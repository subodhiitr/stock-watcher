export {
  HEALTH_STATES,
  INCIDENT_SEVERITIES,
  JOB_CRITICALITIES,
  JOB_RUN_STATES,
  createJobDefinition,
  operationsFailure,
  operationsSuccess,
} from './domain/operations/contracts.ts'
export { JobCoordinator } from './application/operations/job-coordinator.ts'
export { OperationsHealthService } from './application/operations/health-service.ts'
export { BackupRecoveryService } from './application/operations/backup-recovery-service.ts'
export { IncidentService } from './application/operations/incident-service.ts'
export { SqliteOperationsRepository } from './adapters/persistence/operations-repository.ts'

export type {
  AuditIntegrityResult,
  BackupReceipt,
  ComponentHealth,
  HealthState,
  IncidentRecord,
  IncidentSeverity,
  JobCriticality,
  JobDefinition,
  JobLease,
  JobProgress,
  JobRunState,
  OperationsFailureCode,
  OperationsHealth,
  OperationsAlert,
  OperationsDashboard,
  AuditDecisionRecord,
  OperationsResult,
  OperationsTrigger,
} from './domain/operations/contracts.ts'
export type {
  AuditIntegrityPort,
  BackupOperationsPort,
  HealthProbePort,
  IncidentRepositoryPort,
  JobLeasePort,
  OperationalTask,
  OperationsClockPort,
  OperationsRepositoryPort,
} from './ports/operations/operations-port.ts'
export type { JobRunOutcome } from './application/operations/job-coordinator.ts'
