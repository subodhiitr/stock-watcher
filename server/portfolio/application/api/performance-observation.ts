import type {
  PerformanceAccountingRecord,
  PerformanceAttributionRecord,
  PerformanceObservationRecord,
} from '../../ports/api/api-store.ts'

const ONE_MILLION = 1_000_000n
const YEAR_MS = 365.25 * 86_400_000

export type PerformanceHoldingInput = Readonly<{
  instrumentId: string
  quantity: bigint
  costBasisMinorUnits: bigint
  priceMinorUnits: bigint
  previousCloseMinorUnits: bigint
}>

export type PerformanceObservationInput = Readonly<{
  observationId: string
  portfolioId: string
  observedAt: string
  observationDate: string
  portfolioStateVersion: number
  cashMinorUnits: bigint
  benchmarkSymbol: string
  benchmarkPriceMinorUnits: bigint
  holdings: readonly PerformanceHoldingInput[]
  accounting: PerformanceAccountingRecord
  history: readonly PerformanceObservationRecord[]
  createdBy: string
}>

function ratioPpm(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0
  const value = numerator * ONE_MILLION / denominator
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  if (value > maximum) return Number.MAX_SAFE_INTEGER
  if (value < -maximum) return -Number.MAX_SAFE_INTEGER
  return Number(value)
}

function annualizedVolatility(dayReturnsPpm: readonly number[]): number {
  if (dayReturnsPpm.length < 2) return 0
  const values = dayReturnsPpm.map((value) => value / 1_000_000)
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance = values.reduce((total, value) => total + ((value - mean) ** 2), 0) / (values.length - 1)
  return Math.max(0, Math.round(Math.sqrt(variance) * Math.sqrt(252) * 1_000_000))
}

function annualizedReturnPpm(wealthIndexPpm: bigint, firstObservedAt: string, observedAt: string): number {
  const elapsed = Date.parse(observedAt) - Date.parse(firstObservedAt)
  if (elapsed < 86_400_000 || wealthIndexPpm <= 0n) return 0
  const years = elapsed / YEAR_MS
  const annualized = (Math.pow(Number(wealthIndexPpm) / 1_000_000, 1 / years) - 1) * 1_000_000
  return Number.isFinite(annualized) ? Math.round(annualized) : 0
}

export function createPerformanceObservation(input: PerformanceObservationInput): PerformanceObservationRecord {
  const history = [...input.history].sort((left, right) => left.observedAt.localeCompare(right.observedAt))
  const previous = history.at(-1)
  const marketValue = input.holdings.reduce(
    (total, holding) => total + holding.quantity * holding.priceMinorUnits,
    0n,
  )
  const investedCost = input.holdings.reduce((total, holding) => total + holding.costBasisMinorUnits, 0n)
  const dayPnl = input.holdings.reduce(
    (total, holding) => total + holding.quantity * (holding.priceMinorUnits - holding.previousCloseMinorUnits),
    0n,
  )
  const nav = input.cashMinorUnits + marketValue
  const unrealizedPnl = marketValue - investedCost
  const contributedCapital = input.accounting.capitalFlows
    .filter((flow) => flow.occurredAt <= input.observedAt)
    .reduce((total, flow) => total + BigInt(flow.amountMinorUnits), 0n)
  const externalFlow = previous === undefined ? 0n : input.accounting.capitalFlows
    .filter((flow) => flow.occurredAt > previous.observedAt && flow.occurredAt <= input.observedAt)
    .reduce((total, flow) => total + BigInt(flow.amountMinorUnits), 0n)
  const dayReturnPpm = previous === undefined
    ? 0
    : ratioPpm(nav - externalFlow - BigInt(previous.navMinorUnits), BigInt(previous.navMinorUnits))
  const previousWealth = previous === undefined ? ONE_MILLION : BigInt(previous.wealthIndexPpm)
  const wealthIndex = previous === undefined
    ? contributedCapital > 0n ? nav * ONE_MILLION / contributedCapital : ONE_MILLION
    : previousWealth * (ONE_MILLION + BigInt(dayReturnPpm)) / ONE_MILLION
  const previousPeak = previous === undefined
    ? wealthIndex > ONE_MILLION ? wealthIndex : ONE_MILLION
    : BigInt(previous.peakWealthIndexPpm)
  const peakWealth = wealthIndex > previousPeak ? wealthIndex : previousPeak
  const drawdownPpm = ratioPpm(wealthIndex - peakWealth, peakWealth)
  const first = history[0]
  const firstBenchmark = first === undefined
    ? input.benchmarkPriceMinorUnits
    : BigInt(first.benchmarkPriceMinorUnits)
  const benchmarkDayReturnPpm = previous === undefined
    ? 0
    : ratioPpm(
        input.benchmarkPriceMinorUnits - BigInt(previous.benchmarkPriceMinorUnits),
        BigInt(previous.benchmarkPriceMinorUnits),
      )
  const benchmarkTotalReturnPpm = ratioPpm(input.benchmarkPriceMinorUnits - firstBenchmark, firstBenchmark)
  const dailyHistory = new Map<string, PerformanceObservationRecord>()
  for (const observation of history) dailyHistory.set(observation.observationDate, observation)
  const volatilityReturns = [...dailyHistory.values()].map((observation) => observation.dayReturnPpm)
  if (previous !== undefined) volatilityReturns.push(dayReturnPpm)
  const attribution: readonly PerformanceAttributionRecord[] = Object.freeze(input.holdings
    .map((holding) => {
      const holdingMarketValue = holding.quantity * holding.priceMinorUnits
      const holdingDayPnl = holding.quantity * (holding.priceMinorUnits - holding.previousCloseMinorUnits)
      return Object.freeze({
        instrumentId: holding.instrumentId,
        quantity: holding.quantity.toString(),
        marketValueMinorUnits: holdingMarketValue.toString(),
        investedCostMinorUnits: holding.costBasisMinorUnits.toString(),
        unrealizedPnlMinorUnits: (holdingMarketValue - holding.costBasisMinorUnits).toString(),
        dayPnlMinorUnits: holdingDayPnl.toString(),
        weightPpm: ratioPpm(holdingMarketValue, nav),
        dayContributionPpm: previous === undefined ? 0 : ratioPpm(holdingDayPnl, BigInt(previous.navMinorUnits)),
      })
    })
    .sort((left, right) => right.weightPpm - left.weightPpm || left.instrumentId.localeCompare(right.instrumentId)))
  const realizedPnl = BigInt(input.accounting.realizedPnlMinorUnits)
  const charges = BigInt(input.accounting.cumulativeChargesMinorUnits)
  const tax = BigInt(input.accounting.cumulativeTaxMinorUnits)
  return Object.freeze({
    observationId: input.observationId,
    portfolioId: input.portfolioId,
    observedAt: input.observedAt,
    observationDate: input.observationDate,
    portfolioStateVersion: input.portfolioStateVersion,
    benchmarkSymbol: input.benchmarkSymbol,
    benchmarkPriceMinorUnits: input.benchmarkPriceMinorUnits.toString(),
    cashMinorUnits: input.cashMinorUnits.toString(),
    marketValueMinorUnits: marketValue.toString(),
    navMinorUnits: nav.toString(),
    investedCostMinorUnits: investedCost.toString(),
    unrealizedPnlMinorUnits: unrealizedPnl.toString(),
    dayPnlMinorUnits: dayPnl.toString(),
    contributedCapitalMinorUnits: contributedCapital.toString(),
    realizedPnlMinorUnits: realizedPnl.toString(),
    cumulativeChargesMinorUnits: charges.toString(),
    cumulativeTaxMinorUnits: tax.toString(),
    netPnlMinorUnits: (nav - contributedCapital).toString(),
    dayReturnPpm,
    totalReturnPpm: Number(wealthIndex - ONE_MILLION),
    benchmarkDayReturnPpm,
    benchmarkTotalReturnPpm,
    wealthIndexPpm: wealthIndex.toString(),
    peakWealthIndexPpm: peakWealth.toString(),
    drawdownPpm,
    annualizedVolatilityPpm: annualizedVolatility(volatilityReturns),
    annualizedReturnPpm: annualizedReturnPpm(
      wealthIndex,
      first?.observedAt ?? input.observedAt,
      input.observedAt,
    ),
    quoteCount: input.holdings.length,
    totalHoldings: input.holdings.length,
    attribution,
    marketDataSource: 'YAHOO_RESEARCH',
    createdBy: input.createdBy,
  })
}
