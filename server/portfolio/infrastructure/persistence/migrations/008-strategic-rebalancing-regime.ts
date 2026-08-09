import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const STRATEGIC_REBALANCING_REGIME_SQL = `
CREATE TABLE portfolio_strategic_rebalance_observations (
  observation_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  plan_id TEXT NOT NULL REFERENCES portfolio_rebalance_plans(plan_id),
  policy_version TEXT NOT NULL CHECK (policy_version = 'STRATEGIC_REBALANCE_V1'),
  decision_session_date TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('NORMAL', 'NEGATIVE_UNCONFIRMED', 'NEGATIVE_CONFIRMED', 'DATA_BLOCKED', 'FORCED_REVIEW')),
  risk_benchmark TEXT NOT NULL,
  defensive_benchmark TEXT NOT NULL,
  signal_json TEXT NOT NULL CHECK (json_valid(signal_json)),
  data_hash TEXT NOT NULL CHECK (length(data_hash) = 64),
  delayed_buy_minor_units TEXT NOT NULL,
  retained_cash_minor_units TEXT NOT NULL,
  delay_started_on TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_strategic_rebalance_observations_scope_idx
  ON portfolio_strategic_rebalance_observations(portfolio_id, created_at DESC, observation_id DESC);

CREATE TRIGGER portfolio_strategic_rebalance_observations_no_update
BEFORE UPDATE ON portfolio_strategic_rebalance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STRATEGIC_REBALANCE_OBSERVATION');
END;

CREATE TRIGGER portfolio_strategic_rebalance_observations_no_delete
BEFORE DELETE ON portfolio_strategic_rebalance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STRATEGIC_REBALANCE_OBSERVATION');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_strategic_rebalance_observations_no_delete;
DROP TRIGGER portfolio_strategic_rebalance_observations_no_update;
DROP TABLE portfolio_strategic_rebalance_observations;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const STRATEGIC_REBALANCING_REGIME_MIGRATION: MigrationDefinition = Object.freeze({
  id: 8,
  name: 'strategic-rebalancing-regime',
  upSql: STRATEGIC_REBALANCING_REGIME_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(STRATEGIC_REBALANCING_REGIME_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_strategic_rebalance_observations'",
    ).get() as { name: string } | undefined
    if (table === undefined) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
