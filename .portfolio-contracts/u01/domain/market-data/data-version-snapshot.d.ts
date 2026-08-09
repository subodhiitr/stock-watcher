import { type DomainResult } from '../errors/result.ts';
import type { DataVersionId } from '../shared/identifiers.ts';
import type { MarketDataRecord, MarketDataType } from './market-data-record.ts';
export type CompletenessCheck = Readonly<{
    dataType: MarketDataType;
    requiredCount: number;
    presentCount: number;
    completenessPercent: number;
    passed: boolean;
}>;
export type DataVersionSnapshot = Readonly<{
    dataVersionId: DataVersionId;
    asOf: string;
    createdAt: string;
    recordCount: number;
    sources: readonly string[];
    completenessChecks: readonly CompletenessCheck[];
    isProductionQuality: boolean;
}>;
export declare function createDataVersionSnapshot(params: {
    dataVersionId: DataVersionId;
    asOf: string;
    createdAt: string;
    records: readonly MarketDataRecord[];
    requiredTypes: readonly MarketDataType[];
}): DomainResult<DataVersionSnapshot>;
