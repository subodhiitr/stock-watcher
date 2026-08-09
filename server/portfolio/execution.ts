export {
  APPROVAL_STATES,
  BROKER_ORDER_STATUSES,
  EXECUTION_MODES,
  EXECUTION_RUN_STATES,
  ORDER_STATES,
  RECONCILIATION_REASONS,
  RECONCILIATION_STATES,
  SUBMISSION_CERTAINTIES,
  allLiveGatesPass,
  isLiveExecutionMode,
  type ApprovalBinding,
  type ApprovalPriceBound,
  type ApprovalState,
  type BrokerInstrumentMapping,
  type BrokerOrderReference,
  type BrokerOrderSnapshot,
  type BrokerOrderStatus,
  type BrokerSide,
  type DeliveryProduct,
  type ExecutionMode,
  type ExecutionPolicySnapshot,
  type ExecutionQuoteSnapshot,
  type ExecutionRunState,
  type ExecutionWindow,
  type LiveEnablementSnapshot,
  type NormalizedFill,
  type OrderIntentPayload,
  type OrderState,
  type ReconciliationLink,
  type ReconciliationReason,
  type ReconciliationState,
  type SubmissionAttempt,
  type SubmissionCertainty,
} from './domain/execution/contracts.ts'
export type {
  ApprovalDecisionSnapshot,
  DecisionKind,
} from './domain/execution/approval.ts'
export type { ExecutionRunSnapshot } from './domain/execution/execution-run.ts'
export type {
  CancellationAttemptRecord,
  CancellationOutcome,
  CancellationOutcomeRecord,
  ExecutionOrderSnapshot,
} from './domain/execution/execution-order.ts'
export type {
  DifferenceKind,
  DifferenceResolution,
  DifferenceSeverity,
  ReconciledHolding,
  ReconciliationDifference,
  ReconciliationRunSnapshot,
  ReconciliationSnapshotRecord,
} from './domain/execution/reconciliation.ts'
export type {
  KillSwitchActivation,
  KillSwitchReset,
  KillSwitchScope,
  KillSwitchSnapshot,
  KillSwitchState,
} from './domain/execution/kill-switch.ts'
export type {
  AdjustmentProposal,
  AdjustmentProposalState,
  ResidualWork,
  ResidualWorkReason,
} from './domain/execution/residual-and-adjustment.ts'
export type {
  ExecutionEvidenceKind,
  ExecutionEvidencePayload,
  ExecutionHealthEvidence,
  ExecutionProgressEvidence,
} from './domain/execution/evidence.ts'

export type {
  BrokerPlacementCapability,
  BrokerRecoveryCapability,
  CancellationRequest,
  CancellationResult,
  FillCollectionRequest,
  FillCollectionResult,
  OrderStatusRequest,
  OrderStatusResult,
  PlacementRequest,
  PlacementResult,
  ReconciliationSnapshotRequest,
  ReconciliationSnapshotResponse,
  RedactedBrokerFailure,
} from './ports/execution/broker-port.ts'
export type {
  BoundedTimerHandle,
  BoundedTimerPort,
  DeterministicSeedPort,
  ExecutionClockPort,
  ExecutionIdentifierFactory,
  MonotonicTimePort,
  TimerCallback,
} from './ports/execution/runtime-port.ts'
export type {
  BrokerMappingPort,
  ConfirmedExecutionSession,
  ExecutionQuotePort,
  ExecutionSessionPort,
  MappingLoadRequest,
  MappingLoadResult,
  QuoteFetchRequest,
  SessionStatusRequest,
} from './ports/execution/market-execution-port.ts'
export type {
  CommittedExecutionResult,
  ExecutionTransaction,
  KillSwitchResetEligibilityToken,
} from './ports/execution/execution-unit-of-work.ts'

export { ApprovalService } from './application/execution/approval-service.ts'
export type { ApprovalDecisionCommand } from './application/execution/approval-service.ts'
export { ExecutionRunService } from './application/execution/execution-run-service.ts'
export type {
  CreateExecutionRunCommand,
  CreatedExecutionRun,
} from './application/execution/execution-run-service.ts'
export { PlacementCoordinator } from './application/execution/placement-coordinator.ts'
export type {
  DispatchGateRefresh,
  DispatchGateSnapshot,
  ExecutionDispatchFence,
  PlaceOrderCommand,
  PlacementCoordinatorResult,
  PlacementReservation,
  TerminalReservationRelease,
} from './application/execution/placement-coordinator.ts'
export { StatusFillCoordinator } from './application/execution/status-fill-coordinator.ts'
export type {
  AtomicFillAccounting,
  CheckOrderCommand,
  FillAccountingContext,
  StatusFillCheckResult,
} from './application/execution/status-fill-coordinator.ts'
export { CancellationCoordinator } from './application/execution/cancellation-coordinator.ts'
export type {
  CancelOrderCommand,
  ConfirmCancellationCommand,
} from './application/execution/cancellation-coordinator.ts'
export { ReconciliationService } from './application/execution/reconciliation-service.ts'
export type {
  MissingFillApplier,
  ReconcileCommand,
  ReconciliationComparator,
} from './application/execution/reconciliation-service.ts'
export { RecoveryService } from './application/execution/recovery-service.ts'
export type {
  RecoverPortfolioCommand,
  RecoveryPreflight,
  RecoveryResult,
} from './application/execution/recovery-service.ts'
export { KillSwitchService } from './application/execution/kill-switch-service.ts'
export type {
  ActivateKillSwitchCommand,
  KillSwitchActivationResult,
  ResetKillSwitchCommand,
} from './application/execution/kill-switch-service.ts'
export { ExecutionCoordinator } from './application/execution/execution-coordinator.ts'
export type { AdvanceExecutionCommand } from './application/execution/execution-coordinator.ts'
export { composeTrustedExecutionBroker } from './application/execution/trusted-composition.ts'
export type {
  TrustedBrokerComposition,
  TrustedBrokerSelection,
} from './application/execution/trusted-composition.ts'

export {
  DeterministicPaperBroker,
  ImmediatePaperFillPolicy,
} from './adapters/broker/paper-broker.ts'
export type {
  PaperAccountSeed,
  PaperFillDecision,
  PaperFillPolicy,
} from './adapters/broker/paper-broker.ts'
export { DryRunBroker } from './adapters/broker/dry-run-broker.ts'
export type { DryRunRecord } from './adapters/broker/dry-run-broker.ts'
export { BrokerResilienceGovernor } from './adapters/broker/broker-resilience-governor.ts'
export type {
  BrokerResilienceConfiguration,
} from './adapters/broker/broker-resilience-governor.ts'
