import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts'
import type { InstrumentId } from '../../domain/shared/identifiers.ts'
import type { MarketDataRecord } from '../../domain/market-data/market-data-record.ts'

export interface FundamentalsPort {
  fetchFundamentals(params: {
    instrumentIds: readonly InstrumentId[]
    asOfPublicationDate: string
    correlationId: string
  }): Promise<DomainResult<readonly MarketDataRecord[], AnyDomainFailure>>
}
