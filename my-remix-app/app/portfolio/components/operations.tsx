import { on, type Handle } from 'remix/ui'

import type { SharekhanBrokerPortfolio } from '../api/client.ts'
import type { PortfolioSession, PortfolioView } from '../types/views.ts'
import { buttonStyle, fieldStyle, palette, panelStyle } from './styles.ts'

type Row = Readonly<Record<string, unknown>>

function rows(value: unknown): readonly Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => typeof item === 'object' && item !== null) : []
}

function time(value: unknown): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('en-IN') : 'Not recorded'
}

function tone(value: unknown): string {
  const state = String(value ?? 'UNKNOWN')
  if (['HEALTHY', 'SUCCEEDED', 'CLOSED', 'VALID'].includes(state)) return palette.green
  if (['DEGRADED', 'RUNNING', 'CONTAINED'].includes(state)) return palette.amber
  return palette.red
}

export function CompleteOperationsPanel(handle: Handle<Readonly<{
  data?: unknown
  denied?: boolean
  session: PortfolioSession
  busy: boolean
  portfolio: PortfolioView
  sharekhanBrokerPortfolio?: SharekhanBrokerPortfolio
  enrollment?: Readonly<{ secret: string; otpauthUri: string; qrDataUrl: string; expiresAtEpochMs: number }>
  onBeginMfa(): void
  onConfirmMfa(code: string): void
  onLogout(): void
  onRefresh(): void
  onRun(action: 'health' | 'backup' | 'restore-preflight' | 'recovery-scan'): void
  onOpenIncident(input: Readonly<{ severity: 'SEV1' | 'SEV2' | 'SEV3'; code: string; correlationId: string }>): void
  onCloseIncident(incidentId: string, actionCodes: readonly string[]): void
  onLoadSharekhan(): void
  onApplySharekhan(fallbackAcquiredOn: string): void
}>>) {
  return () => {
    if (handle.props.denied) return <MfaGate {...handle.props} />
    const data = (typeof handle.props.data === 'object' && handle.props.data !== null ? handle.props.data : {}) as Row
    const operations = (typeof data.operations === 'object' && data.operations !== null ? data.operations : {}) as Row
    const database = (typeof data.database === 'object' && data.database !== null ? data.database : {}) as Row
    const health = (typeof operations.health === 'object' && operations.health !== null ? operations.health : {}) as Row
    const jobs = rows(operations.jobs)
    const components = rows(health.components)
    const backups = rows(operations.backups)
    const incidents = rows(operations.incidents)
    const alerts = [...rows(operations.alerts), ...rows(data.securityAlerts)]
    return <section mix={panelStyle} aria-labelledby="operations-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div><h2 id="operations-title" style={{ marginBottom: '4px' }}>Operations and safety</h2><p style={{ color: palette.muted, marginTop: 0 }}>Bounded PAPER controls. No live execution or destructive restore.</p></div>
        <button mix={[buttonStyle, on('click', handle.props.onRefresh)]} type="button" disabled={handle.props.busy}>Refresh dashboard</button>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        <Status label="Database" value={`${String(database.state ?? 'UNKNOWN')} · schema ${String(database.schemaVersion ?? 'n/a')}`} state={database.state} />
        <Status label="Operations" value={String(health.state ?? 'UNKNOWN')} state={health.state} />
        <Status label="Audit chain" value={database.operationsAuditValid === false ? 'BLOCKED' : 'VALID'} state={database.operationsAuditValid === false ? 'BLOCKED' : 'VALID'} />
        <Status label="Alerts" value={String(alerts.length)} state={alerts.length === 0 ? 'VALID' : 'DEGRADED'} />
      </dl>
      <h3>Operator actions</h3>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Action busy={handle.props.busy} label="Run health check" run={() => handle.props.onRun('health')} />
        <Action busy={handle.props.busy} label="Create verified backup" run={() => handle.props.onRun('backup')} />
        <Action busy={handle.props.busy || backups.length === 0} label="Run restore preflight" run={() => handle.props.onRun('restore-preflight')} />
        <Action busy={handle.props.busy} label="Scan incomplete jobs" run={() => handle.props.onRun('recovery-scan')} />
      </div>
      <SharekhanReconciliation
        busy={handle.props.busy}
        portfolio={handle.props.portfolio}
        snapshot={handle.props.sharekhanBrokerPortfolio}
        history={rows(data.brokerReconciliation)}
        onLoad={handle.props.onLoadSharekhan}
        onApply={handle.props.onApplySharekhan}
      />
      <Table title="Component health" empty="Run a health check to record component status." columns={['component', 'criticality', 'state', 'code', 'checkedAt']} data={components} />
      <Table title="Jobs" empty="No operator jobs have run yet." columns={['jobKey', 'state', 'trigger', 'attempt', 'resultCode', 'completedAt']} data={jobs} />
      <Table title="Verified backups" empty="No verified backup receipt is stored." columns={['backupId', 'createdAt', 'schemaVersion', 'verifiedEventStreams', 'destination']} data={backups} />
      <Incidents busy={handle.props.busy} data={incidents} onOpen={handle.props.onOpenIncident} onClose={handle.props.onCloseIncident} />
      <Table title="Alerts" empty="No security or operations alerts." columns={['severity', 'category', 'detailCode', 'correlationId', 'createdAt']} data={alerts} />
      <Table title="Audit explanations" empty="No operations audit decisions recorded." columns={['eventType', 'reasonCode', 'explanation', 'createdAt']} data={rows(operations.audit)} />
    </section>
  }
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function SharekhanReconciliation(handle: Handle<Readonly<{
  busy: boolean
  portfolio: PortfolioView
  snapshot?: SharekhanBrokerPortfolio
  history: readonly Row[]
  onLoad(): void
  onApply(fallbackAcquiredOn: string): void
}>>) {
  return () => {
    const snapshot = handle.props.snapshot?.portfolio
    const brokerHoldings = snapshot?.holdings.list.filter((holding) => holding.qty > 0) ?? []
    const brokerByInstrument = new Map(brokerHoldings.map((holding) => [`NSE:${holding.symbol.trim().toUpperCase()}`, holding]))
    const lotsByHolding = new Map<string, readonly Readonly<Record<string, string | number>>[]>()
    for (const holding of handle.props.portfolio.holdings) {
      const holdingId = String(holding.holding_id)
      lotsByHolding.set(holdingId, handle.props.portfolio.lots.filter((lot) => String(lot.holding_id) === holdingId))
    }
    const comparison: Row[] = brokerHoldings.map((brokerHolding) => {
      const instrumentId = `NSE:${brokerHolding.symbol.trim().toUpperCase()}`
      const local = handle.props.portfolio.holdings.find((holding) => String(holding.instrument_id) === instrumentId)
      const localQuantity = local === undefined ? 0 : Number(local.total_quantity)
      const localLots = local === undefined ? [] : lotsByHolding.get(String(local.holding_id)) ?? []
      const localCost = localLots.reduce((sum, lot) => sum + Number(lot.open_quantity) * Number(lot.unit_cost_minor_units), 0)
      const localAverage = localQuantity === 0 ? 0 : localCost / localQuantity / 100
      const quantityMatches = localQuantity === brokerHolding.qty
      const costMatches = Math.abs(localAverage - brokerHolding.avgPrice) < 0.005
      return Object.freeze({
        instrument: instrumentId,
        action: local === undefined ? 'ADD' : quantityMatches && costMatches ? 'MATCH' : 'REPLACE',
        localQty: localQuantity,
        brokerQty: brokerHolding.qty,
        localAvg: money(localAverage),
        brokerAvg: money(brokerHolding.avgPrice),
      })
    })
    for (const local of handle.props.portfolio.holdings) {
      const instrumentId = String(local.instrument_id)
      if (!brokerByInstrument.has(instrumentId)) comparison.push(Object.freeze({
        instrument: instrumentId, action: 'REMOVE', localQty: Number(local.total_quantity), brokerQty: 0,
        localAvg: '—', brokerAvg: '—',
      }))
    }
    const changed = comparison.filter((row) => row.action !== 'MATCH').length
    const missingDates = brokerHoldings.filter((holding) => !holding.acquisitionDate).length
    const zeroCosts = brokerHoldings.filter((holding) => holding.avgPrice === 0).length
    const portfolio = handle.props.portfolio.portfolio
    const canApply = snapshot !== undefined && changed > 0 && portfolio.operating_mode === 'PAPER' && portfolio.status === 'ACTIVE'
    return <section style={{ marginTop: '24px', padding: '18px', border: '1px solid #28415f', borderRadius: '12px', background: '#0a1625' }} aria-labelledby="sharekhan-reconciliation-title">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div><h3 id="sharekhan-reconciliation-title" style={{ margin: 0 }}>Sharekhan broker reconciliation</h3><p style={{ color: palette.muted, marginBottom: 0 }}>Read broker holdings and cash, compare them with <strong>{portfolio.display_name}</strong>, then update this PAPER snapshot only.</p></div>
        <button mix={[buttonStyle, on('click', handle.props.onLoad)]} type="button" disabled={handle.props.busy}>Load broker snapshot</button>
      </div>
      {snapshot === undefined ? <p style={{ color: palette.muted }}>No broker snapshot loaded. This action never places, modifies, or cancels broker orders.</p> : <>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
          <Status label="Broker holdings" value={String(brokerHoldings.length)} state="VALID" />
          <Status label="Changes" value={String(changed)} state={changed === 0 ? 'VALID' : 'DEGRADED'} />
          <Status label="Available cash" value={money(snapshot.funds.availableCash)} state="VALID" />
          <Status label="Captured" value={time(snapshot.asOf)} state="VALID" />
        </dl>
        <Table title="Broker comparison" empty="Broker and local portfolio are empty." columns={['instrument', 'action', 'localQty', 'brokerQty', 'localAvg', 'brokerAvg']} data={comparison} />
        {missingDates > 0 ? <p role="alert" style={{ color: palette.amber }}><strong>Tax-date review:</strong> Sharekhan omitted acquisition dates for {missingDates} holding(s). Enter a verified fallback date; it will be attached only to added or replaced lots.</p> : null}
        {zeroCosts > 0 ? <p role="alert" style={{ color: palette.amber }}><strong>Cost review:</strong> {zeroCosts} broker holding(s) have zero average cost. They will remain zero-cost until corrected from a broker statement.</p> : null}
        <form mix={on('submit', (event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          handle.props.onApply(String(values.get('fallbackAcquiredOn') ?? ''))
        })} style={{ display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap' }}>
          <label>Fallback acquisition date<input mix={fieldStyle} type="date" name="fallbackAcquiredOn" max={new Date().toISOString().slice(0, 10)} required /></label>
          <label style={{ maxWidth: '460px' }}><input type="checkbox" required /> I confirm this date and understand mismatched local lots will be replaced with broker quantity and average cost.</label>
          <button mix={buttonStyle} type="submit" disabled={handle.props.busy || !canApply}>Apply PAPER reconciliation</button>
        </form>
        {changed === 0 ? <p style={{ color: palette.green }}>Broker holdings and local holdings already match on quantity and average cost.</p> : null}
      </>}
      <Table title="Reconciliation history" empty="No Sharekhan reconciliation has been applied." columns={['broker', 'added_count', 'updated_count', 'removed_count', 'unchanged_count', 'applied_at']} data={handle.props.history} />
    </section>
  }
}

function MfaGate(handle: Handle<Readonly<{
  session: PortfolioSession
  busy: boolean
  enrollment?: Readonly<{ secret: string; otpauthUri: string; qrDataUrl: string; expiresAtEpochMs: number }>
  onBeginMfa(): void
  onConfirmMfa(code: string): void
  onLogout(): void
}>>) {
  return () => {
    const canEnroll = handle.props.session.role === 'ADMIN' && !handle.props.session.mfaConfigured
    return <section mix={panelStyle} aria-labelledby="operations-title"><h2 id="operations-title">Operations and safety</h2>
      <p role="alert" style={{ color: palette.amber }}>Verified MFA and operator or administrator access are required.</p>
      <p>Signed in as <strong>{handle.props.session.displayName}</strong> ({handle.props.session.role}).</p>
      {canEnroll ? <><button mix={[buttonStyle, on('click', handle.props.onBeginMfa)]} type="button" disabled={handle.props.busy}>Set up authenticator MFA</button>
        {handle.props.enrollment ? <div style={{ marginTop: '16px', padding: '16px', borderRadius: '10px', background: '#0d1420' }}><h3 style={{ marginTop: 0 }}>Authenticator enrollment</h3><p>Scan this QR code with Microsoft Authenticator, Google Authenticator, 1Password, or another TOTP app:</p><img src={handle.props.enrollment.qrDataUrl} width="240" height="240" alt="Authenticator enrollment QR code" style={{ display: 'block', maxWidth: '100%', background: '#ffffff', borderRadius: '10px', padding: '8px' }} /><p>Cannot scan it? Enter this setup key manually:</p><p><code style={{ overflowWrap: 'anywhere' }}>{handle.props.enrollment.secret}</code></p>
          <form mix={on('submit', (event) => { event.preventDefault(); handle.props.onConfirmMfa(String(new FormData(event.currentTarget).get('code') ?? '')) })} style={{ display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap' }}><label>Current six-digit code<input mix={fieldStyle} name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label><button mix={buttonStyle} disabled={handle.props.busy} type="submit">Confirm MFA</button></form>
          <p style={{ color: palette.muted }}>Expires {time(handle.props.enrollment.expiresAtEpochMs)}. Confirmation signs out every session.</p></div> : null}</>
        : handle.props.session.mfaConfigured && !handle.props.session.mfaVerified ? <><p>Sign out and sign in again with the current authenticator code.</p><button mix={[buttonStyle, on('click', handle.props.onLogout)]} type="button">Sign out</button></>
          : <p>This account lacks privileged access to the selected portfolio.</p>}
    </section>
  }
}

function Status(handle: Handle<Readonly<{ label: string; value: string; state: unknown }>>) {
  return () => <div><dt style={{ color: palette.muted }}>{handle.props.label}</dt><dd style={{ margin: 0, fontWeight: 800, color: tone(handle.props.state) }}>{handle.props.value}</dd></div>
}

function Action(handle: Handle<Readonly<{ busy: boolean; label: string; run(): void }>>) {
  return () => <button mix={[buttonStyle, on('click', handle.props.run)]} disabled={handle.props.busy} type="button">{handle.props.label}</button>
}

function Table(handle: Handle<Readonly<{ title: string; empty: string; columns: readonly string[]; data: readonly Row[] }>>) {
  return () => <details open><summary><strong>{handle.props.title} ({handle.props.data.length})</strong></summary>{handle.props.data.length === 0 ? <p style={{ color: palette.muted }}>{handle.props.empty}</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{handle.props.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{handle.props.data.map((row, index) => <tr key={String(row.runId ?? row.component ?? row.backupId ?? row.auditEventId ?? index)}>{handle.props.columns.map((column) => <td key={column} style={column === 'state' ? { color: tone(row[column]), fontWeight: 800 } : undefined}>{column.endsWith('At') ? time(row[column]) : String(row[column] ?? '—')}</td>)}</tr>)}</tbody></table></div>}</details>
}

function Incidents(handle: Handle<Readonly<{
  busy: boolean
  data: readonly Row[]
  onOpen(input: Readonly<{ severity: 'SEV1' | 'SEV2' | 'SEV3'; code: string; correlationId: string }>): void
  onClose(incidentId: string, actionCodes: readonly string[]): void
}>>) {
  return () => <details open><summary><strong>Incidents ({handle.props.data.length})</strong></summary>
    <form mix={on('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); handle.props.onOpen({ severity: String(values.get('severity')) as 'SEV1' | 'SEV2' | 'SEV3', code: String(values.get('code') ?? '').trim().toUpperCase(), correlationId: String(values.get('correlationId') ?? '').trim() }) })} style={{ display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap', margin: '12px 0' }}>
      <label>Severity<select mix={fieldStyle} name="severity"><option>SEV1</option><option>SEV2</option><option>SEV3</option></select></label><label>Incident code<input mix={fieldStyle} name="code" placeholder="MARKET_DATA_OUTAGE" pattern="[A-Za-z][A-Za-z0-9_]{2,63}" required /></label><label>Correlation ID<input mix={fieldStyle} name="correlationId" defaultValue={`ui-incident-${Date.now()}`} minLength={3} maxLength={128} required /></label><button mix={buttonStyle} disabled={handle.props.busy} type="submit">Open incident</button>
    </form>
    {handle.props.data.length === 0 ? <p style={{ color: palette.muted }}>No incidents recorded.</p> : <ul>{handle.props.data.map((item) => <li key={String(item.incidentId)} style={{ margin: '14px 0' }}><strong style={{ color: tone(item.state) }}>{String(item.severity)} / {String(item.state)}</strong> — {String(item.code)}<br /><small>{String(item.incidentId)} · {time(item.openedAt)}</small>{item.state !== 'CLOSED' ? <form mix={on('submit', (event) => { event.preventDefault(); const actionCodes = String(new FormData(event.currentTarget).get('actionCodes') ?? '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean); handle.props.onClose(String(item.incidentId), actionCodes) })} style={{ display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap', marginTop: '8px' }}><label>Corrective action codes<input mix={fieldStyle} name="actionCodes" placeholder="PROVIDER_RECOVERED,DATA_VERIFIED" required /></label><button mix={buttonStyle} disabled={handle.props.busy} type="submit">Close incident</button></form> : <p>Actions: {Array.isArray(item.actionCodes) ? item.actionCodes.join(', ') : 'Recorded'}</p>}</li>)}</ul>}
  </details>
}
