export const SQL = Object.freeze({
  selectPortfolio: `
    SELECT * FROM portfolios WHERE portfolio_id = ?
  `,
  selectCurrentAllocation: `
    SELECT * FROM portfolio_allocations
    WHERE portfolio_id = ? AND is_current = 1
  `,
  selectAssignments: `
    SELECT * FROM strategy_assignments
    WHERE allocation_record_id = ?
    ORDER BY COALESCE(sleeve_id, ''), assignment_id
  `,
  selectHoldings: `
    SELECT * FROM holdings WHERE portfolio_id = ? ORDER BY holding_id
  `,
  selectLots: `
    SELECT * FROM holding_lots WHERE portfolio_id = ? ORDER BY holding_id, lot_id
  `,
  selectActiveName: `
    SELECT 1 AS found FROM portfolios
    WHERE normalized_name_key = ? AND status = 'ACTIVE' LIMIT 1
  `,
  selectPortfolioVersion: `
    SELECT state_version FROM portfolios WHERE portfolio_id = ?
  `,
  insertPortfolio: `
    INSERT INTO portfolios (
      portfolio_id, display_name, normalized_name_key, base_currency,
      created_at, status, operating_mode, cash_minor_units,
      state_version, seed_key, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  updatePortfolio: `
    UPDATE portfolios SET
      display_name = ?,
      normalized_name_key = ?,
      status = ?,
      operating_mode = ?,
      cash_minor_units = ?,
      state_version = ?,
      updated_at = ?
    WHERE portfolio_id = ? AND state_version = ?
  `,
  selectCurrentAllocationIdentity: `
    SELECT policy_identity FROM portfolio_allocations
    WHERE portfolio_id = ? AND is_current = 1
  `,
  closeCurrentAllocation: `
    UPDATE portfolio_allocations
    SET is_current = 0, valid_to_version = ?
    WHERE portfolio_id = ? AND is_current = 1
  `,
  insertAllocation: `
    INSERT INTO portfolio_allocations (
      allocation_record_id, portfolio_id, policy_identity, policy_kind,
      effective_at, valid_from_version, valid_to_version, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
  `,
  insertAssignment: `
    INSERT INTO strategy_assignments (
      assignment_id, allocation_record_id, portfolio_id, sleeve_id,
      strategy_version_id, weight_ppm, effective_at, evidence_id,
      evidence_hash, evidence_issuer_id, evidence_issued_at, evidence_expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  deleteLots: `DELETE FROM holding_lots WHERE portfolio_id = ?`,
  deleteHoldings: `DELETE FROM holdings WHERE portfolio_id = ?`,
  insertHolding: `
    INSERT INTO holdings (
      holding_id, portfolio_id, instrument_id, total_quantity,
      available_delivery_quantity, reserved_quantity, state_version, margin_funded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `,
  insertLot: `
    INSERT INTO holding_lots (
      lot_id, holding_id, portfolio_id, instrument_id, acquired_on,
      original_quantity, open_quantity, unit_cost_minor_units,
      source_kind, source_reference_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
})
