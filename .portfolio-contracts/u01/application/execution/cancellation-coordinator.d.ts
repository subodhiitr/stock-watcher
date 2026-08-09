import { type ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ReconciliationRunSnapshot } from '../../domain/execution/reconciliation.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerAccountBindingId, IdempotencyKey } from '../../domain/shared/identifiers.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { BrokerPlacementCapability } from '../../ports/execution/broker-port.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionClockPort, ExecutionIdentifierFactory } from '../../ports/execution/runtime-port.ts';
import { StatusFillCoordinator, type CheckOrderCommand } from './status-fill-coordinator.ts';
import { type TerminalReservationRelease } from './placement-coordinator.ts';
export type CancelOrderCommand = Readonly<{
    order: ExecutionOrderSnapshot;
    accountBindingId: BrokerAccountBindingId;
    requestedBy: string;
    reasonCode: string;
    idempotencyKey: IdempotencyKey;
    deadlineAt: Instant;
    statusCheck: Omit<CheckOrderCommand, 'order'>;
}>;
export type ConfirmCancellationCommand = Readonly<{
    orderId: ExecutionOrderSnapshot['orderId'];
    reconciliation: ReconciliationRunSnapshot;
}>;
export declare class CancellationCoordinator {
    private readonly unitOfWork;
    private readonly broker;
    private readonly statusFill;
    private readonly clock;
    private readonly ids;
    private readonly terminalRelease;
    constructor(unitOfWork: ExecutionUnitOfWork, broker: BrokerPlacementCapability, statusFill: StatusFillCoordinator, clock: ExecutionClockPort, ids: ExecutionIdentifierFactory, terminalRelease: TerminalReservationRelease);
    request(command: CancelOrderCommand): Promise<DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure>>;
    confirmTerminal(command: ConfirmCancellationCommand): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure>;
}
