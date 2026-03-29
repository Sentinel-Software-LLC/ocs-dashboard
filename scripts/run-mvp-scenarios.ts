/**
 * Mirrors Audit tab MVP-1 / MVP-2 runners (same scenarios + HTTP → outcome mapping).
 * Usage: npx tsx scripts/run-mvp-scenarios.ts [ENGINE_BASE]
 * Default ENGINE_BASE: http://localhost:5193
 *
 * Optional: MVP_A5_BUILD_ID=abc123 npx tsx ...  (sets X-Build-Id if Engine A5 requires it)
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  MVP1_SCENARIOS,
  statusToOutcome,
  type Mvp1Scenario,
  type ScenarioOutcome,
} from '../src/types/mvp1Scenarios';
import {
  MVP2_SCENARIOS,
  statusToOutcomeMvp2,
  type Mvp2Scenario,
} from '../src/types/mvp2Scenarios';

const engineBase = process.argv[2] || process.env.ENGINE_URL || 'http://localhost:5193';
const apiBase = `${engineBase.replace(/\/$/, '')}/api/PGTAIL`;
const diagBase = `${engineBase.replace(/\/$/, '')}/api/diagnostics`;

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const fromEnv = process.env.MVP_A5_BUILD_ID;
  if (fromEnv) {
    h['X-Build-Id'] = fromEnv;
    return h;
  }
  try {
    const p = path.join(process.cwd(), 'public', 'build-id.json');
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw) as { buildId?: string };
    if (j?.buildId) h['X-Build-Id'] = j.buildId;
  } catch {
    /* optional */
  }
  return h;
}

async function seed(): Promise<void> {
  const r = await fetch(`${diagBase}/seed`, { method: 'POST', headers: headers() });
  if (!r.ok) throw new Error(`Seed failed: ${r.status}`);
}

type Row = {
  scenario: { id: string; featureId: string; label: string };
  expected: ScenarioOutcome;
  actual: ScenarioOutcome;
  status: number;
  pass: boolean;
};

function printFails(label: string, rows: Row[]): void {
  const bad = rows.filter((r) => !r.pass);
  const ok = rows.length - bad.length;
  console.log(`\n=== ${label}: ${ok}/${rows.length} matched ===`);
  for (const r of bad) {
    console.log(
      `  FAIL  ${r.scenario.featureId} ${r.scenario.id}: expected ${r.expected}, got ${r.actual} (HTTP ${r.status}) — ${r.scenario.label}`,
    );
  }
  if (bad.length === 0) console.log('  (all matched scripted expectations)');
}

async function runMvp1(): Promise<boolean> {
  const h = headers();
  const rows: Row[] = [];
  for (const s of MVP1_SCENARIOS) {
    const body = { FromAddress: s.from, ToAddress: s.to, Amount: s.amount, ...s.params };
    const r = await fetch(`${apiBase}/check-risk`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const actual = statusToOutcome(r.status);
    rows.push({
      scenario: { id: s.id, featureId: s.featureId, label: s.label },
      expected: s.expected,
      actual,
      status: r.status,
      pass: actual === s.expected,
    });
  }
  printFails('MVP-1', rows);
  return rows.every((x) => x.pass);
}

async function runMvp2(): Promise<boolean> {
  const h = headers();
  const results: { scenario: Mvp2Scenario; actual: ScenarioOutcome; status: number; pass: boolean }[] = [];
  const preB1 = MVP2_SCENARIOS.filter((s) => s.featureId !== 'B1');
  const b1Scenarios = MVP2_SCENARIOS.filter((s) => s.featureId === 'B1');

  for (const s of preB1) {
    const body = { FromAddress: s.from, ToAddress: s.to, Amount: s.amount, ...s.params };
    const r = await fetch(`${apiBase}/check-risk`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });
    const actual = statusToOutcomeMvp2(r.status);
    results.push({ scenario: s, actual, status: r.status, pass: actual === s.expected });
  }

  if (b1Scenarios.length > 0) {
    const put = await fetch(`${apiBase}/registry/test_trusted_partner/policy`, {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({
        TrustProfile: 2,
        SovereignCap: 100000,
        HardwareWalletRequiredAbove: 1000,
      }),
    });
    if (!put.ok) {
      console.error(`MVP-2: B1 policy deploy failed HTTP ${put.status}`);
    }
    for (const s of b1Scenarios) {
      const body = { FromAddress: s.from, ToAddress: s.to, Amount: s.amount, ...s.params };
      const r = await fetch(`${apiBase}/check-risk`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      });
      const actual = statusToOutcomeMvp2(r.status);
      results.push({ scenario: s, actual, status: r.status, pass: actual === s.expected });
    }
  }

  const flat = results.map((x) => ({
    scenario: { id: x.scenario.id, featureId: x.scenario.featureId, label: x.scenario.label },
    expected: x.scenario.expected,
    actual: x.actual,
    status: x.status,
    pass: x.pass,
  }));
  printFails('MVP-2', flat);
  return results.every((x) => x.pass);
}

async function main(): Promise<void> {
  console.log(`Engine: ${engineBase}`);
  console.log('Seeding…');
  await seed();
  const m1 = await runMvp1();
  const m2 = await runMvp2();
  console.log(`\nOverall: MVP-1 ${m1 ? 'PASS' : 'FAIL'}, MVP-2 ${m2 ? 'PASS' : 'FAIL'}`);
  if (!m1 || !m2) {
    console.log(
      '\nTypical causes: Deployed policy overrides (PI.07) stricter than demo table; missing seed data; A5 requires X-Build-Id (set MVP_A5_BUILD_ID). Re-run after POST /api/diagnostics/seed and Registry policy aligned with Auto-configure for MVP.',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
