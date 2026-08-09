import type {
  PortfolioCollection,
  ManualPaperExit,
  PortfolioSession,
  PortfolioView,
  SafetyMode,
  WorkspaceView,
} from '../types/views.ts'
import type { PortfolioMarketQuote } from '../market/valuation.ts'

export type SharekhanBrokerPortfolio = Readonly<{
  ok: boolean
  mode: string
  broker: 'sharekhan'
  portfolio: Readonly<{
    asOf: number
    funds: Readonly<{ availableCash: number }>
    holdings: Readonly<{
      count: number
      list: readonly Readonly<{
        symbol: string
        exchange: string
        isin: string
        qty: number
        avgPrice: number
        ltp: number
        investedValue: number
        marketValue: number
        pnl: number
        acquisitionDate?: string
      }>[]
    }>
  }>
}>

export class PortfolioApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, code?: string) {
    super('Portfolio request could not be processed')
    this.name = 'PortfolioApiError'
    this.status = status
    this.code = code
  }
}

async function json<Value>(path: string, init: RequestInit = {}): Promise<Value> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { code?: string } } | undefined
    throw new PortfolioApiError(response.status, body?.error?.code)
  }
  return await response.json() as Value
}

function csrfToken(): string {
  if (typeof document === 'undefined') return ''
  const prefix = 'portfolio_csrf='
  const item = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  return item === undefined ? '' : decodeURIComponent(item.slice(prefix.length))
}

function mutationHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-csrf-token': csrfToken(),
    'x-correlation-id': `ui:${crypto.randomUUID()}`,
    'idempotency-key': `ui:${crypto.randomUUID()}`,
  }
}

export const portfolioApi = Object.freeze({
  status(signal?: AbortSignal) {
    return json<Readonly<{ configured: boolean }>>('/api/portfolio/auth/status', { signal })
  },
  login(username: string, password: string, mfaCode: string, signal?: AbortSignal) {
    return json<Readonly<{ authenticated: true; expiresAtEpochMs: number }>>('/api/portfolio/auth/login', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, ...(mfaCode === '' ? {} : { mfaCode }) }),
    })
  },
  bootstrap(username: string, password: string, displayName: string, signal?: AbortSignal) {
    return json<Readonly<{ configured: true; authenticated: true; expiresAtEpochMs: number }>>('/api/portfolio/auth/bootstrap', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, ...(displayName === '' ? {} : { displayName }) }),
    })
  },
  session(signal?: AbortSignal) {
    return json<PortfolioSession>('/api/portfolio/auth/session', { signal })
  },
  logout(signal?: AbortSignal) {
    return json<Readonly<{ authenticated: false }>>('/api/portfolio/auth/logout', {
      method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirm: true }),
    })
  },
  list(signal?: AbortSignal) {
    return json<PortfolioCollection>('/api/portfolio/portfolios', { signal })
  },
  view(portfolioId: string, view: WorkspaceView, signal?: AbortSignal) {
    const encoded = encodeURIComponent(portfolioId)
    return json<PortfolioView | PortfolioView[keyof PortfolioView]>(
      `/api/portfolio/portfolios/${encoded}/${view}`,
      { signal },
    )
  },
  marketQuotes(symbols: readonly string[], signal?: AbortSignal) {
    return json<Readonly<{ ok: boolean; quotes: Readonly<Record<string, PortfolioMarketQuote>> }>>(
      `/yahoo?symbols=${encodeURIComponent(symbols.join(','))}`,
      { signal },
    )
  },
  sharekhanPortfolio(signal?: AbortSignal) {
    return json<SharekhanBrokerPortfolio>('/sharekhan-portfolio', { signal })
  },
  create(input: Readonly<{
    displayName: string
    startingCashMinorUnits: string
    mode: Extract<SafetyMode, 'OBSERVE' | 'PAPER' | 'RECOMMENDATION'>
    strategyVersionId: string
  }>, signal?: AbortSignal) {
    return json<Readonly<{ portfolioId: string; stateVersion: number }>>('/api/portfolio/portfolios', {
      method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify(input),
    })
  },
  archive(portfolioId: string, signal?: AbortSignal) {
    return json<Readonly<{ portfolioId: string; status: string; stateVersion: number }>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/archive`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'ARCHIVE' }) },
    )
  },
  importHolding(portfolioId: string, input: Readonly<{
    instrumentId: string
    quantity: string
    unitCostMinorUnits: string
    acquiredOn: string
  }>, signal?: AbortSignal) {
    return json<Readonly<{
      portfolioId: string
      holdingId: string
      lotId: string
      snapshotStateVersion: number
    }>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/holdings/import`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify(input) },
    )
  },
  exitHolding(portfolioId: string, input: Readonly<{
    instrumentId: string
    quantity: string
    portfolioStateVersion: number
  }>, signal?: AbortSignal) {
    return json<ManualPaperExit>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/holdings/exit`,
      {
        method: 'POST', signal, headers: mutationHeaders(),
        body: JSON.stringify({ confirmation: 'EXIT_PAPER_HOLDING', ...input }),
      },
    )
  },
  assignStrategy(portfolioId: string, strategyVersionId: string, signal?: AbortSignal) {
    return json<Readonly<{
      portfolioId: string
      strategyVersionId: string
      stateVersion: number
      changed: boolean
    }>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/strategy/assign`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ strategyVersionId }) },
    )
  },
  generateRebalance(portfolioId: string, signal?: AbortSignal) {
    return json<PortfolioView['rebalance']['plans'][number]>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/rebalance/generate`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'GENERATE_RESEARCH_PREVIEW' }) },
    )
  },
  approveRebalance(portfolioId: string, planId: string, signal?: AbortSignal) {
    return json<PortfolioView['rebalance']['plans'][number]>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/rebalance/approve`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'APPROVE_PAPER_PLAN', planId }) },
    )
  },
  executeRebalance(portfolioId: string, planId: string, signal?: AbortSignal) {
    return json<PortfolioView['rebalance']['plans'][number]>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/rebalance/execute`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'EXECUTE_PAPER_PLAN', planId }) },
    )
  },
  refreshPerformance(portfolioId: string, signal?: AbortSignal) {
    return json<NonNullable<PortfolioView['performance']['latest']>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/performance/refresh`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'RECORD_PERFORMANCE_OBSERVATION' }) },
    )
  },
  beginMfaEnrollment(portfolioId: string, signal?: AbortSignal) {
    return json<Readonly<{ secret: string; otpauthUri: string; qrDataUrl: string; expiresAtEpochMs: number }>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/mfa/setup`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'RUN_OPERATION' }) },
    )
  },
  confirmMfaEnrollment(portfolioId: string, code: string, signal?: AbortSignal) {
    return json<Readonly<{ configured: true; reloginRequired: true }>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/mfa/confirm`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ code }) },
    )
  },
  runOperation(portfolioId: string, action: 'health' | 'backup' | 'restore-preflight' | 'recovery-scan', signal?: AbortSignal) {
    return json<Readonly<Record<string, unknown>>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/${action}`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ confirmation: 'RUN_OPERATION' }) },
    )
  },
  reconcileSharekhan(portfolioId: string, input: Readonly<{
    brokerAsOf: number
    portfolioStateVersion: number
    availableCashMinorUnits: string
    fallbackAcquiredOn: string
    holdings: readonly Readonly<{
      instrumentId: string
      quantity: string
      unitCostMinorUnits: string
      acquiredOn?: string
    }>[]
  }>, signal?: AbortSignal) {
    return json<Readonly<Record<string, unknown>>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/sharekhan-reconciliation/apply`,
      {
        method: 'POST', signal, headers: mutationHeaders(),
        body: JSON.stringify({ confirmation: 'RECONCILE_SHAREKHAN_PAPER', ...input }),
      },
    )
  },
  openIncident(portfolioId: string, input: Readonly<{
    severity: 'SEV1' | 'SEV2' | 'SEV3'
    code: string
    correlationId: string
  }>, signal?: AbortSignal) {
    return json<Readonly<Record<string, unknown>>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/incidents`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify(input) },
    )
  },
  closeIncident(portfolioId: string, incidentId: string, actionCodes: readonly string[], signal?: AbortSignal) {
    return json<Readonly<Record<string, unknown>>>(
      `/api/portfolio/portfolios/${encodeURIComponent(portfolioId)}/operations/incidents/${encodeURIComponent(incidentId)}/close`,
      { method: 'POST', signal, headers: mutationHeaders(), body: JSON.stringify({ actionCodes }) },
    )
  },
})
