import { type ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import { type ReconciliationRunSnapshot } from '../../domain/execution/reconciliation.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { CommittedExecutionResult, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts';
export type AdvanceExecutionCommand = Readonly<{
    runId: ExecutionRunSnapshot['executionRunId'];
    latestReconciliation?: ReconciliationRunSnapshot;
}>;
export declare class ExecutionCoordinator {
    private readonly unitOfWork;
    private readonly clock;
    constructor(unitOfWork: ExecutionUnitOfWork, clock: ExecutionClockPort);
    advance(command: AdvanceExecutionCommand): DomainResult<CommittedExecutionResult<ExecutionRunSnapshot>, AnyDomainFailure>;
    private deriveTarget;
    private validateReconciliation;
}
