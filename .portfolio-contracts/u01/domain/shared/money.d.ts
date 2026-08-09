import { type InrCurrency } from './constants.ts';
import { type DomainResult } from '../errors/result.ts';
export type Money = Readonly<{
    currency: InrCurrency;
    minorUnits: bigint;
}>;
export type MoneyJson = Readonly<{
    currency: InrCurrency;
    minorUnits: string;
}>;
export declare function createMoney(minorUnits: unknown, currency?: unknown): DomainResult<Money>;
export declare function addMoney(left: Money, right: Money): DomainResult<Money>;
export declare function subtractMoney(left: Money, right: Money): DomainResult<Money>;
export declare function serializeMoney(value: Money): MoneyJson;
export declare function parseMoney(value: unknown): DomainResult<Money>;
export declare function moneyEquals(left: Money, right: Money): boolean;
