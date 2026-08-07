import os from 'node:os'
import { performance } from 'node:perf_hooks'

import {
  BrokerResilienceGovernor,
  DeterministicPaperBroker,
  DryRunBroker,
  ImmediatePaperFillPolicy,
} from '../server/portfolio/execution.ts'
import {
  applyFillProgress,
  recordAcknowledged,
  recordIntent,
  startSubmission,
  type ExecutionOrderSnapshot,
} from '../server/portfolio/domain/execution/execution-order.ts'
import { hashExecutionValue } from '../server/portfolio/domain/execution/canonical-codec.ts'
import {
  deriveReconciliationResult,
  differenceResolutionFor,
  differenceSeverityFor,
  verifySnapshotCoherence,
  type ReconciliationDifference,
} from '../server/portfolio/domain/execution/reconciliation.ts'
import {
  DeterministicClock,
  DeterministicSeed,
  FIXTURE_IDS,
  TEST_LATER,
  TEST_NOW,
  makeBrokerReference,
  makeExecutionOrder,
  makeNormalizedFill,
  makeOrderIntent,
  makeReconciliationSnapshot,
  money,
  quantity,
} from '../tests/portfolio/execution/support/fixtures.ts'

type Measurement = Readonly<{
  name: string
  p50Ms: number
  p95Ms: number
  maxMs: number
  heapDeltaBytes: number
  thresholdMs: number
  inputSizes: Readonly<Record<string, number>>
}>

const U05_BENCHMARK_WARMUP_ITERATIONS = 5
const U05_BENCHMARK_MEASURED_ITERATIONS = 25
const U05_APPROVAL_P95_BUDGET_MS = 25
const U05_CONVERSION_P95_BUDGET_MS = 25
const U05_ORDER_STATE_P95_BUDGET_MS = 5
const U05_FILL_ACCOUNTING_P95_BUDGET_MS = 10
const U05_RECONCILIATION_P95_BUDGET_MS = 70
const U05_RECOVERY_CLASSIFICATION_P95_BUDGET_MS = 15
const U05_PORTFOLIO_ISOLATION_P95_BUDGET_MS = 50
const U05_HEAP_BUDGET_BYTES = 64 * 1024 * 1024

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
  measuredIterations = U05_BENCHMARK_MEASURED_ITERATIONS,
): Promise<Measurement> {
  for (let index = 0; index < U05_BENCHMARK_WARMUP_ITERATIONS; index += 1) {
    await operation()
  }
  global.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const durations: number[] = []
  for (let index = 0; index < measuredIterations; index += 1) {
    const started = performance.now()
    await operation()
    durations.push(performance.now() - started)
  }
  global.gc?.()
  const result = Object.freeze({
    name,
    p50Ms: percentile(durations.sort((a, b) => a - b), 0.5),
    p95Ms: percentile(durations.sort((a, b) => a - b), 0.95),
    maxMs: Math.max(...durations),
    heapDeltaBytes: Math.max(0, process.memoryUsage().heapUsed - heapBefore),
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

console.log(JSON.stringify({
  benchmark: 'U05 portfolio execution',
  warmupIterations: U05_BENCHMARK_WARMUP_ITERATIONS,
  measuredIterations: U05_BENCHMARK_MEASURED_ITERATIONS,
  node: process.version,
  os: `${os.platform()} ${os.release()}`,
  processor: os.cpus()[0]?.model ?? 'unknown',
}))

const order = Object.freeze({
  ...makeExecutionOrder(),
  intent: makeOrderIntent(),
})
const clock = new DeterministicClock()
const paper = new DeterministicPaperBroker(
  clock,
  new DeterministicSeed(7),
  [Object.freeze({
    portfolioId: FIXTURE_IDS.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    cash: money(100_000_000n),
    holdings: Object.freeze([Object.freeze({
      instrumentId: order.instrumentId,
      totalQuantity: quantity(1_000n),
      availableDeliveryQuantity: quantity(1_000n),
      reservedQuantity: quantity(0n),
      averageCost: money(10_000n),
      mappingHash: makeOrderIntent().mapping.snapshotHash,
    })]),
  })],
  new ImmediatePaperFillPolicy(),
)
const dryRun = new DryRunBroker(clock)
const governor = new BrokerResilienceGovernor(paper as never, clock, {
  schedule: () => ({ ok: true as const, value: { cancel() {}, get done() { return false } } }),
  delay: async () => ({ ok: true as const, value: undefined }),
} as never, new DeterministicSeed(17))

await benchmark(
  'approval-throughput',
  U05_APPROVAL_P95_BUDGET_MS,
  { approvals: 250 },
  () => {
    for (let index = 0; index < 250; index += 1) {
      const hash = hashExecutionValue('approval-decision', {
        approvalId: `approval:bench:${index}`,
        binding: makeOrderIntent(),
      })
      if (!hash.ok) throw new TypeError('approval hash failed')
    }
  },
)

await benchmark(
  'conversion-and-hash-250-orders',
  U05_CONVERSION_P95_BUDGET_MS,
  { orders: 250 },
  () => {
    for (let index = 0; index < 250; index += 1) {
      const intent = makeOrderIntent({
        sequence: index + 1,
        orderId: `order:bench:${index}` as never,
      })
      const hash = hashExecutionValue('order-intent', intent)
      if (!hash.ok) throw new TypeError('intent hash failed')
    }
  },
)

await benchmark(
  'order-state-transitions',
  U05_ORDER_STATE_P95_BUDGET_MS,
  { transitions: 5 },
  () => {
    const intented = recordIntent(makeExecutionOrder(), makeOrderIntent(), makeOrderIntent().planHash, 2)
    if (!intented.ok) throw new TypeError('intent failed')
    const submitted = startSubmission(intented.value, Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      attemptNumber: 1,
      intentHash: makeOrderIntent().planHash,
      state: 'SUBMISSION_IN_FLIGHT' as const,
      startedAt: TEST_NOW,
    }), 3)
    if (!submitted.ok) throw new TypeError('submit failed')
    const acknowledged = recordAcknowledged(submitted.value, makeBrokerReference('bench:ack'), 4)
    if (!acknowledged.ok) throw new TypeError('ack failed')
  },
)

await benchmark(
  'fill-accounting-representative',
  U05_FILL_ACCOUNTING_P95_BUDGET_MS,
  { fills: 100, worstCase: 10_000 },
  () => {
    const intented = recordIntent(makeExecutionOrder(), makeOrderIntent(), makeOrderIntent().planHash, 2)
    if (!intented.ok) throw new TypeError('intent failed')
    const submitted = startSubmission(intented.value, Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      attemptNumber: 1,
      intentHash: makeOrderIntent().planHash,
      state: 'SUBMISSION_IN_FLIGHT' as const,
      startedAt: TEST_NOW,
    }), 3)
    if (!submitted.ok) throw new TypeError('submit failed')
    const acknowledged = recordAcknowledged(submitted.value, makeBrokerReference('bench:fill'), 4)
    if (!acknowledged.ok) throw new TypeError('ack failed')
    let runtime: ExecutionOrderSnapshot = Object.freeze({
      ...acknowledged.value,
      intent: makeOrderIntent(),
    })
    for (let index = 0; index < 100; index += 1) {
      const next = applyFillProgress(
        runtime,
        makeNormalizedFill({
          fillId: `fill:bench:${index}` as never,
          quantity: quantity(1n),
        }),
        quantity(BigInt(index + 1)),
        runtime.stateVersion + 1,
      )
      if (!next.ok) break
      runtime = next.value
    }
  },
)

const reconciliationHoldingTemplate = makeReconciliationSnapshot().holdings[0]
if (reconciliationHoldingTemplate === undefined) {
  throw new TypeError('Benchmark reconciliation holding fixture missing')
}
const localReconciliationHoldings = Object.freeze(Array.from({ length: 1_000 }, (_, index) =>
  Object.freeze({
    ...reconciliationHoldingTemplate,
    instrumentId: `instrument:bench:${index}` as never,
    totalQuantity: quantity(BigInt(20 + (index % 5))),
  })))
const externalReconciliationHoldings = Object.freeze(localReconciliationHoldings.map(
  (holding, index) => index % 50 === 0
    ? Object.freeze({ ...holding, totalQuantity: quantity(holding.totalQuantity.shares + 1n) })
    : holding,
))
const reconciliationFills = Object.freeze(Array.from({ length: 10_000 }, (_, index) =>
  Object.freeze({
    ...makeNormalizedFill(),
    fillId: `fill:bench:${index % 9_900}` as never,
  })))
const reconciliationEndpointTimes = Object.freeze({ holdings: TEST_NOW, cash: TEST_NOW })

await benchmark(
  'boundary-reconciliation-large-snapshot',
  U05_RECONCILIATION_P95_BUDGET_MS,
  { holdings: 1_000, fills: 10_000 },
  () => {
    const coherence = verifySnapshotCoherence(reconciliationEndpointTimes)
    if (!coherence.ok) throw new TypeError('Coherence benchmark failed')

    const seenFillIds = new Set<string>()
    let duplicateFillCount = 0
    for (const fill of reconciliationFills) {
      if (seenFillIds.has(fill.fillId)) {
        duplicateFillCount += 1
      } else {
        seenFillIds.add(fill.fillId)
      }
    }

    const differences: ReconciliationDifference[] = []
    for (let index = 0; index < localReconciliationHoldings.length; index += 1) {
      const local = localReconciliationHoldings[index]
      const external = externalReconciliationHoldings[index]
      if (local === undefined || external === undefined) continue
      if (local.totalQuantity === external.totalQuantity) continue
      const kind = 'EXTERNAL_CHANGE' as const
      const differenceIdResult = hashExecutionValue('reconciliation-difference', {
        instrumentId: local.instrumentId,
        local: local.totalQuantity.shares.toString(),
        external: external.totalQuantity.shares.toString(),
      })
      if (!differenceIdResult.ok) throw new TypeError('Difference hash benchmark failed')
      differences.push(Object.freeze({
        differenceId: differenceIdResult.value,
        kind,
        severity: differenceSeverityFor(kind),
        instrumentId: local.instrumentId,
        expected: String(local.totalQuantity.shares),
        actual: String(external.totalQuantity.shares),
        resolution: differenceResolutionFor(kind),
      }))
    }
    const result = deriveReconciliationResult(differences)
    if (duplicateFillCount === 0) throw new TypeError('Duplicate-fill scan benchmark failed')
    if (result !== 'MISMATCH') throw new TypeError('Reconciliation result benchmark failed')
  },
)

await benchmark(
  'recovery-classification-10000-fills',
  U05_RECOVERY_CLASSIFICATION_P95_BUDGET_MS,
  { fills: 10_000 },
  async () => {
    await dryRun.placeOrder({
      ...makePlacementRequest(),
      submissionAttemptId: 'submission:bench:001' as never,
    })
  },
)

const isolationMeasurement = await benchmark(
  'portfolio-isolation-100',
  U05_PORTFOLIO_ISOLATION_P95_BUDGET_MS,
  { portfolios: 100 },
  async () => {
    for (let index = 0; index < 100; index += 1) {
      const result = await governor.placeOrder({
        ...makePlacementRequest(
          `order:iso:${index}` as never,
          `submission:iso:${index}` as never,
        ),
      })
      if (!result.ok) throw new TypeError('governor failed')
    }
  },
)

if (isolationMeasurement.heapDeltaBytes >= U05_HEAP_BUDGET_BYTES) {
  failures.push('portfolio isolation heap delta exceeds 64 MiB')
}

console.log(JSON.stringify({
  result: failures.length === 0 ? 'PASS' : 'FAIL',
  measurements: measurements.length,
  failures,
}))
if (failures.length > 0) process.exitCode = 1

function makePlacementRequest(
  orderId = FIXTURE_IDS.orderSellId,
  submissionAttemptId = FIXTURE_IDS.submissionAttemptId,
) {
  return Object.freeze({
    submissionAttemptId,
    orderId,
    portfolioId: FIXTURE_IDS.portfolioId,
    accountBindingId: FIXTURE_IDS.accountBindingId,
    intent: makeOrderIntent({ orderId }),
    deadlineAt: TEST_LATER,
  })
}
