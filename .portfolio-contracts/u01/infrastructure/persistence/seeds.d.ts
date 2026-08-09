import type Database from 'better-sqlite3';
import { type Instant } from '../../domain/shared/time.ts';
import { type PersistenceResult } from './failures.ts';
export declare function seedPortfolioDatabase(database: Database.Database, now: Instant, defaultStartingCashMinorUnits: bigint): PersistenceResult<void>;
