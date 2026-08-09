import { on, type Handle } from 'remix/ui'

import type { PortfolioView, StrategyOption } from '../types/views.ts'
import { buttonStyle, fieldStyle, palette, panelStyle } from './styles.ts'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function inr(minorUnits: unknown): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
      .format(Number(BigInt(String(minorUnits ?? '0'))) / 100)
  } catch {
    return 'Unavailable'
  }
}

function policyLine(value: unknown): string {
  return Object.entries(record(value)).map(([key, item]) => `${key}: ${String(item)}`).join(' · ')
}

function fixed(value: unknown, digits = 1): string {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}

function warningText(value: string): string {
  return value === 'This preview rebalances current holdings only; it does not discover new constituents.'
    ? 'Legacy preview: regenerate it to run the new strategy-universe opportunity analysis.'
    : value
}

export function CompleteStrategyPanel(handle: Handle<Readonly<{
  data: PortfolioView
  strategies: readonly StrategyOption[]
  busy: boolean
  onAssign(strategyVersionId: string): void
}>>) {
  return () => {
    const current = handle.props.data.strategy[0]
    const currentId = String(current?.strategy_version_id ?? '')
    const profile = record(current?.approved_profile)
    const config = record(profile.config)
    const factor = record(config.factor)
    const construction = record(config.construction)
    const eligibility = record(config.eligibility)
    const rebalance = record(config.rebalance)
    const strategicRebalance = record(config.strategicRebalance)
    return <section mix={panelStyle} aria-labelledby="strategy-title">
      <h2 id="strategy-title">Strategy</h2>
      {current === undefined ? <p>No strategy is assigned.</p> : <article>
        <h3>{String(current.display_name)} · {String(current.horizon)} horizon</h3>
        <p>{String(profile.thesis ?? 'Approved preset strategy')}</p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
          <div><dt style={{ color: palette.muted }}>Version</dt><dd style={{ margin: 0 }}>{String(current.semantic_version)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Benchmark</dt><dd style={{ margin: 0 }}>{String(config.benchmark ?? 'Unavailable')}</dd></div>
          <div><dt style={{ color: palette.muted }}>Decision timing</dt><dd style={{ margin: 0 }}>Finalized EOD data</dd></div>
          <div><dt style={{ color: palette.muted }}>Execution timing</dt><dd style={{ margin: 0 }}>Later-session CNC</dd></div>
          <div><dt style={{ color: palette.muted }}>Validation</dt><dd style={{ margin: 0 }}>{String(profile.validationStatus ?? 'Unavailable')}</dd></div>
          <div><dt style={{ color: palette.muted }}>Effective</dt><dd style={{ margin: 0 }}>{String(current.effective_at)}</dd></div>
        </dl>
        <h3>Factors and construction</h3>
        <p><strong>Factor mix:</strong> Momentum {Number(factor.momentumWeight ?? 0) * 100}% · Quality {Number(factor.qualityWeight ?? 0) * 100}% · Low risk {Number(factor.lowRiskWeight ?? 0) * 100}%</p>
        <p><strong>Opportunity research model:</strong> Price momentum 35% · financial quality 20% · earnings/results momentum 15% · sector strength 10% · verified catalysts 10% · low risk 10%. This separate versioned model does not change the immutable preset above.</p>
        <p><strong>Construction:</strong> Target {String(construction.targetHoldings ?? '—')} holdings · maximum {String(construction.maxHoldings ?? '—')} · cash buffer {String(construction.cashBufferPct ?? '—')}% · replacement hurdle {String(construction.replacementScoreGapPct ?? '—')}%</p>
        <p><strong>Eligibility:</strong> Entry rank {String(eligibility.entryRank ?? '—')} · hold rank {String(eligibility.holdRank ?? '—')} · forced review {String(eligibility.forcedReviewRank ?? '—')} · stock weight {String(eligibility.minStockWeightPct ?? '—')}–{String(eligibility.maxStockWeightPct ?? '—')}%</p>
        <h3>Rebalance, risk and tax</h3>
        <p><strong>Cadence:</strong> Routine {String(rebalance.routineFrequency ?? '—')} · drift review {String(rebalance.driftReviewFrequency ?? '—')} · preferred hold {String(rebalance.preferredMinHoldDays ?? '—')} days · daily turnover cap {String(rebalance.maxDailyTurnoverPct ?? '—')}%</p>
        {Object.keys(strategicRebalance).length === 0 ? null : <p><strong>Strategic timing:</strong> {String(strategicRebalance.primaryHorizonMonths)}-month {String(strategicRebalance.riskBenchmark)} minus {String(strategicRebalance.defensiveBenchmark)} trend · {Number(strategicRebalance.permittedRebalanceFraction ?? 0) * 100}% normal rebalance · {Number(strategicRebalance.negativeTrendBuyFraction ?? 0) * 100}% buys during confirmed negative trend · {String(strategicRebalance.mode)} only.</p>}
        <p><strong>Risk:</strong> {policyLine(config.risk)}</p>
        <p><strong>Tax assumptions:</strong> {policyLine(config.tax)}</p>
        <details><summary>Immutable configuration and lineage</summary><p>Config hash: <code>{String(profile.configHash ?? 'Unavailable')}</code></p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(config, null, 2)}</pre></details>
      </article>}
      <form
        mix={on('submit', (event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          handle.props.onAssign(String(values.get('strategyVersionId') ?? ''))
        })}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '12px', borderTop: `1px solid ${palette.border}`, paddingTop: '16px', marginTop: '18px' }}
      >
        <label style={{ minWidth: '280px', flex: 1 }}>Assign approved horizon preset<select mix={fieldStyle} name="strategyVersionId" defaultValue={currentId}>{handle.props.strategies.map((strategy) => <option key={strategy.strategyVersionId} value={strategy.strategyVersionId}>{strategy.displayName} · {strategy.horizon} · v{strategy.semanticVersion}</option>)}</select></label>
        <button mix={buttonStyle} type="submit" disabled={handle.props.busy}>{handle.props.busy ? 'Assigning…' : 'Assign strategy'}</button>
      </form>
      <p style={{ color: palette.muted }}>Changing strategy advances the portfolio snapshot and makes any earlier preview stale. It never enables live execution.</p>
    </section>
  }
}

function blockerText(blocker: string): string {
  if (blocker === 'PREVIEW_NOT_GENERATED') return 'Generate the first quote-backed research preview.'
  if (blocker === 'PORTFOLIO_SNAPSHOT_CHANGED') return 'Generate a new preview because holdings or strategy changed.'
  return blocker
}

function timedTarget(action: PortfolioView['rebalance']['plans'][number]['actions'][number]): bigint {
  if (action.timedTargetQuantity !== undefined) return BigInt(action.timedTargetQuantity)
  if (action.preTimingTargetQuantity === undefined) return BigInt(action.targetQuantity)
  const current = BigInt(action.currentQuantity)
  const delta = BigInt(action.preTimingTargetQuantity) - current
  const fractionPpm = BigInt(Math.round(Number(action.strategicTimingFraction ?? 0) * 1_000_000))
  return current + delta * fractionPpm / 1_000_000n
}

function actionExplanation(action: PortfolioView['rebalance']['plans'][number]['actions'][number]): string {
  if (action.isNewOpportunity && BigInt(action.targetQuantity) === 0n && BigInt(action.delayedQuantity ?? '0') > 0n) {
    return `Do not open this holding in the current session; ${action.delayedQuantity} shares are delayed by strategic trend timing. ${action.explanation.replace(/^Open a new holding with 0 shares\.\s*/u, '')}`
  }
  return action.explanation
}

function PaperExitAction(handle: Handle<Readonly<{
  instrumentId: string
  quantity: string
  kind: 'PLANNED' | 'MANUAL_RISK'
  busy: boolean
  onExit(input: Readonly<{ instrumentId: string; quantity: string }>): void
}>>) {
  return () => BigInt(handle.props.quantity) <= 0n ? null : <details style={{ marginTop: '6px' }}>
    <summary>{handle.props.kind === 'PLANNED' ? 'Execute planned PAPER sale' : 'Manual staged PAPER reduction'}</summary>
    <form mix={on('submit', (event) => {
      event.preventDefault()
      handle.props.onExit({ instrumentId: handle.props.instrumentId, quantity: handle.props.quantity })
    })} style={{ minWidth: '190px', paddingTop: '6px' }}>
      <small>{handle.props.kind === 'PLANNED'
        ? `Sell the planned ${handle.props.quantity} shares using a fresh server quote.`
        : `Sell the timed ${handle.props.quantity}-share reduction as a manual risk override outside this staged plan. This bypasses only the plan's turnover staging.`}</small>
      <label style={{ display: 'block', margin: '6px 0' }}><input type="checkbox" required /> {handle.props.kind === 'PLANNED' ? 'Confirm planned PAPER sale' : 'Confirm manual staged PAPER reduction'}</label>
      <button mix={buttonStyle} type="submit" disabled={handle.props.busy}>{handle.props.busy ? 'Processing…' : handle.props.kind === 'PLANNED' ? 'Execute planned sale' : 'Execute timed reduction now'}</button>
    </form>
  </details>
}

export function CompleteRebalancePanel(handle: Handle<Readonly<{
  data: PortfolioView
  busy: boolean
  onGenerate(): void
  onReview(): void
  onExit(input: Readonly<{ instrumentId: string; quantity: string }>): void
}>>) {
  return () => {
    const blockers = handle.props.data.rebalance.blockers
    const plan = handle.props.data.rebalance.plans[0]
    const summary = record(plan?.summary)
    const strategic = plan?.strategicRebalance
    return <section mix={panelStyle} aria-labelledby="rebalance-title">
      <h2 id="rebalance-title">Rebalance analysis and preview</h2>
      <p><strong>Status:</strong> {handle.props.data.rebalance.status}</p>
      <p>Portfolio snapshot v{handle.props.data.portfolioSnapshot.stateVersion} · {plan === undefined ? 'No preview generated' : `plan ${plan.planId}`}</p>
      {blockers.length === 0 ? null : <><h3>What is still required</h3><ul>{blockers.map((blocker) => <li key={blocker}>{blockerText(blocker)}</li>)}</ul></>}
      {plan === undefined ? null : <>
        <div role="note" style={{ borderLeft: `5px solid ${palette.amber}`, padding: '10px 14px', background: '#0d1420' }}><strong>Research-data boundary:</strong> NSE constituents and Yahoo history/fundamentals support PAPER research only. This plan cannot authorize live broker execution.</div>
        <p style={{ color: palette.muted }}><strong>Universe:</strong> {plan.marketData.indexUniverse ?? 'Legacy holding-only preview'} · {plan.marketData.constituentCount === undefined ? `${plan.marketData.quoteCount ?? '—'} quotes` : `${plan.marketData.constituentCount}/${plan.marketData.constituentCount} pre-screened`} · {plan.marketData.analyzedCount ?? plan.marketData.quoteCount ?? '—'} analyzed in detail · {plan.marketData.eligibleCount ?? '—'} eligible · benchmark {plan.marketData.benchmark ?? '—'}</p>
        <p style={{ color: palette.muted }}><strong>Research model:</strong> {plan.marketData.researchModelVersion ?? 'Legacy three-factor model'} · momentum 35% · quality 20% · earnings/results 15% · sector 10% · verified catalysts 10% · low risk 10%</p>
        <p style={{ color: palette.muted }}><strong>Catalyst scan coverage:</strong> {fixed(plan.marketData.catalystScanCoveragePct)}% of detailed candidates. A zero catalyst score after a completed scan means no qualifying verified event, not missing data.</p>
        {strategic === undefined ? null : <article style={{ border: `1px solid ${strategic.state === 'NEGATIVE_CONFIRMED' ? palette.amber : strategic.approvalBlocked ? palette.red : palette.border}`, padding: '12px 14px', marginTop: '14px' }}>
          <h3 style={{ marginTop: 0 }}>Strategic rebalance: {strategic.state}</h3>
          <p>{strategic.headline}</p>
          <p><strong>Benchmarks:</strong> {strategic.riskBenchmark} minus {strategic.defensiveBenchmark} · decision session {strategic.decisionSessionDate} · normal fraction {fixed(strategic.permittedRebalanceFraction * 100)}% · applied buy fraction {fixed(strategic.appliedBuyFraction * 100)}%</p>
          {strategic.defensiveProxy === undefined ? null : <p style={{ color: palette.muted }}><strong>History extension:</strong> {strategic.defensiveProxy.symbol} supplies {strategic.defensiveProxy.extendedObservations} rebased Indian government-securities observations before {strategic.defensiveBenchmark} history starts on {strategic.defensiveProxy.primaryHistoryStartsOn}. Recent data remains {strategic.defensiveBenchmark}.</p>}
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>Horizon</th><th>Risk</th><th>Defensive</th><th>Relative</th><th>Baseline</th><th>Excess</th><th>State</th></tr></thead><tbody>{strategic.horizons.map((horizon) => <tr key={horizon.months}><td>{horizon.months}m</td><td>{fixed(horizon.riskReturn * 100, 2)}%</td><td>{fixed(horizon.defensiveReturn * 100, 2)}%</td><td>{fixed(horizon.relativeReturn * 100, 2)}%</td><td>{fixed(horizon.pointInTimeBaseline * 100, 2)}%</td><td>{fixed(horizon.relativeExcess * 100, 2)}%</td><td>{horizon.negative ? 'Negative' : 'Positive'}</td></tr>)}</tbody></table></div>
          <p><strong>Delayed buys:</strong> {inr(strategic.delayedBuyMinorUnits)} · <strong>cash retained:</strong> {inr(strategic.retainedCashMinorUnits)}{strategic.delayStartedOn ? ` · delay started ${strategic.delayStartedOn}` : ''}{strategic.forcedReviewOn ? ` · forced review ${strategic.forcedReviewOn}` : ''}</p>
          <p><strong>Safety:</strong> Mandatory exits are never delayed.{strategic.blockerCodes.length ? ` Approval blockers: ${strategic.blockerCodes.join(', ')}.` : ''}</p>
        </article>}
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', marginTop: '18px' }}>
          <div><dt style={{ color: palette.muted }}>Portfolio NAV</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.navMinorUnits)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Gross buys</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.grossBuyMinorUnits)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Gross sells</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.grossSellMinorUnits)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Estimated charges</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.estimatedChargesMinorUnits)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Estimated tax</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.estimatedTaxMinorUnits)}</dd></div>
          <div><dt style={{ color: palette.muted }}>Projected cash</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.projectedCashMinorUnits)}</dd></div>
        </dl>
        <div style={{ overflowX: 'auto', marginTop: '18px' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th scope="col">Instrument</th><th scope="col">Rank / score</th><th scope="col">Action / incremental quantity</th><th scope="col">Existing → session / strategic</th><th scope="col">Current → target weight</th><th scope="col">Price</th><th scope="col">Costs</th><th scope="col">Explanation</th></tr></thead>
          <tbody>{plan.actions.map((action) => {
            const planIsCurrent = plan.portfolioStateVersion === handle.props.data.portfolioSnapshot.stateVersion
            const plannedExitQuantity = !planIsCurrent
              ? '0'
              : BigInt(action.deltaQuantity) < 0n ? (-BigInt(action.deltaQuantity)).toString() : '0'
            const intendedTimedTarget = timedTarget(action)
            const canManuallyReduce = action.exitRiskLevel === 'EXIT' || action.exitRiskLevel === 'REDUCE'
            const manualRiskExitQuantity = !planIsCurrent || BigInt(action.deltaQuantity) < 0n || !canManuallyReduce || intendedTimedTarget >= BigInt(action.currentQuantity)
              ? '0' : (BigInt(action.currentQuantity) - intendedTimedTarget).toString()
            return <tr key={action.instrumentId}><td>{action.instrumentId}{action.isNewOpportunity && <><br /><small>New opportunity</small></>}{action.exitRiskLevel && action.exitRiskLevel !== 'NONE' && <><br /><strong style={{ color: action.exitRiskLevel === 'EXIT' ? palette.red : action.exitRiskLevel === 'REDUCE' ? palette.amber : '#60a5fa' }}>{action.mandatoryExit ? 'EXIT REQUIRED' : action.exitRiskLevel}</strong></>}</td><td>{action.strategyRank ?? '—'} / {fixed(action.strategyScore)}<br /><small>{fixed(action.dataCoveragePct)}% data</small></td><td><strong>{action.presentationAction ?? action.action}</strong><br /><small>{BigInt(action.deltaQuantity) > 0n ? '+' : ''}{action.deltaQuantity} shares</small>{BigInt(action.delayedQuantity ?? '0') > 0n && <><br /><small>{action.delayedQuantity} shares delayed ({inr(action.delayedNotionalMinorUnits)})</small></>}<PaperExitAction instrumentId={action.instrumentId} quantity={plannedExitQuantity} kind="PLANNED" busy={handle.props.busy} onExit={handle.props.onExit} /><PaperExitAction instrumentId={action.instrumentId} quantity={manualRiskExitQuantity} kind="MANUAL_RISK" busy={handle.props.busy} onExit={handle.props.onExit} /></td><td>{action.currentQuantity} → {action.targetQuantity} / {action.strategicTargetQuantity ?? action.targetQuantity}{action.preTimingTargetQuantity && <><br /><small>Pre-timing {action.preTimingTargetQuantity} · fraction {fixed(Number(action.strategicTimingFraction ?? 0) * 100)}%</small></>}{action.stagedByTurnoverLimit && <><br /><small>Timed target {intendedTimedTarget.toString()} · turnover staged</small></>}{action.stagedByNoTradeBand && <><br /><small>No-trade band</small></>}{action.protectedByMinimumHold && <><br /><small>Minimum hold protected</small></>}</td><td>{fixed(Number(action.currentWeightPpm) / 10_000, 2)}% → {fixed(Number(action.targetWeightPpm) / 10_000, 2)}%</td><td>{inr(action.livePriceMinorUnits)}</td><td>{inr(action.estimatedChargesMinorUnits)}<br /><small>Tax {inr(action.estimatedTaxMinorUnits)}</small></td><td><small>{action.reasonCode}{action.strategicTimingReasonCode ? ` / ${action.strategicTimingReasonCode}` : ''}<br />{actionExplanation(action)}</small></td></tr>
          })}</tbody>
        </table></div>
        <h3>Top strategy candidates</h3>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>Rank</th><th>Symbol</th><th>Score</th><th>Momentum</th><th>Quality</th><th>Valuation</th><th>Earnings</th><th>Sector</th><th>Catalyst</th><th>Low risk</th><th>Coverage</th><th>Decision and evidence</th></tr></thead><tbody>{(plan.topCandidates ?? []).map((candidate) => <tr key={candidate.symbol}><td>{candidate.rank}</td><td>{candidate.symbol}<br /><small>{candidate.name}{candidate.sector ? ` · ${candidate.sector}` : ''}</small></td><td>{fixed(candidate.score)}</td><td>{fixed(candidate.momentumScore, 2)}</td><td>{fixed(candidate.qualityScore, 2)}</td><td>{fixed(candidate.valuationScore, 2)}</td><td>{fixed(candidate.earningsScore, 2)}</td><td>{fixed(candidate.sectorScore, 2)}</td><td>{fixed(candidate.catalystScore, 2)}<br /><small>{fixed(candidate.catalystScanCoveragePct)}% scanned</small></td><td>{fixed(candidate.lowRiskScore, 2)}</td><td>{fixed(candidate.dataCoveragePct)}%</td><td>{candidate.selected ? candidate.currentlyHeld ? 'Retain' : 'Add' : 'Watch'}<br /><small>{candidate.selectionReason}{candidate.evidence?.length ? ` ${candidate.evidence.join(' · ')}` : ''}</small></td></tr>)}</tbody></table></div>
        <h3>Warnings</h3><ul>{plan.warnings.map((warning) => <li key={warning}>{warningText(warning)}</li>)}</ul>
        <details><summary>Plan lineage and constraints</summary><p>Plan hash: <code>{plan.planHash}</code></p><p>Strategy hash: <code>{plan.strategyConfigHash}</code></p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(plan.constraints, null, 2)}</pre></details>
      </>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', borderTop: `1px solid ${palette.border}`, paddingTop: '16px', marginTop: '18px' }}>
        <button mix={[buttonStyle, on('click', handle.props.onGenerate)]} type="button" disabled={handle.props.busy || handle.props.data.portfolio.status !== 'ACTIVE'}>{handle.props.busy ? 'Analyzing market…' : plan === undefined ? 'Analyze market and generate' : 'Regenerate strategy preview'}</button>
        {plan === undefined ? null : <button mix={[buttonStyle, on('click', handle.props.onReview)]} type="button" disabled={handle.props.busy}>Open Execution Review</button>}
      </div>
      <p style={{ color: palette.muted }}>Generation screens the configured NSE universe with the versioned six-factor model, applies entry/hold ranks, replacement gaps, cash, tax and daily-turnover constraints, then persists a snapshot-matched PAPER plan.</p>
    </section>
  }
}

function executionTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-IN', {
    dateStyle:'medium', timeStyle:'medium', timeZone:'Asia/Kolkata',
  }).format(date)
}

function renderExecutionHistory(history: NonNullable<PortfolioView['rebalance']['history']>) {
  return <section aria-labelledby="execution-history-title" style={{ borderTop: `1px solid ${palette.border}`, marginTop: '22px', paddingTop: '16px' }}>
    <h3 id="execution-history-title">Execution history</h3>
    {history.length === 0 ? <p style={{ color: palette.muted }}>No completed PAPER rebalance baskets are recorded.</p> : history.map((plan) => {
      const actions = plan.actions.filter((action) => BigInt(action.deltaQuantity) !== 0n)
      const summary = record(plan.summary)
      return <details key={plan.planId} style={{ border: `1px solid ${palette.border}`, borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
        <summary><strong>{executionTime(plan.executedAt)}</strong> · {actions.length} update(s) · buys {inr(summary.grossBuyMinorUnits)} · sells {inr(summary.grossSellMinorUnits)}</summary>
        <p style={{ color: palette.muted }}>Plan {plan.planId} · source snapshot v{plan.portfolioStateVersion} · projected cash {inr(summary.projectedCashMinorUnits)}</p>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th>Instrument</th><th>Completed action</th><th>Before</th><th>Change</th><th>After</th><th>Execution price</th><th>Reason</th></tr></thead>
          <tbody>{actions.map((action) => {
            const current = BigInt(action.currentQuantity)
            const target = BigInt(action.targetQuantity)
            const delta = BigInt(action.deltaQuantity)
            const label = current === 0n && delta > 0n ? 'NEW ENTRY' : delta > 0n ? 'INCREASE' : target === 0n ? 'FULL EXIT' : 'PARTIAL EXIT'
            return <tr key={`${plan.planId}-${action.instrumentId}`}><td>{action.instrumentId}</td><td>{label}</td><td>{action.currentQuantity}</td><td>{delta > 0n ? '+' : ''}{action.deltaQuantity}</td><td>{action.targetQuantity}</td><td>{inr(action.livePriceMinorUnits)}</td><td>{action.reasonCode}</td></tr>
          })}</tbody>
        </table></div>
      </details>
    })}
  </section>
}

export function CompleteExecutionReviewPanel(handle: Handle<Readonly<{
  data: PortfolioView
  busy: boolean
  onExecute(planId: string): void
  onOpenRebalance(): void
}>>) {
  return () => {
    const history = handle.props.data.rebalance.history ?? []
    const plan = handle.props.data.rebalance.status === 'PREVIEW_READY'
      ? handle.props.data.rebalance.plans[0]
      : undefined
    if (plan === undefined) return <section mix={panelStyle} aria-labelledby="execution-review-title">
      <h2 id="execution-review-title">Execution Review</h2>
      <p><strong>No pending execution basket.</strong> Completed transactions are moved to execution history and cannot be applied twice.</p>
      <button mix={[buttonStyle, on('click', handle.props.onOpenRebalance)]} type="button">Open Rebalance</button>
      {renderExecutionHistory(history)}
    </section>
    const blockers = handle.props.data.rebalance.blockers
    const strategic = plan.strategicRebalance
    const canExecute = handle.props.data.rebalance.status === 'PREVIEW_READY'
      && handle.props.data.portfolio.operating_mode === 'PAPER'
      && blockers.length === 0
      && strategic?.approvalBlocked !== true
    const holdingUpdates = plan.actions.filter((action) => BigInt(action.deltaQuantity) !== 0n)
    const updateCounts = holdingUpdates.reduce((counts, action) => {
      const current = BigInt(action.currentQuantity)
      const target = BigInt(action.targetQuantity)
      const delta = BigInt(action.deltaQuantity)
      if (current === 0n && delta > 0n) counts.entries += 1
      else if (delta > 0n) counts.increases += 1
      else if (target === 0n) counts.exits += 1
      else counts.reductions += 1
      return counts
    }, { entries:0, increases:0, reductions:0, exits:0 })
    const summary = record(plan.summary)
    return <section mix={panelStyle} aria-labelledby="execution-review-title">
      <h2 id="execution-review-title">Execution Review</h2>
      <p><strong>Status:</strong> {handle.props.data.rebalance.status} · plan {plan.planId} · portfolio snapshot v{plan.portfolioStateVersion}</p>
      <div role="note" style={{ borderLeft: `5px solid ${palette.amber}`, padding: '10px 14px', background: '#0d1420' }}><strong>PAPER only:</strong> Executing this basket updates simulated holdings, tax lots and cash. It never submits a live broker order.</div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px', marginTop: '18px' }}>
        <div><dt style={{ color: palette.muted }}>Updates</dt><dd style={{ margin: 0, fontWeight: 800 }}>{holdingUpdates.length}</dd></div>
        <div><dt style={{ color: palette.muted }}>Gross buys</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.grossBuyMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Gross sells</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.grossSellMinorUnits)}</dd></div>
        <div><dt style={{ color: palette.muted }}>Charges and tax</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(BigInt(String(summary.estimatedChargesMinorUnits ?? '0')) + BigInt(String(summary.estimatedTaxMinorUnits ?? '0')))}</dd></div>
        <div><dt style={{ color: palette.muted }}>Projected cash</dt><dd style={{ margin: 0, fontWeight: 800 }}>{inr(summary.projectedCashMinorUnits)}</dd></div>
      </dl>
      <h3>Holding updates</h3>
      <p><strong>{updateCounts.entries}</strong> new entries · <strong>{updateCounts.increases}</strong> increases · <strong>{updateCounts.reductions}</strong> partial exits · <strong>{updateCounts.exits}</strong> full exits.</p>
      {holdingUpdates.length === 0 ? <p>No quantity changes are required.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th>Instrument</th><th>Action</th><th>Current</th><th>Change</th><th>After execution</th><th>Estimated value</th><th>Reason</th></tr></thead>
        <tbody>{holdingUpdates.map((action) => {
          const current = BigInt(action.currentQuantity)
          const target = BigInt(action.targetQuantity)
          const delta = BigInt(action.deltaQuantity)
          const label = current === 0n && delta > 0n ? 'NEW ENTRY' : delta > 0n ? 'INCREASE' : target === 0n ? 'FULL EXIT' : 'PARTIAL EXIT'
          const value = (delta < 0n ? -delta : delta) * BigInt(action.livePriceMinorUnits)
          return <tr key={action.instrumentId}><td>{action.instrumentId}</td><td><strong style={{ color: delta < 0n ? palette.amber : palette.green }}>{label}</strong></td><td>{action.currentQuantity}</td><td>{delta > 0n ? '+' : ''}{action.deltaQuantity}</td><td>{action.targetQuantity}</td><td>{inr(value)}</td><td><small>{action.reasonCode}<br />{action.explanation}</small></td></tr>
        })}</tbody>
      </table></div>}
      {blockers.length === 0 ? null : <><h3>Execution blockers</h3><ul>{blockers.map((blocker) => <li key={blocker}>{blockerText(blocker)}</li>)}</ul></>}
      <form mix={on('submit', (event) => { event.preventDefault(); handle.props.onExecute(plan.planId) })} style={{ borderTop: `1px solid ${palette.border}`, marginTop: '18px', paddingTop: '16px' }}>
        <label style={{ display: 'block', marginBottom: '10px' }}><input type="checkbox" required disabled={!canExecute || handle.props.busy} /> I reviewed every entry, increase, reduction and exit and confirm PAPER execution</label>
        <button mix={buttonStyle} type="submit" disabled={!canExecute || handle.props.busy}>{handle.props.busy ? 'Executing…' : 'Execute Complete PAPER Basket'}</button>
      </form>
      {!canExecute ? <p style={{ color: palette.muted }}>Execution requires an active PAPER portfolio, a current snapshot-matched preview, and no blockers. An already executed plan cannot be applied twice.</p> : null}
      {renderExecutionHistory(history)}
    </section>
  }
}
