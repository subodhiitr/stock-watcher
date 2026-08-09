import type Database from 'better-sqlite3';
import { type PersistenceResult } from './failures.ts';
export type PortfolioDatabaseHealth = Readonly<{
    schemaVersion: number;
    migrationRegistryChecksum: string;
    databaseIntegrity: 'ok';
    foreignKeysEnabled: true;
    trustedSchemaDisabled: true;
    attachedDatabaseCount: 1;
    verifiedEventStreams: number;
    operationsAuditValid: true;
}>;
export declare function inspectPortfolioDatabaseHealth(database: Database.Database): PersistenceResult<PortfolioDatabaseHealth>;
