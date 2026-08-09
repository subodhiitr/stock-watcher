import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import {
  parseHoldingLotId,
  parseInstrumentId,
  parsePortfolioId,
  type HoldingLotId,
  type InstrumentId,
  type PortfolioId,
} from '../shared/identifiers.ts'
import { parseLocalDate, type LocalDate } from '../shared/time.ts'
import { createMoney, type Money } from '../shared/money.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'

export type LotSourceKind = 'IMPORT' | 'FILL' | 'CORPORATE_ACTION'

export type LotSourceReference = Readonly<{
  kind: LotSourceKind
  referenceId: string
}>

export type HoldingLot = Readonly<{
  lotId: HoldingLotId
  portfolioId: PortfolioId
  instrumentId: InstrumentId
  acquiredOn: LocalDate
  originalQuantity: Quantity
  openQuantity: Quantity
  unitCost: Money
  sourceReference: LotSourceReference
}>

export function createHoldingLot(input: HoldingLot): DomainResult<HoldingLot> {
  if (
    !parseHoldingLotId(input.lotId).ok
    || !parsePortfolioId(input.portfolioId).ok
    || !parseInstrumentId(input.instrumentId).ok
    || !parseLocalDate(input.acquiredOn).ok
    || !createQuantity(input.originalQuantity.shares).ok
    || !createQuantity(input.openQuantity.shares).ok
    || !createMoney(input.unitCost.minorUnits, input.unitCost.currency).ok
  ) {
    return failure(domainFailure('INVALID_LOT_SCOPE', { field: 'lot' }))
  }
  if (input.originalQuantity.shares <= 0n || input.openQuantity.shares > input.originalQuantity.shares) {
    return failure(domainFailure('INVALID_QUANTITY', { field: 'openQuantity' }))
  }
  if (input.unitCost.currency !== 'INR' || input.unitCost.minorUnits < 0n) {
    return failure(domainFailure('INVALID_MONEY', { field: 'unitCost' }))
  }
  if (
    input.sourceReference.referenceId.length === 0
    || input.sourceReference.referenceId.length > 128
    || !['IMPORT', 'FILL', 'CORPORATE_ACTION'].includes(input.sourceReference.kind)
  ) {
    return failure(domainFailure('INVALID_LOT_SCOPE', { field: 'sourceReference' }))
  }
  return success(Object.freeze({
    ...input,
    sourceReference: Object.freeze({ ...input.sourceReference }),
  }))
}
