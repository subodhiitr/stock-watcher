import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, type DomainResult } from '../../domain/errors/result.ts'
import type {
  BrokerPlacementCapability,
  BrokerRecoveryCapability,
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
import type {
  BoundedTimerPort,
  DeterministicSeedPort,
  ExecutionClockPort,
} from '../../ports/execution/runtime-port.ts'

export type BrokerResilienceConfiguration = Readonly<{
  maximumConcurrentReads: number
  maximumConcurrentWrites: number
  safeReadRetries: number
  circuitFailureThreshold: number
  circuitCooldownMs: number
  retryBaseDelayMs: number
  retryMaximumJitterMs: number
  maximumDeadlineMs: number
}>

const DEFAULT_CONFIGURATION: BrokerResilienceConfiguration = Object.freeze({
  maximumConcurrentReads: 8,
  maximumConcurrentWrites: 2,
  safeReadRetries: 2,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 30_000,
  retryBaseDelayMs: 100,
  retryMaximumJitterMs: 100,
  maximumDeadlineMs: 120_000,
})

type CircuitState = {
  failures: number
  openUntilMs: number
}

type OperationName =
  | 'PLACE'
  | 'CANCEL'
  | 'STATUS'
  | 'FILLS'
  | 'RECONCILIATION'

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

export class BrokerResilienceGovernor implements BrokerPlacementCapability {
  private readonly broker: BrokerPlacementCapability
  private readonly clock: ExecutionClockPort
  private readonly timers: BoundedTimerPort
  private readonly seed: DeterministicSeedPort
  private readonly configuration: BrokerResilienceConfiguration
  private readonly circuits = new Map<OperationName, CircuitState>()
  private readsInFlight = 0
  private writesInFlight = 0

  public constructor(
    broker: BrokerPlacementCapability,
    clock: ExecutionClockPort,
    timers: BoundedTimerPort,
    seed: DeterministicSeedPort,
    configuration: Partial<BrokerResilienceConfiguration> = {},
  ) {
    this.broker = broker
    this.clock = clock
    this.timers = timers
    this.seed = seed
    this.configuration = Object.freeze({
      ...DEFAULT_CONFIGURATION,
      ...configuration,
    })
    const values = Object.values(this.configuration)
    if (
      values.some((value) => !Number.isSafeInteger(value) || value < 0)
      || !validPositiveInteger(this.configuration.maximumConcurrentReads)
      || !validPositiveInteger(this.configuration.maximumConcurrentWrites)
      || !validPositiveInteger(this.configuration.circuitFailureThreshold)
      || !validPositiveInteger(this.configuration.maximumDeadlineMs)
    ) {
      throw new TypeError('INVALID_BROKER_RESILIENCE_CONFIGURATION')
    }
  }

  private circuitOpen(operation: OperationName): boolean {
    const state = this.circuits.get(operation)
    if (state === undefined) return false
    if (Date.parse(this.clock.now()) >= state.openUntilMs) {
      this.circuits.delete(operation)
      return false
    }
    return true
  }

  private recordSuccess(operation: OperationName): void {
    this.circuits.delete(operation)
  }

  private recordFailure(operation: OperationName): void {
    const state = this.circuits.get(operation) ?? {
      failures: 0,
      openUntilMs: 0,
    }
    state.failures += 1
    if (state.failures >= this.configuration.circuitFailureThreshold) {
      state.openUntilMs =
        Date.parse(this.clock.now()) + this.configuration.circuitCooldownMs
    }
    this.circuits.set(operation, state)
  }

  private acquire(kind: 'READ' | 'WRITE'): (() => void) | undefined {
    if (kind === 'READ') {
      if (this.readsInFlight >= this.configuration.maximumConcurrentReads) {
        return undefined
      }
      this.readsInFlight += 1
      return () => {
        this.readsInFlight -= 1
      }
    }
    if (this.writesInFlight >= this.configuration.maximumConcurrentWrites) {
      return undefined
    }
    this.writesInFlight += 1
    return () => {
      this.writesInFlight -= 1
    }
  }

  private deadlineRemaining(deadlineAt: string): number {
    return Date.parse(deadlineAt) - Date.parse(this.clock.now())
  }

  private async withDeadline<T>(
    deadlineAt: string,
    call: () => Promise<DomainResult<T>>,
    release: () => void,
  ): Promise<DomainResult<T>> {
    const remaining = this.deadlineRemaining(deadlineAt)
    if (
      !Number.isFinite(remaining)
      || remaining <= 0
      || remaining > this.configuration.maximumDeadlineMs
    ) {
      release()
      return failure(domainFailure('PROVIDER_DEADLINE_EXCEEDED', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    let resolveDeadline: ((result: DomainResult<T>) => void) | undefined
    const deadline = new Promise<DomainResult<T>>((resolve) => {
      resolveDeadline = resolve
    })
    const scheduled = this.timers.schedule(() => {
      resolveDeadline?.(failure(domainFailure('PROVIDER_DEADLINE_EXCEEDED', {
        retryability: 'AFTER_STATE_REFRESH',
      })))
    }, Math.max(1, Math.ceil(remaining)), this.configuration.maximumDeadlineMs)
    if (!scheduled.ok) {
      release()
      return scheduled
    }

    const underlying = call()
      .catch(() => failure(domainFailure('PROVIDER_UNAVAILABLE', {
        retryability: 'AFTER_STATE_REFRESH',
      })))
      .finally(() => {
        release()
      })
    const result = await Promise.race([underlying, deadline])
    scheduled.value.cancel()
    return result
  }

  private async runRead<T>(
    operation: OperationName,
    deadlineAt: string,
    call: (broker: BrokerRecoveryCapability) => Promise<DomainResult<T>>,
  ): Promise<DomainResult<T>> {
    if (this.circuitOpen(operation)) {
      return failure(domainFailure('CIRCUIT_OPEN', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    let last: DomainResult<T> | undefined
    for (let attempt = 0; attempt <= this.configuration.safeReadRetries; attempt += 1) {
      const release = this.acquire('READ')
      if (release === undefined) {
        return failure(domainFailure('CAPACITY_EXCEEDED', {
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      last = await this.withDeadline(
        deadlineAt,
        () => call(this.broker),
        release,
      )
      if (last.ok) {
        this.recordSuccess(operation)
        return last
      }
      this.recordFailure(operation)
      if (
        attempt < this.configuration.safeReadRetries
        && !this.circuitOpen(operation)
      ) {
        const jitter = this.seed.nextInt(
          0,
          this.configuration.retryMaximumJitterMs,
        )
        const delay = this.configuration.retryBaseDelayMs * (2 ** attempt) + jitter
        const waited = await this.timers.delay(
          delay,
          this.configuration.maximumDeadlineMs,
        )
        if (!waited.ok) return waited
      }
    }
    return last ?? failure(domainFailure('PROVIDER_UNAVAILABLE', {
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }

  public async placeOrder(
    request: PlacementRequest,
  ): Promise<DomainResult<PlacementResult>> {
    const now = this.clock.now()
    if (this.circuitOpen('PLACE')) {
      return {
        ok: true,
        value: Object.freeze({
          submissionAttemptId: request.submissionAttemptId,
          certainty: 'DEFINITELY_NOT_SENT',
          attemptedAt: now,
          completedAt: now,
          failure: Object.freeze({
            failureCode: 'CIRCUIT_OPEN',
            certainty: 'DEFINITELY_NOT_SENT',
            redactedDetail: 'PLACEMENT_CIRCUIT_OPEN',
          }),
        }),
      }
    }
    const release = this.acquire('WRITE')
    if (release === undefined || this.deadlineRemaining(request.deadlineAt) <= 0) {
      release?.()
      return {
        ok: true,
        value: Object.freeze({
          submissionAttemptId: request.submissionAttemptId,
          certainty: 'DEFINITELY_NOT_SENT',
          attemptedAt: now,
          completedAt: now,
          failure: Object.freeze({
            failureCode: release === undefined
              ? 'CAPACITY_EXCEEDED'
              : 'PROVIDER_DEADLINE_EXCEEDED',
            certainty: 'DEFINITELY_NOT_SENT',
            redactedDetail: release === undefined
              ? 'PLACEMENT_BULKHEAD_FULL'
              : 'PLACEMENT_DEADLINE_ELAPSED',
          }),
        }),
      }
    }
    const result = await this.withDeadline(
      request.deadlineAt,
      () => this.broker.placeOrder(request),
      release,
    )
    if (result.ok) this.recordSuccess('PLACE')
    else this.recordFailure('PLACE')
    return result
  }

  public async cancelOrder(
    request: CancellationRequest,
  ): Promise<DomainResult<CancellationResult>> {
    if (this.circuitOpen('CANCEL')) {
      return failure(domainFailure('CIRCUIT_OPEN', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const release = this.acquire('WRITE')
    if (release === undefined) {
      return failure(domainFailure('CAPACITY_EXCEEDED', {
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const result = await this.withDeadline(
      request.deadlineAt,
      () => this.broker.cancelOrder(request),
      release,
    )
    if (result.ok) this.recordSuccess('CANCEL')
    else this.recordFailure('CANCEL')
    return result
  }

  public fetchOrderStatus(
    request: OrderStatusRequest,
  ): Promise<DomainResult<OrderStatusResult>> {
    return this.runRead(
      'STATUS',
      request.deadlineAt,
      (broker) => broker.fetchOrderStatus(request),
    )
  }

  public collectFills(
    request: FillCollectionRequest,
  ): Promise<DomainResult<FillCollectionResult>> {
    return this.runRead(
      'FILLS',
      request.deadlineAt,
      (broker) => broker.collectFills(request),
    )
  }

  public collectReconciliationSnapshot(
    request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>> {
    return this.runRead(
      'RECONCILIATION',
      request.deadlineAt,
      (broker) => broker.collectReconciliationSnapshot(request),
    )
  }
}
