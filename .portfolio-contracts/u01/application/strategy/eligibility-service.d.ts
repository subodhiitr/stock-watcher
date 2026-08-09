import { type DomainResult, type AnyDomainFailure } from '../../domain/errors/result.ts';
import type { StrategyVersionId } from '../../domain/shared/identifiers.ts';
import type { StrategyConfig } from '../../domain/strategy/strategy-config.ts';
import type { DataVersionSnapshot } from '../../domain/market-data/data-version-snapshot.ts';
import { type EligibilityResult } from '../../domain/strategy/eligibility-result.ts';
import type { ExchangeCalendarPort } from '../../ports/market-data/exchange-calendar-port.ts';
import type { FundamentalsPort } from '../../ports/market-data/fundamentals-port.ts';
import type { IndexMembershipPort } from '../../ports/market-data/index-membership-port.ts';
import type { InstrumentRegistryPort } from '../../ports/market-data/instrument-registry-port.ts';
import type { MarketDataPort } from '../../ports/market-data/market-data-port.ts';
import type { CorporateActionPort } from '../../ports/market-data/corporate-action-port.ts';
import type { ClockPort } from '../../ports/index.ts';
export declare class EligibilityService {
    private readonly indexMembershipPort;
    private readonly instrumentRegistryPort;
    private readonly marketDataPort;
    private readonly fundamentalsPort;
    private readonly corporateActionPort;
    private readonly calendarPort;
    private readonly clock;
    constructor(indexMembershipPort: IndexMembershipPort, instrumentRegistryPort: InstrumentRegistryPort, marketDataPort: MarketDataPort, fundamentalsPort: FundamentalsPort, corporateActionPort: CorporateActionPort, calendarPort: ExchangeCalendarPort, clock: ClockPort);
    evaluateUniverse(params: {
        strategyVersionId: StrategyVersionId;
        config: StrategyConfig;
        snapshot: DataVersionSnapshot;
        asOf: string;
        mode: 'production' | 'research';
    }): Promise<DomainResult<readonly EligibilityResult[], AnyDomainFailure>>;
}
