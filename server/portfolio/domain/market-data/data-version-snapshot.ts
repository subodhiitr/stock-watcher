import { DATA_COMPLETENESS_THRESHOLD_PCT } from '../strategy/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { DataVersionId } from '../shared/identifiers.ts'
import { isProductionQualitySource } from './data-provenance.ts'
import type { MarketDataRecord, MarketDataType } from './market-data-record.ts'

export type CompletenessCheck = Readonly<{
  dataType: MarketDataType
  requiredCount: number
  presentCount: number
  completenessPercent: number
  passed: boolean
}>

export type DataVersionSnapshot = Readonly<{
  dataVersionId: DataVersionId
  asOf: string
  createdAt: string
  recordCount: number
  sources: readonly string[]
  completenessChecks: readonly CompletenessCheck[]
  isProductionQuality: boolean
}>

export function createDataVersionSnapshot(params: {
  dataVersionId: DataVersionId
  asOf: string
  createdAt: string
  records: readonly MarketDataRecord[]
  requiredTypes: readonly MarketDataType[]
}): DomainResult<DataVersionSnapshot> {
  const { dataVersionId, asOf, createdAt, records, requiredTypes } = params

  const completenessChecks: CompletenessCheck[] = []
  for (const dataType of requiredTypes) {
    const typeRecords = records.filter(r => r.dataType === dataType)
    const required = typeRecords.length
    const present = typeRecords.filter(r => r.validationStatus !== 'FAILED_VALIDATION' && r.validationStatus !== 'INCOMPLETE').length
    const completenessPercent = required === 0 ? 0 : Math.round((present / required) * 100)
    const passed = required > 0 && completenessPercent >= DATA_COMPLETENESS_THRESHOLD_PCT
    completenessChecks.push(Object.freeze({ dataType, requiredCount: required, presentCount: present, completenessPercent, passed }))
  }

  const failedCheck = completenessChecks.find(c => !c.passed)
  if (failedCheck) {
    return failure(domainFailure('INVALID_SNAPSHOT_COMPLETENESS', {
      field: failedCheck.dataType,
      context: { completenessPercent: failedCheck.completenessPercent, threshold: DATA_COMPLETENESS_THRESHOLD_PCT },
    }))
  }

  const sources = [...new Set(records.map(r => r.source))]
  const isProductionQuality = sources.every(s => isProductionQualitySource(s as Parameters<typeof isProductionQualitySource>[0]))

  return success(Object.freeze({
    dataVersionId,
    asOf,
    createdAt,
    recordCount: records.length,
    sources: Object.freeze(sources),
    completenessChecks: Object.freeze(completenessChecks),
    isProductionQuality,
  }))
}
