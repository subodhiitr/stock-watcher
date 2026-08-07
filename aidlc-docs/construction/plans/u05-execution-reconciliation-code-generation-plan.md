# U05 Execution and Reconciliation - Code Generation Plan

## Single Source of Truth

This document is the only execution plan for U05 Code Generation. Part 2 must follow the numbered sequence exactly and update each checkbox in the same interaction that completes the step. Application code, tests, benchmarks, and configuration belong under the workspace root. Only the implementation summary belongs under `aidlc-docs\construction\u05-execution-reconciliation\code\`.

## Unit Context

- **Unit**: U05 Execution and Reconciliation
- **Primary stories**: US-021 through US-027
- **Supporting stories**: US-014, US-019, US-028, US-035, US-038
- **Upstream dependencies**: U01 exact values and portfolio state; U02 isolated SQLite owner, synchronous unit of work, migration ledger, and event chain; U03 strategy/corporate-action evidence; U04 immutable approval-ready rebalance plans
- **Downstream consumers**: U06 scheduling, recovery operations, alerts, and audit views; U07 authenticated portfolio APIs; U08 portfolio workspace; U09 integrated delivery verification
- **Runtime boundary**: strict TypeScript under `server\portfolio\`; no HTTP route, UI, scheduler, worker, queue, cloud resource, or new dependency
- **Safety boundary**: live execution remains structurally disabled and uncertified; tests use only temporary databases, fake attestations, deterministic paper behavior, and scripted non-network brokers
- **Protected behavior**: do not call or modify legacy `/trade-execution`, `/paper-trades`, simulation, dashboard, credential files, persistent user data, or real broker accounts

## Brownfield Findings

- U02 owns the sole database connection, migration runner, health checks, backup fingerprint, and close lifecycle.
- U02 transaction callbacks are synchronous and reject Promise-returning work.
- Current state/event matching assumes one portfolio mutation per event. U05 therefore requires an additive mutation-evidence contract; it must not weaken existing U01 matching.
- Migration 001 is immutable. U05 storage starts in migration 002.
- `domain_events` remains the immutable hash chain and `event_dispatch` remains mutable delivery bookkeeping.
- U04 plans are not persisted by U05; U05 consumes them through an injected state port and verifies the existing semantic hash.
- `server\portfolio\index.ts` is the reviewed explicit export surface. Wildcard exports and import-time initialization are forbidden.
- Existing architecture tests already enforce acyclic imports, no forbidden domain/port dependencies, and no ambient time/randomness.
- Current legacy broker clients use unsafe numeric/raw-error behavior. U05 live adapters will expose only disabled, injected-client facades and cannot become certified in this unit.
- No U05 runtime, migration, test, or benchmark file exists.

## Autopilot Implementation Decisions

| ID | Decision |
|---|---|
| AD-C-U05-01 | Add only the 14 approved U05 identifier brands and parsers, including `ExecutionPolicySnapshotId`; reuse existing U01/U04 identities wherever specified. |
| AD-C-U05-02 | Use one versioned canonical execution codec in the domain; persistence codecs map exact values to canonical TEXT without duplicating hash rules. |
| AD-C-U05-03 | Keep aggregate tables mutable only through optimistic state transitions; attempts, fills, reconciliations, differences, residuals, and evidence facts are insert-only with database triggers. |
| AD-C-U05-04 | Extend U02 transaction matching with typed mutation evidence for portfolio and U05 aggregate/fact mutations. Existing U01 mutation/event invariants remain unchanged. |
| AD-C-U05-05 | Keep broker, timer, wait, and reconciliation collection calls outside every synchronous transaction. |
| AD-C-U05-06 | Implement paper and dry-run adapters fully. Implement Zerodha and Sharekhan only as certification-disabled adapters over injected normalized client facades; do not load SDKs or credentials. |
| AD-C-U05-07 | Trusted composition chooses mode and capabilities. Commands cannot select an adapter by name or construct live authority. |
| AD-C-U05-08 | Persist entity-specific indexed columns plus a canonical versioned payload. Exact money and quantity columns use canonical base-10 TEXT. |
| AD-C-U05-09 | Keep approval, execution, order, reconciliation, kill-switch, and recovery coordinators responsibility-focused; committed facts, not process-local flags, drive all resumption. |
| AD-C-U05-10 | Use deterministic fake clock/timer and scripted broker support for all timing, ambiguity, cancellation-race, recovery, and fault tests. |
| AD-C-U05-11 | Verify all 124 functional rules through a checked evidence table and all 134 NFRs through a checked traceability table plus examples, properties, models, contracts, faults, and benchmarks. |
| AD-C-U05-12 | Completion requires no new failure relative to the established full-suite baseline of 795/799 with four unrelated legacy failures. |

## Exact Paths

### Modify

1. `server\portfolio\domain\shared\identifiers.ts`
2. `server\portfolio\domain\errors\failure.ts`
3. `server\portfolio\domain\events\domain-events.ts`
4. `server\portfolio\domain\events\codecs.ts`
5. `server\portfolio\ports\index.ts`
6. `server\portfolio\adapters\persistence\unit-of-work.ts`
7. `server\portfolio\adapters\persistence\event-ledger.ts`
8. `server\portfolio\infrastructure\persistence\migrations\index.ts`
9. `server\portfolio\infrastructure\persistence\database-owner.ts`
10. `server\portfolio\infrastructure\persistence\index.ts`
11. `server\portfolio\index.ts`
12. `server\portfolio\tsconfig.json`
13. `tests\portfolio\architecture.test.ts`
14. `package.json`

### Create Runtime

- `server\portfolio\domain\execution\contracts.ts`
- `server\portfolio\domain\execution\canonical-codec.ts`
- `server\portfolio\domain\execution\approval.ts`
- `server\portfolio\domain\execution\execution-run.ts`
- `server\portfolio\domain\execution\execution-order.ts`
- `server\portfolio\domain\execution\fill-accounting.ts`
- `server\portfolio\domain\execution\reconciliation.ts`
- `server\portfolio\domain\execution\kill-switch.ts`
- `server\portfolio\domain\execution\residual-and-adjustment.ts`
- `server\portfolio\domain\execution\execution-gate.ts`
- `server\portfolio\domain\execution\evidence.ts`
- `server\portfolio\ports\execution\broker-port.ts`
- `server\portfolio\ports\execution\execution-unit-of-work.ts`
- `server\portfolio\ports\execution\execution-state-port.ts`
- `server\portfolio\ports\execution\market-execution-port.ts`
- `server\portfolio\ports\execution\runtime-port.ts`
- `server\portfolio\application\execution\approval-service.ts`
- `server\portfolio\application\execution\execution-run-service.ts`
- `server\portfolio\application\execution\placement-coordinator.ts`
- `server\portfolio\application\execution\status-fill-coordinator.ts`
- `server\portfolio\application\execution\cancellation-coordinator.ts`
- `server\portfolio\application\execution\reconciliation-service.ts`
- `server\portfolio\application\execution\recovery-service.ts`
- `server\portfolio\application\execution\kill-switch-service.ts`
- `server\portfolio\application\execution\execution-coordinator.ts`
- `server\portfolio\infrastructure\persistence\migrations\002-execution-schema.ts`
- `server\portfolio\adapters\persistence\execution\execution-codecs.ts`
- `server\portfolio\adapters\persistence\execution\execution-repositories.ts`
- `server\portfolio\adapters\persistence\execution\execution-statements.ts`
- `server\portfolio\adapters\broker\paper-broker-adapter.ts`
- `server\portfolio\adapters\broker\dry-run-broker-adapter.ts`
- `server\portfolio\adapters\broker\zerodha-broker-adapter.ts`
- `server\portfolio\adapters\broker\sharekhan-broker-adapter.ts`
- `server\portfolio\infrastructure\execution\broker-resilience-governor.ts`
- `server\portfolio\execution-composition.ts`
- `server\portfolio\execution-index.ts`

### Create Tests, Benchmark, and Documentation

- `tests\portfolio\execution\support\fixtures.ts`
- `tests\portfolio\execution\support\arbitraries.ts`
- `tests\portfolio\execution\support\execution-oracle.ts`
- `tests\portfolio\execution\support\model-commands.ts`
- `tests\portfolio\execution\support\scripted-broker.ts`
- `tests\portfolio\execution\support\u05-rule-evidence.ts`
- `tests\portfolio\execution\support\u05-nfr-evidence.ts`
- `tests\portfolio\execution\architecture.test.ts`
- `tests\portfolio\execution\canonical-codec.test.ts`
- `tests\portfolio\execution\approval.test.ts`
- `tests\portfolio\execution\execution-order.test.ts`
- `tests\portfolio\execution\execution-run.test.ts`
- `tests\portfolio\execution\execution-gate.test.ts`
- `tests\portfolio\execution\persistence.test.ts`
- `tests\portfolio\execution\placement.test.ts`
- `tests\portfolio\execution\status-fill.test.ts`
- `tests\portfolio\execution\cancellation.test.ts`
- `tests\portfolio\execution\reconciliation.test.ts`
- `tests\portfolio\execution\kill-switch-recovery.test.ts`
- `tests\portfolio\execution\broker-contract.test.ts`
- `tests\portfolio\execution\execution.property.test.ts`
- `tests\portfolio\execution\execution.model.test.ts`
- `tests\portfolio\execution\fault-injection.test.ts`
- `benchmark\portfolio-execution.ts`
- `aidlc-docs\construction\u05-execution-reconciliation\code\code-summary.md`

## Coverage Commitments

### Stories

- **US-021**: paper adapter uses the production approval, order, fill, accounting, cancellation, and reconciliation contracts.
- **US-022**: independent default-false live gates, uncertified live adapters, no fallback, no credential/network capability in non-live composition.
- **US-023**: immutable current-plan approval binding, subset restrictions, expiry/invalidation, and consume-once behavior.
- **US-024**: canonical identity, intent-before-submit, four-way certainty, safe retry, and duplicate prevention.
- **US-025**: incremental fills, cancellation races, coherent snapshots, unknown outcomes, residuals, and immutable differences.
- **US-026**: normalized broker port, paper/dry-run/scripted contract suites, and disabled Zerodha/Sharekhan facades.
- **US-027**: restricted authority checks, global/portfolio kill switches, containment, privileged reset, and no auto-resume.
- **Supporting stories**: corporate-action and interim-risk invalidation; U06 exactly-once/recovery handoff; audit evidence; deterministic non-AI execution.

### Functional Rules

- BND 10, APR 10, CNV 10, GAT 10, IDM 10, ORD 10, FIL 12, REC 12, BRK 10, KIL 10, AUD 10, ABU 10 = **124**.
- Every rule receives one unique evidence row and at least one named example, property, model, contract, architecture, or fault-test owner.

### NFRs and Extensions

- CAP 10, PERF 15, DET 10, AVAIL 8, REL 14, SAFE 15, SEC 12, OBS 10, RSC 8, MAINT 10, TEST 10, PBT 12 = **134**.
- Security Baseline: default-disabled authority, least capability, secret-free evidence, isolated SDK boundary, immutable audit, no unsafe fallback.
- Resiliency Baseline: deadlines, bulkheads, circuits, four-way certainty, coherent reconciliation, restart classification, progress and capacity evidence.
- Full PBT: round trips, invariants, idempotency, stateful models, independent oracles, shrinking, seed/path replay, permanent regression fixtures, and paired examples.

## Part 1 Planning Record

- [x] Loaded Code Generation and content-validation rules.
- [x] Loaded approved U05 Functional Design, NFR Requirements, NFR Design, Infrastructure Design, and story map.
- [x] Inspected current U01-U04 source, migration, persistence, event, export, TypeScript, script, and test conventions.
- [x] Confirmed migration 001 is immutable and U02 remains the sole database owner.
- [x] Confirmed no U05 runtime, test, benchmark, or partial plan exists.
- [x] Resolved implementation ambiguities through AD-C-U05-01 through AD-C-U05-12.
- [x] Validated Markdown, paths, checkbox syntax, count totals, and absence of diagrams or unsafe executable content.
- [x] Confirmed every Part 2 checkbox below remains unchecked before generation.

## Part 2 Dependency-Safe Execution Sequence

### Shared Contracts and Pure Domain

- [x] **Step 1: Add U05 identifier brands and parsers.** Extend `identifiers.ts` with the 14 approved identifiers, including `ExecutionPolicySnapshotId`, without changing existing parsing behavior. **Coverage**: BND-001/002, CAP-001, SEC-003.
- [x] **Step 2: Append U05 stable failure codes.** Add all unique BND/APR/CNV/GAT/IDM/ORD/FIL/REC/BRK/KIL/AUD/ABU codes to the closed catalog. **Coverage**: all 124 rules; REL-001, MAINT-005.
- [x] **Step 3: Create execution shared contracts.** Define closed states, modes, certainty, bounded constants, exact common records, and exhaustive guards in `contracts.ts`. **Coverage**: US-021..027; PAT-001/002.
- [x] **Step 4: Create the canonical execution codec.** Implement versioned canonical JSON, domain-separated SHA-256, exact broker decimal parsing, and hostile-value rejection. **Coverage**: BND-003/004, IDM-001/002, DET-001..003.
- [x] **Step 5: Implement the approval aggregate.** Bind exact plan/state/quote/window/actor lineage, subset rules, expiry, invalidation, consume-once, and idempotency. **Coverage**: APR-001..010; US-023.
- [x] **Step 6: Implement the execution-run aggregate.** Add the closed phase graph, terminal behavior, reconciliation links, residual completion, and recovery-required transitions. **Coverage**: ORD-001, REC-001; REL-008.
- [x] **Step 7: Implement the execution-order aggregate.** Add stable shells, one-time intent finalization, attempts, four-way certainty, status, cancellation-pending, fill progress, and terminal invariants. **Coverage**: CNV/IDM/ORD; US-024.
- [x] **Step 8: Implement fill and reservation decisions.** Add deterministic fill identity, duplicate/conflict handling, incremental quantity, exact reservation release, and lot/accounting transition requests. **Coverage**: FIL-001..012; SAFE-005/007/008.
- [x] **Step 9: Implement reconciliation models.** Add canonical bounded snapshots, cursor/skew coherence, pure comparison, closed results, zero-tolerance identities, and evidenced one-minor-unit rounding. **Coverage**: REC-001..012; SAFE-013..015.
- [x] **Step 10: Implement kill-switch transitions.** Add global/portfolio activation, containment, privileged reset, health/ambiguity guards, and no auto-resume. **Coverage**: KIL-001..006; US-027.
- [x] **Step 11: Implement residual and adjustment facts.** Add immutable residual work, external differences, and separately authorized adjustment proposals. **Coverage**: REC-008/010/012, AUD-001.
- [x] **Step 12: Implement execution gates and risk policy.** Enforce deterministic precedence across scope, authority, live gates, kill switches, reconciliation, window, quote, CNC, quantity, delivery, cash, and hard risk. **Coverage**: GAT-001..010, CNV-006..010, ABU.
- [x] **Step 13: Implement typed execution evidence.** Add bounded, allowlisted, redacted evidence/health/progress contracts with no raw broker text or credential fields. **Coverage**: AUD-001..010; OBS/SEC.

### Ports and Application Services

- [x] **Step 14: Define the normalized broker port.** Separate read-only recovery capability from placement/cancellation capability and require explicit deadlines, certainty, timestamps, and redacted failures. **Coverage**: BRK-001..010.
- [x] **Step 15: Define execution persistence ports.** Add transaction-scoped repositories and typed mutation-evidence capabilities without exposing SQL or async work. **Coverage**: BND-005..010, REL-002/003/012.
- [x] **Step 16: Define plan and portfolio state ports.** Expose current U04 plan, U01 accounting, U03 policy/corporate-action lineage, and reservations. **Coverage**: APR/GAT, supporting US-014/019.
- [x] **Step 17: Define quote, calendar, and mapping ports.** Require fresh quote provenance, Asia/Kolkata session evidence, and immutable broker mapping snapshots. **Coverage**: CNV-006, GAT-008/009.
- [x] **Step 18: Define runtime ports.** Add injected clock, monotonic time, bounded timer, deterministic seed, and U05 identifier factories. **Coverage**: DET-004/009, PERF-011..015.
- [x] **Step 19: Implement approval service.** Verify current semantic plan hash and state, apply static gates, persist one idempotent decision/evidence transaction, and publish only post-commit facts. **Coverage**: US-023, APR, REL-011.
- [x] **Step 20: Implement plan conversion and run service.** Convert only approved proposed actions, sort sells before buys, build shells, consume approval, and create one run atomically. **Coverage**: CNV, IDM-005.
- [x] **Step 21: Implement placement coordinator.** Revalidate gates, finalize intent, reserve, commit attempt, call outside transaction, and commit normalized certainty. **Coverage**: IDM-006..009, ORD-002..006.
- [x] **Step 22: Implement status and fill coordinator.** Start first check within two seconds, poll with bounded timers, apply unique fills atomically, and trigger reconciliation. **Coverage**: FIL, PERF-015.
- [x] **Step 23: Implement cancellation coordinator.** Persist intent first, keep cancel-pending after response, process race fills, and require reconciled zero open quantity. **Coverage**: ORD-008..010, REL-010.
- [x] **Step 24: Implement reconciliation service.** Collect evidence outside transactions, enforce total deadline/coherence, compare purely, persist immutable result/differences, and route missing fills through fill accounting. **Coverage**: REC, PERF-013.
- [x] **Step 25: Implement recovery service.** Classify persisted facts with placement disabled, use separately gated read-only broker evidence, deduplicate fills, expose progress, and never replace ambiguity. **Coverage**: KIL-007..010, REL-013/014.
- [x] **Step 26: Implement kill-switch service.** Persist activation/reset, request safe cancellation, permit status/fill/reconciliation, and never liquidate or auto-resume. **Coverage**: KIL, US-027.
- [x] **Step 27: Implement execution phase coordinator.** Derive sell, reconciliation, buy, cancel, terminal, and recovery phases only from committed state. **Coverage**: US-021/024/025; SAFE-006.

### Persistence and Events

- [x] **Step 28: Create migration 002.** Add strict aggregate/fact tables, exact TEXT checks, portfolio foreign keys, unique idempotency constraints, recovery indexes, and insert-only triggers; provide guarded reverse SQL. **Coverage**: BND, REL, RSC, MAINT.
- [x] **Step 29: Register migration 002 and test registry integrity.** Append it after 001 without modifying 001. **Coverage**: MAINT-006, recovery preflight.
- [x] **Step 30: Create execution persistence codecs.** Round-trip all canonical payloads and exact indexed values with version rejection. **Coverage**: DET-002/003, PBT-001..003.
- [x] **Step 31: Create prepared execution statements.** Centralize bounded SQL for aggregate/fact insert, optimistic update, lookup, recovery scan, and immutable history reads. **Coverage**: BND-006/010, RSC-003.
- [x] **Step 32: Extend the U02 transaction mutation-evidence contract.** Add a closed `PortfolioMutation | ExecutionAggregateMutation | ExecutionFactInsertion` union before repositories depend on it. Preserve existing portfolio mutation semantics. Execution aggregate mutations carry kind, aggregate ID, and state version; fact insertions carry fact kind and fact ID. Keep one required evidence event per mutation and reject duplicate mutation identities. **Coverage**: BND-005/007/009, AUD-002/003.
- [x] **Step 33: Implement execution repositories and transaction capabilities.** Implement all transaction-scoped repositories against the Step 32 mutation union, add them to the synchronous U02 transaction capability, enforce capability lifetime, idempotent reads/inserts, optimistic conflicts, and fact immutability, and preserve existing portfolio behavior. **Coverage**: BND-005..010, REL-002/007/012.
- [x] **Step 34: Extend domain events additively.** Add one version-aware evidence event for each U05 aggregate mutation or fact insertion, including distinct portfolio-accounting, order-progress, and fill-recorded events for one atomic fill transaction. Each U05 payload carries its mutation kind and exact aggregate/fact identity; existing event shapes remain unchanged. **Coverage**: AUD-001/002.
- [x] **Step 35: Extend event codecs.** Serialize and parse every Step 34 U05 event payload canonically before the existing unknown-type fallthrough, reject unknown versions/types, and preserve all U01 round trips. **Coverage**: AUD-002/004, DET-002.
- [x] **Step 36: Extend persisted mutation/event matching.** Keep the strict one-mutation-to-one-event count. Match `PortfolioMutation` through the existing portfolio ID/version/state logic; match `ExecutionAggregateMutation` by payload mutation kind, aggregate ID, aggregate state version, expected event type, and persisted row; match `ExecutionFactInsertion` by payload fact kind, fact ID, expected event type, and persisted immutable row. A fill transaction therefore stages separate portfolio-accounting, order-progress, and fill-recorded events in one commit. Reject unmatched or duplicate events before appending them to the contiguous portfolio hash chain. **Coverage**: BND-005/009, AUD-002/003.
- [x] **Step 37: Extend database owner capabilities and backup fingerprint.** Expose execution unit of work/repositories through U02 ownership and include every U05 table in verified backup; do not change close ownership. **Coverage**: AVAIL-002/008, RSC-001/002.
- [x] **Step 38: Extend persistence and public exports.** Add explicit named U05 persistence exports only. **Coverage**: MAINT-001..005.

### Broker Adapters, Resilience, and Composition

- [ ] **Step 39: Implement deterministic paper broker.** Use injected clock/seed/fill policy, shadow account state, normalized statuses/fills, no credentials, and no network. **Coverage**: US-021, BRK-003/004, DET-010, SAFE-009.
- [ ] **Step 40: Implement dry-run broker.** Render byte-stable normalized requests, return `DRY_RUN_RECORDED`, and produce no acknowledgement, fill, reservation, or accounting effect. **Coverage**: BRK-004/005, SAFE-010.
- [ ] **Step 41: Implement disabled Zerodha facade.** Normalize only injected reviewed client results, map unknown states closed, remain uncertified, and expose no credential loading or implicit retry. **Coverage**: BRK-007/009/010.
- [ ] **Step 42: Implement disabled Sharekhan facade.** Require explicit reviewed delivery mapping, reject intraday/default product ambiguity, normalize exact values, and remain uncertified. **Coverage**: BRK-008..010.
- [ ] **Step 43: Implement broker resilience governor.** Add independent deadlines, in-flight bulkheads, safe-read retries, circuits, bounded seedable jitter, and placement-certainty preservation. **Coverage**: AVAIL-004..006, RSC-004..008.
- [ ] **Step 44: Implement trusted execution composition.** Select paper/dry-run/test capabilities explicitly; require opaque unconstructable live capability and certification for live; default every live gate false. **Coverage**: US-022/026, BRK-002..006, SAFE-001/011.
- [ ] **Step 45: Create the U05 public entry point and extend root exports.** Export reviewed contracts/services/non-live factories explicitly with no side effects, SQL, raw client types, credentials, or wildcard barrels. **Coverage**: MAINT/SEC.

### Verification Support and Focused Tests

- [ ] **Step 46: Create deterministic fixtures and scripted broker.** Cover buy-only, sell-only, mixed, no-trade, zero affordability, rejection, ambiguity, race fill, mismatch, external change, kill/reset, and restart. **Coverage**: TEST-001..007.
- [ ] **Step 47: Create arbitraries, independent oracle, and model commands.** Generate linked valid/invalid data and state commands with replayable seeds/paths and bounded shrink-safe fixtures. **Coverage**: PBT-001..012.
- [ ] **Step 48: Create rule and NFR evidence tables.** Add exactly 124 unique functional-rule rows and 134 unique NFR rows with named executable owners. **Coverage**: all U05 rules/NFRs.
- [ ] **Step 49: Test canonical codecs and exact identifiers.** Cover hostile values, round trips, domain separation, broker decimals, and stable ordering. **Coverage**: BND, DET, PBT-001..003/007.
- [ ] **Step 50: Test approval, run, order, and gate examples.** Cover complete state graphs, precedence, binding changes, idempotency, sell-before-buy, quantity ceilings, and zero affordability. **Coverage**: APR/CNV/GAT/IDM/ORD.
- [ ] **Step 51: Test migration, repositories, transactions, events, backup, and recovery indexes.** Use temporary databases only and inject failure at every write boundary. **Coverage**: BND/AUD, REL-002/011/012, TEST-003.
- [ ] **Step 52: Test placement, polling, fill accounting, and cancellation races.** Prove intent-before-submit, four-way certainty, two-second first checks, unique fills, exact lots/cash, and reconciled cancellation. **Coverage**: IDM/ORD/FIL, PERF-011/012/015.
- [ ] **Step 53: Test reconciliation, residuals, adjustments, kill switches, and recovery.** Prove ten-second skew/cursor coherence, immutable differences, no snapshot overwrite, containment, read-only recovery, and ambiguity persistence. **Coverage**: REC/KIL, SAFE-012..015, REL-013/014.
- [ ] **Step 54: Run broker contract and architecture tests.** Apply one normalized contract suite to paper, dry-run, scripted, and disabled live facades; scan forbidden imports, credentials, network paths, legacy routes, and runtime-to-test edges. **Coverage**: BRK/ABU, SEC/MAINT/TEST.
- [ ] **Step 55: Run property and state-model suites.** Execute required round trips, permutation invariants, isolation, idempotency, reservation/fill/reconciliation/kill/recovery models, oracle comparisons, and permanent counterexamples. **Coverage**: PBT-001..012.
- [ ] **Step 56: Run deterministic fault and restart drills.** Inject transaction failures, deadlines, disconnects, malformed results, crash boundaries, publication failure, and repeated cold recovery. **Coverage**: REL, AVAIL, RSC, TEST-005.

### Benchmark, Configuration, and Final Verification

- [ ] **Step 57: Create execution benchmark harness.** Measure approval, 250-order conversion/hash, transitions, representative/worst fill, boundary reconciliation, 10,000-fill recovery, and 100-portfolio isolation against approved thresholds. **Coverage**: CAP/PERF/RSC.
- [ ] **Step 58: Update TypeScript and npm configuration.** Include the benchmark and add `test:portfolio:u05`, `bench:portfolio:u05`, and `verify:portfolio:u05` without adding dependencies. **Coverage**: MAINT-006..010, TEST-008..010.
- [ ] **Step 59: Extend root architecture guards.** Assert 124/134 evidence counts, U05 import boundaries, explicit exports, no legacy routes/credential loaders/live SDK in non-live code, and no test/benchmark runtime imports. **Coverage**: ABU, SEC, MAINT.
- [ ] **Step 60: Run focused U05 tests.** Require all U05 example, contract, property, model, fault, migration, and architecture tests to pass.
- [ ] **Step 61: Run strict type and declaration checks.** Require `typecheck:portfolio` and `test:portfolio:contracts` to pass with no casts that bypass U05 contracts.
- [ ] **Step 62: Run U05 benchmarks.** Require every measurable U05 threshold to pass and report p50/p95/max, growth, heap, and event-loop evidence where specified.
- [ ] **Step 63: Run portfolio and full compatibility verification.** Run U01-U04 suites and the full repository suite; accept only the same four established unrelated legacy failures and no changed failure signature.
- [ ] **Step 64: Create the implementation summary and finalize workflow state.** Record modified/created files, story/rule/NFR evidence, test/benchmark results, safety guarantees, extension compliance, known unrelated baseline failures, and mark U05 Code Generation complete only after review.

## Completion Gates

- [ ] All 64 Part 2 steps are checked.
- [ ] All seven primary and five supporting stories are traced.
- [ ] All 124 functional rules and 134 NFRs have unique executable evidence.
- [ ] Live execution is default-disabled, uncertified, credential-free in tests, and unreachable from caller-selected data.
- [ ] No broker call, timer, Promise, or wait occurs inside a U02 transaction.
- [ ] No persistent user database, credential file, legacy trade route, or real order is touched.
- [ ] Focused tests, strict typing, declarations, and benchmarks pass.
- [ ] Portfolio compatibility remains green and the full suite adds no failure beyond the established four unrelated failures.
