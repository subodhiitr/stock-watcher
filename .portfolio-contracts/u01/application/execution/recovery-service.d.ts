import { type ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ExecutionProgressEvidence } from '../../domain/execution/evidence.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerAccountBindingId, PortfolioId } from '../../domain/shared/identifiers.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { BrokerRecoveryCapability } from '../../ports/execution/broker-port.ts';
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import { StatusFillCoordinator, type CheckOrderCommand } from './status-fill-coordinator.ts';
export interface RecoveryPreflight {
    verify(portfolioId: PortfolioId): Promise<DomainResult<void>>;
}
export type RecoverPortfolioCommand = Readonly<{
    portfolioId: PortfolioId;
    accountBindingId: BrokerAccountBindingId;
    deadlineAt: Instant;
    preflight: RecoveryPreflight;
    statusCheck(order: ExecutionOrderSnapshot): Omit<CheckOrderCommand, 'order'>;
}>;
export type RecoveryResult = Readonly<{
    orders: readonly ExecutionOrderSnapshot[];
    progress?: ExecutionProgressEvidence;
    reconciliationRequired: boolean;
}>;
export declare class RecoveryService {
    private readonly unitOfWork;
    private readonly broker;
    private readonly statusFill;
    private readonly clock;
    constructor(unitOfWork: ExecutionUnitOfWork, broker: BrokerRecoveryCapability, statusFill: StatusFillCoordinator, clock: ExecutionClockPort);
    recover(command: RecoverPortfolioCommand): Promise<DomainResult<CommittedExecutionResult<RecoveryResult>, AnyDomainFailure>>;
    private classifyInFlightUnknown;
    private queryUnknown;
}
