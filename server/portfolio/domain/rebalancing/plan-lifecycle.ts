import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { RebalanceRunId } from '../shared/identifiers.ts'
import type { Instant, LocalDate } from '../shared/time.ts'
import type { PlanLifecycleState, RebalancePlan } from './rebalance-plan.ts'

export type PlanLifecycleTransition = Readonly<{
  from: PlanLifecycleState
  to: PlanLifecycleState
  changedAt: Instant
}>

export type PlanLifecycle = Readonly<{
  rebalanceRunId: RebalanceRunId
  state: PlanLifecycleState
  history: readonly PlanLifecycleTransition[]
}>

const ALLOWED_TRANSITIONS: Readonly<Record<PlanLifecycleState, readonly PlanLifecycleState[]>> =
  Object.freeze({
    DRAFT: Object.freeze<PlanLifecycleState[]>(['APPROVAL_READY']),
    APPROVAL_READY: Object.freeze<PlanLifecycleState[]>([
      'SUPERSEDED',
      'INVALIDATED',
      'EXPIRED',
    ]),
    SUPERSEDED: Object.freeze<PlanLifecycleState[]>([]),
    INVALIDATED: Object.freeze<PlanLifecycleState[]>([]),
    EXPIRED: Object.freeze<PlanLifecycleState[]>([]),
  })

export function createDraftPlanLifecycle(
  rebalanceRunId: RebalanceRunId,
): PlanLifecycle {
  return Object.freeze({
    rebalanceRunId,
    state: 'DRAFT',
    history: Object.freeze([]),
  })
}

export function transitionPlanLifecycle(
  lifecycle: PlanLifecycle,
  to: PlanLifecycleState,
  changedAt: Instant,
): DomainResult<PlanLifecycle> {
  if (!ALLOWED_TRANSITIONS[lifecycle.state].includes(to)) {
    return failure(domainFailure('PLAN_STATE_UNSUPPORTED', {
      field: 'state',
      context: { from: lifecycle.state, to },
    }))
  }
  const transition = Object.freeze({ from: lifecycle.state, to, changedAt })
  return success(Object.freeze({
    rebalanceRunId: lifecycle.rebalanceRunId,
    state: to,
    history: Object.freeze([...lifecycle.history, transition]),
  }))
}

export function revalidatePlanLifecycle(input: Readonly<{
  plan: RebalancePlan
  checkedAt: Instant
  checkedOn: LocalDate
  lineageCurrent: boolean
  supersededByNonEquivalentPlan: boolean
}>): DomainResult<RebalancePlan> {
  if (input.plan.state !== 'APPROVAL_READY') {
    return failure(domainFailure('PLAN_HISTORY_MUTATION', { field: 'state' }))
  }
  let state: PlanLifecycleState = 'APPROVAL_READY'
  if (!input.lineageCurrent) {
    state = 'INVALIDATED'
  } else if (input.supersededByNonEquivalentPlan) {
    state = 'SUPERSEDED'
  } else if (input.checkedOn > input.plan.timing.eligibleExecutionDate) {
    state = 'EXPIRED'
  }
  if (state === 'APPROVAL_READY') return success(input.plan)
  return success(Object.freeze({ ...input.plan, state }))
}
