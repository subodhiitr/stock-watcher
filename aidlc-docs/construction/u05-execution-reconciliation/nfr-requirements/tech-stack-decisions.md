# U05 Execution and Reconciliation Technology Stack Decisions

## Decision Summary

This document records **18** U05 stack decisions. The objective is the smallest brownfield-compatible stack that can satisfy the 134 U05 NFRs without weakening execution safety or adding speculative dependencies.

| Decision | Area | Selection |
|---|---|---|
| TSD-U05-01 | Runtime | Existing Node.js `>=24.3.0` local process |
| TSD-U05-02 | Language/module boundary | Strict erasable TypeScript in the existing NodeNext ESM `server/portfolio/` boundary |
| TSD-U05-03 | Exact values | Existing U01 `Money`, `Quantity`, `Weight`, `ScaledRate`, branded IDs, and time values |
| TSD-U05-04 | Canonical integrity | Deterministic canonical JSON and SHA-256 through `node:crypto` |
| TSD-U05-05 | Deadlines/timers | Injected clock plus built-in `AbortController`, `AbortSignal`, and timers |
| TSD-U05-06 | HTTP | Built-in `fetch` only for a future reviewed direct REST adapter where appropriate |
| TSD-U05-07 | Persistence | Existing U02 `PortfolioDatabaseOwner` and synchronous `PortfolioUnitOfWork` |
| TSD-U05-08 | SQLite | Existing lockfile-resolved `better-sqlite3` from the current caret dependency, only behind the U02 owner/adapter boundary |
| TSD-U05-09 | Schema evolution | New numbered U02 migration and versioned codecs; never edit migration 001 |
| TSD-U05-10 | Orchestration | Async application coordinator around short synchronous transactions and out-of-transaction broker calls |
| TSD-U05-11 | Broker abstraction | One normalized U05 `BrokerPort`; legacy clients are isolated implementation inputs, not contracts |
| TSD-U05-12 | Credentials | Opaque composition capability/health evidence; no credential field in U05 domain/application contracts |
| TSD-U05-13 | Resilience | Existing circuit-breaker primitives for safe reads plus explicit U05 certainty-aware placement logic |
| TSD-U05-14 | Non-live modes | In-process deterministic paper, dry-run, and test-fake adapters implementing the normalized port |
| TSD-U05-15 | Tests | Node built-in test runner, strict assertions, fake timers/clocks, temporary U02 databases |
| TSD-U05-16 | Property testing | Existing locked `fast-check` 4.8.0 with shared U01-U04 generators extended for U05 |
| TSD-U05-17 | Observability | Typed immutable U05 evidence/metric payloads consumed later by U06; no logging SDK in domain/application |
| TSD-U05-18 | Dependency policy | Zero new production or development dependencies for initial U05 implementation |

## Runtime and TypeScript Baseline

U05 remains inside the current Node process and `server/portfolio/` package boundary. The repository currently requires Node `>=24.3.0`, TypeScript 6.0.3, and these compiler constraints:

- `target: "ES2024"`;
- `module` and `moduleResolution`: `"NodeNext"`;
- `strict: true`;
- `verbatimModuleSyntax: true`;
- `erasableSyntaxOnly: true`;
- `isolatedModules: true`;
- `allowImportingTsExtensions: true`;
- `exactOptionalPropertyTypes: true`;
- `noUncheckedIndexedAccess: true`;
- `noImplicitOverride: true`;
- `noFallthroughCasesInSwitch: true`;
- `useUnknownInCatchVariables: true`;
- `noEmit: true` for normal checking.

U05 shall not introduce runtime enums, parameter properties, decorators requiring transformation, namespaces with runtime code, JSX, path-alias-only imports, or an emitted JavaScript runtime tree.

## Exact Values and Integrity

### U01 Exact Values

U05 reuses:

- `Money` as INR minor-unit `bigint`;
- `Quantity` as non-negative whole-share `bigint`;
- `Weight` and `ScaledRate` for exact policy values;
- branded portfolio, instrument, order, idempotency, actor, command, correlation, causation, event, evidence, strategy, and rebalance identifiers;
- canonical `Instant` and `LocalDate`.

Broker decimal strings must be parsed losslessly into exact units before domain use. Current legacy `Number` aggregates are display/legacy behavior only and are not U05 accounting authority.

### Canonical Hashes

Use `node:crypto.createHash("sha256")` over deterministic UTF-8 canonical JSON:

- object keys sorted lexicographically;
- `undefined` omitted;
- `bigint` encoded as base-10 string;
- non-finite numbers rejected;
- canonical collections sorted by documented identity/sequence;
- distinct domain separators for approval, order identity, intent, fill, reconciliation snapshot, difference, adjustment, and event.

U04 `planHash`, `planInputHash`, and `logicalOrderKey` are consumed and reverified rather than recomputed under a second incompatible format.

## Time, Deadlines, and Polling

### Built-In Facilities

Use injected clock/timer interfaces backed at composition by Node built-ins:

- `AbortController` and `AbortSignal.timeout()` where the underlying call supports cancellation;
- `node:timers/promises` or an equivalent injected timer for bounded waits;
- high-resolution timing through `process.hrtime.bigint()` for benchmarks/metrics.

The pure domain shall not call `Date.now()`, `new Date()`, `setTimeout`, `setInterval`, or randomness directly.

### Deadline Semantics

- Placement default/hard deadline: 8/15 seconds.
- Status, fills, cancel, account, holdings, cash default/hard deadline: 10/20 seconds.
- Coherent reconciliation collection default/hard deadline: 60/120 seconds.
- Poll interval default 5 seconds, configurable only from 2 through 15 seconds.
- A call may begin only if its entire deadline fits within the immutable U04 execution window.

If an SDK promise times out but cannot be proven cancelled before transport, the result is `UNKNOWN`, not `DEFINITELY_NOT_SENT`. A generic promise race does not establish that a broker did not receive a request.

## HTTP and Broker Transport

### Built-In Fetch

Node 24 built-in `fetch` is preferred only for a future direct broker REST adapter when:

1. the broker's official contract is reviewed;
2. TLS and endpoint allowlisting are enforced;
3. abort behavior and response certainty are testable;
4. request/response logging is redacted;
5. the adapter passes the common contract suite.

No `axios`, `node-fetch`, or additional transport package is introduced for U05.

### Existing SDKs

The current `kiteconnect` and `sharekhan-api` dependencies may be wrapped only behind U05 adapter contracts. They are not imported by domain/application code.

Until conformance proves exact normalization, deadline/cancellation behavior, `CNC` mapping, fill/status semantics, redaction, and response certainty, live adapter certification remains false.

## Persistence and Transaction Boundary

### Existing U02 Owner

U05 reuses the current `PortfolioDatabaseOwner`:

- one owner per database path;
- WAL for persistent databases;
- `synchronous = FULL`;
- foreign keys enabled;
- trusted schema disabled;
- 5-second SQLite busy timeout;
- encryption-attestation gate;
- health and verified backup primitives.

No U05 module opens `stock-watcher.db`, attaches another database, constructs a second `better-sqlite3` connection, or exposes SQL through a public contract.

### Synchronous Unit of Work

The current `PortfolioUnitOfWork.execute`:

- begins `BEGIN IMMEDIATE`;
- rejects nested transactions;
- rejects Promise-returning callbacks;
- commits portfolio mutation and event facts together;
- rolls back on typed failure, event mismatch, or exception;
- returns post-commit events after commit.

U05 shall add transaction-scoped approval, execution, fill, reconciliation, kill-switch, and accounting capabilities. The current portfolio mutation/event matching rule must be extended additively with explicit U05 write-to-event invariants; it must not be bypassed or weakened.

One unique fill is applied per transaction. Broker calls, polling, waits, and large snapshot comparison occur outside the transaction.

### Schema Evolution

Current migration 001 contains portfolio, allocation, strategy assignment, holdings/lots, domain-event, and dispatch structures but no U05 approval/order/fill/reconciliation tables.

A later approved Code Generation stage must add a numbered migration with:

- immutable ID/name/checksum;
- forward SQL and assertions;
- explicit guarded reversal or irreversible rationale;
- exact TEXT storage for money/quantity;
- unique approval-to-run, order-idempotency, broker-reference, fill-identity, fill-application, and kill-scope constraints;
- indexes for non-terminal order, reconciliation freshness, fill deduplication, and restart scans;
- version-aware U05 event codecs.

This NFR stage changes no database or migration.

## Application Orchestration

Use an async application coordinator with this boundary:

1. load/validate immutable local state;
2. execute a short U02 transaction to persist intent/attempt;
3. perform one broker call outside all transactions;
4. normalize certainty and exact values;
5. execute a short U02 outcome transaction;
6. schedule status/fill/reconciliation work through typed post-commit facts;
7. stop on ambiguity, kill switch, stale authority, or failed invariant.

No queue library, workflow engine, worker thread, or distributed transaction coordinator is needed initially. The existing local process and U06 scheduler/event-dispatch mechanisms are sufficient once implemented.

## Normalized Broker Port

The U05 port shall use bounded typed results for:

- capabilities and redacted health;
- account binding;
- holdings and available delivery;
- available non-margin cash;
- instrument mapping;
- placement;
- order status;
- fills;
- cancellation;
- open orders and coherent snapshot metadata.

Each result contains:

- normalized closed status/certainty;
- exact values;
- `asOf` and optional cursor;
- configured deadline and measured duration;
- safe retry classification;
- stable redacted failure code.

Raw SDK objects, exceptions, tokens, account IDs, payloads, and success-shaped empty values cannot cross the adapter.

## Legacy Adapter Fit and Hazards

### Sharekhan

Current `sharekhan-client.js`:

- defaults missing `productType` to `INTRADAY`;
- converts customer ID, scrip code, quantity, price, fills, cash, and holdings through JavaScript `Number`;
- maps unknown order status to arbitrary strings or empty status;
- treats cancellation HTTP status below 400 as success;
- performs authentication retry without U05 placement certainty;
- returns/logs raw response messages;
- reads symbol mappings from the legacy database;
- has no explicit placement/status/cancel deadline.

U05 must explicitly map reviewed Sharekhan delivery product semantics, use an immutable broker instrument snapshot, parse exact decimals, map every unknown value to `UNKNOWN`, and keep certification false until conformance passes. The default payload builder is never called without explicit safe normalized fields.

### Zerodha

Current `zerodha-kite-client.js`:

- constructs the SDK immediately with credential strings;
- retries after authentication renewal;
- returns order ID strings but does not persist U05 intent first;
- converts order quantity, fill quantity, average price, holdings, cash, margins, and P&L through `Number`;
- returns raw status/status message;
- returns boolean cancellation;
- has no explicit U05 call deadline or certainty classification.

U05 must use a narrow adapter, exact normalization, reviewed `CNC` mapping, unknown status preservation, redacted failures, and explicit deadline/certainty semantics. An implicit authentication retry around placement is prohibited unless the adapter can prove that the first attempt was not sent.

### Legacy Confirmation Poller and Routes

The legacy confirmation poller uses a 10-second interval and a 15-minute timeout, mutates in-memory trade records, and may infer cancellation/closure after timeout. Legacy `/trade-execution` and `/paper-trades` paths use random/time IDs, floating-point accounting, direct live clients, and mode fallback after repeated failures.

U05 shall not import or invoke these modules. Their behavior is compatibility-protected and remains separate.

## Credentials and Authority

U05 domain/application contracts contain no secret field. A later U07 composition boundary may obtain credentials through approved environment/OS-secret mechanisms and construct an adapter capability. U05 sees only:

- stable redacted account binding;
- broker kind;
- capability/certification status;
- credential availability/expiry health;
- opaque authorization/MFA evidence identifiers.

Legacy `.zerodha.properties` and `.sharekhan.properties` loaders are not imported by U05. No credential value enters an event, failure, metric, test, benchmark, or generated artifact.

## Resilience Mechanisms

The existing `server/portfolio/infrastructure/resilience/` circuit-breaker and redaction primitives may be reused where their contracts fit.

- Safe read calls may use bounded retry, injected backoff/jitter, independent circuit state, and in-flight limits.
- Placement uses U05's stricter four-way certainty model. A generic provider retry wrapper must not wrap placement.
- Cancellation acknowledgement or false return does not prove terminal state.
- Circuit-open or deadline failure blocks live work and emits a stable result.
- Paper/fake adapters have no network, credential, or live SDK capability.

## Paper, Dry-Run, and Fake Adapters

### Paper

The paper adapter:

- implements the same normalized broker port;
- uses injected deterministic fill policy, clock, and seed;
- exercises acknowledgement, open, partial, filled, rejected, expired, cancel-pending, cancelled, and unknown states;
- posts exact shadow cash/holdings/lots/fills through U02;
- cannot accept a live account or credential capability.

### Dry-Run

The dry-run adapter:

- validates and renders the exact normalized request;
- does not initialize a live SDK or perform network I/O;
- returns `DRY_RUN_RECORDED`, never acknowledgement/fill;
- creates no reservation or financial mutation.

### Test Fake

The fake:

- is constructible only from test composition;
- scripts deterministic certainty/status/fill/cancellation outcomes;
- exposes call counters and normalized request capture;
- rejects any credential, DNS, socket, non-loopback HTTP, or live SDK capability.

## Test and Benchmark Stack

Reuse:

- `node:test`;
- `node:assert/strict`;
- native Node 24 TypeScript execution;
- existing `fast-check` 4.8.0;
- generated temporary U02 databases and fake encryption attestations;
- custom Node benchmark scripts under the repository's existing convention.

Test files retain the established patterns:

- `*.test.ts` for examples, contract, integration, and regression tests;
- `*.property.test.ts` for pure properties;
- `*.model.test.ts` for stateful command models.

No test may load a credential file, initialize a live broker adapter, use non-loopback network I/O, mutate persistent data, or submit a real order.

Benchmarks use fixed/logged seeds, warm operations, exclude fixture generation, record p50/p95/maximum/heap/event-loop delay/environment, and exit non-zero on an approved threshold violation.

## Observability Boundary

U05 emits typed immutable payloads and events only. It does not add a logger, tracer, metrics SDK, dashboard client, or alert package.

Payloads include safe lineage, durations, counts, certainty, state, circuit/health, reconciliation difference classifications, and containment codes. U06 later owns routing, retention, dashboards, and alerts.

## Dependency Decision

U05 requires **zero new dependencies**.

Existing approved capabilities are sufficient:

- Node 24 runtime and built-in APIs;
- U01 exact domain contracts;
- U02 `better-sqlite3` owner boundary;
- U04 plan/action contracts;
- existing broker packages isolated behind adapters;
- existing resilience primitives;
- existing TypeScript, Node types, and `fast-check` development tooling.

No package or lockfile change is authorized by this stage.

## Rejected Alternatives

| Alternative | Reason rejected |
|---|---|
| New broker abstraction or workflow package | Existing ports and small explicit state machines are easier to audit; a package cannot supply broker certainty or financial invariants. |
| ORM/query builder/migration framework | U02 already owns prepared SQL, migrations, and transaction capabilities; a second persistence model would violate ownership. |
| Decimal/money package | U01 exact `bigint` values already satisfy accounting precision. |
| Axios/node-fetch for new U05 HTTP | Node 24 built-in `fetch` is sufficient where a reviewed direct REST adapter is appropriate. |
| Generic automatic retry around placement | Cannot prove `DEFINITELY_NOT_SENT` and could duplicate a real order. |
| Reusing the legacy confirmation poller | Its timeout and local-state inference conflict with U05 unknown/cancellation safety. |
| Reusing legacy trade routes or simulation state | They use intraday policy, floating-point state, direct live clients, and compatibility behavior outside portfolio U05. |
| Importing legacy credential loaders | They expose plaintext property-file values and are not a safe domain/application contract. |
| Worker thread, queue, or separate service | No benchmark evidence requires process isolation; it would add lifecycle and recovery complexity. |
| Embedded logging/tracing SDK | U05 should emit typed evidence; U06 owns operational sinks. |

## PBT-09 Compliance

- **Framework**: existing `fast-check` 4.8.0.
- **Language**: strict erasable TypeScript.
- **Runner**: Node built-in test runner.
- **Custom generators**: required for all linked U05 domains.
- **Shrinking**: enabled and relationship-preserving.
- **Seed replay**: mandatory in failure output and CI.
- **Dependency disposition**: already locked as a root development dependency; no installation or manifest change.

PBT-09 is satisfied at the U05 NFR Requirements decision level.

## Decision Traceability

| Plan decisions | Stack decisions |
|---|---|
| AD-U05-NFR-01 through AD-U05-NFR-03 | TSD-U05-01, TSD-U05-02, TSD-U05-10 |
| AD-U05-NFR-04 through AD-U05-NFR-06 | TSD-U05-05, TSD-U05-06, TSD-U05-11, TSD-U05-13 |
| AD-U05-NFR-07 through AD-U05-NFR-12 | TSD-U05-07 through TSD-U05-10, TSD-U05-13 |
| AD-U05-NFR-13 through AD-U05-NFR-15 | TSD-U05-03, TSD-U05-04, TSD-U05-07, TSD-U05-14 |
| AD-U05-NFR-16 through AD-U05-NFR-18 | TSD-U05-11, TSD-U05-12, TSD-U05-14, TSD-U05-17 |
| AD-U05-NFR-19 through AD-U05-NFR-22 | TSD-U05-05, TSD-U05-07 through TSD-U05-10, TSD-U05-15, TSD-U05-16, TSD-U05-18 |

## Extension Compliance Summary

- **Security**: Minimal dependency surface, no credential-bearing domain contracts, TLS requirement, redacted errors/evidence, separate authority, and fail-closed adapters satisfy applicable Security Baseline obligations. Cloud intermediary/IAM/network controls and browser headers are N/A to this unit.
- **Resiliency**: Explicit deadlines, certainty-aware retry, independent circuit/bulkhead behavior, deterministic recovery, local capacity bounds, and no success-shaped fallback satisfy applicable U05 obligations. DR operations remain U06; multi-zone/auto-scaling remain N/A.
- **Property-Based Testing - Full**: Existing `fast-check` supports custom linked generators, shrinking, seed replay, stateful commands, and Node test integration with no new package.
- **Blocking findings**: None.

## Stage Boundary

This document selects technologies only. It adds no runtime code, test, package, database, credential, network, or trade behavior. U05 NFR Design is next and remains unstarted.
