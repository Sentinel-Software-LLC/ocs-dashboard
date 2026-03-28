"use client";
import { useState } from 'react';
import { mvp1ScenarioToManualTestPreset, type ManualTestPreset, type Mvp1Scenario, type ScenarioOutcome } from '@/types/mvp1Scenarios';
import { mvp2ScenarioToManualTestPreset, type Mvp2Scenario } from '@/types/mvp2Scenarios';
import CheckRiskForm from './CheckRiskForm';
import ComplianceTab from './ComplianceTab';

export type MvpAutoSeedState = {
  phase: 'idle' | 'restoring' | 'ok' | 'error';
  detail?: string;
};

interface AuditTabProps {
  apiBase: string;
  diagnosticsBase: string;
  mvpAutoSeed: MvpAutoSeedState;
  autoConfigurePolicyForMvp: () => Promise<void>;
  trafficResults: { scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] | null;
  setTrafficResults: (v: { scenario: Mvp1Scenario; actual: ScenarioOutcome; pass: boolean }[] | null) => void;
  trafficResultsMvp2: { scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] | null;
  setTrafficResultsMvp2: (v: { scenario: Mvp2Scenario; actual: ScenarioOutcome; pass: boolean }[] | null) => void;
  generating: boolean;
  generatingMvp2: boolean;
  generateTraffic: () => Promise<void>;
  generateTrafficMvp2: () => Promise<void>;
  fetchLogs: () => void;
  getApiHeaders: () => Promise<Record<string, string>>;
  getRiskLabel: (s: string) => string;
  getAuthorizationLabel: (s: string) => string;
}

export default function AuditTab(props: AuditTabProps) {
  const {
    apiBase,
    diagnosticsBase,
    mvpAutoSeed,
    autoConfigurePolicyForMvp,
    trafficResults,
    trafficResultsMvp2,
    generating,
    generatingMvp2,
    generateTraffic,
    generateTrafficMvp2,
    fetchLogs,
    getApiHeaders,
    getRiskLabel,
    getAuthorizationLabel,
  } = props;

  const [manualTestPresetVersion, setManualTestPresetVersion] = useState(0);
  const [manualTestPreset, setManualTestPreset] = useState<ManualTestPreset | null>(null);
  const [manualTestPresetLabel, setManualTestPresetLabel] = useState<string | null>(null);

  const applyMvp1RowToManualTest = (scenario: Mvp1Scenario) => {
    setManualTestPresetVersion((v) => v + 1);
    setManualTestPreset(mvp1ScenarioToManualTestPreset(scenario));
    setManualTestPresetLabel(`${scenario.featureId} — ${scenario.label}`);
    document.getElementById('audit-manual-test')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const applyMvp2RowToManualTest = (scenario: Mvp2Scenario) => {
    setManualTestPresetVersion((v) => v + 1);
    setManualTestPreset(mvp2ScenarioToManualTestPreset(scenario));
    setManualTestPresetLabel(`${scenario.featureId} — ${scenario.label}`);
    document.getElementById('audit-manual-test')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl space-y-8">
      <h2 className="text-xl text-slate-300 underline underline-offset-8">Audit & Export</h2>

      <div>
        <h3 className="text-lg font-bold text-slate-300 mb-4">Automated MVP Demo</h3>
        <div className="mb-4 p-4 rounded-lg border border-slate-600 bg-slate-900/70 text-sm text-slate-300 space-y-2">
        <p>
          <strong className="text-slate-200">What “pass” means:</strong> MVP scenarios ship with a <strong className="text-slate-200">fixed expectation table</strong> tuned to the{' '}
          <strong className="text-slate-200">factory demo registry</strong> (Trusted Partner, ~$1000 cap, Community-style posture — use{' '}
          <strong className="text-slate-200">Auto-configure policy for MVP</strong> to align the DB). PGTAIL always evaluates against your{' '}
          <strong className="text-slate-200">live Deployed</strong> policy. If you deploy something stricter (e.g. Zero Trust), many rows can show ✗ even when the engine did the right thing — the{' '}
          <strong className="text-slate-200">canned expectation</strong> no longer matches your posture. ✓ / ✗ is “matched scripted demo,” not “engine broken.”
        </p>
        <p className="text-slate-400 text-xs">
          <strong className="text-slate-200">Auto-configure policy for MVP</strong> (above Run) resets demo rows and clears overrides, then opens <strong className="text-slate-300">Registry &amp; Policy</strong> so <strong className="text-slate-300">Current Settings</strong> matches the MVP expectation table.
        </p>
        </div>
        <p className="text-slate-400 text-sm mb-4">
          <strong className="text-slate-300">MVP-1</strong> and <strong className="text-slate-300">MVP-2</strong> are both on this page — run either suite below without switching modes.
        </p>
        <div className="space-y-8">
          <div id="mvp1-demo" className="space-y-4 scroll-mt-4">
            <p className="font-bold text-lg text-emerald-400">MVP-1 — The Sovereign Foundation</p>
            <p className="text-xs text-slate-500 -mt-2">18 scenarios (C7, B2, E6, E7, E4, H3 — extremes per feature). Expected pass: Auto-configure or Trusted Partner + ~$1000 cap.</p>
                <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                  <p className="text-sm font-bold text-slate-300 mb-2">MVP-1 Prerequisites</p>
                  <ul className="text-xs text-slate-400 list-disc list-inside space-y-1">
                    <li>Engine running (dotnet run on 5193, or Docker on 8080)</li>
                    <li>Runs use live DB policy — <strong className="text-slate-300">Deploy</strong> from Registry &amp; Policy so results match what you configured.</li>
                    <li>Use <strong className="text-slate-300">Auto-configure policy for MVP</strong> first if you want Current Settings to match the table (resets seeded wallets and clears deploy overrides).</li>
                  </ul>
                  {mvpAutoSeed.phase === 'idle' && mvpAutoSeed.detail && (
                    <p className="text-sm text-slate-400 mt-3">{mvpAutoSeed.detail}</p>
                  )}
                  {mvpAutoSeed.phase === 'restoring' && (
                    <p className="text-sm text-amber-200 mt-3">Applying MVP demo policy…</p>
                  )}
                  {mvpAutoSeed.phase === 'error' && mvpAutoSeed.detail && (
                    <p className="text-sm text-red-300 mt-3">Auto-configure failed: {mvpAutoSeed.detail}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => autoConfigurePolicyForMvp()}
                      disabled={mvpAutoSeed.phase === 'restoring' || generating || generatingMvp2}
                      className="bg-slate-600 hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm border border-slate-500"
                    >
                      Auto-configure policy for MVP
                    </button>
                    <button
                      onClick={generateTraffic}
                      disabled={generating || generatingMvp2 || mvpAutoSeed.phase === 'restoring'}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm"
                    >
                      {generating ? '⏳ Running…' : '▶ Run MVP-1'}
                    </button>
                  </div>
                </div>
                {trafficResults && (
                  <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                    <h3 className="text-sm font-bold text-slate-400 mb-1">MVP-1 Results — {trafficResults.filter((r) => r.pass).length}/{trafficResults.length} matched demo expectations</h3>
                    <p className="text-xs text-slate-500 mb-3">✓ = actual outcome matched the scenario&apos;s Expected column (see callout above).</p>
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-600 text-slate-500">
                          <th className="p-2">Feature</th>
                          <th className="p-2">Scenario</th>
                          <th className="p-2">Risk</th>
                          <th className="p-2">Expected</th>
                          <th className="p-2">Actual</th>
                          <th className="p-2" title="Whether Actual matched the scripted Expected for the factory demo preset">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficResults.map((r, i) => (
                          <tr
                            key={i}
                            role="button"
                            tabIndex={0}
                            title="Load into Manual Test"
                            className={`border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500/80 ${r.pass ? '' : 'bg-red-900/20'}`}
                            onClick={() => applyMvp1RowToManualTest(r.scenario)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                applyMvp1RowToManualTest(r.scenario);
                              }
                            }}
                          >
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
          </div>
          <div id="mvp2-demo" className="space-y-4 scroll-mt-4 border-t border-slate-700 pt-8">
            <p className="font-bold text-lg text-amber-400">MVP-2 — Enterprise Guard</p>
            <p className="text-xs text-slate-500 -mt-2">21 scenarios (H1–H3, J1, K1, I2, B1 — 3 outcomes per feature: Authorized / Requires Authorization / Not Authorized).</p>
                <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                  <p className="text-sm font-bold text-slate-300 mb-2">MVP-2 Prerequisites</p>
                  <ul className="text-xs text-slate-400 list-disc list-inside space-y-1">
                    <li>Engine running; seeded (Auto-configure or manual seed).</li>
                    <li>H1–I2 scenarios run against the seeded default policy (cap=$1000). B1 policy (Custom, cap=$100k, HW=$1000) is <strong className="text-slate-300">auto-deployed</strong> by the runner before B1 scenarios execute — no manual step needed.</li>
                    <li>Optional: <strong className="text-slate-300">Auto-configure policy for MVP</strong> resets demo rows (status messages appear under MVP-1 above).</li>
                  </ul>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => autoConfigurePolicyForMvp()}
                      disabled={mvpAutoSeed.phase === 'restoring' || generating || generatingMvp2}
                      className="bg-slate-600 hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm border border-slate-500"
                    >
                      Auto-configure policy for MVP
                    </button>
                    <button
                      onClick={generateTrafficMvp2}
                      disabled={generatingMvp2 || generating || mvpAutoSeed.phase === 'restoring'}
                      className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-4 py-2 rounded font-bold text-sm"
                    >
                      {generatingMvp2 ? '⏳ Running…' : '▶ Run MVP-2'}
                    </button>
                  </div>
                </div>
                {trafficResultsMvp2 && (
                  <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
                    <h3 className="text-sm font-bold text-slate-400 mb-1">MVP-2 Results — {trafficResultsMvp2.filter((r) => r.pass).length}/{trafficResultsMvp2.length} matched demo expectations (21 scenarios, 3 extremes per feature)</h3>
                    <p className="text-xs text-slate-500 mb-3">✓ = actual outcome matched the scenario&apos;s Expected column (see callout above).</p>
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-600 text-slate-500">
                          <th className="p-2">Feature</th>
                          <th className="p-2">Scenario</th>
                          <th className="p-2">Risk</th>
                          <th className="p-2">Expected</th>
                          <th className="p-2">Actual</th>
                          <th className="p-2" title="Whether Actual matched the scripted Expected for the factory demo preset">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficResultsMvp2.map((r, i) => (
                          <tr
                            key={i}
                            role="button"
                            tabIndex={0}
                            title="Load into Manual Test"
                            className={`border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500/80 ${r.pass ? '' : 'bg-red-900/20'}`}
                            onClick={() => applyMvp2RowToManualTest(r.scenario)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                applyMvp2RowToManualTest(r.scenario);
                              }
                            }}
                          >
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
          </div>
        </div>
      </div>

      <div id="audit-manual-test" className="border-t border-slate-600 pt-8 space-y-6 scroll-mt-4">
        <h3 className="text-lg font-bold text-slate-300 mb-4">Manual Test</h3>
        <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
          <p className="text-xs text-slate-500 mb-3">Test check-risk with optional swap params. For DEX swaps, set Max Slippage % to enforce I2 guard.</p>
          <CheckRiskForm
            apiBase={apiBase}
            onSuccess={fetchLogs}
            presetVersion={manualTestPresetVersion}
            preset={manualTestPreset}
            presetLabel={manualTestPresetLabel}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${apiBase}/audit/export?format=csv`, { headers: await getApiHeaders() });
                if (!res.ok) throw new Error(`Export failed: ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ocs-disclosure-report-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                // handled by parent
              }
            }}
            className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded font-bold"
          >
            Export Disclosure Report (CSV) — N1
          </button>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${apiBase}/audit/export/signed`, { headers: await getApiHeaders() });
                if (!res.ok) throw new Error(`Export failed: ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ocs-forensics-signed-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                // handled by parent
              }
            }}
            className="bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded font-bold"
          >
            Download Signed Forensics Bundle — F3
          </button>
        </div>
      </div>

      <div className="border-t border-slate-600 pt-8">
        <h3 className="text-lg font-bold text-slate-300 mb-4">Compliance (PI.06)</h3>
        <ComplianceTab diagnosticsBase={diagnosticsBase} getApiHeaders={getApiHeaders} embedded />
      </div>
    </div>
  );
}
