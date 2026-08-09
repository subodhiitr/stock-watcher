export {
  DOMAIN_EVENT_SCHEMA_VERSION,
  INR_CURRENCY,
  MAX_HOLDINGS,
  MAX_IDENTIFIER_LENGTH,
  MAX_OPEN_LOTS,
  MAX_PORTFOLIO_NAME_LENGTH,
  MAX_STRATEGY_SLEEVES,
  WEIGHT_SCALE,
} from './domain/shared/constants.ts'

export {
  DOMAIN_FAILURE_CODES,
  domainFailure,
} from './domain/errors/failure.ts'
export { DomainInvariantError } from './domain/errors/invariant-error.ts'
export { failure, success } from './domain/errors/result.ts'
export { createSafeContext } from './domain/errors/safe-context.ts'

export {
  compareIdentifiers,
  parseActorId,
  parseAllocationId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseIdempotencyKey,
  parseInstrumentId,
  parseOrderId,
  parsePortfolioId,
  parseRebalanceRunId,
  parseStrategyAssignmentId,
  parseStrategyId,
  parseStrategySleeveId,
  parseStrategyVersionId,
  redactIdentifier,
} from './domain/shared/identifiers.ts'
export {
  compareInstants,
  parseInstant,
  parseLocalDate,
} from './domain/shared/time.ts'
export { createCommandContext } from './domain/shared/command-context.ts'
export {
  addMoney,
  createMoney,
  moneyEquals,
  parseMoney,
  serializeMoney,
  subtractMoney,
} from './domain/shared/money.ts'
export {
  addQuantities,
  createQuantity,
  parseQuantity,
  serializeQuantity,
  subtractQuantities,
} from './domain/shared/quantity.ts'
export {
  FULL_WEIGHT,
  createWeight,
  parseWeight,
  serializeWeight,
} from './domain/shared/weight.ts'
export {
  convertScaledRate,
  createScaledRate,
  parseScaledRate,
  scaledRateEquals,
  serializeScaledRate,
} from './domain/shared/scaled-rate.ts'
export {
  INITIAL_PORTFOLIO_STATE_VERSION,
  NO_PORTFOLIO_STATE_VERSION,
  createPortfolioStateVersion,
  nextPortfolioStateVersion,
  parsePortfolioStateVersion,
  serializePortfolioStateVersion,
} from './domain/shared/state-version.ts'

export {
  OPERATING_MODES,
  createModeTransitionEvidence,
  createStrategyEligibilityEvidence,
  isOperatingMode,
  parseIntegrityHash,
  validateModeEvidence,
  validateStrategyEvidence,
} from './domain/portfolio/evidence.ts'
export {
  allocationPoliciesEqual,
  allocationPolicyIdentity,
  createMultiSleeveAllocation,
  createSingleStrategyAllocation,
  validateStrategyAllocationPolicy,
} from './domain/portfolio/strategy-allocation.ts'
export { createHoldingLot } from './domain/portfolio/holding-lot.ts'
export { createHolding } from './domain/portfolio/holding.ts'
export {
  validatePortfolioIntegrity,
  validateTargetedTransition,
} from './domain/portfolio/integrity.ts'
export {
  Portfolio,
} from './domain/portfolio/portfolio.ts'
export { createPortfolioName } from './domain/portfolio/portfolio-name.ts'

export {
  freezeDomainEvent,
  hasValidEventAggregateBinding,
} from './domain/events/domain-events.ts'
export {
  parseDomainEvent,
  serializeDomainEvent,
} from './domain/events/codecs.ts'

export type {
  DomainFailure,
  DomainFailureCode,
  Retryability,
} from './domain/errors/failure.ts'
export type {
  AnyDomainFailure,
  DomainError,
  DomainResult,
  DomainSuccess,
} from './domain/errors/result.ts'
export type {
  SafeContext,
  SafeContextValue,
} from './domain/errors/safe-context.ts'
export type {
  ActorId,
  AllocationId,
  BrandedIdentifier,
  CausationId,
  CommandId,
  CorrelationId,
  EventId,
  EvidenceId,
  HoldingId,
  HoldingLotId,
  IdempotencyKey,
  InstrumentId,
  OrderId,
  PortfolioId,
  RebalanceRunId,
  StrategyAssignmentId,
  StrategyId,
  StrategySleeveId,
  StrategyVersionId,
} from './domain/shared/identifiers.ts'
export type { Instant, LocalDate } from './domain/shared/time.ts'
export type { CommandContext } from './domain/shared/command-context.ts'
export type { Money, MoneyJson } from './domain/shared/money.ts'
export type { Quantity, QuantityJson } from './domain/shared/quantity.ts'
export type { Weight, WeightJson } from './domain/shared/weight.ts'
export type { ScaledRate, ScaledRateJson } from './domain/shared/scaled-rate.ts'
export type { PortfolioStateVersion } from './domain/shared/state-version.ts'
export type {
  IntegrityHash,
  ModeEvidenceKind,
  ModeTransitionEvidence,
  OperatingMode,
  StrategyEligibilityEvidence,
} from './domain/portfolio/evidence.ts'
export type {
  MultiSleeveAllocation,
  SingleStrategyAllocation,
  SleeveAssignment,
  StrategyAllocationPolicy,
} from './domain/portfolio/strategy-allocation.ts'
export type {
  HoldingLot,
  LotSourceKind,
  LotSourceReference,
} from './domain/portfolio/holding-lot.ts'
export type { Holding, HoldingInput } from './domain/portfolio/holding.ts'
export type {
  PortfolioIntegrityState,
  PortfolioStatus,
} from './domain/portfolio/integrity.ts'
export type {
  PortfolioSnapshot,
} from './domain/portfolio/portfolio.ts'
export type { PortfolioName } from './domain/portfolio/portfolio-name.ts'
export type {
  ArchivePortfolioCommand,
  ChangePortfolioModeCommand,
  CreatePortfolioCommand,
  PortfolioCommand,
  ReplaceStrategyAllocationCommand,
  Transition,
} from './domain/portfolio/commands.ts'
export type {
  DomainEventEnvelope,
  PortfolioArchived,
  PortfolioCreated,
  PortfolioDomainEvent,
  PortfolioDomainEventType,
  PortfolioModeChanged,
  StrategyAllocationChanged,
} from './domain/events/domain-events.ts'
export type {
  ClockPort,
  CommittedDomainResult,
  CommittedEventHandler,
  IdentifierFactory,
  InternalEventBus,
  PortfolioRepository,
  PortfolioTransaction,
  PortfolioUnitOfWork,
  StrategyEvidencePort,
} from './ports/index.ts'

export {
  RejectingEncryptionAttestation,
  TemporaryTestEncryptionAttestation,
  defaultPortfolioDatabaseConfiguration,
  openPortfolioDatabase,
  type DatabaseOwnerMode,
  type EncryptionAttestation,
  type EncryptionAttestationPort,
  type EncryptionProtection,
  type EncryptionPurpose,
  type PersistenceFailure,
  type PersistenceFailureCode,
  type PersistenceResult,
  type PortfolioBackupReceipt,
  type PortfolioDatabaseConfiguration,
  type PortfolioDatabaseOwner,
  type PortfolioDatabaseHealth,
  type ExecutionUnitOfWork,
} from './infrastructure/persistence/index.ts'

// ── U03: Strategy, Data, and Research ──────────────────────────────────────
// Domain – shared identifiers (U03 additions)
export type { BacktestRunId, DataVersionId, DataRecordId, CorporateActionId, StrategyVersionEventId } from './domain/shared/identifiers.ts'
export {
  parseBacktestRunId,
  parseDataVersionId,
  parseDataRecordId,
  parseCorporateActionId,
  parseStrategyVersionEventId,
} from './domain/shared/identifiers.ts'

// Domain – strategy constants and config
export {
  MAX_UNIVERSE_SIZE, MAX_FACTOR_COMPONENTS_MOMENTUM, MAX_FACTOR_COMPONENTS_QUALITY, MAX_FACTOR_COMPONENTS_RISK,
  WEIGHT_SCALE_PPM, WEIGHT_SUM_TOLERANCE_PPM, CONVICTION_MIN, CONVICTION_MAX, DEFAULT_REGIME_CONFIRMATION_WEAKENING,
  DEFAULT_REGIME_CONFIRMATION_STRENGTHENING, MIN_BACKTEST_YEARS, MIN_TRADING_DAYS_PER_YEAR, MIN_WALKFORWARD_FOLDS,
  DATA_COMPLETENESS_THRESHOLD_PCT, AI_PERMITTED_OPERATIONS, AI_ADVISORY_CONSTANTS, DEFAULT_CB_FAILURE_THRESHOLD,
  DEFAULT_CB_COOLDOWN_MS, DEFAULT_PROVIDER_DEADLINE_MS, DEFAULT_MAX_RETRIES,
} from './domain/strategy/constants.ts'
export { createStrategyConfig, strategyConfigsEqual, type StrategyConfig } from './domain/strategy/strategy-config.ts'
export {
  SHORT_HORIZON_PRESET,
  MEDIUM_HORIZON_PRESET,
  LONG_HORIZON_PRESET,
} from './domain/strategy/strategy-presets.ts'

// Domain – market data
export type { DataProvider, DataValidationStatus, DataProvenance } from './domain/market-data/data-provenance.ts'
export { createDataProvenance, isProductionQualitySource, PRODUCTION_QUALITY_SOURCES } from './domain/market-data/data-provenance.ts'
export type { MarketDataType, MarketDataRecord } from './domain/market-data/market-data-record.ts'
export { createMarketDataRecord } from './domain/market-data/market-data-record.ts'
export type { CompletenessCheck, DataVersionSnapshot } from './domain/market-data/data-version-snapshot.ts'
export { createDataVersionSnapshot } from './domain/market-data/data-version-snapshot.ts'

// Domain – eligibility
export type { EligibilityRuleId, EligibilityStatus, EligibilityResult, RiskFlag } from './domain/strategy/eligibility-result.ts'
export { createEligibilityResult, createRiskFlag } from './domain/strategy/eligibility-result.ts'

// Domain – signals
export type { MomentumComponents, QualityComponents, BfsiQualityComponents, RiskComponents, SignalSnapshot } from './domain/strategy/signal-snapshot.ts'
export { createSignalSnapshot } from './domain/strategy/signal-snapshot.ts'

// Domain – regime
export type { RegimeCategory, RegimeIndicators, RegimeState } from './domain/strategy/regime-state.ts'
export { createRegimeState, isFailClosedTowardsCrisis } from './domain/strategy/regime-state.ts'

// Domain – corporate actions
export type { CorporateActionType, CorporateActionStatus, CorporateActionImpact, CorporateAction } from './domain/strategy/corporate-action.ts'
export { createCorporateAction, applyCorporateActionTransition } from './domain/strategy/corporate-action.ts'

// Domain – backtest
export type { BacktestStatus, WalkForwardFold, BacktestResult, BacktestRun } from './domain/strategy/backtest-run.ts'
export {
  createBacktestRun,
  startBacktestRun,
  recordBiasCheck,
  completeBacktestRun,
  failBacktestRun,
} from './domain/strategy/backtest-run.ts'

// Domain – strategy version
export type { StrategyVersionStatus, EvidenceType, EvidenceReference, StrategyVersion } from './domain/strategy/strategy-version.ts'
export { createVersion, submitForActivation, activate, withdrawVersion } from './domain/strategy/strategy-version.ts'

// Domain – AI advisory
export type { AiPermittedOperation, AiAdvisoryRequest, AiAdvisoryResult } from './domain/strategy/ai-advisory.ts'
export { createAiAdvisoryRequest, createAiAdvisoryResult } from './domain/strategy/ai-advisory.ts'

// Domain – strategy events
export type { StrategyDomainEvent } from './domain/strategy/strategy-events.ts'
export { freezeStrategyEvent } from './domain/strategy/strategy-events.ts'

// Ports – market data
export type { MarketDataPort } from './ports/market-data/market-data-port.ts'
export type { FundamentalsPort } from './ports/market-data/fundamentals-port.ts'
export type { IndexMembershipPort } from './ports/market-data/index-membership-port.ts'
export type { CorporateActionPort } from './ports/market-data/corporate-action-port.ts'
export type { ExchangeCalendarPort } from './ports/market-data/exchange-calendar-port.ts'
export type { InstrumentRegistryPort, InstrumentMetadata } from './ports/market-data/instrument-registry-port.ts'
export type { MarketDataSnapshotRepository } from './ports/market-data/snapshot-repository-port.ts'

// Ports – strategy
export type { StrategyVersionRepository } from './ports/strategy/strategy-version-repository.ts'
export type { BacktestRunRepository } from './ports/strategy/backtest-run-repository.ts'
export type { AiAdvisoryPort } from './ports/strategy/ai-advisory-port.ts'
export type { StrategyVersionUnitOfWork } from './ports/strategy/strategy-unit-of-work.ts'

// Application – strategy services
export { EligibilityService } from './application/strategy/eligibility-service.ts'
export { SignalScoringService } from './application/strategy/signal-scoring-service.ts'
export { RegimeDeterminationService } from './application/strategy/regime-determination-service.ts'
export { CorporateActionProcessor } from './application/strategy/corporate-action-processor.ts'
export { BacktestOrchestrationService } from './application/strategy/backtest-orchestration-service.ts'
export { StrategyVersionService } from './application/strategy/strategy-version-service.ts'
export { AiAdvisoryService } from './application/strategy/ai-advisory-service.ts'

// Infrastructure – resilience
export { CircuitBreakerRegistry } from './infrastructure/resilience/circuit-breaker-registry.ts'
export { CredentialRedactor } from './infrastructure/resilience/credential-redactor.ts'
export { ProviderResilienceWrapper } from './infrastructure/resilience/provider-resilience-wrapper.ts'
export { ResearchModeGate } from './infrastructure/resilience/research-mode-gate.ts'
export type { CircuitBreakerStatus, ProviderHealthRecord } from './infrastructure/resilience/circuit-breaker-registry.ts'
export type { ProviderResilienceConfig } from './infrastructure/resilience/provider-resilience-wrapper.ts'

// U04: Construction and Rebalancing
export {
  parseCalendarSessionId,
  parseCostScheduleVersionId,
  parseTaxRuleVersionId,
  parseTurnoverSnapshotId,
} from './domain/shared/identifiers.ts'
export type {
  CalendarSessionId,
  CostScheduleVersionId,
  TaxRuleVersionId,
  TurnoverSnapshotId,
} from './domain/shared/identifiers.ts'
export {
  U04_BENCHMARK_MEASURED_ITERATIONS,
  U04_BENCHMARK_SEED,
  U04_BENCHMARK_WARMUP_ITERATIONS,
  U04_COST_TAX_P95_BUDGET_MS,
  U04_DEFAULT_DEPENDENCY_TIMEOUT_MS,
  U04_DEFAULT_EXECUTION_WINDOW_END,
  U04_DEFAULT_EXECUTION_WINDOW_START,
  U04_DEFAULT_OPTIMIZER_TIMEOUT_MS,
  U04_EXECUTABLE_SEED_P95_BUDGET_MS,
  U04_FALLBACK_P95_BUDGET_MS,
  U04_FULL_PLAN_HEAP_BUDGET_BYTES,
  U04_FULL_PLAN_P95_BUDGET_MS,
  U04_GREEDY_P95_BUDGET_MS,
  U04_HASH_P95_BUDGET_MS,
  U04_IDEAL_TARGET_P95_BUDGET_MS,
  U04_MAX_ACTION_BUCKETS,
  U04_MAX_CANDIDATES,
  U04_MAX_HOLDINGS,
  U04_MAX_OPEN_LOTS,
  U04_MAX_OPTIMIZER_CONSTRAINTS,
  U04_MAX_OPTIMIZER_INSTRUMENTS,
  U04_MAX_OPTIMIZER_TIMEOUT_MS,
  U04_MAX_ORACLE_INSTRUMENTS,
  U04_MAX_ORACLE_QUANTITY_PER_INSTRUMENT,
  U04_MAX_PROPOSED_ORDERS,
  U04_MAX_SELECTED_POSITIONS,
  U04_MAX_TAX_LOTS,
  U04_MAX_TURNOVER_WINDOWS,
  U04_OPTIMIZER_HEAP_BUDGET_BYTES,
  U04_PLAN_ASSEMBLY_P95_BUDGET_MS,
  U04_PLANNING_TIME_ZONE,
  U04_RATE_SCALE,
  U04_REPLAY_P95_BUDGET_MS,
  U04_RULE_FAMILIES,
  U04_VERIFIER_P95_BUDGET_MS,
  U04_WEIGHT_SCALE,
} from './domain/shared/rebalancing-constants.ts'
export type { U04RuleFamily } from './domain/shared/rebalancing-constants.ts'
export {
  BLOCKING_PREREQUISITE_CODES,
  EXPLANATION_KEYS,
  EXPLANATION_TEMPLATES,
  PLANNER_REASON_CODES,
  REBALANCING_CONSTRAINT_FAMILIES,
  REBALANCING_CONSTRAINT_IDS,
  REBALANCING_URGENCIES,
} from './domain/shared/rebalancing-reasons.ts'
export type {
  BlockingPrerequisiteCode,
  ExplanationKey,
  PlannerReasonCode,
  RebalancingConstraintFamily,
  RebalancingConstraintId,
  RebalancingUrgency,
} from './domain/shared/rebalancing-reasons.ts'
export {
  canonicalPlanJson,
  createOptimizerRequestHash,
  createPlanHash,
  createPlanInputHash,
  deriveLogicalOrderKey,
  hashCanonicalPlan,
} from './domain/shared/canonical-plan-hash.ts'
export {
  buildSafePlanObservabilityPayload,
  buildSafeReasonBundle,
} from './domain/shared/safe-observability-payload-builder.ts'
export type {
  PlanningPhase,
  PlanningPhaseDuration,
  SafePlanObservabilityPayload,
  SafeReasonBundle,
} from './domain/shared/safe-observability-payload-builder.ts'
export type {
  ActionIntentMarker,
  CadencePolicySnapshot,
  ConstructionConstraintSet,
  FrozenPlanningInput,
  InterimAuthorization,
  InterimReasonFamily,
  MarketCapBucket,
  NormalizedPlanningContext,
  PlanningCandidate,
  PlanningIntent,
  PlanningTiming,
  PlanningTurnoverWindow,
} from './domain/construction/planning-context.ts'
export { validatePlanningContext } from './domain/construction/planning-gate.ts'
export { projectCandidates } from './domain/construction/candidate-projection.ts'
export type {
  CandidateProjection,
  ProjectedCandidate,
} from './domain/construction/candidate-projection.ts'
export { verifyConstructionConstraints } from './domain/construction/constraint-verifier.ts'
export type {
  ConstraintCheck,
  ConstraintVerification,
  VerifiablePosition,
} from './domain/construction/constraint-verifier.ts'
export { constructIdealTarget } from './domain/construction/ideal-target-constructor.ts'
export type {
  IdealCandidateExclusion,
  IdealTarget,
  IdealTargetPosition,
} from './domain/construction/ideal-target-constructor.ts'
export { calculateImplementationShortfall } from './domain/construction/implementation-shortfall.ts'
export type { ImplementationShortfall } from './domain/construction/implementation-shortfall.ts'
export { allocateWholeSharesGreedy } from './domain/rebalancing/whole-share-greedy-allocator.ts'
export type {
  ExecutableTarget,
  ExecutableTargetPosition,
} from './domain/rebalancing/whole-share-greedy-allocator.ts'
export { estimateOrderCost } from './domain/rebalancing/cost-estimator.ts'
export type {
  CostChargeCode,
  CostChargeRule,
  CostEstimate,
  CostSchedule,
} from './domain/rebalancing/cost-estimator.ts'
export { selectTaxLots } from './domain/rebalancing/tax-lot-selection.ts'
export type {
  LotDisposition,
  LotSelectionPolicy,
  SpecificLotInstruction,
  TaxEstimate,
  TaxRuleSet,
} from './domain/rebalancing/tax-lot-selection.ts'
export {
  calculateDriftBand,
  calculateTurnoverConsumption,
  evaluateDiscretionaryHolding,
  evaluateTurnoverWindows,
  isCadenceOpen,
} from './domain/rebalancing/cadence-and-turnover-policy.ts'
export type {
  TurnoverBudgetEvaluation,
  TurnoverWindowBalance,
} from './domain/rebalancing/cadence-and-turnover-policy.ts'
export { authorizeInterimPlanning } from './domain/rebalancing/interim-authorization.ts'
export type { InterimAuthorizationDecision } from './domain/rebalancing/interim-authorization.ts'
export { buildActionBuckets } from './domain/rebalancing/action-buckets.ts'
export type {
  ActionBuckets,
  BlockedActionInput,
  BlockedOrder,
  ProposedOrder,
  SkippedActionInput,
  SkippedOrder,
} from './domain/rebalancing/action-buckets.ts'
export { assembleRebalancePlan } from './domain/rebalancing/rebalance-plan.ts'
export type {
  ApprovalReadySummary,
  ConcentrationSnapshot,
  PlanLifecycleState,
  PlanWarning,
  RebalancePlan,
} from './domain/rebalancing/rebalance-plan.ts'
export {
  canSupersedePlan,
  comparePlanEquivalence,
  createSemanticPlanHash,
  logicalOrderKey,
  planLogicalOrderKeys,
} from './domain/rebalancing/plan-equivalence.ts'
export type { PlanEquivalence } from './domain/rebalancing/plan-equivalence.ts'
export {
  createDraftPlanLifecycle,
  revalidatePlanLifecycle,
  transitionPlanLifecycle,
} from './domain/rebalancing/plan-lifecycle.ts'
export type {
  PlanLifecycle,
  PlanLifecycleTransition,
} from './domain/rebalancing/plan-lifecycle.ts'
export type {
  ConfirmedPlanningSession,
  InstrumentEvaluationSnapshot,
  PlanningSnapshot,
  PlanningSnapshotPort,
  PlanningSnapshotRequest,
} from './ports/rebalancing/planning-snapshot-port.ts'
export type {
  EffectiveChargeRule,
  EffectiveCostSchedule,
  EffectiveTaxRuleSet,
  EffectiveTurnoverSnapshot,
  PolicyAndTurnoverPort,
  PolicyAndTurnoverResolution,
  PolicyChargeCode,
  TurnoverWindowKind,
  TurnoverWindowSnapshot,
} from './ports/rebalancing/policy-and-turnover-port.ts'
export type {
  HistoricalPlanState,
  PlanHistoryFact,
  PlanHistoryPort,
} from './ports/rebalancing/plan-history-port.ts'
export type {
  OptimizerCandidate,
  OptimizerHardConstraint,
  OptimizerMode,
  OptimizerPort,
  OptimizerPosition,
  OptimizerRequest,
  OptimizerResponse,
  OptimizerResponseStatus,
} from './ports/rebalancing/optimizer-port.ts'
export { PlanningSnapshotAssembler } from './application/rebalancing/planning-snapshot-assembler.ts'
export type {
  AssembledPlanningSnapshot,
  PlanningAssemblyRequest,
  PlanningConstraintPolicyInput,
} from './application/rebalancing/planning-snapshot-assembler.ts'
export { OptimizerOrchestrationService } from './application/rebalancing/optimizer-orchestration-service.ts'
export type {
  OptimizerOrchestrationResult,
  OptimizerOutcome,
  OptimizerOutcomeStatus,
} from './application/rebalancing/optimizer-orchestration-service.ts'
export { RebalancePlanningService } from './application/rebalancing/rebalance-planning-service.ts'
export type { RebalancePlanningRequest } from './application/rebalancing/rebalance-planning-service.ts'
export { GreedyBaselineOptimizerAdapter } from './adapters/optimization/greedy-baseline-optimizer-adapter.ts'
export { SmallProblemOracleOptimizerAdapter } from './adapters/optimization/small-problem-oracle-optimizer-adapter.ts'

// ── U05: Execution and Reconciliation ─────────────────────────────────────
export {
  APPROVAL_STATES,
  ApprovalService,
  BROKER_ORDER_STATUSES,
  BrokerResilienceGovernor,
  CancellationCoordinator,
  DeterministicPaperBroker,
  DryRunBroker,
  EXECUTION_MODES,
  EXECUTION_RUN_STATES,
  ExecutionCoordinator,
  ExecutionRunService,
  ImmediatePaperFillPolicy,
  KillSwitchService,
  ORDER_STATES,
  PlacementCoordinator,
  RECONCILIATION_REASONS,
  RECONCILIATION_STATES,
  ReconciliationService,
  RecoveryService,
  SUBMISSION_CERTAINTIES,
  StatusFillCoordinator,
  allLiveGatesPass,
  composeTrustedExecutionBroker,
  isLiveExecutionMode,
} from './execution.ts'

// U07 basic protected API boundary. Runtime transport and concrete adapters are deferred.
export { SecurePortfolioApi, portfolioHtmlSecurityHeaders } from './api.ts'
export type {
  AuthenticatedSession,
  AuthenticatedRateLimiter,
  MutationIdempotencyPort,
  PortfolioApiAccess,
  PortfolioApiClock,
  PortfolioApiContext,
  PortfolioApiHandler,
  PortfolioApiRequest,
  PortfolioApiResponse,
  PortfolioApiSecurityPolicy,
  PortfolioAuthorizer,
  RequestSchema,
  RequestSchemaResult,
  SecurePortfolioResource,
  SessionAuthenticator,
} from './api.ts'

// U06 operations, security, recovery, and audit.
export {
  BackupRecoveryService,
  HEALTH_STATES,
  INCIDENT_SEVERITIES,
  IncidentService,
  JOB_CRITICALITIES,
  JOB_RUN_STATES,
  JobCoordinator,
  OperationsHealthService,
  SqliteOperationsRepository,
  createJobDefinition,
} from './operations.ts'
export type {
  AuditDecisionRecord,
  AuditIntegrityPort,
  AuditIntegrityResult,
  BackupOperationsPort,
  BackupReceipt,
  ComponentHealth,
  HealthProbePort,
  HealthState,
  IncidentRecord,
  IncidentRepositoryPort,
  IncidentSeverity,
  JobCriticality,
  JobDefinition,
  JobLease,
  JobLeasePort,
  JobProgress,
  JobRunOutcome,
  JobRunState,
  OperationalTask,
  OperationsClockPort,
  OperationsFailureCode,
  OperationsAlert,
  OperationsDashboard,
  OperationsHealth,
  OperationsRepositoryPort,
  OperationsResult,
  OperationsTrigger,
} from './operations.ts'
export type {
  ActivateKillSwitchCommand,
  AdjustmentProposal,
  AdjustmentProposalState,
  AdvanceExecutionCommand,
  ApprovalBinding,
  ApprovalDecisionCommand,
  ApprovalDecisionSnapshot,
  ApprovalPriceBound,
  ApprovalState,
  AtomicFillAccounting,
  BoundedTimerHandle,
  BoundedTimerPort,
  BrokerInstrumentMapping,
  BrokerMappingPort,
  BrokerOrderReference,
  BrokerOrderSnapshot,
  BrokerOrderStatus,
  BrokerPlacementCapability,
  BrokerRecoveryCapability,
  BrokerResilienceConfiguration,
  BrokerSide,
  CancelOrderCommand,
  CancellationAttemptRecord,
  CancellationOutcome,
  CancellationOutcomeRecord,
  CancellationRequest,
  CancellationResult,
  CheckOrderCommand,
  CommittedExecutionResult,
  ConfirmCancellationCommand,
  ConfirmedExecutionSession,
  CreateExecutionRunCommand,
  CreatedExecutionRun,
  DecisionKind,
  DeliveryProduct,
  DeterministicSeedPort,
  DispatchGateRefresh,
  DispatchGateSnapshot,
  DifferenceKind,
  DifferenceResolution,
  DifferenceSeverity,
  DryRunRecord,
  ExecutionClockPort,
  ExecutionDispatchFence,
  ExecutionEvidenceKind,
  ExecutionEvidencePayload,
  ExecutionHealthEvidence,
  ExecutionIdentifierFactory,
  ExecutionMode,
  ExecutionOrderSnapshot,
  ExecutionPolicySnapshot,
  ExecutionProgressEvidence,
  ExecutionQuotePort,
  ExecutionQuoteSnapshot,
  ExecutionRunSnapshot,
  ExecutionRunState,
  ExecutionSessionPort,
  ExecutionTransaction,
  ExecutionWindow,
  FillAccountingContext,
  FillCollectionRequest,
  FillCollectionResult,
  KillSwitchActivation,
  KillSwitchActivationResult,
  KillSwitchReset,
  KillSwitchResetEligibilityToken,
  KillSwitchScope,
  KillSwitchSnapshot,
  KillSwitchState,
  LiveEnablementSnapshot,
  MappingLoadRequest,
  MappingLoadResult,
  MissingFillApplier,
  MonotonicTimePort,
  NormalizedFill,
  OrderIntentPayload,
  OrderState,
  OrderStatusRequest,
  OrderStatusResult,
  PaperAccountSeed,
  PaperFillDecision,
  PaperFillPolicy,
  PlaceOrderCommand,
  PlacementCoordinatorResult,
  PlacementRequest,
  PlacementReservation,
  PlacementResult,
  QuoteFetchRequest,
  ReconcileCommand,
  ReconciledHolding,
  ReconciliationComparator,
  ReconciliationDifference,
  ReconciliationLink,
  ReconciliationReason,
  ReconciliationRunSnapshot,
  ReconciliationSnapshotRecord,
  ReconciliationSnapshotRequest,
  ReconciliationSnapshotResponse,
  ReconciliationState,
  RecoverPortfolioCommand,
  RecoveryPreflight,
  RecoveryResult,
  RedactedBrokerFailure,
  ResetKillSwitchCommand,
  ResidualWork,
  ResidualWorkReason,
  SessionStatusRequest,
  StatusFillCheckResult,
  SubmissionAttempt,
  SubmissionCertainty,
  TerminalReservationRelease,
  TimerCallback,
  TrustedBrokerComposition,
  TrustedBrokerSelection,
} from './execution.ts'
