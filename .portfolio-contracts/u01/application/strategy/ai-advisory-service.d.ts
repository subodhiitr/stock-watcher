import type { AnyDomainFailure } from "../../domain/errors/result.ts";
import { type DomainResult } from "../../domain/errors/result.ts";
import { type AiAdvisoryResult } from "../../domain/strategy/ai-advisory.ts";
import type { AiAdvisoryPort } from "../../ports/strategy/ai-advisory-port.ts";
import type { ClockPort, IdentifierFactory } from "../../ports/index.ts";
export declare class AiAdvisoryService {
    private readonly aiAdvisoryPort;
    private readonly clock;
    private readonly identifiers;
    constructor(aiAdvisoryPort: AiAdvisoryPort, clock: ClockPort, identifiers: IdentifierFactory);
    request(params: {
        operation: string;
        structuredData: Readonly<Record<string, unknown>>;
        textContext?: string;
        correlationId: string;
        strategyVersionId?: string;
        timeoutMs?: number;
    }): Promise<DomainResult<AiAdvisoryResult, AnyDomainFailure>>;
}
