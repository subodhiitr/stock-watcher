import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { DataVersionSnapshot } from '../../domain/market-data/data-version-snapshot.ts'

export type ResearchLabelled<T> = Readonly<{
  value: T
  researchModeOnly: true
  label: 'RESEARCH_MODE_ONLY'
}>

export class ResearchModeGate {
  checkProductionAllowed(
    snapshot: DataVersionSnapshot,
    currentInstant: string,
  ): DomainResult<void> {
    if (!snapshot.isProductionQuality) {
      return failure(domainFailure('NON_PRODUCTION_DATA_FOR_PRODUCTION_EVAL', {
        field: 'snapshot.isProductionQuality',
      }))
    }
    // Check staleness of all contributing sources
    for (const check of snapshot.completenessChecks) {
      if (!check.passed) {
        return failure(domainFailure('DATA_STALE', { field: check.dataType }))
      }
    }
    return success(undefined)
  }

  wrapResult<T>(result: T, _mode: 'production' | 'research'): ResearchLabelled<T> {
    return Object.freeze({
      value: result,
      researchModeOnly: true as const,
      label: 'RESEARCH_MODE_ONLY' as const,
    })
  }
}
