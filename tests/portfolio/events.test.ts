import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseDomainEvent,
  serializeDomainEvent,
} from '../../server/portfolio/index.ts'
import {
  eventId,
  makeContext,
  makePortfolio,
  makePortfolioTransition,
  makeSingleAllocation,
  must,
} from './support/arbitraries.ts'

test('all emitted event facts are immutable and codec round-trip', () => {
  const portfolio = makePortfolio('events')
  const modeChanged = must(portfolio.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'RECOMMENDATION',
    evidence: [],
    context: makeContext(1, 'events-mode'),
    eventId: eventId('events-mode'),
  }))
  const allocationChanged = must(modeChanged.state.replaceStrategyAllocation({
    portfolioId: portfolio.portfolioId,
    allocationPolicy: makeSingleAllocation(
      portfolio.portfolioId,
      'events-new',
      modeChanged.state.snapshot().createdAt,
    ),
    context: makeContext(2, 'events-allocation'),
    eventId: eventId('events-allocation'),
  }))
  const archived = must(allocationChanged.state.archive({
    portfolioId: portfolio.portfolioId,
    context: makeContext(3, 'events-archive'),
    eventId: eventId('events-archive'),
  }))

  const events = [
    makePortfolioTransition('events-created').events[0],
    modeChanged.events[0],
    allocationChanged.events[0],
    archived.events[0],
  ]

  for (const event of events) {
    assert.ok(event)
    assert.ok(Object.isFrozen(event))
    assert.ok(Object.isFrozen(event.payload))
    const parsed = must(parseDomainEvent(serializeDomainEvent(event)))
    assert.deepEqual(parsed, event)
  }
})

test('event parser rejects unknown types and schema versions', () => {
  assert.equal(parseDomainEvent('{}').ok, false)
  const created = makePortfolioTransition('unknown-schema').events[0]
  assert.ok(created)
  const value = JSON.parse(serializeDomainEvent(created)) as Record<string, unknown>
  value.schemaVersion = 2
  assert.equal(parseDomainEvent(JSON.stringify(value)).ok, false)
  value.schemaVersion = 1
  value.type = 'PortfolioDeleted'
  assert.equal(parseDomainEvent(JSON.stringify(value)).ok, false)
})
