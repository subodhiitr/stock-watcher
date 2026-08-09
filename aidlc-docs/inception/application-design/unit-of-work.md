# Portfolio Management Units of Work

## Decomposition Model

The portfolio feature remains one local Node and Remix deployment. The units below are logical development and ownership boundaries inside the approved strict-TypeScript modular monolith; they are not independently deployed services. Each unit completes its design, code, and focused verification before dependent units begin.

## Unit Summary

| Order | Unit | Primary capability | Primary stories | Criticality |
|---|---|---|---|---|
| 1 | U01 Portfolio Domain Foundation | Shared financial contracts, portfolio aggregate, and strategy assignment | US-002, US-004, US-005, US-009 | Critical |
| 2 | U02 Portfolio Persistence | Isolated database ownership, migrations, repositories, seed, and transactions | US-001 | Critical |
| 3 | U03 Strategy, Data, and Research | Strategy lifecycle, point-in-time inputs, signals, corporate actions, backtesting, and advisory policy | US-006 through US-008, US-010 through US-014, US-036 through US-038 | High |
| 4 | U04 Construction and Rebalancing | Targets, costs, taxes, cadence, turnover, optimization, and explainable plans | US-015 through US-020 | High |
| 5 | U05 Execution and Reconciliation | Approval, risk, paper and broker execution, idempotency, reconciliation, and kill switches | US-021 through US-027 | Critical |
| 6 | U06 Operations, Security, and Recovery | Scheduling, health, audit, backup, restore, and incidents | US-028 through US-031, US-035 | Critical |
| 7 | U07 API and Runtime Integration | Authenticated portfolio APIs, validation, authorization, and composition | US-034 | Critical |
| 8 | U08 React Portfolio Workspace | Dedicated portfolio URLs, isolated UI state, accessible investor and operator views | US-003, US-032, US-033 | High |
| 9 | U09 Integrated Quality and Delivery | Cross-unit acceptance, property tests, capacity, CI, supply chain, and recovery verification | US-039 | Critical quality gate |

## U01 Portfolio Domain Foundation

### Responsibility

Define the stable vocabulary and pure state rules used by every later unit.

### In Scope

- Branded portfolio, strategy, rebalance, order, actor, correlation, and idempotency identifiers.
- Exact INR money, quantities, percentages, local dates, instants, and Asia/Kolkata exchange-session values.
- Portfolio lifecycle, cash, holdings, lots, immutable state versions, strategy assignments, and optional strategy sleeves.
- Domain errors, reason codes, transition guards, authorization scopes, audit-event envelopes, and post-commit event types.
- No-negative-cash, no-short, no-leverage, exact weight, portfolio-isolation, and immutable-lineage invariants.

### Boundaries

- Pure TypeScript with no SQL, HTTP, broker SDK, filesystem, timer, or React dependency.
- Does not import the legacy simulation or intraday strategy policy.
- Exposes contracts that later units implement through ports.

### Expected Code Area

- `server/portfolio/domain/`
- `server/portfolio/ports/`
- Shared API-safe contract types only where needed by later adapters.

### Exit Criteria

- Public types and state transitions are documented and strict-TypeScript clean.
- Example tests cover critical lifecycle rules.
- Property analysis identifies round-trip, invariant, idempotency, and state-model tests for downstream generation.

## U02 Portfolio Persistence

### Responsibility

Own `portfolio-management.db` and provide the only transactional persistence boundary for portfolio-domain state.

### In Scope

- Database owner, connection lifecycle, WAL and timeout configuration, schema versioning, and numbered migrations.
- Tables, constraints, indexes, repositories, unit of work, optimistic state versions, append-only audit persistence, and post-commit event extraction.
- Idempotent registration of three strategy presets and exactly one configurable INR 1,000,000 `Paper Portfolio`.
- Temporary test-database support, integrity checks, backup coordination hooks, and safe shutdown.

### Boundaries

- Never attaches, migrates, mutates, or deletes `stock-watcher.db`.
- Uses parameterized statements and exact persisted money representation.
- Commits financial state and its audit event atomically.

### Expected Code Area

- `server/portfolio/infrastructure/persistence/`
- `server/portfolio/adapters/persistence/`
- Portfolio-specific migrations under the same ownership boundary.

### Exit Criteria

- Fresh initialization and repeated initialization are deterministic and idempotent.
- Repository integration tests prove portfolio isolation, constraints, transaction rollback, and audit atomicity.
- Backup consumers can obtain a consistent database state without bypassing the database owner.

## U03 Strategy, Data, and Research

### Responsibility

Produce immutable, point-in-time, explainable strategy decisions and evidence without granting execution authority.

### In Scope

- Declarative strategy schema, canonicalization, hashing, version lifecycle, activation evidence, and the three horizon presets.
- Provider ports and adapters for EOD prices, point-in-time membership, fundamentals, corporate actions, instruments, quotes, and exchange calendars.
- Provenance, validation, freshness, effective dates, checksums, anomaly status, and provider health.
- Universe eligibility, normalization, factor signals, composite scores, regime confirmation, hysteresis, and reason codes.
- Corporate-action transformations and mapping blocks.
- Point-in-time backtesting, horizon comparisons, evidence reports, and deterministic AI-advisory boundaries.

### Boundaries

- Prototype NSE/Yahoo inputs remain visibly non-execution research data.
- Missing licensed or stale point-in-time inputs fail closed for production claims and executable planning.
- AI output cannot alter strategy, portfolio, target, risk, approval, or order state.

### Expected Code Area

- `server/portfolio/domain/strategy/`
- `server/portfolio/domain/evaluation/`
- `server/portfolio/application/evaluation/`
- `server/portfolio/adapters/market-data/`
- `server/portfolio/adapters/research/`

### Exit Criteria

- Identical strategy, data version, and as-of inputs produce equivalent outputs.
- Presets match approved horizon, EOD, cadence, holding, and turnover definitions.
- Backtests reject look-ahead, survivorship, or incomplete point-in-time inputs.

## U04 Construction and Rebalancing

### Responsibility

Convert approved evaluation snapshots into constraint-valid, after-cost, after-tax, explainable rebalance plans.

### In Scope

- Ideal and executable targets, inverse-volatility score weighting, cash buffers, and implementation shortfall.
- Whole-share greedy allocation and verified optional integer or risk-parity optimization.
- Stock, sector, group, liquidity, small-cap, cash, exposure, and turnover constraints.
- Effective-dated cost schedules, tax lots, tax estimates, and lot selection.
- Biweekly, monthly, quarterly, and annual cadence and turnover windows.
- Drift bands, preferred holding periods, rank buffers, replacement hurdles, minimum order values, and interim risk exceptions.
- Immutable proposed and skipped orders, structured reasons, plan hashes, and approval-ready views.

### Boundaries

- Consumes immutable portfolio, strategy, evaluation, holdings, lots, and reconciliation snapshots.
- Does not place or simulate orders.
- Routine plans use finalized EOD decisions and cannot schedule same-session or intraday execution.

### Expected Code Area

- `server/portfolio/domain/construction/`
- `server/portfolio/domain/rebalancing/`
- `server/portfolio/application/rebalancing/`
- `server/portfolio/adapters/optimization/`

### Exit Criteria

- Targets conserve exact weight and cash while satisfying all hard constraints.
- Equivalent immutable inputs produce equivalent plans and no duplicate logical orders.
- Optimizer failure cannot emit an unconstrained target and uses only a visible approved fallback.

## U05 Execution and Reconciliation

### Responsibility

Safely approve, submit, track, and reconcile paper or broker orders through one shared state machine.

### In Scope

- Plan-bound basket and order approvals, invalidation, pre-trade risk, automation limits, and current-state revalidation.
- Environment, application, portfolio, and strategy live gates, all disabled by default.
- Paper, fake, dry-run, Zerodha, and Sharekhan implementations of one broker port.
- Intent-before-submit persistence, stable idempotency keys, sell-before-buy sequencing, and cash recalculation.
- Partial fills, rejections, expiry, cancellation, residual orders, restarts, external changes, and unknown statuses.
- Portfolio and global kill-switch activation and reset policies.

### Boundaries

- External calls occur outside long database transactions.
- Automated verification composes only paper, fake, or dry-run adapters.
- Unknown status blocks duplicate submission and dependent execution until reconciliation.

### Expected Code Area

- `server/portfolio/domain/execution/`
- `server/portfolio/application/execution/`
- `server/portfolio/adapters/brokers/`
- Portfolio-specific risk and reconciliation modules.

### Exit Criteria

- State-machine and contract tests cover every supported order and reconciliation outcome.
- Repeated equivalent commands cannot create duplicate orders.
- No default or automated path can reach a real-order submission.

## U06 Operations, Security, and Recovery

### Responsibility

Operate the portfolio workload safely through scheduling, observability, audit integrity, backup, restore, and incident evidence.

### In Scope

- Exchange-calendar-aware jobs, portfolio-specific cadence, leases, dependencies, retries, manual triggers, and restart recovery.
- Shallow and deep health, structured logs, metrics, alerts, capacity indicators, broker and provider status, and audit-chain status.
- Append-only hash-chained audit, immutable performance, attribution, benchmark snapshots, redacted exports, and explanations.
- Encrypted hourly and retained daily backups, restore verification, database-aware rollback, preflight, and post-deploy checks.
- Lightweight change, incident, communication, correction-of-errors, and action-tracking records.

### Boundaries

- Operations may block execution but cannot silently mutate strategy or portfolio policy.
- Recovery verifies accounting, strategy hashes, jobs, reconciliation, audit chain, and disabled live gates before reopening work.
- Local workstation deployment makes cloud multi-zone, multi-region, auto-scaling, cloud IAM, and network-intermediary controls N/A.

### Expected Code Area

- `server/portfolio/application/operations/`
- `server/portfolio/infrastructure/scheduling/`
- `server/portfolio/infrastructure/observability/`
- `server/portfolio/infrastructure/recovery/`

### Exit Criteria

- Leases and recovery prevent duplicate job effects.
- Health and alerts expose actionable redacted status.
- Test restore meets the one-hour RPO and hours-level RTO and preserves audit verification.

## U07 API and Runtime Integration

### Responsibility

Expose portfolio application services through authenticated, authorized, validated HTTP resources and wire the module into the existing runtime.

### In Scope

- Focused portfolio, strategy, evaluation, rebalance, execution, reconciliation, performance, and operations route modules.
- Request schemas, field and payload bounds, correlation IDs, stable errors, mutation idempotency, CSRF, restrictive CORS, and rate limits.
- Secure sessions, object-level portfolio authorization, privileged role checks, MFA gates, and generic failure responses.
- Portfolio composition root, lifecycle, focused `ticker_proxy.js` registration shim, graceful shutdown, and Remix proxy forwarding.
- HTML security-header integration for the dedicated React workspace.

### Boundaries

- Routes contain protocol translation, not portfolio business logic or SQL.
- The composition root alone knows concrete persistence and external adapters.
- `/trade-execution` remains canonical and `/paper-trades` remains its compatibility alias.

### Expected Code Area

- `server/portfolio/api/`
- `server/portfolio/composition/`
- Focused additive registration in `server/routes/`, `ticker_proxy.js`, and Remix proxy configuration.

### Exit Criteria

- API tests prove authentication, portfolio object authorization, validation, idempotency, stable errors, headers, and compatibility.
- Invalid or inaccessible portfolio identifiers never select a fallback portfolio.
- Existing intraday, dashboard, mobile, replay, and legacy trade tests remain unchanged and passing.

## U08 React Portfolio Workspace

### Responsibility

Provide a dedicated, accessible React workspace for multiple isolated portfolios.

### In Scope

- `/portfolio` and portfolio-scoped overview, holdings, strategy, rebalance, performance, and operations URLs.
- Typed API client, route composition, query cancellation, stale-response protection, selected-portfolio URL state, and error boundaries.
- Separate selector, creation, overview, holdings, strategy, preview, approval, performance, operations, status, blocking-reason, and confirmation components.
- Explicit paper, recommendation, approval-required, restricted-auto, and live safety states.
- Keyboard navigation, visible focus, semantic labels, text-plus-icon status, consequence-focused confirmations, and WCAG 2.1 AA contrast.

### Boundaries

- UI components receive typed views and callbacks and contain no domain, SQL, broker, credential, or authorization policy.
- Server-side checks remain authoritative even when controls are hidden or disabled.
- Does not load legacy dashboard HTML, `dashboard-app.js`, or intraday UI state.

### Expected Code Area

- `my-remix-app/app/portfolio/api/`
- `my-remix-app/app/portfolio/components/`
- `my-remix-app/app/portfolio/hooks/`
- `my-remix-app/app/portfolio/routes/`
- `my-remix-app/app/portfolio/state/`
- `my-remix-app/app/portfolio/types/`

### Exit Criteria

- Portfolio switching cannot leak cached or late-arriving state.
- Focused component tests cover all visible safety and error states.
- Route and accessibility tests cover all dedicated URLs without legacy embedding.

## U09 Integrated Quality and Delivery

### Responsibility

Prove the complete portfolio feature meets safety, scale, compatibility, recovery, and delivery requirements.

### In Scope

- Cross-unit acceptance tests for the seeded paper portfolio, multiple isolated portfolios, three horizon presets, planning, paper execution, operations, API, and React flows.
- Full `fast-check` domain generators, round trips, invariants, idempotency, oracle tests, state models, shrinking, seed reporting, and permanent regressions.
- Failure injection for database, provider, broker, scheduler, audit, backup, restart, and unknown execution outcomes.
- Capacity tests for 100 portfolios, 1,000 instruments, 10 years of daily history, and broker order limits.
- GitHub Actions type checks, example tests, property tests, security checks, vulnerability scanning, SBOM generation, and build verification.
- Restore drill, compatibility suite, and proof that no automated validation can submit a real order.

### Boundaries

- Owns integrated harnesses and delivery gates, not business logic duplicated from earlier units.
- Uses temporary databases, deterministic fixtures, fake clocks, fake providers, and fake or dry-run brokers.
- A failed quality gate blocks deployment.

### Expected Code Area

- `tests/portfolio/`
- Portfolio-focused Remix tests.
- Existing CI configuration and build scripts, modified only as required by approved gates.

### Exit Criteria

- All requirements acceptance criteria and 39 stories have passing evidence.
- Type checks, focused and full tests, property tests, security checks, SBOM, build, capacity, and restore verification pass.
- No blocking security, resiliency, or property-testing findings remain.

## Cross-Unit Rules

1. Each story has exactly one primary unit; other units may provide integration support without duplicating ownership.
2. Public contracts stabilize before dependent implementation.
3. Portfolio state and audit changes are transactional; post-commit events publish only after commit.
4. Exact financial values never use binary floating-point accounting.
5. Every external boundary has deadlines, safe retry rules, explicit failure behavior, health reporting, and secret redaction.
6. Security and resiliency controls are designed in their owning units and verified again by U09.
7. Every business-logic unit identifies property tests during Functional Design and implements them alongside example tests.
8. No unit changes protected legacy trading behavior unless an additive integration point is explicitly listed.

## Extension Compliance Allocation

- **Security**: U02 owns encrypted and parameterized storage; U05 owns execution defense in depth; U06 owns audit, monitoring, backup, and incidents; U07 owns API, session, authorization, validation, headers, and rate limits; U09 verifies supply-chain and end-to-end controls.
- **Resiliency**: U02 owns persistence integrity; U03 and U05 own dependency failure behavior; U06 owns criticality, observability, health, backup, recovery, and incidents; U09 verifies capacity and recovery. Cloud topology controls remain N/A for the approved local deployment.
- **Property-based testing**: U01 through U07 identify and implement applicable domain properties; U08 uses focused state and serialization properties where valuable; U09 provides shared generators, integrated models, CI seed reporting, and cross-unit evidence.

