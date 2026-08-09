import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import {
  createJobDefinition,
  operationsFailure,
  operationsSuccess,
  type BackupReceipt,
  type ComponentHealth,
  type IncidentRecord,
  type IncidentSeverity,
  type OperationsResult,
} from '../../domain/operations/contracts.ts'
import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type { PortfolioDatabaseOwner } from '../../infrastructure/persistence/database-owner.ts'
import { IncidentService } from './incident-service.ts'
import { JobCoordinator } from './job-coordinator.ts'

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

export class PortfolioOperationsApiService {
  readonly #owner: PortfolioDatabaseOwner
  readonly #now: () => number
  readonly #backupDirectory: string
  readonly #jobs: JobCoordinator
  readonly #incidents: IncidentService

  constructor(owner: PortfolioDatabaseOwner, now: () => number, backupDirectory: string) {
    this.#owner = owner
    this.#now = now
    this.#backupDirectory = path.resolve(backupDirectory)
    const clock = Object.freeze({ now: () => this.#instant() })
    this.#jobs = new JobCoordinator(owner.operations, clock)
    this.#incidents = new IncidentService(owner.operations)
  }

  #instant(): Instant {
    return new Date(this.#now()).toISOString() as Instant
  }

  async #audit(input: Readonly<{
    actorId: string
    portfolioId: string
    runId?: string
    eventType: string
    reasonCode: string
    explanation: string
    payload?: Readonly<Record<string, unknown>>
  }>): Promise<void> {
    await this.#owner.operations.appendAuditDecision({
      auditEventId: `audit:${randomUUID()}`,
      actorId: input.actorId,
      portfolioId: input.portfolioId as PortfolioId,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      eventType: input.eventType,
      reasonCode: input.reasonCode,
      explanation: input.explanation,
      inputVersionHash: hash(input.payload ?? {}),
      createdAt: this.#instant(),
      redactedPayload: Object.freeze({ ...(input.payload ?? {}) }),
    })
  }

  async runHealthCheck(actorId: string, portfolioId: string): Promise<OperationsResult<Readonly<{
    runId: string
    components: readonly ComponentHealth[]
  }>>> {
    let components: readonly ComponentHealth[] = Object.freeze([])
    const result = await this.#jobs.run(
      createJobDefinition({ jobKey: 'PORTFOLIO_HEALTH_CHECK', criticality: 'CRITICAL', maxAttempts: 3, dependencyKeys: [] }),
      Object.freeze({
        execute: async ({ runId }: Readonly<{ runId: string }>) => {
          const checkedAt = this.#instant()
          const database = this.#owner.health()
          const audit = await this.#owner.operations.verify()
          components = Object.freeze([
            Object.freeze({
              component: 'PORTFOLIO_DATABASE', criticality: 'CRITICAL' as const,
              state: database.ok ? 'HEALTHY' as const : 'BLOCKED' as const,
              checkedAt, code: database.ok ? 'DATABASE_OK' : 'DATABASE_INTEGRITY_FAILED',
            }),
            Object.freeze({
              component: 'OPERATIONS_AUDIT_CHAIN', criticality: 'CRITICAL' as const,
              state: audit.valid ? 'HEALTHY' as const : 'BLOCKED' as const,
              checkedAt, code: audit.code,
            }),
            Object.freeze({
              component: 'PORTFOLIO_API', criticality: 'HIGH' as const,
              state: 'HEALTHY' as const, checkedAt, code: 'API_REQUEST_HANDLED',
            }),
          ])
          for (const component of components) await this.#owner.operations.recordComponentHealth(component)
          if (!database.ok || !audit.valid) throw new Error('HEALTH_CHECK_BLOCKED')
          await this.#audit({
            actorId, portfolioId, runId, eventType: 'OPERATIONS_HEALTH_CHECKED',
            reasonCode: 'MANUAL_OPERATOR_REQUEST', explanation: 'Operator ran the bounded portfolio health checks.',
            payload: { componentCount: components.length },
          })
          return Object.freeze({ completed: components.length, total: components.length, resultCode: 'HEALTHY' })
        },
      }),
      'MANUAL',
      portfolioId as PortfolioId,
    )
    return result.ok
      ? operationsSuccess(Object.freeze({ runId: result.value.runId, components }))
      : result
  }

  async createVerifiedBackup(actorId: string, portfolioId: string): Promise<OperationsResult<Readonly<{
    runId: string
    receipt: BackupReceipt
  }>>> {
    let receipt: BackupReceipt | undefined
    const result = await this.#jobs.run(
      createJobDefinition({
        jobKey: 'PORTFOLIO_VERIFIED_BACKUP', criticality: 'CRITICAL', maxAttempts: 3,
        dependencyKeys: ['PORTFOLIO_DATABASE', 'OPERATIONS_AUDIT_CHAIN'],
      }),
      Object.freeze({
        execute: async ({ runId }: Readonly<{ runId: string }>) => {
          const health = this.#owner.health()
          const audit = await this.#owner.operations.verify()
          if (!health.ok || !audit.valid) throw new Error('BACKUP_PRECONDITION_FAILED')
          const fileName = `portfolio-backup-${new Date(this.#now()).toISOString().replaceAll(':', '-')}-${randomUUID()}.db`
          const created = await this.#owner.backupTo(path.join(this.#backupDirectory, fileName))
          if (!created.ok) throw new Error(created.error.code)
          receipt = Object.freeze({
            backupId: `backup:${randomUUID()}`,
            destination: created.value.destination,
            createdAt: this.#instant(),
            schemaVersion: created.value.schemaVersion,
            verifiedEventStreams: created.value.verifiedEventStreams,
          })
          await this.#owner.operations.recordBackup(receipt)
          await this.#audit({
            actorId, portfolioId, runId, eventType: 'VERIFIED_BACKUP_CREATED',
            reasonCode: 'MANUAL_OPERATOR_REQUEST', explanation: 'Operator created an owner-mediated and integrity-verified backup.',
            payload: { backupId: receipt.backupId, schemaVersion: receipt.schemaVersion },
          })
          return Object.freeze({ completed: 1, total: 1, resultCode: 'BACKUP_VERIFIED' })
        },
      }),
      'MANUAL',
      portfolioId as PortfolioId,
    )
    return result.ok && receipt !== undefined
      ? operationsSuccess(Object.freeze({ runId: result.value.runId, receipt }))
      : result.ok ? operationsFailure('BACKUP_FAILED', true) : result
  }

  async runRestorePreflight(actorId: string, portfolioId: string): Promise<OperationsResult<Readonly<{
    runId: string
    ready: true
    checks: readonly string[]
  }>>> {
    const checks = Object.freeze(['DATABASE_INTEGRITY', 'AUDIT_CHAIN', 'VERIFIED_BACKUP_RECEIPT'])
    const result = await this.#jobs.run(
      createJobDefinition({ jobKey: 'PORTFOLIO_RESTORE_PREFLIGHT', criticality: 'HIGH', maxAttempts: 3, dependencyKeys: [] }),
      Object.freeze({
        execute: async ({ runId }: Readonly<{ runId: string }>) => {
          const health = this.#owner.health()
          const audit = await this.#owner.operations.verify()
          const dashboard = await this.#owner.operations.dashboard(1)
          if (!health.ok || !audit.valid || dashboard.backups.length === 0) throw new Error('RESTORE_PREFLIGHT_BLOCKED')
          await this.#audit({
            actorId, portfolioId, runId, eventType: 'RESTORE_PREFLIGHT_COMPLETED',
            reasonCode: 'MANUAL_OPERATOR_REQUEST', explanation: 'Operator completed a non-destructive restore readiness review.',
            payload: { checks },
          })
          return Object.freeze({ completed: checks.length, total: checks.length, resultCode: 'RESTORE_READY' })
        },
      }),
      'MANUAL',
      portfolioId as PortfolioId,
    )
    return result.ok
      ? operationsSuccess(Object.freeze({ runId: result.value.runId, ready: true as const, checks }))
      : result
  }

  async runRecoveryScan(actorId: string, portfolioId: string): Promise<OperationsResult<Readonly<{
    runId: string
    recoveryRequiredRunIds: readonly string[]
  }>>> {
    let recovered: readonly string[] = Object.freeze([])
    const result = await this.#jobs.run(
      createJobDefinition({ jobKey: 'PORTFOLIO_RECOVERY_SCAN', criticality: 'HIGH', maxAttempts: 3, dependencyKeys: [] }),
      Object.freeze({
        execute: async ({ runId }: Readonly<{ runId: string }>) => {
          const incomplete = (await this.#owner.operations.listIncomplete(this.#instant()))
            .filter((item) => item.runId !== runId)
          for (const lease of incomplete) await this.#owner.operations.markRecoveryRequired(lease, this.#instant())
          recovered = Object.freeze(incomplete.map((item) => item.runId))
          await this.#audit({
            actorId, portfolioId, runId, eventType: 'RECOVERY_SCAN_COMPLETED',
            reasonCode: 'MANUAL_OPERATOR_REQUEST', explanation: 'Operator classified incomplete or retryable operation runs.',
            payload: { recoveryRequiredCount: recovered.length },
          })
          return Object.freeze({ completed: incomplete.length, total: incomplete.length, resultCode: 'RECOVERY_SCAN_COMPLETE' })
        },
      }),
      'RECOVERY',
      portfolioId as PortfolioId,
    )
    return result.ok
      ? operationsSuccess(Object.freeze({ runId: result.value.runId, recoveryRequiredRunIds: recovered }))
      : result
  }

  async openIncident(actorId: string, portfolioId: string, input: Readonly<{
    severity: IncidentSeverity
    code: string
    correlationId: string
  }>): Promise<OperationsResult<IncidentRecord>> {
    const result = await this.#incidents.open({
      incidentId: `incident-${randomUUID()}`,
      severity: input.severity,
      openedAt: this.#instant(),
      code: input.code,
      correlationId: input.correlationId,
    })
    if (result.ok) await this.#audit({
      actorId, portfolioId, eventType: 'INCIDENT_OPENED', reasonCode: input.code,
      explanation: 'Operator opened an immutable portfolio incident record.',
      payload: { incidentId: result.value.incidentId, severity: input.severity, correlationId: input.correlationId },
    })
    return result
  }

  async closeIncident(actorId: string, portfolioId: string, incidentId: string, actionCodes: readonly string[]): Promise<OperationsResult<IncidentRecord>> {
    const current = await this.#owner.operations.findById(incidentId)
    if (current === undefined) return operationsFailure('INCIDENT_INVALID')
    const result = await this.#incidents.close(current, this.#instant(), actionCodes)
    if (result.ok) await this.#audit({
      actorId, portfolioId, eventType: 'INCIDENT_CLOSED', reasonCode: 'CORRECTIVE_ACTION_RECORDED',
      explanation: 'Operator closed an incident with explicit corrective-action evidence.',
      payload: { incidentId, actionCodes: result.value.actionCodes },
    })
    return result
  }
}
