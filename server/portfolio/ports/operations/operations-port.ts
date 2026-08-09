import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type {
  AuditIntegrityResult,
  AuditDecisionRecord,
  BackupReceipt,
  ComponentHealth,
  OperationsAlert,
  OperationsDashboard,
  IncidentRecord,
  JobDefinition,
  JobLease,
  JobProgress,
  OperationsTrigger,
} from '../../domain/operations/contracts.ts'

export interface OperationsClockPort {
  now(): Instant
}

export interface JobLeasePort {
  dependenciesReady(definition: JobDefinition, portfolioId?: PortfolioId): Promise<boolean>
  acquire(input: Readonly<{
    definition: JobDefinition
    portfolioId?: PortfolioId
    trigger: OperationsTrigger
    now: Instant
  }>): Promise<JobLease | undefined>
  succeed(lease: JobLease, progress: JobProgress, completedAt: Instant): Promise<void>
  fail(lease: JobLease, code: string, retryable: boolean, failedAt: Instant): Promise<void>
  listIncomplete(now: Instant): Promise<readonly JobLease[]>
  markRecoveryRequired(lease: JobLease, markedAt: Instant): Promise<void>
}

export interface OperationalTask {
  execute(input: Readonly<{
    runId: string
    idempotencyKey: string
    portfolioId?: PortfolioId
  }>): Promise<JobProgress>
}

export interface HealthProbePort {
  probe(): Promise<ComponentHealth>
}

export interface AuditIntegrityPort {
  verify(): Promise<AuditIntegrityResult>
}

export interface BackupOperationsPort {
  create(destination: string): Promise<BackupReceipt>
  verify(receipt: BackupReceipt): Promise<boolean>
}

export interface IncidentRepositoryPort {
  append(record: IncidentRecord): Promise<void>
  findById(incidentId: string): Promise<IncidentRecord | undefined>
}

export interface OperationsRepositoryPort
  extends JobLeasePort, IncidentRepositoryPort, AuditIntegrityPort {
  recordComponentHealth(health: ComponentHealth): Promise<void>
  listComponentHealth(): Promise<readonly ComponentHealth[]>
  appendAlert(alert: OperationsAlert): Promise<void>
  recordBackup(receipt: BackupReceipt): Promise<void>
  appendAuditDecision(record: Omit<AuditDecisionRecord, 'previousHash' | 'eventHash'>): Promise<AuditDecisionRecord>
  dashboard(limit?: number): Promise<OperationsDashboard>
}
