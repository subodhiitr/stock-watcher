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