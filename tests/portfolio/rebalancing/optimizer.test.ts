import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GreedyBaselineOptimizerAdapter,
  OptimizerOrchestrationService,
  PlanningSnapshotAssembler,
  allocateWholeSharesGreedy,
  constructIdealTarget,
  createOptimizerRequestHash,
  createPlanInputHash,
  projectCandidates,
  success,
  type OptimizerPort,
  type OptimizerRequest,
  type OptimizerResponse,
  type PlanningCandidate,
} from '../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  exactMoney,
  exactQuantity,
  makeAssemblyRequest,
  makeFakePorts,
} from './support/fixtures.ts'
import {
  isEquivalentOrBetterThanReference,
  solveSmallProblemOracle,
} from './support/oracle.ts'

async function optimizerValues() {
  const assembled = await new PlanningSnapshotAssembler(makeFakePorts())
    .assemble(makeAssemblyRequest())
  assert.equal(assembled.ok, true)
  if (!assembled.ok) throw new TypeError('assembly failed')
  const projection = projectCandidates(assembled.value.context.candidates)
  assert.equal(projection.ok, true)
  if (!projection.ok) throw new TypeError('projection failed')
  const startingNav = exactMoney(1_000_000n)
  const ideal = constructIdealTarget({
    projection: projection.value,
    startingNav,
    constraints: assembled.value.context.constraints,
  })
  assert.equal(ideal.ok, true)
  if (!ideal.ok) throw new TypeError('ideal target failed')
  const greedy = allocateWholeSharesGreedy({
    idealTarget: ideal.value,
    candidates: assembled.value.context.candidates,
    startingNav,
    constraints: assembled.value.context.constraints,
    timing: assembled.value.context.timing,
  })
  assert.equal(greedy.ok, true)
  if (!greedy.ok) throw new TypeError('greedy allocation failed')
  return {
    context: assembled.value.context,
    startingNav,
    ideal: ideal.value,
    greedy: greedy.value,
  }
}

test('verified optimizer candidate is accepted only after shared verification', async () => {
  const values = await optimizerValues()
  const result = await new OptimizerOrchestrationService(
    new GreedyBaselineOptimizerAdapter(),
  ).optimize({
    portfolioId: values.context.portfolioId,
    mode: 'INTEGER_TRACKING',
    timeoutBudgetMs: 250,
    greedyTarget: values.greedy,
    idealWeights: new Map(values.ideal.positions.map((position) =>
      [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.optimizerOutcome.status, 'VERIFIED_ACCEPTED')
  assert.equal(result.optimizerOutcome.verifierAccepted, true)
  assert.equal(result.executableTarget.allocationMethod, 'OPTIMIZER_PRIMARY')
})

test('timeout and infeasibility expose deterministic greedy fallback metadata', async () => {
  const values = await optimizerValues()
  for (const status of ['TIMEOUT', 'INFEASIBLE'] as const) {
    const port: OptimizerPort = Object.freeze({
      optimize: async (request: OptimizerRequest) => success(Object.freeze({
        status,
        requestHash: request.requestHash,
        positions: Object.freeze([]),
        residualCash: request.availableCash,
        durationMs: 10,
        iterationCount: 1,
        violatedConstraintIds: Object.freeze([]),
      })),
    })
    const result = await new OptimizerOrchestrationService(port).optimize({
      portfolioId: values.context.portfolioId,
      mode: 'INTEGER_TRACKING',
      timeoutBudgetMs: 250,
      greedyTarget: values.greedy,
      idealWeights: new Map(values.ideal.positions.map((position) =>
        [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
      candidates: values.context.candidates,
      startingNav: values.startingNav,
      constraints: values.context.constraints,
      timing: values.context.timing,
    })
    assert.equal(result.optimizerOutcome.status, 'FALLBACK_USED')
    assert.equal(result.optimizerOutcome.fallbackReason, status)
    assert.deepEqual(result.executableTarget.positions, values.greedy.positions)
  }
})

test('missing metadata and verifier rejection cannot escape to output', async () => {
  const values = await optimizerValues()
  const invalidPort: OptimizerPort = Object.freeze({
    optimize: async (request: OptimizerRequest) => success(Object.freeze({
      status: 'CANDIDATE',
      requestHash: request.requestHash,
      positions: Object.freeze(request.candidates.map((candidate) =>
        Object.freeze({
          instrumentId: candidate.instrumentId,
          targetQuantity: exactQuantity(10_000n),
        }))),
      residualCash: exactMoney(-1n),
      durationMs: Number.NaN,
      iterationCount: -1,
      violatedConstraintIds: Object.freeze([]),
    })),
  })
  const result = await new OptimizerOrchestrationService(invalidPort).optimize({
    portfolioId: values.context.portfolioId,
    mode: 'RISK_PARITY',
    timeoutBudgetMs: 250,
    greedyTarget: values.greedy,
    idealWeights: new Map(values.ideal.positions.map((position) =>
      [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.optimizerOutcome.status, 'FALLBACK_USED')
  assert.equal(result.optimizerOutcome.fallbackReason, 'VERIFICATION_REJECTED')
  assert.deepEqual(result.executableTarget.positions, values.greedy.positions)
})

test('oversized optimizer requests bypass the port and use greedy fallback', async () => {
  const values = await optimizerValues()
  let called = false
  const port: OptimizerPort = Object.freeze({
    optimize: async (): Promise<ReturnType<OptimizerPort['optimize']> extends Promise<infer T> ? T : never> => {
      called = true
      throw new TypeError('must not be called')
    },
  })
  const template = values.context.candidates[0] as PlanningCandidate
  const candidates = Object.freeze(Array.from({ length: 76 }, (_, index) =>
    Object.freeze({
      ...template,
      instrumentId: `OVERSIZED-OPT-${index}` as PlanningCandidate['instrumentId'],
      currentHolding: undefined,
    }) as unknown as PlanningCandidate))
  const result = await new OptimizerOrchestrationService(port).optimize({
    portfolioId: values.context.portfolioId,
    mode: 'INTEGER_TRACKING',
    timeoutBudgetMs: 750,
    greedyTarget: values.greedy,
    idealWeights: new Map(),
    candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(called, false)
  assert.equal(result.optimizerOutcome.status, 'FALLBACK_USED')
  assert.equal(result.optimizerOutcome.fallbackReason, 'INFEASIBLE')
})

test('small exact oracle defines equivalence or improvement tolerance', async () => {
  const base = {
    portfolioId: FIXTURE_IDS.portfolioId,
    mode: 'INTEGER_TRACKING' as const,
    candidateSetHash: createPlanInputHash({ candidates: 2 }),
    availableCash: exactMoney(100_000n),
    candidates: Object.freeze([
      Object.freeze({
        instrumentId: 'ORACLE-A' as PlanningCandidate['instrumentId'],
        price: exactMoney(10_000n),
        currentQuantity: exactQuantity(0n),
        idealWeight: Object.freeze({ partsPerMillion: 500_000n }),
        maximumQuantity: exactQuantity(4n),
      }),
      Object.freeze({
        instrumentId: 'ORACLE-B' as PlanningCandidate['instrumentId'],
        price: exactMoney(10_000n),
        currentQuantity: exactQuantity(0n),
        idealWeight: Object.freeze({ partsPerMillion: 500_000n }),
        maximumQuantity: exactQuantity(4n),
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
  const baselineResult = await new GreedyBaselineOptimizerAdapter().optimize(request)
  assert.equal(baselineResult.ok, true)
  if (!baselineResult.ok) return
  const baseline: OptimizerResponse = baselineResult.value
  assert.equal(isEquivalentOrBetterThanReference({
    request,
    candidate: oracle,
    reference: baseline,
  }), true)
})

test('optimizer orchestration enforces its timeout even when the port never settles', async () => {
  const values = await optimizerValues()
  const hangingPort: OptimizerPort = Object.freeze({
    optimize: async () => new Promise<never>(() => {}),
  })
  const result = await new OptimizerOrchestrationService(hangingPort).optimize({
    portfolioId: values.context.portfolioId,
    mode: 'INTEGER_TRACKING',
    timeoutBudgetMs: 1,
    greedyTarget: values.greedy,
    idealWeights: new Map(values.ideal.positions.map((position) =>
      [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
    candidates: values.context.candidates,
    startingNav: values.startingNav,
    constraints: values.context.constraints,
    timing: values.context.timing,
  })
  assert.equal(result.optimizerOutcome.status, 'FALLBACK_USED')
  assert.equal(result.optimizerOutcome.fallbackReason, 'TIMEOUT')
  assert.deepEqual(result.executableTarget.positions, values.greedy.positions)
})
