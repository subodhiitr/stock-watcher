import { MAX_OPEN_LOTS } from '../shared/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  compareIdentifiers,
  parseHoldingId,
  parseInstrumentId,
  parsePortfolioId,
  type HoldingId,
  type InstrumentId,
  type PortfolioId,
} from '../shared/identifiers.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'
import {
  createPortfolioStateVersion,
  type PortfolioStateVersion,
} from '../shared/state-version.ts'
import { createHoldingLot, type HoldingLot } from './holding-lot.ts'

export type Holding = Readonly<{
  holdingId: HoldingId
  portfolioId: PortfolioId
  instrumentId: InstrumentId
  totalQuantity: Quantity
  availableDeliveryQuantity: Quantity
  reservedQuantity: Quantity
  lots: readonly HoldingLot[]
  stateVersion: PortfolioStateVersion
  marginFunded: false
}>

export type HoldingInput = Omit<Holding, 'marginFunded'> & Readonly<{
  marginFunded: boolean
}>

export function createHolding(input: HoldingInput): DomainResult<Holding> {
  if (
    !parseHoldingId(input.holdingId).ok
    || !parsePortfolioId(input.portfolioId).ok
    || !parseInstrumentId(input.instrumentId).ok
    || !createQuantity(input.totalQuantity.shares).ok
    || !createQuantity(input.availableDeliveryQuantity.shares).ok
    || !createQuantity(input.reservedQuantity.shares).ok
    || !createPortfolioStateVersion(input.stateVersion).ok
  ) {
    return failure(domainFailure('INVALID_HOLDING_SCOPE', { field: 'holding' }))
  }
  if (input.lots.length > MAX_OPEN_LOTS) {
    return failure(domainFailure('CAPACITY_EXCEEDED', {
      field: 'lots',
      context: { maximum: MAX_OPEN_LOTS },
    }))
  }
  if (input.marginFunded !== false) {
    return failure(domainFailure('LEVERAGE_FORBIDDEN', { field: 'marginFunded' }))
  }
  if (
    input.availableDeliveryQuantity.shares > input.totalQuantity.shares
    || input.reservedQuantity.shares > input.totalQuantity.shares
  ) {
    return failure(domainFailure('RESERVED_QUANTITY_EXCEEDED', { field: 'reservedQuantity' }))
  }

  const lotIds = new Set<string>()
  let total = 0n
  const lots: HoldingLot[] = []
  for (const lot of input.lots) {
    const validatedLot = createHoldingLot(lot)
    if (!validatedLot.ok) {
      return validatedLot
    }
    if (lot.portfolioId !== input.portfolioId || lot.instrumentId !== input.instrumentId) {
      return failure(domainFailure('INVALID_LOT_SCOPE', { field: 'lots' }))
    }
    if (lotIds.has(lot.lotId)) {
      return failure(domainFailure('DUPLICATE_POSITION_ID', { field: 'lotId' }))
    }
    lotIds.add(lot.lotId)
    total += lot.openQuantity.shares
    lots.push(validatedLot.value)
  }

  if (total !== input.totalQuantity.shares) {
    return failure(domainFailure('HOLDING_LOT_MISMATCH', {
      field: 'totalQuantity',
      context: {
        expected: input.totalQuantity.shares.toString(),
        actual: total.toString(),
      },
    }))
  }

  lots.sort((left, right) => compareIdentifiers(left.lotId, right.lotId))
  return success(Object.freeze({ ...input, lots: Object.freeze(lots), marginFunded: false }))
}
