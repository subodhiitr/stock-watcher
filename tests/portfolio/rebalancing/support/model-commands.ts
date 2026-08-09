import fc from 'fast-check'

export const MODEL_FIXTURE_BOUNDS = Object.freeze({
  maxHoldings: 10,
  maxLots: 50,
  maxCandidates: 5,
})

export type RebalancingModelCommand =
  | Readonly<{
    kind: 'PLAN'
    inputHash: string
    planHash: string
    holdings: number
    lots: number
    candidates: number
  }>
  | Readonly<{ kind: 'SUPERSEDE' | 'INVALIDATE' | 'EXPIRE' }>
  | Readonly<{ kind: 'CONSUME_TURNOVER'; partsPerMillion: bigint }>
  | Readonly<{
    kind: 'INTERIM'
    reasonFamily: 'HARD_RISK_EXIT' | 'CONFIRMED_REGIME_EXPOSURE_REDUCTION'
    hasAiOnlyEvidence: boolean
    attemptsBuy: boolean
  }>

export type RebalancingReferenceModel = Readonly<{
  lifecycle: 'DRAFT' | 'APPROVAL_READY' | 'SUPERSEDED' | 'INVALIDATED' | 'EXPIRED'
  inputHashes: ReadonlySet<string>
  logicalPlanCount: number
  turnoverPpm: bigint
  lastInterimAuthorized: boolean
}>

export function initialReferenceModel(): RebalancingReferenceModel {
  return Object.freeze({
    lifecycle: 'DRAFT',
    inputHashes: new Set<string>(),
    logicalPlanCount: 0,
    turnoverPpm: 0n,
    lastInterimAuthorized: false,
  })
}

export function applyReferenceCommand(
  model: RebalancingReferenceModel,
  command: RebalancingModelCommand,
): RebalancingReferenceModel {
  if (command.kind === 'PLAN') {
    const hashes = new Set(model.inputHashes)
    const duplicate = hashes.has(command.inputHash)
    hashes.add(command.inputHash)
    return Object.freeze({
      ...model,
      lifecycle: model.lifecycle === 'DRAFT' ? 'APPROVAL_READY' : model.lifecycle,
      inputHashes: hashes,
      logicalPlanCount: model.logicalPlanCount + (duplicate ? 0 : 1),
    })
  }
  if (command.kind === 'CONSUME_TURNOVER') {
    return Object.freeze({
      ...model,
      turnoverPpm: model.turnoverPpm + command.partsPerMillion,
    })
  }
  if (command.kind === 'INTERIM') {
    return Object.freeze({
      ...model,
      lastInterimAuthorized: !command.hasAiOnlyEvidence
        && !command.attemptsBuy,
    })
  }
  const target = command === undefined ? model.lifecycle
    : command.kind === 'SUPERSEDE' ? 'SUPERSEDED'
      : command.kind === 'INVALIDATE' ? 'INVALIDATED'
        : 'EXPIRED'
  return Object.freeze({
    ...model,
    lifecycle: model.lifecycle === 'APPROVAL_READY' ? target : model.lifecycle,
  })
}

export const modelCommandArbitrary: fc.Arbitrary<RebalancingModelCommand> = fc.oneof(
  fc.record({
    seed: fc.integer({ min: 0, max: 1_000_000 }),
    holdings: fc.integer({ min: 0, max: MODEL_FIXTURE_BOUNDS.maxHoldings }),
    lots: fc.integer({ min: 0, max: MODEL_FIXTURE_BOUNDS.maxLots }),
    candidates: fc.integer({ min: 0, max: MODEL_FIXTURE_BOUNDS.maxCandidates }),
  }).map((value) => Object.freeze({
    kind: 'PLAN' as const,
    inputHash: `INPUT-${value.seed}`,
    planHash: `PLAN-${value.seed}`,
    holdings: value.holdings,
    lots: value.lots,
    candidates: value.candidates,
  })),
  fc.constantFrom(
    Object.freeze({ kind: 'SUPERSEDE' as const }),
    Object.freeze({ kind: 'INVALIDATE' as const }),
    Object.freeze({ kind: 'EXPIRE' as const }),
  ),
  fc.bigInt({ min: 0n, max: 100_000n }).map((partsPerMillion) =>
    Object.freeze({ kind: 'CONSUME_TURNOVER' as const, partsPerMillion })),
  fc.record({
    reasonFamily: fc.constantFrom(
      'HARD_RISK_EXIT',
      'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
    ),
    hasAiOnlyEvidence: fc.boolean(),
    attemptsBuy: fc.boolean(),
  }).map((value) => Object.freeze({ kind: 'INTERIM' as const, ...value })),
)

export const modelSequenceArbitrary = fc.integer({ min: 1, max: 100 })
  .chain((length) => fc.array(modelCommandArbitrary, {
    minLength: length,
    maxLength: length,
  }))
