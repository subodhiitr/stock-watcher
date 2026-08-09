import type Database from 'better-sqlite3';
import type { PortfolioRepository } from '../../ports/index.ts';
import type { Portfolio } from '../../domain/portfolio/portfolio.ts';
import type { PortfolioId } from '../../domain/shared/identifiers.ts';
import type { PortfolioStateVersion } from '../../domain/shared/state-version.ts';
import { type PersistenceResult } from '../../infrastructure/persistence/failures.ts';
export declare class SqlitePortfolioRepository implements PortfolioRepository {
    private readonly database;
    private readonly writable;
    private readonly canAccess;
    private readonly now;
    private readonly onMutation;
    constructor(database: Database.Database, writable: boolean, canAccess?: () => boolean, now?: () => string, onMutation?: (portfolio: Portfolio, kind: 'INSERT' | 'SAVE') => void);
    getById(portfolioId: PortfolioId): PersistenceResult<Portfolio | undefined>;
    findByName(normalizedNameKey: string): PersistenceResult<Portfolio | undefined>;
    activeNameExists(normalizedNameKey: string): PersistenceResult<boolean>;
    insert(portfolio: Portfolio): PersistenceResult<void>;
    save(portfolio: Portfolio, expectedVersion: PortfolioStateVersion): PersistenceResult<void>;
}
