import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type {
  ActorId,
  EvidenceId,
  PortfolioId,
  StrategyVersionId,
} from '../shared/identifiers.ts'
import {
  parseActorId,
  parseEvidenceId,
  parsePortfolioId,
  parseStrategyVersionId,
} from '../shared/identifiers.ts'
import { compareInstants, type Instant } from '../shared/time.ts'

declare const integrityHashBrand: unique symbol
export type IntegrityHash = string & { readonly [integrityHashBrand]: 'IntegrityHash' }

export type OperatingMode =
  | 'OBSERVE'
  | 'PAPER'
  | 'RECOMMENDATION'
  | 'APPROVAL_REQUIRED'
  | 'RESTRICTED_AUTO'
  | 'LIVE'

export const OPERATING_MODES: readonly OperatingMode[] = Object.freeze([
  'OBSERVE',
  'PAPER',
  'RECOMMENDATION',
  'APPROVAL_REQUIRED',
  'RESTRICTED_AUTO',
  'LIVE',
])

export type ModeEvidenceKind =
  | 'EXECUTION_AUTHORIZATION'
  | 'RESTRICTED_AUTOMATION'
  | 'LIVE_ACTIVATION'

export type ModeTransitionEvidence = Readonly<{
  evidenceId: EvidenceId
  portfolioId: PortfolioId
  targetMode: OperatingMode
  evidenceKind: ModeEvidenceKind
  issuerId: ActorId
  issuedAt: Instant
  expiresAt: Instant
  evidenceHash: IntegrityHash
}>

export type StrategyEligibilityEvidence = Readonly<{
  evidenceId: EvidenceId
  portfolioId: PortfolioId
  strategyVersionId: StrategyVersionId
  issuerId: ActorId
  issuedAt: Instant
  expiresAt: Instant
  evidenceHash: IntegrityHash
}>

export function parseIntegrityHash(value: unknown): DomainResult<IntegrityHash> {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    return failure(domainFailure('INVALID_MODE_EVIDENCE', { field: 'evidenceHash' }))
  }
  return success(value as IntegrityHash)
}

export function isOperatingMode(value: unknown): value is OperatingMode {
  return typeof value === 'string' && OPERATING_MODES.includes(value as OperatingMode)
}

export function createModeTransitionEvidence(
  input: ModeTransitionEvidence,
): DomainResult<ModeTransitionEvidence> {
  if (!isOperatingMode(input.targetMode)) {
    return failure(domainFailure('INVALID_OPERATING_MODE', { field: 'targetMode' }))
  }
  const hash = parseIntegrityHash(input.evidenceHash)
  if (!hash.ok) {
    return hash
  }
  if (
    !parseEvidenceId(input.evidenceId).ok
    || !parsePortfolioId(input.portfolioId).ok
    || !parseActorId(input.issuerId).ok
  ) {
    return failure(domainFailure('INVALID_MODE_EVIDENCE', { field: 'identifier' }))
  }
  if (compareInstants(input.issuedAt, input.expiresAt) >= 0) {
    return failure(domainFailure('INVALID_MODE_EVIDENCE', { field: 'expiresAt' }))
  }
  return success(Object.freeze({ ...input, evidenceHash: hash.value }))
}

export function createStrategyEligibilityEvidence(
  input: StrategyEligibilityEvidence,
): DomainResult<StrategyEligibilityEvidence> {
  const hash = parseIntegrityHash(input.evidenceHash)
  if (!hash.ok) {
    return failure(domainFailure('STRATEGY_EVIDENCE_REQUIRED', { field: 'evidenceHash' }))
  }
  if (
    !parseEvidenceId(input.evidenceId).ok
    || !parsePortfolioId(input.portfolioId).ok
    || !parseStrategyVersionId(input.strategyVersionId).ok
    || !parseActorId(input.issuerId).ok
  ) {
    return failure(domainFailure('STRATEGY_EVIDENCE_REQUIRED', { field: 'identifier' }))
  }
  if (compareInstants(input.issuedAt, input.expiresAt) >= 0) {
    return failure(domainFailure('STRATEGY_EVIDENCE_REQUIRED', { field: 'expiresAt' }))
  }
  return success(Object.freeze({ ...input, evidenceHash: hash.value }))
}

export function validateModeEvidence(
  evidence: readonly ModeTransitionEvidence[],
  portfolioId: PortfolioId,
  targetMode: OperatingMode,
  effectiveAt: Instant,
): DomainResult<readonly ModeTransitionEvidence[]> {
  const requiredKinds: readonly ModeEvidenceKind[] =
    targetMode === 'APPROVAL_REQUIRED'
      ? ['EXECUTION_AUTHORIZATION']
      : targetMode === 'RESTRICTED_AUTO'
        ? ['EXECUTION_AUTHORIZATION', 'RESTRICTED_AUTOMATION']
        : targetMode === 'LIVE'
          ? ['LIVE_ACTIVATION']
          : []

  for (const requiredKind of requiredKinds) {
    if (!evidence.some((item) => item.evidenceKind === requiredKind)) {
      const code =
        requiredKind === 'EXECUTION_AUTHORIZATION'
          ? 'EXECUTION_EVIDENCE_REQUIRED'
          : requiredKind === 'RESTRICTED_AUTOMATION'
            ? 'AUTOMATION_EVIDENCE_REQUIRED'
            : 'LIVE_EVIDENCE_REQUIRED'
      return failure(domainFailure(code, { field: 'evidence' }))
    }
  }

  const validatedEvidence: ModeTransitionEvidence[] = []
  for (const item of evidence) {
    const validated = createModeTransitionEvidence(item)
    if (!validated.ok) {
      return validated
    }
    if (
      item.portfolioId !== portfolioId
      || item.targetMode !== targetMode
      || compareInstants(item.issuedAt, effectiveAt) > 0
      || compareInstants(item.expiresAt, effectiveAt) <= 0
    ) {
      return failure(domainFailure('INVALID_MODE_EVIDENCE', {
        field: 'evidence',
        context: { evidenceId: item.evidenceId },
      }))
    }
    validatedEvidence.push(validated.value)
  }

  return success(Object.freeze(validatedEvidence))
}

export function validateStrategyEvidence(
  evidence: StrategyEligibilityEvidence,
  portfolioId: PortfolioId,
  strategyVersionId: StrategyVersionId,
  effectiveAt: Instant,
): DomainResult<StrategyEligibilityEvidence> {
  const validated = createStrategyEligibilityEvidence(evidence)
  if (!validated.ok) {
    return validated
  }
  if (
    evidence.portfolioId !== portfolioId
    || evidence.strategyVersionId !== strategyVersionId
    || compareInstants(evidence.issuedAt, effectiveAt) > 0
    || compareInstants(evidence.expiresAt, effectiveAt) <= 0
  ) {
    return failure(domainFailure('STRATEGY_EVIDENCE_REQUIRED', {
      field: 'evidenceReference',
      context: { evidenceId: evidence.evidenceId },
    }))
  }
  return success(validated.value)
}
