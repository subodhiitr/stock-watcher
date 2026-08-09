# Automatic Portfolio Management Requirements

## Intent Analysis

- **User request**: Execute the selected automatic portfolio-management specification, create a paper portfolio, allow multiple portfolios to use different strategies, and define short-, medium-, and long-horizon non-intraday rebalance strategies.
- **Request type**: New feature and system-wide enhancement.
- **Scope estimate**: Multiple components across portfolio domain logic, persistence, market data, broker adapters, APIs, scheduling, backtesting, risk controls, and Remix UI.
- **Complexity estimate**: Complex and high risk because the system makes financial decisions, can submit broker orders, maintains tax and performance records, and must fail closed.
- **Requirements depth**: Comprehensive.

## Source of Truth

1. `C:\data\project\spec\automatic_portfolio_management_spec.md`
2. `C:\data\project\spec\adaptive_momentum_quality_strategy.json`
3. Answers in `requirement-verification-questions.md`
4. Answers in `resiliency-clarification-questions.md`
5. The user's multi-portfolio and paper-portfolio addition
6. The user's short-, medium-, and long-horizon strategy addition
7. `strategy-presets.md`

If requirements conflict, this document and the recorded user answers take precedence over the original specification.

## Confirmed Product Decisions

- Implement roadmap Phases 0 through 6, including restricted automation, Sharekhan integration, multi-strategy capabilities, and advanced optimization.
- Full-auto execution remains excluded until the activation evidence defined by the source specification is satisfied and the user explicitly enables it.
- Implement approval-based Zerodha execution but keep live execution disabled by default.
- Never place real broker orders during automated validation; use fake, paper, or dry-run adapters.
- Build point-in-time provider interfaces and fail closed when required licensed data is unavailable.
- Use current NSE/Yahoo integrations only for prototyping and non-execution research.
- Store the new domain in a separate `portfolio-management.db`; do not migrate, mutate, or delete existing operational trading records.
- Implement the full portfolio workspace in the existing Remix application.
- Enable the security, resiliency, and full property-based-testing baselines.
- Seed one paper portfolio and support multiple isolated portfolios with independent strategy assignments.
- Provide versioned short-, medium-, and long-horizon strategy presets; all use EOD signals and delivery execution rather than intraday trading.

## Actors

- **Investor**: Creates portfolios, assigns strategies, reviews performance, and approves rebalance plans.
- **Strategy editor**: Creates and versions strategy configurations.
- **Order approver**: Approves or rejects live order baskets.
- **Operator**: Monitors jobs, data health, broker health, reconciliation, alerts, and kill switches.
- **Scheduler**: Runs deterministic portfolio jobs under configured safety policies.
- **Broker adapter**: Synchronizes accounts and executes approved orders.

For the initial single-investor deployment, one person may hold multiple roles, but privileged actions must remain distinct and auditable.

## Functional Requirements

### FR-001 Portfolio Lifecycle and Isolation

1. The system shall create, read, update, archive, and list multiple portfolios.
2. Every portfolio shall have an immutable identifier, display name, base currency, operating mode, status, optional broker account, and active strategy assignment.
3. Portfolio names shall be unique among non-archived portfolios.
4. Holdings, lots, cash, orders, rebalance runs, performance, risk state, and audit records shall be scoped by portfolio identifier.
5. Requests referencing a portfolio shall verify that the portfolio exists and is accessible before reading or mutating state.
6. Archiving a portfolio shall block new evaluations and orders without deleting historical records.
7. Switching the selected portfolio in the UI shall never merge or leak state from another portfolio.

### FR-002 Seeded Paper Portfolio

1. First initialization of an empty `portfolio-management.db` shall create exactly one portfolio named `Paper Portfolio`.
2. The seeded portfolio shall use INR, PAPER mode, active status, and the `adaptive-momentum-quality` strategy version `1.0.0`.
3. The seeded portfolio shall not require a broker account.
4. The default starting paper cash shall be configurable and shall initially be INR 1,000,000.
5. Re-running initialization shall be idempotent and shall not duplicate or reset the seeded portfolio.
6. Tests shall create isolated temporary databases and shall never seed or alter the user's persistent database.

### FR-003 Portfolio Strategy Assignment

1. Each portfolio shall independently assign an active immutable strategy version.
2. Different portfolios may use different strategies or different versions of the same strategy.
3. Changing an assignment shall create an audit event and shall affect only future evaluations.
4. Existing signal snapshots, targets, plans, and orders shall retain the strategy version used to create them.
5. A strategy version may not be changed after activation; changes shall create a new version.
6. Advanced scope shall support multiple strategy sleeves within one portfolio with explicit allocation weights that total 100%.

### FR-010 Strategy Management

1. Strategies shall be schema-validated, versioned configurations rather than executable user code.
2. A strategy shall define universe, eligibility, factors, composite scoring, construction, regime, entry, hold/exit, rebalance, execution, risk, tax, automation, benchmark, version, and effective date.
3. The supplied adaptive momentum-quality JSON shall be imported as the initial strategy.
4. Configuration hashes and approval metadata shall make activated strategy versions tamper-evident.
5. Parameter changes shall require validation, backtest evidence, explicit activation, and audit history.
6. Invalid weights, unsupported enums, unsafe limits, or arbitrary executable content shall be rejected.
7. Fresh initialization shall register the three immutable strategy presets defined in `strategy-presets.md`.
8. Presets shall be available initially for PAPER and OBSERVE modes; live use shall require separate evidence and activation.

### FR-011 Horizon Strategy Presets

1. The system shall provide `short-horizon-momentum-quality@1.0.0`, `adaptive-momentum-quality@1.0.0`, and `long-horizon-quality-compounders@1.0.0`.
2. The short-horizon preset shall target 1-3 month positional holdings, use EOD signals, review constituents every two weeks, and enforce a 40% rolling 30-day turnover budget.
3. The medium-horizon preset shall target 3-12 month holdings, retain the supplied adaptive momentum-quality parameters, rebalance constituents monthly, and enforce a 25% calendar-month turnover budget.
4. The long-horizon preset shall target 1-5 year holdings, emphasize quality and low risk, rebalance constituents quarterly, and enforce 15% quarterly and 30% annual turnover budgets.
5. Each preset shall define its own factor weights, target and maximum holdings, cash buffer, drift band, replacement hurdle, preferred minimum holding period, and period-aware turnover limits as specified in `strategy-presets.md`.
6. Preferred holding periods shall suppress routine churn but shall not block hard-risk exits, mandatory-eligibility exits, or verified corporate-action handling.
7. All presets shall calculate decisions from finalized end-of-day data, create plans after market close, and execute approved delivery/CNC orders only in a later eligible session.
8. No preset shall perform high-frequency optimization, intentional same-day round trips, short selling, leverage, or margin-funded trading.
9. Strategy comparison shall report horizon-appropriate return, drawdown, turnover, cost, tax, and holding-period metrics without promising returns.

### FR-020 Data Providers and Health

1. Provider interfaces shall cover EOD prices, point-in-time index membership, fundamentals, corporate actions, broker instruments, live quotes, exchange calendar, and verified event flags.
2. Every record used for a decision shall retain source, fetched time, market time, effective date, version or checksum, validation status, and stale-after threshold.
3. Production-quality signals and executable plans shall require adjusted, point-in-time, complete, non-stale data.
4. Missing licensed point-in-time providers shall block production backtest claims and live order generation.
5. Existing NSE/Yahoo data may be used only for prototype, comparison, and non-execution research with visible provenance.
6. Data anomalies, unresolved corporate actions, stale quotes, and clock mismatches shall activate data kill switches.

### FR-030 Universe and Eligibility

1. The default live universe shall be Nifty 500; backtests shall require historical point-in-time membership.
2. Configurable alternatives shall include Nifty 100, Nifty 200, Nifty 500, custom watchlists, and selected ETFs.
3. Eligibility shall enforce listing history, data completeness, price, traded value, spread, trading status, surveillance status, corporate-action validity, fundamental freshness, broker mapping, and anomaly checks.
4. Financial-sector companies shall use sector-appropriate quality rules.
5. Severe verified governance, solvency, default, fraud, delisting, or regulatory flags shall create deterministic risk blocks.

### FR-040 Signals and Market Regime

1. Signal calculations shall be deterministic and reproducible for a strategy version, data version, and as-of time.
2. Momentum, quality, and low-risk scores shall follow the source specification and supplied strategy weights.
3. Inputs shall be winsorized and normalized using documented percentile or robust z-score rules.
4. Missing values shall use explicit deterministic policies and shall never silently become favorable scores.
5. Market regime shall control total equity exposure but shall not select individual securities.
6. Regime transitions shall implement confirmation and hysteresis.
7. Every score and regime result shall retain component values, reason codes, risk flags, and data lineage.

### FR-050 Portfolio Construction and Optimization

1. The default strategy shall target 25 holdings with the specified entry, hold, review, and maximum-position ranks.
2. Initial weighting shall use inverse volatility adjusted by score conviction.
3. Construction shall enforce stock, sector, group, small-cap, liquidity, turnover, and cash constraints.
4. The planner shall produce both an unconstrained ideal target and a constraint-valid executable target.
5. The difference shall be reported as implementation shortfall.
6. MVP whole-share allocation shall use a deterministic greedy allocator.
7. Advanced scope shall support a verified integer optimizer and risk-parity allocation without weakening constraints.
8. Allocation results shall never use leverage, short positions, or unavailable delivery quantity.

### FR-060 Rebalance Planning

1. The system shall evaluate finalized EOD data, health, regime, ranks, and risk after each trading day but shall change routine constituents only on the assigned strategy's biweekly, monthly, or quarterly schedule.
2. A rebalance shall compare actual broker or paper state with target allocations.
3. The planner shall apply no-trade bands, minimum order value, rank buffers, replacement hurdles, turnover limits, costs, taxes, liquidity, and available cash.
4. Plans shall include proposed and skipped orders with reason codes.
5. Each plan shall show current and target weights, quantities, values, costs, taxes, cash, sectors, risks, warnings, and urgency.
6. Plans shall follow the documented state machine and preserve every state transition.
7. Re-running the same planning input shall produce an equivalent plan and shall not duplicate orders.
8. Turnover enforcement shall support rolling 30-day, calendar-month, calendar-quarter, and calendar-year budgets and shall aggregate all runs for the portfolio.
9. Interim rebalances outside the routine schedule shall require a hard-risk exit, mandatory-eligibility failure, verified corporate action, or confirmed regime-driven exposure reduction.

### FR-070 Cost and Tax

1. Cost schedules shall be configurable independently from strategy logic.
2. Estimates shall include brokerage, STT, exchange charges, GST, SEBI charges, stamp duty, DP charges, spread, slippage, market impact, and broker fees.
3. Live and backtest planning shall share the same cost model.
4. The system shall maintain acquisition lots and support jurisdiction-configured lot selection.
5. Tax rates and holding-period rules shall be configurable and effective-dated.
6. Tax preferences shall never override a hard-risk exit.
7. Explanations shall identify when costs or taxes cause a trade to be skipped.

### FR-080 Broker Synchronization and Reconciliation

1. A broker adapter interface shall normalize account, holdings, cash, instrument, order, fill, cancellation, and status operations.
2. Zerodha shall be the first live adapter and Sharekhan shall be supported in the full roadmap.
3. Broker holdings, cash, delivery quantity, and open orders shall reconcile before generating executable orders.
4. External portfolio changes shall be detected and recorded without overwriting history.
5. An unknown broker order status shall block duplicate placement and further dependent execution.
6. Reconciliation shall run before execution, after sells, after buys, after partial fills, at end of day, and after restart.

### FR-090 Paper Execution

1. Every portfolio may operate in PAPER mode independently.
2. Paper execution shall use the same plan, validation, state machine, cost, slippage, idempotency, and reconciliation contracts as live execution.
3. Paper fills shall support partial fills, rejection, expiry, cancellation, and residual orders.
4. Paper operation shall maintain a complete shadow portfolio and performance history.
5. Paper and live records shall be unambiguously distinguishable.

### FR-100 Approval-Based and Restricted Execution

1. Live order submission shall be disabled by default at application, portfolio, strategy, and environment levels.
2. Approval-required mode shall allow approval or rejection of a basket and individual orders.
3. Approval shall bind to the exact plan hash, strategy version, portfolio state version, and price-validity window.
4. Any material state or price change after approval shall invalidate approval and require replanning.
5. Sells shall execute before buys; buys shall be recalculated from confirmed available cash.
6. Every order shall use an idempotency key based on portfolio, rebalance run, symbol, side, and sequence.
7. Restricted automation shall enforce approved universe, CNC-only product, order count, daily notional, position, turnover, data, drawdown, rejection, and reconciliation limits.
8. New constituents, hard-risk events, and material tax-impact sells shall continue to require human approval.
9. Full-auto shall remain disabled until all source-specification activation criteria are met and explicitly approved.

### FR-110 Risk Controls and Kill Switches

1. Every order shall pass symbol, product, quantity, price, concentration, cash, turnover, liquidity, restriction, count, notional, connectivity, freshness, conflict, idempotency, strategy, and automation checks.
2. Risk controls shall apply independently per portfolio and globally across the application.
3. A global kill switch shall block new orders, cancel cancellable pending orders, permit reconciliation, and never liquidate holdings automatically.
4. Portfolio kill switches shall stop only the selected portfolio.
5. Kill-switch activation and reset shall require reason, actor, timestamp, and audit event.
6. Data, broker, drawdown, negative cash, unresolved mismatch, and repeated execution errors shall fail closed.

### FR-120 Scheduling and Jobs

1. The scheduler shall use the exchange calendar and Asia/Kolkata timezone.
2. Jobs shall implement the source schedule for data, signals, planning, broker checks, execution, reconciliation, and performance snapshots.
3. Job leases shall prevent duplicate concurrent runs.
4. Every job shall expose status, start/end time, input version, progress, result, error, and retry eligibility.
5. Restart shall recover or reconcile incomplete jobs without assuming success.
6. Operators shall be able to trigger safe jobs manually with the same locking and validation.
7. Routine planning jobs shall resolve each portfolio's assigned strategy schedule independently and shall never treat a manual run as permission to bypass cadence or turnover controls.

### FR-130 Backtesting and Research

1. Backtests shall use point-in-time universe membership, publication-date fundamentals, adjusted prices, delisted instruments, exchange calendars, whole shares, cash, costs, slippage, taxes, corporate actions, liquidity, and realistic T+1 execution.
2. Backtests shall prevent look-ahead and survivorship bias.
3. Reports shall include all required return, risk, drawdown, benchmark, turnover, cost, tax, cash, and attribution metrics.
4. Validation shall include in-sample, validation, true out-of-sample, walk-forward, stability, sensitivity, regime stress, bootstrap or Monte Carlo, and shadow operation.
5. Strategy approval shall not optimize solely for highest CAGR.
6. Advanced scope shall support scenario analysis, multiple strategies, and improved attribution.

### FR-140 Corporate Actions

1. The engine shall support dividends, splits, bonus issues, rights issues, mergers, demergers, symbol changes, delisting, buybacks, and ETF unit changes.
2. Adjustments shall preserve quantity, average-price, tax-lot, and audit lineage.
3. Unresolved mappings shall block affected rebalances.
4. Broker holdings shall reconcile after effective dates.

### FR-150 AI and News Policy

1. AI may summarize, classify, extract, compare, explain, and prioritize review.
2. AI shall not invent returns, change strategy parameters, choose securities or quantities, bypass controls, convert allegations to facts, or execute orders.
3. Only verified structured sources shall create trade-impacting event flags.
4. Deterministic engines shall remain the authority for portfolio decisions.

### FR-160 APIs

1. APIs shall implement portfolio CRUD and selection in addition to the portfolio, strategy, rebalance, risk, operations, data-health, and broker-health endpoints in the source specification.
2. Every portfolio-scoped path shall include or resolve an explicit portfolio identifier.
3. Mutation APIs shall validate schemas, enforce authorization, accept correlation identifiers, and return stable error codes.
4. Order, approval, execution, kill-switch, and strategy activation APIs shall require idempotency tokens.
5. Existing `/trade-execution` shall remain the canonical legacy trade API; `/paper-trades` remains a compatibility alias.
6. New portfolio APIs shall not silently change legacy simulation or intraday behavior.

### FR-170 Dashboard

1. `/portfolio` shall provide a portfolio selector and creation flow.
2. Users shall be able to create portfolios, select an operating mode, set paper capital, and assign an existing short-, medium-, or long-horizon strategy version.
3. The workspace shall display overview, holdings, targets, drift, ranks, reasons, tax estimates, risk flags, and benchmarked performance for the selected portfolio.
4. Rebalance preview shall show order basket, skipped orders, before/after allocation and risk, costs, taxes, cash, warnings, approval, rejection, and execution state.
5. Strategy view shall show thesis, intended holding horizon, EOD-only timing, version, factors, constraints, regime, rebalance cadence, turnover budgets, preferred holding period, test metrics, and history.
6. Operations view shall show jobs, sessions, stale data, broker health, rejected orders, unresolved reconciliation, alerts, audit events, and kill switches.
7. The UI shall clearly distinguish paper, recommendation, approval-required, restricted-auto, and live state.
8. `/portfolio` shall be a dedicated React-rendered URL composed from separate portfolio route, state, hook, and feature components; it shall not embed or depend on legacy dashboard markup or intraday UI state.

### FR-180 Explainability, Audit, and Reporting

1. Every buy, hold, reduce, sell, and skip decision shall include structured reason codes and a human-readable explanation.
2. Critical state changes shall write append-only, hash-chained audit events with actor, timestamp, portfolio, run, previous hash, and details.
3. Audit exports shall be downloadable and redact secrets and account identifiers.
4. Performance snapshots and attribution shall be immutable for their as-of version.
5. Metrics and alerts shall cover ingestion, freshness, calculations, broker latency, rejection, fills, reconciliation, slippage, charges, turnover, automation blocks, and kill switches.

## Data Requirements

### DR-001 Separate Database

- Use `portfolio-management.db` for all new portfolio-domain tables.
- Do not attach or mutate `stock-watcher.db` during portfolio-domain migrations or tests.
- Read-only adapters may import normalized legacy or broker state only through explicit synchronization.

### DR-002 Core Entities

The database shall include versioned schemas for:

- portfolios and portfolio strategy assignments;
- strategy definitions and immutable versions;
- portfolio snapshots, holdings, and holding lots;
- instrument master and provider mappings;
- data health and corporate actions;
- signal and regime snapshots;
- ideal and executable target allocations;
- rebalance runs and planned orders;
- broker orders, fills, and reconciliation records;
- paper orders and fills using shared order contracts;
- scheduled jobs, leases, alerts, and kill switches;
- performance, attribution, and benchmark snapshots;
- append-only audit events.

### DR-003 Integrity

- All monetary values shall use integer minor units or exact decimal representation, never binary floating point for persisted accounting.
- Quantities, dates, timezones, enum states, foreign keys, uniqueness, and checks shall be enforced at schema and domain boundaries.
- Schema changes shall use numbered forward and reversal migrations.
- Backup and restore shall preserve audit-chain verification.

## Non-Functional Requirements

### NFR-SEC Security

1. Portfolio databases, backups, tokens, and generated reports shall be encrypted at rest using an OS-protected key; all non-local traffic shall use TLS 1.2 or newer.
2. Secrets shall use environment variables or the OS secret store and shall never enter source, logs, reports, strategy JSON, or audit details.
3. HTML responses shall set restrictive CSP, HSTS where HTTPS applies, `nosniff`, frame protection, and strict referrer policy.
4. Every API field shall have schema, type, format, length, range, and payload-size validation.
5. Local authentication, secure sessions, object-level portfolio authorization, and privileged role checks shall protect all non-public routes.
6. Strategy editing, order approval, automation activation, and kill-switch reset shall be separately authorized and audited.
7. Structured logs shall include timestamp, level, correlation ID, event, and redacted context.
8. Security events and audit logs shall be tamper-evident and retained for at least 90 days.
9. Rate limiting, CSRF protection, restricted CORS, generic errors, fail-safe defaults, and resource cleanup shall apply.
10. Dependencies shall be locked, vulnerability-scanned, sourced from trusted registries, and represented in an SBOM.
11. Automation activation shall require two-factor confirmation.

### NFR-REL Reliability and Resiliency

1. Execution, reconciliation, risk, audit, and portfolio persistence are **Critical** workloads.
2. Signals, planning, scheduling, and broker synchronization are **High** workloads.
3. Research reports and non-execution news summaries are **Medium** workloads.
4. The local production target is successful service for at least 99% of configured evaluation and execution windows when the host, exchange, and broker are available.
5. Recovery target is hours using encrypted backup and restore; maximum acceptable persistent portfolio-data loss is one hour.
6. Deployment topology is a local workstation with no cloud-region topology.
7. Persistent data shall have automated encrypted hourly backups, daily retained backups, and tested restore procedures.
8. External calls shall use bounded timeouts, retries only where safe, jittered backoff, circuit breakers for critical dependencies, and bulkheads where resource exhaustion is possible.
9. Deep health checks shall report database, data-provider, broker, scheduler, audit-chain, backup, and clock health without exposing secrets.
10. Non-critical dependency failure may degrade research views but shall never allow trading with incomplete state.
11. A lightweight change process shall require a change record, approval, test evidence, and rollback note.
12. GitHub Actions shall run type checking, example tests, property tests, security checks, and build verification.
13. Direct local deployment shall require backup, preflight validation, post-deploy health verification, and database-aware rollback.
14. A lightweight incident process shall cover severity, containment, recovery, communication, evidence, correction-of-errors review, and tracked actions.

### NFR-PERF Performance and Capacity

1. Interactive local database reads shall target p95 response under 500 ms for supported portfolio sizes, excluding external provider latency.
2. API endpoints invoking external providers shall expose bounded deadlines and shall not block the event loop with CPU-heavy optimization or compression.
3. Daily signal and planning jobs shall complete before their next scheduled dependent job.
4. Optimizers shall expose duration, iteration, constraint, and fallback metrics.
5. Capacity tests shall cover at least 100 portfolios, 1,000 instruments, 10 years of daily history, and the configured broker order limits.

### NFR-TEST Testing

1. Example-based unit, integration, API, UI, failure-injection, and acceptance tests shall cover the source specification.
2. Full property-based testing shall use `fast-check` integrated with Node's test runner.
3. Domain generators shall cover portfolios, strategies, holdings, lots, scores, targets, orders, fills, and state transitions.
4. Properties shall cover normalization ranges, weight and cash invariants, no leverage or shorting, portfolio isolation, serialization round trips, idempotency, deterministic scoring, allocator constraints, and state-machine safety.
5. Stateful model tests shall compare random command sequences for portfolio, rebalance, order, kill-switch, and reconciliation state.
6. Property-test failures shall report reproducible seeds and shrunk counterexamples.
7. Critical paths shall retain explicit example tests in addition to property tests.
8. No test shall use real broker credentials, mutate persistent user data, or submit a real order.
9. Tests shall prove each horizon preset obeys its cadence, preferred-hold exceptions, no-trade band, replacement hurdle, and all applicable turnover windows.
10. Tests shall prove that EOD decisions cannot create same-session routine trades or invoke legacy intraday rules.

### NFR-MAINT Maintainability

1. New portfolio domain code shall be isolated from intraday simulation logic.
2. Shared broker, market-data, audit, and cost contracts may be reused through explicit adapters.
3. New domain and UI code shall use strict TypeScript.
4. Public domain interfaces, migrations, state machines, reason codes, and configuration schemas shall be documented.
5. `ticker_proxy.js` shall expose new behavior through focused route and service modules rather than adding portfolio business logic directly.

### NFR-UX Usability and Accessibility

1. Destructive, live, approval, automation, and kill-switch actions shall require clear confirmation and display consequences.
2. Disabled actions shall explain the blocking data, risk, approval, or broker condition.
3. Status shall not rely on color alone.
4. New controls shall support keyboard operation, visible focus, semantic labels, and WCAG 2.1 AA contrast.
5. Monetary, percentage, timezone, and as-of values shall be explicit and consistent.

## Operating and Recovery Decisions

- **DR strategy**: Encrypted backup and restore.
- **RTO**: Hours.
- **RPO**: One hour for portfolio-domain persistence.
- **Change management**: Lightweight change record, approval, test evidence, and rollback note.
- **CI/CD**: GitHub Actions.
- **Rollback**: Database-aware forward and reversal migrations plus previous-version redeployment.
- **Deployment**: Direct local workstation deployment with gates.
- **Regional topology**: Not applicable to the local workstation deployment.
- **Incident response**: Lightweight severity, containment, recovery, audit, and correction-of-errors process.
- **Resiliency testing approach**: To be selected during NFR Design as required by RESILIENCY-14.

## Acceptance Criteria

1. A fresh portfolio database contains exactly one usable `Paper Portfolio` assigned to strategy `adaptive-momentum-quality@1.0.0`.
2. Fresh initialization registers all three horizon strategy presets exactly once.
3. Users can create at least two additional portfolios, assign different horizon strategy versions, and observe complete state isolation.
4. Short-, medium-, and long-horizon plans enforce their configured biweekly, monthly, and quarterly constituent schedules and period-aware turnover budgets.
5. Every preset uses finalized EOD decisions and next-session delivery/CNC execution without intentional same-day round trips or legacy intraday rules.
6. Broker holdings and cash reconcile exactly before executable planning.
7. Daily scores are reproducible from stored strategy and data versions.
8. Ideal and executable targets satisfy all configured constraints.
9. Rebalance previews include costs, taxes, risks, skipped trades, and reason codes.
10. Paper orders exercise the full order and reconciliation state machine.
11. Zerodha approval execution exists but remains disabled until explicitly configured; automated tests prove no real order path is invoked.
12. Sharekhan and restricted automation conform to the same safety contracts.
13. Duplicate submissions do not create duplicate broker or paper orders.
14. Global and portfolio kill switches block new orders while allowing reconciliation.
15. Point-in-time backtests reject incomplete data and pass look-ahead and survivorship safeguards.
16. Dashboard reports selected-portfolio holdings, strategy, horizon, rebalance cadence, operations, benchmark performance, and drawdown.
17. Every critical decision and state transition is auditable and portfolio-scoped.
18. Backup restore recovers the portfolio database within the approved hours-level target with no more than one hour of data loss.
19. Type checks, example tests, property tests, security checks, and build verification pass in GitHub Actions.

## Out of Scope and Safety Limits

- Managing third-party client money or public model-portfolio distribution.
- Futures, options, short selling, leverage, and margin-funded positions.
- High-frequency or intraday portfolio optimization.
- Intraday signals, intentional same-day round trips, and reuse of legacy intraday entry or exit rules for portfolio rebalancing.
- AI-generated strategy parameters or direct AI order authority.
- Real broker orders during development, automated testing, or agent validation.
- Full-auto activation without the evidence, observation periods, reconciliation record, compliance checks, and explicit approval required by the source specification.

## Traceability Summary

| Requirement area | Source |
|---|---|
| Portfolio lifecycle and multi-portfolio strategy isolation | User addition; source sections 5, 21, 23, 27 |
| Short-, medium-, and long-horizon strategy presets | User addition; `strategy-presets.md`; source sections 6 through 15 |
| Strategy, signals, regime, and construction | Source sections 6 through 10; supplied strategy JSON |
| Rebalance, costs, taxes, and execution | Source sections 11 through 17 and 24 |
| Data, corporate actions, and storage | Source sections 19 through 21 |
| APIs, scheduling, backtesting, and dashboard | Source sections 23 through 27 |
| Security, observability, and compliance | Source sections 29 through 31; security extension |
| Testing and delivery roadmap | Source sections 33 through 35; PBT extension |
| Recovery and operational process | Resiliency clarification answers; resiliency extension |

## Extension Compliance

### Security Baseline

- **Compliant at requirements stage**: SECURITY-01, SECURITY-03 through SECURITY-05, SECURITY-08 through SECURITY-15 are represented as explicit requirements.
- **N/A for current local topology**: SECURITY-02, SECURITY-06, and SECURITY-07 cloud/network-intermediary checks; they become applicable if hosted infrastructure is introduced.
- **Blocking findings**: None at requirements stage.

### Resiliency Baseline

- **Compliant at requirements stage**: RESILIENCY-01 through RESILIENCY-07 and RESILIENCY-10 through RESILIENCY-13 and RESILIENCY-15 have requirements or approved decisions.
- **N/A for local workstation topology**: RESILIENCY-08 multi-zone/multi-region and RESILIENCY-09 cloud auto-scaling.
- **Deferred by rule to NFR Design**: RESILIENCY-14 resiliency testing approach.
- **Blocking findings**: None at requirements stage.

### Property-Based Testing

- **Enabled in full**: PBT-01 through PBT-10 are mandatory in their applicable downstream stages.
- **Requirements-stage commitment**: `fast-check`, domain generators, shrinking, seed reproducibility, model/stateful testing, invariants, idempotency, round trips, and complementary example tests are required.
- **Blocking findings**: None at requirements stage.
