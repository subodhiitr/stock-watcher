import * as http from 'node:http'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createRequestListener } from 'remix/node-fetch-server'

import { router } from './app/router.ts'
import { shouldProxy } from './proxy-routes.ts'

const envFile = resolve(import.meta.dirname, '../.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
const useExternalProxy = process.argv.includes('--external-proxy')
const proxyUrl = process.env.PROXY_URL || (useExternalProxy ? 'http://localhost:3001' : undefined)
const proxyReconnectWindowMs = 5 * 60 * 1000
const proxyReconnectMaxDelayMs = 10 * 1000
const require = createRequire(import.meta.url)
const { initializeProxy, proxyRequestHandler } = require('../ticker_proxy.js') as {
  initializeProxy: () => Promise<void>
  proxyRequestHandler: http.RequestListener
}

const remixRequestListener = createRequestListener(async (request) => {
    try {
      return await router.fetch(request)
    } catch (error) {
      if (!(request.signal.aborted && error === request.signal.reason)) {
        console.error(error)
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  })

function forwardToProxy(proxyBase: string, request: http.IncomingMessage, response: http.ServerResponse) {
  const target = new URL(request.url ?? '/', proxyBase)
  const reconnectableEventStreams = new Set([
    '/stream/intraday-live',
    '/stream/market-overview',
    '/simulation/analysis/stream',
    '/trade-execution/stream',
    '/paper-trades/stream',
  ])
  const isReconnectableEventStream = reconnectableEventStreams.has(target.pathname)
    && String(request.headers.accept || '').toLowerCase().includes('text/event-stream')
  const options: http.RequestOptions = {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: request.method,
    headers: request.headers,
  }
  let activeProxy: http.ClientRequest | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let reconnectStableTimer: NodeJS.Timeout | null = null
  let reconnectStartedAt = 0
  let reconnectAttempt = 0
  let closed = false

  const failProxyResponse = (_error: Error) => {
    if (response.writableEnded || response.destroyed) return
    if (!response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Proxy unavailable')
      return
    }

    // Once upstream headers/body have started, an HTTP 502 can no longer be
    // written. Terminate the incomplete downstream response without attempting
    // a second writeHead (which would crash the server with ERR_HTTP_HEADERS_SENT).
    response.destroy()
  }

  const stopReconnect = () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (reconnectStableTimer) clearTimeout(reconnectStableTimer)
    reconnectTimer = null
    reconnectStableTimer = null
    if (activeProxy && !activeProxy.destroyed) activeProxy.destroy()
  }

  const connectEventStream = () => {
    if (closed || response.writableEnded || response.destroyed) return
    let settled = false
    let currentProxyResponse: http.IncomingMessage | null = null
    const reconnect = (error: Error) => {
      if (settled) return
      settled = true
      if (reconnectStableTimer) clearTimeout(reconnectStableTimer)
      reconnectStableTimer = null
      currentProxyResponse?.unpipe(response)
      if (closed || response.writableEnded || response.destroyed) return

      if (!reconnectStartedAt) reconnectStartedAt = Date.now()
      const elapsed = Date.now() - reconnectStartedAt
      if (elapsed >= proxyReconnectWindowMs) {
        console.warn(`[proxy] SSE reconnect window expired for ${target.pathname}`)
        failProxyResponse(error)
        return
      }

      const delay = Math.min(proxyReconnectMaxDelayMs, 1000 * (2 ** reconnectAttempt))
      reconnectAttempt += 1
      if (reconnectAttempt === 1) {
        console.warn(`[proxy] SSE upstream disconnected for ${target.pathname}; retrying for up to 5 minutes`)
      }
      reconnectTimer = setTimeout(connectEventStream, delay)
    }

    activeProxy = http.request(options, (proxyRes) => {
      currentProxyResponse = proxyRes
      if (closed || response.writableEnded || response.destroyed) {
        proxyRes.destroy()
        return
      }

      // Treat a connection that remains healthy for 30 seconds as recovered.
      // Short connect/drop loops continue counting against the same 5-minute window.
      if (reconnectStartedAt) {
        reconnectStableTimer = setTimeout(() => {
          reconnectStartedAt = 0
          reconnectAttempt = 0
          reconnectStableTimer = null
        }, 30 * 1000)
      } else {
        reconnectAttempt = 0
      }
      if (!response.headersSent) {
        response.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
      }

      proxyRes.once('error', reconnect)
      proxyRes.once('aborted', () => reconnect(new Error('Upstream proxy response aborted')))
      proxyRes.once('end', () => reconnect(new Error('Upstream proxy response ended')))
      proxyRes.pipe(response, { end: false })
    })
    activeProxy.once('error', reconnect)
    activeProxy.end()
  }

  if (isReconnectableEventStream && ['GET', 'HEAD'].includes(String(request.method || 'GET').toUpperCase())) {
    request.on('aborted', stopReconnect)
    response.on('close', stopReconnect)
    connectEventStream()
    return
  }

  const proxy = http.request(options, (proxyRes) => {
    if (response.writableEnded || response.destroyed) {
      proxyRes.destroy()
      return
    }
    response.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
    proxyRes.on('error', failProxyResponse)
    proxyRes.on('aborted', () => failProxyResponse(new Error('Upstream proxy response aborted')))
    proxyRes.pipe(response)
  })
  proxy.on('error', failProxyResponse)
  request.on('aborted', () => proxy.destroy())
  response.on('close', () => {
    if (!response.writableEnded && !proxy.destroyed) proxy.destroy()
  })
  request.pipe(proxy)
}

const server = http.createServer((request, response) => {
  if (shouldProxy(request)) {
    if (proxyUrl) {
      forwardToProxy(proxyUrl, request, response)
    } else {
      proxyRequestHandler(request, response)
    }
    return
  }

  remixRequestListener(request, response)
})

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
  if (proxyUrl) {
    console.log(`[proxy] Forwarding proxy routes → ${proxyUrl}`)
  } else {
    initializeProxy().catch((error) => {
      console.warn('[proxy] Warmup failed:', error?.message || error)
    })
  }
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
