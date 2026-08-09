import { on, type Handle } from 'remix/ui'

import type { PerformanceObservation, PortfolioView } from '../types/views.ts'
import {
  buildPortfolioValuation,
  type PortfolioMarketSnapshot,
} from '../market/valuation.ts'
import { groupPortfolioLots } from '../market/lot-groups.ts'
import { buttonStyle, palette, panelStyle } from './styles.ts'

function inr(minorUnits: unknown): string {
  try {
    const units = BigInt(String(minorUnits ?? '0'))
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(units) / 100)
  } catch {
    return 'Unavailable'
  }
}

function percentage(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return '—'
  return `${(Number(numerator * 10_000n / denominator) / 100).toFixed(2)}%`
}

function pnlTone(value: bigint | undefined): string {
  if (value === undefined || value === 0n) return palette.muted
  return value > 0n ? palette.green : palette.red
}

function exitTime(value: unknown): string {
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-IN', {
    dateStyle:'medium', timeStyle:'medium', timeZone:'Asia/Kolkata',
  }).format(date)
}

function MarketDataStatus(handle: Handle<Readonly<{
  market: PortfolioMarketSnapshot
  quotedHoldings: number
  totalHoldings: number
  onRefresh(): void
}>>) {
  return () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px', borderTop: `1px solid ${palette.border}`, paddingTop: '14px', marginTop: '16px' }}>
      <span role="status" style={{ color: handle.props.market.error ? palette.amber : palette.muted }}>
        {handle.props.market.loading
          ? 'Refreshing live Yahoo market data…'
          : handle.props.market.error
            ? handle.props.market.error
            : handle.props.totalHoldings === 0
              ? 'Add a holding to begin market valuation.'
              : `Live quotes ${handle.props.quotedHoldings}/${handle.props.totalHoldings}${handle.props.market.fetchedAt ? ` · ${new Date(handle.props.market.fetchedAt).toLocaleTimeString('en-IN')}` : ''}`}
      </span>
      <button mix={[buttonStyle, on('click', handle.props.onRefresh)]} type="button" disabled={handle.props.market.loading || handle.props.totalHoldings === 0}>Refresh prices</button>
    </div>
  )
}

export function OverviewPanel(handle: Handle<Readonly<{
  data: PortfolioView
  market: PortfolioMarketSnapshot
  onRefresh(): void
}>>) {
  return () => {
    const valuation = buildPortfolioValuation(handle.props.data, handle.props.market.quotes)
    const cash = BigInt(handle.props.data.portfolio.cash_minor_units)
    const hasHoldings = valuation.totalHoldings > 0
    const marketValue = hasHoldings && !valuation.complete ? 'Unavailable' : inr(valuation.marketValueMinorUnits)
    const unrealized = hasHoldings && !valuation.complete ? 'Unavailable' : inr(valuation.unrealizedPnlMinorUnits)
    const totalEquity = hasHoldings && !valuation.complete ? 'Unavailable' : inr(cash + valuation.marketValueMinorUnits)
    return <section mix={panelStyle} aria-labelledby="overview-title">
      <h2 id="overview-title">Overview</h2>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <div><dt style={{ color: palette.muted }}>Cash</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>{inr(handle.props.data.portfolio.cash_minor_units)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Invested cost</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>{inr(valuation.investedMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Market value</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>{marketValue}</dd></div>
        <div><dt style={{ color: palette.muted }}>Total equity</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>{totalEquity}</dd></div>
        <div><dt style={{ color: palette.muted }}>Unrealized P/L</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800, color: valuation.complete ? pnlTone(valuation.unrealizedPnlMinorUnits) : palette.muted }}>{unrealized}</dd><small style={{ color: palette.muted }}>{valuation.complete ? percentage(valuation.unrealizedPnlMinorUnits, valuation.investedMinorUnits) : 'Waiting for all quotes'}</small></div>
        <div><dt style={{ color: palette.muted }}>Today’s P/L</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800, color: valuation.complete ? pnlTone(valuation.dayPnlMinorUnits) : palette.muted }}>{valuation.complete ? inr(valuation.dayPnlMinorUnits) : 'Unavailable'}</dd></div>
        <div><dt style={{ color: palette.muted }}>State version</dt><dd style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>{handle.props.data.portfolio.state_version}</dd></div>
        <div><dt style={{ color: palette.muted }}>Rebalance status</dt><dd style={{ margin: '4px 0', fontWeight: 800 }}>{handle.props.data.rebalance.status}</dd></div>
      </dl>
      <p style={{ color: palette.muted }}>P/L uses imported open-lot cost basis and the latest available Yahoo quote. Quotes are an informational overlay and are not treated as approval-ready planning data.</p>
      <MarketDataStatus market={handle.props.market} quotedHoldings={valuation.quotedHoldings} totalHoldings={valuation.totalHoldings} onRefresh={handle.props.onRefresh} />
    </section>
  }
}

export function HoldingsPanel(handle: Handle<Readonly<{
  data: PortfolioView
  market: PortfolioMarketSnapshot
  busy: boolean
  onRefresh(): void
  onExit(input: Readonly<{ instrumentId: string; quantity: string }>): void
}>>) {
  return () => {
    const valuation = buildPortfolioValuation(handle.props.data, handle.props.market.quotes)
    const lotGroups = groupPortfolioLots(handle.props.data.lots)
    const availableQuantityByHolding = new Map(handle.props.data.holdings.map((holding) => [
      String(holding.holding_id),
      BigInt(String(holding.available_delivery_quantity)),
    ]))
    const currentRiskPlan = handle.props.data.rebalance.plans[0]
    const riskActions = currentRiskPlan?.portfolioStateVersion === handle.props.data.portfolioSnapshot.stateVersion
      ? currentRiskPlan.actions
      : []
    const riskByInstrument = new Map(riskActions
      .filter((action) => BigInt(action.currentQuantity) > 0n)
      .map((action) => [action.instrumentId, action]))
    const riskyPositions = [...riskByInstrument.values()].filter((action) => action.exitRiskLevel && action.exitRiskLevel !== 'NONE')
    return (
    <section mix={panelStyle} aria-labelledby="holdings-title">
      <h2 id="holdings-title">Holdings and lots</h2>
      <p style={{ color: palette.muted }}>Portfolio snapshot v{handle.props.data.portfolioSnapshot.stateVersion} contains {handle.props.data.portfolioSnapshot.holdingsIncluded} holding(s) and {handle.props.data.portfolioSnapshot.lotsIncluded} open lot(s).</p>
      {riskyPositions.length > 0 ? <div role="alert" style={{ display: 'grid', gap: '8px', margin: '12px 0 18px' }}>{riskyPositions.map((risk) => {
        const riskColor = risk.exitRiskLevel === 'EXIT' ? palette.red : risk.exitRiskLevel === 'REDUCE' ? palette.amber : '#60a5fa'
        return <div key={risk.instrumentId} style={{ borderLeft: `5px solid ${riskColor}`, padding: '10px 14px', background: risk.exitRiskLevel === 'EXIT' ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.08)' }}><strong style={{ color: riskColor }}>{risk.instrumentId}: {risk.mandatoryExit ? 'EXIT REQUIRED' : risk.exitRiskLevel}</strong><br /><small>{risk.exitRiskSummary} Use <strong>Exit / reduce</strong> in its holding row below to execute the PAPER action.</small></div>
      })}</div> : <p style={{ color: palette.muted }}>{currentRiskPlan === undefined || currentRiskPlan.portfolioStateVersion !== handle.props.data.portfolioSnapshot.stateVersion ? 'Generate a current rebalance preview to automatically assess exit risk.' : 'No active exit-risk flags in the latest rebalance analysis.'}</p>}
      {handle.props.data.holdings.length === 0 ? <p>No holdings recorded for this portfolio.</p> : (
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th scope="col">Instrument</th><th scope="col">Quantity</th><th scope="col">Average cost</th><th scope="col">Live price</th><th scope="col">Market value</th><th scope="col">Unrealized P/L</th><th scope="col">Day P/L</th><th scope="col">Market details</th><th scope="col">Action</th></tr></thead>
          <tbody>{valuation.holdings.map((item) => {
            const risk = riskByInstrument.get(item.instrumentId)
            const plannedDelta = BigInt(risk?.deltaQuantity ?? '0')
            const availableQuantity = availableQuantityByHolding.get(item.holdingId) ?? 0n
            const plannedQuantity = plannedDelta < 0n ? -plannedDelta : 0n
            const suggestedQuantity = plannedDelta < 0n
              ? [plannedQuantity, item.quantity, availableQuantity].reduce((minimum, value) => value < minimum ? value : minimum)
              : risk?.exitRiskLevel === 'EXIT' ? availableQuantity : availableQuantity > 0n ? 1n : 0n
            return <tr key={item.holdingId}><td><strong>{item.instrumentId}</strong><br /><small style={{ color: palette.muted }}>{item.marketState || 'Market state unavailable'}</small></td><td>{item.quantity.toString()}</td><td>{item.averageCostMinorUnits === undefined ? 'Unavailable' : inr(item.averageCostMinorUnits)}</td><td>{item.marketPriceMinorUnits === undefined ? 'Unavailable' : inr(item.marketPriceMinorUnits)}<br /><small style={{ color: pnlTone(item.dayPnlMinorUnits) }}>{item.changePercent === undefined ? '' : `${item.changePercent.toFixed(2)}%`}</small></td><td>{item.marketValueMinorUnits === undefined ? 'Unavailable' : inr(item.marketValueMinorUnits)}</td><td style={{ color: pnlTone(item.unrealizedPnlMinorUnits) }}>{item.unrealizedPnlMinorUnits === undefined ? 'Unavailable' : <>{inr(item.unrealizedPnlMinorUnits)}<br /><small>{percentage(item.unrealizedPnlMinorUnits, item.costBasisMinorUnits)}</small></>}</td><td style={{ color: pnlTone(item.dayPnlMinorUnits) }}>{item.dayPnlMinorUnits === undefined ? 'Unavailable' : inr(item.dayPnlMinorUnits)}</td><td><small>52W {item.low52MinorUnits === undefined ? '—' : inr(item.low52MinorUnits)} – {item.high52MinorUnits === undefined ? '—' : inr(item.high52MinorUnits)}<br />Volume {item.volume === undefined ? '—' : new Intl.NumberFormat('en-IN').format(item.volume)}</small></td><td><details><summary>Exit / reduce</summary><form mix={on('submit', (event) => {
              event.preventDefault()
              const values = new FormData(event.currentTarget)
              handle.props.onExit({ instrumentId: item.instrumentId, quantity: String(values.get('quantity') ?? '') })
            })} style={{ minWidth: '220px', paddingTop: '8px' }}><label>Shares to sell<input name="quantity" inputMode="numeric" pattern="[1-9][0-9]*" min="1" max={availableQuantity.toString()} defaultValue={suggestedQuantity.toString()} required style={{ display: 'block', width: '100%', margin: '5px 0 8px' }} /></label><small>{availableQuantity.toString()} delivery shares available.</small>{risk !== undefined && plannedDelta < 0n ? <small style={{ display: 'block' }}> Strategy suggests selling {plannedQuantity.toString()} shares.</small> : null}<label style={{ display: 'block', margin: '8px 0' }}><input type="checkbox" required /> Confirm PAPER sale using a fresh server quote</label><button mix={buttonStyle} type="submit" disabled={handle.props.busy || availableQuantity === 0n || handle.props.data.portfolio.operating_mode !== 'PAPER'}>{handle.props.busy ? 'Processing…' : suggestedQuantity === item.quantity ? 'Exit holding' : 'Reduce holding'}</button><small style={{ display: 'block', color: palette.muted, marginTop: '6px' }}>FIFO lots, charges and estimated tax are calculated server-side. No broker order is sent.</small></form></details></td></tr>
          })}</tbody>
        </table></div>
      )}
      {lotGroups.length === 0 ? null : (
        <div style={{ overflowX: 'auto', marginTop: '20px' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption style={{ textAlign: 'left', fontWeight: 800, paddingBottom: '8px' }}>Consolidated tax lots included in this snapshot</caption>
          <thead><tr><th scope="col">Instrument</th><th scope="col">Open quantity</th><th scope="col">Unit cost</th><th scope="col">Acquired</th><th scope="col">Source</th></tr></thead>
          <tbody>{lotGroups.map((item) => <tr key={item.key}><td>{item.instrumentId}</td><td>{item.openQuantity.toString()}</td><td>{inr(item.unitCostMinorUnits)}</td><td>{item.acquiredOn}</td><td>{item.sourceKind}{item.lotCount > 1 && <><br /><details><summary>{item.lotCount} fills</summary><small>{item.sourceReferenceIds.length > 0 ? item.sourceReferenceIds.join(' · ') : item.lotIds.join(' · ')}</small></details></>}</td></tr>)}</tbody>
        </table></div>
      )}
      {lotGroups.some((group) => group.lotCount > 1) ? <p style={{ color: palette.muted }}>Matching fills are consolidated for display. Individual tax lots and plan references remain preserved for accounting and audit.</p> : null}
      {(handle.props.data.manualExits ?? []).length > 0 ? <div style={{ overflowX: 'auto', marginTop: '20px' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption style={{ textAlign: 'left', fontWeight: 800, paddingBottom: '8px' }}>Recent PAPER exits</caption>
        <thead><tr><th scope="col">Executed (IST)</th><th scope="col">Instrument</th><th scope="col">Action</th><th scope="col">Price</th><th scope="col">Realized P/L</th><th scope="col">Charges / tax</th><th scope="col">Net proceeds</th><th scope="col">Reason</th></tr></thead>
        <tbody>{(handle.props.data.manualExits ?? []).map((exit) => <tr key={String(exit.exit_id)}><td>{exitTime(exit.executed_at)}</td><td>{String(exit.instrument_id)}</td><td>{String(exit.exit_kind)} · {String(exit.quantity)} shares</td><td>{inr(exit.execution_price_minor_units)}</td><td style={{ color: pnlTone(BigInt(String(exit.realized_pnl_minor_units))) }}>{inr(exit.realized_pnl_minor_units)}</td><td>{inr(exit.charges_minor_units)} / {inr(exit.tax_minor_units)}</td><td>{inr(exit.net_proceeds_minor_units)}</td><td>{String(exit.reason_code)}</td></tr>)}</tbody>
      </table></div> : null}
      <MarketDataStatus market={handle.props.market} quotedHoldings={valuation.quotedHoldings} totalHoldings={valuation.totalHoldings} onRefresh={handle.props.onRefresh} />
    </section>
    )
  }
}

export function StrategyPanel(handle: Handle<Readonly<{ data: PortfolioView }>>) {
  return () => (
    <section mix={panelStyle} aria-labelledby="strategy-title">
      <h2 id="strategy-title">Strategy</h2>
      {handle.props.data.strategy.map((item) => (
        <article key={String(item.strategy_version_id)}>
          <h3>{String(item.display_name)} · {String(item.horizon)}</h3>
          <p>Version {String(item.semantic_version)} · effective {String(item.effective_at)}</p>
          <details><summary>Configuration and lineage</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(item.canonical_payload)}</pre></details>
        </article>
      ))}
      <p style={{ color: palette.muted }}>Thesis, timing, factors, constraints, regime, cadence, turnover, preferred-hold policy, tests and history are read from the immutable version payload and lineage.</p>
    </section>
  )
}

export function RebalancePanel(handle: Handle<Readonly<{ data: PortfolioView }>>) {
  return () => {
    const blockers = handle.props.data.rebalance.blockers ?? []
    return <section mix={panelStyle}><h2>Rebalance preview and approval</h2><p><strong>Status:</strong> {handle.props.data.rebalance.status}</p><p>Your holdings are stored in portfolio snapshot v{handle.props.data.portfolioSnapshot.stateVersion}. A rebalance plan is separate and has not been generated.</p><h3>What is still required</h3><ul>{blockers.map((blocker) => <li key={blocker}>{blocker === 'HOLDINGS_REQUIRED' ? 'Import at least one delivery holding.' : blocker === 'PLANNING_SNAPSHOT_NOT_CONNECTED' ? 'Connect a point-in-time planning snapshot with prices, signals, regime, reconciliation, costs, and tax rules.' : blocker}</li>)}</ul><p style={{ color: palette.muted }}>Approval and execution remain disabled until every planning and authorization gate passes.</p></section>
  }
}

function ppm(value: number): string {
  return `${(value / 10_000).toFixed(2)}%`
}

function performanceTone(value: number | bigint): string {
  if (value === 0 || value === 0n) return palette.muted
  return value > 0 ? palette.green : palette.red
}

function chartCoordinates(
  observations: readonly PerformanceObservation[],
  value: (observation: PerformanceObservation) => number,
  minimum: number,
  maximum: number,
): readonly Readonly<{ x: number; y: number }>[] {
  const width = 760
  const height = 220
  const spread = Math.max(1, maximum - minimum)
  return observations.map((observation, index) => {
    const x = observations.length === 1 ? width / 2 : index * width / (observations.length - 1)
    const y = height - ((value(observation) - minimum) / spread) * height
    return Object.freeze({ x, y })
  })
}

function chartPoints(coordinates: readonly Readonly<{ x: number; y: number }>[]): string {
  return coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

export function PerformancePanel(handle: Handle<Readonly<{
  data: PortfolioView
  busy: boolean
  onRefresh(): void
}>>) {
  return () => {
    const performance = handle.props.data.performance
    const latest = performance.latest
    if (latest === undefined) {
      return <section mix={panelStyle} aria-labelledby="performance-title">
        <h2 id="performance-title">Performance</h2>
        <p><strong>Status:</strong> NO_OBSERVATIONS</p>
        <p>Record the first observation to establish the portfolio and strategy-benchmark baseline. Future observations calculate flow-adjusted returns, drawdown, volatility, charges, tax and position attribution.</p>
        <button mix={[buttonStyle, on('click', handle.props.onRefresh)]} type="button" disabled={handle.props.busy}>{handle.props.busy ? 'Recording…' : 'Record first observation'}</button>
        <p style={{ color: palette.muted }}>Observations use complete Yahoo holding quotes and the strategy benchmark. They are research analytics and never authorize execution.</p>
      </section>
    }
    const history = performance.observations
    const chartValues = history.flatMap((observation) => [observation.totalReturnPpm, observation.benchmarkTotalReturnPpm])
    const minimum = Math.min(0, ...chartValues)
    const maximum = Math.max(0, ...chartValues)
    const portfolioCoordinates = chartCoordinates(history, (observation) => observation.totalReturnPpm, minimum, maximum)
    const benchmarkCoordinates = chartCoordinates(history, (observation) => observation.benchmarkTotalReturnPpm, minimum, maximum)
    const portfolioPoints = chartPoints(portfolioCoordinates)
    const benchmarkPoints = chartPoints(benchmarkCoordinates)
    const alphaPpm = latest.totalReturnPpm - latest.benchmarkTotalReturnPpm
    return <section mix={panelStyle} aria-labelledby="performance-title">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div><h2 id="performance-title" style={{ marginBottom: '4px' }}>Performance</h2><span style={{ color: performance.status === 'STALE' ? palette.amber : palette.green }}><strong>{performance.status}</strong> · {performance.observationCount} observation(s) since {performance.trackedSince}</span></div>
        <button mix={[buttonStyle, on('click', handle.props.onRefresh)]} type="button" disabled={handle.props.busy}>{handle.props.busy ? 'Recording…' : 'Record latest observation'}</button>
      </div>
      {performance.status === 'STALE' ? <p role="alert" style={{ color: palette.amber }}>Holdings, cash, or strategy changed after the latest observation. Record a new observation to refresh performance.</p> : null}
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginTop: '20px' }}>
        <div><dt style={{ color: palette.muted }}>Portfolio NAV</dt><dd style={{ margin: '4px 0', fontWeight: 800 }}>{inr(latest.navMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Total return</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(latest.totalReturnPpm) }}>{ppm(latest.totalReturnPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>{latest.benchmarkSymbol} return</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(latest.benchmarkTotalReturnPpm) }}>{ppm(latest.benchmarkTotalReturnPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Alpha</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(alphaPpm) }}>{ppm(alphaPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Day return / P&amp;L</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(latest.dayReturnPpm) }}>{ppm(latest.dayReturnPpm)} · {inr(latest.dayPnlMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Net P&amp;L</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(BigInt(latest.netPnlMinorUnits)) }}>{inr(latest.netPnlMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Drawdown</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(latest.drawdownPpm) }}>{ppm(latest.drawdownPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Annualized return</dt><dd style={{ margin: '4px 0', fontWeight: 800 }}>{ppm(latest.annualizedReturnPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Annualized volatility</dt><dd style={{ margin: '4px 0', fontWeight: 800 }}>{ppm(latest.annualizedVolatilityPpm)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Unrealized P&amp;L</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(BigInt(latest.unrealizedPnlMinorUnits)) }}>{inr(latest.unrealizedPnlMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Realized P&amp;L</dt><dd style={{ margin: '4px 0', fontWeight: 800, color: performanceTone(BigInt(latest.realizedPnlMinorUnits)) }}>{inr(latest.realizedPnlMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Charges / tax</dt><dd style={{ margin: '4px 0', fontWeight: 800 }}>{inr(latest.cumulativeChargesMinorUnits)} / {inr(latest.cumulativeTaxMinorUnits)}</dd></div>
      </dl>
      <h3>Portfolio versus benchmark</h3>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox="0 0 760 220" role="img" aria-label="Portfolio and benchmark cumulative return chart" style={{ width: '100%', minWidth: '560px', height: '240px', border: `1px solid ${palette.border}`, background: '#0d1420' }}>
          <line x1="0" y1={String(220 - ((0 - minimum) / Math.max(1, maximum - minimum)) * 220)} x2="760" y2={String(220 - ((0 - minimum) / Math.max(1, maximum - minimum)) * 220)} stroke={palette.border} />
          <polyline points={portfolioPoints} fill="none" stroke={palette.green} strokeWidth="4" />
          <polyline points={benchmarkPoints} fill="none" stroke="#60a5fa" strokeWidth="3" />
          {portfolioCoordinates.map((point, index) => <circle key={`portfolio-${history[index]?.observationId ?? index}`} cx={String(point.x)} cy={String(point.y)} r="6" fill={palette.green} />)}
          {benchmarkCoordinates.map((point, index) => <circle key={`benchmark-${history[index]?.observationId ?? index}`} cx={String(point.x)} cy={String(point.y)} r="5" fill="#60a5fa" />)}
          {history.length === 1 ? <>
            <text x="380" y="28" textAnchor="middle" fill={palette.muted} fontSize="14">Baseline recorded — add the next observation to draw a trend line</text>
            <text x="380" y="208" textAnchor="middle" fill={palette.muted} fontSize="13">{history[0]?.observationDate}</text>
          </> : null}
        </svg>
      </div>
      <p><span style={{ color: palette.green }}>● Portfolio</span> · <span style={{ color: '#60a5fa' }}>● {latest.benchmarkSymbol}</span></p>
      <h3>Position attribution</h3>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Instrument</th><th>Weight</th><th>Market value</th><th>Unrealized P/L</th><th>Day P/L</th><th>Day contribution</th></tr></thead>
        <tbody>{performance.attribution.map((item) => <tr key={item.instrumentId}><td>{item.instrumentId}<br /><small>{item.quantity} shares</small></td><td>{ppm(item.weightPpm)}</td><td>{inr(item.marketValueMinorUnits)}</td><td style={{ color: performanceTone(BigInt(item.unrealizedPnlMinorUnits)) }}>{inr(item.unrealizedPnlMinorUnits)}</td><td style={{ color: performanceTone(BigInt(item.dayPnlMinorUnits)) }}>{inr(item.dayPnlMinorUnits)}</td><td>{ppm(item.dayContributionPpm)}</td></tr>)}</tbody>
      </table></div>
      <h3>Daily observations</h3>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Date</th><th>NAV</th><th>Day return</th><th>Total return</th><th>Benchmark</th><th>Drawdown</th></tr></thead>
        <tbody>{[...history].reverse().map((item) => <tr key={item.observationId}><td>{item.observationDate}<br /><small>{new Date(item.observedAt).toLocaleTimeString('en-IN')}</small></td><td>{inr(item.navMinorUnits)}</td><td>{ppm(item.dayReturnPpm)}</td><td>{ppm(item.totalReturnPpm)}</td><td>{ppm(item.benchmarkTotalReturnPpm)}</td><td>{ppm(item.drawdownPpm)}</td></tr>)}</tbody>
      </table></div>
      <p style={{ color: palette.muted }}>Returns are time-weighted and adjust for recorded starting cash and imported holding cost. Realized P/L, charges and tax come from approved PAPER plans; older plans created before realized-gain tracking may show zero realized P/L. Yahoo data remains research-only.</p>
    </section>
  }
}

export function OperationsPanel(handle: Handle<Readonly<{ data?: unknown; denied?: boolean }>>) {
  return () => {
    const data = (typeof handle.props.data === 'object' && handle.props.data !== null
      ? handle.props.data
      : {}) as Record<string, unknown>
    const operations = (typeof data.operations === 'object' && data.operations !== null
      ? data.operations
      : {}) as Record<string, unknown>
    const database = (typeof data.database === 'object' && data.database !== null
      ? data.database
      : {}) as Record<string, unknown>
    const health = (typeof operations.health === 'object' && operations.health !== null
      ? operations.health
      : {}) as Record<string, unknown>
    const rows = (key: string) => Array.isArray(operations[key]) ? operations[key] as readonly unknown[] : []
    const securityAlerts = Array.isArray(data.securityAlerts) ? data.securityAlerts : []
    if (handle.props.denied) {
      return <section mix={panelStyle}><h2>Operations and safety</h2><p role="alert">Operator or administrator access with verified MFA is required.</p></section>
    }
    return (
      <section mix={panelStyle} aria-labelledby="operations-title">
        <h2 id="operations-title">Operations and safety</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
          <div><dt style={{ color: palette.muted }}>Database</dt><dd style={{ margin: 0, fontWeight: 800 }}>{String(database.state ?? 'Unknown')} · schema {String(database.schemaVersion ?? 'n/a')}</dd></div>
          <div><dt style={{ color: palette.muted }}>Operations health</dt><dd style={{ margin: 0, fontWeight: 800 }}>{String(health.state ?? 'Unknown')}</dd></div>
          <div><dt style={{ color: palette.muted }}>Audit integrity</dt><dd style={{ margin: 0, fontWeight: 800 }}>{database.operationsAuditValid === false ? 'Blocked' : 'Valid'}</dd></div>
          <div><dt style={{ color: palette.muted }}>Security alerts</dt><dd style={{ margin: 0, fontWeight: 800 }}>{securityAlerts.length}</dd></div>
        </dl>
        <details open><summary>Jobs</summary><OperationsList items={rows('jobs')} empty="No portfolio jobs have run yet." /></details>
        <details><summary>Component health</summary><OperationsList items={Array.isArray(health.components) ? health.components : []} empty="No component health has been recorded yet." /></details>
        <details><summary>Backups</summary><OperationsList items={rows('backups')} empty="No verified backup receipt has been recorded yet." /></details>
        <details><summary>Incidents</summary><OperationsList items={rows('incidents')} empty="No incidents are open or recently closed." /></details>
        <details><summary>Audit explanations</summary><OperationsList items={rows('audit')} empty="No U6 audit decision has been recorded yet." /></details>
      </section>
    )
  }
}

function OperationsList(handle: Handle<Readonly<{ items: readonly unknown[]; empty: string }>>) {
  return () => handle.props.items.length === 0
    ? <p style={{ color: palette.muted }}>{handle.props.empty}</p>
    : <ul>{handle.props.items.slice(0, 12).map((item, index) => (
        <li key={index}><code>{JSON.stringify(item)}</code></li>
      ))}</ul>
}
