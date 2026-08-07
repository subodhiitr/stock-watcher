import { projectCandidates } from '../../domain/construction/candidate-projection.ts'
import {
  constructIdealTarget,
  type IdealTarget,
} from '../../domain/construction/ideal-target-constructor.ts'
import { calculateImplementationShortfall } from '../../domain/construction/implementation-shortfall.ts'
import type {
  ActionIntentMarker,
  NormalizedPlanningContext,
  PlanningCandidate,
} from '../../domain/construction/planning-context.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { InstrumentId } from '../../domain/shared/identifiers.ts'
import { createMoney, type Money } from '../../domain/shared/money.ts'
import { createQuantity, type Quantity } from '../../domain/shared/quantity.ts'
import {
  U04_RATE_SCALE,
  U04_WEIGHT_SCALE,
} from '../../domain/shared/rebalancing-constants.ts'
import {
  buildSafeReasonBundle,
  type PlanningPhaseDuration,
} from '../../domain/shared/safe-observability-payload-builder.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import {
  buildActionBuckets,
  type BlockedActionInput,
  type SkippedActionInput,
} from '../../domain/rebalancing/action-buckets.ts'
import {
  calculateTurnoverConsumption,
  evaluateDiscretionaryHolding,
  evaluateTurnoverWindows,
  isCadenceOpen,
} from '../../domain/rebalancing/cadence-and-turnover-policy.ts'
import { estimateOrderCost, type CostEstimate } from '../../domain/rebalancing/cost-estimator.ts'
import { authorizeInterimPlanning } from '../../domain/rebalancing/interim-authorization.ts'
import { assembleRebalancePlan, type RebalancePlan } from '../../domain/rebalancing/rebalance-plan.ts'
import { selectTaxLots, type TaxEstimate } from '../../domain/rebalancing/tax-lot-selection.ts'
import {
  allocateWholeSharesGreedy,
  type ExecutableTarget,
  type ExecutableTargetPosition,
} from '../../domain/rebalancing/whole-share-greedy-allocator.ts'
import type { OptimizerMode } from '../../ports/rebalancing/optimizer-port.ts'
import {
  PlanningSnapshotAssembler,
  type PlanningAssemblyRequest,
} from './planning-snapshot-assembler.ts'
import { OptimizerOrchestrationService } from './optimizer-orchestration-service.ts'

export type RebalancePlanningRequest = Readonly<{
  assembly: PlanningAssemblyRequest
  optimizerMode?: OptimizerMode
  optimizerTimeoutMs?: number
  phaseDurations: readonly PlanningPhaseDuration[]
}>

function absoluteMoney(value: Money): Money {
  const result = createMoney(value.minorUnits < 0n ? -value.minorUnits : value.minorUnits)
  if (!result.ok) throw new TypeError('Invalid absolute money')
  return result.value
}

type DiscretionaryPolicyResult = Readonly<{
  fixedTargetQuantityByInstrument: ReadonlyMap<InstrumentId, Quantity>
  skipped: readonly SkippedActionInput[]
}>

function daysHeld(acquiredOn: string | undefined, asOf: string): number {
  if (acquiredOn === undefined) return 0
  const acquiredAt = Date.parse(`${acquiredOn}T00:00:00.000Z`)
  const evaluatedAt = Date.parse(`${asOf}T00:00:00.000Z`)
  if (!Number.isFinite(acquiredAt) || !Number.isFinite(evaluatedAt)) return 0
  return Math.max(0, Math.floor((evaluatedAt - acquiredAt) / 86_400_000))
}

function currentValueMinorUnits(candidate: PlanningCandidate): bigint {
  return (candidate.currentHolding?.totalQuantity.shares ?? 0n)
    * candidate.price.minorUnits
}

function requiresHardConstraintReduction(input: Readonly<{
  context: NormalizedPlanningContext
  candidate: PlanningCandidate
  position: ExecutableTargetPosition
  startingNav: Money
}>): boolean {
  if (input.position.deltaQuantityShares >= 0n || input.startingNav.minorUnits <= 0n) {
    return false
  }
  const weightPpm = (value: bigint) =>
    value * U04_WEIGHT_SCALE / input.startingNav.minorUnits
  const candidateWeight = weightPpm(currentValueMinorUnits(input.candidate))
  const totalEquityWeight = weightPpm(input.context.candidates.reduce(
    (total, candidate) => total + currentValueMinorUnits(candidate),
    0n,
  ))
  const cashWeight = weightPpm(input.context.cash.minorUnits)
  if (
    candidateWeight > input.context.constraints.maxStockWeight.partsPerMillion
    || totalEquityWeight > input.context.constraints.regimeExposureCap.partsPerMillion
    || cashWeight < input.context.constraints.cashBufferFloor.partsPerMillion
  ) return true
  const sameClassificationWeight = (
    field: 'sectorId' | 'groupId',
    classification: string | undefined,
  ) => classification === undefined ? 0n : weightPpm(input.context.candidates.reduce(
    (total, candidate) =>
      candidate[field] === classification ? total + currentValueMinorUnits(candidate) : total,
    0n,
  ))
  if (
    sameClassificationWeight('sectorId', input.candidate.sectorId)
      > input.context.constraints.maxSectorWeight.partsPerMillion
    || sameClassificationWeight('groupId', input.candidate.groupId)
      > input.context.constraints.maxGroupWeight.partsPerMillion
  ) return true
  const smallCapWeight = weightPpm(input.context.candidates.reduce(
    (total, candidate) => candidate.marketCapBucket === 'SMALL_CAP'
      ? total + currentValueMinorUnits(candidate)
      : total,
    0n,
  ))
  return input.candidate.marketCapBucket === 'SMALL_CAP'
    && smallCapWeight > input.context.constraints.maxSmallCapWeight.partsPerMillion
}

function evaluateDiscretionaryPolicies(input: Readonly<{
  context: NormalizedPlanningContext
  idealTarget: IdealTarget
  initialTarget: ExecutableTarget
  preliminaryDragByInstrument: ReadonlyMap<InstrumentId, bigint>
  startingNav: Money
}>): DomainResult<DiscretionaryPolicyResult> {
  const idealById = new Map(
    input.idealTarget.positions.map((position) => [position.instrumentId, position] as const),
  )
  const candidateById = new Map(
    input.context.candidates.map((candidate) => [candidate.instrumentId, candidate] as const),
  )
  const selectedEntrants = input.idealTarget.positions
    .map((position) => candidateById.get(position.instrumentId))
    .filter((candidate): candidate is PlanningCandidate =>
      candidate !== undefined && candidate.currentHolding === undefined)
    .sort((left, right) =>
      right.compositeScorePpm > left.compositeScorePpm ? 1
        : right.compositeScorePpm < left.compositeScorePpm ? -1
          : left.rank - right.rank
            || (left.instrumentId < right.instrumentId ? -1 : 1))
  const displacedIncumbents = input.initialTarget.positions
    .map((position) => Object.freeze({
      position,
      candidate: candidateById.get(position.instrumentId),
    }))
    .filter((entry): entry is Readonly<{
      position: ExecutableTargetPosition
      candidate: PlanningCandidate
    }> => entry.candidate?.currentHolding !== undefined
      && entry.position.deltaQuantityShares < 0n
      && !idealById.has(entry.position.instrumentId))
    .sort((left, right) =>
      right.candidate.rank - left.candidate.rank
        || (left.candidate.instrumentId < right.candidate.instrumentId ? -1 : 1))
  const replacementByIncumbent = new Map<InstrumentId, PlanningCandidate>()
  for (let index = 0; index < displacedIncumbents.length; index += 1) {
    const incumbent = displacedIncumbents[index]
    const entrant = selectedEntrants[index]
    if (incumbent !== undefined && entrant !== undefined) {
      replacementByIncumbent.set(incumbent.candidate.instrumentId, entrant)
    }
  }

  const fixedTargetQuantityByInstrument = new Map<InstrumentId, Quantity>()
  const skipped: SkippedActionInput[] = []
  const zeroQuantity = createQuantity(0n)
  if (!zeroQuantity.ok) {
    return failure(domainFailure('EXECUTABLE_RECONCILIATION_FAILURE', { field: 'quantity' }))
  }
  const requiredGapPpm = input.context.constraints.replacementScoreGap.numerator
    * U04_RATE_SCALE / input.context.constraints.replacementScoreGap.scale

  for (const position of input.initialTarget.positions) {
    const candidate = candidateById.get(position.instrumentId)
    if (candidate?.currentHolding === undefined) continue
    const currentWeight = createWeight(
      input.startingNav.minorUnits === 0n
        ? 0n
        : currentValueMinorUnits(candidate) * U04_WEIGHT_SCALE
          / input.startingNav.minorUnits,
    )
    const zeroWeight = createWeight(0n)
    if (!currentWeight.ok || !zeroWeight.ok) {
      return failure(domainFailure('IDEAL_TARGET_ARITHMETIC_FAILURE', {
        field: 'currentWeight',
      }))
    }
    const idealPosition = idealById.get(candidate.instrumentId)
    const replacement = replacementByIncumbent.get(candidate.instrumentId)
    const dragMinorUnits = (input.preliminaryDragByInstrument.get(candidate.instrumentId) ?? 0n)
      + (replacement === undefined
        ? 0n
        : input.preliminaryDragByInstrument.get(replacement.instrumentId) ?? 0n)
    const dragPpm = input.startingNav.minorUnits === 0n
      ? 0n
      : dragMinorUnits * U04_RATE_SCALE / input.startingNav.minorUnits
    const afterDragScoreGapPpm = replacement === undefined
      ? undefined
      : replacement.compositeScorePpm - candidate.compositeScorePpm - dragPpm
    const holdRankBufferActive = candidate.eligibilityStatus === 'HOLD_ELIGIBLE'
      && idealPosition === undefined
      && (afterDragScoreGapPpm === undefined || afterDragScoreGapPpm <= requiredGapPpm)
    const mandatory = input.context.planningIntent === 'INTERIM_EXCEPTION'
      || candidate.hardRiskFlag
      || candidate.mandatoryEligibilityFailure
      || candidate.corporateActionBlocked
      || requiresHardConstraintReduction({
        context: input.context,
        candidate,
        position,
        startingNav: input.startingNav,
      })
    const evaluation = evaluateDiscretionaryHolding({
      currentWeight: currentWeight.value,
      targetWeight: idealPosition?.targetWeight ?? zeroWeight.value,
      absoluteDriftBand: input.context.constraints.absoluteDriftBand,
      relativeDriftBand: input.context.constraints.relativeDriftBand,
      daysHeld: daysHeld(candidate.acquiredOn, input.context.asOf),
      preferredMinimumHoldDays: input.context.constraints.preferredMinimumHoldDays,
      mandatory,
      holdRankBufferActive,
      ...(afterDragScoreGapPpm === undefined
        ? {}
        : {
            replacementScoreGapPpm: afterDragScoreGapPpm,
            requiredReplacementGapPpm: requiredGapPpm,
          }),
    })
    if (!evaluation.ok) return evaluation
    if (evaluation.value.allowed || evaluation.value.reasonBundle === undefined) continue

    fixedTargetQuantityByInstrument.set(
      candidate.instrumentId,
      candidate.currentHolding.totalQuantity,
    )
    skipped.push(Object.freeze({
      instrumentId: candidate.instrumentId,
      candidateSide: position.deltaQuantityShares > 0n ? 'BUY'
        : position.targetQuantity.shares === 0n ? 'SELL' : 'REDUCE',
      reasonBundle: evaluation.value.reasonBundle,
      ...(idealPosition === undefined ? {} : { foregoneTargetWeight: idealPosition.targetWeight }),
    }))
    if (replacement !== undefined && idealPosition === undefined) {
      fixedTargetQuantityByInstrument.set(replacement.instrumentId, zeroQuantity.value)
      const replacementTarget = idealById.get(replacement.instrumentId)
      skipped.push(Object.freeze({
        instrumentId: replacement.instrumentId,
        candidateSide: 'BUY',
        reasonBundle: evaluation.value.reasonBundle,
        ...(replacementTarget === undefined
          ? {} : { foregoneTargetWeight: replacementTarget.targetWeight }),
      }))
    }
  }
  return success(Object.freeze({
    fixedTargetQuantityByInstrument,
    skipped: Object.freeze(skipped),
  }))
}

export class RebalancePlanningService {
  readonly #assembler: PlanningSnapshotAssembler
  readonly #optimizer?: OptimizerOrchestrationService

  constructor(input: Readonly<{
    assembler: PlanningSnapshotAssembler
    optimizer?: OptimizerOrchestrationService
  }>) {
    this.#assembler = input.assembler
    if (input.optimizer !== undefined) this.#optimizer = input.optimizer
  }

  async plan(
    request: RebalancePlanningRequest,
  ): Promise<DomainResult<RebalancePlan>> {
    const assembled = await this.#assembler.assemble(request.assembly)
    if (!assembled.ok) return assembled
    const { context } = assembled.value
    if (context.planningIntent === 'ROUTINE') {
      const cadence = isCadenceOpen({
        asOf: context.asOf,
        reviewKind: 'CONSTITUENT',
        cadence: context.cadence,
        decisionSessionDate: context.timing.decisionSessionDate,
        eligibleExecutionDate: context.timing.eligibleExecutionDate,
      })
      if (!cadence.ok) return cadence
      if (!cadence.value) {
        return failure(domainFailure('ROUTINE_CADENCE_NOT_OPEN', { field: 'asOf' }))
      }
    }
    const projection = projectCandidates(context.candidates)
    if (!projection.ok) return projection
    const startingNav = createMoney(
      context.cash.minorUnits + context.candidates.reduce(
        (total, candidate) => total
          + (candidate.currentHolding?.totalQuantity.shares ?? 0n)
            * candidate.price.minorUnits,
        0n,
      ),
    )
    if (!startingNav.ok || startingNav.value.minorUnits < 0n) {
      return failure(domainFailure('IDEAL_TARGET_ARITHMETIC_FAILURE', { field: 'startingNav' }))
    }
    const idealTarget = constructIdealTarget({
      projection: projection.value,
      startingNav: startingNav.value,
      constraints: context.constraints,
    })
    if (!idealTarget.ok) return idealTarget
    const initialGreedyTarget = allocateWholeSharesGreedy({
      idealTarget: idealTarget.value,
      candidates: context.candidates,
      startingNav: startingNav.value,
      constraints: context.constraints,
      timing: context.timing,
    })
    if (!initialGreedyTarget.ok) return initialGreedyTarget

    const preliminaryDragByInstrument = new Map<InstrumentId, bigint>()
    for (const position of initialGreedyTarget.value.positions) {
      if (position.deltaQuantityShares === 0n) continue
      const candidate = context.candidates.find((item) =>
        item.instrumentId === position.instrumentId)
      if (candidate === undefined) {
        return failure(domainFailure('CANDIDATE_LINEAGE_MISSING', { field: 'instrumentId' }))
      }
      const side = position.deltaQuantityShares > 0n ? 'BUY' as const : 'SELL' as const
      const cost = estimateOrderCost({
        schedule: assembled.value.costSchedule,
        asOf: context.asOf,
        side,
        grossNotional: absoluteMoney(position.deltaValue),
      })
      if (!cost.ok) return cost
      let dragMinorUnits = cost.value.totalCost.minorUnits
      if (side === 'SELL') {
        const tax = selectTaxLots({
          lots: candidate.currentHolding?.lots ?? [],
          sellQuantity: Object.freeze({ shares: -position.deltaQuantityShares }),
          salePrice: candidate.price,
          asOf: context.asOf,
          taxRules: assembled.value.taxRules,
          mandatoryHardRiskExit: candidate.hardRiskFlag
            || candidate.mandatoryEligibilityFailure,
        })
        if (!tax.ok) return tax
        dragMinorUnits += tax.value.estimatedTax.minorUnits
      }
      preliminaryDragByInstrument.set(position.instrumentId, dragMinorUnits)
    }
    const policy = context.planningIntent === 'ROUTINE'
      ? evaluateDiscretionaryPolicies({
          context,
          idealTarget: idealTarget.value,
          initialTarget: initialGreedyTarget.value,
          preliminaryDragByInstrument,
          startingNav: startingNav.value,
        })
      : success(Object.freeze({
          fixedTargetQuantityByInstrument: new Map<InstrumentId, Quantity>(),
          skipped: Object.freeze([]) as readonly SkippedActionInput[],
        }))
    if (!policy.ok) return policy
    let greedyTarget = initialGreedyTarget.value
    if (policy.value.fixedTargetQuantityByInstrument.size > 0) {
      const constrainedTarget = allocateWholeSharesGreedy({
        idealTarget: idealTarget.value,
        candidates: context.candidates,
        startingNav: startingNav.value,
        constraints: context.constraints,
        timing: context.timing,
        fixedTargetQuantityByInstrument: policy.value.fixedTargetQuantityByInstrument,
      })
      if (!constrainedTarget.ok) return constrainedTarget
      greedyTarget = constrainedTarget.value
    }

    const actionIntents: ActionIntentMarker[] = greedyTarget.positions.map((position) => {
      const candidate = context.candidates.find((item) =>
        item.instrumentId === position.instrumentId)
      const intent = position.deltaQuantityShares > 0n ? 'BUY' as const
        : position.deltaQuantityShares < 0n
          ? (position.targetQuantity.shares === 0n ? 'SELL' as const : 'REDUCE' as const)
          : 'HOLD' as const
      return Object.freeze({
        instrumentId: position.instrumentId,
        intent,
        mandatory: candidate?.hardRiskFlag === true
          || candidate?.mandatoryEligibilityFailure === true
          || candidate?.corporateActionBlocked === true,
      })
    })
    const interim = authorizeInterimPlanning({
      planningIntent: context.planningIntent,
      ...(context.interimAuthorization === undefined
        ? {} : { authorization: context.interimAuthorization }),
      actionIntents: Object.freeze(actionIntents),
      createdAt: context.createdAt,
    })
    if (!interim.ok) return interim
    if (!interim.value.authorized) {
      return failure(domainFailure('INTERIM_AUTHORIZATION_REQUIRED', { field: 'interim' }))
    }

    let executableTarget = greedyTarget
    let optimizerFallbackUsed = false
    if (
      request.optimizerMode !== undefined
      && request.optimizerTimeoutMs !== undefined
      && this.#optimizer !== undefined
      && policy.value.fixedTargetQuantityByInstrument.size === 0
    ) {
      const optimized = await this.#optimizer.optimize({
        portfolioId: context.portfolioId,
        mode: request.optimizerMode,
        timeoutBudgetMs: request.optimizerTimeoutMs,
        greedyTarget,
        idealWeights: new Map(idealTarget.value.positions.map((position) =>
          [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
        candidates: context.candidates,
        startingNav: startingNav.value,
        constraints: context.constraints,
        timing: context.timing,
      })
      executableTarget = optimized.executableTarget
      optimizerFallbackUsed =
        optimized.executableTarget.allocationMethod === 'OPTIMIZER_VERIFIED_FALLBACK'
    }

    const costsByInstrument = new Map<InstrumentId, CostEstimate>()
    const taxesByInstrument = new Map<InstrumentId, TaxEstimate>()
    let totalBuyMinorUnits = 0n
    let totalSellMinorUnits = 0n
    for (const position of executableTarget.positions) {
      if (position.deltaQuantityShares === 0n) continue
      const candidate = context.candidates.find((item) =>
        item.instrumentId === position.instrumentId)
      if (candidate === undefined) {
        return failure(domainFailure('CANDIDATE_LINEAGE_MISSING', { field: 'instrumentId' }))
      }
      const notional = absoluteMoney(position.deltaValue)
      const side = position.deltaQuantityShares > 0n ? 'BUY' as const : 'SELL' as const
      const cost = estimateOrderCost({
        schedule: assembled.value.costSchedule,
        asOf: context.asOf,
        side,
        grossNotional: notional,
      })
      if (!cost.ok) return cost
      costsByInstrument.set(position.instrumentId, cost.value)
      if (side === 'BUY') totalBuyMinorUnits += notional.minorUnits
      else {
        totalSellMinorUnits += notional.minorUnits
        const quantity = {
          shares: -position.deltaQuantityShares,
        } as const
        const tax = selectTaxLots({
          lots: candidate.currentHolding?.lots ?? [],
          sellQuantity: quantity,
          salePrice: candidate.price,
          asOf: context.asOf,
          taxRules: assembled.value.taxRules,
          mandatoryHardRiskExit: candidate.hardRiskFlag
            || candidate.mandatoryEligibilityFailure,
        })
        if (!tax.ok) return tax
        taxesByInstrument.set(position.instrumentId, tax.value)
      }
    }
    const buyMoney = createMoney(totalBuyMinorUnits)
    const sellMoney = createMoney(totalSellMinorUnits)
    if (!buyMoney.ok || !sellMoney.ok) {
      return failure(domainFailure('TURNOVER_FORMULA_INVALID', { field: 'turnover' }))
    }
    const consumption = calculateTurnoverConsumption({
      totalBuyNotional: buyMoney.value,
      totalSellNotional: sellMoney.value,
      startingNav: startingNav.value,
    })
    if (!consumption.ok) return consumption
    const turnover = evaluateTurnoverWindows({
      proposedConsumption: consumption.value,
      windows: context.turnoverWindows,
    })
    if (!turnover.ok) return turnover
    if (
      !turnover.value.accepted
      && actionIntents.some((intent) => intent.intent !== 'HOLD' && !intent.mandatory)
    ) {
      return failure(domainFailure('TURNOVER_BUDGET_EXCEEDED', { field: 'turnover' }))
    }

    const skipped: SkippedActionInput[] = [...policy.value.skipped]
    for (const item of projection.value.excludedCandidates) {
      skipped.push(Object.freeze({
        instrumentId: item.candidate.instrumentId,
        candidateSide: item.candidate.currentHolding === undefined ? 'BUY' : 'SELL',
        reasonBundle: item.reasonBundle,
      }))
    }
    for (const position of executableTarget.positions) {
      if (
        position.deltaQuantityShares === 0n
        && !projection.value.excludedCandidates.some((item) =>
          item.candidate.instrumentId === position.instrumentId)
        && !projection.value.blockedCandidates.some((item) =>
          item.candidate.instrumentId === position.instrumentId)
        && !skipped.some((item) => item.instrumentId === position.instrumentId)
      ) {
        const reason = buildSafeReasonBundle({
          primaryCode: 'NO_TRADE_REQUIRED',
          explanationKey: 'NO_TRADE_REQUIRED',
        })
        if (!reason.ok) return reason
        skipped.push(Object.freeze({
          instrumentId: position.instrumentId,
          candidateSide: 'REPLACE',
          reasonBundle: reason.value,
        }))
      }
    }
    const blocked: BlockedActionInput[] = projection.value.blockedCandidates.map((item) =>
      Object.freeze({
        instrumentId: item.candidate.instrumentId,
        candidateSide: 'BUY',
        blockingPrerequisite: 'CLASSIFICATION',
        reasonBundle: item.reasonBundle,
      }))
    const buckets = buildActionBuckets({
      portfolioId: context.portfolioId,
      startingNav: startingNav.value,
      candidates: context.candidates,
      executablePositions: executableTarget.positions,
      costsByInstrument,
      taxesByInstrument,
      skipped: Object.freeze(skipped),
      blocked: Object.freeze(blocked),
    })
    if (!buckets.ok) return buckets
    const totalEstimatedCosts = createMoney([...costsByInstrument.values()].reduce(
      (total, cost) => total + cost.totalCost.minorUnits,
      0n,
    ))
    const totalEstimatedTaxes = createMoney([...taxesByInstrument.values()].reduce(
      (total, tax) => total + tax.estimatedTax.minorUnits,
      0n,
    ))
    if (!totalEstimatedCosts.ok || !totalEstimatedTaxes.ok) {
      return failure(domainFailure('PLAN_SUMMARY_RECONCILIATION_FAILURE', {
        field: 'drag',
      }))
    }
    const shortfall = calculateImplementationShortfall({
      idealPositions: idealTarget.value.positions,
      executablePositions: executableTarget.positions,
      idealCashWeight: idealTarget.value.cashWeight,
      executableCashWeight: executableTarget.cashWeight,
      estimatedCost: totalEstimatedCosts.value,
      estimatedTax: totalEstimatedTaxes.value,
    })
    if (!shortfall.ok) return shortfall
    const plan = assembleRebalancePlan({
      context,
      idealTarget: idealTarget.value,
      executableTarget,
      implementationShortfall: shortfall.value,
      actionBuckets: buckets.value,
      turnoverBudget: turnover.value,
      totalEstimatedCosts: totalEstimatedCosts.value,
      totalEstimatedTaxes: totalEstimatedTaxes.value,
      phaseDurations: request.phaseDurations,
      optimizerFallbackUsed,
    })
    if (!plan.ok) return plan
    if (
      assembled.value.equivalentPriorPlan !== undefined
      && assembled.value.equivalentPriorPlan.planHash !== plan.value.planHash
    ) {
      return failure(domainFailure('PLAN_HASH_NON_DETERMINISTIC', { field: 'planHash' }))
    }
    return success(plan.value)
  }
}
