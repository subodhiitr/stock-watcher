import {
  verifyConstructionConstraints,
  type VerifiablePosition,
} from '../../domain/construction/constraint-verifier.ts'
import type {
  ConstructionConstraintSet,
  PlanningCandidate,
  PlanningTiming,
} from '../../domain/construction/planning-context.ts'
import type { DomainResult } from '../../domain/errors/result.ts'
import { createOptimizerRequestHash, hashCanonicalPlan } from '../../domain/shared/canonical-plan-hash.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { Money } from '../../domain/shared/money.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import {
  U04_MAX_OPTIMIZER_CONSTRAINTS,
  U04_MAX_OPTIMIZER_INSTRUMENTS,
  U04_MAX_OPTIMIZER_TIMEOUT_MS,
  U04_WEIGHT_SCALE,
} from '../../domain/shared/rebalancing-constants.ts'
import { REBALANCING_CONSTRAINT_IDS } from '../../domain/shared/rebalancing-reasons.ts'
import { createWeight } from '../../domain/shared/weight.ts'
import type {
  ExecutableTarget,
  ExecutableTargetPosition,
} from '../../domain/rebalancing/whole-share-greedy-allocator.ts'
import type {
  OptimizerMode,
  OptimizerPort,
  OptimizerRequest,
  OptimizerResponse,
} from '../../ports/rebalancing/optimizer-port.ts'

export type OptimizerOutcomeStatus =
  | 'VERIFIED_ACCEPTED'
  | 'TIMEOUT'
  | 'INFEASIBLE'
  | 'SOLVER_ERROR'
  | 'VERIFICATION_REJECTED'
  | 'FALLBACK_USED'

export type OptimizerOutcome = Readonly<{
  status: OptimizerOutcomeStatus
  mode: OptimizerMode
  requestHash: IntegrityHash
  timeoutBudgetMs: number
  durationMs: number
  iterationCount: number
  verifierAccepted: boolean
  violatedConstraintIds: readonly string[]
  fallbackReason?: 'TIMEOUT' | 'INFEASIBLE' | 'SOLVER_ERROR' | 'VERIFICATION_REJECTED'
}>

export type OptimizerOrchestrationResult = Readonly<{
  executableTarget: ExecutableTarget
  optimizerOutcome: OptimizerOutcome
}>

function exactQuantity(shares: bigint) {
  const result = createQuantity(shares)
  if (!result.ok) throw new TypeError('Invalid optimizer quantity')
  return result.value
}

function exactWeight(partsPerMillion: bigint) {
  const result = createWeight(partsPerMillion)
  if (!result.ok) throw new TypeError('Invalid optimizer weight')
  return result.value
}

function exactMoney(minorUnits: bigint) {
  const result = createMoney(minorUnits)
  if (!result.ok) throw new TypeError('Invalid optimizer money')
  return result.value
}

function fallback(
  greedy: ExecutableTarget,
  mode: OptimizerMode,
  requestHash: IntegrityHash,
  timeoutBudgetMs: number,
  response: OptimizerResponse | undefined,
  reason: NonNullable<OptimizerOutcome['fallbackReason']>,
): OptimizerOrchestrationResult {
  return Object.freeze({
    executableTarget: Object.freeze({
      ...greedy,
      allocationMethod: 'OPTIMIZER_VERIFIED_FALLBACK',
    }),
    optimizerOutcome: Object.freeze({
      status: 'FALLBACK_USED',
      mode,
      requestHash,
      timeoutBudgetMs,
      durationMs: response?.durationMs ?? 0,
      iterationCount: response?.iterationCount ?? 0,
      verifierAccepted: false,
      violatedConstraintIds: Object.freeze([
        ...(response?.violatedConstraintIds ?? []),
      ].sort()),
      fallbackReason: reason,
    }),
  })
}

function proposedTurnoverPpm(
  positions: readonly VerifiablePosition[],
  startingNav: Money,
): bigint {
  if (startingNav.minorUnits <= 0n) return 0n
  let buy = 0n
  let sell = 0n
  for (const position of positions) {
    const delta = position.targetQuantity.shares - position.currentQuantity.shares
    const notional = (delta < 0n ? -delta : delta)
      * (position.targetQuantity.shares === 0n
        ? 0n
        : position.targetValue.minorUnits / position.targetQuantity.shares)
    if (delta >= 0n) buy += notional
    else sell += notional
  }
  return (buy > sell ? buy : sell) * U04_WEIGHT_SCALE / startingNav.minorUnits
}

export class OptimizerOrchestrationService {
  readonly #optimizer: OptimizerPort

  constructor(optimizer: OptimizerPort) {
    this.#optimizer = optimizer
  }

  async optimize(input: Readonly<{
    portfolioId: PortfolioId
    mode: OptimizerMode
    timeoutBudgetMs: number
    greedyTarget: ExecutableTarget
    idealWeights: ReadonlyMap<string, bigint>
    candidates: readonly PlanningCandidate[]
    startingNav: Money
    constraints: ConstructionConstraintSet
    timing: PlanningTiming
  }>): Promise<OptimizerOrchestrationResult> {
    const boundedTimeout = input.timeoutBudgetMs > U04_MAX_OPTIMIZER_TIMEOUT_MS
      ? U04_MAX_OPTIMIZER_TIMEOUT_MS
      : input.timeoutBudgetMs
    const candidateSetHash = hashCanonicalPlan(input.candidates.map((candidate) => ({
      instrumentId: candidate.instrumentId,
      price: candidate.price,
      currentQuantity: candidate.currentHolding?.totalQuantity.shares ?? 0n,
      idealWeight: input.idealWeights.get(candidate.instrumentId) ?? 0n,
    })))
    const requestBase = {
      portfolioId: input.portfolioId,
      mode: input.mode,
      candidateSetHash,
      availableCash: input.startingNav,
      candidates: input.candidates.map((candidate) => Object.freeze({
        instrumentId: candidate.instrumentId,
        price: candidate.price,
        currentQuantity: candidate.currentHolding?.totalQuantity
          ?? exactQuantity(0n),
        idealWeight: exactWeight(input.idealWeights.get(candidate.instrumentId) ?? 0n),
        maximumQuantity: exactQuantity(
          candidate.price.minorUnits <= 0n
            ? 0n
            : candidate.liquidityCapacity.minorUnits / candidate.price.minorUnits,
        ),
      })),
      hardConstraints: REBALANCING_CONSTRAINT_IDS.map((constraintId) =>
        Object.freeze({ constraintId })),
      turnoverWindowCount: 1,
      timeoutBudgetMs: boundedTimeout,
      objective: Object.freeze({
        kind: input.mode === 'INTEGER_TRACKING'
          ? 'MINIMIZE_TRACKING_ERROR' as const
          : 'MINIMIZE_RISK_CONTRIBUTION_GAP' as const,
        tolerancePpm: 0n,
      }),
    }
    const requestHash = createOptimizerRequestHash(requestBase)
    if (
      input.candidates.length > U04_MAX_OPTIMIZER_INSTRUMENTS
      || requestBase.hardConstraints.length > U04_MAX_OPTIMIZER_CONSTRAINTS
      || boundedTimeout <= 0
    ) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        undefined,
        'INFEASIBLE',
      )
    }
    const request: OptimizerRequest = Object.freeze({
      ...requestBase,
      candidates: Object.freeze(requestBase.candidates),
      hardConstraints: Object.freeze(requestBase.hardConstraints),
      requestHash,
    })
    let operation: Promise<DomainResult<OptimizerResponse>>
    try {
      operation = this.#optimizer.optimize(request)
    } catch {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        undefined,
        'SOLVER_ERROR',
      )
    }
    const outcome = await new Promise<Readonly<{
      kind: 'RESULT'
      result: DomainResult<OptimizerResponse>
    }> | Readonly<{ kind: 'TIMEOUT' }> | Readonly<{ kind: 'ERROR' }>>((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(Object.freeze({ kind: 'TIMEOUT' }))
      }, boundedTimeout)
      operation.then(
        (result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(Object.freeze({ kind: 'RESULT', result }))
        },
        () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(Object.freeze({ kind: 'ERROR' }))
        },
      )
    })
    if (outcome.kind !== 'RESULT') {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        undefined,
        outcome.kind === 'TIMEOUT' ? 'TIMEOUT' : 'SOLVER_ERROR',
      )
    }
    const result = outcome.result
    if (!result.ok) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        undefined,
        'SOLVER_ERROR',
      )
    }
    const response = result.value
    if (response.status !== 'CANDIDATE') {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        response,
        response.status,
      )
    }
    if (
      response.requestHash !== requestHash
      || !Number.isSafeInteger(response.durationMs)
      || response.durationMs < 0
      || !Number.isSafeInteger(response.iterationCount)
      || response.iterationCount < 0
      || new Set(response.positions.map((position) => position.instrumentId)).size
        !== response.positions.length
      || response.positions.some((position) =>
        !input.candidates.some((candidate) =>
          candidate.instrumentId === position.instrumentId))
    ) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        response,
        'VERIFICATION_REJECTED',
      )
    }
    const responseById = new Map(
      response.positions.map((position) => [position.instrumentId, position] as const),
    )
    const verifiable: VerifiablePosition[] = []
    for (const candidate of input.candidates) {
      const quantity = responseById.get(candidate.instrumentId)?.targetQuantity
        ?? exactQuantity(0n)
      const targetValueMinorUnits = quantity.shares * candidate.price.minorUnits
      const targetValue = createMoney(targetValueMinorUnits)
      const targetWeight = createWeight(
        input.startingNav.minorUnits <= 0n
          ? 0n
          : targetValueMinorUnits * U04_WEIGHT_SCALE / input.startingNav.minorUnits,
      )
      if (!targetValue.ok || !targetWeight.ok) {
        return fallback(
          input.greedyTarget,
          input.mode,
          requestHash,
          boundedTimeout,
          response,
          'VERIFICATION_REJECTED',
        )
      }
      verifiable.push({
        instrumentId: candidate.instrumentId,
        decisionPrice: candidate.price,
        targetQuantity: quantity,
        targetValue: targetValue.value,
        targetWeight: targetWeight.value,
        currentQuantity: candidate.currentHolding?.totalQuantity ?? exactQuantity(0n),
        availableDeliveryQuantity: candidate.availableDeliveryQuantity,
        liquidityCapacity: candidate.currentHolding === undefined
          ? candidate.liquidityCapacity
          : exactMoney(
            targetValue.value.minorUnits > candidate.liquidityCapacity.minorUnits
              ? targetValue.value.minorUnits
              : candidate.liquidityCapacity.minorUnits,
          ),
        ...(candidate.sectorId === undefined ? {} : { sectorId: candidate.sectorId }),
        ...(candidate.groupId === undefined ? {} : { groupId: candidate.groupId }),
        ...(candidate.marketCapBucket === undefined
          ? {} : { marketCapBucket: candidate.marketCapBucket }),
      })
    }
    const computedResidual = input.startingNav.minorUnits - verifiable.reduce(
      (total, position) => total + position.targetValue.minorUnits,
      0n,
    )
    if (computedResidual !== response.residualCash.minorUnits) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        response,
        'VERIFICATION_REJECTED',
      )
    }
    const verification = verifyConstructionConstraints({
      positions: verifiable,
      residualCash: response.residualCash,
      startingNav: input.startingNav,
      constraints: input.constraints,
      proposedTurnoverPpm: proposedTurnoverPpm(verifiable, input.startingNav),
      timing: input.timing,
    })
    if (!verification.accepted) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        Object.freeze({
          ...response,
          violatedConstraintIds: verification.violatedConstraintIds,
        }),
        'VERIFICATION_REJECTED',
      )
    }
    const positions: ExecutableTargetPosition[] = verifiable.map((position) => {
      const candidate = input.candidates.find((value) =>
        value.instrumentId === position.instrumentId)
      if (candidate === undefined) throw new TypeError('Missing optimizer candidate')
      const deltaQuantityShares = position.targetQuantity.shares
        - (candidate.currentHolding?.totalQuantity.shares ?? 0n)
      return Object.freeze({
        instrumentId: position.instrumentId,
        targetWeight: position.targetWeight,
        targetQuantity: position.targetQuantity,
        targetValue: position.targetValue,
        deltaQuantityShares,
        deltaValue: exactMoney(deltaQuantityShares * candidate.price.minorUnits),
        bindingConstraintIds: Object.freeze([]),
      })
    })
    const totalEquityWeight = createWeight(positions.reduce(
      (total, position) => total + position.targetWeight.partsPerMillion,
      0n,
    ))
    const cashWeight = createWeight(
      input.startingNav.minorUnits <= 0n
        ? U04_WEIGHT_SCALE
        : response.residualCash.minorUnits * U04_WEIGHT_SCALE / input.startingNav.minorUnits,
    )
    if (!totalEquityWeight.ok || !cashWeight.ok) {
      return fallback(
        input.greedyTarget,
        input.mode,
        requestHash,
        boundedTimeout,
        response,
        'VERIFICATION_REJECTED',
      )
    }
    return Object.freeze({
      executableTarget: Object.freeze({
        allocationMethod: 'OPTIMIZER_PRIMARY',
        totalEquityWeight: totalEquityWeight.value,
        cashWeight: cashWeight.value,
        residualCash: response.residualCash,
        positions: Object.freeze(positions),
        constraintChecks: verification.checks,
        noTrade: positions.every((position) => position.deltaQuantityShares === 0n),
      }),
      optimizerOutcome: Object.freeze({
        status: 'VERIFIED_ACCEPTED',
        mode: input.mode,
        requestHash,
        timeoutBudgetMs: boundedTimeout,
        durationMs: response.durationMs,
        iterationCount: response.iterationCount,
        verifierAccepted: true,
        violatedConstraintIds: Object.freeze([]),
      }),
    })
  }
}
