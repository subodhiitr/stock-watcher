import { createHash } from 'node:crypto'

import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { parseIntegrityHash, type IntegrityHash } from '../portfolio/evidence.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'

type CanonicalJsonPrimitive = null | boolean | number | string

interface CanonicalJsonArray extends ReadonlyArray<CanonicalJsonValue> {}

interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue
}

type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonArray
  | CanonicalJsonObject

function canonicalize(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('NON_FINITE_NUMBER')
    return value
  }
  if (typeof value === 'bigint') return value.toString(10)
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const canonical: Record<string, CanonicalJsonValue> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) canonical[key] = canonicalize(item)
    }
    return Object.freeze(canonical)
  }
  throw new TypeError('UNSUPPORTED_CANONICAL_VALUE')
}

export function canonicalExecutionJson(value: unknown): DomainResult<string> {
  try {
    return success(JSON.stringify(canonicalize(value)))
  } catch {
    return failure(domainFailure('EXECUTION_EXACT_VALUE_REQUIRED', {
      field: 'canonicalPayload',
      retryability: 'NEVER',
    }))
  }
}

export function hashExecutionValue(
  domain: string,
  value: unknown,
): DomainResult<IntegrityHash> {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(domain)) {
    return failure(domainFailure('ORDER_PAYLOAD_HASH_INVALID', {
      field: 'hashDomain',
      retryability: 'NEVER',
    }))
  }
  const canonical = canonicalExecutionJson(value)
  if (!canonical.ok) return canonical
  const hash = createHash('sha256')
    .update(`portfolio-execution:v1:${domain}\0`, 'utf8')
    .update(canonical.value, 'utf8')
    .digest('hex')
  const parsed = parseIntegrityHash(hash)
  if (!parsed.ok) {
    return failure(domainFailure('ORDER_PAYLOAD_HASH_INVALID', {
      field: 'hash',
      retryability: 'NEVER',
    }))
  }
  return success(parsed.value)
}

function normalizeDecimal(value: unknown): DomainResult<Readonly<{
  negative: boolean
  whole: string
  fraction: string
}>> {
  if (typeof value !== 'string' || value.trim() !== value) {
    return failure(domainFailure('EXECUTION_EXACT_VALUE_REQUIRED', {
      field: 'brokerDecimal',
      retryability: 'NEVER',
    }))
  }
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (match === null) {
    return failure(domainFailure('EXECUTION_EXACT_VALUE_REQUIRED', {
      field: 'brokerDecimal',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({
    negative: match[1] === '-',
    whole: match[2] ?? '0',
    fraction: match[3] ?? '',
  }))
}

export function parseBrokerMoneyDecimal(value: unknown): DomainResult<Money> {
  const decimal = normalizeDecimal(value)
  if (!decimal.ok) return decimal
  if (decimal.value.fraction.length > 2) {
    return failure(domainFailure('EXECUTION_EXACT_VALUE_REQUIRED', {
      field: 'brokerMoney',
      retryability: 'NEVER',
    }))
  }
  const fraction = decimal.value.fraction.padEnd(2, '0')
  const absolute = BigInt(decimal.value.whole) * 100n + BigInt(fraction || '0')
  return createMoney(decimal.value.negative ? -absolute : absolute)
}

export function parseBrokerQuantityDecimal(value: unknown): DomainResult<Quantity> {
  const decimal = normalizeDecimal(value)
  if (!decimal.ok) return decimal
  if (decimal.value.negative || /[1-9]/.test(decimal.value.fraction)) {
    return failure(domainFailure('EXECUTION_QUANTITY_INVALID', {
      field: 'brokerQuantity',
      retryability: 'NEVER',
    }))
  }
  return createQuantity(BigInt(decimal.value.whole))
}
