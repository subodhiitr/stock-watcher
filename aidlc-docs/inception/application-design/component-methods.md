# Component Method Signatures

These signatures define component contracts and high-level intent. Detailed algorithms, thresholds, transition tables, and persistence schemas are deferred to per-unit Functional Design.

## Shared Types

```ts
type PortfolioId = string
type StrategyVersionId = string
type RebalanceRunId = string
type OrderId = string
type CorrelationId = string
type IdempotencyKey = string
type Instant = string
type LocalDate = string

interface Money {
  currency: 'INR'
  minorUnits: bigint
}

interface RequestContext {
  actorId: string
  roles: readonly string[]
  correlationId: CorrelationId
  now: Instant
}
```

## Portfolio Lifecycle

```ts
interface PortfolioApplication {
  createPortfolio(command: CreatePortfolioCommand, context: RequestContext): Promise<PortfolioView>
  listPortfolios(query: ListPortfoliosQuery, context: RequestContext): Promise<readonly PortfolioSummary[]>
  getPortfolio(query: GetPortfolioQuery, context: RequestContext): Promise<PortfolioView>
  updatePortfolio(command: UpdatePortfolioCommand, context: RequestContext): Promise<PortfolioView>
  archivePortfolio(command: ArchivePortfolioCommand, context: RequestContext): Promise<void>
  assignStrategy(command: AssignStrategyCommand, context: RequestContext): Promise<StrategyAssignmentView>
}

interface PortfolioRepository {
  insert(portfolio: Portfolio): void
  getById(portfolioId: PortfolioId): Portfolio | null
  listVisibleTo(actorId: string): readonly Portfolio[]
  save(portfolio: Portfolio, expectedVersion: number): void
}
```

## Strategy Lifecycle

```ts
interface StrategyApplication {
  listStrategies(query: ListStrategiesQuery, context: RequestContext): Promise<readonly StrategySummary[]>
  getStrategy(query: GetStrategyQuery, context: RequestContext): Promise<StrategyVersionView>
  createDraft(command: CreateStrategyDraftCommand, context: RequestContext): Promise<StrategyVersionView>
  validateVersion(command: ValidateStrategyCommand, context: RequestContext): Promise<StrategyValidationResult>
  activateVersion(command: ActivateStrategyCommand, context: RequestContext): Promise<StrategyVersionView>
}

interface StrategySchema {
  parse(input: unknown): StrategyConfiguration
  canonicalize(configuration: StrategyConfiguration): string
  hash(configuration: StrategyConfiguration): string
}
```

## Data, Eligibility, Signals, and Regime

```ts
interface MarketDataPort {
  getEodPrices(request: EodPriceRequest): Promise<VersionedData<EodPrice>>
  getIndexMembership(request: MembershipRequest): Promise<VersionedData<IndexMember>>
  getFundamentals(request: FundamentalRequest): Promise<VersionedData<FundamentalRecord>>
  getCorporateActions(request: CorporateActionRequest): Promise<VersionedData<CorporateAction>>
  getQuotes(request: QuoteRequest): Promise<VersionedData<Quote>>
  getExchangeCalendar(request: CalendarRequest): Promise<ExchangeCalendar>
}

interface EvaluationApplication {
  evaluatePortfolio(command: EvaluatePortfolioCommand, context: RequestContext): Promise<EvaluationView>
  getEvaluation(query: GetEvaluationQuery, context: RequestContext): Promise<EvaluationView>
}

interface EligibilityEngine {
  evaluate(input: EligibilityInput): EligibilityResult
}

interface SignalEngine {
  score(input: SignalInput): SignalSnapshot
}

interface RegimeEngine {
  evaluate(input: RegimeInput): RegimeSnapshot
}
```

## Construction, Cost, Tax, and Rebalancing

```ts
interface ConstructionEngine {
  buildIdealTarget(input: ConstructionInput): TargetAllocation
  buildExecutableTarget(input: ExecutableConstructionInput): ExecutableTarget
}

interface CostModel {
  estimate(order: CandidateOrder, context: CostContext): CostEstimate
}

interface TaxModel {
  estimateSale(input: TaxSaleInput): TaxEstimate
  selectLots(input: LotSelectionInput): LotSelection
}

interface RebalanceApplication {
  preview(command: PreviewRebalanceCommand, context: RequestContext): Promise<RebalancePlanView>
  getPlan(query: GetRebalancePlanQuery, context: RequestContext): Promise<RebalancePlanView>
  listPlans(query: ListRebalancePlansQuery, context: RequestContext): Promise<readonly RebalancePlanSummary[]>
  approve(command: ApproveRebalanceCommand, context: RequestContext): Promise<ApprovalView>
  reject(command: RejectRebalanceCommand, context: RequestContext): Promise<ApprovalView>
}

interface RebalancePlanner {
  plan(input: RebalancePlanningInput): RebalancePlan
}
```

## Risk, Execution, and Reconciliation

```ts
interface RiskPolicy {
  evaluatePlan(input: PlanRiskInput): RiskDecision
  evaluateOrder(input: OrderRiskInput): RiskDecision
}

interface ApprovalPolicy {
  validateApproval(input: ApprovalValidationInput): ApprovalDecision
}

interface ExecutionApplication {
  execute(command: ExecuteRebalanceCommand, context: RequestContext): Promise<ExecutionView>
  cancel(command: CancelExecutionCommand, context: RequestContext): Promise<ExecutionView>
  reconcile(command: ReconcilePortfolioCommand, context: RequestContext): Promise<ReconciliationView>
}

interface BrokerPort {
  getAccount(request: BrokerAccountRequest): Promise<BrokerAccount>
  getHoldings(request: BrokerHoldingsRequest): Promise<readonly BrokerHolding[]>
  getCash(request: BrokerCashRequest): Promise<BrokerCash>
  placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResult>
  cancelOrder(request: BrokerCancelRequest): Promise<BrokerOrderResult>
  getOrder(request: BrokerOrderStatusRequest): Promise<BrokerOrderResult>
  getFills(request: BrokerFillRequest): Promise<readonly BrokerFill[]>
}

interface ReconciliationEngine {
  compare(input: ReconciliationInput): ReconciliationResult
}
```

## Scheduling, Operations, Audit, and Recovery

```ts
interface SchedulerApplication {
  claimDueJobs(input: ClaimJobsInput): Promise<readonly ScheduledJob[]>
  runJob(command: RunJobCommand, context: RequestContext): Promise<JobRunView>
  triggerJob(command: TriggerJobCommand, context: RequestContext): Promise<JobRunView>
  recoverIncompleteJobs(context: RequestContext): Promise<readonly JobRunView[]>
}

interface KillSwitchApplication {
  getState(query: GetKillSwitchQuery, context: RequestContext): Promise<KillSwitchView>
  activate(command: ActivateKillSwitchCommand, context: RequestContext): Promise<KillSwitchView>
  reset(command: ResetKillSwitchCommand, context: RequestContext): Promise<KillSwitchView>
}

interface OperationsApplication {
  getHealth(query: HealthQuery, context: RequestContext): Promise<HealthView>
  getOperations(query: OperationsQuery, context: RequestContext): Promise<OperationsView>
  createBackup(command: CreateBackupCommand, context: RequestContext): Promise<BackupView>
  verifyBackup(command: VerifyBackupCommand, context: RequestContext): Promise<BackupView>
  restoreBackup(command: RestoreBackupCommand, context: RequestContext): Promise<RestoreView>
}

interface AuditPort {
  append(event: AuditEvent): void
  verifyChain(scope: AuditScope): AuditVerification
  export(scope: AuditScope): Promise<RedactedAuditExport>
}
```

## Persistence and Internal Events

```ts
interface PortfolioUnitOfWork {
  execute<T>(work: (repositories: PortfolioRepositories) => T): T
  executeWithEvents<T>(
    work: (repositories: PortfolioRepositories) => T,
  ): { result: T; events: readonly DomainEvent[] }
}

interface InternalEventBus {
  publishAfterCommit(events: readonly DomainEvent[]): Promise<void>
  subscribe<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void
}

interface PortfolioDatabaseOwner {
  initialize(): void
  migrate(): void
  health(): DatabaseHealth
  close(): void
}
```

## API Adapter

```ts
interface PortfolioRouteModule {
  handle(request: Request, context: HttpRouteContext): Promise<Response | null>
}

interface HttpInputValidator<T> {
  parse(input: unknown): T
}

interface PortfolioAuthorizer {
  requirePortfolioAccess(context: RequestContext, portfolioId: PortfolioId): Promise<void>
  requireRole(context: RequestContext, role: string): void
}
```

## Dedicated React UI

```ts
interface PortfolioWorkspacePageProps {
  initialPortfolioId?: PortfolioId
  initialSubview?: 'overview' | 'holdings' | 'strategy' | 'rebalance' | 'performance' | 'operations'
}

interface PortfolioSelectorProps {
  portfolios: readonly PortfolioSummary[]
  selectedPortfolioId: PortfolioId | null
  onSelect(portfolioId: PortfolioId): void
  onCreate(): void
}

interface RebalancePreviewPanelProps {
  plan: RebalancePlanView
  canApprove: boolean
  onApprove(request: ApprovalRequest): Promise<void>
  onReject(request: RejectionRequest): Promise<void>
}

interface PortfolioOperationsPanelProps {
  operations: OperationsView
  permissions: OperationsPermissions
  onActivateKillSwitch(request: KillSwitchRequest): Promise<void>
  onResetKillSwitch(request: KillSwitchRequest): Promise<void>
}
```

React components receive typed views and callbacks. They do not issue SQL, hold broker credentials, or contain domain policy.
