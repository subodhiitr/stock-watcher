# Application Services

## Service Pattern

Application services expose command and query use cases. A command validates authorization and input, loads state through repositories, invokes domain components, persists atomically, appends audit records, commits, and only then publishes typed internal events. Queries return portfolio-scoped read views and never mutate state.

## Portfolio Lifecycle Service

- Creates, updates, lists, reads, archives, and selects portfolios.
- Initializes exact cash and the active strategy assignment atomically.
- Enforces optimistic portfolio state versions and unique active names.
- Emits `PortfolioCreated`, `PortfolioArchived`, and `StrategyAssigned` after commit.
- Never reads or writes the legacy trade database.

## Strategy Service

- Registers the three immutable horizon presets idempotently.
- Creates declarative drafts, validates schema and constraints, calculates canonical hashes, and records evidence.
- Activates a version only after authorization and evidence gates pass.
- Preserves historical strategy references in signals, targets, plans, and orders.
- Cannot enable live execution as a side effect of strategy activation.

## Evaluation Service

- Loads the assigned strategy and a point-in-time data bundle.
- Verifies provenance, completeness, effective dates, freshness, market clock, and provider health.
- Runs eligibility, signal, and regime components deterministically.
- Stores immutable signal and regime snapshots with reason codes and lineage.
- Fails closed for production or execution use when licensed point-in-time data is unavailable.

## Construction Service

- Produces an unconstrained ideal target and a constraint-valid executable target.
- Coordinates score weighting, inverse volatility, whole shares, cash, concentration, sector, group, liquidity, and exposure constraints.
- Uses the deterministic greedy allocator first and a verified optimizer only when enabled.
- Reports implementation shortfall and all fallback decisions.

## Rebalance Service

- Loads reconciled actual state, target state, lots, current strategy, costs, taxes, and prior turnover.
- Applies horizon cadence, drift bands, preferred holding periods, replacement hurdles, turnover windows, cash, and risk rules.
- Produces immutable proposed and skipped orders with explanations.
- Repeating equivalent immutable inputs produces an equivalent plan.
- Approval binds to the plan hash, strategy version, portfolio version, approver, and price window.

## Execution Service

- Revalidates live gates, approval, portfolio state, market session, quote freshness, risk, reconciliation, and idempotency.
- Dispatches paper, fake, dry-run, Zerodha, or Sharekhan through the same `BrokerPort`.
- Executes sells before buys, reconciles confirmed cash, recalculates buys, and creates residual plans for partial fills.
- Treats unknown outcomes as blocked pending reconciliation.
- Automated tests compose only paper, fake, or dry-run adapters.

## Risk and Kill-Switch Service

- Applies global and portfolio risk checks before plans and orders.
- Resolves data, broker, drawdown, cash, turnover, concentration, liquidity, order-count, and automation limits.
- Activates portfolio or global kill switches with reason and audit.
- Global activation cancels cancellable pending orders and permits reconciliation but never liquidates holdings.
- Reset and restricted automation activation require role checks and two-factor confirmation.

## Scheduler Service

- Resolves due jobs from exchange sessions, dependencies, and each portfolio's strategy cadence.
- Uses leases to prevent duplicate active runs.
- Runs data, evaluation, planning, execution, reconciliation, performance, backup, and health jobs.
- Manual triggers use the same authorization, cadence, turnover, lease, and validation policies.
- Restart recovery reconciles incomplete work instead of assuming success.

## Operations and Recovery Service

- Aggregates shallow and deep health for database, providers, broker, scheduler, audit chain, backup, and clock.
- Emits structured metrics and alerts without exposing secrets.
- Creates encrypted hourly and retained daily backups.
- Verifies restore integrity, schema, exact accounting, strategy hashes, and audit chain.
- Coordinates deployment preflight and post-deploy checks; migration algorithms remain in infrastructure components.

## Audit and Reporting Service

- Converts domain and application outcomes into append-only hash-chained events.
- Stores immutable performance, attribution, and benchmark snapshots.
- Produces redacted audit exports and user-readable explanations.
- Rejects chain verification failures and exposes them through operations health.

## API Service Boundary

- Dedicated portfolio routes translate HTTP resources to commands and queries.
- Input validation occurs before application service invocation.
- Authentication and object-level authorization occur before resource access.
- Mutation responses include stable error codes and correlation IDs.
- Order, approval, execution, strategy activation, and kill-switch mutations require idempotency tokens.

## React Workspace Service Boundary

- `/portfolio` and its portfolio-scoped subroutes render dedicated React components.
- A typed `PortfolioApiClient` is the only browser-to-backend boundary.
- Query cancellation and selected-portfolio tokens prevent stale responses from replacing current state.
- React error boundaries separate unavailable data, unauthorized state, and recoverable component errors.
- No portfolio component imports legacy dashboard scripts or intraday UI state.

## Transaction and Event Rules

1. Domain changes and their audit event persist in the same database transaction.
2. Internal events publish only after a successful commit.
3. Event handlers are idempotent and persist handler progress when required.
4. A failed post-commit handler creates retryable job state; it never rolls back a committed financial record.
5. External broker calls never occur inside a long-lived database transaction.
6. Broker intent is persisted before submission, and outcome reconciliation follows submission.
