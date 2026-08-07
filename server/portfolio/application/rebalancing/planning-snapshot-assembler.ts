import { validatePlanningContext } from '../../domain/construction/planning-gate.ts'
import type {
  ConstructionConstraintSet,
  InterimAuthorization,
  NormalizedPlanningContext,
  PlanningIntent,
} from '../../domain/construction/planning-context.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import {
  U04_MAX_CANDIDATES,
  U04_MAX_HOLDINGS,
  U04_MAX_OPEN_LOTS,
  U04_RATE_SCALE,
  U04_WEIGHT_SCALE,
} from '../../domain/shared/rebalancing-constants.ts'
import { createScaledRate } from '../../domain/shared/scaled-rate.ts'
import type {
  PortfolioId,
  RebalanceRunId,
} from '../../domain/shared/identifiers.ts'
import type { Instant, LocalDate } from '../../domain/shared/time.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import type { CostSchedule } from '../../domain/rebalancing/cost-estimator.ts'
import type { TaxRuleSet } from '../../domain/rebalancing/tax-lot-selection.ts'
import type {
  PlanHistoryFact,
  PlanHistoryPort,
} from '../../ports/rebalancing/plan-history-port.ts'
import type {
  PlanningSnapshotPort,
} from '../../ports/rebalancing/planning-snapshot-port.ts'
import type {
  PolicyAndTurnoverPort,
} from '../../ports/rebalancing/policy-and-turnover-port.ts'

export type PlanningConstraintPolicyInput = Readonly<{
  maxSectorWeightPpm: bigint
  maxGroupWeightPpm: bigint
  maxSmallCapWeightPpm: bigint
  maxLiquidityParticipationPpm: bigint
  minimumOrderMinorUnits: bigint
  nextRoutineDecisionDate: LocalDate
  nextDriftReviewDate: LocalDate
}>

export type PlanningAssemblyRequest = Readonly<{
  portfolioId: PortfolioId
  rebalanceRunId: RebalanceRunId
  planningIntent: PlanningIntent
  asOf: LocalDate
  createdAt: Instant
  dependencyTimeoutMs: number
  constraintPolicy: PlanningConstraintPolicyInput
  interimAuthorization?: InterimAuthorization
}>

export type AssembledPlanningSnapshot = Readonly<{
  context: NormalizedPlanningContext
  costSchedule: CostSchedule
  taxRules: TaxRuleSet
  equivalentPriorPlan?: PlanHistoryFact
  currentApprovalReadyPlan?: PlanHistoryFact
}>

function percentageToPpm(value: number): bigint {
  return BigInt(Math.round(value * 10_000))
}

function requireValue<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new TypeError('Invalid assembled planning value')
  return result.value
}

function withDependencyDeadline<T>(
  operation: Promise<DomainResult<T>>,
  timeoutMs: number,
): Promise<DomainResult<T>> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(failure(domainFailure('PLANNING_PREREQUISITE_UNSAFE', {
        field: 'dependencyTimeoutMs',
      })))
    }, timeoutMs)
    operation.then(
      (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(failure(domainFailure('PLANNING_PREREQUISITE_UNSAFE', {
          field: 'dependency',
        })))
      },
    )
  })
}

export class PlanningSnapshotAssembler {
  readonly #snapshotPort: PlanningSnapshotPort
  readonly #policyPort: PolicyAndTurnoverPort
  readonly #historyPort: PlanHistoryPort

  constructor(input: Readonly<{
    snapshotPort: PlanningSnapshotPort
    policyPort: PolicyAndTurnoverPort
    historyPort: PlanHistoryPort
  }>) {
    this.#snapshotPort = input.snapshotPort
    this.#policyPort = input.policyPort
    this.#historyPort = input.historyPort
  }

  async assemble(
    request: PlanningAssemblyRequest,
  ): Promise<DomainResult<AssembledPlanningSnapshot>> {
    if (!Number.isSafeInteger(request.dependencyTimeoutMs) || request.dependencyTimeoutMs <= 0) {
      return failure(domainFailure('PLANNING_PREREQUISITE_UNSAFE', {
        field: 'dependencyTimeoutMs',
      }))
    }
    const [snapshotResult, policyResult] = await Promise.all([
      withDependencyDeadline(this.#snapshotPort.loadPlanningSnapshot({
        portfolioId: request.portfolioId,
        rebalanceRunId: request.rebalanceRunId,
        asOf: request.asOf,
        timeoutMs: request.dependencyTimeoutMs,
      }), request.dependencyTimeoutMs),
      withDependencyDeadline(this.#policyPort.resolveForDate({
        portfolioId: request.portfolioId,
        asOf: request.asOf,
        timeoutMs: request.dependencyTimeoutMs,
      }), request.dependencyTimeoutMs),
    ])
    if (!snapshotResult.ok) return snapshotResult
    if (!policyResult.ok) return policyResult
    const snapshot = snapshotResult.value
    const policy = policyResult.value
    if (
      snapshot.portfolio.portfolioId !== request.portfolioId
      || policy.turnover.portfolioId !== request.portfolioId
    ) {
      return failure(domainFailure('PORTFOLIO_SCOPE_MISMATCH', { field: 'snapshot' }))
    }
    if (
      snapshot.portfolio.holdings.length > U04_MAX_HOLDINGS
      || snapshot.portfolio.holdings.reduce(
        (total, holding) => total + holding.lots.length,
        0,
      ) > U04_MAX_OPEN_LOTS
      || snapshot.evaluations.length > U04_MAX_CANDIDATES
    ) {
      return failure(domainFailure('CAPACITY_EXCEEDED', { field: 'snapshot' }))
    }
    const config = snapshot.strategyConfig
    if (
      config.rebalance.routineFrequency === 'DAILY'
      || config.rebalance.driftReviewFrequency === 'DAILY'
    ) {
      return failure(domainFailure('UNKNOWN_VALUE_REJECTED', { field: 'cadence' }))
    }
    const turnoverWindows = policy.turnover.windows.map((window) => Object.freeze({
      windowKind: window.windowKind,
      budgetLimit: requireValue(createScaledRate(window.budgetLimitPpm, U04_RATE_SCALE)),
      consumedBeforePlan: requireValue(
        createScaledRate(window.consumedBeforePlanPpm, U04_RATE_SCALE),
      ),
    }))
    const remainingTurnoverPpm = turnoverWindows.reduce((minimum, window) => {
      const remaining = window.budgetLimit.numerator - window.consumedBeforePlan.numerator
      const bounded = remaining > 0n ? remaining : 0n
      return bounded < minimum ? bounded : minimum
    }, U04_RATE_SCALE)
    const constraints: ConstructionConstraintSet = Object.freeze({
      targetHoldings: config.construction.targetHoldings,
      maxHoldings: config.construction.maxHoldings,
      maxStockWeight: requireValue(
        createWeight(percentageToPpm(config.eligibility.maxStockWeightPct)),
      ),
      maxSectorWeight: requireValue(
        createWeight(request.constraintPolicy.maxSectorWeightPpm),
      ),
      maxGroupWeight: requireValue(
        createWeight(request.constraintPolicy.maxGroupWeightPpm),
      ),
      maxSmallCapWeight: requireValue(
        createWeight(request.constraintPolicy.maxSmallCapWeightPpm),
      ),
      maxLiquidityParticipation: requireValue(createScaledRate(
        request.constraintPolicy.maxLiquidityParticipationPpm,
        U04_RATE_SCALE,
      )),
      cashBufferFloor: requireValue(
        createWeight(percentageToPpm(config.construction.cashBufferPct)),
      ),
      regimeExposureCap: requireValue(
        createWeight(percentageToPpm(snapshot.regime.equityExposureMaxPct)),
      ),
      turnoverBudgetCeiling: requireValue(
        createScaledRate(remainingTurnoverPpm, U04_RATE_SCALE),
      ),
      minimumOrderValue: requireValue(
        createMoney(request.constraintPolicy.minimumOrderMinorUnits),
      ),
      replacementScoreGap: requireValue(createScaledRate(
        percentageToPpm(config.construction.replacementScoreGapPct),
        U04_RATE_SCALE,
      )),
      preferredMinimumHoldDays: config.rebalance.preferredMinHoldDays,
      absoluteDriftBand: requireValue(
        createWeight(percentageToPpm(config.eligibility.noTradeBandPctPoints)),
      ),
      relativeDriftBand: requireValue(createScaledRate(
        BigInt(Math.round(config.eligibility.noTradeBandFractionOfTarget * Number(U04_RATE_SCALE))),
        U04_RATE_SCALE,
      )),
    })
    const candidates = snapshot.evaluations.map((evaluation) => {
      const instrumentId = evaluation.signal.instrumentId
      const holding = snapshot.portfolio.holdings.find(
        (value) => value.instrumentId === instrumentId,
      )
      const actions = snapshot.corporateActions.filter(
        (action) => action.instrumentId === instrumentId,
      )
      return Object.freeze({
        instrumentId,
        eligibilityStatus: evaluation.eligibility.status,
        hardRiskFlag: evaluation.eligibility.hardRiskFlag,
        mandatoryEligibilityFailure:
          evaluation.eligibility.status === 'INELIGIBLE',
        corporateActionBlocked: actions.some((action) =>
          action.status === 'BLOCKED' || action.status === 'REQUIRES_MANUAL_REVIEW'),
        corporateActionVerified: actions.some((action) => action.status === 'PROCESSED'),
        rank: evaluation.signal.rank,
        compositeScorePpm: BigInt(Math.round(evaluation.signal.compositeScore * 1_000_000)),
        convictionMultiplier: requireValue(createScaledRate(
          BigInt(Math.round(evaluation.signal.convictionMultiplier * 1_000_000)),
          U04_RATE_SCALE,
        )),
        realizedVolatility: requireValue(createScaledRate(
          evaluation.realizedVolatilityPpm,
          U04_RATE_SCALE,
        )),
        ...(evaluation.sectorId === undefined ? {} : { sectorId: evaluation.sectorId }),
        ...(evaluation.groupId === undefined ? {} : { groupId: evaluation.groupId }),
        ...(evaluation.marketCapBucket === undefined
          ? {} : { marketCapBucket: evaluation.marketCapBucket }),
        price: requireValue(createMoney(evaluation.priceMinorUnits)),
        liquidityCapacity: requireValue(createMoney(evaluation.liquidityCapacityMinorUnits)),
        ...(holding === undefined ? {} : { currentHolding: holding }),
        availableDeliveryQuantity: holding?.availableDeliveryQuantity
          ?? requireValue(createQuantity(0n)),
        ...(holding?.lots[0]?.acquiredOn === undefined
          ? {} : { acquiredOn: holding.lots[0].acquiredOn }),
      })
    })
    const candidateInstrumentIds = new Set(candidates.map((value) => value.instrumentId))
    for (const holding of snapshot.portfolio.holdings) {
      if (!candidateInstrumentIds.has(holding.instrumentId)) {
        return failure(domainFailure('CANDIDATE_LINEAGE_MISSING', { field: 'evaluations' }))
      }
    }
    const contextInput: NormalizedPlanningContext = {
      portfolioId: request.portfolioId,
      rebalanceRunId: request.rebalanceRunId,
      planningIntent: request.planningIntent,
      asOf: request.asOf,
      createdAt: request.createdAt,
      portfolioStatus: snapshot.portfolio.status,
      portfolioMode: snapshot.portfolio.mode,
      portfolioSnapshotVersion: snapshot.portfolio.stateVersion,
      cash: snapshot.portfolio.cash,
      holdings: Object.freeze([...snapshot.portfolio.holdings]),
      candidates: Object.freeze(candidates),
      strategyVersionId: snapshot.strategyVersionId,
      strategyConfigHash: snapshot.strategyConfigHash,
      dataVersionId: snapshot.dataVersionId,
      evaluationAsOf: snapshot.evaluationAsOf,
      regimeCategory: snapshot.regime.category,
      reconciliationSnapshotId: snapshot.reconciliationSnapshotId,
      costScheduleVersionId: policy.costSchedule.scheduleVersionId,
      taxRuleVersionId: policy.taxRuleSet.taxRuleVersionId,
      turnoverSnapshotId: policy.turnover.turnoverSnapshotId,
      turnoverWindows: Object.freeze(turnoverWindows),
      constraints,
      cadence: Object.freeze({
        strategyHorizon: config.horizon,
        routineFrequency: config.rebalance.routineFrequency,
        driftReviewFrequency: config.rebalance.driftReviewFrequency,
        nextRoutineDecisionDate: request.constraintPolicy.nextRoutineDecisionDate,
        nextDriftReviewDate: request.constraintPolicy.nextDriftReviewDate,
        preferredMinimumHoldDays: config.rebalance.preferredMinHoldDays,
      }),
      timing: Object.freeze({
        calendarSessionId: snapshot.session.calendarSessionId,
        decisionSessionDate: snapshot.session.sessionDate,
        decisionReadyAt: snapshot.session.decisionReadyAt,
        eligibleExecutionDate: snapshot.session.eligibleExecutionDate,
        eligibleExecutionWindowStart: snapshot.session.eligibleExecutionWindowStart,
        eligibleExecutionWindowEnd: snapshot.session.eligibleExecutionWindowEnd,
        timeZone: snapshot.session.timeZone,
        finalized: snapshot.session.finalized,
        sameSessionExecutionAllowed: snapshot.session.sameSessionExecutionAllowed,
      }),
      ...(request.interimAuthorization === undefined
        ? {} : { interimAuthorization: request.interimAuthorization }),
    }
    const gated = validatePlanningContext(Object.freeze(contextInput))
    if (!gated.ok) return gated
    const [equivalentResult, currentResult] = await Promise.all([
      withDependencyDeadline(this.#historyPort.findByInputHash({
        portfolioId: request.portfolioId,
        planInputHash: gated.value.planInputHash as NonNullable<typeof gated.value.planInputHash>,
        timeoutMs: request.dependencyTimeoutMs,
      }), request.dependencyTimeoutMs),
      withDependencyDeadline(this.#historyPort.findCurrentApprovalReady({
        portfolioId: request.portfolioId,
        timeoutMs: request.dependencyTimeoutMs,
      }), request.dependencyTimeoutMs),
    ])
    if (!equivalentResult.ok) return equivalentResult
    if (!currentResult.ok) return currentResult
    const costSchedule: CostSchedule = Object.freeze({
      scheduleVersionId: policy.costSchedule.scheduleVersionId,
      effectiveFrom: policy.costSchedule.effectiveFrom,
      chargeRules: Object.freeze(policy.costSchedule.chargeRules.map((rule) =>
        Object.freeze({ ...rule }))),
      spreadRatePpm: policy.costSchedule.spreadRatePpm,
      slippageRatePpm: policy.costSchedule.slippageRatePpm,
      impactRatePpm: policy.costSchedule.impactRatePpm,
    })
    const taxRules: TaxRuleSet = Object.freeze({
      taxRuleVersionId: policy.taxRuleSet.taxRuleVersionId,
      effectiveFrom: policy.taxRuleSet.effectiveFrom,
      holdingPeriodThresholdDays: policy.taxRuleSet.holdingPeriodThresholdDays,
      shortTermRatePpm: policy.taxRuleSet.shortTermRatePpm,
      longTermRatePpm: policy.taxRuleSet.longTermRatePpm,
      lotSelectionPolicy: policy.taxRuleSet.lotSelectionPolicy,
    })
    return success(Object.freeze({
      context: gated.value,
      costSchedule,
      taxRules,
      ...(equivalentResult.value === undefined
        ? {} : { equivalentPriorPlan: equivalentResult.value }),
      ...(currentResult.value === undefined
        ? {} : { currentApprovalReadyPlan: currentResult.value }),
    }))
  }
}
