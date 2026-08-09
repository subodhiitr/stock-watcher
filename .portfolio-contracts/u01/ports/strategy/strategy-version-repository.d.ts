import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { StrategyVersionId } from '../../domain/shared/identifiers.ts';
import type { StrategyVersion } from '../../domain/strategy/strategy-version.ts';
export interface StrategyVersionRepository {
    insert(version: StrategyVersion): DomainResult<void, AnyDomainFailure>;
    getById(strategyVersionId: StrategyVersionId): DomainResult<StrategyVersion | undefined, AnyDomainFailure>;
    getActiveByStrategyId(strategyId: string): DomainResult<StrategyVersion | undefined, AnyDomainFailure>;
    listByStrategyId(strategyId: string): DomainResult<readonly StrategyVersion[], AnyDomainFailure>;
    save(version: StrategyVersion): DomainResult<void, AnyDomainFailure>;
}
