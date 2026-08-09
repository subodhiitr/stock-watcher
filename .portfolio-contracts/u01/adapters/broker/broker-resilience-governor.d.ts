import { type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerPlacementCapability, CancellationRequest, CancellationResult, FillCollectionRequest, FillCollectionResult, OrderStatusRequest, OrderStatusResult, PlacementRequest, PlacementResult, ReconciliationSnapshotRequest, ReconciliationSnapshotResponse } from '../../ports/execution/broker-port.ts';
import type { BoundedTimerPort, DeterministicSeedPort, ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
export type BrokerResilienceConfiguration = Readonly<{
    maximumConcurrentReads: number;
    maximumConcurrentWrites: number;
    safeReadRetries: number;
    circuitFailureThreshold: number;
    circuitCooldownMs: number;
    retryBaseDelayMs: number;
    retryMaximumJitterMs: number;
    maximumDeadlineMs: number;
}>;
export declare class BrokerResilienceGovernor implements BrokerPlacementCapability {
    private readonly broker;
    private readonly clock;
    private readonly timers;
    private readonly seed;
    private readonly configuration;
    private readonly circuits;
    private readsInFlight;
    private writesInFlight;
    constructor(broker: BrokerPlacementCapability, clock: ExecutionClockPort, timers: BoundedTimerPort, seed: DeterministicSeedPort, configuration?: Partial<BrokerResilienceConfiguration>);
    private circuitOpen;
    private recordSuccess;
    private recordFailure;
    private acquire;
    private deadlineRemaining;
    private withDeadline;
    private runRead;
    placeOrder(request: PlacementRequest): Promise<DomainResult<PlacementResult>>;
    cancelOrder(request: CancellationRequest): Promise<DomainResult<CancellationResult>>;
    fetchOrderStatus(request: OrderStatusRequest): Promise<DomainResult<OrderStatusResult>>;
    collectFills(request: FillCollectionRequest): Promise<DomainResult<FillCollectionResult>>;
    collectReconciliationSnapshot(request: ReconciliationSnapshotRequest): Promise<DomainResult<ReconciliationSnapshotResponse>>;
}
