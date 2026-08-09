import type { PortfolioApiStore } from '../../ports/api/api-store.ts';
import type { PortfolioRepository, PortfolioUnitOfWork } from '../../ports/index.ts';
import type { ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { OperationsRepositoryPort } from '../../ports/operations/operations-port.ts';
import type { PortfolioDatabaseConfiguration } from './configuration.ts';
import { type PersistenceResult } from './failures.ts';
import { type PortfolioDatabaseHealth } from './health.ts';
export type PortfolioBackupReceipt = Readonly<{
    destination: string;
    schemaVersion: number;
    verifiedEventStreams: number;
}>;
export interface PortfolioDatabaseOwner {
    readonly portfolios: PortfolioRepository;
    readonly unitOfWork: PortfolioUnitOfWork;
    readonly executionUnitOfWork: ExecutionUnitOfWork;
    readonly apiStore: PortfolioApiStore;
    readonly operations: OperationsRepositoryPort;
    health(): PersistenceResult<PortfolioDatabaseHealth>;
    backupTo(destination: string): Promise<PersistenceResult<PortfolioBackupReceipt>>;
    close(): PersistenceResult<void>;
}
export declare function openPortfolioDatabase(configuration: PortfolioDatabaseConfiguration): PersistenceResult<PortfolioDatabaseOwner>;
