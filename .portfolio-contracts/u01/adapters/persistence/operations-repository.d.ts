import type Database from 'better-sqlite3';
import type { PortfolioId } from '../../domain/shared/identifiers.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { AuditDecisionRecord, AuditIntegrityResult, BackupReceipt, ComponentHealth, IncidentRecord, JobDefinition, JobLease, JobProgress, OperationsAlert, OperationsDashboard, OperationsTrigger } from '../../domain/operations/contracts.ts';
import type { OperationsRepositoryPort } from '../../ports/operations/operations-port.ts';
export declare class SqliteOperationsRepository implements OperationsRepositoryPort {
    #private;
    constructor(database: Database.Database, now: () => Instant, canUse?: () => boolean);
    dependenciesReady(definition: JobDefinition): Promise<boolean>;
    acquire(input: Readonly<{
        definition: JobDefinition;
        portfolioId?: PortfolioId;
        trigger: OperationsTrigger;
        now: Instant;
    }>): Promise<JobLease | undefined>;
    succeed(leaseRecord: JobLease, progress: JobProgress, completedAt: Instant): Promise<void>;
    fail(leaseRecord: JobLease, code: string, retryable: boolean, failedAt: Instant): Promise<void>;
    listIncomplete(now: Instant): Promise<readonly JobLease[]>;
    markRecoveryRequired(leaseRecord: JobLease, markedAt: Instant): Promise<void>;
    recordComponentHealth(health: ComponentHealth): Promise<void>;
    listComponentHealth(): Promise<readonly ComponentHealth[]>;
    verify(): Promise<AuditIntegrityResult>;
    appendAlert(alertRecord: OperationsAlert): Promise<void>;
    recordBackup(receipt: BackupReceipt): Promise<void>;
    append(record: IncidentRecord): Promise<void>;
    findById(incidentId: string): Promise<IncidentRecord | undefined>;
    appendAuditDecision(record: Omit<AuditDecisionRecord, 'previousHash' | 'eventHash'>): Promise<AuditDecisionRecord>;
    dashboard(limit?: number): Promise<OperationsDashboard>;
}
