# U04 Construction and Rebalancing NFR Requirements

## Scope and Criticality

U04 is **financially critical in-process planning logic**. It converts immutable U01/U02 portfolio state and immutable U03 evaluation outputs into deterministic, approval-ready rebalance plans. U04 owns no broker execution, no scheduler, no HTTP listener, no background daemon, and no independent deployment artifact.

Under the approved project workload taxonomy, planning remains a **High** workload rather than a deployable **Critical** service. That classification does **not** reduce the correctness bar: a wrong plan can still create real financial harm, so U04 must remain exact, deterministic, explainable, and fail closed.

U04 has **no independent deployment SLA**. Availability, RTO, RPO, backup, restore, topology, and incident-process ownership are inherited from the containing local Node application and the project-wide operations decisions.

## Dependency Map

- **Upstream domain contracts**: U01 exact `Money`, `Quantity`, `Weight`, `ScaledRate`, identifiers, holding, lot, and portfolio-scope invariants.
- **Upstream persistence lineage**: U02 snapshot, lot, cost/tax schedule, turnover snapshot, and plan-history lineage needed for deterministic replay and duplicate detection.
- **Upstream evaluation outputs**: U03 `EligibilityResult`, `SignalSnapshot`, `RegimeState`, corporate-action state, and production-quality lineage.
- **Downstream consumers**: U05 approval and execution binding, U07 service/API composition, and U08 preview/review surfaces.
- **Optional dependency**: `OptimizerPort`, initially satisfiable by in-process deterministic adapters only.

## Autopilot Resolution

Autopilot decisions `AD-N01` through `AD-N14` in `aidlc-docs/construction/plans/u04-construction-rebalancing-nfr-requirements-plan.md` are treated as the answered clarifications for this stage. No unresolved material NFR ambiguity remains.

## NFR Count

This artifact defines **100** unique U04 NFRs across nine subsystems: Capacity, Performance, Determinism, Reliability, Availability/Recovery, Security, Observability, Testing/PBT, and Maintainability.

## Capacity Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-CAP-001 | A `RebalancePlan` request shall reference exactly one canonical `PortfolioId`, one canonical `RebalanceRunId`, and one immutable planning context. | Boundary and invalid-scope examples. |
| NFR-U04-CAP-002 | One Node process shall support at least 100 sequential U04 plan evaluations for distinct portfolios without cross-portfolio contamination or retained mutable planner state. | 100-portfolio batch harness with equivalence and isolation assertions. |
| NFR-U04-CAP-003 | One portfolio input shall support up to 1,000 current holdings. | Boundary portfolio fixture. |
| NFR-U04-CAP-004 | One portfolio input shall support up to 10,000 open lots across its holdings. | Boundary lot-distribution fixture. |
| NFR-U04-CAP-005 | One planning pass shall support up to 1,000 candidate instruments carrying immutable U03 evaluation outputs. | Generated candidate-universe boundary fixture. |
| NFR-U04-CAP-006 | One ideal or executable target shall support up to 100 selected positions; any request exceeding that bound shall be rejected before allocation begins. | Valid/invalid construction-policy examples. |
| NFR-U04-CAP-007 | One approval-ready plan shall support up to 1,000 instrument action buckets and up to 250 proposed net orders. | Boundary action-ledger fixture and summary assertions. |
| NFR-U04-CAP-008 | One plan shall support exactly 1 through 4 active turnover windows chosen from the approved set `{rolling 30-day, calendar month, calendar quarter, calendar year}`. | Window-combination matrix tests. |
| NFR-U04-CAP-009 | One cost/tax evaluation pass shall support up to 800 participating sell-side lots across all proposed reductions. | Boundary lot-selection and tax-estimation fixture. |
| NFR-U04-CAP-010 | One bounded optimizer request shall include no more than 75 active decision instruments. | Optimizer-boundary validation tests. |
| NFR-U04-CAP-011 | One bounded optimizer request shall include no more than 250 hard constraints and no more than 4 active turnover windows. | Optimizer request-shape tests. |
| NFR-U04-CAP-012 | Collections above approved limits shall fail with stable bounded errors before candidate ranking, cost/tax estimation, or optimizer invocation begins. | Adversarial oversized-input examples. |
| NFR-U04-CAP-013 | Planner algorithms over holdings, lots, candidates, action buckets, and optimizer inputs shall remain linear or `O(n log n)` at the approved limits; no unbounded quadratic scan is allowed. | Complexity review and benchmark growth-curve evidence. |

## Performance and Resource Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-PERF-001 | Canonical `planInputHash` generation for the full supported boundary input (1 portfolio, 1,000 holdings, 10,000 lots, 1,000 candidates, 4 windows) shall complete below 40 ms p95. | Warm benchmark with fixed seed and isolated fixture generation. |
| NFR-U04-PERF-002 | Ideal target construction for 1,000 candidates selecting up to 100 positions shall complete below 250 ms p95. | Focused ideal-target benchmark. |
| NFR-U04-PERF-003 | Executable whole-share seed generation and initial reconciliation for up to 100 positions shall complete below 60 ms p95. | Focused executable-seed benchmark. |
| NFR-U04-PERF-004 | Deterministic greedy whole-share allocation for up to 100 positions shall complete below 300 ms p95. | Greedy-allocation benchmark with fixed residual-cash fixture. |
| NFR-U04-PERF-005 | Cost and tax estimation for up to 250 proposed orders spanning up to 800 lots shall complete below 200 ms p95. | Focused cost/tax benchmark. |
| NFR-U04-PERF-006 | Constraint verification plus reason attribution for up to 1,000 action buckets shall complete below 75 ms p95. | Constraint-verifier benchmark. |
| NFR-U04-PERF-007 | Approval-ready summary assembly and canonical `planHash` generation after a completed plan shall complete below 80 ms p95. | Plan-assembly benchmark. |
| NFR-U04-PERF-008 | Full approval-ready plan generation for the supported boundary workload shall complete below 1.8 seconds p95. | End-to-end planning benchmark excluding startup. |
| NFR-U04-PERF-009 | Equivalent-input replay comparison and duplicate-plan detection shall complete below 120 ms p95 for supported plan sizes. | Replay-equivalence benchmark. |
| NFR-U04-PERF-010 | A bounded optimizer port call on an eligible small problem shall either succeed or time out within a default 250 ms budget; the hard timeout cap shall not exceed 750 ms. | Injected-timeout benchmark and timeout-path tests. |
| NFR-U04-PERF-011 | Optimizer verification plus deterministic fallback after timeout, solver error, or verifier rejection shall complete below 400 ms p95 from failure detection. | Fallback benchmark with rejected optimizer outcomes. |
| NFR-U04-PERF-012 | Boundary full-plan generation shall add no more than 192 MiB incremental heap above the benchmark baseline. | Exposed-GC heap benchmark. |
| NFR-U04-PERF-013 | A bounded optimizer attempt plus deterministic fallback shall add no more than 64 MiB incremental heap above the greedy-only baseline. | Heap benchmark comparing greedy-only and optimizer-attempt runs. |
| NFR-U04-PERF-014 | All U04 benchmarks shall record Node version, OS, processor, warm-up, iterations, seed, p50, p95, maximum, input sizes, and heap delta, and shall fail CI when an approved threshold is exceeded. | Machine-readable benchmark report and non-zero exit on budget violation. |

## Determinism and Exact Arithmetic Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-DET-001 | U04 shall reuse U01 exact `Money`, `Quantity`, `Weight`, and `ScaledRate` contracts for all exact accounting, quantity, weight, turnover, and lot values. | Type and constructor inspection plus explicit examples. |
| NFR-U04-DET-002 | No U04 money, quantity, weight, turnover, or order-notional invariant may be stored or compared using floating-point approximations after conversion to exact units. | Source inspection and property tests. |
| NFR-U04-DET-003 | Canonical JSON for plan hashing shall sort object keys, omit `undefined`, encode every `bigint` as a base-10 string, and serialize as UTF-8 without extra whitespace. | Canonicalization property suite. |
| NFR-U04-DET-004 | `planInputHash` and `planHash` shall use lowercase hexadecimal SHA-256 produced by `node:crypto` and shall always be 64 characters long. | Hash-shape and determinism tests. |
| NFR-U04-DET-005 | U04 plan construction shall not read ambient time, randomness, environment variables, filesystem paths, network state, or global mutable state. | Architecture inspection and dependency scan. |
| NFR-U04-DET-006 | Session timing, eligible execution window, and `asOf` values shall arrive only as explicit validated inputs. | Input-boundary tests. |
| NFR-U04-DET-007 | Equivalent inputs, including permutation-equivalent holdings, lots, and candidates, shall produce equivalent ideal targets, executable targets, logical orders, reason bundles, `planInputHash`, and `planHash`. | Permutation and replay property tests. |
| NFR-U04-DET-008 | Canonical ordering shall be by `instrumentId` for positions and actions, by documented lot tie-break rules for lot selection, and by stable rule identifiers for reasons and constraint failures. | Ordering property suite. |
| NFR-U04-DET-009 | U04 shall consume U03 analytical scores, conviction multipliers, and regime bands as immutable upstream inputs and shall not recompute them with different math. | Source inspection and lineage assertions. |
| NFR-U04-DET-010 | Duplicate detection shall use semantic logical-order keys and plan-hash equivalence rather than creation time, random IDs, or incidental array order. | Equivalent-plan replay property. |

## Reliability and Fail-Closed Planning Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-REL-001 | Missing or stale mandatory lineage, schedule, or classification data shall reject plan creation or block the affected action; U04 shall not silently default these values. | Prerequisite fault matrix. |
| NFR-U04-REL-002 | No `APPROVAL_READY` output may contain unconstrained, partially verified, or partially explained orders. | Plan-structure invariant property. |
| NFR-U04-REL-003 | Every optimizer outcome shall be re-verified against cash, quantity, leverage, concentration, liquidity, turnover, and lifecycle rules before acceptance. | Verifier fault-injection tests. |
| NFR-U04-REL-004 | If the optimizer times out, errors, or fails verification, U04 shall deterministically fall back to the same greedy result that would have been produced without the optimizer attempt. | Greedy-vs-fallback oracle property. |
| NFR-U04-REL-005 | Portfolio scope is isolated end-to-end: holdings, lots, turnover, lineage, and action buckets from another portfolio invalidate the entire plan. | Cross-portfolio contamination tests. |
| NFR-U04-REL-006 | Routine planning shall never generate same-session routable output; the next eligible session shall always be explicit and later than the finalized decision session. | Timing invariant tests. |
| NFR-U04-REL-007 | Lifecycle transitions shall be limited to `DRAFT -> APPROVAL_READY` and `APPROVAL_READY -> SUPERSEDED | INVALIDATED | EXPIRED`; illegal transitions fail closed. | Stateful lifecycle model tests. |
| NFR-U04-REL-008 | Mandatory hard-risk, mandatory-eligibility, and verified corporate-action exits may override discretionary preferences but still may not exceed available delivery quantity or create leverage. | Critical example suite and invariant property. |
| NFR-U04-REL-009 | All expected failures shall return stable typed reason codes with no success-shaped fallback, hidden retry loop, or implicit best-effort trade basket. | Failure-surface tests. |
| NFR-U04-REL-010 | Sequential batch evaluation shall not retain mutable candidate rankings, lot choices, or turnover consumption between portfolios except through explicit input snapshots. | Batch-isolation property. |

## Availability, Dependency Isolation, and Recovery Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-AVAIL-001 | U04 has no independent deployment SLA; it inherits the approved local workload target of successfully serving at least 99% of configured evaluation and execution windows when the host, exchange, and broker are available. | Traceability review against approved project NFRs. |
| NFR-U04-AVAIL-002 | U04 inherits the approved hours-level RTO and one-hour RPO and shall not define contradictory unit-specific recovery targets. | Requirements traceability review. |
| NFR-U04-AVAIL-003 | Approval-ready plans, invalidations, and supersessions shall be reproducible by deterministic replay from U02 persisted state and U03 lineage inputs; no hidden planner state is permitted. | Deterministic recovery drill property. |
| NFR-U04-AVAIL-004 | U04 owns no backups, replication, regional topology, or failover mechanism, but it shall preserve the lineage required to rebuild the same plan after restore. | Recovery-metadata content inspection. |
| NFR-U04-AVAIL-005 | Cost/tax schedule resolution, turnover snapshot access, and optimizer port calls shall all use explicit bounded time budgets supplied by the application layer; unbounded waits are forbidden. | Timeout-configuration tests. |
| NFR-U04-AVAIL-006 | Failure of an optional optimizer enhancement shall degrade only to deterministic greedy planning; it shall not prevent a valid constrained plan when the greedy planner can succeed. | Fallback scenario tests. |
| NFR-U04-AVAIL-007 | Failure of any critical prerequisite such as finalized EOD data, effective cost/tax versions, turnover snapshots, or regime lineage shall fail closed and emit no approval-ready plan. | Critical-prerequisite fault matrix. |
| NFR-U04-AVAIL-008 | The approved deployment context remains a local workstation with no multi-zone or multi-region topology; U04 shall remain topology-neutral and shall not assume distributed recovery features. | Architecture review. |

## Security Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-SEC-001 | Planning requests, candidate inputs, turnover snapshots, schedule versions, and optimizer requests shall be schema-validated before any business processing begins. | Schema and constructor tests. |
| NFR-U04-SEC-002 | All strings, arrays, counts, and numeric fields shall enforce explicit bounded length and range constraints aligned to the approved capacity envelope. | Boundary and oversize-input tests. |
| NFR-U04-SEC-003 | `PortfolioId`, `InstrumentId`, `HoldingLotId`, `StrategyVersionId`, `DataVersionId`, and schedule-version references shall be validated as canonical identifiers before deeper use. | Invalid-identifier matrix. |
| NFR-U04-SEC-004 | U04 public entities, reason bundles, and explanations shall be structurally unable to contain broker credentials, session tokens, passwords, API keys, account numbers, or personal data. | Type-boundary inspection and fixture scan. |
| NFR-U04-SEC-005 | Human-readable explanations shall be generated only from stable allowlisted reason templates and safe redacted context; arbitrary upstream text is forbidden. | Explanation-rendering tests. |
| NFR-U04-SEC-006 | AI advisory input or output shall never authorize interim planning, alter target parameters, choose lots, or choose quantities. | Prohibited-AI-operation tests. |
| NFR-U04-SEC-007 | `planInputHash`, `planHash`, strategy lineage, data lineage, schedule versions, and turnover snapshot references shall become immutable once a plan reaches `APPROVAL_READY`. | Immutability and lifecycle tests. |
| NFR-U04-SEC-008 | Unknown enums, unsupported optimizer modes, unsupported turnover windows, or prototype-polluting or untrusted raw objects shall fail closed before plan construction. | Hostile-input matrix. |
| NFR-U04-SEC-009 | U04 shall accept only typed pre-validated inputs and shall not build SQL, shell commands, file paths, or network requests from plan data. | Architecture and forbidden-API inspection. |
| NFR-U04-SEC-010 | Misuse and abuse tests shall cover cross-portfolio contamination, oversized arrays, missing schedules, stale data, unsafe optimizer output, AI-only interim requests, and forged lot instructions. | Security test matrix. |
| NFR-U04-SEC-011 | User-facing and operator-facing failure outputs shall expose stable reason codes and safe redacted context only; no stack traces, filesystem paths, provider secrets, or raw exception messages may escape the outer boundary. | Error-shape tests. |
| NFR-U04-SEC-012 | U04 adds no new production runtime dependency in the MVP; any future external optimizer dependency shall be exact-version locked, vulnerability-scanned, SBOM-listed, and isolated behind `OptimizerPort` before use. | Manifest and supply-chain policy review. |

## Observability Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-OBS-001 | Every plan shall carry immutable `planInputHash`, `planHash`, `PortfolioId`, `RebalanceRunId`, strategy version lineage, data version lineage, cost/tax version IDs, and turnover snapshot IDs. | Plan-content property. |
| NFR-U04-OBS-002 | U04 shall expose per-phase durations for gate validation, ideal target construction, executable allocation, cost/tax estimation, constraint verification, optimizer attempt, and final assembly. | Timing-payload contract tests and benchmark evidence. |
| NFR-U04-OBS-003 | Optimizer telemetry shall include mode, request hash, timeout budget, duration, iteration count, verifier result, violated constraint IDs, and fallback reason when applicable. | Optimizer-outcome contract tests. |
| NFR-U04-OBS-004 | Constraint verification shall expose which constraint identifiers bound, skipped, or blocked each evaluated action. | Reason-bundle property. |
| NFR-U04-OBS-005 | Approval-ready summaries shall expose current versus target cash, exposure, per-name concentration, sector/group concentration, implementation shortfall, total estimated costs, and total estimated taxes. | Summary reconciliation tests. |
| NFR-U04-OBS-006 | Turnover metadata shall expose consumed and remaining budgets for each active window together with the formula inputs used to compute them. | Turnover-summary tests. |
| NFR-U04-OBS-007 | Action ledgers shall expose stable reason codes, urgency, mandatory-versus-discretionary classification, and counts by `proposed`, `skipped`, and `blocked` state. | Action-ledger property. |
| NFR-U04-OBS-008 | U04 shall not own log routing, trace exporters, dashboards, or alert definitions; it exposes typed immutable observability payloads only for outer layers to publish. | Architecture inspection. |

## Testing and Property-Based Verification Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-TEST-001 | Every acceptance criterion in US-015 through US-020 shall have at least one named example test or property. | Story-to-test coverage matrix. |
| NFR-U04-TEST-002 | All 117 U04 business rules across GAT, TGT, EXE, OPT, CTT, CAD, INT, PLN, and ABU shall map to one or more named tests or properties. | Rule-to-test coverage matrix. |
| NFR-U04-TEST-003 | Critical example tests shall pin exact outputs for the eight mandatory example scenarios and at least one scenario per autopilot decision that changes observable behavior. | Explicit example-suite inventory. |
| NFR-U04-TEST-004 | Test fixtures shall use fake identifiers, fake prices, fake costs, fake tax schedules, and fake lot graphs; they shall contain no real broker credentials or persisted user portfolio data. | Fixture scan and secret scan. |
| NFR-U04-TEST-005 | Test layout shall follow existing repository conventions: `*.test.ts`, `*.property.test.ts`, and `*.model.test.ts` beneath `tests/portfolio/` using `node:test`. | Test-layout inspection. |
| NFR-U04-TEST-006 | U04 shall use the already locked root `fast-check` dependency with Node's built-in test runner; no second PBT framework is introduced. | Manifest and import inspection. |
| NFR-U04-TEST-007 | Reusable domain arbitraries shall cover exact values, holdings, lots, portfolios, candidate instruments, ideal targets, executable targets, cost schedules, tax rule sets, turnover snapshots, optimizer requests, and lifecycle commands. | Generator inventory review. |
| NFR-U04-TEST-008 | Pure properties shall execute at least 1,000 generated cases in CI unless an approved higher-cost exception is explicitly documented. | `fast-check` `numRuns` configuration. |
| NFR-U04-TEST-009 | Stateful model properties shall execute at least 250 generated command sequences with lengths from 1 through 100. | `fast-check` commands configuration. |
| NFR-U04-TEST-010 | Expensive optimizer and oracle properties shall execute at least 100 generated small problems unless a documented and benchmark-justified lower bound is approved. | Suite configuration and benchmark rationale review. |
| NFR-U04-TEST-011 | Shrinking shall remain enabled, and every failing property shall report the seed, path, and minimal shrunk counterexample. | Failure-output format tests. |
| NFR-U04-TEST-012 | Round-trip and determinism properties shall cover canonical hashing, approval-ready serialization views, and equivalent-input replay semantics. | Property suite review. |
| NFR-U04-TEST-013 | Invariant properties shall cover no negative cash, no shorting, no leverage, no unavailable delivery quantity, concentration caps, cash-buffer preservation, exposure ranges, turnover ceilings, and lifecycle legality. | Invariant-property suite. |
| NFR-U04-TEST-014 | Oracle and model-based tests shall compare greedy allocation, optimizer acceptance or rejection, and plan lifecycle behavior against a reference small-problem oracle or simplified state model. | Oracle/model suite review. |
| NFR-U04-TEST-015 | Every production-relevant shrunk counterexample discovered by PBT shall become a permanent example-based regression test, and the focused U04 typecheck, tests, contract review, and benchmarks shall run before stage completion. | Regression-policy review and verification command plan. |

## Maintainability and Compatibility Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U04-MAINT-001 | U04 code shall remain under `server/portfolio/domain/construction/`, `server/portfolio/domain/rebalancing/`, `server/portfolio/application/rebalancing/`, and `server/portfolio/adapters/optimization/` without merging unrelated concerns. | Architecture graph and path review. |
| NFR-U04-MAINT-002 | Dependency direction shall be strictly acyclic: shared exact-value and identifier contracts -> domain planning modules -> application orchestration -> adapters. | Import-graph verification. |
| NFR-U04-MAINT-003 | U04 domain and application code shall not import `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`, `/trade-execution`, `/paper-trades`, Remix route handlers, or legacy intraday-policy modules. | Forbidden-import scan. |
| NFR-U04-MAINT-004 | U04 shall compile under the existing strict `server/portfolio/tsconfig.json` without weakening `strict`, `erasableSyntaxOnly`, `NodeNext`, `exactOptionalPropertyTypes`, or `noUncheckedIndexedAccess`. | TypeScript configuration review. |
| NFR-U04-MAINT-005 | Public U04 contracts, reason codes, optimizer-port interfaces, and benchmark limits shall be explicit exports with no wildcard barrel cycles or deep imports into internals. | Export-surface inspection. |
| NFR-U04-MAINT-006 | Public U04 declarations shall be reviewable through declaration-only contract output before merge; unexpected declaration drift blocks approval. | Declaration-diff process review. |
| NFR-U04-MAINT-007 | No new production runtime dependency is permitted for the U04 MVP; built-in Node APIs plus existing project dependencies are sufficient. | Manifest inspection. |
| NFR-U04-MAINT-008 | Future external solver integration shall remain optional, isolated behind `OptimizerPort`, and incapable of weakening deterministic verifier or fallback semantics. | Adapter-contract review. |
| NFR-U04-MAINT-009 | Source shall use named constants for financial scales, capacity ceilings, and latency thresholds; no unexplained magic numbers or hidden defaults are permitted. | Source-review checklist. |
| NFR-U04-MAINT-010 | No generated JavaScript, benchmark outputs, solver artifacts, or plan snapshot files may be committed; U04 remains source-first and contract-documented. | Artifact scan. |

## Explicit N/A Categories

- HTML security headers, public-API rate limiting, browser accessibility, and session-cookie policy are owned by outer delivery layers rather than U04's pure domain core.
- Cloud IAM, VPC rules, load balancers, CDN logging, multi-zone topology, and auto-scaling are not owned by U04 in the approved local-workstation deployment model.
- Backup automation, backup retention, restore orchestration, and disaster-recovery runbooks are owned by U02 and later operational stages.
- U04 exposes observability payloads but does not own centralized logging, alert routing, dashboards, or tracing infrastructure.

## Story Traceability

| Story | Primary NFR coverage |
|---|---|
| US-015 | `CAP-003` through `CAP-011`, `PERF-002` through `PERF-008`, `DET-001` through `DET-010`, `REL-001` through `REL-004`, `OBS-004` through `OBS-005`, `TEST-012` through `TEST-014` |
| US-016 | `CAP-008`, `REL-006` through `REL-010`, `AVAIL-001` through `AVAIL-008`, `OBS-006` through `OBS-007`, `TEST-001` through `TEST-015` |
| US-017 | `CAP-009`, `PERF-005`, `REL-001`, `REL-008`, `SEC-001` through `SEC-011`, `OBS-005` through `OBS-006`, `TEST-003`, `TEST-013`, `TEST-014` |
| US-018 | `PERF-007` through `PERF-009`, `DET-003` through `DET-010`, `REL-002`, `REL-007`, `OBS-001` through `OBS-008`, `TEST-003`, `TEST-012` |
| US-019 | `REL-001`, `REL-006`, `REL-008`, `AVAIL-007`, `SEC-005` through `SEC-010`, `TEST-003`, `TEST-013`, `TEST-014` |
| US-020 | `CAP-010` through `CAP-011`, `PERF-010` through `PERF-013`, `REL-003` through `REL-004`, `AVAIL-005` through `AVAIL-006`, `OBS-003`, `TEST-010`, `TEST-014` |

## Requirements Traceability

| Requirement | Primary NFR coverage |
|---|---|
| FR-011 Horizon Strategy Presets | `REL-006`, `AVAIL-001`, `OBS-006`, `TEST-013` |
| FR-050 Portfolio Construction and Optimization | `CAP-003` through `CAP-013`, `PERF-002` through `PERF-004`, `DET-001` through `DET-010`, `REL-003` through `REL-004` |
| FR-060 Rebalance Planning | `REL-001` through `REL-010`, `OBS-001` through `OBS-008`, `TEST-001` through `TEST-015` |
| FR-070 Cost and Tax | `CAP-009`, `PERF-005`, `SEC-001` through `SEC-011`, `OBS-005`, `TEST-003`, `TEST-013` |
| NFR-SEC Security | `SEC-001` through `SEC-012`, Security Baseline table |
| NFR-REL Reliability and Resiliency | `REL-001` through `REL-010`, `AVAIL-001` through `AVAIL-008`, Resiliency Baseline table |
| NFR-PERF Performance and Capacity | `CAP-001` through `CAP-013`, `PERF-001` through `PERF-014` |
| NFR-TEST Testing | `TEST-001` through `TEST-015`, Property-Based Testing table |
| NFR-MAINT Maintainability | `MAINT-001` through `MAINT-010`, `SEC-012` |

## Extension Compliance

### Security Baseline

| Rule | Status | Rationale | Supporting U04 requirement(s) |
|---|---|---|---|
| SECURITY-01 | N/A | U04 is pure planning/domain logic and owns no persistence store or transport; encryption remains an outer-layer concern. | Inherited from U02/U06 |
| SECURITY-02 | N/A | U04 defines no network-facing intermediary. | N/A |
| SECURITY-03 | N/A | U04 is not a deployed entry point; it exposes typed observability payloads for outer logging rather than owning a logging sink. | `OBS-001` through `OBS-008` |
| SECURITY-04 | N/A | U04 serves no HTML response. | N/A |
| SECURITY-05 | Compliant | Schema, bounds, identifier, and hostile-input validation are mandatory before any planning work. | `SEC-001` through `SEC-003`, `SEC-008`, `CAP-012` |
| SECURITY-06 | N/A | U04 defines no IAM policy or permission boundary. | N/A |
| SECURITY-07 | N/A | U04 defines no network configuration. | N/A |
| SECURITY-08 | N/A | Endpoint authentication and authorization belong to outer layers, though U04 still enforces portfolio scope as defense in depth. | `SEC-003`, `REL-005` |
| SECURITY-09 | N/A | U04 has no deployed runtime hardening surface, directory listing, or public object store. | N/A |
| SECURITY-10 | Compliant | U04 MVP adds no production dependency, and any future solver must be locked, scanned, SBOM-listed, and isolated behind a port. | `SEC-012`, `MAINT-007`, `MAINT-008` |
| SECURITY-11 | Compliant | Security-sensitive business logic is isolated, misuse cases are explicit, and AI or business-logic abuse is fail closed. | `REL-001` through `REL-004`, `SEC-005` through `SEC-010`, `TEST-010` |
| SECURITY-12 | N/A | U04 handles no passwords, sessions, MFA, or credential lifecycle. | N/A |
| SECURITY-13 | Compliant | Canonical hashes, immutable lineage, and logical-order-key determinism protect software and data integrity. | `DET-003` through `DET-010`, `SEC-007`, `OBS-001` |
| SECURITY-14 | N/A | Alerting and retention are outer operational concerns; U04 only emits typed security-relevant metadata. | `OBS-001` through `OBS-008` |
| SECURITY-15 | Compliant | Missing prerequisites, verifier disagreement, stale data, and unsafe optimizer output all fail closed with safe reason codes. | `REL-001` through `REL-009`, `AVAIL-007`, `SEC-011` |

No blocking U04 NFR-stage security finding remains.

### Resiliency Baseline

| Rule | Status | Rationale | Supporting U04 requirement(s) |
|---|---|---|---|
| RESILIENCY-01 | Compliant | U04 is documented as a financially critical High workload with explicit upstream and downstream dependencies. | Scope and Criticality, `AVAIL-001` |
| RESILIENCY-02 | Compliant by reference | U04 inherits the approved availability, RTO, and RPO targets and does not contradict them. | `AVAIL-001` through `AVAIL-004` |
| RESILIENCY-03 | N/A | Change management is already defined at project level and is not redefined in this pure-domain stage. | N/A |
| RESILIENCY-04 | N/A | U04 defines no deployment or rollback process. | N/A |
| RESILIENCY-05 | N/A | U04 is not a deployed workload and owns no log, metric, or trace routing, though it emits observability payloads for outer layers. | `OBS-001` through `OBS-008` |
| RESILIENCY-06 | N/A | U04 is not a service and exposes no health endpoint. | N/A |
| RESILIENCY-07 | N/A | U04 owns no deployed resiliency monitoring resource. | N/A |
| RESILIENCY-08 | N/A | Local-workstation topology and pure-domain scope mean no zone or region topology is owned here. | `AVAIL-008` |
| RESILIENCY-09 | N/A | U04 defines no auto-scaling runtime. | N/A |
| RESILIENCY-10 | Compliant | Optimizer and prerequisite dependencies are isolated through explicit timeouts, verification, and deterministic fallback or fail-closed behavior. | `PERF-010`, `PERF-011`, `AVAIL-005` through `AVAIL-007`, `REL-003`, `REL-004` |
| RESILIENCY-11 | N/A | Disaster-recovery strategy is tied to persistent state and operations, not U04's pure planning layer. | `AVAIL-002`, `AVAIL-004` |
| RESILIENCY-12 | N/A | Backups and replication are owned by persistence and operations layers. | `AVAIL-002`, `AVAIL-004` |
| RESILIENCY-13 | N/A | Failover and recovery runbooks are outside the NFR scope of a pure planning library, though deterministic replay inputs are preserved. | `AVAIL-003`, `AVAIL-004` |
| RESILIENCY-14 | N/A | Operational DR and chaos testing are executed later; this stage captures replayability and benchmarkable failure behavior only. | `TEST-010` through `TEST-015` |
| RESILIENCY-15 | N/A | Incident-response process is owned at project level rather than by the U04 domain library. | N/A |

No blocking U04 NFR-stage resiliency finding remains.

### Property-Based Testing (Full Enforcement)

| Rule | Status | Rationale | Supporting U04 requirement(s) |
|---|---|---|---|
| PBT-01 | Compliant by reference | Functional Design already identified U04 property families; this stage preserves them as measurable test obligations. | U04 Functional Design, `TEST-007` through `TEST-014` |
| PBT-02 | Compliant as requirement | Round-trip and replay properties are explicitly required. | `TEST-012` |
| PBT-03 | Compliant as requirement | Invariant properties for cash, leverage, turnover, and constraints are explicitly required. | `TEST-013` |
| PBT-04 | Compliant as requirement | Idempotent replay and duplicate-detection properties are explicitly required. | `DET-010`, `TEST-012`, `TEST-014` |
| PBT-05 | Compliant as requirement | Oracle comparisons for greedy versus optimizer behavior are mandatory. | `REL-004`, `TEST-010`, `TEST-014` |
| PBT-06 | Compliant as requirement | Stateful lifecycle and batch-isolation command models are mandatory. | `REL-007`, `REL-010`, `TEST-009`, `TEST-014` |
| PBT-07 | Compliant as requirement | Reusable constrained domain arbitraries are mandatory. | `TEST-007` |
| PBT-08 | Compliant as requirement | Shrinking, seed logging, and reproducibility are mandatory. | `TEST-011` |
| PBT-09 | Compliant | `fast-check` with Node's built-in test runner remains the selected framework. | `TEST-006`, `tech-stack-decisions.md` |
| PBT-10 | Compliant as requirement | Critical example tests remain mandatory alongside property tests, and shrunk failures become regressions. | `TEST-001` through `TEST-005`, `TEST-015` |

No blocking U04 NFR-stage property-based testing finding remains.
