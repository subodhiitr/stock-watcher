import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  PortfolioId,
  RebalanceRunId,
  StrategyVersionId,
  DataVersionId,
  CostScheduleVersionId,
  TaxRuleVersionId,
  TurnoverSnapshotId,
} from './identifiers.ts'
import {
  EXPLANATION_TEMPLATES,
  PLANNER_REASON_CODES,
  REBALANCING_CONSTRAINT_IDS,
  type ExplanationKey,
  type PlannerReasonCode,
  type RebalancingConstraintId,
} from './rebalancing-reasons.ts'
import {
  U04_MAX_PHASE_DURATIONS,
  U04_MAX_SAFE_CONSTRAINT_IDS,
  U04_MAX_SAFE_REASON_CODES,
} from './rebalancing-constants.ts'

export type SafeReasonBundle = Readonly<{
  primaryCode: PlannerReasonCode
  secondaryCodes: readonly PlannerReasonCode[]
  explanationKey: ExplanationKey
  humanExplanation: string
  constraintIds: readonly RebalancingConstraintId[]
}>

export type PlanningPhase =
  | 'GATE'
  | 'IDEAL_TARGET'
  | 'EXECUTABLE_ALLOCATION'
  | 'COST_TAX'
  | 'CONSTRAINT_VERIFICATION'
  | 'OPTIMIZER'
  | 'ASSEMBLY'

export type PlanningPhaseDuration = Readonly<{
  phase: PlanningPhase
  durationMs: number
}>

export type SafePlanObservabilityPayload = Readonly<{
  portfolioId: PortfolioId
  rebalanceRunId: RebalanceRunId
  planInputHash: IntegrityHash
  planHash: IntegrityHash
  strategyVersionId: StrategyVersionId
  dataVersionId: DataVersionId
  costScheduleVersionId: CostScheduleVersionId
  taxRuleVersionId: TaxRuleVersionId
  turnoverSnapshotId: TurnoverSnapshotId
  phaseDurations: readonly PlanningPhaseDuration[]
  actionCounts: Readonly<{
    proposed: number
    skipped: number
    blocked: number
  }>
}>

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort())
}

export function buildSafeReasonBundle(input: Readonly<{
  primaryCode: PlannerReasonCode
  secondaryCodes?: readonly PlannerReasonCode[]
  explanationKey: ExplanationKey
  constraintIds?: readonly RebalancingConstraintId[]
}>): DomainResult<SafeReasonBundle> {
  const secondaryCodes = uniqueSorted(input.secondaryCodes ?? [])
  const constraintIds = uniqueSorted(input.constraintIds ?? [])
  if (
    !PLANNER_REASON_CODES.includes(input.primaryCode)
    || EXPLANATION_TEMPLATES[input.explanationKey] === undefined
    || secondaryCodes.length > U04_MAX_SAFE_REASON_CODES
    || constraintIds.length > U04_MAX_SAFE_CONSTRAINT_IDS
    || secondaryCodes.some((code) => !PLANNER_REASON_CODES.includes(code))
    || constraintIds.some((id) => !REBALANCING_CONSTRAINT_IDS.includes(id))
  ) {
    return failure(domainFailure('UNSAFE_PLAN_EXPLANATION', { field: 'reasonBundle' }))
  }
  return success(Object.freeze({
    primaryCode: input.primaryCode,
    secondaryCodes,
    explanationKey: input.explanationKey,
    humanExplanation: EXPLANATION_TEMPLATES[input.explanationKey],
    constraintIds,
  }))
}

export function buildSafePlanObservabilityPayload(
  input: SafePlanObservabilityPayload,
): DomainResult<SafePlanObservabilityPayload> {
  if (
    input.phaseDurations.length > U04_MAX_PHASE_DURATIONS
    || input.phaseDurations.some(({ durationMs }) =>
      !Number.isSafeInteger(durationMs) || durationMs < 0)
    || [input.actionCounts.proposed, input.actionCounts.skipped, input.actionCounts.blocked]
      .some((count) => !Number.isSafeInteger(count) || count < 0)
  ) {
    return failure(domainFailure('UNSAFE_PLAN_EXPLANATION', { field: 'observability' }))
  }
  return success(Object.freeze({
    ...input,
    phaseDurations: Object.freeze(input.phaseDurations.map((value) => Object.freeze({ ...value }))),
    actionCounts: Object.freeze({ ...input.actionCounts }),
  }))
}
