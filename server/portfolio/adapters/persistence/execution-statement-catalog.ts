export const EXECUTION_SQL = Object.freeze({
  insertApproval: `
    INSERT INTO execution_approvals (
      approval_id, portfolio_id, rebalance_run_id, approval_state,
      decision_kind, idempotency_key, consumed_by_execution_run_id,
      state_version, schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectApproval: `
    SELECT canonical_payload FROM execution_approvals WHERE approval_id = ?
  `,
  selectActiveApproval: `
    SELECT canonical_payload FROM execution_approvals
    WHERE portfolio_id = ? AND approval_state IN ('APPROVED', 'PARTIALLY_APPROVED')
    ORDER BY state_version DESC, approval_id LIMIT 1
  `,
  updateApproval: `
    UPDATE execution_approvals SET
      approval_state = ?, decision_kind = ?, consumed_by_execution_run_id = ?,
      state_version = ?, canonical_payload = ?
    WHERE approval_id = ? AND state_version = ?
  `,

  insertRun: `
    INSERT INTO execution_runs (
      execution_run_id, portfolio_id, approval_id, run_state, mode,
      portfolio_state_version, state_version, updated_at,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectRun: `
    SELECT canonical_payload FROM execution_runs WHERE execution_run_id = ?
  `,
  selectActiveRun: `
    SELECT canonical_payload FROM execution_runs
    WHERE portfolio_id = ?
      AND run_state NOT IN ('BLOCKED', 'COMPLETED', 'COMPLETED_WITH_RESIDUAL', 'CANCELLED')
    ORDER BY updated_at DESC, execution_run_id LIMIT 1
  `,
  selectRunByApproval: `
    SELECT canonical_payload FROM execution_runs WHERE approval_id = ?
  `,
  selectActiveRuns: `
    SELECT canonical_payload FROM execution_runs
    WHERE run_state NOT IN ('BLOCKED', 'COMPLETED', 'COMPLETED_WITH_RESIDUAL', 'CANCELLED')
    ORDER BY updated_at, execution_run_id
  `,
  updateRun: `
    UPDATE execution_runs SET
      run_state = ?, portfolio_state_version = ?, state_version = ?,
      updated_at = ?, canonical_payload = ?
    WHERE execution_run_id = ? AND state_version = ?
  `,

  insertOrder: `
    INSERT INTO execution_orders (
      order_id, execution_run_id, portfolio_id, instrument_id, side,
      order_state, logical_order_key, idempotency_key, order_sequence,
      approved_quantity_shares, filled_quantity_shares,
      broker_order_reference_id, state_version, schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectOrder: `
    SELECT canonical_payload FROM execution_orders WHERE order_id = ?
  `,
  selectOrdersByRun: `
    SELECT canonical_payload FROM execution_orders
    WHERE execution_run_id = ? ORDER BY order_sequence, order_id
  `,
  selectOrderByBrokerReference: `
    SELECT canonical_payload FROM execution_orders
    WHERE portfolio_id = ? AND broker_order_reference_id = ?
  `,
  selectGlobalCancellableOrders: `
    SELECT canonical_payload FROM execution_orders
    WHERE order_state IN ('ACKNOWLEDGED', 'OPEN', 'PARTIALLY_FILLED')
    ORDER BY portfolio_id, execution_run_id, order_sequence, order_id
  `,
  selectPortfolioCancellableOrders: `
    SELECT canonical_payload FROM execution_orders
    WHERE portfolio_id = ?
      AND order_state IN ('ACKNOWLEDGED', 'OPEN', 'PARTIALLY_FILLED')
    ORDER BY execution_run_id, order_sequence, order_id
  `,
  updateOrder: `
    UPDATE execution_orders SET
      order_state = ?, filled_quantity_shares = ?,
      broker_order_reference_id = ?, state_version = ?, canonical_payload = ?
    WHERE order_id = ? AND state_version = ?
  `,

  insertReconciliationRun: `
    INSERT INTO reconciliation_runs (
      reconciliation_run_id, portfolio_id, reconciliation_state, reason,
      started_at, completed_at, prior_run_id, state_version,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectReconciliationRun: `
    SELECT canonical_payload FROM reconciliation_runs WHERE reconciliation_run_id = ?
  `,
  selectLatestReconciliationRun: `
    SELECT canonical_payload FROM reconciliation_runs
    WHERE portfolio_id = ?
    ORDER BY started_at DESC, reconciliation_run_id DESC LIMIT 1
  `,
  updateReconciliationRun: `
    UPDATE reconciliation_runs SET
      reconciliation_state = ?, completed_at = ?, state_version = ?,
      canonical_payload = ?
    WHERE reconciliation_run_id = ? AND state_version = ?
  `,

  insertReconciliationSnapshot: `
    INSERT INTO reconciliation_snapshots (
      snapshot_id, portfolio_id, source, content_hash, captured_at,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
  selectReconciliationSnapshot: `
    SELECT canonical_payload FROM reconciliation_snapshots WHERE snapshot_id = ?
  `,

  insertKillSwitch: `
    INSERT INTO execution_kill_switches (
      kill_switch_id, scope_kind, portfolio_id, switch_state,
      state_version, schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
  selectKillSwitch: `
    SELECT canonical_payload FROM execution_kill_switches WHERE kill_switch_id = ?
  `,
  selectGlobalKillSwitch: `
    SELECT canonical_payload FROM execution_kill_switches
    WHERE scope_kind = 'GLOBAL' LIMIT 1
  `,
  selectPortfolioKillSwitch: `
    SELECT canonical_payload FROM execution_kill_switches
    WHERE scope_kind = 'PORTFOLIO' AND portfolio_id = ? LIMIT 1
  `,
  updateKillSwitch: `
    UPDATE execution_kill_switches SET
      switch_state = ?, state_version = ?, canonical_payload = ?
    WHERE kill_switch_id = ? AND state_version = ?
  `,

  insertFill: `
    INSERT INTO execution_fills (
      fill_id, order_id, execution_run_id, portfolio_id, instrument_id,
      side, quantity_shares, price_minor_units, content_hash, trade_time,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectFill: `
    SELECT canonical_payload FROM execution_fills WHERE fill_id = ?
  `,

  insertCancellationRequest: `
    INSERT INTO execution_cancellation_requests (
      cancellation_id, order_id, portfolio_id, idempotency_key,
      requested_at, schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `,
  selectCancellationRequest: `
    SELECT canonical_payload FROM execution_cancellation_requests
    WHERE cancellation_id = ?
  `,
  selectCancellationByIdempotency: `
    SELECT canonical_payload FROM execution_cancellation_requests
    WHERE order_id = ? AND idempotency_key = ?
  `,
  insertCancellationOutcome: `
    INSERT INTO execution_cancellation_outcomes (
      cancellation_id, outcome, completed_at, schema_version, canonical_payload
    ) VALUES (?, ?, ?, 1, ?)
  `,
  selectCancellationOutcome: `
    SELECT canonical_payload FROM execution_cancellation_outcomes
    WHERE cancellation_id = ?
  `,

  insertResidualWork: `
    INSERT INTO execution_residual_work (
      residual_work_id, execution_run_id, order_id, portfolio_id,
      remaining_quantity_shares, reason, created_at,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectResidualWork: `
    SELECT canonical_payload FROM execution_residual_work WHERE residual_work_id = ?
  `,

  insertAdjustmentProposal: `
    INSERT INTO execution_adjustment_proposals (
      adjustment_proposal_id, reconciliation_run_id, portfolio_id,
      proposal_state, content_hash, state_version,
      schema_version, canonical_payload
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `,
  selectAdjustmentProposal: `
    SELECT canonical_payload FROM execution_adjustment_proposals
    WHERE adjustment_proposal_id = ?
  `,
  updateAdjustmentProposal: `
    UPDATE execution_adjustment_proposals SET
      proposal_state = ?, state_version = ?, canonical_payload = ?
    WHERE adjustment_proposal_id = ? AND state_version = ?
  `,

  selectPortfolioStatusVersion: `
    SELECT status, state_version FROM portfolios WHERE portfolio_id = ?
  `,
  selectPortfolioByReconciliationRun: `
    SELECT portfolio_id FROM reconciliation_runs WHERE reconciliation_run_id = ?
  `,
  selectPortfolioByOrder: `
    SELECT portfolio_id FROM execution_orders WHERE order_id = ?
  `,
  selectResetPortfolioVersions: `
    SELECT portfolio_id, state_version FROM portfolios
    WHERE portfolio_id IN (
      SELECT portfolio_id FROM execution_orders
      WHERE order_state IN (
        'SUBMISSION_IN_FLIGHT', 'ACKNOWLEDGED', 'OPEN',
        'PARTIALLY_FILLED', 'UNKNOWN', 'CANCEL_PENDING'
      )
    )
    ORDER BY portfolio_id
  `,
})
