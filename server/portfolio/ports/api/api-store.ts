import type { PortfolioApiResponse } from '../../api/api-contracts.ts'

export type PrincipalRole = 'INVESTOR' | 'OPERATOR' | 'ADMIN'
export type PortfolioAccessRole = 'VIEWER' | 'EDITOR' | 'OWNER'

export type PrincipalRecord = Readonly<{
  principalId: string
  usernameKey: string
  displayName: string
  passwordSalt: string
  passwordHash: string
  globalRole: PrincipalRole
  mfaSecret?: string
  disabled: boolean
}>

export type SessionRecord = Readonly<{
  sessionHash: string
  principalId: string
  actorId: string
  csrfHash: string
  expiresAtEpochMs: number
  mfaVerified: boolean
  invalidated: boolean
}>

export type PortfolioListItem = Readonly<{
  portfolioId: string
  displayName: string
  status: string
  mode: string
  cashMinorUnits: string
  stateVersion: number
  accessRole: PortfolioAccessRole
}>

export type StrategyOption = Readonly<{
  strategyVersionId: string
  displayName: string
  horizon: string
  semanticVersion: string
}>

export type IdempotencyBeginResult =
  | Readonly<{ kind: 'NEW' }>
  | Readonly<{ kind: 'CONFLICT' | 'IN_PROGRESS' }>
  | Readonly<{ kind: 'REPLAY'; response: PortfolioApiResponse }>

export type ResearchRebalancePlanRecord = Readonly<{
  planId: string
  rebalanceRunId: string
  portfolioId: string
  portfolioStateVersion: number
  strategyVersionId: string
  planHash: string
  marketDataSource: 'YAHOO_RESEARCH'
  marketDataAsOf: string
  state: 'PREVIEW_READY' | 'APPROVED_PAPER' | 'SUPERSEDED'
  canonicalPayload: unknown
  createdAt: string
  createdBy: string
}>

export type StrategicRebalanceObservationRecord = Readonly<{
  observationId: string
  portfolioId: string
  planId: string
  policyVersion: 'STRATEGIC_REBALANCE_V1'
  decisionSessionDate: string
  state: 'NORMAL' | 'NEGATIVE_UNCONFIRMED' | 'NEGATIVE_CONFIRMED' | 'DATA_BLOCKED' | 'FORCED_REVIEW'
  riskBenchmark: string
  defensiveBenchmark: string
  signal: Readonly<Record<string, unknown>>
  dataHash: string
  delayedBuyMinorUnits: string
  retainedCashMinorUnits: string
  delayStartedOn: string | null
  createdAt: string
  createdBy: string
}>

export type PerformanceAttributionRecord = Readonly<{
  instrumentId: string
  quantity: string
  marketValueMinorUnits: string
  investedCostMinorUnits: string
  unrealizedPnlMinorUnits: string
  dayPnlMinorUnits: string
  weightPpm: number
  dayContributionPpm: number
}>

export type PerformanceObservationRecord = Readonly<{
  observationId: string
  portfolioId: string
  observedAt: string
  observationDate: string
  portfolioStateVersion: number
  benchmarkSymbol: string
  benchmarkPriceMinorUnits: string
  cashMinorUnits: string
  marketValueMinorUnits: string
  navMinorUnits: string
  investedCostMinorUnits: string
  unrealizedPnlMinorUnits: string
  dayPnlMinorUnits: string
  contributedCapitalMinorUnits: string
  realizedPnlMinorUnits: string
  cumulativeChargesMinorUnits: string
  cumulativeTaxMinorUnits: string
  netPnlMinorUnits: string
  dayReturnPpm: number
  totalReturnPpm: number
  benchmarkDayReturnPpm: number
  benchmarkTotalReturnPpm: number
  wealthIndexPpm: string
  peakWealthIndexPpm: string
  drawdownPpm: number
  annualizedVolatilityPpm: number
  annualizedReturnPpm: number
  quoteCount: number
  totalHoldings: number
  attribution: readonly PerformanceAttributionRecord[]
  marketDataSource: 'YAHOO_RESEARCH'
  createdBy: string
}>

export type PerformanceCapitalFlowRecord = Readonly<{
  occurredAt: string
  amountMinorUnits: string
  kind: 'STARTING_CASH' | 'HOLDING_IMPORT'
}>

export type PerformanceAccountingRecord = Readonly<{
  capitalFlows: readonly PerformanceCapitalFlowRecord[]
  realizedPnlMinorUnits: string
  cumulativeChargesMinorUnits: string
  cumulativeTaxMinorUnits: string
}>

export type ManualPaperExitRecord = Readonly<{
  exitId: string
  portfolioId: string
  holdingId: string
  instrumentId: string
  quantity: string
  executionPriceMinorUnits: string
  grossProceedsMinorUnits: string
  releasedCostBasisMinorUnits: string
  realizedPnlMinorUnits: string
  chargesMinorUnits: string
  taxMinorUnits: string
  netProceedsMinorUnits: string
  portfolioStateVersionBefore: number
  portfolioStateVersionAfter: number
  exitKind: 'FULL' | 'PARTIAL'
  reasonCode: 'USER_REQUESTED' | 'STRATEGY_RISK_EXIT' | 'STRATEGY_RISK_REDUCTION'
  riskSnapshot: Readonly<Record<string, unknown>>
  marketDataSource: 'YAHOO_RESEARCH'
  executedAt: string
  executedBy: string
}>

export type BrokerHoldingSnapshot = Readonly<{
  instrumentId: string
  quantity: string
  unitCostMinorUnits: string
  acquiredOn?: string
}>

export type BrokerPortfolioReconciliationRecord = Readonly<{
  reconciliationId: string
  portfolioId: string
  broker: 'SHAREKHAN'
  brokerAsOf: number
  portfolioStateVersion: number
  cashMinorUnits: string
  addedCount: number
  updatedCount: number
  removedCount: number
  unchangedCount: number
  appliedAt: string
}>

export interface PortfolioApiStore {
  countPrincipals(): number
  createPrincipal(record: PrincipalRecord, createdAtEpochMs: number): boolean
  findPrincipalByUsername(usernameKey: string): PrincipalRecord | undefined
  findPrincipalById(principalId: string): PrincipalRecord | undefined
  setPrincipalMfaSecret(principalId: string, secret: string): boolean
  invalidatePrincipalSessions(principalId: string, nowEpochMs: number): void
  createSession(record: Readonly<{
    sessionHash: string
    principalId: string
    csrfHash: string
    createdAtEpochMs: number
    expiresAtEpochMs: number
    mfaVerified: boolean
  }>): boolean
  findSession(sessionHash: string, nowEpochMs: number): SessionRecord | undefined
  touchSession(sessionHash: string, nowEpochMs: number): void
  invalidateSession(sessionHash: string, nowEpochMs: number): void
  allowRateLimit(input: Readonly<{
    bucketKey: string
    nowEpochMs: number
    windowMs: number
    limit: number
    blockMs: number
    consume?: boolean
  }>): Readonly<{ allowed: boolean; retryAfterMs: number }>
  appendSecurityAlert(input: Readonly<{
    alertId: string
    category: 'AUTH_BRUTE_FORCE' | 'RATE_LIMIT' | 'SESSION_REJECTED'
    subjectHash: string
    detailCode: string
    createdAtEpochMs: number
  }>): void
  grantPortfolioAccess(
    principalId: string,
    portfolioId: string,
    role: PortfolioAccessRole,
    createdAtEpochMs: number,
  ): boolean
  grantAllExistingPortfolios(principalId: string, createdAtEpochMs: number): void
  canAccessPortfolio(principalId: string, portfolioId: string, access: string): boolean
  listPortfolios(principalId: string): readonly PortfolioListItem[]
  listStrategyOptions(): readonly StrategyOption[]
  beginIdempotency(input: Readonly<{
    principalId: string
    idempotencyKey: string
    requestHash: string
    nowEpochMs: number
    expiresAtEpochMs: number
  }>): IdempotencyBeginResult
  completeIdempotency(input: Readonly<{
    principalId: string
    idempotencyKey: string
    requestHash: string
    response: PortfolioApiResponse
  }>): void
  abandonIdempotency(principalId: string, idempotencyKey: string, requestHash: string): void
  readPortfolioView(principalId: string, portfolioId: string): unknown | undefined
  readCurrentResearchRebalancePlan(portfolioId: string): ResearchRebalancePlanRecord | undefined
  readLatestStrategicRebalanceObservation(portfolioId: string): StrategicRebalanceObservationRecord | undefined
  saveResearchRebalancePlan(input: Readonly<{
    plan: ResearchRebalancePlanRecord
    strategicObservation?: StrategicRebalanceObservationRecord
    eventId: string
    supersedeEventId: string
  }>): boolean
  approveResearchRebalancePlan(input: Readonly<{
    portfolioId: string
    planId: string
    actorId: string
    eventId: string
    occurredAt: string
  }>): boolean
  readPerformanceObservations(portfolioId: string): readonly PerformanceObservationRecord[]
  readPerformanceAccounting(portfolioId: string): PerformanceAccountingRecord
  savePerformanceObservation(observation: PerformanceObservationRecord): boolean
  executeManualPaperExit(exit: ManualPaperExitRecord): boolean
  applyBrokerPortfolioReconciliation(input: Readonly<{
    reconciliationId: string
    portfolioId: string
    broker: 'SHAREKHAN'
    brokerAsOf: number
    portfolioStateVersion: number
    availableCashMinorUnits: string
    fallbackAcquiredOn: string
    holdings: readonly BrokerHoldingSnapshot[]
    appliedAt: string
    appliedBy: string
  }>): BrokerPortfolioReconciliationRecord | undefined
  listSecurityAlerts(limit: number): readonly unknown[]
}
