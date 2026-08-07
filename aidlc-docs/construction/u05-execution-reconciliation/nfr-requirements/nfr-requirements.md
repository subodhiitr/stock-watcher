# U05 Execution and Reconciliation NFR Requirements

## Scope and Criticality

U05 is a **Critical** in-process execution, reconciliation, fill-accounting, authority, and audit workload inside the existing local Node modular monolith. It consumes an immutable U04 `APPROVAL_READY` plan, U01 exact domain values, and U02 transaction capabilities. It produces approval, order, fill, cancellation, reconciliation, residual-work, kill-switch, and recovery facts without owning an HTTP listener, scheduler, backup process, or independent deployment SLA.

Live execution remains disabled by default. These requirements do not authorize a real broker call and do not alter the approved U05 Functional Design.

## Brownfield Baseline

- Node.js is `>=24.3.0`; `server/portfolio/` is a NodeNext ESM boundary using strict erasable TypeScript.
- U01 represents INR `Money` and whole-share `Quantity` with `bigint`, canonical base-10 codecs, branded identifiers, and typed failures.
- U02 owns `better-sqlite3`, one connection per database path, synchronous `BEGIN IMMEDIATE` transactions, atomic state/event persistence, WAL, `synchronous = FULL`, and a 5-second busy timeout. Promise-returning transaction callbacks are rejected.
- U04 supports 250 proposed orders, 1,000 holdings, 10,000 open lots, immutable `RebalancePlan` hashes, canonical action ordering, and a normal 09:45 through 11:30 Asia/Kolkata next-session execution window.
- Current U02 migration 001 has no U05 tables. Future U05 storage is additive through a numbered migration; migration 001 is immutable.
- Current Sharekhan code defaults missing order product to `INTRADAY`, converts financial values through `Number`, exposes raw messages, and has no U05 deadline/certainty contract.
- Current Zerodha code converts quantities/prices through `Number`, preserves raw broker messages, performs implicit authentication retry, and has no U05 intent-before-submit contract.
- The legacy poller uses a 10-second interval and 15-minute timeout, while legacy trade routes can invoke live placement and infer local terminal states. U05 must not import or reuse those execution paths.
- Legacy credential modules read and write plaintext home-directory property files. U05 domain/application code must not import them or expose their values.

## Conservative Decisions

The 22 decisions `AD-U05-NFR-01` through `AD-U05-NFR-22` in the stage plan are approved conservative resolutions for workload class, capacity, windows, deadlines, polling, ambiguity, restart, modes, security, resources, and testing. They are normative for this artifact.

## NFR Count

This artifact defines **134** unique requirements across 12 categories: Capacity, Performance, Determinism, Availability, Reliability, Execution/Reconciliation Safety, Security, Observability/Audit, Resource Use, Maintainability/Contracts, Testing, and Property-Based Testing.

## Capacity Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-CAP-001 | Every approval, execution, order, fill, reconciliation, adjustment, and kill-switch command shall reference exactly one canonical `PortfolioId`; cross-portfolio input shall reject the complete operation before mutation or external I/O. | Scope-boundary and cross-portfolio contamination tests. |
| NFR-U05-CAP-002 | One execution run shall support 0 through 250 approved logical orders, including buy-only, sell-only, and mixed baskets, without truncation or duplicate identity. | Boundary fixtures at 0, 1, 249, 250, and 251 orders. |
| NFR-U05-CAP-003 | Preflight and reconciliation shall support one portfolio containing up to 1,000 holdings and 10,000 open lots. | Generated boundary portfolio and lot-distribution fixtures. |
| NFR-U05-CAP-004 | One execution run and its recovery history shall support up to 10,000 unique normalized fills across its orders while preserving exact duplicate detection and immutable ordering. | 10,000-fill persistence/recovery fixture. |
| NFR-U05-CAP-005 | One reconciliation comparison shall support up to 1,000 holdings, 250 broker-relevant open or recent orders, and 10,000 normalized fills. Inputs above any bound shall become `BLOCKED`, not partially compared. | Reconciliation boundary and oversize matrix. |
| NFR-U05-CAP-006 | One sell fill may apply the approved U04 disposition across up to 800 participating lots; a larger disposition shall block before a financial transaction begins. | 800/801-lot fill-accounting examples. |
| NFR-U05-CAP-007 | One process shall execute or recover at least 100 portfolios sequentially without retaining mutable approval, order, broker, timer, or reconciliation state between portfolios. | 100-portfolio isolation harness. |
| NFR-U05-CAP-008 | Each logical order shall retain at most three placement attempts and a bounded immutable history of status, cancellation, and fill facts; unbounded raw broker history shall not be retained. | Aggregate-size and attempt-bound properties. |
| NFR-U05-CAP-009 | Every collection, string, identifier, broker response, and evidence payload shall be length/count checked against named bounds before hashing, sorting, allocation, SQL work, or broker invocation. | Adversarial oversized-input tests. |
| NFR-U05-CAP-010 | Algorithms over orders, holdings, lots, fills, differences, and evidence shall be linear or `O(n log n)` at supported limits; no unbounded quadratic scan is permitted. | Complexity review and measured growth curves. |

## Configured-Window Performance and Latency Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-PERF-001 | Approval binding, hash verification, and static risk validation for 250 proposed orders and a 10,000-lot portfolio shall complete below 500 ms p95, excluding database and external I/O. | Warm approval benchmark with fixed fixture generation outside measurement. |
| NFR-U05-PERF-002 | Canonical conversion of 250 approved U04 proposed actions into ordered U05 order shells shall complete below 250 ms p95. | Plan-conversion benchmark. |
| NFR-U05-PERF-003 | Deriving and checking all idempotency and canonical intent hashes for a 250-order basket shall complete below 100 ms p95. | Hash/equivalence benchmark. |
| NFR-U05-PERF-004 | One pure approval, execution, order, cancellation, reconciliation, or kill-switch transition decision shall complete below 10 ms p95. | Per-state-machine warm benchmarks. |
| NFR-U05-PERF-005 | One U02-backed intent, attempt, outcome, cancellation, or non-financial state transition transaction shall commit below 75 ms p95 at representative database size. | 500-run temporary-database benchmark. |
| NFR-U05-PERF-006 | One representative unique fill with ordinary lot disposition shall commit fill, order progress, reservation, accounting, and evidence below 100 ms p95. | Representative fill transaction benchmark. |
| NFR-U05-PERF-007 | One worst-case fill applying an approved disposition across 800 lots shall commit below 250 ms p95. | 800-lot transaction benchmark. |
| NFR-U05-PERF-008 | In-memory comparison of 1,000 holdings, 250 orders, and 10,000 fills shall complete below 1.5 seconds p95, excluding broker collection and persistence. | Reconciliation comparator benchmark. |
| NFR-U05-PERF-009 | Local normalization, comparison, difference assembly, and immutable result persistence for one boundary reconciliation shall complete below 2.5 seconds p95, excluding broker I/O. | End-to-end local reconciliation benchmark. |
| NFR-U05-PERF-010 | Deterministic recovery replay and deduplication of 10,000 persisted fills shall complete below 120 seconds p95 and shall expose progress at least every 500 examined fills. | Restart/replay benchmark with progress assertions. |
| NFR-U05-PERF-011 | Placement calls shall use an 8-second default deadline and a configurable hard cap of 15 seconds. Deadline expiry shall produce `UNKNOWN` unless the adapter proves `DEFINITELY_NOT_SENT`. | Fake-clock adapter deadline tests. |
| NFR-U05-PERF-012 | Status, fill, cancellation, account, holdings, and cash calls shall use a 10-second default deadline and a configurable hard cap of 20 seconds. | Per-port deadline matrix. |
| NFR-U05-PERF-013 | One coherent reconciliation collection shall use a 60-second default total deadline and a 120-second hard cap, including all endpoint calls and safe read retries. | Slow/failing broker collection tests. |
| NFR-U05-PERF-014 | No broker call may start unless its full configured deadline ends before the immutable execution-window end; local pre-submit work for a 250-order basket shall not delay the first eligible placement by more than 5 seconds p95 after prerequisites are available. | Injected-clock configured-window tests and basket orchestration benchmark. |
| NFR-U05-PERF-015 | The first status/fill check shall begin within 2 seconds after acknowledgement, cancellation response, or ambiguous placement return; later polling shall follow the configured bounded interval. | Fake-clock acknowledgement, cancellation, and ambiguity timing matrix. |

## Determinism and Exactness Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-DET-001 | All money, price, notional, charge, cash, quantity, weight, turnover, and lot calculations shall reuse U01 `Money`, `Quantity`, `Weight`, and `ScaledRate`; binary floating point shall not be accounting authority. | Type/import inspection and exact arithmetic properties. |
| NFR-U05-DET-002 | Canonical JSON shall sort object keys, omit `undefined`, encode `bigint` as base-10 strings, and serialize finite values as UTF-8 without incidental whitespace. | Canonicalization round-trip and hostile-value tests. |
| NFR-U05-DET-003 | Approval, order, intent, fill, snapshot, difference, adjustment, and event hashes shall use lowercase 64-character SHA-256 with distinct domain separators through `node:crypto`. | Hash-shape and cross-domain collision-separation tests. |
| NFR-U05-DET-004 | Domain and application decisions shall not read ambient clock, randomness, environment, filesystem, SDK state, network state, or mutable globals; clocks, IDs, deadlines, policy, and broker facts shall be injected. | Forbidden-API scan and deterministic replay tests. |
| NFR-U05-DET-005 | Equivalent approved actions shall always yield sells before buys, then ascending canonical `InstrumentId`, immutable sequence numbers, and equivalent order/idempotency identities regardless of input permutation. | Permutation-equivalence property. |
| NFR-U05-DET-006 | Equivalent command and persisted state shall produce structurally equivalent transition, failure, evidence, and retry-eligibility results. | Duplicate-run determinism property. |
| NFR-U05-DET-007 | Reconciliation shall canonicalize holdings, orders, fills, and differences before comparison; input ordering shall not change result state or difference identities. | Comparator commutativity property. |
| NFR-U05-DET-008 | Fill identity shall prefer broker fill/trade ID; the fallback fingerprint shall deterministically bind account, order, instrument, side, exact quantity, exact price, and trade time. | Identity stability/conflict property. |
| NFR-U05-DET-009 | Poll schedules, safe-read retry delays, and circuit cooldown decisions shall derive from injected policy and clock; generated jitter shall be bounded and seed-replayable in tests. | Fake-clock schedule and seed-replay properties. |
| NFR-U05-DET-010 | Paper fills shall be reproducible from the same approved inputs, fill-policy snapshot, and seed; dry-run rendering shall be byte-equivalent for equivalent normalized requests. | Paper oracle and dry-run rendering properties. |

## Availability, Dependency, and Recovery Target Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-AVAIL-001 | U05 shall support successful service in at least 99% of configured execution/reconciliation windows when host, exchange, broker, required data, and U02 persistence are available. | U06/U09 window-outcome aggregation contract. |
| NFR-U05-AVAIL-002 | U05 persistent facts shall inherit the approved hours-level RTO and one-hour RPO; U05 shall define no contradictory target. | Project NFR traceability review. |
| NFR-U05-AVAIL-003 | U05 shall remain topology-neutral within the approved local workstation deployment and shall not require multi-zone, multi-region, or auto-scaling infrastructure. | Architecture/import review. |
| NFR-U05-AVAIL-004 | Broker/account/quote readiness shall distinguish healthy, degraded, circuit-open, unavailable, and unknown states without exposing credentials; only a healthy certified state permits placement. | Readiness-state matrix. |
| NFR-U05-AVAIL-005 | Each broker and quote dependency shall have independent deadline, circuit, and in-flight limits so one failure cannot exhaust all timers, sockets, or portfolio work. | Bulkhead/circuit state-model tests. |
| NFR-U05-AVAIL-006 | Failure of a live broker or quote dependency shall fail the live command explicitly; it shall not report paper/dry-run success or switch mode inside the same command. | Live-failure fallback tests. |
| NFR-U05-AVAIL-007 | Paper execution may remain available when live dependencies are absent only through an explicitly issued paper command and isolated paper composition with no live capability. | Composition and degraded-mode tests. |
| NFR-U05-AVAIL-008 | Recovery shall depend only on versioned persisted facts, immutable U04/U05 lineage, injected clocks/policies, and current broker evidence; hidden in-memory state shall not be required. | Cold-process recovery property. |

## Reliability, Ambiguity, Retry, and Recovery Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-REL-001 | Every expected failure shall return one stable typed code, retryability classification, and bounded safe context without partial success or mutation. | Failure-shape matrix. |
| NFR-U05-REL-002 | Approval/order state, portfolio accounting, reservation, immutable evidence, and dispatch intent required by one transition shall commit or roll back atomically through U02. | Failure injection at every persistence step. |
| NFR-U05-REL-003 | Canonical intent and a submission-attempt marker shall commit before any placement call; no transaction shall contain a broker call, Promise, timer, or network wait. | Call-order spy and transaction capability tests. |
| NFR-U05-REL-004 | Placement shall have at most three attempts total and shall retry only a proved `DEFINITELY_NOT_SENT` outcome with unchanged identity and fully revalidated gates. | Generated certainty/retry matrix. |
| NFR-U05-REL-005 | Timeout, disconnect, malformed acknowledgement, missing broker ID, process crash, SDK uncertainty, or an expired call whose transport may continue shall become `UNKNOWN`. | Adapter fault-injection matrix. |
| NFR-U05-REL-006 | `UNKNOWN` shall block duplicate placement, approval reuse, dependent buys, completion, and automatic retry for any duration until reconciliation proves a state. | Stateful unknown-outcome model. |
| NFR-U05-REL-007 | Equivalent replay of approval, execute, placement, fill, cancellation, reconciliation adjustment, kill-switch, and recovery commands shall return existing state without duplicate external or accounting effect; conflicting replay shall fail and audit. | Idempotency property family. |
| NFR-U05-REL-008 | Approval, execution, order, reconciliation, cancellation, and kill-switch transitions shall follow closed documented graphs; terminal states shall never reopen for placement. | Stateful transition models. |
| NFR-U05-REL-009 | Filled quantity and applied accounting quantity shall be monotone and at most approved quantity; equivalent duplicate fills are no-ops and conflicting duplicates are integrity failures. | Fill-stream model and overfill/regression tests. |
| NFR-U05-REL-010 | Cancellation response shall not prove cancellation. Status/fill processing shall continue, race fills shall apply once, and terminal cancellation shall require reconciled zero open quantity. | Cancellation-race command model. |
| NFR-U05-REL-011 | Post-commit publication shall occur only after U02 commit and shall be idempotent; publication failure shall not roll back committed financial facts or create a second fact. | Event-dispatch failure tests. |
| NFR-U05-REL-012 | Portfolio, approval, order, reservation, and kill-switch optimistic version conflict shall roll back, return a state-refresh failure, and perform no broker call. | Concurrent-version conflict tests. |
| NFR-U05-REL-013 | Restart shall classify every local non-terminal order within 30 seconds, start required reconciliation within 60 seconds after dependencies become healthy, and converge every broker-provable outcome within two cycles or 5 minutes. | Boundary restart drill with fake broker. |
| NFR-U05-REL-014 | An externally unprovable outcome shall remain explicit `UNKNOWN` beyond the convergence target; elapsed time, including the legacy 15-minute threshold, shall never convert ambiguity into failed, cancelled, or safe-to-retry. | Long-running fake-clock ambiguity test. |

## Execution and Reconciliation Safety Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-SAFE-001 | Environment, application, portfolio, strategy, broker-account, broker-certification, approval, reconciliation, session, risk, and composition gates shall be independent, default false when absent, and all true immediately before each live placement. | One-missing-gate-at-a-time matrix. |
| NFR-U05-SAFE-002 | Approval hash, authority expiry, plan/strategy/portfolio lineage, approved key, price bound, execution window, and current state shall be revalidated before every placement. | Bound-field mutation matrix. |
| NFR-U05-SAFE-003 | Each dependent placement phase shall require a `MATCHED` or allowable `MATCHED_WITH_ROUNDING` reconciliation completed within 30 seconds and no unknown, foreign, mapping, or material difference. | Reconciliation freshness/gate tests. |
| NFR-U05-SAFE-004 | Every equity order shall be whole-share, cash-funded, long-only, `CNC`/delivery, price protected, and at or below approved quantity; margin, collateral, shorting, fractional quantity, and unbounded market orders shall be rejected. | Product/quantity/price risk matrix. |
| NFR-U05-SAFE-005 | Sell quantity shall not exceed reconciled available delivery after reservations; buy affordability shall exclude estimated proceeds, unsettled funds, collateral, margin, and unconfirmed cash. | Exact delivery/cash properties. |
| NFR-U05-SAFE-006 | Sells shall precede buys. Buy intent shall be finalized exactly once from confirmed post-sell cash, and zero affordability shall create terminal `RESIDUAL` without intent, reservation, attempt, or broker call. | Sell-buy, buy-only, and zero-affordability examples. |
| NFR-U05-SAFE-007 | A unique fill shall update order progress, exact cash, holding quantity, approved lot lineage, reservation, portfolio version, and immutable evidence in one transaction; holding quantity shall equal open-lot quantity afterward. | Exact ledger oracle and rollback tests. |
| NFR-U05-SAFE-008 | Reservations shall be non-negative, created before placement, reduced only by accepted fill/accounting, and released only for broker-proved terminal unfilled quantity. | Reservation state model. |
| NFR-U05-SAFE-009 | Paper mode shall use the same approval, preflight, order, fill, cancellation, reconciliation, accounting, failure, and audit contracts as live mode, with only the broker transport/fill policy replaced. | Cross-mode contract suite. |
| NFR-U05-SAFE-010 | Dry-run shall perform exact request construction and all non-transport validation but shall create no broker acknowledgement, fill, reservation, financial mutation, or live success state. | Dry-run side-effect assertions. |
| NFR-U05-SAFE-011 | A live failure shall never fall back to paper or dry-run inside the same command; a different mode requires a new explicit command and identity. | Mode-transition misuse tests. |
| NFR-U05-SAFE-012 | Global/portfolio kill-switch activation shall block new intent and retry, request safe cancellation, permit status/fill/reconciliation, and never liquidate; reset shall never auto-resume. | Kill-switch state model. |
| NFR-U05-SAFE-013 | Quantity/order/fill identity tolerance shall be zero. Cash tolerance shall be zero except one INR minor unit with explicit broker rounding evidence. | Reconciliation tolerance matrix. |
| NFR-U05-SAFE-014 | External manual changes, partial/rejected/cancelled/expired work, and unresolved differences shall create immutable difference/residual facts requiring review or replan; snapshot replacement shall never overwrite accounting history. | External-change and residual-work tests. |
| NFR-U05-SAFE-015 | Account, holdings, cash, order, and fill snapshot endpoint times shall differ by at most 10 seconds unless one broker cursor proves a coherent snapshot; excess unproved skew shall block reconciliation comparison and placement. | Injected-timestamp skew boundary tests at 10 seconds, above 10 seconds, and coherent-cursor exemption. |

## Security, Credential, Redaction, and Authority Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-SEC-001 | Every command, identifier, enum, exact value, broker mapping, payload, response, count, and string shall be allowlisted and bounded before business work. | Schema/constructor and hostile-input tests. |
| NFR-U05-SEC-002 | Portfolio object scope and opaque authorization evidence shall be checked before deeper state disclosure or mutation; approval, adjustment, automation, cancellation, and reset authorities shall remain distinct. | Authorization-evidence and IDOR-style scope tests. |
| NFR-U05-SEC-003 | Credentials, tokens, secrets, raw account IDs, and SDK clients shall be structurally absent from U05 domain/application entities, failures, events, and public declarations. | Type/declaration scan and generated fixture scan. |
| NFR-U05-SEC-004 | Logs, evidence, failures, metrics, and outputs shall contain only allowlisted codes, hashes, counts, timings, and redacted stable bindings; raw broker payloads/errors, paths, SQL, and stack traces are forbidden. | Redaction property with injected sentinel secrets. |
| NFR-U05-SEC-005 | Every non-local broker/quote transport shall require TLS 1.2 or newer and certificate validation; an adapter unable to prove secure transport shall remain uncertified and disabled. | Adapter configuration/conformance review. |
| NFR-U05-SEC-006 | U05 shall not import legacy credential loaders or read/write home-directory property files. Credentials shall enter only a narrow future composition adapter and shall be represented to U05 as opaque capability/health evidence. | Forbidden-import and capability-boundary tests. |
| NFR-U05-SEC-007 | Live activation and kill-switch reset shall require current portfolio-bound privileged authorization and MFA evidence; missing, expired, mismatched, or replay-conflicting evidence shall fail closed. | Authority/MFA evidence matrix. |
| NFR-U05-SEC-008 | External-call exceptions, invariant errors, database errors, and unknown values shall fail closed, release timers/resources, roll back active transactions, and return generic stable failures. | Exception/resource-cleanup fault matrix. |
| NFR-U05-SEC-009 | Canonical hashes, optimistic versions, immutable intent/fill/snapshot facts, and append-only event linkage shall detect tampering before dependent execution. | Tamper/corruption tests. |
| NFR-U05-SEC-010 | AI output, arbitrary explanation text, portfolio mode, one environment flag, one credential, or one approval shall never grant execution authority or modify size, side, sequence, mapping, price protection, reconciliation, or kill state. | Business-logic abuse tests. |
| NFR-U05-SEC-011 | U05 shall add no production dependency. Any future broker, validation, or resilience dependency requires exact locking, trusted source, vulnerability scan, SBOM inclusion, and explicit architecture approval before use. | Manifest/lock/SBOM policy review. |
| NFR-U05-SEC-012 | Automated validation shall secret-scan U05 fixtures and prove no credential, live SDK placement capability, DNS/socket capability, non-loopback HTTP capability, or real broker call is reachable. | Architecture test, call counter, and secret scan. |

## Observability and Audit Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-OBS-001 | Every approval, rejection, intent, attempt, outcome, status, fill, cancellation, reconciliation, adjustment, residual, kill-switch, and recovery transition shall emit immutable portfolio-scoped evidence. | Event-family completeness matrix. |
| NFR-U05-OBS-002 | Evidence shall include schema version, event/aggregate identity, state version, actor, command, correlation, causation, timestamp, previous hash, new hash, and bounded canonical payload. | Event codec and chain properties. |
| NFR-U05-OBS-003 | U05 shall expose latency, error rate, throughput, and saturation measures for approval, placement, polling, fill accounting, cancellation, reconciliation, and recovery without embedding a logging SDK. | Typed observability contract review. |
| NFR-U05-OBS-004 | Each broker call measure shall include broker key, operation, attempt, configured deadline, duration, certainty, safe retryability, circuit state, and redacted result code. | Broker telemetry contract tests. |
| NFR-U05-OBS-005 | Order polling shall expose scheduled/actual interval, poll count, age, normalized status, filled/open quantity, and next eligibility; interval default shall be 5 seconds and remain within 2 through 15 seconds. | Fake-clock polling metric tests. |
| NFR-U05-OBS-006 | Reconciliation evidence shall expose trigger, local/external snapshot IDs and times, endpoint skew, counts, result state, difference kinds/severity, duration, and previous-run lineage. | Reconciliation payload property. |
| NFR-U05-OBS-007 | Unknown outcomes and cancellation races shall emit high-severity containment evidence within one accepted local transition, including affected dependent-work count but no raw broker content. | Ambiguity/cancel fault tests. |
| NFR-U05-OBS-008 | Live-gate denial, restricted-auto denial, kill activation/reset, credential unavailability, redaction rejection, and authority failure shall expose stable security event codes for U06 alert routing. | Security-event inventory test. |
| NFR-U05-OBS-009 | U06 shall be able to retain operational/security evidence for at least 90 days in append-only or tamper-evident storage; U05 shall supply immutable records and no delete/update capability. | Cross-unit contract traceability. |
| NFR-U05-OBS-010 | Observability failure before a required atomic evidence write shall roll back the financial transition; post-commit sink failure shall preserve committed facts and create idempotent dispatch work. | Pre/post-commit failure injection. |

## Resource-Use Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-RSC-001 | Boundary local reconciliation of 1,000 holdings, 250 orders, and 10,000 fills shall add no more than 256 MiB incremental heap above baseline. | Exposed-GC boundary benchmark. |
| NFR-U05-RSC-002 | Restart classification and 10,000-fill recovery replay shall add no more than 256 MiB incremental heap and shall not retain duplicate full snapshots after completion. | Recovery heap/liveness benchmark. |
| NFR-U05-RSC-003 | A U02 transaction shall contain only synchronous bounded database/domain work; no Promise, timer, network wait, broker SDK object, or unbounded reconciliation collection may escape into it. | Transaction-capability and source tests. |
| NFR-U05-RSC-004 | Financial fill application shall process one unique fill per bounded transaction; batches shall continue with a new optimistic state read after each commit. | Fill-batch transaction spy. |
| NFR-U05-RSC-005 | CPU work outside transactions shall expose progress at least every 500 fills and shall yield between bounded chunks when a chunk exceeds 50 ms, without changing canonical result order. | Event-loop delay and progress benchmark. |
| NFR-U05-RSC-006 | Per portfolio, at most one placement/cancellation mutation and four safe read calls may be in flight; limits shall be lower when broker policy requires it. | In-flight bulkhead test. |
| NFR-U05-RSC-007 | All timers, abort controllers, poll loops, subscriptions, and adapter resources shall be released on terminal state, kill switch, deadline, shutdown, or failure. | Handle-leak and fake-timer tests. |
| NFR-U05-RSC-008 | Benchmarks shall record Node version, OS, processor, fixture sizes, warm-up, iterations, seed, p50, p95, maximum, heap delta, event-loop delay, and external-I/O exclusion and shall fail when an approved threshold is exceeded. | Machine-readable benchmark report review. |

## Maintainability and Contract Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-MAINT-001 | U05 shall remain decomposed beneath `server/portfolio/domain/execution/`, `application/execution/`, broker adapters, and additive persistence adapters; approval, risk, accounting, broker normalization, and reconciliation shall not be merged into one module. | Architecture graph/path review. |
| NFR-U05-MAINT-002 | Dependency direction shall be acyclic: U01/U04 public types -> U05 domain -> U05 application/ports -> adapters/composition; domain/application shall not import concrete brokers, routes, React, or persistence internals. | Import graph. |
| NFR-U05-MAINT-003 | All U05 TypeScript shall retain `strict`, NodeNext, `erasableSyntaxOnly`, `isolatedModules`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `noImplicitOverride`; no strictness weakening is allowed. | `tsconfig` and typecheck review. |
| NFR-U05-MAINT-004 | Public identifiers, states, events, failures, broker-port results, policies, bounds, and deadlines shall be explicit exports and reviewable through declaration-only contract output. | Declaration diff. |
| NFR-U05-MAINT-005 | New failure codes, event variants, broker statuses, and codecs shall be additive and schema-versioned; unknown versions shall fail closed. | Compatibility/codec tests. |
| NFR-U05-MAINT-006 | Future U05 tables shall use a new numbered checksummed migration with explicit assertions; current migration 001 shall not be edited. | Migration registry and checksum review. |
| NFR-U05-MAINT-007 | All SQL and `better-sqlite3` access shall remain inside U02-owned adapters/owner capabilities; U05 domain/application shall expose no raw database, statement, or transaction object. | Forbidden-import/public-surface scan. |
| NFR-U05-MAINT-008 | U05 shall not import or call `/trade-execution`, `/paper-trades`, `server/routes/trade-execution.js`, `simulation_engine.js`, legacy confirmation pollers, legacy credential loaders, or intraday policy. | Architecture tests. |
| NFR-U05-MAINT-009 | Capacity, timing, polling, deadline, retry, freshness, and redaction limits shall use named validated policy constants; hidden or broker-client defaults are prohibited. | Constant/configuration inspection. |
| NFR-U05-MAINT-010 | No new runtime package, emitted JavaScript, broker capture, credential file, database/WAL/SHM file, benchmark output, or generated request/response snapshot shall be committed for U05. | Manifest and artifact scan. |

## Example, Integration, Contract, and Acceptance Testing Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-TEST-001 | Every acceptance criterion for US-021 through US-027 and supporting US-014, US-019, US-028, US-035, and US-038 shall map to at least one named example, property, model, contract, or acceptance test. | Story-to-test matrix. |
| NFR-U05-TEST-002 | All 124 Functional Design rules across BND, APR, CNV, GAT, IDM, ORD, FIL, REC, BRK, KIL, AUD, and ABU shall map to one or more named tests. | 124-row rule evidence matrix. |
| NFR-U05-TEST-003 | Critical examples shall include buy-only progression, sell-then-buy, zero affordability, stale approval, fresh-quote revalidation, duplicate/conflicting commands, partial fill, cancellation race, unknown placement, restart, external order, kill switch, Sharekhan `INTRADAY` rejection, and audit rollback. | Mandatory example inventory. |
| NFR-U05-TEST-004 | Test layers shall include pure unit, state-machine model, U02 temporary-database integration, broker contract, failure injection, paper/dry parity, capacity benchmark, and end-to-end acceptance tests. | Test plan/layout review. |
| NFR-U05-TEST-005 | Fixtures shall use fake identifiers, prices, accounts, credentials, broker payloads, and generated temporary databases; no persistent user database, credential file, cache, live SDK, or real account may be opened. | Harness architecture and path-policy tests. |
| NFR-U05-TEST-006 | The same broker contract suite shall run against paper, fake, dry-run, and fixture-only normalized Zerodha/Sharekhan adapters, with explicit documented differences for transport and fill policy only. | Parameterized adapter suite. |
| NFR-U05-TEST-007 | Tests shall omit each independent live gate one at a time and prove no placement; a separate architecture test shall prove automated composition cannot construct a live placement capability. | Gate matrix and dependency graph test. |
| NFR-U05-TEST-008 | Fault injection shall cover every external deadline, definitely-not-sent proof, timeout, disconnect, malformed acknowledgement, missing ID, rejection, process-crash boundary, status unknown, cancellation race, circuit-open state, and persistence failure. | Fault matrix coverage report. |
| NFR-U05-TEST-009 | Restart and capacity tests shall cover 250 orders, 10,000 lots, 10,000 fills, two reconciliation cycles, repeated recovery, and permanent ambiguity without duplicate placement or fill. | Boundary recovery suite and benchmark. |
| NFR-U05-TEST-010 | No automated test, property, model, benchmark, acceptance run, or agent validation may perform DNS, non-loopback network I/O, credential loading, live SDK placement, or a real trade; any reachable path is a blocking failure. | Network denial, fake call counters, forbidden-import scan, and secret scan. |

## Full Property-Based Testing Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U05-PBT-001 | U05 shall reuse the existing locked `fast-check` with Node's built-in test runner; no second PBT framework shall be added. | Manifest and import inspection. |
| NFR-U05-PBT-002 | Reusable constrained arbitraries shall cover exact values, branded IDs, U04 plans, approvals, order baskets, mappings, quotes, broker results, fill streams, snapshots, differences, policies, kill switches, and recovery commands. | Generator inventory. |
| NFR-U05-PBT-003 | Pure canonicalization, conversion, comparator, exact-accounting, and gate properties shall run at least 1,000 generated cases in CI. | `numRuns` configuration. |
| NFR-U05-PBT-004 | Approval, execution, order, cancellation, reconciliation, kill-switch, and recovery state models shall run at least 250 command sequences with lengths from 1 through 100. | `fc.commands` configuration. |
| NFR-U05-PBT-005 | Each normalized broker adapter contract shall execute at least 500 generated request/response cases, including unknown enum/status and malformed payload cases. | Adapter property configuration. |
| NFR-U05-PBT-006 | Expensive U02 transaction, fill-ledger oracle, restart, and recovery properties shall execute at least 100 generated scenarios unless an approved benchmark documents a lower bound. | Expensive-suite configuration and exception review. |
| NFR-U05-PBT-007 | Round-trip properties shall cover approval, intent, fill, reconciliation snapshot/difference, kill-switch, event, and broker normalized codecs without exact-value or authority-field loss. | Codec property suite. |
| NFR-U05-PBT-008 | Invariant properties shall cover scope, exact cash, no short/leverage, sell-before-buy, approved ceilings, fill monotonicity, reservation conservation, lot/holding equality, terminal states, and live-gate denial. | Invariant property suite. |
| NFR-U05-PBT-009 | Idempotency properties shall prove equivalent command/fill/reconciliation/recovery replay has one observable effect and conflicting reuse fails without mutation or external invocation. | Idempotency property suite. |
| NFR-U05-PBT-010 | Oracle/model tests shall compare paper execution, order state, fill ledger, reconciliation comparator, kill switch, and recovery against simplified exact reference models after every generated command. | Model/oracle suite. |
| NFR-U05-PBT-011 | Shrinking shall remain enabled; every failure shall report seed, path, and minimal linked counterexample while preserving valid portfolio/order/fill relationships. | Deliberate-failure output test. |
| NFR-U05-PBT-012 | PBT shall complement named critical examples; every production-relevant shrunk case shall become a permanent example regression and flaky failures shall be investigated rather than silently retried. | Regression and CI policy review. |

## Story Traceability

| Story | Primary NFR coverage |
|---|---|
| US-021 | `CAP-002` through `CAP-005`, `DET-010`, `SAFE-007` through `SAFE-010`, `TEST-003`, `PBT-008` through `PBT-010` |
| US-022 | `AVAIL-006` through `AVAIL-007`, `SAFE-001`, `SAFE-009` through `SAFE-011`, `SEC-012`, `TEST-007`, `TEST-010` |
| US-023 | `PERF-001`, `DET-002` through `DET-006`, `REL-007`, `SAFE-002`, `SEC-002`, `PBT-007` |
| US-024 | `PERF-003`, `REL-003` through `REL-007`, `OBS-004`, `PBT-009` |
| US-025 | `CAP-003` through `CAP-006`, `PERF-006` through `PERF-010`, `REL-005` through `REL-014`, `SAFE-003` through `SAFE-008` |
| US-026 | `PERF-011` through `PERF-013`, `AVAIL-004` through `AVAIL-006`, `SEC-003` through `SEC-006`, `TEST-006`, `PBT-005` |
| US-027 | `SAFE-001`, `SAFE-012`, `SEC-002`, `SEC-007`, `OBS-008`, `PBT-004` |
| US-014 | `SAFE-002` through `SAFE-003`, `SAFE-013` through `SAFE-014`, `REL-012`, `OBS-006` |
| US-019 | `SAFE-004` through `SAFE-006`, `SAFE-012`, `SEC-010`, `TEST-003` |
| US-028 | `DET-009`, `REL-007`, `REL-013` through `REL-014`, `RSC-007`, `TEST-009` |
| US-035 | `SEC-004`, `SEC-009`, `OBS-001` through `OBS-010`, `PBT-007` |
| US-038 | `DET-004`, `SEC-010`, `MAINT-008`, `TEST-010` |

All seven primary U05 stories and all five approved supporting stories are covered.

## Functional Rule Traceability

| Functional rules | Count | NFR coverage |
|---|---:|---|
| BND-001 through BND-010 | 10 | `CAP-001`, `DET-001`, `REL-002`, `REL-012`, `RSC-003` through `RSC-004`, `MAINT-005` through `MAINT-007` |
| APR-001 through APR-010 | 10 | `PERF-001`, `DET-002` through `DET-006`, `REL-007`, `SAFE-002`, `SEC-002`, `PBT-004`, `PBT-007` |
| CNV-001 through CNV-010 | 10 | `CAP-002`, `PERF-002` through `PERF-003`, `DET-005`, `SAFE-004` through `SAFE-006`, `PBT-003`, `PBT-008` |
| GAT-001 through GAT-010 | 10 | `AVAIL-004` through `AVAIL-007`, `SAFE-001` through `SAFE-005`, `SEC-007`, `TEST-007` |
| IDM-001 through IDM-010 | 10 | `PERF-003`, `REL-003` through `REL-007`, `OBS-004`, `PBT-009` |
| ORD-001 through ORD-010 | 10 | `PERF-004`, `PERF-011` through `PERF-015`, `REL-004` through `REL-010`, `OBS-005`, `PBT-004` |
| FIL-001 through FIL-012 | 12 | `CAP-004`, `CAP-006`, `PERF-006` through `PERF-007`, `DET-008`, `REL-009`, `SAFE-007` through `SAFE-008`, `PBT-006`, `PBT-008` through `PBT-010` |
| REC-001 through REC-012 | 12 | `CAP-003` through `CAP-005`, `PERF-008` through `PERF-010`, `DET-007`, `REL-013` through `REL-014`, `SAFE-003`, `SAFE-013` through `SAFE-015`, `OBS-006` |
| BRK-001 through BRK-010 | 10 | `PERF-011` through `PERF-013`, `AVAIL-004` through `AVAIL-007`, `SEC-003` through `SEC-006`, `TEST-006`, `TEST-010`, `PBT-005` |
| KIL-001 through KIL-010 | 10 | `REL-013` through `REL-014`, `SAFE-012`, `SEC-007`, `OBS-008`, `PBT-004`, `PBT-010` |
| AUD-001 through AUD-010 | 10 | `REL-002`, `REL-011`, `SEC-004`, `SEC-009`, `OBS-001` through `OBS-010`, `PBT-007` |
| ABU-001 through ABU-010 | 10 | `SAFE-001`, `SAFE-004` through `SAFE-012`, `SEC-010` through `SEC-012`, `MAINT-008`, `TEST-007`, `TEST-010` |
| **Total** | **124** | **Every approved rule range mapped** |

## Project Requirement Traceability

| Source requirement | U05 NFR coverage |
|---|---|
| FR-001, DR-001 through DR-003 | `CAP-001`, `DET-001`, `REL-002`, `SEC-009`, `MAINT-006` through `MAINT-007` |
| FR-011, FR-060, FR-070 | `PERF-014`, `SAFE-002`, `SAFE-004` through `SAFE-008` |
| FR-080 | `CAP-003` through `CAP-006`, `PERF-008` through `PERF-013`, `REL-005` through `REL-014`, `SAFE-003`, `SAFE-013` through `SAFE-014` |
| FR-090 | `DET-010`, `AVAIL-007`, `SAFE-009`, `TEST-006`, `PBT-010` |
| FR-100 | `CAP-002`, `DET-005`, `REL-003` through `REL-007`, `SAFE-001` through `SAFE-011` |
| FR-110 | `SAFE-001` through `SAFE-006`, `SAFE-012`, `SEC-002`, `SEC-007`, `OBS-008` |
| FR-120 | `DET-009`, `REL-013` through `REL-014`, `OBS-005`, `RSC-007` |
| FR-140, FR-150 | `SAFE-002` through `SAFE-003`, `SAFE-014`, `SEC-009` through `SEC-010` |
| FR-160, FR-180 | `REL-007`, `SEC-001` through `SEC-004`, `OBS-001` through `OBS-010` |
| NFR-SEC | `SEC-001` through `SEC-012` and Security Baseline table |
| NFR-REL | `AVAIL-001` through `AVAIL-008`, `REL-001` through `REL-014`, and Resiliency Baseline table |
| NFR-PERF | `CAP-001` through `CAP-010`, `PERF-001` through `PERF-015`, `RSC-001` through `RSC-008` |
| NFR-TEST | `TEST-001` through `TEST-010`, `PBT-001` through `PBT-012` |
| NFR-MAINT | `MAINT-001` through `MAINT-010` |
| AC-4 through AC-6, AC-10 through AC-14, AC-17, AC-19 | Story and functional-rule mappings above |

## Extension Compliance

### Security Baseline

| Rule | Status | U05 disposition |
|---|---|---|
| SECURITY-01 | Compliant, shared | U05 persists through U02's attested encrypted boundary and requires TLS 1.2+ for non-local broker transport; U06 owns backup controls. `SEC-005`, `MAINT-007`. |
| SECURITY-02 | N/A | No load balancer, API gateway, or CDN exists in the approved local topology. |
| SECURITY-03 | Compliant, shared | U05 emits typed structured redacted evidence; U06 owns the centralized sink. `SEC-004`, `OBS-001` through `OBS-010`. |
| SECURITY-04 | N/A to U05 | U05 serves no HTML; U07 owns headers. |
| SECURITY-05 | Compliant at U05 boundary | Every command and adapter value is bounded and validated. `CAP-009`, `SEC-001`. |
| SECURITY-06 | N/A | U05 defines no cloud IAM policy. |
| SECURITY-07 | N/A | U05 defines no cloud network resource. |
| SECURITY-08 | Compliant, shared | Portfolio-bound authority and object scope are mandatory; U07 authenticates endpoints. `SEC-002`, `SEC-007`. |
| SECURITY-09 | Compliant for applicable behavior | Live defaults false, errors are generic, and legacy unsafe defaults are not reused; deployment hardening remains U07/U09. `SAFE-001`, `SEC-008`. |
| SECURITY-10 | Compliant | No dependency is added and future additions require lock/scan/SBOM review. `SEC-011`, `MAINT-010`. |
| SECURITY-11 | Compliant | Authority, risk, broker, accounting, audit, and kill-switch concerns are isolated with defense in depth and misuse tests. `SAFE-001` through `SAFE-015`, `SEC-010`. |
| SECURITY-12 | Compliant, shared | U05 stores no credential and requires opaque MFA evidence for privileged live/reset actions; U07 owns authentication/session mechanics. `SEC-003`, `SEC-006`, `SEC-007`. |
| SECURITY-13 | Compliant | Canonical hashes, immutable facts, versions, and append-only evidence protect integrity. `DET-002`, `DET-003`, `SEC-009`, `OBS-002`. |
| SECURITY-14 | Compliant, shared | U05 emits alertable security/financial events; U06 owns routing, dashboards, and 90-day retention. `OBS-007` through `OBS-009`. |
| SECURITY-15 | Compliant | Every exceptional path is bounded, cleaned up, rolled back, and fail closed. `REL-001` through `REL-014`, `SEC-008`, `RSC-007`. |

Security blocking findings: none.

### Resiliency Baseline

| Rule | Status | U05 disposition |
|---|---|---|
| RESILIENCY-01 | Compliant | U05 is Critical and its U01/U02/U04, broker/quote, U06/U07, and test dependencies are explicit. |
| RESILIENCY-02 | Compliant by reference | `AVAIL-001` and `AVAIL-002` preserve approved 99%-window, hours-level RTO, and one-hour RPO targets. |
| RESILIENCY-03 | N/A to this unit stage | The approved lightweight project change process is not redefined by U05. |
| RESILIENCY-04 | N/A to this stage | U05 NFR Requirements defines no deployment or rollback resource; U06/U09 own approved direct/database-aware delivery. |
| RESILIENCY-05 | Compliant, shared | `OBS-003` through `OBS-010` supply metrics/log/event contracts; U06 owns sinks and dashboards. |
| RESILIENCY-06 | Compliant, shared | `AVAIL-004` defines dependency readiness; U06/U07 own process/deep health endpoints. |
| RESILIENCY-07 | Compliant, shared | `OBS-003` through `OBS-009` expose ambiguity, circuit, capacity, and recovery degradation signals. |
| RESILIENCY-08 | N/A | Multi-zone/multi-region is excluded by the approved local workstation topology. |
| RESILIENCY-09 | N/A | Cloud auto-scaling is excluded; `CAP`/`PERF`/`RSC` requirements provide local capacity gates. |
| RESILIENCY-10 | Compliant | Explicit deadlines, circuits, in-flight limits, safe retry certainty, and fail-closed degradation are mandatory. `PERF-011` through `PERF-013`, `AVAIL-004` through `AVAIL-007`, `REL-004` through `REL-006`. |
| RESILIENCY-11 | N/A to U05 ownership | Approved encrypted backup/restore DR is owned by U06; U05 supplies deterministic recovery facts. `AVAIL-002`, `AVAIL-008`. |
| RESILIENCY-12 | N/A to U05 ownership | U06 owns backup scheduling/retention; U05 data remains inside the U02 consistent boundary. |
| RESILIENCY-13 | Compliant, shared | U05 defines restart classification and broker convergence semantics; U06 owns operator runbooks/failback. `REL-013`, `REL-014`. |
| RESILIENCY-14 | N/A at U05 NFR Requirements | The approved unit map assigns the resiliency-testing approach decision to U06 NFR Design; U05 still defines fault/recovery test obligations. |
| RESILIENCY-15 | N/A to U05 ownership | U06 owns incident/COE process; U05 emits containment and evidence inputs. `OBS-007` through `OBS-009`. |

Resiliency blocking findings: none.

### Property-Based Testing - Full

| Rule | Status | U05 disposition |
|---|---|---|
| PBT-01 | Compliant by reference | Approved Functional Design identifies approval, conversion, order, fill, paper, reconciliation, kill-switch, recovery, audit, and adapter properties. |
| PBT-02 | Compliant as requirement | `PBT-007` mandates all applicable round trips. |
| PBT-03 | Compliant as requirement | `PBT-008` mandates financial, lifecycle, scope, and authority invariants. |
| PBT-04 | Compliant as requirement | `PBT-009` mandates idempotency for every claimed idempotent operation. |
| PBT-05 | Compliant as requirement | `PBT-010` mandates exact ledger, paper, comparator, and recovery models/oracles. |
| PBT-06 | Compliant as requirement | `PBT-004` and `PBT-010` mandate stateful models with counts and lengths. |
| PBT-07 | Compliant as requirement | `PBT-002` mandates reusable constrained linked-domain arbitraries. |
| PBT-08 | Compliant as requirement | `PBT-011` and `PBT-012` mandate shrinking, seed/path replay, CI execution, and regression capture. |
| PBT-09 | Compliant | Existing `fast-check` 4.8.0 with Node's test runner is retained in `tech-stack-decisions.md`. |
| PBT-10 | Compliant as requirement | `TEST-003`, `TEST-004`, and `PBT-012` retain named examples alongside PBT. |

PBT blocking findings: none.

## Explicit N/A and Ownership Boundaries

- HTML headers, browser accessibility, HTTP authentication/session handling, CORS, CSRF, and endpoint rate limits are owned by U07/U08.
- Scheduler leases, centralized logs/metrics/dashboards/alerts, backup scheduling/retention, restore runbooks, incident process, and correction-of-errors tracking are owned by U06.
- CI workflow, vulnerability scanning, SBOM generation, and final integrated capacity/recovery evidence are owned by U09.
- Multi-zone, multi-region, load-balancing, cloud IAM/network policy, and cloud auto-scaling are N/A for the approved local workstation topology.

## Completion Gate

U05 NFR Requirements are complete only when all 134 IDs are unique, all 12 stories and all 124 Functional Design rules are traced, the 22 conservative decisions are represented, all measurable thresholds have verification methods, all extension rows are compliant or justified N/A, and no test or validation path can reach a real broker.
