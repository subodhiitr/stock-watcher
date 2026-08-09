import { type DomainResult } from '../errors/result.ts';
import type { ActorId, EvidenceId, PortfolioId, StrategyVersionId } from '../shared/identifiers.ts';
import { type Instant } from '../shared/time.ts';
declare const integrityHashBrand: unique symbol;
export type IntegrityHash = string & {
    readonly [integrityHashBrand]: 'IntegrityHash';
};
export type OperatingMode = 'OBSERVE' | 'PAPER' | 'RECOMMENDATION' | 'APPROVAL_REQUIRED' | 'RESTRICTED_AUTO' | 'LIVE';
export declare const OPERATING_MODES: readonly OperatingMode[];
export type ModeEvidenceKind = 'EXECUTION_AUTHORIZATION' | 'RESTRICTED_AUTOMATION' | 'LIVE_ACTIVATION';
export type ModeTransitionEvidence = Readonly<{
    evidenceId: EvidenceId;
    portfolioId: PortfolioId;
    targetMode: OperatingMode;
    evidenceKind: ModeEvidenceKind;
    issuerId: ActorId;
    issuedAt: Instant;
    expiresAt: Instant;
    evidenceHash: IntegrityHash;
}>;
export type StrategyEligibilityEvidence = Readonly<{
    evidenceId: EvidenceId;
    portfolioId: PortfolioId;
    strategyVersionId: StrategyVersionId;
    issuerId: ActorId;
    issuedAt: Instant;
    expiresAt: Instant;
    evidenceHash: IntegrityHash;
}>;
export declare function parseIntegrityHash(value: unknown): DomainResult<IntegrityHash>;
export declare function isOperatingMode(value: unknown): value is OperatingMode;
export declare function createModeTransitionEvidence(input: ModeTransitionEvidence): DomainResult<ModeTransitionEvidence>;
export declare function createStrategyEligibilityEvidence(input: StrategyEligibilityEvidence): DomainResult<StrategyEligibilityEvidence>;
export declare function validateModeEvidence(evidence: readonly ModeTransitionEvidence[], portfolioId: PortfolioId, targetMode: OperatingMode, effectiveAt: Instant): DomainResult<readonly ModeTransitionEvidence[]>;
export declare function validateStrategyEvidence(evidence: StrategyEligibilityEvidence, portfolioId: PortfolioId, strategyVersionId: StrategyVersionId, effectiveAt: Instant): DomainResult<StrategyEligibilityEvidence>;
export {};
