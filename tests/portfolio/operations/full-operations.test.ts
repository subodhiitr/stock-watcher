import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  IncidentService,
  JobCoordinator,
  SqliteOperationsRepository,
  createJobDefinition,
  parseInstant,
  type Instant,
} from '../../../server/portfolio/index.ts'
import { openTestOwner } from '../persistence/support.ts'

function instant(value: string): Instant {
  const parsed = parseInstant(value)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('invalid instant')
  return parsed.value
}

const now = instant('2026-08-08T02:30:00.000Z')

function inputHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

test('U06 migration creates durable operations tables and owner exposes the repository', async () => {
  const owner = openTestOwner()
  try {
    assert.equal(typeof owner.operations.dashboard, 'function')
    const health = owner.health()
    assert.equal(health.ok, true)
    assert.equal(health.ok && health.value.schemaVersion, 10)
    assert.equal(health.ok && health.value.operationsAuditValid, true)
    const dashboard = await owner.operations.dashboard()
    assert.equal(dashboard.health.state, 'HEALTHY')
  } finally {
    owner.close()
  }
})

test('durable job leases block duplicates, record success, and classify restart recovery', async () => {
  const owner = openTestOwner()
  try {
    const repository = owner.operations
    await repository.recordComponentHealth({
      component: 'DATABASE_HEALTH',
      criticality: 'CRITICAL',
      state: 'HEALTHY',
      checkedAt: now,
      code: 'OK',
    })
    const definition = createJobDefinition({
      jobKey: 'DAILY_SIGNAL_JOB',
      criticality: 'CRITICAL',
      maxAttempts: 2,
      dependencyKeys: ['DATABASE_HEALTH'],
    })
    const first = await repository.acquire({ definition, trigger: 'SCHEDULED', now })
    assert.ok(first)
    const duplicate = await repository.acquire({ definition, trigger: 'MANUAL', now })
    assert.equal(duplicate, undefined)
    if (first === undefined) throw new Error('lease missing')
    await repository.succeed(first, { completed: 1, total: 1, resultCode: 'DONE' }, now)
    const second = await repository.acquire({ definition, trigger: 'RECOVERY', now })
    assert.ok(second)
    if (second === undefined) throw new Error('second lease missing')
    await repository.markRecoveryRequired(second, now)
    const dashboard = await repository.dashboard()
    assert.equal(dashboard.jobs.some((job) => job.state === 'RECOVERY_REQUIRED'), true)
    assert.equal(dashboard.jobs.some((job) => job.state === 'SUCCEEDED'), true)
  } finally {
    owner.close()
  }
})

test('operations repository records alerts, backups, incidents, and hash-chained audit decisions', async () => {
  const owner = openTestOwner()
  try {
    const repository = owner.operations
    await repository.appendAlert({
      alertId: `alert:${randomUUID()}`,
      severity: 'SEV2',
      category: 'BACKUP_FAILURE',
      detailCode: 'DESTINATION_UNAVAILABLE',
      correlationId: 'correlation:ops-test',
      createdAt: now,
      redactedContext: { destination: 'redacted' },
    })
    await repository.recordBackup({
      backupId: `backup:${randomUUID()}`,
      destination: 'C:/redacted/portfolio.backup',
      createdAt: now,
      schemaVersion: 4,
      verifiedEventStreams: 2,
    })
    const incidents = new IncidentService(repository)
    const opened = await incidents.open({
      incidentId: 'incident-full-u6',
      severity: 'SEV1',
      openedAt: now,
      code: 'AUDIT_CHAIN_BLOCKED',
      correlationId: 'correlation:ops-test',
    })
    assert.equal(opened.ok, true)
    if (!opened.ok) throw new Error('incident failed')
    const closed = await incidents.close(opened.value, now, ['ROOT_CAUSE_REVIEWED'])
    assert.equal(closed.ok, true)
    await repository.appendAuditDecision({
      auditEventId: `audit:${randomUUID()}`,
      actorId: 'actor:operator',
      eventType: 'BACKUP_VERIFIED',
      reasonCode: 'SCHEDULED_HOURLY_BACKUP',
      explanation: 'Verified backup completed with redacted destination evidence.',
      inputVersionHash: inputHash('backup-input-v1'),
      createdAt: now,
      redactedPayload: { destinationHash: inputHash('C:/redacted/portfolio.backup') },
    })
    const integrity = await repository.verify()
    assert.equal(integrity.valid, true)
    const dashboard = await repository.dashboard()
    assert.equal(dashboard.alerts.length, 1)
    assert.equal(dashboard.backups.length, 1)
    assert.equal(dashboard.incidents[0]?.state, 'CLOSED')
    assert.equal(dashboard.audit.length, 1)
    assert.equal(dashboard.audit[0]?.previousHash, '0'.repeat(64))
  } finally {
    owner.close()
  }
})

test('job coordinator works against the durable U06 repository', async () => {
  const owner = openTestOwner()
  try {
    const coordinator = new JobCoordinator(owner.operations, { now: () => now })
    const result = await coordinator.run(
      createJobDefinition({
        jobKey: 'SNAPSHOT_EXPORT_JOB',
        criticality: 'HIGH',
        maxAttempts: 1,
        dependencyKeys: [],
      }),
      { execute: async (input) => ({
        completed: input.idempotencyKey.length > 20 ? 1 : 0,
        total: 1,
        resultCode: 'EXPORTED',
      }) },
      'MANUAL',
    )
    assert.equal(result.ok, true)
    const dashboard = await owner.operations.dashboard()
    assert.equal(dashboard.jobs[0]?.resultCode, 'EXPORTED')
  } finally {
    owner.close()
  }
})
