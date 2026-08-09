import { createHash } from 'node:crypto'

import type { MigrationDefinition } from './types.ts'

export const REBALANCE_EXIT_HISTORY_SQL = `
INSERT OR IGNORE INTO portfolio_manual_exits (
  exit_id, portfolio_id, holding_id, instrument_id, quantity,
  execution_price_minor_units, gross_proceeds_minor_units,
  released_cost_basis_minor_units, realized_pnl_minor_units,
  charges_minor_units, tax_minor_units, net_proceeds_minor_units,
  portfolio_state_version_before, portfolio_state_version_after,
  exit_kind, reason_code, risk_snapshot_json, market_data_source,
  executed_at, executed_by
)
SELECT
  'rebalance-exit-backfill:' || p.plan_id || ':' || json_extract(action.value, '$.instrumentId'),
  p.portfolio_id,
  COALESCE(h.holding_id, 'rebalance-history:' || json_extract(action.value, '$.instrumentId')),
  json_extract(action.value, '$.instrumentId'),
  CAST(-CAST(json_extract(action.value, '$.deltaQuantity') AS INTEGER) AS TEXT),
  CAST(json_extract(action.value, '$.livePriceMinorUnits') AS TEXT),
  CAST(-CAST(json_extract(action.value, '$.deltaQuantity') AS INTEGER) * CAST(json_extract(action.value, '$.livePriceMinorUnits') AS INTEGER) AS TEXT),
  CAST(
    -CAST(json_extract(action.value, '$.deltaQuantity') AS INTEGER) * CAST(json_extract(action.value, '$.livePriceMinorUnits') AS INTEGER)
    - CAST(COALESCE(json_extract(action.value, '$.realizedPnlMinorUnits'), 0) AS INTEGER)
    AS TEXT
  ),
  CAST(COALESCE(json_extract(action.value, '$.realizedPnlMinorUnits'), 0) AS TEXT),
  CAST(COALESCE(json_extract(action.value, '$.estimatedChargesMinorUnits'), 0) AS TEXT),
  CAST(COALESCE(json_extract(action.value, '$.estimatedTaxMinorUnits'), 0) AS TEXT),
  CAST(
    -CAST(json_extract(action.value, '$.deltaQuantity') AS INTEGER) * CAST(json_extract(action.value, '$.livePriceMinorUnits') AS INTEGER)
    - CAST(COALESCE(json_extract(action.value, '$.estimatedChargesMinorUnits'), 0) AS INTEGER)
    - CAST(COALESCE(json_extract(action.value, '$.estimatedTaxMinorUnits'), 0) AS INTEGER)
    AS TEXT
  ),
  p.portfolio_state_version,
  p.portfolio_state_version + 1,
  CASE WHEN CAST(json_extract(action.value, '$.targetQuantity') AS INTEGER) = 0 THEN 'FULL' ELSE 'PARTIAL' END,
  SUBSTR('REBALANCE_' || COALESCE(json_extract(action.value, '$.reasonCode'), 'STRATEGY_REBALANCE'), 1, 64),
  json_object(
    'planId', p.plan_id,
    'actionReasonCode', COALESCE(json_extract(action.value, '$.reasonCode'), 'STRATEGY_REBALANCE'),
    'exitRiskLevel', COALESCE(json_extract(action.value, '$.exitRiskLevel'), 'NONE'),
    'exitRiskSummary', COALESCE(json_extract(action.value, '$.exitRiskSummary'), ''),
    'mandatoryExit', CASE WHEN json_extract(action.value, '$.mandatoryExit') = 1 THEN json('true') ELSE json('false') END,
    'backfilled', json('true')
  ),
  'YAHOO_RESEARCH',
  approved.occurred_at,
  approved.actor_id
FROM portfolio_rebalance_plans p
JOIN portfolio_rebalance_plan_events approved ON approved.rowid = (
  SELECT MIN(event.rowid) FROM portfolio_rebalance_plan_events event
  WHERE event.plan_id = p.plan_id AND event.plan_state = 'APPROVED_PAPER'
)
JOIN json_each(p.canonical_payload, '$.actions') action
LEFT JOIN holdings h ON h.portfolio_id = p.portfolio_id
  AND h.instrument_id = json_extract(action.value, '$.instrumentId')
WHERE CAST(json_extract(action.value, '$.deltaQuantity') AS INTEGER) < 0;
`

const DOWN_SQL = `
DROP TRIGGER portfolio_manual_exits_no_delete;
DELETE FROM portfolio_manual_exits WHERE exit_id LIKE 'rebalance-exit-backfill:%';
CREATE TRIGGER portfolio_manual_exits_no_delete
BEFORE DELETE ON portfolio_manual_exits
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_MANUAL_EXIT');
END;
`

function checksum(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex')
}

export const REBALANCE_EXIT_HISTORY_MIGRATION: MigrationDefinition = Object.freeze({
  id: 9,
  name: 'rebalance-exit-history',
  upSql: REBALANCE_EXIT_HISTORY_SQL,
  downSql: DOWN_SQL,
  checksum: checksum(REBALANCE_EXIT_HISTORY_SQL),
  reverseChecksum: checksum(DOWN_SQL),
  assertForward(database) {
    const invalid = database.prepare(`
      SELECT exit_id FROM portfolio_manual_exits
      WHERE exit_id LIKE 'rebalance-exit-backfill:%' AND reason_code NOT LIKE 'REBALANCE_%'
      LIMIT 1
    `).get()
    if (invalid !== undefined) throw new Error('MIGRATION_ASSERTION_FAILED')
  },
})
