"use client";
import { useState, useEffect, useCallback } from 'react';
import { runPi06ComplianceChecks, type Pi06CheckRow } from '@/lib/pi06ComplianceChecks';

export type { Pi06CheckRow } from '@/lib/pi06ComplianceChecks';

function arr<T>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

function pickTemplates(data: Record<string, unknown> | null): { id?: string; subject?: string }[] | null {
  if (!data) return null;
  return arr(data.templates) ?? arr(data.Templates);
}

function pickPlaybooks(data: Record<string, unknown> | null): { id?: string; name?: string; raci?: string }[] | null {
  if (!data) return null;
  return arr(data.playbooks) ?? arr(data.Playbooks);
}

/** PI.06 Sprint 4: F4, E2, M2, H5, G4 — Compliance & Horizon diagnostics (embedded under Audit) */
export default function ComplianceTab({
  diagnosticsBase,
  getApiHeaders,
  embedded,
  refreshToken = 0,
  externalBusy = false,
}: {
  diagnosticsBase: string;
  getApiHeaders: () => Promise<Record<string, string>>;
  embedded?: boolean;
  /** Increment from parent (e.g. after MVP-3) to re-fetch and stay in sync */
  refreshToken?: number;
  /** When true (e.g. MVP-3 suite running), disable refresh */
  externalBusy?: boolean;
}) {
  const [f4, setF4] = useState<Record<string, unknown> | null>(null);
  const [e2, setE2] = useState<Record<string, unknown> | null>(null);
  const [h5, setH5] = useState<Record<string, unknown> | null>(null);
  const [g4, setG4] = useState<Record<string, unknown> | null>(null);
  const [m2Status, setM2Status] = useState<string>('—');
  const [fetchDiag, setFetchDiag] = useState<{ path: string; status: number; hint?: string }[]>([]);
  const [checkRows, setCheckRows] = useState<Pi06CheckRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null>(null);

  const runComplianceChecks = useCallback(async () => {
    setRunning(true);
    setError(null);
    setFetchDiag([]);
    setLoading(true);
    try {
      const result = await runPi06ComplianceChecks(diagnosticsBase, getApiHeaders);
      if (result.error) {
        setError(result.error);
        setCheckRows(null);
        setF4(null);
        setE2(null);
        setH5(null);
        setG4(null);
        setM2Status('—');
      } else {
        setCheckRows(result.rows);
        setFetchDiag(result.fetchDiag);
        setF4(result.f4);
        setE2(result.e2);
        setH5(result.h5);
        setG4(result.g4);
        setM2Status(result.m2StatusLine);
        setError(null);
      }
      setLastCompletedAt(new Date().toLocaleString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
      setCheckRows(null);
    } finally {
      setLoading(false);
      setRunning(false);
    }
  }, [diagnosticsBase, getApiHeaders]);

  useEffect(() => {
    void runComplianceChecks();
  }, [runComplianceChecks, refreshToken]);

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

  if (loading && !checkRows) {
    return (
      <div>
        <p className="text-slate-400">Running PI.06 compliance checks…</p>
      </div>
    );
  }
  if (error && !checkRows) return <div><p className="text-red-400">Error: {error}</p></div>;

  const f4List = pickTemplates(f4);
  const g4List = pickPlaybooks(g4);
  const anyHttpFail = fetchDiag.some((d) => d.status < 200 || d.status >= 300);
  const travel =
    e2?.travelModeEnabled === true || e2?.TravelModeEnabled === true ? 'Enabled'
      : e2?.travelModeEnabled === false || e2?.TravelModeEnabled === false ? 'Off'
      : '—';
  const blockUnver =
    h5?.blockUnverifiedDelegation === true || h5?.BlockUnverifiedDelegation === true ? 'Yes'
      : h5?.blockUnverifiedDelegation === false || h5?.BlockUnverifiedDelegation === false ? 'No'
      : '—';

  const passedCount = checkRows?.filter((r) => r.pass).length ?? 0;
  const totalChecks = checkRows?.length ?? 0;
  const allPass = totalChecks > 0 && passedCount === totalChecks;

  return (
    <div className={embedded ? '' : 'bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl'}>
      {!embedded && <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Compliance & Horizon (PI.06 Sprint 4)</h2>}
      {!embedded && (
        <p className="text-slate-400 text-sm mb-4">
          Live data from <code className="text-slate-300 bg-slate-900 px-1 rounded">{diagnosticsBase}</code> — emergency comms, geofencing policy, recovery attestation, EIP-7702 rules, incident playbooks.
        </p>
      )}

      <div className="mb-6 p-4 rounded-lg border border-slate-600 bg-slate-900/60">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-200">PI.06 diagnostics (F4, E2, H5, G4, M2)</p>
            <p className="text-xs text-slate-500 mt-1">
              These five probes load automatically when this section is shown. <strong className="text-slate-400">Run MVP-3 full suite</strong> (in this MVP-3 card, above)
              runs them after seed; M2 is then tagged as the full-suite flow on the server. <strong className="text-slate-400">Refresh PI.06 only</strong> re-runs the same probes
              with a <em>standalone</em> M2 label (<q>demo attestation</q>) — use that when you are not running the whole MVP-3 pipeline.
            </p>
            {lastCompletedAt && (
              <p className="text-[11px] text-slate-500 mt-1">Last completed: {lastCompletedAt}</p>
            )}
            <p className="text-[11px] text-slate-600 mt-1">
              PI.06 ✓/✗ = <code className="text-slate-500">/api/diagnostics/*</code> only. <strong className="text-slate-500">MVP-1 / MVP-2 ✓/✗</strong> ={' '}
              <code className="text-slate-500">check-risk</code> scenarios (separate tables on this page).
            </p>
          </div>
          <button
            type="button"
            onClick={() => runComplianceChecks()}
            disabled={running || externalBusy}
            className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40 disabled:cursor-not-allowed underline shrink-0 mt-1"
          >
            {running ? 'Refreshing…' : 'Refresh PI.06 only'}
          </button>
        </div>
        {checkRows && checkRows.length > 0 && (
          <>
            <p className={`text-sm font-bold mb-2 ${allPass ? 'text-emerald-400' : 'text-amber-300'}`}>
              PI.06 Results — {passedCount}/{totalChecks} passed {allPass ? '(all green)' : '(fix failures or Engine allowlist)'}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-600 text-slate-500">
                  <th className="p-2">PI</th>
                  <th className="p-2">Surface</th>
                  <th className="p-2">Criterion</th>
                  <th className="p-2">Actual</th>
                  <th className="p-2">Match</th>
                </tr>
              </thead>
              <tbody>
                {checkRows.map((r) => (
                  <tr key={r.id} className={`border-b border-slate-700/50 ${r.pass ? '' : 'bg-red-900/20'}`}>
                    <td className="p-2 font-mono text-slate-300">{r.id}</td>
                    <td className="p-2 text-slate-300">{r.label}</td>
                    <td className="p-2 text-slate-400 text-xs">{r.criterion}</td>
                    <td className="p-2 text-slate-400 text-xs font-mono">{r.detail}</td>
                    <td className="p-2 font-bold">{r.pass ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {anyHttpFail && (
        <div className="mb-4 p-3 rounded-lg border border-amber-700/50 bg-amber-900/20 text-amber-200 text-xs space-y-1">
          <p className="font-bold">Some compliance endpoints did not return 200 — cards may show “—”.</p>
          <ul className="list-disc list-inside font-mono text-amber-100/90">
            {fetchDiag.map((d) => (
              <li key={d.path}>{d.path}: HTTP {d.status}{d.hint && d.status === 403 ? ` — ${d.hint}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      {!anyHttpFail && fetchDiag.length > 0 && (
        <p className="text-xs text-emerald-400/90 mb-4">✓ All compliance diagnostic GETs reachable ({fetchDiag.map((d) => d.path).join(', ')})</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">F4 — Customer Comms Templates</h3>
          {f4List && f4List.length > 0 ? (
            <ul className="text-xs text-slate-400 space-y-1">
              {f4List.map((t, i) => (
                <li key={i}><span className="text-slate-500 font-mono">{t.id}</span>: {t.subject}</li>
              ))}
            </ul>
          ) : <p className="text-slate-500 text-sm">No templates (check Engine / network).</p>}
          {typeof f4?.note === 'string' && <p className="text-[10px] text-slate-500 mt-2 italic">{f4.note}</p>}
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">E2 — Geo/IP Geofencing</h3>
          <p className="text-sm text-slate-400">Travel mode: <strong className="text-slate-200">{travel}</strong></p>
          {(e2?.homeRegionRequired === true || e2?.HomeRegionRequired === true) && (
            <p className="text-xs text-slate-500 mt-1">Home region required</p>
          )}
          {typeof e2?.note === 'string' && <p className="text-[10px] text-slate-500 mt-2 italic">{e2.note}</p>}
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">M2 — Recovery Phrase Attestation</h3>
          <p className="text-sm text-slate-400 mb-2">Last result: <strong className="text-slate-200">{m2Status}</strong></p>
          <button type="button" onClick={testM2} className="text-xs bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded">Test attestation again</button>
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <h3 className="font-bold text-slate-200 mb-2">H5 — EIP-7702 Abuse Detection</h3>
          <p className="text-sm text-slate-400">Block unverified delegation: <strong className="text-slate-200">{blockUnver}</strong></p>
          {typeof h5?.note === 'string' && <p className="text-[10px] text-slate-500 mt-2 italic">{h5.note}</p>}
        </div>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 md:col-span-2">
          <h3 className="font-bold text-slate-200 mb-2">G4 — Incident Playbooks</h3>
          {g4List && g4List.length > 0 ? (
            <ul className="text-xs text-slate-400 space-y-1">
              {g4List.map((p, i) => (
                <li key={i}><strong className="text-slate-300">{p.name}</strong> — RACI: {p.raci}</li>
              ))}
            </ul>
          ) : <p className="text-slate-500 text-sm">No playbooks (check Engine / network).</p>}
          {typeof g4?.note === 'string' && <p className="text-[10px] text-slate-500 mt-2 italic">{g4.note}</p>}
        </div>
      </div>
    </div>
  );
}
