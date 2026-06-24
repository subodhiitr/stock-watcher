import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldProxyPath } from './proxy-routes.ts'

test('should proxy trade execution canonical and alias paths', () => {
  assert.equal(shouldProxyPath('/paper-trades'), true)
  assert.equal(shouldProxyPath('/paper-trades/stream'), true)
  assert.equal(shouldProxyPath('/trade-execution'), true)
  assert.equal(shouldProxyPath('/trade-execution/stream'), true)
  assert.equal(shouldProxyPath('/not-proxy-path'), false)
})
