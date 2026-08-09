import { type DomainResult } from '../../domain/errors/result.ts';
import type { StrategyVersionId, DataVersionId } from '../../domain/shared/identifiers.ts';
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts';
import type { EligibilityResult } from '../../domain/strategy/eligibility-result.ts';
import { type SignalSnapshot } from '../../domain/strategy/signal-snapshot.ts';
import type { MarketDataPort } from '../../ports/market-data/market-data-port.ts';
import type { FundamentalsPort } from '../../ports/market-data/fundamentals-port.ts';
import type { AiAdvisoryPort } from '../../ports/strategy/ai-advisory-port.ts';
import type { ClockPort } from '../../ports/index.ts';
export declare class SignalScoringService {
    private readonly marketDataPort;
    private readonly fundamentalsPort;
    private readonly aiAdvisoryPort;
    private readonly clock;
    constructor(marketDataPort: MarketDataPort, fundamentalsPort: FundamentalsPort, aiAdvisoryPort?: AiAdvisoryPort, clock?: ClockPort);
    scoreUniverse(params: {
        eligibleInstruments: readonly EligibilityResult[];
        config: StrategyConfig;
        dataVersionId: DataVersionId;
        strategyVersionId: StrategyVersionId;
        asOf: string;
    }): DomainResult<readonly SignalSnapshot[]>;
}
