import { type DomainResult } from '../errors/result.ts';
import { type PortfolioDomainEvent } from './domain-events.ts';
export declare function serializeDomainEvent(event: PortfolioDomainEvent): string;
export declare function parseDomainEvent(serialized: string): DomainResult<PortfolioDomainEvent>;
