import { on, type Handle } from 'remix/ui'

import type { PortfolioListItem, StrategyOption, WorkspaceView } from '../types/views.ts'
import { buttonStyle, fieldStyle, palette, panelStyle } from './styles.ts'

export function SafetyStatus(handle: Handle<Readonly<{ mode: string; status: string }>>) {
  return () => {
    const label = handle.props.status === 'ARCHIVED'
      ? 'Archived — all new activity is blocked'
      : handle.props.mode === 'LIVE'
        ? 'Live execution — real orders may be sent'
        : handle.props.mode === 'RESTRICTED_AUTO'
          ? 'Restricted automation — policy limits apply'
          : handle.props.mode === 'APPROVAL_REQUIRED'
            ? 'Approval required before execution'
            : handle.props.mode === 'RECOMMENDATION'
              ? 'Recommendations only — no order authority'
              : handle.props.mode === 'PAPER'
                ? 'Paper mode — simulated execution only'
                : 'Observe mode — read only'
    const tone = handle.props.status === 'ARCHIVED' || handle.props.mode === 'LIVE'
      ? palette.red
      : handle.props.mode === 'PAPER' || handle.props.mode === 'OBSERVE'
        ? palette.green
        : palette.amber
    return <div role="status" style={{ borderLeft: `5px solid ${tone}`, padding: '10px 14px', background: '#0d1420' }}><strong>Safety state:</strong> {label}</div>
  }
}

export function PortfolioSelector(handle: Handle<Readonly<{
  portfolios: readonly PortfolioListItem[]
  selectedId?: string
  onSelect(portfolioId: string): void
}>>) {
  return () => (
    <label style={{ display: 'grid', gap: '6px', minWidth: '260px' }}>
      <span style={{ fontWeight: 700 }}>Selected portfolio</span>
      <select
        mix={[fieldStyle, on('change', (event) => handle.props.onSelect(event.currentTarget.value))]}
        value={handle.props.selectedId ?? ''}
      >
        <option value="" disabled>Choose a portfolio</option>
        {handle.props.portfolios.map((item) => (
          <option key={item.portfolioId} value={item.portfolioId}>{item.displayName} — {item.status}</option>
        ))}
      </select>
    </label>
  )
}

export function CreatePortfolioForm(handle: Handle<Readonly<{
  strategies: readonly StrategyOption[]
  busy: boolean
  onCreate(input: Readonly<{
    displayName: string
    startingCashRupees: string
    mode: 'OBSERVE' | 'PAPER' | 'RECOMMENDATION'
    strategyVersionId: string
  }>): void
}>>) {
  return () => (
    <details mix={panelStyle}>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Create portfolio</summary>
      <form
        mix={on('submit', (event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          handle.props.onCreate({
            displayName: String(values.get('displayName') ?? ''),
            startingCashRupees: String(values.get('startingCashRupees') ?? ''),
            mode: String(values.get('mode') ?? 'PAPER') as 'OBSERVE' | 'PAPER' | 'RECOMMENDATION',
            strategyVersionId: String(values.get('strategyVersionId') ?? ''),
          })
        })}
        style={{ display: 'grid', gap: '14px', marginTop: '18px' }}
      >
        <label>Name<input mix={fieldStyle} name="displayName" required minLength={1} maxLength={120} /></label>
        <label>Starting cash (INR)<input mix={fieldStyle} name="startingCashRupees" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label>Safety mode<select mix={fieldStyle} name="mode" defaultValue="PAPER">
          <option value="OBSERVE">Observe — read only</option>
          <option value="PAPER">Paper — simulated</option>
          <option value="RECOMMENDATION">Recommendation — no orders</option>
        </select></label>
        <label>Horizon strategy<select mix={fieldStyle} name="strategyVersionId" required>
          {handle.props.strategies.map((item) => (
            <option key={item.strategyVersionId} value={item.strategyVersionId}>{item.displayName} · {item.horizon} · v{item.semanticVersion}</option>
          ))}
        </select></label>
        <p style={{ color: palette.muted, margin: 0 }}>Approval-required, restricted-auto, and live modes require separate server-side evidence and cannot be self-enabled here.</p>
        <button mix={buttonStyle} type="submit" disabled={handle.props.busy || handle.props.strategies.length === 0}>{handle.props.busy ? 'Creating…' : 'Create isolated portfolio'}</button>
      </form>
    </details>
  )
}

export function ImportHoldingForm(handle: Handle<Readonly<{
  busy: boolean
  disabled: boolean
  onImport(input: Readonly<{
    instrumentId: string
    quantity: string
    unitCostRupees: string
    acquiredOn: string
  }>): void
}>>) {
  return () => (
    <details mix={panelStyle} open>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Import a delivery holding</summary>
      <form
        mix={on('submit', (event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          handle.props.onImport({
            instrumentId: String(values.get('instrumentId') ?? ''),
            quantity: String(values.get('quantity') ?? ''),
            unitCostRupees: String(values.get('unitCostRupees') ?? ''),
            acquiredOn: String(values.get('acquiredOn') ?? ''),
          })
        })}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end', gap: '14px', marginTop: '18px' }}
      >
        <label>Instrument ID<input mix={fieldStyle} name="instrumentId" required maxLength={128} placeholder="NSE:RELIANCE" autoCapitalize="characters" /></label>
        <label>Delivery quantity<input mix={fieldStyle} name="quantity" inputMode="numeric" required pattern="[1-9][0-9]*" /></label>
        <label>Average unit cost (INR)<input mix={fieldStyle} name="unitCostRupees" inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,2})?" /></label>
        <label>Acquired on<input mix={fieldStyle} name="acquiredOn" type="date" required /></label>
        <button mix={buttonStyle} type="submit" disabled={handle.props.busy || handle.props.disabled}>{handle.props.busy ? 'Importingâ€¦' : 'Import and version snapshot'}</button>
      </form>
      <p style={{ color: palette.muted, marginBottom: 0 }}>Each import creates one tax lot. Existing instruments cannot be imported twice; use broker reconciliation for later adjustments.</p>
    </details>
  )
}

const views: readonly Readonly<{ key: WorkspaceView; label: string }>[] = Object.freeze([
  { key: 'overview', label: 'Overview' },
  { key: 'holdings', label: 'Holdings' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'rebalance', label: 'Rebalance' },
  { key: 'execution', label: 'Execution Review' },
  { key: 'performance', label: 'Performance' },
  { key: 'operations', label: 'Operations' },
])

export function PortfolioNavigation(handle: Handle<Readonly<{
  portfolioId: string
  view: WorkspaceView
  onNavigate(view: WorkspaceView): void
}>>) {
  return () => (
    <nav aria-label="Portfolio workspace" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {views.map((item) => {
        const href = `/portfolio/${encodeURIComponent(handle.props.portfolioId)}${item.key === 'overview' ? '' : `/${item.key}`}`
        return (
          <a
            key={item.key}
            href={href}
            aria-current={handle.props.view === item.key ? 'page' : undefined}
            mix={on('click', (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              handle.props.onNavigate(item.key)
            })}
            style={{ color: handle.props.view === item.key ? '#07101d' : palette.ink, background: handle.props.view === item.key ? palette.blue : '#1d2838', borderRadius: '8px', padding: '10px 14px', fontWeight: 700, textDecoration: 'none' }}
          >{item.label}</a>
        )
      })}
    </nav>
  )
}
