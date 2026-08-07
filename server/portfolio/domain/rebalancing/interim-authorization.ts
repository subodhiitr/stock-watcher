import type {
  ActionIntentMarker,
  InterimAuthorization,
  PlanningIntent,
} from '../construction/planning-context.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { U04_MAX_SAFE_SOURCE_IDS } from '../shared/rebalancing-constants.ts'
import {
  buildSafeReasonBundle,
  type SafeReasonBundle,
} from '../shared/safe-observability-payload-builder.ts'
import type { Instant } from '../shared/time.ts'

export type InterimAuthorizationDecision = Readonly<{
  authorized: boolean
  permittedIntents: readonly ActionIntentMarker[]
  reasonBundle?: SafeReasonBundle
}>

const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function denied(code: 'INTERIM_NOT_AUTHORIZED'): DomainResult<InterimAuthorizationDecision> {
  const reason = buildSafeReasonBundle({
    primaryCode: code,
    explanationKey: 'PREREQUISITE_BLOCK',
  })
  return reason.ok
    ? success(Object.freeze({
      authorized: false,
      permittedIntents: Object.freeze([]),
      reasonBundle: reason.value,
    }))
    : reason
}

function validateProof(
  authorization: InterimAuthorization,
  createdAt: Instant,
): boolean {
  return (
    authorization.sourceIds.length > 0
    && authorization.sourceIds.length <= U04_MAX_SAFE_SOURCE_IDS
    && authorization.sourceIds.every((id) =>
      SOURCE_ID_PATTERN.test(id) && !id.toUpperCase().includes('AI'))
    && authorization.verifiedAt <= createdAt
    && authorization.advisoryEvidenceExcluded === true
  )
}

export function authorizeInterimPlanning(input: Readonly<{
  planningIntent: PlanningIntent
  authorization?: InterimAuthorization
  actionIntents: readonly ActionIntentMarker[]
  createdAt: Instant
}>): DomainResult<InterimAuthorizationDecision> {
  if (input.planningIntent === 'ROUTINE') {
    if (input.authorization !== undefined) {
      return failure(domainFailure('INTERIM_REASON_AMBIGUOUS', { field: 'authorization' }))
    }
    return success(Object.freeze({
      authorized: true,
      permittedIntents: Object.freeze([...input.actionIntents]),
    }))
  }
  if (input.authorization === undefined) return denied('INTERIM_NOT_AUTHORIZED')
  if (!validateProof(input.authorization, input.createdAt)) {
    return failure(domainFailure('INTERIM_PROOF_MISSING', { field: 'authorization' }))
  }

  const reductionOnly = input.actionIntents.every((intent) =>
    intent.intent === 'SELL' || intent.intent === 'REDUCE' || intent.intent === 'HOLD')
  const mandatoryOnly = input.actionIntents.every((intent) =>
    intent.intent === 'HOLD' || (
      intent.mandatory
      && (intent.intent === 'SELL' || intent.intent === 'REDUCE')
    ))
  if (
    input.authorization.reasonFamily === 'CONFIRMED_REGIME_EXPOSURE_REDUCTION'
    && (!input.authorization.exposureDeltaOnly || !reductionOnly)
  ) {
    return failure(domainFailure('REGIME_REDUCTION_SCOPE_INVALID', { field: 'actionIntents' }))
  }
  if (
    input.authorization.reasonFamily !== 'CONFIRMED_REGIME_EXPOSURE_REDUCTION'
    && !mandatoryOnly
  ) {
    return failure(domainFailure(
      input.authorization.reasonFamily === 'VERIFIED_CORPORATE_ACTION'
        ? 'CORPORATE_ACTION_SCOPE_EXCEEDED'
        : 'INTERIM_BUY_FORBIDDEN',
      { field: 'actionIntents' },
    ))
  }
  return success(Object.freeze({
    authorized: true,
    permittedIntents: Object.freeze([...input.actionIntents]),
  }))
}
