import type { AnyDomainFailure, DomainResult } from '../../domain/errors/result.ts';
import type { AiAdvisoryRequest, AiAdvisoryResult } from '../../domain/strategy/ai-advisory.ts';
export interface AiAdvisoryPort {
    request(params: {
        advisory: AiAdvisoryRequest;
        timeoutMs?: number;
    }): Promise<DomainResult<AiAdvisoryResult, AnyDomainFailure>>;
}
