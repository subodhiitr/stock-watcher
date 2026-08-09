import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

declare const stateVersionBrand: unique symbol
export type PortfolioStateVersion = number & {
  readonly [stateVersionBrand]: 'PortfolioStateVersion'
}

export const INITIAL_PORTFOLIO_STATE_VERSION = 1 as PortfolioStateVersion
export const NO_PORTFOLIO_STATE_VERSION = 0 as PortfolioStateVersion

export function createPortfolioStateVersion(
  value: unknown,
  allowZero = false,
): DomainResult<PortfolioStateVersion> {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    return failure(domainFailure('INVALID_INITIAL_STATE', { field: 'stateVersion' }))
  }
  return success(value as PortfolioStateVersion)
}

export function nextPortfolioStateVersion(
  current: PortfolioStateVersion,
): DomainResult<PortfolioStateVersion> {
  if (current >= Number.MAX_SAFE_INTEGER) {
    return failure(domainFailure('EXACT_ARITHMETIC_FAILURE', {
      field: 'stateVersion',
      retryability: 'NEVER',
    }))
  }
  return success((current + 1) as PortfolioStateVersion)
}

export function serializePortfolioStateVersion(value: PortfolioStateVersion): string {
  return String(value)
}

export function parsePortfolioStateVersion(value: unknown): DomainResult<PortfolioStateVersion> {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return failure(domainFailure('INVALID_INITIAL_STATE', { field: 'stateVersion' }))
  }
  const parsed = Number(value)
  return createPortfolioStateVersion(parsed)
}
