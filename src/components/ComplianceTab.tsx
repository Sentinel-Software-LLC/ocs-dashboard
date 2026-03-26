"use client";
import { useState, useEffect } from 'react';

/** PI.06 Sprint 4: F4, E2, M2, H5, G4 — Compliance & Horizon diagnostics (embedded under Audit) */
export default function ComplianceTab({ diagnosticsBase, getApiHeaders, embedded }: { diagnosticsBase: string; getApiHeaders: () => Promise<Record<string, string>>; embedded?: boolean }) {
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

  if (loading) return <div><p className="text-slate-400">Loading compliance policies…</p></div>;
  if (error) return <div><p className="text-red-400">Error: {error}</p></div>;

  return (
    <div className={embedded ? '' : 'bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl'}>
      {!embedded && <h2 className="text-xl mb-4 text-slate-300 underline underline-offset-8">Compliance & Horizon (PI.06 Sprint 4)</h2>}
      {!embedded && <p className="text-slate-400 text-sm mb-6">Engine diagnostics for F4, E2, M2, H5, G4.</p>}
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
