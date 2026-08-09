import type {
  AllGatesContext,
} from '../../domain/execution/execution-gate.ts'
import { evaluateExecutionGates } from '../../domain/execution/execution-gate.ts'
import type {
  ApprovalBinding,
  OrderIntentPayload,
  SubmissionAttempt,
} from '../../domain/execution/contracts.ts'
import { U05_MAX_PLACEMENT_ATTEMPTS } from '../../domain/execution/contracts.ts'
import type {
  ExecutionRunPortfolioVersionEvidencePayload,
  PortfolioAccountingEvidencePayload,
} from '../../domain/execution/evidence.ts'
import {
  isUnresolvableTerminalState,
  recordAcknowledged,
  recordDefinitelyNotSent,
  recordIntent,
  recordRejected,
  recordRetryExhausted,
  recordUnknown,
  startSubmission,
  type ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import {
  createResidualWork,
  type ResidualWork,
} from '../../domain/execution/residual-and-adjustment.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import { isReconciliationMatched } from '../../domain/execution/reconciliation.ts'
import {
  DOMAIN_FAILURE_CODES,
  domainFailure,
} from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type {
  BrokerAccountBindingId,
  OrderId,
} from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import type { KillSwitchScope } from '../../domain/execution/kill-switch.ts'
import type {
  BrokerPlacementCapability,
  PlacementResult,
} from '../../ports/execution/broker-port.ts'
import type {
  CommittedExecutionResult,
  ExecutionTransaction,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type {
  ExecutionClockPort,
  ExecutionIdentifierFactory,
} from '../../ports/execution/runtime-port.ts'

export interface PlacementReservation {
  reserve(
    transaction: ExecutionTransaction,
    order: ExecutionOrderSnapshot,
    intent: OrderIntentPayload,
  ): DomainResult<Readonly<{
    order: ExecutionOrderSnapshot
    accountingEvidence?: PortfolioAccountingEvidencePayload
    run?: ExecutionRunSnapshot
    runEvidence?: ExecutionRunPortfolioVersionEvidencePayload
  }>, AnyDomainFailure>
}

export type DispatchAdmissionIdentity = Readonly<{
  scope: KillSwitchScope
  portfolioId: ExecutionOrderSnapshot['portfolioId']
  executionRunId: ExecutionOrderSnapshot['executionRunId']
  orderId: ExecutionOrderSnapshot['orderId']
  submissionAttemptId: SubmissionAttempt['submissionAttemptId']
  clientIdentity: Readonly<{
    idempotencyKey: ExecutionOrderSnapshot['idempotencyKey']
    intentHash: IntegrityHash
  }>
}>

export type UnresolvedDispatchAdmission = Readonly<{
  admission: DispatchAdmissionIdentity
  brokerDispatched: boolean
  failureCode: string
}>

export type DispatchOperationResult<T> =
  | Readonly<{
    kind: 'OUTCOME_PERSISTED'
    value: T
  }>
  | Readonly<{
    kind: 'OUTCOME_UNRESOLVED'
    unresolved: UnresolvedDispatchAdmission
    failure: AnyDomainFailure
  }>

export type DispatchFenceClosureToken = Readonly<{
  closureId: string
}>

export type DispatchFenceResult<T> =
  | Readonly<{ admitted: false }>
  | Readonly<{
    admitted: true
    outcome: DispatchOperationResult<T>
  }>

export type DispatchFenceDrainResult = Readonly<{
  closure: DispatchFenceClosureToken
  unresolvedAdmissions: readonly UnresolvedDispatchAdmission[]
}>

export interface ExecutionDispatchFence {
  /**
   * Atomically admits or refuses the operation. closeAndDrain prevents new
   * admissions and waits for active operations to report either persisted or
   * unresolved. A failed result proves the operation was not admitted. An
   * admitted operation is released only with OUTCOME_PERSISTED;
   * OUTCOME_UNRESOLVED remains retained and is surfaced by closeAndDrain.
   */
  execute<T>(
    admission: DispatchAdmissionIdentity,
    operation: () => Promise<DispatchOperationResult<T>>,
  ): Promise<DomainResult<DispatchFenceResult<T>, AnyDomainFailure>>
  closeAndDrain(
    scope: KillSwitchScope,
  ): Promise<DomainResult<DispatchFenceDrainResult, AnyDomainFailure>>
  resolveAdmission(
    admission: DispatchAdmissionIdentity,
    validateResolved: () => DomainResult<void, AnyDomainFailure>,
  ): Promise<DomainResult<void, AnyDomainFailure>>
  /** Serializes the authoritative validator with admission and later closes. */
  open(
    scope: KillSwitchScope,
    closure: DispatchFenceClosureToken,
    validateCurrent: () => DomainResult<void, AnyDomainFailure>,
  ): Promise<DomainResult<void, AnyDomainFailure>>
}

export type TerminalReservationReleaseResult = Readonly<{
  order: ExecutionOrderSnapshot
  accountingEvidence?: PortfolioAccountingEvidencePayload
  run?: ExecutionRunSnapshot
  runEvidence?: ExecutionRunPortfolioVersionEvidencePayload
}>

export interface TerminalReservationRelease {
  release(
    transaction: ExecutionTransaction,
    order: ExecutionOrderSnapshot,
  ): DomainResult<TerminalReservationReleaseResult, AnyDomainFailure>
}

export function validateTerminalReservationRelease(
  priorOrder: ExecutionOrderSnapshot,
  terminalOrder: ExecutionOrderSnapshot,
  priorRun: ExecutionRunSnapshot,
  result: TerminalReservationReleaseResult,
): DomainResult<TerminalReservationReleaseResult, AnyDomainFailure> {
  if (
    result.order.orderId !== terminalOrder.orderId
    || result.order.state !== terminalOrder.state
    || result.order.stateVersion !== terminalOrder.stateVersion
    || result.order.residualWorkId !== terminalOrder.residualWorkId
    || result.order.reservedCash !== undefined
    || result.order.reservedDeliveryQuantity !== undefined
  ) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'terminalReservation',
      retryability: 'NEVER',
    }))
  }
  const sellReleaseShares = priorOrder.side === 'SELL'
    ? priorOrder.reservedDeliveryQuantity?.shares ?? 0n
    : 0n
  if (priorOrder.side === 'BUY' || sellReleaseShares === 0n) {
    if (
      result.accountingEvidence !== undefined
      || result.run !== undefined
      || result.runEvidence !== undefined
    ) {
      return failure(domainFailure('EXECUTION_EVIDENCE_MISSING', {
        field: 'terminalReservation',
        retryability: 'NEVER',
      }))
    }
    return success(result)
  }
  const accounting = result.accountingEvidence
  const advancedRun = result.run
  const runEvidence = result.runEvidence
  const expectedRelease = (-sellReleaseShares).toString(10)
  if (
    accounting === undefined
    || advancedRun === undefined
    || runEvidence === undefined
    || accounting.reason !== 'SELL_RESERVATION'
    || accounting.portfolioId !== priorOrder.portfolioId
    || accounting.executionRunId !== priorOrder.executionRunId
    || accounting.orderId !== priorOrder.orderId
    || accounting.instrumentId !== priorOrder.instrumentId
    || accounting.fillId !== undefined
    || accounting.cashDeltaMinorUnits !== '0'
    || accounting.holdingDeltaShares !== '0'
    || accounting.reservedCashDeltaMinorUnits !== '0'
    || accounting.reservedDeliveryDeltaShares !== expectedRelease
    || accounting.reservedQuantityDeltaShares !== expectedRelease
    || advancedRun.executionRunId !== priorRun.executionRunId
    || advancedRun.portfolioId !== priorRun.portfolioId
    || advancedRun.approvalId !== priorRun.approvalId
    || advancedRun.state !== priorRun.state
    || advancedRun.portfolioStateVersion !== priorRun.portfolioStateVersion + 1
    || advancedRun.stateVersion !== priorRun.stateVersion + 1
    || accounting.portfolioStateVersion !== advancedRun.portfolioStateVersion
    || runEvidence.portfolioId !== advancedRun.portfolioId
    || runEvidence.executionRunId !== advancedRun.executionRunId
    || runEvidence.previousPortfolioStateVersion !== priorRun.portfolioStateVersion
    || runEvidence.portfolioStateVersion !== advancedRun.portfolioStateVersion
    || runEvidence.stateVersion !== advancedRun.stateVersion
  ) {
    return failure(domainFailure('EXECUTION_EVIDENCE_MISSING', {
      field: 'terminalReservation',
      retryability: 'NEVER',
    }))
  }
  return success(result)
}

export type PlaceOrderCommand = Readonly<{
  order: ExecutionOrderSnapshot
  intent: OrderIntentPayload
  intentHash: IntegrityHash
  accountBindingId: BrokerAccountBindingId
  deadlineAt: Instant
  gates: AllGatesContext
}>

export type DispatchGateSnapshot = Pick<
  AllGatesContext,
  'liveEnablement' | 'executionWindow' | 'quote' | 'preTradeRisk'
> & Readonly<{
  currentPlanHash: IntegrityHash
  currentPlanInputHash: IntegrityHash
  strategyVersionId: ApprovalBinding['strategyVersionId']
  strategyConfigHash: IntegrityHash
  policySnapshotId: ExecutionRunSnapshot['policySnapshotId']
  reconciliationSnapshotId: ApprovalBinding['reconciliationSnapshotId']
  maximumQuoteAgeMs: number
}>

export interface DispatchGateRefresh {
  refresh(
    command: Readonly<{
      order: ExecutionOrderSnapshot
      intent: OrderIntentPayload
      accountBindingId: BrokerAccountBindingId
      deadlineAt: Instant
    }>,
  ): Promise<DomainResult<DispatchGateSnapshot, AnyDomainFailure>>
}

export type PlacementCoordinatorResult = Readonly<{
  order: ExecutionOrderSnapshot
  brokerCallMade: boolean
  certainty?: PlacementResult['certainty']
}>

type PlacementAuthority = Readonly<{
  order: ExecutionOrderSnapshot
  run: ExecutionRunSnapshot
  gates: AllGatesContext
}>

type AttemptCommit = Readonly<{
  order: ExecutionOrderSnapshot
  brokerCallRequired: boolean
  attemptId?: SubmissionAttempt['submissionAttemptId']
}>

type CompletedPlacement = Readonly<{
  placement: PlacementResult
  outcome: CommittedExecutionResult<ExecutionOrderSnapshot>
  brokerCallMade: boolean
}>

const isSequenceComplete = (order: ExecutionOrderSnapshot): boolean =>
  order.state === 'FILLED'
  || order.state === 'REJECTED'
  || order.state === 'CANCELLED'
  || order.state === 'EXPIRED'
  || order.state === 'RESIDUAL'

export class PlacementCoordinator {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly broker: BrokerPlacementCapability
  private readonly reservation: PlacementReservation
  private readonly ids: ExecutionIdentifierFactory
  private readonly clock: ExecutionClockPort
  private readonly terminalRelease: TerminalReservationRelease
  private readonly dispatchFence: ExecutionDispatchFence
  private readonly dispatchGateRefresh: DispatchGateRefresh

  public constructor(
    unitOfWork: ExecutionUnitOfWork,
    broker: BrokerPlacementCapability,
    reservation: PlacementReservation,
    terminalRelease: TerminalReservationRelease,
    dispatchFence: ExecutionDispatchFence,
    ids: ExecutionIdentifierFactory,
    dispatchGateRefresh: DispatchGateRefresh,
    clock: ExecutionClockPort,
  ) {
    this.unitOfWork = unitOfWork
    this.broker = broker
    this.reservation = reservation
    this.terminalRelease = terminalRelease
    this.dispatchFence = dispatchFence
    this.ids = ids
    this.dispatchGateRefresh = dispatchGateRefresh
    this.clock = clock
  }

  public async place(
    command: PlaceOrderCommand,
  ): Promise<DomainResult<CommittedExecutionResult<PlacementCoordinatorResult>, AnyDomainFailure>> {
    if (
      command.order.orderId !== command.intent.orderId
      || command.order.executionRunId !== command.intent.executionRunId
      || command.order.portfolioId !== command.intent.portfolioId
    ) {
      return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
        field: 'intent',
        retryability: 'NEVER',
      }))
    }

    const intentCommit = this.unitOfWork.execute((transaction) => {
      const authorityResult = this.loadAuthority(transaction, command, this.clock.now())
      if (!authorityResult.ok) return authorityResult
      const current = authorityResult.value.order
      if (
        current.state !== 'PLANNED'
        && (
          current.intent === undefined
          || current.intentHash !== command.intentHash
        )
      ) {
        return failure(domainFailure('ORDER_IDEMPOTENCY_CONFLICT', {
          field: 'intentHash',
          retryability: 'NEVER',
        }))
      }
      if (current.state !== 'PLANNED') return success(current)
      const gates = evaluateExecutionGates(authorityResult.value.gates)
      if (!gates.ok) return gates
      const reserved = this.reservation.reserve(transaction, current, command.intent)
      if (!reserved.ok) return reserved
      const accountingEvidence = reserved.value.accountingEvidence
      const advancedRun = reserved.value.run
      const runEvidence = reserved.value.runEvidence
      const priorReservedDelivery = current.reservedDeliveryQuantity?.shares ?? 0n
      const nextReservedDelivery =
        reserved.value.order.reservedDeliveryQuantity?.shares ?? 0n
      const reservedDeliveryDelta =
        (nextReservedDelivery - priorReservedDelivery).toString(10)
      if (
        current.reservedCash !== undefined
        || current.reservedDeliveryQuantity !== undefined
        || reserved.value.order.orderId !== current.orderId
        || reserved.value.order.executionRunId !== current.executionRunId
        || reserved.value.order.state !== current.state
        || reserved.value.order.stateVersion !== current.stateVersion
        || (
          current.side === 'SELL'
          && reserved.value.order.reservedDeliveryQuantity?.shares
            !== command.intent.quantity.shares
        )
        || current.side === 'SELL'
          && reserved.value.order.reservedCash !== undefined
        || current.side === 'BUY'
          && (
            reserved.value.order.reservedCash === undefined
            || reserved.value.order.reservedCash.minorUnits <= 0n
            || reserved.value.order.reservedDeliveryQuantity !== undefined
          )
        || current.side === 'SELL'
        && (
          accountingEvidence === undefined
          || advancedRun === undefined
          || runEvidence === undefined
          || accountingEvidence.reason !== 'SELL_RESERVATION'
          || accountingEvidence.portfolioId !== current.portfolioId
          || accountingEvidence.executionRunId !== current.executionRunId
          || accountingEvidence.orderId !== current.orderId
          || accountingEvidence.instrumentId !== current.instrumentId
          || accountingEvidence.fillId !== undefined
          || accountingEvidence.cashDeltaMinorUnits !== '0'
          || accountingEvidence.holdingDeltaShares !== '0'
          || accountingEvidence.reservedCashDeltaMinorUnits !== '0'
          || accountingEvidence.reservedDeliveryDeltaShares
            !== reservedDeliveryDelta
          || accountingEvidence.reservedQuantityDeltaShares
            !== reservedDeliveryDelta
          || advancedRun.executionRunId !== authorityResult.value.run.executionRunId
          || advancedRun.portfolioId !== authorityResult.value.run.portfolioId
          || advancedRun.approvalId !== authorityResult.value.run.approvalId
          || advancedRun.state !== authorityResult.value.run.state
          || advancedRun.portfolioStateVersion
            !== authorityResult.value.run.portfolioStateVersion + 1
          || advancedRun.stateVersion !== authorityResult.value.run.stateVersion + 1
          || accountingEvidence.portfolioStateVersion
            !== advancedRun.portfolioStateVersion
          || runEvidence.portfolioId !== advancedRun.portfolioId
          || runEvidence.executionRunId !== advancedRun.executionRunId
          || runEvidence.previousPortfolioStateVersion
            !== authorityResult.value.run.portfolioStateVersion
          || runEvidence.portfolioStateVersion !== advancedRun.portfolioStateVersion
          || runEvidence.stateVersion !== advancedRun.stateVersion
        )
        || current.side === 'BUY' && (
          accountingEvidence !== undefined
          || advancedRun !== undefined
          || runEvidence !== undefined
        )
      ) {
        return failure(domainFailure('EXECUTION_EVIDENCE_MISSING', {
          field: 'accountingEvidence',
          retryability: 'NEVER',
        }))
      }
      const recorded = recordIntent(
        reserved.value.order,
        command.intent,
        command.intentHash,
        current.stateVersion + 1,
      )
      if (!recorded.ok) return recorded
      const saved = transaction.orders.save(recorded.value, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        ...(accountingEvidence !== undefined ? [accountingEvidence] : []),
        ...(runEvidence !== undefined ? [runEvidence] : []),
        Object.freeze({
          kind: 'ORDER_INTENT_RECORDED',
          portfolioId: recorded.value.portfolioId,
          executionRunId: recorded.value.executionRunId,
          orderId: recorded.value.orderId,
          intentHashPrefix: command.intentHash.slice(0, 12),
          sequence: recorded.value.sequence,
          side: recorded.value.side,
          stateVersion: recorded.value.stateVersion,
          occurredAt: this.clock.now(),
        }),
      ])
      if (!staged.ok) return staged
      return success(recorded.value)
    })
    if (!intentCommit.ok) return intentCommit
    if (
      intentCommit.value.value.state !== 'INTENT_RECORDED'
      && intentCommit.value.value.state !== 'SUBMISSION_IN_FLIGHT'
    ) {
      return success(Object.freeze({
        value: Object.freeze({
          order: intentCommit.value.value,
          brokerCallMade: false,
        }),
        postCommitEvidence: intentCommit.value.postCommitEvidence,
      }))
    }

    const attemptCommit = this.unitOfWork.execute<AttemptCommit>((transaction) => {
      const authorityResult = this.loadAuthority(transaction, command, this.clock.now())
      if (!authorityResult.ok) return authorityResult
      const current = authorityResult.value.order
      if (current.state === 'SUBMISSION_IN_FLIGHT') {
        return success<AttemptCommit>(Object.freeze({
          order: current,
          brokerCallRequired: false,
        }))
      }
      if (current.state !== 'INTENT_RECORDED') {
        return success<AttemptCommit>(Object.freeze({
          order: current,
          brokerCallRequired: false,
        }))
      }
      if (current.submissionAttempts.length >= U05_MAX_PLACEMENT_ATTEMPTS) {
        return failure(domainFailure('ORDER_RETRY_NOT_SAFE', {
          field: 'submissionAttempts',
          retryability: 'NEVER',
        }))
      }
      const gates = evaluateExecutionGates(authorityResult.value.gates)
      if (!gates.ok) return gates
      const attemptId = this.ids.submissionAttemptId()
      const attempt: SubmissionAttempt = Object.freeze({
        submissionAttemptId: attemptId,
        attemptNumber: current.submissionAttempts.length + 1,
        intentHash: command.intentHash,
        state: 'SUBMISSION_IN_FLIGHT',
        startedAt: this.clock.now(),
      })
      const started = startSubmission(current, attempt, current.stateVersion + 1)
      if (!started.ok) return started
      const saved = transaction.orders.save(started.value, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'SUBMISSION_ATTEMPT_STARTED',
        portfolioId: started.value.portfolioId,
        executionRunId: started.value.executionRunId,
        orderId: started.value.orderId,
        submissionAttemptId: attemptId,
        attemptNumber: attempt.attemptNumber,
        intentHashPrefix: command.intentHash.slice(0, 12),
        occurredAt: this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success<AttemptCommit>(Object.freeze({
        order: started.value,
        brokerCallRequired: true,
        attemptId,
      }))
    })
    if (!attemptCommit.ok) return attemptCommit
    if (!attemptCommit.value.value.brokerCallRequired) {
      return success(Object.freeze({
        value: Object.freeze({
          order: attemptCommit.value.value.order,
          brokerCallMade: false,
        }),
        postCommitEvidence: Object.freeze([
          ...intentCommit.value.postCommitEvidence,
          ...attemptCommit.value.postCommitEvidence,
        ]),
      }))
    }
    const committedIntent = attemptCommit.value.value.order.intent
    const attemptId = attemptCommit.value.value.attemptId
    if (committedIntent === undefined || attemptId === undefined) {
      return failure(domainFailure('ORDER_INTENT_NOT_PERSISTED', {
        field: 'intent',
        retryability: 'NEVER',
      }))
    }

    const latestAttempt = attemptCommit.value.value.order.submissionAttempts[
      attemptCommit.value.value.order.submissionAttempts.length - 1
    ]
    if (latestAttempt === undefined) {
      return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
        field: 'submissionAttemptId',
        retryability: 'NEVER',
      }))
    }
    const admission: DispatchAdmissionIdentity = Object.freeze({
      scope: Object.freeze({
        kind: 'PORTFOLIO',
        portfolioId: attemptCommit.value.value.order.portfolioId,
      }),
      portfolioId: attemptCommit.value.value.order.portfolioId,
      executionRunId: attemptCommit.value.value.order.executionRunId,
      orderId: attemptCommit.value.value.order.orderId,
      submissionAttemptId: attemptId,
      clientIdentity: Object.freeze({
        idempotencyKey: attemptCommit.value.value.order.idempotencyKey,
        intentHash: command.intentHash,
      }),
    })
    const fenceResult = await this.dispatchFence.execute<CompletedPlacement>(
      admission,
      async () => {
        const refreshedGates = await this.dispatchGateRefresh.refresh(Object.freeze({
          order: attemptCommit.value.value.order,
          intent: committedIntent,
          accountBindingId: command.accountBindingId,
          deadlineAt: command.deadlineAt,
        }))
        const dispatchValidation = refreshedGates.ok
          ? this.unitOfWork.execute((transaction) => {
              const authority = this.loadAuthority(
                transaction,
                command,
                this.clock.now(),
                refreshedGates.value,
              )
              if (!authority.ok) return authority
              const current = authority.value.order
              const currentAttempt =
                current.submissionAttempts[current.submissionAttempts.length - 1]
              if (
                current.state !== 'SUBMISSION_IN_FLIGHT'
                || currentAttempt?.submissionAttemptId !== attemptId
              ) {
                return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
                  field: 'submissionAttemptId',
                  retryability: 'NEVER',
                }))
              }
              return evaluateExecutionGates(authority.value.gates)
            })
          : refreshedGates
        if (!dispatchValidation.ok) {
          const placement = this.definitelyNotDispatched(
            attemptId,
            latestAttempt.startedAt,
            dispatchValidation.error.code,
          )
          const outcomeCommit = this.persistOutcome(
            attemptCommit.value.value.order.orderId,
            attemptId,
            placement,
          )
          if (!outcomeCommit.ok) {
            return this.unresolvedDispatch(
              admission,
              false,
              outcomeCommit.error,
            )
          }
          return Object.freeze({
            kind: 'OUTCOME_PERSISTED' as const,
            value: Object.freeze({
              placement,
              outcome: outcomeCommit.value,
              brokerCallMade: false,
            }),
          })
        }
        const brokerResult = await this.broker.placeOrder(Object.freeze({
          submissionAttemptId: attemptId,
          orderId: attemptCommit.value.value.order.orderId,
          portfolioId: attemptCommit.value.value.order.portfolioId,
          accountBindingId: command.accountBindingId,
          intent: committedIntent,
          deadlineAt: command.deadlineAt,
        }))
        const placement = this.normalizePlacement(
          attemptId,
          latestAttempt.startedAt,
          command.accountBindingId,
          brokerResult,
        )
        const outcomeCommit = this.persistOutcome(
          attemptCommit.value.value.order.orderId,
          attemptId,
          placement,
        )
        if (!outcomeCommit.ok) {
          return this.unresolvedDispatch(
            admission,
            true,
            outcomeCommit.error,
          )
        }
        return Object.freeze({
          kind: 'OUTCOME_PERSISTED' as const,
          value: Object.freeze({
            placement,
            outcome: outcomeCommit.value,
            brokerCallMade: true,
          }),
        })
      },
    )
    let completed: CompletedPlacement
    if (!fenceResult.ok || !fenceResult.value.admitted) {
      const placement = this.definitelyNotDispatched(
        attemptId,
        latestAttempt.startedAt,
      )
      const outcomeCommit = this.persistOutcome(
        attemptCommit.value.value.order.orderId,
        attemptId,
        placement,
      )
      if (!outcomeCommit.ok) return outcomeCommit
      completed = Object.freeze({
        placement,
        outcome: outcomeCommit.value,
        brokerCallMade: false,
      })
    } else {
      if (fenceResult.value.outcome.kind === 'OUTCOME_UNRESOLVED') {
        return failure(fenceResult.value.outcome.failure)
      }
      completed = fenceResult.value.outcome.value
    }
    return success(Object.freeze({
      value: Object.freeze({
        order: completed.outcome.value,
        brokerCallMade: completed.brokerCallMade,
        certainty: completed.placement.certainty,
      }),
      postCommitEvidence: Object.freeze([
        ...intentCommit.value.postCommitEvidence,
        ...attemptCommit.value.postCommitEvidence,
        ...completed.outcome.postCommitEvidence,
      ]),
    }))
  }

  private loadAuthority(
    transaction: ExecutionTransaction,
    command: PlaceOrderCommand,
    now: Instant,
    refreshedGates?: DispatchGateSnapshot,
  ): DomainResult<PlacementAuthority, AnyDomainFailure> {
    const runResult = transaction.runs.getById(command.intent.executionRunId)
    if (!runResult.ok) return runResult
    const run = runResult.value
    if (run === undefined) {
      return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
        field: 'executionRunId',
        retryability: 'NEVER',
      }))
    }
    const approvalResult = transaction.approvals.getById(run.approvalId)
    if (!approvalResult.ok) return approvalResult
    const approval = approvalResult.value
    if (
      approval === undefined
      || approval.state !== 'CONSUMED'
      || approval.consumedByExecutionRunId !== run.executionRunId
      || approval.binding === undefined
    ) {
      return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
        field: 'approvalId',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const currentPortfolio = transaction.portfolioState.assertCurrent(
      run.portfolioId,
      run.portfolioStateVersion,
      'ACTIVE',
    )
    if (!currentPortfolio.ok) return currentPortfolio
    const currentResult = transaction.orders.getById(command.order.orderId)
    if (!currentResult.ok) return currentResult
    const current = currentResult.value
    if (
      current === undefined
      || current.executionRunId !== run.executionRunId
      || current.portfolioId !== run.portfolioId
      || command.intent.approvalId !== run.approvalId
      || command.intent.planHash !== run.planHash
      || command.intent.policySnapshotId !== run.policySnapshotId
    ) {
      return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
        field: 'order',
        retryability: 'NEVER',
      }))
    }
    const basketResult = transaction.orders.listByRun(run.executionRunId)
    if (!basketResult.ok) return basketResult
    const basket = [...basketResult.value].sort((left, right) => left.sequence - right.sequence)
    const next = basket.find((order) => !isSequenceComplete(order))
    if (next === undefined || next.orderId !== current.orderId) {
      return failure(domainFailure('ORDER_SEQUENCE_NON_DETERMINISTIC', {
        field: 'sequence',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (
      current.side === 'SELL' && run.state !== 'SELLING'
      || current.side === 'BUY' && run.state !== 'BUYING'
    ) {
      return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
        field: 'run.state',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (
      current.side === 'BUY'
      && basket.some((order) => order.side === 'SELL' && order.state !== 'FILLED')
    ) {
      return failure(domainFailure('RECONCILIATION_BLOCKS_DEPENDENCY', {
        field: 'sellOrders',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const reconciliationId = current.side === 'BUY'
      ? run.phaseReconciliationIds[run.phaseReconciliationIds.length - 1]
      : run.preExecutionReconciliationId
    if (reconciliationId === undefined) {
      return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
        field: 'reconciliationRunId',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const reconciliationResult = transaction.reconciliationRuns.getById(reconciliationId)
    if (!reconciliationResult.ok) return reconciliationResult
    const reconciliation = reconciliationResult.value
    if (
      reconciliation === undefined
      || reconciliation.portfolioId !== run.portfolioId
      || !isReconciliationMatched(reconciliation.state)
      || reconciliation.completedAt === undefined
      || reconciliation.completedAt > now
      || current.side === 'BUY' && reconciliation.reason !== 'AFTER_SELLS'
      || current.side === 'SELL' && reconciliation.reason !== 'BEFORE_EXECUTION'
    ) {
      return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
        field: 'reconciliationRunId',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (
      refreshedGates !== undefined
      && (
        approval.binding.planHash !== refreshedGates.currentPlanHash
        || approval.binding.planInputHash !== refreshedGates.currentPlanInputHash
        || approval.binding.strategyVersionId !== refreshedGates.strategyVersionId
        || approval.binding.strategyConfigHash !== refreshedGates.strategyConfigHash
        || run.policySnapshotId !== refreshedGates.policySnapshotId
        || reconciliation.externalSnapshotId !== refreshedGates.reconciliationSnapshotId
        || refreshedGates.executionWindow.executionDate
          !== approval.binding.executionDate
        || refreshedGates.executionWindow.windowStart !== approval.binding.windowStart
        || refreshedGates.executionWindow.windowEnd !== approval.binding.windowEnd
        || refreshedGates.executionWindow.timeZone !== approval.binding.timeZone
        || !Number.isSafeInteger(refreshedGates.maximumQuoteAgeMs)
        || refreshedGates.maximumQuoteAgeMs < 0
      )
    ) {
      return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
        field: 'dispatchLineage',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const globalKillResult = transaction.killSwitches.findByScope({ kind: 'GLOBAL' })
    if (!globalKillResult.ok) return globalKillResult
    const portfolioKillResult = transaction.killSwitches.findByScope({
      kind: 'PORTFOLIO',
      portfolioId: run.portfolioId,
    })
    if (!portfolioKillResult.ok) return portfolioKillResult
    const {
      globalKillSwitch: _globalKillSwitch,
      portfolioKillSwitch: _portfolioKillSwitch,
      ...gateDefaults
    } = command.gates
    return success(Object.freeze({
      order: current,
      run,
      gates: Object.freeze({
        ...gateDefaults,
        ...(refreshedGates ?? {}),
        quote: Object.freeze({
          ...(refreshedGates?.quote ?? gateDefaults.quote),
          nowInstant: now,
          maximumQuoteAgeMs: refreshedGates?.maximumQuoteAgeMs
            ?? gateDefaults.quote.maximumQuoteAgeMs,
          logicalOrderKey: command.intent.logicalOrderKey,
          proposedLimitPrice: command.intent.limitPrice,
        }),
        portfolioStatus: 'ACTIVE',
        requestedMode: run.mode,
        ...(globalKillResult.value !== undefined
          ? { globalKillSwitch: globalKillResult.value }
          : {}),
        ...(portfolioKillResult.value !== undefined
          ? { portfolioKillSwitch: portfolioKillResult.value }
          : {}),
        portfolioId: run.portfolioId,
        reconciliation,
        now,
        approval,
        executionRunId: run.executionRunId,
        currentPlanHash: run.planHash,
        currentPortfolioVersion: run.portfolioStateVersion,
      }),
    }))
  }

  private persistOutcome(
    orderId: OrderId,
    attemptId: SubmissionAttempt['submissionAttemptId'],
    placement: PlacementResult,
  ): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(orderId)
      if (!currentResult.ok) return currentResult
      const current = currentResult.value
      if (current === undefined || current.state !== 'SUBMISSION_IN_FLIGHT') {
        return failure(domainFailure('ORDER_STATE_TRANSITION_INVALID', {
          field: 'state',
          retryability: 'NEVER',
        }))
      }
      const latestAttempt = current.submissionAttempts[current.submissionAttempts.length - 1]
      if (latestAttempt?.submissionAttemptId !== attemptId) {
        return failure(domainFailure('SUBMISSION_ATTEMPT_INVALID', {
          field: 'submissionAttemptId',
          retryability: 'NEVER',
        }))
      }
      let transitioned: DomainResult<ExecutionOrderSnapshot>
      let residualWork: ResidualWork | undefined
      switch (placement.certainty) {
        case 'ACKNOWLEDGED':
          if (placement.brokerReference === undefined) {
            return failure(domainFailure('BROKER_STATUS_UNKNOWN', {
              field: 'brokerReference',
              retryability: 'NEVER',
            }))
          }
          transitioned = recordAcknowledged(
            current,
            placement.brokerReference,
            current.stateVersion + 1,
          )
          break
        case 'REJECTED':
          transitioned = recordRejected(
            current,
            placement.failure?.failureCode ?? 'ORDER_REJECTED',
            current.stateVersion + 1,
          )
          break
        case 'DEFINITELY_NOT_SENT':
          if (current.submissionAttempts.length === U05_MAX_PLACEMENT_ATTEMPTS) {
            if (current.intent === undefined) {
              return failure(domainFailure('ORDER_INTENT_NOT_PERSISTED', {
                field: 'intent',
                retryability: 'NEVER',
              }))
            }
            const remainingQuantity = createQuantity(
              current.intent.quantity.shares - current.filledQuantity.shares,
            )
            if (!remainingQuantity.ok) return remainingQuantity
            const residual = createResidualWork(
              this.ids.residualWorkId(),
              current.executionRunId,
              current.orderId,
              remainingQuantity.value,
              'RECOVERY_REQUIRED',
              placement.completedAt,
            )
            if (!residual.ok) return residual
            residualWork = residual.value
            transitioned = recordRetryExhausted(
              current,
              residual.value.residualWorkId,
              current.stateVersion + 1,
            )
          } else {
            transitioned = recordDefinitelyNotSent(
              current,
              current.stateVersion + 1,
            )
          }
          break
        case 'UNKNOWN':
          transitioned = recordUnknown(current, current.stateVersion + 1)
          break
      }
      if (!transitioned.ok) return transitioned
      let persistedOrder = transitioned.value
      const releaseEvidence: (
        PortfolioAccountingEvidencePayload
        | ExecutionRunPortfolioVersionEvidencePayload
      )[] = []
      if (
        transitioned.value.state === 'REJECTED'
        || transitioned.value.state === 'RESIDUAL'
      ) {
        const runResult = transaction.runs.getById(current.executionRunId)
        if (!runResult.ok) return runResult
        if (runResult.value === undefined) {
          return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
            field: 'executionRunId',
            retryability: 'NEVER',
          }))
        }
        const portfolioCurrent = transaction.portfolioState.assertCurrent(
          runResult.value.portfolioId,
          runResult.value.portfolioStateVersion,
          'ACTIVE',
        )
        if (!portfolioCurrent.ok) return portfolioCurrent
        const released = this.terminalRelease.release(transaction, transitioned.value)
        if (!released.ok) return released
        const validRelease = validateTerminalReservationRelease(
          current,
          transitioned.value,
          runResult.value,
          released.value,
        )
        if (!validRelease.ok) return validRelease
        persistedOrder = validRelease.value.order
        if (validRelease.value.accountingEvidence !== undefined) {
          releaseEvidence.push(validRelease.value.accountingEvidence)
        }
        if (validRelease.value.runEvidence !== undefined) {
          releaseEvidence.push(validRelease.value.runEvidence)
        }
      }
      const failureCode = placement.failure?.failureCode
        ?? (placement.certainty === 'REJECTED' ? 'ORDER_REJECTED' : undefined)
      const finalizedAttempt: SubmissionAttempt = Object.freeze({
        ...latestAttempt,
        state: placement.certainty,
        completedAt: placement.completedAt,
        ...(failureCode !== undefined ? { failureCode } : {}),
      })
      persistedOrder = Object.freeze({
        ...persistedOrder,
        submissionAttempts: Object.freeze([
          ...current.submissionAttempts.slice(0, -1),
          finalizedAttempt,
        ]),
      })
      if (residualWork !== undefined) {
        const insertedResidual = transaction.residuals.insert(residualWork)
        if (!insertedResidual.ok) return insertedResidual
      }
      const saved = transaction.orders.save(persistedOrder, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        ...releaseEvidence,
        Object.freeze({
          kind: 'SUBMISSION_OUTCOME_RECORDED',
          portfolioId: persistedOrder.portfolioId,
          executionRunId: persistedOrder.executionRunId,
          orderId: persistedOrder.orderId,
          submissionAttemptId: attemptId,
          certainty: placement.certainty,
          orderState: persistedOrder.state,
          stateVersion: persistedOrder.stateVersion,
          occurredAt: placement.completedAt,
        }),
        ...(residualWork !== undefined
          ? [
            Object.freeze({
              kind: 'RESIDUAL_WORK_RECORDED' as const,
              portfolioId: persistedOrder.portfolioId,
              executionRunId: residualWork.executionRunId,
              orderId: residualWork.orderId,
              residualWorkId: residualWork.residualWorkId,
              remainingQuantityShares:
                residualWork.remainingQuantity.shares.toString(10),
              reason: residualWork.reason,
              occurredAt: residualWork.createdAt,
            }),
          ]
          : []),
      ])
      if (!staged.ok) return staged
      return success(persistedOrder)
    })
  }

  private normalizePlacement(
    attemptId: SubmissionAttempt['submissionAttemptId'],
    attemptedAt: Instant,
    accountBindingId: BrokerAccountBindingId,
    result: DomainResult<PlacementResult>,
  ): PlacementResult {
    if (result.ok && result.value.submissionAttemptId === attemptId) {
      const placement = result.value
      const valid = placement.certainty === 'ACKNOWLEDGED'
        ? placement.brokerReference !== undefined
          && placement.brokerReference.accountBindingId === accountBindingId
          && placement.failure === undefined
        : placement.certainty === 'DEFINITELY_NOT_SENT'
          ? placement.brokerReference === undefined
            && (
              placement.failure === undefined
              || placement.failure.certainty === 'DEFINITELY_NOT_SENT'
            )
          : placement.brokerReference === undefined
            && placement.failure?.certainty === placement.certainty
      if (valid) return placement
    }
    const failureCode = result.ok
      ? 'BROKER_STATUS_UNKNOWN'
      : result.error.code
    return Object.freeze({
      submissionAttemptId: attemptId,
      certainty: 'UNKNOWN',
      attemptedAt,
      completedAt: this.clock.now(),
      failure: Object.freeze({
        failureCode,
        certainty: 'UNKNOWN',
        redactedDetail: 'Placement outcome could not be proven.',
      }),
    })
  }

  private definitelyNotDispatched(
    attemptId: SubmissionAttempt['submissionAttemptId'],
    attemptedAt: Instant,
    failureCode: string = 'KILL_SWITCH_ACTIVE',
  ): PlacementResult {
    return Object.freeze({
      submissionAttemptId: attemptId,
      certainty: 'DEFINITELY_NOT_SENT',
      attemptedAt,
      completedAt: this.clock.now(),
      failure: Object.freeze({
        failureCode: this.isPlacementFailureCode(failureCode)
          ? failureCode
          : 'SUBMISSION_OUTCOME_UNKNOWN',
        certainty: 'DEFINITELY_NOT_SENT',
        redactedDetail: 'Dispatch was not admitted.',
      }),
    })
  }

  private isPlacementFailureCode(
    code: string,
  ): code is NonNullable<PlacementResult['failure']>['failureCode'] {
    return DOMAIN_FAILURE_CODES.some((candidate) => candidate === code)
  }

  private unresolvedDispatch(
    admission: DispatchAdmissionIdentity,
    brokerDispatched: boolean,
    failureValue: AnyDomainFailure,
  ): DispatchOperationResult<CompletedPlacement> {
    return Object.freeze({
      kind: 'OUTCOME_UNRESOLVED',
      unresolved: Object.freeze({
        admission,
        brokerDispatched,
        failureCode: failureValue.code,
      }),
      failure: failureValue,
    })
  }
}
