import type { AllGatesContext } from '../../domain/execution/execution-gate.ts';
import type { ApprovalBinding, OrderIntentPayload, SubmissionAttempt } from '../../domain/execution/contracts.ts';
import type { ExecutionRunPortfolioVersionEvidencePayload, PortfolioAccountingEvidencePayload } from '../../domain/execution/evidence.ts';
import { type ExecutionOrderSnapshot } from '../../domain/execution/execution-order.ts';
import type { ExecutionRunSnapshot } from '../../domain/execution/execution-run.ts';
import { type AnyDomainFailure, type DomainResult } from '../../domain/errors/result.ts';
import type { IntegrityHash } from '../../domain/portfolio/evidence.ts';
import type { BrokerAccountBindingId } from '../../domain/shared/identifiers.ts';
import type { Instant } from '../../domain/shared/time.ts';
import type { KillSwitchScope } from '../../domain/execution/kill-switch.ts';
import type { BrokerPlacementCapability, PlacementResult } from '../../ports/execution/broker-port.ts';
import type { CommittedExecutionResult, ExecutionTransaction, ExecutionUnitOfWork } from '../../ports/execution/execution-unit-of-work.ts';
import type { ExecutionClockPort, ExecutionIdentifierFactory } from '../../ports/execution/runtime-port.ts';
export interface PlacementReservation {
    reserve(transaction: ExecutionTransaction, order: ExecutionOrderSnapshot, intent: OrderIntentPayload): DomainResult<Readonly<{
        order: ExecutionOrderSnapshot;
        accountingEvidence?: PortfolioAccountingEvidencePayload;
        run?: ExecutionRunSnapshot;
        runEvidence?: ExecutionRunPortfolioVersionEvidencePayload;
    }>, AnyDomainFailure>;
}
export type DispatchAdmissionIdentity = Readonly<{
    scope: KillSwitchScope;
    portfolioId: ExecutionOrderSnapshot['portfolioId'];
    executionRunId: ExecutionOrderSnapshot['executionRunId'];
    orderId: ExecutionOrderSnapshot['orderId'];
    submissionAttemptId: SubmissionAttempt['submissionAttemptId'];
    clientIdentity: Readonly<{
        idempotencyKey: ExecutionOrderSnapshot['idempotencyKey'];
        intentHash: IntegrityHash;
    }>;
}>;
export type UnresolvedDispatchAdmission = Readonly<{
    admission: DispatchAdmissionIdentity;
    brokerDispatched: boolean;
    failureCode: string;
}>;
export type DispatchOperationResult<T> = Readonly<{
    kind: 'OUTCOME_PERSISTED';
    value: T;
}> | Readonly<{
    kind: 'OUTCOME_UNRESOLVED';
    unresolved: UnresolvedDispatchAdmission;
    failure: AnyDomainFailure;
}>;
export type DispatchFenceClosureToken = Readonly<{
    closureId: string;
}>;
export type DispatchFenceResult<T> = Readonly<{
    admitted: false;
}> | Readonly<{
    admitted: true;
    outcome: DispatchOperationResult<T>;
}>;
export type DispatchFenceDrainResult = Readonly<{
    closure: DispatchFenceClosureToken;
    unresolvedAdmissions: readonly UnresolvedDispatchAdmission[];
}>;
export interface ExecutionDispatchFence {
    /**
     * Atomically admits or refuses the operation. closeAndDrain prevents new
     * admissions and waits for active operations to report either persisted or
     * unresolved. A failed result proves the operation was not admitted. An
     * admitted operation is released only with OUTCOME_PERSISTED;
     * OUTCOME_UNRESOLVED remains retained and is surfaced by closeAndDrain.
     */
    execute<T>(admission: DispatchAdmissionIdentity, operation: () => Promise<DispatchOperationResult<T>>): Promise<DomainResult<DispatchFenceResult<T>, AnyDomainFailure>>;
    closeAndDrain(scope: KillSwitchScope): Promise<DomainResult<DispatchFenceDrainResult, AnyDomainFailure>>;
    resolveAdmission(admission: DispatchAdmissionIdentity, validateResolved: () => DomainResult<void, AnyDomainFailure>): Promise<DomainResult<void, AnyDomainFailure>>;
    /** Serializes the authoritative validator with admission and later closes. */
    open(scope: KillSwitchScope, closure: DispatchFenceClosureToken, validateCurrent: () => DomainResult<void, AnyDomainFailure>): Promise<DomainResult<void, AnyDomainFailure>>;
}
export type TerminalReservationReleaseResult = Readonly<{
    order: ExecutionOrderSnapshot;
    accountingEvidence?: PortfolioAccountingEvidencePayload;
    run?: ExecutionRunSnapshot;
    runEvidence?: ExecutionRunPortfolioVersionEvidencePayload;
}>;
export interface TerminalReservationRelease {
    release(transaction: ExecutionTransaction, order: ExecutionOrderSnapshot): DomainResult<TerminalReservationReleaseResult, AnyDomainFailure>;
}
export declare function validateTerminalReservationRelease(priorOrder: ExecutionOrderSnapshot, terminalOrder: ExecutionOrderSnapshot, priorRun: ExecutionRunSnapshot, result: TerminalReservationReleaseResult): DomainResult<TerminalReservationReleaseResult, AnyDomainFailure>;
export type PlaceOrderCommand = Readonly<{
    order: ExecutionOrderSnapshot;
    intent: OrderIntentPayload;
    intentHash: IntegrityHash;
    accountBindingId: BrokerAccountBindingId;
    deadlineAt: Instant;
    gates: AllGatesContext;
}>;
export type DispatchGateSnapshot = Pick<AllGatesContext, 'liveEnablement' | 'executionWindow' | 'quote' | 'preTradeRisk'> & Readonly<{
    currentPlanHash: IntegrityHash;
    currentPlanInputHash: IntegrityHash;
    strategyVersionId: ApprovalBinding['strategyVersionId'];
    strategyConfigHash: IntegrityHash;
    policySnapshotId: ExecutionRunSnapshot['policySnapshotId'];
    reconciliationSnapshotId: ApprovalBinding['reconciliationSnapshotId'];
    maximumQuoteAgeMs: number;
}>;
export interface DispatchGateRefresh {
    refresh(command: Readonly<{
        order: ExecutionOrderSnapshot;
        intent: OrderIntentPayload;
        accountBindingId: BrokerAccountBindingId;
        deadlineAt: Instant;
    }>): Promise<DomainResult<DispatchGateSnapshot, AnyDomainFailure>>;
}
export type PlacementCoordinatorResult = Readonly<{
    order: ExecutionOrderSnapshot;
    brokerCallMade: boolean;
    certainty?: PlacementResult['certainty'];
}>;
export declare class PlacementCoordinator {
    private readonly unitOfWork;
    private readonly broker;
    private readonly reservation;
    private readonly ids;
    private readonly clock;
    private readonly terminalRelease;
    private readonly dispatchFence;
    private readonly dispatchGateRefresh;
    constructor(unitOfWork: ExecutionUnitOfWork, broker: BrokerPlacementCapability, reservation: PlacementReservation, terminalRelease: TerminalReservationRelease, dispatchFence: ExecutionDispatchFence, ids: ExecutionIdentifierFactory, dispatchGateRefresh: DispatchGateRefresh, clock: ExecutionClockPort);
    place(command: PlaceOrderCommand): Promise<DomainResult<CommittedExecutionResult<PlacementCoordinatorResult>, AnyDomainFailure>>;
    private loadAuthority;
    private persistOutcome;
    private normalizePlacement;
    private definitelyNotDispatched;
    private isPlacementFailureCode;
    private unresolvedDispatch;
}
