import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BackupRecoveryService,
  IncidentService,
  JobCoordinator,
  OperationsHealthService,
  createJobDefinition,
  type BackupOperationsPort,
  type HealthProbePort,
  type IncidentRecord,
  type IncidentRepositoryPort,
  type JobLease,
  type JobLeasePort,
  type OperationsClockPort,
} from '../../../server/portfolio/operations.ts'
import { parseInstant, type Instant } from '../../../server/portfolio/index.ts'

function instant(value: string): Instant {
  const parsed = parseInstant(value)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('invalid test instant')
  return parsed.value
}

const now = instant('2026-08-07T10:00:00.000Z')
const later = instant('2026-08-07T10:05:00.000Z')
const clock: OperationsClockPort = { now: () => now }
const definition = createJobDefinition({
  jobKey: 'DAILY_RECONCILIATION',
  criticality: 'CRITICAL',
  maxAttempts: 2,
  dependencyKeys: ['BROKER_HEALTH', 'DATABASE_HEALTH', 'BROKER_HEALTH'],
})
const lease: JobLease = Object.freeze({
  runId: 'run-1',
  jobKey: definition.jobKey,
  leaseToken: 'lease-token-1',
  acquiredAt: now,
  expiresAt: later,
  attempt: 1,
})

function leasePort(input: Readonly<{
  dependenciesReady?: boolean
  acquired?: JobLease
  incomplete?: readonly JobLease[]
  events?: string[]
}> = {}): JobLeasePort {
  const events = input.events ?? []
  return {
    dependenciesReady: async () => input.dependenciesReady ?? true,
    acquire: async () => input.acquired,
    succeed: async () => { events.push('succeeded') },
    fail: async (_lease, code, retryable) => { events.push(`${code}:${retryable}`) },
    listIncomplete: async () => input.incomplete ?? [],
    markRecoveryRequired: async () => { events.push('recovery-required') },
  }
}

test('job definitions remain bounded and canonical', () => {
  assert.deepEqual(definition.dependencyKeys, ['BROKER_HEALTH', 'DATABASE_HEALTH'])
  assert.throws(() => createJobDefinition({
    jobKey: 'bad key',
    criticality: 'HIGH',
    maxAttempts: 1,
    dependencyKeys: [],
  }))
})

test('job coordinator blocks dependencies and duplicate leases before task work', async () => {
  let calls = 0
  const task = { execute: async () => { calls += 1; return { completed: 1, total: 1, resultCode: 'OK' } } }
  const dependencyBlocked = await new JobCoordinator(
    leasePort({ dependenciesReady: false }),
    clock,
  ).run(definition, task, 'SCHEDULED')
  assert.deepEqual(dependencyBlocked, { ok: false, code: 'JOB_DEPENDENCY_BLOCKED', retryable: true })
  const alreadyLeased = await new JobCoordinator(leasePort(), clock).run(definition, task, 'MANUAL')
  assert.deepEqual(alreadyLeased, { ok: false, code: 'JOB_ALREADY_LEASED', retryable: true })
  assert.equal(calls, 0)
})

test('job coordinator passes the durable lease token as the task idempotency key', async () => {
  const events: string[] = []
  let idempotencyKey = ''
  const result = await new JobCoordinator(leasePort({ acquired: lease, events }), clock).run(
    definition,
    { execute: async (input) => {
      idempotencyKey = input.idempotencyKey
      return Object.freeze({ completed: 1, total: 1, resultCode: 'RECONCILED' })
    } },
    'SCHEDULED',
  )
  assert.equal(result.ok, true)
  assert.equal(idempotencyKey, lease.leaseToken)
  assert.deepEqual(events, ['succeeded'])
})

test('job failures are recorded with bounded retry eligibility', async () => {
  const events: string[] = []
  const result = await new JobCoordinator(leasePort({ acquired: lease, events }), clock).run(
    definition,
    { execute: async () => { throw new Error('raw failure must not escape') } },
    'RECOVERY',
  )
  assert.deepEqual(result, { ok: false, code: 'JOB_TASK_FAILED', retryable: true })
  assert.deepEqual(events, ['JOB_TASK_FAILED:true'])
})

test('a completion-write failure becomes recovery-required instead of retrying completed work', async () => {
  const events: string[] = []
  const port = leasePort({ acquired: lease, events })
  port.succeed = async () => { throw new Error('commit uncertain') }
  const result = await new JobCoordinator(port, clock).run(
    definition,
    { execute: async () => ({ completed: 1, total: 1, resultCode: 'DONE' }) },
    'SCHEDULED',
  )
  assert.deepEqual(result, { ok: false, code: 'JOB_COMPLETION_UNKNOWN', retryable: false })
  assert.deepEqual(events, ['recovery-required'])
})

test('restart classification marks every incomplete lease for recovery', async () => {
  const events: string[] = []
  const result = await new JobCoordinator(
    leasePort({ incomplete: [lease, { ...lease, runId: 'run-2' }], events }),
    clock,
  ).classifyIncomplete()
  assert.equal(result.length, 2)
  assert.deepEqual(events, ['recovery-required', 'recovery-required'])
})

test('health aggregation blocks a failed critical probe and only degrades medium work', async () => {
  const healthy: HealthProbePort = { probe: async () => ({
    component: 'database', criticality: 'CRITICAL', state: 'HEALTHY', checkedAt: now, code: 'OK',
  }) }
  const medium: HealthProbePort = { probe: async () => ({
    component: 'reports', criticality: 'MEDIUM', state: 'DEGRADED', checkedAt: now, code: 'STALE',
  }) }
  const degraded = await new OperationsHealthService([healthy, medium], clock).inspect()
  assert.equal(degraded.ok && degraded.value.state, 'DEGRADED')
  const blocked = await new OperationsHealthService([healthy, { probe: async () => { throw new Error('secret') } }], clock).inspect()
  assert.equal(blocked.ok && blocked.value.state, 'BLOCKED')
  assert.equal(blocked.ok && blocked.value.components[1]?.code, 'PROBE_FAILED')
})

test('backup orchestration requires healthy operations, valid audit, and verified output', async () => {
  const health = new OperationsHealthService([{
    probe: async () => ({
      component: 'database', criticality: 'CRITICAL', state: 'HEALTHY', checkedAt: now, code: 'OK',
    }),
  }], clock)
  const receipt = Object.freeze({
    backupId: 'backup-1', destination: 'safe.db', createdAt: now, schemaVersion: 2, verifiedEventStreams: 3,
  })
  const backups: BackupOperationsPort = {
    create: async () => receipt,
    verify: async () => true,
  }
  const service = new BackupRecoveryService(
    health,
    { verify: async () => ({ valid: true, verifiedStreams: 3, code: 'OK' }) },
    backups,
  )
  assert.deepEqual(await service.createVerifiedBackup('safe.db'), { ok: true, value: receipt })
  const invalidAudit = new BackupRecoveryService(
    health,
    { verify: async () => ({ valid: false, verifiedStreams: 0, code: 'BROKEN' }) },
    backups,
  )
  assert.deepEqual(await invalidAudit.restorePreflight(), {
    ok: false, code: 'AUDIT_INTEGRITY_FAILED', retryable: false,
  })
})

test('incident lifecycle is append-only and closing requires action evidence', async () => {
  const history: IncidentRecord[] = []
  const repository: IncidentRepositoryPort = {
    append: async (record) => { history.push(record) },
    findById: async (id) => history.find((record) => record.incidentId === id),
  }
  const service = new IncidentService(repository)
  const opened = await service.open({
    incidentId: 'incident-1', severity: 'SEV2', openedAt: now, code: 'BROKER_OUTAGE', correlationId: 'corr-1',
  })
  assert.equal(opened.ok, true)
  if (!opened.ok) throw new Error('incident did not open')
  assert.equal((await service.close(opened.value, later, [])).ok, false)
  const closed = await service.close(opened.value, later, ['RESTORE_VERIFIED', 'ROOT_CAUSE_REVIEWED'])
  assert.equal(closed.ok && closed.value.state, 'CLOSED')
  assert.equal(history.length, 2)
})
