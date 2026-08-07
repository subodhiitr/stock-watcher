import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { createHolding, type Holding } from '../portfolio/holding.ts'
import { createHoldingLot, type HoldingLot } from '../portfolio/holding-lot.ts'
import { validatePortfolioIntegrity } from '../portfolio/integrity.ts'
import { Portfolio } from '../portfolio/portfolio.ts'
import {
  parseHoldingLotId,
  type HoldingId,
  type InstrumentId,
} from '../shared/identifiers.ts'
import { createMoney } from '../shared/money.ts'
import { createQuantity, type Quantity } from '../shared/quantity.ts'
import { nextPortfolioStateVersion } from '../shared/state-version.ts'
import type { LocalDate } from '../shared/time.ts'
import type { NormalizedFill } from './contracts.ts'
import type { AccountingDelta } from './fill-accounting.ts'

function rebuildPortfolio(
  portfolio: Portfolio,
  holdings: readonly Holding[],
  cashMinorUnits: bigint,
): DomainResult<Portfolio> {
  const nextVersion = nextPortfolioStateVersion(portfolio.stateVersion)
  if (!nextVersion.ok) return nextVersion
  const cash = createMoney(cashMinorUnits)
  if (!cash.ok || cash.value.minorUnits < 0n) {
    return failure(domainFailure('BUY_FILL_NEGATIVE_CASH', {
      field: 'cash',
      retryability: 'NEVER',
    }))
  }
  const snapshot = Object.freeze({
    ...portfolio.snapshot(),
    cash: cash.value,
    holdings: Object.freeze([...holdings]),
    stateVersion: nextVersion.value,
  })
  const integrity = validatePortfolioIntegrity(snapshot)
  if (!integrity.ok) return integrity
  return success(Portfolio.rehydrate(snapshot))
}

export function reserveSellDelivery(
  portfolio: Portfolio,
  instrumentId: InstrumentId,
  quantity: Quantity,
): DomainResult<Portfolio> {
  if (portfolio.status !== 'ACTIVE' || quantity.shares <= 0n) {
    return failure(domainFailure('SELL_DELIVERY_EXCEEDED', {
      field: 'quantity',
      retryability: 'NEVER',
    }))
  }

  const holding = portfolio.holdings.find((item) => item.instrumentId === instrumentId)
  if (
    holding === undefined
    || holding.availableDeliveryQuantity.shares - holding.reservedQuantity.shares
      < quantity.shares
  ) {
    return failure(domainFailure('SELL_DELIVERY_EXCEEDED', {
      field: 'availableDeliveryQuantity',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const nextVersion = nextPortfolioStateVersion(portfolio.stateVersion)
  if (!nextVersion.ok) return nextVersion
  const reservedQuantity = createQuantity(
    holding.reservedQuantity.shares + quantity.shares,
  )
  if (!reservedQuantity.ok) return reservedQuantity
  const updatedHolding = createHolding({
    ...holding,
    reservedQuantity: reservedQuantity.value,
    stateVersion: nextVersion.value,
  })
  if (!updatedHolding.ok) return updatedHolding
  const holdings = portfolio.holdings.map((item) =>
    item.instrumentId === instrumentId ? updatedHolding.value : item)
  return rebuildPortfolio(portfolio, holdings, portfolio.cash.minorUnits)
}

export function releaseSellDelivery(
  portfolio: Portfolio,
  instrumentId: InstrumentId,
  quantity: Quantity,
): DomainResult<Portfolio> {
  if (quantity.shares <= 0n) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'quantity',
      retryability: 'NEVER',
    }))
  }
  const holding = portfolio.holdings.find((item) => item.instrumentId === instrumentId)
  if (holding === undefined || holding.reservedQuantity.shares < quantity.shares) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'reservedQuantity',
      retryability: 'NEVER',
    }))
  }
  const nextVersion = nextPortfolioStateVersion(portfolio.stateVersion)
  if (!nextVersion.ok) return nextVersion
  const reservedQuantity = createQuantity(
    holding.reservedQuantity.shares - quantity.shares,
  )
  if (!reservedQuantity.ok) return reservedQuantity
  const updatedHolding = createHolding({
    ...holding,
    reservedQuantity: reservedQuantity.value,
    stateVersion: nextVersion.value,
  })
  if (!updatedHolding.ok) return updatedHolding
  return rebuildPortfolio(
    portfolio,
    portfolio.holdings.map((item) =>
      item.instrumentId === instrumentId ? updatedHolding.value : item),
    portfolio.cash.minorUnits,
  )
}

export type ApplyFillAccountingInput = Readonly<{
  portfolio: Portfolio
  fill: NormalizedFill
  delta: AccountingDelta
  acquiredOn: LocalDate
  newHoldingId?: HoldingId
}>

function applyLotMutations(
  holding: Holding | undefined,
  input: ApplyFillAccountingInput,
): DomainResult<readonly HoldingLot[]> {
  const lots = new Map((holding?.lots ?? []).map((lot) => [lot.lotId, lot] as const))
  for (const mutation of input.delta.lotMutations) {
    const lotId = parseHoldingLotId(mutation.lotId)
    if (!lotId.ok) return lotId
    if (mutation.kind === 'OPEN_FILL_LOT') {
      if (
        lots.has(lotId.value)
        || mutation.unitCost === undefined
        || mutation.quantity.shares <= 0n
      ) {
        return failure(domainFailure('BUY_FILL_LOT_INVALID', {
          field: 'lotMutation',
          retryability: 'NEVER',
        }))
      }
      const created = createHoldingLot({
        lotId: lotId.value,
        portfolioId: input.fill.portfolioId,
        instrumentId: input.fill.instrumentId,
        acquiredOn: input.acquiredOn,
        originalQuantity: mutation.quantity,
        openQuantity: mutation.quantity,
        unitCost: mutation.unitCost,
        sourceReference: Object.freeze({
          kind: 'FILL',
          referenceId: input.fill.fillId,
        }),
      })
      if (!created.ok) return created
      lots.set(lotId.value, created.value)
      continue
    }
    if (mutation.kind === 'INCREASE_FILL_LOT') {
      return failure(domainFailure('BUY_FILL_LOT_INVALID', {
        field: 'lotMutation',
        retryability: 'NEVER',
      }))
    }
    const current = lots.get(lotId.value)
    if (
      current === undefined
      || mutation.quantity.shares <= 0n
      || mutation.quantity.shares > current.openQuantity.shares
      || (
        mutation.kind === 'CLOSE_EXISTING_LOT'
        && mutation.quantity.shares !== current.openQuantity.shares
      )
    ) {
      return failure(domainFailure('SELL_FILL_LOT_MISMATCH', {
        field: 'lotMutation',
        retryability: 'NEVER',
      }))
    }
    const remaining = current.openQuantity.shares - mutation.quantity.shares
    if (remaining === 0n) {
      lots.delete(lotId.value)
      continue
    }
    const openQuantity = createQuantity(remaining)
    if (!openQuantity.ok) return openQuantity
    const updated = createHoldingLot({
      ...current,
      openQuantity: openQuantity.value,
    })
    if (!updated.ok) return updated
    lots.set(lotId.value, updated.value)
  }
  return success(Object.freeze(
    [...lots.values()].sort((left, right) => left.lotId < right.lotId ? -1 : 1),
  ))
}

export function applyFillAccounting(
  input: ApplyFillAccountingInput,
): DomainResult<Portfolio> {
  if (
    input.fill.portfolioId !== input.portfolio.portfolioId
    || input.fill.fillId !== input.delta.fillId
  ) {
    return failure(domainFailure('FILL_BINDING_INVALID', {
      field: 'fill',
      retryability: 'NEVER',
    }))
  }
  const existing = input.portfolio.holdings.find((item) =>
    item.instrumentId === input.fill.instrumentId)
  if (
    input.fill.side === 'SELL' && existing === undefined
    || input.fill.side === 'BUY' && existing === undefined && input.newHoldingId === undefined
  ) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'holding',
      retryability: 'NEVER',
    }))
  }
  const lots = applyLotMutations(existing, input)
  if (!lots.ok) return lots
  const nextVersion = nextPortfolioStateVersion(input.portfolio.stateVersion)
  if (!nextVersion.ok) return nextVersion
  const totalQuantity = createQuantity(
    (existing?.totalQuantity.shares ?? 0n) + input.delta.holdingDelta,
  )
  const availableDeliveryQuantity = createQuantity(
    (existing?.availableDeliveryQuantity.shares ?? 0n) + input.delta.deliveryDelta,
  )
  const releaseShares = input.delta.reservationSide === 'SELL'
    && 'shares' in input.delta.reservationReleaseAmount
    ? input.delta.reservationReleaseAmount.shares
    : 0n
  const reservedQuantity = createQuantity(
    (existing?.reservedQuantity.shares ?? 0n) - releaseShares,
  )
  if (!totalQuantity.ok || !availableDeliveryQuantity.ok || !reservedQuantity.ok) {
    return failure(domainFailure('FILL_ACCOUNTING_ATOMICITY_FAILED', {
      field: 'quantity',
      retryability: 'NEVER',
    }))
  }
  const holding = createHolding({
    holdingId: existing?.holdingId ?? input.newHoldingId!,
    portfolioId: input.portfolio.portfolioId,
    instrumentId: input.fill.instrumentId,
    totalQuantity: totalQuantity.value,
    availableDeliveryQuantity: availableDeliveryQuantity.value,
    reservedQuantity: reservedQuantity.value,
    lots: lots.value,
    stateVersion: nextVersion.value,
    marginFunded: false,
  })
  if (!holding.ok) return holding
  const holdings = existing === undefined
    ? [...input.portfolio.holdings, holding.value]
    : input.portfolio.holdings.map((item) =>
      item.instrumentId === input.fill.instrumentId ? holding.value : item)
  return rebuildPortfolio(
    input.portfolio,
    holdings,
    input.portfolio.cash.minorUnits + input.delta.cashDelta.minorUnits,
  )
}
