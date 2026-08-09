// Step 14: Normalized broker port — interfaces/types only; no SDK, credential,
// network, or implementation detail.
//
// BrokerRecoveryCapability is read-only: safe to call during kill-switch containment
// or after a crash without placement authority.
//
// BrokerPlacementCapability extends recovery and adds order placement and cancellation;
// it must never be constructed from user input (trusted-composition rule).
//
// All results carry explicit deadlines (supplied by caller), asOf timestamps (from the
// broker response), and four-way SubmissionCertainty.  Failures are redacted: no raw
// broker payloads, stack traces, account identifiers, or credentials.

import type { DomainFailureCode } from '../../domain/errors/failure.ts'
import type { DomainResult } from '../../domain/errors/result.ts'
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts'
import type {
  BrokerAccountBindingId,
  BrokerOrderReferenceId,
  CancellationId,
  OrderId,
  PortfolioId,
  ReconciliationSnapshotId,
  SubmissionAttemptId,
} from '../../domain/shared/identifiers.ts'
import type { Instant } from '../../domain/shared/time.ts'
import type {
  BrokerOrderReference,
  BrokerOrderSnapshot,
  NormalizedFill,
  OrderIntentPayload,
  SubmissionCertainty,
} from '../../domain/execution/contracts.ts'
import type {
  ReconciliationSnapshotRecord,
} from '../../domain/execution/reconciliation.ts'

// ── Redacted failure ─────────────────────────────────────────────────────────
// Contains only an allowlisted failure code and a short bounded description.
// Raw broker text, error objects, stack traces, account IDs, and credentials are
// never carried in this type.

export type RedactedBrokerFailure = Readonly<{
  /** Domain-catalog failure code — never a raw broker error string. */
  failureCode: DomainFailureCode
  /** Four-way certainty attached to this failure (always present). */
  certainty: SubmissionCertainty
  /** Short bounded description drawn from a fixed allowlist; max 120 chars. */
  redactedDetail: string
}>

// ── Placement ────────────────────────────────────────────────────────────────

export type PlacementRequest = Readonly<{
  submissionAttemptId: SubmissionAttemptId
  orderId: OrderId
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  intent: OrderIntentPayload
  /** Wall-clock deadline; broker call must complete before this instant. */
  deadlineAt: Instant
}>

export type PlacementResult = Readonly<{
  submissionAttemptId: SubmissionAttemptId
  /**
   * Four-way certainty:
   *   ACKNOWLEDGED        – broker reference present; order is live.
   *   REJECTED            – broker proved the order was not accepted.
   *   DEFINITELY_NOT_SENT – transport failure before any network bytes left;
   *                         retry is safe with same idempotency key.
   *   UNKNOWN             – ambiguous; placement disabled; recovery required.
   */
  certainty: SubmissionCertainty
  /** Present only when certainty is ACKNOWLEDGED. */
  brokerReference?: BrokerOrderReference
  attemptedAt: Instant
  completedAt: Instant
  /** Present when certainty is REJECTED or UNKNOWN. */
  failure?: RedactedBrokerFailure
}>

// ── Cancellation ─────────────────────────────────────────────────────────────

export type CancellationRequest = Readonly<{
  cancellationId: CancellationId
  orderId: OrderId
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  brokerOrderReferenceId: BrokerOrderReferenceId
  /** Wall-clock deadline; broker call must complete before this instant. */
  deadlineAt: Instant
}>

export type CancellationResult = Readonly<{
  cancellationId: CancellationId
  /**
   * ACKNOWLEDGED – broker accepted the cancel request.
   * REJECTED     – broker refused (e.g. already filled).
   * UNKNOWN      – ambiguous; reconciliation must determine final state.
   */
  outcome: 'ACKNOWLEDGED' | 'REJECTED' | 'UNKNOWN'
  brokerAsOf: Instant
  completedAt: Instant
  failure?: RedactedBrokerFailure
}>

// ── Order status ─────────────────────────────────────────────────────────────

export type OrderStatusRequest = Readonly<{
  orderId: OrderId
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  brokerOrderReferenceId: BrokerOrderReferenceId
  /** Wall-clock deadline; broker call must complete before this instant. */
  deadlineAt: Instant
}>

export type OrderStatusResult = Readonly<{
  orderId: OrderId
  snapshot: BrokerOrderSnapshot
  /** Broker-reported time of the status response. */
  asOf: Instant
  /** Pagination cursor for incremental fill collection; opaque to domain. */
  cursor?: string
}>

// ── Fill collection ───────────────────────────────────────────────────────────

export type FillCollectionRequest = Readonly<{
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  /** Resume cursor from previous collection; absent means start from beginning. */
  fromCursor?: string
  /** Wall-clock deadline; collection must complete before this instant. */
  deadlineAt: Instant
}>

export type FillCollectionResult = Readonly<{
  fills: readonly NormalizedFill[]
  /** Cursor for the next page; absent means collection is complete. */
  nextCursor?: string
  /** Broker-reported time at which this snapshot was captured. */
  asOf: Instant
  /**
   * True when all endpoint timestamps fall within the allowed reconciliation
   * skew window or a coherent cursor was supplied; false triggers re-collection.
   */
  coherent: boolean
}>

// ── Reconciliation snapshot collection ───────────────────────────────────────

export type ReconciliationSnapshotRequest = Readonly<{
  snapshotId: ReconciliationSnapshotId
  portfolioId: PortfolioId
  accountBindingId: BrokerAccountBindingId
  /** Resume cursor from a previous partial collection. */
  fromCursor?: string
  /** Wall-clock deadline for the complete collection. */
  deadlineAt: Instant
  /** Content hash of the expected mapping snapshot for immutability verification. */
  mappingSnapshotHash: IntegrityHash
}>

export type ReconciliationSnapshotResponse = Readonly<{
  snapshot: ReconciliationSnapshotRecord
  /** True when the snapshot passed coherence verification. */
  coherent: boolean
}>

// ── Capability interfaces ────────────────────────────────────────────────────

/**
 * Read-only recovery capability.
 *
 * Safe to inject during kill-switch containment, crash recovery, or any context
 * where placement authority must be withheld.  Implementations must not accept
 * credentials, perform writes, or expose broker account details.
 */
export interface BrokerRecoveryCapability {
  /** Fetch the current live status of a previously placed order. */
  fetchOrderStatus(
    request: OrderStatusRequest,
  ): Promise<DomainResult<OrderStatusResult>>

  /** Collect a page of normalized fills with cursor-based pagination. */
  collectFills(
    request: FillCollectionRequest,
  ): Promise<DomainResult<FillCollectionResult>>

  /**
   * Collect a full reconciliation snapshot including holdings, cash, open orders,
   * and fills.  Used by the reconciliation service outside synchronous transactions.
   */
  collectReconciliationSnapshot(
    request: ReconciliationSnapshotRequest,
  ): Promise<DomainResult<ReconciliationSnapshotResponse>>
}

/**
 * Full broker capability: placement and cancellation in addition to recovery reads.
 *
 * Must never be constructed from user input.  Trusted composition selects
 * paper/dry-run/live capabilities explicitly; commands cannot name an adapter.
 */
export interface BrokerPlacementCapability extends BrokerRecoveryCapability {
  /**
   * Submit a limit order.  Returns four-way certainty.
   * DEFINITELY_NOT_SENT is the only certainty that permits a safe retry.
   */
  placeOrder(
    request: PlacementRequest,
  ): Promise<DomainResult<PlacementResult>>

  /**
   * Request cancellation.  Outcome may be ACKNOWLEDGED, REJECTED, or UNKNOWN.
   * An UNKNOWN outcome requires reconciliation to determine the final state.
   */
  cancelOrder(
    request: CancellationRequest,
  ): Promise<DomainResult<CancellationResult>>
}
