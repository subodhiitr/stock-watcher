import type Database from 'better-sqlite3';
import { type PortfolioId } from '../../domain/shared/identifiers.ts';
import { Portfolio } from '../../domain/portfolio/portfolio.ts';
import { type PersistenceResult } from '../../infrastructure/persistence/failures.ts';
export declare function loadPortfolio(database: Database.Database, portfolioId: PortfolioId): PersistenceResult<Portfolio | undefined>;
export declare function insertAllocation(database: Database.Database, portfolio: Portfolio): void;
export declare function replaceHoldings(database: Database.Database, portfolio: Portfolio): void;
