/**
 * MVP-1 Demo — Scenario catalog.
 * Ties feature → scenario → expected outcome. Generate Traffic uses this.
 * Settings dependency: e.g. C7 Cap OK requires sovereignCap >= amount.
 */
export type ScenarioOutcome = 'APPROVED' | 'MFA' | 'BLOCKED';

export interface Mvp1Scenario {
  id: string;
  featureId: string;
  featureName: string;
  label: string;
  from: string;
  to: string;
  amount: string;
  params?: Record<string, unknown>;
  expected: ScenarioOutcome;
  /** e.g. "sovereignCap >= 5" for Cap OK */
  settingsNote?: string;
}

export const MVP1_SCENARIOS: Mvp1Scenario[] = [
  {
    id: 'c7-cap-ok',
    featureId: 'C7',
    featureName: 'Sovereign Cap',
    label: 'Cap OK ($5 within limit)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5',
    expected: 'APPROVED',
    settingsNote: 'Requires sovereignCap ≥ 5',
  },
  {
    id: 'c7-cap-breach',
    featureId: 'C7',
    featureName: 'Sovereign Cap',
    label: 'Cap breach ($5000 → MFA)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    expected: 'MFA',
    settingsNote: 'Amount exceeds cap → MFA required',
  },
  {
    id: 'b2-blacklist',
    featureId: 'B2',
    featureName: 'Address Lock',
    label: 'Blacklist block (ToAddress)',
    from: 'test_peeling_chain',
    to: 'rff5udguy9nvcpdnwuqw4jwfmoxwu855nt',
    amount: '1',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress in blacklist',
  },
  {
    id: 'e6-peeling',
    featureId: 'E6',
    featureName: 'Peeling Chain',
    label: 'Peeling chain (FromAddress)',
    from: 'test_peeling_chain',
    to: 'test_mature_wallet',
    amount: '100',
    expected: 'BLOCKED',
    settingsNote: 'FromAddress = peeling chain',
  },
  {
    id: 'e7-virgin',
    featureId: 'E7',
    featureName: 'Wallet Maturity',
    label: 'Virgin wallet (ToAddress)',
    from: 'test_trusted_partner',
    to: 'test_virgin_wallet',
    amount: '10',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress has zero history',
  },
  {
    id: 'e4-registry-miss',
    featureId: 'E4',
    featureName: 'Pre-check Verdict',
    label: 'Registry miss (FromAddress unknown)',
    from: '0xUnknown_New_User',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'BLOCKED',
    settingsNote: 'FromAddress not in registry',
  },
];

/** HTTP status → ScenarioOutcome */
export function statusToOutcome(status: number): ScenarioOutcome {
  if (status === 200) return 'APPROVED';
  if (status === 202) return 'MFA';
  if (status === 403) return 'BLOCKED';
  return 'BLOCKED'; // fail-closed
}

/** Match a traffic log (source, dest, amount from details) to an MVP-1 scenario. Returns best match or null. */
export function matchLogToScenario(
  sourceAddress: string,
  destAddress: string,
  amountFromDetails?: number | null
): Mvp1Scenario | null {
  const src = (sourceAddress || '').toLowerCase().trim();
  const dst = (destAddress || '').toLowerCase().trim();
  const amt = amountFromDetails ?? 0;

  const candidates = MVP1_SCENARIOS.filter((s) => {
    const sFrom = s.from.toLowerCase().trim();
    const sTo = s.to.toLowerCase().trim();
    const fromMatch = src === sFrom || src.includes(sFrom) || sFrom.includes(src);
    const toMatch = dst === sTo || dst.includes(sTo) || sTo.includes(dst);
    return fromMatch && toMatch;
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates (e.g. C7 Cap OK vs Cap breach): pick by closest amount
  const withAmount = candidates.filter((s) => parseFloat(s.amount) > 0);
  if (amt > 0 && withAmount.length > 0) {
    const best = withAmount.reduce((a, b) =>
      Math.abs(amt - parseFloat(a.amount)) <= Math.abs(amt - parseFloat(b.amount)) ? a : b
    );
    return best;
  }

  return candidates[0];
}
