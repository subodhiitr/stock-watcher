import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  ActorId,
  CorrelationId,
  EvidenceId,
  IdempotencyKey,
  KillSwitchId,
  PortfolioId,
  ReconciliationSnapshotId,
} from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'

export type KillSwitchState = 'INACTIVE' | 'ACTIVE'

export type KillSwitchScopeGlobal = Readonly<{ kind: 'GLOBAL' }>
export type KillSwitchScopePortfolio = Readonly<{
  kind: 'PORTFOLIO'
  portfolioId: PortfolioId
}>
export type KillSwitchScope = KillSwitchScopeGlobal | KillSwitchScopePortfolio

export type KillSwitchActivation = Readonly<{
  reasonCode: string
  actorId: string
  evidenceId: EvidenceId
  activatedAt: Instant
  correlationId: CorrelationId
}>

export type KillSwitchReset = Readonly<{
  actorId: ActorId
  authorizationEvidenceId: EvidenceId
  mfaEvidenceId: EvidenceId
  reasonCode: string
  healthSnapshotHash: IntegrityHash
  reconciliationSnapshotIds: readonly ReconciliationSnapshotId[]
  resetAt: Instant
  idempotencyKey: IdempotencyKey
}>

export type KillSwitchTransition = Readonly<{
  from: KillSwitchState
  to: KillSwitchState
  at: Instant
  by: string
  reasonCode: string
}>

export type KillSwitchSnapshot = Readonly<{
  killSwitchId: KillSwitchId
  scope: KillSwitchScope
  state: KillSwitchState
  stateVersion: number
  activeActivation?: KillSwitchActivation
  history: readonly KillSwitchTransition[]
}>

export function isKillSwitchActive(snapshot: KillSwitchSnapshot): boolean {
  return snapshot.state === 'ACTIVE'
}

export function killSwitchAffectsPortfolio(
  snapshot: KillSwitchSnapshot,
  portfolioId: PortfolioId,
): boolean {
  if (snapshot.scope.kind === 'GLOBAL') return true
  return (
    snapshot.scope.kind === 'PORTFOLIO'
    && snapshot.scope.portfolioId === portfolioId
  )
}

// Validate activation fields (deterministic, no side effects)
function validateActivation(activation: KillSwitchActivation): DomainResult<void> {
  if (!activation.reasonCode || activation.reasonCode.trim() !== activation.reasonCode) {
    return failure(domainFailure('KILL_SWITCH_ACTIVATION_INVALID', {
      field: 'reasonCode',
      retryability: 'NEVER',
    }))
  }
  if (!activation.actorId) {
    return failure(domainFailure('KILL_SWITCH_ACTIVATION_INVALID', {
      field: 'actorId',
      retryability: 'NEVER',
    }))
  }
  return success(undefined)
}

// INACTIVE → ACTIVE (idempotent for equivalent active state)
export function activateKillSwitch(
  snapshot: KillSwitchSnapshot,
  activation: KillSwitchActivation,
  nextVersion: number,
): DomainResult<KillSwitchSnapshot> {
  const validation = validateActivation(activation)
  if (!validation.ok) return validation
  if (snapshot.state === 'ACTIVE') {
    // Idempotent: already active
    return success(snapshot)
  }
  const transition: KillSwitchTransition = Object.freeze({
    from: 'INACTIVE',
    to: 'ACTIVE',
    at: activation.activatedAt,
    by: activation.actorId,
    reasonCode: activation.reasonCode,
  })
  return success(Object.freeze({
    ...snapshot,
    state: 'ACTIVE' as KillSwitchState,
    stateVersion: nextVersion,
    activeActivation: activation,
    history: Object.freeze([...snapshot.history, transition]),
  }))
}

// ACTIVE → INACTIVE (privileged reset with MFA)
export function resetKillSwitch(
  snapshot: KillSwitchSnapshot,
  reset: KillSwitchReset,
  nextVersion: number,
): DomainResult<KillSwitchSnapshot> {
  if (snapshot.state !== 'ACTIVE') {
    return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
      field: 'state',
      retryability: 'NEVER',
    }))
  }
  if (!reset.authorizationEvidenceId) {
    return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
      field: 'authorizationEvidenceId',
      retryability: 'NEVER',
    }))
  }
  if (!reset.mfaEvidenceId) {
    return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
      field: 'mfaEvidenceId',
      retryability: 'NEVER',
    }))
  }
  if (!reset.reasonCode || reset.reasonCode.trim() !== reset.reasonCode) {
    return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
      field: 'reasonCode',
      retryability: 'NEVER',
    }))
  }
  if (reset.reconciliationSnapshotIds.length === 0) {
    return failure(domainFailure('KILL_SWITCH_RESET_BLOCKED', {
      field: 'reconciliationSnapshotIds',
      retryability: 'NEVER',
    }))
  }
  const transition: KillSwitchTransition = Object.freeze({
    from: 'ACTIVE',
    to: 'INACTIVE',
    at: reset.resetAt,
    by: reset.actorId,
    reasonCode: reset.reasonCode,
  })
  return success(Object.freeze({
    killSwitchId: snapshot.killSwitchId,
    scope: snapshot.scope,
    state: 'INACTIVE' as KillSwitchState,
    stateVersion: nextVersion,
    history: Object.freeze([...snapshot.history, transition]),
  }))
}

// Gate: require kill switch to be inactive
export function requiresKillSwitchInactive(
  snapshot: KillSwitchSnapshot,
): DomainResult<void> {
  if (isKillSwitchActive(snapshot)) {
    return failure(domainFailure('KILL_SWITCH_ACTIVE', {
      field: 'state',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// Containment: activate due to invariant failure / ambiguous submission / material mismatch
export function activateContainment(
  snapshot: KillSwitchSnapshot,
  activation: KillSwitchActivation,
  nextVersion: number,
): DomainResult<KillSwitchSnapshot> {
  // Containment is always applied — same as activation but with a containment reason code
  return activateKillSwitch(snapshot, activation, nextVersion)
}

// Reset is never an auto-resume: it only permits revalidation
export function resetAllowsAutoResume(): false {
  return false
}
