import type Database from 'better-sqlite3';
import { type ExecutionDomainEvent } from '../../domain/events/execution-events.ts';
import type { ExecutionEvidencePayload } from '../../domain/execution/evidence.ts';
import { type PersistenceResult } from '../../infrastructure/persistence/failures.ts';
import type { TransactionMutation } from './unit-of-work.ts';
export declare function createExecutionDomainEvents(mutations: readonly TransactionMutation[], evidence: readonly ExecutionEvidencePayload[]): PersistenceResult<readonly ExecutionDomainEvent[]>;
export declare function appendExecutionDomainEvents(database: Database.Database, events: readonly ExecutionDomainEvent[], insertedAt: string): PersistenceResult<void>;
export declare function verifyExecutionEventChains(database: Database.Database): PersistenceResult<Readonly<Record<string, string>>>;
