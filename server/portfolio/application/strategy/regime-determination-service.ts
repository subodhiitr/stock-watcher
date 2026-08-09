import { domainFailure } from '../../domain/errors/failure.ts'
import { failure, success, type DomainResult } from '../../domain/errors/result.ts'
import type { DataVersionId } from '../../domain/shared/identifiers.ts'
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts'
import { createRegimeState, type RegimeCategory, type RegimeState } from '../../domain/strategy/regime-state.ts'
import type { MarketDataPort } from '../../ports/market-data/market-data-port.ts'
import type { ClockPort } from '../../ports/index.ts'

export class RegimeDeterminationService {
  private readonly marketDataPort: MarketDataPort
  private readonly clock: ClockPort

  constructor(marketDataPort: MarketDataPort, clock: ClockPort) {
    this.marketDataPort = marketDataPort
    this.clock = clock
  }

  determineRegime(params: {
    config: StrategyConfig
    dataVersionId: DataVersionId
    asOf: string
    previousRegime?: RegimeCategory
    previousConfirmationCount?: number
  }): DomainResult<RegimeState> {
    const { config, dataVersionId, asOf, previousRegime, previousConfirmationCount } = params
    const evaluatedAt = this.clock.now()

    const baseParams = {
      indicators: {
        nifty50AboveDMA200: null,
        nifty500AboveDMA200: null,
        breadthAbove200DMA_pct: null,
        breadthAbove100DMA_pct: null,
        benchmarkVolatility20D: null,
        marketDrawdownFrom52W: null,
        creditStressProxy: null,
      },
      dataVersionId,
      asOf,
      evaluatedAt,
      crisisDrawdownPct: config.regime.crisisDrawdownPct,
      highVolatilityThreshold: config.regime.highVolatilityThreshold,
      confirmationPeriodsWeakening: config.regime.confirmationPeriodsWeakening,
      confirmationPeriodsStrengthening: config.regime.confirmationPeriodsStrengthening,
    }

    // exactOptionalPropertyTypes: only include optional fields if they have values
    const fullParams = previousRegime !== undefined && previousConfirmationCount !== undefined
      ? { ...baseParams, previousRegime, previousConfirmationCount }
      : previousRegime !== undefined
      ? { ...baseParams, previousRegime }
      : baseParams

    return createRegimeState(fullParams as Parameters<typeof createRegimeState>[0])
  }
}
