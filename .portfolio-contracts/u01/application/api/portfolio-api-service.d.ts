import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { PortfolioDatabaseOwner } from '../../infrastructure/persistence/database-owner.ts';
export type CreatePortfolioInput = Readonly<{
    displayName: string;
    startingCashMinorUnits: string;
    mode: string;
    strategyVersionId: string;
}>;
export declare class PortfolioApiApplicationService {
    private readonly owner;
    private readonly store;
    private readonly now;
    constructor(owner: PortfolioDatabaseOwner, now: () => number);
    list(actorId: string): Readonly<{
        portfolios: readonly Readonly<{
            portfolioId: string;
            displayName: string;
            status: string;
            mode: string;
            cashMinorUnits: string;
            stateVersion: number;
            accessRole: import("../../ports/api/api-store.ts").PortfolioAccessRole;
        }>[];
        strategies: readonly Readonly<{
            strategyVersionId: string;
            displayName: string;
            horizon: string;
            semanticVersion: string;
        }>[];
    }>;
    view(actorId: string, portfolioId: string): unknown | undefined;
    operations(actorId: string, portfolioId: string): unknown | undefined;
    operationsDashboard(actorId: string, portfolioId: string): Promise<unknown | undefined>;
    create(actorId: string, input: CreatePortfolioInput): DomainResult<Readonly<{
        portfolioId: string;
        stateVersion: number;
    }>, AnyDomainFailure>;
    archive(actorId: string, portfolioIdValue: string, confirmation: string): DomainResult<Readonly<{
        portfolioId: string;
        status: string;
        stateVersion: number;
    }>, AnyDomainFailure>;
}
