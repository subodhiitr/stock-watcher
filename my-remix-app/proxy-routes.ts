import * as http from 'node:http'

const proxyPathPrefixes = ['/broker', '/borker', '/nse', '/ollama', '/openai', '/paper-trades', '/simulation', '/simulation-replay', '/stream', '/trade-execution', '/yahoo']
const proxyPaths = new Set([
  '/broker-mode',
  '/broker-refresh-token',
  '/broker-status',
  '/dashboard-bootstrap',
  '/dashboard-market',
  '/etf-favs',
  '/etf-list',
  '/etf-nav',
  '/etf-prefs',
  '/etf-summary',
  '/fresh-stock-news',
  '/health',
  '/intraday-signals',
  '/paper-trades',
  '/portfolio/day-pnl',
  '/simulation-snapshots',
  '/sparklines',
  '/stock-favs',
  '/stock-news',
  '/stock-prefs',
  '/trade-execution',
  '/trade-settings',
  '/zerodha-portfolio',
  '/sharekhan-portfolio',
])

export function shouldProxyPath(pathname: string) {
  return proxyPaths.has(pathname) || proxyPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function shouldProxy(request: http.IncomingMessage) {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  return shouldProxyPath(pathname)
}
