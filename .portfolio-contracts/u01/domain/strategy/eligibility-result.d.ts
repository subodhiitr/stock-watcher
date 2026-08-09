import { type DomainResult } from '../errors/result.ts';
import type { DataVersionId, InstrumentId, StrategyVersionId } from '../shared/identifiers.ts';
import type { DataProvider } from '../market-data/data-provenance.ts';
export type EligibilityRuleId = 'LISTING_HISTORY' | 'PRICE_AVAILABILITY' | 'MIN_PRICE' | 'TRADED_VALUE' | 'CORPORATE_ACTION_STATUS' | 'TRADING_STATUS' | 'SURVEILLANCE_STATUS' | 'PRICE_ADJUSTMENT_VALIDITY' | 'FUNDAMENTAL_FRESHNESS' | 'BROKER_MAPPING' | 'DATA_ANOMALY' | 'FUNDAMENTAL_HEALTH';
export type EligibilityRuleResult = Readonly<{
    ruleId: EligibilityRuleId;
    passed: boolean;
    actual?: number;
    threshold?: number;
    reasonCode: string;
}>;
export type EligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'HOLD_ELIGIBLE' | 'FORCED_REVIEW';
export type EligibilityResult = Readonly<{
    instrumentId: InstrumentId;
    strategyVersionId: StrategyVersionId;
    dataVersionId: DataVersionId;
    asOf: string;
    status: EligibilityStatus;
    ruleResults: readonly EligibilityRuleResult[];
    isBfsi: boolean;
    hardRiskFlag: boolean;
    fundamentalHealthExclude: boolean;
    evaluatedAt: string;
}>;
export declare function createEligibilityResult(params: {
    instrumentId: InstrumentId;
    strategyVersionId: StrategyVersionId;
    dataVersionId: DataVersionId;
    asOf: string;
    ruleResults: readonly EligibilityRuleResult[];
    isBfsi: boolean;
    evaluatedAt: string;
}): DomainResult<EligibilityResult>;
export type RiskFlagSource = Extract<DataProvider, 'LICENSED_EOD' | 'BROKER_API' | 'EXCHANGE_FILING'>;
export type RiskFlag = Readonly<{
    flagType: 'HARD_RISK_FLAG' | 'FUNDAMENTAL_HEALTH_EXCLUDE';
    source: RiskFlagSource;
    reason: string;
}>;
export declare function createRiskFlag(flagType: 'HARD_RISK_FLAG' | 'FUNDAMENTAL_HEALTH_EXCLUDE', source: DataProvider, reason: string): DomainResult<RiskFlag>;
