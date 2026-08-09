import {
  isUnresolvableTerminalState,
  recordUnknown,
  type ExecutionOrderSnapshot,
} from '../../domain/execution/execution-order.ts'
import type {
  ExecutionProgressEvidence,
} from '../../domain/execution/evidence.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type {
  BrokerAccountBindingId,
  PortfolioId,
} from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type { BrokerRecoveryCapability } from '../../ports/execution/broker-port.ts'
import type {
  ExecutionClockPort,
} from '../../ports/execution/runtime-port.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import {
  StatusFillCoordinator,
  type CheckOrderCommand,
} from './status-fill-coordinator.ts'

export interface RecoveryPreflight {
  verify(portfolioId: PortfolioId): Promise<DomainResult<void>>
}

export type RecoverPortfolioCommand = Readonly<{
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  deadlineAt: Instant
  preflight: RecoveryPreflight
  statusCheck(order: ExecutionOrderSnapshot): Omit<CheckOrderCommand, 'order'>
}>

export type RecoveryResult = Readonly<{
  orders: readonly ExecutionOrderSnapshot[]
  progress?: ExecutionProgressEvidence
  reconciliationRequired: boolean
}>

type LoadedRecoveryState = Readonly<{
  run: ExecutionRunSnapshot | undefined
  orders: readonly ExecutionOrderSnapshot[]
}>

export class RecoveryService {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly broker: BrokerRecoveryCapability
  private readonly statusFill: StatusFillCoordinator
  private readonly clock: ExecutionClockPort

  constructor(
    unitOfWork: ExecutionUnitOfWork,
    broker: BrokerRecoveryCapability,
    statusFill: StatusFillCoordinator,
    clock: ExecutionClockPort,
  ) {
    this.unitOfWork = unitOfWork
    this.broker = broker
    this.statusFill = statusFill
    this.clock = clock
  }

  async recover(
    command: RecoverPortfolioCommand,
  ): Promise<DomainResult<CommittedExecutionResult<RecoveryResult>, AnyDomainFailure>> {
    const preflight = await command.preflight.verify(command.portfolioId)
    if (!preflight.ok) return preflight
    // Keep the read-only broker capability live in this object graph. No placement
    // capability is accepted by this service, so restart classification cannot submit.
    void this.broker

    const loaded = this.unitOfWork.execute<LoadedRecoveryState>((transaction) => {
      const runResult = transaction.runs.findActiveByPortfolio(command.portfolioId)
      if (!runResult.ok) return runResult
      if (runResult.value === undefined) {
        return success<LoadedRecoveryState>(Object.freeze({
          run: undefined,
          orders: Object.freeze([]) as readonly ExecutionOrderSnapshot[],
        }))
      }
      const ordersResult = transaction.orders.listByRun(runResult.value.executionRunId)
      if (!ordersResult.ok) return ordersResult
      return success<LoadedRecoveryState>(Object.freeze({
        run: runResult.value,
        orders: ordersResult.value,
      }))
    })
    if (!loaded.ok) return loaded
    if (loaded.value.value.run === undefined) {
      return success(Object.freeze({
        value: Object.freeze({
          orders: Object.freeze([]),
          reconciliationRequired: false,
        }),
        postCommitEvidence: Object.freeze([]),
      }))
    }

    const orders = [...loaded.value.value.orders]
      .sort((left, right) => left.sequence - right.sequence)
    const recovered: ExecutionOrderSnapshot[] = []
    const evidence = [...loaded.value.postCommitEvidence]
    let reconciliationRequired = false
    for (const order of orders) {
      if (order.state === 'SUBMISSION_IN_FLIGHT') {
        const classified = this.classifyInFlightUnknown(order)
        if (!classified.ok) return classified
        recovered.push(classified.value.value)
        evidence.push(...classified.value.postCommitEvidence)
        reconciliationRequired = true
        continue
      }
      if (order.state === 'UNKNOWN') {
        const queried = await this.queryUnknown(order, command)
        if (!queried.ok) return queried
        recovered.push(queried.value.value)
        evidence.push(...queried.value.postCommitEvidence)
        reconciliationRequired ||= queried.value.value.state === 'UNKNOWN'
        continue
      }
      if (isUnresolvableTerminalState(order.state) || order.brokerReference === undefined) {
        recovered.push(order)
        continue
      }
      const checked = await this.statusFill.check({
        ...command.statusCheck(order),
        order,
        portfolioId: command.portfolioId,
        accountBindingId: command.accountBindingId,
        deadlineAt: command.deadlineAt,
      })
      if (!checked.ok) return checked
      recovered.push(checked.value.value.order)
      evidence.push(...checked.value.postCommitEvidence)
      reconciliationRequired ||= checked.value.value.reconciliationRequired
    }

    const run = loaded.value.value.run
    const progress: ExecutionProgressEvidence = Object.freeze({
      portfolioId: command.portfolioId,
      executionRunId: run.executionRunId,
      totalOrders: recovered.length,
      plannedOrders: recovered.filter((order) => order.state === 'PLANNED').length,
      inFlightOrders: recovered.filter((order) =>
        order.state === 'SUBMISSION_IN_FLIGHT'
        || order.state === 'ACKNOWLEDGED'
        || order.state === 'OPEN'
        || order.state === 'PARTIALLY_FILLED'
        || order.state === 'CANCEL_PENDING').length,
      filledOrders: recovered.filter((order) => order.state === 'FILLED').length,
      rejectedOrders: recovered.filter((order) => order.state === 'REJECTED').length,
      cancelledOrders: recovered.filter((order) => order.state === 'CANCELLED').length,
      unknownOrders: recovered.filter((order) => order.state === 'UNKNOWN').length,
      residualOrders: recovered.filter((order) => order.state === 'RESIDUAL').length,
      asOf: this.clock.now(),
    })
    return success(Object.freeze({
      value: Object.freeze({
        orders: Object.freeze(recovered),
        progress,
        reconciliationRequired,
      }),
      postCommitEvidence: Object.freeze(evidence),
    }))
  }

  private classifyInFlightUnknown(
    order: ExecutionOrderSnapshot,
  ): DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const currentResult = transaction.orders.getById(order.orderId)
      if (!currentResult.ok) return currentResult
      if (currentResult.value === undefined) {
        return failure(domainFailure('RECOVERY_PREFLIGHT_FAILED', {
          field: 'orderId',
          retryability: 'NEVER',
        }))
      }
      const current = currentResult.value
      if (current.state !== 'SUBMISSION_IN_FLIGHT') return success(current)
      const unknown = recordUnknown(current, current.stateVersion + 1)
      if (!unknown.ok) return unknown
      const saved = transaction.orders.save(unknown.value, current.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'RECOVERY_CLASSIFIED',
        portfolioId: current.portfolioId,
        executionRunId: current.executionRunId,
        orderId: current.orderId,
        classification: 'SUBMISSION_IN_FLIGHT_RECLASSIFIED_UNKNOWN',
        occurredAt: this.clock.now(),
      })])
      if (!staged.ok) return staged
      return success(unknown.value)
    })
  }

  private async queryUnknown(
    order: ExecutionOrderSnapshot,
    command: RecoverPortfolioCommand,
  ): Promise<DomainResult<CommittedExecutionResult<ExecutionOrderSnapshot>, AnyDomainFailure>> {
    if (order.brokerReference === undefined) {
      return success(Object.freeze({
        value: order,
        postCommitEvidence: Object.freeze([]),
      }))
    }
    const status = await this.broker.fetchOrderStatus({
      orderId: order.orderId,
      portfolioId: order.portfolioId,
      accountBindingId: command.accountBindingId,
      brokerOrderReferenceId: order.brokerReference.brokerOrderReferenceId,
      deadlineAt: command.deadlineAt,
    })
    if (!status.ok) return status
    void status
    return success(Object.freeze({
      value: order,
      postCommitEvidence: Object.freeze([]),
    }))
  }
}
