import { type DomainResult } from '../../domain/errors/result.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { CancellationRequest, CancellationResult, FillCollectionRequest, FillCollectionResult, OrderStatusRequest, OrderStatusResult, PlacementRequest, PlacementResult, ReconciliationSnapshotRequest, ReconciliationSnapshotResponse } from '../../ports/execution/broker-port.ts';
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
export type DryRunRecord = Readonly<{
    status: 'DRY_RUN_RECORDED';
    orderId: PlacementRequest['orderId'];
    submissionAttemptId: PlacementRequest['submissionAttemptId'];
    normalizedRequest: string;
    requestHash: IntegrityHash;
    recordedAt: ReturnType<ExecutionClockPort['now']>;
}>;
export declare class DryRunBroker {
    private readonly clock;
    private readonly recorded;
    constructor(clock: ExecutionClockPort);
    recordOrder(request: PlacementRequest): DomainResult<DryRunRecord>;
    records(): readonly DryRunRecord[];
    placeOrder(request: PlacementRequest): Promise<DomainResult<PlacementResult>>;
    cancelOrder(_request: CancellationRequest): Promise<DomainResult<CancellationResult>>;
    fetchOrderStatus(_request: OrderStatusRequest): Promise<DomainResult<OrderStatusResult>>;
    collectFills(_request: FillCollectionRequest): Promise<DomainResult<FillCollectionResult>>;
    collectReconciliationSnapshot(_request: ReconciliationSnapshotRequest): Promise<DomainResult<ReconciliationSnapshotResponse>>;
}
