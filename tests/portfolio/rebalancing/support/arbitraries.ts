import fc from 'fast-check'

import {
  createMoney,
  createQuantity,
  createScaledRate,
  createWeight,
  type CostSchedule,
  type InterimAuthorization,
  type OptimizerResponse,
  type PlanningCandidate,
  type PlanningTurnoverWindow,
  type ScaledRate,
  type TaxRuleSet,
  type Weight,
} from '../../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  makePolicyResolution,
} from './fixtures.ts'

function valueOf<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new TypeError('Invalid arbitrary value')
  return result.value
}

export const moneyArbitrary = fc.bigInt({ min: 0n, max: 10_000_000_000n })
  .map((minorUnits) => valueOf(createMoney(minorUnits)))

export const quantityArbitrary = fc.bigInt({ min: 0n, max: 10_000n })
  .map((shares) => valueOf(createQuantity(shares)))

export const weightArbitrary: fc.Arbitrary<Weight> =
  fc.bigInt({ min: 0n, max: 1_000_000n })
    .map((partsPerMillion) => valueOf(createWeight(partsPerMillion)))

export const scaledRateArbitrary: fc.Arbitrary<ScaledRate> =
  fc.bigInt({ min: 0n, max: 1_000_000n })
    .map((numerator) => valueOf(createScaledRate(numerator, 1_000_000n)))

export const planningCandidateArbitrary: fc.Arbitrary<PlanningCandidate> = fc.record({
  suffix: fc.integer({ min: 1, max: 1_000 }),
  rank: fc.integer({ min: 1, max: 100 }),
  score: fc.bigInt({ min: 0n, max: 1_000_000n }),
  conviction: fc.bigInt({ min: 800_000n, max: 1_200_000n }),
  volatility: fc.bigInt({ min: 1n, max: 1_000_000n }),
  price: fc.bigInt({ min: 100n, max: 1_000_000n }),
  liquidity: fc.bigInt({ min: 100_000n, max: 100_000_000n }),
  marketCapBucket: fc.constantFrom('LARGE_CAP', 'MID_CAP', 'SMALL_CAP'),
}).map((value) => Object.freeze({
  instrumentId: `GENERATED-${value.suffix}` as PlanningCandidate['instrumentId'],
  eligibilityStatus: 'ELIGIBLE',
  hardRiskFlag: false,
  mandatoryEligibilityFailure: false,
  corporateActionBlocked: false,
  corporateActionVerified: false,
  rank: value.rank,
  compositeScorePpm: value.score,
  convictionMultiplier: valueOf(createScaledRate(value.conviction, 1_000_000n)),
  realizedVolatility: valueOf(createScaledRate(value.volatility, 1_000_000n)),
  sectorId: `SECTOR-${value.suffix % 10}`,
  groupId: `GROUP-${value.suffix % 20}`,
  marketCapBucket: value.marketCapBucket,
  price: valueOf(createMoney(value.price)),
  liquidityCapacity: valueOf(createMoney(value.liquidity)),
  availableDeliveryQuantity: valueOf(createQuantity(0n)),
}))

export const candidateUniverseArbitrary = fc.uniqueArray(
  planningCandidateArbitrary,
  {
    minLength: 1,
    maxLength: 10,
    selector: (candidate) => candidate.instrumentId,
  },
)

export const costScheduleArbitrary: fc.Arbitrary<CostSchedule> =
  fc.bigInt({ min: 0n, max: 10_000n }).map((ratePpm) => {
    const fixture = makePolicyResolution().costSchedule
    return Object.freeze({
      scheduleVersionId: fixture.scheduleVersionId,
      effectiveFrom: fixture.effectiveFrom,
      chargeRules: Object.freeze(fixture.chargeRules.map((rule) =>
        Object.freeze({ ...rule, ratePpm }))),
      spreadRatePpm: ratePpm,
      slippageRatePpm: ratePpm,
      impactRatePpm: ratePpm,
    })
  })

export const taxRuleSetArbitrary: fc.Arbitrary<TaxRuleSet> = fc.record({
  threshold: fc.integer({ min: 1, max: 1_000 }),
  shortRate: fc.bigInt({ min: 0n, max: 500_000n }),
  longRate: fc.bigInt({ min: 0n, max: 500_000n }),
  policy: fc.constantFrom('FIFO', 'HIFO', 'SPECIFIC'),
}).map((value) => Object.freeze({
  taxRuleVersionId: FIXTURE_IDS.taxRuleVersionId,
  effectiveFrom: '2026-01-01' as TaxRuleSet['effectiveFrom'],
  holdingPeriodThresholdDays: value.threshold,
  shortTermRatePpm: value.shortRate,
  longTermRatePpm: value.longRate,
  lotSelectionPolicy: value.policy,
}))

export const turnoverWindowsArbitrary: fc.Arbitrary<readonly PlanningTurnoverWindow[]> =
  fc.uniqueArray(
    fc.record({
      windowKind: fc.constantFrom(
        'ROLLING_30_DAY',
        'CALENDAR_MONTH',
        'CALENDAR_QUARTER',
        'CALENDAR_YEAR',
      ),
      limit: fc.bigInt({ min: 1n, max: 1_000_000n }),
      consumed: fc.bigInt({ min: 0n, max: 1_000_000n }),
    }).map((value) => Object.freeze({
      windowKind: value.windowKind,
      budgetLimit: valueOf(createScaledRate(value.limit, 1_000_000n)),
      consumedBeforePlan: valueOf(createScaledRate(
        value.consumed > value.limit ? value.limit : value.consumed,
        1_000_000n,
      )),
    })),
    {
      minLength: 1,
      maxLength: 4,
      selector: (window) => window.windowKind,
    },
  ).map((windows) => Object.freeze(windows))

export const interimAuthorizationArbitrary: fc.Arbitrary<InterimAuthorization> =
  fc.constantFrom(
    'HARD_RISK_EXIT',
    'MANDATORY_ELIGIBILITY_FAILURE',
    'VERIFIED_CORPORATE_ACTION',
    'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
  ).map((reasonFamily) => Object.freeze({
    reasonFamily,
    sourceIds: Object.freeze([`SOURCE-${reasonFamily}`]),
    verifiedAt: '2026-07-31T12:00:00.000Z' as InterimAuthorization['verifiedAt'],
    verifiedBy: 'ACTOR-U04-GENERATED' as InterimAuthorization['verifiedBy'],
    exposureDeltaOnly: reasonFamily === 'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
    advisoryEvidenceExcluded: true,
  }))

export const optimizerResponseArbitrary: fc.Arbitrary<OptimizerResponse> = fc.record({
  status: fc.constantFrom('CANDIDATE', 'TIMEOUT', 'INFEASIBLE', 'SOLVER_ERROR'),
  durationMs: fc.integer({ min: 0, max: 750 }),
  iterationCount: fc.integer({ min: 0, max: 1_000 }),
  shares: fc.bigInt({ min: 0n, max: 4n }),
}).map((value) => Object.freeze({
  status: value.status,
  requestHash: FIXTURE_IDS.inputHash,
  positions: Object.freeze([Object.freeze({
    instrumentId: 'GENERATED-OPTIMIZER-1' as OptimizerResponse['positions'][number]['instrumentId'],
    targetQuantity: valueOf(createQuantity(value.shares)),
  })]),
  residualCash: valueOf(createMoney(1_000_000n - value.shares * 10_000n)),
  durationMs: value.durationMs,
  iterationCount: value.iterationCount,
  violatedConstraintIds: Object.freeze([]),
}))

export const hostileInputArbitrary = fc.oneof(
  fc.constant(null),
  fc.constant(Object.create({ polluted: true }) as unknown),
  fc.array(fc.anything(), { minLength: 11, maxLength: 20 }),
  fc.record({ __proto__: fc.constant({ polluted: true }) }),
)
