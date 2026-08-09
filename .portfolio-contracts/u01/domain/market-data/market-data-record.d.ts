import { type DomainResult } from '../errors/result.ts';
import type { DataRecordId } from '../shared/identifiers.ts';
import { type DataProvider, type DataValidationStatus } from './data-provenance.ts';
export type MarketDataType = 'EOD_PRICE' | 'FUNDAMENTALS' | 'INDEX_MEMBERSHIP' | 'INSTRUMENT_DETAILS' | 'EXCHANGE_CALENDAR' | 'LIVE_QUOTE' | 'CORPORATE_ACTION_SCHEDULE';
export type MarketDataRecord = Readonly<{
    recordId: DataRecordId;
    instrumentId: string;
    dataType: MarketDataType;
    effectiveDate: string;
    fetchedAt: string;
    marketTimestamp: string;
    source: DataProvider;
    version: string;
    validationStatus: DataValidationStatus;
    isProductionQuality: boolean;
    staleAfterInstant: string;
    payload: Readonly<Record<string, unknown>>;
}>;
export declare function createMarketDataRecord(input: unknown): DomainResult<MarketDataRecord>;
