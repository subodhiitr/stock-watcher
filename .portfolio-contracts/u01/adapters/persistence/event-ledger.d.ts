import type Database from 'better-sqlite3';
import type { PortfolioDomainEvent } from '../../domain/events/domain-events.ts';
import { type PersistenceResult } from '../../infrastructure/persistence/failures.ts';
export declare function appendDomainEvents(database: Database.Database, events: readonly PortfolioDomainEvent[], insertedAt: string): PersistenceResult<void>;
export declare function verifyEventChains(database: Database.Database): PersistenceResult<Readonly<Record<string, string>>>;
