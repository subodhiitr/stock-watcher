import { type DomainResult } from '../errors/result.ts';
export type ScaledRate = Readonly<{
    numerator: bigint;
    scale: bigint;
}>;
export type ScaledRateJson = Readonly<{
    numerator: string;
    scale: string;
}>;
export declare function createScaledRate(numerator: unknown, scale: unknown): DomainResult<ScaledRate>;
export declare function convertScaledRate(value: ScaledRate, targetScale: bigint): DomainResult<ScaledRate>;
export declare function scaledRateEquals(left: ScaledRate, right: ScaledRate): boolean;
export declare function serializeScaledRate(value: ScaledRate): ScaledRateJson;
export declare function parseScaledRate(value: unknown): DomainResult<ScaledRate>;
