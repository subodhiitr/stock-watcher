import { MAX_PORTFOLIO_NAME_LENGTH } from '../shared/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type PortfolioName = Readonly<{
  display: string
  uniquenessKey: string
}>

export function createPortfolioName(value: unknown): DomainResult<PortfolioName> {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > MAX_PORTFOLIO_NAME_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || /[\ud800-\udfff]/u.test(value.normalize('NFC'))
  ) {
    return failure(domainFailure('INVALID_PORTFOLIO_NAME', { field: 'displayName' }))
  }
  const display = value.normalize('NFC')
  const uniquenessKey = display.replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN')
  return success(Object.freeze({ display, uniquenessKey }))
}
