import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type { PortfolioId } from '../shared/identifiers.ts'
import type { ExecutionRunId } from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import type { Instant, LocalDate } from '../shared/time.ts'
import {
  type ApprovalBinding,
  type ApprovalState,
  type ExecutionMode,
  type ExecutionPolicySnapshot,
  type LiveEnablementSnapshot,
  type ReconciliationState,
  allLiveGatesPass,
  isLiveExecutionMode,
} from './contracts.ts'
import type { KillSwitchSnapshot } from './kill-switch.ts'
import { isKillSwitchActive, killSwitchAffectsPortfolio } from './kill-switch.ts'
import type { ReconciliationRunSnapshot } from './reconciliation.ts'
import {
  isReconciliationMatched,
  reconciliationAllowsDependentExecution,
} from './reconciliation.ts'
import type { ApprovalDecisionSnapshot } from './approval.ts'
import { isActiveApprovalState } from './approval.ts'

export type PortfolioStatus = 'ACTIVE' | 'ARCHIVED' | string

// GAT-001: Archived, missing, or integrity-invalid portfolios cannot execute
export function checkPortfolioGate(portfolioStatus: PortfolioStatus): DomainResult<void> {
  if (portfolioStatus !== 'ACTIVE') {
    return failure(domainFailure('PORTFOLIO_NOT_EXECUTABLE', {
      field: 'portfolioStatus',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// GAT-002/003: Live enablement gates default false; both environment and application must be true
export function checkLiveEnablementGates(
  snapshot: LiveEnablementSnapshot,
  requestedMode: ExecutionMode,
): DomainResult<void> {
  if (!isLiveExecutionMode(requestedMode)) return success(undefined)
  if (!snapshot.environmentEnabled || !snapshot.applicationEnabled) {
    return failure(domainFailure('LIVE_EXECUTION_DISABLED', {
      field: 'liveEnablement',
      retryability: 'AFTER_CORRECTION',
    }))
  }
  if (!snapshot.portfolioEligible || !snapshot.strategyEligible) {
    return failure(domainFailure('LIVE_POLICY_NOT_ELIGIBLE', {
      field: 'liveEnablement',
      retryability: 'AFTER_CORRECTION',
    }))
  }
  return success(undefined)
}

// GAT-004: Broker-account binding, health, credential, and CNC capability
export function checkBrokerReadinessGate(
  snapshot: LiveEnablementSnapshot,
  requestedMode: ExecutionMode,
): DomainResult<void> {
  if (!isLiveExecutionMode(requestedMode)) return success(undefined)
  if (!snapshot.brokerAccountBound || !snapshot.brokerCertified) {
    return failure(domainFailure('BROKER_NOT_EXECUTION_READY', {
      field: 'brokerReadiness',
      retryability: 'AFTER_CORRECTION',
    }))
  }
  return success(undefined)
}

// GAT-005: Current approval and every binding field revalidated before each placement
export function checkApprovalRevalidationGate(
  approval: ApprovalDecisionSnapshot,
  executionRunId: ExecutionRunId,
  nowInstant: Instant,
  currentPlanHash: IntegrityHash,
  currentPortfolioVersion: PortfolioStateVersion,
): DomainResult<void> {
  if (
    !isActiveApprovalState(approval.state)
    && !(
      approval.state === 'CONSUMED'
      && approval.consumedByExecutionRunId === executionRunId
    )
  ) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'approvalState',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const binding = approval.binding
  if (!binding) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'approvalBinding',
      retryability: 'NEVER',
    }))
  }
  if (binding.planHash !== currentPlanHash) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'planHash',
      retryability: 'NEVER',
    }))
  }
  if (
    approval.state !== 'CONSUMED'
    && binding.portfolioStateVersion !== currentPortfolioVersion
  ) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'portfolioStateVersion',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (nowInstant >= binding.expiresAt) {
    return failure(domainFailure('APPROVAL_STALE', {
      field: 'expiresAt',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// GAT-006: Fresh MATCHED reconciliation with no unknown order required before execution
export function checkReconciliationGate(
  reconciliation: ReconciliationRunSnapshot,
  now: Instant,
  maxAgeMs: number,
): DomainResult<void> {
  return reconciliationAllowsDependentExecution(reconciliation, now, maxAgeMs)
}

// GAT-007: Global and portfolio kill switches checked before run creation, reservation, placement
export function checkKillSwitchGate(
  globalKillSwitch: KillSwitchSnapshot | undefined,
  portfolioKillSwitch: KillSwitchSnapshot | undefined,
  portfolioId: PortfolioId,
): DomainResult<void> {
  if (globalKillSwitch !== undefined && isKillSwitchActive(globalKillSwitch)) {
    return failure(domainFailure('KILL_SWITCH_ACTIVE', {
      field: 'globalKillSwitch',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (
    portfolioKillSwitch !== undefined
    && isKillSwitchActive(portfolioKillSwitch)
    && killSwitchAffectsPortfolio(portfolioKillSwitch, portfolioId)
  ) {
    return failure(domainFailure('KILL_SWITCH_ACTIVE', {
      field: 'portfolioKillSwitch',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

export type ExecutionWindowContext = Readonly<{
  executionDate: LocalDate
  windowStart: string
  windowEnd: string
  timeZone: 'Asia/Kolkata'
  nowLocalDate: LocalDate
  nowLocalTime: string
  sameSessionAllowed: false
}>

// GAT-008: Routine execution only on eligible date and inside Asia/Kolkata window
export function checkExecutionWindowGate(
  window: ExecutionWindowContext,
): DomainResult<void> {
  if (window.nowLocalDate !== window.executionDate) {
    return failure(domainFailure('EXECUTION_WINDOW_INVALID', {
      field: 'executionDate',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (window.nowLocalTime < window.windowStart || window.nowLocalTime >= window.windowEnd) {
    return failure(domainFailure('EXECUTION_WINDOW_INVALID', {
      field: 'executionWindow',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

export type QuoteValidationContext = Readonly<{
  fetchedAt: Instant
  staleAfter: Instant
  nowInstant: Instant
  maximumQuoteAgeMs: number
  logicalOrderKey: IntegrityHash
  proposedLimitPrice: Money
}>

// GAT-009: Execution quotes require valid provenance, freshness, and approval-bound price
export function checkQuoteGate(
  quote: QuoteValidationContext,
  approval: ApprovalDecisionSnapshot,
): DomainResult<void> {
  const priceBound = approval.binding?.priceBoundsByOrder.find(
    (bound) => bound.logicalOrderKey === quote.logicalOrderKey,
  )
  if (priceBound === undefined) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'priceBoundsByOrder',
      retryability: 'NEVER',
    }))
  }
  if (quote.nowInstant >= quote.staleAfter) {
    return failure(domainFailure('EXECUTION_PRICE_STALE', {
      field: 'quoteStaleAfter',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const fetchedMs = Date.parse(quote.fetchedAt)
  const nowMs = Date.parse(quote.nowInstant)
  const staleAfterMs = Date.parse(quote.staleAfter)
  if (
    !Number.isFinite(fetchedMs)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(staleAfterMs)
    || fetchedMs > nowMs
    || fetchedMs >= staleAfterMs
    || !Number.isSafeInteger(quote.maximumQuoteAgeMs)
    || quote.maximumQuoteAgeMs < 0
    || nowMs - fetchedMs > quote.maximumQuoteAgeMs
  ) {
    return failure(domainFailure('EXECUTION_PRICE_STALE', {
      field: 'fetchedAt',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (quote.proposedLimitPrice.minorUnits > priceBound.approvedLimitPrice.minorUnits) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'approvedLimitPrice',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  const deviation = quote.proposedLimitPrice.minorUnits >= priceBound.referencePrice.minorUnits
    ? quote.proposedLimitPrice.minorUnits - priceBound.referencePrice.minorUnits
    : priceBound.referencePrice.minorUnits - quote.proposedLimitPrice.minorUnits
  if (
    deviation * priceBound.maximumDeviation.scale
    > priceBound.referencePrice.minorUnits * priceBound.maximumDeviation.numerator
  ) {
    return failure(domainFailure('APPROVAL_REVALIDATION_FAILED', {
      field: 'maximumDeviation',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

export type PreTradeRiskContext = Readonly<{
  universeAllowed: boolean
  symbolAllowed: boolean
  productCnc: boolean
  orderCountBelowLimit: boolean
  dailyNotionalBelowLimit: boolean
  positionBelowLimit: boolean
  concentrationBelowLimit: boolean
  turnoverBelowLimit: boolean
  liquidityAdequate: boolean
  drawdownBelowLimit: boolean
  rejectionsBelowLimit: boolean
  dataComplete: boolean
  cashAdequate: boolean
  noConflict: boolean
  automationAuthorized: boolean
}>

// GAT-010: All pre-trade risk checks must pass; one failure blocks
export function checkPreTradeRiskGate(ctx: PreTradeRiskContext): DomainResult<void> {
  if (!ctx.universeAllowed) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'universe',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.symbolAllowed) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'symbol',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.productCnc) {
    return failure(domainFailure('DELIVERY_ORDER_REQUIRED', {
      field: 'product',
      retryability: 'NEVER',
    }))
  }
  if (!ctx.orderCountBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'orderCount',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.dailyNotionalBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'dailyNotional',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.positionBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'position',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.concentrationBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'concentration',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.turnoverBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'turnover',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.liquidityAdequate) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'liquidity',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.drawdownBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'drawdown',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.rejectionsBelowLimit) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'rejections',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.dataComplete) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'data',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.cashAdequate) {
    return failure(domainFailure('BUY_AFFORDABILITY_FAILED', {
      field: 'cash',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.noConflict) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'conflict',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  if (!ctx.automationAuthorized) {
    return failure(domainFailure('PRE_TRADE_RISK_BLOCKED', {
      field: 'automation',
      retryability: 'AFTER_CORRECTION',
    }))
  }
  return success(undefined)
}

// Sell quantity gate: cannot exceed available delivery
export function checkSellDeliveryGate(
  requestedQuantity: Quantity,
  availableDelivery: Quantity,
  existingReservations: Quantity,
): DomainResult<void> {
  const netAvailable = availableDelivery.shares - existingReservations.shares
  if (requestedQuantity.shares > netAvailable) {
    return failure(domainFailure('SELL_DELIVERY_EXCEEDED', {
      field: 'requestedQuantity',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// Buy affordability gate: cannot imply negative cash, margin, or leverage
export function checkBuyAffordabilityGate(
  requestedCash: Money,
  availableCash: Money,
  minimumCashBuffer: Money,
): DomainResult<void> {
  const netAvailable = availableCash.minorUnits - minimumCashBuffer.minorUnits
  if (requestedCash.minorUnits > netAvailable) {
    return failure(domainFailure('BUY_AFFORDABILITY_FAILED', {
      field: 'requestedCash',
      retryability: 'AFTER_STATE_REFRESH',
    }))
  }
  return success(undefined)
}

// Deterministic precedence gate evaluation (GAT rules 001-010 in order)
export type AllGatesContext = Readonly<{
  portfolioStatus: PortfolioStatus
  liveEnablement: LiveEnablementSnapshot
  requestedMode: ExecutionMode
  globalKillSwitch?: KillSwitchSnapshot
  portfolioKillSwitch?: KillSwitchSnapshot
  portfolioId: PortfolioId
  reconciliation: ReconciliationRunSnapshot
  reconciliationMaxAgeMs: number
  now: Instant
  executionWindow: ExecutionWindowContext
  quote: QuoteValidationContext
  approval: ApprovalDecisionSnapshot
  executionRunId: ExecutionRunId
  currentPlanHash: IntegrityHash
  currentPortfolioVersion: PortfolioStateVersion
  preTradeRisk: PreTradeRiskContext
}>

export function evaluateExecutionGates(ctx: AllGatesContext): DomainResult<void> {
  // GAT-001
  const portfolioGate = checkPortfolioGate(ctx.portfolioStatus)
  if (!portfolioGate.ok) return portfolioGate

  // GAT-002/003
  const liveGate = checkLiveEnablementGates(ctx.liveEnablement, ctx.requestedMode)
  if (!liveGate.ok) return liveGate

  // GAT-004
  const brokerGate = checkBrokerReadinessGate(ctx.liveEnablement, ctx.requestedMode)
  if (!brokerGate.ok) return brokerGate

  // GAT-005
  const approvalGate = checkApprovalRevalidationGate(
    ctx.approval,
    ctx.executionRunId,
    ctx.now,
    ctx.currentPlanHash,
    ctx.currentPortfolioVersion,
  )
  if (!approvalGate.ok) return approvalGate

  // GAT-006
  const reconciliationGate = checkReconciliationGate(
    ctx.reconciliation,
    ctx.now,
    ctx.reconciliationMaxAgeMs,
  )
  if (!reconciliationGate.ok) return reconciliationGate

  // GAT-007
  const killSwitchGate = checkKillSwitchGate(
    ctx.globalKillSwitch,
    ctx.portfolioKillSwitch,
    ctx.portfolioId,
  )
  if (!killSwitchGate.ok) return killSwitchGate

  // GAT-008
  const windowGate = checkExecutionWindowGate(ctx.executionWindow)
  if (!windowGate.ok) return windowGate

  // GAT-009
  const quoteGate = checkQuoteGate(ctx.quote, ctx.approval)
  if (!quoteGate.ok) return quoteGate

  // GAT-010
  const riskGate = checkPreTradeRiskGate(ctx.preTradeRisk)
  if (!riskGate.ok) return riskGate

  return success(undefined)
}
