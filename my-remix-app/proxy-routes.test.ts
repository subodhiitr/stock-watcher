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
  assert.equal(shouldProxyPath('/setup-efficiency'), true)
  assert.equal(shouldProxyPath('/setup-efficiency/stream'), true)
  assert.equal(shouldProxyPath('/setup-efficiency/reconcile'), true)
  assert.equal(shouldProxyPath('/setup-efficiency/analyze-date'), true)
  assert.equal(shouldProxyPath('/exit-quality'), true)
  assert.equal(shouldProxyPath('/exit-quality/stream'), true)
  assert.equal(shouldProxyPath('/exit-quality/reconcile'), true)
  assert.equal(shouldProxyPath('/exit-quality/analyze-date'), true)
  assert.equal(shouldProxyPath('/not-proxy-path'), false)
})

test('should proxy broker portfolio paths', () => {
  assert.equal(shouldProxyPath('/zerodha-portfolio'), true)
  assert.equal(shouldProxyPath('/sharekhan-portfolio'), true)
})

test('should proxy dedicated result calendar path', () => {
  assert.equal(shouldProxyPath('/result-calendar'), true)
})

test('should proxy intraday candle chart path', () => {
  assert.equal(shouldProxyPath('/intraday-candles'), true)
})
