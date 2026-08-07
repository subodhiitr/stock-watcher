import { createHash } from 'node:crypto'
import { AI_ADVISORY_CONSTANTS, AI_PERMITTED_OPERATIONS } from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { EventId } from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'

export type AiPermittedOperation = (typeof AI_PERMITTED_OPERATIONS)[number]

export type AiAdvisoryInputContent = Readonly<{
  structuredData: Readonly<Record<string, unknown>>
  textContext?: string
}>

export type AiAdvisoryRequest = Readonly<{
  requestId: EventId
  operation: AiPermittedOperation
  inputContent: AiAdvisoryInputContent
  correlationId: string
}>

export type AiAdvisoryResult = Readonly<{
  requestId: EventId
  operation: AiPermittedOperation
  advisoryText: string
  producedAt: Instant
  requestHash: string
  // Structural compile-time constraints (AI-002, AI-003)
  canInfluenceState: false
  canDetermineOrderQuantity: false
  canAlterParameters: false
}>

const PROHIBITED_INPUT_KEYS = new Set([
  'portfolio', 'orders', 'credentials', 'accountId', 'brokerId',
  'pii', 'email', 'phone', 'password', 'token', 'secret',
])

export function createAiAdvisoryRequest(params: {
  requestId: EventId
  operation: string
  inputContent: AiAdvisoryInputContent
  correlationId: string
}): DomainResult<AiAdvisoryRequest> {
  const { requestId, operation, inputContent, correlationId } = params

  // Validate operation in permitted set (AI-001)
  if (!(AI_PERMITTED_OPERATIONS as readonly string[]).includes(operation)) {
    return failure(domainFailure('PROHIBITED_AI_OPERATION', { field: 'operation', context: { operation: String(operation).slice(0, 40) } }))
  }

  // Validate input content excludes prohibited fields (AI-007)
  for (const key of Object.keys(inputContent.structuredData)) {
    if (PROHIBITED_INPUT_KEYS.has(key.toLowerCase())) {
      return failure(domainFailure('PROHIBITED_AI_OPERATION', { field: 'inputContent', context: { field: key } }))
    }
  }

  return success(Object.freeze({
    requestId,
    operation: operation as AiPermittedOperation,
    inputContent: Object.freeze(inputContent),
    correlationId,
  }))
}

export function createAiAdvisoryResult(
  request: AiAdvisoryRequest,
  rawText: string,
  producedAt: Instant,
): DomainResult<AiAdvisoryResult> {
  if (typeof rawText !== 'string') {
    return failure(domainFailure('PROHIBITED_AI_OPERATION', { field: 'advisoryText' }))
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ requestId: request.requestId, operation: request.operation }), 'utf8')
    .digest('hex')

  return success(Object.freeze({
    requestId: request.requestId,
    operation: request.operation,
    advisoryText: rawText,
    producedAt,
    requestHash,
    canInfluenceState: AI_ADVISORY_CONSTANTS.canInfluenceState,
    canDetermineOrderQuantity: AI_ADVISORY_CONSTANTS.canDetermineOrderQuantity,
    canAlterParameters: AI_ADVISORY_CONSTANTS.canAlterParameters,
  }))
}
