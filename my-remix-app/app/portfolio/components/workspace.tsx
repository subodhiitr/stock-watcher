import { clientEntry, css, on, type Handle } from 'remix/ui'

import { portfolioApi, PortfolioApiError, type SharekhanBrokerPortfolio } from '../api/client.ts'
import { PortfolioRequestCoordinator } from '../state/request-coordinator.ts'
import {
  portfolioQuoteSymbols,
  type PortfolioMarketSnapshot,
} from '../market/valuation.ts'
import type {
  PortfolioCollection,
  PortfolioSession,
  PortfolioView,
  WorkspaceView,
} from '../types/views.ts'
import { LoginPanel } from './access.tsx'
import {
  CreatePortfolioForm,
  ImportHoldingForm,
  PortfolioNavigation,
  PortfolioSelector,
  SafetyStatus,
} from './controls.tsx'
import {
  HoldingsPanel,
  OverviewPanel,
  PerformancePanel,
} from './panels.tsx'
import { CompleteOperationsPanel } from './operations.tsx'
import { CompleteExecutionReviewPanel, CompleteRebalancePanel, CompleteStrategyPanel } from './strategy-rebalance.tsx'
import { buttonStyle, palette, panelStyle, skipLinkStyle } from './styles.ts'

type WorkspaceProps = Readonly<{
  initialPortfolioId?: string
  initialView: WorkspaceView
}>

function message(error: unknown): string {
  if (error instanceof PortfolioApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again.'
    if (error.status === 403) return 'This account cannot access the requested portfolio or action.'
    if (error.status === 409) return 'That action is already running or used a conflicting request key.'
    if (error.status === 429) return 'Too many requests. Wait briefly and try again.'
  }
  return 'The portfolio request could not be completed.'
}

function rupeesToMinorUnits(value: string): string | undefined {
  if (!/^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,2}))?$/u.test(value)) return undefined
  const [whole = '0', fraction = ''] = value.split('.')
  return String(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')))
}

function formatRupees(minorUnits: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
    .format(Number(BigInt(minorUnits)) / 100)
}

export const PortfolioWorkspace = clientEntry(
  `${import.meta.url}#PortfolioWorkspace`,
  function PortfolioWorkspace(handle: Handle<WorkspaceProps>) {
    const requests = new PortfolioRequestCoordinator()
    const marketRequests = new PortfolioRequestCoordinator()
    let initialized = false
    let configured = true
    let session: PortfolioSession | undefined
    let collection: PortfolioCollection = Object.freeze({ portfolios: [], strategies: [] })
    let selectedId = handle.props.initialPortfolioId
    let currentView = handle.props.initialView
    let data: PortfolioView | undefined
    let operationsData: unknown
    let operationsDenied = false
    let mfaEnrollment: Readonly<{ secret: string; otpauthUri: string; qrDataUrl: string; expiresAtEpochMs: number }> | undefined
    let sharekhanBrokerPortfolio: SharekhanBrokerPortfolio | undefined
    let market: PortfolioMarketSnapshot = Object.freeze({ quotes: {}, loading: false })
    let loading = true
    let busy = false
    let loginBusy = false
    let confirmArchive = false
    let error: string | undefined
    let notice: string | undefined

    handle.signal.addEventListener('abort', () => {
      requests.cancel()
      marketRequests.cancel()
    })

    function portfolioPath(portfolioId: string, view: WorkspaceView): string {
      return `/portfolio/${encodeURIComponent(portfolioId)}${view === 'overview' ? '' : `/${view}`}`
    }

    async function loadMarketQuotes(view: PortfolioView): Promise<void> {
      const symbols = portfolioQuoteSymbols(view)
      if (symbols.length === 0) {
        market = Object.freeze({ quotes: {}, loading: false })
        handle.update()
        return
      }
      const request = marketRequests.begin()
      market = Object.freeze({ quotes: market.quotes, loading: true })
      handle.update()
      try {
        let quotes = Object.freeze({}) as PortfolioMarketSnapshot['quotes']
        const batchSize = 100
        for (let offset = 0; offset < symbols.length; offset += batchSize) {
          const result = await portfolioApi.marketQuotes(
            symbols.slice(offset, offset + batchSize),
            request.signal,
          )
          if (!request.isCurrent()) return
          quotes = Object.freeze({ ...quotes, ...result.quotes })
          market = Object.freeze({
            quotes,
            fetchedAt: new Date().toISOString(),
            loading: offset + batchSize < symbols.length,
          })
          handle.update()
        }
        return
      } catch (marketError) {
        if (request.signal.aborted) return
        market = Object.freeze({
          quotes: market.quotes,
          loading: false,
          error: marketError instanceof PortfolioApiError
            ? 'Live market data is temporarily unavailable.'
            : 'Live market data could not be loaded.',
        })
      }
      handle.update()
    }

    async function loadPortfolio(portfolioId: string): Promise<void> {
      const request = requests.begin()
      marketRequests.cancel()
      market = Object.freeze({ quotes: {}, loading: false })
      loading = true
      error = undefined
      operationsData = undefined
      operationsDenied = false
      handle.update()
      try {
        const operations = currentView === 'operations'
          ? portfolioApi.view(portfolioId, 'operations', request.signal).then(
            (value) => Object.freeze({ value, denied: false }),
            (operationError: unknown) => {
              if (operationError instanceof PortfolioApiError && operationError.status === 403) {
                return Object.freeze({ value: undefined, denied: true })
              }
              throw operationError
            },
          )
          : Promise.resolve(Object.freeze({ value: undefined, denied: false }))
        const [overview, nextOperations] = await Promise.all([
          portfolioApi.view(portfolioId, 'overview', request.signal) as Promise<PortfolioView>,
          operations,
        ])
        if (!request.isCurrent()) return
        data = overview
        operationsData = nextOperations.value
        operationsDenied = nextOperations.denied
        void loadMarketQuotes(overview)
      } catch (loadError) {
        if (!request.signal.aborted) error = message(loadError)
      } finally {
        if (request.isCurrent()) {
          loading = false
          handle.update()
        }
      }
    }

    async function loadAuthenticated(): Promise<void> {
      const request = requests.begin()
      loading = true
      error = undefined
      handle.update()
      try {
        const [nextSession, nextCollection] = await Promise.all([
          portfolioApi.session(request.signal),
          portfolioApi.list(request.signal),
        ])
        if (!request.isCurrent()) return
        session = nextSession
        collection = nextCollection
        const accessible = selectedId !== undefined
          && collection.portfolios.some((item) => item.portfolioId === selectedId)
        selectedId = accessible ? selectedId : collection.portfolios[0]?.portfolioId
        loading = selectedId !== undefined
        handle.update()
        if (selectedId !== undefined) await loadPortfolio(selectedId)
      } catch (authError) {
        if (!request.signal.aborted) {
          session = undefined
          loading = false
          if (!(authError instanceof PortfolioApiError && authError.status === 401)) {
            error = message(authError)
          }
          handle.update()
        }
      }
    }

    async function initialize(): Promise<void> {
      const request = requests.begin()
      try {
        const status = await portfolioApi.status(request.signal)
        if (!request.isCurrent()) return
        configured = status.configured
        if (!configured) {
          loading = false
          handle.update()
          return
        }
        await loadAuthenticated()
      } catch (initialError) {
        if (!request.signal.aborted) {
          loading = false
          error = message(initialError)
          handle.update()
        }
      }
    }

    async function login(username: string, password: string, mfaCode: string): Promise<void> {
      const request = requests.begin()
      loginBusy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.login(username, password, mfaCode, request.signal)
        if (!request.isCurrent()) return
        loginBusy = false
        await loadAuthenticated()
      } catch (loginError) {
        if (!request.signal.aborted) {
          loginBusy = false
          error = loginError instanceof PortfolioApiError && loginError.status === 401
            ? mfaCode === ''
              ? 'MFA is enabled for this account. Enter the current six-digit code from your authenticator app.'
              : 'The username, password, or authenticator code was not accepted. Wait for a fresh code and try once.'
            : message(loginError)
          handle.update()
        }
      }
    }

    async function bootstrap(username: string, password: string, displayName: string): Promise<void> {
      const request = requests.begin()
      loginBusy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.bootstrap(username, password, displayName, request.signal)
        if (!request.isCurrent()) return
        configured = true
        loginBusy = false
        await loadAuthenticated()
      } catch (bootstrapError) {
        if (!request.signal.aborted) {
          loginBusy = false
          error = bootstrapError instanceof PortfolioApiError && bootstrapError.status === 400
            ? 'Use a 3+ character username and a 12+ character password.'
            : message(bootstrapError)
          handle.update()
        }
      }
    }

    async function selectPortfolio(portfolioId: string): Promise<void> {
      selectedId = portfolioId
      data = undefined
      market = Object.freeze({ quotes: {}, loading: false })
      sharekhanBrokerPortfolio = undefined
      history.pushState({}, '', portfolioPath(portfolioId, currentView))
      await loadPortfolio(portfolioId)
    }

    async function navigateView(view: WorkspaceView): Promise<void> {
      if (selectedId === undefined) return
      currentView = view
      history.pushState({}, '', portfolioPath(selectedId, view))
      if (view === 'operations' && operationsData === undefined && !operationsDenied) {
        await loadPortfolio(selectedId)
        return
      }
      handle.update()
    }

    async function createPortfolio(input: Readonly<{
      displayName: string
      startingCashRupees: string
      mode: 'OBSERVE' | 'PAPER' | 'RECOMMENDATION'
      strategyVersionId: string
    }>): Promise<void> {
      const startingCashMinorUnits = rupeesToMinorUnits(input.startingCashRupees)
      if (startingCashMinorUnits === undefined) {
        error = 'Starting cash must be a non-negative INR amount with at most two decimals.'
        handle.update()
        return
      }
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        const created = await portfolioApi.create({
          displayName: input.displayName,
          startingCashMinorUnits,
          mode: input.mode,
          strategyVersionId: input.strategyVersionId,
        }, request.signal)
        if (!request.isCurrent()) return
        collection = await portfolioApi.list(request.signal)
        busy = false
        await selectPortfolio(created.portfolioId)
      } catch (createError) {
        if (!request.signal.aborted) {
          busy = false
          error = message(createError)
          handle.update()
        }
      }
    }

    async function archivePortfolio(): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.archive(selectedId, request.signal)
        if (!request.isCurrent()) return
        collection = await portfolioApi.list(request.signal)
        confirmArchive = false
        busy = false
        await loadPortfolio(selectedId)
      } catch (archiveError) {
        if (!request.signal.aborted) {
          busy = false
          error = message(archiveError)
          handle.update()
        }
      }
    }

    async function importHolding(input: Readonly<{
      instrumentId: string
      quantity: string
      unitCostRupees: string
      acquiredOn: string
    }>): Promise<void> {
      if (selectedId === undefined) return
      const unitCostMinorUnits = rupeesToMinorUnits(input.unitCostRupees)
      if (unitCostMinorUnits === undefined || input.quantity === '0') {
        error = 'Use a positive whole-share quantity and a valid INR unit cost.'
        notice = undefined
        handle.update()
        return
      }
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        const imported = await portfolioApi.importHolding(selectedId, {
          instrumentId: input.instrumentId,
          quantity: input.quantity,
          unitCostMinorUnits,
          acquiredOn: input.acquiredOn,
        }, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = `Holding imported into portfolio snapshot v${imported.snapshotStateVersion}.`
        await loadPortfolio(selectedId)
      } catch (importError) {
        if (!request.signal.aborted) {
          busy = false
          error = importError instanceof PortfolioApiError && importError.status === 409
            ? 'That instrument already exists in this portfolio. Use reconciliation for quantity changes.'
            : message(importError)
          handle.update()
        }
      }
    }

    async function exitHolding(input: Readonly<{ instrumentId: string; quantity: string }>): Promise<void> {
      if (selectedId === undefined || data === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        const exited = await portfolioApi.exitHolding(selectedId, {
          ...input,
          portfolioStateVersion: data.portfolio.state_version,
        }, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = `${exited.exitKind === 'FULL' ? 'Exited' : 'Reduced'} ${exited.instrumentId} by ${exited.quantity} shares at ${formatRupees(exited.executionPriceMinorUnits)}. Net PAPER proceeds ${formatRupees(exited.netProceedsMinorUnits)}.`
        await loadPortfolio(selectedId)
      } catch (exitError) {
        if (!request.signal.aborted) {
          busy = false
          error = exitError instanceof PortfolioApiError && exitError.status === 409
            ? 'The PAPER exit was blocked because the holding, available quantity, quote, or portfolio snapshot changed. Refresh and try again.'
            : message(exitError)
          handle.update()
        }
      }
    }

    async function assignStrategy(strategyVersionId: string): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        const assigned = await portfolioApi.assignStrategy(selectedId, strategyVersionId, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = assigned.changed
          ? `Strategy assigned in portfolio snapshot v${assigned.stateVersion}. Generate a new rebalance preview.`
          : 'That strategy is already assigned to this portfolio.'
        await loadPortfolio(selectedId)
      } catch (strategyError) {
        if (!request.signal.aborted) {
          busy = false
          error = message(strategyError)
          handle.update()
        }
      }
    }

    async function generateRebalance(): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        await portfolioApi.generateRebalance(selectedId, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = 'A new snapshot-bound research rebalance preview was generated.'
        await loadPortfolio(selectedId)
      } catch (planningError) {
        if (!request.signal.aborted) {
          busy = false
          error = planningError instanceof PortfolioApiError && planningError.status === 400
            ? 'Planning is blocked. Confirm holdings, supported NSE symbols, active strategy, and live quote availability.'
            : message(planningError)
          handle.update()
        }
      }
    }

    async function executeRebalance(planId: string): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        await portfolioApi.executeRebalance(selectedId, planId, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = 'PAPER entries and exits executed; holdings, lots and cash were updated. No live broker order was sent.'
        await loadPortfolio(selectedId)
      } catch (executionError) {
        if (!request.signal.aborted) {
          busy = false
          error = executionError instanceof PortfolioApiError && executionError.status === 409
            ? 'This preview is stale, already executed, or no longer matches the portfolio snapshot.'
            : message(executionError)
          handle.update()
        }
      }
    }

    async function refreshPerformance(): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        await portfolioApi.refreshPerformance(selectedId, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = 'A new Yahoo-backed performance observation was recorded.'
        await loadPortfolio(selectedId)
      } catch (performanceError) {
        if (!request.signal.aborted) {
          busy = false
          error = performanceError instanceof PortfolioApiError && performanceError.status === 400
            ? 'Performance refresh requires complete holding quotes and a benchmark quote.'
            : message(performanceError)
          handle.update()
        }
      }
    }

    async function beginMfaEnrollment(): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        mfaEnrollment = await portfolioApi.beginMfaEnrollment(selectedId, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = 'Authenticator setup key created. Confirm it before the ten-minute challenge expires.'
        handle.update()
      } catch (mfaError) {
        if (!request.signal.aborted) {
          busy = false
          error = message(mfaError)
          handle.update()
        }
      }
    }

    async function confirmMfaEnrollment(code: string): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.confirmMfaEnrollment(selectedId, code, request.signal)
        requests.cancel()
        session = undefined
        data = undefined
        operationsData = undefined
        mfaEnrollment = undefined
        busy = false
        loading = false
        error = 'MFA configured. Sign in again with your password and authenticator code.'
        handle.update()
      } catch (mfaError) {
        if (!request.signal.aborted) {
          busy = false
          error = mfaError instanceof PortfolioApiError && mfaError.code === 'MFA_CONFIRMATION_FAILED'
            ? 'The authenticator code is invalid or the setup challenge expired.' : message(mfaError)
          handle.update()
        }
      }
    }

    async function runOperation(action: 'health' | 'backup' | 'restore-preflight' | 'recovery-scan'): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      notice = undefined
      handle.update()
      try {
        await portfolioApi.runOperation(selectedId, action, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = action === 'health' ? 'Health checks completed.'
          : action === 'backup' ? 'Owner-mediated backup created and verified.'
            : action === 'restore-preflight' ? 'Non-destructive restore preflight passed.'
              : 'Incomplete operation runs were classified for recovery.'
        await loadPortfolio(selectedId)
      } catch (operationError) {
        if (!request.signal.aborted) {
          busy = false
          error = operationError instanceof PortfolioApiError && operationError.code !== undefined
            ? `Operation blocked: ${operationError.code.replaceAll('_', ' ').toLowerCase()}.`
            : message(operationError)
          handle.update()
        }
      }
    }

    async function openIncident(input: Readonly<{ severity: 'SEV1' | 'SEV2' | 'SEV3'; code: string; correlationId: string }>): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.openIncident(selectedId, input, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = `${input.severity} incident ${input.code} opened.`
        await loadPortfolio(selectedId)
      } catch (incidentError) {
        if (!request.signal.aborted) { busy = false; error = message(incidentError); handle.update() }
      }
    }

    async function closeIncident(incidentId: string, actionCodes: readonly string[]): Promise<void> {
      if (selectedId === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        await portfolioApi.closeIncident(selectedId, incidentId, actionCodes, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = `Incident ${incidentId} closed with corrective-action evidence.`
        await loadPortfolio(selectedId)
      } catch (incidentError) {
        if (!request.signal.aborted) { busy = false; error = message(incidentError); handle.update() }
      }
    }

    async function loadSharekhanBrokerPortfolio(): Promise<void> {
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        const snapshot = await portfolioApi.sharekhanPortfolio(request.signal)
        if (!request.isCurrent()) return
        sharekhanBrokerPortfolio = snapshot
        busy = false
        notice = `Loaded ${snapshot.portfolio.holdings.list.filter((holding) => holding.qty > 0).length} positive Sharekhan holdings. No orders were placed.`
        handle.update()
      } catch (brokerError) {
        if (!request.signal.aborted) { busy = false; error = message(brokerError); handle.update() }
      }
    }

    function normalizedAcquisitionDate(value: string | undefined): string | undefined {
      if (value === undefined || value.trim() === '') return undefined
      const direct = value.trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/u.test(direct)) return direct
      const parsed = Date.parse(value)
      return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined
    }

    async function applySharekhanReconciliation(fallbackAcquiredOn: string): Promise<void> {
      if (selectedId === undefined || data === undefined || sharekhanBrokerPortfolio === undefined) return
      const request = requests.begin()
      busy = true
      error = undefined
      handle.update()
      try {
        const broker = sharekhanBrokerPortfolio.portfolio
        await portfolioApi.reconcileSharekhan(selectedId, {
          brokerAsOf: broker.asOf,
          portfolioStateVersion: data.portfolio.state_version,
          availableCashMinorUnits: String(Math.round(broker.funds.availableCash * 100)),
          fallbackAcquiredOn,
          holdings: Object.freeze(broker.holdings.list
            .filter((holding) => Number.isInteger(holding.qty) && holding.qty > 0)
            .map((holding) => {
              const acquiredOn = normalizedAcquisitionDate(holding.acquisitionDate)
              return Object.freeze({
                instrumentId: `NSE:${holding.symbol.trim().toUpperCase()}`,
                quantity: String(holding.qty),
                unitCostMinorUnits: String(Math.max(0, Math.round(holding.avgPrice * 100))),
                ...(acquiredOn === undefined ? {} : { acquiredOn }),
              })
            })),
        }, request.signal)
        if (!request.isCurrent()) return
        busy = false
        notice = 'Sharekhan holdings and available cash reconciled into this PAPER portfolio. No broker orders were placed.'
        await loadPortfolio(selectedId)
      } catch (reconciliationError) {
        if (!request.signal.aborted) { busy = false; error = message(reconciliationError); handle.update() }
      }
    }

    async function logout(): Promise<void> {
      const request = requests.begin()
      try {
        await portfolioApi.logout(request.signal)
      } catch {
        // The local session state still clears; server expiry remains authoritative.
      }
      requests.cancel()
      session = undefined
      data = undefined
      collection = Object.freeze({ portfolios: [], strategies: [] })
      loading = false
      handle.update()
    }

    function visiblePanel() {
      if (data === undefined || loading) return <section mix={panelStyle} role="status">Loading portfolio…</section>
      switch (currentView) {
        case 'holdings': return <>
          <ImportHoldingForm
            busy={busy}
            disabled={data.portfolio.status !== 'ACTIVE'}
            onImport={(input) => { void importHolding(input) }}
          />
          <HoldingsPanel
            data={data}
            market={market}
            busy={busy}
            onRefresh={() => { void loadMarketQuotes(data as PortfolioView) }}
            onExit={(input) => { void exitHolding(input) }}
          />
        </>
        case 'strategy': return <CompleteStrategyPanel
          data={data}
          strategies={collection.strategies}
          busy={busy}
          onAssign={(strategyVersionId) => { void assignStrategy(strategyVersionId) }}
        />
        case 'rebalance': return <CompleteRebalancePanel
          data={data}
          busy={busy}
          onGenerate={() => { void generateRebalance() }}
          onReview={() => { void navigateView('execution') }}
          onExit={(input) => { void exitHolding(input) }}
        />
        case 'execution': return <CompleteExecutionReviewPanel
          data={data}
          busy={busy}
          onExecute={(planId) => { void executeRebalance(planId) }}
          onOpenRebalance={() => { void navigateView('rebalance') }}
        />
        case 'performance': return <PerformancePanel data={data} busy={busy} onRefresh={() => { void refreshPerformance() }} />
        case 'operations': return session === undefined ? null : <CompleteOperationsPanel
          data={operationsData}
          denied={operationsDenied}
          session={session}
          busy={busy}
          portfolio={data}
          sharekhanBrokerPortfolio={sharekhanBrokerPortfolio}
          enrollment={mfaEnrollment}
          onBeginMfa={() => { void beginMfaEnrollment() }}
          onConfirmMfa={(code) => { void confirmMfaEnrollment(code) }}
          onLogout={() => { void logout() }}
          onRefresh={() => { if (selectedId !== undefined) void loadPortfolio(selectedId) }}
          onRun={(action) => { void runOperation(action) }}
          onOpenIncident={(input) => { void openIncident(input) }}
          onCloseIncident={(incidentId, actionCodes) => { void closeIncident(incidentId, actionCodes) }}
          onLoadSharekhan={() => { void loadSharekhanBrokerPortfolio() }}
          onApplySharekhan={(fallbackAcquiredOn) => { void applySharekhanReconciliation(fallbackAcquiredOn) }}
        />
        default: return <OverviewPanel data={data} market={market} onRefresh={() => { void loadMarketQuotes(data as PortfolioView) }} />
      }
    }

    return () => {
      if (!initialized && typeof window !== 'undefined') {
        initialized = true
        handle.queueTask(() => initialize())
      }
      if (session === undefined) {
      return <div style={{ minHeight: '100vh', boxSizing: 'border-box', background: '#08111e', color: palette.ink, padding: '48px 20px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}><LoginPanel
            configured={configured}
            busy={loginBusy}
            error={error}
            onLogin={(...values) => { void login(...values) }}
            onBootstrap={(...values) => { void bootstrap(...values) }}
        /></div>
      </div>
      }
      const selected = collection.portfolios.find((item) => item.portfolioId === selectedId)
      return (
        <div
          mix={css({
            minHeight: '100vh', background: '#09111d', color: palette.ink,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            '& *': { boxSizing: 'border-box' },
            '& th, & td': { textAlign: 'left', padding: '10px', borderBottom: `1px solid ${palette.border}` },
          })}
        >
          <a href="#portfolio-main" mix={skipLinkStyle}>Skip to portfolio content</a>
          <header style={{ borderBottom: `1px solid ${palette.border}`, background: '#101927' }}>
            <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '18px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
              <div><p style={{ color: palette.blue, margin: 0, fontWeight: 800 }}>Stock Watcher</p><h1 style={{ margin: 0 }}>Portfolio workspace</h1></div>
              <div style={{ textAlign: 'right' }}><div>{session.displayName} · {session.role}</div><button mix={[buttonStyle, on('click', () => { void logout() })]} style={{ color: palette.blue, background: 'transparent', padding: '8px' }}>Sign out</button></div>
            </div>
          </header>
          <main id="portfolio-main" style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 48px', display: 'grid', gap: '20px' }}>
            <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '16px' }}>
              <PortfolioSelector portfolios={collection.portfolios} selectedId={selectedId} onSelect={(id) => { void selectPortfolio(id) }} />
              {selectedId ? <PortfolioNavigation portfolioId={selectedId} view={currentView} onNavigate={(view) => { void navigateView(view) }} /> : null}
            </section>
            <CreatePortfolioForm strategies={collection.strategies} busy={busy} onCreate={(input) => { void createPortfolio(input) }} />
            {selected ? <SafetyStatus mode={selected.mode} status={selected.status} /> : null}
            {error ? <p role="alert" style={{ color: palette.red, margin: 0 }}>{error}</p> : null}
            {notice ? <p role="status" style={{ color: palette.green, margin: 0 }}>{notice}</p> : null}
            {selectedId === undefined ? <section mix={panelStyle}><h2>No portfolios available</h2><p>Create the first isolated portfolio above.</p></section> : visiblePanel()}
            {selected?.status === 'ACTIVE' && selected.accessRole === 'OWNER' ? (
              <section mix={panelStyle} aria-labelledby="archive-title">
                <h2 id="archive-title">Archive portfolio</h2>
                <p>Archiving blocks new evaluations, plans, and orders while retaining holdings, fills, performance, and audit history.</p>
                {confirmArchive ? <div role="alertdialog" aria-labelledby="archive-confirm-title"><h3 id="archive-confirm-title">Archive {selected.displayName}?</h3><p>This cannot reactivate the portfolio automatically.</p><div style={{ display: 'flex', gap: '10px' }}><button mix={[buttonStyle, on('click', () => { void archivePortfolio() })]} disabled={busy}>Confirm archive</button><button mix={[buttonStyle, on('click', () => { confirmArchive = false; handle.update() })]} disabled={busy}>Cancel</button></div></div> : <button mix={[buttonStyle, on('click', () => { confirmArchive = true; handle.update() })]}>Review archive consequences</button>}
              </section>
            ) : null}
          </main>
        </div>
      )
    }
  },
)
