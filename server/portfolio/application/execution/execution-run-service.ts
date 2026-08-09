import { consumeApproval, verifyApprovalBinding } from '../../domain/execution/approval.ts'
import { isKillSwitchActive } from '../../domain/execution/kill-switch.ts'
import { isReconciliationMatched } from '../../domain/execution/reconciliation.ts'
import type { ExecutionMode } from '../../domain/execution/contracts.ts'
import type { ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts'
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import type {
  ApprovalId,
  ExecutionPolicySnapshotId,
  PortfolioId,
  ReconciliationRunId,
} from '../../domain/shared/identifiers.ts'
import type {
  CommittedExecutionResult,
  ExecutionUnitOfWork,
} from '../../ports/execution/execution-unit-of-work.ts'
import type { ExecutionStatePort } from '../../ports/execution/execution-state-port.ts'
import type {
  ExecutionClockPort,
  ExecutionIdentifierFactory,
} from '../../ports/execution/runtime-port.ts'

export type CreateExecutionRunCommand = Readonly<{
  portfolioId: PortfolioId
  approvalId: ApprovalId
  mode: ExecutionMode
  preExecutionReconciliationId: ReconciliationRunId
  policySnapshotId: ExecutionPolicySnapshotId
  timeoutMs: number
}>

export type CreatedExecutionRun = Readonly<{
  run: ExecutionRunSnapshot
  orders: readonly ExecutionOrderSnapshot[]
}>

export class ExecutionRunService {
  private readonly state: ExecutionStatePort
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly clock: ExecutionClockPort
  private readonly ids: ExecutionIdentifierFactory

  constructor(
    state: ExecutionStatePort,
    unitOfWork: ExecutionUnitOfWork,
    clock: ExecutionClockPort,
    ids: ExecutionIdentifierFactory,
  ) {
    this.state = state
    this.unitOfWork = unitOfWork
    this.clock = clock
    this.ids = ids
  }

  async createRun(
    command: CreateExecutionRunCommand,
  ): Promise<DomainResult<CommittedExecutionResult<CreatedExecutionRun>, AnyDomainFailure>> {
    const replay = this.unitOfWork.execute((transaction) => {
      const runResult = transaction.runs.findByApprovalId(command.approvalId)
      if (!runResult.ok) return runResult
      if (runResult.value === undefined) return { ok: true, value: undefined }
      if (runResult.value.portfolioId !== command.portfolioId) {
        return failure(domainFailure('EXECUTION_PORTFOLIO_MISMATCH', {
          field: 'approvalId',
          retryability: 'NEVER',
        }))
      }
      const ordersResult = transaction.orders.listByRun(
        runResult.value.executionRunId,
      )
      if (!ordersResult.ok) return ordersResult
      return {
        ok: true,
        value: Object.freeze({
          run: runResult.value,
          orders: ordersResult.value,
        }),
      }
    })
    if (!replay.ok) return replay
    if (replay.value.value !== undefined) {
      return {
        ok: true,
        value: Object.freeze({
          value: replay.value.value,
          postCommitEvidence: replay.value.postCommitEvidence,
        }),
      }
    }
    const planResult = await this.state.loadCurrentPlan({
      portfolioId: command.portfolioId,
      timeoutMs: command.timeoutMs,
    })
    if (!planResult.ok) return planResult
    if (planResult.value === undefined || planResult.value.plan.state !== 'APPROVAL_READY') {
      return failure(domainFailure('PLAN_NOT_APPROVAL_READY', {
        field: 'plan',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const accountingResult = await this.state.loadPortfolioAccounting({
      portfolioId: command.portfolioId,
      timeoutMs: command.timeoutMs,
    })
    if (!accountingResult.ok) return accountingResult
    const planState = planResult.value
    const now = this.clock.now()
    const policyResult = await this.state.loadPolicyLineage({
      strategyVersionId: planState.plan.context.strategyVersionId,
      effectiveAt: now,
      timeoutMs: command.timeoutMs,
    })
    if (!policyResult.ok) return policyResult

    return this.unitOfWork.execute((transaction) => {
      const replayResult = transaction.runs.findByApprovalId(command.approvalId)
      if (!replayResult.ok) return replayResult
      if (replayResult.value !== undefined) {
        if (replayResult.value.portfolioId !== command.portfolioId) {
          return failure(domainFailure('EXECUTION_PORTFOLIO_MISMATCH', {
            field: 'approvalId',
            retryability: 'NEVER',
          }))
        }
        const replayOrders = transaction.orders.listByRun(
          replayResult.value.executionRunId,
        )
        if (!replayOrders.ok) return replayOrders
        return {
          ok: true,
          value: Object.freeze({
            run: replayResult.value,
            orders: replayOrders.value,
          }),
        }
      }
      const approvalResult = transaction.approvals.getById(command.approvalId)
      if (!approvalResult.ok) return approvalResult
      const approval = approvalResult.value
      if (approval === undefined || approval.portfolioId !== command.portfolioId) {
        return failure(domainFailure('APPROVAL_STALE', {
          field: 'approvalId',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const verified = verifyApprovalBinding(
        approval,
        planState.verifiedPlanHash,
        accountingResult.value.stateVersion,
        now,
      )
      if (!verified.ok) return verified
      const binding = approval.binding
      if (
        binding === undefined
        || binding.planInputHash !== planState.plan.planInputHash
        || binding.strategyVersionId !== planState.plan.context.strategyVersionId
        || binding.strategyConfigHash !== policyResult.value.strategyConfigHash
        || policyResult.value.policySnapshot.policySnapshotId !== command.policySnapshotId
        || policyResult.value.policySnapshot.strategyVersionId !== binding.strategyVersionId
      ) {
        return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
          field: 'binding',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const portfolioCurrent = transaction.portfolioState.assertCurrent(
        command.portfolioId,
        binding.portfolioStateVersion,
        'ACTIVE',
      )
      if (!portfolioCurrent.ok) return portfolioCurrent
      const globalKill = transaction.killSwitches.findByScope({ kind: 'GLOBAL' })
      if (!globalKill.ok) return globalKill
      const portfolioKill = transaction.killSwitches.findByScope({
        kind: 'PORTFOLIO',
        portfolioId: command.portfolioId,
      })
      if (!portfolioKill.ok) return portfolioKill
      if (
        globalKill.value !== undefined && isKillSwitchActive(globalKill.value)
        || portfolioKill.value !== undefined && isKillSwitchActive(portfolioKill.value)
      ) {
        return failure(domainFailure('KILL_SWITCH_ACTIVE', {
          field: 'killSwitch',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const reconciliationResult = transaction.reconciliationRuns.getById(
        command.preExecutionReconciliationId,
      )
      if (!reconciliationResult.ok) return reconciliationResult
      const reconciliation = reconciliationResult.value
      if (
        reconciliation === undefined
        || reconciliation.portfolioId !== command.portfolioId
        || reconciliation.reason !== 'BEFORE_EXECUTION'
        || !isReconciliationMatched(reconciliation.state)
        || reconciliation.externalSnapshotId !== binding.reconciliationSnapshotId
        || reconciliation.completedAt === undefined
        || reconciliation.completedAt > now
      ) {
        return failure(domainFailure('RECONCILIATION_NOT_CURRENT', {
          field: 'preExecutionReconciliationId',
          retryability: 'AFTER_STATE_REFRESH',
        }))
      }
      const activeResult = transaction.runs.findActiveByPortfolio(command.portfolioId)
      if (!activeResult.ok) return activeResult
      if (activeResult.value !== undefined) {
        if (activeResult.value.approvalId !== command.approvalId) {
          return failure(domainFailure('DUPLICATE_EXECUTION_RUN', {
            field: 'portfolioId',
            retryability: 'NEVER',
          }))
        }
        const existingOrders = transaction.orders.listByRun(activeResult.value.executionRunId)
        if (!existingOrders.ok) return existingOrders
        return {
          ok: true,
          value: Object.freeze({ run: activeResult.value, orders: existingOrders.value }),
        }
      }

      const approvedKeys = new Set(approval.binding?.approvedLogicalOrderKeys ?? [])
      const approvedActions = planState.plan.actionBuckets.proposed
        .filter((action) => approvedKeys.has(action.logicalOrderKey))
        .sort((left, right) => {
          const leftSide = left.side === 'BUY' ? 1 : 0
          const rightSide = right.side === 'BUY' ? 1 : 0
          if (leftSide !== rightSide) return leftSide - rightSide
          return left.logicalOrderKey < right.logicalOrderKey
            ? -1
            : left.logicalOrderKey > right.logicalOrderKey ? 1 : 0
        })
      if (approvedActions.length !== approvedKeys.size) {
        return failure(domainFailure('NON_PROPOSED_ORDER_CONVERSION', {
          field: 'approvedLogicalOrderKeys',
          retryability: 'NEVER',
        }))
      }

      const executionRunId = this.ids.executionRunId()
      const orders: ExecutionOrderSnapshot[] = []
      for (const [index, action] of approvedActions.entries()) {
        const quantity = createQuantity(action.quantityShares)
        if (!quantity.ok) return quantity
        orders.push(Object.freeze({
          orderId: this.ids.orderId(),
          executionRunId,
          portfolioId: command.portfolioId,
          instrumentId: action.instrumentId,
          side: action.side === 'BUY' ? 'BUY' : 'SELL',
          product: 'CNC',
          logicalOrderKey: action.logicalOrderKey,
          idempotencyKey: this.ids.idempotencyKey(),
          sequence: index + 1,
          approvedQuantityCeiling: quantity.value,
          state: 'PLANNED',
          submissionAttempts: Object.freeze([]),
          fills: Object.freeze([]),
          filledQuantity: Object.freeze({ shares: 0n }),
          cancellations: Object.freeze([]),
          cancellationOutcomes: Object.freeze([]),
          stateVersion: 1,
        }))
      }
      const run: ExecutionRunSnapshot = Object.freeze({
        executionRunId,
        portfolioId: command.portfolioId,
        approvalId: approval.approvalId,
        rebalanceRunId: planState.plan.rebalanceRunId,
        planHash: planState.verifiedPlanHash,
        mode: command.mode,
        state: 'CREATED',
        preExecutionReconciliationId: command.preExecutionReconciliationId,
        phaseReconciliationIds: Object.freeze([]),
        policySnapshotId: command.policySnapshotId,
        portfolioStateVersion: binding.portfolioStateVersion,
        createdAt: now,
        updatedAt: now,
        stateVersion: 1,
      })
      const consumed = consumeApproval(
        approval,
        executionRunId,
        approval.stateVersion + 1,
      )
      if (!consumed.ok) return consumed
      const saved = transaction.approvals.save(consumed.value, approval.stateVersion)
      if (!saved.ok) return saved
      const runInserted = transaction.runs.insert(run)
      if (!runInserted.ok) return runInserted
      for (const order of orders) {
        const inserted = transaction.orders.insert(order)
        if (!inserted.ok) return inserted
      }
      const staged = transaction.stageEvidence([
        Object.freeze({
          kind: 'APPROVAL_DECIDED',
          portfolioId: command.portfolioId,
          approvalId: approval.approvalId,
          state: consumed.value.state,
          mode: command.mode,
          planHashPrefix: planState.verifiedPlanHash.slice(0, 12),
          stateVersion: consumed.value.stateVersion,
          occurredAt: now,
        }),
        Object.freeze({
          kind: 'EXECUTION_RUN_STATE_CHANGED',
          portfolioId: command.portfolioId,
          executionRunId,
          approvalId: approval.approvalId,
          previousState: 'CREATED',
          newState: 'CREATED',
          mode: command.mode,
          stateVersion: run.stateVersion,
          occurredAt: now,
        }),
        ...orders.map((order) => Object.freeze({
          kind: 'ORDER_STATE_CHANGED' as const,
          portfolioId: order.portfolioId,
          executionRunId: order.executionRunId,
          orderId: order.orderId,
          previousState: 'PLANNED' as const,
          newState: 'PLANNED' as const,
          stateVersion: order.stateVersion,
          occurredAt: now,
        })),
      ])
      if (!staged.ok) return staged
      return {
        ok: true,
        value: Object.freeze({ run, orders: Object.freeze(orders) }),
      }
    })
  }
}
