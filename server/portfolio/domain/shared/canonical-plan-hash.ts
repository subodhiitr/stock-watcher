import { createHash } from 'node:crypto'

import type { IntegrityHash } from '../portfolio/evidence.ts'
import type { InstrumentId, PortfolioId } from './identifiers.ts'

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString(10)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical plan values must be finite')
    }
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(canonicalize))
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) {
        output[key] = canonicalize(item)
      }
    }
    return Object.freeze(output)
  }
  throw new TypeError('Unsupported canonical plan value')
}

export function canonicalPlanJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hashCanonicalPlan(value: unknown): IntegrityHash {
  return createHash('sha256')
    .update(canonicalPlanJson(value), 'utf8')
    .digest('hex') as IntegrityHash
}

export function deriveLogicalOrderKey(input: Readonly<{
  portfolioId: PortfolioId
  instrumentId: InstrumentId
  side: string
  semanticAction: unknown
}>): IntegrityHash {
  return hashCanonicalPlan({
    kind: 'U04_LOGICAL_ORDER',
    instrumentId: input.instrumentId,
    portfolioId: input.portfolioId,
    semanticAction: input.semanticAction,
    side: input.side,
  })
}

export function createPlanInputHash(input: unknown): IntegrityHash {
  return hashCanonicalPlan({ kind: 'U04_PLAN_INPUT', input })
}

export function createPlanHash(plan: unknown): IntegrityHash {
  return hashCanonicalPlan({ kind: 'U04_PLAN', plan })
}

export function createOptimizerRequestHash(request: unknown): IntegrityHash {
  return hashCanonicalPlan({ kind: 'U04_OPTIMIZER_REQUEST', request })
}
