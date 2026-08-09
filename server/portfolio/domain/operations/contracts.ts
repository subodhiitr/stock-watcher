import type { PortfolioId } from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'

export const JOB_CRITICALITIES = ['CRITICAL', 'HIGH', 'MEDIUM'] as const
export const JOB_RUN_STATES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED'] as const
export const HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'BLOCKED'] as const
export const INCIDENT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3'] as const

export type JobCriticality = (typeof JOB_CRITICALITIES)[number]
export type JobRunState = (typeof JOB_RUN_STATES)[number]
export type HealthState = (typeof HEALTH_STATES)[number]
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]
export type OperationsTrigger = 'SCHEDULED' | 'MANUAL' | 'RECOVERY'
export type AlertSeverity = IncidentSeverity

export type JobDefinition = Readonly<{
  jobKey: string
  criticality: JobCriticality
  maxAttempts: number
  dependencyKeys: readonly string[]
}>

export type JobLease = Readonly<{
  runId: string
  jobKey: string
  leaseToken: string
  portfolioId?: PortfolioId
  acquiredAt: Instant
  expiresAt: Instant
  attempt: number
}>

export type JobProgress = Readonly<{
  completed: number
  total: number
  resultCode: string
}>

export type ComponentHealth = Readonly<{
  component: string
  criticality: JobCriticality
  state: HealthState
  checkedAt: Instant
  code: string
}>

export type OperationsHealth = Readonly<{
  state: HealthState
  checkedAt: Instant
  components: readonly ComponentHealth[]
}>

export type AuditIntegrityResult = Readonly<{
  valid: boolean
  verifiedStreams: number
  code: string
}>

export type BackupReceipt = Readonly<{
  backupId: string
  destination: string
  createdAt: Instant
  schemaVersion: number
  verifiedEventStreams: number
}>

export type IncidentRecord = Readonly<{
  incidentId: string
  severity: IncidentSeverity
  state: 'OPEN' | 'CONTAINED' | 'CLOSED'
  openedAt: Instant
  closedAt?: Instant
  code: string
  correlationId: string
  actionCodes: readonly string[]
}>

export type OperationsAlert = Readonly<{
  alertId: string
  severity: AlertSeverity
  category: string
  detailCode: string
  correlationId: string
  createdAt: Instant
  redactedContext: Readonly<Record<string, unknown>>
}>

export type AuditDecisionRecord = Readonly<{
  auditEventId: string
  actorId: string
  portfolioId?: PortfolioId
  runId?: string
  eventType: string
  reasonCode: string
  explanation: string
  inputVersionHash: string
  previousHash: string
  eventHash: string
  createdAt: Instant
  redactedPayload: Readonly<Record<string, unknown>>
}>

export type OperationsDashboard = Readonly<{
  health: OperationsHealth
  jobs: readonly Readonly<{
    runId: string
    jobKey: string
    portfolioId?: PortfolioId
    trigger: OperationsTrigger
    state: JobRunState
    attempt: number
    acquiredAt: Instant
    expiresAt: Instant
    completedAt?: Instant
    resultCode: string
    retryable: boolean
  }>[]
  alerts: readonly OperationsAlert[]
  backups: readonly BackupReceipt[]
  incidents: readonly IncidentRecord[]
  audit: readonly AuditDecisionRecord[]
}>

export type OperationsFailureCode =
  | 'JOB_ALREADY_LEASED'
  | 'JOB_DEPENDENCY_BLOCKED'
  | 'JOB_TASK_FAILED'
  | 'JOB_COMPLETION_UNKNOWN'
  | 'OPERATIONS_HEALTH_BLOCKED'
  | 'AUDIT_INTEGRITY_FAILED'
  | 'BACKUP_FAILED'
  | 'BACKUP_VERIFICATION_FAILED'
  | 'INCIDENT_INVALID'
  | 'AUDIT_INVALID'

export type OperationsResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: OperationsFailureCode; retryable: boolean }>

export function operationsSuccess<T>(value: T): OperationsResult<T> {
  return Object.freeze({ ok: true, value })
}

export function operationsFailure<T>(
  code: OperationsFailureCode,
  retryable = false,
): OperationsResult<T> {
  return Object.freeze({ ok: false, code, retryable })
}

export function createJobDefinition(input: JobDefinition): JobDefinition {
  if (
    !/^[A-Z][A-Z0-9_]{2,63}$/u.test(input.jobKey)
    || !JOB_CRITICALITIES.includes(input.criticality)
    || !Number.isInteger(input.maxAttempts)
    || input.maxAttempts < 1
    || input.maxAttempts > 3
    || input.dependencyKeys.length > 16
    || input.dependencyKeys.some((key) => !/^[A-Z][A-Z0-9_]{2,63}$/u.test(key))
  ) {
    throw new TypeError('Invalid job definition')
  }
  return Object.freeze({
    ...input,
    dependencyKeys: Object.freeze([...new Set(input.dependencyKeys)].sort()),
  })
}
