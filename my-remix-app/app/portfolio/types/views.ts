export type SafetyMode =
  | 'OBSERVE'
  | 'PAPER'
  | 'RECOMMENDATION'
  | 'APPROVAL_REQUIRED'
  | 'RESTRICTED_AUTO'
  | 'LIVE'

export type PortfolioListItem = Readonly<{
  portfolioId: string
  displayName: string
  status: 'ACTIVE' | 'ARCHIVED'
  mode: SafetyMode
  cashMinorUnits: string
  stateVersion: number
  accessRole: 'VIEWER' | 'EDITOR' | 'OWNER'
}>

export type StrategyOption = Readonly<{
  strategyVersionId: string
  displayName: string
  horizon: 'SHORT' | 'MEDIUM' | 'LONG'
  semanticVersion: string
}>

export type PortfolioCollection = Readonly<{
  portfolios: readonly PortfolioListItem[]
  strategies: readonly StrategyOption[]
}>

export type ResearchRebalanceAction = Readonly<{
  instrumentId: string
  symbol: string
  action: 'BUY' | 'SELL' | 'REDUCE' | 'HOLD'
  currentQuantity: string
  targetQuantity: string
  deltaQuantity: string
  livePriceMinorUnits: string
  currentValueMinorUnits: string
  targetValueMinorUnits: string
  currentWeightPpm: string
  targetWeightPpm: string
  estimatedChargesMinorUnits: string
  estimatedTaxMinorUnits: string
  realizedPnlMinorUnits?: string
  reasonCode: string
  explanation: string
  strategicTargetQuantity?: string
  strategyRank?: number | null
  strategyScore?: number | null
  momentumScore?: number | null
  qualityScore?: number | null
  valuationScore?: number | null
  earningsScore?: number | null
  sectorScore?: number | null
  catalystScore?: number | null
  lowRiskScore?: number | null
  dataCoveragePct?: number
  catalystScanCoveragePct?: number
  isNewOpportunity?: boolean
  stagedByTurnoverLimit?: boolean
  stagedByNoTradeBand?: boolean
  protectedByMinimumHold?: boolean
  exitRiskLevel?: 'NONE' | 'WATCH' | 'REDUCE' | 'EXIT'
  exitRiskScore?: number
  exitRiskFlags?: readonly Readonly<{ code: string; level: 'WATCH' | 'REDUCE' | 'EXIT'; reason: string; mandatory: boolean }>[]
  exitRiskSummary?: string
  mandatoryExit?: boolean
  preTimingTargetQuantity?: string
  timedTargetQuantity?: string
  strategicTimingClassification?: 'MANDATORY_EXIT' | 'RISK_REDUCING' | 'RISK_INCREASING' | 'NO_CHANGE'
  strategicTimingFraction?: number
  delayedQuantity?: string
  delayedNotionalMinorUnits?: string
  strategicTimingReasonCode?: string
  presentationAction?: 'DELAYED'
}>

export type StrategicRebalanceSnapshotView = Readonly<{
  policyVersion: 'STRATEGIC_REBALANCE_V1'
  state: 'NORMAL' | 'NEGATIVE_UNCONFIRMED' | 'NEGATIVE_CONFIRMED' | 'DATA_BLOCKED' | 'FORCED_REVIEW'
  headline: string
  approvalBlocked: boolean
  blockerCodes: readonly string[]
  decisionSessionDate: string
  riskBenchmark: string
  defensiveBenchmark: string
  horizons: readonly Readonly<{
    months: 1 | 3 | 12
    riskReturn: number
    defensiveReturn: number
    relativeReturn: number
    pointInTimeBaseline: number
    relativeExcess: number
    negative: boolean
    baselineObservations: number
  }>[]
  primaryHorizonMonths: 1 | 3 | 12
  confirmationHorizonMonths?: 1 | 3 | 12
  permittedRebalanceFraction: number
  appliedBuyFraction: number
  delayStartedOn: string | null
  forcedReviewOn: string | null
  delayedBuyMinorUnits: string
  retainedCashMinorUnits: string
  dataHash: string
  calculatedAt: string
  defensiveProxy?: Readonly<{
    symbol: string
    purpose: string
    primaryHistoryStartsOn: string | null
    extendedObservations: number
  }>
}>

export type ResearchCandidateSummary = Readonly<{
  symbol: string
  name: string
  sector: string | null
  rank: number | null
  score: number | null
  momentumScore: number | null
  qualityScore: number | null
  valuationScore: number | null
  earningsScore: number | null
  sectorScore: number | null
  catalystScore: number | null
  lowRiskScore: number | null
  dataCoveragePct: number
  catalystScanCoveragePct?: number
  currentlyHeld: boolean
  selected: boolean
  selectionReason: string
  evidence?: readonly string[]
}>

export type ResearchRebalancePlan = Readonly<{
  planId: string
  rebalanceRunId: string
  portfolioId: string
  portfolioStateVersion: number
  strategyVersionId: string
  strategyConfigHash: string
  planHash: string
  state: 'PREVIEW_READY' | 'APPROVED_PAPER'
  scope: 'STRATEGY_UNIVERSE_RESEARCH' | 'CURRENT_HOLDINGS_QUOTE_FALLBACK'
  marketData: Readonly<{
    source: 'YAHOO_RESEARCH'
    asOf: string
    executionEligible: false
    quoteCount?: number
    indexUniverse?: string
    benchmark?: string
    constituentCount?: number
    analyzedCount?: number
    eligibleCount?: number
    researchModelVersion?: string
    researchModelWeights?: Readonly<Record<string, number>>
    catalystScanCoveragePct?: number
  }>
  constraints: Readonly<Record<string, number | string>>
  summary: Readonly<Record<string, string>>
  actions: readonly ResearchRebalanceAction[]
  topCandidates?: readonly ResearchCandidateSummary[]
  warnings: readonly string[]
  strategicRebalance?: StrategicRebalanceSnapshotView
  createdAt: string
  createdBy: string
}>

export type PortfolioView = Readonly<{
  portfolio: Readonly<{
    portfolio_id: string
    display_name: string
    status: string
    operating_mode: SafetyMode
    cash_minor_units: string
    state_version: number
    created_at: string
    updated_at: string
  }>
  holdings: readonly Readonly<Record<string, string | number>>[]
  lots: readonly Readonly<Record<string, string | number>>[]
  strategy: readonly Readonly<Record<string, unknown>>[]
  portfolioSnapshot: Readonly<{
    stateVersion: number
    holdingsIncluded: number
    lotsIncluded: number
    asOf: string
  }>
  rebalance: Readonly<{
    plans: readonly ResearchRebalancePlan[]
    history?: readonly (ResearchRebalancePlan & Readonly<{ executedAt: string }>)[]
    status: string
    blockers: readonly string[]
  }>
  performance: Readonly<{
    observations: readonly PerformanceObservation[]
    latest?: PerformanceObservation
    attribution: readonly PerformanceAttribution[]
    status: 'NO_OBSERVATIONS' | 'CURRENT' | 'STALE'
    observationCount: number
    trackedSince?: string
  }>
  manualExits?: readonly Readonly<Record<string, string | number>>[]
  execution: readonly Readonly<Record<string, string | number>>[]
  reconciliation: readonly Readonly<Record<string, string | number | null>>[]
  brokerReconciliation?: readonly Readonly<Record<string, string | number | null>>[]
}>

export type PerformanceAttribution = Readonly<{
  instrumentId: string
  quantity: string
  marketValueMinorUnits: string
  investedCostMinorUnits: string
  unrealizedPnlMinorUnits: string
  dayPnlMinorUnits: string
  weightPpm: number
  dayContributionPpm: number
}>

export type PerformanceObservation = Readonly<{
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
  attribution: readonly PerformanceAttribution[]
  marketDataSource: 'YAHOO_RESEARCH'
  createdBy: string
}>

export type ManualPaperExit = Readonly<{
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

export type PortfolioSession = Readonly<{
  authenticated: true
  displayName: string
  role: 'INVESTOR' | 'OPERATOR' | 'ADMIN'
  mfaConfigured: boolean
  mfaVerified: boolean
  expiresAtEpochMs: number
}>

export type WorkspaceView = 'overview' | 'holdings' | 'strategy' | 'rebalance' | 'execution' | 'performance' | 'operations'
