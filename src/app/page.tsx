"use client"
import { useState, useEffect } from 'react';
import type { RiskLog, ForensicDetails } from '@/types/risk';
import { TRUST_PROFILES } from '@/types/risk';

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
  const [activeTab, setActiveTab] = useState<'traffic' | 'registry'>('traffic');
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
  const generateTraffic = async () => {
    setGenerating(true);
    setConnectionError(null);
    const baseUrl = `${API_BASE}/check-risk`;
    const scenarios = [
      { body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '5' } },
      { body: { FromAddress: 'test_trusted_partner', ToAddress: 'test_mature_wallet', Amount: '5000' } },
      { body: { FromAddress: 'test_peeling_chain', ToAddress: 'rff5UDgUy9NvcpDNWUqw4jwFMoXWu855Nt', Amount: '1' } },
      { body: { FromAddress: '0xUnknown_New_User', ToAddress: 'test_mature_wallet', Amount: '10' } },
    ];
    try {
      for (const { body } of scenarios) {
        const r = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error(`check-risk returned ${r.status}`);
      }
      await fetchLogs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setConnectionError(`Traffic generation failed. Is PGTAIL.Engine running? ${msg}`);
      console.error('Traffic generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);
  useEffect(() => { if (activeTab === 'registry') fetchRegistry(); }, [activeTab]);

  // Auto-refresh traffic every 5 seconds when on Live Traffic tab
  useEffect(() => {
    if (activeTab !== 'traffic') return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [activeTab]);

  return (
    <main className="p-8 bg-slate-900 min-h-screen text-white font-sans">
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
            onClick={activeTab === 'traffic' ? fetchLogs : fetchRegistry}
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

      {connectionError && (
        <div className="mb-4 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          <strong>Connection Error:</strong> {connectionError}
          <p className="mt-2 text-xs text-slate-400">Run <code className="bg-slate-800 px-1 rounded">dotnet run</code> in the PGTAIL.Engine folder. Ensure PostgreSQL at 192.168.69.20 is reachable.</p>
        </div>
      )}

      {activeTab === 'traffic' && <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl">
        <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Live Traffic Monitor</h2>
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
                  label="Risk Check (Risk vs. Floor)"
                  value={`${matrix.calculatedRisk ?? 0} vs. ${matrix.maxRiskFloor ?? 0}`}
                  ok={Boolean(matrix.riskWithinFloor)}
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
