"use client"
import { useState, useEffect } from 'react';
import { getApiHeaders } from '@/lib/api';
import type { RiskLog, ForensicDetails } from '@/types/risk';
import SovereignConfigurator from '@/components/SovereignConfigurator';
import AuditTab from '@/components/AuditTab';
import GovernanceTab from '@/components/GovernanceTab';
import { MVP1_SCENARIOS, statusToOutcome, matchLogToScenario, type Mvp1Scenario, type ScenarioOutcome } from '@/types/mvp1Scenarios';
import { MVP2_SCENARIOS, statusToOutcomeMvp2, matchLogToScenarioMvp2, type Mvp2Scenario } from '@/types/mvp2Scenarios';
import { runPi06ComplianceChecks } from '@/lib/pi06ComplianceChecks';

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

/** User / UI resolution for action-queue items */
type HoldDecision = 'allowed' | 'blocked' | 'blocked_timeout';

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

/** Read holdTimeoutMinutes from the active vault's policyOverrides and return it as ms. Defaults to 5 min. */
function getHoldTimeoutMs(registry: { hexAddress?: string; policyOverrides?: unknown; PolicyOverrides?: unknown }[], userAddress: string): number {
  const entry = registry.find(r => r.hexAddress?.toLowerCase() === userAddress?.toLowerCase());
  if (!entry) return 5 * 60 * 1000;
  const raw = entry.policyOverrides ?? entry.PolicyOverrides;
  try {
    const po = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown> | undefined;
    const mins = po?.holdTimeoutMinutes;
    return typeof mins === 'number' && mins > 0 ? mins * 60 * 1000 : 5 * 60 * 1000;
  } catch { return 5 * 60 * 1000; }
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
  policyOverrides?: string | Record<string, unknown>;
  PolicyOverrides?: string | Record<string, unknown>;
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
  const [activeTab, setActiveTab] = useState<'traffic' | 'registryPolicy' | 'audit' | 'governance'>('traffic');
  /** User decisions on action-required transactions. blocked_timeout = hold expired without user input. Keyed by log.id. */
  const [decisions, setDecisions] = useState<Record<number, HoldDecision>>({});
  /** After undoing a timeout block: hold stays open with no auto-expire until user chooses Allow/Block. */
  const [holdIndefinite, setHoldIndefinite] = useState<Record<number, boolean>>({});
  /** Which action-queue row has its inline details expanded. */
  const [expandedAction, setExpandedAction] = useState<number | null>(null);
  /** Log id briefly highlighted in the traffic table after "In log" click. */
  const [highlightedLogId, setHighlightedLogId] = useState<number | null>(null);
  /** Pending action that requires a confirmation modal before committing. */
  const [pendingAction, setPendingAction] = useState<{ logId: number; isMfa: boolean } | null>(null);
  /** Ticks every second — drives countdown timers in the action queue. */
  const [nowMs, setNowMs] = useState(() => Date.now());
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
  const [complianceRefreshToken, setComplianceRefreshToken] = useState(0);
  const [mvp3Running, setMvp3Running] = useState(false);
  const [mvp3Summary, setMvp3Summary] = useState<{
    finishedAt: string;
    pi06Pass: number;
    pi06Total: number;
    mvp1Pass: number;
    mvp1Total: number;
    mvp2Pass: number;
    mvp2Total: number;
    allGreen: boolean;
  } | null>(null);
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

  const generateTraffic = async (): Promise<{ scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] | null> => {
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
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('Traffic generation failed:', err);
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const generateTrafficMvp2 = async (): Promise<{ scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] | null> => {
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
      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`MVP-2 traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('MVP-2 traffic generation failed:', err);
      return null;
    } finally {
      setGeneratingMvp2(false);
    }
  };

  /** MVP-3 (Prevention production): seed demo DB + PI.06 diagnostics + MVP-1 + MVP-2 in one run with aggregate pass/fail (PI.07 posture is still manual under Registry). */
  const runMvp3FullSuite = async () => {
    setMvp3Running(true);
    setMvp3Summary(null);
    setConnectionError(null);
    try {
      const seedRes = await fetch(`${DIAGNOSTICS_BASE}/seed`, { method: 'POST', headers: await getApiHeaders() });
      if (!seedRes.ok) throw new Error(`Seed failed: HTTP ${seedRes.status}`);
      await fetchRegistry();
      setRegistryConfiguratorSync((n) => n + 1);

      const pi06 = await runPi06ComplianceChecks(DIAGNOSTICS_BASE, getApiHeaders, 'mvp3Suite');
      if (pi06.error) throw new Error(pi06.error);
      setComplianceRefreshToken((t) => t + 1);

      const mvp1 = await generateTraffic();
      if (!mvp1) throw new Error('MVP-1 did not complete');

      const mvp2 = await generateTrafficMvp2();
      if (!mvp2) throw new Error('MVP-2 did not complete');

      const pi06Pass = pi06.rows.filter((r) => r.pass).length;
      const mvp1Pass = mvp1.filter((r) => r.pass).length;
      const mvp2Pass = mvp2.filter((r) => r.pass).length;

      setMvp3Summary({
        finishedAt: new Date().toLocaleString(),
        pi06Pass,
        pi06Total: pi06.rows.length,
        mvp1Pass,
        mvp1Total: mvp1.length,
        mvp2Pass,
        mvp2Total: mvp2.length,
        allGreen:
          pi06Pass === pi06.rows.length
          && mvp1Pass === mvp1.length
          && mvp2Pass === mvp2.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'MVP-3 suite failed';
      setConnectionError(msg);
    } finally {
      setMvp3Running(false);
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

  // Tick every second for countdown timers
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-expire action items whose hold timer has run out — mark as blocked_timeout (not user block)
  useEffect(() => {
    if (!logs.length) return;
    const holdTimeoutMs = getHoldTimeoutMs(registry, userAddress);
    const expired = logs.filter(l => {
      const s = getStatus(l);
      if (s !== 'MFA_REQUIRED' && s !== 'BLOCKED') return false;
      if (decisions[l.id]) return false;
      if (holdIndefinite[l.id]) return false;
      return Date.now() - new Date(l.timestamp).getTime() > holdTimeoutMs;
    }).map(l => l.id);
    if (expired.length === 0) return;
    setDecisions(prev => {
      const next = { ...prev };
      expired.forEach(id => { if (!next[id]) next[id] = 'blocked_timeout'; });
      return next;
    });
  }, [nowMs, logs, decisions, holdIndefinite, registry, userAddress]);

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
          {(() => {
            const actionCount = logs.filter(l => {
              const s = getStatus(l);
              return (s === 'MFA_REQUIRED' || s === 'BLOCKED') && !decisions[l.id];
            }).length;
            const badgeBg = actionCount === 0 ? 'bg-emerald-600' : actionCount < 5 ? 'bg-amber-500' : 'bg-red-600';
            return (
              <button
                onClick={() => setActiveTab('traffic')}
                className={`px-4 py-2 rounded font-bold flex items-center gap-2 ${activeTab === 'traffic' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
              >
                Transactions
                <span className={`text-xs font-black px-1.5 py-0.5 rounded-full ${badgeBg} text-white`}>
                  {actionCount}
                </span>
              </button>
            );
          })()}
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
            onClick={() => setActiveTab('governance')}
            className={`px-4 py-2 rounded font-bold ${activeTab === 'governance' ? 'bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}
          >
            Governance
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

      {activeTab === 'governance' && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-1 text-slate-300 underline underline-offset-8">Sovereign Governance</h2>
          <p className="text-xs text-slate-500 mb-6">Whitelist and blacklist management. Commits are signed server-side — admin key never leaves this server.</p>
          <GovernanceTab />
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
          generatingMvp3={mvp3Running}
          mvp3Summary={mvp3Summary}
          runMvp3FullSuite={runMvp3FullSuite}
          complianceRefreshToken={complianceRefreshToken}
          mvp1ScenarioCount={MVP1_SCENARIOS.length}
          mvp2ScenarioCount={MVP2_SCENARIOS.length}
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

      {activeTab === 'traffic' && <div className="space-y-4">

        {/* ── ACTION REQUIRED QUEUE ── */}
        {(() => {
          const holdTimeoutMs = getHoldTimeoutMs(registry, userAddress);
          const actionLogs = logs.filter(l => {
            const s = getStatus(l);
            return (s === 'MFA_REQUIRED' || s === 'BLOCKED') && !decisions[l.id];
          });
          if (actionLogs.length === 0) return null;
          return (
            <div className="border border-slate-600 rounded-lg overflow-hidden shadow-2xl">
              <div className="px-4 py-3 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-200 text-sm">Action Required</span>
                  <span className="text-xs font-bold bg-red-700 text-white px-2 py-0.5 rounded-full">{actionLogs.length}</span>
                </div>
                <p className="text-xs text-slate-500">OCS assessed the risk — you decide. Click a row to see full details.</p>
              </div>
              <div className="divide-y divide-slate-700/60">
                {actionLogs.map(log => {
                  const status = getStatus(log);
                  const isMfa = status === 'MFA_REQUIRED';
                  const details = parseForensicDetails(log.detailsJson ?? '');
                  const matrix = details?.decisionMatrix;
                  const amount = matrix?.currentAmount;
                  const reason = details?.trustRangeReason || log.reason || '';
                  const isExpanded = expandedAction === log.id;
                  const isIndefiniteHold = Boolean(holdIndefinite[log.id]);
                  const elapsedMs = nowMs - new Date(log.timestamp).getTime();
                  const remainingMs = isIndefiniteHold ? Number.POSITIVE_INFINITY : Math.max(0, holdTimeoutMs - elapsedMs);
                  const remainingSec = Math.floor((isIndefiniteHold ? 0 : remainingMs) / 1000);
                  const countdownMins = Math.floor(remainingSec / 60);
                  const countdownSecs = remainingSec % 60;
                  const countdownStr = isIndefiniteHold ? '∞' : `${countdownMins}:${String(countdownSecs).padStart(2, '0')}`;
                  const isExpiring = !isIndefiniteHold && remainingMs < 60_000; // last minute

                  return (
                    <div key={log.id} className={isMfa ? 'bg-amber-950/20' : 'bg-red-950/20'}>
                      {/* Row header — clickable to expand */}
                      <button
                        type="button"
                        onClick={() => setExpandedAction(isExpanded ? null : log.id)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-700/20 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-4">
                          {/* Left: addresses + reason */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${isMfa ? 'bg-amber-900/50 text-amber-300' : 'bg-red-900/50 text-red-300'}`}>
                                {isMfa ? 'Requires Authorization' : 'Not Authorized'}
                              </span>
                              <span className="text-xs text-slate-500 font-mono">{formatTime(log.timestamp)}</span>
                              {amount != null && (
                                <span className="text-xs text-slate-400 font-mono">${Number(amount).toFixed(2)}</span>
                              )}
                              {/* Countdown timer — ∞ after undoing a timeout; no auto-expire until user acts */}
                              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                                isIndefiniteHold ? 'bg-sky-900/40 text-sky-200' :
                                isExpiring ? 'bg-red-900/60 text-red-300 animate-pulse' :
                                'bg-slate-700 text-slate-400'
                              }`}
                                title={isIndefiniteHold
                                  ? 'Hold stays open until you choose Allow or Block — auto-expire is paused after a timeout undo.'
                                  : 'Time remaining before this hold auto-expires as Block (timeout).'}>
                                ⏱ {countdownStr}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-slate-400 truncate">
                              <span className="text-slate-500 truncate">{log.sourceAddress}</span>
                              <span className="text-slate-600 shrink-0">→</span>
                              <span className="text-slate-300 truncate">{log.destinationAddress}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500 truncate">{reason}</p>
                          </div>
                          {/* Right: risk score + cross-map + Allow/Block */}
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-lg font-black text-slate-200">{log.riskScore}<span className="text-xs text-slate-500">/100</span></p>
                              <p className="text-[10px] text-slate-500">risk score</p>
                            </div>
                            {/* "In log" — scrolls to the matching row in the full traffic table */}
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                const el = document.getElementById(`traffic-row-${log.id}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  setHighlightedLogId(log.id);
                                  setTimeout(() => setHighlightedLogId(null), 2000);
                                }
                              }}
                              className="text-[10px] text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 px-2 py-1 rounded transition-colors"
                              title="Scroll to this row in the traffic log below"
                            >
                              ↓ In log
                            </button>
                            <div className="flex rounded-lg overflow-hidden border border-slate-600" onClick={e => e.stopPropagation()}>
                              {/* Allow — opens confirmation modal (MFA phone code or escalation warning) */}
                              <button
                                type="button"
                                onClick={() => setPendingAction({ logId: log.id, isMfa })}
                                className={`px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                                  isMfa
                                    ? 'bg-amber-900/50 hover:bg-amber-900/70 text-amber-200'
                                    : 'bg-red-900/50 hover:bg-red-900/70 text-red-200'
                                }`}
                              >
                                Allow
                              </button>
                              {/* Block — MFA: same amber as Allow (50/50 choice); BLOCKED: green confirms the right call */}
                              <button
                                type="button"
                                onClick={() => {
                                  setHoldIndefinite(prev => { const n = { ...prev }; delete n[log.id]; return n; });
                                  setDecisions(prev => ({ ...prev, [log.id]: 'blocked' }));
                                }}
                                className={`px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                                  isMfa
                                    ? 'bg-amber-900/50 hover:bg-amber-900/70 text-amber-200'
                                    : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200'
                                }`}
                              >
                                Block
                              </button>
                            </div>
                            <span className="text-slate-600 text-sm">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                      </button>

                      {/* Inline expanded details */}
                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3">
                          {/* Risk advice */}
                          <div className="p-3 rounded bg-slate-900/60 border border-slate-700">
                            <p className="text-xs font-bold text-amber-400 mb-1">Risk Advice</p>
                            <p className="text-sm text-slate-200">{details?.trustRangeReason || log.reason || '—'}</p>
                            {details?.trustProfile && (
                              <p className="text-xs text-slate-500 mt-1">Profile active: {details.trustProfile}</p>
                            )}
                          </div>

                          {/* Decision matrix */}
                          {matrix && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sovereign Decision Matrix</p>
                              {[
                                { label: 'Amount vs. Cap', value: `$${Number(matrix.currentAmount ?? 0).toFixed(2)} vs. $${Number(matrix.sovereignCap ?? 0).toFixed(2)}`, ok: Boolean(matrix.amountWithinCap) },
                                { label: 'Risk vs. Allow Threshold', value: `${matrix.calculatedRisk ?? 0} vs. ${matrix.maxRiskFloor ?? 0}`, ok: Boolean(matrix.riskWithinFloor) },
                                { label: 'Risk vs. Block Threshold', value: `${matrix.calculatedRisk ?? 0} vs. ${matrix.blockThreshold ?? 100}`, ok: (matrix.calculatedRisk ?? 0) < (matrix.blockThreshold ?? 100) },
                                { label: 'Confidence vs. Ceiling', value: `${matrix.calculatedConfidence ?? 0}% vs. ${matrix.minConfidenceCeiling ?? 0}%`, ok: Boolean(matrix.confidenceAboveCeiling) },
                              ].map(row => (
                                <div key={row.label} className="flex items-center justify-between px-3 py-1.5 bg-slate-900/40 rounded text-xs">
                                  <span className="text-slate-400">{row.label}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-slate-400">{row.value}</span>
                                    <span className={`w-2.5 h-2.5 rounded-full ${row.ok ? 'bg-green-500' : 'bg-red-500'}`} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Brain analysis results */}
                          {Array.isArray(details?.riskResults) && details.riskResults.length > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Brain Analysis</p>
                              {(details.riskResults as Array<Record<string, unknown>>).map((r, idx) => {
                                const score = Number(r.riskScore ?? r.RiskScore ?? 0);
                                const scoreColor = score >= 80 ? 'text-red-400' : score >= 50 ? 'text-amber-400' : 'text-green-400';
                                return (
                                  <div key={idx} className="flex items-center justify-between px-3 py-1.5 bg-slate-900/40 rounded text-xs">
                                    <div className="min-w-0">
                                      <span className={`font-medium ${scoreColor}`}>{String(r.testName ?? r.TestName ?? '—')}</span>
                                      <span className={`ml-2 ${score >= 50 ? scoreColor : 'text-slate-500'} opacity-75`}>{String(r.verdict ?? r.Verdict ?? '')}</span>
                                    </div>
                                    <span className={`font-mono font-bold shrink-0 ml-2 ${scoreColor}`}>
                                      {score}/100
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── ALL TRAFFIC TABLE ── */}
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
          <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Live Traffic Monitor</h2>
          <p className="text-sm text-slate-500 mb-4">
            All transaction logs. Feature column maps each row to the scenario (MVP-1: C7, B2, E6, E7, E4; MVP-2: H1–H3, J1, K1, I2, B1). Run MVP tests in Audit &amp; Export.
          </p>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-600 text-slate-400">
                <th className="p-3 text-sm uppercase tracking-wider">Timestamp</th>
                <th className="p-3 text-sm uppercase tracking-wider">Feature</th>
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
                  const isManualOverride = log.classification === 'Whitelist';
                  const details = parseForensicDetails(log.detailsJson ?? '');
                  const amount = details?.decisionMatrix?.currentAmount;
                  const reason = details?.trustRangeReason || log.reason || '';
                  const scenarioMvp2 = matchLogToScenarioMvp2(log.sourceAddress, log.destinationAddress, amount, reason);
                  const scenarioMvp1 = matchLogToScenario(log.sourceAddress, log.destinationAddress, amount);
                  const scenario = scenarioMvp2 ?? scenarioMvp1;
                  const decision = decisions[log.id];
                  const isHighlighted = highlightedLogId === log.id;

                  const rowBg = isHighlighted ? 'bg-sky-700/40 ring-1 ring-sky-500' :
                    decision === 'allowed' ? 'bg-emerald-900/10' :
                    decision === 'blocked_timeout' ? 'bg-amber-900/10' :
                    decision === 'blocked' ? 'bg-slate-900/30' :
                    status === 'BLOCKED' ? 'bg-red-900/20' :
                    status === 'MFA_REQUIRED' ? 'bg-amber-900/20' :
                    isManualOverride ? 'bg-blue-900/10' : '';

                  return (
                    <tr id={`traffic-row-${log.id}`} key={i} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${rowBg}`}>
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
                        {decision ? (
                          <div className="flex items-center gap-2">
                            <span className={`font-black px-2 py-0.5 rounded text-[11px] ${
                              decision === 'allowed' ? 'bg-emerald-900/30 text-emerald-400' :
                              decision === 'blocked_timeout' ? 'bg-amber-900/35 text-amber-300' :
                              'bg-slate-700 text-slate-400'
                            }`}>
                              {decision === 'allowed' ? 'Allowed by user' :
                                decision === 'blocked_timeout' ? 'Block (timeout)' : 'Block (User)'}
                            </span>
                            {/* Only undoable for MFA/BLOCKED — APPROVED needs no action queue */}
                            {(status === 'MFA_REQUIRED' || status === 'BLOCKED') && (
                              <button
                                type="button"
                                onClick={() => {
                                  const kind = decisions[log.id];
                                  setDecisions(prev => { const n = { ...prev }; delete n[log.id]; return n; });
                                  if (kind === 'blocked_timeout') {
                                    setHoldIndefinite(prev => ({ ...prev, [log.id]: true }));
                                  }
                                }}
                                className="text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
                                title={decision === 'blocked_timeout'
                                  ? 'Restore to Action Required — hold stays open with no auto-expire until you decide'
                                  : 'Return to Action Required queue (timer resumes from first seen)'}
                              >
                                undo
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className={`font-black px-2 py-0.5 rounded text-[11px] ${
                            status === 'BLOCKED' ? 'bg-red-900/30 text-red-400' :
                            status === 'MFA_REQUIRED' ? 'bg-amber-900/30 text-amber-400' :
                            'bg-green-900/30 text-green-400'
                          }`} title="OCS assesses risk. You decide whether to allow the transaction.">
                            {getAuthorizationLabel(status)}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setForensicLog(log)}
                          className="text-[10px] bg-slate-600 hover:bg-slate-500 px-3 py-1 rounded font-bold uppercase tracking-tighter transition-all"
                        >
                          View Forensics
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>}

      {forensicLog && (
        <ForensicModal log={forensicLog} onClose={() => setForensicLog(null)} />
      )}

      {/* ── MFA CONFIRMATION MODAL ── */}
      {pendingAction?.isMfa && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setPendingAction(null)}>
          <div className="bg-slate-800 border border-amber-700/60 rounded-lg shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 border-b border-slate-700 flex items-center gap-3">
              <span className="text-2xl">📱</span>
              <div>
                <h3 className="text-lg font-bold text-amber-300">MFA Verification Required</h3>
                <p className="text-xs text-slate-400 mt-0.5">Transaction requires your explicit approval</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-300">
                OCS has flagged this transaction as <strong className="text-amber-300">Requires Authorization</strong>. Before it can proceed, your identity must be confirmed via multi-factor authentication.
              </p>
              <div className="p-4 bg-amber-900/20 border border-amber-700/40 rounded-lg space-y-2">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">Verification flow (coming in Pilot)</p>
                <ol className="text-sm text-slate-300 space-y-1.5 list-decimal list-inside">
                  <li>A 6-digit code will be sent to your registered phone number.</li>
                  <li>Enter the code within 5 minutes to confirm.</li>
                  <li>Transaction proceeds only after successful verification.</li>
                </ol>
              </div>
              <p className="text-xs text-slate-500 italic">Phone-based MFA enforcement is not yet wired in this build. This is a placeholder for the Pilot phase (HC3).</p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled
                title="Phone MFA enforcement coming in Pilot (HC3)"
                className="px-4 py-2 text-sm bg-amber-900/40 text-amber-500/60 rounded font-bold cursor-not-allowed flex items-center gap-2"
              >
                Send Code
                <span className="text-[10px] font-normal text-amber-600/70 border border-amber-700/40 rounded px-1">Pilot</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ESCALATION WARNING MODAL ── */}
      {pendingAction && !pendingAction.isMfa && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setPendingAction(null)}>
          <div className="bg-slate-800 border border-red-700/60 rounded-lg shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 border-b border-slate-700 flex items-center gap-3">
              <span className="text-2xl">⛔</span>
              <div>
                <h3 className="text-lg font-bold text-red-300">Override Warning</h3>
                <p className="text-xs text-slate-400 mt-0.5">This transaction was assessed as Not Authorized</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-300">
                You are attempting to <strong className="text-red-300">override a hard block</strong>. OCS assessed this transaction as high-risk. Proceeding requires supervisor sign-off and creates a formal escalation record.
              </p>
              <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-lg space-y-2">
                <p className="text-xs font-bold text-red-400 uppercase tracking-wider">Escalation requirements (coming in Pilot)</p>
                <ul className="text-sm text-slate-300 space-y-1.5 list-disc list-inside">
                  <li>Supervisor or administrator approval required.</li>
                  <li>Escalation ticket automatically created and logged.</li>
                  <li>Full audit trail entry with override justification.</li>
                  <li>Risk accepted by authorizing party on record.</li>
                </ul>
              </div>
              <p className="text-xs text-slate-500 italic">Escalation workflow is not yet wired in this build. This is a placeholder for the Pilot phase (HC4).</p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded font-bold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled
                title="Escalation workflow coming in Pilot (HC4)"
                className="px-4 py-2 text-sm bg-red-900/40 text-red-500/60 rounded font-bold cursor-not-allowed flex items-center gap-2"
              >
                Request Escalation
                <span className="text-[10px] font-normal text-red-600/70 border border-red-700/40 rounded px-1">Pilot</span>
              </button>
            </div>
          </div>
        </div>
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

