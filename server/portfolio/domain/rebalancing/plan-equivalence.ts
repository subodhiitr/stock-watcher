import type { ActionBuckets } from './action-buckets.ts'
import {
  createPlanHash,
  deriveLogicalOrderKey,
} from '../shared/canonical-plan-hash.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type { InstrumentId, PortfolioId } from '../shared/identifiers.ts'

export type PlanEquivalence = Readonly<{
  equivalent: boolean
  sameInput: boolean
  samePlan: boolean
  sameLogicalOrders: boolean
}>

type ComparablePlan = Readonly<{
  planInputHash: IntegrityHash
  planHash: IntegrityHash
  actionBuckets: ActionBuckets
}>

type SupersedablePlan = Readonly<{
  state: 'DRAFT' | 'APPROVAL_READY' | 'SUPERSEDED' | 'INVALIDATED' | 'EXPIRED'
  planInputHash: IntegrityHash
  planHash: IntegrityHash
}>

export function logicalOrderKey(input: Readonly<{
  portfolioId: PortfolioId
  instrumentId: InstrumentId
  side: string
  semanticAction: unknown
}>): IntegrityHash {
  return deriveLogicalOrderKey(input)
}

export function planLogicalOrderKeys(
  buckets: ActionBuckets,
): readonly IntegrityHash[] {
  return Object.freeze([
    ...buckets.proposed.map((order) => order.logicalOrderKey),
    ...buckets.skipped.map((order) => order.logicalOrderKey),
    ...buckets.blocked.map((order) => order.logicalOrderKey),
  ].sort())
}

export function comparePlanEquivalence(
  left: ComparablePlan,
  right: ComparablePlan,
): PlanEquivalence {
  const sameInput = left.planInputHash === right.planInputHash
  const samePlan = left.planHash === right.planHash
  const leftKeys = planLogicalOrderKeys(left.actionBuckets)
  const rightKeys = planLogicalOrderKeys(right.actionBuckets)
  const sameLogicalOrders = leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index])
  return Object.freeze({
    equivalent: sameInput && samePlan && sameLogicalOrders,
    sameInput,
    samePlan,
    sameLogicalOrders,
  })
}

export function canSupersedePlan(
  prior: SupersedablePlan,
  next: Pick<SupersedablePlan, 'planInputHash' | 'planHash'>,
): boolean {
  return prior.state === 'APPROVAL_READY'
    && prior.planInputHash !== next.planInputHash
    && prior.planHash !== next.planHash
}

export function createSemanticPlanHash(input: Readonly<{
  portfolioId: PortfolioId
  planInputHash: IntegrityHash
  idealTarget: unknown
  executableTarget: unknown
  actionBuckets: ActionBuckets
  implementationShortfall: unknown
  turnoverBudget: unknown
  timing: unknown
  summary: unknown
}>): IntegrityHash {
  return createPlanHash({
    portfolioId: input.portfolioId,
    planInputHash: input.planInputHash,
    idealTarget: input.idealTarget,
    executableTarget: input.executableTarget,
    actionBuckets: input.actionBuckets,
    implementationShortfall: input.implementationShortfall,
    turnoverBudget: input.turnoverBudget,
    timing: input.timing,
    summary: input.summary,
  })
}
