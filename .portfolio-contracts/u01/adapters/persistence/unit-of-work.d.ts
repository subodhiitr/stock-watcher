import type Database from 'better-sqlite3';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { CommittedDomainResult, PortfolioTransaction, PortfolioUnitOfWork } from '../../ports/index.ts';
export type PortfolioMutation = Readonly<{
    category: 'PORTFOLIO';
    kind: 'INSERT' | 'SAVE';
    portfolioId: string;
    stateVersion: number;
}>;
export type ExecutionAggregateKind = 'APPROVAL' | 'EXECUTION_RUN' | 'EXECUTION_ORDER' | 'RECONCILIATION_RUN' | 'KILL_SWITCH' | 'ADJUSTMENT_PROPOSAL';
export type ExecutionAggregateMutation = Readonly<{
    category: 'EXECUTION_AGGREGATE';
    kind: 'INSERT' | 'SAVE';
    aggregateKind: ExecutionAggregateKind;
    aggregateId: string;
    portfolioId?: string;
    stateVersion: number;
}>;
export type ExecutionFactKind = 'RECONCILIATION_SNAPSHOT' | 'FILL' | 'CANCELLATION_REQUEST' | 'CANCELLATION_OUTCOME' | 'RESIDUAL_WORK';
export type ExecutionFactInsertion = Readonly<{
    category: 'EXECUTION_FACT';
    factKind: ExecutionFactKind;
    factId: string;
    portfolioId: string;
}>;
export type TransactionMutation = PortfolioMutation | ExecutionAggregateMutation | ExecutionFactInsertion;
export declare function transactionMutationIdentity(mutation: TransactionMutation): string;
export declare class SqlitePortfolioUnitOfWork implements PortfolioUnitOfWork {
    private readonly database;
    private readonly now;
    private readonly canAccess;
    constructor(database: Database.Database, now: () => string, canAccess?: () => boolean);
    execute<T>(work: (transaction: PortfolioTransaction) => DomainResult<T, AnyDomainFailure>): DomainResult<CommittedDomainResult<T>, AnyDomainFailure>;
}
