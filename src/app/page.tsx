"use client"
import { useState, useEffect } from 'react';
import type { RiskLog, ForensicDetails } from '@/types/risk';
import { TRUST_PROFILES } from '@/types/risk';
import SovereignConfigurator from '@/components/SovereignConfigurator';

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

function getStatus(log: RiskLog): 'BLOCKED' | 'MFA_REQUIRED' | 'APPROVED' {
  const v = (log.verdict || '').toUpperCase();
  if (v.includes('BLOCKED')) return 'BLOCKED';
  if (v.includes('MFA_REQUIRED')) return 'MFA_REQUIRED';
  if (log.riskScore > 50) return 'BLOCKED';
  return 'APPROVED';
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

const API_BASE = 'http://localhost:5193/api/PGTAIL';

export default function Home() {
  const [logs, setLogs] = useState<RiskLog[]>([]);
  const [forensicLog, setForensicLog] = useState<RiskLog | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'traffic' | 'registry' | 'policy' | 'audit'>('traffic');
  const [configuratorAddress, setConfiguratorAddress] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setConnectionError(null);
    try {
      const res = await fetch(`${API_BASE}/logs`);
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Cannot connect to Engine (localhost:5193). Is PGTAIL.Engine running? ${msg}`);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: targetAddress, userAddress })
    });
    if (response.ok) await fetchLogs();
  };

  const fetchRegistry = async () => {
    try {
      const res = await fetch(`${API_BASE}/registry`);
      const data = await res.json();
      setRegistry(data);
    } catch (err) {
      console.error("Registry fetch error:", err);
    }
  };

  const handleUpdateProfile = async (address: string, trustProfile: number) => {
    const response = await fetch(`${API_BASE}/registry/${encodeURIComponent(address)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trustProfile })
    });
    if (response.ok) await fetchRegistry();
  };

  const [generating, setGenerating] = useState(false);
  const [incidentSwitchEnabled, setIncidentSwitchEnabled] = useState(false);
  const [incidentSwitchLoading, setIncidentSwitchLoading] = useState(false);
  const generateTraffic = async () => {
    setGenerating(true);
    setConnectionError(null);
    const baseUrl = `${API_BASE}/check-risk`;
    // Scenarios exercise each Policy Configurator setting and Engine feature. Update when adding new PI features.
    const scenarios: { label: string; body: Record<string, unknown> }[] = [
      { label: 'Sovereign Cap OK', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '5' } },
      { label: 'Sovereign Cap breach (MFA)', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '5000' } },
      { label: 'B1 HW wallet (above threshold, no HW)', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '5000', IsHardwareWallet: false } },
      { label: 'Blacklist block', body: { FromAddress: 'test_peeling_chain', ToAddress: 'rff5UDgUy9NvcpDNWUqw4jwFMoXWu855Nt', Amount: '1' } },
      { label: 'Registry miss', body: { FromAddress: '0xUnknown_New_User', ToAddress: 'test_mature_wallet', Amount: '10' } },
      { label: 'I2 Slippage exceed (block)', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '100', TransactionType: 'dex_swap', MaxSlippagePercent: 1, SlippagePercent: 2.5 } },
      { label: 'J1 Bridge chain mismatch (block)', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '100', TransactionType: 'bridge', BridgeChainId: 1, ExpectedChainId: 137 } },
      { label: 'J2 Bridge MFA', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '500', TransactionType: 'bridge' } },
      { label: 'I1 DEX swap (RecommendPrivateMempool)', body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '50', TransactionType: 'dex_swap' } },
    ];
    try {
      const results: string[] = [];
      for (const { label, body } of scenarios) {
        const r = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 200) results.push(`${label}: OK`);
        else if (r.status === 202) results.push(`${label}: MFA — ${data.RiskAdvice || 'required'}`);
        else if (r.status === 403) results.push(`${label}: BLOCKED — ${data.Description || data.RiskAdvice || 'blocked'}`);
        else results.push(`${label}: ${r.status}`);
      }
      await fetchLogs();
      setConnectionError(null);
      console.info('Generate Traffic:', results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('Traffic generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const fetchIncidentSwitch = async () => {
    try {
      const res = await fetch(`${API_BASE}/incident-switch`);
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
        headers: { 'Content-Type': 'application/json' },
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

  // Auto-refresh traffic every 5 seconds when on Live Traffic tab
  useEffect(() => {
    if (activeTab !== 'traffic') return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  return (
    <main className="p-8 bg-slate-900 min-h-screen text-white font-sans">
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
        <h1 className="text-3xl font-bold text-red-500 tracking-tight">OCS Station Master</h1>
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
            onClick={toggleIncidentSwitch}
            disabled={incidentSwitchLoading}
            className={`px-4 py-2 rounded font-bold transition-all ${incidentSwitchEnabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-600 hover:bg-slate-500'}`}
            title="E5: Pause new recipients — only whitelisted allowed when enabled"
          >
            {incidentSwitchLoading ? '…' : (incidentSwitchEnabled ? '🛡️ Incident ON' : 'Incident Switch')}
          </button>
          <button
            onClick={activeTab === 'traffic' ? fetchLogs : activeTab === 'registry' ? fetchRegistry : activeTab === 'audit' ? () => {} : () => {}}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95"
          >
            🔄 Refresh
          </button>
          <button
            onClick={generateTraffic}
            disabled={generating}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-bold transition-all shadow-lg active:scale-95"
          >
            {generating ? '⏳ Generating…' : '▶ Generate Traffic'}
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
                        onClick={() => { setConfiguratorAddress(entry.hexAddress); setActiveTab('policy'); }}
                        className="text-[10px] bg-slate-600 hover:bg-slate-500 px-3 py-1 rounded font-bold"
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
          <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Policy Configurator</h2>
          <p className="text-slate-400 text-sm mb-2">Select a defense posture and deploy to sync with Node .20.</p>
          <p className="text-slate-500 text-xs mb-6">
            Operator guide: <a href="https://github.com/onchainsentinel/ocs-docs/blob/main/01_architecture/OCS_Policy_Configuration_Guide.md" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">OCS_Policy_Configuration_Guide.md</a> — documents each setting.
          </p>
          <SovereignConfigurator
            targetAddress={configuratorAddress}
            onAddressChange={setConfiguratorAddress}
          />
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
                  const res = await fetch(`${API_BASE}/audit/export?format=csv`);
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
                  const res = await fetch(`${API_BASE}/audit/export/signed`);
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

      {connectionError && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          <strong>Connection Error:</strong> {connectionError}
          <p className="mt-2 text-xs text-slate-400">Run <code className="bg-slate-800 px-1 rounded">dotnet run</code> in the PGTAIL.Engine folder. Ensure PostgreSQL at 192.168.69.20 is reachable.</p>
        </div>
      )}

      {activeTab === 'traffic' && <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
        <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Live Traffic Monitor</h2>
        {logs.some((l) => getStatus(l) === 'MFA_REQUIRED') && (
          <div className="mb-4 p-4 bg-amber-900/30 border border-amber-600/50 rounded-lg flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-amber-400">MFA Required — Trust-Range Breach</p>
              <p className="text-sm text-amber-200/90">
                One or more transactions require manual approval. Click &quot;View Forensics&quot; to see the specific breach (cap, risk, or confidence).
              </p>
            </div>
          </div>
        )}
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th className="p-3 text-sm uppercase tracking-wider">Timestamp</th>
              <th className="p-3 text-sm uppercase tracking-wider">Target Address / Alert</th>
              <th className="p-3 text-sm uppercase tracking-wider">Risk Score</th>
              <th className="p-3 text-sm uppercase tracking-wider">Status</th>
              <th className="p-3 text-sm uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-slate-500 italic">No traffic detected. Standby...</td></tr>
            ) : (
              logs.map((log, i) => {
                const status = getStatus(log);
                const overridden = isAlreadyOverridden(log.destinationAddress, log.sourceAddress);
                const isManualOverride = log.classification === 'Whitelist';

                const rowBg = status === 'BLOCKED' ? 'bg-red-900/20' :
                  status === 'MFA_REQUIRED' ? 'bg-amber-900/20' :
                  isManualOverride ? 'bg-blue-900/10' : '';

                return (
                  <tr key={i} className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${rowBg}`}>
                    <td className="p-3 text-xs text-slate-500 font-mono">{formatTime(log.timestamp)}</td>
                    <td className="p-3">
                      <div className="font-mono text-xs text-slate-200">{log.destinationAddress}</div>
                      <div className={`text-[10px] italic mt-1 font-bold ${isManualOverride ? 'text-blue-400' : (log.riskScore > 50 ? 'text-yellow-500' : 'text-slate-400')}`}>
                        {isManualOverride ? '🔹 ' : (log.riskScore > 50 ? '⚠️ ' : '✅ ')} {log.reason || log.verdict}
                      </div>
                    </td>
                    <td className="p-3 font-bold text-slate-300">{log.riskScore}/100</td>
                    <td className="p-3">
                      <span className={`font-black px-2 py-0.5 rounded text-[11px] ${
                        status === 'BLOCKED' ? 'bg-red-900/30 text-red-400' :
                        status === 'MFA_REQUIRED' ? 'bg-amber-900/30 text-amber-400' :
                        'bg-green-900/30 text-green-400'
                      }`}>
                        {status}
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 200) {
        const data = await r.json();
        setResult(`OK: ${data.precheckVerdict ?? data.trustRangeVerdict ?? 'PASS'}`);
        onSuccess();
      } else if (r.status === 202) {
        const data = await r.json();
        setResult(`MFA: ${data.riskAdvice ?? 'MFA required'}`);
        onSuccess();
      } else if (r.status === 403) {
        const data = await r.json().catch(() => ({}));
        setResult(`BLOCKED: ${data.description ?? data.riskAdvice ?? 'Blocked'}`);
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
                <p className="text-sm font-bold text-amber-400 mb-1">Trust-Range Breach — MFA Required</p>
                <p className="text-slate-200 text-sm">{details?.trustRangeReason || details?.decisionMatrix?.breachReason || log.reason || 'N/A'}</p>
                <p className="text-xs text-amber-300/80 mt-2">User must manually approve or reject this transaction.</p>
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
