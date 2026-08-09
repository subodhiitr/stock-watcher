import { type DomainResult } from '../errors/result.ts';
declare const configHashBrand: unique symbol;
export type StrategyConfigHash = string & {
    readonly [configHashBrand]: 'StrategyConfigHash';
};
export type StrategyHorizon = 'SHORT' | 'MEDIUM' | 'LONG';
export type RoutineFrequency = 'DAILY' | 'BIWEEKLY' | 'MONTHLY' | 'QUARTERLY';
export type DefaultOrderType = 'MARKET' | 'LIMIT';
export type StrategyMode = 'PAPER' | 'OBSERVE' | 'LIVE';
export type UniversePolicy = Readonly<{
    indexUniverse: string;
    minListingHistoryDays: number;
    minPricePaise: number;
    minMedian20dTradedValueLakh: number;
}>;
export type EligibilityPolicy = Readonly<{
    entryRank: number;
    holdRank: number;
    forcedReviewRank: number;
    minStockWeightPct: number;
    maxStockWeightPct: number;
    noTradeBandPctPoints: number;
    noTradeBandFractionOfTarget: number;
}>;
export type MomentumWeights = Readonly<{
    m3m1: number;
    m6m1: number;
    relativeStrength: number;
    trend: number;
    earningsMomentum: number;
    liquidity: number;
    volatilityAdjusted: number;
}>;
export type QualityWeights = Readonly<{
    returnOnEquity: number;
    returnOnAssets: number;
    earningsStability: number;
    debtCoverage: number;
    cashFlowQuality: number;
    promoterPledge: number;
}>;
export type RiskWeights = Readonly<{
    volatility60d: number;
    maxDrawdown: number;
    downsideDeviation: number;
    beta: number;
    liquidityRisk: number;
}>;
export type FactorPolicy = Readonly<{
    momentumWeight: number;
    qualityWeight: number;
    lowRiskWeight: number;
    momentumWeights: MomentumWeights;
    qualityWeights: QualityWeights;
    riskWeights: RiskWeights;
    bfsiQualityWeights?: Readonly<{
        npaRatio: number;
        capitalAdequacy: number;
        netInterestMargin: number;
        returnOnAssets: number;
        lcrRatio: number;
        promoterPledge: number;
    }>;
    sectorNeutral: boolean;
}>;
export type ConstructionPolicy = Readonly<{
    targetHoldings: number;
    maxHoldings: number;
    replacementScoreGapPct: number;
    cashBufferPct: number;
}>;
export type RegimePolicy = Readonly<{
    confirmationPeriodsWeakening: number;
    confirmationPeriodsStrengthening: number;
    crisisDrawdownPct: number;
    highVolatilityThreshold: number;
}>;
export type RebalancePolicy = Readonly<{
    routineFrequency: RoutineFrequency;
    driftReviewFrequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    preferredMinHoldDays: number;
    maxDailyTurnoverPct: number;
    periodTurnoverBudget: Readonly<{
        rollingDays: number;
        limitPct: number;
        calendarMonthLimitPct?: number;
        quarterLimitPct?: number;
        yearLimitPct?: number;
    }>;
}>;
export type ExecutionPolicy = Readonly<{
    product: 'CNC';
    defaultOrderType: DefaultOrderType;
    startTime: string;
    endTime: string;
    timezone: 'Asia/Kolkata';
}>;
export type RiskPolicy = Readonly<{
    drawdownWarningPct: number;
    drawdownRiskReductionPct: number;
    drawdownKillSwitchPct: number;
}>;
export type TaxPolicy = Readonly<{
    ltcgRatePct: number;
    stcgRatePct: number;
    sttBuyPct: number;
    sttSellPct: number;
    gstPct: number;
}>;
export type AutomationPolicy = Readonly<{
    allowedMode: StrategyMode;
}>;
export type StrategyConfig = Readonly<{
    benchmark: string;
    horizon: StrategyHorizon;
    universe: UniversePolicy;
    eligibility: EligibilityPolicy;
    factor: FactorPolicy;
    construction: ConstructionPolicy;
    regime: RegimePolicy;
    rebalance: RebalancePolicy;
    execution: ExecutionPolicy;
    risk: RiskPolicy;
    tax: TaxPolicy;
    automation: AutomationPolicy;
}>;
export declare function computeConfigHash(config: StrategyConfig): StrategyConfigHash;
export declare function createStrategyConfig(raw: unknown): DomainResult<{
    config: StrategyConfig;
    hash: StrategyConfigHash;
}>;
export declare function strategyConfigsEqual(a: StrategyConfig, b: StrategyConfig): boolean;
export declare function parseVersionString(value: unknown): DomainResult<string>;
export {};
