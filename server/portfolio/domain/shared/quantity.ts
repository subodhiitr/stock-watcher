import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type Quantity = Readonly<{ shares: bigint }>
export type QuantityJson = Readonly<{ shares: string }>

export function createQuantity(shares: unknown): DomainResult<Quantity> {
  if (typeof shares !== 'bigint' || shares < 0n) {
    return failure(domainFailure(
      typeof shares === 'bigint' && shares < 0n ? 'SHORT_POSITION_FORBIDDEN' : 'INVALID_QUANTITY',
      { field: 'shares' },
    ))
  }
  return success(Object.freeze({ shares }))
}

export function addQuantities(left: Quantity, right: Quantity): DomainResult<Quantity> {
  return createQuantity(left.shares + right.shares)
}

export function subtractQuantities(left: Quantity, right: Quantity): DomainResult<Quantity> {
  if (right.shares > left.shares) {
    return failure(domainFailure('SHORT_POSITION_FORBIDDEN', { field: 'shares' }))
  }
  return createQuantity(left.shares - right.shares)
}

export function serializeQuantity(value: Quantity): QuantityJson {
  return Object.freeze({ shares: value.shares.toString(10) })
}

export function parseQuantity(value: unknown): DomainResult<Quantity> {
  if (typeof value !== 'object' || value === null) {
    return failure(domainFailure('INVALID_QUANTITY', { field: 'quantity' }))
  }
  const shares = (value as { shares?: unknown }).shares
  if (typeof shares !== 'string' || !/^(0|[1-9]\d*)$/.test(shares)) {
    return failure(domainFailure('INVALID_QUANTITY', { field: 'shares' }))
  }
  return createQuantity(BigInt(shares))
}
