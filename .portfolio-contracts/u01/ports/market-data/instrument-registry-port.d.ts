import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { InstrumentId } from '../../domain/shared/identifiers.ts';
import type { MarketDataRecord } from '../../domain/market-data/market-data-record.ts';
export type InstrumentMetadata = Readonly<{
    instrumentId: InstrumentId;
    symbol: string;
    isin: string;
    brokerToken: string | null;
    sector: string;
    isBfsi: boolean;
    isActive: boolean;
    exchangeCode: string;
}>;
export interface InstrumentRegistryPort {
    getMetadata(params: {
        instrumentIds: readonly InstrumentId[];
        correlationId: string;
    }): Promise<DomainResult<readonly InstrumentMetadata[], AnyDomainFailure>>;
    validateBrokerMapping(params: {
        instrumentId: InstrumentId;
        broker: string;
        correlationId: string;
    }): Promise<DomainResult<boolean, AnyDomainFailure>>;
    fetchInstrumentRecord(params: {
        instrumentId: InstrumentId;
        correlationId: string;
    }): Promise<DomainResult<MarketDataRecord | null, AnyDomainFailure>>;
}
