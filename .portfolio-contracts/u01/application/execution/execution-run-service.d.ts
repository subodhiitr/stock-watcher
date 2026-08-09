import type { ExecutionMode } from '../../domain/execution/contracts.ts';
import type { ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { ApprovalId, ExecutionPolicySnapshotId, PortfolioId, ReconciliationRunId } from '../../domain/shared/identifiers.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionStatePort } from '../../ports/execution/execution-state-port.ts';
import type { ExecutionClockPort, ExecutionIdentifierFactory } from '../../ports/execution/runtime-port.ts';
export type CreateExecutionRunCommand = Readonly<{
    portfolioId: PortfolioId;
    approvalId: ApprovalId;
    mode: ExecutionMode;
    preExecutionReconciliationId: ReconciliationRunId;
    policySnapshotId: ExecutionPolicySnapshotId;
    timeoutMs: number;
}>;
export type CreatedExecutionRun = Readonly<{
    run: ExecutionRunSnapshot;
    orders: readonly ExecutionOrderSnapshot[];
}>;
export declare class ExecutionRunService {
    private readonly state;
    private readonly unitOfWork;
    private readonly clock;
    private readonly ids;
    constructor(state: ExecutionStatePort, unitOfWork: ExecutionUnitOfWork, clock: ExecutionClockPort, ids: ExecutionIdentifierFactory);
    createRun(command: CreateExecutionRunCommand): Promise<DomainResult<CommittedExecutionResult<CreatedExecutionRun>, AnyDomainFailure>>;
}
