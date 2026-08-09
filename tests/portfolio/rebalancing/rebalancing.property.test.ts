import assert from 'node:assert/strict'
import test from 'node:test'
import fc from 'fast-check'

import {
  GreedyBaselineOptimizerAdapter,
  OptimizerOrchestrationService,
  allocateWholeSharesGreedy,
  canonicalPlanJson,
  constructIdealTarget,
  createOptimizerRequestHash,
  createPlanInputHash,
  evaluateTurnoverWindows,
  hashCanonicalPlan,
  projectCandidates,
  success,
  verifyConstructionConstraints,
  type ConstructionConstraintSet,
  type OptimizerPort,
  type OptimizerRequest,
  type PlanningCandidate,
  type PlanningTiming,
} from '../../../server/portfolio/index.ts'
import {
  candidateUniverseArbitrary,
  turnoverWindowsArbitrary,
} from './support/arbitraries.ts'
import {
  FIXTURE_IDS,
  exactMoney,
  exactQuantity,
} from './support/fixtures.ts'
import {
  isEquivalentOrBetterThanReference,
  solveSmallProblemOracle,
} from './support/oracle.ts'

const PURE_RUNS = 1_000
const EXPENSIVE_RUNS = 100
const SEED = 40_400_448

function constraints(targetHoldings: number): ConstructionConstraintSet {
  return Object.freeze({
    targetHoldings,
    maxHoldings: targetHoldings,
    maxStockWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxSectorWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxGroupWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxSmallCapWeight: Object.freeze({ partsPerMillion: 1_000_000n }),
    maxLiquidityParticipation: Object.freeze({ numerator: 1n, scale: 1n }),
    cashBufferFloor: Object.freeze({ partsPerMillion: 100_000n }),
    regimeExposureCap: Object.freeze({ partsPerMillion: 900_000n }),
    turnoverBudgetCeiling: Object.freeze({ numerator: 1n, scale: 1n }),
    minimumOrderValue: exactMoney(0n),
    replacementScoreGap: Object.freeze({ numerator: 0n, scale: 1n }),
    preferredMinimumHoldDays: 0,
    absoluteDriftBand: Object.freeze({ partsPerMillion: 0n }),
    relativeDriftBand: Object.freeze({ numerator: 0n, scale: 1n }),
  })
}

const TIMING: PlanningTiming = Object.freeze({
  calendarSessionId: FIXTURE_IDS.calendarSessionId,
  decisionSessionDate: '2026-07-31' as PlanningTiming['decisionSessionDate'],
  decisionReadyAt: '2026-07-31T12:00:00.000Z' as PlanningTiming['decisionReadyAt'],
  eligibleExecutionDate: '2026-08-03' as PlanningTiming['eligibleExecutionDate'],
  eligibleExecutionWindowStart: '09:45',
  eligibleExecutionWindowEnd: '11:30',
  timeZone: 'Asia/Kolkata',
  finalized: true,
  sameSessionExecutionAllowed: false,
})

function idealFor(candidates: readonly PlanningCandidate[]) {
  const projection = projectCandidates(candidates)
  if (!projection.ok) throw new TypeError(projection.error.code)
  const result = constructIdealTarget({
    projection: projection.value,
    startingNav: exactMoney(10_000_000n),
    constraints: constraints(candidates.length),
  })
  if (!result.ok) throw new TypeError(result.error.code)
  return result.value
}

test('property: canonical hash round-trip and key order determinism', () => {
  fc.assert(fc.property(
    fc.dictionary(
      fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,8}$/u),
      fc.oneof(fc.integer(), fc.bigInt(), fc.boolean(), fc.string()),
    ),
    (value) => {
      const json = canonicalPlanJson(value)
      const parsed = JSON.parse(json) as unknown
      assert.equal(canonicalPlanJson(parsed), json)
      assert.equal(hashCanonicalPlan(value), hashCanonicalPlan(parsed))
      assert.equal(createPlanInputHash(value).length, 64)
    },
  ), { numRuns: PURE_RUNS, seed: SEED })
})

test('property: candidate permutations produce equivalent ideal targets', () => {
  fc.assert(fc.property(candidateUniverseArbitrary, (candidates) => {
    const forward = idealFor(candidates)
    const reverse = idealFor(Object.freeze([...candidates].reverse()))
    assert.deepEqual(reverse, forward)
  }), { numRuns: PURE_RUNS, seed: SEED + 1 })
})

test('property: exact ideal and executable cash, weight, shorting and leverage invariants', () => {
  fc.assert(fc.property(candidateUniverseArbitrary, (candidates) => {
    const ideal = idealFor(candidates)
    assert.equal(
      ideal.totalEquityWeight.partsPerMillion + ideal.cashWeight.partsPerMillion,
      1_000_000n,
    )
    const first = allocateWholeSharesGreedy({
      idealTarget: ideal,
      candidates,
      startingNav: exactMoney(10_000_000n),
      constraints: constraints(candidates.length),
      timing: TIMING,
    })
    const second = allocateWholeSharesGreedy({
      idealTarget: ideal,
      candidates,
      startingNav: exactMoney(10_000_000n),
      constraints: constraints(candidates.length),
      timing: TIMING,
    })
    assert.equal(first.ok, true)
    assert.deepEqual(second, first)
    if (!first.ok) return
    assert.ok(first.value.residualCash.minorUnits >= 0n)
    assert.ok(first.value.positions.every((position) =>
      position.targetQuantity.shares >= 0n))
    const invested = first.value.positions.reduce(
      (total, position) => total + position.targetValue.minorUnits,
      0n,
    )
    assert.ok(invested + first.value.residualCash.minorUnits <= 10_000_000n)
    assert.ok(first.value.constraintChecks.every((check) => check.passed))
  }), { numRuns: PURE_RUNS, seed: SEED + 2 })
})

test('property: turnover consumption is monotone within every window', () => {
  fc.assert(fc.property(
    turnoverWindowsArbitrary,
    fc.bigInt({ min: 0n, max: 100_000n }),
    (windows, consumption) => {
      const result = evaluateTurnoverWindows({
        proposedConsumption: Object.freeze({
          numerator: consumption,
          scale: 1_000_000n,
        }),
        windows,
      })
      assert.equal(result.ok, true)
      if (!result.ok) return
      for (const window of result.value.windows) {
        assert.ok(
          window.consumedAfterPlan.numerator
            >= window.consumedBeforePlan.numerator,
        )
        assert.ok(window.remainingAfterPlan.numerator >= 0n)
        assert.ok(
          window.remainingAfterPlan.numerator
            <= window.remainingBeforePlan.numerator,
        )
      }
    },
  ), { numRuns: PURE_RUNS, seed: SEED + 3 })
})

test('property: the shared verifier accepts generated safe targets and rejects cap breaches', () => {
  fc.assert(fc.property(
    fc.bigInt({ min: 0n, max: 500_000n }),
    (weightPpm) => {
      const value = weightPpm * 10n
      const safe = verifyConstructionConstraints({
        positions: Object.freeze([Object.freeze({
          instrumentId: 'VERIFY-GENERATED' as PlanningCandidate['instrumentId'],
          decisionPrice: exactMoney(1_000n),
          targetQuantity: exactQuantity(value / 1_000n),
          targetValue: exactMoney(value),
          targetWeight: Object.freeze({ partsPerMillion: weightPpm }),
          currentQuantity: exactQuantity(0n),
          availableDeliveryQuantity: exactQuantity(0n),
          liquidityCapacity: exactMoney(10_000_000n),
          sectorId: 'SAFE',
          groupId: 'SAFE',
          marketCapBucket: 'LARGE_CAP',
        })]),
        residualCash: exactMoney(10_000_000n - value),
        startingNav: exactMoney(10_000_000n),
        constraints: Object.freeze({
          ...constraints(1),
          maxStockWeight: Object.freeze({ partsPerMillion: 500_000n }),
        }),
        proposedTurnoverPpm: weightPpm,
        timing: TIMING,
      })
      assert.equal(safe.accepted, true)
      const unsafe = verifyConstructionConstraints({
        positions: Object.freeze([Object.freeze({
          instrumentId: 'VERIFY-GENERATED' as PlanningCandidate['instrumentId'],
          decisionPrice: exactMoney(1_000n),
          targetQuantity: exactQuantity(6_000n),
          targetValue: exactMoney(6_000_000n),
          targetWeight: Object.freeze({ partsPerMillion: 600_000n }),
          currentQuantity: exactQuantity(0n),
          availableDeliveryQuantity: exactQuantity(0n),
          liquidityCapacity: exactMoney(10_000_000n),
          sectorId: 'SAFE',
          groupId: 'SAFE',
          marketCapBucket: 'LARGE_CAP',
        })]),
        residualCash: exactMoney(4_000_000n),
        startingNav: exactMoney(10_000_000n),
        constraints: Object.freeze({
          ...constraints(1),
          maxStockWeight: Object.freeze({ partsPerMillion: 500_000n }),
        }),
        proposedTurnoverPpm: 600_000n,
        timing: TIMING,
      })
      assert.equal(unsafe.accepted, false)
      assert.ok(unsafe.violatedConstraintIds.includes('SINGLE_NAME_CAP'))
    },
  ), { numRuns: PURE_RUNS, seed: SEED + 4 })
})

test('property: optimizer failure always preserves deterministic greedy positions', async () => {
  await fc.assert(fc.asyncProperty(
    candidateUniverseArbitrary,
    fc.constantFrom('TIMEOUT', 'INFEASIBLE', 'SOLVER_ERROR'),
    async (candidates, status) => {
      const ideal = idealFor(candidates)
      const greedy = allocateWholeSharesGreedy({
        idealTarget: ideal,
        candidates,
        startingNav: exactMoney(10_000_000n),
        constraints: constraints(candidates.length),
        timing: TIMING,
      })
      assert.equal(greedy.ok, true)
      if (!greedy.ok) return
      const port: OptimizerPort = Object.freeze({
        optimize: async (request: OptimizerRequest) => success(Object.freeze({
          status,
          requestHash: request.requestHash,
          positions: Object.freeze([]),
          residualCash: request.availableCash,
          durationMs: 1,
          iterationCount: 0,
          violatedConstraintIds: Object.freeze([]),
        })),
      })
      const result = await new OptimizerOrchestrationService(port).optimize({
        portfolioId: FIXTURE_IDS.portfolioId,
        mode: 'INTEGER_TRACKING',
        timeoutBudgetMs: 250,
        greedyTarget: greedy.value,
        idealWeights: new Map(ideal.positions.map((position) =>
          [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
        candidates,
        startingNav: exactMoney(10_000_000n),
        constraints: constraints(candidates.length),
        timing: TIMING,
      })
      assert.deepEqual(result.executableTarget.positions, greedy.value.positions)
      assert.equal(result.optimizerOutcome.status, 'FALLBACK_USED')
    },
  ), { numRuns: EXPENSIVE_RUNS, seed: SEED + 5 })
})

test('property: exact oracle is equivalent to or better than greedy on 100 small problems', async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 1, max: 4 }),
    fc.integer({ min: 1, max: 4 }),
    async (firstMax, secondMax) => {
      const base = {
        portfolioId: FIXTURE_IDS.portfolioId,
        mode: 'INTEGER_TRACKING' as const,
        candidateSetHash: createPlanInputHash({ firstMax, secondMax }),
        availableCash: exactMoney(100_000n),
        candidates: Object.freeze([
          Object.freeze({
            instrumentId: 'ORACLE-PBT-A' as PlanningCandidate['instrumentId'],
            price: exactMoney(10_000n),
            currentQuantity: exactQuantity(0n),
            idealWeight: Object.freeze({ partsPerMillion: 500_000n }),
            maximumQuantity: exactQuantity(BigInt(firstMax)),
          }),
          Object.freeze({
            instrumentId: 'ORACLE-PBT-B' as PlanningCandidate['instrumentId'],
            price: exactMoney(10_000n),
            currentQuantity: exactQuantity(0n),
            idealWeight: Object.freeze({ partsPerMillion: 500_000n }),
            maximumQuantity: exactQuantity(BigInt(secondMax)),
          }),
        ]),
        hardConstraints: Object.freeze([]),
        turnoverWindowCount: 1,
        timeoutBudgetMs: 250,
        objective: Object.freeze({
          kind: 'MINIMIZE_TRACKING_ERROR' as const,
          tolerancePpm: 0n,
        }),
      }
      const request: OptimizerRequest = Object.freeze({
        ...base,
        requestHash: createOptimizerRequestHash(base),
      })
      const oracle = await solveSmallProblemOracle(request)
      const greedy = await new GreedyBaselineOptimizerAdapter().optimize(request)
      assert.equal(greedy.ok, true)
      if (!greedy.ok) return
      assert.equal(isEquivalentOrBetterThanReference({
        request,
        candidate: oracle,
        reference: greedy.value,
      }), true)
    },
  ), { numRuns: EXPENSIVE_RUNS, seed: SEED + 6 })
})
