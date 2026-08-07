import type { DomainFailureCode } from '../errors/failure.ts'
import type { IntegrityHash } from '../portfolio/evidence.ts'
import type {
  ApprovalId,
  BrokerAccountBindingId,
  BrokerOrderReferenceId,
  CalendarSessionId,
  ExecutionPolicySnapshotId,
  ExecutionRunId,
  FillId,
  InstrumentId,
  OrderId,
  PortfolioId,
  QuoteSnapshotId,
  RebalanceRunId,
  ReconciliationRunId,
  ReconciliationSnapshotId,
  StrategyVersionId,
  SubmissionAttemptId,
} from '../shared/identifiers.ts'
import type { Money } from '../shared/money.ts'
import type { Quantity } from '../shared/quantity.ts'
import type { ScaledRate } from '../shared/scaled-rate.ts'
import type { PortfolioStateVersion } from '../shared/state-version.ts'
import type { Instant, LocalDate } from '../shared/time.ts'

export const U05_MAX_ORDERS = 250
export const U05_MAX_FILLS = 10_000
export const U05_MAX_FILL_LOTS = 800
export const U05_MAX_PLACEMENT_ATTEMPTS = 3
export const U05_MAX_RECONCILIATION_SKEW_MS = 10_000
export const U05_FIRST_STATUS_CHECK_MAX_MS = 2_000
export const U05_PLACEMENT_DEADLINE_DEFAULT_MS = 8_000
export const U05_PLACEMENT_DEADLINE_MAX_MS = 15_000
export const U05_READ_DEADLINE_DEFAULT_MS = 10_000
export const U05_READ_DEADLINE_MAX_MS = 20_000
export const U05_RECONCILIATION_DEADLINE_DEFAULT_MS = 60_000
export const U05_RECONCILIATION_DEADLINE_MAX_MS = 120_000

export const APPROVAL_STATES = Object.freeze([
  'PENDING',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'INVALIDATED',
  'EXPIRED',
  'CONSUMED',
] as const)
export type ApprovalState = (typeof APPROVAL_STATES)[number]

export const EXECUTION_MODES = Object.freeze([
  'PAPER',
  'DRY_RUN',
  'FAKE_TEST',
  'LIVE_ZERODHA',
  'LIVE_SHAREKHAN',
] as const)
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const EXECUTION_RUN_STATES = Object.freeze([
  'CREATED',
  'VALIDATING',
  'READY',
  'SELLING',
  'RECONCILING_SELLS',
  'BUYING',
  'RECONCILING_BUYS',
  'CANCELLING',
  'RECOVERY_REQUIRED',
  'BLOCKED',
  'COMPLETED',
  'COMPLETED_WITH_RESIDUAL',
  'CANCELLED',
] as const)
export type ExecutionRunState = (typeof EXECUTION_RUN_STATES)[number]

export const ORDER_STATES = Object.freeze([
  'PLANNED',
  'RESIDUAL',
  'INTENT_RECORDED',
  'SUBMISSION_IN_FLIGHT',
  'ACKNOWLEDGED',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'REJECTED',
  'UNKNOWN',
  'CANCEL_PENDING',
  'CANCELLED',
  'EXPIRED',
] as const)
export type OrderState = (typeof ORDER_STATES)[number]

export const SUBMISSION_CERTAINTIES = Object.freeze([
  'ACKNOWLEDGED',
  'REJECTED',
  'DEFINITELY_NOT_SENT',
  'UNKNOWN',
] as const)
export type SubmissionCertainty = (typeof SUBMISSION_CERTAINTIES)[number]

export const RECONCILIATION_STATES = Object.freeze([
  'REQUESTED',
  'COLLECTING',
  'COMPARING',
  'MATCHED',
  'MATCHED_WITH_ROUNDING',
  'MISMATCH',
  'UNKNOWN',
  'BLOCKED',
] as const)
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number]

export const BROKER_ORDER_STATUSES = Object.freeze([
  'ACKNOWLEDGED',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'UNKNOWN',
] as const)
export type BrokerOrderStatus = (typeof BROKER_ORDER_STATUSES)[number]

export const RECONCILIATION_REASONS = Object.freeze([
  'BEFORE_EXECUTION',
  'AFTER_SELLS',
  'AFTER_BUYS',
  'AFTER_PARTIAL_FILL',
  'AFTER_CANCELLATION',
  'END_OF_WINDOW',
  'END_OF_DAY',
  'RESTART',
  'MANUAL_SAFE',
] as const)
export type ReconciliationReason = (typeof RECONCILIATION_REASONS)[number]

export type BrokerSide = 'BUY' | 'SELL'
export type DeliveryProduct = 'CNC'

export type ApprovalPriceBound = Readonly<{
  logicalOrderKey: IntegrityHash
  referencePrice: Money
  approvedLimitPrice: Money
  maximumDeviation: ScaledRate
  quoteStaleAfter: Instant
}>

export type ApprovalBinding = Readonly<{
  planHash: IntegrityHash
  planInputHash: IntegrityHash
  strategyVersionId: StrategyVersionId
  strategyConfigHash: IntegrityHash
  portfolioStateVersion: PortfolioStateVersion
  reconciliationSnapshotId: ReconciliationSnapshotId
  quoteSnapshotId: QuoteSnapshotId
  approvedLogicalOrderKeys: readonly IntegrityHash[]
  priceBoundsByOrder: readonly ApprovalPriceBound[]
  executionDate: LocalDate
  windowStart: string
  windowEnd: string
  timeZone: 'Asia/Kolkata'
  expiresAt: Instant
}>

export type ExecutionPolicySnapshot = Readonly<{
  policySnapshotId: ExecutionPolicySnapshotId
  strategyVersionId: StrategyVersionId
  allowedUniverseHash: IntegrityHash
  product: DeliveryProduct
  maximumOrderCount: number
  maximumDailyNotional: Money
  maximumPositionValue: Money
  maximumTurnover: ScaledRate
  minimumCashBuffer: Money
  maximumQuoteAgeMs: number
  maximumPriceDeviation: ScaledRate
  maximumRejections: number
  effectiveAt: Instant
  hash: IntegrityHash
}>

export type LiveEnablementSnapshot = Readonly<{
  environmentEnabled: boolean
  applicationEnabled: boolean
  portfolioEligible: boolean
  strategyEligible: boolean
  brokerAccountBound: boolean
  brokerCertified: boolean
  approvalCurrent: boolean
  reconciliationMatched: boolean
  sessionEligible: boolean
  riskPassed: boolean
  fullAutoEnabled: false
}>

export type ExecutionQuoteSnapshot = Readonly<{
  quoteSnapshotId: QuoteSnapshotId
  instrumentId: InstrumentId
  bid?: Money
  ask?: Money
  last?: Money
  source: string
  marketTime: Instant
  fetchedAt: Instant
  staleAfter: Instant
  validationStatus: 'VALID'
  mappingSnapshotHash: IntegrityHash
}>

export type BrokerInstrumentMapping = Readonly<{
  brokerAccountBindingId: BrokerAccountBindingId
  instrumentId: InstrumentId
  brokerSymbol: string
  brokerInstrumentCode: string
  exchange: string
  product: DeliveryProduct
  snapshotHash: IntegrityHash
  validAt: Instant
}>

export type ExecutionWindow = Readonly<{
  executionDate: LocalDate
  start: string
  end: string
  timeZone: 'Asia/Kolkata'
  sameSessionAllowed: false
  calendarSessionId: CalendarSessionId
}>

export type OrderIntentPayload = Readonly<{
  portfolioId: PortfolioId
  executionRunId: ExecutionRunId
  approvalId: ApprovalId
  rebalanceRunId: RebalanceRunId
  planHash: IntegrityHash
  orderId: OrderId
  logicalOrderKey: IntegrityHash
  instrumentId: InstrumentId
  mapping: BrokerInstrumentMapping
  side: BrokerSide
  product: DeliveryProduct
  orderType: 'LIMIT'
  quantity: Quantity
  limitPrice: Money
  validity: 'DAY'
  executionWindow: ExecutionWindow
  policySnapshotId: ExecutionPolicySnapshotId
  sequence: number
}>

export type SubmissionAttempt = Readonly<{
  submissionAttemptId: SubmissionAttemptId
  attemptNumber: number
  intentHash: IntegrityHash
  state: 'SUBMISSION_IN_FLIGHT' | SubmissionCertainty
  startedAt: Instant
  completedAt?: Instant
  failureCode?: DomainFailureCode
}>

export type BrokerOrderReference = Readonly<{
  brokerOrderReferenceId: BrokerOrderReferenceId
  brokerOrderId: string
  accountBindingId: BrokerAccountBindingId
  acknowledgedAt: Instant
}>

export type NormalizedFill = Readonly<{
  fillId: FillId
  portfolioId: PortfolioId
  orderId: OrderId
  executionRunId: ExecutionRunId
  instrumentId: InstrumentId
  side: BrokerSide
  product: DeliveryProduct
  quantity: Quantity
  price: Money
  charges: Money
  tradeTime: Instant
  brokerFillId?: string
  contentHash: IntegrityHash
}>

export type ReconciliationLink = Readonly<{
  reconciliationRunId: ReconciliationRunId
  snapshotId: ReconciliationSnapshotId
  state: ReconciliationState
  completedAt: Instant
}>

export type BrokerOrderSnapshot = Readonly<{
  brokerReference: BrokerOrderReference
  status: BrokerOrderStatus
  orderedQuantity: Quantity
  filledQuantity: Quantity
  openQuantity: Quantity
  averageFillPrice?: Money
  asOf: Instant
  cursor?: string
}>

export function isLiveExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'LIVE_ZERODHA' || mode === 'LIVE_SHAREKHAN'
}

export function allLiveGatesPass(snapshot: LiveEnablementSnapshot): boolean {
  return snapshot.environmentEnabled
    && snapshot.applicationEnabled
    && snapshot.portfolioEligible
    && snapshot.strategyEligible
    && snapshot.brokerAccountBound
    && snapshot.brokerCertified
    && snapshot.approvalCurrent
    && snapshot.reconciliationMatched
    && snapshot.sessionEligible
    && snapshot.riskPassed
    && snapshot.fullAutoEnabled === false
}
