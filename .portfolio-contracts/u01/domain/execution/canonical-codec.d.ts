import { type DomainResult } from '../errors/result.ts';
import { type IntegrityHash } from '../portfolio/evidence.ts';
import { type Money } from '../shared/money.ts';
import { type Quantity } from '../shared/quantity.ts';
export declare function canonicalExecutionJson(value: unknown): DomainResult<string>;
export declare function hashExecutionValue(domain: string, value: unknown): DomainResult<IntegrityHash>;
export declare function parseBrokerMoneyDecimal(value: unknown): DomainResult<Money>;
export declare function parseBrokerQuantityDecimal(value: unknown): DomainResult<Quantity>;
