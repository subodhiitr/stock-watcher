# Automatic Portfolio Management Application Design

## Approved Architecture Decisions

1. Use a focused `server/portfolio/` strict-TypeScript modular-monolith boundary.
2. Use explicit command/query application services with injected ports and transaction boundaries.
3. Give one database owner exclusive access to `portfolio-management.db`; domain, routes, and React issue no SQL.
4. Use synchronous transactional commands and queries with typed post-commit internal events for leased background work.
5. Add focused portfolio route modules and a composition root wired from `ticker_proxy.js`; keep legacy trade routes separate.
6. Use strict TypeScript for all new portfolio backend and React code, with only a minimal JavaScript composition shim if required.
7. Use version-neutral portfolio-scoped REST resources with stable schemas, errors, correlation IDs, and idempotency tokens.
8. Serve a dedicated React portfolio experience at `/portfolio` using separate route, state, and feature components.

## Application Boundary

The application remains one local Node and Remix deployment. The new portfolio module is internally layered:

- **Domain**: Pure financial types, aggregates, policies, engines, and state machines.
- **Application**: Commands, queries, orchestration, transactions, audit, and internal events.
- **Ports**: Persistence, market data, brokers, clock, optimizer, audit, health, alerts, backup, and reports.
- **Adapters**: SQLite, NSE/Yahoo prototype data, licensed providers, paper/fake brokers, Zerodha, Sharekhan, scheduling, and HTTP.
- **Composition**: Concrete dependency wiring, lifecycle, route registration, and graceful shutdown.
- **React UI**: Dedicated `/portfolio` route tree and typed API client.

## Component Summary

- Portfolio lifecycle and accounting own cash, holdings, lots, state version, and strategy assignment.
- Strategy catalog owns immutable declarative versions, presets, evidence, hashes, and activation.
- Data, eligibility, signals, and regime own point-in-time deterministic decision inputs.
- Construction, cost, tax, and rebalance components own target and plan creation.
- Risk, approval, execution, broker, and reconciliation components own financially material transitions.
- Scheduler, operations, recovery, audit, and reporting own background and operational behavior.
- API and React components translate protocols and user interactions without embedding domain policy.

Detailed definitions are in `components.md`, signatures in `component-methods.md`, orchestration in `services.md`, and relationships in `component-dependency.md`.

## Dedicated React URL and Component Design

`/portfolio` becomes a dedicated React-rendered workspace rather than a legacy dashboard action. It may link to the existing dashboard, but it does not load legacy dashboard markup or global scripts.

### React Folder Boundary

The implementation should use a dedicated folder such as:

```text
my-remix-app/app/portfolio/
  api/
  components/
  hooks/
  routes/
  state/
  types/
```

Each visible capability is a separate component file. Route components compose feature components; hooks own query lifecycle; the API client owns HTTP. Domain and risk rules remain server-side.

### URL State

- `/portfolio`
- `/portfolio/:portfolioId`
- `/portfolio/:portfolioId/holdings`
- `/portfolio/:portfolioId/strategy`
- `/portfolio/:portfolioId/rebalance`
- `/portfolio/:portfolioId/performance`
- `/portfolio/:portfolioId/operations`

Portfolio identifiers in URLs are authorized server-side. Invalid identifiers produce explicit not-found or forbidden states and never select a fallback portfolio.

## API Boundary

Representative resources:

- `GET, POST /api/portfolios`
- `GET, PATCH, DELETE /api/portfolios/:portfolioId`
- `GET, PUT /api/portfolios/:portfolioId/strategy`
- `GET /api/portfolios/:portfolioId/holdings`
- `POST /api/portfolios/:portfolioId/evaluations`
- `GET, POST /api/portfolios/:portfolioId/rebalances`
- `POST /api/portfolios/:portfolioId/rebalances/:rebalanceId/approve`
- `POST /api/portfolios/:portfolioId/rebalances/:rebalanceId/execute`
- `POST /api/portfolios/:portfolioId/reconcile`
- `GET /api/portfolios/:portfolioId/performance`
- `GET /api/portfolios/:portfolioId/operations`
- `GET, POST /api/strategies`
- `POST /api/strategies/:strategyVersionId/activate`

Exact paths and schemas will be finalized in Functional Design. Mutations validate schemas, authenticate, authorize, correlate, audit, and require idempotency where specified.

## Data and Transaction Boundaries

- One database owner controls connection, WAL, timeout, migrations, repositories, and transaction scope.
- Exact money and quantities cross boundaries as validated strings or minor units, never binary floating-point accounting.
- Portfolio changes and audit records commit atomically.
- External calls do not occur inside long transactions.
- Broker intent persists before external submission; result persistence and reconciliation follow.
- Post-commit event handlers are idempotent and leased where background execution is required.

## Failure and Error Model

- Domain errors use stable codes and structured context without secrets.
- API adapters map errors to generic client responses and correlation IDs.
- Stale data, unknown broker status, invalid approval, reconciliation mismatch, negative cash, or state-version conflict fail closed.
- Non-critical research failures may degrade a view but cannot authorize execution.
- React error boundaries distinguish unauthorized, unavailable, stale, validation, and retryable states.

## Security Design

- Authenticate every non-public route and authorize every portfolio identifier.
- Separate strategy editing, order approval, automation activation, and kill-switch reset roles.
- Validate all HTTP fields and use parameterized repository statements.
- Store secrets outside source, strategy JSON, logs, reports, and audit details.
- Keep live enablement deny-by-default across environment, application, portfolio, and strategy.
- Write tamper-evident audit events for privileged and financial changes.
- Apply restrictive browser headers, CSRF protection, restricted CORS, rate limits, secure sessions, and MFA for privileged activation.

## Resiliency Design

- Persistence, execution, reconciliation, risk, and audit are critical workloads.
- External adapters expose deadlines, safe retries, circuit state, and health.
- Scheduler leases and idempotency prevent duplicate work.
- Encrypted hourly backups and retained daily backups support one-hour RPO and hours-level RTO.
- Recovery verifies migrations, accounting, strategy hashes, audit chain, jobs, broker reconciliation, and live gates.
- Multi-zone, multi-region, and cloud auto-scaling remain N/A for the approved local workstation topology.

## Property-Testable Design

Functional Design must identify and later test:

- exact-money serialization round trips;
- factor, sleeve, target, and cash weight invariants;
- portfolio isolation;
- no negative cash, leverage, or short positions;
- deterministic scores, targets, plans, and reason codes;
- seed and migration idempotency;
- order and job idempotency;
- portfolio, approval, order, kill-switch, and reconciliation state models;
- allocator and optimizer comparison to a reference oracle.

## Legacy Compatibility

- `/trade-execution` remains canonical and `/paper-trades` remains its alias.
- New route registration is additive.
- Existing intraday simulation, replay, dashboard, mobile, broker login, and analytics behavior remains unchanged.
- Shared market-data, broker, cost, audit, or calendar capabilities are reused only through explicit adapters.
- No portfolio component imports intraday strategy policy.

## Story Coverage

- Portfolio and strategy components cover US-001 through US-009.
- Data, signal, construction, and planning components cover US-010 through US-020.
- Execution and broker components cover US-021 through US-027.
- Operations, recovery, API, UI, audit, research, and delivery components cover US-028 through US-039.

## Extension Compliance

- **Security**: Applicable SECURITY-01 and SECURITY-03 through SECURITY-15 are represented in components and dependencies; SECURITY-02, SECURITY-06, and SECURITY-07 are N/A for local topology.
- **Resiliency**: Applicable RESILIENCY-01 through RESILIENCY-07, RESILIENCY-10 through RESILIENCY-13, and RESILIENCY-15 are represented; RESILIENCY-08 and RESILIENCY-09 are N/A; RESILIENCY-14 remains deferred to NFR Design by rule.
- **Property-based testing**: Component boundaries expose PBT-01 through PBT-10 opportunities for downstream Functional Design and Code Generation.
- **Blocking findings**: None.
