import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { InstrumentId } from '../../domain/shared/identifiers.ts';
import type { MarketDataRecord } from '../../domain/market-data/market-data-record.ts';
export interface IndexMembershipPort {
    fetchHistoricalMembership(params: {
        indexId: string;
        asOfDate: string;
        correlationId: string;
    }): Promise<DomainResult<readonly InstrumentId[], AnyDomainFailure>>;
    fetchMembershipRecord(params: {
        instrumentId: InstrumentId;
        indexId: string;
        asOfDate: string;
    }): Promise<DomainResult<MarketDataRecord | null, AnyDomainFailure>>;
}
