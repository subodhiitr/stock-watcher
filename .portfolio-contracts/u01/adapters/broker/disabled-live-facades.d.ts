import { type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerPlacementCapability, CancellationRequest, CancellationResult, FillCollectionRequest, FillCollectionResult, OrderStatusRequest, OrderStatusResult, PlacementRequest, PlacementResult, ReconciliationSnapshotRequest, ReconciliationSnapshotResponse } from '../../ports/execution/broker-port.ts';
export type ReviewedLivePlacement = Readonly<{
    status: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN';
    brokerOrderId?: string;
    attemptedAt: PlacementResult['attemptedAt'];
    completedAt: PlacementResult['completedAt'];
}>;
export declare function normalizeReviewedZerodhaPlacement(request: PlacementRequest, response: ReviewedLivePlacement): DomainResult<PlacementResult>;
declare abstract class DisabledLiveBrokerFacade implements BrokerPlacementCapability {
    readonly certified: false;
    placeOrder(_request: PlacementRequest): Promise<DomainResult<PlacementResult>>;
    cancelOrder(_request: CancellationRequest): Promise<DomainResult<CancellationResult>>;
    fetchOrderStatus(_request: OrderStatusRequest): Promise<DomainResult<OrderStatusResult>>;
    collectFills(_request: FillCollectionRequest): Promise<DomainResult<FillCollectionResult>>;
    collectReconciliationSnapshot(_request: ReconciliationSnapshotRequest): Promise<DomainResult<ReconciliationSnapshotResponse>>;
}
export declare class DisabledZerodhaBrokerFacade extends DisabledLiveBrokerFacade {
    readonly broker: "ZERODHA";
}
export type SharekhanReviewedProduct = 'DELIVERY' | 'INTRADAY' | 'UNKNOWN';
export declare function normalizeSharekhanDeliveryProduct(product: SharekhanReviewedProduct): DomainResult<'CNC'>;
export declare function normalizeReviewedSharekhanPlacement(request: PlacementRequest, product: SharekhanReviewedProduct, response: ReviewedLivePlacement): DomainResult<PlacementResult>;
export declare class DisabledSharekhanBrokerFacade extends DisabledLiveBrokerFacade {
    readonly broker: "SHAREKHAN";
}
export {};
