import assert from 'node:assert/strict'
import test from 'node:test'
import fc from 'fast-check'

import {
  authorizeInterimPlanning,
  createDraftPlanLifecycle,
  evaluateTurnoverWindows,
  transitionPlanLifecycle,
  type PlanLifecycle,
} from '../../../server/portfolio/index.ts'
import {
  FIXTURE_IDS,
  INSTRUMENT_A,
} from './support/fixtures.ts'
import {
  MODEL_FIXTURE_BOUNDS,
  applyReferenceCommand,
  initialReferenceModel,
  modelSequenceArbitrary,
  type RebalancingModelCommand,
  type RebalancingReferenceModel,
} from './support/model-commands.ts'

type RuntimeModel = {
  lifecycle: PlanLifecycle
  inputHashes: Set<string>
  logicalPlanCount: number
  turnoverPpm: bigint
  lastInterimAuthorized: boolean
}

function initialRuntimeModel(): RuntimeModel {
  return {
    lifecycle: createDraftPlanLifecycle(FIXTURE_IDS.rebalanceRunId),
    inputHashes: new Set(),
    logicalPlanCount: 0,
    turnoverPpm: 0n,
    lastInterimAuthorized: false,
  }
}

function applyRuntimeCommand(
  runtime: RuntimeModel,
  command: RebalancingModelCommand,
): void {
  if (command.kind === 'PLAN') {
    if (runtime.lifecycle.state === 'DRAFT') {
      const result = transitionPlanLifecycle(
        runtime.lifecycle,
        'APPROVAL_READY',
        '2026-07-31T12:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
      )
      if (result.ok) runtime.lifecycle = result.value
    }
    if (!runtime.inputHashes.has(command.inputHash)) {
      runtime.inputHashes.add(command.inputHash)
      runtime.logicalPlanCount += 1
    }
    return
  }
  if (command.kind === 'CONSUME_TURNOVER') {
    const result = evaluateTurnoverWindows({
      proposedConsumption: Object.freeze({
        numerator: command.partsPerMillion,
        scale: 1_000_000n,
      }),
      windows: Object.freeze([Object.freeze({
        windowKind: 'ROLLING_30_DAY',
        budgetLimit: Object.freeze({ numerator: 10_000_000_000n, scale: 1_000_000n }),
        consumedBeforePlan: Object.freeze({
          numerator: runtime.turnoverPpm,
          scale: 1_000_000n,
        }),
      })]),
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      runtime.turnoverPpm =
        result.value.windows[0]?.consumedAfterPlan.numerator ?? runtime.turnoverPpm
    }
    return
  }
  if (command.kind === 'INTERIM') {
    const result = authorizeInterimPlanning({
      planningIntent: 'INTERIM_EXCEPTION',
      authorization: Object.freeze({
        reasonFamily: command.reasonFamily,
        sourceIds: Object.freeze([
          command.hasAiOnlyEvidence ? 'AI-ONLY-EVIDENCE' : 'VERIFIED-EVIDENCE',
        ]),
        verifiedAt: '2026-07-31T12:00:00.000Z',
        verifiedBy: 'ACTOR-U04-MODEL',
        exposureDeltaOnly:
          command.reasonFamily === 'CONFIRMED_REGIME_EXPOSURE_REDUCTION',
        advisoryEvidenceExcluded: true,
      }) as Parameters<typeof authorizeInterimPlanning>[0]['authorization'],
      actionIntents: Object.freeze([Object.freeze({
        instrumentId: INSTRUMENT_A,
        intent: command.attemptsBuy ? 'BUY' : 'REDUCE',
        mandatory: command.reasonFamily === 'HARD_RISK_EXIT',
      })]),
      createdAt: '2026-07-31T13:00:00.000Z',
    } as Parameters<typeof authorizeInterimPlanning>[0])
    runtime.lastInterimAuthorized = result.ok && result.value.authorized
    return
  }
  const target = command.kind === 'SUPERSEDE' ? 'SUPERSEDED'
    : command.kind === 'INVALIDATE' ? 'INVALIDATED'
      : 'EXPIRED'
  const result = transitionPlanLifecycle(
    runtime.lifecycle,
    target,
    '2026-08-04T12:00:00.000Z' as Parameters<typeof transitionPlanLifecycle>[2],
  )
  if (result.ok) runtime.lifecycle = result.value
}

function assertEquivalent(
  reference: RebalancingReferenceModel,
  runtime: RuntimeModel,
): void {
  assert.equal(runtime.lifecycle.state, reference.lifecycle)
  assert.deepEqual([...runtime.inputHashes].sort(), [...reference.inputHashes].sort())
  assert.equal(runtime.logicalPlanCount, reference.logicalPlanCount)
  assert.equal(runtime.turnoverPpm, reference.turnoverPpm)
  assert.equal(runtime.lastInterimAuthorized, reference.lastInterimAuthorized)
}

test('model: 250 bounded command sequences preserve lifecycle replay turnover and interim safety', () => {
  fc.assert(fc.property(modelSequenceArbitrary, (commands) => {
    let reference = initialReferenceModel()
    const runtime = initialRuntimeModel()
    for (const command of commands) {
      if (command.kind === 'PLAN') {
        assert.ok(command.holdings <= MODEL_FIXTURE_BOUNDS.maxHoldings)
        assert.ok(command.lots <= MODEL_FIXTURE_BOUNDS.maxLots)
        assert.ok(command.candidates <= MODEL_FIXTURE_BOUNDS.maxCandidates)
      }
      reference = applyReferenceCommand(reference, command)
      applyRuntimeCommand(runtime, command)
      assertEquivalent(reference, runtime)
    }
  }), {
    numRuns: 250,
    seed: 40_400_449,
  })
})
