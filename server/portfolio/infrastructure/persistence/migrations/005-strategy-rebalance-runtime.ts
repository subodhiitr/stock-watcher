import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const STRATEGY_REBALANCE_RUNTIME_SQL = `
CREATE TABLE portfolio_rebalance_plans (
  plan_id TEXT PRIMARY KEY,
  rebalance_run_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  portfolio_state_version INTEGER NOT NULL CHECK (portfolio_state_version >= 1),
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(strategy_version_id),
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64),
  market_data_source TEXT NOT NULL CHECK (market_data_source = 'YAHOO_RESEARCH'),
  market_data_as_of TEXT NOT NULL,
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_rebalance_plans_scope_idx
  ON portfolio_rebalance_plans(portfolio_id, created_at DESC, plan_id DESC);

CREATE TABLE portfolio_rebalance_plan_events (
  event_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES portfolio_rebalance_plans(plan_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  plan_state TEXT NOT NULL CHECK (plan_state IN ('PREVIEW_READY', 'APPROVED_PAPER', 'SUPERSEDED')),
  actor_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 2 AND 64),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_rebalance_plan_events_scope_idx
  ON portfolio_rebalance_plan_events(portfolio_id, occurred_at DESC, event_id DESC);

CREATE TRIGGER portfolio_rebalance_plans_no_update
BEFORE UPDATE ON portfolio_rebalance_plans
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN');
END;

CREATE TRIGGER portfolio_rebalance_plans_no_delete
BEFORE DELETE ON portfolio_rebalance_plans
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN');
END;

CREATE TRIGGER portfolio_rebalance_plan_events_no_update
BEFORE UPDATE ON portfolio_rebalance_plan_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN_EVENT');
END;

CREATE TRIGGER portfolio_rebalance_plan_events_no_delete
BEFORE DELETE ON portfolio_rebalance_plan_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN_EVENT');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_rebalance_plan_events_no_delete;
DROP TRIGGER portfolio_rebalance_plan_events_no_update;
DROP TRIGGER portfolio_rebalance_plans_no_delete;
DROP TRIGGER portfolio_rebalance_plans_no_update;
DROP TABLE portfolio_rebalance_plan_events;
DROP TABLE portfolio_rebalance_plans;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const STRATEGY_REBALANCE_RUNTIME_MIGRATION: MigrationDefinition = Object.freeze({
  id: 5,
  name: 'strategy-rebalance-runtime',
  upSql: STRATEGY_REBALANCE_RUNTIME_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(STRATEGY_REBALANCE_RUNTIME_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const required = new Set(['portfolio_rebalance_plans', 'portfolio_rebalance_plan_events'])
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as readonly { name: string }[]
    for (const row of rows) required.delete(row.name)
    if (required.size > 0) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
