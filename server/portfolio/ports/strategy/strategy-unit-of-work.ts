import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts'
import type { CommittedDomainResult } from '../index.ts'
import type { StrategyDomainEvent } from '../../domain/strategy/strategy-events.ts'
import type { StrategyVersion } from '../../domain/strategy/strategy-version.ts'

export interface StrategyVersionUnitOfWork {
  executeActivation(
    activated: StrategyVersion,
    previousActive: StrategyVersion | undefined,
    events: readonly StrategyDomainEvent[],
  ): DomainResult<CommittedDomainResult<StrategyVersion>, AnyDomainFailure>
}
