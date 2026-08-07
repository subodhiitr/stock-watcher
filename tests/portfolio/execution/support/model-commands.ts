import assert from 'node:assert/strict'

import fc, { type Command } from 'fast-check'

import {
  type ExecutionOrderSnapshot,
} from '../../../../server/portfolio/domain/execution/execution-order.ts'
import {
  applyFillProgress,
  recordAcknowledged,
  recordIntent,
  recordUnknown,
  requestCancellation,
  resolveFromUnknown,
  startSubmission,
} from '../../../../server/portfolio/domain/execution/execution-order.ts'
import {
  activateKillSwitch,
  resetKillSwitch,
  type KillSwitchSnapshot,
} from '../../../../server/portfolio/domain/execution/kill-switch.ts'
import {
  FIXTURE_IDS,
  INSTRUMENT_B,
  LOGICAL_ORDER_KEY_BUY,
  TEST_LATER,
  TEST_NOW,
  makeApprovalBinding,
  makeBrokerReference,
  makeExecutionOrder,
  makeOrderIntent,
  makeSimpleReservation,
  makeNormalizedFill,
  quantity,
} from './fixtures.ts'

export type ExecutionReferenceModel = {
  orderState: ExecutionOrderSnapshot['state']
  filledShares: bigint
  reservedShares: bigint
  submissionAttempts: number
  killSwitchActive: boolean
}

export type ExecutionRuntimeModel = {
  order: ExecutionOrderSnapshot
  killSwitch: KillSwitchSnapshot
}

export function initialReferenceModel(): ExecutionReferenceModel {
  return {
    orderState: 'PLANNED',
    filledShares: 0n,
    reservedShares: 0n,
    submissionAttempts: 0,
    killSwitchActive: false,
  }
}

export function initialRuntimeModel(): ExecutionRuntimeModel {
  return {
    order: makeExecutionOrder({
      orderId: FIXTURE_IDS.orderBuyId,
      instrumentId: INSTRUMENT_B,
      side: 'BUY',
      logicalOrderKey: LOGICAL_ORDER_KEY_BUY,
      sequence: 2,
      approvedQuantityCeiling: quantity(4n),
    }),
    killSwitch: Object.freeze({
      killSwitchId: FIXTURE_IDS.killSwitchId,
      scope: Object.freeze({ kind: 'PORTFOLIO', portfolioId: FIXTURE_IDS.portfolioId }),
      state: 'INACTIVE',
      stateVersion: 1,
      history: Object.freeze([]),
    }),
  }
}

function assertEquivalent(model: ExecutionReferenceModel, runtime: ExecutionRuntimeModel): void {
  assert.equal(runtime.order.state, model.orderState)
  assert.equal(runtime.order.filledQuantity.shares, model.filledShares)
  assert.equal(runtime.order.reservedDeliveryQuantity?.shares ?? 0n, model.reservedShares)
  assert.equal(runtime.order.submissionAttempts.length, model.submissionAttempts)
  assert.equal(runtime.killSwitch.state === 'ACTIVE', model.killSwitchActive)
}

class ReserveSellCommand implements Command<ExecutionReferenceModel, ExecutionRuntimeModel> {
  check(m: Readonly<ExecutionReferenceModel>): boolean {
    return m.orderState === 'PLANNED'
  }
  run(m: ExecutionReferenceModel, r: ExecutionRuntimeModel): void {
    const reserved = makeSimpleReservation().reserve({} as never, r.order, makeOrderIntent({
      orderId: r.order.orderId,
      executionRunId: r.order.executionRunId,
      instrumentId: r.order.instrumentId,
      side: r.order.side,
      logicalOrderKey: r.order.logicalOrderKey,
      quantity: r.order.approvedQuantityCeiling,
      sequence: r.order.sequence,
    }))
    assert.equal(reserved.ok, true)
    if (reserved.ok) {
      r.order = reserved.value.order
      Object.assign(m as object, {
        reservedShares: reserved.value.order.reservedDeliveryQuantity?.shares ?? 0n,
      })
    }
    assertEquivalent(m, r)
  }
  toString() { return 'reserve-sell' }
}

class SubmitAndAcknowledgeCommand implements Command<ExecutionReferenceModel, ExecutionRuntimeModel> {
  check(m: Readonly<ExecutionReferenceModel>): boolean {
    return m.orderState === 'PLANNED' || m.orderState === 'INTENT_RECORDED'
  }
  run(m: ExecutionReferenceModel, r: ExecutionRuntimeModel): void {
    if (r.order.state === 'PLANNED') {
      const intented = recordIntent(r.order, makeOrderIntent({
        orderId: r.order.orderId,
        executionRunId: r.order.executionRunId,
        instrumentId: r.order.instrumentId,
        side: r.order.side,
        logicalOrderKey: r.order.logicalOrderKey,
        quantity: r.order.approvedQuantityCeiling,
        sequence: r.order.sequence,
      }), makeApprovalBinding().planHash, r.order.stateVersion + 1)
      assert.equal(intented.ok, true)
      if (intented.ok) r.order = intented.value
      Object.assign(m as object, { orderState: 'INTENT_RECORDED' })
    }
    const submitted = startSubmission(r.order, Object.freeze({
      submissionAttemptId: FIXTURE_IDS.submissionAttemptId,
      attemptNumber: r.order.submissionAttempts.length + 1,
      intentHash: makeApprovalBinding().planHash,
      state: 'SUBMISSION_IN_FLIGHT' as const,
      startedAt: TEST_NOW,
    }), r.order.stateVersion + 1)
    assert.equal(submitted.ok, true)
    if (submitted.ok) {
      r.order = submitted.value
      Object.assign(m as object, {
        orderState: 'SUBMISSION_IN_FLIGHT',
        submissionAttempts: submitted.value.submissionAttempts.length,
      })
    }
    const acknowledged = recordAcknowledged(r.order, makeBrokerReference('model:ack'), r.order.stateVersion + 1)
    assert.equal(acknowledged.ok, true)
    if (acknowledged.ok) {
      r.order = acknowledged.value
      Object.assign(m as object, { orderState: 'ACKNOWLEDGED' })
    }
    assertEquivalent(m, r)
  }
  toString() { return 'submit-acknowledge' }
}

class PartialFillCommand implements Command<ExecutionReferenceModel, ExecutionRuntimeModel> {
  check(m: Readonly<ExecutionReferenceModel>): boolean {
    return m.orderState === 'ACKNOWLEDGED' || m.orderState === 'PARTIALLY_FILLED'
  }
  run(m: ExecutionReferenceModel, r: ExecutionRuntimeModel): void {
    const nextFilled = r.order.filledQuantity.shares + 1n
    const progressed = applyFillProgress(
      Object.freeze({ ...r.order, intent: makeOrderIntent({
        orderId: r.order.orderId,
        executionRunId: r.order.executionRunId,
        instrumentId: r.order.instrumentId,
        side: r.order.side,
        logicalOrderKey: r.order.logicalOrderKey,
        quantity: r.order.approvedQuantityCeiling,
        sequence: r.order.sequence,
      }) }),
      makeNormalizedFill({
        orderId: r.order.orderId,
        executionRunId: r.order.executionRunId,
        instrumentId: r.order.instrumentId,
        side: r.order.side,
        quantity: quantity(1n),
      }),
      quantity(nextFilled),
      r.order.stateVersion + 1,
    )
    assert.equal(progressed.ok, true)
    if (progressed.ok) {
      r.order = progressed.value
      Object.assign(m as object, {
        orderState: progressed.value.state,
        filledShares: progressed.value.filledQuantity.shares,
      })
    }
    assertEquivalent(m, r)
  }
  toString() { return 'partial-fill' }
}

class UnknownRecoveryCommand implements Command<ExecutionReferenceModel, ExecutionRuntimeModel> {
  check(m: Readonly<ExecutionReferenceModel>): boolean {
    return m.orderState === 'ACKNOWLEDGED' || m.orderState === 'PARTIALLY_FILLED'
  }
  run(m: ExecutionReferenceModel, r: ExecutionRuntimeModel): void {
    const unknown = recordUnknown(r.order, r.order.stateVersion + 1)
    assert.equal(unknown.ok, true)
    if (unknown.ok) {
      r.order = unknown.value
      Object.assign(m as object, { orderState: 'UNKNOWN' })
    }
    const resolved = resolveFromUnknown(r.order, 'FILLED', r.order.stateVersion + 1)
    assert.equal(resolved.ok, true)
    if (resolved.ok) {
      r.order = resolved.value
      Object.assign(m as object, {
        orderState: 'FILLED',
        filledShares: r.order.filledQuantity.shares,
      })
    }
    assertEquivalent(m, r)
  }
  toString() { return 'unknown-recovery' }
}

class KillSwitchCycleCommand implements Command<ExecutionReferenceModel, ExecutionRuntimeModel> {
  check(): boolean {
    return true
  }
  run(m: ExecutionReferenceModel, r: ExecutionRuntimeModel): void {
    const activated = activateKillSwitch(r.killSwitch, Object.freeze({
      reasonCode: 'MODEL_STOP',
      actorId: FIXTURE_IDS.actorId,
      evidenceId: FIXTURE_IDS.evidenceId,
      activatedAt: TEST_NOW,
      correlationId: FIXTURE_IDS.correlationId,
    }), r.killSwitch.stateVersion + 1)
    assert.equal(activated.ok, true)
    if (activated.ok) {
      r.killSwitch = activated.value
      Object.assign(m as object, { killSwitchActive: true })
    }
    const reset = resetKillSwitch(r.killSwitch, Object.freeze({
      actorId: FIXTURE_IDS.actorId,
      authorizationEvidenceId: FIXTURE_IDS.evidenceId,
      mfaEvidenceId: FIXTURE_IDS.evidenceId,
      reasonCode: 'MODEL_RESET',
      healthSnapshotHash: makeApprovalBinding().planHash,
      reconciliationSnapshotIds: Object.freeze([FIXTURE_IDS.reconciliationSnapshotId]),
      resetAt: TEST_LATER,
      idempotencyKey: FIXTURE_IDS.idempotencyKey,
    }), r.killSwitch.stateVersion + 1)
    assert.equal(reset.ok, true)
    if (reset.ok) {
      r.killSwitch = reset.value
      Object.assign(m as object, { killSwitchActive: false })
    }
    assertEquivalent(m, r)
  }
  toString() { return 'kill-switch-cycle' }
}

export const executionCommandsArbitrary = fc.commands<ExecutionReferenceModel, ExecutionRuntimeModel>([
  fc.constant(new ReserveSellCommand()),
  fc.constant(new SubmitAndAcknowledgeCommand()),
  fc.constant(new PartialFillCommand()),
  fc.constant(new UnknownRecoveryCommand()),
  fc.constant(new KillSwitchCycleCommand()),
], { maxCommands: 25 })

export function runModel(
  commands: Iterable<Command<ExecutionReferenceModel, ExecutionRuntimeModel>>,
): void {
  fc.modelRun(() => ({
    model: initialReferenceModel(),
    real: initialRuntimeModel(),
  }), commands)
}
