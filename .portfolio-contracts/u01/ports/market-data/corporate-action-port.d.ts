import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { InstrumentId } from '../../domain/shared/identifiers.ts';
import type { CorporateAction } from '../../domain/strategy/corporate-action.ts';
export interface CorporateActionPort {
    fetchActionsForDate(params: {
        instrumentIds: readonly InstrumentId[];
        effectiveDate: string;
        correlationId: string;
    }): Promise<DomainResult<readonly CorporateAction[], AnyDomainFailure>>;
}
