import * as http from 'node:http'
import { createRequire } from 'node:module'
import { createRequestListener } from 'remix/node-fetch-server'

import { router } from './app/router.ts'
import { shouldProxy } from './proxy-routes.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
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

const server = http.createServer((request, response) => {
  if (shouldProxy(request)) {
    proxyRequestHandler(request, response)
    return
  }

  remixRequestListener(request, response)
})

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
  initializeProxy().catch((error) => {
    console.warn('[proxy] Warmup failed:', error?.message || error)
  })
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
