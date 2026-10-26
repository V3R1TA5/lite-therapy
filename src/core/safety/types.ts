export type RiskLevel = 'none' | 'concern' | 'imminent';

export type RiskCategory =
  | 'suicide'
  | 'self_harm'
  | 'harm_to_others'
  | 'abuse'
  | 'psychosis'
  | 'medical_emergency';

export type RiskContext =
  | 'self'
  | 'third_party'
  | 'fiction'
  | 'historical'
  | 'hypothetical'
  | 'negated'
  | 'unclear';

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = {
  none: 0,
  concern: 1,
  imminent: 2,
};

export function maxRiskLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_LEVEL_ORDER[left] >= RISK_LEVEL_ORDER[right] ? left : right;
}
