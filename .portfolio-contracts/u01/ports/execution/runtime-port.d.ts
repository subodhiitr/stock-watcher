import type { AdjustmentProposalId, ApprovalId, CancellationId, EvidenceId, ExecutionPolicySnapshotId, ExecutionRunId, FillId, IdempotencyKey, KillSwitchId, OrderId, PortfolioId, QuoteSnapshotId, ReconciliationRunId, ReconciliationSnapshotId, ResidualWorkId, SubmissionAttemptId } from '../../domain/shared/identifiers.ts';
import type { DomainResult } from '../../domain/errors/result.ts';
import type { Instant, LocalDate } from '../../domain/shared/time.ts';
/**
 * Wall-clock port.
 *
 * Injected into application services so that time reads are testable with a
 * fake clock.  The time zone for LocalDate is always Asia/Kolkata when used
 * within execution window evaluation.
 */
export interface ExecutionClockPort {
    /** Current wall-clock instant as an ISO-8601 string. */
    now(): Instant;
    /** Current calendar date in the Asia/Kolkata time zone. */
    today(): LocalDate;
}
/**
 * Monotonic time port.
 *
 * Returns a monotonically non-decreasing counter in milliseconds.  Suitable
 * for deadline elapsed-time checks and performance measurements.  The absolute
 * value has no meaning; only differences are significant.
 *
 * Must not be affected by system clock adjustments or leap seconds.
 */
export interface MonotonicTimePort {
    /** Current monotonic count in milliseconds. */
    nowMs(): number;
}
/**
 * Handle returned by BoundedTimerPort.schedule.
 * Callers must hold the handle and call cancel() when the timer is no longer
 * needed (e.g. after the awaited work completes).
 */
export interface BoundedTimerHandle {
    /** Cancel the timer if it has not yet fired.  Safe to call multiple times. */
    cancel(): void;
    /** True if the timer has already fired or been cancelled. */
    readonly done: boolean;
}
export type TimerCallback = () => void;
/**
 * Bounded timer port.
 *
 * Application services use this to schedule status-poll intervals and
 * deadline sentinels.  All timers must have a finite upper bound; timers
 * that would fire beyond maxDelayMs are refused.
 *
 * The maximum delay is set by the caller, not the implementation, so that
 * application-layer constants (U05_READ_DEADLINE_MAX_MS etc.) govern timer
 * bounds rather than an infrastructure default.
 */
export interface BoundedTimerPort {
    /**
     * Schedule a one-shot callback after delayMs milliseconds.
     *
     * @param callback   — called once when the delay elapses.
     * @param delayMs    — delay in milliseconds; must be > 0.
     * @param maxDelayMs — upper bound enforced by this port; schedule fails if
     *                     delayMs > maxDelayMs.
     * @returns A typed failure when the requested delay is invalid or unbounded.
     */
    schedule(callback: TimerCallback, delayMs: number, maxDelayMs: number): DomainResult<BoundedTimerHandle>;
    /**
     * Return a Promise that resolves after delayMs milliseconds.
     * The timer is bounded by the same maxDelayMs contract as schedule().
     */
    delay(delayMs: number, maxDelayMs: number): Promise<DomainResult<void>>;
}
/**
 * Deterministic seed port.
 *
 * Provides a seedable pseudo-random number generator for the paper broker
 * adapter and deterministic test scenarios.  The seed is injected at
 * composition time and must not depend on wall-clock entropy or OS PRNG.
 *
 * In production paper mode a fresh seed is generated once per execution run
 * and persisted alongside the run so that replays are reproducible.
 */
export interface DeterministicSeedPort {
    /**
     * The seed value used to initialise this PRNG instance.
     * Stored alongside the execution run for deterministic replay.
     */
    readonly seed: number;
    /**
     * Return the next pseudo-random number in [0, 1).
     * Successive calls on the same seed produce the same sequence.
     */
    nextFloat(): number;
    /**
     * Return the next integer in [min, max] (inclusive on both ends).
     * Throws if min > max.
     */
    nextInt(min: number, max: number): number;
}
/**
 * U05 identifier factory.
 *
 * Centralises all U05 identifier generation behind an injectable interface so
 * that tests can supply deterministic IDs without patching global state.
 *
 * Each method returns a freshly generated, globally unique identifier of the
 * appropriate branded type.  Implementations must use a cryptographically
 * appropriate source of entropy (UUID v4 or equivalent).
 */
export interface ExecutionIdentifierFactory {
    portfolioId(): PortfolioId;
    approvalId(): ApprovalId;
    executionRunId(): ExecutionRunId;
    orderId(): OrderId;
    submissionAttemptId(): SubmissionAttemptId;
    fillId(): FillId;
    cancellationId(): CancellationId;
    reconciliationRunId(): ReconciliationRunId;
    reconciliationSnapshotId(): ReconciliationSnapshotId;
    residualWorkId(): ResidualWorkId;
    killSwitchId(): KillSwitchId;
    adjustmentProposalId(): AdjustmentProposalId;
    quoteSnapshotId(): QuoteSnapshotId;
    executionPolicySnapshotId(): ExecutionPolicySnapshotId;
    idempotencyKey(): IdempotencyKey;
    evidenceId(): EvidenceId;
}
