import * as fc from "fast-check"
import type { DataVersionId, InstrumentId, StrategyVersionId } from "../../../../server/portfolio/domain/shared/identifiers.ts"

export const arbInstrumentId = fc.string({ minLength: 3, maxLength: 10 }).map(s => s.toUpperCase() as InstrumentId)
export const arbStrategyVersionId = fc.string({ minLength: 3, maxLength: 10 }).map(s => `sv-${s}` as StrategyVersionId)
export const arbDataVersionId = fc.string({ minLength: 3, maxLength: 10 }).map(s => `dv-${s}` as DataVersionId)

export const arbDataProvider = fc.constantFrom(
  "NSE_OFFICIAL",
  "YAHOO_RESEARCH",
  "LICENSED_EOD",
  "BROKER_API",
  "EXCHANGE_FILING",
) as fc.Arbitrary<"NSE_OFFICIAL" | "YAHOO_RESEARCH" | "LICENSED_EOD" | "BROKER_API" | "EXCHANGE_FILING">

export const arbProductionDataProvider = fc.constantFrom(
  "LICENSED_EOD",
  "BROKER_API",
  "EXCHANGE_FILING",
) as fc.Arbitrary<"LICENSED_EOD" | "BROKER_API" | "EXCHANGE_FILING">

export const arbDataValidationStatus = fc.constantFrom(
  "VALID",
  "STALE",
  "INCOMPLETE",
  "ANOMALY_DETECTED",
  "FAILED_VALIDATION",
) as fc.Arbitrary<"VALID" | "STALE" | "INCOMPLETE" | "ANOMALY_DETECTED" | "FAILED_VALIDATION">

export const arbMarketDataType = fc.constantFrom(
  "EOD_PRICE",
  "FUNDAMENTALS",
  "INDEX_MEMBERSHIP",
  "INSTRUMENT_DETAILS",
  "EXCHANGE_CALENDAR",
  "LIVE_QUOTE",
  "CORPORATE_ACTION_SCHEDULE",
) as fc.Arbitrary<"EOD_PRICE" | "FUNDAMENTALS" | "INDEX_MEMBERSHIP" | "INSTRUMENT_DETAILS" | "EXCHANGE_CALENDAR" | "LIVE_QUOTE" | "CORPORATE_ACTION_SCHEDULE">

export const arbEligibilityRuleId = fc.constantFrom(
  "LISTING_HISTORY",
  "PRICE_AVAILABILITY",
  "MIN_PRICE",
  "TRADED_VALUE",
  "CORPORATE_ACTION_STATUS",
  "TRADING_STATUS",
  "SURVEILLANCE_STATUS",
  "PRICE_ADJUSTMENT_VALIDITY",
  "FUNDAMENTAL_FRESHNESS",
  "BROKER_MAPPING",
  "DATA_ANOMALY",
  "FUNDAMENTAL_HEALTH",
) as fc.Arbitrary<string>

export const arbEligibilityStatus = fc.constantFrom(
  "ELIGIBLE",
  "INELIGIBLE",
  "HOLD_ELIGIBLE",
  "FORCED_REVIEW",
) as fc.Arbitrary<"ELIGIBLE" | "INELIGIBLE" | "HOLD_ELIGIBLE" | "FORCED_REVIEW">

export const arbRegimeCategory = fc.constantFrom(
  "RISK_ON",
  "CAUTION",
  "RISK_OFF",
  "CRISIS",
) as fc.Arbitrary<"RISK_ON" | "CAUTION" | "RISK_OFF" | "CRISIS">

export const arbStrategyVersionStatus = fc.constantFrom(
  "DRAFT",
  "ACTIVATION_PENDING",
  "ACTIVE",
  "SUPERSEDED",
  "WITHDRAWN",
) as fc.Arbitrary<"DRAFT" | "ACTIVATION_PENDING" | "ACTIVE" | "SUPERSEDED" | "WITHDRAWN">

export const arbEvidenceType = fc.constantFrom(
  "BACKTEST",
  "WALK_FORWARD",
  "OUT_OF_SAMPLE",
  "SHADOW_OPERATION",
) as fc.Arbitrary<"BACKTEST" | "WALK_FORWARD" | "OUT_OF_SAMPLE" | "SHADOW_OPERATION">

export const arbCorporateActionType = fc.constantFrom(
  "SPLIT",
  "BONUS",
  "CASH_DIVIDEND",
  "RIGHTS",
  "MERGER",
  "DEMERGER",
  "SYMBOL_CHANGE",
  "DELISTING",
  "BUYBACK_TENDER",
  "ETF_UNIT_CHANGE",
) as fc.Arbitrary<string>

export const arbCorporateActionSource = fc.constantFrom(
  "EXCHANGE_FILING",
  "LICENSED_PROVIDER",
) as fc.Arbitrary<"EXCHANGE_FILING" | "LICENSED_PROVIDER">

export const arbBacktestStatus = fc.constantFrom(
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
) as fc.Arbitrary<"PENDING" | "RUNNING" | "COMPLETED" | "FAILED">

export const arbMomentumComponents = fc.record({
  m3m1: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  m6m1: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  relativeStrength: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  trend: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  earningsMomentum: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  liquidity: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  volatilityAdjusted: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
})

export const arbQualityComponents = fc.record({
  returnOnEquity: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  returnOnAssets: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  earningsStability: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  debtCoverage: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  cashFlowQuality: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
  promoterPledge: fc.float({ min: Math.fround(-3), max: Math.fround(3), noNaN: true }),
})

export const arbRiskComponents = fc.record({
  volatility60d: fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
  maxDrawdown: fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
  downsideDeviation: fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
  beta: fc.float({ min: Math.fround(-2), max: Math.fround(3), noNaN: true }),
  liquidityRisk: fc.float({ min: Math.fround(0), max: Math.fround(100), noNaN: true }),
})

export const arbAiPermittedOperation = fc.constantFrom(
  "SUMMARIZE",
  "CLASSIFY",
  "EXTRACT",
  "COMPARE",
  "EXPLAIN",
  "PRIORITIZE_REVIEW",
) as fc.Arbitrary<string>
