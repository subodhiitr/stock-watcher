import type { ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts'
import { isUnresolvableTerminalState } from '../../domain/execution/execution-order.ts'
import {
  isTerminalRunState,
  transitionRunState,
  type ExecutionRunSnapshot,
} from '../../domain/execution/execution-run.ts'
import type {
  ExecutionRunState,
} from '../../domain/execution/contracts.ts'
import {
  isReconciliationMatched,
  type ReconciliationRunSnapshot,
} from '../../domain/execution/reconciliation.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import {
  failure,
  success,
  type AnyDomainFailure,
  type DomainResult,
} from '../../domain/errors/result.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts'

export type AdvanceExecutionCommand = Readonly<{
  runId: ExecutionRunSnapshot['executionRunId']
  latestReconciliation?: ReconciliationRunSnapshot
}>

export class ExecutionCoordinator {
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly clock: ExecutionClockPort

  constructor(unitOfWork: ExecutionUnitOfWork, clock: ExecutionClockPort) {
    this.unitOfWork = unitOfWork
    this.clock = clock
  }

  advance(
    command: AdvanceExecutionCommand,
  ): DomainResult<CommittedExecutionResult<ExecutionRunSnapshot>, AnyDomainFailure> {
    return this.unitOfWork.execute((transaction) => {
      const runResult = transaction.runs.getById(command.runId)
      if (!runResult.ok) return runResult
      const run = runResult.value
      if (run === undefined) {
        return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
          field: 'executionRunId',
          retryability: 'NEVER',
        }))
      }
      if (isTerminalRunState(run.state)) return success(run)
      const ordersResult = transaction.orders.listByRun(run.executionRunId)
      if (!ordersResult.ok) return ordersResult
      let reconciliation: ReconciliationRunSnapshot | undefined
      if (command.latestReconciliation !== undefined) {
        const reconciliationResult = transaction.reconciliationRuns.getById(
          command.latestReconciliation.reconciliationRunId,
        )
        if (!reconciliationResult.ok) return reconciliationResult
        reconciliation = reconciliationResult.value
        if (reconciliation === undefined || reconciliation.portfolioId !== run.portfolioId) {
          return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
            field: 'reconciliationRunId',
            retryability: 'AFTER_STATE_REFRESH',
          }))
        }
      }
      const target = this.deriveTarget(
        run,
        ordersResult.value,
        reconciliation,
      )
      if (!target.ok) return target
      if (target.value === run.state) return success(run)
      const transitioned = transitionRunState(
        run,
        target.value,
        this.clock.now(),
        run.stateVersion + 1,
        (
          run.state === 'RECONCILING_SELLS'
          || run.state === 'RECONCILING_BUYS'
          || run.state === 'RECOVERY_REQUIRED'
        )
          ? reconciliation?.reconciliationRunId
          : undefined,
      )
      if (!transitioned.ok) return transitioned
      const saved = transaction.runs.save(transitioned.value, run.stateVersion)
      if (!saved.ok) return saved
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'EXECUTION_RUN_STATE_CHANGED',
        portfolioId: run.portfolioId,
        executionRunId: run.executionRunId,
        approvalId: run.approvalId,
        previousState: run.state,
        newState: transitioned.value.state,
        mode: run.mode,
        stateVersion: transitioned.value.stateVersion,
        occurredAt: transitioned.value.updatedAt,
      })])
      if (!staged.ok) return staged
      return success(transitioned.value)
    })
  }

  private deriveTarget(
    run: ExecutionRunSnapshot,
    orders: readonly ExecutionOrderSnapshot[],
    reconciliation: ReconciliationRunSnapshot | undefined,
  ): DomainResult<ExecutionRunState> {
    if (orders.some((order) =>
      order.portfolioId !== run.portfolioId
      || order.executionRunId !== run.executionRunId)) {
      return failure(domainFailure('EXECUTION_PORTFOLIO_MISMATCH', {
        field: 'orders',
        retryability: 'NEVER',
      }))
    }
    const hasAmbiguity = orders.some((order) =>
      order.state === 'UNKNOWN' || order.state === 'SUBMISSION_IN_FLIGHT')
    if (
      run.state !== 'RECOVERY_REQUIRED'
      && hasAmbiguity
    ) return success('RECOVERY_REQUIRED')
    if (
      orders.some((order) => order.state === 'CANCEL_PENDING')
    ) return success('CANCELLING')

    const sells = orders.filter((order) => order.side === 'SELL')
    const buys = orders.filter((order) => order.side === 'BUY')
    const sellsComplete = sells.every((order) => order.state === 'FILLED')
    const sellFailed = sells.some((order) =>
      order.state === 'REJECTED'
      || order.state === 'CANCELLED'
      || order.state === 'EXPIRED'
      || order.state === 'RESIDUAL')
    const buysComplete = buys.every((order) => isUnresolvableTerminalState(order.state))
    const hasResidual = orders.some((order) => order.state !== 'FILLED')
    const reconciliationMatched = reconciliation !== undefined
      && isReconciliationMatched(reconciliation.state)
    if (
      sellFailed
      && (run.state === 'BUYING' || run.state === 'RECONCILING_BUYS')
    ) return success('RECOVERY_REQUIRED')

    switch (run.state) {
      case 'CREATED':
        return success('VALIDATING')
      case 'VALIDATING':
        return orders.length === 0 ? success('COMPLETED') : success('READY')
      case 'READY':
        if (sellFailed) return success('RECOVERY_REQUIRED')
        return sells.length > 0 && !sellsComplete
          ? success('SELLING')
          : sells.length > 0 ? success('RECONCILING_SELLS')
          : buys.length > 0 ? success('BUYING')
          : success('COMPLETED')
      case 'SELLING':
        if (sellFailed) return success('RECOVERY_REQUIRED')
        return sellsComplete ? success('RECONCILING_SELLS') : success('SELLING')
      case 'RECONCILING_SELLS':
        if (sellFailed || !sellsComplete) return success('RECOVERY_REQUIRED')
        if (reconciliation === undefined) return success('RECONCILING_SELLS')
        {
          const valid = this.validateReconciliation(run, reconciliation, ['AFTER_SELLS'])
          if (!valid.ok) return valid
        }
        if (!isTerminalReconciliation(reconciliation)) return success('RECONCILING_SELLS')
        if (!reconciliationMatched) return success('RECOVERY_REQUIRED')
        if (buys.length > 0 && !buysComplete) return success('BUYING')
        return success(hasResidual ? 'COMPLETED_WITH_RESIDUAL' : 'COMPLETED')
      case 'BUYING':
        return buysComplete ? success('RECONCILING_BUYS') : success('BUYING')
      case 'RECONCILING_BUYS':
        if (reconciliation === undefined) return success('RECONCILING_BUYS')
        {
          const valid = this.validateReconciliation(run, reconciliation, ['AFTER_BUYS'])
          if (!valid.ok) return valid
        }
        if (!isTerminalReconciliation(reconciliation)) return success('RECONCILING_BUYS')
        if (!reconciliationMatched) return success('RECOVERY_REQUIRED')
        return success(hasResidual ? 'COMPLETED_WITH_RESIDUAL' : 'COMPLETED')
      case 'CANCELLING':
        if (!orders.every((order) => isUnresolvableTerminalState(order.state))) {
          return success('CANCELLING')
        }
        return success(hasResidual ? 'COMPLETED_WITH_RESIDUAL' : 'CANCELLED')
      case 'RECOVERY_REQUIRED':
        if (reconciliation === undefined) return success('RECOVERY_REQUIRED')
        {
          const valid = this.validateReconciliation(
            run,
            reconciliation,
            ['RESTART', 'MANUAL_SAFE'],
          )
          if (!valid.ok) return valid
        }
        if (!isTerminalReconciliation(reconciliation) || !reconciliationMatched) {
          return success('RECOVERY_REQUIRED')
        }
        if (orders.every((order) => isUnresolvableTerminalState(order.state))) {
          return success(hasResidual ? 'COMPLETED_WITH_RESIDUAL' : 'COMPLETED')
        }
        if (sells.some((order) => !isUnresolvableTerminalState(order.state))) {
          return success('RECONCILING_SELLS')
        }
        if (buys.some((order) => !isUnresolvableTerminalState(order.state))) {
          return success('RECONCILING_BUYS')
        }
        return success('COMPLETED_WITH_RESIDUAL')
      case 'BLOCKED':
      case 'COMPLETED':
      case 'COMPLETED_WITH_RESIDUAL':
      case 'CANCELLED':
        return success(run.state)
    }
  }

  private validateReconciliation(
    run: ExecutionRunSnapshot,
    reconciliation: ReconciliationRunSnapshot,
    allowedReasons: readonly ReconciliationRunSnapshot['reason'][],
  ): DomainResult<void> {
    const now = this.clock.now()
    if (
      reconciliation.portfolioId !== run.portfolioId
      || !allowedReasons.includes(reconciliation.reason)
      || reconciliation.reconciliationRunId === run.preExecutionReconciliationId
    ) {
      return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
        field: 'reconciliation',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    if (!isTerminalReconciliation(reconciliation)) return success(undefined)
    if (
      reconciliation.completedAt === undefined
      || reconciliation.externalSnapshotId === undefined
      || reconciliation.completedAt < run.updatedAt
      || reconciliation.completedAt > now
      || Date.parse(now) - Date.parse(reconciliation.completedAt) > 120_000
    ) {
      return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
        field: 'reconciliation',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    return success(undefined)
  }

}

function isTerminalReconciliation(snapshot: ReconciliationRunSnapshot): boolean {
  return snapshot.state === 'MATCHED'
    || snapshot.state === 'MATCHED_WITH_ROUNDING'
    || snapshot.state === 'MISMATCH'
    || snapshot.state === 'UNKNOWN'
    || snapshot.state === 'BLOCKED'
}
