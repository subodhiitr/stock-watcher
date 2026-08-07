import type { IdealTarget } from '../construction/ideal-target-constructor.ts'
import type { ImplementationShortfall } from '../construction/implementation-shortfall.ts'
import type {
  NormalizedPlanningContext,
  PlanningTiming,
} from '../construction/planning-context.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  PortfolioId,
  RebalanceRunId,
} from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { U04_WEIGHT_SCALE } from '../shared/rebalancing-constants.ts'
import {
  buildSafePlanObservabilityPayload,
  type PlanningPhaseDuration,
  type SafePlanObservabilityPayload,
} from '../shared/safe-observability-payload-builder.ts'
import type { Instant, LocalDate } from '../shared/time.ts'
import { createWeight, type Weight } from '../shared/weight.ts'
import type { ActionBuckets } from './action-buckets.ts'
import type {
  TurnoverBudgetEvaluation,
} from './cadence-and-turnover-policy.ts'
import type { ExecutableTarget } from './whole-share-greedy-allocator.ts'
import { createSemanticPlanHash } from './plan-equivalence.ts'

export type PlanLifecycleState =
  | 'DRAFT'
  | 'APPROVAL_READY'
  | 'SUPERSEDED'
  | 'INVALIDATED'
  | 'EXPIRED'

export type ConcentrationSnapshot = Readonly<{
  id: string
  weight: Weight
  limit: Weight
}>

export type PlanWarning = Readonly<{
  warningCode: 'BLOCKED_ACTIONS_PRESENT' | 'OPTIMIZER_FALLBACK_USED'
  severity: 'INFO' | 'WARN' | 'MANDATORY_REVIEW'
  message: string
}>

export type ApprovalReadySummary = Readonly<{
  currentCash: Money
  projectedCash: Money
  currentExposure: Weight
  projectedExposure: Weight
  currentSectorWeights: readonly ConcentrationSnapshot[]
  projectedSectorWeights: readonly ConcentrationSnapshot[]
  currentGroupWeights: readonly ConcentrationSnapshot[]
  projectedGroupWeights: readonly ConcentrationSnapshot[]
  totalEstimatedCosts: Money
  totalEstimatedTaxes: Money
  warnings: readonly PlanWarning[]
}>

export type RebalancePlan = Readonly<{
  rebalanceRunId: RebalanceRunId
  portfolioId: PortfolioId
  state: PlanLifecycleState
  planningIntent: NormalizedPlanningContext['planningIntent']
  asOf: LocalDate
  createdAt: Instant
  planInputHash: IntegrityHash
  planHash: IntegrityHash
  context: NormalizedPlanningContext
  idealTarget: IdealTarget
  executableTarget: ExecutableTarget
  implementationShortfall: ImplementationShortfall
  actionBuckets: ActionBuckets
  turnoverBudget: TurnoverBudgetEvaluation
  timing: PlanningTiming
  warnings: readonly PlanWarning[]
  summary: ApprovalReadySummary
  observability: SafePlanObservabilityPayload
}>

function aggregateConcentrations(input: Readonly<{
  ids: ReadonlyMap<string, string | undefined>
  weights: ReadonlyMap<string, bigint>
  limit: Weight
}>): readonly ConcentrationSnapshot[] {
  const totals = new Map<string, bigint>()
  for (const [instrumentId, weight] of input.weights) {
    const id = input.ids.get(instrumentId)
    if (id !== undefined) totals.set(id, (totals.get(id) ?? 0n) + weight)
  }
  return Object.freeze([...totals.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([id, partsPerMillion]) => {
      const weight = createWeight(partsPerMillion)
      if (!weight.ok) throw new TypeError('Invalid concentration')
      return Object.freeze({ id, weight: weight.value, limit: input.limit })
    }))
}

export function assembleRebalancePlan(input: Readonly<{
  context: NormalizedPlanningContext
  idealTarget: IdealTarget
  executableTarget: ExecutableTarget
  implementationShortfall: ImplementationShortfall
  actionBuckets: ActionBuckets
  turnoverBudget: TurnoverBudgetEvaluation
  totalEstimatedCosts: Money
  totalEstimatedTaxes: Money
  phaseDurations: readonly PlanningPhaseDuration[]
  optimizerFallbackUsed: boolean
}>): DomainResult<RebalancePlan> {
  if (
    input.context.planInputHash === undefined
    || input.executableTarget.constraintChecks.some((check) => !check.passed)
  ) {
    return failure(domainFailure('APPROVAL_READY_PREMATURE', { field: 'plan' }))
  }
  const candidateById = new Map(
    input.context.candidates.map((candidate) => [candidate.instrumentId, candidate] as const),
  )
  const currentWeights = new Map<string, bigint>()
  for (const candidate of input.context.candidates) {
    const currentValue = (candidate.currentHolding?.totalQuantity.shares ?? 0n)
      * candidate.price.minorUnits
    currentWeights.set(
      candidate.instrumentId,
      input.context.cash.minorUnits < 0n || input.context.holdings.length === 0
        ? 0n
        : currentValue,
    )
  }
  const currentEquityValue = [...currentWeights.values()].reduce(
    (total, value) => total + value,
    0n,
  )
  const startingNavMinorUnits = currentEquityValue + input.context.cash.minorUnits
  const currentWeightPpm = new Map(
    [...currentWeights.entries()].map(([id, value]) => [
      id,
      startingNavMinorUnits <= 0n ? 0n : value * U04_WEIGHT_SCALE / startingNavMinorUnits,
    ] as const),
  )
  const projectedWeightPpm = new Map(
    input.executableTarget.positions.map((position) =>
      [position.instrumentId, position.targetWeight.partsPerMillion] as const),
  )
  const sectorIds = new Map(
    input.context.candidates.map((candidate) =>
      [candidate.instrumentId, candidate.sectorId] as const),
  )
  const groupIds = new Map(
    input.context.candidates.map((candidate) =>
      [candidate.instrumentId, candidate.groupId] as const),
  )
  const currentExposure = createWeight(
    [...currentWeightPpm.values()].reduce((total, value) => total + value, 0n),
  )
  const totalCosts = createMoney(input.totalEstimatedCosts.minorUnits)
  const totalTaxes = createMoney(input.totalEstimatedTaxes.minorUnits)
  if (!currentExposure.ok || !totalCosts.ok || !totalTaxes.ok) {
    return failure(domainFailure('PLAN_SUMMARY_RECONCILIATION_FAILURE', { field: 'summary' }))
  }
  const warnings: PlanWarning[] = []
  if (input.actionBuckets.blocked.length > 0) {
    warnings.push(Object.freeze({
      warningCode: 'BLOCKED_ACTIONS_PRESENT',
      severity: 'MANDATORY_REVIEW',
      message: 'Blocked actions require review before downstream approval.',
    }))
  }
  if (input.optimizerFallbackUsed) {
    warnings.push(Object.freeze({
      warningCode: 'OPTIMIZER_FALLBACK_USED',
      severity: 'INFO',
      message: 'The verified deterministic allocation replaced the optional optimizer result.',
    }))
  }
  const summary: ApprovalReadySummary = Object.freeze({
    currentCash: input.context.cash,
    projectedCash: input.executableTarget.residualCash,
    currentExposure: currentExposure.value,
    projectedExposure: input.executableTarget.totalEquityWeight,
    currentSectorWeights: aggregateConcentrations({
      ids: sectorIds,
      weights: currentWeightPpm,
      limit: input.context.constraints.maxSectorWeight,
    }),
    projectedSectorWeights: aggregateConcentrations({
      ids: sectorIds,
      weights: projectedWeightPpm,
      limit: input.context.constraints.maxSectorWeight,
    }),
    currentGroupWeights: aggregateConcentrations({
      ids: groupIds,
      weights: currentWeightPpm,
      limit: input.context.constraints.maxGroupWeight,
    }),
    projectedGroupWeights: aggregateConcentrations({
      ids: groupIds,
      weights: projectedWeightPpm,
      limit: input.context.constraints.maxGroupWeight,
    }),
    totalEstimatedCosts: totalCosts.value,
    totalEstimatedTaxes: totalTaxes.value,
    warnings: Object.freeze(warnings),
  })
  const core = {
    rebalanceRunId: input.context.rebalanceRunId,
    portfolioId: input.context.portfolioId,
    state: 'APPROVAL_READY' as const,
    planningIntent: input.context.planningIntent,
    asOf: input.context.asOf,
    createdAt: input.context.createdAt,
    planInputHash: input.context.planInputHash,
    context: input.context,
    idealTarget: input.idealTarget,
    executableTarget: input.executableTarget,
    implementationShortfall: input.implementationShortfall,
    actionBuckets: input.actionBuckets,
    turnoverBudget: input.turnoverBudget,
    timing: input.context.timing,
    warnings: Object.freeze(warnings),
    summary,
  }
  const planHash = createSemanticPlanHash({
    portfolioId: core.portfolioId,
    planInputHash: core.planInputHash,
    idealTarget: core.idealTarget,
    executableTarget: core.executableTarget,
    actionBuckets: core.actionBuckets,
    implementationShortfall: core.implementationShortfall,
    turnoverBudget: core.turnoverBudget,
    timing: core.timing,
    summary: core.summary,
  })
  const observability = buildSafePlanObservabilityPayload({
    portfolioId: input.context.portfolioId,
    rebalanceRunId: input.context.rebalanceRunId,
    planInputHash: input.context.planInputHash,
    planHash,
    strategyVersionId: input.context.strategyVersionId,
    dataVersionId: input.context.dataVersionId,
    costScheduleVersionId: input.context.costScheduleVersionId,
    taxRuleVersionId: input.context.taxRuleVersionId,
    turnoverSnapshotId: input.context.turnoverSnapshotId,
    phaseDurations: input.phaseDurations,
    actionCounts: {
      proposed: input.actionBuckets.proposed.length,
      skipped: input.actionBuckets.skipped.length,
      blocked: input.actionBuckets.blocked.length,
    },
  })
  if (!observability.ok) return observability
  return success(Object.freeze({
    ...core,
    planHash,
    observability: observability.value,
  }))
}
