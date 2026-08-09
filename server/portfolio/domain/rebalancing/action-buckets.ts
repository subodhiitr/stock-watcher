import type { PlanningCandidate } from '../construction/planning-context.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { deriveLogicalOrderKey } from '../shared/canonical-plan-hash.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type { InstrumentId, PortfolioId } from '../shared/identifiers.ts'
import { createMoney, type Money } from '../shared/money.ts'
import type { BlockingPrerequisiteCode } from '../shared/rebalancing-reasons.ts'
import {
  buildSafeReasonBundle,
  type SafeReasonBundle,
} from '../shared/safe-observability-payload-builder.ts'
import { createWeight, type Weight } from '../shared/weight.ts'
import type { CostEstimate } from './cost-estimator.ts'
import type { TaxEstimate } from './tax-lot-selection.ts'
import type { ExecutableTargetPosition } from './whole-share-greedy-allocator.ts'
import {
  U04_MAX_ACTION_BUCKETS,
  U04_MAX_PROPOSED_ORDERS,
  U04_WEIGHT_SCALE,
} from '../shared/rebalancing-constants.ts'

export type ProposedOrder = Readonly<{
  logicalOrderKey: IntegrityHash
  instrumentId: InstrumentId
  side: 'BUY' | 'SELL' | 'REDUCE'
  quantityShares: bigint
  estimatedPrice: Money
  estimatedNotional: Money
  targetWeightBefore: Weight
  targetWeightAfter: Weight
  costEstimate: CostEstimate
  taxEstimate?: TaxEstimate
  reasonBundle: SafeReasonBundle
  urgency: 'MANDATORY' | 'ROUTINE' | 'DRIFT'
}>

export type SkippedOrder = Readonly<{
  logicalOrderKey: IntegrityHash
  instrumentId: InstrumentId
  candidateSide: 'BUY' | 'SELL' | 'REDUCE' | 'REPLACE'
  reasonBundle: SafeReasonBundle
  foregoneTargetWeight?: Weight
}>

export type BlockedOrder = Readonly<{
  logicalOrderKey: IntegrityHash
  instrumentId: InstrumentId
  candidateSide: 'BUY' | 'SELL' | 'REDUCE' | 'REPLACE'
  blockingPrerequisite: BlockingPrerequisiteCode
  reasonBundle: SafeReasonBundle
}>

export type ActionBuckets = Readonly<{
  proposed: readonly ProposedOrder[]
  skipped: readonly SkippedOrder[]
  blocked: readonly BlockedOrder[]
}>

export type SkippedActionInput = Readonly<{
  instrumentId: InstrumentId
  candidateSide: SkippedOrder['candidateSide']
  reasonBundle: SafeReasonBundle
  foregoneTargetWeight?: Weight
}>

export type BlockedActionInput = Readonly<{
  instrumentId: InstrumentId
  candidateSide: BlockedOrder['candidateSide']
  blockingPrerequisite: BlockingPrerequisiteCode
  reasonBundle: SafeReasonBundle
}>

function candidateSide(deltaShares: bigint): 'BUY' | 'SELL' | 'REDUCE' {
  return deltaShares > 0n ? 'BUY' : 'SELL'
}

export function buildActionBuckets(input: Readonly<{
  portfolioId: PortfolioId
  startingNav: Money
  candidates: readonly PlanningCandidate[]
  executablePositions: readonly ExecutableTargetPosition[]
  costsByInstrument: ReadonlyMap<InstrumentId, CostEstimate>
  taxesByInstrument: ReadonlyMap<InstrumentId, TaxEstimate>
  skipped: readonly SkippedActionInput[]
  blocked: readonly BlockedActionInput[]
}>): DomainResult<ActionBuckets> {
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.instrumentId, candidate] as const),
  )
  const proposed: ProposedOrder[] = []
  const seen = new Set<string>()
  for (const position of input.executablePositions) {
    if (position.deltaQuantityShares === 0n) continue
    const candidate = candidateById.get(position.instrumentId)
    const costEstimate = input.costsByInstrument.get(position.instrumentId)
    if (candidate === undefined || costEstimate === undefined) {
      return failure(domainFailure('PROPOSED_ORDER_INCOMPLETE', { field: 'proposedOrder' }))
    }
    const quantityShares = position.deltaQuantityShares < 0n
      ? -position.deltaQuantityShares
      : position.deltaQuantityShares
    const taxEstimate = position.deltaQuantityShares < 0n
      ? input.taxesByInstrument.get(position.instrumentId)
      : undefined
    if (position.deltaQuantityShares < 0n && taxEstimate === undefined) {
      return failure(domainFailure('PROPOSED_ORDER_INCOMPLETE', { field: 'taxEstimate' }))
    }
    const estimatedNotional = createMoney(quantityShares * candidate.price.minorUnits)
    const currentValue = (candidate.currentHolding?.totalQuantity.shares ?? 0n)
      * candidate.price.minorUnits
    const before = createWeight(
      input.startingNav.minorUnits === 0n
        ? 0n
        : currentValue * U04_WEIGHT_SCALE / input.startingNav.minorUnits,
    )
    const reason = buildSafeReasonBundle({
      primaryCode: candidate.hardRiskFlag || candidate.mandatoryEligibilityFailure
        ? 'MANDATORY_EXIT'
        : 'TARGET_SELECTED',
      explanationKey: candidate.hardRiskFlag || candidate.mandatoryEligibilityFailure
        ? 'MANDATORY_EXIT'
        : 'TARGET_SELECTED',
      constraintIds: position.bindingConstraintIds,
    })
    if (!estimatedNotional.ok || !before.ok || !reason.ok) {
      return failure(domainFailure('PROPOSED_ORDER_INCOMPLETE', { field: 'proposedOrder' }))
    }
    const side = candidateSide(position.deltaQuantityShares)
    const semanticAction = {
      quantityShares,
      side,
      targetWeightAfter: position.targetWeight.partsPerMillion,
    }
    proposed.push(Object.freeze({
      logicalOrderKey: deriveLogicalOrderKey({
        portfolioId: input.portfolioId,
        instrumentId: position.instrumentId,
        side,
        semanticAction,
      }),
      instrumentId: position.instrumentId,
      side,
      quantityShares,
      estimatedPrice: candidate.price,
      estimatedNotional: estimatedNotional.value,
      targetWeightBefore: before.value,
      targetWeightAfter: position.targetWeight,
      costEstimate,
      ...(taxEstimate === undefined ? {} : { taxEstimate }),
      reasonBundle: reason.value,
      urgency: candidate.hardRiskFlag || candidate.mandatoryEligibilityFailure
        ? 'MANDATORY'
        : 'ROUTINE',
    }))
    seen.add(position.instrumentId)
  }

  if (
    [...input.skipped, ...input.blocked].some((item, index, all) =>
      seen.has(item.instrumentId)
      || all.findIndex((candidate) => candidate.instrumentId === item.instrumentId) !== index)
  ) {
    return failure(domainFailure('ACTION_STATE_DOWNGRADE_FORBIDDEN', {
      field: 'instrumentId',
    }))
  }
  const skipped = input.skipped.map((item) => {
    seen.add(item.instrumentId)
    return Object.freeze({
      logicalOrderKey: deriveLogicalOrderKey({
        portfolioId: input.portfolioId,
        instrumentId: item.instrumentId,
        side: item.candidateSide,
        semanticAction: {
          bucket: 'SKIPPED',
          primaryCode: item.reasonBundle.primaryCode,
        },
      }),
      ...item,
    })
  })
  const blocked = input.blocked.map((item) => {
    seen.add(item.instrumentId)
    return Object.freeze({
      logicalOrderKey: deriveLogicalOrderKey({
        portfolioId: input.portfolioId,
        instrumentId: item.instrumentId,
        side: item.candidateSide,
        semanticAction: {
          bucket: 'BLOCKED',
          prerequisite: item.blockingPrerequisite,
        },
      }),
      ...item,
    })
  })
  proposed.sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
  skipped.sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
  blocked.sort((left, right) =>
    left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
  if (
    proposed.length > U04_MAX_PROPOSED_ORDERS
    || proposed.length + skipped.length + blocked.length > U04_MAX_ACTION_BUCKETS
  ) {
    return failure(domainFailure('CAPACITY_EXCEEDED', { field: 'actionBuckets' }))
  }
  return success(Object.freeze({
    proposed: Object.freeze(proposed),
    skipped: Object.freeze(skipped),
    blocked: Object.freeze(blocked),
  }))
}
