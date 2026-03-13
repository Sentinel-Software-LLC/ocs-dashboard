/**
 * MVP-2 Demo — Scenario catalog (PI.04 Drainer Shield + PI.05 Fortified Vault).
 * H1, H2, H3, J1, K1, I2, B1. N1 and F3 are export actions (Audit tab).
 */
export type ScenarioOutcome = 'APPROVED' | 'MFA' | 'BLOCKED';

export interface Mvp2Scenario {
  id: string;
  featureId: string;
  featureName: string;
  label: string;
  from: string;
  to: string;
  amount: string;
  params?: Record<string, unknown>;
  expected: ScenarioOutcome;
  settingsNote?: string;
}

export const MVP2_SCENARIOS: Mvp2Scenario[] = [
  {
    id: 'h1-approval-drainer',
    featureId: 'H1',
    featureName: 'Approval Drainer Guard',
    label: 'Approval to known drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: {
      TransactionType: 'approval',
      SpenderAddress: 'test_known_drainer',
    },
    expected: 'BLOCKED',
    settingsNote: 'SpenderAddress in drainer blocklist',
  },
  {
    id: 'h2-permit-drainer',
    featureId: 'H2',
    featureName: 'Permit Signature Guard',
    label: 'Permit to known drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: {
      TransactionType: 'permit',
      SpenderAddress: 'test_known_drainer',
    },
    expected: 'BLOCKED',
    settingsNote: 'SpenderAddress in drainer blocklist',
  },
  {
    id: 'h3-drainer-address',
    featureId: 'H3',
    featureName: 'Known Drainer Blocklist',
    label: 'ToAddress is drainer',
    from: 'test_trusted_partner',
    to: 'test_known_drainer',
    amount: '1',
    expected: 'BLOCKED',
    settingsNote: 'ToAddress in drainer blocklist',
  },
  {
    id: 'j1-bridge-mismatch',
    featureId: 'J1',
    featureName: 'Bridge Chain Validation',
    label: 'Bridge wrong network',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: {
      TransactionType: 'bridge',
      BridgeChainId: 1,
      ExpectedChainId: 137,
    },
    expected: 'BLOCKED',
    settingsNote: 'BridgeChainId != ExpectedChainId',
  },
  {
    id: 'k1-token-impersonation',
    featureId: 'K1',
    featureName: 'Token Impersonation Guard',
    label: 'Token contract is drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: {
      TokenContractAddress: 'test_known_drainer',
    },
    expected: 'BLOCKED',
    settingsNote: 'TokenContractAddress in drainer blocklist',
  },
  {
    id: 'i2-slippage-exceeded',
    featureId: 'I2',
    featureName: 'Slippage Guard',
    label: 'Slippage exceeds max',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: {
      TransactionType: 'dex_swap',
      MaxSlippagePercent: 1,
      SlippagePercent: 2.5,
    },
    expected: 'BLOCKED',
    settingsNote: 'SlippagePercent > MaxSlippagePercent',
  },
  {
    id: 'b1-hw-required',
    featureId: 'B1',
    featureName: 'Hardware-Wallet Policy',
    label: 'High value, no hardware wallet',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: {
      IsHardwareWallet: false,
    },
    expected: 'MFA',
    settingsNote: 'Requires HardwareWalletRequiredAbove=1000 on FromAddress',
  },
];

/** HTTP status → ScenarioOutcome */
export function statusToOutcomeMvp2(status: number): ScenarioOutcome {
  if (status === 200) return 'APPROVED';
  if (status === 202) return 'MFA';
  if (status === 403) return 'BLOCKED';
  return 'BLOCKED'; // fail-closed
}

/** Match a traffic log to an MVP-2 scenario. Returns best match or null.
 * Note: H1–H3, J1, K1, I2 blocked requests are not persisted by Engine, so only B1 typically appears in Live Traffic. */
export function matchLogToScenarioMvp2(
  sourceAddress: string,
  destAddress: string,
  amountFromDetails?: number | null,
  reason?: string
): Mvp2Scenario | null {
  const src = (sourceAddress || '').toLowerCase().trim();
  const dst = (destAddress || '').toLowerCase().trim();
  const amt = amountFromDetails ?? 0;
  const r = (reason || '').toLowerCase();

  // H3: ToAddress is drainer (Engine blocks before logging; if ever logged, match here)
  if (dst.includes('test_known_drainer') || src.includes('test_known_drainer')) {
    return MVP2_SCENARIOS.find((s) => s.featureId === 'H3') ?? null;
  }

  // B1: from trusted_partner, to mature_wallet, amount 5000, MFA — only when reason indicates B1
  const b1 = MVP2_SCENARIOS.find((s) => s.featureId === 'B1');
  if (b1 && src.includes('test_trusted_partner') && dst.includes('test_mature_wallet') && Math.abs(amt - 5000) < 1) {
    if (r.includes('b1') || r.includes('hardware') || r.includes('hardwarewalletrequiredabove')) return b1;
    // C7 Cap breach also uses 5000; return null so MVP-1 matcher can assign C7
  }

  return null;
}
