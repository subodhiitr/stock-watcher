import assert from 'node:assert/strict'
import test from 'node:test'

import { PortfolioRequestCoordinator } from './request-coordinator.ts'

test('new portfolio requests abort and invalidate stale responses', () => {
  const coordinator = new PortfolioRequestCoordinator()
  const first = coordinator.begin()
  const second = coordinator.begin()
  assert.equal(first.signal.aborted, true)
  assert.equal(first.isCurrent(), false)
  assert.equal(second.signal.aborted, false)
  assert.equal(second.isCurrent(), true)
  coordinator.cancel()
  assert.equal(second.signal.aborted, true)
  assert.equal(second.isCurrent(), false)
})

