import type Database from 'better-sqlite3';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { CommittedExecutionResult, ExecutionTransaction, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
export declare class SqliteExecutionUnitOfWork implements ExecutionUnitOfWork {
    private readonly database;
    private readonly now;
    private readonly canAccess;
    constructor(database: Database.Database, now: () => string, canAccess?: () => boolean);
    execute<T>(work: (transaction: ExecutionTransaction) => DomainResult<T, AnyDomainFailure>): DomainResult<CommittedExecutionResult<T>, AnyDomainFailure>;
}
