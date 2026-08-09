import { canonicalExecutionJson, hashExecutionValue } from '../../domain/execution/canonical-codec.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type {
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
} from '../../ports/execution/broker-port.ts'
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts'

export type DryRunRecord = Readonly<{
  status: 'DRY_RUN_RECORDED'
  orderId: PlacementRequest['orderId']
  submissionAttemptId: PlacementRequest['submissionAttemptId']
  normalizedRequest: string
  requestHash: IntegrityHash
  recordedAt: ReturnType<ExecutionClockPort['now']>
}>

function forbidden<T>(): DomainResult<T> {
  return failure(domainFailure('DRY_RUN_SUCCESS_MISREPRESENTED', {
    retryability: 'NEVER',
  }))
}

export class DryRunBroker {
  private readonly clock: ExecutionClockPort
  private readonly recorded = new Map<string, DryRunRecord>()

  public constructor(clock: ExecutionClockPort) {
    this.clock = clock
  }

  public recordOrder(request: PlacementRequest): DomainResult<DryRunRecord> {
    const existing = this.recorded.get(request.submissionAttemptId)
    if (existing !== undefined) return success(existing)
    const normalized = canonicalExecutionJson({
      accountBindingId: request.accountBindingId,
      deadlineAt: request.deadlineAt,
      intent: request.intent,
      orderId: request.orderId,
      portfolioId: request.portfolioId,
      submissionAttemptId: request.submissionAttemptId,
    })
    if (!normalized.ok) return normalized
    const requestHash = hashExecutionValue(
      'dry-run-request',
      JSON.parse(normalized.value),
    )
    if (!requestHash.ok) return requestHash
    const record = Object.freeze({
      status: 'DRY_RUN_RECORDED' as const,
      orderId: request.orderId,
      submissionAttemptId: request.submissionAttemptId,
      normalizedRequest: normalized.value,
      requestHash: requestHash.value,
      recordedAt: this.clock.now(),
    })
    this.recorded.set(request.submissionAttemptId, record)
    return success(record)
  }

  public records(): readonly DryRunRecord[] {
    return Object.freeze(
      [...this.recorded.values()].sort((left, right) =>
        left.submissionAttemptId.localeCompare(right.submissionAttemptId)),
    )
  }

  public async placeOrder(request: PlacementRequest): Promise<DomainResult<PlacementResult>> {
    const recorded = this.recordOrder(request)
    return recorded.ok ? forbidden() : recorded
  }

  public async cancelOrder(
    _request: CancellationRequest,
  ): Promise<DomainResult<CancellationResult>> {
    return forbidden()
  }

  public async fetchOrderStatus(
    _request: OrderStatusRequest,
  ): Promise<DomainResult<OrderStatusResult>> {
    return forbidden()
  }

  public async collectFills(
    _request: FillCollectionRequest,
  ): Promise<DomainResult<FillCollectionResult>> {
    return forbidden()
  }

  public async collectReconciliationSnapshot(
    _request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>> {
    return forbidden()
  }
}
