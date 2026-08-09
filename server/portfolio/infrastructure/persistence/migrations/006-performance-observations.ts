import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const PERFORMANCE_OBSERVATIONS_SQL = `
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

CREATE INDEX portfolio_performance_observations_scope_idx
  ON portfolio_performance_observations(portfolio_id, observed_at DESC, observation_id DESC);

CREATE INDEX portfolio_performance_observations_daily_idx
  ON portfolio_performance_observations(portfolio_id, observation_date, observed_at DESC);

CREATE TRIGGER portfolio_performance_observations_no_update
BEFORE UPDATE ON portfolio_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PERFORMANCE_OBSERVATION');
END;

CREATE TRIGGER portfolio_performance_observations_no_delete
BEFORE DELETE ON portfolio_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PERFORMANCE_OBSERVATION');
END;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_performance_observations_no_delete;
DROP TRIGGER portfolio_performance_observations_no_update;
DROP TABLE portfolio_performance_observations;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const PERFORMANCE_OBSERVATIONS_MIGRATION: MigrationDefinition = Object.freeze({
  id: 6,
  name: 'performance-observations',
  upSql: PERFORMANCE_OBSERVATIONS_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(PERFORMANCE_OBSERVATIONS_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const row = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_performance_observations'",
    ).get() as { name: string } | undefined
    if (row === undefined) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
