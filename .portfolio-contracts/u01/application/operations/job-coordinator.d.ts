import type { PortfolioId } from '../../domain/shared/identifiers.ts';
import { type JobDefinition, type JobLease, type JobProgress, type OperationsResult, type OperationsTrigger } from '../../domain/operations/contracts.ts';
import type { JobLeasePort, OperationalTask, OperationsClockPort } from '../../ports/operations/operations-port.ts';
export type JobRunOutcome = Readonly<{
    runId: string;
    progress: JobProgress;
}>;
export declare class JobCoordinator {
    #private;
    constructor(leases: JobLeasePort, clock: OperationsClockPort);
    run(definition: JobDefinition, task: OperationalTask, trigger: OperationsTrigger, portfolioId?: PortfolioId): Promise<OperationsResult<JobRunOutcome>>;
    classifyIncomplete(): Promise<readonly JobLease[]>;
}
