import os from 'node:os'
import { performance } from 'node:perf_hooks'

import {
  OptimizerOrchestrationService,
  PlanningSnapshotAssembler,
  RebalancePlanningService,
  SmallProblemOracleOptimizerAdapter,
  allocateWholeSharesGreedy,
  comparePlanEquivalence,
  constructIdealTarget,
  createOptimizerRequestHash,
  createPlanHash,
  createPlanInputHash,
  estimateOrderCost,
  projectCandidates,
  selectTaxLots,
  success,
  verifyConstructionConstraints,
  U04_BENCHMARK_MEASURED_ITERATIONS,
  U04_BENCHMARK_SEED,
  U04_BENCHMARK_WARMUP_ITERATIONS,
  U04_COST_TAX_P95_BUDGET_MS,
  U04_DEFAULT_OPTIMIZER_TIMEOUT_MS,
  U04_EXECUTABLE_SEED_P95_BUDGET_MS,
  U04_FALLBACK_P95_BUDGET_MS,
  U04_FULL_PLAN_HEAP_BUDGET_BYTES,
  U04_FULL_PLAN_P95_BUDGET_MS,
  U04_GREEDY_P95_BUDGET_MS,
  U04_HASH_P95_BUDGET_MS,
  U04_IDEAL_TARGET_P95_BUDGET_MS,
  U04_MAX_OPTIMIZER_TIMEOUT_MS,
  U04_OPTIMIZER_HEAP_BUDGET_BYTES,
  U04_PLAN_ASSEMBLY_P95_BUDGET_MS,
  U04_REPLAY_P95_BUDGET_MS,
  U04_VERIFIER_P95_BUDGET_MS,
  type ConstructionConstraintSet,
  type HoldingLot,
  type HoldingLotId,
  type InstrumentId,
  type OptimizerPort,
  type OptimizerRequest,
  type PlanningCandidate,
  type PlanningSnapshot,
  type PlanningTiming,
  type StrategyConfig,
} from '../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  exactMoney,
  exactQuantity,
  makeAssemblyRequest,
  makeFakePorts,
  makePlanningSnapshot,
  makePolicyResolution,
  makePortfolioSnapshot,
  makeStrategyConfig,
} from '../tests/portfolio/rebalancing/support/fixtures.ts'

type Measurement = Readonly<{
  name: string
  p50Ms: number
  p95Ms: number
  maxMs: number
  heapDeltaBytes: number
  thresholdMs: number
  inputSizes: Readonly<Record<string, number>>
}>

const failures: string[] = []
const measurements: Measurement[] = []

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

async function benchmark(
  name: string,
  thresholdMs: number,
  inputSizes: Readonly<Record<string, number>>,
  operation: () => void | Promise<void>,
  measuredIterations = U04_BENCHMARK_MEASURED_ITERATIONS,
): Promise<Measurement> {
  for (let index = 0; index < U04_BENCHMARK_WARMUP_ITERATIONS; index += 1) {
    await operation()
  }
  global.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const durations: number[] = []
  for (let index = 0; index < measuredIterations; index += 1) {
    const startedAt = performance.now()
    await operation()
    durations.push(performance.now() - startedAt)
  }
  global.gc?.()
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
  durations.sort((left, right) => left - right)
  const result: Measurement = Object.freeze({
    name,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations[durations.length - 1] ?? 0,
    heapDeltaBytes,
    thresholdMs,
    inputSizes,
  })
  measurements.push(result)
  if (result.p95Ms >= thresholdMs) {
    failures.push(`${name} p95 ${result.p95Ms.toFixed(3)}ms >= ${thresholdMs}ms`)
  }
  console.log(JSON.stringify(result))
  return result
}

function makeCandidate(index: number): PlanningCandidate {
  return Object.freeze({
    instrumentId: `BENCHMARK-INSTRUMENT-${String(index).padStart(4, '0')}` as InstrumentId,
    eligibilityStatus: 'ELIGIBLE',
    hardRiskFlag: false,
    mandatoryEligibilityFailure: false,
    corporateActionBlocked: false,
    corporateActionVerified: false,
    rank: index + 1,
    compositeScorePpm: 1_000_000n - BigInt(index),
    convictionMultiplier: Object.freeze({ numerator: 1_000_000n, scale: 1_000_000n }),
    realizedVolatility: Object.freeze({
      numerator: 100_000n + BigInt(index % 100),
      scale: 1_000_000n,
    }),
    sectorId: `SECTOR-${index % 100}`,
    groupId: `GROUP-${index % 200}`,
    marketCapBucket: index % 5 === 0 ? 'SMALL_CAP' : 'LARGE_CAP',
    price: exactMoney(10_000n + BigInt(index)),
    liquidityCapacity: exactMoney(100_000_000n),
    availableDeliveryQuantity: exactQuantity(0n),
  })
}

const candidates = Object.freeze(Array.from({ length: 1_000 }, (_, index) =>
  makeCandidate(index)))
const constraints: ConstructionConstraintSet = Object.freeze({
  targetHoldings: 100,
  maxHoldings: 100,
  maxStockWeight: Object.freeze({ partsPerMillion: 50_000n }),
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
const timing: PlanningTiming = Object.freeze({
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
const startingNav = exactMoney(100_000_000n)
const projection = projectCandidates(candidates)
if (!projection.ok) throw new TypeError('Benchmark candidate projection failed')
const idealResult = constructIdealTarget({
  projection: projection.value,
  startingNav,
  constraints,
})
if (!idealResult.ok) throw new TypeError('Benchmark ideal target failed')
const idealTarget = idealResult.value
const greedyResult = allocateWholeSharesGreedy({
  idealTarget,
  candidates,
  startingNav,
  constraints,
  timing,
})
if (!greedyResult.ok) throw new TypeError('Benchmark greedy allocation failed')
const greedyTarget = greedyResult.value

const boundaryHashInput = Object.freeze({
  portfolioId: FIXTURE_IDS.portfolioId,
  holdings: Object.freeze(Array.from({ length: 1_000 }, (_, index) => ({
    instrumentId: `HOLDING-${index}`,
    quantity: BigInt(index),
  }))),
  lots: Object.freeze(Array.from({ length: 10_000 }, (_, index) => ({
    lotId: `LOT-${index}`,
    quantity: BigInt(index % 20),
    unitCost: 10_000n + BigInt(index),
  }))),
  candidates,
  turnoverWindows: Object.freeze([
    'ROLLING_30_DAY',
    'CALENDAR_MONTH',
    'CALENDAR_QUARTER',
    'CALENDAR_YEAR',
  ]),
})

const policy = makePolicyResolution()
const costSchedule = Object.freeze({
  scheduleVersionId: policy.costSchedule.scheduleVersionId,
  effectiveFrom: policy.costSchedule.effectiveFrom,
  chargeRules: policy.costSchedule.chargeRules,
  spreadRatePpm: policy.costSchedule.spreadRatePpm,
  slippageRatePpm: policy.costSchedule.slippageRatePpm,
  impactRatePpm: policy.costSchedule.impactRatePpm,
})
const lotTemplate = makePlanningSnapshot().portfolio.holdings[0]?.lots[0]
if (lotTemplate === undefined) throw new TypeError('Benchmark lot fixture missing')
const taxLots: readonly HoldingLot[] = Object.freeze(Array.from(
  { length: 800 },
  (_, index) => Object.freeze({
    ...lotTemplate,
    lotId: `BENCHMARK-LOT-${index}` as HoldingLotId,
    originalQuantity: exactQuantity(1n),
    openQuantity: exactQuantity(1n),
  }),
))
const taxRules = Object.freeze({
  taxRuleVersionId: policy.taxRuleSet.taxRuleVersionId,
  effectiveFrom: policy.taxRuleSet.effectiveFrom,
  holdingPeriodThresholdDays: policy.taxRuleSet.holdingPeriodThresholdDays,
  shortTermRatePpm: policy.taxRuleSet.shortTermRatePpm,
  longTermRatePpm: policy.taxRuleSet.longTermRatePpm,
  lotSelectionPolicy: policy.taxRuleSet.lotSelectionPolicy,
})

const verifierPositions = Object.freeze(Array.from(
  { length: 1_000 },
  (_, index) => Object.freeze({
    instrumentId: `VERIFY-${index}` as InstrumentId,
    decisionPrice: exactMoney(10_000n),
    targetQuantity: exactQuantity(0n),
    targetValue: exactMoney(0n),
    targetWeight: Object.freeze({ partsPerMillion: 0n }),
    currentQuantity: exactQuantity(0n),
    availableDeliveryQuantity: exactQuantity(0n),
    liquidityCapacity: exactMoney(1_000_000n),
    sectorId: `SECTOR-${index % 100}`,
    groupId: `GROUP-${index % 200}`,
    marketCapBucket: 'LARGE_CAP' as const,
  }),
))

const minimalBuckets = Object.freeze({
  proposed: Object.freeze([]),
  skipped: Object.freeze([]),
  blocked: Object.freeze([]),
})
const replayPlan = Object.freeze({
  planInputHash: FIXTURE_IDS.inputHash,
  planHash: FIXTURE_IDS.planHash,
  actionBuckets: minimalBuckets,
})

const timeoutPort: OptimizerPort = Object.freeze({
  optimize: async (request: OptimizerRequest) => success(Object.freeze({
    status: 'TIMEOUT',
    requestHash: request.requestHash,
    positions: Object.freeze([]),
    residualCash: request.availableCash,
    durationMs: 0,
    iterationCount: 0,
    violatedConstraintIds: Object.freeze([]),
  })),
})
const optimizerService = new OptimizerOrchestrationService(timeoutPort)
const optimizerInput = Object.freeze({
  portfolioId: FIXTURE_IDS.portfolioId,
  mode: 'INTEGER_TRACKING' as const,
  timeoutBudgetMs: 250,
  greedyTarget,
  idealWeights: new Map(idealTarget.positions.map((position) =>
    [position.instrumentId, position.targetWeight.partsPerMillion] as const)),
  candidates: candidates.slice(0, 75),
  startingNav,
  constraints,
  timing,
})

const oracleBase = {
  portfolioId: FIXTURE_IDS.portfolioId,
  mode: 'INTEGER_TRACKING' as const,
  candidateSetHash: createPlanInputHash({ oracle: true }),
  availableCash: exactMoney(100_000n),
  candidates: Object.freeze([
    Object.freeze({
      instrumentId: 'ORACLE-BENCH-A' as InstrumentId,
      price: exactMoney(10_000n),
      currentQuantity: exactQuantity(0n),
      idealWeight: Object.freeze({ partsPerMillion: 500_000n }),
      maximumQuantity: exactQuantity(4n),
    }),
    Object.freeze({
      instrumentId: 'ORACLE-BENCH-B' as InstrumentId,
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
const oracleRequest: OptimizerRequest = Object.freeze({
  ...oracleBase,
  requestHash: createOptimizerRequestHash(oracleBase),
})
const oracleAdapter = new SmallProblemOracleOptimizerAdapter()

const baseSnapshot = makePlanningSnapshot()
const boundaryEvaluations: PlanningSnapshot['evaluations'] = Object.freeze(
  Array.from({ length: 1_000 }, (_, index) => {
    const template = baseSnapshot.evaluations[index % baseSnapshot.evaluations.length]
    if (template === undefined) throw new TypeError('Benchmark evaluation fixture missing')
    const instrumentId = `FULL-PLAN-${String(index).padStart(4, '0')}` as InstrumentId
    return Object.freeze({
      ...template,
      eligibility: Object.freeze({
        ...template.eligibility,
        instrumentId,
        status: 'ELIGIBLE',
      }),
      signal: Object.freeze({
        ...template.signal,
        instrumentId,
        rank: index + 1,
      }),
      sectorId: `SECTOR-${index % 100}`,
      groupId: `GROUP-${index % 200}`,
      marketCapBucket: index % 5 === 0 ? 'SMALL_CAP' : 'LARGE_CAP',
      priceMinorUnits: 10_000n + BigInt(index),
      realizedVolatilityPpm: 100_000n + BigInt(index % 100),
      liquidityCapacityMinorUnits: 100_000_000n,
    })
  }),
)
const fullPlanConfig: StrategyConfig = Object.freeze({
  ...makeStrategyConfig(),
  construction: Object.freeze({
    targetHoldings: 100,
    maxHoldings: 100,
    replacementScoreGapPct: 5,
    cashBufferPct: 10,
  }),
  eligibility: Object.freeze({
    ...makeStrategyConfig().eligibility,
    maxStockWeightPct: 5,
  }),
})
const fullPlanSnapshot = makePlanningSnapshot({
  portfolio: makePortfolioSnapshot({
    holdings: Object.freeze([]),
    cash: startingNav,
  }),
  evaluations: boundaryEvaluations,
  strategyConfig: fullPlanConfig,
})
const fullPlanService = new RebalancePlanningService({
  assembler: new PlanningSnapshotAssembler(makeFakePorts({ snapshot: fullPlanSnapshot })),
})
const fullPlanRequest = Object.freeze({
  assembly: makeAssemblyRequest({
    constraintPolicy: Object.freeze({
      ...makeAssemblyRequest().constraintPolicy,
      maxSectorWeightPpm: 1_000_000n,
      maxGroupWeightPpm: 1_000_000n,
      maxSmallCapWeightPpm: 1_000_000n,
    }),
  }),
  phaseDurations: Object.freeze([
    Object.freeze({ phase: 'GATE' as const, durationMs: 0 }),
    Object.freeze({ phase: 'IDEAL_TARGET' as const, durationMs: 0 }),
    Object.freeze({ phase: 'EXECUTABLE_ALLOCATION' as const, durationMs: 0 }),
    Object.freeze({ phase: 'COST_TAX' as const, durationMs: 0 }),
    Object.freeze({ phase: 'CONSTRAINT_VERIFICATION' as const, durationMs: 0 }),
    Object.freeze({ phase: 'ASSEMBLY' as const, durationMs: 0 }),
  ]),
})

console.log(JSON.stringify({
  benchmark: 'U04 portfolio rebalancing',
  seed: U04_BENCHMARK_SEED,
  warmupIterations: U04_BENCHMARK_WARMUP_ITERATIONS,
  measuredIterations: U04_BENCHMARK_MEASURED_ITERATIONS,
  node: process.version,
  os: `${os.platform()} ${os.release()}`,
  processor: os.cpus()[0]?.model ?? 'unknown',
}))

await benchmark(
  'plan-input-hash',
  U04_HASH_P95_BUDGET_MS,
  { holdings: 1_000, lots: 10_000, candidates: 1_000, turnoverWindows: 4 },
  () => { createPlanInputHash(boundaryHashInput) },
)
await benchmark(
  'ideal-target',
  U04_IDEAL_TARGET_P95_BUDGET_MS,
  { candidates: 1_000, selectedPositions: 100 },
  () => {
    const result = constructIdealTarget({
      projection: projection.value,
      startingNav,
      constraints,
    })
    if (!result.ok) throw new TypeError('Ideal benchmark failed')
  },
)
await benchmark(
  'executable-seed',
  U04_EXECUTABLE_SEED_P95_BUDGET_MS,
  { positions: 100 },
  () => {
    const result = allocateWholeSharesGreedy({
      idealTarget,
      candidates: candidates.slice(0, 100),
      startingNav,
      constraints,
      timing,
    })
    if (!result.ok) throw new TypeError('Executable seed benchmark failed')
  },
)
await benchmark(
  'greedy-allocation',
  U04_GREEDY_P95_BUDGET_MS,
  { positions: 100 },
  () => {
    const result = allocateWholeSharesGreedy({
      idealTarget,
      candidates: candidates.slice(0, 100),
      startingNav,
      constraints,
      timing,
    })
    if (!result.ok) throw new TypeError('Greedy benchmark failed')
  },
)
await benchmark(
  'cost-and-tax',
  U04_COST_TAX_P95_BUDGET_MS,
  { proposedOrders: 250, sellLots: 800 },
  () => {
    for (let index = 0; index < 250; index += 1) {
      const cost = estimateOrderCost({
        schedule: costSchedule,
        asOf: '2026-07-31' as typeof costSchedule.effectiveFrom,
        side: index % 2 === 0 ? 'BUY' : 'SELL',
        grossNotional: exactMoney(1_000_000n),
      })
      if (!cost.ok) throw new TypeError('Cost benchmark failed')
    }
    const tax = selectTaxLots({
      lots: taxLots,
      sellQuantity: exactQuantity(800n),
      salePrice: exactMoney(15_000n),
      asOf: '2026-07-31' as typeof costSchedule.effectiveFrom,
      taxRules,
      mandatoryHardRiskExit: false,
    })
    if (!tax.ok) throw new TypeError('Tax benchmark failed')
  },
)
await benchmark(
  'constraint-verifier',
  U04_VERIFIER_P95_BUDGET_MS,
  { actionBuckets: 1_000 },
  () => {
    const result = verifyConstructionConstraints({
      positions: verifierPositions,
      residualCash: startingNav,
      startingNav,
      constraints,
      proposedTurnoverPpm: 0n,
      timing,
    })
    if (!result.accepted) throw new TypeError('Verifier benchmark failed')
  },
)
await benchmark(
  'plan-assembly-and-hash',
  U04_PLAN_ASSEMBLY_P95_BUDGET_MS,
  { actionBuckets: 1_000 },
  () => { createPlanHash({ greedyTarget, candidates }) },
)
await benchmark(
  'replay-equivalence',
  U04_REPLAY_P95_BUDGET_MS,
  { logicalOrders: 1_000 },
  () => { comparePlanEquivalence(replayPlan, replayPlan) },
)
const optimizerMeasurement = await benchmark(
  'optimizer-timeout-and-fallback',
  U04_FALLBACK_P95_BUDGET_MS,
  { candidates: 75, constraints: 14, timeoutBudgetMs: 250 },
  async () => {
    const result = await optimizerService.optimize(optimizerInput)
    if (result.optimizerOutcome.status !== 'FALLBACK_USED') {
      throw new TypeError('Optimizer fallback benchmark failed')
    }
  },
)
await benchmark(
  'small-problem-oracle',
  U04_DEFAULT_OPTIMIZER_TIMEOUT_MS,
  { candidates: 2, maximumQuantity: 4 },
  async () => {
    const result = await oracleAdapter.optimize(oracleRequest)
    if (!result.ok || result.value.status !== 'CANDIDATE') {
      throw new TypeError('Oracle benchmark failed')
    }
  },
)
const fullPlanMeasurement = await benchmark(
  'full-plan',
  U04_FULL_PLAN_P95_BUDGET_MS,
  { holdings: 0, lots: 0, candidates: 1_000, selectedPositions: 100 },
  async () => {
    const result = await fullPlanService.plan(fullPlanRequest)
    if (!result.ok) throw new TypeError(`Full plan benchmark failed: ${result.error.code}`)
  },
  5,
)

if (U04_DEFAULT_OPTIMIZER_TIMEOUT_MS > 250 || U04_MAX_OPTIMIZER_TIMEOUT_MS > 750) {
  failures.push('Optimizer timeout constants exceed approved bounds')
}
if (fullPlanMeasurement.heapDeltaBytes >= U04_FULL_PLAN_HEAP_BUDGET_BYTES) {
  failures.push('Full-plan heap delta exceeds 192 MiB')
}
if (optimizerMeasurement.heapDeltaBytes >= U04_OPTIMIZER_HEAP_BUDGET_BYTES) {
  failures.push('Optimizer heap delta exceeds 64 MiB')
}

console.log(JSON.stringify({
  result: failures.length === 0 ? 'PASS' : 'FAIL',
  measurements: measurements.length,
  failures,
}))
if (failures.length > 0) process.exitCode = 1
