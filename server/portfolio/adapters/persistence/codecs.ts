import { createHash } from 'node:crypto'

import {
  failure,
  success,
  type DomainResult,
} from '../../domain/errors/result.ts'
import { createMoney, type Money } from '../../domain/shared/money.ts'
import { createQuantity, type Quantity } from '../../domain/shared/quantity.ts'
import { createWeight, type Weight } from '../../domain/shared/weight.ts'
import { parseInstant, type Instant } from '../../domain/shared/time.ts'
import {
  persistenceFailure,
  type PersistenceResult,
} from '../../infrastructure/persistence/failures.ts'

const CANONICAL_NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/

export function encodeNonNegativeBigInt(value: bigint): string {
  if (value < 0n) throw new TypeError('Expected non-negative exact integer')
  return value.toString(10)
}

export function decodeNonNegativeBigInt(value: unknown): PersistenceResult<bigint> {
  if (typeof value !== 'string' || !CANONICAL_NON_NEGATIVE_INTEGER.test(value)) {
    return failure(persistenceFailure('INVALID_PERSISTED_EXACT_VALUE'))
  }
  return success(BigInt(value))
}

export function encodeMoney(value: Money): string {
  if (value.currency !== 'INR') throw new TypeError('Expected INR money')
  return encodeNonNegativeBigInt(value.minorUnits)
}

export function decodeMoney(value: unknown): PersistenceResult<Money> {
  const decoded = decodeNonNegativeBigInt(value)
  if (!decoded.ok) return decoded
  return widen(createMoney(decoded.value))
}

export function encodeQuantity(value: Quantity): string {
  return encodeNonNegativeBigInt(value.shares)
}

export function decodeQuantity(value: unknown): PersistenceResult<Quantity> {
  const decoded = decodeNonNegativeBigInt(value)
  if (!decoded.ok) return decoded
  return widen(createQuantity(decoded.value))
}

export function encodeWeight(value: Weight): number {
  return Number(value.partsPerMillion)
}

export function decodeWeight(value: unknown): PersistenceResult<Weight> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return failure(persistenceFailure('INVALID_PERSISTED_EXACT_VALUE'))
  }
  return widen(createWeight(BigInt(value)))
}

export function decodeInstant(value: unknown): PersistenceResult<Instant> {
  return widen(parseInstant(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite canonical number')
    return value
  }
  if (typeof value === 'bigint') return value.toString(10)
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) result[key] = canonicalize(item)
    }
    return result
  }
  throw new TypeError('Unsupported canonical JSON value')
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function widen<T>(result: DomainResult<T>): PersistenceResult<T> {
  if (result.ok) return success(result.value)
  return failure(persistenceFailure('INVALID_PERSISTED_VALUE'))
}
