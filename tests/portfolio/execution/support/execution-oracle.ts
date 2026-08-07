import type {
  ExecutionOrderSnapshot,
  NormalizedFill,
  ReconciliationDifference,
  ReconciliationSnapshotRecord,
} from '../../../../server/portfolio/execution.ts'

export type OracleFillAccounting = Readonly<{
  filledShares: bigint
  grossMinorUnits: bigint
  chargesMinorUnits: bigint
  netCashMinorUnits: bigint
}>

export function oracleAccountForFills(
  order: Pick<ExecutionOrderSnapshot, 'side' | 'approvedQuantityCeiling'>,
  fills: readonly NormalizedFill[],
): OracleFillAccounting {
  let filledShares = 0n
  let grossMinorUnits = 0n
  let chargesMinorUnits = 0n
  for (const fill of fills) {
    filledShares += fill.quantity.shares
    grossMinorUnits += fill.quantity.shares * fill.price.minorUnits
    chargesMinorUnits += fill.charges.minorUnits
  }
  if (filledShares > order.approvedQuantityCeiling.shares) {
    throw new RangeError('oracle fill overflow')
  }
  const signedGross = order.side === 'SELL' ? grossMinorUnits : -grossMinorUnits
  const signedCharges = -chargesMinorUnits
  return Object.freeze({
    filledShares,
    grossMinorUnits,
    chargesMinorUnits,
    netCashMinorUnits: signedGross + signedCharges,
  })
}

export function oracleReplayFilledQuantity(
  fills: readonly NormalizedFill[],
): bigint {
  return fills.reduce((total, fill) => total + fill.quantity.shares, 0n)
}

function normalizeHoldingSet(snapshot: ReconciliationSnapshotRecord) {
  return new Map(snapshot.holdings.map((holding) => [
    holding.instrumentId,
    {
      total: holding.totalQuantity.shares,
      available: holding.availableDeliveryQuantity.shares,
      reserved: holding.reservedQuantity.shares,
      averageCost: holding.averageCost?.minorUnits,
    },
  ]))
}

function stringifyBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString(10) : item)
}

export function oracleCompareReconciliation(
  local: ReconciliationSnapshotRecord,
  external: ReconciliationSnapshotRecord,
): readonly ReconciliationDifference[] {
  const differences: ReconciliationDifference[] = []
  if (local.cash.minorUnits !== external.cash.minorUnits) {
    differences.push(Object.freeze({
      differenceId: local.contentHash,
      kind: 'VALUE_MISMATCH',
      severity: 'BLOCKING',
      expected: local.cash.minorUnits.toString(10),
      actual: external.cash.minorUnits.toString(10),
      resolution: 'REQUIRES_ADJUSTMENT_APPROVAL',
      absoluteMinorUnitDifference:
        local.cash.minorUnits > external.cash.minorUnits
          ? local.cash.minorUnits - external.cash.minorUnits
          : external.cash.minorUnits - local.cash.minorUnits,
    }))
  }
  const localHoldings = normalizeHoldingSet(local)
  const externalHoldings = normalizeHoldingSet(external)
  for (const [instrumentId, expected] of localHoldings) {
    const actual = externalHoldings.get(instrumentId)
    if (actual === undefined) {
      differences.push(Object.freeze({
        differenceId: local.contentHash,
        kind: 'EXTERNAL_CHANGE',
        severity: 'CRITICAL',
        instrumentId,
        expected: stringifyBigInts(expected),
        actual: 'missing',
        resolution: 'REQUIRES_ADJUSTMENT_APPROVAL',
      }))
      continue
    }
    if (
      expected.total !== actual.total
      || expected.available !== actual.available
      || expected.reserved !== actual.reserved
      || expected.averageCost !== actual.averageCost
    ) {
      differences.push(Object.freeze({
        differenceId: local.contentHash,
        kind: 'VALUE_MISMATCH',
        severity: 'BLOCKING',
        instrumentId,
        expected: stringifyBigInts(expected),
        actual: stringifyBigInts(actual),
        resolution: 'REQUIRES_ADJUSTMENT_APPROVAL',
      }))
    }
  }
  for (const instrumentId of externalHoldings.keys()) {
    if (!localHoldings.has(instrumentId)) {
      differences.push(Object.freeze({
        differenceId: external.contentHash,
        kind: 'EXTERNAL_CHANGE',
        severity: 'CRITICAL',
        instrumentId,
        expected: 'missing',
        actual: 'present',
        resolution: 'REQUIRES_ADJUSTMENT_APPROVAL',
      }))
    }
  }
  return Object.freeze(differences)
}
