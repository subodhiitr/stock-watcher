import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import type { PortfolioId } from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type {
  AuditDecisionRecord,
  AuditIntegrityResult,
  BackupReceipt,
  ComponentHealth,
  IncidentRecord,
  JobDefinition,
  JobLease,
  JobProgress,
  OperationsAlert,
  OperationsDashboard,
  OperationsTrigger,
} from '../../domain/operations/contracts.ts'
import type { OperationsRepositoryPort } from '../../ports/operations/operations-port.ts'

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function freezeRecord<T extends Record<string, unknown>>(value: T): Readonly<T> {
  return Object.freeze({ ...value })
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed = JSON.parse(value) as unknown
  return Object.freeze(
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {},
  )
}

function lease(row: Record<string, unknown>): JobLease {
  return Object.freeze({
    runId: String(row.run_id),
    jobKey: String(row.job_key),
    leaseToken: String(row.lease_token),
    ...(row.portfolio_id === null ? {} : { portfolioId: String(row.portfolio_id) as PortfolioId }),
    acquiredAt: String(row.acquired_at) as Instant,
    expiresAt: String(row.expires_at) as Instant,
    attempt: Number(row.attempt),
  })
}

function incident(row: Record<string, unknown>): IncidentRecord {
  return Object.freeze({
    incidentId: String(row.incident_id),
    severity: row.severity as IncidentRecord['severity'],
    state: row.incident_state as IncidentRecord['state'],
    openedAt: String(row.opened_at) as Instant,
    ...(row.closed_at === null ? {} : { closedAt: String(row.closed_at) as Instant }),
    code: String(row.code),
    correlationId: String(row.correlation_id),
    actionCodes: Object.freeze(JSON.parse(String(row.action_codes)) as readonly string[]),
  })
}

function alert(row: Record<string, unknown>): OperationsAlert {
  return Object.freeze({
    alertId: String(row.alert_id),
    severity: row.severity as OperationsAlert['severity'],
    category: String(row.category),
    detailCode: String(row.detail_code),
    correlationId: String(row.correlation_id),
    createdAt: String(row.created_at) as Instant,
    redactedContext: parseJsonObject(String(row.redacted_context)),
  })
}

function backup(row: Record<string, unknown>): BackupReceipt {
  return Object.freeze({
    backupId: String(row.backup_id),
    destination: String(row.destination_hash),
    createdAt: String(row.created_at) as Instant,
    schemaVersion: Number(row.schema_version),
    verifiedEventStreams: Number(row.verified_event_streams),
  })
}

function audit(row: Record<string, unknown>): AuditDecisionRecord {
  return Object.freeze({
    auditEventId: String(row.audit_event_id),
    actorId: String(row.actor_id),
    ...(row.portfolio_id === null ? {} : { portfolioId: String(row.portfolio_id) as PortfolioId }),
    ...(row.run_id === null ? {} : { runId: String(row.run_id) }),
    eventType: String(row.event_type),
    reasonCode: String(row.reason_code),
    explanation: String(row.explanation),
    inputVersionHash: String(row.input_version_hash),
    previousHash: String(row.previous_hash),
    eventHash: String(row.event_hash),
    createdAt: String(row.created_at) as Instant,
    redactedPayload: parseJsonObject(String(row.redacted_payload)),
  })
}

export class SqliteOperationsRepository implements OperationsRepositoryPort {
  readonly #database: Database.Database
  readonly #now: () => Instant
  readonly #canUse: () => boolean

  constructor(
    database: Database.Database,
    now: () => Instant,
    canUse: () => boolean = () => true,
  ) {
    this.#database = database
    this.#now = now
    this.#canUse = canUse
  }

  #assertAvailable(): void {
    if (!this.#canUse()) throw new Error('OPERATIONS_REPOSITORY_UNAVAILABLE')
  }

  async dependenciesReady(definition: JobDefinition): Promise<boolean> {
    this.#assertAvailable()
    if (definition.dependencyKeys.length === 0) return true
    const placeholders = definition.dependencyKeys.map(() => '?').join(', ')
    const blocked = this.#database.prepare(`
      SELECT COUNT(*) AS count FROM portfolio_component_health
      WHERE component IN (${placeholders}) AND state = 'BLOCKED'
    `).get(...definition.dependencyKeys) as { count: number }
    return blocked.count === 0
  }

  async acquire(input: Readonly<{
    definition: JobDefinition
    portfolioId?: PortfolioId
    trigger: OperationsTrigger
    now: Instant
  }>): Promise<JobLease | undefined> {
    this.#assertAvailable()
    const existing = this.#database.prepare(`
      SELECT * FROM portfolio_job_runs
      WHERE job_key = ? AND COALESCE(portfolio_id, '') = COALESCE(?, '')
        AND run_state = 'RUNNING' AND expires_at > ?
    `).get(input.definition.jobKey, input.portfolioId ?? null, input.now) as Record<string, unknown> | undefined
    if (existing !== undefined) return undefined
    this.#database.prepare(`
      UPDATE portfolio_job_runs SET run_state = 'RECOVERY_REQUIRED', result_code = 'LEASE_EXPIRED'
      WHERE job_key = ? AND COALESCE(portfolio_id, '') = COALESCE(?, '')
        AND run_state = 'RUNNING' AND expires_at <= ?
    `).run(input.definition.jobKey, input.portfolioId ?? null, input.now)
    const previous = this.#database.prepare(`
      SELECT MAX(attempt) AS attempt FROM portfolio_job_runs
      WHERE job_key = ? AND COALESCE(portfolio_id, '') = COALESCE(?, '')
        AND run_state IN ('FAILED', 'RECOVERY_REQUIRED')
    `).get(input.definition.jobKey, input.portfolioId ?? null) as { attempt: number | null }
    const attempt = Math.min(input.definition.maxAttempts, Number(previous.attempt ?? 0) + 1)
    const acquired = new Date(input.now).getTime()
    const expiresAt = new Date(acquired + 15 * 60 * 1000).toISOString() as Instant
    const record = Object.freeze({
      runId: `operations-run:${randomUUID()}`,
      jobKey: input.definition.jobKey,
      leaseToken: hash(`${input.definition.jobKey}:${input.portfolioId ?? 'all'}:${input.trigger}:${input.now}:${randomUUID()}`),
      ...(input.portfolioId === undefined ? {} : { portfolioId: input.portfolioId }),
      acquiredAt: input.now,
      expiresAt,
      attempt,
    })
    this.#database.prepare(`
      INSERT INTO portfolio_job_runs (
        run_id, job_key, portfolio_id, trigger_kind, run_state, lease_token,
        acquired_at, expires_at, attempt, created_at
      ) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?)
    `).run(
      record.runId,
      record.jobKey,
      record.portfolioId ?? null,
      input.trigger,
      record.leaseToken,
      record.acquiredAt,
      record.expiresAt,
      record.attempt,
      input.now,
    )
    return record
  }

  async succeed(leaseRecord: JobLease, progress: JobProgress, completedAt: Instant): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      UPDATE portfolio_job_runs
      SET run_state = 'SUCCEEDED', completed_at = ?, progress_completed = ?,
          progress_total = ?, result_code = ?, retryable = 0
      WHERE run_id = ? AND lease_token = ? AND run_state = 'RUNNING'
    `).run(progress.completed >= 0 ? completedAt : completedAt, progress.completed, progress.total, progress.resultCode, leaseRecord.runId, leaseRecord.leaseToken)
  }

  async fail(leaseRecord: JobLease, code: string, retryable: boolean, failedAt: Instant): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      UPDATE portfolio_job_runs
      SET run_state = 'FAILED', completed_at = ?, result_code = ?, retryable = ?
      WHERE run_id = ? AND lease_token = ? AND run_state = 'RUNNING'
    `).run(failedAt, code, retryable ? 1 : 0, leaseRecord.runId, leaseRecord.leaseToken)
  }

  async listIncomplete(now: Instant): Promise<readonly JobLease[]> {
    this.#assertAvailable()
    const rows = this.#database.prepare(`
      SELECT * FROM portfolio_job_runs
      WHERE run_state = 'RUNNING' OR (run_state = 'FAILED' AND retryable = 1)
      ORDER BY acquired_at, run_id
    `).all() as readonly Record<string, unknown>[]
    return Object.freeze(rows.map(lease))
  }

  async markRecoveryRequired(leaseRecord: JobLease, markedAt: Instant): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      UPDATE portfolio_job_runs
      SET run_state = 'RECOVERY_REQUIRED', completed_at = ?, result_code = 'RECOVERY_REQUIRED', retryable = 0
      WHERE run_id = ?
    `).run(markedAt, leaseRecord.runId)
  }

  async recordComponentHealth(health: ComponentHealth): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      INSERT INTO portfolio_component_health (component, criticality, state, checked_at, code)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(component) DO UPDATE SET
        criticality = excluded.criticality,
        state = excluded.state,
        checked_at = excluded.checked_at,
        code = excluded.code
    `).run(health.component, health.criticality, health.state, health.checkedAt, health.code)
  }

  async listComponentHealth(): Promise<readonly ComponentHealth[]> {
    this.#assertAvailable()
    const rows = this.#database.prepare(`
      SELECT component, criticality, state, checked_at, code
      FROM portfolio_component_health ORDER BY component
    `).all() as readonly Record<string, unknown>[]
    return Object.freeze(rows.map((row) => Object.freeze({
      component: String(row.component),
      criticality: row.criticality as ComponentHealth['criticality'],
      state: row.state as ComponentHealth['state'],
      checkedAt: String(row.checked_at) as Instant,
      code: String(row.code),
    })))
  }

  async verify(): Promise<AuditIntegrityResult> {
    this.#assertAvailable()
    const rows = this.#database.prepare(`
      SELECT previous_hash, event_hash, actor_id, portfolio_id, run_id, event_type,
             reason_code, explanation, input_version_hash, created_at, redacted_payload
      FROM portfolio_audit_events ORDER BY rowid
    `).all() as readonly Record<string, unknown>[]
    let previous = '0'.repeat(64)
    for (const row of rows) {
      const expected = hash(JSON.stringify({
        actorId: row.actor_id,
        portfolioId: row.portfolio_id,
        runId: row.run_id,
        eventType: row.event_type,
        reasonCode: row.reason_code,
        explanation: row.explanation,
        inputVersionHash: row.input_version_hash,
        previousHash: previous,
        createdAt: row.created_at,
        redactedPayload: JSON.parse(String(row.redacted_payload)) as unknown,
      }))
      if (row.previous_hash !== previous || row.event_hash !== expected) {
        return Object.freeze({ valid: false, verifiedStreams: 0, code: 'AUDIT_CHAIN_BROKEN' })
      }
      previous = String(row.event_hash)
    }
    return Object.freeze({ valid: true, verifiedStreams: rows.length > 0 ? 1 : 0, code: 'OK' })
  }

  async appendAlert(alertRecord: OperationsAlert): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      INSERT OR IGNORE INTO portfolio_operations_alerts (
        alert_id, severity, category, detail_code, correlation_id, created_at, redacted_context
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      alertRecord.alertId,
      alertRecord.severity,
      alertRecord.category,
      alertRecord.detailCode,
      alertRecord.correlationId,
      alertRecord.createdAt,
      JSON.stringify(alertRecord.redactedContext),
    )
  }

  async recordBackup(receipt: BackupReceipt): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      INSERT OR IGNORE INTO portfolio_backup_receipts (
        backup_id, destination_hash, created_at, schema_version,
        verified_event_streams, verification_code
      ) VALUES (?, ?, ?, ?, ?, 'VERIFIED')
    `).run(
      receipt.backupId,
      hash(receipt.destination),
      receipt.createdAt,
      receipt.schemaVersion,
      receipt.verifiedEventStreams,
    )
  }

  async append(record: IncidentRecord): Promise<void> {
    this.#assertAvailable()
    this.#database.prepare(`
      INSERT INTO portfolio_incident_events (
        incident_event_id, incident_id, severity, incident_state, opened_at,
        closed_at, code, correlation_id, action_codes, appended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `incident-event:${randomUUID()}`,
      record.incidentId,
      record.severity,
      record.state,
      record.openedAt,
      record.closedAt ?? null,
      record.code,
      record.correlationId,
      JSON.stringify(record.actionCodes),
      this.#now(),
    )
  }

  async findById(incidentId: string): Promise<IncidentRecord | undefined> {
    this.#assertAvailable()
    const row = this.#database.prepare(`
      SELECT * FROM portfolio_incident_events
      WHERE incident_id = ? ORDER BY appended_at DESC, incident_event_id DESC LIMIT 1
    `).get(incidentId) as Record<string, unknown> | undefined
    return row === undefined ? undefined : incident(row)
  }

  async appendAuditDecision(record: Omit<AuditDecisionRecord, 'previousHash' | 'eventHash'>): Promise<AuditDecisionRecord> {
    this.#assertAvailable()
    const latest = this.#database.prepare(`
      SELECT event_hash FROM portfolio_audit_events
      ORDER BY rowid DESC LIMIT 1
    `).get() as { event_hash: string } | undefined
    const previousHash = latest?.event_hash ?? '0'.repeat(64)
    const eventHash = hash(JSON.stringify({
      actorId: record.actorId,
      portfolioId: record.portfolioId ?? null,
      runId: record.runId ?? null,
      eventType: record.eventType,
      reasonCode: record.reasonCode,
      explanation: record.explanation,
      inputVersionHash: record.inputVersionHash,
      previousHash,
      createdAt: record.createdAt,
      redactedPayload: record.redactedPayload,
    }))
    const appended = Object.freeze({ ...record, previousHash, eventHash })
    this.#database.prepare(`
      INSERT INTO portfolio_audit_events (
        audit_event_id, actor_id, portfolio_id, run_id, event_type, reason_code,
        explanation, input_version_hash, previous_hash, event_hash, created_at, redacted_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appended.auditEventId,
      appended.actorId,
      appended.portfolioId ?? null,
      appended.runId ?? null,
      appended.eventType,
      appended.reasonCode,
      appended.explanation,
      appended.inputVersionHash,
      appended.previousHash,
      appended.eventHash,
      appended.createdAt,
      JSON.stringify(appended.redactedPayload),
    )
    return appended
  }

  async dashboard(limit = 20): Promise<OperationsDashboard> {
    this.#assertAvailable()
    const checkedAt = this.#now()
    const components = await this.listComponentHealth()
    const state = components.some((item) => item.criticality === 'CRITICAL' && item.state !== 'HEALTHY')
      ? 'BLOCKED'
      : components.some((item) => item.state !== 'HEALTHY') ? 'DEGRADED' : 'HEALTHY'
    const jobs = this.#database.prepare(`
      SELECT run_id, job_key, portfolio_id, trigger_kind, run_state, attempt,
             acquired_at, expires_at, completed_at, result_code, retryable
      FROM portfolio_job_runs ORDER BY acquired_at DESC, run_id DESC LIMIT ?
    `).all(limit) as readonly Record<string, unknown>[]
    const alertRows = this.#database.prepare(`
      SELECT * FROM portfolio_operations_alerts ORDER BY created_at DESC, alert_id DESC LIMIT ?
    `).all(limit) as readonly Record<string, unknown>[]
    const backupRows = this.#database.prepare(`
      SELECT * FROM portfolio_backup_receipts ORDER BY created_at DESC, backup_id DESC LIMIT ?
    `).all(limit) as readonly Record<string, unknown>[]
    const incidentRows = this.#database.prepare(`
      SELECT * FROM portfolio_incident_events latest
      WHERE rowid = (
        SELECT MAX(rowid) FROM portfolio_incident_events scoped
        WHERE scoped.incident_id = latest.incident_id
      )
      ORDER BY appended_at DESC, rowid DESC LIMIT ?
    `).all(limit) as readonly Record<string, unknown>[]
    const auditRows = this.#database.prepare(`
      SELECT * FROM portfolio_audit_events ORDER BY rowid DESC LIMIT ?
    `).all(limit) as readonly Record<string, unknown>[]
    return Object.freeze({
      health: Object.freeze({ state, checkedAt, components }),
      jobs: Object.freeze(jobs.map((row) => freezeRecord({
        runId: String(row.run_id),
        jobKey: String(row.job_key),
        ...(row.portfolio_id === null ? {} : { portfolioId: String(row.portfolio_id) as PortfolioId }),
        trigger: row.trigger_kind as OperationsTrigger,
        state: row.run_state as 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'RECOVERY_REQUIRED',
        attempt: Number(row.attempt),
        acquiredAt: String(row.acquired_at) as Instant,
        expiresAt: String(row.expires_at) as Instant,
        ...(row.completed_at === null ? {} : { completedAt: String(row.completed_at) as Instant }),
        resultCode: String(row.result_code),
        retryable: Number(row.retryable) === 1,
      }))),
      alerts: Object.freeze(alertRows.map(alert)),
      backups: Object.freeze(backupRows.map(backup)),
      incidents: Object.freeze(incidentRows.map(incident)),
      audit: Object.freeze(auditRows.map(audit)),
    })
  }
}
