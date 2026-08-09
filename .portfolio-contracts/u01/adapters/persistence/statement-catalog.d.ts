export declare const SQL: Readonly<{
    selectPortfolio: "\n    SELECT * FROM portfolios WHERE portfolio_id = ?\n  ";
    selectCurrentAllocation: "\n    SELECT * FROM portfolio_allocations\n    WHERE portfolio_id = ? AND is_current = 1\n  ";
    selectAssignments: "\n    SELECT * FROM strategy_assignments\n    WHERE allocation_record_id = ?\n    ORDER BY COALESCE(sleeve_id, ''), assignment_id\n  ";
    selectHoldings: "\n    SELECT * FROM holdings WHERE portfolio_id = ? ORDER BY holding_id\n  ";
    selectLots: "\n    SELECT * FROM holding_lots WHERE portfolio_id = ? ORDER BY holding_id, lot_id\n  ";
    selectActiveName: "\n    SELECT 1 AS found FROM portfolios\n    WHERE normalized_name_key = ? AND status = 'ACTIVE' LIMIT 1\n  ";
    selectPortfolioVersion: "\n    SELECT state_version FROM portfolios WHERE portfolio_id = ?\n  ";
    insertPortfolio: "\n    INSERT INTO portfolios (\n      portfolio_id, display_name, normalized_name_key, base_currency,\n      created_at, status, operating_mode, cash_minor_units,\n      state_version, seed_key, updated_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ";
    updatePortfolio: "\n    UPDATE portfolios SET\n      display_name = ?,\n      normalized_name_key = ?,\n      status = ?,\n      operating_mode = ?,\n      cash_minor_units = ?,\n      state_version = ?,\n      updated_at = ?\n    WHERE portfolio_id = ? AND state_version = ?\n  ";
    selectCurrentAllocationIdentity: "\n    SELECT policy_identity FROM portfolio_allocations\n    WHERE portfolio_id = ? AND is_current = 1\n  ";
    closeCurrentAllocation: "\n    UPDATE portfolio_allocations\n    SET is_current = 0, valid_to_version = ?\n    WHERE portfolio_id = ? AND is_current = 1\n  ";
    insertAllocation: "\n    INSERT INTO portfolio_allocations (\n      allocation_record_id, portfolio_id, policy_identity, policy_kind,\n      effective_at, valid_from_version, valid_to_version, is_current\n    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)\n  ";
    insertAssignment: "\n    INSERT INTO strategy_assignments (\n      assignment_id, allocation_record_id, portfolio_id, sleeve_id,\n      strategy_version_id, weight_ppm, effective_at, evidence_id,\n      evidence_hash, evidence_issuer_id, evidence_issued_at, evidence_expires_at\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ";
    deleteLots: "DELETE FROM holding_lots WHERE portfolio_id = ?";
    deleteHoldings: "DELETE FROM holdings WHERE portfolio_id = ?";
    insertHolding: "\n    INSERT INTO holdings (\n      holding_id, portfolio_id, instrument_id, total_quantity,\n      available_delivery_quantity, reserved_quantity, state_version, margin_funded\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)\n  ";
    insertLot: "\n    INSERT INTO holding_lots (\n      lot_id, holding_id, portfolio_id, instrument_id, acquired_on,\n      original_quantity, open_quantity, unit_cost_minor_units,\n      source_kind, source_reference_id\n    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ";
}>;
