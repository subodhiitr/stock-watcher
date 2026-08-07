import {
  approveBasket,
  approveSubset,
  rejectApproval,
  requiresApprovalReadyPlan,
  type ApprovalDecisionSnapshot,
  type DecisionKind,
} from '../../domain/execution/approval.ts'
import { hashExecutionValue } from '../../domain/execution/canonical-codec.ts'
import { isKillSwitchActive } from '../../domain/execution/kill-switch.ts'
import type { ApprovalBinding, ExecutionMode } from '../../domain/execution/contracts.ts'
import { checkPortfolioGate } from '../../domain/execution/execution-gate.ts'
import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type { ExecutionUnitOfWork, CommittedExecutionResult } from '../../ports/execution/execution-unit-of-work.ts'
import type {
  CurrentPlanState,
  ExecutionStatePort,
  ExecutionPolicyLineage,
} from '../../ports/execution/execution-state-port.ts'
import type { ExecutionClockPort } from '../../ports/execution/runtime-port.ts'

function approvalBoundsMatchPlanAndPolicy(
  binding: ApprovalBinding,
  proposedOrders: CurrentPlanState['plan']['actionBuckets']['proposed'],
  policy: ExecutionPolicyLineage['policySnapshot'],
  now: string,
): boolean {
  const nowMs = Date.parse(now)
  return binding.priceBoundsByOrder.every((bound) => {
    const proposed = proposedOrders.find(
      (order) => order.logicalOrderKey === bound.logicalOrderKey,
    )
    const staleAfterMs = Date.parse(bound.quoteStaleAfter)
    if (
      proposed === undefined
      || proposed.estimatedPrice === undefined
      || proposed.estimatedPrice.minorUnits !== bound.referencePrice.minorUnits
      || bound.referencePrice.minorUnits <= 0n
      || bound.maximumDeviation.numerator < 0n
      || bound.maximumDeviation.numerator * policy.maximumPriceDeviation.scale
        > policy.maximumPriceDeviation.numerator * bound.maximumDeviation.scale
      || !Number.isFinite(nowMs)
      || !Number.isFinite(staleAfterMs)
      || staleAfterMs <= nowMs
    ) {
      return false
    }
    const limitDeviation =
      bound.approvedLimitPrice.minorUnits >= bound.referencePrice.minorUnits
        ? bound.approvedLimitPrice.minorUnits - bound.referencePrice.minorUnits
        : bound.referencePrice.minorUnits - bound.approvedLimitPrice.minorUnits
    return limitDeviation * bound.maximumDeviation.scale
      <= bound.referencePrice.minorUnits * bound.maximumDeviation.numerator
  })
}

export type ApprovalDecisionCommand = Readonly<{
  pending: ApprovalDecisionSnapshot
  binding?: ApprovalBinding
  decisionKind: DecisionKind
  reasonCode?: string
  mandatoryLogicalOrderKeys: readonly IntegrityHash[]
  mode: ExecutionMode
  timeoutMs: number
}>

export class ApprovalService {
  private readonly state: ExecutionStatePort
  private readonly unitOfWork: ExecutionUnitOfWork
  private readonly clock: ExecutionClockPort

  constructor(
    state: ExecutionStatePort,
    unitOfWork: ExecutionUnitOfWork,
    clock: ExecutionClockPort,
  ) {
    this.state = state
    this.unitOfWork = unitOfWork
    this.clock = clock
  }

  async decide(
    command: ApprovalDecisionCommand,
  ): Promise<DomainResult<CommittedExecutionResult<ApprovalDecisionSnapshot>, AnyDomainFailure>> {
    const decisionHashResult = hashExecutionValue('approval-decision', {
      approvalId: command.pending.approvalId,
      portfolioId: command.pending.portfolioId,
      rebalanceRunId: command.pending.rebalanceRunId,
      decisionKind: command.decisionKind,
      binding: command.binding,
      reasonCode: command.reasonCode,
      decidedBy: command.pending.decidedBy,
      authorizationEvidenceId: command.pending.authorizationEvidenceId,
      mfaEvidenceId: command.pending.mfaEvidenceId,
      idempotencyKey: command.pending.idempotencyKey,
      decidedAt: command.pending.decidedAt,
    })
    if (!decisionHashResult.ok) return decisionHashResult
    const replay = this.unitOfWork.execute((transaction) =>
      transaction.approvals.getById(command.pending.approvalId))
    if (!replay.ok) return replay
    if (replay.value.value !== undefined) {
      if (
        replay.value.value.idempotencyKey !== command.pending.idempotencyKey
        || replay.value.value.decisionHash !== decisionHashResult.value
      ) {
        return failure(domainFailure('APPROVAL_IDEMPOTENCY_CONFLICT', {
          field: 'idempotencyKey',
          retryability: 'NEVER',
        }))
      }
      return {
        ok: true,
        value: Object.freeze({
          value: replay.value.value,
          postCommitEvidence: replay.value.postCommitEvidence,
        }),
      }
    }
    const planResult = await this.state.loadCurrentPlan({
      portfolioId: command.pending.portfolioId,
      timeoutMs: command.timeoutMs,
    })
    if (!planResult.ok) return planResult
    const currentPlan = planResult.value
    if (currentPlan === undefined) {
      return failure(domainFailure('PLAN_NOT_APPROVAL_READY', {
        field: 'plan',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }
    const ready = requiresApprovalReadyPlan(currentPlan.plan.state)
    if (!ready.ok) return ready
    if (
      currentPlan.plan.portfolioId !== command.pending.portfolioId
      || currentPlan.plan.rebalanceRunId !== command.pending.rebalanceRunId
      || currentPlan.plan.planHash !== currentPlan.verifiedPlanHash
    ) {
      return failure(domainFailure('PLAN_HASH_BINDING_FAILED', {
        field: 'planHash',
        retryability: 'NEVER',
      }))
    }

    const accountingResult = await this.state.loadPortfolioAccounting({
      portfolioId: command.pending.portfolioId,
      timeoutMs: command.timeoutMs,
    })
    if (!accountingResult.ok) return accountingResult
    const portfolioGate = checkPortfolioGate(accountingResult.value.snapshot.status)
    if (!portfolioGate.ok) return portfolioGate

    const policyResult = await this.state.loadPolicyLineage({
      strategyVersionId: currentPlan.plan.context.strategyVersionId,
      effectiveAt: this.clock.now(),
      timeoutMs: command.timeoutMs,
    })
    if (!policyResult.ok) return policyResult
    const lineageResult = await this.state.loadAggregateLineage({
      portfolioId: command.pending.portfolioId,
      killSwitchScope: Object.freeze({
        kind: 'PORTFOLIO',
        portfolioId: command.pending.portfolioId,
      }),
      timeoutMs: command.timeoutMs,
    })
    if (!lineageResult.ok) return lineageResult
    if (
      lineageResult.value.activeRun !== undefined
      || lineageResult.value.killSwitch !== undefined
        && isKillSwitchActive(lineageResult.value.killSwitch)
    ) {
      return failure(domainFailure(
        lineageResult.value.activeRun === undefined
          ? 'KILL_SWITCH_ACTIVE'
          : 'DUPLICATE_EXECUTION_RUN',
        { field: 'aggregateLineage', retryability: 'AFTER_STATE_REFRESH' },
      ))
    }
    const corporateActionsResult = await this.state.loadCorporateActionEvidence({
      portfolioId: command.pending.portfolioId,
      executionDate: command.binding?.executionDate ?? currentPlan.plan.asOf,
      timeoutMs: command.timeoutMs,
    })
    if (!corporateActionsResult.ok) return corporateActionsResult
    if (
      corporateActionsResult.value.pendingActions.length > 0
      || corporateActionsResult.value.processedSincePlan.length > 0
    ) {
      return failure(domainFailure('APPROVAL_STALE', {
        field: 'corporateActions',
        retryability: 'AFTER_STATE_REFRESH',
      }))
    }

    const proposedKeys = currentPlan.plan.actionBuckets.proposed.map((order) => order.logicalOrderKey)
    let decided: DomainResult<ApprovalDecisionSnapshot>
    if (command.decisionKind === 'REJECT') {
      if (command.reasonCode === undefined) {
        return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
          field: 'reasonCode',
          retryability: 'NEVER',
        }))
      }
      decided = rejectApproval(
        command.pending,
        command.reasonCode,
        decisionHashResult.value,
        command.pending.stateVersion + 1,
      )
    } else {
      const binding = command.binding
      const policy = policyResult.value.policySnapshot
      if (
        binding === undefined
        || binding.planHash !== currentPlan.verifiedPlanHash
        || binding.planInputHash !== currentPlan.plan.planInputHash
        || binding.strategyVersionId !== currentPlan.plan.context.strategyVersionId
        || binding.strategyConfigHash !== policyResult.value.strategyConfigHash
        || binding.portfolioStateVersion !== accountingResult.value.stateVersion
        || lineageResult.value.latestReconciliation?.externalSnapshotId
          !== binding.reconciliationSnapshotId
        || this.clock.now() >= binding.expiresAt
        || !approvalBoundsMatchPlanAndPolicy(
          binding,
          currentPlan.plan.actionBuckets.proposed,
          policy,
          this.clock.now(),
        )
      ) {
        return failure(domainFailure('APPROVAL_BINDING_INCOMPLETE', {
          field: 'binding',
          retryability: 'NEVER',
        }))
      }
      decided = command.decisionKind === 'APPROVE_BASKET'
        ? approveBasket(
          command.pending,
          binding,
          proposedKeys,
          decisionHashResult.value,
          command.pending.stateVersion + 1,
        )
        : approveSubset(
          command.pending,
          binding,
          proposedKeys,
          command.mandatoryLogicalOrderKeys,
          decisionHashResult.value,
          command.pending.stateVersion + 1,
        )
    }
    if (!decided.ok) return decided

    const decision = decided.value
    return this.unitOfWork.execute((transaction) => {
      const existing = transaction.approvals.getById(decision.approvalId)
      if (!existing.ok) return existing
      if (existing.value !== undefined) {
        if (
          existing.value.idempotencyKey === decision.idempotencyKey
          && existing.value.decisionHash === decision.decisionHash
        ) return { ok: true, value: existing.value }
        return failure(domainFailure('APPROVAL_IDEMPOTENCY_CONFLICT', {
          field: 'idempotencyKey',
          retryability: 'NEVER',
        }))
      }
      const portfolioCurrent = transaction.portfolioState.assertCurrent(
        decision.portfolioId,
        accountingResult.value.stateVersion,
        'ACTIVE',
      )
      if (!portfolioCurrent.ok) return portfolioCurrent
      const globalKill = transaction.killSwitches.findByScope({ kind: 'GLOBAL' })
      if (!globalKill.ok) return globalKill
      const portfolioKill = transaction.killSwitches.findByScope({
        kind: 'PORTFOLIO',
        portfolioId: decision.portfolioId,
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
      const inserted = transaction.approvals.insert(decision)
      if (!inserted.ok) return inserted
      const staged = transaction.stageEvidence([Object.freeze({
        kind: 'APPROVAL_DECIDED',
        portfolioId: decision.portfolioId,
        approvalId: decision.approvalId,
        state: decision.state,
        mode: command.mode,
        planHashPrefix: currentPlan.verifiedPlanHash.slice(0, 12),
        stateVersion: decision.stateVersion,
        occurredAt: decision.decidedAt,
      })])
      if (!staged.ok) return staged
      return { ok: true, value: decision }
    })
  }
}
