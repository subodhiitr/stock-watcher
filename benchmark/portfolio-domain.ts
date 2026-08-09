import { performance } from 'node:perf_hooks'

import {
  MAX_HOLDINGS,
  MAX_OPEN_LOTS,
  MAX_STRATEGY_SLEEVES,
  Portfolio,
  createCommandContext,
  createHolding,
  createHoldingLot,
  createMoney,
  createMultiSleeveAllocation,
  createPortfolioStateVersion,
  createQuantity,
  createSingleStrategyAllocation,
  createStrategyEligibilityEvidence,
  createWeight,
  parseActorId,
  parseAllocationId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parseIntegrityHash,
  parseLocalDate,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategySleeveId,
  parseStrategyVersionId,
  parseInstant,
  validatePortfolioIntegrity,
  type DomainResult,
  type PortfolioId,
  type StrategyAllocationPolicy,
} from '../server/portfolio/index.ts'

const BENCHMARK_SEED = 20_270_102
const CREATED_AT = value(parseInstant('2027-01-02T10:00:00.000Z'))
const ISSUED_AT = value(parseInstant('2027-01-01T09:00:00.000Z'))
const EXPIRES_AT = value(parseInstant('2030-01-01T00:00:00.000Z'))
const ACQUIRED_ON = value(parseLocalDate('2027-01-02'))
const HASH = value(parseIntegrityHash('e'.repeat(64)))

function value<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function identifier<T>(parser: (input: unknown) => DomainResult<T>, raw: string): T {
  return value(parser(raw))
}

function strategyEvidence(owner: PortfolioId, token: string) {
  const strategyVersionId = identifier(parseStrategyVersionId, `strategy-version-${token}`)
  return {
    strategyVersionId,
    evidence: value(createStrategyEligibilityEvidence({
      evidenceId: identifier(parseEvidenceId, `evidence-${token}`),
      portfolioId: owner,
      strategyVersionId,
      issuerId: identifier(parseActorId, `issuer-${token}`),
      issuedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
      evidenceHash: HASH,
    })),
  }
}

function singleAllocation(owner: PortfolioId): StrategyAllocationPolicy {
  const evidence = strategyEvidence(owner, 'single')
  return value(createSingleStrategyAllocation(owner, {
    assignmentId: identifier(parseStrategyAssignmentId, 'assignment-single'),
    strategyVersionId: evidence.strategyVersionId,
    weight: value(createWeight(1_000_000n)),
    effectiveAt: CREATED_AT,
    evidenceReference: evidence.evidence,
  }))
}

function commandContext(version: number, token: number) {
  return value(createCommandContext({
    commandId: identifier(parseCommandId, `command-${token}`),
    actorId: identifier(parseActorId, 'actor-benchmark'),
    correlationId: identifier(parseCorrelationId, 'correlation-benchmark'),
    causationId: identifier(parseCausationId, `causation-${token}`),
    effectiveAt: CREATED_AT,
    expectedStateVersion: value(createPortfolioStateVersion(version, version === 0)),
  }))
}

function createRepresentativePortfolio(): Portfolio {
  const owner = identifier(parsePortfolioId, 'portfolio-benchmark-normal')
  return value(Portfolio.create({
    portfolioId: owner,
    displayName: 'Benchmark Portfolio',
    startingCash: value(createMoney(100_000_000n)),
    mode: 'PAPER',
    modeEvidence: [],
    allocationPolicy: singleAllocation(owner),
    nameUniquenessVerified: true,
    context: commandContext(0, 0),
    eventId: identifier(parseEventId, 'event-create-normal'),
  })).state
}

function createBoundaryPortfolio(): Portfolio {
  const owner = identifier(parsePortfolioId, 'portfolio-benchmark-boundary')
  const openLotsPerHolding = MAX_OPEN_LOTS / MAX_HOLDINGS
  const oneShare = value(createQuantity(1n))
  const tenShares = value(createQuantity(BigInt(openLotsPerHolding)))
  const zeroShares = value(createQuantity(0n))
  const unitCost = value(createMoney(10_000n))
  const holdings = Array.from({ length: MAX_HOLDINGS }, (_, holdingIndex) => {
    const instrumentId = identifier(parseInstrumentId, `instrument-${holdingIndex}`)
    const lots = Array.from({ length: openLotsPerHolding }, (_, lotIndex) =>
      value(createHoldingLot({
        lotId: identifier(parseHoldingLotId, `lot-${holdingIndex}-${lotIndex}`),
        portfolioId: owner,
        instrumentId,
        acquiredOn: ACQUIRED_ON,
        originalQuantity: oneShare,
        openQuantity: oneShare,
        unitCost,
        sourceReference: {
          kind: 'FILL',
          referenceId: `fill-${holdingIndex}-${lotIndex}`,
        },
      })))
    return value(createHolding({
      holdingId: identifier(parseHoldingId, `holding-${holdingIndex}`),
      portfolioId: owner,
      instrumentId,
      totalQuantity: tenShares,
      availableDeliveryQuantity: tenShares,
      reservedQuantity: zeroShares,
      lots,
      stateVersion: value(createPortfolioStateVersion(1)),
      marginFunded: false,
    }))
  })

  return Portfolio.rehydrate({
    portfolioId: owner,
    name: Object.freeze({
      display: 'Boundary Portfolio',
      uniquenessKey: 'boundary portfolio',
    }),
    baseCurrency: 'INR',
    createdAt: CREATED_AT,
    status: 'ACTIVE',
    mode: 'PAPER',
    cash: value(createMoney(100_000_000n)),
    allocationPolicy: singleAllocation(owner),
    holdings: Object.freeze(holdings),
    stateVersion: value(createPortfolioStateVersion(1)),
  })
}

function createHundredSleeves(owner: PortfolioId): StrategyAllocationPolicy {
  const sleeves = Array.from({ length: MAX_STRATEGY_SLEEVES }, (_, index) => {
    const token = `sleeve-${String(index).padStart(3, '0')}`
    const evidence = strategyEvidence(owner, token)
    return {
      sleeveId: identifier(parseStrategySleeveId, token),
      assignmentId: identifier(parseStrategyAssignmentId, `assignment-${token}`),
      strategyVersionId: evidence.strategyVersionId,
      weight: value(createWeight(10_000n)),
      effectiveAt: CREATED_AT,
      evidenceReference: evidence.evidence,
    }
  })
  return value(createMultiSleeveAllocation(owner, {
    allocationId: identifier(parseAllocationId, 'allocation-hundred'),
    sleeves,
    effectiveAt: CREATED_AT,
  }))
}

function measure(iterations: number, operation: () => void): number[] {
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now()
    operation()
    samples.push(performance.now() - started)
  }
  return samples.sort((left, right) => left - right)
}

function percentile(samples: readonly number[], percentileValue: number): number {
  const index = Math.min(
    samples.length - 1,
    Math.ceil(samples.length * percentileValue) - 1,
  )
  return samples[Math.max(0, index)] ?? 0
}

function stats(samples: readonly number[]) {
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples.at(-1) ?? 0,
  }
}

const representative = createRepresentativePortfolio()
let transitionPortfolio = representative
let transitionToken = 1
const transitionSamples = measure(500, () => {
  const targetMode = transitionPortfolio.mode === 'PAPER' ? 'OBSERVE' : 'PAPER'
  const transition = value(transitionPortfolio.changeMode({
    portfolioId: transitionPortfolio.portfolioId,
    mode: targetMode,
    evidence: [],
    context: commandContext(transitionPortfolio.stateVersion, transitionToken),
    eventId: identifier(parseEventId, `event-transition-${transitionToken}`),
  }))
  transitionPortfolio = transition.state
  transitionToken += 1
})

const boundary = createBoundaryPortfolio()
const fullValidationSamples = measure(30, () => {
  const validation = validatePortfolioIntegrity(boundary.snapshot())
  if (!validation.ok) throw new Error(validation.error.code)
})
const representativeValidationSamples = measure(100, () => {
  const validation = validatePortfolioIntegrity(representative.snapshot())
  if (!validation.ok) throw new Error(validation.error.code)
})

const sleevesOwner = identifier(parsePortfolioId, 'portfolio-benchmark-sleeves')
const sleeveSamples = measure(200, () => {
  createHundredSleeves(sleevesOwner)
})

global.gc?.()
const heapBefore = process.memoryUsage().heapUsed
const boundaryTransition = value(boundary.changeMode({
  portfolioId: boundary.portfolioId,
  mode: 'OBSERVE',
  evidence: [],
  context: commandContext(boundary.stateVersion, 50_000),
  eventId: identifier(parseEventId, 'event-boundary-transition'),
}))
const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore)
if (boundaryTransition.state.holdings !== boundary.holdings) {
  throw new Error('Boundary transition did not preserve the immutable holdings collection')
}

const report = {
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  seed: BENCHMARK_SEED,
  capacity: {
    holdings: boundary.holdings.length,
    openLots: boundary.holdings.reduce((total, holding) => total + holding.lots.length, 0),
    sleeves: MAX_STRATEGY_SLEEVES,
  },
  normalTransition: stats(transitionSamples),
  fullIntegrityValidation: stats(fullValidationSamples),
  representativeIntegrityValidation: stats(representativeValidationSamples),
  hundredSleeveValidation: stats(sleeveSamples),
  boundaryTransitionHeapDeltaBytes: heapDeltaBytes,
  validationGrowthRatio:
    percentile(fullValidationSamples, 0.95)
    / Math.max(percentile(representativeValidationSamples, 0.95), Number.EPSILON),
}

console.log(JSON.stringify(report, null, 2))

if (report.normalTransition.p95Ms >= 25) {
  throw new Error('Normal transition p95 exceeded 25 ms')
}
if (report.fullIntegrityValidation.p95Ms >= 100) {
  throw new Error('Full integrity validation p95 exceeded 100 ms')
}
if (report.hundredSleeveValidation.p95Ms >= 10) {
  throw new Error('Hundred-sleeve validation p95 exceeded 10 ms')
}
if (report.boundaryTransitionHeapDeltaBytes >= 64 * 1024 * 1024) {
  throw new Error('Boundary transition heap delta exceeded 64 MiB')
}
