import { type DomainResult } from '../errors/result.ts';
declare const instantBrand: unique symbol;
declare const localDateBrand: unique symbol;
export type Instant = string & {
    readonly [instantBrand]: 'Instant';
};
export type LocalDate = string & {
    readonly [localDateBrand]: 'LocalDate';
};
export declare function parseInstant(value: unknown): DomainResult<Instant>;
export declare function parseLocalDate(value: unknown): DomainResult<LocalDate>;
export declare function compareInstants(left: Instant, right: Instant): number;
export {};
