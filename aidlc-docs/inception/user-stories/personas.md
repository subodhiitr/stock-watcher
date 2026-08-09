# Portfolio Management Personas

## Persona 1: Priya - Self-Directed Investor

- **Goals**: Maintain multiple portfolios, select horizon-appropriate strategies, understand proposed changes, and measure performance against benchmarks.
- **Responsibilities**: Create and fund paper portfolios, choose operating modes, review holdings and drift, and request or approve permitted portfolio actions.
- **Authority boundary**: Cannot edit activated strategy versions, bypass risk controls, enable restricted automation alone, or reset protected kill switches without the required role.
- **Pain points**: Unclear rebalance rationale, accidental state mixing between portfolios, excessive turnover, stale data, and hidden costs or taxes.
- **Safety concerns**: No unexpected live orders, no intraday behavior, visible paper/live state, and clear consequences before destructive actions.
- **Accessibility needs**: Keyboard-operable controls, visible focus, semantic labels, non-color status indicators, and explicit monetary, percentage, timezone, and as-of values.
- **Mapped stories**: US-001 through US-006, US-015 through US-019, US-021, US-022, US-032, US-035 through US-037.

## Persona 2: Arjun - Strategy Editor

- **Goals**: Create reproducible strategy versions, compare horizon presets, validate changes, and activate only evidence-backed configurations.
- **Responsibilities**: Define schema-valid factors and constraints, run research validation, document thesis and parameter changes, and submit versions for activation.
- **Authority boundary**: Cannot mutate an activated version, approve their own live order basket by default, bypass data lineage, or grant AI authority to select trades.
- **Pain points**: Unreproducible signals, survivorship bias, unclear factor provenance, invalid configurations, and performance comparisons that ignore turnover or drawdown.
- **Safety concerns**: Point-in-time data, tamper-evident versions, deterministic outputs, and separate PAPER or OBSERVE validation before live eligibility.
- **Accessibility needs**: Structured validation feedback, navigable parameter forms, readable comparison tables, and explanations not dependent on charts alone.
- **Mapped stories**: US-005 through US-014, US-020, US-036 through US-038.

## Persona 3: Meera - Order Approver

- **Goals**: Approve only current, complete, risk-checked order baskets and understand the financial consequences before execution.
- **Responsibilities**: Review plan hashes, costs, taxes, cash, risk flags, skipped orders, state freshness, and individual order details.
- **Authority boundary**: Cannot approve an invalidated plan, override global safety controls, silently enable full-auto, or submit an order without idempotency and reconciliation.
- **Pain points**: Stale approvals, ambiguous partial fills, hidden state changes, duplicate submissions, and insufficient explanation of blocked actions.
- **Safety concerns**: Live execution disabled by default, sell-before-buy sequencing, reapproval after material change, and complete audit history.
- **Accessibility needs**: Clear confirmation steps, keyboard-accessible order review, explicit warning text, and stable focus after approval or rejection.
- **Mapped stories**: US-018, US-022 through US-027, US-033 through US-035.

## Persona 4: Ravi - Portfolio Operator

- **Goals**: Keep data, jobs, brokers, backups, audit chains, and reconciliation healthy while recovering safely from failures.
- **Responsibilities**: Monitor health, investigate alerts, trigger safe jobs, activate kill switches, validate backups, coordinate incidents, and verify recovery.
- **Authority boundary**: Cannot treat unknown outcomes as success, delete audit history, expose secrets in diagnostics, or bypass portfolio and global controls.
- **Pain points**: Duplicate jobs, silent dependency failures, unreconciled orders, backup uncertainty, and alerts without actionable context.
- **Safety concerns**: Fail-closed external dependencies, bounded retries, one-hour RPO, hours-level RTO, and database-aware rollback.
- **Accessibility needs**: Searchable status tables, textual severity labels, keyboard-operable actions, and concise recovery instructions.
- **Mapped stories**: US-010, US-013, US-014, US-024 through US-031, US-033 through US-035, US-039.

## System Actor: Scheduler

- **Purpose**: Run exchange-calendar-aware ingestion, evaluation, planning, execution, reconciliation, performance, and backup jobs.
- **Authority boundary**: Must honor leases, portfolio strategy cadence, turnover limits, kill switches, and retry eligibility; a manual trigger grants no additional authority.
- **Mapped stories**: US-010 through US-014, US-016, US-024, US-028 through US-030.

## System Actor: Broker Adapter

- **Purpose**: Normalize Zerodha, Sharekhan, fake, dry-run, and paper account, order, fill, cancellation, status, and reconciliation operations.
- **Authority boundary**: Cannot submit without explicit execution authorization, cannot infer success from an unknown status, and cannot expose credentials.
- **Mapped stories**: US-021 through US-027.

## Persona Coverage

All human-facing stories map to at least one human persona. Background stories map to Ravi and the relevant system actor so operational value and authority remain explicit.
