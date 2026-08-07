import { INR_CURRENCY, type InrCurrency } from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type Money = Readonly<{
  currency: InrCurrency
  minorUnits: bigint
}>

export type MoneyJson = Readonly<{
  currency: InrCurrency
  minorUnits: string
}>

export function createMoney(
  minorUnits: unknown,
  currency: unknown = INR_CURRENCY,
): DomainResult<Money> {
  if (currency !== INR_CURRENCY) {
    return failure(domainFailure('UNSUPPORTED_CURRENCY', { field: 'currency' }))
  }
  if (typeof minorUnits !== 'bigint') {
    return failure(domainFailure('INVALID_MONEY', { field: 'minorUnits' }))
  }
  return success(Object.freeze({ currency, minorUnits }))
}

export function addMoney(left: Money, right: Money): DomainResult<Money> {
  if (left.currency !== right.currency) {
    return failure(domainFailure('VALUE_SCALE_MISMATCH', { field: 'currency' }))
  }
  return createMoney(left.minorUnits + right.minorUnits, left.currency)
}

export function subtractMoney(left: Money, right: Money): DomainResult<Money> {
  if (left.currency !== right.currency) {
    return failure(domainFailure('VALUE_SCALE_MISMATCH', { field: 'currency' }))
  }
  return createMoney(left.minorUnits - right.minorUnits, left.currency)
}

export function serializeMoney(value: Money): MoneyJson {
  return Object.freeze({
    currency: value.currency,
    minorUnits: value.minorUnits.toString(10),
  })
}

export function parseMoney(value: unknown): DomainResult<Money> {
  if (typeof value !== 'object' || value === null) {
    return failure(domainFailure('INVALID_MONEY', { field: 'money' }))
  }
  const candidate = value as { currency?: unknown; minorUnits?: unknown }
  if (
    typeof candidate.minorUnits !== 'string'
    || !/^-?(0|[1-9]\d*)$/.test(candidate.minorUnits)
  ) {
    return failure(domainFailure('INVALID_MONEY', { field: 'minorUnits' }))
  }
  return createMoney(BigInt(candidate.minorUnits), candidate.currency)
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.minorUnits === right.minorUnits
}
