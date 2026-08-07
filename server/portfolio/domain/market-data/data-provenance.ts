import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type DataProvider =
  | 'NSE_OFFICIAL'
  | 'YAHOO_RESEARCH'
  | 'LICENSED_EOD'
  | 'BROKER_API'
  | 'EXCHANGE_FILING'

export type DataValidationStatus =
  | 'VALID'
  | 'STALE'
  | 'INCOMPLETE'
  | 'ANOMALY_DETECTED'
  | 'FAILED_VALIDATION'

export type DataProvenance = Readonly<{
  source: DataProvider
  fetchedAt: string
  marketTimestamp: string
  effectiveDate: string
  version: string
  validationStatus: DataValidationStatus
}>

export const PRODUCTION_QUALITY_SOURCES: ReadonlyArray<DataProvider> = Object.freeze([
  'LICENSED_EOD',
  'BROKER_API',
  'EXCHANGE_FILING',
])

export function isProductionQualitySource(source: DataProvider): boolean {
  return (PRODUCTION_QUALITY_SOURCES as readonly string[]).includes(source)
}

export function createDataProvenance(input: unknown): DomainResult<DataProvenance> {
  if (typeof input !== 'object' || input === null) {
    return failure(domainFailure('MISSING_DATA_PROVENANCE', { field: 'provenance' }))
  }
  const p = input as Record<string, unknown>
  const validSources: DataProvider[] = [
    'NSE_OFFICIAL', 'YAHOO_RESEARCH', 'LICENSED_EOD', 'BROKER_API', 'EXCHANGE_FILING',
  ]
  const validStatuses: DataValidationStatus[] = [
    'VALID', 'STALE', 'INCOMPLETE', 'ANOMALY_DETECTED', 'FAILED_VALIDATION',
  ]
  if (!validSources.includes(p['source'] as DataProvider)) {
    return failure(domainFailure('MISSING_DATA_PROVENANCE', { field: 'source' }))
  }
  for (const field of ['fetchedAt', 'marketTimestamp', 'effectiveDate', 'version']) {
    if (typeof p[field] !== 'string' || (p[field] as string).length === 0) {
      return failure(domainFailure('MISSING_DATA_PROVENANCE', { field }))
    }
  }
  if (!validStatuses.includes(p['validationStatus'] as DataValidationStatus)) {
    return failure(domainFailure('MISSING_DATA_PROVENANCE', { field: 'validationStatus' }))
  }
  return success(Object.freeze({
    source: p['source'] as DataProvider,
    fetchedAt: p['fetchedAt'] as string,
    marketTimestamp: p['marketTimestamp'] as string,
    effectiveDate: p['effectiveDate'] as string,
    version: p['version'] as string,
    validationStatus: p['validationStatus'] as DataValidationStatus,
  }))
}
