import { type DomainResult } from '../errors/result.ts';
export type DataProvider = 'NSE_OFFICIAL' | 'YAHOO_RESEARCH' | 'LICENSED_EOD' | 'BROKER_API' | 'EXCHANGE_FILING';
export type DataValidationStatus = 'VALID' | 'STALE' | 'INCOMPLETE' | 'ANOMALY_DETECTED' | 'FAILED_VALIDATION';
export type DataProvenance = Readonly<{
    source: DataProvider;
    fetchedAt: string;
    marketTimestamp: string;
    effectiveDate: string;
    version: string;
    validationStatus: DataValidationStatus;
}>;
export declare const PRODUCTION_QUALITY_SOURCES: ReadonlyArray<DataProvider>;
export declare function isProductionQualitySource(source: DataProvider): boolean;
export declare function createDataProvenance(input: unknown): DomainResult<DataProvenance>;
