import {
  MEDIUM_HORIZON_PRESET,
  createMoney,
  createQuantity,
  success,
  type CalendarSessionId,
  type CostScheduleVersionId,
  type DataVersionId,
  type DomainResult,
  type Holding,
  type HoldingLot,
  type HoldingLotId,
  type InstrumentId,
  type IntegrityHash,
  type LocalDate,
  type PlanHistoryFact,
  type PlanHistoryPort,
  type PlanningAssemblyRequest,
  type PlanningSnapshot,
  type PlanningSnapshotPort,
  type PolicyAndTurnoverPort,
  type PolicyAndTurnoverResolution,
  type PortfolioId,
  type PortfolioSnapshot,
  type RebalanceRunId,
  type StrategyConfig,
  type StrategyVersionId,
  type TaxRuleVersionId,
  type TurnoverSnapshotId,
} from '../../../../server/portfolio/index.ts'

export const FIXTURE_IDS = Object.freeze({
  portfolioId: 'PORTFOLIO-U04-001' as PortfolioId,
  rebalanceRunId: 'REBALANCE-U04-001' as RebalanceRunId,
  strategyVersionId: 'STRATEGY-VERSION-U04-001' as StrategyVersionId,
  dataVersionId: 'DATA-VERSION-U04-001' as DataVersionId,
  costScheduleVersionId: 'COST-SCHEDULE-U04-001' as CostScheduleVersionId,
  taxRuleVersionId: 'TAX-RULE-U04-001' as TaxRuleVersionId,
  turnoverSnapshotId: 'TURNOVER-U04-001' as TurnoverSnapshotId,
  calendarSessionId: 'NSE-2026-07-31' as CalendarSessionId,
  inputHash: 'a'.repeat(64) as IntegrityHash,
  planHash: 'b'.repeat(64) as IntegrityHash,
})

export function exactMoney(minorUnits: bigint) {
  const result = createMoney(minorUnits)
  if (!result.ok) throw new TypeError('Invalid fixture money')
  return result.value
}

export function exactQuantity(shares: bigint) {
  const result = createQuantity(shares)
  if (!result.ok) throw new TypeError('Invalid fixture quantity')
  return result.value
}

function holdingLot(
  instrumentId: InstrumentId,
  shares: bigint,
  unitCostMinorUnits: bigint,
  acquiredOn: LocalDate,
): HoldingLot {
  return Object.freeze({
    lotId: `LOT-${instrumentId}` as HoldingLotId,
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId,
    acquiredOn,
    originalQuantity: exactQuantity(shares),
    openQuantity: exactQuantity(shares),
    unitCost: exactMoney(unitCostMinorUnits),
    sourceReference: Object.freeze({ kind: 'IMPORT', referenceId: `IMPORT-${instrumentId}` }),
  })
}

function holding(
  instrumentId: InstrumentId,
  shares: bigint,
  availableShares = shares,
): Holding {
  const lot = holdingLot(
    instrumentId,
    shares,
    8_000n,
    '2025-01-15' as LocalDate,
  )
  return Object.freeze({
    holdingId: `HOLDING-${instrumentId}` as Holding['holdingId'],
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId,
    totalQuantity: exactQuantity(shares),
    availableDeliveryQuantity: exactQuantity(availableShares),
    reservedQuantity: exactQuantity(0n),
    lots: Object.freeze([lot]),
    stateVersion: 1 as unknown as Holding['stateVersion'],
    marginFunded: false,
  })
}

export const INSTRUMENT_A = 'INSTRUMENT-U04-A' as InstrumentId
export const INSTRUMENT_B = 'INSTRUMENT-U04-B' as InstrumentId
export const INSTRUMENT_C = 'INSTRUMENT-U04-C' as InstrumentId

export function makeStrategyConfig(): StrategyConfig {
  return Object.freeze({
    ...MEDIUM_HORIZON_PRESET.config,
    eligibility: Object.freeze({
      ...MEDIUM_HORIZON_PRESET.config.eligibility,
      entryRank: 10,
      holdRank: 15,
      forcedReviewRank: 20,
      maxStockWeightPct: 50,
      noTradeBandPctPoints: 0.5,
      noTradeBandFractionOfTarget: 0.2,
    }),
    construction: Object.freeze({
      targetHoldings: 2,
      maxHoldings: 3,
      replacementScoreGapPct: 5,
      cashBufferPct: 10,
    }),
    rebalance: Object.freeze({
      ...MEDIUM_HORIZON_PRESET.config.rebalance,
      routineFrequency: 'MONTHLY',
      driftReviewFrequency: 'MONTHLY',
      preferredMinHoldDays: 30,
    }),
  })
}

export function makePortfolioSnapshot(
  overrides: Partial<PortfolioSnapshot> = {},
): PortfolioSnapshot {
  const firstHolding = holding(INSTRUMENT_A, 20n)
  return Object.freeze({
    portfolioId: FIXTURE_IDS.portfolioId,
    name: Object.freeze({
      display: 'U04 Fixture Portfolio',
      uniquenessKey: 'u04 fixture portfolio',
    }) as unknown as PortfolioSnapshot['name'],
    baseCurrency: 'INR',
    createdAt: '2026-01-01T00:00:00.000Z' as PortfolioSnapshot['createdAt'],
    status: 'ACTIVE',
    mode: 'PAPER',
    cash: exactMoney(800_000n),
    allocationPolicy: Object.freeze({
      kind: 'SINGLE',
      assignmentId: 'ASSIGNMENT-U04-001',
      strategyVersionId: FIXTURE_IDS.strategyVersionId,
      weight: Object.freeze({ partsPerMillion: 1_000_000n }),
      effectiveAt: '2026-01-01T00:00:00.000Z',
      evidenceReference: Object.freeze({
        evidenceId: 'EVIDENCE-U04-001',
        source: 'USER',
      }),
    }) as unknown as PortfolioSnapshot['allocationPolicy'],
    holdings: Object.freeze([firstHolding]),
    stateVersion: 1 as unknown as PortfolioSnapshot['stateVersion'],
    ...overrides,
  })
}

function evaluation(
  instrumentId: InstrumentId,
  rank: number,
  current = false,
): PlanningSnapshot['evaluations'][number] {
  return Object.freeze({
    eligibility: Object.freeze({
      instrumentId,
      strategyVersionId: FIXTURE_IDS.strategyVersionId,
      dataVersionId: FIXTURE_IDS.dataVersionId,
      asOf: '2026-07-31',
      status: current ? 'HOLD_ELIGIBLE' : 'ELIGIBLE',
      ruleResults: Object.freeze([]),
      isBfsi: false,
      hardRiskFlag: false,
      fundamentalHealthExclude: false,
      evaluatedAt: '2026-07-31T12:00:00.000Z',
    }),
    signal: Object.freeze({
      instrumentId,
      strategyVersionId: FIXTURE_IDS.strategyVersionId,
      dataVersionId: FIXTURE_IDS.dataVersionId,
      asOf: '2026-07-31',
      isBfsi: false,
      momentumComponents: Object.freeze({
        m3m1: 0.5,
        m6m1: 0.5,
        relativeStrength: 0.5,
        trend: 0.5,
        earningsMomentum: 0.5,
        liquidity: 0.5,
        volatilityAdjusted: 0.5,
      }),
      qualityComponents: Object.freeze({
        returnOnEquity: 0.5,
        returnOnAssets: 0.5,
        earningsStability: 0.5,
        debtCoverage: 0.5,
        cashFlowQuality: 0.5,
        promoterPledge: 0.5,
      }),
      riskComponents: Object.freeze({
        volatility60d: 0.2,
        maxDrawdown: 0.1,
        downsideDeviation: 0.1,
        beta: 1,
        liquidityRisk: 0.1,
      }),
      momentumScore: 0.8,
      qualityScore: 0.7,
      riskScore: 0.6,
      compositeScore: 1 - rank / 100,
      convictionMultiplier: rank === 1 ? 1.1 : 1,
      rank,
      riskFlags: Object.freeze([]),
      degradedAdvisoryContext: false,
      missingComponentsNeutralized: false,
      computedAt: '2026-07-31T12:00:00.000Z',
    }),
    sectorId: rank === 1 ? 'TECH' : 'FINANCIALS',
    groupId: rank === 1 ? 'GROUP-A' : 'GROUP-B',
    marketCapBucket: rank === 1 ? 'LARGE_CAP' : 'MID_CAP',
    priceMinorUnits: 10_000n,
    realizedVolatilityPpm: rank === 1 ? 200_000n : 250_000n,
    liquidityCapacityMinorUnits: 600_000n,
  })
}

export function makePlanningSnapshot(
  overrides: Partial<PlanningSnapshot> = {},
): PlanningSnapshot {
  return Object.freeze({
    portfolio: makePortfolioSnapshot(),
    strategyVersionId: FIXTURE_IDS.strategyVersionId,
    strategyConfigHash: 'c'.repeat(64) as IntegrityHash,
    strategyConfig: makeStrategyConfig(),
    dataVersionId: FIXTURE_IDS.dataVersionId,
    evaluationAsOf: '2026-07-31' as LocalDate,
    evaluations: Object.freeze([
      evaluation(INSTRUMENT_A, 1, true),
      evaluation(INSTRUMENT_B, 2),
    ]),
    regime: Object.freeze({
      category: 'RISK_ON',
      confirmationStatus: 'CONFIRMED',
      confirmationCount: 2,
      indicators: Object.freeze({
        nifty50AboveDMA200: true,
        nifty500AboveDMA200: true,
        breadthAbove200DMA_pct: 60,
        breadthAbove100DMA_pct: 65,
        benchmarkVolatility20D: 15,
        marketDrawdownFrom52W: 0.05,
        creditStressProxy: 0.2,
      }),
      dataVersionId: FIXTURE_IDS.dataVersionId,
      asOf: '2026-07-31',
      isCrisisImmediate: false,
      crisisReason: null,
      equityExposureMinPct: 60,
      equityExposureMaxPct: 90,
      evaluatedAt: '2026-07-31T12:00:00.000Z',
    }),
    corporateActions: Object.freeze([]),
    reconciliationSnapshotId: 'RECONCILIATION-U04-001',
    session: Object.freeze({
      calendarSessionId: FIXTURE_IDS.calendarSessionId,
      sessionDate: '2026-07-31' as LocalDate,
      decisionReadyAt: '2026-07-31T12:00:00.000Z' as PlanningSnapshot['session']['decisionReadyAt'],
      eligibleExecutionDate: '2026-08-03' as LocalDate,
      eligibleExecutionWindowStart: '09:45',
      eligibleExecutionWindowEnd: '11:30',
      timeZone: 'Asia/Kolkata',
      finalized: true,
      sameSessionExecutionAllowed: false,
    }),
    ...overrides,
  })
}

export function makePolicyResolution(
  overrides: Partial<PolicyAndTurnoverResolution> = {},
): PolicyAndTurnoverResolution {
  const chargeCodes = [
    'BROKERAGE',
    'STT',
    'EXCHANGE',
    'GST',
    'SEBI',
    'STAMP_DUTY',
    'DP',
    'BROKER_FEE',
  ] as const
  return Object.freeze({
    costSchedule: Object.freeze({
      scheduleVersionId: FIXTURE_IDS.costScheduleVersionId,
      effectiveFrom: '2026-01-01' as LocalDate,
      chargeRules: Object.freeze(chargeCodes.map((chargeCode) => Object.freeze({
        chargeCode,
        appliesToSide: 'BOTH' as const,
        ratePpm: 100n,
        fixedMinorUnits: 0n,
      }))),
      spreadRatePpm: 100n,
      slippageRatePpm: 100n,
      impactRatePpm: 100n,
      integrityHash: 'd'.repeat(64) as IntegrityHash,
    }),
    taxRuleSet: Object.freeze({
      taxRuleVersionId: FIXTURE_IDS.taxRuleVersionId,
      effectiveFrom: '2026-01-01' as LocalDate,
      holdingPeriodThresholdDays: 365,
      shortTermRatePpm: 150_000n,
      longTermRatePpm: 100_000n,
      lotSelectionPolicy: 'FIFO',
      integrityHash: 'e'.repeat(64) as IntegrityHash,
    }),
    turnover: Object.freeze({
      turnoverSnapshotId: FIXTURE_IDS.turnoverSnapshotId,
      portfolioId: FIXTURE_IDS.portfolioId,
      asOf: '2026-07-31' as LocalDate,
      windows: Object.freeze([
        Object.freeze({
          windowKind: 'CALENDAR_MONTH',
          budgetLimitPpm: 1_000_000n,
          consumedBeforePlanPpm: 0n,
        }),
      ]),
      integrityHash: 'f'.repeat(64) as IntegrityHash,
    }),
    ...overrides,
  })
}

export function makeAssemblyRequest(
  overrides: Partial<PlanningAssemblyRequest> = {},
): PlanningAssemblyRequest {
  return Object.freeze({
    portfolioId: FIXTURE_IDS.portfolioId,
    rebalanceRunId: FIXTURE_IDS.rebalanceRunId,
    planningIntent: 'ROUTINE',
    asOf: '2026-07-31' as LocalDate,
    createdAt: '2026-07-31T12:30:00.000Z' as PlanningAssemblyRequest['createdAt'],
    dependencyTimeoutMs: 250,
    constraintPolicy: Object.freeze({
      maxSectorWeightPpm: 1_000_000n,
      maxGroupWeightPpm: 1_000_000n,
      maxSmallCapWeightPpm: 1_000_000n,
      maxLiquidityParticipationPpm: 1_000_000n,
      minimumOrderMinorUnits: 1_000n,
      nextRoutineDecisionDate: '2026-07-31' as LocalDate,
      nextDriftReviewDate: '2026-07-31' as LocalDate,
    }),
    ...overrides,
  })
}

export function makeFakePorts(input: Readonly<{
  snapshot?: PlanningSnapshot
  policy?: PolicyAndTurnoverResolution
  equivalentPriorPlan?: PlanHistoryFact
  currentApprovalReadyPlan?: PlanHistoryFact
}> = {}): Readonly<{
  snapshotPort: PlanningSnapshotPort
  policyPort: PolicyAndTurnoverPort
  historyPort: PlanHistoryPort
}> {
  const snapshot = input.snapshot ?? makePlanningSnapshot()
  const policy = input.policy ?? makePolicyResolution()
  return Object.freeze({
    snapshotPort: Object.freeze({
      loadPlanningSnapshot: async (): Promise<DomainResult<PlanningSnapshot>> =>
        success(snapshot),
    }),
    policyPort: Object.freeze({
      resolveForDate: async (): Promise<DomainResult<PolicyAndTurnoverResolution>> =>
        success(policy),
    }),
    historyPort: Object.freeze({
      findByInputHash: async (): Promise<DomainResult<PlanHistoryFact | undefined>> =>
        success(input.equivalentPriorPlan),
      findCurrentApprovalReady: async (): Promise<DomainResult<PlanHistoryFact | undefined>> =>
        success(input.currentApprovalReadyPlan),
    }),
  })
}

export const MANDATORY_EDGE_SCENARIOS = Object.freeze([
  'MONTHLY_INSIDE_NO_TRADE_BAND',
  'AFTER_DRAG_REPLACEMENT_SKIPPED',
  'MISSING_GROUP_CLASSIFICATION_BLOCKED',
  'REGIME_REDUCTION_SELL_ONLY',
  'HARD_RISK_EXIT_WITH_DELIVERY_LIMIT',
  'UNSAFE_OPTIMIZER_FALLBACK',
  'EQUIVALENT_PLAN_REPLAY',
  'PLAN_EXPIRY',
] as const)

export const AD_C_OBSERVABILITY_EXAMPLES = Object.freeze([
  'SHARED_CANONICAL_HASH',
  'ALLOWLISTED_EXPLANATION',
  'EXPLICIT_TIMEOUT_INPUT',
  'GREEDY_AUTHORITATIVE_FALLBACK',
] as const)
