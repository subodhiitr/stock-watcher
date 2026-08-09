import type { PortfolioId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
export declare const JOB_CRITICALITIES: readonly ["CRITICAL", "HIGH", "MEDIUM"];
export declare const JOB_RUN_STATES: readonly ["RUNNING", "SUCCEEDED", "FAILED", "RECOVERY_REQUIRED"];
export declare const HEALTH_STATES: readonly ["HEALTHY", "DEGRADED", "BLOCKED"];
export declare const INCIDENT_SEVERITIES: readonly ["SEV1", "SEV2", "SEV3"];
export type JobCriticality = (typeof JOB_CRITICALITIES)[number];
export type JobRunState = (typeof JOB_RUN_STATES)[number];
export type HealthState = (typeof HEALTH_STATES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type OperationsTrigger = 'SCHEDULED' | 'MANUAL' | 'RECOVERY';
export type AlertSeverity = IncidentSeverity;
export type JobDefinition = Readonly<{
    jobKey: string;
    criticality: JobCriticality;
    maxAttempts: number;
    dependencyKeys: readonly string[];
}>;
export type JobLease = Readonly<{
    runId: string;
    jobKey: string;
    leaseToken: string;
    portfolioId?: PortfolioId;
    acquiredAt: Instant;
    expiresAt: Instant;
    attempt: number;
}>;
export type JobProgress = Readonly<{
    completed: number;
    total: number;
    resultCode: string;
}>;
export type ComponentHealth = Readonly<{
    component: string;
    criticality: JobCriticality;
    state: HealthState;
    checkedAt: Instant;
    code: string;
}>;
export type OperationsHealth = Readonly<{
    state: HealthState;
    checkedAt: Instant;
    components: readonly ComponentHealth[];
}>;
export type AuditIntegrityResult = Readonly<{
    valid: boolean;
    verifiedStreams: number;
    code: string;
}>;
export type BackupReceipt = Readonly<{
    backupId: string;
    destination: string;
    createdAt: Instant;
    schemaVersion: number;
    verifiedEventStreams: number;
}>;
export type IncidentRecord = Readonly<{
    incidentId: string;
    severity: IncidentSeverity;
    state: 'OPEN' | 'CONTAINED' | 'CLOSED';
    openedAt: Instant;
    closedAt?: Instant;
    code: string;
    correlationId: string;
    actionCodes: readonly string[];
}>;
export type OperationsAlert = Readonly<{
    alertId: string;
    severity: AlertSeverity;
    category: string;
    detailCode: string;
    correlationId: string;
    createdAt: Instant;
    redactedContext: Readonly<Record<string, unknown>>;
}>;
export type AuditDecisionRecord = Readonly<{
    auditEventId: string;
    actorId: string;
    portfolioId?: PortfolioId;
    runId?: string;
    eventType: string;
    reasonCode: string;
    explanation: string;
    inputVersionHash: string;
    previousHash: string;
    eventHash: string;
    createdAt: Instant;
    redactedPayload: Readonly<Record<string, unknown>>;
}>;
export type OperationsDashboard = Readonly<{
    health: OperationsHealth;
    jobs: readonly Readonly<{
        runId: string;
        jobKey: string;
        portfolioId?: PortfolioId;
        trigger: OperationsTrigger;
        state: JobRunState;
        attempt: number;
        acquiredAt: Instant;
        expiresAt: Instant;
        completedAt?: Instant;
        resultCode: string;
        retryable: boolean;
    }>[];
    alerts: readonly OperationsAlert[];
    backups: readonly BackupReceipt[];
    incidents: readonly IncidentRecord[];
    audit: readonly AuditDecisionRecord[];
}>;
export type OperationsFailureCode = 'JOB_ALREADY_LEASED' | 'JOB_DEPENDENCY_BLOCKED' | 'JOB_TASK_FAILED' | 'JOB_COMPLETION_UNKNOWN' | 'OPERATIONS_HEALTH_BLOCKED' | 'AUDIT_INTEGRITY_FAILED' | 'BACKUP_FAILED' | 'BACKUP_VERIFICATION_FAILED' | 'INCIDENT_INVALID' | 'AUDIT_INVALID';
export type OperationsResult<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    ok: false;
    code: OperationsFailureCode;
    retryable: boolean;
}>;
export declare function operationsSuccess<T>(value: T): OperationsResult<T>;
export declare function operationsFailure<T>(code: OperationsFailureCode, retryable?: boolean): OperationsResult<T>;
export declare function createJobDefinition(input: JobDefinition): JobDefinition;
