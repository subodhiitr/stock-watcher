import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { ActorId, CorrelationId, EvidenceId, StrategyVersionEventId, StrategyVersionId } from '../shared/identifiers.ts'
import type { Instant } from '../shared/time.ts'
import type { StrategyConfig, StrategyConfigHash } from './strategy-config.ts'
import type {
  StrategyDomainEvent,
  StrategyVersionActivated,
  StrategyVersionCreated,
  StrategyVersionSubmittedForActivation,
  StrategyVersionSuperseded,
  StrategyVersionWithdrawn,
} from './strategy-events.ts'

export type StrategyVersionStatus = 'DRAFT' | 'ACTIVATION_PENDING' | 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN'

export type EvidenceType = 'BACKTEST' | 'WALK_FORWARD' | 'OUT_OF_SAMPLE' | 'SHADOW_OPERATION'

export type EvidenceReference = Readonly<{
  evidenceId: EvidenceId
  evidenceType: EvidenceType
  passed: boolean
}>

export type StrategyVersion = Readonly<{
  strategyVersionId: StrategyVersionId
  strategyId: string
  versionLabel: string
  status: StrategyVersionStatus
  config: StrategyConfig
  configHash: StrategyConfigHash
  isPreset: boolean
  evidenceRefs: readonly EvidenceReference[]
  createdBy: ActorId
  createdAt: Instant
  effectiveFrom: Instant | null
  approvedAt: Instant | null
  approvedBy: ActorId | null
  supersededAt: Instant | null
  supersededByVersionId: StrategyVersionId | null
  withdrawnAt: Instant | null
  withdrawnBy: ActorId | null
  withdrawalReason: string | null
}>

const MANDATORY_EVIDENCE_TYPES: readonly EvidenceType[] = [
  'BACKTEST', 'WALK_FORWARD', 'OUT_OF_SAMPLE', 'SHADOW_OPERATION',
]

function makeEnvelope(
  strategyVersionId: StrategyVersionId,
  actorId: ActorId,
  occurredAt: Instant,
  correlationId: CorrelationId,
  eventId: StrategyVersionEventId,
) {
  return Object.freeze({ eventId, schemaVersion: 1 as const, strategyVersionId, actorId, occurredAt, correlationId })
}

export function createVersion(params: {
  strategyVersionId: StrategyVersionId
  strategyId: string
  versionLabel: string
  config: StrategyConfig
  configHash: StrategyConfigHash
  createdBy: ActorId
  createdAt: Instant
  isPreset: boolean
  eventId: StrategyVersionEventId
  correlationId: CorrelationId
}): DomainResult<{ version: StrategyVersion; event: StrategyVersionCreated }> {
  const { strategyVersionId, strategyId, versionLabel, config, configHash, createdBy, createdAt, isPreset, eventId, correlationId } = params
  if (typeof versionLabel !== 'string' || versionLabel.length === 0) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'versionLabel' }))
  }
  const version: StrategyVersion = Object.freeze({
    strategyVersionId, strategyId, versionLabel,
    status: 'DRAFT' as StrategyVersionStatus,
    config, configHash, isPreset,
    evidenceRefs: Object.freeze([]),
    createdBy, createdAt,
    effectiveFrom: null,
    approvedAt: null, approvedBy: null,
    supersededAt: null, supersededByVersionId: null,
    withdrawnAt: null, withdrawnBy: null, withdrawalReason: null,
  })
  const event: StrategyVersionCreated = Object.freeze({
    ...makeEnvelope(strategyVersionId, createdBy, createdAt, correlationId, eventId),
    type: 'StrategyVersionCreated' as const,
    payload: Object.freeze({ strategyId, versionLabel, configHash, createdBy, isPreset }),
  })
  return success({ version, event })
}

export function submitForActivation(
  version: StrategyVersion,
  params: {
    evidenceRefs: readonly EvidenceReference[]
    submittedBy: ActorId
    submittedAt: Instant
    eventId: StrategyVersionEventId
    correlationId: CorrelationId
  },
): DomainResult<{ version: StrategyVersion; event: StrategyVersionSubmittedForActivation }> {
  if (version.status !== 'DRAFT') {
    return failure(domainFailure('INVALID_STRATEGY_VERSION_TRANSITION', { field: 'status', context: { from: version.status, to: 'ACTIVATION_PENDING' } }))
  }
  if (params.evidenceRefs.length === 0) {
    return failure(domainFailure('MISSING_REQUIRED_EVIDENCE', { field: 'evidenceRefs' }))
  }
  const updated: StrategyVersion = Object.freeze({ ...version, status: 'ACTIVATION_PENDING' as StrategyVersionStatus, evidenceRefs: Object.freeze(params.evidenceRefs) })
  const event: StrategyVersionSubmittedForActivation = Object.freeze({
    ...makeEnvelope(version.strategyVersionId, params.submittedBy, params.submittedAt, params.correlationId, params.eventId),
    type: 'StrategyVersionSubmittedForActivation' as const,
    payload: Object.freeze({ evidenceRefs: params.evidenceRefs.map(e => e.evidenceId), submittedBy: params.submittedBy }),
  })
  return success({ version: updated, event })
}

export function activate(
  version: StrategyVersion,
  previousActive: StrategyVersion | undefined,
  params: {
    approvedBy: ActorId
    approvedAt: Instant
    effectiveFrom: Instant
    eventId: StrategyVersionEventId
    supersededEventId: StrategyVersionEventId
    correlationId: CorrelationId
  },
): DomainResult<{ activated: StrategyVersion; superseded: StrategyVersion | undefined; events: readonly StrategyDomainEvent[] }> {
  if (version.status !== 'ACTIVATION_PENDING') {
    return failure(domainFailure('INVALID_STRATEGY_VERSION_TRANSITION', { field: 'status', context: { from: version.status, to: 'ACTIVE' } }))
  }
  // Validate all 4 mandatory evidence types present and passed (SV-003)
  for (const req of MANDATORY_EVIDENCE_TYPES) {
    const ref = version.evidenceRefs.find(e => e.evidenceType === req)
    if (!ref) {
      return failure(domainFailure('MISSING_REQUIRED_EVIDENCE', { field: req }))
    }
    if (!ref.passed) {
      return failure(domainFailure('EVIDENCE_NOT_PASSED', { field: req }))
    }
  }
  // No AI evidence allowed (SV-011)
  const aiEvidence = version.evidenceRefs.find(e => (e.evidenceId as string).startsWith('ai-'))
  if (aiEvidence) {
    return failure(domainFailure('AI_EVIDENCE_FORBIDDEN', { field: 'evidenceRefs' }))
  }

  const activated: StrategyVersion = Object.freeze({
    ...version,
    status: 'ACTIVE' as StrategyVersionStatus,
    approvedAt: params.approvedAt,
    approvedBy: params.approvedBy,
    effectiveFrom: params.effectiveFrom,
  })
  const activationEvent: StrategyVersionActivated = Object.freeze({
    ...makeEnvelope(version.strategyVersionId, params.approvedBy, params.approvedAt, params.correlationId, params.eventId),
    type: 'StrategyVersionActivated' as const,
    payload: Object.freeze({
      configHash: version.configHash,
      evidenceRefs: version.evidenceRefs.map(e => e.evidenceId),
      approvedBy: params.approvedBy,
      activatedAt: params.approvedAt,
    }),
  })
  const events: StrategyDomainEvent[] = [activationEvent]

  let superseded: StrategyVersion | undefined
  if (previousActive) {
    superseded = Object.freeze({
      ...previousActive,
      status: 'SUPERSEDED' as StrategyVersionStatus,
      supersededAt: params.approvedAt,
      supersededByVersionId: version.strategyVersionId,
    })
    const supersededEvent: StrategyVersionSuperseded = Object.freeze({
      ...makeEnvelope(previousActive.strategyVersionId, params.approvedBy, params.approvedAt, params.correlationId, params.supersededEventId),
      type: 'StrategyVersionSuperseded' as const,
      payload: Object.freeze({ supersededByVersionId: version.strategyVersionId, supersededAt: params.approvedAt }),
    })
    events.push(supersededEvent)
  }

  return success({ activated, superseded, events: Object.freeze(events) })
}

export function withdrawVersion(
  version: StrategyVersion,
  params: {
    withdrawnBy: ActorId
    withdrawnAt: Instant
    withdrawalReason: string
    eventId: StrategyVersionEventId
    correlationId: CorrelationId
  },
): DomainResult<{ version: StrategyVersion; event: StrategyVersionWithdrawn }> {
  if (version.status === 'WITHDRAWN') {
    return failure(domainFailure('INVALID_STRATEGY_VERSION_TRANSITION', { field: 'status', context: { from: version.status, to: 'WITHDRAWN' } }))
  }
  if (version.status === 'SUPERSEDED') {
    return failure(domainFailure('INVALID_STRATEGY_VERSION_TRANSITION', { field: 'status' }))
  }
  if (typeof params.withdrawalReason !== 'string' || params.withdrawalReason.trim().length === 0) {
    return failure(domainFailure('INVALID_STRATEGY_CONFIG', { field: 'withdrawalReason' }))
  }
  const updated: StrategyVersion = Object.freeze({
    ...version,
    status: 'WITHDRAWN' as StrategyVersionStatus,
    withdrawnAt: params.withdrawnAt,
    withdrawnBy: params.withdrawnBy,
    withdrawalReason: params.withdrawalReason,
  })
  const event: StrategyVersionWithdrawn = Object.freeze({
    ...makeEnvelope(version.strategyVersionId, params.withdrawnBy, params.withdrawnAt, params.correlationId, params.eventId),
    type: 'StrategyVersionWithdrawn' as const,
    payload: Object.freeze({ withdrawalReason: params.withdrawalReason, withdrawnBy: params.withdrawnBy }),
  })
  return success({ version: updated, event })
}
