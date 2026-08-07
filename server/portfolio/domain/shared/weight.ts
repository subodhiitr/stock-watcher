import { WEIGHT_SCALE } from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'

export type Weight = Readonly<{ partsPerMillion: bigint }>
export type WeightJson = Readonly<{ partsPerMillion: string }>

export const FULL_WEIGHT: Weight = Object.freeze({ partsPerMillion: WEIGHT_SCALE })

export function createWeight(partsPerMillion: unknown): DomainResult<Weight> {
  if (
    typeof partsPerMillion !== 'bigint'
    || partsPerMillion < 0n
    || partsPerMillion > WEIGHT_SCALE
  ) {
    return failure(domainFailure('INVALID_WEIGHT', { field: 'partsPerMillion' }))
  }
  return success(Object.freeze({ partsPerMillion }))
}

export function serializeWeight(value: Weight): WeightJson {
  return Object.freeze({ partsPerMillion: value.partsPerMillion.toString(10) })
}

export function parseWeight(value: unknown): DomainResult<Weight> {
  if (typeof value !== 'object' || value === null) {
    return failure(domainFailure('INVALID_WEIGHT', { field: 'weight' }))
  }
  const parts = (value as { partsPerMillion?: unknown }).partsPerMillion
  if (typeof parts !== 'string' || !/^(0|[1-9]\d*)$/.test(parts)) {
    return failure(domainFailure('INVALID_WEIGHT', { field: 'partsPerMillion' }))
  }
  return createWeight(BigInt(parts))
}
