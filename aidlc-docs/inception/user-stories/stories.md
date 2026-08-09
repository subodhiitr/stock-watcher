# Automatic Portfolio Management User Stories

## Story Method

- **Organization**: Hybrid user-journey and business-domain epics.
- **Scope**: Full approved roadmap, labeled by delivery phase.
- **Granularity**: Small, independently testable stories.
- **Acceptance format**: Given/When/Then plus explicit invariants.
- **Traceability**: Functional requirements, requirements acceptance criteria, and applicable extension rules.

## Common Domain Invariants

1. Portfolio state never crosses portfolio identifiers.
2. Cash cannot become negative and holdings cannot become short or leveraged.
3. Activated strategy versions and historical decision inputs are immutable.
4. Routine decisions use finalized EOD data and approved orders execute only in a later eligible CNC session.
5. Unknown, stale, incomplete, or unreconciled execution state fails closed.
6. Repeated equivalent commands do not duplicate portfolios, plans, jobs, or orders.
7. Every privileged or financially material state change is attributable and auditable.

# Epic 1: Portfolio Foundation

## US-001 Initialize the Portfolio Domain

- **Phase**: 0
- **Persona**: Priya
- **Story**: As an investor, I want an isolated portfolio database with a ready paper portfolio so that I can begin safely without affecting existing trading records.
- **Acceptance criteria**:
  - Given no portfolio database, when initialization runs, then `portfolio-management.db` is created with exactly one active INR `Paper Portfolio`, INR 1,000,000 configurable cash, and `adaptive-momentum-quality@1.0.0`.
  - Given initialization already succeeded, when it runs again, then no portfolio, cash, or strategy assignment is duplicated or reset.
  - Given tests or migrations run, when storage is opened, then `stock-watcher.db` and user trading records remain unattached and unchanged.
- **Invariants**: Initialization is idempotent; accounting uses exact decimal or integer minor units; encrypted storage and audit integrity are preserved.
- **Traceability**: FR-002; DR-001 through DR-003; AC-1; SECURITY-01, SECURITY-13, SECURITY-15; RESILIENCY-01, RESILIENCY-12; PBT-02 through PBT-04.
- **INVEST**: Pass - one independently verifiable initialization outcome with clear persistence boundaries.

## US-002 Create Independent Portfolios

- **Phase**: 0
- **Persona**: Priya
- **Story**: As an investor, I want to create multiple portfolios with their own mode, capital, and strategy so that I can pursue separate objectives.
- **Acceptance criteria**:
  - Given valid unique details, when Priya creates a portfolio, then it receives an immutable identifier and isolated cash, holdings, orders, performance, and risk state.
  - Given a duplicate active name or invalid capital, mode, or strategy version, when creation is attempted, then validation rejects it without partial persistence.
  - Given at least three portfolios, when each is queried, then no state from another portfolio appears.
- **Invariants**: Names are unique among non-archived portfolios; creation is atomic; no portfolio starts with negative cash.
- **Traceability**: FR-001, FR-003; AC-3, AC-17; SECURITY-05, SECURITY-08, SECURITY-15; PBT-03, PBT-06, PBT-07.
- **INVEST**: Pass - creates one user-valued aggregate with isolated acceptance boundaries.

## US-003 Select a Portfolio Without State Leakage

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want to switch the selected portfolio so that every screen and action uses only that portfolio's state.
- **Acceptance criteria**:
  - Given multiple portfolios, when Priya changes the selector, then overview, holdings, targets, plans, strategy, performance, and operations refresh for the selected identifier.
  - Given a stale response from the previous selection, when it arrives, then it cannot overwrite the current selection's state.
  - Given an inaccessible or missing identifier, when requested, then access fails closed with a generic error.
- **Invariants**: Every portfolio resource is object-authorized; selected-state changes never merge cached data.
- **Traceability**: FR-001, FR-160, FR-170; AC-3, AC-16; SECURITY-05, SECURITY-08, SECURITY-15; PBT-03, PBT-06.
- **INVEST**: Pass - isolates one complete selection behavior from portfolio creation and editing.

## US-004 Archive a Portfolio Safely

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want to archive an unused portfolio so that new activity stops while its history remains available.
- **Acceptance criteria**:
  - Given an active portfolio and confirmation, when it is archived, then new evaluations, plans, and orders are blocked.
  - Given historical records, when archiving completes, then holdings, fills, performance, and audit events remain queryable.
  - Given an already archived portfolio, when archive is repeated, then the result remains idempotent.
- **Invariants**: Archiving never deletes financial history and never affects another portfolio.
- **Traceability**: FR-001; AC-17; SECURITY-08, SECURITY-13; PBT-04, PBT-06.
- **INVEST**: Pass - a small lifecycle transition with explicit retention behavior.

## US-005 Assign and Change Strategy Versions

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want to assign an immutable strategy version per portfolio so that future decisions follow the intended horizon without rewriting history.
- **Acceptance criteria**:
  - Given an eligible strategy version, when assigned, then only future evaluations use it.
  - Given existing signals, targets, or orders, when the assignment changes, then their original strategy identifiers and hashes remain unchanged.
  - Given an unauthorized actor or unapproved live strategy, when assignment is attempted, then it is rejected and audited.
- **Invariants**: One active assignment per portfolio unless explicit sleeve mode is used; historical lineage is immutable.
- **Traceability**: FR-003, FR-010; AC-3, AC-17; SECURITY-08, SECURITY-13; PBT-03, PBT-06.
- **INVEST**: Pass - one strategy-assignment capability with testable lineage.

# Epic 2: Strategy Lifecycle

## US-006 Register Horizon Presets

- **Phase**: 0
- **Persona**: Arjun
- **Story**: As a strategy editor, I want the three approved horizon presets registered once so that portfolios can choose consistent short-, medium-, or long-term behavior.
- **Acceptance criteria**:
  - Given a fresh database, when strategies are seeded, then the short, medium, and long preset identifiers and version `1.0.0` exist exactly once.
  - Given each preset, when validated, then factor weights total 100% and cadence, holdings, drift bands, replacement hurdles, holding preference, and turnover windows match `strategy-presets.md`.
  - Given any preset, when inspected, then it is PAPER/OBSERVE eligible and not implicitly live-enabled.
- **Invariants**: Presets are immutable after activation; all use EOD decisions and later-session CNC execution.
- **Traceability**: FR-010, FR-011; AC-2, AC-4, AC-5; SECURITY-13; PBT-02 through PBT-04, PBT-07.
- **INVEST**: Pass - bounded to deterministic preset registration and validation.

## US-007 Create a Validated Strategy Version

- **Phase**: 1
- **Persona**: Arjun
- **Story**: As a strategy editor, I want schema-validated strategy versions so that unsafe or malformed configurations cannot influence portfolios.
- **Acceptance criteria**:
  - Given a complete declarative configuration, when saved, then unsupported enums, non-total weights, infeasible constraints, unsafe limits, and executable content are rejected.
  - Given a valid draft, when versioned, then its canonical hash, author, effective date, and approval metadata are recorded.
  - Given an activated version, when modification is attempted, then the system requires a new version.
- **Invariants**: Untrusted configuration is safely parsed; activated content and hash are immutable.
- **Traceability**: FR-010; AC-17; SECURITY-05, SECURITY-13, SECURITY-15; PBT-02 through PBT-04, PBT-07.
- **INVEST**: Pass - one strategy-version creation boundary with complete validation.

## US-008 Activate Only Evidence-Backed Strategies

- **Phase**: 2
- **Persona**: Arjun
- **Story**: As a strategy editor, I want activation gated by research evidence so that unvalidated parameter changes cannot reach execution.
- **Acceptance criteria**:
  - Given a candidate version, when activation is requested, then required out-of-sample, walk-forward, turnover, cost, tax, drawdown, and shadow evidence is checked.
  - Given missing or failed evidence, when activation is attempted, then it remains inactive with explicit reasons.
  - Given complete evidence and authorized approval, when activated, then the exact hash and evidence references are audited.
- **Invariants**: Activation never optimizes solely for CAGR and never silently enables live trading.
- **Traceability**: FR-010, FR-100, FR-130; AC-11, AC-15, AC-17; SECURITY-08, SECURITY-13; PBT-03, PBT-06.
- **INVEST**: Pass - separates activation policy from strategy editing and broker execution.

## US-009 Allocate Multiple Strategy Sleeves

- **Phase**: 6
- **Persona**: Priya
- **Story**: As an advanced investor, I want multiple strategy sleeves in one portfolio so that I can diversify methods under one risk boundary.
- **Acceptance criteria**:
  - Given approved strategy versions, when sleeves are configured, then allocation weights must total exactly 100%.
  - Given sleeve targets, when portfolio construction runs, then shared stock, sector, group, cash, and turnover limits remain satisfied.
  - Given overlapping securities, when targets combine, then quantities and explanations are deterministic and not duplicated.
- **Invariants**: Sleeve allocation cannot create leverage, short positions, or constraint bypass.
- **Traceability**: FR-003, FR-050, FR-130; AC-8; SECURITY-05, SECURITY-11; PBT-03, PBT-05, PBT-07.
- **INVEST**: Pass - one advanced allocation capability with measurable aggregate constraints.

# Epic 3: Data, Eligibility, and Signals

## US-010 Ingest Provenanced Point-in-Time Data

- **Phase**: 0
- **Persona**: Ravi
- **Story**: As an operator, I want every decision input to retain provenance and freshness so that portfolio outputs are reproducible and trustworthy.
- **Acceptance criteria**:
  - Given provider data, when stored, then source, fetched time, market time, effective date, version or checksum, validation status, and stale-after time are retained.
  - Given prototype NSE or Yahoo data, when used, then it is visibly marked non-execution research data.
  - Given missing licensed point-in-time data, when production planning is requested, then it is blocked.
- **Invariants**: Data lineage cannot be detached from a decision; provider failure never becomes favorable input.
- **Traceability**: FR-020; AC-7, AC-15; SECURITY-13, SECURITY-15; RESILIENCY-10; PBT-02, PBT-03.
- **INVEST**: Pass - focuses on ingestion provenance independent of scoring.

## US-011 Build the Eligible Universe

- **Phase**: 1
- **Persona**: Arjun
- **Story**: As a strategy editor, I want deterministic eligibility filtering so that only tradable, healthy, correctly mapped instruments can enter a portfolio.
- **Acceptance criteria**:
  - Given an as-of date, when eligibility runs, then historical index membership and all listing, completeness, price, liquidity, status, surveillance, mapping, and anomaly rules apply.
  - Given a financial-sector company, when quality filters run, then sector-appropriate rules are used.
  - Given a severe verified governance, solvency, default, fraud, delisting, or regulatory flag, when evaluated, then the instrument is blocked with reasons.
- **Invariants**: Identical versioned inputs produce the same eligible set; missing fields never improve eligibility.
- **Traceability**: FR-030; AC-7, AC-15; SECURITY-15; PBT-03, PBT-05, PBT-07.
- **INVEST**: Pass - one deterministic universe transformation with observable exclusions.

## US-012 Calculate Deterministic Signals and Regimes

- **Phase**: 1
- **Persona**: Arjun
- **Story**: As a strategy editor, I want reproducible scores and market regimes so that every target can be explained from immutable inputs.
- **Acceptance criteria**:
  - Given a strategy, data version, and as-of time, when scoring repeats, then component and composite scores are equivalent.
  - Given outliers or missing values, when normalization runs, then documented winsorization and deterministic missing-data policies apply.
  - Given regime inputs, when a transition is considered, then confirmation and hysteresis apply and regime changes only total equity exposure.
- **Invariants**: Normalized ranges and weight totals remain valid; regime logic cannot select individual securities.
- **Traceability**: FR-040; AC-7; SECURITY-13; PBT-03, PBT-05, PBT-07, PBT-08.
- **INVEST**: Pass - scoped to score and regime outputs with reproducibility.

## US-013 Fail Closed on Data or Dependency Failure

- **Phase**: 1
- **Persona**: Ravi
- **Story**: As an operator, I want incomplete or unhealthy dependencies to block risky work so that research degradation never permits unsafe trading.
- **Acceptance criteria**:
  - Given stale data, unresolved corporate action, clock mismatch, or provider timeout, when planning starts, then affected execution work halts with a stable reason code.
  - Given a non-critical news or research dependency failure, when the dashboard loads, then that view degrades without authorizing trades.
  - Given a critical dependency failure, when retries are considered, then deadlines, safe retry eligibility, jitter, circuit breaking, and resource limits apply.
- **Invariants**: No error path bypasses validation, authorization, reconciliation, or resource cleanup.
- **Traceability**: FR-020, FR-110; NFR-REL; SECURITY-15; RESILIENCY-05, RESILIENCY-06, RESILIENCY-10; PBT-03, PBT-06.
- **INVEST**: Pass - one failure-policy outcome that is independently fault-injectable.

## US-014 Process Corporate Actions

- **Phase**: 2
- **Persona**: Ravi
- **Story**: As an operator, I want corporate actions applied with lineage so that quantities, costs, lots, and broker state remain correct.
- **Acceptance criteria**:
  - Given a supported corporate action, when its effective date is processed, then quantity, average price, tax lots, symbol mappings, and audit lineage adjust deterministically.
  - Given an unresolved mapping, when an affected rebalance is requested, then it is blocked for review.
  - Given processing completes, when broker state refreshes, then holdings reconcile before further orders.
- **Invariants**: Value-preserving actions conserve economic value within documented rounding; history is never overwritten.
- **Traceability**: FR-140; AC-6, AC-17; SECURITY-13, SECURITY-15; PBT-02, PBT-03, PBT-05.
- **INVEST**: Pass - isolates corporate-action transformation and reconciliation.

# Epic 4: Construction and Rebalancing

## US-015 Construct Ideal and Executable Targets

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want ideal and executable targets so that I can see both strategy intent and real-world constraint effects.
- **Acceptance criteria**:
  - Given eligible scored securities, when construction runs, then target holdings, inverse-volatility score adjustment, stock, sector, group, liquidity, cash, and turnover constraints apply.
  - Given whole-share constraints, when allocation completes, then no negative cash, short position, leverage, or unavailable quantity exists.
  - Given executable targets differ from ideal targets, when shown, then implementation shortfall is quantified and explained.
- **Invariants**: Weights plus cash equal 100% within defined decimal tolerance; all caps hold.
- **Traceability**: FR-050; AC-8; SECURITY-11; PBT-03, PBT-05, PBT-07.
- **INVEST**: Pass - produces one pair of constraint-verifiable target outputs.

## US-016 Enforce Horizon Rebalance Cadence

- **Phase**: 2
- **Persona**: Priya
- **Story**: As an investor, I want rebalancing to respect my strategy horizon so that short, medium, and long portfolios do not churn like intraday systems.
- **Acceptance criteria**:
  - Given each preset, when routine planning runs, then constituent changes occur only biweekly, monthly, or quarterly as configured.
  - Given drift inside the preset no-trade band or an unexpired preferred hold, when no hard-risk exception exists, then the trade is skipped with a reason.
  - Given repeated runs, when turnover is aggregated, then rolling 30-day, monthly, quarterly, and annual limits cannot be bypassed.
  - Given an EOD decision, when execution is scheduled, then no same-session routine trade or legacy intraday rule is invoked.
- **Invariants**: Cadence, preferred holds, and turnover limits are portfolio-scoped and deterministic.
- **Traceability**: FR-011, FR-060, FR-120; AC-4, AC-5; SECURITY-11; PBT-03, PBT-04, PBT-06.
- **INVEST**: Pass - one testable horizon-policy boundary across three presets.

## US-017 Plan Costs and Taxes

- **Phase**: 2
- **Persona**: Priya
- **Story**: As an investor, I want rebalances to account for costs and taxes so that small theoretical improvements do not destroy after-tax value.
- **Acceptance criteria**:
  - Given candidate orders, when planning runs, then configured brokerage, statutory charges, spread, slippage, impact, and broker fees are estimated.
  - Given acquisition lots and effective tax rules, when a sale is considered, then the configured lot selection and tax estimate are included.
  - Given expected improvement does not exceed costs, taxes, and turnover penalty, when evaluated, then replacement is skipped unless hard risk requires exit.
- **Invariants**: Live and backtest cost models share the same versioned schedule; hard risk overrides tax preference.
- **Traceability**: FR-060, FR-070; AC-9; SECURITY-13; PBT-03, PBT-05, PBT-07.
- **INVEST**: Pass - independently verifies after-cost and after-tax planning.

## US-018 Review an Explainable Rebalance Preview

- **Phase**: 2
- **Persona**: Meera
- **Story**: As an order approver, I want a complete rebalance preview so that I can understand proposed, skipped, and blocked actions before execution.
- **Acceptance criteria**:
  - Given a valid plan, when opened, then current and target weights, quantities, values, cash, sectors, risk, costs, taxes, warnings, urgency, and reason codes are visible.
  - Given skipped orders, when reviewed, then each has a structured code and human-readable explanation.
  - Given the same immutable inputs, when planning repeats, then the plan is equivalent and does not duplicate orders.
- **Invariants**: Preview totals reconcile to the portfolio snapshot; no approval is implied by viewing.
- **Traceability**: FR-060, FR-170, FR-180; AC-9, AC-16, AC-17; SECURITY-13; PBT-03, PBT-04.
- **INVEST**: Pass - one reviewable plan artifact with deterministic totals.

## US-019 Handle Interim Risk Rebalances

- **Phase**: 2
- **Persona**: Priya
- **Story**: As an investor, I want interim changes limited to verified risk conditions so that routine horizon discipline remains intact.
- **Acceptance criteria**:
  - Given no routine date, when planning is requested, then only hard risk, mandatory eligibility failure, verified corporate action, or confirmed regime exposure reduction can permit constituent action.
  - Given AI sentiment alone, when an interim exit is considered, then it is rejected.
  - Given a valid hard-risk exit, when costs, taxes, holding preference, or turnover limits conflict, then risk exit takes precedence and the override is explained.
- **Invariants**: Interim reasons are structured, verified, and audited; no automatic liquidation follows a global kill switch.
- **Traceability**: FR-060, FR-110, FR-150; AC-4, AC-17; SECURITY-11, SECURITY-13; PBT-03, PBT-06.
- **INVEST**: Pass - isolates exceptional rebalance authorization from routine cadence.

## US-020 Use Advanced Optimization Safely

- **Phase**: 6
- **Persona**: Arjun
- **Story**: As a strategy editor, I want verified integer and risk-parity optimization so that allocation improves without weakening constraints.
- **Acceptance criteria**:
  - Given a feasible target problem, when an advanced optimizer runs, then the result satisfies every hard constraint and whole-share rule.
  - Given timeout, infeasibility, or solver error, when optimization fails, then the system reports duration, iterations, violated constraints, and uses only an approved deterministic fallback.
  - Given a reference small problem, when compared, then the optimized result matches or improves on the verified oracle within documented tolerance.
- **Invariants**: Failure never emits an unconstrained target; fallback is visible and reproducible.
- **Traceability**: FR-050, FR-130; AC-8; SECURITY-15; RESILIENCY-10; PBT-03, PBT-05, PBT-08.
- **INVEST**: Pass - advanced allocator behavior is separable and oracle-testable.

# Epic 5: Paper and Broker Execution

## US-021 Execute Paper Orders Through the Real State Machine

- **Phase**: 3
- **Persona**: Priya
- **Story**: As an investor, I want paper execution to use live-equivalent contracts so that I can validate behavior without risking money.
- **Acceptance criteria**:
  - Given an approved paper plan, when executed, then validation, ordering, costs, slippage, idempotency, fills, and reconciliation use shared contracts.
  - Given configured fill outcomes, when processing occurs, then partial fills, rejection, expiry, cancellation, and residual orders are represented.
  - Given completion, when performance updates, then paper holdings and history remain clearly distinguishable from live records.
- **Invariants**: Paper cash and positions reconcile after every transition; no broker credential or real-order path is invoked.
- **Traceability**: FR-090; AC-10; SECURITY-15; PBT-03, PBT-06, PBT-07.
- **INVEST**: Pass - delivers one safe execution mode with complete observable states.

## US-022 Keep Live Execution Disabled by Default

- **Phase**: 4
- **Persona**: Meera
- **Story**: As an order approver, I want live order submission disabled at every control layer so that configuration mistakes cannot place trades.
- **Acceptance criteria**:
  - Given default application, environment, portfolio, or strategy settings, when live execution is requested, then submission is blocked.
  - Given all enablement gates except one, when submission is requested, then it remains blocked with the missing gate identified.
  - Given automated tests, when execution paths run, then only fake, paper, or dry-run adapters are callable.
- **Invariants**: Enablement is deny-by-default and requires explicit independent gates; no success-shaped fallback exists.
- **Traceability**: FR-100; AC-11; SECURITY-08, SECURITY-11, SECURITY-15; PBT-03, PBT-06.
- **INVEST**: Pass - one critical default-deny behavior with exhaustive gate checks.

## US-023 Approve a Current Order Basket

- **Phase**: 4
- **Persona**: Meera
- **Story**: As an order approver, I want approval bound to exact current state so that changed plans cannot execute under stale consent.
- **Acceptance criteria**:
  - Given a current plan, when approved, then approval binds to plan hash, strategy version, portfolio state version, approver, and price-validity window.
  - Given a material state or price change, when execution starts, then prior approval is invalidated and replanning is required.
  - Given basket review, when Meera acts, then she can approve or reject the basket and permitted individual orders with audit reasons.
- **Invariants**: Approval cannot outlive its bound inputs and does not bypass pre-trade validation.
- **Traceability**: FR-100; AC-11, AC-17; SECURITY-08, SECURITY-13; PBT-03, PBT-06.
- **INVEST**: Pass - approval is an independent state transition with explicit invalidation.

## US-024 Submit Orders Idempotently

- **Phase**: 3
- **Persona**: Meera
- **Story**: As an order approver, I want repeated submissions to be idempotent so that retries cannot create duplicate orders.
- **Acceptance criteria**:
  - Given a portfolio, run, symbol, side, and sequence, when submission occurs, then one stable idempotency key identifies the order.
  - Given the same key and equivalent request, when repeated, then the existing result is returned without another broker or paper order.
  - Given the same key with conflicting content, when submitted, then it is rejected and audited.
- **Invariants**: At most one logical order exists per idempotency key; unknown external status blocks another placement.
- **Traceability**: FR-100, FR-160; AC-13; SECURITY-13, SECURITY-15; PBT-04, PBT-06.
- **INVEST**: Pass - narrow duplicate-prevention behavior with exact identity rules.

## US-025 Reconcile Partial and Unknown Outcomes

- **Phase**: 4
- **Persona**: Ravi
- **Story**: As an operator, I want every execution stage reconciled so that partial or unknown outcomes cannot corrupt cash or positions.
- **Acceptance criteria**:
  - Given broker state, when planning or execution reaches a boundary, then holdings, cash, delivery quantity, open orders, and fills reconcile.
  - Given sells, when fills confirm, then affordable buys are recalculated before submission.
  - Given partial fills, restart, external changes, or unknown status, when reconciled, then history is retained, residual work is explicit, and duplicates remain blocked.
- **Invariants**: Sells precede buys; sell quantity never exceeds available delivery quantity; unknown does not equal failed or succeeded.
- **Traceability**: FR-080, FR-090, FR-100; AC-6, AC-10, AC-13; SECURITY-15; RESILIENCY-01, RESILIENCY-10; PBT-03, PBT-06.
- **INVEST**: Pass - focuses on reconciliation boundaries independent of broker implementation.

## US-026 Use Interchangeable Broker Adapters

- **Phase**: 4
- **Persona**: Ravi
- **Story**: As an operator, I want Zerodha and Sharekhan behind one contract so that safety behavior is consistent across brokers.
- **Acceptance criteria**:
  - Given either broker, when account, holdings, cash, instruments, orders, fills, cancellation, or status are requested, then normalized domain results are returned.
  - Given a fake or dry-run adapter, when the same contract tests run, then it exercises equivalent states without network submission.
  - Given broker credentials or errors, when logged or returned, then secrets and internal details are redacted.
- **Invariants**: Adapter differences cannot weaken validation, idempotency, reconciliation, or CNC-only policy.
- **Traceability**: FR-080, FR-100; AC-12; SECURITY-01, SECURITY-03, SECURITY-15; RESILIENCY-10; PBT-02, PBT-06.
- **INVEST**: Pass - one normalized boundary with contract-verifiable implementations.

## US-027 Enforce Restricted Automation and Kill Switches

- **Phase**: 5
- **Persona**: Ravi
- **Story**: As an operator, I want restricted automation bounded by risk controls and kill switches so that automation cannot exceed explicit authority.
- **Acceptance criteria**:
  - Given restricted-auto mode, when an order is considered, then universe, CNC, order-count, notional, position, turnover, data, drawdown, rejection, and reconciliation limits all pass.
  - Given a new constituent, hard-risk event, or material tax-impact sale, when considered, then human approval remains required.
  - Given a portfolio kill switch, when active, then only that portfolio stops; given the global switch, then all new orders stop, cancellable pending orders cancel, reconciliation continues, and no liquidation starts.
  - Given reset or automation activation, when requested, then separate authorization, reason, audit, and two-factor confirmation are required.
- **Invariants**: Any failed gate blocks execution; kill switches never delete state or auto-liquidate.
- **Traceability**: FR-100, FR-110; AC-12, AC-14, AC-17; SECURITY-08, SECURITY-11 through SECURITY-14; RESILIENCY-01; PBT-03, PBT-06.
- **INVEST**: Pass - one bounded-automation control surface with explicit safety transitions.

# Epic 6: Scheduling, Operations, and Recovery

## US-028 Run Portfolio Jobs Exactly Once

- **Phase**: 1
- **Persona**: Ravi
- **Story**: As an operator, I want leased exchange-calendar-aware jobs so that work is not duplicated and each portfolio follows its own strategy schedule.
- **Acceptance criteria**:
  - Given Asia/Kolkata exchange sessions, when jobs become due, then ingestion, signals, planning, broker checks, execution, reconciliation, and snapshots run in dependency order.
  - Given concurrent attempts, when a lease is held, then only one active run proceeds.
  - Given a manual trigger, when invoked, then the same locks, cadence, turnover, validation, and authorization apply.
  - Given restart, when incomplete work is discovered, then it resumes or reconciles without assuming success.
- **Invariants**: Job identity and input version are stable; manual execution grants no policy bypass.
- **Traceability**: FR-120; AC-4, AC-13; SECURITY-15; RESILIENCY-01, RESILIENCY-10; PBT-04, PBT-06.
- **INVEST**: Pass - one scheduler reliability outcome with deterministic leases.

## US-029 Monitor Health and Alerts

- **Phase**: 3
- **Persona**: Ravi
- **Story**: As an operator, I want actionable health and security monitoring so that degraded portfolio workloads are detected before unsafe execution.
- **Acceptance criteria**:
  - Given a running service, when shallow and deep health are requested, then process, database, providers, broker, scheduler, audit chain, backup, and clock status are reported without secrets.
  - Given latency, error, saturation, stale data, backup failure, rejected orders, reconciliation, or authorization violations, when thresholds cross, then structured alerts are emitted.
  - Given logs, when recorded, then timestamp, level, correlation ID, event, and redacted context are present and retained for at least 90 days.
- **Invariants**: Monitoring cannot mutate portfolio state or reveal credentials; security/audit logs are tamper-evident.
- **Traceability**: FR-180; NFR-SEC, NFR-REL; SECURITY-03, SECURITY-14; RESILIENCY-05 through RESILIENCY-07; PBT-03.
- **INVEST**: Pass - independently demonstrates observability and alert delivery.

## US-030 Back Up, Restore, and Roll Back Safely

- **Phase**: 0
- **Persona**: Ravi
- **Story**: As an operator, I want encrypted backup and database-aware recovery so that portfolio service returns within hours with no more than one hour of data loss.
- **Acceptance criteria**:
  - Given persistent portfolio data, when scheduled backup runs, then encrypted hourly and retained daily backups include integrity metadata.
  - Given a test restore, when completed, then schema, cash, holdings, orders, strategy versions, and audit-chain verification recover within the RTO and RPO.
  - Given deployment failure, when rollback occurs, then backup, reversible or forward migrations, previous application version, and post-restore health checks are used.
  - Given a local workstation topology, when topology rules are evaluated, then cloud multi-zone and auto-scaling requirements are explicitly N/A rather than simulated.
- **Invariants**: Restore never overwrites an unbacked-up database; recovery preserves exact accounting and audit integrity.
- **Traceability**: DR-003; AC-18; SECURITY-01, SECURITY-13; RESILIENCY-02 through RESILIENCY-04, RESILIENCY-08, RESILIENCY-09, RESILIENCY-11 through RESILIENCY-14; PBT-02, PBT-03.
- **INVEST**: Pass - a testable local backup/restore and rollback capability.

## US-031 Manage Incidents and Corrections

- **Phase**: 5
- **Persona**: Ravi
- **Story**: As an operator, I want a lightweight incident and correction process so that failures are contained, recovered, explained, and prevented from recurring.
- **Acceptance criteria**:
  - Given a production incident, when declared, then severity, owner, containment, communication, evidence, and recovery status are recorded.
  - Given recovery, when validation completes, then affected portfolios, reconciliation, audit integrity, data freshness, and broker state are checked before reopening execution.
  - Given closure, when correction-of-errors review completes, then causes, impact, corrective actions, owners, and due dates are retained.
- **Invariants**: Incident handling cannot erase evidence or bypass execution gates.
- **Traceability**: NFR-REL; SECURITY-13, SECURITY-14; RESILIENCY-05, RESILIENCY-13, RESILIENCY-15.
- **INVEST**: Pass - one operational workflow with clear start and closure conditions.

# Epic 7: APIs, User Experience, Security, and Audit

## US-032 Use the Portfolio Workspace

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want a complete portfolio workspace so that I can create, select, understand, and manage each portfolio.
- **Acceptance criteria**:
  - Given `/portfolio`, when loaded, then portfolio creation and selection are available with mode, paper capital, and horizon strategy assignment.
  - Given the dedicated `/portfolio` URL, when rendered, then separate React components provide the workspace without loading legacy dashboard markup, global scripts, or intraday UI state.
  - Given a selected portfolio, when viewed, then overview, holdings, targets, drift, ranks, explanations, taxes, risks, benchmark performance, and drawdown are scoped correctly.
  - Given strategy details, when opened, then thesis, horizon, EOD timing, version, factors, constraints, regime, cadence, turnover, preferred hold, tests, and history are visible.
- **Invariants**: Paper, recommendation, approval-required, restricted-auto, and live state are unmistakable.
- **Traceability**: FR-170; AC-3, AC-16; SECURITY-08; PBT-03.
- **INVEST**: Pass - delivers the investor's core read and create workspace.

## US-033 Operate an Accessible Safety Interface

- **Phase**: 3
- **Persona**: Ravi
- **Story**: As an operator, I want an accessible operations interface so that I can diagnose and act safely without relying on color or pointer input.
- **Acceptance criteria**:
  - Given operations data, when viewed, then jobs, sessions, stale data, broker health, rejections, mismatches, alerts, audit events, and kill switches are searchable and explicit.
  - Given a disabled action, when focused, then the blocking data, risk, approval, or broker condition is explained.
  - Given keyboard-only use, when navigating, then controls have semantic labels, visible focus, logical order, confirmations, and WCAG 2.1 AA contrast.
- **Invariants**: UI hiding never replaces server-side authorization; destructive actions require confirmation.
- **Traceability**: FR-170; NFR-UX; AC-16; SECURITY-08, SECURITY-11.
- **INVEST**: Pass - one accessible operational interaction boundary.

## US-034 Protect Portfolio APIs and Sessions

- **Phase**: 0
- **Persona**: Priya
- **Story**: As an investor, I want authenticated and validated APIs so that another principal or malformed request cannot access or corrupt my portfolios.
- **Acceptance criteria**:
  - Given a non-public request, when processed, then secure session validation and portfolio object authorization occur before data access.
  - Given mutation input, when processed, then schema, type, format, length, range, payload size, correlation ID, CSRF, CORS, and idempotency rules apply using parameterized storage operations.
  - Given HTML responses, when returned, then restrictive CSP, applicable HSTS, `nosniff`, frame protection, and referrer policy are set.
  - Given authentication failures, when thresholds are exceeded, then brute-force protection and security alerts apply; privileged accounts support MFA.
  - Given an error, when returned, then no stack, path, framework, database, token, or account detail is exposed.
- **Invariants**: Authorization is deny-by-default; sessions expire and logout invalidates them; secrets are never hardcoded or logged.
- **Traceability**: FR-160; NFR-SEC; SECURITY-04, SECURITY-05, SECURITY-08, SECURITY-09, SECURITY-11, SECURITY-12, SECURITY-15; PBT-03, PBT-06, PBT-07.
- **INVEST**: Pass - coherent API/session security boundary with externally verifiable responses.

## US-035 Audit and Explain Critical Decisions

- **Phase**: 1
- **Persona**: Priya
- **Story**: As an investor, I want tamper-evident explanations and reports so that I can verify why portfolio state changed.
- **Acceptance criteria**:
  - Given buy, hold, reduce, sell, or skip decisions, when recorded, then structured reason codes and human-readable explanations reference their input versions.
  - Given a critical state change, when committed, then actor, timestamp, portfolio, run, before/after details, previous hash, and new hash are appended.
  - Given an audit export, when downloaded, then secrets and account identifiers are redacted while verification data remains.
  - Given performance and attribution snapshots, when stored, then they are immutable for their as-of version.
- **Invariants**: Application behavior cannot rewrite or delete audit events; every chain verifies or visibly fails.
- **Traceability**: FR-180; AC-17; SECURITY-03, SECURITY-13, SECURITY-14; PBT-02, PBT-03.
- **INVEST**: Pass - one auditable explanation and export capability.

# Epic 8: Research, AI Policy, and Delivery Quality

## US-036 Backtest Without Look-Ahead or Survivorship Bias

- **Phase**: 2
- **Persona**: Arjun
- **Story**: As a strategy editor, I want point-in-time backtests so that historical results represent information and instruments actually available then.
- **Acceptance criteria**:
  - Given a historical period, when replayed, then point-in-time membership, publication-date fundamentals, adjusted prices, delisted securities, calendars, whole shares, cash, costs, taxes, corporate actions, liquidity, and T+1 execution apply.
  - Given incomplete point-in-time data, when a production-quality backtest is requested, then it is rejected.
  - Given known future information, when injected into a test fixture, then look-ahead and survivorship safeguards detect failure.
- **Invariants**: Backtest decision time precedes execution time; data versions and assumptions are reproducible.
- **Traceability**: FR-130; AC-15; SECURITY-13; PBT-03, PBT-05, PBT-08.
- **INVEST**: Pass - one historically faithful replay capability with explicit bias tests.

## US-037 Compare and Validate Horizon Strategies

- **Phase**: 2
- **Persona**: Arjun
- **Story**: As a strategy editor, I want robust horizon-appropriate validation so that presets are judged by risk-adjusted evidence rather than headline return.
- **Acceptance criteria**:
  - Given a strategy version, when validated, then in-sample, validation, true out-of-sample, walk-forward, stability, sensitivity, regime stress, bootstrap or Monte Carlo, and shadow results are available.
  - Given short, medium, and long presets, when compared, then horizon-appropriate rolling return, drawdown, risk, benchmark, turnover, cost, tax, cash, attribution, and average holding period are reported.
  - Given an apparent best CAGR, when risk, instability, costs, or turnover fail thresholds, then approval remains blocked.
- **Invariants**: Comparisons use the same point-in-time and cost conventions; no result promises future returns.
- **Traceability**: FR-011, FR-130; AC-4, AC-15; SECURITY-13; PBT-03, PBT-05, PBT-08.
- **INVEST**: Pass - validates strategy evidence independently of activation.

## US-038 Keep AI Advisory and Deterministic

- **Phase**: 1
- **Persona**: Arjun
- **Story**: As a strategy editor, I want AI limited to advisory tasks so that deterministic engines remain responsible for financial decisions.
- **Acceptance criteria**:
  - Given permitted content, when AI is used, then it may summarize, classify, extract, compare, explain, or prioritize review.
  - Given a request to invent returns, alter parameters, select securities or quantities, bypass controls, turn allegations into facts, or execute orders, when processed, then it is refused.
  - Given a trade-impacting event, when considered, then only verified structured sources can set its deterministic flag.
- **Invariants**: AI output alone cannot change strategy, portfolio, plan, risk, approval, or order state.
- **Traceability**: FR-150; AC-17; SECURITY-05, SECURITY-11, SECURITY-15; PBT-03, PBT-06.
- **INVEST**: Pass - one explicit authority boundary with positive and negative scenarios.

## US-039 Verify Capacity, CI, and Supply Chain

- **Phase**: 0
- **Persona**: Ravi
- **Story**: As an operator, I want automated quality and capacity gates so that changes remain safe at the supported portfolio scale.
- **Acceptance criteria**:
  - Given interactive local reads, when load-tested at supported scale, then p95 is below 500 ms excluding provider latency.
  - Given 100 portfolios, 1,000 instruments, 10 years of daily history, and broker limits, when capacity tests run, then jobs complete before dependent schedules and the event loop remains responsive.
  - Given a change, when GitHub Actions runs, then type checks, example tests, full property tests with seeds and shrinking, security checks, vulnerability scanning, SBOM generation, and build verification pass.
  - Given dependencies and pipeline tools, when verified, then lock files, trusted sources, pinned versions, and controlled pipeline modification apply.
- **Invariants**: Failed quality gates block deployment; flaky property failures are investigated rather than silently retried.
- **Traceability**: NFR-PERF, NFR-TEST, NFR-MAINT; AC-19; SECURITY-09, SECURITY-10, SECURITY-13; RESILIENCY-03, RESILIENCY-04, RESILIENCY-09; PBT-01 through PBT-10.
- **INVEST**: Pass - one delivery gate with measurable capacity and quality outcomes.

# Traceability and Coverage Summary

## Functional Coverage

- **Portfolio and strategy**: FR-001 through FR-011 -> US-001 through US-009.
- **Data, eligibility, signals, and construction**: FR-020 through FR-050 -> US-010 through US-015, US-020.
- **Rebalancing, costs, and taxes**: FR-060 through FR-070 -> US-016 through US-019.
- **Broker, paper, approval, automation, and risk**: FR-080 through FR-110 -> US-021 through US-027.
- **Scheduling, research, corporate actions, AI, APIs, UI, and audit**: FR-120 through FR-180 -> US-014, US-028 through US-039.
- **Data and non-functional requirements**: DR-001 through DR-003 and all NFR groups -> US-001, US-029 through US-035, US-039.

## Acceptance Coverage

Requirements acceptance criteria AC-1 through AC-19 are mapped to at least one story. Portfolio isolation, EOD-only horizon behavior, no real automated orders, backup recovery, and CI quality gates have explicit negative scenarios.

## Extension Compliance

### Security Compliance

- **Compliant**: SECURITY-01 and SECURITY-03 through SECURITY-15 are mapped to explicit acceptance scenarios.
- **N/A for current local topology**: SECURITY-02, SECURITY-06, and SECURITY-07 network intermediary, cloud IAM, and cloud network checks. They become applicable if hosted infrastructure is introduced.
- **Blocking findings**: None.

### Resiliency Compliance

- **Compliant**: RESILIENCY-01 through RESILIENCY-07, RESILIENCY-10 through RESILIENCY-13, and RESILIENCY-15 map to workload, failure, monitoring, recovery, and incident stories.
- **N/A for local workstation topology**: RESILIENCY-08 multi-zone/multi-region deployment and RESILIENCY-09 cloud auto-scaling; local capacity remains covered by US-039.
- **Deferred as required**: RESILIENCY-14 testing approach remains an NFR Design decision; US-030 defines the recovery scenarios it must validate.
- **Blocking findings**: None.

### Property-Based Testing Compliance

- **Downstream enforcement**: PBT-01 through PBT-10 are mapped where invariants, round trips, idempotency, oracle comparison, generated domain data, or stateful transitions apply.
- **Complementary examples**: Every story retains concrete Given/When/Then scenarios; property tests cannot replace these examples.
- **Blocking findings**: None at the User Stories stage.
