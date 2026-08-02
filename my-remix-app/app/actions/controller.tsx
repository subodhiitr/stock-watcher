import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createController } from 'remix/router'

import { assetServer } from '../assets.ts'
import { routes } from '../routes.ts'

const actionsDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceDir = path.resolve(actionsDir, '..', '..', '..')

async function rootFileResponse(
  fileName: string,
  contentType: string,
  cacheControl = 'no-cache',
) {
  const filePath = path.join(workspaceDir, fileName)
  const body = await fs.readFile(filePath)

  return new Response(body, {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Length': String(body.byteLength),
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function dashboardBodyHtml() {
  const html = await fs.readFile(path.join(workspaceDir, 'nse_midcap_dashboard.html'), 'utf8')
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const body = bodyMatch ? bodyMatch[1] : html

  return body
    .replace(/<script\b[^>]*\bsrc=["']trade_rules\.js[^"']*["'][^>]*><\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc=["']simulation_engine\.js[^"']*["'][^>]*><\/script>/gi, '')
    .replace(/<script\b[^>]*\bsrc=["']dashboard-app\.js[^"']*["'][^>]*><\/script>/gi, '')
    .trim()
}

async function dashboardResponse(options: { view?: 'stocks' | 'etfs'; action?: 'portfolio' | 'replay' } = {}) {
  const body = await dashboardBodyHtml()
  const bootScript = JSON.stringify({
    view: options.view || 'stocks',
    action: options.action || null,
  })
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>NSE Midcap Dashboard</title>
<link rel="preload" href="/dashboard.css?v=20260730-55" as="style">
<link rel="stylesheet" href="/dashboard.css?v=20260730-55">
</head>
<body>
${body}
<script>window.__DASHBOARD_ROUTE__=${bootScript};</script>
<script defer src="/trade_rules.js?v=20260628-25"></script>
<script defer src="/simulation_engine.js?v=20260628-25"></script>
<script defer src="/dashboard-app.js?v=20260801-71"></script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

function mobileResponse() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#101820">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="IntradayX">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>IntradayX Mobile</title>
<link rel="manifest" href="/mobile-manifest.webmanifest">
<link rel="icon" href="/mobile-icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/mobile-icon-192.png">
<link rel="stylesheet" href="/mobile.css?v=20260801-20">
</head>
<body>
<div class="global-status" id="global-status" role="status" aria-live="assertive"></div>
<main class="app-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">IntradayX</p>
      <h1>Trade</h1>
    </div>
    <div class="topbar-actions">
      <button class="icon-btn earnings-results-icon" id="earnings-results-btn" type="button" aria-label="Open earnings results" aria-controls="earnings-results-overlay" title="Earnings Results">&#128202;</button>
      <button class="icon-btn fresh-news-icon" id="fresh-news-icon" type="button" aria-label="Open fresh news" aria-controls="fresh-news-overlay" title="Fresh News" onclick="window.openMobileFreshNews?.()">&#128240;</button>
      <button class="icon-btn broker-login-icon zerodha-icon" id="zerodha-login-icon" type="button" aria-label="Log in to Zerodha" title="Zerodha login">Z</button>
      <button class="icon-btn broker-login-icon sharekhan-icon" id="sharekhan-login-icon" type="button" aria-label="Log in to Sharekhan" title="Sharekhan login">S</button>
      <button class="icon-btn settings-icon" id="settings-icon" type="button" aria-label="Open settings" title="Settings">&#9881;</button>
      <button class="icon-btn notification-btn" id="notification-btn" type="button" aria-label="Notifications">
        <span aria-hidden="true">!</span>
        <em id="notification-count">0</em>
      </button>
    </div>
  </header>

  <section class="hero-metrics" aria-label="Trading summary">
    <button class="metric-card" id="portfolio-card" type="button" aria-haspopup="dialog" aria-controls="portfolio-overlay">
      <span>Portfolio</span>
      <strong id="portfolio-total">--</strong>
    </button>
    <button class="metric-card" id="today-pnl-card" type="button" aria-haspopup="dialog" aria-controls="pnl-overlay">
      <span id="today-pnl-label">Today P/L</span>
      <strong id="broker-mode-label">--</strong>
    </button>
    <article>
      <span>Simulation</span>
      <strong id="simulation-label">--</strong>
    </article>
  </section>

  <section class="market-strip" aria-label="Market overview">
    <div class="market-nifty">
      <div class="market-index-row"><span>Nifty 50</span><strong id="market-nifty-price">--</strong><b id="market-nifty-change">--</b></div>
      <div class="market-index-row"><span>Nifty Midcap 150</span><strong id="market-midcap-price">--</strong><b id="market-midcap-change">--</b></div>
    </div>
    <div class="sector-leaders" id="sector-leaders"><span>Top sectors</span><strong>--</strong></div>
  </section>

  <nav class="tabs" aria-label="Mobile views">
    <button class="tab active" type="button" data-view="trade">Trade</button>
    <button class="tab" type="button" data-view="setups">Setups</button>
    <button class="tab" type="button" data-view="stocks">All Stocks</button>
  </nav>

  <section class="view active" id="view-trade">
    <div class="section-title">
      <h2>Manual Entry</h2>
      <span id="updated-at">--</span>
    </div>
    <form class="trade-form" id="manual-entry-form">
      <input id="manual-symbol" name="symbol" placeholder="Select symbol" autocomplete="off" list="manual-symbol-options">
      <datalist id="manual-symbol-options"></datalist>
      <select id="manual-side" name="side" aria-label="Side">
        <option value="buy">BUY</option>
        <option value="sell">SELL</option>
      </select>
      <input id="manual-qty" name="qty" type="number" min="1" step="1" placeholder="Qty">
      <input id="manual-price" name="price" type="number" min="0.01" step="0.01" placeholder="Price">
      <input id="manual-target" name="target" type="number" min="0" step="0.01" placeholder="Target">
      <button type="submit">Enter</button>
    </form>
    <div class="status-line" id="trade-status"></div>
    <div class="section-title">
      <h2>Today Positions</h2>
      <span id="trade-count">--</span>
    </div>
    <div class="trade-table" id="trade-list"></div>
  </section>

  <section class="view" id="view-setups">
    <div class="section-title">
      <h2>Setup Cards</h2>
      <span id="setup-count">--</span>
    </div>
    <label class="setup-selector-card" for="setup-filter-select">
      <span>Show stocks</span>
      <select id="setup-filter-select">
        <option value="combined_top">Combined Top Setups</option>
        <option value="simulation_top25">Server Simulation Top 25</option>
        <option value="tradeable">Tradeable</option>
        <option value="gainers">Top Gainers</option>
        <option value="losers">Top Losers</option>
        <option value="favorites">Favourites</option>
        <option value="rangebound">Rangebound</option>
        <option value="opening_flush">Opening Flush VWAP Reclaim</option>
        <option value="top_gainer_pullback">Top-Gainer Pullback Reclaim</option>
        <option value="top_gainer_continuation">Top-Gainer Continuation</option>
        <option value="gap_and_go">Gap and Go</option>
        <option value="bull_flag">Bull-Flag Continuation</option>
        <option value="vwap_continuation">VWAP Trend Continuation</option>
        <option value="breakdown">Breakdown Shorts</option>
        <option value="bear_flags">Bear-Flag Shorts</option>
        <option value="vwap_rejection">VWAP Rejection</option>
        <option value="vwap_pullback">VWAP Pullback / Hold</option>
        <option value="runners">Momentum Runners</option>
        <option value="best_pullbacks">Best Pullbacks</option>
      </select>
      <button class="setup-refresh-btn" id="setup-refresh-btn" type="button" aria-label="Refresh selected setups" title="Refresh selected setups">&#8635;</button>
    </label>
    <div class="setup-grid" id="setup-list"></div>
  </section>

  <section class="view" id="view-settings">
    <div class="section-title">
      <h2>Modes</h2>
    </div>
    <div class="control-panel">
      <label>Broker Mode
        <select id="broker-mode-select">
          <option value="zerodha_dry_run">Paper / Zerodha Dry</option>
          <option value="zerodha_live">Zerodha Live</option>
          <option value="sharekhan_live">Sharekhan Live</option>
        </select>
      </label>
      <button id="simulation-toggle" type="button">Toggle Simulation</button>
      <button id="simulation-stop-now" type="button">Stop Now</button>
      <label class="check-row auto-refresh-row"><input id="auto-refresh-toggle" type="checkbox"> Refresh every 5 min</label>
      <span class="auto-refresh-state" id="auto-refresh-state">Auto refresh off</span>
    </div>
    <div class="section-title">
      <h2>Trade Settings</h2>
      <span id="settings-state">--</span>
    </div>
    <form class="settings-form" id="settings-form">
      <label>Minimum Score <input name="SIMULATION_MIN_SCORE" type="number" min="0" max="100" step="1"></label>
      <label>Short Min Score <input name="SIMULATION_SHORT_MIN_SCORE" type="number" min="0" max="100" step="1"></label>
      <label>Priority Top N <input name="SIMULATION_TOP_N" type="number" min="1" max="100" step="1"></label>
      <label>New / Cycle <input name="SIMULATION_MAX_NEW_PER_CYCLE" type="number" min="1" max="50" step="1"></label>
      <label>Position Cap <input name="MAX_POSITION_EXPOSURE" type="number" min="10000" step="1000"></label>
      <label>Min Net % <input name="SIMULATION_MIN_NET_PROFIT_PCT" type="number" min="0" max="10" step="0.1"></label>
      <label>Max Open <input name="SIMULATION_MAX_OPEN" type="number" min="1" max="100" step="1"></label>
      <label>Daily Max <input name="SIMULATION_DAILY_MAX_TRADES" type="number" min="1" max="200" step="1"></label>
      <label>Nifty Regime % <input name="SIMULATION_MARKET_REGIME_NIFTY_PCT" type="number" min="-1" max="1" step="0.001"></label>
      <label>Sector Regime % <input name="SIMULATION_MARKET_REGIME_SECTOR_PCT" type="number" min="-1" max="1" step="0.001"></label>
      <label class="check-row"><input name="SIMULATION_ENABLE_ETF" type="checkbox"> Enable ETF simulation and setups</label>
      <label class="check-row"><input name="SIMULATION_OVERRIDE_STOP_GUARD" type="checkbox"> Stop guard override</label>
      <label class="check-row"><input name="SIMULATION_AUTO_MANUAL_EXITS" type="checkbox"> Auto-exit manual trades</label>
      <section class="mobile-setup-settings-list" id="mobile-setup-settings-list" aria-label="Setup configuration">
        <div class="empty">Loading setup configuration…</div>
      </section>
      <div class="form-actions">
        <button type="submit" id="settings-save">Save Settings</button>
        <button type="button" id="settings-reset">Clear Overrides</button>
      </div>
      <div class="settings-status" id="settings-status" role="status" aria-live="polite"></div>
    </form>
  </section>

  <section class="view" id="view-stocks">
    <div class="section-title all-stock-title">
      <h2>All Stocks</h2>
      <input id="all-stock-search" type="search" placeholder="Search stock" aria-label="Search all stocks" autocomplete="off">
      <span id="all-stock-count">--</span>
    </div>
    <label class="all-stock-filter" for="all-stock-filter-select">
      <span>Profile</span>
      <select id="all-stock-filter-select">
        <option value="all">All Stocks</option>
        <option value="favorites">Favourites</option>
        <option value="gainers">Top Gainers</option>
        <option value="losers">Top Losers</option>
      </select>
    </label>
    <div class="all-stock-list" id="all-stock-list"><div class="empty">Open All Stocks to load data</div></div>
    <div class="pagination-bar">
      <button id="all-stock-prev" type="button">Previous</button>
      <span id="all-stock-page">Page 1</span>
      <button id="all-stock-next" type="button">Next</button>
    </div>
  </section>
</main>
<div class="overlay" id="notification-overlay" hidden>
  <section class="portfolio-sheet notification-sheet" role="dialog" aria-modal="true" aria-labelledby="notification-title">
    <header class="sheet-head">
      <div>
        <p class="eyebrow">Alerts</p>
        <h2 id="notification-title">Notifications</h2>
      </div>
      <button class="icon-btn" id="notification-close" type="button" aria-label="Close">x</button>
    </header>
    <div class="transaction-list notification-list" id="notification-list"></div>
  </section>

</div>
<div class="overlay" id="earnings-results-overlay" hidden>
  <section class="portfolio-sheet news-sheet earnings-results-sheet" role="dialog" aria-modal="true" aria-labelledby="earnings-results-title">
    <header class="sheet-head">
      <div><p class="eyebrow">Next 30 days</p><h2 id="earnings-results-title">Earnings Results</h2></div>
      <button class="icon-btn" id="earnings-results-close" type="button" aria-label="Close">x</button>
    </header>
    <div class="news-status" id="earnings-results-status">Loading earnings calendar…</div>
    <div class="earnings-results-date-strip" id="earnings-results-date-strip" aria-label="Earnings result dates"></div>
    <div class="transaction-list earnings-results-list" id="earnings-results-list"></div>
  </section>
</div>
<div class="overlay" id="fresh-news-overlay" hidden>
  <section class="portfolio-sheet news-sheet" role="dialog" aria-modal="true" aria-labelledby="fresh-news-title">
    <header class="sheet-head">
      <div><p class="eyebrow">Market feed</p><h2 id="fresh-news-title">Fresh News</h2></div>
      <button class="icon-btn" id="fresh-news-close" type="button" aria-label="Close">x</button>
    </header>
    <div class="news-status" id="fresh-news-status">Loading fresh news…</div>
    <div class="transaction-list news-list" id="fresh-news-list"></div>
  </section>
</div>
<div class="overlay" id="candle-overlay" hidden>
  <section class="portfolio-sheet chart-sheet" role="dialog" aria-modal="true" aria-labelledby="candle-title">
    <header class="sheet-head"><h2 id="candle-title">5m Candles</h2><button class="icon-btn" id="candle-close" type="button" aria-label="Close">x</button></header>
    <div class="candle-interval-toolbar" role="group" aria-label="Candle interval">
      <button class="active" id="candle-interval-5m" type="button">5 min</button>
      <button id="candle-interval-15m" type="button">15 min</button>
    </div>
    <div class="chart-body" id="candle-body"><div class="empty">Loading candles…</div></div>
  </section>
</div>
<div class="overlay" id="stock-detail-overlay" hidden>
  <section class="portfolio-sheet detail-sheet" role="dialog" aria-modal="true" aria-labelledby="stock-detail-title">
    <header class="sheet-head"><h2 id="stock-detail-title">Stock Details</h2><button class="icon-btn" id="stock-detail-close" type="button" aria-label="Close">x</button></header>
    <div class="stock-detail-body" id="stock-detail-body"><div class="empty">Loading details…</div></div>
  </section>
</div>
<div class="overlay" id="pnl-overlay" hidden>
  <section class="portfolio-sheet pnl-sheet" role="dialog" aria-modal="true" aria-labelledby="pnl-title">
    <header class="sheet-head">
      <div>
        <p class="eyebrow">Today</p>
        <h2 id="pnl-title">P/L Breakdown</h2>
      </div>
      <button class="icon-btn" id="pnl-close" type="button" aria-label="Close">x</button>
    </header>
    <section class="portfolio-summary" id="pnl-summary"></section>
    <div class="transaction-list pnl-list" id="pnl-list"></div>
  </section>
</div>
<div class="overlay" id="portfolio-overlay" hidden>
  <section class="portfolio-sheet" role="dialog" aria-modal="true" aria-labelledby="portfolio-title">
    <header class="sheet-head">
      <div>
        <p class="eyebrow">Portfolio</p>
      <h2 id="portfolio-title">Today</h2>
      </div>
      <button class="icon-btn" id="portfolio-close" type="button" aria-label="Close">x</button>
    </header>
    <div class="portfolio-summary" id="portfolio-summary"></div>
    <div class="section-title">
      <h2>Today's Transactions</h2>
      <span id="portfolio-transaction-count">--</span>
    </div>
    <div class="transaction-list" id="portfolio-transactions"></div>
  </section>
</div>
<script defer src="/mobile-app.js?v=20260801-60"></script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },
    dashboardApp() {
      return rootFileResponse(
        'dashboard-app.js',
        'application/javascript; charset=utf-8',
        'public, max-age=3600',
      )
    },
    dashboardCss() {
      return rootFileResponse('dashboard.css', 'text/css; charset=utf-8', 'public, max-age=3600')
    },
    home() {
      return dashboardResponse()
    },
    etfs() {
      return dashboardResponse({ view: 'etfs' })
    },
    legacyDashboard() {
      return rootFileResponse('nse_midcap_dashboard.html', 'text/html; charset=utf-8')
    },
    mobile() {
      return mobileResponse()
    },
    mobileApp() {
      return rootFileResponse(
        'mobile-app.js',
        'application/javascript; charset=utf-8',
        'public, max-age=3600',
      )
    },
    mobileCss() {
      return rootFileResponse('mobile.css', 'text/css; charset=utf-8', 'public, max-age=3600')
    },
    mobileIcon() {
      return rootFileResponse('mobile-icon.svg', 'image/svg+xml; charset=utf-8', 'public, max-age=86400')
    },
    mobileIcon192() {
      return rootFileResponse('mobile-icon-192.png', 'image/png', 'public, max-age=86400')
    },
    mobileIcon512() {
      return rootFileResponse('mobile-icon-512.png', 'image/png', 'public, max-age=86400')
    },
    mobileManifest() {
      return rootFileResponse(
        'mobile-manifest.webmanifest',
        'application/manifest+json; charset=utf-8',
        'no-cache',
      )
    },
    mobileServiceWorker() {
      return rootFileResponse(
        'mobile-sw.js',
        'application/javascript; charset=utf-8',
        'no-cache',
      )
    },
    portfolio() {
      return dashboardResponse({ action: 'portfolio' })
    },
    replay() {
      return dashboardResponse({ action: 'replay' })
    },
    simulationEngine() {
      return rootFileResponse(
        'simulation_engine.js',
        'application/javascript; charset=utf-8',
        'public, max-age=3600',
      )
    },
    tradeRules() {
      return rootFileResponse(
        'trade_rules.js',
        'application/javascript; charset=utf-8',
        'public, max-age=3600',
      )
    },
    stocks() {
      return dashboardResponse({ view: 'stocks' })
    },
  },
})
