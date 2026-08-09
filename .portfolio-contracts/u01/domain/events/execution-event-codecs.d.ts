import { type DomainResult } from '../errors/result.ts';
import { type ExecutionDomainEvent } from './execution-events.ts';
export declare function serializeExecutionDomainEvent(event: ExecutionDomainEvent): DomainResult<string>;
export declare function parseExecutionDomainEvent(serialized: string): DomainResult<ExecutionDomainEvent>;
