# U05 Execution and Reconciliation Logical Components

## Dependency Rule

Runtime dependencies flow inward:

1. composition and adapters depend on ports and application;
2. application coordinators depend on ports and domain;
3. ports depend only on public domain contracts;
4. domain aggregates and policies depend only on U01/U04 public exact contracts and U05 leaf values;
5. persistence adapters depend on U02 owner/transaction infrastructure and U05 persistence ports;
6. tests and benchmarks depend on public runtime contracts, but runtime code never imports them.

No domain or application component imports `better-sqlite3`, a broker SDK, credential loader, legacy trade route, test helper, or benchmark.

## Scope and Criticality

| Item | Classification |
|---|---|
| Workload | Critical local financial execution and reconciliation |
| Availability | At least 99% of configured windows when required host/dependencies are available |
| Recovery | Approved hours-level RTO and one-hour RPO; non-terminal classification starts immediately after restart |
| Business impact | Incorrect duplication, accounting, or reconciliation can create financial loss; ambiguity therefore blocks rather than guesses |
| Upstream | U01 exact portfolio domain, U02 persistence, U03 active strategy/policy evidence, U04 immutable plans |
| External | Broker account/order/fill APIs and fresh execution quotes through normalized ports only |
| Downstream | U06 scheduling/operations, U07 portfolio API/auth, U09 integrated build/release evidence |

## Component Inventory

| ID | Component | Layer | Responsibility | Direct dependencies | Proposed source |
|---|---|---|---|---|---|
| LC-U05-01 | Execution Shared Contracts | Domain leaf | Closed states, certainty, modes, stable failures, bounded constants, additive identifier brands | U01 public contracts | `server/portfolio/domain/execution/contracts.ts` |
| LC-U05-02 | Canonical Execution Codec | Domain leaf | Versioned canonical JSON, domain-separated hashes, exact broker decimal normalization | LC-01, U01 exact values, `node:crypto` | `server/portfolio/domain/execution/canonical-codec.ts` |
| LC-U05-03 | Approval Aggregate | Domain | Approval binding, subset rules, expiry/invalidation, consume-once lifecycle | LC-01, LC-02, U04 public plan contract | `server/portfolio/domain/execution/approval.ts` |
| LC-U05-04 | Execution Run Aggregate | Domain | Run lifecycle, canonical phase progression, terminal/residual state | LC-01, LC-03 | `server/portfolio/domain/execution/execution-run.ts` |
| LC-U05-05 | Execution Order Aggregate | Domain | Stable shell, one-time intent finalization, attempts, status, cancellation, monotone fill progress | LC-01, LC-02 | `server/portfolio/domain/execution/execution-order.ts` |
| LC-U05-06 | Fill and Reservation Model | Domain | Fill identity/deduplication, exact incremental accounting transition, cash/delivery reservations | LC-01, LC-02, U01 holdings/lots | `server/portfolio/domain/execution/fill-accounting.ts` |
| LC-U05-07 | Reconciliation Model | Domain | Canonical snapshots, coherence/skew validation, pure comparison, closed differences/results | LC-01, LC-02 | `server/portfolio/domain/execution/reconciliation.ts` |
| LC-U05-08 | Kill-Switch Aggregate | Domain | Global/portfolio activation, containment, privileged reset, immutable history | LC-01 | `server/portfolio/domain/execution/kill-switch.ts` |
| LC-U05-09 | Residual and Adjustment Model | Domain | Immutable residual work, external differences, separately authorized adjustment proposals | LC-01, LC-02, LC-07 | `server/portfolio/domain/execution/residual-and-adjustment.ts` |
| LC-U05-10 | Execution Gate and Risk Policy | Domain service | Scope, authority, quote, window, product, quantity, cash, delivery, and hard-risk projection | LC-01, LC-03, LC-05, U04 public contracts | `server/portfolio/domain/execution/execution-gate.ts` |
| LC-U05-11 | Execution Evidence Contracts | Domain leaf | Typed bounded redacted evidence, metrics, health, and recovery progress payloads | LC-01, U01 safe observability builder | `server/portfolio/domain/execution/evidence.ts` |
| LC-U05-12 | Normalized Broker Port | Port | Capabilities, health, account, holdings, cash, placement, status, fills, cancel, snapshot metadata | LC-01, LC-02, LC-05 through LC-07 | `server/portfolio/ports/execution/broker-port.ts` |
| LC-U05-13 | Execution Persistence Port | Port | Transaction-scoped approval/run/order/fill/reconciliation/kill repositories and atomic mutation capabilities | LC-03 through LC-09, LC-11 | `server/portfolio/ports/execution/execution-unit-of-work.ts` |
| LC-U05-14 | Plan and Portfolio State Ports | Port | Load U04 plan, U01 portfolio/accounting state, strategy/policy lineage, current reservations | LC-01, U01/U04 public contracts | `server/portfolio/ports/execution/execution-state-port.ts` |
| LC-U05-15 | Quote, Calendar, and Mapping Ports | Port | Fresh quote snapshots, exchange-session evidence, immutable broker instrument mapping | LC-01, LC-02 | `server/portfolio/ports/execution/market-execution-port.ts` |
| LC-U05-16 | Clock, Timer, and Identifier Ports | Port | Inject current time/date, bounded waits, monotonic measurement, and additive identifiers | LC-01, U01 clock/identifier contracts | `server/portfolio/ports/execution/runtime-port.ts` |
| LC-U05-17 | Approval Application Service | Application | Validate plan/state, apply gate/risk policy, create idempotent approval/rejection transaction | LC-03, LC-10, LC-13 through LC-16 | `server/portfolio/application/execution/approval-service.ts` |
| LC-U05-18 | Plan Conversion and Run Service | Application | Canonically convert approved U04 actions to shells and atomically consume approval/create run | LC-03 through LC-05, LC-10, LC-13 through LC-16 | `server/portfolio/application/execution/execution-run-service.ts` |
| LC-U05-19 | Execution Phase Coordinator | Application | Orchestrate sell, reconciliation, buy, cancel, and terminal phases without hidden mutable state | LC-04, LC-05, LC-10, LC-13 through LC-16, LC-20 through LC-24 | `server/portfolio/application/execution/execution-coordinator.ts` |
| LC-U05-20 | Placement Coordinator | Application | Finalize intent, reserve, persist attempt, call broker outside transaction, normalize/commit certainty | LC-05, LC-10, LC-12 through LC-16 | `server/portfolio/application/execution/placement-coordinator.ts` |
| LC-U05-21 | Status and Fill Coordinator | Application | Start first check, poll status/fills, deduplicate, apply one fill transaction, schedule reconciliation | LC-05, LC-06, LC-12, LC-13, LC-16 | `server/portfolio/application/execution/status-fill-coordinator.ts` |
| LC-U05-22 | Cancellation Coordinator | Application | Persist cancel intent, call adapter, retain cancel-pending, resolve fills/status/reconciliation races | LC-05, LC-06, LC-07, LC-12, LC-13, LC-16 | `server/portfolio/application/execution/cancellation-coordinator.ts` |
| LC-U05-23 | Reconciliation Service | Application | Collect bounded coherent snapshot, compare purely, persist immutable result/differences, gate phases | LC-07, LC-09, LC-12 through LC-16 | `server/portfolio/application/execution/reconciliation-service.ts` |
| LC-U05-24 | Recovery Service | Application | Scan persisted non-terminal work, classify ambiguity, query references, apply fills once, converge safely | LC-04 through LC-09, LC-12 through LC-16, LC-21, LC-23 | `server/portfolio/application/execution/recovery-service.ts` |
| LC-U05-25 | Kill-Switch Service | Application | Activate containment, request safe cancellation, validate reset, never auto-resume or liquidate | LC-08, LC-10, LC-13 through LC-16, LC-22, LC-23 | `server/portfolio/application/execution/kill-switch-service.ts` |
| LC-U05-26 | U05 SQLite Persistence Adapter | Adapter | Numbered migration, prepared statements, codecs, repositories, event/write matching, recovery indexes | LC-13, U02 database owner/unit of work | `server/portfolio/adapters/persistence/execution/` |
| LC-U05-27 | Deterministic Paper Broker Adapter | Adapter | Normalized in-process states/fills and shadow account evidence using injected policy/clock/seed | LC-12, LC-16 | `server/portfolio/adapters/broker/paper-broker-adapter.ts` |
| LC-U05-28 | Dry-Run Broker Adapter | Adapter | Exact normalized request rendering with no acknowledgement, reservation, fill, or financial effect | LC-12 | `server/portfolio/adapters/broker/dry-run-broker-adapter.ts` |
| LC-U05-29 | Scripted Test Broker Adapter | Test adapter | Deterministic certainty/status/fill/cancel/deadline scripts, counters, request capture, network prohibition | LC-12, LC-16 | `tests/portfolio/execution/support/scripted-broker.ts` |
| LC-U05-30 | Zerodha Broker Adapter | Adapter | Reviewed CNC mapping, exact normalization, closed statuses/certainty, redaction; uncertified by default | LC-12, LC-32, legacy SDK only inside adapter | `server/portfolio/adapters/broker/zerodha-broker-adapter.ts` |
| LC-U05-31 | Sharekhan Broker Adapter | Adapter | Explicit delivery mapping overriding unsafe intraday default, exact normalization; uncertified by default | LC-12, LC-32, legacy SDK only inside adapter | `server/portfolio/adapters/broker/sharekhan-broker-adapter.ts` |
| LC-U05-32 | Broker Resilience Governor | Infrastructure | Per-dependency deadlines, circuits, in-flight limits, safe-read retry, placement certainty preservation | LC-12, LC-16, existing resilience primitives where compatible | `server/portfolio/infrastructure/execution/broker-resilience-governor.ts` |
| LC-U05-33 | Execution Composition and Capability Factory | Composition | Select mode from trusted config, construct non-live/live capability, enforce certification/default-disabled live | LC-12, LC-17 through LC-25, LC-27 through LC-32 | `server/portfolio/execution-composition.ts` |
| LC-U05-34 | U05 Public Entry Point | Public contract | Explicitly export approved U05 domain, port, service, and composition contracts with no import side effect | LC-01 through LC-25, selected LC-27/28/33 contracts | `server/portfolio/execution-index.ts` |
| LC-U05-35 | Execution Verification Architecture | Test | Linked generators, state models, oracles, contract suites, fault injection, seed/path replay, architecture checks | Public LC-01 through LC-34 contracts, `fast-check`, `node:test` | `tests/portfolio/execution/` |
| LC-U05-36 | Execution Benchmark Harness | Benchmark | Capacity fixtures and p50/p95/max/heap/event-loop/growth threshold checks | Public LC-01 through LC-34 contracts, Node built-ins | `benchmark/portfolio-execution.ts` |

## Component Responsibilities and Invariants

### Domain Components LC-U05-01 through LC-U05-11

- Are immutable or pure and perform no file, environment, clock, timer, database, network, SDK, or credential access.
- Reuse exact U01 values and actual U04 public plan fields.
- Return typed failures for expected invalid input and never return partial success.
- Keep approval, execution, order, reconciliation, and kill-switch histories separate but linked by immutable identifiers.
- Define every event/evidence payload before persistence implementation is introduced.

### Port Components LC-U05-12 through LC-U05-16

- Contain interfaces and normalized types only.
- Expose no raw SQL, database connection, SDK object, secret, or unbounded unknown payload.
- Require explicit deadlines, `asOf`, optional cursor, certainty, and redacted failure classification on external results.
- Separate transaction capabilities from asynchronous external capabilities.

### Application Components LC-U05-17 through LC-U05-25

- Are async only to coordinate ports; every U02 callback remains synchronous.
- Re-load and revalidate state at every financial boundary.
- Perform one external call at a time per order and never within a transaction.
- Derive all follow-up work from committed state, not process-local flags.
- Emit post-commit evidence only after a successful transaction.

### Adapter and Infrastructure Components LC-U05-26 through LC-U05-33

- LC-U05-26 is the only U05 component permitted to use U02 persistence internals.
- LC-U05-30 and LC-U05-31 are the only U05 components permitted to import their respective broker SDK/client.
- Live adapters start uncertified and cannot be selected by caller data.
- Paper, dry-run, and fake compositions contain no credential/live capability.
- Generic resilience may retry only safe reads; placement obeys four-way certainty.
- Composition validates every capability before wiring and performs no work during import.

### Verification Components LC-U05-35 and LC-U05-36

- Are development/CI leaves and are never imported by runtime source.
- Never read credential files, initialize live SDKs, use non-loopback network, mutate persistent user data, or place an order.
- Use temporary U02 databases and fake encryption attestations only.

## Acyclic Layer Order

| Order | Components | May depend on |
|---:|---|---|
| 1 | LC-U05-01 | U01 public leaf contracts only |
| 2 | LC-U05-02, LC-U05-11 | Order 1 and Node pure APIs |
| 3 | LC-U05-03 through LC-U05-09 | Orders 1-2 and U01/U04 public domain contracts |
| 4 | LC-U05-10 | Orders 1-3 |
| 5 | LC-U05-12 through LC-U05-16 | Orders 1-4 |
| 6 | LC-U05-17, LC-U05-18 | Orders 1-5 |
| 7 | LC-U05-20 through LC-U05-23 | Orders 1-6 through port interfaces only |
| 8 | LC-U05-24, LC-U05-25 | Orders 1-7 |
| 9 | LC-U05-19, LC-U05-26 through LC-U05-29, LC-U05-32 | Orders 1-8 or ports/domain plus approved external implementation inputs |
| 10 | LC-U05-30, LC-U05-31 | Orders 1-9 and one isolated legacy SDK input each |
| 11 | LC-U05-33 | Application, ports, and adapters from prior orders |
| 12 | LC-U05-34 | Approved public contracts only |
| 13 | LC-U05-35, LC-U05-36 | Public runtime contracts; never imported by runtime |

Application components depend only on LC-U05-12 policy/result interfaces. Composition injects the LC-U05-32-governed adapter implementation, so no application-to-infrastructure import edge exists.

## Critical Interaction Sequences

### Placement

1. LC-U05-19 selects the next canonical order.
2. LC-U05-20 loads current state through LC-U05-13/14.
3. LC-U05-10 validates scope, approval, reconciliation, window, quote, product, quantity, cash/delivery, and kill gates.
4. LC-U05-20 uses LC-U05-13 to commit finalized intent, reservation, and attempt.
5. After commit, LC-U05-20 calls LC-U05-12 through the composition-governed adapter.
6. LC-U05-20 commits normalized certainty/outcome.
7. LC-U05-21 schedules the first status/fill check within two seconds.

### Fill

1. LC-U05-21 obtains normalized fills through LC-U05-12.
2. LC-U05-06 derives unique identity and incremental quantity.
3. LC-U05-13 transactionally applies fill, order progress, reservation, cash, holding, lots, portfolio version, and event.
4. Duplicate equivalent fills are no-ops; conflicts roll back.
5. LC-U05-23 reconciles after partial/terminal progress as required.

### Cancellation Race

1. LC-U05-22 commits cancellation intent.
2. External cancellation returns without proving terminal cancellation.
3. The order remains cancel-pending while LC-U05-21 ingests status/fills.
4. A completing race fill transitions to filled; otherwise LC-U05-23 must prove zero open quantity before cancelled.

### Reconciliation and Recovery

1. LC-U05-23 collects bounded endpoint evidence through LC-U05-12.
2. LC-U05-07 accepts a coherent cursor or enforces at most ten seconds of endpoint skew.
3. Pure comparison yields immutable result/differences.
4. Missing known fills route through LC-U05-21/06; snapshots never write accounting directly.
5. On restart, LC-U05-24 classifies persisted attempts before any work and never replaces an ambiguous order.

## NFR-to-Component Traceability

| NFR category | Primary components |
|---|---|
| `CAP-001` through `CAP-010` | LC-U05-01, 05 through 07, 10, 19 through 24, 26, 35, 36 |
| `PERF-001` through `PERF-015` | LC-U05-02 through 07, 10, 17 through 24, 26, 32, 35, 36 |
| `DET-001` through `DET-010` | LC-U05-01 through 11, 16, 27 through 29, 35 |
| `AVAIL-001` through `AVAIL-008` | LC-U05-11, 12, 19 through 25, 27, 32, 33 |
| `REL-001` through `REL-014` | LC-U05-03 through 10, 13, 17 through 26, 32, 35 |
| `SAFE-001` through `SAFE-015` | LC-U05-03 through 10, 12 through 25, 27 through 33, 35 |
| `SEC-001` through `SEC-012` | LC-U05-01, 02, 10 through 16, 20, 26 through 35 |
| `OBS-001` through `OBS-010` | LC-U05-11, 13, 17 through 26, 32, 35 |
| `RSC-001` through `RSC-008` | LC-U05-12, 13, 16, 19 through 26, 32, 35, 36 |
| `MAINT-001` through `MAINT-010` | LC-U05-01 through 16, 26, 30 through 35 |
| `TEST-001` through `TEST-010` | LC-U05-27 through 36 |
| `PBT-001` through `PBT-012` | LC-U05-01 through 11, LC-U05-27 through 29, LC-U05-35 |

All 134 requirements are assigned to at least one runtime component and one verification responsibility where applicable.

## Verification Architecture

| Verification family | Owned by LC-U05-35 |
|---|---|
| Example tests | Buy-only, sell-only, mixed, no-trade, zero affordability, rejection, ambiguity, race fill, mismatch, external change, kill/reset, restart |
| Round trips | Canonical values, events, persisted entities, broker decimal formats, dry-run normalized request |
| Invariants | Scope isolation, non-negative exact values, sell-before-buy, no short/leverage, reservations, monotone fills, holding/open-lot equality |
| Idempotency | Approval, execute, intent, placement outcome, fill, cancel, reconciliation, adjustment, kill, reset, recovery |
| Stateful models | Approval, execution run, order, cancellation, reservation, fill stream, reconciliation, kill-switch, paper broker, recovery |
| Oracles | Exact accounting ledger, reconciliation comparator, deterministic paper fill, certainty/retry model |
| Contract suites | Broker port, paper, dry-run, fake, Zerodha, Sharekhan, persistence codecs/repositories |
| Fault injection | Every transaction write, deadline, disconnect, malformed result, process-crash boundary, event publication, restart |
| Architecture | Forbidden imports, no credential path, no live SDK in non-live composition, no legacy trade route, no test-to-runtime edge |
| Benchmarks | Approval, conversion, hashing, transitions, transactions, fill accounting, reconciliation, recovery, sequential portfolio isolation |

## Public and Hidden Contracts

LC-U05-34 explicitly exports:

- approved identifier/value/state/result types;
- approval, execution, order, reconciliation, difference, residual, and kill-switch contracts;
- normalized port interfaces;
- application service interfaces;
- non-live composition entry points;
- live capability/certification status types that cannot be constructed from caller input.

LC-U05-34 hides:

- SQL, statement names, migration internals, database handles, SDK types, raw broker payloads, credential values, redaction rules, hash-domain constants, mutable circuit state, test fakes, generators, models, and benchmark fixtures.

Wildcard exports and import-time initialization are forbidden.

## Ownership Boundaries

- U02 owns the connection, transaction implementation, migration runner, backup consistency, and encryption attestation.
- U04 owns plan construction, action quantity ceilings, lot-disposition lineage, and execution timing.
- U05 owns approval, normalized execution, fill accounting coordination, reconciliation, containment, and restart classification.
- U06 owns scheduling, leases, centralized observability, alerts, backup operations, runbooks, and incident/COE workflow.
- U07 owns authenticated HTTP commands, object/function authorization, MFA/session evidence, and portfolio execution views.
- U09 owns CI/release integration, scan/SBOM evidence, and final capacity/recovery execution.

## Explicitly Forbidden Dependencies

- `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`
- Remix routes and browser code
- `/trade-execution` and `/paper-trades`
- legacy credential property loaders
- raw `stock-watcher.db` access
- direct `better-sqlite3` use outside LC-U05-26/U02
- broker SDK imports outside LC-U05-30 and LC-U05-31
- test, property, model, or benchmark helpers from runtime source

## Design Completion Findings

- Component count: 36.
- Dependency direction: acyclic with adapter injection through ports.
- NFR coverage: all 134 approved IDs.
- Security blocking findings: none.
- Resiliency blocking findings: none.
- Property-Based Testing blocking findings: none.
- Infrastructure added by this design: none.
- Real broker or persisted-data effect: none.
