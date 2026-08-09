import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const BROKER_PORTFOLIO_RECONCILIATION_SQL = `
CREATE TABLE portfolio_broker_reconciliations (
  reconciliation_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  broker TEXT NOT NULL CHECK (broker IN ('SHAREKHAN')),
  broker_as_of INTEGER NOT NULL,
  portfolio_state_version_before INTEGER NOT NULL,
  portfolio_state_version_after INTEGER NOT NULL,
  cash_minor_units_before TEXT NOT NULL,
  cash_minor_units_after TEXT NOT NULL,
  added_count INTEGER NOT NULL,
  updated_count INTEGER NOT NULL,
  removed_count INTEGER NOT NULL,
  unchanged_count INTEGER NOT NULL,
  fallback_acquired_on TEXT NOT NULL,
  canonical_payload TEXT NOT NULL CHECK (json_valid(canonical_payload)),
  applied_at TEXT NOT NULL,
  applied_by TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_broker_reconciliations_latest_idx
  ON portfolio_broker_reconciliations(portfolio_id, applied_at DESC, reconciliation_id DESC);

CREATE TRIGGER portfolio_broker_reconciliations_no_update
BEFORE UPDATE ON portfolio_broker_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_BROKER_RECONCILIATION');
END;

CREATE TRIGGER portfolio_broker_reconciliations_no_delete
BEFORE DELETE ON portfolio_broker_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_BROKER_RECONCILIATION');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_broker_reconciliations_no_delete;
DROP TRIGGER portfolio_broker_reconciliations_no_update;
DROP INDEX portfolio_broker_reconciliations_latest_idx;
DROP TABLE portfolio_broker_reconciliations;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const BROKER_PORTFOLIO_RECONCILIATION_MIGRATION: MigrationDefinition = Object.freeze({
  id: 10,
  name: 'broker-portfolio-reconciliation',
  upSql: BROKER_PORTFOLIO_RECONCILIATION_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(BROKER_PORTFOLIO_RECONCILIATION_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const row = database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'portfolio_broker_reconciliations'
    `).get()
    if (row === undefined) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
