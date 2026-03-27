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
  // C7 Cap — 3 extremes
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
    id: 'c7-cap-high',
    featureId: 'C7',
    featureName: 'Sovereign Cap',
    label: 'Cap high risk (target virgin)',
    from: 'test_trusted_partner',
    to: 'test_virgin_wallet',
    amount: '5',
    expected: 'BLOCKED',
    settingsNote: 'Target virgin wallet → risk 100',
  },
  // B2 Blacklist — 3 extremes
  {
    id: 'b2-blacklist-low',
    featureId: 'B2',
    featureName: 'Address Lock',
    label: 'Blacklist low (target whitelist)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'APPROVED',
    settingsNote: 'Target whitelist, no blacklist',
  },
  {
    id: 'b2-blacklist-moderate',
    featureId: 'B2',
    featureName: 'Address Lock',
    label: 'Blacklist moderate (target graylist)',
    from: 'test_trusted_partner',
    to: 'test_community_blacklisted',
    amount: '10',
    expected: 'MFA',
    settingsNote: 'Target community graylist',
  },
  {
    id: 'b2-blacklist-high',
    featureId: 'B2',
    featureName: 'Address Lock',
    label: 'Blacklist block (ToAddress)',
    from: 'test_trusted_partner',
    to: 'test_blacklisted',
    amount: '1',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress in blacklist',
  },
  // E6 Peeling Chain — 3 extremes (ToAddress = peeling)
  {
    id: 'e6-peeling-low',
    featureId: 'E6',
    featureName: 'Peeling Chain',
    label: 'Peeling low (target no peeling)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'APPROVED',
    settingsNote: 'Target has no peeling',
  },
  {
    id: 'e6-peeling-moderate',
    featureId: 'E6',
    featureName: 'Peeling Chain',
    label: 'Peeling moderate (target suspected)',
    from: 'test_trusted_partner',
    to: 'test_suspected_peeling',
    amount: '10',
    expected: 'MFA',
    settingsNote: 'Target suspected peeling (light)',
  },
  {
    id: 'e6-peeling-high',
    featureId: 'E6',
    featureName: 'Peeling Chain',
    label: 'Peeling chain (ToAddress)',
    from: 'test_trusted_partner',
    to: 'rff5udguy9nvcpdnwuqw4jwfmoxwu855nt',
    amount: '1',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress = real XRPL peeling address (not in registry)',
  },
  // E7 Virgin Wallet — 3 extremes
  {
    id: 'e7-virgin-low',
    featureId: 'E7',
    featureName: 'Wallet Maturity',
    label: 'Virgin low (target established)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'APPROVED',
    settingsNote: 'Target established',
  },
  {
    id: 'e7-virgin-moderate',
    featureId: 'E7',
    featureName: 'Wallet Maturity',
    label: 'Virgin moderate (target young 2h)',
    from: 'test_trusted_partner',
    to: 'test_age_2hour',
    amount: '10',
    expected: 'MFA',
    settingsNote: 'Target young (2h, risk 65)',
  },
  {
    id: 'e7-virgin-high',
    featureId: 'E7',
    featureName: 'Wallet Maturity',
    label: 'Virgin wallet (ToAddress)',
    from: 'test_trusted_partner',
    to: 'test_virgin_wallet',
    amount: '10',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress has zero history',
  },
  // E4 Registry Miss — 2 extremes
  {
    id: 'e4-registry-low',
    featureId: 'E4',
    featureName: 'Pre-check Verdict',
    label: 'Registry low (source in registry)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'APPROVED',
    settingsNote: 'Source in registry',
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
  // H3 Drainer — 2 extremes
  {
    id: 'h3-drainer-low',
    featureId: 'H3',
    featureName: 'Known Drainer',
    label: 'Drainer low (target not drainer)',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '10',
    expected: 'APPROVED',
    settingsNote: 'Target not drainer',
  },
  {
    id: 'h3-drainer-high',
    featureId: 'H3',
    featureName: 'Known Drainer',
    label: 'Drainer block (ToAddress)',
    from: 'test_trusted_partner',
    to: 'test_known_drainer',
    amount: '1',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress known drainer',
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

/** Fields that match Manual Test / check-risk form (MVP-1 scenario → form). */
export type ManualTestPreset = {
  from: string;
  to: string;
  amount: string;
  txType: string;
  maxSlippage: string;
  slippage: string;
};

function manualTestExtrasFromParams(params?: Record<string, unknown>): Pick<ManualTestPreset, 'txType' | 'maxSlippage' | 'slippage'> {
  const p = params ?? {};
  const str = (camel: string, pascal: string) => {
    const v = p[pascal] ?? p[camel];
    return v != null && v !== '' ? String(v) : '';
  };
  return {
    txType: str('transactionType', 'TransactionType'),
    maxSlippage: str('maxSlippagePercent', 'MaxSlippagePercent'),
    slippage: str('slippagePercent', 'SlippagePercent'),
  };
}

export function mvp1ScenarioToManualTestPreset(s: Mvp1Scenario): ManualTestPreset {
  return {
    from: s.from,
    to: s.to,
    amount: s.amount,
    ...manualTestExtrasFromParams(s.params),
  };
}
