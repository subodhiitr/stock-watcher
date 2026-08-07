# U03 Strategy, Data, and Research – Logical Components

## Dependency Rule

Dependencies flow in one direction only: infrastructure → application services → domain aggregates/services → domain value objects → domain constants. No domain component imports an infrastructure or adapter component. No runtime component imports test or benchmark components.

U03 never imports U02 persistence internals or U01 aggregate implementations; it only imports through U01 public contracts (`server/portfolio/index.ts`). U01 never imports U03.

---

## Component Scope and Criticality

| Scope | Classification |
|---|---|
| Availability target | Research-advisory path: best-effort; critical evaluation path: matches hosting process SLA |
| Recovery Time Objective | Inherits project RTO for stateless computation services |
| Recovery Point Objective | Zero data loss of in-flight computation results (any in-progress evaluation is discarded; the next scheduled run recomputes from persisted data) |
| Workload criticality | Critical evaluation components: HIGH; AI advisory components: NORMAL |

---

## Domain Layer

### LC-U03-01: Strategy Domain Constants

**Responsibility**

- Strategy configuration numeric bounds: max factor weight 1,000,000 PPM, min weight 0 PPM, weight sum tolerance ±10 PPM.
- Named factor count limits: 7 momentum, 6 quality, 5 risk.
- Universe eligibility thresholds: min market-cap floor, min liquidity ratio, min trading-day count, min data-coverage requirement.
- Signal score bounds: winsorization σ multiplier (3.0), conviction multiplier range [0.80, 1.20].
- Strategy version lifecycle stage identifiers (string enum).
- Named evidence type identifiers (BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION).
- AI advisory permitted operation identifiers (closed union of 6 strings).
- Regime confirmation period (default 3 days).
- Backtest minimum history requirement (5 years × 252 trading days = 1,260 observations).

**Dependencies**

None.

**Visibility**

Only constants required to interpret public exact values, schemas, or configuration contracts are exported. Internal threshold details remain private.

---

### LC-U03-02: Strategy Config Value Object

**Responsibility**

- Immutable `StrategyConfig` record: name, description, factor weight policy, eligibility criteria, regime parameters, backtest parameters.
- Structural validation: all fields present, all weights parseable, all thresholds within defined bounds from LC-U03-01.
- Canonical JSON hash: deterministic serialization (alphabetical key order, no whitespace), SHA-256 via `node:crypto`.
- Equality by canonical hash.
- Named construction result: success with frozen config, or typed failure specifying the invalid field.

**Dependencies**

LC-U03-01 only.

**Constraints**

- No mutable fields.
- No file, network, or database access.
- No ambient time read.

---

### LC-U03-03: Data Provenance and Market Data Records

**Responsibility**

- `DataProvenance`: source identifier, fetchedAt, marketTimestamp, effectiveDate, version, validationStatus, `isProductionQuality` flag.
- `MarketDataRecord`: price OHLCV, volume, fundamentals snapshot, factor values (raw floats), corporate action adjustments, exchange calendar data.
- Staleness policy: `staleAfterInstant` derived from `effectiveDate` + source-specific max latency constant.
- Reject any record missing mandatory provenance fields.

**Dependencies**

LC-U03-01, LC-U03-02.

**Constraints**

- `isProductionQuality = false` is the default for all records from NSE_OFFICIAL or YAHOO_RESEARCH sources.
- No modification of provenance after construction.

---

### LC-U03-04: DataVersionSnapshot

**Responsibility**

- `DataVersionSnapshot`: immutable snapshot of all market data records required for one evaluation date, keyed by (instrumentId, dataType).
- `DataVersionId` (UUID v4 via `node:crypto.randomUUID()`).
- Completeness check: each required dataType must meet the 98% coverage threshold from LC-U03-01.
- `isProductionQuality` flag: false if any contributing record is non-production.
- Bind to evaluation results at construction; result types without a snapshot ID are structurally incomplete.

**Dependencies**

LC-U03-01, LC-U03-03.

**Constraints**

- Snapshot is immutable after construction.
- No incremental update; snapshots are always fully assembled.

---

### LC-U03-05: Eligibility Value Objects

**Responsibility**

- `EligibilityResult`: per-instrument eligibility outcome, bound to `DataVersionId`, pass/fail reason (typed), sub-results for each of 12 rules.
- `EligibilityCriteria`: snapshot of thresholds applied (from config).
- BFSI-specific result sub-type for 3 additional eligibility checks.

**Dependencies**

LC-U03-01, LC-U03-04.

**Constraints**

- Rule application order is canonical.
- Result includes the exact threshold values applied, enabling reproducibility audits.

---

### LC-U03-06: Signal Value Objects

**Responsibility**

- `SignalSnapshot`: per-instrument signal scores after full pipeline (raw → winsorized → z-scored → composite → conviction-weighted).
- `FactorComponentScore`: intermediate values for each of the 18 named factors.
- `DEGRADED_ADVISORY_CONTEXT` flag on SignalSnapshot: immutable once set.
- Bound `DataVersionId`.

**Dependencies**

LC-U03-01, LC-U03-04.

**Constraints**

- All numeric fields are `number` (float64) with explicit `NaN`/`Infinity` exclusions enforced by PAT-U03-003.
- `DEGRADED_ADVISORY_CONTEXT` is set, never cleared, on a snapshot instance.

---

### LC-U03-07: Regime State Value Objects

**Responsibility**

- `RegimeState`: current market regime (BULL, BEAR, NEUTRAL, CRISIS, RECOVERY), confirmation-period counter, contributing indicator values, bound `DataVersionId`.
- `RegimeIndicatorRecord`: per-indicator readings for a date.
- Regime confirmation state machine state: UNCONFIRMED, CONFIRMING, CONFIRMED.

**Dependencies**

LC-U03-01, LC-U03-04.

**Constraints**

- No ambient clock access in regime determination logic.

---

### LC-U03-08: Corporate Action Value Objects

**Responsibility**

- `CorporateAction`: action type (10 types), announcement date, effective date, affected instruments, adjustment factors.
- `CorporateActionProcessingResult`: PROCESSED, BLOCKED, REQUIRES_MANUAL_REVIEW.
- Bounded context: adjustment ratios must be positive and within defined sanity bounds.

**Dependencies**

LC-U03-01.

**Constraints**

- Ambiguous or incomplete actions are blocked, never silently applied.

---

### LC-U03-09: BacktestRun Aggregate

**Responsibility**

- `BacktestRun` lifecycle: QUEUED → RUNNING → BIAS_CHECKING → COMPLETED / FAILED.
- Look-ahead violation accumulator: `lookAheadViolations` count (fails to FAILED when > 0).
- Survivorship bias violation accumulator: `survivorshipViolations` count (fails to FAILED when > 0).
- `BacktestResult`: aggregate performance metrics (return series, drawdown, Sharpe ratio, calendar-year breakdown) bound to version and data snapshot chain.
- Immutable completed result; no update after COMPLETED.

**Dependencies**

LC-U03-01, LC-U03-04.

**Constraints**

- COMPLETED transition is guarded: both bias checks performed and both violation counts = 0.
- T+1 execution model encoded as a domain constant.

---

### LC-U03-10: StrategyVersion Aggregate

**Responsibility**

- `StrategyVersion` lifecycle: DRAFT → ACTIVATION_PENDING → ACTIVE → SUPERSEDED / WITHDRAWN.
- Configuration schema validation (delegates to LC-U03-02).
- Evidence collection for activation: BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION.
- Activation guard: all four evidence types with `passed = true` required.
- Atomic transition: this version to ACTIVE, previous ACTIVE to SUPERSEDED (U02 provides transaction boundary).
- Immutable configHash: set at DRAFT creation, unchanged through lifecycle.
- Versioned domain events: `StrategyVersionCreated`, `StrategyVersionActivated`, `StrategyVersionSuperseded`, `StrategyVersionWithdrawn`.

**Dependencies**

LC-U03-01, LC-U03-02, LC-U03-09.

**Constraints**

- No portfolio mutation behavior.
- No execution authority.
- No AI advisory result may be used as activation evidence (structural type exclusion).

---

### LC-U03-11: AI Advisory Value Objects

**Responsibility**

- `AiAdvisoryRequest`: permitted operation (closed union from LC-U03-01), safe context input (excludes portfolio state, orders, credentials, PII by structural type).
- `AiAdvisoryResult`: advisory output, bound `AiPermittedOperation`, all three `false` literal constants: `canInfluenceState: false`, `canDetermineOrderQuantity: false`, `canAlterParameters: false`.
- Audit record: requestId, operation, producedAt, model identifier, SHA-256 output hash.

**Dependencies**

LC-U03-01.

**Constraints**

- TypeScript `as const` assertions on all three advisory result constants.
- No constructor allows assigning `true` to any of the three literal-false fields.

---

## Application Service Layer

### LC-U03-12: Universe Eligibility Service

**Responsibility**

- Apply 12-rule eligibility algorithm (9 universal + 3 BFSI-specific) to each instrument in the universe for the evaluation date.
- Load universe instruments from InstrumentRegistryPort; load membership from IndexMembershipPort.
- Bind `DataVersionId` to every `EligibilityResult`.
- Return typed result: eligible set, ineligible set with reasons, partial result on port failure (fail closed).

**Dependencies**

LC-U03-01, LC-U03-04, LC-U03-05, LC-U03-18 (ProviderResilienceWrapper via port injection).

**Constraints**

- No ambient clock access.
- Port calls through injected port interfaces only.

---

### LC-U03-13: Signal Scoring Service

**Responsibility**

- Execute the full scoring pipeline: raw factor collection → winsorization → cross-sectional z-scoring → component score → composite score → conviction multiplier → final rank.
- Apply NaN/Infinity gate at each step (PAT-U03-003).
- Apply weight sum validation (PAT-U03-004).
- Bind `DataVersionId` and config hash to every `SignalSnapshot`.
- Collect AI advisory input (non-blocking) and apply `DEGRADED_ADVISORY_CONTEXT` flag if advisory path fails (PAT-U03-013).

**Dependencies**

LC-U03-01, LC-U03-04, LC-U03-06, LC-U03-11, LC-U03-18.

**Constraints**

- All arithmetic uses JavaScript `Number`.
- No ambient state between evaluation runs.

---

### LC-U03-14: Regime Determination Service

**Responsibility**

- Collect regime indicator values from MarketDataPort for the evaluation date.
- Apply regime determination logic with confirmation-period state machine (UNCONFIRMED → CONFIRMING → CONFIRMED).
- Fail-closed: if indicators are unavailable, return `REGIME_UNAVAILABLE` (not a neutral default).
- Return `RegimeState` bound to `DataVersionId`.

**Dependencies**

LC-U03-01, LC-U03-04, LC-U03-07, LC-U03-18.

**Constraints**

- No clock access.
- Fail-closed on missing indicators (not silently neutral).

---

### LC-U03-15: Corporate Action Processor

**Responsibility**

- Receive corporate actions from CorporateActionPort for the evaluation date.
- Evaluate each action: PROCESSED (clean adjustment), BLOCKED (ambiguous), REQUIRES_MANUAL_REVIEW (complex).
- Aggregate result: list of processed and blocked actions; fail-closed on any REQUIRES_MANUAL_REVIEW.
- Emit `CorporateActionProcessed` or `CorporateActionBlocked` events.

**Dependencies**

LC-U03-01, LC-U03-08, LC-U03-18.

**Constraints**

- No silent default for ambiguous actions.
- Blocking an action does not affect other actions.

---

### LC-U03-16: Backtest Orchestration Service

**Responsibility**

- Orchestrate a BacktestRun: validate date range (min 5 years), assemble point-in-time data via BacktestDataAccessGuard, iterate through evaluation dates, apply T+1 model, aggregate performance metrics.
- Call eligibility, scoring, and regime services per evaluation date.
- Enforce look-ahead and survivorship checks through BacktestDataAccessGuard.
- Transition BacktestRun to COMPLETED or FAILED based on bias check results.

**Dependencies**

LC-U03-01, LC-U03-09, LC-U03-12, LC-U03-13, LC-U03-14, LC-U03-15, LC-U03-18.

**Constraints**

- Research-mode only (DataVersionSnapshot.isProductionQuality flag checked at entry).
- No real portfolio mutation.

---

### LC-U03-17: Strategy Version Application Service

**Responsibility**

- Create, validate, and manage StrategyVersion lifecycle transitions.
- Coordinate with StrategyVersionRepository (port, via U02) for persistence.
- Enforce activation evidence gate via LC-U03-10 aggregate logic.
- Emit lifecycle domain events.

**Dependencies**

LC-U03-01, LC-U03-10, LC-U03-21 (port declarations).

**Constraints**

- No execution authority.
- Activation evidence must satisfy LC-U03-10 guard.

---

### LC-U03-18: AI Advisory Application Service

**Responsibility**

- Validate `AiAdvisoryRequest` operation against permitted set from LC-U03-01.
- Call AiAdvisoryPort with deadline and retry wrapping (PAT-U03-005).
- Record audit event for every request/response.
- On port failure: return `DEGRADED_ADVISORY_CONTEXT` result (non-blocking).
- Reject prohibited operations with `PROHIBITED_AI_OPERATION` before any call.

**Dependencies**

LC-U03-01, LC-U03-11, LC-U03-21.

**Constraints**

- All three `false` literal constants are preserved on every returned result.
- No AI result may be forwarded as activation evidence.

---

## Infrastructure Layer

### LC-U03-19: Provider Resilience Wrapper

**Responsibility**

- Generic `ProviderResilienceWrapper<T>` that wraps any async provider call with: per-call deadline, configurable exponential-backoff retry (base × 2^attempt + jitter), exhaustion terminal error, circuit breaker gate query.
- Accepts provider identity, max retries, base delay ms, and deadline ms as configuration.
- On success: return result and reset retry counter.
- On transient failure: retry up to maxRetries; then emit `ProviderErrorEvent` (structured, credential-redacted) and return a typed provider-exhausted failure.
- On `DomainInvariantError`: propagate immediately without retry.

**Dependencies**

LC-U03-01, LC-U03-20, LC-U03-22 (for credential redaction).

**Constraints**

- Node `setTimeout`-based backoff (no third-party scheduler).
- No retry state persisted beyond the current call stack.

---

### LC-U03-20: Per-Provider Circuit Breaker Registry

**Responsibility**

- In-memory registry mapping provider identity → `CircuitBreakerState` (CLOSED, OPEN, HALF_OPEN).
- State machine transitions: CLOSED → OPEN on failureThreshold consecutive failures; OPEN → HALF_OPEN after cooldown; HALF_OPEN → CLOSED on probe success; HALF_OPEN → OPEN on probe failure.
- Probe call coordination: only one concurrent probe in HALF_OPEN state; all others receive CIRCUIT_OPEN immediately.
- Resets to CLOSED on process restart.

**Dependencies**

LC-U03-01.

**Constraints**

- One independent circuit breaker instance per provider identity.
- State is in-memory only.

---

### LC-U03-21: Research Mode Gate

**Responsibility**

- `ResearchModeGate.checkProductionAllowed(snapshot: DataVersionSnapshot, mode: 'production' | 'research'): DomainResult<void>`
- Rejects if `mode === 'production'` and `snapshot.isProductionQuality === false`.
- Rejects if any record in snapshot is stale and `mode === 'production'`.
- In research mode: returns success with `RESEARCH_MODE_ONLY` label.
- Not callable from domain logic; enforced in application service layer.

**Dependencies**

LC-U03-01, LC-U03-04.

**Constraints**

- Stateless. No read of clock or global state; accepts current time as explicit argument.

---

### LC-U03-22: Credential Redactor

**Responsibility**

- `redactProviderContext(raw: unknown): SafeProviderLogContext`
- Scrubs known credential field names (configurable allowlist from LC-U03-01).
- Converts nested unknown objects to bounded safe descriptors.
- Limits log context fields to approved list.
- Used by PAT-U03-012 logging and PAT-U03-005 error events.

**Dependencies**

LC-U03-01.

**Constraints**

- Never throws; always returns a safe value.
- No external dependency.

---

## Port Declaration Layer

### LC-U03-23: U03 Provider Ports

**Responsibility**

Declare all 7 external provider port interfaces:

- `MarketDataPort`: price OHLCV, volume, adjustments.
- `FundamentalsPort`: financials, sector, country, quality metrics.
- `IndexMembershipPort`: point-in-time index constituents.
- `CorporateActionPort`: all corporate action event types.
- `ExchangeCalendarPort`: trading day calendars, exchange holidays.
- `InstrumentRegistryPort`: instrument metadata and active identifiers.
- `AiAdvisoryPort`: advisory request/result exchange.

Each port declares: input type, output type, error union (including provider-exhausted, circuit-open, data-unavailable).

**Dependencies**

LC-U03-01, LC-U03-03, LC-U03-11 types.

**Constraints**

- Interfaces only. No implementation or infrastructure helper.
- No port is callable from LC-U03-01 through LC-U03-11.

---

### LC-U03-24: U03 Persistence Ports

**Responsibility**

Declare persistence port interfaces:

- `StrategyVersionRepository`: load by ID, load current ACTIVE, save.
- `BacktestRunRepository`: create, update status, load by ID.
- `MarketDataSnapshotRepository`: save/load DataVersionSnapshot by ID.
- `StrategyVersionUnitOfWork`: atomic ACTIVE/SUPERSEDED dual transition.

**Dependencies**

LC-U03-01, LC-U03-09, LC-U03-10 types.

**Constraints**

- Interfaces only. Implementations live in U02 adapter layer.

---

## Test and Verification Layer

### LC-U03-25: Property Test Generators

**Responsibility**

Seven `fast-check` arbitrary families (PAT-U03-014):

1. `strategyConfigArb`
2. `eligibilityInputArb`
3. `signalUniverseArb`
4. `regimeIndicatorSequenceArb`
5. `corporateActionArb`
6. `backtestDateRangeArb`
7. `aiAdvisoryRequestArb`

Stateful models covering StrategyVersion lifecycle and BacktestRun lifecycle commands. Seed and path reproduction helpers. Shrinking wrappers for universe-size and weight-array counterexamples.

**Dependencies**

LC-U03-01 through LC-U03-18 and `fast-check`.

**Visibility**

Test only. Never imported by production source or LC-U03-26.

---

### LC-U03-26: Backtest Data Access Guard

**Responsibility**

- Records every data access in a backtest replay: access date, data publication date, access type.
- Look-ahead violation detection: fundamentals with publication date after decision date T; price or membership records with date after EOD of day T.
- Survivorship bias detection: any instrument excluded because it no longer exists today.
- Violation accumulator: increments `BacktestRun` counters via aggregate command.

**Dependencies**

LC-U03-01, LC-U03-04, LC-U03-09.

**Visibility**

Used only by LC-U03-16 (Backtest Orchestration Service). Not exported by public entry point.

---

### LC-U03-27: U03 Benchmark Harness

**Responsibility**

- Representative fixture generation for 500-instrument and boundary-size universe.
- Warm-up and measurement harness.
- p95 latency reporting for eligibility scan, signal scoring, and regime determination.
- Heap allocation and growth-curve checks.
- Non-zero threshold assertions for benchmark regressions.

**Dependencies**

LC-U03-01 through LC-U03-16 and Node standard APIs.

**Visibility**

Development and CI only. Never imported by production source.

---

### LC-U03-28: U03 Public Entry Point

**Responsibility**

- Explicitly export: approved value objects, aggregate types, application service interfaces, domain failure codes, port interfaces.
- Hide: internal validators, constructors, constants, test helpers, generator families.

**Dependencies**

LC-U03-02 through LC-U03-24 approved exports.

**Constraints**

- No wildcard re-export.
- No side effect during import.
- No environment initialization.

---

## Dependency Matrix

`D` = direct allowed dependency. `–` = no direct dependency.

| Consumer | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 19 | 20 | 21 | 22 | 23 | 24 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01 Constants | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 02 StrategyConfig | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 03 Provenance/MktData | D | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 04 DataVersionSnapshot | D | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 05 Eligibility VOs | D | – | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 06 Signal VOs | D | – | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 07 RegimeState VOs | D | – | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 08 CorporateAction VOs | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 09 BacktestRun Agg | D | – | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 10 StrategyVersion Agg | D | D | – | – | – | – | – | – | D | – | – | – | – | – | – | – | – |
| 11 AI Advisory VOs | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 12 Eligibility Svc | D | – | – | D | D | – | – | – | – | – | – | D | – | – | – | – | – |
| 13 Signal Scoring Svc | D | – | – | D | – | D | – | – | – | – | D | D | – | – | – | – | – |
| 14 Regime Svc | D | – | – | D | – | – | D | – | – | – | – | D | – | – | – | – | – |
| 15 Corp Action Proc | D | – | – | – | – | – | – | D | – | – | – | D | – | – | – | – | – |
| 16 Backtest Svc | D | – | – | – | – | – | – | – | D | – | – | D | – | – | – | – | – |
| 17 StratVer App Svc | D | – | – | – | – | – | – | – | – | D | – | – | – | – | – | – | D |
| 18 AI Advisory Svc | D | – | – | – | – | – | – | – | – | – | D | – | – | – | – | D | – |
| 19 Resilience Wrapper | D | – | – | – | – | – | – | – | – | – | – | – | D | – | D | – | – |
| 20 Circuit Breaker Reg | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 21 Research Mode Gate | D | – | – | D | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 22 Credential Redactor | D | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| 23 Provider Ports | D | – | D | – | – | – | – | – | – | – | D | – | – | – | – | – | – |
| 24 Persistence Ports | D | – | – | – | – | – | – | – | D | D | – | – | – | – | – | – | – |

LC-U03-25 through LC-U03-28 (test/verification/benchmark) depend on approved exports from LC-U03-01 through LC-U03-24 but are never imported by any runtime component.

---

## Acyclic Layers

1. LC-U03-01: Domain constants (no dependencies).
2. LC-U03-02, LC-U03-03, LC-U03-22: Leaf value objects and utilities (depend on LC-U03-01 only).
3. LC-U03-04, LC-U03-08, LC-U03-11: Snapshot and advisory value objects.
4. LC-U03-05, LC-U03-06, LC-U03-07, LC-U03-09: Evaluation and aggregate value objects.
5. LC-U03-10, LC-U03-20: StrategyVersion aggregate, circuit breaker.
6. LC-U03-19, LC-U03-21: Resilience and gate infrastructure.
7. LC-U03-12, LC-U03-13, LC-U03-14, LC-U03-15, LC-U03-16: Evaluation application services.
8. LC-U03-17, LC-U03-18: Lifecycle and advisory application services.
9. LC-U03-23, LC-U03-24: Port declarations.
10. LC-U03-26: BacktestDataAccessGuard (research/test utility).
11. LC-U03-28: Public entry point.
12. LC-U03-25, LC-U03-27: Test and benchmark leaves (never imported by runtime).

---

## Proposed Source Placement

| Logical Component | Proposed Path |
|---|---|
| LC-U03-01 | `server/portfolio/domain/strategy/constants.ts` |
| LC-U03-02 | `server/portfolio/domain/strategy/strategy-config.ts` |
| LC-U03-03 | `server/portfolio/domain/market-data/data-provenance.ts`, `market-data-record.ts` |
| LC-U03-04 | `server/portfolio/domain/market-data/data-version-snapshot.ts` |
| LC-U03-05 | `server/portfolio/domain/strategy/eligibility-result.ts` |
| LC-U03-06 | `server/portfolio/domain/strategy/signal-snapshot.ts` |
| LC-U03-07 | `server/portfolio/domain/strategy/regime-state.ts` |
| LC-U03-08 | `server/portfolio/domain/strategy/corporate-action.ts` |
| LC-U03-09 | `server/portfolio/domain/strategy/backtest-run.ts` |
| LC-U03-10 | `server/portfolio/domain/strategy/strategy-version.ts`, `strategy-events.ts` |
| LC-U03-11 | `server/portfolio/domain/strategy/ai-advisory.ts` |
| LC-U03-12 | `server/portfolio/application/strategy/eligibility-service.ts` |
| LC-U03-13 | `server/portfolio/application/strategy/signal-scoring-service.ts` |
| LC-U03-14 | `server/portfolio/application/strategy/regime-determination-service.ts` |
| LC-U03-15 | `server/portfolio/application/strategy/corporate-action-processor.ts` |
| LC-U03-16 | `server/portfolio/application/strategy/backtest-orchestration-service.ts` |
| LC-U03-17 | `server/portfolio/application/strategy/strategy-version-service.ts` |
| LC-U03-18 | `server/portfolio/application/strategy/ai-advisory-service.ts` |
| LC-U03-19 | `server/portfolio/infrastructure/resilience/provider-resilience-wrapper.ts` |
| LC-U03-20 | `server/portfolio/infrastructure/resilience/circuit-breaker-registry.ts` |
| LC-U03-21 | `server/portfolio/infrastructure/resilience/research-mode-gate.ts` |
| LC-U03-22 | `server/portfolio/infrastructure/resilience/credential-redactor.ts` |
| LC-U03-23 | `server/portfolio/ports/market-data/`, `server/portfolio/ports/strategy/ai-advisory-port.ts` |
| LC-U03-24 | `server/portfolio/ports/strategy/`, `server/portfolio/ports/market-data/snapshot-repository.ts` |
| LC-U03-25 | `tests/portfolio/support/arbitraries/strategy/`, `tests/portfolio/support/models/strategy/` |
| LC-U03-26 | `tests/portfolio/support/backtest-data-access-guard.ts` |
| LC-U03-27 | `benchmark/portfolio-strategy.ts` |
| LC-U03-28 | `server/portfolio/strategy-index.ts` |

Final filenames may be refined during Code Generation planning, but component responsibilities and dependency direction cannot change without NFR Design review.

---

## Contract Boundaries

- U01 public contracts (`server/portfolio/index.ts`) are used for exact values, identifiers, and domain results. U03 does not import U01 internals.
- U02 is accessed only through `StrategyVersionUnitOfWork` and `StrategyVersionRepository` port interfaces declared in LC-U03-24.
- Provider adapters that implement LC-U03-23 port interfaces live in a future U04 adapter layer; U03 declares only the interfaces.
- `server/portfolio/infrastructure/resilience/` is the only path that may reference circuit breaker, retry, and deadline infrastructure.
- AI advisory adapter implementation is also future (U04); U03 declares the port interface only.

---

## Verification Architecture

| Concern | Verification approach |
|---|---|
| Import and dependency direction | Static architecture graph check against the acyclic layer order above |
| No production component imports test support | Import-direction lint rule |
| All 100 NFR IDs assigned | Traceability table in `nfr-design-patterns.md` |
| Deterministic evaluation | Property: same inputs → same outputs for eligibility, scoring, and regime services |
| Float64 NaN/Infinity gate | Property: any NaN or Infinity injection in raw factors returns `COMPUTATION_ERROR`, not NaN in output |
| Weight sum invariant | Property: weight sum outside [999,990, 1,000,010] is always rejected |
| Backtest T+1 model | Property: no evaluation date uses data with an effective date after that evaluation date |
| Activation evidence completeness | Property: activation with any missing evidence type always returns typed failure |
| AI advisory constant literals | Compile-time check: cannot assign `true` to `canInfluenceState`, `canDetermineOrderQuantity`, `canAlterParameters` |
| Circuit breaker isolation | Property: failure in provider A does not change circuit state of provider B |
| Research mode gate | Property: any snapshot with `isProductionQuality = false` is rejected for production evaluation |
| No execution side effects | Static check: no broker/order/trade import in LC-U03-01 through LC-U03-18 |

---

## Traceability to NFR Patterns

| Logical Component | Primary Patterns |
|---|---|
| LC-U03-01, LC-U03-02 | PAT-U03-001, PAT-U03-004 |
| LC-U03-03, LC-U03-04 | PAT-U03-002 |
| LC-U03-06 | PAT-U03-003, PAT-U03-013 |
| LC-U03-07 | PAT-U03-001 |
| LC-U03-09 | PAT-U03-009 |
| LC-U03-10 | PAT-U03-008 |
| LC-U03-11 | PAT-U03-010 |
| LC-U03-12, LC-U03-13, LC-U03-14, LC-U03-15 | PAT-U03-001, PAT-U03-003 |
| LC-U03-16 | PAT-U03-009 |
| LC-U03-19 | PAT-U03-005 |
| LC-U03-20 | PAT-U03-006 |
| LC-U03-21 | PAT-U03-007 |
| LC-U03-22 | PAT-U03-012 |
| LC-U03-13, LC-U03-18 | PAT-U03-013 |
| LC-U03-25 | PAT-U03-014 |
| LC-U03-26 | PAT-U03-009 |

Every runtime component has at least one owning pattern. Every pattern has at least one owning component.
