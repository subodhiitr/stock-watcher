import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

const NON_NEGATIVE_INTEGER_TEXT =
  "(VALUE = '0' OR (length(VALUE) > 0 AND VALUE NOT GLOB '*[^0-9]*' AND substr(VALUE, 1, 1) BETWEEN '1' AND '9'))"

function integerCheck(column: string): string {
  return NON_NEGATIVE_INTEGER_TEXT.replaceAll('VALUE', column)
}

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE database_metadata (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  database_id TEXT NOT NULL UNIQUE,
  database_kind TEXT NOT NULL CHECK (database_kind = 'PORTFOLIO_MANAGEMENT'),
  created_at TEXT NOT NULL,
  minimum_reader_version INTEGER NOT NULL CHECK (minimum_reader_version >= 1)
) STRICT;

CREATE TABLE seed_registry (
  seed_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  seed_version INTEGER NOT NULL CHECK (seed_version >= 1),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE strategy_definitions (
  strategy_id TEXT PRIMARY KEY,
  strategy_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('SHORT', 'MEDIUM', 'LONG')),
  seed_key TEXT UNIQUE REFERENCES seed_registry(seed_key)
) STRICT;

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
  cash_minor_units TEXT NOT NULL CHECK (${integerCheck('cash_minor_units')}),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  seed_key TEXT UNIQUE REFERENCES seed_registry(seed_key),
  updated_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX portfolios_active_name_uq
  ON portfolios(normalized_name_key) WHERE status = 'ACTIVE';
CREATE INDEX portfolios_status_id_idx ON portfolios(status, portfolio_id);

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

CREATE UNIQUE INDEX portfolio_current_allocation_uq
  ON portfolio_allocations(portfolio_id) WHERE is_current = 1;
CREATE INDEX portfolio_allocation_history_idx
  ON portfolio_allocations(portfolio_id, valid_from_version);

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

CREATE TABLE holdings (
  holding_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  total_quantity TEXT NOT NULL CHECK (${integerCheck('total_quantity')}),
  available_delivery_quantity TEXT NOT NULL CHECK (${integerCheck('available_delivery_quantity')}),
  reserved_quantity TEXT NOT NULL CHECK (${integerCheck('reserved_quantity')}),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  margin_funded INTEGER NOT NULL CHECK (margin_funded = 0),
  UNIQUE (portfolio_id, instrument_id)
) STRICT;

CREATE TABLE holding_lots (
  lot_id TEXT PRIMARY KEY,
  holding_id TEXT NOT NULL REFERENCES holdings(holding_id) ON DELETE CASCADE,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(portfolio_id),
  instrument_id TEXT NOT NULL,
  acquired_on TEXT NOT NULL,
  original_quantity TEXT NOT NULL CHECK (${integerCheck('original_quantity')}),
  open_quantity TEXT NOT NULL CHECK (${integerCheck('open_quantity')}),
  unit_cost_minor_units TEXT NOT NULL CHECK (${integerCheck('unit_cost_minor_units')}),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('IMPORT', 'FILL', 'CORPORATE_ACTION')),
  source_reference_id TEXT NOT NULL CHECK (length(source_reference_id) BETWEEN 1 AND 128)
) STRICT;

CREATE INDEX holding_lots_holding_idx ON holding_lots(holding_id, lot_id);

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

CREATE TRIGGER domain_events_no_update
BEFORE UPDATE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_DOMAIN_EVENT');
END;

CREATE TRIGGER domain_events_no_delete
BEFORE DELETE ON domain_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_DOMAIN_EVENT');
END;
`

const DOWN_SQL = `
DROP TRIGGER domain_events_no_delete;
DROP TRIGGER domain_events_no_update;
DROP TABLE event_dispatch;
DROP TABLE domain_events;
DROP TABLE holding_lots;
DROP TABLE holdings;
DROP TABLE strategy_assignments;
DROP TABLE portfolio_allocations;
DROP TABLE portfolios;
DROP TABLE strategy_versions;
DROP TABLE strategy_definitions;
DROP TABLE seed_registry;
DROP TABLE database_metadata;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const INITIAL_SCHEMA_MIGRATION: MigrationDefinition = Object.freeze({
  id: 1,
  name: 'initial-portfolio-schema',
  upSql: INITIAL_SCHEMA_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(INITIAL_SCHEMA_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const rows = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all() as readonly { name: string }[]
    const names = new Set(rows.map((row) => row.name))
    for (const required of ['portfolios', 'domain_events', 'event_dispatch']) {
      if (!names.has(required)) throw new Error('MIGRATION_ASSERTION_FAILED')
    }
  },
})
