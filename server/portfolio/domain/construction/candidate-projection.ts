import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  buildSafeReasonBundle,
  type SafeReasonBundle,
} from '../shared/safe-observability-payload-builder.ts'
import type { PlanningCandidate } from './planning-context.ts'

export type ProjectedCandidate = Readonly<{
  candidate: PlanningCandidate
  reasonBundle: SafeReasonBundle
}>

export type CandidateProjection = Readonly<{
  mandatoryExits: readonly ProjectedCandidate[]
  holdEligibleIncumbents: readonly ProjectedCandidate[]
  newEntrants: readonly ProjectedCandidate[]
  excludedCandidates: readonly ProjectedCandidate[]
  blockedCandidates: readonly ProjectedCandidate[]
}>

function projected(
  candidate: PlanningCandidate,
  reason: Parameters<typeof buildSafeReasonBundle>[0],
): DomainResult<ProjectedCandidate> {
  const bundle = buildSafeReasonBundle(reason)
  return bundle.ok
    ? success(Object.freeze({ candidate, reasonBundle: bundle.value }))
    : bundle
}

export function projectCandidates(
  candidates: readonly PlanningCandidate[],
): DomainResult<CandidateProjection> {
  const seen = new Set<string>()
  const mandatoryExits: ProjectedCandidate[] = []
  const holdEligibleIncumbents: ProjectedCandidate[] = []
  const newEntrants: ProjectedCandidate[] = []
  const excludedCandidates: ProjectedCandidate[] = []
  const blockedCandidates: ProjectedCandidate[] = []

  for (const candidate of candidates) {
    if (seen.has(candidate.instrumentId)) {
      return failure(domainFailure('CANDIDATE_LINEAGE_MISSING', { field: 'instrumentId' }))
    }
    seen.add(candidate.instrumentId)

    let target: ProjectedCandidate[]
    let reason: Parameters<typeof buildSafeReasonBundle>[0]
    const isMandatoryExit = candidate.currentHolding !== undefined && (
      candidate.hardRiskFlag
      || candidate.mandatoryEligibilityFailure
      || candidate.corporateActionBlocked
    )
    if (isMandatoryExit) {
      target = mandatoryExits
      reason = {
        primaryCode: 'MANDATORY_EXIT',
        explanationKey: 'MANDATORY_EXIT',
        constraintIds: ['AVAILABLE_DELIVERY'],
      }
    } else if (
      candidate.currentHolding !== undefined
      && (candidate.eligibilityStatus === 'ELIGIBLE'
        || candidate.eligibilityStatus === 'HOLD_ELIGIBLE'
        || candidate.eligibilityStatus === 'FORCED_REVIEW')
    ) {
      target = holdEligibleIncumbents
      reason = {
        primaryCode: 'TARGET_SELECTED',
        explanationKey: 'TARGET_SELECTED',
      }
    } else if (
      candidate.currentHolding === undefined
      && candidate.eligibilityStatus === 'ELIGIBLE'
      && (candidate.sectorId === undefined
        || candidate.groupId === undefined
        || candidate.marketCapBucket === undefined
        || candidate.liquidityCapacity.minorUnits <= 0n
        || candidate.realizedVolatility.numerator <= 0n)
    ) {
      target = blockedCandidates
      reason = {
        primaryCode: 'MISSING_CLASSIFICATION',
        explanationKey: 'PREREQUISITE_BLOCK',
      }
    } else if (
      candidate.currentHolding === undefined
      && candidate.eligibilityStatus === 'ELIGIBLE'
      && candidate.realizedVolatility.numerator > 0n
    ) {
      target = newEntrants
      reason = {
        primaryCode: 'TARGET_SELECTED',
        explanationKey: 'TARGET_SELECTED',
      }
    } else {
      target = excludedCandidates
      reason = {
        primaryCode: 'NO_TRADE_REQUIRED',
        explanationKey: 'POLICY_SKIP',
      }
    }
    const value = projected(candidate, reason)
    if (!value.ok) return value
    target.push(value.value)
  }

  return success(Object.freeze({
    mandatoryExits: Object.freeze(mandatoryExits),
    holdEligibleIncumbents: Object.freeze(holdEligibleIncumbents),
    newEntrants: Object.freeze(newEntrants),
    excludedCandidates: Object.freeze(excludedCandidates),
    blockedCandidates: Object.freeze(blockedCandidates),
  }))
}
