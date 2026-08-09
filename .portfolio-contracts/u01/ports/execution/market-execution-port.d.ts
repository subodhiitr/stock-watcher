import type { DomainResult } from '../../domain/errors/result.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { BrokerAccountBindingId, CalendarSessionId, InstrumentId, QuoteSnapshotId } from '../../domain/shared/identifiers.ts';
import type { Instant, LocalDate } from '../../domain/shared/time.ts';
import type { BrokerInstrumentMapping, ExecutionQuoteSnapshot, ExecutionWindow } from '../../domain/execution/contracts.ts';
export type QuoteFetchRequest = Readonly<{
    snapshotId: QuoteSnapshotId;
    instrumentId: InstrumentId;
    /**
     * Content hash of the broker mapping snapshot used to route this quote
     * request.  The quote result must carry this hash so the gate can verify
     * the mapping has not changed between quote fetch and placement.
     */
    mappingSnapshotHash: IntegrityHash;
    /** Wall-clock deadline; quote fetch must complete before this instant. */
    deadlineAt: Instant;
}>;
/**
 * Execution quote port.
 *
 * Returns a fresh ExecutionQuoteSnapshot whose validationStatus is VALID and
 * whose staleAfter instant is in the future relative to the fetch time.
 * The quote must have been sourced within maximumQuoteAgeMs of the current
 * wall clock or the port must return a freshness failure.
 */
export interface ExecutionQuotePort {
    fetchQuote(request: QuoteFetchRequest): Promise<DomainResult<ExecutionQuoteSnapshot>>;
}
export type SessionStatusRequest = Readonly<{
    executionDate: LocalDate;
    /** Wall-clock instant at which the session check is being made. */
    checkAt: Instant;
    /** Wall-clock deadline for the session lookup. */
    deadlineAt: Instant;
}>;
/**
 * Confirmed session evidence returned when the session query succeeds.
 *
 * sameSessionAllowed is always false: the approval and execution run must
 * have been created in an earlier session than the one currently open.
 */
export type ConfirmedExecutionSession = Readonly<{
    calendarSessionId: CalendarSessionId;
    /** Time zone is always Asia/Kolkata — enforced by the port contract. */
    timeZone: 'Asia/Kolkata';
    sessionDate: LocalDate;
    window: ExecutionWindow;
    /**
     * True when the current wall-clock instant falls within the execution window
     * and the session is eligible for new placement.
     */
    withinWindow: boolean;
    sessionVerifiedAt: Instant;
}>;
/**
 * Execution session port.
 *
 * Validates that the requested execution date maps to an open Asia/Kolkata NSE
 * session and returns a ConfirmedExecutionSession with the window bounds.
 * The time zone is hard-coded to Asia/Kolkata and cannot be overridden.
 */
export interface ExecutionSessionPort {
    /**
     * Load the confirmed execution session for a given date.
     * Returns a failure if the date is not a valid NSE trading day or if the
     * session cannot be verified within deadlineAt.
     */
    loadSession(request: SessionStatusRequest): Promise<DomainResult<ConfirmedExecutionSession>>;
}
export type MappingLoadRequest = Readonly<{
    instrumentId: InstrumentId;
    accountBindingId: BrokerAccountBindingId;
    /**
     * The expected content hash of the mapping.  When present the port must
     * verify that the loaded mapping's snapshotHash matches this value.
     * Pass undefined for the initial load (no prior hash to verify against).
     */
    expectedSnapshotHash?: IntegrityHash;
    /** Wall-clock deadline for the mapping lookup. */
    deadlineAt: Instant;
}>;
export type MappingLoadResult = Readonly<{
    mapping: BrokerInstrumentMapping;
    /**
     * Canonical content hash of this mapping version.  Callers must pin this
     * hash at quote-fetch time and re-verify it immediately before placement.
     */
    snapshotHash: IntegrityHash;
    /** Time at which this mapping was last verified as current. */
    verifiedAt: Instant;
}>;
/**
 * Broker mapping port.
 *
 * Returns immutable instrument-to-broker mapping snapshots.  The mapping is
 * content-addressed: any change to broker symbol, exchange, product, or
 * account binding produces a new snapshotHash and invalidates all in-flight
 * approvals that pin the old hash.
 */
export interface BrokerMappingPort {
    /**
     * Load the current broker instrument mapping for an instrument and account.
     * When expectedSnapshotHash is supplied the port verifies hash equality and
     * returns a failure if the mapping has changed.
     */
    loadMapping(request: MappingLoadRequest): Promise<DomainResult<MappingLoadResult>>;
    /**
     * Load mappings for a set of instruments in one batch.
     * Batch size is bounded by the caller; each mapping is independently verified
     * when expectedSnapshotHash is supplied per instrument.
     */
    loadMappingBatch(requests: readonly MappingLoadRequest[]): Promise<DomainResult<readonly MappingLoadResult[]>>;
}
