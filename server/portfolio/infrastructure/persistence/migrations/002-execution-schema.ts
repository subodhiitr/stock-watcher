import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

const CANONICAL_NON_NEGATIVE_INTEGER =
  "(VALUE = '0' OR (length(VALUE) > 0 AND VALUE NOT GLOB '*[^0-9]*' AND substr(VALUE, 1, 1) BETWEEN '1' AND '9'))"

function integerCheck(column: string): string {
  return CANONICAL_NON_NEGATIVE_INTEGER.replaceAll('VALUE', column)
}

const PAYLOAD_CHECK =
  'length(canonical_payload) BETWEEN 2 AND 1048576'

export const EXECUTION_SCHEMA_SQL = `
CREATE TABLE execution_approvals (
  approval_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  rebalance_run_id TEXT NOT NULL,
  approval_state TEXT NOT NULL CHECK (
    approval_state IN (
      'PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED',
      'INVALIDATED', 'EXPIRED', 'CONSUMED'
    )
  ),
  decision_kind TEXT NOT NULL CHECK (
    decision_kind IN ('APPROVE_BASKET', 'APPROVE_SUBSET', 'REJECT')
  ),
  idempotency_key TEXT NOT NULL,
  consumed_by_execution_run_id TEXT,
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  UNIQUE (portfolio_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX execution_approvals_active_portfolio_uq
  ON execution_approvals(portfolio_id)
  WHERE approval_state IN ('APPROVED', 'PARTIALLY_APPROVED');

CREATE TABLE execution_runs (
  execution_run_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  approval_id TEXT NOT NULL UNIQUE REFERENCES execution_approvals(approval_id),
  run_state TEXT NOT NULL CHECK (
    run_state IN (
      'CREATED', 'VALIDATING', 'READY', 'SELLING', 'RECONCILING_SELLS',
      'BUYING', 'RECONCILING_BUYS', 'CANCELLING', 'RECOVERY_REQUIRED',
      'BLOCKED', 'COMPLETED', 'COMPLETED_WITH_RESIDUAL', 'CANCELLED'
    )
  ),
  mode TEXT NOT NULL CHECK (
    mode IN ('PAPER', 'DRY_RUN', 'FAKE_TEST', 'LIVE_ZERODHA', 'LIVE_SHAREKHAN')
  ),
  portfolio_state_version INTEGER NOT NULL CHECK (portfolio_state_version >= 1),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE INDEX execution_runs_recovery_idx
  ON execution_runs(run_state, updated_at, execution_run_id);
CREATE INDEX execution_runs_portfolio_state_idx
  ON execution_runs(portfolio_id, run_state, execution_run_id);

CREATE TABLE execution_orders (
  order_id TEXT PRIMARY KEY,
  execution_run_id TEXT NOT NULL REFERENCES execution_runs(execution_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_state TEXT NOT NULL CHECK (
    order_state IN (
      'PLANNED', 'RESIDUAL', 'INTENT_RECORDED', 'SUBMISSION_IN_FLIGHT',
      'ACKNOWLEDGED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED',
      'UNKNOWN', 'CANCEL_PENDING', 'CANCELLED', 'EXPIRED'
    )
  ),
  logical_order_key TEXT NOT NULL CHECK (length(logical_order_key) = 64),
  idempotency_key TEXT NOT NULL,
  order_sequence INTEGER NOT NULL CHECK (order_sequence >= 1),
  approved_quantity_shares TEXT NOT NULL CHECK (${integerCheck('approved_quantity_shares')}),
  filled_quantity_shares TEXT NOT NULL CHECK (${integerCheck('filled_quantity_shares')}),
  broker_order_reference_id TEXT,
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  UNIQUE (execution_run_id, logical_order_key),
  UNIQUE (execution_run_id, order_sequence),
  UNIQUE (portfolio_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX execution_orders_broker_reference_uq
  ON execution_orders(portfolio_id, broker_order_reference_id)
  WHERE broker_order_reference_id IS NOT NULL;
CREATE INDEX execution_orders_run_idx
  ON execution_orders(execution_run_id, order_sequence, order_id);
CREATE INDEX execution_orders_recovery_idx
  ON execution_orders(order_state, portfolio_id, execution_run_id, order_id);

CREATE TABLE reconciliation_runs (
  reconciliation_run_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  reconciliation_state TEXT NOT NULL CHECK (
    reconciliation_state IN (
      'REQUESTED', 'COLLECTING', 'COMPARING', 'MATCHED',
      'MATCHED_WITH_ROUNDING', 'MISMATCH', 'UNKNOWN', 'BLOCKED'
    )
  ),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  prior_run_id TEXT REFERENCES reconciliation_runs(reconciliation_run_id),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE INDEX reconciliation_runs_portfolio_latest_idx
  ON reconciliation_runs(portfolio_id, started_at DESC, reconciliation_run_id);
CREATE INDEX reconciliation_runs_recovery_idx
  ON reconciliation_runs(reconciliation_state, started_at, reconciliation_run_id);

CREATE TABLE reconciliation_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT REFERENCES reconciliation_runs(reconciliation_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  source TEXT NOT NULL CHECK (source IN ('LOCAL', 'PAPER', 'ZERODHA', 'SHAREKHAN')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  captured_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE INDEX reconciliation_snapshots_run_idx
  ON reconciliation_snapshots(portfolio_id, source, captured_at, snapshot_id);

CREATE TABLE execution_kill_switches (
  kill_switch_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('GLOBAL', 'PORTFOLIO')),
  portfolio_id TEXT REFERENCES portfolios(portfolio_id),
  switch_state TEXT NOT NULL CHECK (switch_state IN ('INACTIVE', 'ACTIVE')),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  CHECK (
    (scope_kind = 'GLOBAL' AND portfolio_id IS NULL)
    OR (scope_kind = 'PORTFOLIO' AND portfolio_id IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX execution_kill_switch_global_uq
  ON execution_kill_switches(scope_kind) WHERE scope_kind = 'GLOBAL';
CREATE UNIQUE INDEX execution_kill_switch_portfolio_uq
  ON execution_kill_switches(portfolio_id) WHERE scope_kind = 'PORTFOLIO';
CREATE INDEX execution_kill_switch_active_idx
  ON execution_kill_switches(switch_state, scope_kind, portfolio_id);

CREATE TABLE execution_fills (
  fill_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  execution_run_id TEXT NOT NULL REFERENCES execution_runs(execution_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity_shares TEXT NOT NULL CHECK (${integerCheck('quantity_shares')}),
  price_minor_units TEXT NOT NULL CHECK (${integerCheck('price_minor_units')}),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  trade_time TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE INDEX execution_fills_order_idx
  ON execution_fills(order_id, trade_time, fill_id);
CREATE INDEX execution_fills_run_idx
  ON execution_fills(execution_run_id, trade_time, fill_id);

CREATE TABLE execution_cancellation_requests (
  cancellation_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  idempotency_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  UNIQUE (order_id, idempotency_key)
) STRICT;

CREATE INDEX execution_cancellation_requests_order_idx
  ON execution_cancellation_requests(order_id, requested_at, cancellation_id);

CREATE TABLE execution_cancellation_outcomes (
  cancellation_id TEXT PRIMARY KEY
    REFERENCES execution_cancellation_requests(cancellation_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('ACKNOWLEDGED', 'REJECTED', 'UNKNOWN')),
  completed_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE TABLE execution_residual_work (
  residual_work_id TEXT PRIMARY KEY,
  execution_run_id TEXT NOT NULL REFERENCES execution_runs(execution_run_id),
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  remaining_quantity_shares TEXT NOT NULL CHECK (${integerCheck('remaining_quantity_shares')}),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'PARTIAL_FILL', 'REJECTED', 'CANCELLED', 'EXPIRED',
      'PRICE_STALE', 'CASH_REDUCED', 'RECOVERY_REQUIRED'
    )
  ),
  created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  UNIQUE (execution_run_id, order_id)
) STRICT;

CREATE INDEX execution_residual_work_run_idx
  ON execution_residual_work(execution_run_id, created_at, residual_work_id);

CREATE TABLE execution_adjustment_proposals (
  adjustment_proposal_id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT NOT NULL REFERENCES reconciliation_runs(reconciliation_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  proposal_state TEXT NOT NULL CHECK (
    proposal_state IN ('PROPOSED', 'APPROVED', 'REJECTED', 'APPLIED')
  ),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK})
) STRICT;

CREATE INDEX execution_adjustment_proposals_run_idx
  ON execution_adjustment_proposals(reconciliation_run_id, adjustment_proposal_id);

CREATE TABLE execution_domain_events (
  event_id TEXT PRIMARY KEY,
  stream_key TEXT NOT NULL,
  stream_sequence INTEGER NOT NULL CHECK (stream_sequence >= 1),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  event_type TEXT NOT NULL,
  event_schema_version INTEGER NOT NULL CHECK (event_schema_version = 1),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('PORTFOLIO', 'GLOBAL')),
  portfolio_id TEXT REFERENCES portfolios(portfolio_id),
  aggregate_state_version INTEGER,
  mutation_kind TEXT,
  aggregate_id TEXT,
  fact_kind TEXT,
  fact_id TEXT,
  occurred_at TEXT NOT NULL,
  canonical_payload TEXT NOT NULL CHECK (${PAYLOAD_CHECK}),
  inserted_at TEXT NOT NULL,
  CHECK (
    (scope_kind = 'PORTFOLIO' AND portfolio_id IS NOT NULL)
    OR (scope_kind = 'GLOBAL' AND portfolio_id IS NULL AND stream_key = 'GLOBAL_EXECUTION_CONTROL')
  ),
  CHECK (
    (mutation_kind IS NOT NULL AND aggregate_id IS NOT NULL
      AND aggregate_state_version IS NOT NULL AND fact_kind IS NULL AND fact_id IS NULL)
    OR (mutation_kind IS NULL AND aggregate_id IS NULL
      AND aggregate_state_version IS NULL AND fact_kind IS NOT NULL AND fact_id IS NOT NULL)
  ),
  UNIQUE (stream_key, stream_sequence),
  UNIQUE (stream_key, event_hash)
) STRICT;

CREATE INDEX execution_domain_events_portfolio_idx
  ON execution_domain_events(portfolio_id, stream_sequence);

CREATE TABLE execution_event_dispatch (
  event_id TEXT PRIMARY KEY REFERENCES execution_domain_events(event_id),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'DEAD_LETTER')
  ),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  published_at TEXT,
  last_failure_code TEXT
) STRICT;

CREATE INDEX execution_event_dispatch_pending_idx
  ON execution_event_dispatch(status, available_at, event_id);

CREATE TRIGGER reconciliation_snapshots_no_update
BEFORE UPDATE ON reconciliation_snapshots
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECONCILIATION_SNAPSHOT'); END;
CREATE TRIGGER reconciliation_snapshots_no_delete
BEFORE DELETE ON reconciliation_snapshots
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECONCILIATION_SNAPSHOT'); END;

CREATE TRIGGER execution_fills_no_update
BEFORE UPDATE ON execution_fills
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_FILL'); END;
CREATE TRIGGER execution_fills_no_delete
BEFORE DELETE ON execution_fills
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_FILL'); END;

CREATE TRIGGER execution_cancellation_requests_no_update
BEFORE UPDATE ON execution_cancellation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_REQUEST'); END;
CREATE TRIGGER execution_cancellation_requests_no_delete
BEFORE DELETE ON execution_cancellation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_REQUEST'); END;

CREATE TRIGGER execution_cancellation_outcomes_no_update
BEFORE UPDATE ON execution_cancellation_outcomes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_OUTCOME'); END;
CREATE TRIGGER execution_cancellation_outcomes_no_delete
BEFORE DELETE ON execution_cancellation_outcomes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_OUTCOME'); END;

CREATE TRIGGER execution_residual_work_no_update
BEFORE UPDATE ON execution_residual_work
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RESIDUAL_WORK'); END;
CREATE TRIGGER execution_residual_work_no_delete
BEFORE DELETE ON execution_residual_work
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RESIDUAL_WORK'); END;

CREATE TRIGGER execution_domain_events_no_update
BEFORE UPDATE ON execution_domain_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_EVENT'); END;
CREATE TRIGGER execution_domain_events_no_delete
BEFORE DELETE ON execution_domain_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_EVENT'); END;
`

const DOWN_SQL = `
DROP TRIGGER execution_domain_events_no_delete;
DROP TRIGGER execution_domain_events_no_update;
DROP TRIGGER execution_residual_work_no_delete;
DROP TRIGGER execution_residual_work_no_update;
DROP TRIGGER execution_cancellation_outcomes_no_delete;
DROP TRIGGER execution_cancellation_outcomes_no_update;
DROP TRIGGER execution_cancellation_requests_no_delete;
DROP TRIGGER execution_cancellation_requests_no_update;
DROP TRIGGER execution_fills_no_delete;
DROP TRIGGER execution_fills_no_update;
DROP TRIGGER reconciliation_snapshots_no_delete;
DROP TRIGGER reconciliation_snapshots_no_update;
DROP TABLE execution_event_dispatch;
DROP TABLE execution_domain_events;
DROP TABLE execution_adjustment_proposals;
DROP TABLE execution_residual_work;
DROP TABLE execution_cancellation_outcomes;
DROP TABLE execution_cancellation_requests;
DROP TABLE execution_fills;
DROP TABLE execution_kill_switches;
DROP TABLE reconciliation_snapshots;
DROP TABLE reconciliation_runs;
DROP TABLE execution_orders;
DROP TABLE execution_runs;
DROP TABLE execution_approvals;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const EXECUTION_SCHEMA_MIGRATION: MigrationDefinition = Object.freeze({
  id: 2,
  name: 'execution-and-reconciliation-schema',
  upSql: EXECUTION_SCHEMA_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(EXECUTION_SCHEMA_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as readonly { name: string }[]
    const names = new Set(rows.map((row) => row.name))
    for (const required of [
      'execution_approvals',
      'execution_runs',
      'execution_orders',
      'reconciliation_runs',
      'reconciliation_snapshots',
      'execution_kill_switches',
      'execution_fills',
      'execution_cancellation_requests',
      'execution_cancellation_outcomes',
      'execution_residual_work',
      'execution_adjustment_proposals',
      'execution_domain_events',
      'execution_event_dispatch',
    ]) {
      if (!names.has(required)) throw new Error('MIGRATION_ASSERTION_FAILED')
    }
  },
})
