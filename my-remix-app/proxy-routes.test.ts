import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldProxyPath } from './proxy-routes.ts'

test('should proxy trade execution and simulation runtime paths', () => {
  assert.equal(shouldProxyPath('/paper-trades'), true)
  assert.equal(shouldProxyPath('/paper-trades/stream'), true)
  assert.equal(shouldProxyPath('/trade-execution'), true)
  assert.equal(shouldProxyPath('/trade-execution/stream'), true)
  assert.equal(shouldProxyPath('/simulation/start'), true)
  assert.equal(shouldProxyPath('/simulation/stop'), true)
  assert.equal(shouldProxyPath('/simulation/status'), true)
  assert.equal(shouldProxyPath('/not-proxy-path'), false)
})
