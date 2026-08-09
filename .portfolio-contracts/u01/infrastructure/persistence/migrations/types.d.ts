import type Database from 'better-sqlite3';
export type MigrationDefinition = Readonly<{
    id: number;
    name: string;
    upSql: string;
    downSql?: string;
    checksum: string;
    reverseChecksum?: string;
    assertForward: (database: Database.Database) => void;
}>;
