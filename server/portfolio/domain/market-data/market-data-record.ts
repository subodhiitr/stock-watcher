import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { DataRecordId } from '../shared/identifiers.ts'
import { isProductionQualitySource, type DataProvider, type DataValidationStatus } from './data-provenance.ts'

export type MarketDataType =
  | 'EOD_PRICE'
  | 'FUNDAMENTALS'
  | 'INDEX_MEMBERSHIP'
  | 'INSTRUMENT_DETAILS'
  | 'EXCHANGE_CALENDAR'
  | 'LIVE_QUOTE'
  | 'CORPORATE_ACTION_SCHEDULE'

export type MarketDataRecord = Readonly<{
  recordId: DataRecordId
  instrumentId: string
  dataType: MarketDataType
  effectiveDate: string
  fetchedAt: string
  marketTimestamp: string
  source: DataProvider
  version: string
  validationStatus: DataValidationStatus
  isProductionQuality: boolean
  staleAfterInstant: string
  payload: Readonly<Record<string, unknown>>
}>

const VALID_DATA_TYPES: MarketDataType[] = [
  'EOD_PRICE', 'FUNDAMENTALS', 'INDEX_MEMBERSHIP', 'INSTRUMENT_DETAILS',
  'EXCHANGE_CALENDAR', 'LIVE_QUOTE', 'CORPORATE_ACTION_SCHEDULE',
]

export function createMarketDataRecord(input: unknown): DomainResult<MarketDataRecord> {
  if (typeof input !== 'object' || input === null) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'record' }))
  }
  const r = input as Record<string, unknown>
  for (const field of ['recordId', 'instrumentId', 'effectiveDate', 'fetchedAt', 'marketTimestamp', 'version', 'staleAfterInstant']) {
    if (typeof r[field] !== 'string' || (r[field] as string).length === 0) {
      return failure(domainFailure('INVALID_DATA_RECORD', { field }))
    }
  }
  if (!VALID_DATA_TYPES.includes(r['dataType'] as MarketDataType)) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'dataType' }))
  }
  if (typeof r['source'] !== 'string') {
    return failure(domainFailure('MISSING_DATA_PROVENANCE', { field: 'source' }))
  }
  if (typeof r['payload'] !== 'object' || r['payload'] === null) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'payload' }))
  }
  const source = r['source'] as DataProvider
  return success(Object.freeze({
    recordId: r['recordId'] as DataRecordId,
    instrumentId: r['instrumentId'] as string,
    dataType: r['dataType'] as MarketDataType,
    effectiveDate: r['effectiveDate'] as string,
    fetchedAt: r['fetchedAt'] as string,
    marketTimestamp: r['marketTimestamp'] as string,
    source,
    version: r['version'] as string,
    validationStatus: (r['validationStatus'] ?? 'VALID') as DataValidationStatus,
    isProductionQuality: isProductionQualitySource(source),
    staleAfterInstant: r['staleAfterInstant'] as string,
    payload: Object.freeze(r['payload'] as Record<string, unknown>),
  }))
}
