# U03 Strategy, Data, and Research – NFR Design Patterns

## Pattern Overview

U03 applies fourteen design patterns spanning deterministic evaluation arithmetic, point-in-time data versioning, provider resilience, research-mode separation, activation evidence gating, backtest bias certification, AI advisory structural isolation, credential-safe logging, non-critical degradation, and property-test generator architecture. All patterns are in-process software patterns. U03 introduces no cloud queue, managed cache, load balancer, external worker, or deployed infrastructure component.

---

## PAT-U03-001: Deterministic Evaluation Pipeline

### Intent

Guarantee that identical inputs always produce identical outputs for every evaluation function (eligibility, scoring, regime, backtest), enabling reproducibility, audit, and property-based verification.

### Design

- All evaluation functions accept every non-deterministic input as an explicit argument: data version snapshot, strategy config, as-of date, exchange calendar, actor identity.
- No function reads ambient time (`Date.now()`), randomness (`Math.random()`), environment variables, filesystem state, process global, or database connection from within domain or application service logic.
- Canonical collection ordering is applied at construction (alphabetical by instrumentId for universe, alphabetical by key for config objects). Equal inputs yield the same canonical order.
- Idempotent operations preserve output and emit no event on repeated equivalent calls.
- State version increments exactly once per accepted state-changing lifecycle command; no-ops and rejections do not increment.

### Explicitly Excluded

- Clock reads inside evaluation functions.
- Random tiebreaks (deterministic alphabetical tiebreak is used instead).
- Cached mutable global score state.
- Partial evaluation results returned on error.

### NFR Coverage

NFR-U03-DET-001, NFR-U03-DET-005, NFR-U03-DET-008, NFR-U03-DET-010, NFR-U03-REL-001, NFR-U03-REL-002, NFR-U03-REL-007.

---

## PAT-U03-002: Point-in-Time Data Versioning and Provenance Gate

### Intent

Ensure every evaluation decision is permanently linked to an immutable, complete, and quality-validated data snapshot, enabling full historical reproducibility and look-ahead prevention.

### Design

- Before any evaluation run begins, assemble a `DataVersionSnapshot` from all required data records for the evaluation date.
- Completeness check: for each required dataType, verify that at least 98% of expected observations are present. Any dataType below threshold rejects the snapshot with `INCOMPLETE_DATA_SNAPSHOT`.
- Quality flag: if any contributing source has `isProductionQuality = false`, set the snapshot's `isProductionQuality = false`. Production evaluation rejects non-production-quality snapshots (enforced by ResearchModeGate, PAT-U03-007).
- Each data record carries immutable provenance: source, fetchedAt, marketTimestamp, effectiveDate, version, validationStatus. Records missing any provenance field are rejected at ingestion time.
- Staleness check: any record where `now() > staleAfterInstant` is marked STALE and blocked from production evaluation.
- The snapshot ID (`DataVersionId`, UUID v4 via `node:crypto.randomUUID()`) is bound to every downstream evaluation result (EligibilityResult, SignalSnapshot, RegimeState, BacktestResult). Results without a bound snapshot ID are structurally invalid.

### NFR Coverage

NFR-U03-CAP-003, NFR-U03-DET-001, NFR-U03-DET-009, NFR-U03-OBS-001, NFR-U03-OBS-006, NFR-U03-RSC-001 through RSC-004, NFR-U03-REL-003, NFR-U03-SEC-006.

---

## PAT-U03-003: Float64 Score Arithmetic with NaN/Infinity Hard Gate

### Intent

Compute z-scores, composite scores, conviction multipliers, and rates using IEEE 754 double-precision arithmetic while preventing pathological values from propagating silently to downstream evaluation consumers.

### Design

- All signal-scoring arithmetic uses JavaScript `Number` (float64). No decimal or BigInt library is used for z-scores.
- After every intermediate computation step (raw factor, winsorized value, z-score, component score, composite score, conviction multiplier), apply an explicit gate:
  ```
  if (!Number.isFinite(value)) → COMPUTATION_ERROR for affected instrument
  ```
- `COMPUTATION_ERROR` is a typed `DomainFailure`. It marks the affected instrument's signal as INELIGIBLE for construction and does not propagate to other instruments.
- Cross-sectional mean and standard deviation are computed from the full universe in one pass. When std = 0 (all instruments have the same raw value), all z-scores for that component are set to 0.0 (neutral) rather than producing NaN.
- Winsorization clips values to [mean − 3σ, mean + 3σ] before z-scoring. Post-winsorization z-scores are in [−3.0, 3.0].
- Conviction multiplier is always clamped to [0.80, 1.20] inclusive as a final safety gate, regardless of intermediate percentile result.

### NFR Coverage

NFR-U03-DET-002, NFR-U03-DET-005, NFR-U03-DET-006, NFR-U03-DET-007, NFR-U03-REL-001, NFR-U03-REL-002, NFR-U03-PBT-011.

---

## PAT-U03-004: Scaled Integer Weight Sum Invariant

### Intent

Verify factor weight policy constraints with exact integer arithmetic, avoiding floating-point comparison failures on weight sums.

### Design

- Factor weights are stored and validated as integer parts-per-million (values in [0, 1,000,000]) reusing the U01 exact-value contracts.
- Weight sum verification: `momentumPPM + qualityPPM + lowRiskPPM` must equal exactly 1,000,000. Acceptance band is [999,990, 1,000,010] to account for rounding at the input boundary; values outside this band are rejected with a named error code.
- Sub-component weight sets (7 momentum, 6 quality, 5 risk) are each independently verified to sum to 1,000,000 using the same scaled integer check.
- The canonical JSON hash computation converts weight values to their decimal string form before hashing, preserving the exact numeric value.
- Floating-point weight comparisons (e.g., `0.3 + 0.4 + 0.3 === 1.0`) are never used for policy validation.

### NFR Coverage

NFR-U03-DET-003, NFR-U03-DET-004, NFR-U03-SEC-005, NFR-U03-PBT-010.

---

## PAT-U03-005: Provider Call with Per-Call Deadline and Exponential Backoff Retry

### Intent

Make every external provider call resilient to transient failures while preventing unbounded wait time from blocking the evaluation pipeline.

### Design

- Every external provider port call is wrapped by `ProviderResilienceWrapper` (LC-U03-22).
- **Per-call deadline**: each call is bounded by a configurable timeout (default 30 s). Calls exceeding the deadline are cancelled and treated as a provider failure.
- **Retry**: on a transient failure, retry up to `maxRetries` times (default 3) with exponential backoff (`base × 2^attempt`) and configurable jitter. Each retry is independently subject to the per-call deadline.
- **Exhaustion**: after all retries are exhausted, emit a terminal `ProviderErrorEvent` containing provider identity, correlation ID, attempt count, and failure reason. Do not return a partial or default result.
- **Critical vs non-critical path**: if the provider is on the critical evaluation path (MarketDataPort, FundamentalsPort, IndexMembershipPort, ExchangeCalendarPort, InstrumentRegistryPort), the evaluation run fails closed. If non-critical (AiAdvisoryPort), degrade to `DEGRADED_ADVISORY_CONTEXT` (PAT-U03-013).
- The wrapper does not catch invariant errors or `DomainInvariantError`; those propagate immediately.

### NFR Coverage

NFR-U03-PERF-015, NFR-U03-PERF-016, NFR-U03-RES-001, NFR-U03-RES-002, NFR-U03-REL-003, NFR-U03-SEC-001.

---

## PAT-U03-006: Per-Provider Circuit Breaker

### Intent

Stop making futile network attempts after a provider enters a failure run, protecting downstream latency and preventing retry avalanche.

### Design

- `ProviderCircuitBreakerRegistry` (LC-U03-23) maintains one `CircuitBreakerState` per provider identity (string key).
- Circuit breaker state machine:
  ```
  CLOSED
    --[consecutive failures >= failureThreshold (default 5)]--> OPEN
  OPEN
    --[cooldown elapsed (default 60 s)]--> HALF_OPEN
  HALF_OPEN
    --[probe succeeds]--> CLOSED
    --[probe fails]----> OPEN
  ```
- In `OPEN` state, calls return immediately with `CIRCUIT_OPEN` reason code without a network attempt. This does not count as a retry.
- In `HALF_OPEN` state, exactly one probe call is permitted. All other concurrent calls receive `CIRCUIT_OPEN` until the probe resolves.
- Circuit breaker instances are independent per provider. A failure in one does not affect any other.
- Circuit breaker state is in-memory. It resets on process restart.

### NFR Coverage

NFR-U03-RES-003, NFR-U03-RES-004, NFR-U03-RES-005, NFR-U03-RES-006, NFR-U03-RES-008.

---

## PAT-U03-007: Research-Mode Separation Gate

### Intent

Enforce a hard boundary that prevents non-production-quality data from entering production evaluation, construction, or order generation pipelines.

### Design

- `ResearchModeGate` (LC-U03-24) is called at the application service boundary before any production evaluation call.
- Gate checks `DataVersionSnapshot.isProductionQuality`. If `false`, the call is rejected with `NON_PRODUCTION_DATA_FOR_PRODUCTION_EVAL`.
- Gate checks individual record `isProductionQuality`. NSE_OFFICIAL and YAHOO_RESEARCH sources always produce `isProductionQuality = false` records.
- Research-mode evaluation is permitted explicitly: the calling application service must pass a `ResearchMode` flag, and all results are labelled `RESEARCH_MODE_ONLY`.
- Stale records (where `now() > staleAfterInstant`) are allowed only in research mode with an explicit `STALE` label in the output. They never enter production evaluation silently.
- The gate is not callable from domain logic. It lives only in the application service or adapter layer.

### NFR Coverage

NFR-U03-RSC-001 through NFR-U03-RSC-005, NFR-U03-REL-003, NFR-U03-SEC-005.

---

## PAT-U03-008: Strategy Activation Evidence Gate

### Intent

Prevent unvalidated strategy configurations from reaching portfolio construction or production use by enforcing a multi-evidence, multi-actor activation checkpoint.

### Design

- The activation command is accepted only when:
  1. Submitting actor identity is confirmed as an authorized strategy approver (opaque evidence token from the application layer).
  2. All four mandatory evidence types are present in `evidenceRefs`: BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION.
  3. Every evidence reference has `passed = true`.
  4. No AI advisory result is included as evidence (structural check: evidence type must be in the mandatory set).
  5. No other version for the same `strategyId` is currently ACTIVE (checked through the repository port before the state transition).
- If all checks pass: atomically transition this version to ACTIVE and the previous ACTIVE version to SUPERSEDED. This atomicity is enforced by U02 at the database transaction level; U03 domain logic returns both transitions as an ordered result.
- Emit `StrategyVersionActivated` and `StrategyVersionSuperseded` audit events with actor, timestamp, configHash, and evidence reference list.
- Strategy activation never implicitly enables live trading (execution gates live in U05).

### NFR Coverage

NFR-U03-REL-007, NFR-U03-REL-008, NFR-U03-SEC-009, NFR-U03-SEC-010, NFR-U03-SEC-011.

---

## PAT-U03-009: Backtest Bias Certification

### Intent

Prevent look-ahead bias and survivorship bias from contaminating backtest evidence used for strategy activation.

### Design

- Every data access in a backtest replay is routed through a `BacktestDataAccessGuard` (LC-U03-28) that records the access date, data publication date, and access type.
- **Look-ahead check**: any fundamental access with a publication date after the decision date T is a `LOOK_AHEAD_VIOLATION`. Any price or membership record with a date after EOD of day T is a `LOOK_AHEAD_VIOLATION`.
- **Survivorship check**: the backtest universe at any evaluation date is constructed from the historical point-in-time index membership for that date. Any instrument that was in the universe on a given date but is excluded in the test because it no longer exists today is a `SURVIVORSHIP_BIAS_VIOLATION`.
- Before the BacktestRun transitions to COMPLETED:
  - Both `lookAheadChecksPerformed` and `survivorshipBiasChecksPerformed` must be `true`.
  - `lookAheadViolations` and `survivorshipViolations` must both be 0.
- A BacktestRun with any violation transitions to FAILED. The partial result is discarded.
- T+1 execution model is enforced: the decision date is EOD of day T; execution is simulated at the opening of day T+1 within the configured execution window.

### NFR Coverage

NFR-U03-DET-009, NFR-U03-REL-005, NFR-U03-TEST-012, NFR-U03-OBS-006.

---

## PAT-U03-010: AI Advisory Structural Boundary

### Intent

Ensure AI advisory output can never alter financial decisions, domain state, risk parameters, or order behavior through structural language constraints rather than runtime checks.

### Design

- `AiAdvisoryResult` has three compile-time constants typed as the literal `false`:
  - `canInfluenceState: false`
  - `canDetermineOrderQuantity: false`
  - `canAlterParameters: false`
  These are TypeScript literal types enforced at the type-system level; no runtime assignment to `true` is possible.
- `AiPermittedOperation` is a closed TypeScript union of exactly six string literals. Any string not in the union is a compile-time error.
- Any request whose operation is not in the permitted set is rejected at the `AiAdvisoryPort` boundary with `PROHIBITED_AI_OPERATION` before any call is made.
- `AiAdvisoryInput` type structurally excludes portfolio state, orders, broker credentials, account identifiers, and PII. The type system prevents these from being passed in.
- AI advisory audit events are recorded after every interaction: requestId, permittedOperation, producedAt, model identifier (redacted for external exposure), SHA-256 hash of the output content.

### NFR Coverage

NFR-U03-SEC-003, NFR-U03-SEC-004, NFR-U03-SEC-007, NFR-U03-SEC-008, NFR-U03-SEC-011, NFR-U03-PBT-013.

---

## PAT-U03-011: Closed Typed Domain Failure

### Intent

Handle every expected validation and processing failure completely while preventing corrupted or unknown state from being silently accepted as a domain value.

### Design

- Same discriminated `DomainResult<T>` pattern from U01.
- Success and failure branches are mutually exclusive; exhaustive switches are required.
- Failure context uses field-specific allowlists, bounded scalar counts and lengths, stable reason codes, and redacted identifier rendering.
- Rejected operations return no next state, no events, and no partial data.
- Unknown enum members, unsupported evidence types, and corrupted aggregate state fail closed with the closest typed failure code.
- `DomainInvariantError` is reserved for impossible trusted-state corruption or programmer defects; it is not caught and downgraded by U03.

### NFR Coverage

NFR-U03-REL-001, NFR-U03-REL-002, NFR-U03-REL-004, NFR-U03-REL-006, NFR-U03-SEC-001.

---

## PAT-U03-012: Credential-Redacted Structured Logging

### Intent

Ensure provider errors are observable and traceable without leaking credentials, internal implementation details, or sensitive provider metadata.

### Design

- Every provider error is logged with a structured record containing: timestamp (ISO-8601), correlation ID, provider identity (logical name, never credential), error type (typed enum), retry attempt count, and circuit breaker state at the time of failure.
- Before any log write, a `CredentialRedactor` component scrubs known credential field names (apiKey, token, secret, password, authorization) from the log payload.
- Provider-specific error messages and internal stack traces are mapped to a safe, provider-agnostic error code before logging or propagating to the external API.
- Log output is structured (JSON lines or equivalent) to support downstream log aggregation in U06 without manual parsing.
- No log write may block the evaluation pipeline. Log writes are best-effort fire-and-forget to the standard output stream.

### NFR Coverage

NFR-U03-SEC-001, NFR-U03-SEC-002, NFR-U03-OBS-003, NFR-U03-OBS-005, NFR-U03-MAINT-004.

---

## PAT-U03-013: Non-Critical Degradation Path

### Intent

Allow the deterministic evaluation pipeline to proceed fully when optional advisory services are unavailable, preventing non-essential failures from blocking financially critical decisions.

### Design

- The evaluation pipeline has two execution paths:
  - **Critical path**: eligibility, signal scoring, regime determination, corporate action processing. This path must complete or fail closed.
  - **Advisory path**: AI advisory, news context, optional sentiment. This path degrades without blocking the critical path.
- When any advisory-path provider is unavailable:
  - The critical path proceeds unaffected.
  - A `DEGRADED_ADVISORY_CONTEXT` warning flag is attached to the SignalSnapshot and any research report.
  - The flag is immutable: once set, it cannot be removed by a later successful advisory call on the same snapshot.
- The `DEGRADED_ADVISORY_CONTEXT` label is visible to portfolio operators in U06 health reporting.
- Advisory-path exceptions are caught at the application service boundary and converted to the `DEGRADED_ADVISORY_CONTEXT` flag. They do not propagate to the critical-path result.

### NFR Coverage

NFR-U03-RES-007, NFR-U03-RES-008, NFR-U03-AVAIL-001, NFR-U03-OBS-004, NFR-U03-REL-006.

---

## PAT-U03-014: Property Test Generator Architecture

### Intent

Provide a complete, reusable, and well-specified set of test generators covering all 32 identified PBT properties, with correct shrinking behavior and reproducible seeds.

### Design

Seven generator families, each implemented as a named `fast-check` arbitrary:

| Generator | Coverage |
|---|---|
| `strategyConfigArb` | Valid/invalid weight sums, all enum fields, boundary thresholds, malformed JSON, prototype-polluting payloads |
| `eligibilityInputArb` | Per-instrument eligibility inputs with pass/fail outcomes, BFSI/non-BFSI split, missing-field injection |
| `signalUniverseArb` | Arbitrary universe sizes 1–1,000, NaN/Infinity raw factor injection, zero-std component, all-missing inputs |
| `regimeIndicatorSequenceArb` | Multi-day sequences hitting confirmation boundaries, mid-sequence crisis injection, all-missing sequences |
| `corporateActionArb` | All 10 action types, boundary ratios, ambiguous-source scenarios |
| `backtestDateRangeArb` | Date ranges below/exactly/above 5 years, look-ahead injection cases |
| `aiAdvisoryRequestArb` | All 6 permitted operations, all documented prohibited types |

All generators extend the shared portfolio test-support arbitraries established in U01/U02.

Shrinking discipline:
- Shrinking must reduce universe size while preserving the violating condition.
- Shrinking must reduce weight arrays to the minimal failing example.
- Shrinking must reduce regime sequences to the minimal transition-violating subsequence.
- Every shrunk production-relevant counterexample becomes a permanent named regression test.

CI seed policy:
- Every CI run logs the fast-check seed.
- A fixed recorded seed may be used for expensive backtest properties.
- Flaky failures are investigated, not retried silently.

### NFR Coverage

NFR-U03-PBT-001 through NFR-U03-PBT-014, NFR-U03-TEST-011, NFR-U03-TEST-012.

---

## NFR Coverage Traceability

Every NFR ID is assigned to at least one pattern. Unassigned IDs after all patterns are listed would be a compliance gap.

| NFR Category | Assigned To |
|---|---|
| NFR-U03-CAP-001 through CAP-009 | PAT-U03-001 (CAP-009), PAT-U03-002 (CAP-003), PAT-U03-014 (all generators drive capacity tests) |
| NFR-U03-PERF-001 through PERF-022 | PAT-U03-001 (determinism enables benchmark), PAT-U03-003 (single-pass float), PAT-U03-005 (provider deadline = PERF-015,016) |
| NFR-U03-DET-001 through DET-010 | PAT-U03-001 (DET-001,005,008,010), PAT-U03-002 (DET-001,009), PAT-U03-003 (DET-002,005,006,007), PAT-U03-004 (DET-003,004) |
| NFR-U03-REL-001 through REL-008 | PAT-U03-011 (REL-001,002,004,006), PAT-U03-001 (REL-001,007), PAT-U03-005 (REL-003), PAT-U03-009 (REL-005), PAT-U03-008 (REL-007,008) |
| NFR-U03-RES-001 through RES-008 | PAT-U03-005 (RES-001,002), PAT-U03-006 (RES-003 through RES-006), PAT-U03-013 (RES-007,008) |
| NFR-U03-AVAIL-001 through AVAIL-002 | PAT-U03-013 (AVAIL-001), PAT-U03-005 (AVAIL-002) |
| NFR-U03-SEC-001 through SEC-012 | PAT-U03-012 (SEC-001,002), PAT-U03-010 (SEC-003,004,007,008,011), PAT-U03-007 (SEC-005), PAT-U03-002 (SEC-006), PAT-U03-009 (SEC-009), PAT-U03-008 (SEC-010,011) |
| NFR-U03-OBS-001 through OBS-006 | PAT-U03-002 (OBS-001), PAT-U03-003 (OBS-002), PAT-U03-006 (OBS-003), PAT-U03-013 (OBS-004), PAT-U03-012 (OBS-005), PAT-U03-009 (OBS-006) |
| NFR-U03-RSC-001 through RSC-005 | PAT-U03-007 (RSC-001 through RSC-005) |
| NFR-U03-TEST-001 through TEST-012 | PAT-U03-014 (TEST-011,012), all patterns drive TEST-001,002 coverage |
| NFR-U03-PBT-001 through PBT-014 | PAT-U03-014 (all PBT IDs) |
| NFR-U03-MAINT-001 through MAINT-008 | PAT-U03-001 (MAINT-002), PAT-U03-012 (MAINT-004), PAT-U03-005 (MAINT-005) |
