import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const MANUAL_PAPER_EXITS_SQL = `
CREATE TABLE portfolio_manual_exits (
  exit_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  holding_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  quantity TEXT NOT NULL,
  execution_price_minor_units TEXT NOT NULL,
  gross_proceeds_minor_units TEXT NOT NULL,
  released_cost_basis_minor_units TEXT NOT NULL,
  realized_pnl_minor_units TEXT NOT NULL,
  charges_minor_units TEXT NOT NULL,
  tax_minor_units TEXT NOT NULL,
  net_proceeds_minor_units TEXT NOT NULL,
  portfolio_state_version_before INTEGER NOT NULL CHECK (portfolio_state_version_before >= 1),
  portfolio_state_version_after INTEGER NOT NULL CHECK (portfolio_state_version_after = portfolio_state_version_before + 1),
  exit_kind TEXT NOT NULL CHECK (exit_kind IN ('FULL', 'PARTIAL')),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 2 AND 64),
  risk_snapshot_json TEXT NOT NULL CHECK (json_valid(risk_snapshot_json)),
  market_data_source TEXT NOT NULL CHECK (market_data_source = 'YAHOO_RESEARCH'),
  executed_at TEXT NOT NULL,
  executed_by TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_manual_exits_scope_idx
  ON portfolio_manual_exits(portfolio_id, executed_at DESC, exit_id DESC);

CREATE TRIGGER portfolio_manual_exits_no_update
BEFORE UPDATE ON portfolio_manual_exits
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_MANUAL_EXIT');
END;

CREATE TRIGGER portfolio_manual_exits_no_delete
BEFORE DELETE ON portfolio_manual_exits
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_MANUAL_EXIT');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_manual_exits_no_delete;
DROP TRIGGER portfolio_manual_exits_no_update;
DROP TABLE portfolio_manual_exits;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const MANUAL_PAPER_EXITS_MIGRATION: MigrationDefinition = Object.freeze({
  id: 7,
  name: 'manual-paper-exits',
  upSql: MANUAL_PAPER_EXITS_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(MANUAL_PAPER_EXITS_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const row = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_manual_exits'",
    ).get() as { name: string } | undefined
    if (row === undefined) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
