import type { PortfolioView } from '../types/views.ts'

export type PortfolioMarketQuote = Readonly<{
  symbol: string
  price: number
  change: number
  high52: number
  low52: number
  volume: number
  open: number
  prevClose: number
  marketState: string
}>

export type PortfolioMarketSnapshot = Readonly<{
  quotes: Readonly<Record<string, PortfolioMarketQuote>>
  fetchedAt?: string
  loading: boolean
  error?: string
}>

export type HoldingValuation = Readonly<{
  holdingId: string
  instrumentId: string
  quoteSymbol?: string
  quantity: bigint
  costBasisMinorUnits: bigint
  averageCostMinorUnits?: bigint
  marketPriceMinorUnits?: bigint
  marketValueMinorUnits?: bigint
  unrealizedPnlMinorUnits?: bigint
  dayPnlMinorUnits?: bigint
  changePercent?: number
  high52MinorUnits?: bigint
  low52MinorUnits?: bigint
  volume?: number
  marketState?: string
}>

export type PortfolioValuation = Readonly<{
  holdings: readonly HoldingValuation[]
  investedMinorUnits: bigint
  marketValueMinorUnits: bigint
  unrealizedPnlMinorUnits: bigint
  dayPnlMinorUnits: bigint
  quotedHoldings: number
  totalHoldings: number
  complete: boolean
}>

function integer(value: unknown): bigint | undefined {
  const text = String(value ?? '')
  return /^(0|[1-9][0-9]*)$/u.test(text) ? BigInt(text) : undefined
}

function priceMinorUnits(value: unknown): bigint | undefined {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) return undefined
  return BigInt(Math.round(price * 100))
}

export function quoteSymbolForInstrument(instrumentId: unknown): string | undefined {
  const normalized = String(instrumentId ?? '').trim().toUpperCase()
  if (normalized === '' || normalized.startsWith('BSE:')) return undefined
  return normalized.replace(/^NSE:/u, '').replace(/\.NS$/u, '') || undefined
}

export function portfolioQuoteSymbols(data: PortfolioView): readonly string[] {
  const symbols = new Set<string>()
  for (const holding of data.holdings) {
    const symbol = quoteSymbolForInstrument(holding.instrument_id)
    if (symbol !== undefined) symbols.add(symbol)
  }
  return Object.freeze([...symbols])
}

export function buildPortfolioValuation(
  data: PortfolioView,
  quotes: Readonly<Record<string, PortfolioMarketQuote>>,
): PortfolioValuation {
  const lotsByHolding = new Map<string, readonly Readonly<Record<string, string | number>>[]>()
  for (const lot of data.lots) {
    const holdingId = String(lot.holding_id)
    lotsByHolding.set(holdingId, Object.freeze([...(lotsByHolding.get(holdingId) ?? []), lot]))
  }

  let investedMinorUnits = 0n
  let marketValueMinorUnits = 0n
  let unrealizedPnlMinorUnits = 0n
  let dayPnlMinorUnits = 0n
  let quotedHoldings = 0
  const holdings = data.holdings.map((holding): HoldingValuation => {
    const holdingId = String(holding.holding_id)
    const instrumentId = String(holding.instrument_id)
    const quantity = integer(holding.total_quantity) ?? 0n
    const costBasisMinorUnits = (lotsByHolding.get(holdingId) ?? []).reduce((total, lot) => {
      const openQuantity = integer(lot.open_quantity) ?? 0n
      const unitCost = integer(lot.unit_cost_minor_units) ?? 0n
      return total + (openQuantity * unitCost)
    }, 0n)
    investedMinorUnits += costBasisMinorUnits
    const quoteSymbol = quoteSymbolForInstrument(instrumentId)
    const quote = quoteSymbol === undefined ? undefined : quotes[quoteSymbol]
    const marketPriceMinorUnits = priceMinorUnits(quote?.price)
    const previousCloseMinorUnits = priceMinorUnits(quote?.prevClose)
    const averageCostMinorUnits = quantity > 0n ? costBasisMinorUnits / quantity : undefined
    if (marketPriceMinorUnits === undefined) {
      return Object.freeze({
        holdingId,
        instrumentId,
        ...(quoteSymbol === undefined ? {} : { quoteSymbol }),
        quantity,
        costBasisMinorUnits,
        ...(averageCostMinorUnits === undefined ? {} : { averageCostMinorUnits }),
      })
    }
    quotedHoldings += 1
    const marketValue = marketPriceMinorUnits * quantity
    const unrealizedPnl = marketValue - costBasisMinorUnits
    const high52MinorUnits = priceMinorUnits(quote?.high52)
    const low52MinorUnits = priceMinorUnits(quote?.low52)
    const dayPnl = previousCloseMinorUnits === undefined
      ? 0n
      : (marketPriceMinorUnits - previousCloseMinorUnits) * quantity
    marketValueMinorUnits += marketValue
    unrealizedPnlMinorUnits += unrealizedPnl
    dayPnlMinorUnits += dayPnl
    return Object.freeze({
      holdingId,
      instrumentId,
      ...(quoteSymbol === undefined ? {} : { quoteSymbol }),
      quantity,
      costBasisMinorUnits,
      ...(averageCostMinorUnits === undefined ? {} : { averageCostMinorUnits }),
      marketPriceMinorUnits,
      marketValueMinorUnits: marketValue,
      unrealizedPnlMinorUnits: unrealizedPnl,
      dayPnlMinorUnits: dayPnl,
      changePercent: quote?.change,
      ...(high52MinorUnits === undefined ? {} : { high52MinorUnits }),
      ...(low52MinorUnits === undefined ? {} : { low52MinorUnits }),
      volume: quote?.volume,
      marketState: quote?.marketState,
    })
  })
  return Object.freeze({
    holdings: Object.freeze(holdings),
    investedMinorUnits,
    marketValueMinorUnits,
    unrealizedPnlMinorUnits,
    dayPnlMinorUnits,
    quotedHoldings,
    totalHoldings: holdings.length,
    complete: quotedHoldings === holdings.length,
  })
}
