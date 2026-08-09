import type { AnyDomainFailure } from "../../domain/errors/result.ts";
import { type DomainResult } from "../../domain/errors/result.ts";
import type { ActorId, CorrelationId, StrategyVersionId } from "../../domain/shared/identifiers.ts";
import type { EvidenceReference, StrategyVersion } from "../../domain/strategy/strategy-version.ts";
import type { StrategyVersionRepository } from "../../ports/strategy/strategy-version-repository.ts";
import type { StrategyVersionUnitOfWork } from "../../ports/strategy/strategy-unit-of-work.ts";
import type { ClockPort, IdentifierFactory } from "../../ports/index.ts";
export declare class StrategyVersionService {
    private readonly strategyVersionRepo;
    private readonly activationUoW;
    private readonly clock;
    private readonly identifiers;
    constructor(strategyVersionRepo: StrategyVersionRepository, activationUoW: StrategyVersionUnitOfWork, clock: ClockPort, identifiers: IdentifierFactory);
    createStrategyVersion(params: {
        strategyId: string;
        versionLabel: string;
        rawConfig: unknown;
        createdBy: ActorId;
        correlationId: CorrelationId;
        isPreset?: boolean;
    }): DomainResult<StrategyVersion, AnyDomainFailure>;
    submitForActivation(params: {
        strategyVersionId: StrategyVersionId;
        evidenceRefs: readonly EvidenceReference[];
        submittedBy: ActorId;
        correlationId: CorrelationId;
    }): DomainResult<StrategyVersion, AnyDomainFailure>;
    activateVersion(params: {
        strategyVersionId: StrategyVersionId;
        approvedBy: ActorId;
        correlationId: CorrelationId;
    }): DomainResult<StrategyVersion, AnyDomainFailure>;
    withdrawVersion(params: {
        strategyVersionId: StrategyVersionId;
        withdrawnBy: ActorId;
        withdrawalReason: string;
        correlationId: CorrelationId;
    }): DomainResult<StrategyVersion, AnyDomainFailure>;
}
