import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const OPERATIONS_SCHEMA_SQL = `
CREATE TABLE portfolio_job_runs (
  run_id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL CHECK (length(job_key) BETWEEN 3 AND 64),
  portfolio_id TEXT REFERENCES portfolios(portfolio_id),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('SCHEDULED', 'MANUAL', 'RECOVERY')),
  run_state TEXT NOT NULL CHECK (run_state IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'RECOVERY_REQUIRED')),
  lease_token TEXT NOT NULL UNIQUE,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  completed_at TEXT,
  progress_completed INTEGER NOT NULL DEFAULT 0 CHECK (progress_completed >= 0),
  progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
  result_code TEXT NOT NULL DEFAULT 'RUNNING' CHECK (length(result_code) BETWEEN 2 AND 64),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX portfolio_job_runs_active_uq
  ON portfolio_job_runs(job_key, COALESCE(portfolio_id, ''))
  WHERE run_state = 'RUNNING';
CREATE INDEX portfolio_job_runs_state_idx
  ON portfolio_job_runs(run_state, expires_at, job_key);

CREATE TABLE portfolio_component_health (
  component TEXT PRIMARY KEY CHECK (length(component) BETWEEN 2 AND 96),
  criticality TEXT NOT NULL CHECK (criticality IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  state TEXT NOT NULL CHECK (state IN ('HEALTHY', 'DEGRADED', 'BLOCKED')),
  checked_at TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 64)
) STRICT;

CREATE TABLE portfolio_operations_alerts (
  alert_id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 2 AND 64),
  detail_code TEXT NOT NULL CHECK (length(detail_code) BETWEEN 2 AND 64),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 3 AND 128),
  created_at TEXT NOT NULL,
  redacted_context TEXT NOT NULL CHECK (length(redacted_context) BETWEEN 2 AND 8192)
) STRICT;

CREATE TABLE portfolio_backup_receipts (
  backup_id TEXT PRIMARY KEY,
  destination_hash TEXT NOT NULL CHECK (length(destination_hash) = 64),
  created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  verified_event_streams INTEGER NOT NULL CHECK (verified_event_streams >= 0),
  verification_code TEXT NOT NULL CHECK (length(verification_code) BETWEEN 2 AND 64)
) STRICT;

CREATE TABLE portfolio_incident_events (
  incident_event_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL CHECK (length(incident_id) BETWEEN 3 AND 64),
  severity TEXT NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3')),
  incident_state TEXT NOT NULL CHECK (incident_state IN ('OPEN', 'CONTAINED', 'CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 64),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 3 AND 128),
  action_codes TEXT NOT NULL CHECK (length(action_codes) BETWEEN 2 AND 2048),
  appended_at TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_incident_events_latest_idx
  ON portfolio_incident_events(incident_id, appended_at DESC, incident_event_id DESC);

CREATE TABLE portfolio_audit_events (
  audit_event_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 3 AND 128),
  portfolio_id TEXT,
  run_id TEXT,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 2 AND 64),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 2 AND 64),
  explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 2048),
  input_version_hash TEXT NOT NULL CHECK (length(input_version_hash) = 64),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  created_at TEXT NOT NULL,
  redacted_payload TEXT NOT NULL CHECK (length(redacted_payload) BETWEEN 2 AND 16384)
) STRICT;

CREATE INDEX portfolio_audit_events_scope_idx
  ON portfolio_audit_events(portfolio_id, created_at DESC, audit_event_id DESC);

CREATE TRIGGER portfolio_operations_alerts_no_update
BEFORE UPDATE ON portfolio_operations_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_OPERATIONS_ALERT');
END;

CREATE TRIGGER portfolio_operations_alerts_no_delete
BEFORE DELETE ON portfolio_operations_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_OPERATIONS_ALERT');
END;

CREATE TRIGGER portfolio_incident_events_no_update
BEFORE UPDATE ON portfolio_incident_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INCIDENT_EVENT');
END;

CREATE TRIGGER portfolio_incident_events_no_delete
BEFORE DELETE ON portfolio_incident_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INCIDENT_EVENT');
END;

CREATE TRIGGER portfolio_audit_events_no_update
BEFORE UPDATE ON portfolio_audit_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_AUDIT_EVENT');
END;

CREATE TRIGGER portfolio_audit_events_no_delete
BEFORE DELETE ON portfolio_audit_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_AUDIT_EVENT');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_audit_events_no_delete;
DROP TRIGGER portfolio_audit_events_no_update;
DROP TRIGGER portfolio_incident_events_no_delete;
DROP TRIGGER portfolio_incident_events_no_update;
DROP TRIGGER portfolio_operations_alerts_no_delete;
DROP TRIGGER portfolio_operations_alerts_no_update;
DROP TABLE portfolio_audit_events;
DROP TABLE portfolio_incident_events;
DROP TABLE portfolio_backup_receipts;
DROP TABLE portfolio_operations_alerts;
DROP TABLE portfolio_component_health;
DROP TABLE portfolio_job_runs;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const OPERATIONS_SCHEMA_MIGRATION: MigrationDefinition = Object.freeze({
  id: 4,
  name: 'portfolio-operations-schema',
  upSql: OPERATIONS_SCHEMA_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(OPERATIONS_SCHEMA_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const required = new Set([
      'portfolio_job_runs',
      'portfolio_component_health',
      'portfolio_operations_alerts',
      'portfolio_backup_receipts',
      'portfolio_incident_events',
      'portfolio_audit_events',
    ])
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as readonly { name: string }[]
    for (const row of rows) required.delete(row.name)
    if (required.size > 0) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
