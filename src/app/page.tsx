"use client"
import { useState, useEffect } from 'react';
import { getApiHeaders } from '@/lib/api';
import type { RiskLog, ForensicDetails } from '@/types/risk';
import SovereignConfigurator from '@/components/SovereignConfigurator';
import AuditTab from '@/components/AuditTab';
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

const MVP_DEMO_REGISTRY_HINT =
  'Runs use live Engine policy per scenario wallet. Optional: click “Auto-configure policy for MVP” first to reset demo registry rows and clear deploy overrides so Current Settings match the scripted MVP-1 table.';

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
  const [activeTab, setActiveTab] = useState<'traffic' | 'registryPolicy' | 'audit'>('traffic');
  /** Selected wallet for policy config. Set from My Wallets or Registry Configure. */
  const [userAddress, setUserAddress] = useState('test_trusted_partner');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  /** Bumped after MVP auto-configure (seed) so Policy Configurator reloads Current Settings from API. */
  const [registryConfiguratorSync, setRegistryConfiguratorSync] = useState(0);

  /** MVP-1's connected wallets = whitelisted registry entries. Fallback to known addresses if registry empty. */
  const whitelisted = registry.filter((e) => e.entryType === 1);
  const myWallets = loggedInUser === 'mvp1'
    ? (whitelisted.length >= 1
        ? whitelisted
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

  const [generating, setGenerating] = useState(false);
  const [generatingMvp2, setGeneratingMvp2] = useState(false);
  const [incidentSwitchEnabled, setIncidentSwitchEnabled] = useState(false);
  const [incidentSwitchLoading, setIncidentSwitchLoading] = useState(false);
  const [trafficResults, setTrafficResults] = useState<{ scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] | null>(null);
  const [trafficResultsMvp2, setTrafficResultsMvp2] = useState<{ scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] | null>(null);
  /** MVP auto-configure (POST seed): optional; opening MVP alone does not call it. */
  const [mvpAutoSeed, setMvpAutoSeed] = useState<{
    phase: 'idle' | 'restoring' | 'ok' | 'error';
    detail?: string;
  }>({ phase: 'idle', detail: MVP_DEMO_REGISTRY_HINT });

  const autoConfigurePolicyForMvp = async () => {
    setMvpAutoSeed({ phase: 'restoring' });
    setConnectionError(null);
    try {
      const res = await fetch(`${DIAGNOSTICS_BASE}/seed`, { method: 'POST', headers: await getApiHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRegistry();
      setRegistryConfiguratorSync((n) => n + 1);
      setActiveTab('registryPolicy');
      setMvpAutoSeed({
        phase: 'ok',
        detail:
          'MVP demo policy applied: demo registry rows reset and PolicyOverrides cleared so Current Settings match what the MVP table expects. Review Registry & Policy for your wallet, then return here to run.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setMvpAutoSeed({ phase: 'error', detail: msg });
      setConnectionError(`Could not auto-configure policy for MVP: ${msg}`);
    }
  };

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

      // Split scenarios: H1–I2 run against the seeded default policy (cap=$1000).
      // B1 scenarios need a higher cap so the HW threshold fires independently — deploy first.
      const preB1 = MVP2_SCENARIOS.filter((s) => s.featureId !== 'B1');
      const b1Scenarios = MVP2_SCENARIOS.filter((s) => s.featureId === 'B1');

      for (const s of preB1) {
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
        results.push({ scenario: s, actual, pass: actual === s.expected });
      }

      if (b1Scenarios.length > 0) {
        // Deploy B1 policy: Custom profile, cap=$100k, HW threshold=$1000
        await fetch(`${API_BASE}/registry/test_trusted_partner/policy`, {
          method: 'PUT',
          headers: { ...await getApiHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ TrustProfile: 2, SovereignCap: 100000, HardwareWalletRequiredAbove: 1000 }),
        });
        for (const s of b1Scenarios) {
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
          results.push({ scenario: s, actual, pass: actual === s.expected });
        }
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
  useEffect(() => { if (activeTab === 'registryPolicy') fetchRegistry(); }, [activeTab]);
  useEffect(() => { if (loggedInUser === 'mvp1') fetchRegistry(); }, [loggedInUser]);

  // Auto-refresh traffic every 5 seconds when on Live Traffic tab
  useEffect(() => {
    if (activeTab !== 'traffic') return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  if (!loggedInUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h1 className="text-4xl font-bold text-red-500 tracking-tight mb-4">OCS Station Master</h1>
          <p className="text-slate-400 mb-8">Sign in to configure your wallets and run the MVP-1 demo.</p>
          <button
            onClick={() => { setLoggedInUser('mvp1'); setActiveTab('registryPolicy'); }}
            className="w-full bg-red-600 hover:bg-red-500 px-8 py-4 rounded-lg font-bold text-lg transition-all"
          >
            Log in as MVP-1
          </button>
          <p className="text-slate-500 text-sm mt-6">Demo user with pre-seeded wallets for testing.</p>
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SWC parser workaround for JSX after return
  return (0 as any) || <main className="p-8 pb-12 bg-slate-900 min-h-screen text-white font-sans">
      <div className="mb-4 p-3 rounded-lg border border-slate-600 bg-slate-800/50 text-slate-300 text-sm">
        <strong>OCS assesses risk and communicates.</strong> You decide whether to allow or reject each transaction.
      </div>
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
            onClick={() => setActiveTab('registryPolicy')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'registryPolicy' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Registry & Policy
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'audit' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Audit & Export
          </button>
          <button
            onClick={activeTab === 'registryPolicy' ? fetchRegistry : clearTrafficLogs}
            className={activeTab === 'registryPolicy' ? 'bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95' : 'bg-slate-600 hover:bg-slate-500 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95'}
            title={activeTab === 'registryPolicy' ? 'Refresh registry' : 'Clear traffic logs (DB + UI)'}
          >
            {activeTab === 'registryPolicy' ? '🔄 Refresh' : 'Clear Results'}
          </button>
        </div>
      </div>

      {mvpAutoSeed.phase === 'ok' && mvpAutoSeed.detail && (
        <div className="mb-4 p-3 rounded-lg border border-emerald-700/50 bg-emerald-900/20 text-emerald-100 text-sm flex justify-between items-start gap-4">
          <span>✓ {mvpAutoSeed.detail}</span>
          <button
            type="button"
            className="text-emerald-300/90 hover:text-white text-xs font-bold shrink-0"
            onClick={() =>
              setMvpAutoSeed({
                phase: 'idle',
                detail: MVP_DEMO_REGISTRY_HINT,
              })
            }
          >
            Dismiss
          </button>
        </div>
      )}

      {activeTab === 'registryPolicy' && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl text-slate-300 underline underline-offset-8 mb-4">Registry & Policy Configurator</h2>
          <div>
            <h3 className="text-lg font-bold text-slate-300 mb-3">Policy Configurator</h3>
            <p className="text-slate-400 text-sm mb-3">Select a wallet. Policy applies when that wallet sends transactions.</p>
            {(() => {
              const walletOptions = registry.length >= 1 ? registry : myWallets;
              const displayLabel = (e: { hexAddress: string; notes?: string }) =>
                (e.notes?.trim() || MVP1_WALLET_INFO[e.hexAddress]?.label) ?? e.hexAddress;
              return (
                <div className="flex flex-wrap items-center gap-4 mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-600">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Wallet</label>
                    <select
                      value={userAddress}
                      onChange={(e) => setUserAddress(e.target.value)}
                      className="bg-slate-700 text-slate-200 px-3 py-2 rounded border border-slate-600 font-mono text-sm min-w-[14rem]"
                    >
                      {walletOptions.map((e) => (
                        <option key={e.hexAddress} value={e.hexAddress}>
                          {displayLabel(e)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-500 max-w-md self-end pb-1">
                    Trust profile, cap, list rules, and sliders for this wallet are configured below in <strong>Policy Settings</strong> (defense posture + deploy).
                  </p>
                </div>
              );
            })()}
            <SovereignConfigurator
              targetAddress={userAddress}
              registry={registry}
              registryRefreshVersion={registryConfiguratorSync}
              incidentSwitchEnabled={incidentSwitchEnabled}
              incidentSwitchLoading={incidentSwitchLoading}
              onToggleIncidentSwitch={toggleIncidentSwitch}
            />
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <AuditTab
          apiBase={API_BASE}
          diagnosticsBase={DIAGNOSTICS_BASE}
          mvpAutoSeed={mvpAutoSeed}
          autoConfigurePolicyForMvp={autoConfigurePolicyForMvp}
          trafficResults={trafficResults}
          setTrafficResults={setTrafficResults}
          trafficResultsMvp2={trafficResultsMvp2}
          setTrafficResultsMvp2={setTrafficResultsMvp2}
          generating={generating}
          generatingMvp2={generatingMvp2}
          generateTraffic={generateTraffic}
          generateTrafficMvp2={generateTrafficMvp2}
          fetchLogs={fetchLogs}
          getApiHeaders={getApiHeaders}
          getRiskLabel={(s) => getRiskLabel(s as Parameters<typeof getRiskLabel>[0])}
          getAuthorizationLabel={(s) => getAuthorizationLabel(s as Parameters<typeof getAuthorizationLabel>[0])}
        />
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
          Live transaction logs. Feature column maps each row to the scenario (MVP-1: C7, B2, E6, E7, E4; MVP-2: H1–H3, J1, K1, I2, B1). Run MVP tests in Audit & Export.
        </p>
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
                      <div className={`text-[10px] italic mt-1 font-bold ${isManualOverride ? 'text-blue-400' : (log.riskScore >= 51 ? 'text-yellow-500' : 'text-slate-400')}`}>
                        {isManualOverride ? '🔹 ' : (log.riskScore >= 51 ? '⚠️ ' : '✅ ')} {log.reason || log.verdict}
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
    </main>;
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

