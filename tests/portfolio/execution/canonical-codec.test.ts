import assert from 'node:assert/strict'
import test from 'node:test'

import { compareIdentifiers } from '../../../server/portfolio/domain/shared/identifiers.ts'
import {
  canonicalExecutionJson,
  hashExecutionValue,
  parseBrokerMoneyDecimal,
  parseBrokerQuantityDecimal,
} from '../../../server/portfolio/domain/execution/canonical-codec.ts'
import {
  parseExecutionDomainEvent,
  serializeExecutionDomainEvent,
} from '../../../server/portfolio/domain/events/execution-event-codecs.ts'
import { FIXTURE_IDS, TEST_NOW, makeApprovedApproval } from './support/fixtures.ts'

test('canonical codec orders keys strips undefined and preserves bigint values exactly', () => {
  const canonical = canonicalExecutionJson({
    z: 1,
    a: { d: 4n, c: undefined, b: [3n, { y: 2, x: 1 }] },
    m: undefined,
  })
  assert.equal(canonical.ok, true)
  assert.equal(canonical.ok && canonical.value, '{"a":{"b":["3",{"x":1,"y":2}],"d":"4"},"z":1}')
})

test('canonical codec rejects hostile non finite and functional values', () => {
  assert.equal(canonicalExecutionJson({ bad: Number.NaN }).ok, false)
  assert.equal(canonicalExecutionJson(() => 'nope').ok, false)
})

test('hashExecutionValue separates domains and remains stable for equivalent canonical payloads', () => {
  const left = hashExecutionValue('approval-decision', { b: 2, a: 1 })
  const right = hashExecutionValue('approval-decision', { a: 1, b: 2 })
  const other = hashExecutionValue('dry-run-request', { a: 1, b: 2 })
  assert.equal(left.ok, true)
  assert.equal(right.ok, true)
  assert.equal(other.ok, true)
  if (left.ok && right.ok && other.ok) {
    assert.equal(left.value, right.value)
    assert.notEqual(left.value, other.value)
  }
})

test('broker decimals parse exactly for money and quantity', () => {
  const rupees = parseBrokerMoneyDecimal('123.45')
  const whole = parseBrokerMoneyDecimal('12')
  const quantity = parseBrokerQuantityDecimal('25')
  assert.equal(rupees.ok, true)
  assert.equal(whole.ok, true)
  assert.equal(quantity.ok, true)
  assert.equal(rupees.ok && rupees.value.minorUnits, 12_345n)
  assert.equal(whole.ok && whole.value.minorUnits, 1_200n)
  assert.equal(quantity.ok && quantity.value.shares, 25n)

  assert.equal(parseBrokerMoneyDecimal('12.345').ok, false)
  assert.equal(parseBrokerMoneyDecimal(' 12.34 ').ok, false)
  assert.equal(parseBrokerQuantityDecimal('5.1').ok, false)
  assert.equal(parseBrokerQuantityDecimal('-1').ok, false)
})

test('execution event codec round trips canonically and rejects mutated ordering', () => {
  const serialized = serializeExecutionDomainEvent(Object.freeze({
    eventId: FIXTURE_IDS.eventId,
    schemaVersion: 1,
    scope: Object.freeze({ kind: 'PORTFOLIO', portfolioId: FIXTURE_IDS.portfolioId }),
    occurredAt: TEST_NOW,
    type: 'ExecutionAggregateMutationRecorded' as const,
    payload: Object.freeze({
      operation: 'INSERT' as const,
      aggregateKind: 'APPROVAL' as const,
      aggregateId: FIXTURE_IDS.approvalId,
      aggregateStateVersion: 2,
      evidence: Object.freeze({
        kind: 'APPROVAL_DECIDED' as const,
        portfolioId: FIXTURE_IDS.portfolioId,
        approvalId: FIXTURE_IDS.approvalId,
        state: makeApprovedApproval().state,
        mode: 'PAPER' as const,
        planHashPrefix: 'abcdef123456',
        stateVersion: 2,
        occurredAt: TEST_NOW,
      }),
    }),
  }))
  assert.equal(serialized.ok, true)
  if (!serialized.ok) return
  const parsed = parseExecutionDomainEvent(serialized.value)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(parsed.value.type, 'ExecutionAggregateMutationRecorded')
    if (parsed.value.type === 'ExecutionAggregateMutationRecorded') {
      assert.equal(parsed.value.payload.aggregateKind, 'APPROVAL')
      assert.equal(parsed.value.payload.aggregateStateVersion, 2)
    }
  }
  assert.equal(
    parseExecutionDomainEvent(serialized.value.replace('"eventId"', '"zz"')).ok,
    false,
  )
})

test('identifier comparisons preserve stable canonical ordering', () => {
  const ids = ['order:arb:10', 'order:arb:2', 'order:arb:1']
  ids.sort(compareIdentifiers)
  assert.deepEqual(ids, ['order:arb:1', 'order:arb:10', 'order:arb:2'])
})
