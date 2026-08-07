# Application Components

## Architectural Style

The portfolio feature is an additive strict-TypeScript modular monolith under `server/portfolio/`. Domain and application code depend on declared ports. Infrastructure and external adapters implement those ports. A composition root wires components into focused route modules without placing portfolio business logic in `ticker_proxy.js`.

## Backend Components

| Component | Purpose | Responsibilities | Primary interfaces |
|---|---|---|---|
| Domain Kernel | Shared financial and identity types | Portfolio IDs, exact money, quantities, dates, enums, reason codes, errors, hashes, state-transition primitives | Value objects, domain errors, transition guards |
| Portfolio Aggregate | Own portfolio lifecycle and accounting boundary | Portfolio metadata, cash, holdings, lots, strategy assignment, archive state, state version | `Portfolio`, `PortfolioSnapshot`, `Holding`, `HoldingLot` |
| Strategy Catalog | Own declarative strategy lifecycle | Schema validation, immutable versions, preset registration, hashes, evidence references, activation | `StrategyVersion`, `StrategyAssignment`, `StrategyPolicy` |
| Data and Eligibility | Supply point-in-time decision inputs | Provider provenance, freshness, universe membership, eligibility, corporate actions, verified event flags | `MarketDataPort`, `EligibilityEngine`, `CorporateActionPort` |
| Signal and Regime Engine | Produce deterministic scores and exposure state | Normalization, composite scores, reason codes, lineage, regime confirmation and hysteresis | `SignalEngine`, `RegimeEngine` |
| Construction Engine | Produce target allocations | Ideal targets, executable targets, whole-share allocation, caps, cash buffer, implementation shortfall | `ConstructionEngine`, `OptimizerPort` |
| Cost and Tax Engine | Estimate execution drag | Charges, spread, slippage, impact, tax lots, effective-dated rules | `CostModel`, `TaxModel` |
| Rebalance Planner | Produce explainable order plans | Cadence, drift, preferred holds, replacement hurdles, turnover windows, proposed and skipped orders | `RebalancePlanner`, `RebalancePlan` |
| Risk and Approval | Enforce execution authority | Pre-trade checks, live gates, plan-bound approval, kill switches, automation limits | `RiskPolicy`, `ApprovalPolicy`, `KillSwitchPolicy` |
| Execution Coordinator | Run paper and live order state machines | Sell-before-buy sequencing, idempotency, partial fills, residual orders, cancellation, reconciliation | `ExecutionService`, `BrokerPort`, `PaperBrokerAdapter` |
| Scheduler and Jobs | Run leased background work | Exchange calendar, per-portfolio cadence, dependencies, retries, recovery, manual triggers | `JobScheduler`, `JobLeaseRepository`, `ClockPort` |
| Operations and Recovery | Expose operational safety | Health, metrics, alerts, backup, restore, deployment preflight, incident evidence | `HealthService`, `BackupPort`, `AlertPort` |
| Audit and Reporting | Preserve explanations and history | Hash-chained audit, performance, attribution, benchmark, redacted exports | `AuditPort`, `PerformanceService`, `ReportPort` |
| Portfolio Persistence | Own `portfolio-management.db` | Connection lifecycle, migrations, repositories, transactions, seed data, integrity, backup coordination | `PortfolioUnitOfWork`, repository ports |
| Portfolio API Adapter | Translate HTTP to application requests | Authentication, authorization, schema validation, correlation IDs, idempotency, stable errors | Focused `/api/portfolios` route handlers |
| Portfolio Composition Root | Wire implementations | Construct database owner, repositories, adapters, services, routes, jobs, and shutdown hooks | `createPortfolioModule()` |

## React UI Components

The portfolio UI is a dedicated React experience at `/portfolio`. It does not reuse the legacy dashboard HTML body, `dashboard-app.js`, or intraday view state.

### Route and State Components

| Component | Responsibility |
|---|---|
| `PortfolioWorkspacePage` | Dedicated `/portfolio` page shell and top-level error boundaries |
| `PortfolioWorkspaceRouter` | Portfolio subview routing and selected portfolio URL state |
| `PortfolioApiClient` | Typed same-origin API calls; no direct database or broker access |
| `usePortfolioWorkspace` | Selected portfolio query state, cancellation, stale-response protection, and refresh |
| `PortfolioAccessBoundary` | Authenticated loading, unauthorized, and degraded states |

### Feature Components

| Component | Responsibility |
|---|---|
| `PortfolioSelector` | Select a portfolio without cross-portfolio state leakage |
| `PortfolioCreateDialog` | Create a paper, observe, recommendation, or eligible execution portfolio |
| `PortfolioOverviewPanel` | Cash, equity exposure, benchmark, drawdown, mode, freshness, and risk |
| `HoldingsTable` | Holdings, lots, target weights, drift, ranks, reasons, and tax context |
| `StrategyDetailsPanel` | Horizon, version, thesis, factors, constraints, cadence, turnover, and evidence |
| `RebalancePreviewPanel` | Proposed and skipped orders, before/after allocations, costs, taxes, and warnings |
| `OrderApprovalPanel` | Basket and order approval or rejection bound to plan state |
| `PerformancePanel` | Return, risk, drawdown, attribution, benchmark, costs, and holding period |
| `PortfolioOperationsPanel` | Jobs, data health, broker health, reconciliation, alerts, audit, backup, and kill switches |
| `PortfolioStatusBadge` | Text and icon status that does not rely on color |
| `BlockingReasonPanel` | Structured reason codes and actionable explanations for disabled actions |
| `ConfirmationDialog` | Consequence-focused confirmation for destructive or privileged actions |

## URL Design

- `/portfolio` - portfolio list, creation, and default selected portfolio overview.
- `/portfolio/:portfolioId` - selected portfolio overview.
- `/portfolio/:portfolioId/holdings` - holdings and lots.
- `/portfolio/:portfolioId/strategy` - assigned strategy and evidence.
- `/portfolio/:portfolioId/rebalance` - latest preview and history.
- `/portfolio/:portfolioId/performance` - performance and attribution.
- `/portfolio/:portfolioId/operations` - health, jobs, reconciliation, audit, and controls.

All routes render React components from a dedicated portfolio UI folder. A missing or unauthorized portfolio identifier fails closed and never falls back to another portfolio.

## Protected Legacy Boundaries

- Existing `/trade-execution` remains the canonical legacy trade API.
- `/paper-trades` remains its compatibility alias.
- Existing dashboard, mobile, simulation, replay, and intraday modules retain their behavior.
- Portfolio APIs do not call legacy intraday entry, time-stop, runner, VWAP, or first-hour logic.
- `stock-watcher.db` remains separate and is not attached to portfolio-domain transactions.

## Component-Level Extension Compliance

- Security-critical functions are isolated behind authorization, validation, secret, risk, approval, and audit interfaces.
- External calls are adapter-bound with deadlines, fail-closed behavior, and health reporting.
- Stateful and transformational components expose boundaries suitable for property and model testing.
- Cloud intermediary, IAM, network, multi-zone, and auto-scaling components are N/A for the approved local topology.
