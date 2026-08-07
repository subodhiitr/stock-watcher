import type { AnyDomainFailure } from "../../domain/errors/result.ts"
import { success, type DomainResult } from "../../domain/errors/result.ts"
import type { EventId, StrategyVersionEventId, StrategyVersionId, CorrelationId, ActorId } from "../../domain/shared/identifiers.ts"
import {
  createAiAdvisoryRequest,
  createAiAdvisoryResult,
  type AiAdvisoryResult,
} from "../../domain/strategy/ai-advisory.ts"
import type { AiAdvisoryPort } from "../../ports/strategy/ai-advisory-port.ts"
import type { ClockPort, IdentifierFactory } from "../../ports/index.ts"

export class AiAdvisoryService {
  private readonly aiAdvisoryPort: AiAdvisoryPort
  private readonly clock: ClockPort
  private readonly identifiers: IdentifierFactory

  constructor(aiAdvisoryPort: AiAdvisoryPort, clock: ClockPort, identifiers: IdentifierFactory) {
    this.aiAdvisoryPort = aiAdvisoryPort
    this.clock = clock
    this.identifiers = identifiers
  }

  async request(params: {
    operation: string
    structuredData: Readonly<Record<string, unknown>>
    textContext?: string
    correlationId: string
    strategyVersionId?: string
    timeoutMs?: number
  }): Promise<DomainResult<AiAdvisoryResult, AnyDomainFailure>> {
    const requestId = this.identifiers.eventId()

    const inputContent = params.textContext !== undefined
      ? Object.freeze({ structuredData: params.structuredData, textContext: params.textContext })
      : Object.freeze({ structuredData: params.structuredData })

    const requestResult = createAiAdvisoryRequest({
      requestId,
      operation: params.operation,
      inputContent,
      correlationId: params.correlationId,
    })
    if (!requestResult.ok) return requestResult

    const portResult = await this.aiAdvisoryPort.request({
      advisory: requestResult.value,
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
    })

    const producedAt = this.clock.now()

    if (!portResult.ok) {
      // Non-blocking degraded path (AI-008, DF-008)
      return createAiAdvisoryResult(
        requestResult.value,
        `[DEGRADED] Advisory unavailable: ${portResult.error.code}`,
        producedAt,
      )
    }

    return success(portResult.value)
  }
}
