import type { AccountingDelta, LotMutation } from '../../domain/execution/fill-accounting.ts'
import {
  computeBuyAccountingDelta,
  computeSellAccountingDelta,
  detectFillConflict,
  validateIncrementalQuantity,
} from '../../domain/execution/fill-accounting.ts'
import type { NormalizedFill } from '../../domain/execution/contracts.ts'
import type {
  ExecutionRunPortfolioVersionEvidencePayload,
  PortfolioAccountingEvidencePayload,
} from '../../domain/execution/evidence.ts'
import {
  applyFillReservationRelease,
  applyFillProgress,
  recordExpired,
  recordRejected,
  recordUnknown,
  transitionToOpen,
  type ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type { Quantity } from '../../domain/shared/quantity.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type {
  BrokerAccountBindingId,
  PortfolioId,
} from '../../domain/shared/identifiers.ts'
import type {
  BrokerRecoveryCapability,
  FillCollectionResult,
  OrderStatusResult,
} from '../../ports/execution/broker-port.ts'
import type {
  CommittedExecutionResult,
  ExecutionTransaction,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type {
  BoundedTimerPort,
  ExecutionClockPort,
} from '../../ports/execution/runtime-port.ts'
import {
  validateTerminalReservationRelease,
  type TerminalReservationRelease,
} from './placement-coordinator.ts'

export type AtomicFillAccountingResult = Readonly<{
  accountingEvidence: PortfolioAccountingEvidencePayload
  run: ExecutionRunSnapshot
  runEvidence: ExecutionRunPortfolioVersionEvidencePayload
}>

export interface AtomicFillAccounting {
  apply(
    transaction: ExecutionTransaction,
    orderBeforeReservationRelease: ExecutionOrderSnapshot,
    orderAfterReservationRelease: ExecutionOrderSnapshot,
    fill: NormalizedFill,
    delta: AccountingDelta,
  ): DomainResult<AtomicFillAccountingResult>
}

export type FillAccountingContext = Readonly<{
  fillLotId?: string
  existingLotCount?: number
  sellLotMutations?: readonly LotMutation[]
}>

export type CheckOrderCommand = Readonly<{
  order: ExecutionOrderSnapshot
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  deadlineAt: Instant
  fromCursor?: string
  accountingContext(fill: NormalizedFill): DomainResult<FillAccountingContext>
}>

export type StatusFillCheckResult = Readonly<{
  order: ExecutionOrderSnapshot
  status: OrderStatusResult
  fills: FillCollectionResult
  reconciliationRequired: boolean
}>

export class StatusFillCoordinator {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly broker: BrokerRecoveryCapability
  private readonly accounting: AtomicFillAccounting
  private readonly timer: BoundedTimerPort
  private readonly clock: ExecutionClockPort
  private readonly terminalRelease: TerminalReservationRelease

  constructor(
    unitOfWork: ExecutionUnitOfWork,
    broker: BrokerRecoveryCapability,
    accounting: AtomicFillAccounting,
    terminalRelease: TerminalReservationRelease,
    timer: BoundedTimerPort,
    clock: ExecutionClockPort,
  ) {
    this.unitOfWork = unitOfWork
    this.broker = broker
    this.accounting = accounting
    this.terminalRelease = terminalRelease
    this.timer = timer
    this.clock = clock
  }

  async check(
    command: CheckOrderCommand,
  ): Promise<DomainResult<CommittedExecutionResult<StatusFillCheckResult>, AnyDomainFailure>> {
    if (
      command.order.portfolioId !== command.portfolioId
      || command.order.brokerReference === undefined
    ) {
      return failure(domainFailure('FILL_BINDING_INVALID', {
        field: 'order',
        retryability: 'NEVER',
      }))
    }
    const statusResult = await this.broker.fetchOrderStatus({
      orderId: command.order.orderId,
      portfolioId: command.portfolioId,
      accountBindingId: command.accountBindingId,
      brokerOrderReferenceId: command.order.brokerReference.brokerOrderReferenceId,
      deadlineAt: command.deadlineAt,
    })
    if (!statusResult.ok) return statusResult
    if (
      statusResult.value.orderId !== command.order.orderId
      || statusResult.value.snapshot.brokerReference.brokerOrderReferenceId
        !== command.order.brokerReference.brokerOrderReferenceId
      || statusResult.value.snapshot.brokerReference.accountBindingId
        !== command.accountBindingId
    ) {
      return failure(domainFailure('FILL_BINDING_INVALID', {
        field: 'status',
        retryability: 'NEVER',
      }))
    }
    const fillsResult = await this.broker.collectFills({
      portfolioId: command.portfolioId,
      accountBindingId: command.accountBindingId,
      ...(command.fromCursor !== undefined ? { fromCursor: command.fromCursor } : {}),
      deadlineAt: command.deadlineAt,
    })
    if (!fillsResult.ok) return fillsResult
    if (!fillsResult.value.coherent) {
      return failure(domainFailure('BROKER_SNAPSHOT_INCOHERENT', {
        field: 'fills',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }

    let latest = command.order
    const evidence = []
    for (const fill of fillsResult.value.fills) {
      if (fill.orderId !== command.order.orderId) continue
      const applied = this.applyOneFill(latest, fill, command.accountingContext)
      if (!applied.ok) return applied
      latest = applied.value.value
      evidence.push(...applied.value.postCommitEvidence)
    }
    const brokerFillAccountingMismatch =
      statusResult.value.snapshot.filledQuantity.shares
        !== latest.filledQuantity.shares
    const statusCommit = this.commitStatus(latest, statusResult.value)
    if (!statusCommit.ok) return statusCommit
    latest = statusCommit.value.value
    evidence.push(...statusCommit.value.postCommitEvidence)
    return success(Object.freeze({
      value: Object.freeze({
        order: latest,
        status: statusResult.value,
        fills: fillsResult.value,
        reconciliationRequired:
          fillsResult.value.fills.length > 0
          || brokerFillAccountingMismatch
          || latest.state === 'UNKNOWN'
          || latest.state === 'CANCEL_PENDING',
      }),
      postCommitEvidence: Object.freeze(evidence),
    }))
  }

  async waitForNextPoll(
    intervalMs: number,
  ): Promise<DomainResult<void>> {
    if (intervalMs < 2_000 || intervalMs > 15_000) {
      return failure(domainFailure('EXECUTION_WINDOW_INVALID', {
        field: 'pollIntervalMs',
        retryability: 'NEVER',
      }))
    }
    return this.timer.delay(intervalMs, 15_000)
  }

  private applyOneFill(
    expectedOrder: ExecutionOrderSnapshot,
    fill: NormalizedFill,
    contextFactory: CheckOrderCommand['accountingContext'],
  ): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure> {
    if (
      fill.portfolioId !== expectedOrder.portfolioId
      || fill.executionRunId !== expectedOrder.executionRunId
      || fill.orderId !== expectedOrder.orderId
      || fill.instrumentId !== expectedOrder.instrumentId
      || fill.side !== expectedOrder.side
      || fill.product !== 'CNC'
    ) {
      return failure(domainFailure('FILL_BINDING_INVALID', {
        field: 'fill',
        retryability: 'NEVER',
      }))
    }
    const contextResult = contextFactory(fill)
    if (!contextResult.ok) return contextResult
    return this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(expectedOrder.orderId)
      if (!currentResult.ok) return currentResult
      const current = currentResult.value
      if (current === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      const conflict = detectFillConflict(current.fills, fill.fillId, fill.contentHash)
      if (!conflict.ok) return conflict
      if (conflict.value === 'DUPLICATE') return success(current)
      if (conflict.value === 'CONFLICT') {
        return failure(domainFailure('FILL_IDEMPOTENCY_CONFLICT', {
          field: 'fillId',
          retryability: 'NEVER',
        }))
      }
      if (current.intent === undefined) {
        return failure(domainFailure('ORDER_INTENT_NOT_PERSISTED', {
          field: 'intent',
          retryability: 'NEVER',
        }))
      }
      const runResult = transaction.runs.getById(current.executionRunId)
      if (!runResult.ok) return runResult
      const run = runResult.value
      if (run === undefined || run.portfolioId !== current.portfolioId) {
        return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
          field: 'executionRunId',
          retryability: 'NEVER',
        }))
      }
      const portfolioCurrent = transaction.portfolioState.assertCurrent(
        run.portfolioId,
        run.portfolioStateVersion,
        'ACTIVE',
      )
      if (!portfolioCurrent.ok) return portfolioCurrent
      const cumulative = validateIncrementalQuantity(
        current.intent.quantity,
        current.filledQuantity,
        fill.quantity,
      )
      if (!cumulative.ok) return cumulative
      const context = contextResult.value
      let delta: DomainResult<AccountingDelta>
      if (fill.side === 'BUY') {
        if (
          current.reservedCash === undefined
          || context.fillLotId === undefined
          || context.existingLotCount === undefined
        ) {
          return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
            field: 'buyAccountingContext',
            retryability: 'NEVER',
          }))
        }
        delta = computeBuyAccountingDelta(
          fill,
          current.reservedCash,
          fill.fillId,
          context.fillLotId,
          context.existingLotCount,
        )
      } else {
        if (
          current.reservedDeliveryQuantity === undefined
          || context.sellLotMutations === undefined
        ) {
          return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
            field: 'sellAccountingContext',
            retryability: 'NEVER',
          }))
        }
        delta = computeSellAccountingDelta(
          fill,
          fill.fillId,
          context.sellLotMutations,
          current.reservedDeliveryQuantity,
        )
      }
      if (!delta.ok) return delta
      const progressed = applyFillProgress(
        current,
        fill,
        cumulative.value,
        current.stateVersion + 1,
      )
      if (!progressed.ok) return progressed
      const reservationReleased = applyFillReservationRelease(
        progressed.value,
        delta.value,
      )
      if (!reservationReleased.ok) return reservationReleased
      const accountingApplied = this.accounting.apply(
        transaction,
        current,
        reservationReleased.value,
        fill,
        delta.value,
      )
      if (!accountingApplied.ok) return accountingApplied
      const accountingEvidence = accountingApplied.value.accountingEvidence
      const advancedRun = accountingApplied.value.run
      const runEvidence = accountingApplied.value.runEvidence
      const priorReservedCash = current.reservedCash?.minorUnits ?? 0n
      const nextReservedCash =
        reservationReleased.value.reservedCash?.minorUnits ?? 0n
      const expectedReservedCashDelta =
        (nextReservedCash - priorReservedCash).toString(10)
      const priorReservedDelivery =
        current.reservedDeliveryQuantity?.shares ?? 0n
      const nextReservedDelivery =
        reservationReleased.value.reservedDeliveryQuantity?.shares ?? 0n
      const expectedReservedDeliveryDelta =
        (nextReservedDelivery - priorReservedDelivery).toString(10)
      if (
        accountingEvidence.reason !== (
          fill.side === 'BUY' ? 'BUY_FILL' : 'SELL_FILL'
        )
        || accountingEvidence.portfolioId !== fill.portfolioId
        || accountingEvidence.executionRunId !== fill.executionRunId
        || accountingEvidence.orderId !== fill.orderId
        || accountingEvidence.fillId !== fill.fillId
        || accountingEvidence.instrumentId !== fill.instrumentId
        || accountingEvidence.cashDeltaMinorUnits
          !== delta.value.cashDelta.minorUnits.toString(10)
        || accountingEvidence.holdingDeltaShares
          !== delta.value.holdingDelta.toString(10)
        || accountingEvidence.reservedCashDeltaMinorUnits
          !== expectedReservedCashDelta
        || accountingEvidence.reservedDeliveryDeltaShares
          !== expectedReservedDeliveryDelta
        || accountingEvidence.reservedQuantityDeltaShares
          !== expectedReservedDeliveryDelta
        || fill.side === 'BUY' && expectedReservedDeliveryDelta !== '0'
        || fill.side === 'SELL' && expectedReservedCashDelta !== '0'
        || reservationReleased.value.state === 'FILLED'
          && (
            nextReservedCash !== 0n
            || nextReservedDelivery !== 0n
          )
        || advancedRun.executionRunId !== run.executionRunId
        || advancedRun.portfolioId !== run.portfolioId
        || advancedRun.approvalId !== run.approvalId
        || advancedRun.state !== run.state
        || advancedRun.portfolioStateVersion !== run.portfolioStateVersion + 1
        || advancedRun.stateVersion !== run.stateVersion + 1
        || accountingEvidence.portfolioStateVersion
          !== advancedRun.portfolioStateVersion
        || runEvidence.portfolioId !== advancedRun.portfolioId
        || runEvidence.executionRunId !== advancedRun.executionRunId
        || runEvidence.previousPortfolioStateVersion !== run.portfolioStateVersion
        || runEvidence.portfolioStateVersion !== advancedRun.portfolioStateVersion
        || runEvidence.stateVersion !== advancedRun.stateVersion
      ) {
        return failure(domainFailure('EXECUTION_EVIDENCE_MISSING', {
          field: 'accountingEvidence',
          retryability: 'NEVER',
        }))
      }
      const fillInserted = transaction.fills.insert(fill)
      if (!fillInserted.ok) return fillInserted
      const saved = transaction.orders.save(
        reservationReleased.value,
        current.stateVersion,
      )
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        accountingEvidence,
        runEvidence,
        Object.freeze({
          kind: 'FILL_RECORDED',
          portfolioId: fill.portfolioId,
          executionRunId: fill.executionRunId,
          orderId: fill.orderId,
          fillId: fill.fillId,
          side: fill.side,
          filledQuantityShares: fill.quantity.shares.toString(10),
          cumulativeQuantityShares: cumulative.value.shares.toString(10),
          occurredAt: this.clock.now(),
        }),
        Object.freeze({
          kind: 'ORDER_STATE_CHANGED',
          portfolioId: fill.portfolioId,
          executionRunId: fill.executionRunId,
          orderId: fill.orderId,
          previousState: current.state,
          newState: reservationReleased.value.state,
          stateVersion: reservationReleased.value.stateVersion,
          occurredAt: this.clock.now(),
        }),
      ])
      if (!staged.ok) return staged
      return success(reservationReleased.value)
    })
  }

  private commitStatus(
    expectedOrder: ExecutionOrderSnapshot,
    status: OrderStatusResult,
  ): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(expectedOrder.orderId)
      if (!currentResult.ok) return currentResult
      const current = currentResult.value
      if (current === undefined) {
        return failure(domainFailure('ORDER_LINEAGE_INCOMPLETE', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      let transitioned: DomainResult<ExecutionOrderSnapshot>
      switch (status.snapshot.status) {
        case 'ACKNOWLEDGED':
          return success(current)
        case 'OPEN':
          if (
            current.state === 'OPEN'
            || current.state === 'PARTIALLY_FILLED'
            || current.state === 'CANCEL_PENDING'
          ) return success(current)
          transitioned = transitionToOpen(current, current.stateVersion + 1)
          break
        case 'PARTIALLY_FILLED':
          return success(current)
        case 'FILLED':
          if (current.state === 'FILLED') return success(current)
          transitioned = recordUnknown(current, current.stateVersion + 1)
          break
        case 'REJECTED':
          transitioned = recordRejected(current, 'ORDER_REJECTED', current.stateVersion + 1)
          break
        case 'EXPIRED':
          transitioned = recordExpired(current, current.stateVersion + 1)
          break
        case 'CANCEL_PENDING':
        case 'CANCELLED':
          return success(current)
        case 'UNKNOWN':
          if (current.state === 'UNKNOWN') return success(current)
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
        || transitioned.value.state === 'EXPIRED'
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
      const saved = transaction.orders.save(persistedOrder, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([
        ...releaseEvidence,
        Object.freeze({
        kind: 'ORDER_STATE_CHANGED',
        portfolioId: current.portfolioId,
        executionRunId: current.executionRunId,
        orderId: current.orderId,
        previousState: current.state,
        newState: persistedOrder.state,
        stateVersion: persistedOrder.stateVersion,
        occurredAt: this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success(persistedOrder)
    })
  }
}
