export const REBALANCING_CONSTRAINT_FAMILIES = Object.freeze([
  'EXPOSURE',
  'CASH',
  'SINGLE_NAME',
  'SECTOR',
  'GROUP',
  'SMALL_CAP',
  'LIQUIDITY',
  'TURNOVER',
  'DELIVERY',
  'MIN_ORDER_VALUE',
  'TIMING',
  'PREFERRED_HOLD',
  'REPLACEMENT_HURDLE',
  'LOT_SELECTION',
] as const)

export type RebalancingConstraintFamily =
  (typeof REBALANCING_CONSTRAINT_FAMILIES)[number]

export const REBALANCING_CONSTRAINT_IDS = Object.freeze([
  'EXPOSURE_CAP',
  'CASH_BUFFER',
  'NO_NEGATIVE_CASH',
  'NO_SHORTING',
  'NO_LEVERAGE',
  'SINGLE_NAME_CAP',
  'SECTOR_CAP',
  'GROUP_CAP',
  'SMALL_CAP_CAP',
  'LIQUIDITY_CAP',
  'TURNOVER_BUDGET',
  'AVAILABLE_DELIVERY',
  'MINIMUM_ORDER_VALUE',
  'PREFERRED_HOLD',
  'HOLD_RANK_BUFFER',
  'REPLACEMENT_HURDLE',
  'NEXT_ELIGIBLE_SESSION',
] as const)

export type RebalancingConstraintId =
  (typeof REBALANCING_CONSTRAINT_IDS)[number]

export const PLANNER_REASON_CODES = Object.freeze([
  'TARGET_SELECTED',
  'MANDATORY_EXIT',
  'NO_TRADE_REQUIRED',
  'INSIDE_DRIFT_BAND',
  'PREFERRED_HOLD_ACTIVE',
  'HOLD_RANK_BUFFER_ACTIVE',
  'REPLACEMENT_HURDLE_NOT_MET',
  'TURNOVER_BUDGET_EXCEEDED',
  'MISSING_CLASSIFICATION',
  'MISSING_COST_SCHEDULE',
  'MISSING_TAX_RULES',
  'MISSING_LOT_INSTRUCTION',
  'INTERIM_NOT_AUTHORIZED',
  'OPTIMIZER_TIMEOUT',
  'OPTIMIZER_INFEASIBLE',
  'OPTIMIZER_ERROR',
  'OPTIMIZER_VERIFICATION_REJECTED',
  'GREEDY_FALLBACK_USED',
] as const)

export type PlannerReasonCode = (typeof PLANNER_REASON_CODES)[number]

export const EXPLANATION_KEYS = Object.freeze([
  'TARGET_SELECTED',
  'MANDATORY_EXIT',
  'NO_TRADE_REQUIRED',
  'POLICY_SKIP',
  'PREREQUISITE_BLOCK',
  'OPTIMIZER_FALLBACK',
] as const)

export type ExplanationKey = (typeof EXPLANATION_KEYS)[number]

export const REBALANCING_URGENCIES = Object.freeze([
  'MANDATORY',
  'ROUTINE',
  'DRIFT',
] as const)

export type RebalancingUrgency = (typeof REBALANCING_URGENCIES)[number]

export const BLOCKING_PREREQUISITE_CODES = Object.freeze([
  'LINEAGE',
  'SESSION',
  'CLASSIFICATION',
  'LIQUIDITY',
  'COST_SCHEDULE',
  'TAX_RULES',
  'TURNOVER_SNAPSHOT',
  'LOT_INSTRUCTION',
  'INTERIM_PROOF',
] as const)

export type BlockingPrerequisiteCode =
  (typeof BLOCKING_PREREQUISITE_CODES)[number]

export const EXPLANATION_TEMPLATES: Readonly<Record<ExplanationKey, string>> =
  Object.freeze({
    TARGET_SELECTED: 'The action is included by the verified rebalance policy.',
    MANDATORY_EXIT: 'The action is required to reduce a verified portfolio risk.',
    NO_TRADE_REQUIRED: 'No action is needed under the verified target and policy.',
    POLICY_SKIP: 'The action is skipped by a verified portfolio policy.',
    PREREQUISITE_BLOCK: 'The action is blocked because a required verified input is unavailable.',
    OPTIMIZER_FALLBACK: 'The verified deterministic allocation is used instead of the optional optimizer.',
  })
