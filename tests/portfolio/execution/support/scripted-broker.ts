import type {
  BrokerPlacementCapability,
  CancellationRequest,
  CancellationResult,
  FillCollectionRequest,
  FillCollectionResult,
  OrderStatusRequest,
  OrderStatusResult,
  PlacementRequest,
  PlacementResult,
  ReconciliationSnapshotRequest,
  ReconciliationSnapshotResponse,
} from '../../../../server/portfolio/execution.ts'
import { domainFailure } from '../../../../server/portfolio/domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../../../server/portfolio/domain/errors/result.ts'
import type { ExecutionClockPort } from '../../../../server/portfolio/execution.ts'
import {
  FIXTURE_IDS,
  INSTRUMENT_A,
  INSTRUMENT_B,
  TEST_LATER,
  TEST_NOW,
  makeBrokerReference,
  makeExecutionWindow,
  makeIntegrityHash,
  makeMapping,
  makeNormalizedFill,
  makeOrderIntent,
  makeReconciliationSnapshot,
  money,
  quantity,
} from './fixtures.ts'

type Step<T> = T | DomainResult<T>
type QueueMap = {
  place: Step<PlacementResult>[]
  cancel: Step<CancellationResult>[]
  status: Step<OrderStatusResult>[]
  fills: Step<FillCollectionResult>[]
  reconciliation: Step<ReconciliationSnapshotResponse>[]
}

export type ScriptedScenario =
  | 'buy-only'
  | 'sell-only'
  | 'mixed'
  | 'no-trade'
  | 'zero-affordability'
  | 'rejection'
  | 'ambiguity'
  | 'race-fill'
  | 'external-mismatch'
  | 'kill-reset'
  | 'restart-recovery'

function ok<T>(value: T): DomainResult<T> {
  return success(value)
}

function unavailable<T>(field: string): DomainResult<T> {
  return failure(domainFailure('BROKER_SNAPSHOT_INCOHERENT', {
    field,
    retryability: 'AFTER_STATE_REFRESH',
  }))
}

export class ScriptedBroker implements BrokerPlacementCapability {
  readonly #clock: ExecutionClockPort
  readonly #queues: QueueMap

  public readonly calls = {
    place: [] as PlacementRequest[],
    cancel: [] as CancellationRequest[],
    status: [] as OrderStatusRequest[],
    fills: [] as FillCollectionRequest[],
    reconciliation: [] as ReconciliationSnapshotRequest[],
  }

  public constructor(
    clock: ExecutionClockPort,
    queues: Partial<QueueMap> = {},
  ) {
    this.#clock = clock
    this.#queues = {
      place: [...(queues.place ?? [])],
      cancel: [...(queues.cancel ?? [])],
      status: [...(queues.status ?? [])],
      fills: [...(queues.fills ?? [])],
      reconciliation: [...(queues.reconciliation ?? [])],
    }
  }

  public enqueuePlacement(...steps: Step<PlacementResult>[]): this {
    this.#queues.place.push(...steps)
    return this
  }

  public enqueueCancellation(...steps: Step<CancellationResult>[]): this {
    this.#queues.cancel.push(...steps)
    return this
  }

  public enqueueStatus(...steps: Step<OrderStatusResult>[]): this {
    this.#queues.status.push(...steps)
    return this
  }

  public enqueueFills(...steps: Step<FillCollectionResult>[]): this {
    this.#queues.fills.push(...steps)
    return this
  }

  public enqueueReconciliation(...steps: Step<ReconciliationSnapshotResponse>[]): this {
    this.#queues.reconciliation.push(...steps)
    return this
  }

  async placeOrder(request: PlacementRequest): Promise<DomainResult<PlacementResult>> {
    this.calls.place.push(request)
    return this.shift('place')
  }

  async cancelOrder(request: CancellationRequest): Promise<DomainResult<CancellationResult>> {
    this.calls.cancel.push(request)
    return this.shift('cancel')
  }

  async fetchOrderStatus(request: OrderStatusRequest): Promise<DomainResult<OrderStatusResult>> {
    this.calls.status.push(request)
    return this.shift('status')
  }

  async collectFills(request: FillCollectionRequest): Promise<DomainResult<FillCollectionResult>> {
    this.calls.fills.push(request)
    return this.shift('fills')
  }

  async collectReconciliationSnapshot(
    request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>> {
    this.calls.reconciliation.push(request)
    return this.shift('reconciliation')
  }

  shift<K extends keyof QueueMap>(
    key: K,
  ): DomainResult<QueueMap[K][number] extends Step<infer T> ? T : never> {
    const next = this.#queues[key].shift() as Step<unknown> | undefined
    if (next === undefined) return unavailable(String(key)) as never
    if (typeof next === 'object' && next !== null && 'ok' in next) {
      return next as never
    }
    return ok(next as never) as never
  }

  static scenario(
    name: ScriptedScenario,
    clock: ExecutionClockPort,
  ): ScriptedBroker {
    const broker = new ScriptedBroker(clock)
    const acknowledged = Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      certainty: 'ACKNOWLEDGED' as const,
      brokerReference: makeBrokerReference('scripted:ack'),
      attemptedAt: TEST_NOW,
      completedAt: TEST_NOW,
    })
    const rejected = Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      certainty: 'REJECTED' as const,
      attemptedAt: TEST_NOW,
      completedAt: TEST_NOW,
      failure: Object.freeze({
        failureCode: 'ORDER_REJECTED' as const,
        certainty: 'REJECTED' as const,
        redactedDetail: 'SCRIPTED_REJECTED',
      }),
    })
    const ambiguous = Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      certainty: 'UNKNOWN' as const,
      attemptedAt: TEST_NOW,
      completedAt: TEST_NOW,
      failure: Object.freeze({
        failureCode: 'SUBMISSION_OUTCOME_UNKNOWN' as const,
        certainty: 'UNKNOWN' as const,
        redactedDetail: 'SCRIPTED_UNKNOWN',
      }),
    })
    const openStatus = Object.freeze({
      orderId: FIXTURE_IDS.orderSellId,
      snapshot: Object.freeze({
        brokerReference: makeBrokerReference('scripted:open'),
        status: 'OPEN' as const,
        orderedQuantity: quantity(10n),
        filledQuantity: quantity(0n),
        openQuantity: quantity(10n),
        asOf: TEST_NOW,
        cursor: 'cursor:open',
      }),
      asOf: TEST_NOW,
      cursor: 'cursor:open',
    })
    const filledStatus = Object.freeze({
      orderId: FIXTURE_IDS.orderSellId,
      snapshot: Object.freeze({
        brokerReference: makeBrokerReference('scripted:filled'),
        status: 'FILLED' as const,
        orderedQuantity: quantity(10n),
        filledQuantity: quantity(10n),
        openQuantity: quantity(0n),
        averageFillPrice: money(12_400n),
        asOf: TEST_LATER,
        cursor: 'cursor:filled',
      }),
      asOf: TEST_LATER,
      cursor: 'cursor:filled',
    })
    const singleFill = Object.freeze({
      fills: Object.freeze([makeNormalizedFill()]),
      asOf: TEST_LATER,
      coherent: true,
    })
    const mismatchSnapshot = Object.freeze({
      snapshot: makeReconciliationSnapshot({
        source: 'PAPER',
        snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
        holdings: Object.freeze([Object.freeze({
          instrumentId: INSTRUMENT_B as never,
          totalQuantity: quantity(3n),
          availableDeliveryQuantity: quantity(3n),
          reservedQuantity: quantity(0n),
          averageCost: money(8_000n),
          mappingHash: makeIntegrityHash('mismatch'),
        })]),
      }),
      coherent: true,
    })
    switch (name) {
      case 'buy-only':
        broker
          .enqueuePlacement(Object.freeze({
            ...acknowledged,
            brokerReference: makeBrokerReference('scripted:buy'),
          }))
          .enqueueStatus(Object.freeze({
            ...filledStatus,
            snapshot: Object.freeze({
              ...filledStatus.snapshot,
              brokerReference: makeBrokerReference('scripted:buy'),
            }),
          }))
          .enqueueFills(Object.freeze({
            ...singleFill,
            fills: Object.freeze([makeNormalizedFill({
              orderId: FIXTURE_IDS.orderBuyId,
              instrumentId: INSTRUMENT_B as never,
              side: 'BUY',
              quantity: quantity(4n),
              price: money(8_000n),
            })]),
          }))
          .enqueueReconciliation(ok({
            snapshot: makeReconciliationSnapshot({
              source: 'PAPER',
              snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
              cash: money(99_968_000n),
              holdings: Object.freeze([
                ...makeReconciliationSnapshot().holdings,
                Object.freeze({
                  instrumentId: INSTRUMENT_B as never,
                  totalQuantity: quantity(4n),
                  availableDeliveryQuantity: quantity(4n),
                  reservedQuantity: quantity(0n),
                  averageCost: money(8_000n),
                  mappingHash: makeIntegrityHash('buy-only'),
                }),
              ]),
              fills: Object.freeze([makeNormalizedFill({
                orderId: FIXTURE_IDS.orderBuyId,
                instrumentId: INSTRUMENT_B as never,
                side: 'BUY',
                quantity: quantity(4n),
                price: money(8_000n),
              })]),
            }),
            coherent: true,
          }))
        return broker
      case 'sell-only':
        broker
          .enqueuePlacement(acknowledged)
          .enqueueStatus(filledStatus)
          .enqueueFills(singleFill)
          .enqueueReconciliation(ok({
            snapshot: makeReconciliationSnapshot({
              source: 'PAPER',
              snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
              cash: money(100_124_000n),
              fills: Object.freeze([makeNormalizedFill()]),
            }),
            coherent: true,
          }))
        return broker
      case 'mixed':
        broker
          .enqueuePlacement(
            Object.freeze({ ...acknowledged, brokerReference: makeBrokerReference('scripted:sell') }),
            Object.freeze({ ...acknowledged, brokerReference: makeBrokerReference('scripted:buy-mixed') }),
          )
          .enqueueStatus(openStatus, filledStatus)
          .enqueueFills(
            Object.freeze({
              fills: Object.freeze([]),
              nextCursor: 'cursor:mixed-1',
              asOf: TEST_NOW,
              coherent: true,
            }),
            singleFill,
          )
          .enqueueReconciliation(ok({
            snapshot: makeReconciliationSnapshot({
              source: 'PAPER',
              snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
              cash: money(100_124_000n),
              fills: Object.freeze([makeNormalizedFill()]),
            }),
            coherent: true,
          }))
        return broker
      case 'no-trade':
        broker
          .enqueueStatus(openStatus)
          .enqueueFills(Object.freeze({
            fills: Object.freeze([]),
            asOf: TEST_NOW,
            coherent: true,
          }))
          .enqueueReconciliation(ok({
            snapshot: makeReconciliationSnapshot({
              source: 'PAPER',
              snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
            }),
            coherent: true,
          }))
        return broker
      case 'zero-affordability':
        broker.enqueuePlacement(rejected)
        return broker
      case 'rejection':
        broker
          .enqueuePlacement(rejected)
          .enqueueStatus(Object.freeze({
            ...openStatus,
            snapshot: Object.freeze({
              ...openStatus.snapshot,
              status: 'REJECTED' as const,
              openQuantity: quantity(0n),
            }),
          }))
        return broker
      case 'ambiguity':
        broker.enqueuePlacement(ambiguous)
        return broker
      case 'race-fill':
        broker
          .enqueuePlacement(acknowledged)
          .enqueueCancellation(ok({
            cancellationId: FIXTURE_IDS.cancellationId,
            outcome: 'UNKNOWN',
            brokerAsOf: TEST_LATER,
            completedAt: TEST_LATER,
          }))
          .enqueueStatus(Object.freeze({
            ...filledStatus,
            snapshot: Object.freeze({
              ...filledStatus.snapshot,
              status: 'FILLED' as const,
            }),
          }))
          .enqueueFills(singleFill)
        return broker
      case 'external-mismatch':
        broker
          .enqueuePlacement(acknowledged)
          .enqueueStatus(openStatus)
          .enqueueFills(singleFill)
          .enqueueReconciliation(ok(mismatchSnapshot))
        return broker
      case 'kill-reset':
        broker
          .enqueuePlacement(acknowledged)
          .enqueueCancellation(ok({
            cancellationId: FIXTURE_IDS.cancellationId,
            outcome: 'ACKNOWLEDGED',
            brokerAsOf: thisNow(clock),
            completedAt: thisNow(clock),
          }))
          .enqueueStatus(Object.freeze({
            ...openStatus,
            snapshot: Object.freeze({
              ...openStatus.snapshot,
              status: 'CANCELLED' as const,
              openQuantity: quantity(0n),
            }),
          }))
        return broker
      case 'restart-recovery':
        broker
          .enqueueStatus(openStatus)
          .enqueueFills(singleFill)
          .enqueueReconciliation(ok({
            snapshot: makeReconciliationSnapshot({
              source: 'PAPER',
              snapshotId: FIXTURE_IDS.reconciliationSnapshotTwoId,
              fills: Object.freeze([makeNormalizedFill()]),
            }),
            coherent: true,
          }))
        return broker
    }
  }
}

function thisNow(clock: ExecutionClockPort) {
  return clock.now()
}

export function makePlacementRequest(
  overrides: Partial<PlacementRequest> = {},
): PlacementRequest {
  const intent = makeOrderIntent(overrides.intent)
  return Object.freeze({
    submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
    orderId: intent.orderId,
    portfolioId: intent.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    intent,
    deadlineAt: TEST_LATER,
    ...overrides,
  })
}

export function makeScriptedBroker(
  scenario: ScriptedScenario,
  clock: ExecutionClockPort,
): ScriptedBroker {
  return ScriptedBroker.scenario(scenario, clock)
}
