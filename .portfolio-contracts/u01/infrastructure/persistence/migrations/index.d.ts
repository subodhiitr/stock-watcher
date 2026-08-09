import type Database from 'better-sqlite3';
import { type PersistenceResult } from '../failures.ts';
import type { MigrationDefinition } from './types.ts';
export declare const MIGRATIONS: readonly MigrationDefinition[];
export declare function migrationRegistryChecksum(): string;
export declare function migrateDatabase(database: Database.Database, appliedAt: string, applicationVersion: string): PersistenceResult<number>;
export declare function reverseLatestMigration(database: Database.Database, maintenanceMode: boolean, verifiedBackup: boolean): PersistenceResult<number>;
