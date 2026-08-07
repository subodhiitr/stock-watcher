import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import { hashExecutionValue } from './canonical-codec.ts'
import type {
  BrokerOrderReferenceId,
  FillId,
  InstrumentId,
  OrderId,
  PortfolioId,
} from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import { addMoney, subtractMoney } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { Instant, LocalDate } from '../shared/time.ts'
import {
  type BrokerSide,
  type DeliveryProduct,
  type NormalizedFill,
  U05_MAX_FILL_LOTS,
} from './contracts.ts'

export type FillIdentityKind = 'BROKER_ID' | 'CANONICAL_FINGERPRINT'

export type FillCharge = Readonly<{
  chargeCode: string
  amount: Money
  confirmed: true
}>

export type LotMutationKind =
  | 'OPEN_FILL_LOT'
  | 'INCREASE_FILL_LOT'
  | 'REDUCE_EXISTING_LOT'
  | 'CLOSE_EXISTING_LOT'

export type LotMutation = Readonly<{
  kind: LotMutationKind
  lotId: string
  quantity: Quantity
  unitCost?: Money
}>

export type AccountingDelta = Readonly<{
  fillId: FillId
  cashDelta: Money
  holdingDelta: bigint
  lotMutations: readonly LotMutation[]
  deliveryDelta: bigint
  reservationReleaseAmount: Money | Quantity
  reservationSide: BrokerSide
}>

export type FillIdentity = Readonly<{
  fillId: FillId
  kind: FillIdentityKind
  brokerFillId?: string
  contentHash: IntegrityHash
}>

type FillFingerprintInput = Readonly<{
  accountBindingId: string
  brokerOrderId: string
  instrumentId: InstrumentId
  side: BrokerSide
  quantity: Quantity
  price: Money
  tradeTime: Instant
}>

// Derive stable fill identity: prefer broker fill/trade ID; fall back to canonical fingerprint
export function deriveFillIdentity(
  fillId: FillId,
  input: FillFingerprintInput,
  brokerFillId: string | undefined,
  contentHash: IntegrityHash,
): FillIdentity {
  if (brokerFillId !== undefined && brokerFillId.length > 0) {
    return Object.freeze({
      fillId,
      kind: 'BROKER_ID' as FillIdentityKind,
      brokerFillId,
      contentHash,
    })
  }
  return Object.freeze({
    fillId,
    kind: 'CANONICAL_FINGERPRINT' as FillIdentityKind,
    contentHash,
  })
}

// Derive a canonical fingerprint hash for fills without a broker fill ID
export function deriveFillFingerprintHash(
  input: FillFingerprintInput,
): DomainResult<IntegrityHash> {
  return hashExecutionValue('fill-fingerprint', {
    accountBindingId: input.accountBindingId,
    brokerOrderId: input.brokerOrderId,
    instrumentId: input.instrumentId,
    side: input.side,
    quantityShares: input.quantity.shares.toString(10),
    priceCurrency: input.price.currency,
    priceMinorUnits: input.price.minorUnits.toString(10),
    tradeTime: input.tradeTime,
  })
}

// Validate incremental fill quantity: must be monotone-increasing and within ceiling
export function validateIncrementalQuantity(
  orderQuantityCeiling: Quantity,
  alreadyFilledQuantity: Quantity,
  newIncrementalQuantity: Quantity,
): DomainResult<Quantity> {
  if (newIncrementalQuantity.shares <= 0n) {
    return failure(domainFailure('FILL_CUMULATIVE_INVALID', {
      field: 'newIncrementalQuantity',
      retryability: 'NEVER',
    }))
  }
  const cumulative = alreadyFilledQuantity.shares + newIncrementalQuantity.shares
  if (cumulative > orderQuantityCeiling.shares) {
    return failure(domainFailure('FILL_CUMULATIVE_INVALID', {
      field: 'cumulativeQuantity',
      retryability: 'NEVER',
    }))
  }
  return success(Object.freeze({ shares: cumulative }) as Quantity)
}

// Detect duplicate or conflicting fill by identity and content hash
export type FillConflictKind = 'DUPLICATE' | 'CONFLICT'

export function detectFillConflict(
  existingFills: readonly NormalizedFill[],
  candidateFillId: FillId,
  candidateContentHash: IntegrityHash,
): DomainResult<FillConflictKind | null> {
  for (const fill of existingFills) {
    if (fill.fillId !== candidateFillId) continue
    // Same identity — check content equivalence
    if (fill.contentHash === candidateContentHash) {
      return success('DUPLICATE' as FillConflictKind)
    }
    return success('CONFLICT' as FillConflictKind)
  }
  return success(null)
}

// Compute accounting delta for a buy fill
export function computeBuyAccountingDelta(
  fill: NormalizedFill,
  reservedCash: Money,
  fillId: FillId,
  fillLotId: string,
  existingLotCount: number,
): DomainResult<AccountingDelta> {
  if (existingLotCount >= U05_MAX_FILL_LOTS) {
    return failure(domainFailure('BUY_FILL_LOT_INVALID', {
      field: 'lotCount',
      retryability: 'NEVER',
    }))
  }
  // Cash debit = notional + charges (must not go below zero — enforced in portfolio aggregate)
  const fillNotional = Object.freeze({
    currency: fill.price.currency,
    minorUnits: fill.quantity.shares * fill.price.minorUnits,
  }) as Money
  const totalDebit = addMoney(fillNotional, fill.charges)
  if (!totalDebit.ok) {
    return failure(domainFailure('BUY_FILL_NEGATIVE_CASH', {
      field: 'cashDelta',
      retryability: 'NEVER',
    }))
  }
  const negatedDebit = Object.freeze({
    currency: totalDebit.value.currency,
    minorUnits: -totalDebit.value.minorUnits,
  }) as Money
  // Release proportional reserved cash (at most the reserved amount)
  const releaseAmount = reservedCash.minorUnits < totalDebit.value.minorUnits
    ? reservedCash
    : totalDebit.value
  return success(Object.freeze({
    fillId,
    cashDelta: negatedDebit,
    holdingDelta: fill.quantity.shares,
    lotMutations: Object.freeze([
      Object.freeze({
        kind: 'OPEN_FILL_LOT' as LotMutationKind,
        lotId: fillLotId,
        quantity: fill.quantity,
        unitCost: fill.price,
      }),
    ]),
    deliveryDelta: 0n,
    reservationReleaseAmount: releaseAmount,
    reservationSide: 'BUY' as BrokerSide,
  }))
}

// Compute accounting delta for a sell fill
export function computeSellAccountingDelta(
  fill: NormalizedFill,
  fillId: FillId,
  lotMutations: readonly LotMutation[],
  reservedDeliveryQuantity: Quantity,
): DomainResult<AccountingDelta> {
  if (fill.quantity.shares <= 0n) {
    return failure(domainFailure('SELL_FILL_QUANTITY_EXCEEDED', {
      field: 'quantity',
      retryability: 'NEVER',
    }))
  }
  // Validate lot mutations cover exactly the fill quantity
  let lotTotal = 0n
  for (const mut of lotMutations) {
    if (mut.kind !== 'REDUCE_EXISTING_LOT' && mut.kind !== 'CLOSE_EXISTING_LOT') continue
    lotTotal += mut.quantity.shares
  }
  if (lotTotal !== fill.quantity.shares) {
    return failure(domainFailure('SELL_FILL_LOT_MISMATCH', {
      field: 'lotMutations',
      retryability: 'NEVER',
    }))
  }
  // Proceeds credit = fill quantity * price - charges (net)
  const grossProceeds = Object.freeze({
    currency: fill.price.currency,
    minorUnits: fill.quantity.shares * fill.price.minorUnits,
  }) as Money
  const netProceeds = subtractMoney(grossProceeds, fill.charges)
  if (!netProceeds.ok) {
    return failure(domainFailure('SELL_FILL_QUANTITY_EXCEEDED', {
      field: 'netProceeds',
      retryability: 'NEVER',
    }))
  }
  const releaseQty = reservedDeliveryQuantity.shares < fill.quantity.shares
    ? reservedDeliveryQuantity
    : fill.quantity
  return success(Object.freeze({
    fillId,
    cashDelta: netProceeds.value,
    holdingDelta: -fill.quantity.shares,
    lotMutations: Object.freeze([...lotMutations]),
    deliveryDelta: -fill.quantity.shares,
    reservationReleaseAmount: releaseQty,
    reservationSide: 'SELL' as BrokerSide,
  }))
}
