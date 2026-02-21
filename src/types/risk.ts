/** Risk log from PGTAIL Engine API (RiskAuditLogDto) */
export interface RiskLog {
  id: number;
  timestamp: string;
  transactionHash: string;
  sourceAddress: string;
  destinationAddress: string;
  riskScore: number;
  confidenceScore: number;
  classification: string;
  verdict: string;
  reason: string;
  detailsJson: string;
}

/** Decision matrix from DetailsJson (maps to C# TrustRangeDecisionMatrix) */
export interface DecisionMatrix {
  currentAmount: number;
  sovereignCap: number | null;
  calculatedRisk: number;
  maxRiskFloor: number;
  blockThreshold?: number;
  calculatedConfidence: number;
  minConfidenceCeiling: number;
  amountWithinCap: boolean;
  riskWithinFloor: boolean;
  confidenceAboveCeiling: boolean;
  verdict: string;
  mfaStatus: string;
  breachReason: string;
}

/** Parsed forensic details from DetailsJson */
export interface ForensicDetails {
  decisionMatrix?: DecisionMatrix;
  riskResults?: unknown[];
  trustRangeVerdict?: string;
  trustRangeReason?: string;
  trustProfile?: string;
}

/** Trust profile enum (matches C# TrustProfile) */
export type TrustProfile = 'ZeroTrust' | 'Community' | 'Custom' | 'Institutional' | 'TimeSentry';

export const TRUST_PROFILES: { value: number; label: string; description: string }[] = [
  { value: 0, label: 'Zero Trust', description: 'Strict: Cap=0, Risk≤10, Confidence≥95%' },
  { value: 1, label: 'Community', description: 'Default: Cap=$1K, Risk≤30, Confidence≥70%' },
  { value: 2, label: 'Custom', description: 'Use your vault overrides only' },
  { value: 3, label: 'Institutional', description: 'Relaxed: Cap=$100K, Risk≤50, Confidence≥60%' },
  { value: 4, label: 'Time-Sentry', description: '90% Cap reduction after 8 PM (Ghost Hours Policy)' },
];
