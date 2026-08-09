import { AI_PERMITTED_OPERATIONS } from './constants.ts';
import { type DomainResult } from '../errors/result.ts';
import type { EventId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
export type AiPermittedOperation = (typeof AI_PERMITTED_OPERATIONS)[number];
export type AiAdvisoryInputContent = Readonly<{
    structuredData: Readonly<Record<string, unknown>>;
    textContext?: string;
}>;
export type AiAdvisoryRequest = Readonly<{
    requestId: EventId;
    operation: AiPermittedOperation;
    inputContent: AiAdvisoryInputContent;
    correlationId: string;
}>;
export type AiAdvisoryResult = Readonly<{
    requestId: EventId;
    operation: AiPermittedOperation;
    advisoryText: string;
    producedAt: Instant;
    requestHash: string;
    canInfluenceState: false;
    canDetermineOrderQuantity: false;
    canAlterParameters: false;
}>;
export declare function createAiAdvisoryRequest(params: {
    requestId: EventId;
    operation: string;
    inputContent: AiAdvisoryInputContent;
    correlationId: string;
}): DomainResult<AiAdvisoryRequest>;
export declare function createAiAdvisoryResult(request: AiAdvisoryRequest, rawText: string, producedAt: Instant): DomainResult<AiAdvisoryResult>;
