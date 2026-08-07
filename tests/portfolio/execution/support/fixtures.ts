import { createHash } from 'node:crypto'

import {
  createMoney,
  createPortfolioStateVersion,
  createQuantity,
  createScaledRate,
  parseActorId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseIdempotencyKey,
  parseInstant,
  parseIntegrityHash,
  parseLocalDate,
  parseOrderId,
  parsePortfolioId,
  parseRebalanceRunId,
  parseStrategyVersionId,
  type ActorId,
  type AnyDomainFailure,
  type ApprovalBinding,
  type ApprovalDecisionSnapshot,
  type BrokerInstrumentMapping,
  type BrokerOrderReference,
  type CommittedExecutionResult,
  type DecisionKind,
  type DeterministicSeedPort,
  type DispatchGateRefresh,
  type ExecutionClockPort,
  type ExecutionDispatchFence,
  type ExecutionEvidencePayload,
  type ExecutionIdentifierFactory,
  type ExecutionMode,
  type ExecutionOrderSnapshot,
  type ExecutionPolicySnapshot,
  type ExecutionQuoteSnapshot,
  type ExecutionRunSnapshot,
  type ExecutionTransaction,
  type ExecutionWindow,
  type FillCollectionResult,
  type Instant,
  type IntegrityHash,
  type KillSwitchScope,
  type KillSwitchSnapshot,
  type LiveEnablementSnapshot,
  type LocalDate,
  type MappingLoadResult,
  type MonotonicTimePort,
  type NormalizedFill,
  type OrderIntentPayload,
  type PlacementReservation,
  type PortfolioDatabaseOwner,
  type PortfolioId,
  type Quantity,
  type QuoteFetchRequest,
  type ReconciledHolding,
  type ReconciliationComparator,
  type ReconciliationDifference,
  type ReconciliationRunSnapshot,
  type ReconciliationSnapshotRecord,
  type SessionStatusRequest,
  type TerminalReservationRelease,
} from '../../../../server/portfolio/index.ts'
import { domainFailure } from '../../../../server/portfolio/domain/errors/failure.ts'
import { failure, success } from '../../../../server/portfolio/domain/errors/result.ts'
import type { DomainResult } from '../../../../server/portfolio/domain/errors/result.ts'
import {
  parseAdjustmentProposalId,
  parseApprovalId,
  parseBrokerAccountBindingId,
  parseBrokerOrderReferenceId,
  parseCancellationId,
  parseExecutionPolicySnapshotId,
  parseExecutionRunId,
  parseFillId,
  parseInstrumentId,
  parseKillSwitchId,
  parseQuoteSnapshotId,
  parseReconciliationRunId,
  parseReconciliationSnapshotId,
  parseResidualWorkId,
  parseSubmissionAttemptId,
  type AdjustmentProposalId,
  type BrokerAccountBindingId,
} from '../../../../server/portfolio/domain/shared/identifiers.ts'
import type { PortfolioStateVersion } from '../../../../server/portfolio/domain/shared/state-version.ts'
import type { PreTradeRiskContext } from '../../../../server/portfolio/domain/execution/execution-gate.ts'
import type {
  ExecutionRunPortfolioVersionEvidencePayload,
  PortfolioAccountingEvidencePayload,
} from '../../../../server/portfolio/domain/execution/evidence.ts'
import type {
  DispatchAdmissionIdentity,
  DispatchFenceClosureToken,
  DispatchFenceDrainResult,
  DispatchFenceResult,
  DispatchOperationResult,
  UnresolvedDispatchAdmission,
} from '../../../../server/portfolio/application/execution/placement-coordinator.ts'
import {
  releaseSellDelivery,
  reserveSellDelivery,
} from '../../../../server/portfolio/domain/execution/portfolio-accounting.ts'
import type {
  CurrentPlanState,
  ExecutionAggregateLineage,
  ExecutionCorporateActionEvidence,
  ExecutionPolicyLineage,
  ExecutionPortfolioAccounting,
  ExecutionStatePort,
} from '../../../../server/portfolio/ports/execution/execution-state-port.ts'
import type { TimerCallback, BoundedTimerHandle, BoundedTimerPort } from '../../../../server/portfolio/ports/execution/runtime-port.ts'
import type { BrokerMappingPort, ConfirmedExecutionSession, ExecutionQuotePort, ExecutionSessionPort } from '../../../../server/portfolio/ports/execution/market-execution-port.ts'
import { makePortfolio, must, openTestOwner } from '../../persistence/support.ts'

export const TEST_DATE = must(parseLocalDate('2026-08-03'))
export const TEST_NOW = must(parseInstant('2026-08-03T04:45:00.000Z'))
export const TEST_LATER = must(parseInstant('2026-08-03T04:46:00.000Z'))
export const TEST_EXPIRY = must(parseInstant('2026-08-03T06:30:00.000Z'))

export function makeIntegrityHash(label: string): IntegrityHash {
  return must(parseIntegrityHash(createHash('sha256').update(label).digest('hex')))
}

export function money(minorUnits: bigint | number) {
  return must(createMoney(BigInt(minorUnits)))
}

export function quantity(shares: bigint | number) {
  return must(createQuantity(BigInt(shares)))
}

export function rate(
  numerator: bigint | number,
  denominator: bigint | number = 1_000_000n,
) {
  return must(createScaledRate(BigInt(numerator), BigInt(denominator)))
}

export const FIXTURE_IDS = Object.freeze({
  portfolioId: must(parsePortfolioId('portfolio:test:u05')),
  secondPortfolioId: must(parsePortfolioId('portfolio:test:u05-second')),
  approvalId: must(parseApprovalId('approval:test:u05')),
  secondApprovalId: must(parseApprovalId('approval:test:u05-second')),
  executionRunId: must(parseExecutionRunId('execution-run:test:u05')),
  secondExecutionRunId: must(parseExecutionRunId('execution-run:test:u05-second')),
  rebalanceRunId: must(parseRebalanceRunId('rebalance-run:test:u05')),
  orderSellId: must(parseOrderId('order:test:u05-sell')),
  orderBuyId: must(parseOrderId('order:test:u05-buy')),
  orderAuxId: must(parseOrderId('order:test:u05-aux')),
  submissionAttemptId: must(parseSubmissionAttemptId('submission-attempt:test:u05')),
  fillId: must(parseFillId('fill:test:u05')),
  fillTwoId: must(parseFillId('fill:test:u05-second')),
  fillThreeId: must(parseFillId('fill:test:u05-third')),
  cancellationId: must(parseCancellationId('cancellation:test:u05')),
  accountBindingId: must(parseBrokerAccountBindingId('broker-account:test:u05')),
  brokerReferenceId: must(parseBrokerOrderReferenceId('broker-order:test:u05')),
  quoteSnapshotId: must(parseQuoteSnapshotId('quote-snapshot:test:u05')),
  executionPolicySnapshotId: must(parseExecutionPolicySnapshotId('execution-policy:test:u05')),
  reconciliationRunId: must(parseReconciliationRunId('reconciliation-run:test:u05')),
  reconciliationSnapshotId: must(parseReconciliationSnapshotId('reconciliation-snapshot:test:u05')),
  reconciliationSnapshotTwoId: must(parseReconciliationSnapshotId('reconciliation-snapshot:test:u05-second')),
  residualWorkId: must(parseResidualWorkId('residual-work:test:u05')),
  killSwitchId: must(parseKillSwitchId('kill-switch:test:u05')),
  adjustmentProposalId: must(parseAdjustmentProposalId('adjustment-proposal:test:u05')),
  strategyVersionId: must(parseStrategyVersionId('strategy-version:test:u05')),
  actorId: must(parseActorId('actor:test:u05')),
  evidenceId: must(parseEvidenceId('evidence:test:u05')),
  commandId: must(parseCommandId('command:test:u05')),
  correlationId: must(parseCorrelationId('correlation:test:u05')),
  causationId: must(parseCausationId('causation:test:u05')),
  eventId: must(parseEventId('event:test:u05')),
  idempotencyKey: must(parseIdempotencyKey('idempotency:test:u05')),
} as const)

export const INSTRUMENT_A = must(parseInstrumentId('instrument:test:u05-alpha'))
export const INSTRUMENT_B = must(parseInstrumentId('instrument:test:u05-beta'))
export const INSTRUMENT_C = must(parseInstrumentId('instrument:test:u05-gamma'))
export const LOGICAL_ORDER_KEY_SELL = makeIntegrityHash('u05-logical-sell')
export const LOGICAL_ORDER_KEY_BUY = makeIntegrityHash('u05-logical-buy')
export const LOGICAL_ORDER_KEY_AUX = makeIntegrityHash('u05-logical-aux')
export const PLAN_HASH = makeIntegrityHash('u05-plan-hash')
export const PLAN_INPUT_HASH = makeIntegrityHash('u05-plan-input-hash')
export const POLICY_HASH = makeIntegrityHash('u05-policy-hash')
export const MAPPING_HASH = makeIntegrityHash('u05-mapping-hash')
export const RECONCILIATION_HASH = makeIntegrityHash('u05-reconciliation-hash')
export const DECISION_HASH = makeIntegrityHash('u05-decision-hash')

type AdvanceListener = () => void

export class DeterministicClock implements ExecutionClockPort, MonotonicTimePort {
  #nowMs: number
  #today: LocalDate
  #listeners = new Set<AdvanceListener>()

  public constructor(
    startAt: Instant = TEST_NOW,
    today: LocalDate = TEST_DATE,
  ) {
    this.#nowMs = Date.parse(startAt)
    this.#today = today
  }

  public now(): Instant {
    return must(parseInstant(new Date(this.#nowMs).toISOString()))
  }

  public today(): LocalDate {
    return this.#today
  }

  public nowMs(): number {
    return this.#nowMs
  }

  public advanceMs(ms: number): Instant {
    this.#nowMs += ms
    for (const listener of this.#listeners) listener()
    return this.now()
  }

  public setToday(value: LocalDate): void {
    this.#today = value
  }

  public onAdvance(listener: AdvanceListener): void {
    this.#listeners.add(listener)
  }
}

class DeterministicTimerHandle implements BoundedTimerHandle {
  #done = false
  readonly #cancelFn: () => void

  public constructor(cancelFn: () => void) {
    this.#cancelFn = cancelFn
  }

  public cancel(): void {
    if (this.#done) return
    this.#done = true
    this.#cancelFn()
  }

  public get done(): boolean {
    return this.#done
  }

  public markDone(): void {
    this.#done = true
  }
}

export class DeterministicTimer implements BoundedTimerPort {
  readonly #clock: DeterministicClock
  readonly #scheduled = new Map<number, {
    dueAt: number
    callback: TimerCallback
    handle: DeterministicTimerHandle
  }>()
  #nextId = 1

  public constructor(clock: DeterministicClock) {
    this.#clock = clock
    clock.onAdvance(() => this.flushDue())
  }

  public schedule(
    callback: TimerCallback,
    delayMs: number,
    maxDelayMs: number,
  ): DomainResult<BoundedTimerHandle> {
    if (delayMs <= 0 || delayMs > maxDelayMs) {
      return failure(domainFailure('PROVIDER_DEADLINE_EXCEEDED', {
        field: 'delayMs',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const id = this.#nextId++
    const handle = new DeterministicTimerHandle(() => {
      this.#scheduled.delete(id)
    })
    this.#scheduled.set(id, {
      dueAt: this.#clock.nowMs() + delayMs,
      callback,
      handle,
    })
    return success(handle)
  }

  public async delay(delayMs: number, maxDelayMs: number): Promise<DomainResult<void>> {
    if (delayMs <= 0 || delayMs > maxDelayMs) {
      return failure(domainFailure('PROVIDER_DEADLINE_EXCEEDED', {
        field: 'delayMs',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    this.#clock.advanceMs(delayMs)
    return success(undefined)
  }

  public flushDue(): void {
    for (const [id, scheduled] of [...this.#scheduled.entries()]) {
      if (scheduled.dueAt > this.#clock.nowMs() || scheduled.handle.done) continue
      this.#scheduled.delete(id)
      scheduled.handle.markDone()
      scheduled.callback()
    }
  }
}

export class DeterministicSeed implements DeterministicSeedPort {
  public readonly seed: number
  #state: number

  public constructor(seed = 12_345) {
    this.seed = seed
    this.#state = seed >>> 0
  }

  public nextFloat(): number {
    this.#state = (1664525 * this.#state + 1013904223) >>> 0
    return this.#state / 0x1_0000_0000
  }

  public nextInt(min: number, max: number): number {
    if (min > max) throw new RangeError('min > max')
    const span = max - min + 1
    return min + Math.floor(this.nextFloat() * span)
  }
}

export class DeterministicExecutionIds implements ExecutionIdentifierFactory {
  readonly #prefix: string
  readonly #counters = new Map<string, number>()

  public constructor(prefix = 'u05') {
    this.#prefix = prefix
  }

  #next(name: string): string {
    const value = (this.#counters.get(name) ?? 0) + 1
    this.#counters.set(name, value)
    return `${name}:${this.#prefix}:${String(value).padStart(3, '0')}`
  }

  portfolioId() { return must(parsePortfolioId(this.#next('portfolio'))) }
  approvalId() { return must(parseApprovalId(this.#next('approval'))) }
  executionRunId() { return must(parseExecutionRunId(this.#next('execution-run'))) }
  orderId() { return must(parseOrderId(this.#next('order'))) }
  submissionAttemptId() { return must(parseSubmissionAttemptId(this.#next('submission-attempt'))) }
  fillId() { return must(parseFillId(this.#next('fill'))) }
  cancellationId() { return must(parseCancellationId(this.#next('cancellation'))) }
  reconciliationRunId() { return must(parseReconciliationRunId(this.#next('reconciliation-run'))) }
  reconciliationSnapshotId() { return must(parseReconciliationSnapshotId(this.#next('reconciliation-snapshot'))) }
  residualWorkId() { return must(parseResidualWorkId(this.#next('residual-work'))) }
  killSwitchId() { return must(parseKillSwitchId(this.#next('kill-switch'))) }
  adjustmentProposalId() { return must(parseAdjustmentProposalId(this.#next('adjustment-proposal'))) }
  quoteSnapshotId() { return must(parseQuoteSnapshotId(this.#next('quote-snapshot'))) }
  executionPolicySnapshotId() { return must(parseExecutionPolicySnapshotId(this.#next('execution-policy'))) }
  idempotencyKey() { return must(parseIdempotencyKey(this.#next('idempotency'))) }
  evidenceId() { return must(parseEvidenceId(this.#next('evidence'))) }
}

export function makeBrokerReference(
  brokerOrderId = 'paper:broker-order-001',
  accountBindingId: BrokerAccountBindingId = FIXTURE_IDS.accountBindingId,
  acknowledgedAt: Instant = TEST_NOW,
): BrokerOrderReference {
  return Object.freeze({
    brokerOrderReferenceId: must(parseBrokerOrderReferenceId(`broker-ref:${brokerOrderId}`)),
    brokerOrderId,
    accountBindingId,
    acknowledgedAt,
  })
}

export function makeExecutionWindow(
  overrides: Partial<ExecutionWindow> = {},
): ExecutionWindow {
  return Object.freeze({
    executionDate: TEST_DATE,
    start: '09:20',
    end: '15:15',
    timeZone: 'Asia/Kolkata',
    sameSessionAllowed: false,
    calendarSessionId: 'calendar-session:test:u05' as ExecutionWindow['calendarSessionId'],
    ...overrides,
  })
}

export function makeApprovalBinding(
  overrides: Partial<ApprovalBinding> = {},
): ApprovalBinding {
  const keys = overrides.approvedLogicalOrderKeys ?? Object.freeze([
    LOGICAL_ORDER_KEY_SELL,
    LOGICAL_ORDER_KEY_BUY,
  ])
  return Object.freeze({
    planHash: PLAN_HASH,
    planInputHash: PLAN_INPUT_HASH,
    strategyVersionId: FIXTURE_IDS.strategyVersionId,
    strategyConfigHash: POLICY_HASH,
    portfolioStateVersion: must(createPortfolioStateVersion(1, true)),
    reconciliationSnapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    quoteSnapshotId: FIXTURE_IDS.quoteSnapshotId,
    approvedLogicalOrderKeys: keys,
    priceBoundsByOrder: Object.freeze(keys.map((logicalOrderKey, index) => Object.freeze({
      logicalOrderKey,
      referencePrice: money(index === 0 ? 12_500n : 8_000n),
      approvedLimitPrice: money(index === 0 ? 12_700n : 8_100n),
      maximumDeviation: rate(50_000n),
      quoteStaleAfter: TEST_EXPIRY,
    }))),
    executionDate: TEST_DATE,
    windowStart: '09:20',
    windowEnd: '15:15',
    timeZone: 'Asia/Kolkata',
    expiresAt: TEST_EXPIRY,
    ...overrides,
  })
}

export function makePendingApproval(
  overrides: Partial<ApprovalDecisionSnapshot> = {},
): ApprovalDecisionSnapshot {
  return Object.freeze({
    approvalId: FIXTURE_IDS.approvalId,
    portfolioId: FIXTURE_IDS.portfolioId,
    rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
    state: 'PENDING',
    decisionKind: 'REJECT' as DecisionKind,
    decidedBy: FIXTURE_IDS.actorId,
    authorizationEvidenceId: FIXTURE_IDS.evidenceId,
    idempotencyKey: FIXTURE_IDS.idempotencyKey,
    decisionHash: DECISION_HASH,
    decidedAt: TEST_NOW,
    stateVersion: 1,
    ...overrides,
  })
}

export function makeApprovedApproval(
  overrides: Partial<ApprovalDecisionSnapshot> = {},
): ApprovalDecisionSnapshot {
  const binding = makeApprovalBinding(overrides.binding)
  return Object.freeze({
    ...makePendingApproval(),
    state: 'APPROVED',
    decisionKind: 'APPROVE_BASKET',
    binding,
    stateVersion: 2,
    ...overrides,
  })
}

export function makeExecutionRun(
  overrides: Partial<ExecutionRunSnapshot> = {},
): ExecutionRunSnapshot {
  return Object.freeze({
    executionRunId: FIXTURE_IDS.executionRunId,
    portfolioId: FIXTURE_IDS.portfolioId,
    approvalId: FIXTURE_IDS.approvalId,
    rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
    planHash: PLAN_HASH,
    mode: 'PAPER' as ExecutionMode,
    state: 'READY',
    preExecutionReconciliationId: FIXTURE_IDS.reconciliationRunId,
    phaseReconciliationIds: Object.freeze([]),
    policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
    portfolioStateVersion: must(createPortfolioStateVersion(1, true)),
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    stateVersion: 1,
    ...overrides,
  })
}

export function makeMapping(
  instrumentId = INSTRUMENT_A,
  overrides: Partial<BrokerInstrumentMapping> = {},
): BrokerInstrumentMapping {
  return Object.freeze({
    brokerAccountBindingId: FIXTURE_IDS.accountBindingId,
    instrumentId: instrumentId as BrokerInstrumentMapping['instrumentId'],
    brokerSymbol: instrumentId,
    brokerInstrumentCode: `code:${instrumentId}`,
    exchange: 'NSE',
    product: 'CNC',
    snapshotHash: MAPPING_HASH,
    validAt: TEST_NOW,
    ...overrides,
  })
}

export function makeOrderIntent(
  overrides: Partial<OrderIntentPayload> = {},
): OrderIntentPayload {
  return Object.freeze({
    portfolioId: FIXTURE_IDS.portfolioId,
    executionRunId: FIXTURE_IDS.executionRunId,
    approvalId: FIXTURE_IDS.approvalId,
    rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
    planHash: PLAN_HASH,
    orderId: FIXTURE_IDS.orderSellId,
    logicalOrderKey: LOGICAL_ORDER_KEY_SELL,
    instrumentId: INSTRUMENT_A as OrderIntentPayload['instrumentId'],
    mapping: makeMapping(INSTRUMENT_A),
    side: 'SELL',
    product: 'CNC',
    orderType: 'LIMIT',
    quantity: quantity(10n),
    limitPrice: money(12_500n),
    validity: 'DAY',
    executionWindow: makeExecutionWindow(),
    policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
    sequence: 1,
    ...overrides,
  })
}

export function makeExecutionOrder(
  overrides: Partial<ExecutionOrderSnapshot> = {},
): ExecutionOrderSnapshot {
  return Object.freeze({
    orderId: FIXTURE_IDS.orderSellId,
    executionRunId: FIXTURE_IDS.executionRunId,
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId: INSTRUMENT_A as ExecutionOrderSnapshot['instrumentId'],
    side: 'SELL',
    product: 'CNC',
    logicalOrderKey: LOGICAL_ORDER_KEY_SELL,
    idempotencyKey: FIXTURE_IDS.idempotencyKey,
    sequence: 1,
    approvedQuantityCeiling: quantity(10n),
    state: 'PLANNED',
    submissionAttempts: Object.freeze([]),
    fills: Object.freeze([]),
    filledQuantity: quantity(0n),
    cancellations: Object.freeze([]),
    cancellationOutcomes: Object.freeze([]),
    stateVersion: 1,
    ...overrides,
  })
}

export function makeNormalizedFill(
  overrides: Partial<NormalizedFill> = {},
): NormalizedFill {
  return Object.freeze({
    fillId: FIXTURE_IDS.fillId,
    portfolioId: FIXTURE_IDS.portfolioId,
    orderId: FIXTURE_IDS.orderSellId,
    executionRunId: FIXTURE_IDS.executionRunId,
    instrumentId: INSTRUMENT_A as NormalizedFill['instrumentId'],
    side: 'SELL',
    product: 'CNC',
    quantity: quantity(5n),
    price: money(12_400n),
    charges: money(15n),
    tradeTime: TEST_LATER,
    brokerFillId: 'paper-fill:1',
    contentHash: makeIntegrityHash(`fill:${overrides.fillId ?? FIXTURE_IDS.fillId}`),
    ...overrides,
  })
}

export function makeReconciliationSnapshot(
  overrides: Partial<ReconciliationSnapshotRecord> = {},
): ReconciliationSnapshotRecord {
  return Object.freeze({
    snapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    source: 'LOCAL',
    portfolioId: FIXTURE_IDS.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    cash: money(100_000_000n),
    holdings: Object.freeze([Object.freeze({
      instrumentId: INSTRUMENT_A as ReconciledHolding['instrumentId'],
      totalQuantity: quantity(20n),
      availableDeliveryQuantity: quantity(20n),
      reservedQuantity: quantity(0n),
      averageCost: money(11_000n),
      mappingHash: MAPPING_HASH,
    })]),
    openOrders: Object.freeze([]),
    fills: Object.freeze([]),
    endpointTimes: Object.freeze({ holdings: TEST_NOW, cash: TEST_NOW }),
    capturedAt: TEST_NOW,
    contentHash: RECONCILIATION_HASH,
    ...overrides,
  })
}

export function makeReconciliationRun(
  overrides: Partial<ReconciliationRunSnapshot> = {},
): ReconciliationRunSnapshot {
  return Object.freeze({
    reconciliationRunId: FIXTURE_IDS.reconciliationRunId,
    portfolioId: FIXTURE_IDS.portfolioId,
    reason: 'BEFORE_EXECUTION',
    state: 'MATCHED',
    localSnapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    externalSnapshotId: FIXTURE_IDS.reconciliationSnapshotId,
    differences: Object.freeze([]),
    startedAt: TEST_NOW,
    completedAt: TEST_NOW,
    snapshotHash: RECONCILIATION_HASH,
    stateVersion: 1,
    ...overrides,
  })
}

export function makeExecutionPolicyLineage(
  overrides: Partial<ExecutionPolicyLineage> = {},
): ExecutionPolicyLineage {
  const policySnapshot: ExecutionPolicySnapshot = Object.freeze({
    policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
    strategyVersionId: FIXTURE_IDS.strategyVersionId,
    allowedUniverseHash: makeIntegrityHash('u05-allowed-universe'),
    product: 'CNC',
    maximumOrderCount: 250,
    maximumDailyNotional: money(500_000_000n),
    maximumPositionValue: money(150_000_000n),
    maximumTurnover: rate(900_000n),
    minimumCashBuffer: money(25_000n),
    maximumQuoteAgeMs: 60_000,
    maximumPriceDeviation: rate(50_000n),
    maximumRejections: 3,
    effectiveAt: TEST_NOW,
    hash: POLICY_HASH,
  })
  return Object.freeze({
    policySnapshot,
    strategyConfigHash: POLICY_HASH,
    effectiveAt: TEST_NOW,
    ...overrides,
  })
}

export function makeCorporateActionEvidence(
  overrides: Partial<ExecutionCorporateActionEvidence> = {},
): ExecutionCorporateActionEvidence {
  return Object.freeze({
    pendingActions: Object.freeze([]),
    processedSincePlan: Object.freeze([]),
    contentHash: makeIntegrityHash('u05-corporate-actions'),
    asOf: TEST_NOW,
    ...overrides,
  })
}

export function makePlanState(
  overrides: Partial<CurrentPlanState> = {},
): CurrentPlanState {
  const plan = Object.freeze({
    portfolioId: FIXTURE_IDS.portfolioId,
    rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
    state: 'APPROVAL_READY',
    planHash: PLAN_HASH,
    planInputHash: PLAN_INPUT_HASH,
    asOf: TEST_DATE,
    context: Object.freeze({
      strategyVersionId: FIXTURE_IDS.strategyVersionId,
    }),
    actionBuckets: Object.freeze({
      proposed: Object.freeze([
        Object.freeze({
          logicalOrderKey: LOGICAL_ORDER_KEY_SELL,
          instrumentId: INSTRUMENT_A,
          side: 'SELL',
          quantityShares: 10n,
          estimatedPrice: money(12_500n),
        }),
        Object.freeze({
          logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
          instrumentId: INSTRUMENT_B,
          side: 'BUY',
          quantityShares: 4n,
          estimatedPrice: money(8_000n),
        }),
      ]),
      skipped: Object.freeze([]),
      blocked: Object.freeze([]),
    }),
  }) as unknown as CurrentPlanState['plan']
  return Object.freeze({
    plan,
    verifiedPlanHash: PLAN_HASH,
    loadedAt: TEST_NOW,
    ...overrides,
  })
}

export function makeExecutionPortfolioAccounting(
  stateVersion: PortfolioStateVersion = must(createPortfolioStateVersion(1, true)),
): ExecutionPortfolioAccounting {
  const transition = makePortfolio('u05-accounting', 'U05 Accounting Portfolio')
  const snapshot = transition.state.snapshot()
  const holdingsByInstrument = new Map(snapshot.holdings.map((holding) => [
    holding.instrumentId,
    holding,
  ]))
  return Object.freeze({
    snapshot,
    totalReservedCash: money(0n),
    holdingsByInstrument,
    stateVersion,
    asOf: TEST_NOW,
  })
}

export function makeAggregateLineage(
  overrides: Partial<ExecutionAggregateLineage> = {},
): ExecutionAggregateLineage {
  return Object.freeze({
    latestReconciliation: makeReconciliationRun(),
    asOf: TEST_NOW,
    ...overrides,
  })
}

export class FixtureExecutionStatePort implements ExecutionStatePort {
  readonly #plan: CurrentPlanState | undefined
  readonly #accounting: ExecutionPortfolioAccounting
  readonly #policy: ExecutionPolicyLineage
  readonly #corporateActions: ExecutionCorporateActionEvidence
  readonly #aggregate: ExecutionAggregateLineage

  public constructor(options: {
    plan?: CurrentPlanState
    accounting?: ExecutionPortfolioAccounting
    policy?: ExecutionPolicyLineage
    corporateActions?: ExecutionCorporateActionEvidence
    aggregate?: ExecutionAggregateLineage
  } = {}) {
    this.#plan = options.plan ?? makePlanState()
    this.#accounting = options.accounting ?? makeExecutionPortfolioAccounting()
    this.#policy = options.policy ?? makeExecutionPolicyLineage()
    this.#corporateActions = options.corporateActions ?? makeCorporateActionEvidence()
    this.#aggregate = options.aggregate ?? makeAggregateLineage()
  }

  async loadCurrentPlan(): Promise<DomainResult<CurrentPlanState | undefined>> {
    return success(this.#plan)
  }

  async loadPortfolioAccounting(): Promise<DomainResult<ExecutionPortfolioAccounting>> {
    return success(this.#accounting)
  }

  async loadPolicyLineage(): Promise<DomainResult<ExecutionPolicyLineage>> {
    return success(this.#policy)
  }

  async loadCorporateActionEvidence(): Promise<DomainResult<ExecutionCorporateActionEvidence>> {
    return success(this.#corporateActions)
  }

  async loadAggregateLineage(): Promise<DomainResult<ExecutionAggregateLineage>> {
    return success(this.#aggregate)
  }
}

export class StaticQuotePort implements ExecutionQuotePort {
  readonly #quote: ExecutionQuoteSnapshot
  public constructor(quote?: ExecutionQuoteSnapshot) {
    this.#quote = quote ?? Object.freeze({
      quoteSnapshotId: FIXTURE_IDS.quoteSnapshotId,
      instrumentId: INSTRUMENT_A as ExecutionQuoteSnapshot['instrumentId'],
      bid: money(12_400n),
      ask: money(12_500n),
      last: money(12_450n),
      source: 'fixture',
      marketTime: TEST_NOW,
      fetchedAt: TEST_NOW,
      staleAfter: TEST_EXPIRY,
      validationStatus: 'VALID',
      mappingSnapshotHash: MAPPING_HASH,
    })
  }
  async fetchQuote(_request: QuoteFetchRequest): Promise<DomainResult<ExecutionQuoteSnapshot>> {
    return success(this.#quote)
  }
}

export class StaticSessionPort implements ExecutionSessionPort {
  readonly #session: ConfirmedExecutionSession
  public constructor(session?: ConfirmedExecutionSession) {
    this.#session = session ?? Object.freeze({
      calendarSessionId: makeExecutionWindow().calendarSessionId,
      timeZone: 'Asia/Kolkata',
      sessionDate: TEST_DATE,
      window: makeExecutionWindow(),
      withinWindow: true,
      sessionVerifiedAt: TEST_NOW,
    })
  }
  async loadSession(_request: SessionStatusRequest): Promise<DomainResult<ConfirmedExecutionSession>> {
    return success(this.#session)
  }
}

export class StaticMappingPort implements BrokerMappingPort {
  readonly #mapping: MappingLoadResult
  public constructor(mapping?: MappingLoadResult) {
    const loadedMapping = makeMapping()
    this.#mapping = mapping ?? Object.freeze({
      mapping: loadedMapping,
      snapshotHash: loadedMapping.snapshotHash,
      verifiedAt: TEST_NOW,
    })
  }
  async loadMapping(): Promise<DomainResult<MappingLoadResult>> {
    return success(this.#mapping)
  }
  async loadMappingBatch(
    requests: readonly unknown[],
  ): Promise<DomainResult<readonly MappingLoadResult[]>> {
    return success(Object.freeze(Array.from({ length: requests.length }, () => this.#mapping)))
  }
}

export function makePreTradeRiskContext(
  overrides: Partial<PreTradeRiskContext> = {},
): PreTradeRiskContext {
  return Object.freeze({
    universeAllowed: true,
    symbolAllowed: true,
    productCnc: true,
    orderCountBelowLimit: true,
    dailyNotionalBelowLimit: true,
    positionBelowLimit: true,
    concentrationBelowLimit: true,
    turnoverBelowLimit: true,
    liquidityAdequate: true,
    drawdownBelowLimit: true,
    rejectionsBelowLimit: true,
    dataComplete: true,
    cashAdequate: true,
    noConflict: true,
    automationAuthorized: true,
    ...overrides,
  })
}

export function makeAllGatesContext(
  overrides: Partial<{
    run: ExecutionRunSnapshot
    approval: ApprovalDecisionSnapshot
    reconciliation: ReconciliationRunSnapshot
    requestedMode: ExecutionMode
    liveEnablement: LiveEnablementSnapshot
    preTradeRisk: PreTradeRiskContext
    currentPlanHash: IntegrityHash
    portfolioStateVersion: PortfolioStateVersion
  }> = {},
) {
  const run = overrides.run ?? makeExecutionRun()
  const approval = overrides.approval ?? makeApprovedApproval({
    consumedByExecutionRunId: run.executionRunId,
    state: 'CONSUMED',
  })
  const reconciliation = overrides.reconciliation ?? makeReconciliationRun()
  const portfolioStateVersion = overrides.portfolioStateVersion
    ?? approval.binding?.portfolioStateVersion
    ?? must(createPortfolioStateVersion(1, true))
  return Object.freeze({
    portfolioStatus: 'ACTIVE' as const,
    liveEnablement: overrides.liveEnablement ?? Object.freeze({
      environmentEnabled: true,
      applicationEnabled: true,
      portfolioEligible: true,
      strategyEligible: true,
      brokerAccountBound: true,
      brokerCertified: true,
      approvalCurrent: true,
      reconciliationMatched: true,
      sessionEligible: true,
      riskPassed: true,
      fullAutoEnabled: false,
    }),
    requestedMode: overrides.requestedMode ?? 'PAPER',
    portfolioId: run.portfolioId,
    reconciliation,
    reconciliationMaxAgeMs: 120_000,
    now: TEST_NOW,
    executionWindow: Object.freeze({
      executionDate: TEST_DATE,
      windowStart: '09:20',
      windowEnd: '15:15',
      timeZone: 'Asia/Kolkata',
      nowLocalDate: TEST_DATE,
      nowLocalTime: '10:15',
      sameSessionAllowed: false,
    }),
    quote: Object.freeze({
      fetchedAt: TEST_NOW,
      staleAfter: TEST_EXPIRY,
      nowInstant: TEST_NOW,
      maximumQuoteAgeMs: 60_000,
      logicalOrderKey: LOGICAL_ORDER_KEY_SELL,
      proposedLimitPrice: money(12_500n),
    }),
    approval,
    executionRunId: run.executionRunId,
    currentPlanHash: overrides.currentPlanHash ?? PLAN_HASH,
    currentPortfolioVersion: portfolioStateVersion,
    preTradeRisk: overrides.preTradeRisk ?? makePreTradeRiskContext(),
  })
}

export function makeDispatchGateRefresh(
  gates = makeAllGatesContext(),
): DispatchGateRefresh {
  return {
    async refresh() {
      return success(Object.freeze({
        liveEnablement: gates.liveEnablement,
        executionWindow: gates.executionWindow,
        quote: gates.quote,
        preTradeRisk: gates.preTradeRisk,
        currentPlanHash: gates.currentPlanHash,
        currentPlanInputHash: gates.approval.binding!.planInputHash,
        strategyVersionId: gates.approval.binding!.strategyVersionId,
        strategyConfigHash: gates.approval.binding!.strategyConfigHash,
        policySnapshotId: FIXTURE_IDS.executionPolicySnapshotId,
        reconciliationSnapshotId: gates.reconciliation.externalSnapshotId!,
        maximumQuoteAgeMs: gates.quote.maximumQuoteAgeMs,
      }))
    },
  }
}

export function makeSimpleReservation(): PlacementReservation {
  return {
    reserve(
      transaction: ExecutionTransaction,
      order: ExecutionOrderSnapshot,
      intent: OrderIntentPayload,
    ) {
      const reserved = Object.freeze({
        ...order,
        ...(order.side === 'BUY'
          ? { reservedCash: money(intent.quantity.shares * intent.limitPrice.minorUnits) }
          : {}),
        ...(order.side === 'SELL'
          ? { reservedDeliveryQuantity: intent.quantity }
          : {}),
      }) as ExecutionOrderSnapshot
      if (order.side === 'BUY') {
        return success(Object.freeze({ order: reserved }))
      }
      const runResult = transaction.runs.getById(order.executionRunId)
      if (!runResult.ok) return runResult
      if (runResult.value === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'executionRunId',
          retryability: 'NEVER',
        }))
      }
      const portfolioResult = transaction.portfolioAccounting.getById(order.portfolioId)
      if (!portfolioResult.ok) return portfolioResult
      if (portfolioResult.value === undefined) {
        return failure(domainFailure('EXECUTION_PORTFOLIO_MISMATCH', {
          field: 'portfolioId',
          retryability: 'NEVER',
        }))
      }
      const portfolio = reserveSellDelivery(
        portfolioResult.value,
        order.instrumentId,
        intent.quantity,
      )
      if (!portfolio.ok) return portfolio
      const savedPortfolio = transaction.portfolioAccounting.save(
        portfolio.value,
        portfolioResult.value.stateVersion,
      )
      if (!savedPortfolio.ok) return savedPortfolio
      const run = Object.freeze({
        ...runResult.value,
        portfolioStateVersion: portfolio.value.stateVersion,
        stateVersion: runResult.value.stateVersion + 1,
      })
      const savedRun = transaction.runs.save(run, runResult.value.stateVersion)
      if (!savedRun.ok) return savedRun
      const reservedDelta = intent.quantity.shares.toString(10)
      const accountingEvidence: PortfolioAccountingEvidencePayload = Object.freeze({
        kind: 'PORTFOLIO_ACCOUNTING_CHANGED',
        portfolioId: order.portfolioId,
        executionRunId: order.executionRunId,
        orderId: order.orderId,
        instrumentId: order.instrumentId,
        reason: 'SELL_RESERVATION',
        cashDeltaMinorUnits: '0',
        holdingDeltaShares: '0',
        reservedCashDeltaMinorUnits: '0',
        reservedDeliveryDeltaShares: reservedDelta,
        reservedQuantityDeltaShares: reservedDelta,
        portfolioStateVersion: run.portfolioStateVersion,
        occurredAt: TEST_NOW,
      })
      const runEvidence: ExecutionRunPortfolioVersionEvidencePayload = Object.freeze({
        kind: 'EXECUTION_RUN_PORTFOLIO_VERSION_ADVANCED',
        portfolioId: run.portfolioId,
        executionRunId: run.executionRunId,
        previousPortfolioStateVersion: runResult.value.portfolioStateVersion,
        portfolioStateVersion: run.portfolioStateVersion,
        stateVersion: run.stateVersion,
        occurredAt: TEST_NOW,
      })
      return success(Object.freeze({
        order: reserved,
        accountingEvidence,
        run,
        runEvidence,
      }))
    },
  }
}

export function makeSimpleTerminalRelease(): TerminalReservationRelease {
  return {
    release(transaction: ExecutionTransaction, order: ExecutionOrderSnapshot) {
      const { reservedCash: _reservedCash, reservedDeliveryQuantity: _reservedDeliveryQuantity, ...rest } = order
      const terminalOrder = Object.freeze(rest)
      if (order.side === 'BUY' || order.reservedDeliveryQuantity === undefined) {
        return success(Object.freeze({
          order: terminalOrder,
        }))
      }
      const runResult = transaction.runs.getById(order.executionRunId)
      if (!runResult.ok) return runResult
      if (runResult.value === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'executionRunId',
          retryability: 'NEVER',
        }))
      }
      const portfolioResult = transaction.portfolioAccounting.getById(order.portfolioId)
      if (!portfolioResult.ok) return portfolioResult
      if (portfolioResult.value === undefined) {
        return failure(domainFailure('EXECUTION_PORTFOLIO_MISMATCH', {
          field: 'portfolioId',
          retryability: 'NEVER',
        }))
      }
      const portfolio = releaseSellDelivery(
        portfolioResult.value,
        order.instrumentId,
        order.reservedDeliveryQuantity,
      )
      if (!portfolio.ok) return portfolio
      const savedPortfolio = transaction.portfolioAccounting.save(
        portfolio.value,
        portfolioResult.value.stateVersion,
      )
      if (!savedPortfolio.ok) return savedPortfolio
      const run = Object.freeze({
        ...runResult.value,
        portfolioStateVersion: portfolio.value.stateVersion,
        stateVersion: runResult.value.stateVersion + 1,
      })
      const savedRun = transaction.runs.save(run, runResult.value.stateVersion)
      if (!savedRun.ok) return savedRun
      const releasedDelta = (-order.reservedDeliveryQuantity.shares).toString(10)
      const accountingEvidence: PortfolioAccountingEvidencePayload = Object.freeze({
        kind: 'PORTFOLIO_ACCOUNTING_CHANGED',
        portfolioId: order.portfolioId,
        executionRunId: order.executionRunId,
        orderId: order.orderId,
        instrumentId: order.instrumentId,
        reason: 'SELL_RESERVATION',
        cashDeltaMinorUnits: '0',
        holdingDeltaShares: '0',
        reservedCashDeltaMinorUnits: '0',
        reservedDeliveryDeltaShares: releasedDelta,
        reservedQuantityDeltaShares: releasedDelta,
        portfolioStateVersion: run.portfolioStateVersion,
        occurredAt: TEST_NOW,
      })
      const runEvidence: ExecutionRunPortfolioVersionEvidencePayload = Object.freeze({
        kind: 'EXECUTION_RUN_PORTFOLIO_VERSION_ADVANCED',
        portfolioId: run.portfolioId,
        executionRunId: run.executionRunId,
        previousPortfolioStateVersion: runResult.value.portfolioStateVersion,
        portfolioStateVersion: run.portfolioStateVersion,
        stateVersion: run.stateVersion,
        occurredAt: TEST_NOW,
      })
      return success(Object.freeze({
        order: terminalOrder,
        accountingEvidence,
        run,
        runEvidence,
      }))
    },
  }
}

export class InMemoryDispatchFence implements ExecutionDispatchFence {
  readonly admissions: Array<{ kind: 'execute' | 'close' | 'resolve' | 'open'; orderId?: string }> = []
  readonly unresolved: UnresolvedDispatchAdmission[] = []
  closed = false

  async execute<T>(
    admission: DispatchAdmissionIdentity,
    operation: () => Promise<DispatchOperationResult<T>>,
  ): Promise<DomainResult<DispatchFenceResult<T>>> {
    this.admissions.push({ kind: 'execute', orderId: admission.orderId })
    if (this.closed) return success(Object.freeze({ admitted: false as const }))
    const outcome = await operation()
    if (outcome.kind === 'OUTCOME_UNRESOLVED') {
      this.unresolved.push(outcome.unresolved)
    }
    return success(Object.freeze({ admitted: true as const, outcome }))
  }

  async closeAndDrain(_scope: KillSwitchScope): Promise<DomainResult<DispatchFenceDrainResult>> {
    this.closed = true
    this.admissions.push({ kind: 'close' })
    return success(Object.freeze({
      closure: Object.freeze({ closureId: 'closure:test:u05' }) as DispatchFenceClosureToken,
      unresolvedAdmissions: Object.freeze([...this.unresolved]),
    }))
  }

  async resolveAdmission(
    _admission: DispatchAdmissionIdentity,
    validateResolved: () => DomainResult<void>,
  ): Promise<DomainResult<void>> {
    this.admissions.push({ kind: 'resolve' })
    const validation = validateResolved()
    if (!validation.ok) return validation
    this.unresolved.splice(0, this.unresolved.length)
    return success(undefined)
  }

  async open(
    _scope: KillSwitchScope,
    _closure: DispatchFenceClosureToken,
    validateCurrent: () => DomainResult<void>,
  ): Promise<DomainResult<void>> {
    this.admissions.push({ kind: 'open' })
    this.closed = false
    return validateCurrent()
  }
}

export function makeComparator(
  differences: readonly ReconciliationDifference[] = Object.freeze([]),
): ReconciliationComparator {
  return {
    compare() {
      return success(differences)
    },
  }
}

export function makeApprovalEvidence(snapshot: ApprovalDecisionSnapshot): ExecutionEvidencePayload {
  return Object.freeze({
    kind: 'APPROVAL_DECIDED',
    portfolioId: snapshot.portfolioId,
    approvalId: snapshot.approvalId,
    state: snapshot.state,
    mode: 'PAPER',
    planHashPrefix: PLAN_HASH.slice(0, 12),
    stateVersion: snapshot.stateVersion,
    occurredAt: TEST_NOW,
  })
}

export function makeRunEvidence(snapshot: ExecutionRunSnapshot): ExecutionEvidencePayload {
  return Object.freeze({
    kind: 'EXECUTION_RUN_STATE_CHANGED',
    portfolioId: snapshot.portfolioId,
    executionRunId: snapshot.executionRunId,
    approvalId: snapshot.approvalId,
    previousState: snapshot.state,
    newState: snapshot.state,
    mode: snapshot.mode,
    stateVersion: snapshot.stateVersion,
    occurredAt: TEST_NOW,
  })
}

export function makeOrderEvidence(snapshot: ExecutionOrderSnapshot): ExecutionEvidencePayload {
  return Object.freeze({
    kind: 'ORDER_STATE_CHANGED',
    portfolioId: snapshot.portfolioId,
    executionRunId: snapshot.executionRunId,
    orderId: snapshot.orderId,
    previousState: snapshot.state,
    newState: snapshot.state,
    stateVersion: snapshot.stateVersion,
    occurredAt: TEST_NOW,
  })
}

export function makeReconciliationRunEvidence(
  snapshot: ReconciliationRunSnapshot,
): ExecutionEvidencePayload {
  return Object.freeze({
    kind: 'RECONCILIATION_STATE_CHANGED',
    portfolioId: snapshot.portfolioId,
    reconciliationRunId: snapshot.reconciliationRunId,
    previousState: snapshot.state,
    newState: snapshot.state,
    stateVersion: snapshot.stateVersion,
    occurredAt: TEST_NOW,
  })
}

export function makeReconciliationSnapshotEvidence(
  snapshot: ReconciliationSnapshotRecord,
  reconciliationRunId: ReconciliationRunSnapshot['reconciliationRunId'] = FIXTURE_IDS.reconciliationRunId,
): ExecutionEvidencePayload {
  return Object.freeze({
    kind: 'RECONCILIATION_SNAPSHOT_RECORDED',
    portfolioId: snapshot.portfolioId,
    reconciliationRunId,
    snapshotId: snapshot.snapshotId,
    source: snapshot.source,
    contentHashPrefix: snapshot.contentHash.slice(0, 12),
    occurredAt: TEST_NOW,
  })
}

export function makeOwnerWithPortfolio(
  token = 'u05-runtime',
  displayName = 'U05 Runtime Portfolio',
): { owner: PortfolioDatabaseOwner; portfolioId: PortfolioId } {
  const owner = openTestOwner()
  void token
  const transition = makePortfolio('u05', displayName)
  const persisted = owner.unitOfWork.execute((transaction) => {
    const inserted = transaction.portfolios.insert(transition.state)
    if (!inserted.ok) return inserted
    const appended = transaction.appendDomainEvents(transition.events)
    return appended.ok ? success(transition.state.portfolioId) : appended
  })
  return {
    owner,
    portfolioId: must(persisted).value,
  }
}

export function closeOwner(owner: PortfolioDatabaseOwner): void {
  must(owner.close())
}

export async function applyPersistedEvidence<T>(
  committed: CommittedExecutionResult<T>,
  handler: (payload: ExecutionEvidencePayload) => void,
): Promise<void> {
  for (const payload of committed.postCommitEvidence) handler(payload)
}
