import { type PersistenceResult } from './failures.ts';
import type { DatabaseOwnerMode } from './configuration.ts';
export type ValidatedDatabasePath = Readonly<{
    sqlitePath: string;
    canonicalPath: string;
    inMemory: boolean;
}>;
export declare function validateDatabasePath(databasePath: string, mode: DatabaseOwnerMode, protectedLegacyPaths: readonly string[]): PersistenceResult<ValidatedDatabasePath>;
export declare function pathsEqual(left: string, right: string): boolean;
