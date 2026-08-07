import {
  recordCancellationOutcome,
  recordCancelled,
  requestCancellation,
  type CancellationAttemptRecord,
  type CancellationOutcomeRecord,
  type ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type { ReconciliationRunSnapshot } from '../../domain/execution/reconciliation.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type {
  ExecutionRunPortfolioVersionEvidencePayload,
  PortfolioAccountingEvidencePayload,
} from '../../domain/execution/evidence.ts'
import type {
  BrokerAccountBindingId,
  IdempotencyKey,
} from '../../domain/shared/identifiers.ts'
import type { Quantity } from '../../domain/shared/quantity.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type { BrokerPlacementCapability } from '../../ports/execution/broker-port.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type {
  ExecutionClockPort,
  ExecutionIdentifierFactory,
} from '../../ports/execution/runtime-port.ts'
import {
  StatusFillCoordinator,
  type CheckOrderCommand,
} from './status-fill-coordinator.ts'
import {
  validateTerminalReservationRelease,
  type TerminalReservationRelease,
} from './placement-coordinator.ts'

export type CancelOrderCommand = Readonly<{
  order: ExecutionOrderSnapshot
  accountBindingId: BrokerAccountBindingId
  requestedBy: string
  reasonCode: string
  idempotencyKey: IdempotencyKey
  deadlineAt: Instant
  statusCheck: Omit<CheckOrderCommand, 'order'>
}>

export type ConfirmCancellationCommand = Readonly<{
  orderId: ExecutionOrderSnapshot['orderId']
  reconciliation: ReconciliationRunSnapshot
}>

type CancellationStart = Readonly<{
  order: ExecutionOrderSnapshot
  request: CancellationAttemptRecord
  outcome?: CancellationOutcomeRecord
  replayed: boolean
}>

export class CancellationCoordinator {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly broker: BrokerPlacementCapability
  private readonly statusFill: StatusFillCoordinator
  private readonly clock: ExecutionClockPort
  private readonly ids: ExecutionIdentifierFactory
  private readonly terminalRelease: TerminalReservationRelease

  constructor(
    unitOfWork: ExecutionUnitOfWork,
    broker: BrokerPlacementCapability,
    statusFill: StatusFillCoordinator,
    clock: ExecutionClockPort,
    ids: ExecutionIdentifierFactory,
    terminalRelease: TerminalReservationRelease,
  ) {
    this.unitOfWork = unitOfWork
    this.broker = broker
    this.statusFill = statusFill
    this.clock = clock
    this.ids = ids
    this.terminalRelease = terminalRelease
  }

  async request(
    command: CancelOrderCommand,
  ): Promise<DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure>> {
    if (
      command.order.brokerReference === undefined
      || command.order.portfolioId !== command.statusCheck.portfolioId
      || command.order.brokerReference.accountBindingId !== command.accountBindingId
      || command.statusCheck.accountBindingId !== command.accountBindingId
    ) {
      return failure(domainFailure('CANCELLATION_OUTCOME_UNKNOWN', {
        field: 'brokerReference',
        retryability: 'NEVER',
      }))
    }
    const requestCommit = this.unitOfWork.execute<CancellationStart>((transaction) => {
      const currentResult = transaction.orders.getById(command.order.orderId)
      if (!currentResult.ok) return currentResult
      if (currentResult.value === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      const current = currentResult.value
      if (
        current.brokerReference === undefined
        || current.brokerReference.accountBindingId !== command.accountBindingId
      ) {
        return failure(domainFailure('CANCELLATION_OUTCOME_UNKNOWN', {
          field: 'brokerReference',
          retryability: 'NEVER',
        }))
      }
      const existingRequest = transaction.cancellations
        .findRequestByOrderAndIdempotencyKey(
          current.orderId,
          command.idempotencyKey,
        )
      if (!existingRequest.ok) return existingRequest
      if (existingRequest.value !== undefined) {
        if (
          existingRequest.value.requestedBy !== command.requestedBy
          || existingRequest.value.reasonCode !== command.reasonCode
          || !current.cancellations.some((item) =>
            item.cancellationId === existingRequest.value?.cancellationId)
        ) {
          return failure(domainFailure('MUTATION_IDEMPOTENCY_REQUIRED', {
            field: 'idempotencyKey',
            retryability: 'NEVER',
          }))
        }
        const existingOutcome = transaction.cancellations.getOutcomeById(
          existingRequest.value.cancellationId,
        )
        if (!existingOutcome.ok) return existingOutcome
        return success<CancellationStart>(Object.freeze({
          order: current,
          request: existingRequest.value,
          ...(existingOutcome.value !== undefined
            ? { outcome: existingOutcome.value }
            : {}),
          replayed: true,
        }))
      }
      const proposedRequest: CancellationAttemptRecord = Object.freeze({
        cancellationId: this.ids.cancellationId(),
        orderId: current.orderId,
        idempotencyKey: command.idempotencyKey,
        requestedBy: command.requestedBy,
        reasonCode: command.reasonCode,
        requestedAt: this.clock.now(),
        deadlineAt: command.deadlineAt,
      })
      const pending = requestCancellation(
        current,
        proposedRequest,
        current.stateVersion + 1,
      )
      if (!pending.ok) return pending
      const inserted = transaction.cancellations.insertRequest(proposedRequest)
      if (!inserted.ok) return inserted
      const saved = transaction.orders.save(pending.value, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        Object.freeze({
          kind: 'CANCELLATION_REQUESTED',
          portfolioId: current.portfolioId,
          executionRunId: current.executionRunId,
          orderId: current.orderId,
          cancellationId: proposedRequest.cancellationId,
          occurredAt: proposedRequest.requestedAt,
        }),
        Object.freeze({
          kind: 'ORDER_STATE_CHANGED',
          portfolioId: current.portfolioId,
          executionRunId: current.executionRunId,
          orderId: current.orderId,
          previousState: current.state,
          newState: pending.value.state,
          stateVersion: pending.value.stateVersion,
          occurredAt: proposedRequest.requestedAt,
        }),
      ])
      if (!staged.ok) return staged
      return success<CancellationStart>(Object.freeze({
        order: pending.value,
        request: proposedRequest,
        replayed: false,
      }))
    })
    if (!requestCommit.ok) return requestCommit
    const cancellationId = requestCommit.value.value.request.cancellationId
    const committedReference = requestCommit.value.value.order.brokerReference
    if (committedReference === undefined) {
      return failure(domainFailure('CANCELLATION_OUTCOME_UNKNOWN', {
        field: 'brokerReference',
        retryability: 'NEVER',
      }))
    }

    let outcome = requestCommit.value.value.outcome
    if (outcome === undefined && requestCommit.value.value.replayed) {
      return failure(domainFailure('CANCELLATION_OUTCOME_UNKNOWN', {
        field: 'cancellationId',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (outcome === undefined) {
      const brokerResult = await this.broker.cancelOrder({
        cancellationId,
        orderId: requestCommit.value.value.order.orderId,
        portfolioId: requestCommit.value.value.order.portfolioId,
        accountBindingId: command.accountBindingId,
        brokerOrderReferenceId: committedReference.brokerOrderReferenceId,
        deadlineAt: requestCommit.value.value.request.deadlineAt,
      })
      const completedAt = this.clock.now()
      outcome = brokerResult.ok && brokerResult.value.cancellationId === cancellationId
        ? Object.freeze({
          cancellationId,
          outcome: brokerResult.value.outcome,
          completedAt,
          brokerAsOf: brokerResult.value.brokerAsOf,
          ...(brokerResult.value.failure !== undefined
            ? { failureCode: brokerResult.value.failure.failureCode }
            : {}),
        })
        : Object.freeze({
          cancellationId,
          outcome: 'UNKNOWN',
          completedAt,
        })
    }
    const committedOutcome = outcome
    const outcomeCommit = this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(command.order.orderId)
      if (!currentResult.ok) return currentResult
      if (currentResult.value === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      const current = currentResult.value
      const existingOutcome = transaction.cancellations.getOutcomeById(cancellationId)
      if (!existingOutcome.ok) return existingOutcome
      if (existingOutcome.value !== undefined) return success(current)
      const recorded = recordCancellationOutcome(
        current,
        committedOutcome,
        current.stateVersion + 1,
      )
      if (!recorded.ok) return recorded
      const inserted = transaction.cancellations.insertOutcome(committedOutcome)
      if (!inserted.ok) return inserted
      const saved = transaction.orders.save(recorded.value, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        Object.freeze({
          kind: 'CANCELLATION_OUTCOME_RECORDED',
          portfolioId: current.portfolioId,
          executionRunId: current.executionRunId,
          orderId: current.orderId,
          cancellationId,
          outcome: committedOutcome.outcome,
          occurredAt: committedOutcome.completedAt,
        }),
        Object.freeze({
          kind: 'ORDER_STATE_CHANGED',
          portfolioId: current.portfolioId,
          executionRunId: current.executionRunId,
          orderId: current.orderId,
          previousState: current.state,
          newState: recorded.value.state,
          stateVersion: recorded.value.stateVersion,
          occurredAt: committedOutcome.completedAt,
        }),
      ])
      if (!staged.ok) return staged
      return success(recorded.value)
    })
    if (!outcomeCommit.ok) return outcomeCommit

    const checked = await this.statusFill.check({
      ...command.statusCheck,
      order: outcomeCommit.value.value,
    })
    if (!checked.ok) return checked
    return success(Object.freeze({
      value: checked.value.value.order,
      postCommitEvidence: Object.freeze([
        ...requestCommit.value.postCommitEvidence,
        ...outcomeCommit.value.postCommitEvidence,
        ...checked.value.postCommitEvidence,
      ]),
    }))
  }

  confirmTerminal(
    command: ConfirmCancellationCommand,
  ): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(command.orderId)
      if (!currentResult.ok) return currentResult
      if (currentResult.value === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      const current = currentResult.value
      const reconciliationResult = transaction.reconciliationRuns.getById(
        command.reconciliation.reconciliationRunId,
      )
      if (!reconciliationResult.ok) return reconciliationResult
      const reconciliation = reconciliationResult.value
      const cancellationRequest =
        current.cancellations[current.cancellations.length - 1]
      if (
        reconciliation === undefined
        || reconciliation.portfolioId !== current.portfolioId
        || reconciliation.reason !== 'AFTER_CANCELLATION'
        || (
          reconciliation.state !== 'MATCHED'
          && reconciliation.state !== 'MATCHED_WITH_ROUNDING'
        )
        || reconciliation.completedAt === undefined
        || cancellationRequest === undefined
        || reconciliation.completedAt < cancellationRequest.requestedAt
        || reconciliation.externalSnapshotId === undefined
      ) {
        return failure(domainFailure('CANCELLATION_NOT_RECONCILED', {
          field: 'reconciliation',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const snapshotResult = transaction.reconciliationSnapshots.getById(
        reconciliation.externalSnapshotId,
      )
      if (!snapshotResult.ok) return snapshotResult
      if (
        snapshotResult.value === undefined
        || snapshotResult.value.portfolioId !== current.portfolioId
        || snapshotResult.value.source === 'LOCAL'
        || snapshotResult.value.accountBindingId
          !== current.brokerReference?.accountBindingId
      ) {
        return failure(domainFailure('CANCELLATION_NOT_RECONCILED', {
          field: 'reconciliationSnapshot',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const openOrder = snapshotResult.value.openOrders.find((item) =>
        item.brokerReference.brokerOrderReferenceId
          === current.brokerReference?.brokerOrderReferenceId)
      if (openOrder === undefined || openOrder.openQuantity.shares !== 0n) {
        return failure(domainFailure('CANCELLATION_NOT_RECONCILED', {
          field: 'openQuantity',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const reconciledOpenQuantity: Quantity = openOrder.openQuantity
      const cancelled = recordCancelled(current, {
        reconciliationState: reconciliation.state,
        openQuantity: reconciledOpenQuantity,
      }, current.stateVersion + 1)
      if (!cancelled.ok) return cancelled
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
      const released = this.terminalRelease.release(transaction, cancelled.value)
      if (!released.ok) return released
      const validRelease = validateTerminalReservationRelease(
        current,
        cancelled.value,
        runResult.value,
        released.value,
      )
      if (!validRelease.ok) return validRelease
      const saved = transaction.orders.save(
        validRelease.value.order,
        current.stateVersion,
      )
      if (!saved.ok) return saved
      const releaseEvidence: (
        PortfolioAccountingEvidencePayload
        | ExecutionRunPortfolioVersionEvidencePayload
      )[] = []
      if (validRelease.value.accountingEvidence !== undefined) {
        releaseEvidence.push(validRelease.value.accountingEvidence)
      }
      if (validRelease.value.runEvidence !== undefined) {
        releaseEvidence.push(validRelease.value.runEvidence)
      }
      const staged = transaction.stageEvidence([
        ...releaseEvidence,
        Object.freeze({
        kind: 'ORDER_STATE_CHANGED',
        portfolioId: current.portfolioId,
        executionRunId: current.executionRunId,
        orderId: current.orderId,
        previousState: current.state,
        newState: validRelease.value.order.state,
        stateVersion: validRelease.value.order.stateVersion,
        occurredAt: this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success(validRelease.value.order)
    })
  }
}
