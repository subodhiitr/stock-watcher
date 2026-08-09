import type { ApprovalId, AdjustmentProposalId, CancellationId, ExecutionRunId, FillId, InstrumentId, KillSwitchId, OrderId, PortfolioId, ReconciliationRunId, ReconciliationSnapshotId, ResidualWorkId, SubmissionAttemptId } from '../shared/identifiers.ts';
import type { Instant } from '../shared/time.ts';
import type { ApprovalState, ExecutionMode, ExecutionRunState, OrderState, ReconciliationState, SubmissionCertainty } from './contracts.ts';
import type { KillSwitchState } from './kill-switch.ts';
export type ApprovalEvidencePayload = Readonly<{
    kind: 'APPROVAL_DECIDED';
    portfolioId: PortfolioId;
    approvalId: ApprovalId;
    state: ApprovalState;
    mode: ExecutionMode;
    planHashPrefix: string;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type ExecutionRunEvidencePayload = Readonly<{
    kind: 'EXECUTION_RUN_STATE_CHANGED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    approvalId: ApprovalId;
    previousState: ExecutionRunState;
    newState: ExecutionRunState;
    mode: ExecutionMode;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type ExecutionRunPortfolioVersionEvidencePayload = Readonly<{
    kind: 'EXECUTION_RUN_PORTFOLIO_VERSION_ADVANCED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    previousPortfolioStateVersion: number;
    portfolioStateVersion: number;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type OrderIntentEvidencePayload = Readonly<{
    kind: 'ORDER_INTENT_RECORDED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    intentHashPrefix: string;
    sequence: number;
    side: 'BUY' | 'SELL';
    stateVersion: number;
    occurredAt: Instant;
}>;
export type SubmissionAttemptEvidencePayload = Readonly<{
    kind: 'SUBMISSION_ATTEMPT_STARTED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    submissionAttemptId: SubmissionAttemptId;
    attemptNumber: number;
    intentHashPrefix: string;
    occurredAt: Instant;
}>;
export type SubmissionOutcomeEvidencePayload = Readonly<{
    kind: 'SUBMISSION_OUTCOME_RECORDED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    submissionAttemptId: SubmissionAttemptId;
    certainty: SubmissionCertainty;
    orderState: OrderState;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type OrderStateChangedEvidencePayload = Readonly<{
    kind: 'ORDER_STATE_CHANGED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    previousState: OrderState;
    newState: OrderState;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type FillRecordedEvidencePayload = Readonly<{
    kind: 'FILL_RECORDED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    fillId: FillId;
    side: 'BUY' | 'SELL';
    filledQuantityShares: string;
    cumulativeQuantityShares: string;
    occurredAt: Instant;
}>;
export type PortfolioAccountingEvidencePayload = Readonly<{
    kind: 'PORTFOLIO_ACCOUNTING_CHANGED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    fillId?: FillId;
    instrumentId: InstrumentId;
    reason: 'SELL_RESERVATION' | 'BUY_FILL' | 'SELL_FILL';
    cashDeltaMinorUnits: string;
    holdingDeltaShares: string;
    reservedCashDeltaMinorUnits: string;
    reservedDeliveryDeltaShares: string;
    reservedQuantityDeltaShares: string;
    portfolioStateVersion: number;
    occurredAt: Instant;
}>;
export type CancellationEvidencePayload = Readonly<{
    kind: 'CANCELLATION_REQUESTED' | 'CANCELLATION_OUTCOME_RECORDED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    cancellationId: CancellationId;
    outcome?: 'ACKNOWLEDGED' | 'REJECTED' | 'UNKNOWN';
    occurredAt: Instant;
}>;
export type ReconciliationEvidencePayload = Readonly<{
    kind: 'RECONCILIATION_COMPLETED';
    portfolioId: PortfolioId;
    reconciliationRunId: ReconciliationRunId;
    state: ReconciliationState;
    differenceCount: number;
    occurredAt: Instant;
}>;
export type ReconciliationStateChangedEvidencePayload = Readonly<{
    kind: 'RECONCILIATION_STATE_CHANGED';
    portfolioId: PortfolioId;
    reconciliationRunId: ReconciliationRunId;
    previousState: ReconciliationState;
    newState: ReconciliationState;
    stateVersion: number;
    occurredAt: Instant;
}>;
export type ReconciliationSnapshotRecordedEvidencePayload = Readonly<{
    kind: 'RECONCILIATION_SNAPSHOT_RECORDED';
    portfolioId: PortfolioId;
    reconciliationRunId: ReconciliationRunId;
    snapshotId: ReconciliationSnapshotId;
    source: 'LOCAL' | 'PAPER' | 'ZERODHA' | 'SHAREKHAN';
    contentHashPrefix: string;
    occurredAt: Instant;
}>;
type KillSwitchEvidenceBase = Readonly<{
    killSwitchId: KillSwitchId;
    state: KillSwitchState;
    reasonCode: string;
    stateVersion: number;
    occurredAt: Instant;
}>;
type KillSwitchEvidenceScope = (Readonly<{
    scopeKind: 'PORTFOLIO';
    portfolioId: PortfolioId;
}> | Readonly<{
    scopeKind: 'GLOBAL';
    globalStreamId: 'GLOBAL_EXECUTION_CONTROL';
}>);
export type KillSwitchEvidencePayload = (KillSwitchEvidenceBase & KillSwitchEvidenceScope & Readonly<{
    kind: 'KILL_SWITCH_ACTIVATED';
}>) | (KillSwitchEvidenceBase & KillSwitchEvidenceScope & Readonly<{
    kind: 'KILL_SWITCH_RESET';
    authorizationEvidenceId: string;
    mfaEvidenceId: string;
    healthSnapshotHash: string;
    reconciliationSnapshotIds: readonly ReconciliationSnapshotId[];
}>);
export type RecoveryEvidencePayload = Readonly<{
    kind: 'RECOVERY_CLASSIFIED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    classification: 'SUBMISSION_IN_FLIGHT_RECLASSIFIED_UNKNOWN' | 'FILL_DEDUPLICATED' | 'AMBIGUITY_RETAINED';
    occurredAt: Instant;
}>;
export type ResidualWorkEvidencePayload = Readonly<{
    kind: 'RESIDUAL_WORK_RECORDED';
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    orderId: OrderId;
    residualWorkId: ResidualWorkId;
    remainingQuantityShares: string;
    reason: 'PARTIAL_FILL' | 'REJECTED' | 'CANCELLED' | 'EXPIRED' | 'PRICE_STALE' | 'CASH_REDUCED' | 'RECOVERY_REQUIRED';
    occurredAt: Instant;
}>;
export type AdjustmentProposalEvidencePayload = Readonly<{
    kind: 'ADJUSTMENT_PROPOSAL_RECORDED';
    portfolioId: PortfolioId;
    reconciliationRunId: ReconciliationRunId;
    adjustmentProposalId: AdjustmentProposalId;
    state: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED';
    stateVersion: number;
    occurredAt: Instant;
}>;
export type ExecutionEvidencePayload = ApprovalEvidencePayload | ExecutionRunEvidencePayload | ExecutionRunPortfolioVersionEvidencePayload | OrderIntentEvidencePayload | SubmissionAttemptEvidencePayload | SubmissionOutcomeEvidencePayload | OrderStateChangedEvidencePayload | FillRecordedEvidencePayload | PortfolioAccountingEvidencePayload | CancellationEvidencePayload | ReconciliationEvidencePayload | ReconciliationStateChangedEvidencePayload | ReconciliationSnapshotRecordedEvidencePayload | KillSwitchEvidencePayload | RecoveryEvidencePayload | ResidualWorkEvidencePayload | AdjustmentProposalEvidencePayload;
export type ExecutionEvidenceKind = ExecutionEvidencePayload['kind'];
export type ExecutionHealthEvidence = Readonly<{
    portfolioId: PortfolioId;
    executionRunId?: ExecutionRunId;
    activeOrderCount: number;
    unknownOrderCount: number;
    pendingFillCount: number;
    killSwitchActive: boolean;
    reconciliationState: ReconciliationState;
    asOf: Instant;
}>;
export type ExecutionProgressEvidence = Readonly<{
    portfolioId: PortfolioId;
    executionRunId: ExecutionRunId;
    totalOrders: number;
    plannedOrders: number;
    inFlightOrders: number;
    filledOrders: number;
    rejectedOrders: number;
    cancelledOrders: number;
    unknownOrders: number;
    residualOrders: number;
    asOf: Instant;
}>;
export declare function isKnownEvidenceKind(kind: string): kind is ExecutionEvidenceKind;
export declare function redactForEvidence(value: string): string;
export {};
