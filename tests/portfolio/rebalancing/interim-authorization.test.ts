import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeInterimPlanning,
  type ActionIntentMarker,
  type InterimAuthorization,
} from '../../../server/portfolio/index.ts'
import { INSTRUMENT_A } from './support/fixtures.ts'

function authorization(
  reasonFamily: InterimAuthorization['reasonFamily'],
  overrides: Partial<InterimAuthorization> = {},
): InterimAuthorization {
  return Object.freeze({
    reasonFamily,
    sourceIds: Object.freeze(['VERIFIED-SOURCE-U04']),
    verifiedAt: '2026-07-31T12:00:00.000Z' as InterimAuthorization['verifiedAt'],
    verifiedBy: 'ACTOR-U04-001' as InterimAuthorization['verifiedBy'],
    exposureDeltaOnly: reasonFamily === 'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
    advisoryEvidenceExcluded: true,
    ...overrides,
  })
}

function action(
  intent: ActionIntentMarker['intent'],
  mandatory: boolean,
): ActionIntentMarker {
  return Object.freeze({ instrumentId: INSTRUMENT_A, intent, mandatory })
}

test('interim planning is denied without verified authorization', () => {
  const result = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    actionIntents: Object.freeze([action('SELL', true)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.authorized, false)
  assert.equal(result.value.reasonBundle?.primaryCode, 'INTERIM_NOT_AUTHORIZED')
})

test('hard-risk and mandatory eligibility proof permit only mandatory reductions', () => {
  for (const reasonFamily of [
    'HARD_RISK_EXIT',
    'MANDATORY_ELIGIBILITY_FAILURE',
  ] as const) {
    const result = authorizeInterimPlanning({
      planningIntent: 'INTERIM_EXCEPTION',
      authorization: authorization(reasonFamily),
      actionIntents: Object.freeze([action('SELL', true)]),
      createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
    })
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.value.authorized, true)
  }
})

test('AI-only proof is rejected', () => {
  const result = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('HARD_RISK_EXIT', {
      sourceIds: Object.freeze(['AI-ADVISORY-ONLY']),
    }),
    actionIntents: Object.freeze([action('SELL', true)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'INTERIM_PROOF_MISSING')
})

test('confirmed regime exceptions allow reductions but never new buys', () => {
  const reduction = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('CONFIRMED_REGIME_EXPOSURE_REDUCTION'),
    actionIntents: Object.freeze([action('REDUCE', false)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(reduction.ok, true)
  if (reduction.ok) assert.equal(reduction.value.authorized, true)
  const buy = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('CONFIRMED_REGIME_EXPOSURE_REDUCTION'),
    actionIntents: Object.freeze([action('BUY', false)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(buy.ok, false)
  if (!buy.ok) assert.equal(buy.error.code, 'REGIME_REDUCTION_SCOPE_INVALID')
})

test('verified corporate-action scope stays limited to mandatory changes', () => {
  const allowed = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('VERIFIED_CORPORATE_ACTION'),
    actionIntents: Object.freeze([action('REDUCE', true)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(allowed.ok, true)
  const lateral = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('VERIFIED_CORPORATE_ACTION'),
    actionIntents: Object.freeze([action('REPLACE', false)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(lateral.ok, false)
  if (!lateral.ok) {
    assert.equal(lateral.error.code, 'CORPORATE_ACTION_SCOPE_EXCEEDED')
  }
})

test('hard-risk override never authorizes a non-mandatory buy', () => {
  const result = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization: authorization('HARD_RISK_EXIT'),
    actionIntents: Object.freeze([action('BUY', false)]),
    createdAt: '2026-07-31T12:30:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'INTERIM_BUY_FORBIDDEN')
})
