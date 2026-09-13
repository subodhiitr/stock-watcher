# Database schema reference

Schema-only reference captured on 2026-09-10 from the three application SQLite databases, opened read-only. No application records, credential values, or session values were queried. Local developer-tool databases (CodeGraph and Headroom) are outside application scope.

This describes the installed schema, including applied ALTER TABLE changes. Source migrations remain authoritative for creating/upgrading installations. Recheck this reference after schema changes; an older installation may differ.

## Reading the schema

- Each table has a purpose and its exact installed CREATE TABLE statement, followed by explicit indexes and triggers when present.
- PRIMARY KEY, UNIQUE, NOT NULL, DEFAULT, CHECK, and REFERENCES clauses express the stored constraints. Composite keys identify records using several columns. SQLite may also create implicit indexes for keys; those are represented by their table constraints rather than separate CREATE INDEX statements.
- REFERENCES clauses are enforced relationships when foreign-key enforcement is enabled. Similarly named IDs without REFERENCES are application-managed associations; do not assume SQLite enforces them.
- JSON/payload columns contain documents defined by their owning service or codec. A TEXT column alone does not define the nested document schema. canonical_payload is a deterministic serialized domain document; schema_version identifies its encoding version where present.
- Portfolio fields ending in _minor_units use exact monetary minor units; _ppm fields use parts per million. Some exact numeric values are stored as TEXT and must be decoded by the portfolio codecs rather than treated as arbitrary strings or floating-point amounts.
- Main application timestamps commonly use epoch milliseconds, while portfolio timestamps may be ISO text. The declaration and owning codec determine the representation; do not assume a single timestamp format across databases.
- SQLite has special primary-key/nullability behavior, so interpret the complete DDL rather than relying only on a PRAGMA notnull flag.

## Database ownership and relationships

The main application database holds dashboard preferences, provider caches, and the legacy trading ledger. The portfolio database has independent accounting and execution state. Snapshot storage is separate so historical captures can be queried without loading every date. There are no cross-file foreign keys connecting these databases.

Within the portfolio database, portfolios own holdings and acquisition lots, allocation policies and strategy assignments, plans, approvals, and execution runs. Runs connect to orders and fills; reconciliation records capture discrepancies and proposals. Security principals connect to sessions and portfolio memberships. Event ledgers and dispatch tables separate durable facts from delivery state. The SQL below shows which of those associations have declared foreign keys.

## Main application

File: `stock-watcher.db`. Schema owners: `server/db.js`, `server/db-migrate.js`. **20 tables.**

| Table | What it holds |
| --- | --- |
| `day_pnl` | Daily profit/loss totals for the dashboard. |
| `etf_holdings_cache` | Expiring provider payloads describing ETF holdings. |
| `etf_master` | ETF metadata plus saved and favorite flags. |
| `etf_nav_daily` | Dated ETF net asset values and supporting provider data. |
| `etf_quote_cache` | Expiring ETF quote responses. |
| `exit_quality_reconciliation` | Incremental exit-analysis cursor, progress, completion status, and errors. |
| `exit_quality_summary` | Computed exit-quality aggregates by category and reporting period. |
| `exit_quality_trade_facts` | Per-exit analysis facts linked by position ID to the originating trade. |
| `fresh_news` | Per-symbol, per-date news arrays with expiration and update timestamps; the dated filesystem cache additionally holds scan coverage. |
| `json_cache` | Named JSON cache entries with expiry; payload shape depends on the key and owning service. |
| `kv_store` | Named application settings and preferences encoded as values; interpretation depends on the key. |
| `portfolio_state` | Legacy portfolio state documents, separate from the TypeScript portfolio subsystem. |
| `schema_version` | Main database schema version marker. |
| `scripts_master` | Cross-provider instrument identifiers and independent provider update timestamps. |
| `setup_efficiency_reconciliation` | Incremental setup-analysis cursor, progress, completion status, and errors. |
| `setup_efficiency_summary` | Computed setup performance aggregates by setup type and reporting period. |
| `setup_efficiency_trade_facts` | Position-level setup performance facts and reconciliation timestamps. |
| `strategy_advisor_runs` | Strategy-review run progress, phases, status, and result/evidence payloads for a trading date. |
| `symbols` | Saved and simulation stock symbols, company metadata, source membership, and favorites. |
| `trade_txns` | Legacy trade transaction documents plus closing-price and exit-category fields used by analysis. |

### day_pnl

Daily profit/loss totals for the dashboard.

```sql
CREATE TABLE day_pnl (
      date TEXT PRIMARY KEY,
      pnl REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### etf_holdings_cache

Expiring provider payloads describing ETF holdings.

```sql
CREATE TABLE etf_holdings_cache (
      symbol TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### etf_master

ETF metadata plus saved and favorite flags.

```sql
CREATE TABLE etf_master (
      symbol TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      is_saved INTEGER NOT NULL DEFAULT 0 CHECK (is_saved IN (0, 1)),
      is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### etf_nav_daily

Dated ETF net asset values and supporting provider data.

```sql
CREATE TABLE etf_nav_daily (
      symbol TEXT NOT NULL,
      nav_date TEXT NOT NULL,
      nav REAL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, nav_date)
    );
```

### etf_quote_cache

Expiring ETF quote responses.

```sql
CREATE TABLE etf_quote_cache (
      symbol TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### exit_quality_reconciliation

Incremental exit-analysis cursor, progress, completion status, and errors.

```sql
CREATE TABLE exit_quality_reconciliation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cursor_updated_at INTEGER NOT NULL DEFAULT 0,
      cursor_trade_id TEXT NOT NULL DEFAULT '',
      last_started_at INTEGER NOT NULL DEFAULT 0,
      last_completed_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      rows_scanned INTEGER NOT NULL DEFAULT 0,
      exits_updated INTEGER NOT NULL DEFAULT 0,
      close_prices_resolved INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );
```

### exit_quality_summary

Computed exit-quality aggregates by category and reporting period.

```sql
CREATE TABLE exit_quality_summary (
      exit_category TEXT NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL,
      computed_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (exit_category, period)
    );
```

### exit_quality_trade_facts

Per-exit analysis facts linked by position ID to the originating trade.

```sql
CREATE TABLE exit_quality_trade_facts (
      exit_id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      exit_category TEXT NOT NULL,
      side TEXT,
      closed_at INTEGER NOT NULL DEFAULT 0,
      source_updated_at INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      reconciled_at INTEGER NOT NULL DEFAULT 0
    );

CREATE INDEX idx_exit_quality_facts_category_closed
    ON exit_quality_trade_facts(exit_category, closed_at);
```

### fresh_news

Per-symbol, per-date news arrays with expiration and update timestamps; the dated filesystem cache additionally holds scan coverage.

```sql
CREATE TABLE fresh_news (
      symbol TEXT NOT NULL,
      news_date TEXT NOT NULL,
      news_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, news_date)
    );
```

### json_cache

Named JSON cache entries with expiry; payload shape depends on the key and owning service.

```sql
CREATE TABLE json_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL DEFAULT 9999999999999,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### kv_store

Named application settings and preferences encoded as values; interpretation depends on the key.

```sql
CREATE TABLE kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### portfolio_state

Legacy portfolio state documents, separate from the TypeScript portfolio subsystem.

```sql
CREATE TABLE portfolio_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
```

### schema_version

Main database schema version marker.

```sql
CREATE TABLE schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
```

### scripts_master

Cross-provider instrument identifiers and independent provider update timestamps.

```sql
CREATE TABLE scripts_master (
      symbol TEXT PRIMARY KEY,
      sharekhan_code INTEGER,
      zerodha_token INTEGER,
      nse_code TEXT,
      yahoo_symbol TEXT,
      sharekhan_updated_at INTEGER NOT NULL DEFAULT 0,
      zerodha_updated_at INTEGER NOT NULL DEFAULT 0,
      nse_updated_at INTEGER NOT NULL DEFAULT 0,
      yahoo_updated_at INTEGER NOT NULL DEFAULT 0
    );
```

### setup_efficiency_reconciliation

Incremental setup-analysis cursor, progress, completion status, and errors.

```sql
CREATE TABLE setup_efficiency_reconciliation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cursor_updated_at INTEGER NOT NULL DEFAULT 0,
      cursor_trade_id TEXT NOT NULL DEFAULT '',
      last_started_at INTEGER NOT NULL DEFAULT 0,
      last_completed_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'idle',
      rows_scanned INTEGER NOT NULL DEFAULT 0,
      positions_updated INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );
```

### setup_efficiency_summary

Computed setup performance aggregates by setup type and reporting period.

```sql
CREATE TABLE setup_efficiency_summary (
      setup_type TEXT NOT NULL,
      period TEXT NOT NULL,
      data TEXT NOT NULL,
      computed_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (setup_type, period)
    );
```

### setup_efficiency_trade_facts

Position-level setup performance facts and reconciliation timestamps.

```sql
CREATE TABLE setup_efficiency_trade_facts (
      position_id TEXT PRIMARY KEY,
      setup_type TEXT NOT NULL,
      side TEXT,
      closed_at INTEGER NOT NULL DEFAULT 0,
      source_updated_at INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      reconciled_at INTEGER NOT NULL DEFAULT 0
    );

CREATE INDEX idx_setup_efficiency_facts_setup_closed
    ON setup_efficiency_trade_facts(setup_type, closed_at);
```

### strategy_advisor_runs

Strategy-review run progress, phases, status, and result/evidence payloads for a trading date.

```sql
CREATE TABLE strategy_advisor_runs (
      id TEXT PRIMARY KEY,
      trade_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

CREATE INDEX idx_strategy_advisor_runs_date_updated
    ON strategy_advisor_runs(trade_date, updated_at DESC);
```

### symbols

Saved and simulation stock symbols, company metadata, source membership, and favorites.

```sql
CREATE TABLE symbols (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      sector TEXT,
      cap TEXT,
      source TEXT NOT NULL DEFAULT 'saved' CHECK (source IN ('saved', 'simulation', 'both')),
      updated_at INTEGER NOT NULL DEFAULT 0
    , is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)));
```

### trade_txns

Legacy trade transaction documents plus closing-price and exit-category fields used by analysis.

```sql
CREATE TABLE trade_txns (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    , day_close_price REAL, day_close_source TEXT, exit_category TEXT);

CREATE INDEX idx_trade_txns_opened_at
      ON trade_txns (CAST(json_extract(data, '$.openedAt') AS INTEGER));

CREATE INDEX idx_trade_txns_status
      ON trade_txns (json_extract(data, '$.status'));

CREATE INDEX idx_trade_txns_symbol
      ON trade_txns (json_extract(data, '$.symbol'));
```
## Portfolio subsystem

File: `data/portfolio-management.db`. Schema owners: `server/portfolio/infrastructure/persistence/migrations/`, `server/portfolio/adapters/persistence/`. **43 tables.**

| Table | What it holds |
| --- | --- |
| `database_metadata` | Identity and compatibility metadata for this dedicated portfolio database. |
| `domain_events` | Portfolio domain event ledger with stream sequence, hashes, actor/command context, and canonical event payload. |
| `event_dispatch` | Delivery status, retry timing, and leases for portfolio domain events. |
| `execution_adjustment_proposals` | Proposed accounting adjustments arising from reconciliation, with state and content integrity metadata. |
| `execution_approvals` | Execution approval decisions, consumption tracking, and idempotency for rebalance runs. |
| `execution_cancellation_outcomes` | Recorded outcomes of cancellation requests. |
| `execution_cancellation_requests` | Idempotent order cancellation requests and request timestamps. |
| `execution_domain_events` | Execution event ledger with aggregate/fact identity and hash-linked streams. |
| `execution_event_dispatch` | Delivery status, retries, and leases for execution events. |
| `execution_fills` | Immutable execution fill facts including order, instrument, side, quantity, price, and trade time. |
| `execution_kill_switches` | Global or portfolio-scoped execution stop controls and their state versions. |
| `execution_orders` | Order lifecycle state, approved/filled quantities, broker references, and idempotency identifiers. |
| `execution_residual_work` | Uncompleted order quantities and reasons requiring later handling. |
| `execution_runs` | Approved execution run state, mode, portfolio version, and serialized run details. |
| `holding_lots` | Acquisition lots, original/open quantities, cost basis, and source references. |
| `holdings` | Aggregated positions, available and reserved quantities, state version, and margin-funding flag. |
| `portfolio_allocations` | Versioned allocation-policy records, including effective periods and the current-policy marker. |
| `portfolio_audit_events` | Hash-linked operational audit records with actor, reason, and redacted supporting context. |
| `portfolio_backup_receipts` | Backup verification receipts and destination hashes; the backup contents are not stored here. |
| `portfolio_broker_reconciliations` | Applied broker-to-portfolio reconciliation history, before/after versions and cash, position change counts, and detailed payload. |
| `portfolio_component_health` | Latest recorded health and criticality of monitored components. |
| `portfolio_idempotency` | Principal-scoped request deduplication and stored HTTP responses for safe retries. |
| `portfolio_incident_events` | Append-only incident lifecycle records, severity, correlation, and action codes. |
| `portfolio_job_runs` | Durable background job execution state, leases, attempts, progress, results, and retryability. |
| `portfolio_manual_exits` | Manual exit accounting history with quantity, cost basis, proceeds, charges, tax, P/L, risk context, and actor. |
| `portfolio_memberships` | Principal-to-portfolio access roles. |
| `portfolio_operations_alerts` | Operational alerts with severity, category, correlation, and redacted context. |
| `portfolio_performance_observations` | Dated portfolio valuations and performance measures, benchmark comparisons, returns, drawdown, volatility, and attribution. |
| `portfolio_principals` | Local security identities, password verification material, roles, MFA secret, and disabled status. This table is sensitive; never export its rows into documentation. |
| `portfolio_rate_limits` | Request/authentication rate-limit buckets, attempt counters, and block deadlines. |
| `portfolio_rebalance_plan_events` | Lifecycle history of rebalance plans with actor and reason. |
| `portfolio_rebalance_plans` | Stored rebalance plans, input portfolio/strategy versions, plan hash, market-data provenance, and canonical details. |
| `portfolio_security_alerts` | Security alert metadata with hashed subject identifiers. |
| `portfolio_sessions` | Session and CSRF hashes, identity linkage, expiry, MFA verification, and invalidation state. This table is sensitive. |
| `portfolio_strategic_rebalance_observations` | Strategic timing/regime decisions, benchmark signals, data integrity hash, and deferred-buy/retained-cash tracking. |
| `portfolios` | Portfolio identity, name, currency, lifecycle state, operating mode, cash, and optimistic concurrency version. |
| `reconciliation_runs` | Reconciliation lifecycle state, trigger reason, timing, and linkage to an earlier run. |
| `reconciliation_snapshots` | Captured reconciliation evidence from a named source, with content hash and canonical payload. |
| `schema_migrations` | Applied migration identity, checksums, application version, and application time. |
| `seed_registry` | Stable seed identity and version tracking to prevent duplicate initialization. |
| `strategy_assignments` | Strategy versions assigned to portfolio allocation sleeves with weights and supporting evidence metadata. |
| `strategy_definitions` | Named strategy identities, display labels, horizons, and seed identifiers. |
| `strategy_versions` | Versioned strategy configuration payloads with SHA-256 integrity hashes and lifecycle status. |

### database_metadata

Identity and compatibility metadata for this dedicated portfolio database.

```sql
CREATE TABLE database_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  database_id TEXT NOT NULL UNIQUE,
  database_kind TEXT NOT NULL CHECK (database_kind = 'PORTFOLIO_MANAGEMENT'),
  created_at TEXT NOT NULL,
  minimum_reader_version INTEGER NOT NULL CHECK (minimum_reader_version >= 1)
) STRICT;
```

### domain_events

Portfolio domain event ledger with stream sequence, hashes, actor/command context, and canonical event payload.

```sql
CREATE TABLE domain_events (
  event_id TEXT PRIMARY KEY,
  stream_key TEXT NOT NULL,
  stream_sequence INTEGER NOT NULL CHECK (stream_sequence >= 1),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  event_type TEXT NOT NULL,
  event_schema_version INTEGER NOT NULL CHECK (event_schema_version >= 1),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  aggregate_state_version INTEGER NOT NULL CHECK (aggregate_state_version >= 1),
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  canonical_payload TEXT NOT NULL,
  inserted_at TEXT NOT NULL,
  UNIQUE (stream_key, stream_sequence),
  UNIQUE (stream_key, event_hash)
) STRICT;

CREATE INDEX domain_events_portfolio_version_idx
  ON domain_events(portfolio_id, aggregate_state_version, stream_sequence);

CREATE TRIGGER domain_events_no_delete
BEFORE DELETE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_DOMAIN_EVENT');
END;

CREATE TRIGGER domain_events_no_update
BEFORE UPDATE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_DOMAIN_EVENT');
END;
```

### event_dispatch

Delivery status, retry timing, and leases for portfolio domain events.

```sql
CREATE TABLE event_dispatch (
  event_id TEXT PRIMARY KEY REFERENCES domain_events(event_id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'DEAD_LETTER')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  published_at TEXT,
  last_failure_code TEXT
) STRICT;

CREATE INDEX event_dispatch_pending_idx
  ON event_dispatch(status, available_at, event_id);
```

### execution_adjustment_proposals

Proposed accounting adjustments arising from reconciliation, with state and content integrity metadata.

```sql
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
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE INDEX execution_adjustment_proposals_run_idx
  ON execution_adjustment_proposals(reconciliation_run_id, adjustment_proposal_id);
```

### execution_approvals

Execution approval decisions, consumption tracking, and idempotency for rebalance runs.

```sql
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
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  UNIQUE (portfolio_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX execution_approvals_active_portfolio_uq
  ON execution_approvals(portfolio_id)
  WHERE approval_state IN ('APPROVED', 'PARTIALLY_APPROVED');
```

### execution_cancellation_outcomes

Recorded outcomes of cancellation requests.

```sql
CREATE TABLE execution_cancellation_outcomes (
  cancellation_id TEXT PRIMARY KEY
    REFERENCES execution_cancellation_requests(cancellation_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('ACKNOWLEDGED', 'REJECTED', 'UNKNOWN')),
  completed_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE TRIGGER execution_cancellation_outcomes_no_delete
BEFORE DELETE ON execution_cancellation_outcomes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_OUTCOME'); END;

CREATE TRIGGER execution_cancellation_outcomes_no_update
BEFORE UPDATE ON execution_cancellation_outcomes
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_OUTCOME'); END;
```

### execution_cancellation_requests

Idempotent order cancellation requests and request timestamps.

```sql
CREATE TABLE execution_cancellation_requests (
  cancellation_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  idempotency_key TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  UNIQUE (order_id, idempotency_key)
) STRICT;

CREATE INDEX execution_cancellation_requests_order_idx
  ON execution_cancellation_requests(order_id, requested_at, cancellation_id);

CREATE TRIGGER execution_cancellation_requests_no_delete
BEFORE DELETE ON execution_cancellation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_REQUEST'); END;

CREATE TRIGGER execution_cancellation_requests_no_update
BEFORE UPDATE ON execution_cancellation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_CANCELLATION_REQUEST'); END;
```

### execution_domain_events

Execution event ledger with aggregate/fact identity and hash-linked streams.

```sql
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
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
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

CREATE TRIGGER execution_domain_events_no_delete
BEFORE DELETE ON execution_domain_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_EVENT'); END;

CREATE TRIGGER execution_domain_events_no_update
BEFORE UPDATE ON execution_domain_events
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_EVENT'); END;
```

### execution_event_dispatch

Delivery status, retries, and leases for execution events.

```sql
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
```

### execution_fills

Immutable execution fill facts including order, instrument, side, quantity, price, and trade time.

```sql
CREATE TABLE execution_fills (
  fill_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  execution_run_id TEXT NOT NULL REFERENCES execution_runs(execution_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity_shares TEXT NOT NULL CHECK ((quantity_shares = '0' OR (length(quantity_shares) > 0 AND quantity_shares NOT GLOB '*[^0-9]*' AND substr(quantity_shares, 1, 1) BETWEEN '1' AND '9'))),
  price_minor_units TEXT NOT NULL CHECK ((price_minor_units = '0' OR (length(price_minor_units) > 0 AND price_minor_units NOT GLOB '*[^0-9]*' AND substr(price_minor_units, 1, 1) BETWEEN '1' AND '9'))),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  trade_time TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE INDEX execution_fills_order_idx
  ON execution_fills(order_id, trade_time, fill_id);

CREATE INDEX execution_fills_run_idx
  ON execution_fills(execution_run_id, trade_time, fill_id);

CREATE TRIGGER execution_fills_no_delete
BEFORE DELETE ON execution_fills
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_FILL'); END;

CREATE TRIGGER execution_fills_no_update
BEFORE UPDATE ON execution_fills
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_EXECUTION_FILL'); END;
```

### execution_kill_switches

Global or portfolio-scoped execution stop controls and their state versions.

```sql
CREATE TABLE execution_kill_switches (
  kill_switch_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('GLOBAL', 'PORTFOLIO')),
  portfolio_id TEXT REFERENCES portfolios(portfolio_id),
  switch_state TEXT NOT NULL CHECK (switch_state IN ('INACTIVE', 'ACTIVE')),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  CHECK (
    (scope_kind = 'GLOBAL' AND portfolio_id IS NULL)
    OR (scope_kind = 'PORTFOLIO' AND portfolio_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX execution_kill_switch_active_idx
  ON execution_kill_switches(switch_state, scope_kind, portfolio_id);

CREATE UNIQUE INDEX execution_kill_switch_global_uq
  ON execution_kill_switches(scope_kind) WHERE scope_kind = 'GLOBAL';

CREATE UNIQUE INDEX execution_kill_switch_portfolio_uq
  ON execution_kill_switches(portfolio_id) WHERE scope_kind = 'PORTFOLIO';
```

### execution_orders

Order lifecycle state, approved/filled quantities, broker references, and idempotency identifiers.

```sql
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
  approved_quantity_shares TEXT NOT NULL CHECK ((approved_quantity_shares = '0' OR (length(approved_quantity_shares) > 0 AND approved_quantity_shares NOT GLOB '*[^0-9]*' AND substr(approved_quantity_shares, 1, 1) BETWEEN '1' AND '9'))),
  filled_quantity_shares TEXT NOT NULL CHECK ((filled_quantity_shares = '0' OR (length(filled_quantity_shares) > 0 AND filled_quantity_shares NOT GLOB '*[^0-9]*' AND substr(filled_quantity_shares, 1, 1) BETWEEN '1' AND '9'))),
  broker_order_reference_id TEXT,
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  UNIQUE (execution_run_id, logical_order_key),
  UNIQUE (execution_run_id, order_sequence),
  UNIQUE (portfolio_id, idempotency_key)
) STRICT;

CREATE UNIQUE INDEX execution_orders_broker_reference_uq
  ON execution_orders(portfolio_id, broker_order_reference_id)
  WHERE broker_order_reference_id IS NOT NULL;

CREATE INDEX execution_orders_recovery_idx
  ON execution_orders(order_state, portfolio_id, execution_run_id, order_id);

CREATE INDEX execution_orders_run_idx
  ON execution_orders(execution_run_id, order_sequence, order_id);
```

### execution_residual_work

Uncompleted order quantities and reasons requiring later handling.

```sql
CREATE TABLE execution_residual_work (
  residual_work_id TEXT PRIMARY KEY,
  execution_run_id TEXT NOT NULL REFERENCES execution_runs(execution_run_id),
  order_id TEXT NOT NULL REFERENCES execution_orders(order_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  remaining_quantity_shares TEXT NOT NULL CHECK ((remaining_quantity_shares = '0' OR (length(remaining_quantity_shares) > 0 AND remaining_quantity_shares NOT GLOB '*[^0-9]*' AND substr(remaining_quantity_shares, 1, 1) BETWEEN '1' AND '9'))),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'PARTIAL_FILL', 'REJECTED', 'CANCELLED', 'EXPIRED',
      'PRICE_STALE', 'CASH_REDUCED', 'RECOVERY_REQUIRED'
    )
  ),
  created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
  UNIQUE (execution_run_id, order_id)
) STRICT;

CREATE INDEX execution_residual_work_run_idx
  ON execution_residual_work(execution_run_id, created_at, residual_work_id);

CREATE TRIGGER execution_residual_work_no_delete
BEFORE DELETE ON execution_residual_work
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RESIDUAL_WORK'); END;

CREATE TRIGGER execution_residual_work_no_update
BEFORE UPDATE ON execution_residual_work
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RESIDUAL_WORK'); END;
```

### execution_runs

Approved execution run state, mode, portfolio version, and serialized run details.

```sql
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
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE INDEX execution_runs_portfolio_state_idx
  ON execution_runs(portfolio_id, run_state, execution_run_id);

CREATE INDEX execution_runs_recovery_idx
  ON execution_runs(run_state, updated_at, execution_run_id);
```

### holding_lots

Acquisition lots, original/open quantities, cost basis, and source references.

```sql
CREATE TABLE holding_lots (
  lot_id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL REFERENCES holdings(holding_id) ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  acquired_on TEXT NOT NULL,
  original_quantity TEXT NOT NULL CHECK ((original_quantity = '0' OR (length(original_quantity) > 0 AND original_quantity NOT GLOB '*[^0-9]*' AND substr(original_quantity, 1, 1) BETWEEN '1' AND '9'))),
  open_quantity TEXT NOT NULL CHECK ((open_quantity = '0' OR (length(open_quantity) > 0 AND open_quantity NOT GLOB '*[^0-9]*' AND substr(open_quantity, 1, 1) BETWEEN '1' AND '9'))),
  unit_cost_minor_units TEXT NOT NULL CHECK ((unit_cost_minor_units = '0' OR (length(unit_cost_minor_units) > 0 AND unit_cost_minor_units NOT GLOB '*[^0-9]*' AND substr(unit_cost_minor_units, 1, 1) BETWEEN '1' AND '9'))),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('IMPORT', 'FILL', 'CORPORATE_ACTION')),
  source_reference_id TEXT NOT NULL CHECK (length(source_reference_id) BETWEEN 1 AND 128)
) STRICT;

CREATE INDEX holding_lots_holding_idx ON holding_lots(holding_id, lot_id);
```

### holdings

Aggregated positions, available and reserved quantities, state version, and margin-funding flag.

```sql
CREATE TABLE holdings (
  holding_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  total_quantity TEXT NOT NULL CHECK ((total_quantity = '0' OR (length(total_quantity) > 0 AND total_quantity NOT GLOB '*[^0-9]*' AND substr(total_quantity, 1, 1) BETWEEN '1' AND '9'))),
  available_delivery_quantity TEXT NOT NULL CHECK ((available_delivery_quantity = '0' OR (length(available_delivery_quantity) > 0 AND available_delivery_quantity NOT GLOB '*[^0-9]*' AND substr(available_delivery_quantity, 1, 1) BETWEEN '1' AND '9'))),
  reserved_quantity TEXT NOT NULL CHECK ((reserved_quantity = '0' OR (length(reserved_quantity) > 0 AND reserved_quantity NOT GLOB '*[^0-9]*' AND substr(reserved_quantity, 1, 1) BETWEEN '1' AND '9'))),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  margin_funded INTEGER NOT NULL CHECK (margin_funded = 0),
  UNIQUE (portfolio_id, instrument_id)
) STRICT;
```

### portfolio_allocations

Versioned allocation-policy records, including effective periods and the current-policy marker.

```sql
CREATE TABLE portfolio_allocations (
  allocation_record_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  policy_identity TEXT NOT NULL,
  policy_kind TEXT NOT NULL CHECK (policy_kind IN ('SINGLE', 'SLEEVES')),
  effective_at TEXT NOT NULL,
  valid_from_version INTEGER NOT NULL CHECK (valid_from_version >= 1),
  valid_to_version INTEGER CHECK (
    valid_to_version IS NULL OR valid_to_version >= valid_from_version
  ),
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1))
) STRICT;

CREATE INDEX portfolio_allocation_history_idx
  ON portfolio_allocations(portfolio_id, valid_from_version);

CREATE UNIQUE INDEX portfolio_current_allocation_uq
  ON portfolio_allocations(portfolio_id) WHERE is_current = 1;
```

### portfolio_audit_events

Hash-linked operational audit records with actor, reason, and redacted supporting context.

```sql
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

CREATE TRIGGER portfolio_audit_events_no_delete
BEFORE DELETE ON portfolio_audit_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_AUDIT_EVENT');
END;

CREATE TRIGGER portfolio_audit_events_no_update
BEFORE UPDATE ON portfolio_audit_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_AUDIT_EVENT');
END;
```

### portfolio_backup_receipts

Backup verification receipts and destination hashes; the backup contents are not stored here.

```sql
CREATE TABLE portfolio_backup_receipts (
  backup_id TEXT PRIMARY KEY,
  destination_hash TEXT NOT NULL CHECK (length(destination_hash) = 64),
  created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  verified_event_streams INTEGER NOT NULL CHECK (verified_event_streams >= 0),
  verification_code TEXT NOT NULL CHECK (length(verification_code) BETWEEN 2 AND 64)
) STRICT;
```

### portfolio_broker_reconciliations

Applied broker-to-portfolio reconciliation history, before/after versions and cash, position change counts, and detailed payload.

```sql
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

CREATE TRIGGER portfolio_broker_reconciliations_no_delete
BEFORE DELETE ON portfolio_broker_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_BROKER_RECONCILIATION');
END;

CREATE TRIGGER portfolio_broker_reconciliations_no_update
BEFORE UPDATE ON portfolio_broker_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_BROKER_RECONCILIATION');
END;
```

### portfolio_component_health

Latest recorded health and criticality of monitored components.

```sql
CREATE TABLE portfolio_component_health (
  component TEXT PRIMARY KEY CHECK (length(component) BETWEEN 2 AND 96),
  criticality TEXT NOT NULL CHECK (criticality IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  state TEXT NOT NULL CHECK (state IN ('HEALTHY', 'DEGRADED', 'BLOCKED')),
  checked_at TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 2 AND 64)
) STRICT;
```

### portfolio_idempotency

Principal-scoped request deduplication and stored HTTP responses for safe retries.

```sql
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
```

### portfolio_incident_events

Append-only incident lifecycle records, severity, correlation, and action codes.

```sql
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

CREATE TRIGGER portfolio_incident_events_no_delete
BEFORE DELETE ON portfolio_incident_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INCIDENT_EVENT');
END;

CREATE TRIGGER portfolio_incident_events_no_update
BEFORE UPDATE ON portfolio_incident_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INCIDENT_EVENT');
END;
```

### portfolio_job_runs

Durable background job execution state, leases, attempts, progress, results, and retryability.

```sql
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
```

### portfolio_manual_exits

Manual exit accounting history with quantity, cost basis, proceeds, charges, tax, P/L, risk context, and actor.

```sql
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

CREATE TRIGGER portfolio_manual_exits_no_delete
BEFORE DELETE ON portfolio_manual_exits
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_MANUAL_EXIT');
END;

CREATE TRIGGER portfolio_manual_exits_no_update
BEFORE UPDATE ON portfolio_manual_exits
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_MANUAL_EXIT');
END;
```

### portfolio_memberships

Principal-to-portfolio access roles.

```sql
CREATE TABLE portfolio_memberships (
  principal_id TEXT NOT NULL REFERENCES portfolio_principals(principal_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  access_role TEXT NOT NULL CHECK (access_role IN ('VIEWER', 'EDITOR', 'OWNER')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (principal_id, portfolio_id)
) STRICT;

CREATE INDEX portfolio_memberships_portfolio_idx
  ON portfolio_memberships(portfolio_id, principal_id);
```

### portfolio_operations_alerts

Operational alerts with severity, category, correlation, and redacted context.

```sql
CREATE TABLE portfolio_operations_alerts (
  alert_id TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 2 AND 64),
  detail_code TEXT NOT NULL CHECK (length(detail_code) BETWEEN 2 AND 64),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 3 AND 128),
  created_at TEXT NOT NULL,
  redacted_context TEXT NOT NULL CHECK (length(redacted_context) BETWEEN 2 AND 8192)
) STRICT;

CREATE TRIGGER portfolio_operations_alerts_no_delete
BEFORE DELETE ON portfolio_operations_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_OPERATIONS_ALERT');
END;

CREATE TRIGGER portfolio_operations_alerts_no_update
BEFORE UPDATE ON portfolio_operations_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_OPERATIONS_ALERT');
END;
```

### portfolio_performance_observations

Dated portfolio valuations and performance measures, benchmark comparisons, returns, drawdown, volatility, and attribution.

```sql
CREATE TABLE portfolio_performance_observations (
  observation_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  observed_at TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  portfolio_state_version INTEGER NOT NULL CHECK (portfolio_state_version >= 1),
  benchmark_symbol TEXT NOT NULL,
  benchmark_price_minor_units TEXT NOT NULL,
  cash_minor_units TEXT NOT NULL,
  market_value_minor_units TEXT NOT NULL,
  nav_minor_units TEXT NOT NULL,
  invested_cost_minor_units TEXT NOT NULL,
  unrealized_pnl_minor_units TEXT NOT NULL,
  day_pnl_minor_units TEXT NOT NULL,
  contributed_capital_minor_units TEXT NOT NULL,
  realized_pnl_minor_units TEXT NOT NULL,
  cumulative_charges_minor_units TEXT NOT NULL,
  cumulative_tax_minor_units TEXT NOT NULL,
  net_pnl_minor_units TEXT NOT NULL,
  day_return_ppm INTEGER NOT NULL,
  total_return_ppm INTEGER NOT NULL,
  benchmark_day_return_ppm INTEGER NOT NULL,
  benchmark_total_return_ppm INTEGER NOT NULL,
  wealth_index_ppm TEXT NOT NULL,
  peak_wealth_index_ppm TEXT NOT NULL,
  drawdown_ppm INTEGER NOT NULL CHECK (drawdown_ppm <= 0),
  annualized_volatility_ppm INTEGER NOT NULL CHECK (annualized_volatility_ppm >= 0),
  annualized_return_ppm INTEGER NOT NULL,
  quote_count INTEGER NOT NULL CHECK (quote_count >= 0),
  total_holdings INTEGER NOT NULL CHECK (total_holdings >= 0),
  attribution_json TEXT NOT NULL CHECK (json_valid(attribution_json)),
  market_data_source TEXT NOT NULL CHECK (market_data_source = 'YAHOO_RESEARCH'),
  created_by TEXT NOT NULL
) STRICT;

CREATE INDEX portfolio_performance_observations_daily_idx
  ON portfolio_performance_observations(portfolio_id, observation_date, observed_at DESC);

CREATE INDEX portfolio_performance_observations_scope_idx
  ON portfolio_performance_observations(portfolio_id, observed_at DESC, observation_id DESC);

CREATE TRIGGER portfolio_performance_observations_no_delete
BEFORE DELETE ON portfolio_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PERFORMANCE_OBSERVATION');
END;

CREATE TRIGGER portfolio_performance_observations_no_update
BEFORE UPDATE ON portfolio_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PERFORMANCE_OBSERVATION');
END;
```

### portfolio_principals

Local security identities, password verification material, roles, MFA secret, and disabled status. This table is sensitive; never export its rows into documentation.

```sql
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
```

### portfolio_rate_limits

Request/authentication rate-limit buckets, attempt counters, and block deadlines.

```sql
CREATE TABLE portfolio_rate_limits (
  bucket_key TEXT PRIMARY KEY CHECK (length(bucket_key) = 64),
  window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  blocked_until INTEGER
) STRICT;
```

### portfolio_rebalance_plan_events

Lifecycle history of rebalance plans with actor and reason.

```sql
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

CREATE TRIGGER portfolio_rebalance_plan_events_no_delete
BEFORE DELETE ON portfolio_rebalance_plan_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN_EVENT');
END;

CREATE TRIGGER portfolio_rebalance_plan_events_no_update
BEFORE UPDATE ON portfolio_rebalance_plan_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN_EVENT');
END;
```

### portfolio_rebalance_plans

Stored rebalance plans, input portfolio/strategy versions, plan hash, market-data provenance, and canonical details.

```sql
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

CREATE TRIGGER portfolio_rebalance_plans_no_delete
BEFORE DELETE ON portfolio_rebalance_plans
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN');
END;

CREATE TRIGGER portfolio_rebalance_plans_no_update
BEFORE UPDATE ON portfolio_rebalance_plans
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REBALANCE_PLAN');
END;
```

### portfolio_security_alerts

Security alert metadata with hashed subject identifiers.

```sql
CREATE TABLE portfolio_security_alerts (
  alert_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('AUTH_BRUTE_FORCE', 'RATE_LIMIT', 'SESSION_REJECTED')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  detail_code TEXT NOT NULL CHECK (length(detail_code) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TRIGGER portfolio_security_alerts_no_delete
BEFORE DELETE ON portfolio_security_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SECURITY_ALERT');
END;

CREATE TRIGGER portfolio_security_alerts_no_update
BEFORE UPDATE ON portfolio_security_alerts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SECURITY_ALERT');
END;
```

### portfolio_sessions

Session and CSRF hashes, identity linkage, expiry, MFA verification, and invalidation state. This table is sensitive.

```sql
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
```

### portfolio_strategic_rebalance_observations

Strategic timing/regime decisions, benchmark signals, data integrity hash, and deferred-buy/retained-cash tracking.

```sql
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

CREATE TRIGGER portfolio_strategic_rebalance_observations_no_delete
BEFORE DELETE ON portfolio_strategic_rebalance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STRATEGIC_REBALANCE_OBSERVATION');
END;

CREATE TRIGGER portfolio_strategic_rebalance_observations_no_update
BEFORE UPDATE ON portfolio_strategic_rebalance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_STRATEGIC_REBALANCE_OBSERVATION');
END;
```

### portfolios

Portfolio identity, name, currency, lifecycle state, operating mode, cash, and optimistic concurrency version.

```sql
CREATE TABLE portfolios (
  portfolio_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  normalized_name_key TEXT NOT NULL CHECK (length(normalized_name_key) > 0),
  base_currency TEXT NOT NULL CHECK (base_currency = 'INR'),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  operating_mode TEXT NOT NULL CHECK (
    operating_mode IN (
      'OBSERVE', 'PAPER', 'RECOMMENDATION',
      'APPROVAL_REQUIRED', 'RESTRICTED_AUTO', 'LIVE'
    )
  ),
  cash_minor_units TEXT NOT NULL CHECK ((cash_minor_units = '0' OR (length(cash_minor_units) > 0 AND cash_minor_units NOT GLOB '*[^0-9]*' AND substr(cash_minor_units, 1, 1) BETWEEN '1' AND '9'))),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  seed_key TEXT UNIQUE REFERENCES seed_registry(seed_key),
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX portfolios_active_name_uq
  ON portfolios(normalized_name_key) WHERE status = 'ACTIVE';

CREATE INDEX portfolios_status_id_idx ON portfolios(status, portfolio_id);
```

### reconciliation_runs

Reconciliation lifecycle state, trigger reason, timing, and linkage to an earlier run.

```sql
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
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE INDEX reconciliation_runs_portfolio_latest_idx
  ON reconciliation_runs(portfolio_id, started_at DESC, reconciliation_run_id);

CREATE INDEX reconciliation_runs_recovery_idx
  ON reconciliation_runs(reconciliation_state, started_at, reconciliation_run_id);
```

### reconciliation_snapshots

Captured reconciliation evidence from a named source, with content hash and canonical payload.

```sql
CREATE TABLE reconciliation_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  reconciliation_run_id TEXT REFERENCES reconciliation_runs(reconciliation_run_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  source TEXT NOT NULL CHECK (source IN ('LOCAL', 'PAPER', 'ZERODHA', 'SHAREKHAN')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  captured_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 1048576)
) STRICT;

CREATE INDEX reconciliation_snapshots_run_idx
  ON reconciliation_snapshots(portfolio_id, source, captured_at, snapshot_id);

CREATE TRIGGER reconciliation_snapshots_no_delete
BEFORE DELETE ON reconciliation_snapshots
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECONCILIATION_SNAPSHOT'); END;

CREATE TRIGGER reconciliation_snapshots_no_update
BEFORE UPDATE ON reconciliation_snapshots
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECONCILIATION_SNAPSHOT'); END;
```

### schema_migrations

Applied migration identity, checksums, application version, and application time.

```sql
CREATE TABLE schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  reverse_checksum TEXT,
  applied_at TEXT NOT NULL,
  application_version TEXT NOT NULL
) STRICT;
```

### seed_registry

Stable seed identity and version tracking to prevent duplicate initialization.

```sql
CREATE TABLE seed_registry (
  seed_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  seed_version INTEGER NOT NULL CHECK (seed_version >= 1),
  created_at TEXT NOT NULL
) STRICT;
```

### strategy_assignments

Strategy versions assigned to portfolio allocation sleeves with weights and supporting evidence metadata.

```sql
CREATE TABLE strategy_assignments (
  assignment_id TEXT PRIMARY KEY,
  allocation_record_id TEXT NOT NULL REFERENCES portfolio_allocations(allocation_record_id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  sleeve_id TEXT,
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(strategy_version_id),
  weight_ppm INTEGER NOT NULL CHECK (weight_ppm > 0 AND weight_ppm <= 1000000),
  effective_at TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  evidence_issuer_id TEXT NOT NULL,
  evidence_issued_at TEXT NOT NULL,
  evidence_expires_at TEXT NOT NULL,
  UNIQUE (allocation_record_id, sleeve_id),
  UNIQUE (allocation_record_id, strategy_version_id)
) STRICT;
```

### strategy_definitions

Named strategy identities, display labels, horizons, and seed identifiers.

```sql
CREATE TABLE strategy_definitions (
  strategy_id TEXT PRIMARY KEY,
  strategy_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('SHORT', 'MEDIUM', 'LONG')),
  seed_key TEXT UNIQUE REFERENCES seed_registry(seed_key)
) STRICT;
```

### strategy_versions

Versioned strategy configuration payloads with SHA-256 integrity hashes and lifecycle status.

```sql
CREATE TABLE strategy_versions (
  strategy_version_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategy_definitions(strategy_id),
  semantic_version TEXT NOT NULL,
  canonical_payload TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('SEEDED', 'DRAFT', 'ACTIVE', 'RETIRED')),
  created_at TEXT NOT NULL,
  seed_key TEXT UNIQUE REFERENCES seed_registry(seed_key),
  UNIQUE (strategy_id, semantic_version)
) STRICT;
```
## Simulation snapshots

File: `snapshots/simulation_snapshots.db`. Schema owners: `server/snapshot-db.js`, `server/snapshot-store.js`. **1 table.**

| Table | What it holds |
| --- | --- |
| `simulation_snapshots` | Captured simulation candidate snapshots by trading date/time and bucket, with encoded payload, source, counts, and update timestamps. |

### simulation_snapshots

Captured simulation candidate snapshots by trading date/time and bucket, with encoded payload, source, counts, and update timestamps.

```sql
CREATE TABLE simulation_snapshots (
      id TEXT PRIMARY KEY,
      trading_date TEXT NOT NULL,
      snapshot_at INTEGER NOT NULL,
      bucket INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      candidate_count INTEGER NOT NULL DEFAULT 0,
      payload BLOB NOT NULL,
      payload_encoding TEXT NOT NULL DEFAULT 'gzip-json',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (trading_date, bucket)
    );

CREATE INDEX idx_simulation_snapshots_at
      ON simulation_snapshots (snapshot_at);

CREATE INDEX idx_simulation_snapshots_date_at
      ON simulation_snapshots (trading_date, snapshot_at);
```
