import { type DomainResult } from '../errors/result.ts';
export type Quantity = Readonly<{
    shares: bigint;
}>;
export type QuantityJson = Readonly<{
    shares: string;
}>;
export declare function createQuantity(shares: unknown): DomainResult<Quantity>;
export declare function addQuantities(left: Quantity, right: Quantity): DomainResult<Quantity>;
export declare function subtractQuantities(left: Quantity, right: Quantity): DomainResult<Quantity>;
export declare function serializeQuantity(value: Quantity): QuantityJson;
export declare function parseQuantity(value: unknown): DomainResult<Quantity>;
