import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('my-remix-app/app/portfolio/components/strategy-rebalance.tsx', 'utf8')

test('rebalance UI distinguishes planned sales from manual turnover-staged risk exits', () => {
  assert.match(source, /Execute planned PAPER sale/u)
  assert.match(source, /Manual staged PAPER reduction/u)
  assert.match(source, /manual risk override outside this staged plan/u)
  assert.match(source, /Timed target/u)
  assert.match(source, /action\.exitRiskLevel === 'REDUCE'/u)
  assert.match(source, /Do not open this holding in the current session/u)
  assert.match(source, /BigInt\(action\.deltaQuantity\) < 0n/u)
})
