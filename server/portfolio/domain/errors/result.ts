import type { DomainFailure } from './failure.ts'

export type AnyDomainFailure = DomainFailure<string>

export type DomainSuccess<T> = Readonly<{
  ok: true
  value: T
}>

export type DomainError<Error extends AnyDomainFailure = DomainFailure> = Readonly<{
  ok: false
  error: Error
}>

export type DomainResult<
  T,
  Error extends AnyDomainFailure = DomainFailure,
> = DomainSuccess<T> | DomainError<Error>

export function success<T>(value: T): DomainSuccess<T> {
  return Object.freeze({ ok: true, value })
}

export function failure<Error extends AnyDomainFailure>(error: Error): DomainError<Error> {
  return Object.freeze({ ok: false, error })
}
