/**
 * U03 Portfolio Strategy Benchmark
 * Measures performance of key U03 domain operations.
 * Run with: npm run bench:portfolio:u03
 */
import { performance } from "node:perf_hooks"
import { createStrategyConfig } from "../server/portfolio/domain/strategy/strategy-config.ts"
import { createSignalSnapshot } from "../server/portfolio/domain/strategy/signal-snapshot.ts"
import { createRegimeState, type RegimeIndicators } from "../server/portfolio/domain/strategy/regime-state.ts"
import { createEligibilityResult, type EligibilityRuleResult } from "../server/portfolio/domain/strategy/eligibility-result.ts"
import { SHORT_HORIZON_PRESET, MEDIUM_HORIZON_PRESET } from "../server/portfolio/domain/strategy/strategy-presets.ts"
import { strategyConfigsEqual } from "../server/portfolio/domain/strategy/strategy-config.ts"
import type { DataVersionId, InstrumentId, StrategyVersionId } from "../server/portfolio/domain/shared/identifiers.ts"
import type { EligibilityRuleId } from "../server/portfolio/domain/strategy/eligibility-result.ts"

const RUNS = 10_000

function bench(name: string, fn: () => void): void {
  const start = performance.now()
  for (let i = 0; i < RUNS; i++) fn()
  const elapsed = performance.now() - start
  const opsPerSec = Math.round(RUNS / (elapsed / 1000))
  console.log(`${name.padEnd(55)} ${opsPerSec.toLocaleString()} ops/sec  (${elapsed.toFixed(1)}ms / ${RUNS} runs)`)
}

const VALID_RAW = {
  benchmark: "NIFTY50",
  routineFrequency: "MONTHLY",
  universe: { indexUniverse: "NIFTY500", minListingHistoryDays: 252, minPricePaise: 1000, minMedian20dTradedValueLakh: 100 },
  eligibility: { entryRank: 50, holdRank: 65, forcedReviewRank: 80, minStockWeightPct: 1.0, maxStockWeightPct: 10.0, noTradeBandPctPoints: 0.50, noTradeBandFractionOfTarget: 0.20 },
  factor: {
    momentumWeight: 0.55, qualityWeight: 0.30, lowRiskWeight: 0.15,
    momentumWeights: { m3m1: 0.15, m6m1: 0.20, relativeStrength: 0.15, trend: 0.15, earningsMomentum: 0.20, liquidity: 0.10, volatilityAdjusted: 0.05 },
    qualityWeights: { returnOnEquity: 0.25, returnOnAssets: 0.20, earningsStability: 0.20, debtCoverage: 0.15, cashFlowQuality: 0.10, promoterPledge: 0.10 },
    riskWeights: { volatility60d: 0.30, maxDrawdown: 0.25, downsideDeviation: 0.20, beta: 0.15, liquidityRisk: 0.10 },
    sectorNeutral: false,
  },
  construction: { targetHoldings: 25, maxHoldings: 30, replacementScoreGapPct: 10, cashBufferPct: 2.0 },
  regime: { confirmationPeriodsWeakening: 2, confirmationPeriodsStrengthening: 5, crisisDrawdownPct: 15.0, highVolatilityThreshold: 25.0 },
  rebalance: { routineFrequency: "MONTHLY", driftReviewFrequency: "MONTHLY", preferredMinHoldDays: 60, maxDailyTurnoverPct: 10.0, periodTurnoverBudget: { rollingDays: 30, limitPct: 25.0 } },
  execution: { product: "CNC", defaultOrderType: "MARKET", startTime: "09:45", endTime: "11:30", timezone: "Asia/Kolkata" },
  risk: { drawdownWarningPct: 10.0, drawdownRiskReductionPct: 15.0, drawdownKillSwitchPct: 20.0 },
  tax: { ltcgRatePct: 10.0, stcgRatePct: 15.0, sttBuyPct: 0.1, sttSellPct: 0.1, gstPct: 18.0 },
  automation: { allowedMode: "PAPER" },
}

const configResult = createStrategyConfig(VALID_RAW)
if (!configResult.ok) throw new Error("Benchmark setup failed: config creation")
const { config: benchConfig, hash: benchHash } = configResult.value

const MOM_COMPS = Object.freeze({ m3m1: 0.5, m6m1: 0.6, relativeStrength: 0.7, trend: 0.8, earningsMomentum: 0.4, liquidity: 0.3, volatilityAdjusted: 0.2 })
const QUAL_COMPS = Object.freeze({ returnOnEquity: 0.6, returnOnAssets: 0.5, earningsStability: 0.7, debtCoverage: 0.8, cashFlowQuality: 0.6, promoterPledge: 0.4 })
const RISK_COMPS = Object.freeze({ volatility60d: 0.3, maxDrawdown: 0.4, downsideDeviation: 0.35, beta: 0.5, liquidityRisk: 0.2 })

const REGIME_INDICATORS: RegimeIndicators = Object.freeze({
  nifty50AboveDMA200: true, nifty500AboveDMA200: true,
  breadthAbove200DMA_pct: 60, breadthAbove100DMA_pct: 65,
  benchmarkVolatility20D: 15, marketDrawdownFrom52W: 0.03,
  creditStressProxy: 0.5,
})

const ALL_PASS_RULES: EligibilityRuleResult[] = [
  { ruleId: "LISTING_HISTORY" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "PRICE_AVAILABILITY" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "MIN_PRICE" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "TRADED_VALUE" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "CORPORATE_ACTION_STATUS" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "TRADING_STATUS" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "SURVEILLANCE_STATUS" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "PRICE_ADJUSTMENT_VALIDITY" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "FUNDAMENTAL_FRESHNESS" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "BROKER_MAPPING" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "DATA_ANOMALY" as EligibilityRuleId, passed: true, reasonCode: "OK" },
  { ruleId: "FUNDAMENTAL_HEALTH" as EligibilityRuleId, passed: true, reasonCode: "OK" },
].map(r => Object.freeze(r))

const INS_ID = "INS-001" as InstrumentId
const SV_ID = "sv-001" as StrategyVersionId
const DV_ID = "dv-001" as DataVersionId

console.log("\n=== U03 Strategy Domain Benchmark ===")
console.log(`Runs per operation: ${RUNS.toLocaleString()}\n`)

bench("createStrategyConfig (full validation + SHA-256)", () => {
  createStrategyConfig(VALID_RAW)
})

bench("strategyConfigsEqual (hash comparison)", () => {
  strategyConfigsEqual(benchConfig, benchConfig)
})

bench("createSignalSnapshot (12 guards + validation)", () => {
  createSignalSnapshot({
    instrumentId: INS_ID, strategyVersionId: SV_ID, dataVersionId: DV_ID,
    asOf: "2024-01-15", isBfsi: false,
    momentumComponents: MOM_COMPS, qualityComponents: QUAL_COMPS, riskComponents: RISK_COMPS,
    momentumScore: 0.65, qualityScore: 0.60, riskScore: 0.55, compositeScore: 0.62,
    convictionMultiplier: 1.0, rank: 5,
    computedAt: "2024-01-16T08:00:00Z",
  })
})

bench("createRegimeState (RISK_ON path)", () => {
  createRegimeState({
    indicators: REGIME_INDICATORS,
    dataVersionId: DV_ID,
    asOf: "2024-01-15",
    evaluatedAt: "2024-01-16T08:00:00Z",
    crisisDrawdownPct: 15.0,
    highVolatilityThreshold: 25.0,
  })
})

bench("createEligibilityResult (12 rules, all pass)", () => {
  createEligibilityResult({
    instrumentId: INS_ID,
    strategyVersionId: SV_ID,
    dataVersionId: DV_ID,
    asOf: "2024-01-15",
    ruleResults: ALL_PASS_RULES,
    isBfsi: false,
    evaluatedAt: "2024-01-16T08:00:00Z",
  })
})

bench("SHORT_HORIZON_PRESET hash access (no recompute)", () => {
  void SHORT_HORIZON_PRESET.hash
})

bench("strategyConfigsEqual across different presets", () => {
  strategyConfigsEqual(SHORT_HORIZON_PRESET.config, MEDIUM_HORIZON_PRESET.config)
})

console.log("\nBenchmark complete.")
