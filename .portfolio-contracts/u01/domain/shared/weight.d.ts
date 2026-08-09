import { type DomainResult } from '../errors/result.ts';
export type Weight = Readonly<{
    partsPerMillion: bigint;
}>;
export type WeightJson = Readonly<{
    partsPerMillion: string;
}>;
export declare const FULL_WEIGHT: Weight;
export declare function createWeight(partsPerMillion: unknown): DomainResult<Weight>;
export declare function serializeWeight(value: Weight): WeightJson;
export declare function parseWeight(value: unknown): DomainResult<Weight>;
