import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

declare const instantBrand: unique symbol
declare const localDateBrand: unique symbol

export type Instant = string & { readonly [instantBrand]: 'Instant' }
export type LocalDate = string & { readonly [localDateBrand]: 'LocalDate' }

const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseInstant(value: unknown): DomainResult<Instant> {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    return failure(domainFailure('INVALID_EFFECTIVE_TIME', { field: 'instant' }))
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    return failure(domainFailure('INVALID_EFFECTIVE_TIME', { field: 'instant' }))
  }
  return success(value as Instant)
}

export function parseLocalDate(value: unknown): DomainResult<LocalDate> {
  if (typeof value !== 'string') {
    return failure(domainFailure('INVALID_LOCAL_DATE', { field: 'localDate' }))
  }
  const match = LOCAL_DATE_PATTERN.exec(value)
  if (match === null) {
    return failure(domainFailure('INVALID_LOCAL_DATE', { field: 'localDate' }))
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) {
    return failure(domainFailure('INVALID_LOCAL_DATE', { field: 'localDate' }))
  }
  return success(value as LocalDate)
}

export function compareInstants(left: Instant, right: Instant): number {
  return left < right ? -1 : left > right ? 1 : 0
}
