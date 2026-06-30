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
      'Content-Type': contentType,
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
<link rel="preload" href="/dashboard.css?v=20260628-30" as="style">
<link rel="stylesheet" href="/dashboard.css?v=20260628-30">
</head>
<body>
${body}
<script>window.__DASHBOARD_ROUTE__=${bootScript};</script>
<script defer src="/trade_rules.js?v=20260628-25"></script>
<script defer src="/simulation_engine.js?v=20260628-25"></script>
<script defer src="/dashboard-app.js?v=20260628-42"></script>
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
<link rel="stylesheet" href="/mobile.css?v=20260629-2">
</head>
<body>
<main class="app-shell">
  <header class="topbar">
    <div>
      <p class="eyebrow">IntradayX</p>
      <h1>Trade</h1>
    </div>
    <div class="topbar-actions">
      <button class="icon-btn" id="refresh-btn" type="button" aria-label="Refresh">↻</button>
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
      <span>Today P/L</span>
      <strong id="broker-mode-label">--</strong>
    </button>
    <article>
      <span>Simulation</span>
      <strong id="simulation-label">--</strong>
    </article>
  </section>

  <nav class="tabs" aria-label="Mobile views">
    <button class="tab active" type="button" data-view="trade">Trade</button>
    <button class="tab" type="button" data-view="setups">Setups</button>
    <button class="tab" type="button" data-view="settings">Settings</button>
  </nav>

  <section class="view active" id="view-trade">
    <div class="section-title">
      <h2>Manual Entry</h2>
      <span id="updated-at">--</span>
    </div>
    <form class="trade-form" id="manual-entry-form">
      <input id="manual-symbol" name="symbol" placeholder="Symbol" autocomplete="off">
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
    <div class="setup-grid" id="setup-list"></div>
  </section>

  <section class="view" id="view-settings">
    <div class="section-title">
      <h2>Modes</h2>
    </div>
    <div class="control-panel">
      <label>Broker Mode
        <select id="broker-mode-select">
          <option value="paper">Paper</option>
          <option value="zerodha_dry_run">Zerodha Dry</option>
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
      <label>Position Cap <input name="MAX_POSITION_EXPOSURE" type="number" min="10000" step="1000"></label>
      <label>Min Net % <input name="SIMULATION_MIN_NET_PROFIT_PCT" type="number" min="0" max="10" step="0.1"></label>
      <label>Max Open <input name="SIMULATION_MAX_OPEN" type="number" min="1" max="100" step="1"></label>
      <label>Daily Max <input name="SIMULATION_DAILY_MAX_TRADES" type="number" min="1" max="200" step="1"></label>
      <label>Nifty Regime % <input name="SIMULATION_MARKET_REGIME_NIFTY_PCT" type="number" min="-1" max="1" step="0.001"></label>
      <label>Sector Regime % <input name="SIMULATION_MARKET_REGIME_SECTOR_PCT" type="number" min="-1" max="1" step="0.001"></label>
      <label class="check-row"><input name="SIMULATION_OVERRIDE_STOP_GUARD" type="checkbox"> Stop guard override</label>
      <label class="check-row"><input name="SIMULATION_AUTO_MANUAL_EXITS" type="checkbox"> Auto-exit manual trades</label>
      <div class="form-actions">
        <button type="submit">Save Settings</button>
        <button type="button" id="settings-reset">Clear Overrides</button>
      </div>
    </form>
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
<script defer src="/mobile-app.js?v=20260629-2"></script>
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
