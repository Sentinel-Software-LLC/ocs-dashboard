/**
 * MVP-2 Demo — Scenario catalog (PI.04 Drainer Shield + PI.05 Fortified Vault).
 * H1, H2, H3, J1, K1, I2, B1 — 3 extremes (Low/APPROVED, Moderate/MFA, High/BLOCKED) per feature.
 * N1 and F3 are export actions (Audit tab).
 *
 * Execution order matters for B1: H1–I2 scenarios run against the seeded default policy
 * (SovereignCap=1000). Before B1 scenarios, generateTrafficMvp2 deploys the B1 policy
 * (Custom, SovereignCap=100000, HardwareWalletRequiredAbove=1000) so the HW threshold
 * can fire independently of the cap.
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
  // ── H1: Approval Drainer Guard ──────────────────────────────────────────────
  {
    id: 'h1-approval-safe-low',
    featureId: 'H1',
    featureName: 'Approval Drainer Guard',
    label: 'Safe spender, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    params: { TransactionType: 'approval', SpenderAddress: 'test_mature_wallet' },
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'h1-approval-safe-cap',
    featureId: 'H1',
    featureName: 'Approval Drainer Guard',
    label: 'Safe spender, exceeds cap',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: { TransactionType: 'approval', SpenderAddress: 'test_mature_wallet' },
    expected: 'MFA',
    settingsNote: 'H1 guard does not fire; cap breach ($5000 > $1000) triggers MFA',
  },
  {
    id: 'h1-approval-drainer',
    featureId: 'H1',
    featureName: 'Approval Drainer Guard',
    label: 'Approval to known drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TransactionType: 'approval', SpenderAddress: 'test_known_drainer' },
    expected: 'BLOCKED',
    settingsNote: 'SpenderAddress in drainer blocklist',
  },

  // ── H2: Permit Signature Guard ───────────────────────────────────────────────
  {
    id: 'h2-permit-safe-low',
    featureId: 'H2',
    featureName: 'Permit Signature Guard',
    label: 'Safe spender, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    params: { TransactionType: 'permit', SpenderAddress: 'test_mature_wallet' },
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'h2-permit-safe-cap',
    featureId: 'H2',
    featureName: 'Permit Signature Guard',
    label: 'Safe spender, exceeds cap',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: { TransactionType: 'permit', SpenderAddress: 'test_mature_wallet' },
    expected: 'MFA',
    settingsNote: 'H2 guard does not fire; cap breach triggers MFA',
  },
  {
    id: 'h2-permit-drainer',
    featureId: 'H2',
    featureName: 'Permit Signature Guard',
    label: 'Permit to known drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TransactionType: 'permit', SpenderAddress: 'test_known_drainer' },
    expected: 'BLOCKED',
    settingsNote: 'SpenderAddress in drainer blocklist',
  },

  // ── H3: Known Drainer Blocklist ──────────────────────────────────────────────
  {
    id: 'h3-drainer-safe-low',
    featureId: 'H3',
    featureName: 'Known Drainer Blocklist',
    label: 'Legitimate target, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'h3-drainer-safe-cap',
    featureId: 'H3',
    featureName: 'Known Drainer Blocklist',
    label: 'Legitimate target, exceeds cap',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    expected: 'MFA',
    settingsNote: 'H3 guard does not fire; cap breach ($5000 > $1000) triggers MFA',
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

  // ── J1: Bridge Chain Validation ──────────────────────────────────────────────
  {
    id: 'j1-no-bridge',
    featureId: 'J1',
    featureName: 'Bridge Chain Validation',
    label: 'Standard transfer, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'j1-bridge-match',
    featureId: 'J1',
    featureName: 'Bridge Chain Validation',
    label: 'Bridge correct chain — J2 confirms',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TransactionType: 'bridge', BridgeChainId: 137, ExpectedChainId: 137 },
    expected: 'MFA',
    settingsNote: 'Chain IDs match (J1 passes); J2 requires two-channel bridge confirmation',
  },
  {
    id: 'j1-bridge-mismatch',
    featureId: 'J1',
    featureName: 'Bridge Chain Validation',
    label: 'Bridge wrong network',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TransactionType: 'bridge', BridgeChainId: 1, ExpectedChainId: 137 },
    expected: 'BLOCKED',
    settingsNote: 'BridgeChainId != ExpectedChainId',
  },

  // ── K1: Token Impersonation Guard ────────────────────────────────────────────
  {
    id: 'k1-token-safe-low',
    featureId: 'K1',
    featureName: 'Token Impersonation Guard',
    label: 'Legitimate token, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    params: { TokenContractAddress: '0x_safe_token_contract' },
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'k1-token-safe-cap',
    featureId: 'K1',
    featureName: 'Token Impersonation Guard',
    label: 'Legitimate token, exceeds cap',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: { TokenContractAddress: '0x_safe_token_contract' },
    expected: 'MFA',
    settingsNote: 'K1 guard does not fire; cap breach triggers MFA',
  },
  {
    id: 'k1-token-impersonation',
    featureId: 'K1',
    featureName: 'Token Impersonation Guard',
    label: 'Token contract is drainer',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TokenContractAddress: 'test_known_drainer' },
    expected: 'BLOCKED',
    settingsNote: 'TokenContractAddress in drainer blocklist',
  },

  // ── I2: Slippage Guard ───────────────────────────────────────────────────────
  {
    id: 'i2-slippage-safe-low',
    featureId: 'I2',
    featureName: 'Slippage Guard',
    label: 'Slippage within limit, $800',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '800',
    params: { TransactionType: 'dex_swap', MaxSlippagePercent: 1, SlippagePercent: 0.5 },
    expected: 'APPROVED',
    settingsNote: 'Auto cap=$1000 → APPROVED; Community cap=$500 would → MFA',
  },
  {
    id: 'i2-slippage-safe-cap',
    featureId: 'I2',
    featureName: 'Slippage Guard',
    label: 'Slippage within limit, exceeds cap',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: { TransactionType: 'dex_swap', MaxSlippagePercent: 1, SlippagePercent: 0.5 },
    expected: 'MFA',
    settingsNote: 'I2 guard does not fire; cap breach triggers MFA',
  },
  {
    id: 'i2-slippage-exceeded',
    featureId: 'I2',
    featureName: 'Slippage Guard',
    label: 'Slippage exceeds max',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '100',
    params: { TransactionType: 'dex_swap', MaxSlippagePercent: 1, SlippagePercent: 2.5 },
    expected: 'BLOCKED',
    settingsNote: 'SlippagePercent (2.5%) > MaxSlippagePercent (1%)',
  },

  // ── B1: Hardware-Wallet Policy ───────────────────────────────────────────────
  // generateTrafficMvp2 deploys Custom policy (cap=$100k, HW=1000) before these run,
  // so the HW threshold fires independently of the sovereign cap.
  {
    id: 'b1-hw-below-threshold',
    featureId: 'B1',
    featureName: 'Hardware-Wallet Policy',
    label: 'Amount below HW threshold',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '500',
    params: { IsHardwareWallet: false },
    expected: 'APPROVED',
    settingsNote: 'Amount ($500) < HardwareWalletRequiredAbove ($1000); no HW required',
  },
  {
    id: 'b1-hw-required',
    featureId: 'B1',
    featureName: 'Hardware-Wallet Policy',
    label: 'High value, no hardware wallet',
    from: 'test_trusted_partner',
    to: 'test_mature_wallet',
    amount: '5000',
    params: { IsHardwareWallet: false },
    expected: 'MFA',
    settingsNote: 'Amount ($5000) > HardwareWalletRequiredAbove ($1000); HW or MFA required',
  },
  {
    id: 'b1-hw-blacklisted',
    featureId: 'B1',
    featureName: 'Hardware-Wallet Policy',
    label: 'Hardware wallet present — blacklisted destination',
    from: 'test_trusted_partner',
    to: 'test_blacklisted',
    amount: '5000',
    params: { IsHardwareWallet: true },
    expected: 'BLOCKED',
    settingsNote: 'HW present (B1 satisfied), but B2 blacklist hard-blocks — layered defense',
  },
];

import type { ManualTestPreset } from './mvp1Scenarios';

export function mvp2ScenarioToManualTestPreset(s: Mvp2Scenario): ManualTestPreset {
  const p = s.params ?? {};
  const str = (key: string): string => {
    const v = p[key] ?? p[key.charAt(0).toLowerCase() + key.slice(1)];
    return v != null && v !== '' ? String(v) : '';
  };
  return {
    from: s.from,
    to: s.to,
    amount: s.amount,
    txType: str('TransactionType'),
    maxSlippage: str('MaxSlippagePercent'),
    slippage: str('SlippagePercent'),
    spenderAddress: str('SpenderAddress') || undefined,
    bridgeChainId: str('BridgeChainId') || undefined,
    expectedChainId: str('ExpectedChainId') || undefined,
    tokenContractAddress: str('TokenContractAddress') || undefined,
    isHardwareWallet: str('IsHardwareWallet') || undefined,
  };
}

/** HTTP status → ScenarioOutcome */
export function statusToOutcomeMvp2(status: number): ScenarioOutcome {
  if (status === 200) return 'APPROVED';
  if (status === 202) return 'MFA';
  if (status === 403) return 'BLOCKED';
  return 'BLOCKED'; // fail-closed
}

/** Match a traffic log to an MVP-2 scenario. Returns best match or null.
 * Note: H1–H3, J1, K1, I2 blocked requests are not persisted by Engine, so only
 * APPROVED/MFA rows appear in Live Traffic. B1 scenarios are always persisted. */
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

  // H3 / H1 / H2: ToAddress or SpenderAddress is drainer (Engine blocks before logging; if ever logged)
  if (dst.includes('test_known_drainer') || src.includes('test_known_drainer')) {
    return MVP2_SCENARIOS.find((s) => s.featureId === 'H3' && s.expected === 'BLOCKED') ?? null;
  }

  // B1: from trusted_partner, to mature_wallet, amount 5000, MFA with hardware wallet reason
  const b1Mfa = MVP2_SCENARIOS.find((s) => s.id === 'b1-hw-required');
  if (b1Mfa && src.includes('test_trusted_partner') && dst.includes('test_mature_wallet') && Math.abs(amt - 5000) < 1) {
    if (r.includes('b1') || r.includes('hardware') || r.includes('hardwarewalletrequiredabove')) return b1Mfa;
  }

  // B1: from trusted_partner, to mature_wallet, amount 500, APPROVED (below HW threshold)
  const b1Low = MVP2_SCENARIOS.find((s) => s.id === 'b1-hw-below-threshold');
  if (b1Low && src.includes('test_trusted_partner') && dst.includes('test_mature_wallet') && Math.abs(amt - 500) < 1) {
    return b1Low;
  }

  // B1: from trusted_partner, to blacklisted, BLOCKED
  if (src.includes('test_trusted_partner') && dst.includes('test_blacklisted')) {
    return MVP2_SCENARIOS.find((s) => s.id === 'b1-hw-blacklisted') ?? null;
  }

  return null;
}
