import { type DomainResult } from '../errors/result.ts';
import type { ActorId, CorrelationId, EvidenceId, StrategyVersionEventId, StrategyVersionId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
import type { StrategyConfig, StrategyConfigHash } from './strategy-config.ts';
import type { StrategyDomainEvent, StrategyVersionCreated, StrategyVersionSubmittedForActivation, StrategyVersionWithdrawn } from './strategy-events.ts';
export type StrategyVersionStatus = 'DRAFT' | 'ACTIVATION_PENDING' | 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN';
export type EvidenceType = 'BACKTEST' | 'WALK_FORWARD' | 'OUT_OF_SAMPLE' | 'SHADOW_OPERATION';
export type EvidenceReference = Readonly<{
    evidenceId: EvidenceId;
    evidenceType: EvidenceType;
    passed: boolean;
}>;
export type StrategyVersion = Readonly<{
    strategyVersionId: StrategyVersionId;
    strategyId: string;
    versionLabel: string;
    status: StrategyVersionStatus;
    config: StrategyConfig;
    configHash: StrategyConfigHash;
    isPreset: boolean;
    evidenceRefs: readonly EvidenceReference[];
    createdBy: ActorId;
    createdAt: Instant;
    effectiveFrom: Instant | null;
    approvedAt: Instant | null;
    approvedBy: ActorId | null;
    supersededAt: Instant | null;
    supersededByVersionId: StrategyVersionId | null;
    withdrawnAt: Instant | null;
    withdrawnBy: ActorId | null;
    withdrawalReason: string | null;
}>;
export declare function createVersion(params: {
    strategyVersionId: StrategyVersionId;
    strategyId: string;
    versionLabel: string;
    config: StrategyConfig;
    configHash: StrategyConfigHash;
    createdBy: ActorId;
    createdAt: Instant;
    isPreset: boolean;
    eventId: StrategyVersionEventId;
    correlationId: CorrelationId;
}): DomainResult<{
    version: StrategyVersion;
    event: StrategyVersionCreated;
}>;
export declare function submitForActivation(version: StrategyVersion, params: {
    evidenceRefs: readonly EvidenceReference[];
    submittedBy: ActorId;
    submittedAt: Instant;
    eventId: StrategyVersionEventId;
    correlationId: CorrelationId;
}): DomainResult<{
    version: StrategyVersion;
    event: StrategyVersionSubmittedForActivation;
}>;
export declare function activate(version: StrategyVersion, previousActive: StrategyVersion | undefined, params: {
    approvedBy: ActorId;
    approvedAt: Instant;
    effectiveFrom: Instant;
    eventId: StrategyVersionEventId;
    supersededEventId: StrategyVersionEventId;
    correlationId: CorrelationId;
}): DomainResult<{
    activated: StrategyVersion;
    superseded: StrategyVersion | undefined;
    events: readonly StrategyDomainEvent[];
}>;
export declare function withdrawVersion(version: StrategyVersion, params: {
    withdrawnBy: ActorId;
    withdrawnAt: Instant;
    withdrawalReason: string;
    eventId: StrategyVersionEventId;
    correlationId: CorrelationId;
}): DomainResult<{
    version: StrategyVersion;
    event: StrategyVersionWithdrawn;
}>;
