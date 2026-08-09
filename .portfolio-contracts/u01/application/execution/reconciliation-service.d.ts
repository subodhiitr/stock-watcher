import type { NormalizedFill } from '../../domain/execution/contracts.ts';
import { type ReconciliationDifference, type ReconciliationRunSnapshot, type ReconciliationSnapshotRecord } from '../../domain/execution/reconciliation.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { BrokerAccountBindingId, PortfolioId } from '../../domain/shared/identifiers.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { BrokerRecoveryCapability } from '../../ports/execution/broker-port.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionClockPort, MonotonicTimePort } from '../../ports/execution/runtime-port.ts';
import { type TerminalReservationRelease } from './placement-coordinator.ts';
export interface ReconciliationComparator {
    compare(local: ReconciliationSnapshotRecord, external: ReconciliationSnapshotRecord): DomainResult<readonly ReconciliationDifference[]>;
}
export interface MissingFillApplier {
    apply(fill: NormalizedFill): Promise<DomainResult<void>>;
}
export type ReconcileCommand = Readonly<{
    run: ReconciliationRunSnapshot;
    localSnapshot: ReconciliationSnapshotRecord;
    portfolioId: PortfolioId;
    accountBindingId: BrokerAccountBindingId;
    externalSnapshotId: ReconciliationSnapshotRecord['snapshotId'];
    mappingSnapshotHash: ReconciliationSnapshotRecord['contentHash'];
    deadlineAt: Instant;
    totalDeadlineMs: number;
    fromCursor?: string;
}>;
export declare class ReconciliationService {
    private readonly unitOfWork;
    private readonly broker;
    private readonly comparator;
    private readonly missingFillApplier;
    private readonly clock;
    private readonly monotonic;
    private readonly terminalRelease;
    constructor(unitOfWork: ExecutionUnitOfWork, broker: BrokerRecoveryCapability, comparator: ReconciliationComparator, missingFillApplier: MissingFillApplier, clock: ExecutionClockPort, monotonic: MonotonicTimePort, terminalRelease: TerminalReservationRelease);
    reconcile(command: ReconcileCommand): Promise<DomainResult<CommittedExecutionResult<ReconciliationRunSnapshot>, AnyDomainFailure>>;
    private resolveUnknownOrders;
    private provenResolvedState;
    private startOrResume;
    private persistComparing;
    private complete;
    private block;
    private stateEvidence;
    private deadlineExceeded;
}
