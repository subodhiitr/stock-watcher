import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeInterimPlanning,
  buildSafeReasonBundle,
  calculateImplementationShortfall,
  comparePlanEquivalence,
  createDraftPlanLifecycle,
  createPlanInputHash,
  deriveLogicalOrderKey,
  evaluateDiscretionaryHolding,
  transitionPlanLifecycle,
  verifyConstructionConstraints,
  type InterimAuthorization,
  type PlanningCandidate,
} from '../../../server/portfolio/index.ts'
import {
  AD_C_OBSERVABILITY_EXAMPLES,
  FIXTURE_IDS,
  INSTRUMENT_A,
  MANDATORY_EDGE_SCENARIOS,
  exactMoney,
  exactQuantity,
} from './support/fixtures.ts'

test('edge 1: monthly portfolio inside no-trade band emits a policy skip', () => {
  const result = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 250_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 255_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 10_000n }),
    relativeDriftBand: Object.freeze({ numerator: 20n, scale: 100n }),
    daysHeld: 100,
    preferredMinimumHoldDays: 30,
    mandatory: false,
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.reasonBundle?.primaryCode, 'INSIDE_DRIFT_BAND')
})

test('edge 2: after-drag replacement below hurdle is skipped', () => {
  const result = evaluateDiscretionaryHolding({
    currentWeight: Object.freeze({ partsPerMillion: 100_000n }),
    targetWeight: Object.freeze({ partsPerMillion: 300_000n }),
    absoluteDriftBand: Object.freeze({ partsPerMillion: 1_000n }),
    relativeDriftBand: Object.freeze({ numerator: 1n, scale: 100n }),
    daysHeld: 500,
    preferredMinimumHoldDays: 30,
    replacementScoreGapPpm: 10_000n,
    requiredReplacementGapPpm: 50_000n,
    mandatory: false,
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.reasonBundle?.primaryCode, 'REPLACEMENT_HURDLE_NOT_MET')
  }
})

test('edge 3: missing group classification has an allowlisted blocked explanation', () => {
  const reason = buildSafeReasonBundle({
    primaryCode: 'MISSING_CLASSIFICATION',
    explanationKey: 'PREREQUISITE_BLOCK',
  })
  assert.equal(reason.ok, true)
  if (!reason.ok) return
  assert.equal(
    reason.value.humanExplanation,
    'The action is blocked because a required verified input is unavailable.',
  )
})

test('edge 4: confirmed weaker regime permits sell-only exposure reduction', () => {
  const authorization: InterimAuthorization = Object.freeze({
    reasonFamily: 'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
    sourceIds: Object.freeze(['REGIME-VERIFIED-001']),
    verifiedAt: '2026-07-31T12:00:00.000Z' as InterimAuthorization['verifiedAt'],
    verifiedBy: 'ACTOR-U04-001' as InterimAuthorization['verifiedBy'],
    exposureDeltaOnly: true,
    advisoryEvidenceExcluded: true,
  })
  const allowed = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization,
    actionIntents: Object.freeze([
      Object.freeze({ instrumentId: INSTRUMENT_A, intent: 'REDUCE', mandatory: false }),
    ]),
    createdAt: '2026-07-31T13:00:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(allowed.ok, true)
  const denied = authorizeInterimPlanning({
    planningIntent: 'INTERIM_EXCEPTION',
    authorization,
    actionIntents: Object.freeze([
      Object.freeze({ instrumentId: INSTRUMENT_A, intent: 'BUY', mandatory: false }),
    ]),
    createdAt: '2026-07-31T13:00:00.000Z' as InterimAuthorization['verifiedAt'],
  })
  assert.equal(denied.ok, false)
})

test('edge 5: hard-risk exit remains bounded by available delivery', () => {
  const verification = verifyConstructionConstraints({
    positions: Object.freeze([Object.freeze({
      instrumentId: INSTRUMENT_A,
      decisionPrice: exactMoney(10_000n),
      targetQuantity: exactQuantity(10n),
      targetValue: exactMoney(100_000n),
      targetWeight: Object.freeze({ partsPerMillion: 100_000n }),
      currentQuantity: exactQuantity(20n),
      availableDeliveryQuantity: exactQuantity(5n),
      liquidityCapacity: exactMoney(1_000_000n),
      sectorId: 'TECH',
      groupId: 'GROUP-A',
      marketCapBucket: 'LARGE_CAP',
    })]),
    residualCash: exactMoney(900_000n),
    startingNav: exactMoney(1_000_000n),
    constraints: Object.freeze({
      targetHoldings: 1,
      maxHoldings: 2,
      maxStockWeight: Object.freeze({ partsPerMillion: 500_000n }),
      maxSectorWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
      maxGroupWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
      maxSmallCapWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
      maxLiquidityParticipation: Object.freeze({ numerator: 1n, scale: 1n }),
      cashBufferFloor: Object.freeze({ partsPerMillion: 0n }),
      regimeExposureCap: Object.freeze({ partsPerMillion: 1_000_000n }),
      turnoverBudgetCeiling: Object.freeze({ numerator: 1n, scale: 1n }),
      minimumOrderValue: exactMoney(0n),
      replacementScoreGap: Object.freeze({ numerator: 0n, scale: 1n }),
      preferredMinimumHoldDays: 0,
      absoluteDriftBand: Object.freeze({ partsPerMillion: 0n }),
      relativeDriftBand: Object.freeze({ numerator: 0n, scale: 1n }),
    }),
    proposedTurnoverPpm: 100_000n,
    timing: Object.freeze({
      calendarSessionId: FIXTURE_IDS.calendarSessionId,
      decisionSessionDate: '2026-07-31',
      decisionReadyAt: '2026-07-31T12:00:00.000Z',
      eligibleExecutionDate: '2026-08-03',
      eligibleExecutionWindowStart: '09:45',
      eligibleExecutionWindowEnd: '11:30',
      timeZone: 'Asia/Kolkata',
      finalized: true,
      sameSessionExecutionAllowed: false,
    }) as Parameters<typeof verifyConstructionConstraints>[0]['timing'],
  })
  assert.equal(verification.accepted, false)
  assert.ok(verification.violatedConstraintIds.includes('AVAILABLE_DELIVERY'))
})

test('edge 6: single-name cap violation is rejected by the shared verifier', () => {
  const candidate = {
    instrumentId: INSTRUMENT_A,
    decisionPrice: exactMoney(10_000n),
    targetQuantity: exactQuantity(100n),
    targetValue: exactMoney(1_000_000n),
    targetWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    currentQuantity: exactQuantity(0n),
    availableDeliveryQuantity: exactQuantity(0n),
    liquidityCapacity: exactMoney(1_000_000n),
    sectorId: 'TECH',
    groupId: 'GROUP-A',
    marketCapBucket: 'LARGE_CAP',
  } as const
  const constraints = {
    targetHoldings: 1,
    maxHoldings: 1,
    maxStockWeight: Object.freeze({ partsPerMillion: 500_000n }),
    maxSectorWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxGroupWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxSmallCapWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxLiquidityParticipation: Object.freeze({ numerator: 1n, scale: 1n }),
    cashBufferFloor: Object.freeze({ partsPerMillion: 0n }),
    regimeExposureCap: Object.freeze({ partsPerMillion: 1_000_000n }),
    turnoverBudgetCeiling: Object.freeze({ numerator: 1n, scale: 1n }),
    minimumOrderValue: exactMoney(0n),
    replacementScoreGap: Object.freeze({ numerator: 0n, scale: 1n }),
    preferredMinimumHoldDays: 0,
    absoluteDriftBand: Object.freeze({ partsPerMillion: 0n }),
    relativeDriftBand: Object.freeze({ numerator: 0n, scale: 1n }),
  } as const
  const verification = verifyConstructionConstraints({
    positions: Object.freeze([candidate]),
    residualCash: exactMoney(0n),
    startingNav: exactMoney(1_000_000n),
    constraints,
    proposedTurnoverPpm: 1_000_000n,
    timing: Object.freeze({
      calendarSessionId: FIXTURE_IDS.calendarSessionId,
      decisionSessionDate: '2026-07-31',
      decisionReadyAt: '2026-07-31T12:00:00.000Z',
      eligibleExecutionDate: '2026-08-03',
      eligibleExecutionWindowStart: '09:45',
      eligibleExecutionWindowEnd: '11:30',
      timeZone: 'Asia/Kolkata',
      finalized: true,
      sameSessionExecutionAllowed: false,
    }) as Parameters<typeof verifyConstructionConstraints>[0]['timing'],
  })
  assert.ok(verification.violatedConstraintIds.includes('SINGLE_NAME_CAP'))
})

test('edge 7: canonical hashes and logical order keys ignore object key order', () => {
  assert.equal(
    createPlanInputHash({ a: 1, b: 2n }),
    createPlanInputHash({ b: 2n, a: 1 }),
  )
  const first = deriveLogicalOrderKey({
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId: INSTRUMENT_A,
    side: 'BUY',
    semanticAction: { quantity: 2n, target: 100n },
  })
  const second = deriveLogicalOrderKey({
    portfolioId: FIXTURE_IDS.portfolioId,
    instrumentId: INSTRUMENT_A,
    side: 'BUY',
    semanticAction: { target: 100n, quantity: 2n },
  })
  assert.equal(first, second)
})

test('edge 8: approval-ready plan can expire and never return to ready', () => {
  const draft = createDraftPlanLifecycle(FIXTURE_IDS.rebalanceRunId)
  const ready = transitionPlanLifecycle(
    draft,
    'APPROVAL_READY',
    '2026-07-31T12:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  assert.equal(ready.ok, true)
  if (!ready.ok) return
  const expired = transitionPlanLifecycle(
    ready.value,
    'EXPIRED',
    '2026-08-04T12:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  assert.equal(expired.ok, true)
  if (!expired.ok) return
  assert.equal(
    transitionPlanLifecycle(
      expired.value,
      'APPROVAL_READY',
      '2026-08-04T13:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
    ).ok,
    false,
  )
})

test('all mandatory and material AD-C examples remain permanently enumerated', () => {
  assert.equal(MANDATORY_EDGE_SCENARIOS.length, 8)
  assert.equal(new Set(MANDATORY_EDGE_SCENARIOS).size, 8)
  assert.equal(AD_C_OBSERVABILITY_EXAMPLES.length, 4)
  assert.ok(AD_C_OBSERVABILITY_EXAMPLES.includes('ALLOWLISTED_EXPLANATION'))
})

test('implementation shortfall and plan comparison remain pure value operations', () => {
  const shortfall = calculateImplementationShortfall({
    idealPositions: Object.freeze([]),
    executablePositions: Object.freeze([]),
    idealCashWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    executableCashWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    estimatedCost: exactMoney(0n),
    estimatedTax: exactMoney(0n),
  })
  assert.equal(shortfall.ok, true)
  const actionBuckets = Object.freeze({
    proposed: Object.freeze([]),
    skipped: Object.freeze([]),
    blocked: Object.freeze([]),
  })
  assert.equal(comparePlanEquivalence(
    { planInputHash: FIXTURE_IDS.inputHash, planHash: FIXTURE_IDS.planHash, actionBuckets },
    { planInputHash: FIXTURE_IDS.inputHash, planHash: FIXTURE_IDS.planHash, actionBuckets },
  ).equivalent, true)
  assert.equal(({} as Partial<PlanningCandidate>).instrumentId, undefined)
})
