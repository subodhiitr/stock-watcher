import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { DataVersionId } from '../../domain/shared/identifiers.ts';
import type { DataVersionSnapshot } from '../../domain/market-data/data-version-snapshot.ts';
export interface MarketDataSnapshotRepository {
    save(snapshot: DataVersionSnapshot): DomainResult<void, AnyDomainFailure>;
    getById(dataVersionId: DataVersionId): DomainResult<DataVersionSnapshot | undefined, AnyDomainFailure>;
}
