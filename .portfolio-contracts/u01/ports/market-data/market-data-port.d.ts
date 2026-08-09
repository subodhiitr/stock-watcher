import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { InstrumentId } from '../../domain/shared/identifiers.ts';
import type { MarketDataRecord } from '../../domain/market-data/market-data-record.ts';
export interface MarketDataPort {
    fetchEodPrices(params: {
        instrumentIds: readonly InstrumentId[];
        startDate: string;
        endDate: string;
        adjusted: boolean;
        correlationId: string;
    }): Promise<DomainResult<readonly MarketDataRecord[], AnyDomainFailure>>;
}
