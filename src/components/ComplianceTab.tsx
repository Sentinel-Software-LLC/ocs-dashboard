"use client";
import { useState, useEffect } from 'react';

function arr<T>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

/** Read camelCase or PascalCase from Engine JSON (depends on serializer). */
function pickTemplates(data: Record<string, unknown> | null): { id?: string; subject?: string }[] | null {
  if (!data) return null;
  return arr(data.templates) ?? arr(data.Templates);
}

function pickPlaybooks(data: Record<string, unknown> | null): { id?: string; name?: string; raci?: string }[] | null {
  if (!data) return null;
  return arr(data.playbooks) ?? arr(data.Playbooks);
}

/** PI.06 Sprint 4: F4, E2, M2, H5, G4 — Compliance & Horizon diagnostics (embedded under Audit) */
export default function ComplianceTab({ diagnosticsBase, getApiHeaders, embedded }: { diagnosticsBase: string; getApiHeaders: () => Promise<Record<string, string>>; embedded?: boolean }) {
  const [f4, setF4] = useState<Record<string, unknown> | null>(null);
  const [e2, setE2] = useState<Record<string, unknown> | null>(null);
  const [h5, setH5] = useState<Record<string, unknown> | null>(null);
  const [g4, setG4] = useState<Record<string, unknown> | null>(null);
  const [m2Status, setM2Status] = useState<string>('—');
  const [fetchDiag, setFetchDiag] = useState<{ path: string; status: number; hint?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setFetchDiag([]);
      try {
        const h = await getApiHeaders();
        const paths = ['comms-templates', 'geofencing', 'eip7702-policy', 'playbooks'] as const;
        const responses = await Promise.all(
          paths.map((p) => fetch(`${diagnosticsBase}/${p}`, { headers: h }))
        );
        const diag: { path: string; status: number; hint?: string }[] = [];
        responses.forEach((r, i) => {
          let hint: string | undefined;
          if (r.status === 403) hint = 'If A5 DApp allowlist is on, dashboard needs a matching X-Build-Id (see build-id.json).';
          diag.push({ path: paths[i], status: r.status, hint });
        });
        if (!cancelled) setFetchDiag(diag);
        const [rF4, rE2, rH5, rG4] = responses;
        if (!cancelled) {
          setF4(rF4.ok ? ((await rF4.json()) as Record<string, unknown>) : null);
          setE2(rE2.ok ? ((await rE2.json()) as Record<string, unknown>) : null);
          setH5(rH5.ok ? ((await rH5.json()) as Record<string, unknown>) : null);
          setG4(rG4.ok ? ((await rG4.json()) as Record<string, unknown>) : null);
        }
        // One-click demo: prove M2 POST path without director clicking (still can re-run).
        if (!cancelled && responses.every((r) => r.ok)) {
          try {
            const rM2 = await fetch(`${diagnosticsBase}/recovery-attestation`, {
              method: 'POST',
              headers: { ...h, 'Content-Type': 'application/json' },
              body: JSON.stringify({ attestationPayload: 'director-demo-stub', deviceId: 'compliance-tab' }),
            });
            const data = rM2.ok ? await rM2.json() : null;
            if (!cancelled) {
              setM2Status(
                data && typeof data === 'object' && 'valid' in data && (data as { valid?: boolean }).valid
                  ? 'Accepted (demo attestation)'
                  : `HTTP ${rM2.status}`
              );
            }
          } catch {
            if (!cancelled) setM2Status('Request failed');
          }
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

  if (loading) return <div><p className="text-slate-400">Loading compliance policies from Engine…</p></div>;
  if (error) return <div><p className="text-red-400">Error: {error}</p></div>;

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

  return (
    <div className={embedded ? '' : 'bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl'}>
      {!embedded && <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Compliance & Horizon (PI.06 Sprint 4)</h2>}
      {!embedded && (
        <p className="text-slate-400 text-sm mb-4">
          Live data from <code className="text-slate-300 bg-slate-900 px-1 rounded">{diagnosticsBase}</code> — emergency comms, geofencing policy, recovery attestation, EIP-7702 rules, incident playbooks.
        </p>
      )}
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
        <p className="text-xs text-emerald-400/90 mb-4">✓ All compliance diagnostic endpoints reachable ({fetchDiag.map((d) => d.path).join(', ')})</p>
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
