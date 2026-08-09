import { type DomainResult } from '../errors/result.ts';
import type { IntegrityHash } from '../portfolio/evidence.ts';
import type { ActorId, CorrelationId, EvidenceId, IdempotencyKey, KillSwitchId, PortfolioId, ReconciliationSnapshotId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
export type KillSwitchState = 'INACTIVE' | 'ACTIVE';
export type KillSwitchScopeGlobal = Readonly<{
    kind: 'GLOBAL';
}>;
export type KillSwitchScopePortfolio = Readonly<{
    kind: 'PORTFOLIO';
    portfolioId: PortfolioId;
}>;
export type KillSwitchScope = KillSwitchScopeGlobal | KillSwitchScopePortfolio;
export type KillSwitchActivation = Readonly<{
    reasonCode: string;
    actorId: string;
    evidenceId: EvidenceId;
    activatedAt: Instant;
    correlationId: CorrelationId;
}>;
export type KillSwitchReset = Readonly<{
    actorId: ActorId;
    authorizationEvidenceId: EvidenceId;
    mfaEvidenceId: EvidenceId;
    reasonCode: string;
    healthSnapshotHash: IntegrityHash;
    reconciliationSnapshotIds: readonly ReconciliationSnapshotId[];
    resetAt: Instant;
    idempotencyKey: IdempotencyKey;
}>;
export type KillSwitchTransition = Readonly<{
    from: KillSwitchState;
    to: KillSwitchState;
    at: Instant;
    by: string;
    reasonCode: string;
}>;
export type KillSwitchSnapshot = Readonly<{
    killSwitchId: KillSwitchId;
    scope: KillSwitchScope;
    state: KillSwitchState;
    stateVersion: number;
    activeActivation?: KillSwitchActivation;
    history: readonly KillSwitchTransition[];
}>;
export declare function isKillSwitchActive(snapshot: KillSwitchSnapshot): boolean;
export declare function killSwitchAffectsPortfolio(snapshot: KillSwitchSnapshot, portfolioId: PortfolioId): boolean;
export declare function activateKillSwitch(snapshot: KillSwitchSnapshot, activation: KillSwitchActivation, nextVersion: number): DomainResult<KillSwitchSnapshot>;
export declare function resetKillSwitch(snapshot: KillSwitchSnapshot, reset: KillSwitchReset, nextVersion: number): DomainResult<KillSwitchSnapshot>;
export declare function requiresKillSwitchInactive(snapshot: KillSwitchSnapshot): DomainResult<void>;
export declare function activateContainment(snapshot: KillSwitchSnapshot, activation: KillSwitchActivation, nextVersion: number): DomainResult<KillSwitchSnapshot>;
export declare function resetAllowsAutoResume(): false;
