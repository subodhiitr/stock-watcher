# U03 Strategy, Data, and Research NFR Requirements

## Scope and Criticality

U03 is a **Critical** in-process evaluation library and adapter boundary. It defines strategy version management, deterministic market data ingestion with provenance, universe eligibility filtering, factor-signal scoring, market-regime determination, corporate action processing, backtesting integrity, and the AI advisory boundary. It owns no HTTP listener, no browser surface, and no broker connection.

U03 correctness is financially critical because every downstream construction (U04), execution (U05), operations (U06), and research (U08) unit depends on the determinism, provenance, and fail-closed behavior of U03 outputs. A compromised evaluation output or a silent data error could produce incorrect portfolio decisions.

U03 has no independently deployable process or SLA. Availability is inherited from the containing Node application.

### Dependency Map

- **Upstream**: U01 domain contracts (identifiers, exact values, result types, port interfaces), U02 persistence (strategy version storage, backtest records, data snapshots)
- **Downstream consumers**: U04 (EligibilityResult, SignalSnapshot, RegimeState), U05 (StrategyVersionId, CorporateActionImpact), U06 (ProviderHealthRecord, audit events), U07 (strategy lifecycle commands and read models), U08 (research comparison UI via U07)
- **External provider ports**: MarketDataPort, FundamentalsPort, IndexMembershipPort, CorporateActionPort, ExchangeCalendarPort, InstrumentRegistryPort, AiAdvisoryPort

---

## Capacity Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-CAP-001 | The eligibility engine shall evaluate up to 1,000 instruments in a single evaluation pass without error or truncation. | Boundary fixture with 1,000 generated instruments. |
| NFR-U03-CAP-002 | The signal scoring engine shall compute scores for up to 1,000 eligible instruments in a single evaluation pass. | Same boundary fixture; verify all 1,000 SignalSnapshots are produced. |
| NFR-U03-CAP-003 | The DataVersionSnapshot shall capture data records for up to 1,000 instruments across up to 7 data types (EOD_PRICE, FUNDAMENTALS, INDEX_MEMBERSHIP, INSTRUMENT_DETAILS, EXCHANGE_CALENDAR, LIVE_QUOTE, CORPORATE_ACTION_SCHEDULE) without truncation. | Boundary snapshot fixture. |
| NFR-U03-CAP-004 | A BacktestRun shall support a date range of up to 10 calendar years of daily data (approximately 2,520 trading sessions) for up to 1,000 instruments. | Generated backtest fixture with 10-year date range. |
| NFR-U03-CAP-005 | Walk-forward evidence shall support up to 10 rolling folds within one BacktestRun. | Boundary fold fixture. |
| NFR-U03-CAP-006 | The strategy version registry shall support at least 100 distinct strategy versions across all strategyId families concurrently without performance degradation. | Boundary strategy registry benchmark. |
| NFR-U03-CAP-007 | The corporate action processor shall handle at least 50 concurrent pending actions for the same effective date without result ordering instability. | Batch action fixture. |
| NFR-U03-CAP-008 | Collections above approved limits shall fail with stable bounded errors before expensive computation begins. | Adversarial oversized-input examples. |
| NFR-U03-CAP-009 | Algorithms over the eligible universe (z-scoring, ranking, percentile computation) shall be linear or O(n log n); no unbounded quadratic scan is permitted at 1,000 instruments. | Complexity review and benchmark growth curve. |

---

## Performance and Latency Requirements

### Evaluation Latency

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-PERF-001 | A complete single-date evaluation for 1,000 instruments (eligibility + signal scoring + regime determination), starting from pre-fetched in-memory data records, shall complete below 60 seconds p95. | Warm benchmark with generated fixture; record p50, p95, maximum. |
| NFR-U03-PERF-002 | The eligibility engine applied to a single instrument shall complete below 10 ms p95. | Per-instrument warm benchmark. |
| NFR-U03-PERF-003 | Cross-sectional z-scoring and composite-score computation for 1,000 instruments (all components) shall complete below 20 seconds p95 starting from pre-computed raw factor inputs. | Scoring-only warm benchmark. |
| NFR-U03-PERF-004 | Regime determination for one evaluation date (7 indicators, confirmation counter update) shall complete below 500 ms p95. | Regime-only benchmark. |
| NFR-U03-PERF-005 | Strategy configuration validation and canonical hash computation for one config shall complete below 100 ms p95. | Config validation benchmark. |
| NFR-U03-PERF-006 | DataVersionSnapshot assembly for 1,000 instruments and 7 data types shall complete below 5 seconds p95, starting from pre-fetched records. | Snapshot assembly benchmark. |

### Backtest Latency

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-PERF-010 | A 5-year backtest for 1,000 instruments with walk-forward (3 rolling folds) shall complete below 10 minutes p95. Runs exceeding this limit produce a terminal BACKTEST_TIMEOUT failure and no partial result. | End-to-end backtest benchmark with generated 5-year fixture. |
| NFR-U03-PERF-011 | A single-fold evaluation pass within a backtest shall not exceed the same per-date latency bounds as live evaluation (NFR-U03-PERF-001). | Per-fold benchmark. |

### Provider Call Deadlines

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-PERF-015 | Each individual provider port call shall complete or fail within a configurable per-call deadline (default: 30 seconds). Calls exceeding the deadline are cancelled and treated as provider failures. | Mock provider with injected deadline; verify timeout produces ProviderErrorEvent. |
| NFR-U03-PERF-016 | The total data fetch phase for one evaluation date (all required providers) shall complete within a configurable total deadline (default: 120 seconds). Exhausted total deadline fails the evaluation with TOTAL_FETCH_TIMEOUT. | Injected slow provider benchmark. |

### Resource Use

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-PERF-020 | A full single-date evaluation for 1,000 instruments shall add no more than 256 MiB peak heap above the baseline. | Exposed-GC benchmark with heap measurement. |
| NFR-U03-PERF-021 | A 5-year backtest for 1,000 instruments shall complete without exceeding 512 MiB peak heap above the baseline at any fold boundary. | Backtest heap benchmark. |
| NFR-U03-PERF-022 | Benchmarks shall record Node version, OS, processor, input size, warm-up, iterations, seed, p50, p95, maximum, and heap delta. | Machine-readable benchmark report. |

---

## Determinism and Exact Arithmetic Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-DET-001 | Identical inputs (same strategyVersionId, dataVersionId, asOf date) shall always produce structurally equal EligibilityResult, SignalSnapshot, and RegimeState outputs. | Duplicate-run determinism property; verify byte-for-byte equivalent outputs. |
| NFR-U03-DET-002 | Z-score computation shall use IEEE 754 double-precision arithmetic with explicit NaN, Infinity, and negative-infinity detection after every intermediate step. Any pathological value produces a COMPUTATION_ERROR for the affected instrument and does not propagate silently. | PBT property with NaN/Infinity-injected inputs; verify COMPUTATION_ERROR is raised. |
| NFR-U03-DET-003 | Factor weight sum validation shall use the U01 scaled integer parts-per-million representation. The weight sum is verified as exactly 1,000,000; any deviation outside [999,990, 1,000,010] after rounding is rejected. | Exact weight sum property; boundary edge cases. |
| NFR-U03-DET-004 | The canonical strategy configuration hash shall use SHA-256 over deterministic UTF-8 canonical JSON (keys sorted, no trailing whitespace, no indentation) produced by node:crypto. Two structurally equal configs always produce the same hash. | Hash determinism property using generated configs. |
| NFR-U03-DET-005 | Cross-sectional z-scoring shall use the population statistics (mean and standard deviation) computed from the entire eligible universe in the same evaluation pass. No z-score references a prior session's population statistics. | Oracle cross-check property comparing per-instrument z-score to manual computation. |
| NFR-U03-DET-006 | Winsorization bounds [mean − 3σ, mean + 3σ] shall be computed before z-scoring and applied consistently across the full universe. Post-winsorization z-scores shall be in the range [−3.0, 3.0] for every instrument. | Range invariant property over generated universes. |
| NFR-U03-DET-007 | The conviction multiplier shall always be in [0.80, 1.20] inclusive for any generated eligible universe. | Multiplier range property over generated universes. |
| NFR-U03-DET-008 | Rank assignment shall be stable and deterministic. Ties in composite score are broken by descending instrumentId alphabetical order. Equivalent inputs always produce the same rank ordering. | Rank determinism property; permuted-input commutativity property. |
| NFR-U03-DET-009 | Backtest replay with identical strategyVersionId, dataVersionId, and date range shall produce an equivalent BacktestResult. Bootstrap/Monte Carlo tests with the same logged seed shall produce bitwise-identical results. | Backtest idempotency and seed-reproducibility properties. |
| NFR-U03-DET-010 | U03 evaluation functions shall not read ambient time, randomness, environment variables, process state, filesystem paths, database connections, or global mutable state. All non-deterministic inputs are provided by the application layer as explicit arguments. | Architecture and source inspection; determinism property. |

---

## Reliability Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-REL-001 | Every expected invalid input or evaluation failure shall return a typed DomainFailure with a stable reason code without mutation, partial result, event, retry, or success-shaped fallback. | Failure injection matrix; verify failure mode and no side effect. |
| NFR-U03-REL-002 | Unknown enum members, unsupported evidence types, unknown data types, and corrupted state shall fail closed. | Exhaustive unknown-value injection tests. |
| NFR-U03-REL-003 | A provider failure during eligibility or signal evaluation shall abandon the evaluation and produce a PROVIDER_UNAVAILABLE or STALE_DATA reason code. No partial EligibilityResult or SignalSnapshot shall be returned. | Fault-injection test on each provider port. |
| NFR-U03-REL-004 | Corporate action processing failures shall block the affected instrument from production planning without corrupting other instruments in the same evaluation pass. | Isolated failure injection per instrument. |
| NFR-U03-REL-005 | A BacktestRun that detects a look-ahead or survivorship violation shall transition to FAILED. A partial result with violations is structurally unrepresentable. | Bias-violation injection test. |
| NFR-U03-REL-006 | The AI advisory path shall not affect the result of eligibility, signal scoring, regime determination, or any deterministic evaluation step regardless of AI service availability. | Fault-injection on AiAdvisoryPort; verify evaluation result is unchanged. |
| NFR-U03-REL-007 | Strategy version status transitions shall be strictly enforced. An invalid transition returns a DomainFailure and leaves the aggregate unchanged. | State machine invariant property. |
| NFR-U03-REL-008 | A strategy activation event shall atomically include the exact hash, evidence references, and authorized actor before reaching U02 persistence. Partial activations are unrepresentable. | Activation scenario tests. |

---

## Provider Resilience Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-RES-001 | Transient provider failures shall trigger up to 3 retry attempts (configurable) with exponential backoff and configurable jitter. Each retry is subject to the per-call deadline. | Mock provider with N-failure-then-success; verify retry count and backoff interval. |
| NFR-U03-RES-002 | After exhausting all retry attempts, a terminal ProviderErrorEvent shall be emitted containing the provider identity, correlation ID, attempt count, and failure reason. | Exhausted-retry scenario test. |
| NFR-U03-RES-003 | Each external provider port shall have an independent circuit breaker. After a configurable number of consecutive failures (default 5), the circuit opens and subsequent calls fail immediately without a network attempt. | Circuit breaker state machine test. |
| NFR-U03-RES-004 | A circuit-open call shall produce a CIRCUIT_OPEN reason code and shall not count as a retry attempt. | Circuit state transition test. |
| NFR-U03-RES-005 | After a configurable cooldown period (default 60 seconds), the circuit moves to HALF_OPEN and permits one probe call. A successful probe closes the circuit; a failed probe reopens it. | Half-open probe scenario test. |
| NFR-U03-RES-006 | Circuit breaker state for each provider is maintained independently. A failure in one provider's circuit does not affect any other provider's circuit state. | Parallel circuit isolation test. |
| NFR-U03-RES-007 | Non-critical provider failure (AiAdvisoryPort, news provider, optional sentiment feed) shall degrade the advisory output without blocking, delaying, or altering the deterministic evaluation pipeline. A DEGRADED_ADVISORY_CONTEXT warning is attached to the affected result. | Fault-injection on non-critical port; verify evaluation proceeds unaffected. |
| NFR-U03-RES-008 | Provider health status (HEALTHY, DEGRADED, CIRCUIT_OPEN, UNKNOWN) is updated after every call attempt and available for U06 portfolio health reporting without coupling to the evaluation pipeline. | Health record update test. |

---

## Availability and Recovery Requirements

- U03 has no independent uptime target because it is not a deployable process.
- The containing portfolio workload retains the project-approved availability target and hours-level RTO with a one-hour RPO.
- U03 state (strategy versions, backtest records, data snapshots) is recoverable from U02 persistence by deterministic replay and validation.
- U03 defines versioned data port contracts and provenance records required for recovery reproducibility but does not back up or restore data directly.
- Multi-zone, multi-region, auto-scaling, failover, and cloud disaster-recovery infrastructure are N/A to U03.
- RTO/RPO decisions were established during Requirements Analysis and approved by the user. U03 does not alter these targets.

### Degraded Mode

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-AVAIL-001 | When a non-critical provider is unavailable, the system shall operate in a DEGRADED_ADVISORY_CONTEXT mode. Research-quality comparison reports are deferred; deterministic portfolio evaluation proceeds without blocking. | Non-critical fault-injection test; verify portfolio evaluation continues. |
| NFR-U03-AVAIL-002 | When a critical data provider is unavailable and no valid cached snapshot exists, the evaluation run fails closed with a stable reason code. Degraded mode does not produce a partially evaluated result that could mislead downstream units. | Critical fault-injection test; verify fail-closed with reason code. |

---

## Security Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-SEC-001 | All provider errors shall be logged with timestamp, correlation ID, provider identity, error type, and retry count. No provider-specific error message, internal stack trace, SQL fragment, or path detail shall be propagated to the external API response. | Log content inspection test; API error shape test. |
| NFR-U03-SEC-002 | Provider credentials, access tokens, API keys, and account identifiers shall be redacted from all log output, error messages, DomainFailure payloads, and audit events before any cross-component exposure. | Credential-redaction property; inject mock credentials and verify redacted output. |
| NFR-U03-SEC-003 | AiAdvisoryResult.canInfluenceState, AiAdvisoryResult.canDetermineOrderQuantity, and AiAdvisoryResult.canAlterParameters shall be enforced compile-time constants set to false. No code path shall set them to true. | Type-system inspection; PBT property P-28, P-29. |
| NFR-U03-SEC-004 | AI advisory requests shall not include portfolio state, orders, broker credentials, account identifiers, or personally identifiable information. The AiAdvisoryInput type shall structurally exclude these fields. | Type boundary inspection; generated request fuzz test. |
| NFR-U03-SEC-005 | Strategy configuration JSON shall be parsed using a schema-validated parser that rejects prototype-polluting keys, constructor-override patterns, executable content fields, and keys outside the declared schema before any field access. | Prototype-pollution injection tests; schema rejection examples. |
| NFR-U03-SEC-006 | All provider payload data shall be validated against a declared type schema before use. Payloads failing validation are rejected with a typed reason code and not stored in the DataVersionSnapshot. | Schema validation property over generated payloads. |
| NFR-U03-SEC-007 | Every prohibited AI advisory operation (parameter change, security selection, order instruction, return expectation) shall be rejected with PROHIBITED_AI_OPERATION and logged in the security audit trail before invocation. | Prohibited-operation rejection tests for all prohibited types. |
| NFR-U03-SEC-008 | AiAdvisoryPort shall enforce the closed AiPermittedOperation enum at the boundary. Any operation string not in the six-element set is rejected before the call is executed. | Exhaustive permitted/prohibited boundary tests. |
| NFR-U03-SEC-009 | Only verified exchange filings, company filings, or licensed structured provider data shall create HARD_RISK_FLAG or FUNDAMENTAL_HEALTH_EXCLUDE entries. AI advisory output shall never set these flags. | Flag-creation boundary tests; AI advisory output → flag attempt rejection test. |
| NFR-U03-SEC-010 | Every strategy lifecycle event (creation, submission for activation, activation, supersession, withdrawal) shall be logged as an immutable audit event with actor identity, timestamp, strategy version hash, and correlation ID. | Audit event content property; verify all six lifecycle transitions produce correct events. |
| NFR-U03-SEC-011 | Every AI advisory interaction shall be recorded in the audit log with requestId, permittedOperation, producedAt, model identifier (redacted for external exposure), and SHA-256 summary hash of the output. | Audit event content property for AI interactions. |
| NFR-U03-SEC-012 | Security-sensitive NFR tests shall include: credential injection, prohibited AI operation attempts, HARD_RISK_FLAG creation from non-structural sources, lifecycle transitions by unauthorized actors, and config JSON with prototype-polluting payloads. | Security test matrix. |

---

## Observability Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-OBS-001 | Every evaluation run (eligibility, signal, regime) shall produce a DataVersionSnapshot identifier that links to all contributing data records. The snapshot is queryable by evaluation date and strategy version. | Snapshot traceability test; verify snapshot links correctly. |
| NFR-U03-OBS-002 | Every SignalSnapshot shall record the DataVersionId, missing-data treatment flags, sector-branching decisions, and any COMPUTATION_ERROR instruments. | Signal snapshot content property. |
| NFR-U03-OBS-003 | Provider health status per provider shall be queryable at any time without triggering an evaluation run. | Health-query isolation test. |
| NFR-U03-OBS-004 | A DEGRADED_ADVISORY_CONTEXT label persists in the SignalSnapshot and research report for any evaluation pass where a non-critical provider was unavailable. This label is never silently removed. | Degradation label persistence test. |
| NFR-U03-OBS-005 | All provider errors shall include a correlation ID that connects the log entry to the evaluation run that triggered the call. | Correlation ID propagation test. |
| NFR-U03-OBS-006 | A backtest run shall record exchange calendar version, timezone, cost model version, and data completeness percentage per fold for full reproducibility and auditability. | BacktestRun content property. |

---

## Research-Mode Separation Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-RSC-001 | NSE_OFFICIAL and YAHOO_RESEARCH data records shall always have isProductionQuality = false. Any path that promotes these records to isProductionQuality = true is rejected. | Promotion-attempt rejection test; source-to-quality mapping property. |
| NFR-U03-RSC-002 | A DataVersionSnapshot used for production planning shall have isProductionQuality = true across all contributing sources. A snapshot with any non-production-quality source is structurally blocked from production evaluation use. | Snapshot quality gate test. |
| NFR-U03-RSC-003 | Research-mode outputs shall be visibly labelled with the data source, isProductionQuality = false, and RESEARCH_MODE_ONLY in the result. No research-mode result shall reach a production planning or order generation code path. | Label presence property; boundary test at planning gate. |
| NFR-U03-RSC-004 | Stale records may be used in research mode only if explicitly requested and the result is labelled STALE. Stale records shall never enter a production evaluation silently. | Stale-data research-mode label property. |
| NFR-U03-RSC-005 | Strategy presets and all strategy versions in PAPER or OBSERVE mode are permitted to use research data. Production planning mode requires production-quality data only. | Mode-to-quality policy property. |

---

## Testing and Property-Based Verification Requirements

### Story Coverage

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-TEST-001 | Every acceptance criterion in US-006, US-007, US-008, US-010, US-011, US-012, US-013, US-014, US-036, US-037, and US-038 shall have at least one explicit named test case or property. | Story-to-test coverage matrix. |
| NFR-U03-TEST-002 | Every business rule in the 140 U03 business rules (SR, SV, MD, UE, SC, RM, CA, BT, AI, DF subsystems) shall map to at least one named test case or property. | Rule-to-test coverage matrix. |

### Example-Based Tests

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-TEST-010 | Critical regression tests shall pin exact output values, event counts, event field contents, reason codes, and data version identifiers. | Pinned regression test suite. |
| NFR-U03-TEST-011 | Test fixtures shall use generated fake instrument identifiers, fake provider responses, and fake actor identities; they shall contain no real broker credentials, market data subscriptions, or user data. | Fixture audit; credential-scan on test files. |
| NFR-U03-TEST-012 | Bias tests shall inject known future data into backtest fixtures and verify that look-ahead and survivorship safeguards detect the violation and produce a FAILED status. | Bias-violation injection example tests. |

### Property-Based Tests

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-PBT-001 | Use fast-check integrated with Node's test runner. No additional PBT framework is introduced. | package.json and import inspection. |
| NFR-U03-PBT-002 | Shared arbitraries from U01/U02's portfolio test-support boundary shall be reused and extended with U03-specific generators: StrategyConfig, EligibilityInput, SignalUniverse, RegimeIndicatorSequence, CorporateAction, BacktestDateRange, and AiAdvisoryRequest. | Generator inventory inspection. |
| NFR-U03-PBT-003 | Pure properties (P-01 through P-17, P-23 through P-26, P-28 through P-32) shall execute at least 1,000 generated cases in CI. | fast-check numRuns configuration. |
| NFR-U03-PBT-004 | Stateful model properties (P-06, P-19, P-20) shall execute at least 250 generated command sequences with lengths from 1 through 100. | fast-check commands numRuns and maxCommands configuration. |
| NFR-U03-PBT-005 | Expensive backtest idempotency properties (P-25) shall execute at least 50 generated cases. | fast-check numRuns configuration for backtest suite. |
| NFR-U03-PBT-006 | Shrinking shall remain enabled. Failure output shall include the seed, shrunk path, and minimal counterexample. | fast-check configuration; failure output format test. |
| NFR-U03-PBT-007 | CI shall log the seed or use an explicitly recorded fixed seed. A flaky property failure shall be investigated, not retried silently. | CI script and seed logging requirement. |
| NFR-U03-PBT-008 | Round-trip properties (P-01, P-27, P-31) shall generate arbitrary valid inputs and verify structural equality after the round trip. | Round-trip property suite. |
| NFR-U03-PBT-009 | Every shrunk production-relevant counterexample shall become a permanent explicit regression test in the appropriate `.test.ts` file. | Regression test policy; post-shrink conversion process. |
| NFR-U03-PBT-010 | The StrategyConfig generator shall cover: boundary weight sums (near 1.0, exactly 1.0, slightly over, slightly under); invalid enum values; malformed JSON; empty and maximum-length benchmarks; prototype-polluting payloads. | Generator specification review. |
| NFR-U03-PBT-011 | The SignalUniverse generator shall cover: all-missing inputs; zero-std-deviation component (all instruments equal); universe sizes from 1 to 1,000; instruments with NaN/Infinity raw factor values. | Generator specification review. |
| NFR-U03-PBT-012 | The RegimeIndicatorSequence generator shall cover: sequences designed to trigger confirmation-period boundaries at exactly confirmationPeriodsWeakening and confirmationPeriodsStrengthening; mid-sequence crisis injection; all-missing indicator sequences. | Generator specification review. |
| NFR-U03-PBT-013 | The AiAdvisoryRequest generator shall cover all six permitted operations and all documented prohibited operation types. | Generator specification review. |
| NFR-U03-PBT-014 | CorporateAction generators shall cover all ten action types (SPLIT, BONUS, CASH_DIVIDEND, RIGHTS, MERGER, DEMERGER, SYMBOL_CHANGE, DELISTING, BUYBACK_TENDER, ETF_UNIT_CHANGE) with boundary ratios and ambiguous-source scenarios. | Generator specification review. |

---

## Maintainability Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U03-MAINT-001 | U03 code shall be organized under `server/portfolio/domain/strategy/`, `server/portfolio/domain/evaluation/`, `server/portfolio/application/evaluation/`, `server/portfolio/adapters/market-data/`, and `server/portfolio/adapters/research/` without merging unrelated concerns. | Architecture graph; module boundary inspection. |
| NFR-U03-MAINT-002 | Dependency direction shall be strictly acyclic: domain logic has no import from adapters, HTTP, broker SDKs, React, simulation engine, or legacy dashboard modules. | Import graph verification. |
| NFR-U03-MAINT-003 | Public exports from U03 modules shall be explicit; wildcard barrel cycles and deep imports into another module's internals are prohibited. | Barrel export inspection. |
| NFR-U03-MAINT-004 | Every public type, state machine, algorithm, data port, reason code, and capacity bound shall be documented inline. | Documentation coverage review. |
| NFR-U03-MAINT-005 | U03 shall introduce no new production runtime dependency. Existing node:crypto, node:assert, node:test, and the locked fast-check development dependency are sufficient. | package.json and manifest inspection. |
| NFR-U03-MAINT-006 | No generated JavaScript, backtest output files, data snapshot files, benchmark result files, or provider mock fixtures shall be committed to the repository. | .gitignore and artifact scan. |
| NFR-U03-MAINT-007 | U03 shall not alter `/trade-execution`, `/paper-trades`, legacy database schemas, simulation engine APIs, dashboard modules, or intraday policy logic. | Change set inspection before merge. |
| NFR-U03-MAINT-008 | The TypeScript strict configuration established in U01 shall apply to all U03 source files. No compiler strictness weakening is permitted. | tsconfig inheritance review. |

---

## Explicit N/A Categories

- Network TLS, cloud IAM, load balancing, autoscaling, multi-zone deployment, and CDN controls are N/A to U03.
- Browser security, React accessibility, and HTTP authentication are N/A to U03.
- SQLite WAL configuration, backup scheduling, restore orchestration, and alerting are owned by U02 and U06 respectively; U03 supplies provenance records and port contracts only.
- Broker execution deadlines, order rate limits, and reconciliation SLAs are owned by U05.
- U03 has no independent uptime or SLA target.

---

## Extension Compliance

### Security Baseline

- Applicable: SECURITY-03, SECURITY-05, SECURITY-11, SECURITY-13, SECURITY-15.
- N/A: SECURITY-01 (no persistence layer in U03), SECURITY-02 (no network intermediary), SECURITY-04 (no HTTP surface), SECURITY-08 (no authorization layer).
- Compliant: NFR-U03-SEC-001 through SEC-012 address all applicable rules.
- No blocking Security finding.

### Resiliency Baseline

- Applicable: RESILIENCY-01, RESILIENCY-02, RESILIENCY-05, RESILIENCY-06, RESILIENCY-10.
- N/A: RESILIENCY-03, RESILIENCY-04 (change management and CI owned at project level), RESILIENCY-07 (stateful data owned by U02), RESILIENCY-08 (regional topology N/A for local deployment), RESILIENCY-11 through RESILIENCY-13 (DR owned by U06), RESILIENCY-14 (resiliency testing deferred to U06), RESILIENCY-15 (incident response owned at project level).
- Compliant: NFR-U03-RES-001 through RES-008, NFR-U03-AVAIL-001, AVAIL-002 address all applicable rules.
- No blocking Resiliency finding.

### Property-Based Testing (Full Enforcement)

- PBT-01: Complete in Functional Design (32 properties P-01 through P-32 documented).
- PBT-02 through PBT-08, PBT-10: Measurable Code Generation obligations specified in NFR-U03-PBT-001 through PBT-014.
- PBT-09: fast-check already locked as root development dependency in U01; reused in U03 without reinstallation.
- No blocking PBT finding.
