import type { OrderIntentPayload } from '../../domain/execution/contracts.ts';
import type { ReconciledHolding } from '../../domain/execution/reconciliation.ts';
import { type DomainResult } from '../../domain/errors/result.ts';
import { type BrokerAccountBindingId, type PortfolioId } from '../../domain/shared/identifiers.ts';
import { type Money } from '../../domain/shared/money.ts';
import type { BrokerPlacementCapability, CancellationRequest, CancellationResult, FillCollectionRequest, FillCollectionResult, OrderStatusRequest, OrderStatusResult, PlacementRequest, PlacementResult, ReconciliationSnapshotRequest, ReconciliationSnapshotResponse } from '../../ports/execution/broker-port.ts';
import type { DeterministicSeedPort, ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
export type PaperAccountSeed = Readonly<{
    portfolioId: PortfolioId;
    accountBindingId: BrokerAccountBindingId;
    cash: Money;
    holdings?: readonly ReconciledHolding[];
}>;
export type PaperFillDecision = Readonly<{
    kind: 'FILL_FULL';
}> | Readonly<{
    kind: 'LEAVE_OPEN';
}> | Readonly<{
    kind: 'REJECT';
}>;
export interface PaperFillPolicy {
    decide(intent: OrderIntentPayload, seed: DeterministicSeedPort): PaperFillDecision;
}
export declare class ImmediatePaperFillPolicy implements PaperFillPolicy {
    decide(): PaperFillDecision;
}
export declare class DeterministicPaperBroker implements BrokerPlacementCapability {
    private readonly clock;
    private readonly seed;
    private readonly fillPolicy;
    private readonly accounts;
    private readonly orders;
    private readonly placementResults;
    private readonly cancellationResults;
    constructor(clock: ExecutionClockPort, seed: DeterministicSeedPort, accounts: readonly PaperAccountSeed[], fillPolicy?: PaperFillPolicy);
    private account;
    placeOrder(request: PlacementRequest): Promise<DomainResult<PlacementResult>>;
    private applyFullFill;
    private reserveOpenOrder;
    private releaseOpenReservation;
    cancelOrder(request: CancellationRequest): Promise<DomainResult<CancellationResult>>;
    fetchOrderStatus(request: OrderStatusRequest): Promise<DomainResult<OrderStatusResult>>;
    collectFills(request: FillCollectionRequest): Promise<DomainResult<FillCollectionResult>>;
    collectReconciliationSnapshot(request: ReconciliationSnapshotRequest): Promise<DomainResult<ReconciliationSnapshotResponse>>;
}
