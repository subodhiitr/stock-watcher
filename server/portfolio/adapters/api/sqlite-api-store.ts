import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

import type { PortfolioApiResponse } from '../../api/api-contracts.ts'
import type {
  IdempotencyBeginResult,
  ManualPaperExitRecord,
  PortfolioAccessRole,
  PortfolioApiStore,
  PortfolioListItem,
  PerformanceAccountingRecord,
  PerformanceAttributionRecord,
  PerformanceObservationRecord,
  BrokerPortfolioReconciliationRecord,
  PrincipalRecord,
  SessionRecord,
  StrategyOption,
  ResearchRebalancePlanRecord,
  StrategicRebalanceObservationRecord,
} from '../../ports/api/api-store.ts'

type PerformanceObservationRow = Readonly<{
  observation_id: string
  portfolio_id: string
  observed_at: string
  observation_date: string
  portfolio_state_version: number
  benchmark_symbol: string
  benchmark_price_minor_units: string
  cash_minor_units: string
  market_value_minor_units: string
  nav_minor_units: string
  invested_cost_minor_units: string
  unrealized_pnl_minor_units: string
  day_pnl_minor_units: string
  contributed_capital_minor_units: string
  realized_pnl_minor_units: string
  cumulative_charges_minor_units: string
  cumulative_tax_minor_units: string
  net_pnl_minor_units: string
  day_return_ppm: number
  total_return_ppm: number
  benchmark_day_return_ppm: number
  benchmark_total_return_ppm: number
  wealth_index_ppm: string
  peak_wealth_index_ppm: string
  drawdown_ppm: number
  annualized_volatility_ppm: number
  annualized_return_ppm: number
  quote_count: number
  total_holdings: number
  attribution_json: string
  market_data_source: 'YAHOO_RESEARCH'
  created_by: string
}>

function performanceObservation(row: PerformanceObservationRow): PerformanceObservationRecord {
  return Object.freeze({
    observationId: row.observation_id,
    portfolioId: row.portfolio_id,
    observedAt: row.observed_at,
    observationDate: row.observation_date,
    portfolioStateVersion: row.portfolio_state_version,
    benchmarkSymbol: row.benchmark_symbol,
    benchmarkPriceMinorUnits: row.benchmark_price_minor_units,
    cashMinorUnits: row.cash_minor_units,
    marketValueMinorUnits: row.market_value_minor_units,
    navMinorUnits: row.nav_minor_units,
    investedCostMinorUnits: row.invested_cost_minor_units,
    unrealizedPnlMinorUnits: row.unrealized_pnl_minor_units,
    dayPnlMinorUnits: row.day_pnl_minor_units,
    contributedCapitalMinorUnits: row.contributed_capital_minor_units,
    realizedPnlMinorUnits: row.realized_pnl_minor_units,
    cumulativeChargesMinorUnits: row.cumulative_charges_minor_units,
    cumulativeTaxMinorUnits: row.cumulative_tax_minor_units,
    netPnlMinorUnits: row.net_pnl_minor_units,
    dayReturnPpm: row.day_return_ppm,
    totalReturnPpm: row.total_return_ppm,
    benchmarkDayReturnPpm: row.benchmark_day_return_ppm,
    benchmarkTotalReturnPpm: row.benchmark_total_return_ppm,
    wealthIndexPpm: row.wealth_index_ppm,
    peakWealthIndexPpm: row.peak_wealth_index_ppm,
    drawdownPpm: row.drawdown_ppm,
    annualizedVolatilityPpm: row.annualized_volatility_ppm,
    annualizedReturnPpm: row.annualized_return_ppm,
    quoteCount: row.quote_count,
    totalHoldings: row.total_holdings,
    attribution: Object.freeze(JSON.parse(row.attribution_json) as PerformanceAttributionRecord[]),
    marketDataSource: row.market_data_source,
    createdBy: row.created_by,
  })
}

type PrincipalRow = Readonly<{
  principal_id: string
  username_key: string
  display_name: string
  password_salt: string
  password_hash: string
  global_role: PrincipalRecord['globalRole']
  mfa_secret: string | null
  disabled: number
}>

function principal(row: PrincipalRow): PrincipalRecord {
  return Object.freeze({
    principalId: row.principal_id,
    usernameKey: row.username_key,
    displayName: row.display_name,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    globalRole: row.global_role,
    ...(row.mfa_secret === null ? {} : { mfaSecret: row.mfa_secret }),
    disabled: row.disabled === 1,
  })
}

export class SqlitePortfolioApiStore implements PortfolioApiStore {
  private readonly database: Database.Database
  private readonly canUse: () => boolean

  constructor(
    database: Database.Database,
    canUse: () => boolean = () => true,
  ) {
    this.database = database
    this.canUse = canUse
  }

  private assertAvailable(): void {
    if (!this.canUse()) throw new Error('PORTFOLIO_API_STORE_UNAVAILABLE')
  }

  countPrincipals(): number {
    this.assertAvailable()
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM portfolio_principals').get() as { count: number }
    return row.count
  }

  createPrincipal(record: PrincipalRecord, createdAtEpochMs: number): boolean {
    this.assertAvailable()
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO portfolio_principals (
        principal_id, username_key, display_name, password_salt, password_hash,
        global_role, mfa_secret, disabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.principalId,
      record.usernameKey,
      record.displayName,
      record.passwordSalt,
      record.passwordHash,
      record.globalRole,
      record.mfaSecret ?? null,
      record.disabled ? 1 : 0,
      createdAtEpochMs,
    )
    return result.changes === 1
  }

  findPrincipalByUsername(usernameKey: string): PrincipalRecord | undefined {
    this.assertAvailable()
    const row = this.database.prepare(`
      SELECT principal_id, username_key, display_name, password_salt, password_hash,
             global_role, mfa_secret, disabled
      FROM portfolio_principals WHERE username_key = ?
    `).get(usernameKey) as PrincipalRow | undefined
    return row === undefined ? undefined : principal(row)
  }

  findPrincipalById(principalId: string): PrincipalRecord | undefined {
    this.assertAvailable()
    const row = this.database.prepare(`
      SELECT principal_id, username_key, display_name, password_salt, password_hash,
             global_role, mfa_secret, disabled
      FROM portfolio_principals WHERE principal_id = ?
    `).get(principalId) as PrincipalRow | undefined
    return row === undefined ? undefined : principal(row)
  }

  setPrincipalMfaSecret(principalId: string, secret: string): boolean {
    this.assertAvailable()
    const result = this.database.prepare(`
      UPDATE portfolio_principals SET mfa_secret = ?
      WHERE principal_id = ? AND global_role = 'ADMIN' AND disabled = 0 AND mfa_secret IS NULL
    `).run(secret, principalId)
    return result.changes === 1
  }

  invalidatePrincipalSessions(principalId: string, nowEpochMs: number): void {
    this.assertAvailable()
    this.database.prepare(`
      UPDATE portfolio_sessions SET invalidated_at = ?
      WHERE principal_id = ? AND invalidated_at IS NULL
    `).run(nowEpochMs, principalId)
  }

  createSession(record: Readonly<{
    sessionHash: string
    principalId: string
    csrfHash: string
    createdAtEpochMs: number
    expiresAtEpochMs: number
    mfaVerified: boolean
  }>): boolean {
    this.assertAvailable()
    const result = this.database.prepare(`
      INSERT INTO portfolio_sessions (
        session_hash, principal_id, csrf_hash, created_at, expires_at,
        last_seen_at, mfa_verified, invalidated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      record.sessionHash,
      record.principalId,
      record.csrfHash,
      record.createdAtEpochMs,
      record.expiresAtEpochMs,
      record.createdAtEpochMs,
      record.mfaVerified ? 1 : 0,
    )
    return result.changes === 1
  }

  findSession(sessionHash: string, nowEpochMs: number): SessionRecord | undefined {
    this.assertAvailable()
    const row = this.database.prepare(`
      SELECT s.session_hash, s.principal_id, s.csrf_hash, s.expires_at,
             s.mfa_verified, s.invalidated_at, p.disabled
      FROM portfolio_sessions s
      JOIN portfolio_principals p ON p.principal_id = s.principal_id
      WHERE s.session_hash = ?
    `).get(sessionHash) as {
      session_hash: string
      principal_id: string
      csrf_hash: string
      expires_at: number
      mfa_verified: number
      invalidated_at: number | null
      disabled: number
    } | undefined
    if (
      row === undefined
      || row.disabled === 1
      || row.invalidated_at !== null
      || row.expires_at <= nowEpochMs
    ) return undefined
    return Object.freeze({
      sessionHash: row.session_hash,
      principalId: row.principal_id,
      actorId: `actor:${row.principal_id}`,
      csrfHash: row.csrf_hash,
      expiresAtEpochMs: row.expires_at,
      mfaVerified: row.mfa_verified === 1,
      invalidated: false,
    })
  }

  touchSession(sessionHash: string, nowEpochMs: number): void {
    this.assertAvailable()
    this.database.prepare(`
      UPDATE portfolio_sessions SET last_seen_at = ?
      WHERE session_hash = ? AND invalidated_at IS NULL AND expires_at > ?
    `).run(nowEpochMs, sessionHash, nowEpochMs)
  }

  invalidateSession(sessionHash: string, nowEpochMs: number): void {
    this.assertAvailable()
    this.database.prepare(`
      UPDATE portfolio_sessions SET invalidated_at = ?
      WHERE session_hash = ? AND invalidated_at IS NULL
    `).run(nowEpochMs, sessionHash)
  }

  allowRateLimit(input: Readonly<{
    bucketKey: string
    nowEpochMs: number
    windowMs: number
    limit: number
    blockMs: number
    consume?: boolean
  }>): Readonly<{ allowed: boolean; retryAfterMs: number }> {
    this.assertAvailable()
    const existing = this.database.prepare(`
      SELECT window_started_at, attempt_count, blocked_until
      FROM portfolio_rate_limits WHERE bucket_key = ?
    `).get(input.bucketKey) as {
      window_started_at: number
      attempt_count: number
      blocked_until: number | null
    } | undefined
    if (existing?.blocked_until !== null && existing?.blocked_until !== undefined && existing.blocked_until > input.nowEpochMs) {
      return Object.freeze({ allowed: false, retryAfterMs: existing.blocked_until - input.nowEpochMs })
    }
    if (input.consume === false) return Object.freeze({ allowed: true, retryAfterMs: 0 })
    const reset = existing === undefined
      || input.nowEpochMs - existing.window_started_at >= input.windowMs
    const windowStartedAt = reset ? input.nowEpochMs : existing.window_started_at
    const attempts = reset ? 1 : existing.attempt_count + 1
    const blockedUntil = attempts > input.limit ? input.nowEpochMs + input.blockMs : null
    this.database.prepare(`
      INSERT INTO portfolio_rate_limits (bucket_key, window_started_at, attempt_count, blocked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET
        window_started_at = excluded.window_started_at,
        attempt_count = excluded.attempt_count,
        blocked_until = excluded.blocked_until
    `).run(input.bucketKey, windowStartedAt, attempts, blockedUntil)
    return Object.freeze({
      allowed: blockedUntil === null,
      retryAfterMs: blockedUntil === null ? 0 : input.blockMs,
    })
  }

  appendSecurityAlert(input: Readonly<{
    alertId: string
    category: 'AUTH_BRUTE_FORCE' | 'RATE_LIMIT' | 'SESSION_REJECTED'
    subjectHash: string
    detailCode: string
    createdAtEpochMs: number
  }>): void {
    this.assertAvailable()
    this.database.prepare(`
      INSERT OR IGNORE INTO portfolio_security_alerts (
        alert_id, category, subject_hash, detail_code, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(input.alertId, input.category, input.subjectHash, input.detailCode, input.createdAtEpochMs)
  }

  grantPortfolioAccess(
    principalId: string,
    portfolioId: string,
    role: PortfolioAccessRole,
    createdAtEpochMs: number,
  ): boolean {
    this.assertAvailable()
    const result = this.database.prepare(`
      INSERT INTO portfolio_memberships (principal_id, portfolio_id, access_role, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(principal_id, portfolio_id) DO UPDATE SET access_role = excluded.access_role
    `).run(principalId, portfolioId, role, createdAtEpochMs)
    return result.changes === 1
  }

  grantAllExistingPortfolios(principalId: string, createdAtEpochMs: number): void {
    this.assertAvailable()
    this.database.prepare(`
      INSERT OR IGNORE INTO portfolio_memberships (
        principal_id, portfolio_id, access_role, created_at
      ) SELECT ?, portfolio_id, 'OWNER', ? FROM portfolios
    `).run(principalId, createdAtEpochMs)
  }

  canAccessPortfolio(principalId: string, portfolioId: string, access: string): boolean {
    this.assertAvailable()
    if (portfolioId === 'portfolio:collection') return true
    const row = this.database.prepare(`
      SELECT m.access_role, p.global_role
      FROM portfolio_memberships m
      JOIN portfolio_principals p ON p.principal_id = m.principal_id
      WHERE m.principal_id = ? AND m.portfolio_id = ? AND p.disabled = 0
    `).get(principalId, portfolioId) as {
      access_role: PortfolioAccessRole
      global_role: PrincipalRecord['globalRole']
    } | undefined
    if (row === undefined) return false
    if (access === 'READ') return true
    if (access === 'MUTATE') return row.access_role === 'EDITOR' || row.access_role === 'OWNER'
    return row.access_role === 'OWNER'
      && (row.global_role === 'OPERATOR' || row.global_role === 'ADMIN')
  }

  listPortfolios(principalId: string): readonly PortfolioListItem[] {
    this.assertAvailable()
    const rows = this.database.prepare(`
      SELECT p.portfolio_id, p.display_name, p.status, p.operating_mode,
             p.cash_minor_units, p.state_version, m.access_role
      FROM portfolio_memberships m
      JOIN portfolios p ON p.portfolio_id = m.portfolio_id
      WHERE m.principal_id = ?
      ORDER BY CASE p.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, p.display_name, p.portfolio_id
    `).all(principalId) as readonly {
      portfolio_id: string
      display_name: string
      status: string
      operating_mode: string
      cash_minor_units: string
      state_version: number
      access_role: PortfolioAccessRole
    }[]
    return Object.freeze(rows.map((row) => Object.freeze({
      portfolioId: row.portfolio_id,
      displayName: row.display_name,
      status: row.status,
      mode: row.operating_mode,
      cashMinorUnits: row.cash_minor_units,
      stateVersion: row.state_version,
      accessRole: row.access_role,
    })))
  }

  listStrategyOptions(): readonly StrategyOption[] {
    this.assertAvailable()
    const rows = this.database.prepare(`
      SELECT v.strategy_version_id, d.display_name, d.horizon, v.semantic_version
      FROM strategy_versions v
      JOIN strategy_definitions d ON d.strategy_id = v.strategy_id
      WHERE v.status IN ('SEEDED', 'ACTIVE')
      ORDER BY CASE d.horizon WHEN 'SHORT' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
               d.display_name, v.semantic_version
    `).all() as readonly {
      strategy_version_id: string
      display_name: string
      horizon: string
      semantic_version: string
    }[]
    return Object.freeze(rows.map((row) => Object.freeze({
      strategyVersionId: row.strategy_version_id,
      displayName: row.display_name,
      horizon: row.horizon,
      semanticVersion: row.semantic_version,
    })))
  }

  beginIdempotency(input: Readonly<{
    principalId: string
    idempotencyKey: string
    requestHash: string
    nowEpochMs: number
    expiresAtEpochMs: number
  }>): IdempotencyBeginResult {
    this.assertAvailable()
    this.database.prepare('DELETE FROM portfolio_idempotency WHERE expires_at <= ?').run(input.nowEpochMs)
    const existing = this.database.prepare(`
      SELECT request_hash, state, response_status, response_headers, response_body
      FROM portfolio_idempotency WHERE principal_id = ? AND idempotency_key = ?
    `).get(input.principalId, input.idempotencyKey) as {
      request_hash: string
      state: 'IN_PROGRESS' | 'COMPLETED'
      response_status: number | null
      response_headers: string | null
      response_body: string | null
    } | undefined
    if (existing !== undefined) {
      if (existing.request_hash !== input.requestHash) return Object.freeze({ kind: 'CONFLICT' })
      if (existing.state === 'IN_PROGRESS') return Object.freeze({ kind: 'IN_PROGRESS' })
      const response: PortfolioApiResponse = Object.freeze({
        status: existing.response_status ?? 500,
        headers: Object.freeze(JSON.parse(existing.response_headers ?? '{}') as Record<string, string>),
        body: JSON.parse(existing.response_body ?? 'null') as unknown,
      })
      return Object.freeze({ kind: 'REPLAY', response })
    }
    this.database.prepare(`
      INSERT INTO portfolio_idempotency (
        principal_id, idempotency_key, request_hash, state, created_at, expires_at
      ) VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?)
    `).run(
      input.principalId,
      input.idempotencyKey,
      input.requestHash,
      input.nowEpochMs,
      input.expiresAtEpochMs,
    )
    return Object.freeze({ kind: 'NEW' })
  }

  completeIdempotency(input: Readonly<{
    principalId: string
    idempotencyKey: string
    requestHash: string
    response: PortfolioApiResponse
  }>): void {
    this.assertAvailable()
    this.database.prepare(`
      UPDATE portfolio_idempotency
      SET state = 'COMPLETED', response_status = ?, response_headers = ?, response_body = ?
      WHERE principal_id = ? AND idempotency_key = ? AND request_hash = ? AND state = 'IN_PROGRESS'
    `).run(
      input.response.status,
      JSON.stringify(input.response.headers),
      JSON.stringify(input.response.body),
      input.principalId,
      input.idempotencyKey,
      input.requestHash,
    )
  }

  abandonIdempotency(principalId: string, idempotencyKey: string, requestHash: string): void {
    this.assertAvailable()
    this.database.prepare(`
      DELETE FROM portfolio_idempotency
      WHERE principal_id = ? AND idempotency_key = ? AND request_hash = ? AND state = 'IN_PROGRESS'
    `).run(principalId, idempotencyKey, requestHash)
  }

  readPortfolioView(principalId: string, portfolioId: string): unknown | undefined {
    this.assertAvailable()
    if (!this.canAccessPortfolio(principalId, portfolioId, 'READ')) return undefined
    const portfolio = this.database.prepare(`
      SELECT portfolio_id, display_name, status, operating_mode, cash_minor_units,
             state_version, created_at, updated_at
      FROM portfolios WHERE portfolio_id = ?
    `).get(portfolioId) as Record<string, unknown> | undefined
    if (portfolio === undefined) return undefined
    const holdings = this.database.prepare(`
      SELECT holding_id, instrument_id, total_quantity, available_delivery_quantity,
             reserved_quantity, state_version
      FROM holdings WHERE portfolio_id = ? ORDER BY instrument_id
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const lots = this.database.prepare(`
      SELECT lot_id, holding_id, instrument_id, acquired_on, open_quantity,
             unit_cost_minor_units, source_kind, source_reference_id
      FROM holding_lots WHERE portfolio_id = ? ORDER BY holding_id, acquired_on, lot_id
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const strategy = this.database.prepare(`
      SELECT d.display_name, d.horizon, v.semantic_version, v.strategy_version_id,
             v.canonical_payload, a.effective_at, a.policy_kind
      FROM portfolio_allocations a
      JOIN strategy_assignments sa ON sa.allocation_record_id = a.allocation_record_id
      JOIN strategy_versions v ON v.strategy_version_id = sa.strategy_version_id
      JOIN strategy_definitions d ON d.strategy_id = v.strategy_id
      WHERE a.portfolio_id = ? AND a.is_current = 1
      ORDER BY sa.sleeve_id, sa.assignment_id
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const execution = this.database.prepare(`
      SELECT order_state AS state, COUNT(*) AS count FROM execution_orders
      WHERE portfolio_id = ? GROUP BY order_state ORDER BY order_state
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const reconciliation = this.database.prepare(`
      SELECT reconciliation_run_id, reconciliation_state AS state, reason, started_at, completed_at
      FROM reconciliation_runs WHERE portfolio_id = ?
      ORDER BY started_at DESC LIMIT 10
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const brokerReconciliation = this.database.prepare(`
      SELECT reconciliation_id, broker, broker_as_of,
             portfolio_state_version_before, portfolio_state_version_after,
             cash_minor_units_before, cash_minor_units_after,
             added_count, updated_count, removed_count, unchanged_count,
             fallback_acquired_on, applied_at, applied_by
      FROM portfolio_broker_reconciliations WHERE portfolio_id = ?
      ORDER BY applied_at DESC, reconciliation_id DESC LIMIT 20
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const manualExits = this.database.prepare(`
      SELECT exit_id, instrument_id, quantity, execution_price_minor_units,
             gross_proceeds_minor_units, released_cost_basis_minor_units,
             realized_pnl_minor_units, charges_minor_units, tax_minor_units,
             net_proceeds_minor_units, exit_kind, reason_code, executed_at
      FROM portfolio_manual_exits WHERE portfolio_id = ?
      ORDER BY executed_at DESC, exit_id DESC LIMIT 20
    `).all(portfolioId) as readonly Record<string, unknown>[]
    const currentPlan = this.readCurrentResearchRebalancePlan(portfolioId)
    const rebalanceHistory = this.database.prepare(`
      SELECT p.canonical_payload, e.occurred_at
      FROM portfolio_rebalance_plans p
      JOIN portfolio_rebalance_plan_events e ON e.rowid = (
        SELECT MIN(approved.rowid) FROM portfolio_rebalance_plan_events approved
        WHERE approved.plan_id = p.plan_id AND approved.plan_state = 'APPROVED_PAPER'
      )
      WHERE p.portfolio_id = ?
      ORDER BY e.rowid DESC LIMIT 20
    `).all(portfolioId) as readonly { canonical_payload: string; occurred_at: string }[]
    const performanceObservations = this.readPerformanceObservations(portfolioId)
    const dailyPerformance = new Map<string, PerformanceObservationRecord>()
    for (const observation of performanceObservations) dailyPerformance.set(observation.observationDate, observation)
    const performanceHistory = Object.freeze([...dailyPerformance.values()])
    const latestPerformance = performanceObservations.at(-1)
    const rebalanceBlockers = currentPlan === undefined
        ? ['PREVIEW_NOT_GENERATED']
        : currentPlan.portfolioStateVersion !== portfolio.state_version
          ? ['PORTFOLIO_SNAPSHOT_CHANGED']
          : []
    return Object.freeze({
      portfolio: Object.freeze({ ...portfolio }),
      holdings: Object.freeze(holdings.map((row) => Object.freeze({ ...row }))),
      lots: Object.freeze(lots.map((row) => Object.freeze({ ...row }))),
      strategy: Object.freeze(strategy.map((row) => Object.freeze({ ...row }))),
      portfolioSnapshot: Object.freeze({
        stateVersion: portfolio.state_version,
        holdingsIncluded: holdings.length,
        lotsIncluded: lots.length,
        asOf: portfolio.updated_at,
      }),
      rebalance: Object.freeze({
        plans: Object.freeze(currentPlan === undefined ? [] : [currentPlan.canonicalPayload]),
        history: Object.freeze(rebalanceHistory.map((row) => Object.freeze({
          ...(JSON.parse(row.canonical_payload) as Record<string, unknown>),
          state:'APPROVED_PAPER',
          executedAt:row.occurred_at,
        }))),
        status: currentPlan?.state ?? 'NO_PLAN',
        blockers: Object.freeze(rebalanceBlockers),
      }),
      performance: Object.freeze({
        observations: performanceHistory,
        latest: latestPerformance,
        attribution: latestPerformance?.attribution ?? Object.freeze([]),
        status: latestPerformance === undefined
          ? 'NO_OBSERVATIONS'
          : latestPerformance.portfolioStateVersion === portfolio.state_version
            ? 'CURRENT'
            : 'STALE',
        observationCount: performanceObservations.length,
        trackedSince: performanceHistory[0]?.observationDate,
      }),
      manualExits: Object.freeze(manualExits.map((row) => Object.freeze({ ...row }))),
      execution: Object.freeze(execution.map((row) => Object.freeze({ ...row }))),
      reconciliation: Object.freeze(reconciliation.map((row) => Object.freeze({ ...row }))),
      brokerReconciliation: Object.freeze(brokerReconciliation.map((row) => Object.freeze({ ...row }))),
    })
  }

  readCurrentResearchRebalancePlan(portfolioId: string): ResearchRebalancePlanRecord | undefined {
    this.assertAvailable()
    const row = this.database.prepare(`
      SELECT
        p.plan_id, p.rebalance_run_id, p.portfolio_id, p.portfolio_state_version,
        p.strategy_version_id, p.plan_hash, p.market_data_source,
        p.market_data_as_of, p.canonical_payload, p.created_at, p.created_by,
        e.plan_state
      FROM portfolio_rebalance_plans p
      JOIN portfolio_rebalance_plan_events e ON e.event_id = (
        SELECT latest.event_id
        FROM portfolio_rebalance_plan_events latest
        WHERE latest.plan_id = p.plan_id
        ORDER BY latest.rowid DESC
        LIMIT 1
      )
      WHERE p.portfolio_id = ? AND e.plan_state <> 'SUPERSEDED'
      ORDER BY p.created_at DESC, p.plan_id DESC
      LIMIT 1
    `).get(portfolioId) as Readonly<{
      plan_id: string
      rebalance_run_id: string
      portfolio_id: string
      portfolio_state_version: number
      strategy_version_id: string
      plan_hash: string
      market_data_source: 'YAHOO_RESEARCH'
      market_data_as_of: string
      canonical_payload: string
      created_at: string
      created_by: string
      plan_state: ResearchRebalancePlanRecord['state']
    }> | undefined
    if (row === undefined) return undefined
    return Object.freeze({
      planId: row.plan_id,
      rebalanceRunId: row.rebalance_run_id,
      portfolioId: row.portfolio_id,
      portfolioStateVersion: row.portfolio_state_version,
      strategyVersionId: row.strategy_version_id,
      planHash: row.plan_hash,
      marketDataSource: row.market_data_source,
      marketDataAsOf: row.market_data_as_of,
      state: row.plan_state,
      canonicalPayload: JSON.parse(row.canonical_payload) as unknown,
      createdAt: row.created_at,
      createdBy: row.created_by,
    })
  }

  readLatestStrategicRebalanceObservation(portfolioId: string): StrategicRebalanceObservationRecord | undefined {
    this.assertAvailable()
    const row = this.database.prepare(`
      SELECT * FROM portfolio_strategic_rebalance_observations
      WHERE portfolio_id = ? ORDER BY rowid DESC LIMIT 1
    `).get(portfolioId) as Readonly<{
      observation_id: string; portfolio_id: string; plan_id: string
      policy_version: 'STRATEGIC_REBALANCE_V1'; decision_session_date: string
      state: StrategicRebalanceObservationRecord['state']; risk_benchmark: string; defensive_benchmark: string
      signal_json: string; data_hash: string; delayed_buy_minor_units: string; retained_cash_minor_units: string
      delay_started_on: string | null; created_at: string; created_by: string
    }> | undefined
    if (row === undefined) return undefined
    return Object.freeze({
      observationId: row.observation_id, portfolioId: row.portfolio_id, planId: row.plan_id,
      policyVersion: row.policy_version, decisionSessionDate: row.decision_session_date, state: row.state,
      riskBenchmark: row.risk_benchmark, defensiveBenchmark: row.defensive_benchmark,
      signal: JSON.parse(row.signal_json) as Readonly<Record<string, unknown>>, dataHash: row.data_hash,
      delayedBuyMinorUnits: row.delayed_buy_minor_units, retainedCashMinorUnits: row.retained_cash_minor_units,
      delayStartedOn: row.delay_started_on, createdAt: row.created_at, createdBy: row.created_by,
    })
  }

  saveResearchRebalancePlan(input: Readonly<{
    plan: ResearchRebalancePlanRecord
    strategicObservation?: StrategicRebalanceObservationRecord
    eventId: string
    supersedeEventId: string
  }>): boolean {
    this.assertAvailable()
    if (this.database.inTransaction) return false
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const current = this.readCurrentResearchRebalancePlan(input.plan.portfolioId)
      if (current !== undefined) {
        this.database.prepare(`
          INSERT INTO portfolio_rebalance_plan_events (
            event_id, plan_id, portfolio_id, plan_state, actor_id, reason_code, occurred_at
          ) VALUES (?, ?, ?, 'SUPERSEDED', ?, 'NEW_PREVIEW_GENERATED', ?)
        `).run(
          input.supersedeEventId,
          current.planId,
          input.plan.portfolioId,
          input.plan.createdBy,
          input.plan.createdAt,
        )
      }
      this.database.prepare(`
        INSERT INTO portfolio_rebalance_plans (
          plan_id, rebalance_run_id, portfolio_id, portfolio_state_version,
          strategy_version_id, plan_hash, market_data_source, market_data_as_of,
          canonical_payload, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.plan.planId,
        input.plan.rebalanceRunId,
        input.plan.portfolioId,
        input.plan.portfolioStateVersion,
        input.plan.strategyVersionId,
        input.plan.planHash,
        input.plan.marketDataSource,
        input.plan.marketDataAsOf,
        JSON.stringify(input.plan.canonicalPayload),
        input.plan.createdAt,
        input.plan.createdBy,
      )
      this.database.prepare(`
        INSERT INTO portfolio_rebalance_plan_events (
          event_id, plan_id, portfolio_id, plan_state, actor_id, reason_code, occurred_at
        ) VALUES (?, ?, ?, 'PREVIEW_READY', ?, 'RESEARCH_PREVIEW_GENERATED', ?)
      `).run(
        input.eventId,
        input.plan.planId,
        input.plan.portfolioId,
        input.plan.createdBy,
        input.plan.createdAt,
      )
      if (input.strategicObservation !== undefined) {
        const observation = input.strategicObservation
        this.database.prepare(`
          INSERT INTO portfolio_strategic_rebalance_observations (
            observation_id, portfolio_id, plan_id, policy_version, decision_session_date,
            state, risk_benchmark, defensive_benchmark, signal_json, data_hash,
            delayed_buy_minor_units, retained_cash_minor_units, delay_started_on, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          observation.observationId, observation.portfolioId, observation.planId, observation.policyVersion,
          observation.decisionSessionDate, observation.state, observation.riskBenchmark, observation.defensiveBenchmark,
          JSON.stringify(observation.signal), observation.dataHash, observation.delayedBuyMinorUnits,
          observation.retainedCashMinorUnits, observation.delayStartedOn, observation.createdAt, observation.createdBy,
        )
      }
      this.database.exec('COMMIT')
      return true
    } catch {
      if (this.database.inTransaction) this.database.exec('ROLLBACK')
      return false
    }
  }

  approveResearchRebalancePlan(input: Readonly<{
    portfolioId: string
    planId: string
    actorId: string
    eventId: string
    occurredAt: string
  }>): boolean {
    this.assertAvailable()
    if (this.database.inTransaction) return false
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const current = this.readCurrentResearchRebalancePlan(input.portfolioId)
      if (current?.planId !== input.planId || !['PREVIEW_READY', 'APPROVED_PAPER'].includes(current.state)) throw new Error('PLAN_STATE_CONFLICT')
      const state = this.database.prepare(`
        SELECT state_version, operating_mode, status, cash_minor_units FROM portfolios WHERE portfolio_id = ?
      `).get(input.portfolioId) as { state_version: number; operating_mode: string; status: string; cash_minor_units: string } | undefined
      if (
        state?.state_version !== current.portfolioStateVersion
        || state.operating_mode !== 'PAPER'
        || state.status !== 'ACTIVE'
      ) throw new Error('PORTFOLIO_STATE_CONFLICT')

      const payload = current.canonicalPayload as Record<string, unknown>
      const strategic = payload['strategicRebalance']
      if (typeof strategic === 'object' && strategic !== null && (strategic as Record<string, unknown>)['approvalBlocked'] === true) {
        throw new Error('STRATEGIC_APPROVAL_BLOCKED')
      }
      const actions = Array.isArray(payload.actions) ? payload.actions : []
      const summary = typeof payload.summary === 'object' && payload.summary !== null
        ? payload.summary as Record<string, unknown> : {}
      if (actions.length > 500 || !/^(0|[1-9][0-9]*)$/u.test(String(summary.projectedCashMinorUnits ?? ''))) {
        throw new Error('INVALID_PLAN_PAYLOAD')
      }

      const holdings = this.database.prepare(`
        SELECT holding_id, instrument_id, total_quantity, available_delivery_quantity, reserved_quantity
        FROM holdings WHERE portfolio_id = ?
      `).all(input.portfolioId) as readonly {
        holding_id: string
        instrument_id: string
        total_quantity: string
        available_delivery_quantity: string
        reserved_quantity: string
      }[]
      const holdingByInstrument = new Map(holdings.map((holding) => [holding.instrument_id, holding]))
      const parsedActions = actions.map((raw) => {
        if (typeof raw !== 'object' || raw === null) throw new Error('INVALID_PLAN_ACTION')
        const action = raw as Record<string, unknown>
        const instrumentId = String(action.instrumentId ?? '')
        const currentQuantity = String(action.currentQuantity ?? '')
        const targetQuantity = String(action.targetQuantity ?? '')
        const deltaQuantity = String(action.deltaQuantity ?? '')
        const livePriceMinorUnits = String(action.livePriceMinorUnits ?? '')
        const estimatedChargesMinorUnits = String(action.estimatedChargesMinorUnits ?? '')
        const estimatedTaxMinorUnits = String(action.estimatedTaxMinorUnits ?? '')
        const reasonCode = String(action.reasonCode ?? 'STRATEGY_REBALANCE')
        if (!/^NSE:[A-Z0-9&-]+$/u.test(instrumentId)
          || !/^(0|[1-9][0-9]*)$/u.test(currentQuantity)
          || !/^(0|[1-9][0-9]*)$/u.test(targetQuantity)
          || !/^-?(0|[1-9][0-9]*)$/u.test(deltaQuantity)
          || !/^[1-9][0-9]*$/u.test(livePriceMinorUnits)
          || !/^(0|[1-9][0-9]*)$/u.test(estimatedChargesMinorUnits)
          || !/^(0|[1-9][0-9]*)$/u.test(estimatedTaxMinorUnits)
          || !/^[A-Z0-9_]{2,48}$/u.test(reasonCode)) throw new Error('INVALID_PLAN_ACTION')
        const currentShares = BigInt(currentQuantity)
        const targetShares = BigInt(targetQuantity)
        const deltaShares = BigInt(deltaQuantity)
        const holding = holdingByInstrument.get(instrumentId)
        if (targetShares - currentShares !== deltaShares
          || (holding === undefined ? currentShares !== 0n : BigInt(holding.total_quantity) !== currentShares)) {
          throw new Error('PLAN_QUANTITY_CONFLICT')
        }
        if (holding !== undefined && deltaShares < 0n && -deltaShares > BigInt(holding.available_delivery_quantity)) {
          throw new Error('DELIVERY_QUANTITY_CONFLICT')
        }
        return Object.freeze({
          instrumentId, currentShares, targetShares, deltaShares,
          price:BigInt(livePriceMinorUnits), charges:BigInt(estimatedChargesMinorUnits), tax:BigInt(estimatedTaxMinorUnits), holding,
          reasonCode,
          exitRiskLevel:String(action.exitRiskLevel ?? 'NONE'),
          exitRiskSummary:String(action.exitRiskSummary ?? ''),
          mandatoryExit:action.mandatoryExit === true,
        })
      })

      const expectedCash = parsedActions.reduce((cash, action) => (
        cash - action.deltaShares * action.price - action.charges - action.tax
      ), BigInt(state.cash_minor_units))
      const projectedCash = BigInt(String(summary.projectedCashMinorUnits))
      if (expectedCash !== projectedCash || projectedCash < 0n) throw new Error('PLAN_CASH_CONFLICT')

      const nextStateVersion = state.state_version + 1
      const acquiredOn = input.occurredAt.slice(0, 10)
      for (const action of parsedActions) {
        if (action.deltaShares === 0n) continue
        if (action.deltaShares > 0n) {
          const holdingId = action.holding?.holding_id ?? `holding:${randomUUID()}`
          if (action.holding === undefined) {
            this.database.prepare(`
              INSERT INTO holdings (
                holding_id, portfolio_id, instrument_id, total_quantity,
                available_delivery_quantity, reserved_quantity, state_version, margin_funded
              ) VALUES (?, ?, ?, ?, ?, '0', ?, 0)
            `).run(holdingId, input.portfolioId, action.instrumentId, action.targetShares.toString(), action.targetShares.toString(), nextStateVersion)
          } else {
            const available = BigInt(action.holding.available_delivery_quantity) + action.deltaShares
            this.database.prepare(`
              UPDATE holdings SET total_quantity = ?, available_delivery_quantity = ?, state_version = ?
              WHERE portfolio_id = ? AND holding_id = ?
            `).run(action.targetShares.toString(), available.toString(), nextStateVersion, input.portfolioId, holdingId)
          }
          this.database.prepare(`
            INSERT INTO holding_lots (
              lot_id, holding_id, portfolio_id, instrument_id, acquired_on,
              original_quantity, open_quantity, unit_cost_minor_units, source_kind, source_reference_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FILL', ?)
          `).run(
            `lot:${randomUUID()}`, holdingId, input.portfolioId, action.instrumentId, acquiredOn,
            action.deltaShares.toString(), action.deltaShares.toString(), action.price.toString(), `paper-plan:${input.planId}`,
          )
          continue
        }

        if (action.holding === undefined) throw new Error('MISSING_SELL_HOLDING')
        let remaining = -action.deltaShares
        const lots = this.database.prepare(`
          SELECT lot_id, open_quantity, unit_cost_minor_units FROM holding_lots
          WHERE portfolio_id = ? AND holding_id = ? ORDER BY acquired_on, lot_id
        `).all(input.portfolioId, action.holding.holding_id) as readonly { lot_id: string; open_quantity: string; unit_cost_minor_units: string }[]
        let releasedCostBasis = 0n
        for (const lot of lots) {
          if (remaining === 0n) break
          const openQuantity = BigInt(lot.open_quantity)
          const sold = remaining < openQuantity ? remaining : openQuantity
          releasedCostBasis += sold * BigInt(lot.unit_cost_minor_units)
          const nextOpen = openQuantity - sold
          if (nextOpen === 0n) this.database.prepare('DELETE FROM holding_lots WHERE lot_id = ?').run(lot.lot_id)
          else this.database.prepare('UPDATE holding_lots SET open_quantity = ? WHERE lot_id = ?').run(nextOpen.toString(), lot.lot_id)
          remaining -= sold
        }
        if (remaining !== 0n) throw new Error('LOT_QUANTITY_CONFLICT')
        if (action.targetShares === 0n) {
          if (BigInt(action.holding.reserved_quantity) !== 0n) throw new Error('RESERVED_QUANTITY_CONFLICT')
          this.database.prepare('DELETE FROM holdings WHERE portfolio_id = ? AND holding_id = ?').run(input.portfolioId, action.holding.holding_id)
        } else {
          const available = BigInt(action.holding.available_delivery_quantity) + action.deltaShares
          this.database.prepare(`
            UPDATE holdings SET total_quantity = ?, available_delivery_quantity = ?, state_version = ?
            WHERE portfolio_id = ? AND holding_id = ?
          `).run(action.targetShares.toString(), available.toString(), nextStateVersion, input.portfolioId, action.holding.holding_id)
        }
        const quantity = -action.deltaShares
        const grossProceeds = quantity * action.price
        const realizedPnl = grossProceeds - releasedCostBasis
        const netProceeds = grossProceeds - action.charges - action.tax
        if (netProceeds < 0n) throw new Error('REBALANCE_EXIT_ACCOUNTING_CONFLICT')
        this.database.prepare(`
          INSERT INTO portfolio_manual_exits (
            exit_id, portfolio_id, holding_id, instrument_id, quantity,
            execution_price_minor_units, gross_proceeds_minor_units,
            released_cost_basis_minor_units, realized_pnl_minor_units,
            charges_minor_units, tax_minor_units, net_proceeds_minor_units,
            portfolio_state_version_before, portfolio_state_version_after,
            exit_kind, reason_code, risk_snapshot_json, market_data_source,
            executed_at, executed_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'YAHOO_RESEARCH', ?, ?)
        `).run(
          `rebalance-exit:${randomUUID()}`, input.portfolioId, action.holding.holding_id, action.instrumentId,
          quantity.toString(), action.price.toString(), grossProceeds.toString(), releasedCostBasis.toString(),
          realizedPnl.toString(), action.charges.toString(), action.tax.toString(), netProceeds.toString(),
          state.state_version, nextStateVersion, action.targetShares === 0n ? 'FULL' : 'PARTIAL',
          `REBALANCE_${action.reasonCode}`.slice(0, 64),
          JSON.stringify({ planId:input.planId, actionReasonCode:action.reasonCode, exitRiskLevel:action.exitRiskLevel, exitRiskSummary:action.exitRiskSummary, mandatoryExit:action.mandatoryExit }),
          input.occurredAt, input.actorId,
        )
      }

      this.database.prepare(`
        UPDATE portfolios SET cash_minor_units = ?, state_version = ?, updated_at = ? WHERE portfolio_id = ?
      `).run(projectedCash.toString(), nextStateVersion, input.occurredAt, input.portfolioId)
      this.database.prepare(`
        INSERT INTO portfolio_rebalance_plan_events (
          event_id, plan_id, portfolio_id, plan_state, actor_id, reason_code, occurred_at
        ) VALUES (?, ?, ?, 'APPROVED_PAPER', ?, 'USER_APPROVED_PAPER_PLAN', ?)
      `).run(input.eventId, input.planId, input.portfolioId, input.actorId, input.occurredAt)
      this.database.exec('COMMIT')
      return true
    } catch {
      if (this.database.inTransaction) this.database.exec('ROLLBACK')
      return false
    }
  }

  readPerformanceObservations(portfolioId: string): readonly PerformanceObservationRecord[] {
    this.assertAvailable()
    const rows = this.database.prepare(`
      SELECT * FROM portfolio_performance_observations
      WHERE portfolio_id = ? ORDER BY observed_at, observation_id
    `).all(portfolioId) as readonly PerformanceObservationRow[]
    return Object.freeze(rows.map(performanceObservation))
  }

  readPerformanceAccounting(portfolioId: string): PerformanceAccountingRecord {
    this.assertAvailable()
    const eventRows = this.database.prepare(`
      SELECT event_type, occurred_at, canonical_payload
      FROM domain_events
      WHERE portfolio_id = ? AND event_type IN ('PortfolioCreated', 'HoldingImported')
      ORDER BY occurred_at, stream_sequence
    `).all(portfolioId) as readonly { event_type: string; occurred_at: string; canonical_payload: string }[]
    const capitalFlows = eventRows.map((row) => {
      const event = JSON.parse(row.canonical_payload) as { payload?: Record<string, unknown> }
      const payload = event.payload ?? {}
      const startingCash = typeof payload.startingCash === 'object' && payload.startingCash !== null
        ? (payload.startingCash as Record<string, unknown>).minorUnits
        : payload.startingCash
      const amount = row.event_type === 'PortfolioCreated'
        ? BigInt(String(startingCash ?? '0'))
        : BigInt(String(payload.quantity ?? '0')) * BigInt(String(payload.unitCostMinorUnits ?? '0'))
      return Object.freeze({
        occurredAt: row.occurred_at,
        amountMinorUnits: amount.toString(),
        kind: row.event_type === 'PortfolioCreated' ? 'STARTING_CASH' as const : 'HOLDING_IMPORT' as const,
      })
    })
    const planRows = this.database.prepare(`
      SELECT p.canonical_payload
      FROM portfolio_rebalance_plans p
      WHERE p.portfolio_id = ? AND EXISTS (
        SELECT 1 FROM portfolio_rebalance_plan_events e
        WHERE e.plan_id = p.plan_id AND e.plan_state = 'APPROVED_PAPER'
      )
      ORDER BY p.created_at, p.plan_id
    `).all(portfolioId) as readonly { canonical_payload: string }[]
    let realizedPnl = 0n
    let charges = 0n
    let tax = 0n
    for (const row of planRows) {
      const plan = JSON.parse(row.canonical_payload) as {
        summary?: Record<string, unknown>
        actions?: readonly Record<string, unknown>[]
      }
      charges += BigInt(String(plan.summary?.estimatedChargesMinorUnits ?? '0'))
      tax += BigInt(String(plan.summary?.estimatedTaxMinorUnits ?? '0'))
      for (const action of plan.actions ?? []) {
        realizedPnl += BigInt(String(action.realizedPnlMinorUnits ?? '0'))
      }
    }
    const manualExitTotals = this.database.prepare(`
      SELECT
        COALESCE(SUM(CAST(realized_pnl_minor_units AS INTEGER)), 0) AS realized_pnl,
        COALESCE(SUM(CAST(charges_minor_units AS INTEGER)), 0) AS charges,
        COALESCE(SUM(CAST(tax_minor_units AS INTEGER)), 0) AS tax
      FROM portfolio_manual_exits WHERE portfolio_id = ? AND reason_code NOT LIKE 'REBALANCE_%'
    `).get(portfolioId) as { realized_pnl: number; charges: number; tax: number }
    realizedPnl += BigInt(manualExitTotals.realized_pnl)
    charges += BigInt(manualExitTotals.charges)
    tax += BigInt(manualExitTotals.tax)
    return Object.freeze({
      capitalFlows: Object.freeze(capitalFlows),
      realizedPnlMinorUnits: realizedPnl.toString(),
      cumulativeChargesMinorUnits: charges.toString(),
      cumulativeTaxMinorUnits: tax.toString(),
    })
  }

  savePerformanceObservation(observation: PerformanceObservationRecord): boolean {
    this.assertAvailable()
    try {
      const result = this.database.prepare(`
        INSERT INTO portfolio_performance_observations (
          observation_id, portfolio_id, observed_at, observation_date,
          portfolio_state_version, benchmark_symbol, benchmark_price_minor_units,
          cash_minor_units, market_value_minor_units, nav_minor_units,
          invested_cost_minor_units, unrealized_pnl_minor_units, day_pnl_minor_units,
          contributed_capital_minor_units, realized_pnl_minor_units,
          cumulative_charges_minor_units, cumulative_tax_minor_units, net_pnl_minor_units,
          day_return_ppm, total_return_ppm, benchmark_day_return_ppm,
          benchmark_total_return_ppm, wealth_index_ppm, peak_wealth_index_ppm,
          drawdown_ppm, annualized_volatility_ppm, annualized_return_ppm,
          quote_count, total_holdings, attribution_json, market_data_source, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        observation.observationId, observation.portfolioId, observation.observedAt,
        observation.observationDate, observation.portfolioStateVersion,
        observation.benchmarkSymbol, observation.benchmarkPriceMinorUnits,
        observation.cashMinorUnits, observation.marketValueMinorUnits, observation.navMinorUnits,
        observation.investedCostMinorUnits, observation.unrealizedPnlMinorUnits,
        observation.dayPnlMinorUnits, observation.contributedCapitalMinorUnits,
        observation.realizedPnlMinorUnits, observation.cumulativeChargesMinorUnits,
        observation.cumulativeTaxMinorUnits, observation.netPnlMinorUnits,
        observation.dayReturnPpm, observation.totalReturnPpm,
        observation.benchmarkDayReturnPpm, observation.benchmarkTotalReturnPpm,
        observation.wealthIndexPpm, observation.peakWealthIndexPpm,
        observation.drawdownPpm, observation.annualizedVolatilityPpm,
        observation.annualizedReturnPpm, observation.quoteCount, observation.totalHoldings,
        JSON.stringify(observation.attribution), observation.marketDataSource, observation.createdBy,
      )
      return result.changes === 1
    } catch {
      return false
    }
  }

  executeManualPaperExit(exit: ManualPaperExitRecord): boolean {
    this.assertAvailable()
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const portfolio = this.database.prepare(`
        SELECT cash_minor_units, state_version, status, operating_mode
        FROM portfolios WHERE portfolio_id = ?
      `).get(exit.portfolioId) as {
        cash_minor_units: string
        state_version: number
        status: string
        operating_mode: string
      } | undefined
      if (
        portfolio === undefined
        || portfolio.status !== 'ACTIVE'
        || portfolio.operating_mode !== 'PAPER'
        || portfolio.state_version !== exit.portfolioStateVersionBefore
        || exit.portfolioStateVersionAfter !== portfolio.state_version + 1
      ) throw new Error('MANUAL_EXIT_STATE_CONFLICT')
      const holding = this.database.prepare(`
        SELECT holding_id, instrument_id, total_quantity, available_delivery_quantity, reserved_quantity
        FROM holdings WHERE portfolio_id = ? AND holding_id = ?
      `).get(exit.portfolioId, exit.holdingId) as {
        holding_id: string
        instrument_id: string
        total_quantity: string
        available_delivery_quantity: string
        reserved_quantity: string
      } | undefined
      if (holding === undefined || holding.instrument_id !== exit.instrumentId) throw new Error('MANUAL_EXIT_HOLDING_MISSING')
      const quantity = BigInt(exit.quantity)
      const totalQuantity = BigInt(holding.total_quantity)
      const availableQuantity = BigInt(holding.available_delivery_quantity)
      if (quantity <= 0n || quantity > totalQuantity || quantity > availableQuantity) throw new Error('MANUAL_EXIT_QUANTITY_CONFLICT')
      const lots = this.database.prepare(`
        SELECT lot_id, open_quantity, unit_cost_minor_units
        FROM holding_lots WHERE portfolio_id = ? AND holding_id = ?
        ORDER BY acquired_on, lot_id
      `).all(exit.portfolioId, exit.holdingId) as readonly {
        lot_id: string
        open_quantity: string
        unit_cost_minor_units: string
      }[]
      let remaining = quantity
      let releasedCostBasis = 0n
      for (const lot of lots) {
        if (remaining === 0n) break
        const openQuantity = BigInt(lot.open_quantity)
        const sold = remaining < openQuantity ? remaining : openQuantity
        releasedCostBasis += sold * BigInt(lot.unit_cost_minor_units)
        remaining -= sold
      }
      const price = BigInt(exit.executionPriceMinorUnits)
      const grossProceeds = quantity * price
      const realizedPnl = grossProceeds - releasedCostBasis
      const charges = BigInt(exit.chargesMinorUnits)
      const tax = BigInt(exit.taxMinorUnits)
      const netProceeds = grossProceeds - charges - tax
      if (
        remaining !== 0n
        || releasedCostBasis !== BigInt(exit.releasedCostBasisMinorUnits)
        || grossProceeds !== BigInt(exit.grossProceedsMinorUnits)
        || realizedPnl !== BigInt(exit.realizedPnlMinorUnits)
        || netProceeds !== BigInt(exit.netProceedsMinorUnits)
        || netProceeds < 0n
      ) throw new Error('MANUAL_EXIT_ACCOUNTING_CONFLICT')
      remaining = quantity
      for (const lot of lots) {
        if (remaining === 0n) break
        const openQuantity = BigInt(lot.open_quantity)
        const sold = remaining < openQuantity ? remaining : openQuantity
        const nextOpenQuantity = openQuantity - sold
        if (nextOpenQuantity === 0n) this.database.prepare('DELETE FROM holding_lots WHERE lot_id = ?').run(lot.lot_id)
        else this.database.prepare('UPDATE holding_lots SET open_quantity = ? WHERE lot_id = ?').run(nextOpenQuantity.toString(), lot.lot_id)
        remaining -= sold
      }
      const nextQuantity = totalQuantity - quantity
      if (nextQuantity === 0n) {
        if (BigInt(holding.reserved_quantity) !== 0n) throw new Error('MANUAL_EXIT_RESERVED_QUANTITY')
        this.database.prepare('DELETE FROM holdings WHERE portfolio_id = ? AND holding_id = ?').run(exit.portfolioId, exit.holdingId)
      } else {
        this.database.prepare(`
          UPDATE holdings
          SET total_quantity = ?, available_delivery_quantity = ?, state_version = ?
          WHERE portfolio_id = ? AND holding_id = ?
        `).run(
          nextQuantity.toString(),
          (availableQuantity - quantity).toString(),
          exit.portfolioStateVersionAfter,
          exit.portfolioId,
          exit.holdingId,
        )
      }
      this.database.prepare(`
        UPDATE portfolios SET cash_minor_units = ?, state_version = ?, updated_at = ?
        WHERE portfolio_id = ?
      `).run(
        (BigInt(portfolio.cash_minor_units) + netProceeds).toString(),
        exit.portfolioStateVersionAfter,
        exit.executedAt,
        exit.portfolioId,
      )
      this.database.prepare(`
        INSERT INTO portfolio_manual_exits (
          exit_id, portfolio_id, holding_id, instrument_id, quantity,
          execution_price_minor_units, gross_proceeds_minor_units,
          released_cost_basis_minor_units, realized_pnl_minor_units,
          charges_minor_units, tax_minor_units, net_proceeds_minor_units,
          portfolio_state_version_before, portfolio_state_version_after,
          exit_kind, reason_code, risk_snapshot_json, market_data_source,
          executed_at, executed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        exit.exitId, exit.portfolioId, exit.holdingId, exit.instrumentId, exit.quantity,
        exit.executionPriceMinorUnits, exit.grossProceedsMinorUnits,
        exit.releasedCostBasisMinorUnits, exit.realizedPnlMinorUnits,
        exit.chargesMinorUnits, exit.taxMinorUnits, exit.netProceedsMinorUnits,
        exit.portfolioStateVersionBefore, exit.portfolioStateVersionAfter,
        exit.exitKind, exit.reasonCode, JSON.stringify(exit.riskSnapshot),
        exit.marketDataSource, exit.executedAt, exit.executedBy,
      )
      this.database.exec('COMMIT')
      return true
    } catch {
      if (this.database.inTransaction) this.database.exec('ROLLBACK')
      return false
    }
  }

  applyBrokerPortfolioReconciliation(input: Readonly<{
    reconciliationId: string
    portfolioId: string
    broker: 'SHAREKHAN'
    brokerAsOf: number
    portfolioStateVersion: number
    availableCashMinorUnits: string
    fallbackAcquiredOn: string
    holdings: readonly Readonly<{
      instrumentId: string
      quantity: string
      unitCostMinorUnits: string
      acquiredOn?: string
    }>[]
    appliedAt: string
    appliedBy: string
  }>): BrokerPortfolioReconciliationRecord | undefined {
    this.assertAvailable()
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const portfolio = this.database.prepare(`
        SELECT cash_minor_units, state_version, status, operating_mode
        FROM portfolios WHERE portfolio_id = ?
      `).get(input.portfolioId) as {
        cash_minor_units: string
        state_version: number
        status: string
        operating_mode: string
      } | undefined
      if (
        portfolio === undefined
        || portfolio.status !== 'ACTIVE'
        || portfolio.operating_mode !== 'PAPER'
        || portfolio.state_version !== input.portfolioStateVersion
      ) throw new Error('BROKER_RECONCILIATION_STATE_CONFLICT')

      const currentRows = this.database.prepare(`
        SELECT holding_id, instrument_id, total_quantity, reserved_quantity
        FROM holdings WHERE portfolio_id = ?
      `).all(input.portfolioId) as readonly {
        holding_id: string
        instrument_id: string
        total_quantity: string
        reserved_quantity: string
      }[]
      const currentByInstrument = new Map(currentRows.map((row) => [row.instrument_id, row]))
      const brokerByInstrument = new Map(input.holdings.map((row) => [row.instrumentId, row]))
      if (brokerByInstrument.size !== input.holdings.length) throw new Error('DUPLICATE_BROKER_HOLDING')

      let addedCount = 0
      let updatedCount = 0
      let removedCount = 0
      let unchangedCount = 0
      const nextStateVersion = portfolio.state_version + 1

      for (const current of currentRows) {
        if (brokerByInstrument.has(current.instrument_id)) continue
        if (BigInt(current.reserved_quantity) !== 0n) throw new Error('BROKER_RECONCILIATION_RESERVED_QUANTITY')
        this.database.prepare('DELETE FROM holding_lots WHERE portfolio_id = ? AND holding_id = ?').run(input.portfolioId, current.holding_id)
        this.database.prepare('DELETE FROM holdings WHERE portfolio_id = ? AND holding_id = ?').run(input.portfolioId, current.holding_id)
        removedCount += 1
      }

      for (const brokerHolding of input.holdings) {
        const current = currentByInstrument.get(brokerHolding.instrumentId)
        const targetQuantity = BigInt(brokerHolding.quantity)
        const targetUnitCost = BigInt(brokerHolding.unitCostMinorUnits)
        const targetCost = targetQuantity * targetUnitCost
        let currentCost = -1n
        if (current !== undefined) {
          const cost = this.database.prepare(`
            SELECT COALESCE(SUM(CAST(open_quantity AS INTEGER) * CAST(unit_cost_minor_units AS INTEGER)), 0) AS total_cost
            FROM holding_lots WHERE portfolio_id = ? AND holding_id = ?
          `).get(input.portfolioId, current.holding_id) as { total_cost: number | string }
          currentCost = BigInt(cost.total_cost)
        }
        if (current !== undefined && BigInt(current.total_quantity) === targetQuantity && currentCost === targetCost) {
          unchangedCount += 1
          continue
        }
        if (current !== undefined && BigInt(current.reserved_quantity) !== 0n) throw new Error('BROKER_RECONCILIATION_RESERVED_QUANTITY')
        const holdingId = current?.holding_id ?? `holding:${randomUUID()}`
        if (current === undefined) {
          this.database.prepare(`
            INSERT INTO holdings (
              holding_id, portfolio_id, instrument_id, total_quantity,
              available_delivery_quantity, reserved_quantity, state_version, margin_funded
            ) VALUES (?, ?, ?, ?, ?, '0', ?, 0)
          `).run(holdingId, input.portfolioId, brokerHolding.instrumentId, brokerHolding.quantity, brokerHolding.quantity, nextStateVersion)
          addedCount += 1
        } else {
          this.database.prepare('DELETE FROM holding_lots WHERE portfolio_id = ? AND holding_id = ?').run(input.portfolioId, holdingId)
          this.database.prepare(`
            UPDATE holdings SET total_quantity = ?, available_delivery_quantity = ?, state_version = ?
            WHERE portfolio_id = ? AND holding_id = ?
          `).run(brokerHolding.quantity, brokerHolding.quantity, nextStateVersion, input.portfolioId, holdingId)
          updatedCount += 1
        }
        this.database.prepare(`
          INSERT INTO holding_lots (
            lot_id, holding_id, portfolio_id, instrument_id, acquired_on,
            original_quantity, open_quantity, unit_cost_minor_units, source_kind, source_reference_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IMPORT', ?)
        `).run(
          `lot:${randomUUID()}`, holdingId, input.portfolioId, brokerHolding.instrumentId,
          brokerHolding.acquiredOn ?? input.fallbackAcquiredOn,
          brokerHolding.quantity, brokerHolding.quantity, brokerHolding.unitCostMinorUnits,
          `sharekhan-reconciliation:${input.reconciliationId}`,
        )
      }

      this.database.prepare(`
        UPDATE portfolios SET cash_minor_units = ?, state_version = ?, updated_at = ?
        WHERE portfolio_id = ?
      `).run(input.availableCashMinorUnits, nextStateVersion, input.appliedAt, input.portfolioId)
      this.database.prepare(`
        INSERT INTO portfolio_broker_reconciliations (
          reconciliation_id, portfolio_id, broker, broker_as_of,
          portfolio_state_version_before, portfolio_state_version_after,
          cash_minor_units_before, cash_minor_units_after,
          added_count, updated_count, removed_count, unchanged_count,
          fallback_acquired_on, canonical_payload, applied_at, applied_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.reconciliationId, input.portfolioId, input.broker, input.brokerAsOf,
        portfolio.state_version, nextStateVersion, portfolio.cash_minor_units, input.availableCashMinorUnits,
        addedCount, updatedCount, removedCount, unchangedCount, input.fallbackAcquiredOn,
        JSON.stringify({ holdings:input.holdings }), input.appliedAt, input.appliedBy,
      )
      this.database.exec('COMMIT')
      return Object.freeze({
        reconciliationId: input.reconciliationId,
        portfolioId: input.portfolioId,
        broker: input.broker,
        brokerAsOf: input.brokerAsOf,
        portfolioStateVersion: nextStateVersion,
        cashMinorUnits: input.availableCashMinorUnits,
        addedCount, updatedCount, removedCount, unchangedCount,
        appliedAt: input.appliedAt,
      })
    } catch {
      if (this.database.inTransaction) this.database.exec('ROLLBACK')
      return undefined
    }
  }

  listSecurityAlerts(limit: number): readonly unknown[] {
    this.assertAvailable()
    return Object.freeze(this.database.prepare(`
      SELECT alert_id, category, detail_code, created_at
      FROM portfolio_security_alerts ORDER BY created_at DESC, alert_id DESC LIMIT ?
    `).all(limit).map((row) => Object.freeze({ ...(row as Record<string, unknown>) })))
  }
}
