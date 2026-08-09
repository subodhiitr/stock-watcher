import { MAX_HOLDINGS, MAX_OPEN_LOTS } from '../shared/constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { parsePortfolioId, type PortfolioId } from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import { parseInstant, type Instant } from '../shared/time.ts'
import { createHolding, type Holding } from './holding.ts'
import { isOperatingMode, type OperatingMode } from './evidence.ts'
import {
  validateStrategyAllocationPolicy,
  type StrategyAllocationPolicy,
} from './strategy-allocation.ts'
import { createPortfolioName, type PortfolioName } from './portfolio-name.ts'

export type PortfolioStatus = 'ACTIVE' | 'ARCHIVED'

export type PortfolioIntegrityState = Readonly<{
  portfolioId: PortfolioId
  name: PortfolioName
  baseCurrency: 'INR'
  createdAt: Instant
  status: PortfolioStatus
  mode: OperatingMode
  cash: Money
  allocationPolicy: StrategyAllocationPolicy
  holdings: readonly Holding[]
  stateVersion: PortfolioStateVersion
}>

export function validatePortfolioIntegrity(
  state: PortfolioIntegrityState,
): DomainResult<void> {
  if (!parsePortfolioId(state.portfolioId).ok) {
    return failure(domainFailure('INVALID_IDENTIFIER', { field: 'portfolioId' }))
  }
  const name = createPortfolioName(state.name.display)
  if (!name.ok || name.value.uniquenessKey !== state.name.uniquenessKey) {
    return failure(domainFailure('INVALID_PORTFOLIO_NAME', { field: 'name' }))
  }
  if (state.baseCurrency !== 'INR') {
    return failure(domainFailure('UNSUPPORTED_CURRENCY', { field: 'baseCurrency' }))
  }
  if (!parseInstant(state.createdAt).ok) {
    return failure(domainFailure('INVALID_EFFECTIVE_TIME', { field: 'createdAt' }))
  }
  if (state.status !== 'ACTIVE' && state.status !== 'ARCHIVED') {
    return failure(domainFailure('INVALID_PORTFOLIO_STATUS', { field: 'status' }))
  }
  if (!isOperatingMode(state.mode)) {
    return failure(domainFailure('INVALID_OPERATING_MODE', { field: 'mode' }))
  }
  if (state.cash.currency !== 'INR' || state.cash.minorUnits < 0n) {
    return failure(domainFailure('NEGATIVE_CASH', { field: 'cash' }))
  }
  if (state.stateVersion < 1) {
    return failure(domainFailure('INVALID_INITIAL_STATE', { field: 'stateVersion' }))
  }
  if (state.holdings.length > MAX_HOLDINGS) {
    return failure(domainFailure('CAPACITY_EXCEEDED', {
      field: 'holdings',
      context: { maximum: MAX_HOLDINGS },
    }))
  }

  const holdingIds = new Set<string>()
  const instrumentIds = new Set<string>()
  const lotIds = new Set<string>()
  let openLotCount = 0
  for (const holding of state.holdings) {
    const validatedHolding = createHolding(holding)
    if (!validatedHolding.ok) {
      return validatedHolding
    }
    if (holding.portfolioId !== state.portfolioId) {
      return failure(domainFailure('INVALID_HOLDING_SCOPE', { field: 'portfolioId' }))
    }
    if (holdingIds.has(holding.holdingId) || instrumentIds.has(holding.instrumentId)) {
      return failure(domainFailure('DUPLICATE_POSITION_ID', { field: 'holdingId' }))
    }
    holdingIds.add(holding.holdingId)
    instrumentIds.add(holding.instrumentId)

    let quantity = 0n
    for (const lot of holding.lots) {
      openLotCount += 1
      if (
        lot.portfolioId !== state.portfolioId
        || lot.instrumentId !== holding.instrumentId
      ) {
        return failure(domainFailure('INVALID_LOT_SCOPE', { field: 'lots' }))
      }
      if (lotIds.has(lot.lotId)) {
        return failure(domainFailure('DUPLICATE_POSITION_ID', { field: 'lotId' }))
      }
      lotIds.add(lot.lotId)
      quantity += lot.openQuantity.shares
    }
    if (quantity !== holding.totalQuantity.shares) {
      return failure(domainFailure('HOLDING_LOT_MISMATCH', { field: 'totalQuantity' }))
    }
    if (
      holding.reservedQuantity.shares > holding.totalQuantity.shares
      || holding.availableDeliveryQuantity.shares > holding.totalQuantity.shares
    ) {
      return failure(domainFailure('RESERVED_QUANTITY_EXCEEDED', {
        field: 'reservedQuantity',
      }))
    }
    if (holding.marginFunded !== false) {
      return failure(domainFailure('LEVERAGE_FORBIDDEN', { field: 'marginFunded' }))
    }
  }

  if (openLotCount > MAX_OPEN_LOTS) {
    return failure(domainFailure('CAPACITY_EXCEEDED', {
      field: 'lots',
      context: { maximum: MAX_OPEN_LOTS },
    }))
  }
  const allocation = validateStrategyAllocationPolicy(
    state.portfolioId,
    state.allocationPolicy,
  )
  if (!allocation.ok) {
    return allocation
  }
  return success(undefined)
}

export function validateTargetedTransition(
  prior: PortfolioIntegrityState,
  next: PortfolioIntegrityState,
): DomainResult<void> {
  if (prior.portfolioId !== next.portfolioId) {
    return failure(domainFailure('CROSS_PORTFOLIO_MUTATION', { field: 'portfolioId' }))
  }
  if (prior.createdAt !== next.createdAt) {
    return failure(domainFailure('INVALID_EFFECTIVE_TIME', { field: 'createdAt' }))
  }
  if (next.cash.minorUnits < 0n) {
    return failure(domainFailure('NEGATIVE_CASH', { field: 'cash' }))
  }
  return success(undefined)
}
