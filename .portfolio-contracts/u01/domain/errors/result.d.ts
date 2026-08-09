import type { DomainFailure } from './failure.ts';
export type AnyDomainFailure = DomainFailure<string>;
export type DomainSuccess<T> = Readonly<{
    ok: true;
    value: T;
}>;
export type DomainError<Error extends AnyDomainFailure = DomainFailure> = Readonly<{
    ok: false;
    error: Error;
}>;
export type DomainResult<T, Error extends AnyDomainFailure = DomainFailure> = DomainSuccess<T> | DomainError<Error>;
export declare function success<T>(value: T): DomainSuccess<T>;
export declare function failure<Error extends AnyDomainFailure>(error: Error): DomainError<Error>;
