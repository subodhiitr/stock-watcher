import type { AccountingDelta, LotMutation } from '../../domain/execution/fill-accounting.ts';
import type { NormalizedFill } from '../../domain/execution/contracts.ts';
import type { ExecutionRunPortfolioVersionEvidencePayload, PortfolioAccountingEvidencePayload } from '../../domain/execution/evidence.ts';
import { type ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { BrokerAccountBindingId, PortfolioId } from '../../domain/shared/identifiers.ts';
import type { BrokerRecoveryCapability, FillCollectionResult, OrderStatusResult } from '../../ports/execution/broker-port.ts';
import type { CommittedExecutionResult, ExecutionTransaction, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { BoundedTimerPort, ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
import { type TerminalReservationRelease } from './placement-coordinator.ts';
export type AtomicFillAccountingResult = Readonly<{
    accountingEvidence: PortfolioAccountingEvidencePayload;
    run: ExecutionRunSnapshot;
    runEvidence: ExecutionRunPortfolioVersionEvidencePayload;
}>;
export interface AtomicFillAccounting {
    apply(transaction: ExecutionTransaction, orderBeforeReservationRelease: ExecutionOrderSnapshot, orderAfterReservationRelease: ExecutionOrderSnapshot, fill: NormalizedFill, delta: AccountingDelta): DomainResult<AtomicFillAccountingResult>;
}
export type FillAccountingContext = Readonly<{
    fillLotId?: string;
    existingLotCount?: number;
    sellLotMutations?: readonly LotMutation[];
}>;
export type CheckOrderCommand = Readonly<{
    order: ExecutionOrderSnapshot;
    portfolioId: PortfolioId;
    accountBindingId: BrokerAccountBindingId;
    deadlineAt: Instant;
    fromCursor?: string;
    accountingContext(fill: NormalizedFill): DomainResult<FillAccountingContext>;
}>;
export type StatusFillCheckResult = Readonly<{
    order: ExecutionOrderSnapshot;
    status: OrderStatusResult;
    fills: FillCollectionResult;
    reconciliationRequired: boolean;
}>;
export declare class StatusFillCoordinator {
    private readonly unitOfWork;
    private readonly broker;
    private readonly accounting;
    private readonly timer;
    private readonly clock;
    private readonly terminalRelease;
    constructor(unitOfWork: ExecutionUnitOfWork, broker: BrokerRecoveryCapability, accounting: AtomicFillAccounting, terminalRelease: TerminalReservationRelease, timer: BoundedTimerPort, clock: ExecutionClockPort);
    check(command: CheckOrderCommand): Promise<DomainResult<CommittedExecutionResult<StatusFillCheckResult>, AnyDomainFailure>>;
    waitForNextPoll(intervalMs: number): Promise<DomainResult<void>>;
    private applyOneFill;
    private commitStatus;
}
