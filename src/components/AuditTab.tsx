"use client";
import type { Mvp1Scenario, ScenarioOutcome } from '@/types/mvp1Scenarios';
import type { Mvp2Scenario } from '@/types/mvp2Scenarios';
import CheckRiskForm from './CheckRiskForm';
import ComplianceTab from './ComplianceTab';

interface AuditTabProps {
  apiBase: string;
  diagnosticsBase: string;
  selectedMvp: 1 | 2 | null;
  setSelectedMvp: (v: 1 | 2 | null) => void;
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
    selectedMvp,
    setSelectedMvp,
    trafficResults,
    setTrafficResults,
    trafficResultsMvp2,
    setTrafficResultsMvp2,
    generating,
    generatingMvp2,
    generateTraffic,
    generateTrafficMvp2,
    fetchLogs,
    getApiHeaders,
    getRiskLabel,
    getAuthorizationLabel,
  } = props;

  return (
    <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-2xl space-y-8">
      <h2 className="text-xl text-slate-300 underline underline-offset-8">Audit & Export</h2>

      <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50">
        <h3 className="text-sm font-bold text-slate-400 mb-3">Check Risk (I2 Slippage)</h3>
        <p className="text-xs text-slate-500 mb-3">Test check-risk with optional swap params. For DEX swaps, set Max Slippage % to enforce I2 guard.</p>
        <CheckRiskForm apiBase={apiBase} onSuccess={fetchLogs} />
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

      <div className="border-t border-slate-600 pt-8">
        <h3 className="text-lg font-bold text-slate-300 mb-4">MVP Demo</h3>
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
                          await fetch(`${diagnosticsBase}/seed`, { method: 'POST', headers: await getApiHeaders() });
                        } catch {
                          // handled by parent
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
                          await fetch(`${diagnosticsBase}/seed`, { method: 'POST', headers: await getApiHeaders() });
                        } catch {
                          // handled by parent
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

        <div className="border-t border-slate-600 pt-8">
          <h3 className="text-lg font-bold text-slate-300 mb-4">Compliance (PI.06)</h3>
          <ComplianceTab diagnosticsBase={diagnosticsBase} getApiHeaders={getApiHeaders} embedded />
        </div>
      </div>
    </div>
  );
}
