import type { DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type {
  PortfolioId,
  RebalanceRunId,
} from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'

export type HistoricalPlanState =
  | 'APPROVAL_READY'
  | 'SUPERSEDED'
  | 'INVALIDATED'
  | 'EXPIRED'

export type PlanHistoryFact = Readonly<{
  rebalanceRunId: RebalanceRunId
  portfolioId: PortfolioId
  planInputHash: IntegrityHash
  planHash: IntegrityHash
  logicalOrderKeys: readonly IntegrityHash[]
  state: HistoricalPlanState
  stateChangedAt: Instant
}>

export interface PlanHistoryPort {
  findByInputHash(input: Readonly<{
    portfolioId: PortfolioId
    planInputHash: IntegrityHash
    timeoutMs: number
  }>): Promise<DomainResult<PlanHistoryFact | undefined>>

  findCurrentApprovalReady(input: Readonly<{
    portfolioId: PortfolioId
    timeoutMs: number
  }>): Promise<DomainResult<PlanHistoryFact | undefined>>
}
