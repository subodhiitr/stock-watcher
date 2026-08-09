import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const API_SECURITY_SCHEMA_SQL = `
CREATE TABLE portfolio_principals (
  principal_id TEXT PRIMARY KEY,
  username_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_salt TEXT NOT NULL CHECK (length(password_salt) = 32),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 128),
  global_role TEXT NOT NULL CHECK (global_role IN ('INVESTOR', 'OPERATOR', 'ADMIN')),
  mfa_secret TEXT,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE portfolio_memberships (
  principal_id TEXT NOT NULL REFERENCES portfolio_principals(principal_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  access_role TEXT NOT NULL CHECK (access_role IN ('VIEWER', 'EDITOR', 'OWNER')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (principal_id, portfolio_id)
) STRICT;

CREATE INDEX portfolio_memberships_portfolio_idx
  ON portfolio_memberships(portfolio_id, principal_id);

CREATE TABLE portfolio_sessions (
  session_hash TEXT PRIMARY KEY CHECK (length(session_hash) = 64),
  principal_id TEXT NOT NULL REFERENCES portfolio_principals(principal_id),
  csrf_hash TEXT NOT NULL CHECK (length(csrf_hash) = 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= created_at),
  mfa_verified INTEGER NOT NULL CHECK (mfa_verified IN (0, 1)),
  invalidated_at INTEGER
) STRICT;

CREATE INDEX portfolio_sessions_principal_expiry_idx
  ON portfolio_sessions(principal_id, expires_at);

CREATE TABLE portfolio_idempotency (
  principal_id TEXT NOT NULL REFERENCES portfolio_principals(principal_id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response_status INTEGER,
  response_headers TEXT,
  response_body TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (principal_id, idempotency_key)
) STRICT;

CREATE INDEX portfolio_idempotency_expiry_idx ON portfolio_idempotency(expires_at);

CREATE TABLE portfolio_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (length(bucket_key) = 64),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  blocked_until INTEGER
) STRICT;

CREATE TABLE portfolio_security_alerts (
  alert_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('AUTH_BRUTE_FORCE', 'RATE_LIMIT', 'SESSION_REJECTED')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  detail_code TEXT NOT NULL CHECK (length(detail_code) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TRIGGER portfolio_security_alerts_no_update
BEFORE UPDATE ON portfolio_security_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SECURITY_ALERT');
END;

CREATE TRIGGER portfolio_security_alerts_no_delete
BEFORE DELETE ON portfolio_security_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SECURITY_ALERT');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_security_alerts_no_delete;
DROP TRIGGER portfolio_security_alerts_no_update;
DROP TABLE portfolio_security_alerts;
DROP TABLE portfolio_rate_limits;
DROP TABLE portfolio_idempotency;
DROP TABLE portfolio_sessions;
DROP TABLE portfolio_memberships;
DROP TABLE portfolio_principals;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const API_SECURITY_SCHEMA_MIGRATION: MigrationDefinition = Object.freeze({
  id: 3,
  name: 'portfolio-api-security-schema',
  upSql: API_SECURITY_SCHEMA_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(API_SECURITY_SCHEMA_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const required = new Set([
      'portfolio_principals',
      'portfolio_memberships',
      'portfolio_sessions',
      'portfolio_idempotency',
      'portfolio_rate_limits',
      'portfolio_security_alerts',
    ])
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as readonly { name: string }[]
    for (const row of rows) required.delete(row.name)
    if (required.size > 0) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})

