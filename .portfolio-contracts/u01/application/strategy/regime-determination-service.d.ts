import { type DomainResult } from '../../domain/errors/result.ts';
import type { DataVersionId } from '../../domain/shared/identifiers.ts';
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts';
import { type RegimeCategory, type RegimeState } from '../../domain/strategy/regime-state.ts';
import type { MarketDataPort } from '../../ports/market-data/market-data-port.ts';
import type { ClockPort } from '../../ports/index.ts';
export declare class RegimeDeterminationService {
    private readonly marketDataPort;
    private readonly clock;
    constructor(marketDataPort: MarketDataPort, clock: ClockPort);
    determineRegime(params: {
        config: StrategyConfig;
        dataVersionId: DataVersionId;
        asOf: string;
        previousRegime?: RegimeCategory;
        previousConfirmationCount?: number;
    }): DomainResult<RegimeState>;
}
