"use client"
import { useState, useEffect } from 'react';
import { getApiHeaders } from '@/lib/api';
import type { RiskLog, ForensicDetails } from '@/types/risk';
import { TRUST_PROFILES } from '@/types/risk';
import SovereignConfigurator from '@/components/SovereignConfigurator';
import { MVP1_SCENARIOS, statusToOutcome, matchLogToScenario, type Mvp1Scenario, type ScenarioOutcome } from '@/types/mvp1Scenarios';
import { MVP2_SCENARIOS, statusToOutcomeMvp2, matchLogToScenarioMvp2, type Mvp2Scenario } from '@/types/mvp2Scenarios';

function parseForensicDetails(detailsJson: string): ForensicDetails | null {
  try {
    if (!detailsJson || detailsJson === '[]' || detailsJson === '{}') return null;
    const raw = JSON.parse(detailsJson) as Record<string, unknown>;
    const dm = raw.decisionMatrix as Record<string, unknown> | undefined;
    // Normalize: backend may send PascalCase (CurrentAmount) or camelCase (currentAmount)
    const get = (obj: Record<string, unknown> | undefined, ...keys: string[]) => {
      if (!obj || typeof obj !== 'object') return undefined;
      for (const k of keys) {
        if (k in obj) return obj[k];
      }
      return undefined;
    };
    const matrix = dm ? {
      currentAmount: Number(get(dm, 'currentAmount', 'CurrentAmount')) || 0,
      sovereignCap: get(dm, 'sovereignCap', 'SovereignCap') as number | null ?? null,
      calculatedRisk: Number(get(dm, 'calculatedRisk', 'CalculatedRisk')) || 0,
      maxRiskFloor: Number(get(dm, 'maxRiskFloor', 'MaxRiskFloor')) || 0,
      blockThreshold: Number(get(dm, 'blockThreshold', 'BlockThreshold')) || 100,
      calculatedConfidence: Number(get(dm, 'calculatedConfidence', 'CalculatedConfidence')) || 0,
      minConfidenceCeiling: Number(get(dm, 'minConfidenceCeiling', 'MinConfidenceCeiling')) || 0,
      amountWithinCap: Boolean(get(dm, 'amountWithinCap', 'AmountWithinCap')),
      riskWithinFloor: Boolean(get(dm, 'riskWithinFloor', 'RiskWithinFloor')),
      confidenceAboveCeiling: Boolean(get(dm, 'confidenceAboveCeiling', 'ConfidenceAboveCeiling')),
      verdict: String(get(dm, 'verdict', 'Verdict') ?? ''),
      mfaStatus: String(get(dm, 'mfaStatus', 'MfaStatus') ?? ''),
      breachReason: String(get(dm, 'breachReason', 'BreachReason') ?? ''),
    } : undefined;
    return {
      decisionMatrix: matrix,
      riskResults: raw.riskResults as unknown[] | undefined,
      trustRangeVerdict: String(raw.trustRangeVerdict ?? ''),
      trustRangeReason: String(raw.trustRangeReason ?? ''),
      trustProfile: String(raw.trustProfile ?? ''),
      washSaleWarning: raw.washSaleWarning != null ? String(raw.washSaleWarning) : undefined,
      decentralizationStatus: raw.decentralizationStatus != null ? String(raw.decentralizationStatus) : undefined,
      ensSuspiciousWarning: raw.ensSuspiciousWarning != null ? String(raw.ensSuspiciousWarning) : undefined,
    };
  } catch {
    return null;
  }
}

type InternalStatus = 'BLOCKED' | 'MFA_REQUIRED' | 'APPROVED';

function getStatus(log: RiskLog): InternalStatus {
  const v = (log.verdict || '').toUpperCase();
  if (v.includes('BLOCKED')) return 'BLOCKED';
  if (v.includes('MFA_REQUIRED')) return 'MFA_REQUIRED';
  if (log.riskScore > 50) return 'BLOCKED';
  return 'APPROVED';
}

/** Risk assessment (separate column). OCS assesses risk and communicates. */
function getRiskLabel(status: InternalStatus | 'APPROVED' | 'MFA' | 'BLOCKED'): string {
  if (status === 'APPROVED') return 'Low risk';
  if (status === 'MFA' || status === 'MFA_REQUIRED') return 'Moderate risk';
  if (status === 'BLOCKED') return 'High risk';
  return '—';
}

/** Authorization outcome (Expected / Actual). User decides. */
function getAuthorizationLabel(status: InternalStatus | 'APPROVED' | 'MFA' | 'BLOCKED'): string {
  if (status === 'APPROVED') return 'Authorized';
  if (status === 'MFA' || status === 'MFA_REQUIRED') return 'Requires Authorization';
  if (status === 'BLOCKED') return 'Not Authorized';
  return '—';
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString();
  } catch {
    return ts;
  }
}

interface RegistryEntry {
  id: number;
  hexAddress: string;
  entryType: number;
  confidence: number;
  sovereignCap: number | null;
  maxRiskFloor: number;
  minConfidenceCeiling: number;
  trustProfile: number;
  notes: string;
}

const ENGINE_BASE = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:5193';
const API_BASE = `${ENGINE_BASE}/api/PGTAIL`;
const DIAGNOSTICS_BASE = `${ENGINE_BASE}/api/diagnostics`;

/** MVP-1 demo user's wallets. Label for display and purpose/description. */
const MVP1_WALLET_INFO: Record<string, { label: string; purpose: string }> = {
  test_trusted_partner: { label: 'Trusted Partner (Primary)', purpose: 'Primary wallet for daily transactions and MVP-1 demo. Verified OCS partner.' },
  test_mature_wallet: { label: 'Mature Wallet', purpose: 'Wallet with established history. Supports time-based policies (e.g. Ghost Hours).' },
  test_community_verified: { label: 'Community Verified', purpose: 'Community-approved addresses. Balanced auto-approval for known entities.' },
  test_peeling_chain: { label: 'Peeling Chain', purpose: 'Used for peeling and layering detection scenarios. Higher scrutiny.' },
};

export default function Home() {
  const [loggedInUser, setLoggedInUser] = useState<'mvp1' | null>(null);
  const [logs, setLogs] = useState<RiskLog[]>([]);
  const [forensicLog, setForensicLog] = useState<RiskLog | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'traffic' | 'registry' | 'policy' | 'audit' | 'compliance' | 'mvp'>('traffic');
  const [selectedMvp, setSelectedMvp] = useState<1 | 2 | null>(null);
  /** Selected wallet for policy config. Set from My Wallets or Registry Configure. */
  const [userAddress, setUserAddress] = useState('test_trusted_partner');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  /** MVP-1's connected wallets = whitelisted registry entries. Fallback to known addresses if registry empty. */
  const myWallets = loggedInUser === 'mvp1'
    ? (registry.filter((e) => e.entryType === 1).length > 0
        ? registry.filter((e) => e.entryType === 1)
        : Object.keys(MVP1_WALLET_INFO).map((addr) => ({
            id: 0,
            hexAddress: addr,
            entryType: 1,
            confidence: 100,
            sovereignCap: 1000,
            maxRiskFloor: 50,
            minConfidenceCeiling: 60,
            trustProfile: 1,
            notes: MVP1_WALLET_INFO[addr].label,
          })))
    : [];

  const fetchLogs = async () => {
    setConnectionError(null);
    try {
      const res = await fetch(`${API_BASE}/logs`, { headers: await getApiHeaders() });
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Cannot connect to Engine (${ENGINE_BASE}). Is PGTAIL.Engine running? ${msg}`);
      setLogs([]);
      console.error("Engine Connection Error:", err);
    }
  };

  const isAlreadyOverridden = (address: string, sender: string) => {
    return logs.some((log) =>
      log.classification === 'Whitelist' &&
      log.destinationAddress.toLowerCase() === address.toLowerCase() &&
      log.sourceAddress.toLowerCase() === sender.toLowerCase()
    );
  };

  const handleWhitelist = async (targetAddress: string, userAddress: string) => {
    const response = await fetch(`${API_BASE}/whitelist`, {
      method: 'POST',
      headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: targetAddress, userAddress })
    });
    if (response.ok) await fetchLogs();
  };

  const fetchRegistry = async () => {
    try {
      const res = await fetch(`${API_BASE}/registry`, { headers: await getApiHeaders() });
      const data = await res.json();
      setRegistry(data);
    } catch (err) {
      console.error("Registry fetch error:", err);
    }
  };

  const clearTrafficLogs = async () => {
    try {
      let res = await fetch(`${API_BASE}/logs`, { method: 'DELETE', headers: await getApiHeaders() });
      if (res.status === 405) {
        res = await fetch(`${API_BASE}/logs/clear`, { method: 'POST', headers: await getApiHeaders() });
      }
      if (res.ok) {
        setLogs([]);
        setTrafficResults(null);
        setTrafficResultsMvp2(null);
        await fetchLogs();
      } else {
        setConnectionError(`Clear failed (${res.status}). Engine at ${ENGINE_BASE} may need rebuild.`);
      }
    } catch (err) {
      setConnectionError(`Clear failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleUpdateProfile = async (address: string, trustProfile: number) => {
    const response = await fetch(`${API_BASE}/registry/${encodeURIComponent(address)}`, {
      method: 'PATCH',
      headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ trustProfile })
    });
    if (response.ok) await fetchRegistry();
  };

  const [generating, setGenerating] = useState(false);
  const [generatingMvp2, setGeneratingMvp2] = useState(false);
  const [incidentSwitchEnabled, setIncidentSwitchEnabled] = useState(false);
  const [incidentSwitchLoading, setIncidentSwitchLoading] = useState(false);
  const [trafficResults, setTrafficResults] = useState<{ scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] | null>(null);
  const [trafficResultsMvp2, setTrafficResultsMvp2] = useState<{ scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] | null>(null);

  const generateTraffic = async () => {
    setGenerating(true);
    setConnectionError(null);
    setTrafficResults(null);
    const baseUrl = `${API_BASE}/check-risk`;
    try {
      const results: { scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] = [];
      for (const s of MVP1_SCENARIOS) {
        const body: Record<string, unknown> = {
          FromAddress: s.from,
          ToAddress: s.to,
          Amount: s.amount,
          ...s.params,
        };
        const r = await fetch(baseUrl, {
          method: 'POST',
          headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const actual = statusToOutcome(r.status);
        const pass = actual === s.expected;
        results.push({ scenario: s, actual, pass });
      }
      setTrafficResults(results);
      await fetchLogs();
      setConnectionError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('Traffic generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const generateTrafficMvp2 = async () => {
    setGeneratingMvp2(true);
    setConnectionError(null);
    setTrafficResultsMvp2(null);
    const baseUrl = `${API_BASE}/check-risk`;
    try {
      const results: { scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] = [];
      for (const s of MVP2_SCENARIOS) {
        const body: Record<string, unknown> = {
          FromAddress: s.from,
          ToAddress: s.to,
          Amount: s.amount,
          ...s.params,
        };
        const r = await fetch(baseUrl, {
          method: 'POST',
          headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const actual = statusToOutcomeMvp2(r.status);
        const pass = actual === s.expected;
        results.push({ scenario: s, actual, pass });
      }
      setTrafficResultsMvp2(results);
      await fetchLogs();
      setConnectionError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`MVP-2 traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('MVP-2 traffic generation failed:', err);
    } finally {
      setGeneratingMvp2(false);
    }
  };

  const fetchIncidentSwitch = async () => {
    try {
      const res = await fetch(`${API_BASE}/incident-switch`, { headers: await getApiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setIncidentSwitchEnabled(data.enabled === true);
      }
    } catch { /* ignore */ }
  };

  const toggleIncidentSwitch = async () => {
    setIncidentSwitchLoading(true);
    try {
      const res = await fetch(`${API_BASE}/incident-switch`, {
        method: 'PUT',
        headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !incidentSwitchEnabled })
      });
      if (res.ok) {
        const data = await res.json();
        setIncidentSwitchEnabled(data.enabled === true);
      }
    } catch { /* ignore */ }
    finally { setIncidentSwitchLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, []);
  useEffect(() => { fetchIncidentSwitch(); }, []);
  useEffect(() => { if (activeTab === 'registry') fetchRegistry(); }, [activeTab]);
  useEffect(() => { if (loggedInUser === 'mvp1') fetchRegistry(); }, [loggedInUser]);

  // Auto-refresh traffic every 5 seconds when on Live Traffic tab
  useEffect(() => {
    if (activeTab !== 'traffic') return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  if (!loggedInUser) {
    return (
      <main className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold text-red-500 tracking-tight mb-4">OCS Station Master</h1>
          <p className="text-slate-400 mb-8">Sign in to configure your wallets and run the MVP-1 demo.</p>
          <button
            onClick={() => { setLoggedInUser('mvp1'); setActiveTab('policy'); }}
            className="w-full bg-red-600 hover:bg-red-500 px-8 py-4 rounded-lg font-bold text-lg transition-all"
          >
            Log in as MVP-1
          </button>
          <p className="text-slate-500 text-sm mt-6">Demo user with pre-seeded wallets for testing.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 pb-12 bg-slate-900 min-h-screen text-white font-sans">
      <div className="mb-4 p-3 rounded-lg border border-slate-600 bg-slate-800/50 text-slate-300 text-sm">
        <strong>OCS assesses risk and communicates.</strong> You decide whether to allow or reject each transaction.
      </div>
      {incidentSwitchEnabled && (
        <div className="mb-4 p-4 bg-amber-900/50 border border-amber-600 rounded-lg flex items-center justify-between">
          <span className="font-bold text-amber-400">E5 Incident Switch: ENABLED — Only whitelisted recipients allowed</span>
          <button
            onClick={toggleIncidentSwitch}
            disabled={incidentSwitchLoading}
            className="bg-amber-700 hover:bg-amber-600 px-4 py-2 rounded font-bold text-sm disabled:opacity-50"
          >
            {incidentSwitchLoading ? '…' : 'Disable'}
          </button>
        </div>
      )}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold text-red-500 tracking-tight">OCS Station Master</h1>
          <span className="text-slate-400 text-sm">Logged in as MVP-1</span>
          <button
            onClick={() => setLoggedInUser(null)}
            className="text-slate-500 hover:text-slate-300 text-sm"
          >
            Log out
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('traffic')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'traffic' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Live Traffic
          </button>
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'registry' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Registry
          </button>
          <button
            onClick={() => setActiveTab('policy')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'policy' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Policy Configurator
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'audit' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Audit & Export
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'compliance' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Compliance (PI.06)
          </button>
          <button
            onClick={toggleIncidentSwitch}
            disabled={incidentSwitchLoading}
            className={`px-4 py-2 rounded font-bold transition-all ${incidentSwitchEnabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-600 hover:bg-slate-500'}`}
            title="E5: Pause new recipients — only whitelisted allowed when enabled"
          >
            {incidentSwitchLoading ? '…' : (incidentSwitchEnabled ? '🛡️ Incident ON' : 'Incident Switch')}
          </button>
          <button
            onClick={activeTab === 'registry' ? fetchRegistry : clearTrafficLogs}
            className={activeTab === 'registry' ? 'bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95' : 'bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95'}
            title={activeTab === 'registry' ? 'Refresh registry' : 'Clear traffic logs (DB + UI)'}
          >
            {activeTab === 'registry' ? '🔄 Refresh' : 'Clear Results'}
          </button>
          <button
            onClick={() => setActiveTab('mvp')}
            className={`px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95 ${activeTab === 'mvp' ? 'bg-red-600' : 'bg-emerald-600 hover:bg-emerald-500'}`}
            title="Run MVP-1 or MVP-2 demo scenarios"
          >
            ▶ Run MVP
          </button>
        </div>
      </div>

      {activeTab === 'registry' && (
        <div className="mb-6 bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Trust Profile Selector</h2>
          <p className="text-slate-400 text-sm mb-4">Select a profile to preview the laws that will be applied. Save to update the RegistryEntry on Node .20.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {TRUST_PROFILES.map((p) => (
              <div key={p.value} className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 hover:border-slate-500 transition-colors">
                <p className="font-bold text-slate-200">{p.label}</p>
                <p className="text-xs text-slate-500 mt-1">{p.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <h3 className="text-lg font-bold text-slate-300 mb-3">Registry Entries</h3>
            {registry.length === 0 ? (
              <p className="text-slate-500 italic">No registry entries.</p>
            ) : (
              <div className="space-y-3">
                {registry.map((entry) => (
                  <div key={entry.id} className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-sm text-slate-200">{entry.hexAddress}</p>
                      <p className="text-xs text-slate-500">{entry.notes || 'No notes'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setUserAddress(entry.hexAddress); setActiveTab('policy'); }}
                        className="text-[10px] bg-slate-600 hover:bg-slate-500 px-3 py-1 rounded font-bold"
                        title="Configure policy for this address"
                      >
                        Configure
                      </button>
                      <select
                        value={entry.trustProfile}
                        onChange={(e) => handleUpdateProfile(entry.hexAddress, parseInt(e.target.value, 10))}
                        className="bg-slate-700 text-slate-200 px-3 py-2 rounded text-sm border border-slate-600"
                      >
                        {TRUST_PROFILES.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <span className="text-xs text-slate-500">Cap: ${entry.sovereignCap ?? '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'policy' && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-2 text-slate-300 underline underline-offset-8">My Wallets</h2>
          <p className="text-slate-400 text-sm mb-4">Select a wallet to configure its policy. Policy applies when that wallet sends transactions.</p>
          <div className="flex flex-wrap items-start gap-4 mb-8">
            <div className="flex-shrink-0">
              <label className="block text-xs text-slate-500 mb-1">Wallet</label>
              <select
                value={userAddress}
                onChange={(e) => setUserAddress(e.target.value)}
                className="bg-slate-700 text-slate-200 px-4 py-2 rounded-lg border border-slate-600 min-w-[16rem] font-mono text-sm"
              >
                {myWallets.map((w) => (
                  <option key={w.hexAddress} value={w.hexAddress}>
                    {MVP1_WALLET_INFO[w.hexAddress]?.label ?? w.hexAddress}
                  </option>
                ))}
              </select>
            </div>
            {(() => {
              const selected = myWallets.find((w) => w.hexAddress.toLowerCase() === userAddress.toLowerCase());
              const info = selected ? MVP1_WALLET_INFO[selected.hexAddress] : null;
              return selected ? (
                <div className="flex-1 min-w-0 p-4 rounded-lg border border-slate-600 bg-slate-900/50 space-y-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Address</p>
                    <p className="font-mono text-sm text-slate-200 break-all">{selected.hexAddress}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Purpose</p>
                    <p className="text-sm text-slate-300">{info?.purpose ?? selected.notes ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Cap: ${selected.sovereignCap ?? '—'} · Profile: {TRUST_PROFILES.find((p) => p.value === selected.trustProfile)?.label ?? '—'}</p>
                  </div>
                </div>
              ) : null;
            })()}
          </div>
          <h3 className="text-lg mb-2 text-slate-300">Policy for {MVP1_WALLET_INFO[userAddress]?.label ?? userAddress}</h3>
          <p className="text-slate-400 text-sm mb-4">Choose a defense posture for this wallet, or deploy a Custom policy with your own thresholds.</p>
          <details className="mb-4 rounded-lg border border-slate-600 bg-slate-900/30">
            <summary className="px-4 py-2 cursor-pointer text-slate-400 hover:text-slate-200 text-sm font-medium">MVP-1 Demo Guide — click to expand</summary>
            <div className="px-4 pb-4 pt-2 text-sm text-slate-400 space-y-3">
              <p className="font-medium text-slate-300">1. Configure policy</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Under Defense Posture, click <strong>Custom</strong></li>
                <li>Expand Trust-Range → set Sovereign Cap to <strong>1000</strong></li>
                <li>Click <strong>Deploy Sovereign Law</strong></li>
              </ul>
              <p className="font-medium text-slate-300">2. Run traffic</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Go to <strong>▶ Run MVP</strong> → choose MVP-1 → <strong>▶ Run MVP-1</strong></li>
                <li>Or use <strong>Audit & Export</strong> → Check Risk form</li>
              </ul>
              <p className="font-medium text-slate-300">3. Verify outcomes</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><strong>Live Traffic</strong> tab shows Risk (Low/Moderate/High) and Authorization (Authorized/Not Authorized/Requires Authorization)</li>
                <li>Click <strong>View Forensics</strong> on any row for the decision matrix</li>
              </ul>
            </div>
          </details>
          <SovereignConfigurator targetAddress={userAddress} />
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Audit & Export</h2>
          <p className="text-slate-400 text-sm mb-6">Download forensic and compliance exports from the Engine.</p>
          <div className="mb-8 p-4 rounded-lg border border-slate-600 bg-slate-900/50">
            <h3 className="text-sm font-bold text-slate-400 mb-3">Check Risk (I2 Slippage)</h3>
            <p className="text-xs text-slate-500 mb-3">Test check-risk with optional swap params. For DEX swaps, set Max Slippage % to enforce I2 guard.</p>
            <CheckRiskForm apiBase={API_BASE} onSuccess={() => fetchLogs()} />
          </div>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/audit/export?format=csv`, { headers: await getApiHeaders() });
                  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ocs-disclosure-report-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setConnectionError(e instanceof Error ? e.message : 'CSV export failed');
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded font-bold"
            >
              Export Disclosure Report (CSV) — N1
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/audit/export/signed`, { headers: await getApiHeaders() });
                  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ocs-forensics-signed-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setConnectionError(e instanceof Error ? e.message : 'Signed bundle export failed');
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded font-bold"
            >
              Download Signed Forensics Bundle — F3
            </button>
          </div>
        </div>
      )}

      {activeTab === 'compliance' && (
        <ComplianceTab diagnosticsBase={DIAGNOSTICS_BASE} getApiHeaders={getApiHeaders} />
      )}

      {activeTab === 'mvp' && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">MVP Demo</h2>
          {!selectedMvp ? (
            <div className="space-y-4">
              <p className="text-slate-400">Choose which MVP to run. Each has its own prerequisites and scenarios.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button
                  onClick={() => setSelectedMvp(1)}
                  className="p-6 rounded-lg border-2 border-slate-600 bg-slate-900/50 hover:border-emerald-500 hover:bg-emerald-900/20 text-left transition-all"
                >
                  <p className="font-bold text-xl text-emerald-400 mb-2">MVP-1</p>
                  <p className="text-sm text-slate-400 mb-2">The Sovereign Foundation</p>
                  <p className="text-xs text-slate-500">18 scenarios: C7, B2, E6, E7, E4, H3 (all 3 extremes per feature)</p>
                  <p className="text-xs text-slate-500 mt-1">Prerequisite: Policy Configurator → Trusted Partner → Custom → Sovereign Cap $1000 → Deploy</p>
                </button>
                <button
                  onClick={() => setSelectedMvp(2)}
                  className="p-6 rounded-lg border-2 border-slate-600 bg-slate-900/50 hover:border-amber-500 hover:bg-amber-900/20 text-left transition-all"
                >
                  <p className="font-bold text-xl text-amber-400 mb-2">MVP-2</p>
                  <p className="text-sm text-slate-400 mb-2">Enterprise Guard</p>
                  <p className="text-xs text-slate-500">7 scenarios: H1, H2, H3, J1, K1, I2, B1</p>
                  <p className="text-xs text-slate-500 mt-1">Prerequisite: Policy Configurator → Trusted Partner → Institutional → Custom → Hardware Wallet Required Above = 1000 → Deploy</p>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { setSelectedMvp(null); setTrafficResults(null); setTrafficResultsMvp2(null); }}
                  className="text-slate-400 hover:text-white text-sm font-bold"
                >
                  ← Choose different MVP
                </button>
              </div>
              {selectedMvp === 1 && (
                <>
                  <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                    <p className="text-sm font-bold text-slate-300 mb-2">MVP-1 Prerequisites</p>
                    <ul className="text-xs text-slate-400 list-disc list-inside space-y-1">
                      <li>Engine running (dotnet run on 5193, or Docker on 8080)</li>
                      <li>Database seeded (POST /api/diagnostics/seed)</li>
                      <li>Policy Configurator: Trusted Partner → Custom → Sovereign Cap $1000 → Deploy</li>
                    </ul>
                    <div className="flex gap-4 mt-4">
                      <button
                        onClick={async () => {
                          try {
                            await fetch(`${DIAGNOSTICS_BASE}/seed`, { method: 'POST', headers: await getApiHeaders() });
                          } catch (e) {
                            setConnectionError(e instanceof Error ? e.message : 'Seed failed');
                          }
                        }}
                        className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold text-sm"
                      >
                        Seed Database
                      </button>
                      <button
                        onClick={generateTraffic}
                        disabled={generating}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm"
                      >
                        {generating ? '⏳ Running…' : '▶ Run MVP-1'}
                      </button>
                    </div>
                  </div>
                  {trafficResults && (
                    <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                      <h3 className="text-sm font-bold text-slate-400 mb-3">MVP-1 Results — {trafficResults.filter((r) => r.pass).length}/{trafficResults.length} passed</h3>
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-600 text-slate-500">
                            <th className="p-2">Feature</th>
                            <th className="p-2">Scenario</th>
                            <th className="p-2">Risk</th>
                            <th className="p-2">Expected</th>
                            <th className="p-2">Actual</th>
                            <th className="p-2">Pass</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trafficResults.map((r, i) => (
                            <tr key={i} className={`border-b border-slate-700/50 ${r.pass ? '' : 'bg-red-900/20'}`}>
                              <td className="p-2 font-mono text-slate-300">{r.scenario.featureId}</td>
                              <td className="p-2 text-slate-300">{r.scenario.label}</td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/20 text-green-300' : r.scenario.expected === 'MFA' ? 'bg-amber-900/20 text-amber-300' : 'bg-red-900/20 text-red-300'}`}>{getRiskLabel(r.scenario.expected)}</span></td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/50' : r.scenario.expected === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'}`}>{getAuthorizationLabel(r.scenario.expected)}</span></td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.actual === 'APPROVED' ? 'bg-green-900/50' : r.actual === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'}`}>{getAuthorizationLabel(r.actual)}</span></td>
                              <td className="p-2 font-bold">{r.pass ? '✓' : '✗'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {selectedMvp === 2 && (
                <>
                  <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                    <p className="text-sm font-bold text-slate-300 mb-2">MVP-2 Prerequisites</p>
                    <ul className="text-xs text-slate-400 list-disc list-inside space-y-1">
                      <li>MVP-1 prerequisites</li>
                      <li>Policy Configurator: Trusted Partner → Institutional → Custom → Hardware Wallet Required Above = 1000 → Deploy</li>
                    </ul>
                    <div className="flex gap-4 mt-4">
                      <button
                        onClick={async () => {
                          try {
                            await fetch(`${DIAGNOSTICS_BASE}/seed`, { method: 'POST', headers: await getApiHeaders() });
                          } catch (e) {
                            setConnectionError(e instanceof Error ? e.message : 'Seed failed');
                          }
                        }}
                        className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold text-sm"
                      >
                        Seed Database
                      </button>
                      <button
                        onClick={generateTrafficMvp2}
                        disabled={generatingMvp2}
                        className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm"
                      >
                        {generatingMvp2 ? '⏳ Running…' : '▶ Run MVP-2'}
                      </button>
                    </div>
                  </div>
                  {trafficResultsMvp2 && (
                    <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                      <h3 className="text-sm font-bold text-slate-400 mb-3">MVP-2 Results — {trafficResultsMvp2.filter((r) => r.pass).length}/{trafficResultsMvp2.length} passed</h3>
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-600 text-slate-500">
                            <th className="p-2">Feature</th>
                            <th className="p-2">Scenario</th>
                            <th className="p-2">Risk</th>
                            <th className="p-2">Expected</th>
                            <th className="p-2">Actual</th>
                            <th className="p-2">Pass</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trafficResultsMvp2.map((r, i) => (
                            <tr key={i} className={`border-b border-slate-700/50 ${r.pass ? '' : 'bg-red-900/20'}`}>
                              <td className="p-2 font-mono text-slate-300">{r.scenario.featureId}</td>
                              <td className="p-2 text-slate-300">{r.scenario.label}</td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/20 text-green-300' : r.scenario.expected === 'MFA' ? 'bg-amber-900/20 text-amber-300' : 'bg-red-900/20 text-red-300'}`}>{getRiskLabel(r.scenario.expected)}</span></td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/50' : r.scenario.expected === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'}`}>{getAuthorizationLabel(r.scenario.expected)}</span></td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.actual === 'APPROVED' ? 'bg-green-900/50' : r.actual === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'}`}>{getAuthorizationLabel(r.actual)}</span></td>
                              <td className="p-2 font-bold">{r.pass ? '✓' : '✗'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {connectionError && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          <strong>Connection Error:</strong> {connectionError}
          <p className="mt-2 text-xs text-slate-400">
            {ENGINE_BASE.startsWith('http://localhost') || ENGINE_BASE.includes('192.168')
              ? <>Run <code className="bg-slate-800 px-1 rounded">dotnet run</code> in the PGTAIL.Engine folder. With UseLocalDb, no PostgreSQL required.</>
              : <>Check that the Engine at <code className="bg-slate-800 px-1 rounded">{ENGINE_BASE}</code> is running and CORS allows this origin. Verify <code>NEXT_PUBLIC_ENGINE_URL</code> in Vercel.</>
            }
          </p>
        </div>
      )}

      {activeTab === 'traffic' && <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
        <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Live Traffic Monitor</h2>
        <p className="text-sm text-slate-500 mb-4">
          MVP-1: 6 scenarios (C7, B2, E6, E7, E4). MVP-2: 7 scenarios (H1, H2, H3, J1, K1, I2, B1). Results tie feature → expected → actual → pass/fail.
          <span className="block mt-1 text-xs">Feature column maps each log row to the scenario that produced it. B1: set HardwareWalletRequiredAbove=1000 on Trusted Partner via Custom posture first.</span>
        </p>
        {trafficResults && (
          <div className="mb-6 p-4 rounded-lg border border-slate-600 bg-slate-900/50">
            <h3 className="text-sm font-bold text-slate-400 mb-3">MVP-1 Scenario Results — Settings → Tests → Outcomes</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-600 text-slate-500">
                  <th className="p-2">Feature</th>
                  <th className="p-2">Scenario</th>
                  <th className="p-2">Risk</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Actual</th>
                  <th className="p-2">Pass</th>
                </tr>
              </thead>
              <tbody>
                {trafficResults.map((r, i) => (
                  <tr key={i} className={`border-b border-slate-700/50 ${r.pass ? '' : 'bg-red-900/20'}`}>
                    <td className="p-2 font-mono text-slate-300">{r.scenario.featureId}</td>
                    <td className="p-2 text-slate-300">{r.scenario.label}</td>
                    <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/20 text-green-300' : r.scenario.expected === 'MFA' ? 'bg-amber-900/20 text-amber-300' : 'bg-red-900/20 text-red-300'}`}>{getRiskLabel(r.scenario.expected)}</span></td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        r.scenario.expected === 'APPROVED' ? 'bg-green-900/50' :
                        r.scenario.expected === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'
                      }`}>{getAuthorizationLabel(r.scenario.expected)}</span>
                    </td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        r.actual === 'APPROVED' ? 'bg-green-900/50' :
                        r.actual === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'
                      }`}>{getAuthorizationLabel(r.actual)}</span>
                    </td>
                    <td className="p-2 font-bold">{r.pass ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">
              {trafficResults.filter((r) => r.pass).length}/{trafficResults.length} passed.
              {trafficResults.some((r) => !r.pass) && ' Failures may be due to Policy Configurator settings (e.g. sovereignCap=0 breaks C7 Cap OK).'}
            </p>
          </div>
        )}
        {trafficResultsMvp2 && (
          <div className="mb-6 p-4 rounded-lg border border-slate-600 bg-slate-900/50">
            <h3 className="text-sm font-bold text-slate-400 mb-3">MVP-2 Scenario Results — H1, H2, H3, J1, K1, I2, B1</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-600 text-slate-500">
                  <th className="p-2">Feature</th>
                  <th className="p-2">Scenario</th>
                  <th className="p-2">Risk</th>
                  <th className="p-2">Expected</th>
                  <th className="p-2">Actual</th>
                  <th className="p-2">Pass</th>
                </tr>
              </thead>
              <tbody>
                {trafficResultsMvp2.map((r, i) => (
                  <tr key={i} className={`border-b border-slate-700/50 ${r.pass ? '' : 'bg-red-900/20'}`}>
                    <td className="p-2 font-mono text-slate-300">{r.scenario.featureId}</td>
                    <td className="p-2 text-slate-300">{r.scenario.label}</td>
                    <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-xs ${r.scenario.expected === 'APPROVED' ? 'bg-green-900/20 text-green-300' : r.scenario.expected === 'MFA' ? 'bg-amber-900/20 text-amber-300' : 'bg-red-900/20 text-red-300'}`}>{getRiskLabel(r.scenario.expected)}</span></td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        r.scenario.expected === 'APPROVED' ? 'bg-green-900/50' :
                        r.scenario.expected === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'
                      }`}>{getAuthorizationLabel(r.scenario.expected)}</span>
                    </td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        r.actual === 'APPROVED' ? 'bg-green-900/50' :
                        r.actual === 'MFA' ? 'bg-amber-900/50' : 'bg-red-900/50'
                      }`}>{getAuthorizationLabel(r.actual)}</span>
                    </td>
                    <td className="p-2 font-bold">{r.pass ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">
              {trafficResultsMvp2.filter((r) => r.pass).length}/{trafficResultsMvp2.length} passed.
              {trafficResultsMvp2.some((r) => !r.pass) && ' B1 requires HardwareWalletRequiredAbove on Trusted Partner.'}
            </p>
          </div>
        )}
        {logs.some((l) => getStatus(l) === 'MFA_REQUIRED') && (
          <div className="mb-4 p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-amber-400">Your decision required</p>
              <p className="text-sm text-amber-200/90">
                One or more transactions need your approval. OCS assessed the risk — you decide whether to allow. Click &quot;View Forensics&quot; for details.
              </p>
            </div>
          </div>
        )}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th className="p-3 text-sm uppercase tracking-wider">Timestamp</th>
              <th className="p-3 text-sm uppercase tracking-wider" title="Feature that produced this log (MVP-1: C7, B2, E6, E7, E4; MVP-2: H1–H3, J1, K1, I2, B1)">Feature</th>
              <th className="p-3 text-sm uppercase tracking-wider">Target Address / Alert</th>
              <th className="p-3 text-sm uppercase tracking-wider">Risk Score</th>
              <th className="p-3 text-sm uppercase tracking-wider">Risk</th>
              <th className="p-3 text-sm uppercase tracking-wider">Authorization</th>
              <th className="p-3 text-sm uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500 italic">No traffic detected. Standby...</td></tr>
            ) : (
              logs.map((log, i) => {
                const status = getStatus(log);
                const overridden = isAlreadyOverridden(log.destinationAddress, log.sourceAddress);
                const isManualOverride = log.classification === 'Whitelist';
                const details = parseForensicDetails(log.detailsJson ?? '');
                const amount = details?.decisionMatrix?.currentAmount;
                const reason = details?.trustRangeReason || log.reason || '';
                const scenarioMvp2 = matchLogToScenarioMvp2(log.sourceAddress, log.destinationAddress, amount, reason);
                const scenarioMvp1 = matchLogToScenario(log.sourceAddress, log.destinationAddress, amount);
                const scenario = scenarioMvp2 ?? scenarioMvp1;

                const rowBg = status === 'BLOCKED' ? 'bg-red-900/20' :
                  status === 'MFA_REQUIRED' ? 'bg-amber-900/20' :
                  isManualOverride ? 'bg-blue-900/10' : '';

                return (
                  <tr key={i} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${rowBg}`}>
                    <td className="p-3 text-xs text-slate-500 font-mono">{formatTime(log.timestamp)}</td>
                    <td className="p-3">
                      {scenario ? (
                        <span className="text-xs font-mono font-bold text-slate-300" title={scenario.label}>
                          {scenario.featureId}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-mono text-xs text-slate-200">{log.destinationAddress}</div>
                      <div className={`text-[10px] italic mt-1 font-bold ${isManualOverride ? 'text-blue-400' : (log.riskScore > 50 ? 'text-yellow-500' : 'text-slate-400')}`}>
                        {isManualOverride ? '🔹 ' : (log.riskScore > 50 ? '⚠️ ' : '✅ ')} {log.reason || log.verdict}
                      </div>
                    </td>
                    <td className="p-3 font-bold text-slate-300">{log.riskScore}/100</td>
                    <td className="p-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded ${
                        status === 'BLOCKED' ? 'bg-red-900/20 text-red-300' :
                        status === 'MFA_REQUIRED' ? 'bg-amber-900/20 text-amber-300' :
                        'bg-green-900/20 text-green-300'
                      }`}>
                        {getRiskLabel(status)}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`font-black px-2 py-0.5 rounded text-[11px] ${
                        status === 'BLOCKED' ? 'bg-red-900/30 text-red-400' :
                        status === 'MFA_REQUIRED' ? 'bg-amber-900/30 text-amber-400' :
                        'bg-green-900/30 text-green-400'
                      }`} title="OCS assesses risk. You decide whether to allow the transaction.">
                        {getAuthorizationLabel(status)}
                      </span>
                    </td>
                    <td className="p-3 text-right flex gap-2 justify-end">
                      <button
                        onClick={() => setForensicLog(log)}
                        className="text-[10px] bg-slate-600 hover:bg-slate-500 px-3 py-1 rounded font-bold uppercase tracking-tighter transition-all"
                      >
                        View Forensics
                      </button>
                      {status !== 'APPROVED' && !isManualOverride && !overridden && (
                        <button
                          onClick={() => handleWhitelist(log.destinationAddress, log.sourceAddress)}
                          className="text-[10px] bg-green-700 hover:bg-green-600 px-3 py-1 rounded font-black uppercase tracking-tighter transition-all"
                        >
                          Whitelist
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>}

      {forensicLog && (
        <ForensicModal log={forensicLog} onClose={() => setForensicLog(null)} />
      )}
    </main>
  );
}

function CheckRiskForm({ apiBase, onSuccess }: { apiBase: string; onSuccess: () => void }) {
  const [from, setFrom] = useState('test_trusted_partner');
  const [to, setTo] = useState('test_mature_wallet');
  const [amount, setAmount] = useState('100');
  const [maxSlippage, setMaxSlippage] = useState('');
  const [slippage, setSlippage] = useState('');
  const [txType, setTxType] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        FromAddress: from,
        ToAddress: to,
        Amount: amount,
      };
      if (txType) body.TransactionType = txType;
      if (maxSlippage) body.MaxSlippagePercent = parseFloat(maxSlippage);
      if (slippage) body.SlippagePercent = parseFloat(slippage);

      const r = await fetch(`${apiBase}/check-risk`, {
        method: 'POST',
        headers: { ...(await getApiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 200) {
        const data = await r.json();
        setResult(`Authorized: ${data.precheckVerdict ?? data.trustRangeVerdict ?? 'You may proceed'}`);
        onSuccess();
      } else if (r.status === 202) {
        const data = await r.json();
        setResult(`Requires Authorization: ${data.riskAdvice ?? 'Review and decide'}`);
        onSuccess();
      } else if (r.status === 403) {
        const data = await r.json().catch(() => ({}));
        setResult(`Not Authorized: ${data.description ?? data.riskAdvice ?? 'Review before proceeding'}`);
        onSuccess();
      } else {
        setResult(`Error: ${r.status}`);
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="block text-xs text-slate-500 mb-1">From</label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">To</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Tx Type</label>
        <select value={txType} onChange={(e) => setTxType(e.target.value)} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm">
          <option value="">—</option>
          <option value="dex_swap">dex_swap</option>
          <option value="bridge">bridge</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Max Slippage % (I2)</label>
        <input value={maxSlippage} onChange={(e) => setMaxSlippage(e.target.value)} placeholder="e.g. 1" className="w-20 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Slippage %</label>
        <input value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder="e.g. 2" className="w-20 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <button onClick={handleSubmit} disabled={loading} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 rounded font-bold text-sm">
        {loading ? '…' : 'Check Risk'}
      </button>
      {result && <span className="text-sm text-slate-300">{result}</span>}
    </div>
  );
}

function ForensicModal({ log, onClose }: { log: RiskLog; onClose: () => void }) {
  if (!log) return null;
  const details = parseForensicDetails(log.detailsJson ?? '');
  const matrix = details?.decisionMatrix;
  const status = getStatus(log);

  const verdictLine = status !== 'APPROVED' && details?.trustProfile
    ? `Verdict: ${status} | Reason: ${details.trustRangeReason || log.reason} (${details.trustProfile} Active${details.trustProfile === 'TimeSentry' ? ' - Ghost Hours Policy' : ''})`
    : `Verdict: ${status} | Reason: ${details?.trustRangeReason || log.reason}`;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-xl font-bold text-slate-200">Forensic Details</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          <div className="space-y-4">
            {status === 'MFA_REQUIRED' && (
              <div className="p-4 bg-amber-900/40 border border-amber-600/60 rounded-lg">
                <p className="text-sm font-bold text-amber-400 mb-1">Your decision required</p>
                <p className="text-slate-200 text-sm">{details?.trustRangeReason || details?.decisionMatrix?.breachReason || log.reason || 'N/A'}</p>
                <p className="text-xs text-amber-300/80 mt-2">OCS assessed the risk. You decide whether to allow or reject this transaction.</p>
              </div>
            )}
            {details?.washSaleWarning && (
              <div className="p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                <p className="text-sm font-bold text-amber-400 mb-1">N2 Wash-Sale Warning</p>
                <p className="text-slate-200 text-sm">{details.washSaleWarning}</p>
              </div>
            )}
            {details?.decentralizationStatus && (
              <div className="p-3 bg-slate-900/50 rounded border border-slate-600">
                <p className="text-sm font-bold text-slate-400 mb-1">N3 Decentralization Status</p>
                <p className="text-slate-200 text-sm">{details.decentralizationStatus}</p>
              </div>
            )}
            {details?.ensSuspiciousWarning && (
              <div className="p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg">
                <p className="text-sm font-bold text-amber-400 mb-1">K3 ENS/UNS Suspicious</p>
                <p className="text-slate-200 text-sm">{details.ensSuspiciousWarning}</p>
              </div>
            )}
            <div className="p-3 bg-slate-900/50 rounded border border-slate-600">
              <p className="text-sm font-bold text-amber-400 mb-1">Risk Advice (Iron Sentry)</p>
              <p className="text-slate-200 text-sm">{details?.trustRangeReason || log.reason || 'N/A'}</p>
            </div>

            <div className="p-3 bg-slate-900/50 rounded border border-slate-600">
              <p className="text-sm font-bold text-slate-400 mb-1">Verdict</p>
              <p className="text-slate-200 text-sm">{verdictLine}</p>
              {details?.trustProfile && (
                <p className="text-xs text-slate-500 mt-1">Trust Profile: {details.trustProfile}</p>
              )}
            </div>

            {matrix && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-slate-400">Sovereign Decision Matrix</p>

                <CheckRow
                  label="Limit Check (Amount vs. Cap)"
                  value={`$${Number(matrix.currentAmount ?? 0).toFixed(2)} vs. $${Number(matrix.sovereignCap ?? 0).toFixed(2)}`}
                  ok={Boolean(matrix.amountWithinCap)}
                />
                <CheckRow
                  label="Allow Check (Risk vs. Allow Threshold)"
                  value={`${matrix.calculatedRisk ?? 0} vs. ${matrix.maxRiskFloor ?? 0}`}
                  ok={Boolean(matrix.riskWithinFloor)}
                />
                <CheckRow
                  label="Block Check (Risk vs. Block Threshold)"
                  value={`${matrix.calculatedRisk ?? 0} vs. ${matrix.blockThreshold ?? 100}`}
                  ok={(matrix.calculatedRisk ?? 0) < (matrix.blockThreshold ?? 100)}
                />
                <CheckRow
                  label="Confidence Check (Confidence vs. Ceiling)"
                  value={`${matrix.calculatedConfidence ?? 0}% vs. ${matrix.minConfidenceCeiling ?? 0}%`}
                  ok={Boolean(matrix.confidenceAboveCeiling)}
                />
              </div>
            )}

            {!matrix && details && (
              <p className="text-slate-500 text-sm italic">No decision matrix in forensic data (legacy log).</p>
            )}

            {!details && (
              <p className="text-slate-500 text-sm italic">Could not parse forensic details (malformed or empty JSON).</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between p-2 bg-slate-900/30 rounded">
      <span className="text-slate-300 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-slate-400 text-xs font-mono">{value}</span>
        <span className={`w-3 h-3 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} title={ok ? 'Pass' : 'Fail'} />
      </div>
    </div>
  );
}

/** PI.06 Sprint 4: F4, E2, M2, H5, G4 — Compliance & Horizon diagnostics */
function ComplianceTab({ diagnosticsBase, getApiHeaders }: { diagnosticsBase: string; getApiHeaders: () => Promise<Record<string, string>> }) {
  const [f4, setF4] = useState<Record<string, unknown> | null>(null);
  const [e2, setE2] = useState<Record<string, unknown> | null>(null);
  const [h5, setH5] = useState<Record<string, unknown> | null>(null);
  const [g4, setG4] = useState<Record<string, unknown> | null>(null);
  const [m2Status, setM2Status] = useState<string>('—');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const h = await getApiHeaders();
        const [rF4, rE2, rH5, rG4] = await Promise.all([
          fetch(`${diagnosticsBase}/comms-templates`, { headers: h }),
          fetch(`${diagnosticsBase}/geofencing`, { headers: h }),
          fetch(`${diagnosticsBase}/eip7702-policy`, { headers: h }),
          fetch(`${diagnosticsBase}/playbooks`, { headers: h }),
        ]);
        if (!cancelled) {
          setF4(rF4.ok ? await rF4.json() : null);
          setE2(rE2.ok ? await rE2.json() : null);
          setH5(rH5.ok ? await rH5.json() : null);
          setG4(rG4.ok ? await rG4.json() : null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [diagnosticsBase, getApiHeaders]);

  const testM2 = async () => {
    try {
      const h = await getApiHeaders();
      const r = await fetch(`${diagnosticsBase}/recovery-attestation`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attestationPayload: 'test-stub', deviceId: 'dashboard-test' }),
      });
      const data = r.ok ? await r.json() : null;
      setM2Status(data?.valid ? 'Accepted' : `HTTP ${r.status}`);
    } catch (e) {
      setM2Status(e instanceof Error ? e.message : 'Error');
    }
  };

  if (loading) return <div className="bg-slate-800 p-6 rounded-lg border border-slate-700"><p className="text-slate-400">Loading compliance policies…</p></div>;
  if (error) return <div className="bg-slate-800 p-6 rounded-lg border border-slate-700"><p className="text-red-400">Error: {error}</p></div>;

  return (
    <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
      <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Compliance & Horizon (PI.06 Sprint 4)</h2>
      <p className="text-slate-400 text-sm mb-6">Engine diagnostics for F4, E2, M2, H5, G4.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">F4 — Customer Comms Templates</h3>
          {f4?.templates && Array.isArray(f4.templates) ? (
            <ul className="text-xs text-slate-400 space-y-1">
              {(f4.templates as { id?: string; subject?: string }[]).map((t, i) => (
                <li key={i}>{t.id}: {t.subject}</li>
              ))}
            </ul>
          ) : <p className="text-slate-500 text-sm">—</p>}
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">E2 — Geo/IP Geofencing</h3>
          <p className="text-sm text-slate-400">Travel mode: {e2?.travelModeEnabled ? 'Enabled' : '—'}</p>
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">M2 — Recovery Phrase Attestation</h3>
          <p className="text-sm text-slate-400 mb-2">Status: {m2Status}</p>
          <button onClick={testM2} className="text-xs bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded">Test attestation</button>
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">H5 — EIP-7702 Abuse Detection</h3>
          <p className="text-sm text-slate-400">Block unverified: {h5?.blockUnverifiedDelegation ? 'Yes' : '—'}</p>
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 md:col-span-2">
          <h3 className="font-bold text-slate-200 mb-2">G4 — Incident Playbooks</h3>
          {g4?.playbooks && Array.isArray(g4.playbooks) ? (
            <ul className="text-xs text-slate-400 space-y-1">
              {(g4.playbooks as { id?: string; name?: string; raci?: string }[]).map((p, i) => (
                <li key={i}><strong>{p.name}</strong> — RACI: {p.raci}</li>
              ))}
            </ul>
          ) : <p className="text-slate-500 text-sm">—</p>}
        </div>
      </div>
    </div>
  );
}
