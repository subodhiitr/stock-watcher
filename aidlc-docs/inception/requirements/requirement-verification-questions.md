# Automatic Portfolio Management Requirements Verification

The selected product specification and `adaptive_momentum_quality_strategy.json` are the baseline requirements. Please answer each question by entering a letter after its `[Answer]:` tag.

## Question 1
Which delivery boundary should this AI-DLC execution implement?

A) Implement the production MVP through roadmap Phase 4: architecture and data foundation, read-only intelligence, rebalance preview and backtest, paper operation, and approval-based Zerodha execution (recommended)

B) Implement only roadmap Phases 0 through 2: foundation, read-only intelligence, rebalance preview, and backtest

C) Implement all roadmap phases, including restricted automation, Sharekhan execution, and advanced optimization

X) Other (please describe after [Answer]: tag below)

[Answer]:C

## Question 2
How should live broker execution be handled during development and validation?

A) Implement approval-based Zerodha execution but keep it disabled by default; tests must use fakes or dry-run adapters and no real order may be submitted during validation (recommended)

B) Exclude live execution code and deliver paper/recommendation modes only

C) Implement and enable live Zerodha execution after automated tests pass

X) Other (please describe after [Answer]: tag below)

[Answer]:A

## Question 3
What data-source boundary should the MVP use for point-in-time signals and backtesting?

A) Build provider interfaces and fail-closed validation; use existing NSE/Yahoo data only for prototyping and non-execution research until licensed point-in-time providers are configured (recommended)

B) Use existing NSE/Yahoo data for all MVP signals and backtests, with visible data-quality warnings

C) Integrate a specific licensed point-in-time price, index-membership, fundamentals, and corporate-actions provider now

X) Other (please describe the provider after [Answer]: tag below)

[Answer]:A

## Question 4
How should existing persisted trading data be treated?

A) Use additive, versioned SQLite migrations; preserve existing trades and snapshots, avoid destructive migration, and never alter live persisted trading records during tests (recommended)

B) Create a separate portfolio-management database and leave all current databases untouched

C) Replace the existing persistence model and migrate current records into the new schema

X) Other (please describe after [Answer]: tag below)

[Answer]:B

## Question 5
Which user interface scope should be included?

A) Implement the full specification within the existing `/portfolio` workspace: overview, holdings, rebalance preview, strategy, operations, approvals, kill switch, and explainability (recommended)

B) Implement backend APIs and a minimal rebalance-preview interface only

C) Implement backend/domain capabilities only, without dashboard changes

X) Other (please describe after [Answer]: tag below)

[Answer]:A

## Question 6
Should security extension rules be enforced for this project?

A) Yes - enforce all security rules as blocking constraints (recommended for broker-linked portfolio execution)

B) No - skip the security baseline

X) Other (please describe after [Answer]: tag below)

[Answer]:A

## Question 7
Should the resiliency baseline be applied to this project?

A) Yes - apply the resiliency baseline as blocking design-time guidance for fail-closed data, broker, execution, and reconciliation workflows (recommended)

B) No - skip the resiliency baseline

X) Other (please describe after [Answer]: tag below)

[Answer]:A

## Question 8
Should property-based testing rules be enforced?

A) Yes - enforce all property-based testing rules for scoring, allocation, state machines, constraints, serialization, and idempotency (recommended)

B) Partial - enforce property-based testing only for pure functions and serialization round trips

C) No - use example-based unit and integration tests only

X) Other (please describe after [Answer]: tag below)

[Answer]:A
