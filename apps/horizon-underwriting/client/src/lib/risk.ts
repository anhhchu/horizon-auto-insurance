export type RiskBand = 'Critical' | 'High' | 'Moderate' | 'Low';

export const RISK_BANDS: RiskBand[] = ['Critical', 'High', 'Moderate', 'Low'];

// Display-only scale for the risk meter. Bands and review eligibility are assigned in
// src/gold/build_policy_risk_decisions.sql and arrive with each row; keep these in sync.
export const BAND_THRESHOLDS: { band: RiskBand; min: number }[] = [
  { band: 'Critical', min: 0.45 },
  { band: 'High', min: 0.42 },
  { band: 'Moderate', min: 0.39 },
];

export const REVIEW_THRESHOLD = 0.42;

export function asRiskBand(value: string | null | undefined): RiskBand {
  return RISK_BANDS.find((band) => band === value) ?? 'Low';
}

export type ActionCode = 'NO_ACTION' | 'SAFE_DRIVING_COACHING' | 'DEDUCTIBLE_REVIEW' | 'HUMAN_RENEWAL_REVIEW';

export const ACTIONS: { code: ActionCode; label: string; description: string }[] = [
  { code: 'SAFE_DRIVING_COACHING', label: 'Safe-driving coaching', description: 'Enroll the driver in the telematics coaching program before renewal.' },
  { code: 'DEDUCTIBLE_REVIEW', label: 'Deductible review', description: 'Review deductible options with the customer at renewal.' },
  { code: 'HUMAN_RENEWAL_REVIEW', label: 'Human renewal review', description: 'Route the renewal to a senior underwriter.' },
  { code: 'NO_ACTION', label: 'No action', description: 'Renew on current terms.' },
];

export function actionLabel(code: string | null | undefined) {
  return ACTIONS.find((action) => action.code === code)?.label ?? code ?? 'Unknown';
}

export function asActionCode(value: string | null | undefined): ActionCode {
  return ACTIONS.find((action) => action.code === value)?.code ?? 'NO_ACTION';
}
