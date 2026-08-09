import { success } from "../../../../server/portfolio/domain/errors/result.ts"
import type { MarketDataPort } from "../../../../server/portfolio/ports/market-data/market-data-port.ts"
import type { FundamentalsPort } from "../../../../server/portfolio/ports/market-data/fundamentals-port.ts"
import type { IndexMembershipPort } from "../../../../server/portfolio/ports/market-data/index-membership-port.ts"
import type { InstrumentRegistryPort } from "../../../../server/portfolio/ports/market-data/instrument-registry-port.ts"
import type { CorporateActionPort } from "../../../../server/portfolio/ports/market-data/corporate-action-port.ts"
import type { ExchangeCalendarPort } from "../../../../server/portfolio/ports/market-data/exchange-calendar-port.ts"
import type { MarketDataSnapshotRepository } from "../../../../server/portfolio/ports/market-data/snapshot-repository-port.ts"
import type { AiAdvisoryPort } from "../../../../server/portfolio/ports/strategy/ai-advisory-port.ts"
import type { DataVersionSnapshot } from "../../../../server/portfolio/domain/market-data/data-version-snapshot.ts"
import type { DataVersionId } from "../../../../server/portfolio/domain/shared/identifiers.ts"
import { createAiAdvisoryResult } from "../../../../server/portfolio/domain/strategy/ai-advisory.ts"
import type { Instant } from "../../../../server/portfolio/domain/shared/time.ts"

export class FakeMarketDataPort implements MarketDataPort {
  async fetchEodPrices(_params: {
    instrumentIds: readonly import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId[]
    startDate: string
    endDate: string
    adjusted: boolean
    correlationId: string
  }) {
    return success(Object.freeze([]) as readonly import("../../../../server/portfolio/domain/market-data/market-data-record.ts").MarketDataRecord[])
  }
}

export class FakeFundamentalsPort implements FundamentalsPort {
  async fetchFundamentals(_params: {
    instrumentIds: readonly import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId[]
    asOfPublicationDate: string
    correlationId: string
  }) {
    return success(Object.freeze([]) as readonly import("../../../../server/portfolio/domain/market-data/market-data-record.ts").MarketDataRecord[])
  }
}

export class FakeIndexMembershipPort implements IndexMembershipPort {
  async fetchHistoricalMembership(_params: {
    indexId: string
    asOfDate: string
    correlationId: string
  }) {
    return success(Object.freeze([]) as readonly import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId[])
  }

  async fetchMembershipRecord(_params: {
    instrumentId: import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId
    indexId: string
    asOfDate: string
  }) {
    return success(null as import("../../../../server/portfolio/domain/market-data/market-data-record.ts").MarketDataRecord | null)
  }
}

export class FakeInstrumentRegistryPort implements InstrumentRegistryPort {
  async getMetadata(_params: {
    instrumentIds: readonly import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId[]
    correlationId: string
  }) {
    return success(Object.freeze([]) as readonly import("../../../../server/portfolio/ports/market-data/instrument-registry-port.ts").InstrumentMetadata[])
  }

  async validateBrokerMapping(_params: {
    instrumentId: import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId
    broker: string
    correlationId: string
  }) {
    return success(true)
  }

  async fetchInstrumentRecord(_params: {
    instrumentId: import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId
    correlationId: string
  }) {
    return success(null as import("../../../../server/portfolio/domain/market-data/market-data-record.ts").MarketDataRecord | null)
  }
}

export class FakeCorporateActionPort implements CorporateActionPort {
  async fetchActionsForDate(_params: {
    instrumentIds: readonly import("../../../../server/portfolio/domain/shared/identifiers.ts").InstrumentId[]
    effectiveDate: string
    correlationId: string
  }) {
    return success(Object.freeze([]) as readonly import("../../../../server/portfolio/domain/strategy/corporate-action.ts").CorporateAction[])
  }
}

export class FakeExchangeCalendarPort implements ExchangeCalendarPort {
  async isTradingDay(_params: { date: string; correlationId: string }) {
    return success(true)
  }

  async nextTradingDay(_params: { afterDate: string; correlationId: string }) {
    return success("2024-01-16")
  }

  async previousTradingDay(_params: { beforeDate: string; correlationId: string }) {
    return success("2024-01-14")
  }

  async getSessionTiming(_params: { date: string; correlationId: string }) {
    return success({ openTime: "09:15", closeTime: "15:30" })
  }
}

export class FakeMarketDataSnapshotRepository implements MarketDataSnapshotRepository {
  private readonly store = new Map<string, DataVersionSnapshot>()

  save(snapshot: DataVersionSnapshot) {
    this.store.set(snapshot.dataVersionId as string, snapshot)
    return success(undefined)
  }

  getById(dataVersionId: DataVersionId) {
    return success(this.store.get(dataVersionId as string) ?? undefined)
  }
}

export class FakeAiAdvisoryPort implements AiAdvisoryPort {
  async request(params: {
    advisory: import("../../../../server/portfolio/domain/strategy/ai-advisory.ts").AiAdvisoryRequest
    timeoutMs?: number
  }) {
    const result = createAiAdvisoryResult(
      params.advisory,
      "Fake advisory text for testing.",
      new Date().toISOString() as Instant,
    )
    if (!result.ok) return result
    return success(result.value)
  }
}
