import type { AnyDomainFailure } from "../../domain/errors/result.ts";
import { type DomainResult } from "../../domain/errors/result.ts";
import type { InstrumentId } from "../../domain/shared/identifiers.ts";
import { type CorporateAction, type CorporateActionImpact } from "../../domain/strategy/corporate-action.ts";
import type { CorporateActionPort } from "../../ports/market-data/corporate-action-port.ts";
import type { ClockPort } from "../../ports/index.ts";
export type CorporateActionProcessingResult = Readonly<{
    action: CorporateAction;
    impact: CorporateActionImpact | null;
    requiresManualReview: boolean;
}>;
export declare class CorporateActionProcessor {
    private readonly corporateActionPort;
    private readonly clock;
    constructor(corporateActionPort: CorporateActionPort, clock: ClockPort);
    processActionsForDate(params: {
        instruments: readonly InstrumentId[];
        effectiveDate: string;
    }): Promise<DomainResult<readonly CorporateActionProcessingResult[], AnyDomainFailure>>;
}
