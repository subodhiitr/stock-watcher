# U04 Construction and Rebalancing – Code Generation Plan

## Single Source of Truth

This document is the only approved execution plan for U04 Code Generation. Part 1 planning is complete in this file. Part 2 must follow this plan exactly. Application code, tests, benchmark scripts, and package or TypeScript configuration changes belong under the workspace root. Only the implementation summary belongs under `aidlc-docs\construction\u04-construction-rebalancing\code\`.

## Unit Context

- **Unit**: U04 Construction and Rebalancing
- **Primary stories**: US-015, US-016, US-017, US-018, US-019, US-020
- **Dependencies**: U01 exact values and identifiers; U02 persisted portfolio snapshots, lots, and plan-history lineage; U03 eligibility, signal, regime, calendar, and corporate-action outputs
- **Downstream consumers**: U05 approval and execution binding, U07 runtime and API composition, U08 preview surfaces
- **Runtime boundary**: strict TypeScript inside `server\portfolio\`; no API routes, UI, scheduler, deployment, migration, or persistence-owner implementation in U04
- **Infrastructure Design**: approved N/A; U04 remains in-process planning logic with optional in-process optimizer adapters only
- **Protected behavior**: preserve dashboard, simulation, replay, canonical `/trade-execution`, `/paper-trades` alias, persisted trading data, and unrelated dirty changes

## Brownfield Findings from Current Source Inspection

- `server\portfolio\index.ts` is the authoritative public barrel and already exposes U01, U02, and U03 contracts with explicit named exports only.
- `server\portfolio\ports\index.ts` remains the reviewed cross-cutting port surface; it currently exposes repository, unit-of-work, clock, identifier-factory, strategy-evidence, and internal-event-bus contracts only.
- `server\portfolio\domain\shared\identifiers.ts` and `server\portfolio\domain\errors\failure.ts` already follow the additive branded-ID and additive failure-code patterns that U04 must extend.
- `server\portfolio\tsconfig.json` already includes benchmark files explicitly; a new U04 benchmark file will require one include-line update.
- `package.json` already carries focused scripts for U01, U02, and U03 and is the correct place to add focused U04 scripts.
- `tests\portfolio\architecture.test.ts` already enforces no wildcard exports, no forbidden runtime dependencies in domain and port code, acyclic imports, and rule-evidence counts; U04 should extend that guard instead of replacing it.
- `tests\portfolio\strategy\support\u03-rule-evidence.ts` establishes the current large-scale rule-evidence-table convention: one readonly array of `{ ruleId, description, coveredIn }`.
- `benchmark\portfolio-domain.ts`, `benchmark\portfolio-persistence.ts`, and `benchmark\portfolio-strategy.ts` establish the current benchmark location and Node-runner convention.
- No `server\portfolio\domain\construction\`, `server\portfolio\domain\rebalancing\`, `server\portfolio\application\rebalancing\`, `server\portfolio\ports\rebalancing\`, `server\portfolio\adapters\optimization\`, or `tests\portfolio\rebalancing\` directories exist yet.
- No current repository source provides U04 planner, cost, tax, cadence, turnover, or optimizer contracts, so this plan must create them surgically without reworking U01-U03.

## Part 1 Planning Record

- [x] Read `.aidlc-rule-details\construction\code-generation.md`.
- [x] Read `.aidlc-rule-details\common\content-validation.md`.
- [x] Read `aidlc-docs\aidlc-state.md` and confirmed enabled Security Baseline, Resiliency Baseline, and Property-Based Testing Full enforcement.
- [x] Read all approved U04 functional-design, NFR-requirements, and NFR-design plans and artifacts.
- [x] Read U04 stories US-015 through US-020 plus `unit-of-work-dependency.md` and `unit-of-work-story-map.md`.
- [x] Inspected actual current repository source under `server\portfolio\`, `tests\portfolio\`, `benchmark\`, `package.json`, and TypeScript configs instead of relying on stale assumptions.
- [x] Confirmed the required U04 runtime directories and files do not yet exist, so no duplicate-runtime cleanup step is needed before creation.
- [x] Resolved remaining implementation ambiguities as explicit AD-C decisions below.
- [x] Validated planned scope excludes persistence schema or migration work, API or frontend work, deployment artifacts, live credentials, and real trading activity.
- [x] Validated intended coverage targets: 6 stories, 117 functional rules, 100 NFRs, Full PBT obligations, benchmark thresholds, and extension compliance expectations.
- [x] Validated Markdown structure, checklist syntax, and that all Part 2 execution steps below remain unchecked by design.

## Autopilot Implementation Decisions

| # | Ambiguity | Safe decision | Rationale |
|---|---|---|---|
| AD-C01 | Where should U04 shared additions live? | Keep additive cross-cutting U04 support under `server\portfolio\domain\shared\` and keep U04-specific planner logic under `domain\construction\` and `domain\rebalancing\`. | This matches the current U01-U03 layout and minimizes boundary churn. |
| AD-C02 | Which new branded identifiers are actually required? | Add only cross-layer U04 IDs that benefit from parser validation: `CostScheduleVersionId`, `TaxRuleVersionId`, `TurnoverSnapshotId`, and `CalendarSessionId`. Reuse existing `RebalanceRunId`, `PortfolioId`, `InstrumentId`, `HoldingLotId`, `StrategyVersionId`, `DataVersionId`, and `IntegrityHash`. | This satisfies shared-addition needs without introducing redundant aggregate IDs. |
| AD-C03 | Does U04 need a new generated plan ID or extra identifier-factory methods? | No. `RebalanceRunId` remains the plan identity, logical-order keys are deterministic hashes, and the application layer accepts already-supplied IDs instead of expanding `IdentifierFactory` or `ports\index.ts`. | This avoids unnecessary changes to the shared port surface. |
| AD-C04 | Can U04 reuse U02 canonical JSON helpers directly? | No direct import from `adapters\persistence` is allowed. Create `server\portfolio\domain\shared\canonical-plan-hash.ts` that mirrors the approved canonicalization semantics while staying inside the pure domain boundary. | U04 needs the same semantics but must not depend on adapter internals. |
| AD-C05 | How should stable human explanations be enforced? | Centralize allowlisted reason templates, machine codes, and constraint families in `server\portfolio\domain\shared\rebalancing-reasons.ts`; build bounded public payloads through `server\portfolio\domain\shared\safe-observability-payload-builder.ts`; forbid raw provider, AI, or exception text in U04 public payloads. | This is the safest way to satisfy explainability, security, and determinism together. |
| AD-C06 | What is the minimal new port surface? | Create exactly four U04-specific ports: `PlanningSnapshotPort`, `PolicyAndTurnoverPort`, `PlanHistoryPort`, and `OptimizerPort`. Do not create duplicate repository or unit-of-work abstractions that current U01/U02 patterns already cover. | The user explicitly requested a minimal, contract-driven port surface. |
| AD-C07 | Where should timeout budgets be enforced? | Time budgets for schedule resolution, turnover lookup, and optimizer calls are explicit inputs owned by the application-layer snapshot assembler and optimizer orchestrator, never by ambient clock reads inside the domain. | This preserves deterministic domain behavior and matches approved AVAIL and DET requirements. |
| AD-C08 | How should the planner be decomposed across new domain files? | `domain\construction\` owns planning context, gate, candidate projection, shared constraint verification, ideal targets, and implementation shortfall. `domain\rebalancing\` owns executable allocation, cost and tax policy, cadence and turnover policy, interim authorization, action buckets, plan assembly, equivalence, and lifecycle. | This directly matches the approved logical components and keeps files responsibility-focused. |
| AD-C09 | What is the canonical executable planner? | The deterministic greedy allocator is the authoritative executable planner. Optional optimizer logic is additive only and can never weaken or replace greedy fallback semantics. | This preserves US-015 safety and US-020 fallback guarantees. |
| AD-C10 | What optimizer implementations are in scope now? | Implement one in-process greedy-baseline adapter for production code paths and one bounded exact small-problem oracle adapter for tests and benchmark verification only. No external solver, worker thread, queue, or background process is introduced. | This meets the approved MVP scope and NFR bounds with the lowest risk. |
| AD-C11 | How should U04 exports be reviewed? | Extend `server\portfolio\index.ts` with explicit named exports only. Do not create wildcard barrels and do not add `ports\rebalancing\index.ts`. | This follows the current public-export pattern and preserves architecture-test compatibility. |
| AD-C12 | What is the correct rule-evidence-table format for 117 rules? | Follow the U03 convention: create `tests\portfolio\rebalancing\support\u04-rule-evidence.ts` as a readonly array of `{ ruleId, description, coveredIn }` records and validate the count in architecture tests. | The array format scales better than the U01 object-map convention for large multi-file coverage. |
| AD-C13 | How should permanent edge examples be tracked? | Keep canonical edge and regression scenarios in `tests\portfolio\rebalancing\support\fixtures.ts` and pin them in `edge-cases.test.ts`; any future shrunk production-relevant counterexample is appended there. | This satisfies PBT-10 without scattering one-off fixtures across unrelated tests. |
| AD-C14 | Which new npm scripts are justified? | Add `test:portfolio:u04`, `bench:portfolio:u04`, and `verify:portfolio:u04`. Reuse the existing `typecheck:portfolio` and `test:portfolio:contracts` commands instead of creating duplicate typecheck scripts. | This gives a focused U04 entry point while minimizing script sprawl. |
| AD-C15 | How should final compatibility be judged? | U04 completion requires zero new failures in the focused U04 suite, the complete portfolio suites, or the full repository suite. If the pre-existing unrelated four legacy repository failures still reproduce, U04 must not increase or mutate that baseline. | This is the current repository reality recorded in `aidlc-state.md` and is the safest compatibility threshold. |

## Exact Application, Test, Config, and Documentation Paths

### Modify (existing files)

1. `server\portfolio\domain\shared\identifiers.ts`
2. `server\portfolio\domain\errors\failure.ts`
3. `server\portfolio\index.ts`
4. `server\portfolio\tsconfig.json`
5. `package.json`
6. `tests\portfolio\architecture.test.ts`

### Create Runtime Source – Shared

7. `server\portfolio\domain\shared\rebalancing-constants.ts`
8. `server\portfolio\domain\shared\rebalancing-reasons.ts`
9. `server\portfolio\domain\shared\canonical-plan-hash.ts`
9a. `server\portfolio\domain\shared\safe-observability-payload-builder.ts`

### Create Runtime Source – Domain Construction

10. `server\portfolio\domain\construction\planning-context.ts`
11. `server\portfolio\domain\construction\planning-gate.ts`
12. `server\portfolio\domain\construction\candidate-projection.ts`
13. `server\portfolio\domain\construction\constraint-verifier.ts`
14. `server\portfolio\domain\construction\ideal-target-constructor.ts`
15. `server\portfolio\domain\construction\implementation-shortfall.ts`

### Create Runtime Source – Domain Rebalancing

16. `server\portfolio\domain\rebalancing\whole-share-greedy-allocator.ts`
17. `server\portfolio\domain\rebalancing\cost-estimator.ts`
18. `server\portfolio\domain\rebalancing\tax-lot-selection.ts`
19. `server\portfolio\domain\rebalancing\cadence-and-turnover-policy.ts`
20. `server\portfolio\domain\rebalancing\interim-authorization.ts`
21. `server\portfolio\domain\rebalancing\action-buckets.ts`
22. `server\portfolio\domain\rebalancing\rebalance-plan.ts`
23. `server\portfolio\domain\rebalancing\plan-equivalence.ts`
24. `server\portfolio\domain\rebalancing\plan-lifecycle.ts`

### Create Runtime Source – Ports

25. `server\portfolio\ports\rebalancing\planning-snapshot-port.ts`
26. `server\portfolio\ports\rebalancing\policy-and-turnover-port.ts`
27. `server\portfolio\ports\rebalancing\plan-history-port.ts`
28. `server\portfolio\ports\rebalancing\optimizer-port.ts`

### Create Runtime Source – Application

29. `server\portfolio\application\rebalancing\planning-snapshot-assembler.ts`
30. `server\portfolio\application\rebalancing\optimizer-orchestration-service.ts`
31. `server\portfolio\application\rebalancing\rebalance-planning-service.ts`

### Create Runtime Source – Adapters

32. `server\portfolio\adapters\optimization\greedy-baseline-optimizer-adapter.ts`
33. `server\portfolio\adapters\optimization\small-problem-oracle-optimizer-adapter.ts`

### Create Test Support

34. `tests\portfolio\rebalancing\support\fixtures.ts`
35. `tests\portfolio\rebalancing\support\arbitraries.ts`
36. `tests\portfolio\rebalancing\support\oracle.ts`
37. `tests\portfolio\rebalancing\support\model-commands.ts`
38. `tests\portfolio\rebalancing\support\u04-rule-evidence.ts`

### Create Test Source

39. `tests\portfolio\rebalancing\architecture.test.ts`
40. `tests\portfolio\rebalancing\planning-gate.test.ts`
41. `tests\portfolio\rebalancing\ideal-target.test.ts`
42. `tests\portfolio\rebalancing\executable-target.test.ts`
43. `tests\portfolio\rebalancing\cost-tax.test.ts`
44. `tests\portfolio\rebalancing\cadence-turnover.test.ts`
45. `tests\portfolio\rebalancing\interim-authorization.test.ts`
46. `tests\portfolio\rebalancing\rebalance-plan.test.ts`
47. `tests\portfolio\rebalancing\optimizer.test.ts`
48. `tests\portfolio\rebalancing\edge-cases.test.ts`
49. `tests\portfolio\rebalancing\rebalancing.property.test.ts`
50. `tests\portfolio\rebalancing\rebalancing.model.test.ts`

### Create Benchmark and Documentation

51. `benchmark\portfolio-rebalancing.ts`
52. `aidlc-docs\construction\u04-construction-rebalancing\code\code-summary.md`

## Coverage Commitments

### Story Coverage

- **US-015**: planning gate, candidate projection, ideal target construction, executable allocation, implementation shortfall, constraint verification
- **US-016**: cadence policy, drift band logic, preferred holds, turnover aggregation, no same-session routine execution
- **US-017**: effective-dated cost schedules, tax rules, lot selection, after-drag replacement suppression, hard-risk override precedence
- **US-018**: proposed/skipped/blocked action buckets, structured reasons, approval-ready summary, deterministic plan equivalence and hash stability
- **US-019**: interim authorization families, AI prohibition, fail-closed overrides, scope-limited risk reductions
- **US-020**: optimizer port, bounded request validation, verifier rejection, explicit timeout metadata, deterministic greedy fallback, small-problem oracle checks

### Functional Rule Coverage Plan

- **GAT (12 rules)** -> planning-gate example tests, hostile-input examples, property invariants
- **TGT (14 rules)** -> ideal-target examples and properties
- **EXE (15 rules)** -> executable-target examples, allocation invariants, no-trade and reconciliation cases
- **OPT (10 rules)** -> optimizer examples, oracle support, fallback properties
- **CTT (15 rules)** -> cost-tax examples, lot-selection cases, shared schedule fixtures
- **CAD (14 rules)** -> cadence-turnover examples, edge cases, stateful models
- **INT (10 rules)** -> interim-authorization examples and model commands
- **PLN (17 rules)** -> rebalance-plan examples, edge cases, equivalence properties, lifecycle model checks
- **ABU (10 rules)** -> architecture tests, hostile-input examples, fail-closed properties and model transitions

### NFR and Extension Coverage Plan

- **Capacity and performance** -> named constants, gate limits, benchmark harness, explicit script thresholds
- **Determinism and reliability** -> canonical hashing, frozen snapshots, shared verifier, no ambient nondeterminism, exact-value-only arithmetic
- **Availability and security** -> explicit timeouts, fail-closed schedules, secret-free reason payloads, no new runtime dependency, no SQL or network construction from plan data
- **Observability** -> typed lineage, phase durations, optimizer metadata, turnover summaries, action-ledger counts
- **Testing and PBT** -> reusable arbitraries, 1,000-run properties, 250-sequence models, 100 oracle problems, seed and shrink visibility, permanent regression examples
- **Maintainability** -> explicit exports, acyclic boundaries, forbidden-import scans, declaration review, benchmark include control, no committed generated artifacts

## Part 2 Execution Rules

- Every remaining checkbox below is intentionally `[ ]` and must stay `[ ]` until Part 2 executes that exact step.
- No step may be skipped, renumbered, or silently merged during execution without updating this plan.
- No persistence schema, migration, database-path, API, frontend, deployment, or live-trading artifact may be introduced while executing U04.
- The plan must be updated in place during Part 2 so completed steps become `[x]` in the same interaction that performs the work.

## Dependency-Safe Execution Sequence

### Shared Contracts and Constants

- [x] **Step 1: Extend branded identifier support in `server\portfolio\domain\shared\identifiers.ts`.**  
  Add parsers and branded types for `CostScheduleVersionId`, `TaxRuleVersionId`, `TurnoverSnapshotId`, and `CalendarSessionId`; keep the existing parser pattern, `IDENTIFIER_PATTERN`, and named-export style unchanged.  
  **Story/Rule/NFR**: US-017, US-018; GAT-007, GAT-008, PLN-011; `NFR-U04-SEC-003`, `NFR-U04-MAINT-005`.  
  **Verification**: identifier cases land in `planning-gate.test.ts` and `architecture.test.ts`.

- [x] **Step 2: Append the missing U04 failure codes to `server\portfolio\domain\errors\failure.ts`.**  
  Preserve the additive const-array pattern, keep existing codes untouched, do not duplicate the five U04 codes already present (`PORTFOLIO_SCOPE_MISMATCH`, `PORTFOLIO_ARCHIVED`, `CAPABILITY_BOUNDARY_VIOLATION`, `SHORT_POSITION_FORBIDDEN`, and `LEVERAGE_FORBIDDEN`), and add grouped U04 comments by subsystem (`GAT`, `TGT`, `EXE`, `OPT`, `CTT`, `CAD`, `INT`, `PLN`, `ABU`).  
  **Story/Rule/NFR**: all U04 stories; all 117 functional rules; `NFR-U04-REL-009`, `NFR-U04-SEC-011`, `NFR-U04-MAINT-005`.  
  **Verification**: `u04-rule-evidence.ts`, root architecture rule-count assertion, and focused example tests all assert stable code usage.

- [x] **Step 3: Create `server\portfolio\domain\shared\rebalancing-constants.ts`.**  
  Define named U04 limits, timing defaults, benchmark budgets, optimizer caps, rule-family names, and explanation-safe numeric constants only; no magic numbers remain scattered across runtime or tests.  
  **Story/Rule/NFR**: US-015 through US-020; CAP-003..CAP-013; `NFR-U04-MAINT-009`.  
  **Verification**: imported by runtime, tests, and benchmark with no duplicate constant definitions.

- [x] **Step 4: Create the U04 reason catalog and safe observability payload builder.**  
  Create `server\portfolio\domain\shared\rebalancing-reasons.ts` to centralize constraint families, planner reason codes, explanation keys, urgency categories, blocking-prerequisite codes, and stable allowlisted explanation templates. Create `server\portfolio\domain\shared\safe-observability-payload-builder.ts` to build typed, bounded, secret-free explainability and observability payloads from domain values and canonical hashes. Do not embed arbitrary upstream text or stack messages.  
  **Story/Rule/NFR**: US-018, US-019; TGT-013, EXE-013, PLN-003..PLN-005, PLN-017, ABU-008; `NFR-U04-SEC-004`, `NFR-U04-SEC-005`, `NFR-U04-OBS-004`, `NFR-U04-OBS-007`.  
  **Verification**: `rebalance-plan.test.ts`, `edge-cases.test.ts`, and `architecture.test.ts`.

- [x] **Step 5: Create `server\portfolio\domain\shared\canonical-plan-hash.ts`.**  
  Implement canonical JSON sorting, `bigint` string encoding, logical-order-key derivation, `planInputHash`, `planHash`, and optimizer-request hashing with the same canonical semantics as approved U02/U03 behavior but without importing adapter code.  
  **Story/Rule/NFR**: US-018, US-020; GAT-011, GAT-012, OPT-003, PLN-005..PLN-011, ABU-005; `NFR-U04-DET-003`..`NFR-U04-DET-010`, `NFR-U04-OBS-001`.  
  **Verification**: `rebalancing.property.test.ts`, `optimizer.test.ts`, `edge-cases.test.ts`, benchmark hash phase.

### U04-Specific Ports

- [x] **Step 6: Create `server\portfolio\ports\rebalancing\planning-snapshot-port.ts`.**  
  Define the immutable snapshot-loading contract for one plan request only: portfolio snapshot, holdings, lots, strategy config lineage, evaluation outputs, corporate-action state, and confirmed session metadata. Do not expose persistence internals, SQL types, or adapter classes.  
  **Story/Rule/NFR**: US-015, US-018; GAT-001..GAT-010; `NFR-U04-SEC-001`, `NFR-U04-MAINT-001`, `NFR-U04-MAINT-005`.  
  **Verification**: `architecture.test.ts` import-boundary assertions and declaration review.

- [x] **Step 7: Create `server\portfolio\ports\rebalancing\policy-and-turnover-port.ts` and `server\portfolio\ports\rebalancing\plan-history-port.ts`.**  
  The first resolves effective-dated cost, tax, and turnover snapshots with explicit timeout inputs; the second queries prior plan lineage, equivalence, supersession, invalidation, and expiry facts. Avoid duplicating U02 repository conventions or inventing transaction APIs.  
  **Story/Rule/NFR**: US-017, US-018, US-019; GAT-007, CTT-001..CTT-007, CAD-010..CAD-013, PLN-007..PLN-016; `NFR-U04-AVAIL-005`, `NFR-U04-AVAIL-007`, `NFR-U04-MAINT-008`.  
  **Verification**: port contract compile checks and focused architecture assertions.

- [x] **Step 8: Create `server\portfolio\ports\rebalancing\optimizer-port.ts`.**  
  Define bounded optimizer request and response DTOs, timeout budget input, duration and iteration metadata, violated-constraint IDs, and fallback-visible status values only; no solver-specific schema leaks. Keep the port interface-only and import shared constraint identifiers rather than the domain `constraint-verifier.ts` implementation; verifier compatibility is structural and enforced by the application orchestrator.  
  **Story/Rule/NFR**: US-020; OPT-001..OPT-010; `NFR-U04-CAP-010`, `NFR-U04-CAP-011`, `NFR-U04-PERF-010`, `NFR-U04-OBS-003`, `NFR-U04-SEC-012`.  
  **Verification**: `optimizer.test.ts`, `rebalancing.property.test.ts`, declaration review.

### Domain Construction Modules

- [x] **Step 9: Create `server\portfolio\domain\construction\planning-context.ts`.**  
  Define the frozen planning input shape, normalized context snapshot, constraint-set projection inputs, action-intent markers, and any internal helper DTOs shared by gate, candidate, ideal-target, and verifier flows.  
  **Story/Rule/NFR**: US-015 through US-019; GAT-001..GAT-012; `NFR-U04-DET-001`, `NFR-U04-DET-005`, `NFR-U04-MAINT-001`.  
  **Verification**: compile-only coverage through all downstream U04 modules and tests.

- [x] **Step 10: Create `server\portfolio\domain\construction\planning-gate.ts`.**  
  Validate portfolio scope, canonical IDs, finalized EOD timing, lineage presence, collection bounds, approved turnover-window counts, supported enums, and fail-closed prerequisite safety before any planning algorithm runs.  
  **Story/Rule/NFR**: US-015, US-016, US-017, US-019; GAT-001..GAT-012, ABU-001, ABU-002, ABU-004, ABU-006; `NFR-U04-CAP-001`..`NFR-U04-CAP-012`, `NFR-U04-REL-001`, `NFR-U04-SEC-001`..`NFR-U04-SEC-003`, `NFR-U04-SEC-008`.  
  **Verification**: `planning-gate.test.ts`, `edge-cases.test.ts`, `rebalancing.property.test.ts`.

- [x] **Step 11: Create `server\portfolio\domain\construction\candidate-projection.ts`.**  
  Project current holdings into mandatory exits, hold-eligible incumbents, new entrants, excluded candidates, and blocked candidates using immutable U03 eligibility, signal, regime, classification, and liquidity lineage only.  
  **Story/Rule/NFR**: US-015, US-019; TGT-001..TGT-004, TGT-012, TGT-013, INT-001..INT-010; `NFR-U04-DET-009`, `NFR-U04-REL-005`, `NFR-U04-SEC-006`.  
  **Verification**: `ideal-target.test.ts`, `interim-authorization.test.ts`, `edge-cases.test.ts`.

- [x] **Step 12: Create `server\portfolio\domain\construction\constraint-verifier.ts`.**  
  Project the canonical hard-constraint model and reusable verifier for exposure, cash, single-name, sector, group, small-cap, liquidity, turnover, delivery, minimum-order-value, and timing constraints; expose deterministic binding reasons and disagreement rejection.  
  **Story/Rule/NFR**: US-015, US-016, US-017, US-020; TGT-010..TGT-014, EXE-008..EXE-015, OPT-004..OPT-009, CAD-010..CAD-014, PLN-004..PLN-010, ABU-010; `NFR-U04-PERF-006`, `NFR-U04-REL-002`, `NFR-U04-REL-003`, `NFR-U04-OBS-004`.  
  **Verification**: `executable-target.test.ts`, `optimizer.test.ts`, `rebalancing.property.test.ts`.

- [x] **Step 13: Create `server\portfolio\domain\construction\ideal-target-constructor.ts`.**  
  Implement deterministic candidate ranking, inverse-volatility-times-conviction raw intent, exact normalization, regime exposure cap, cash-buffer reservation, hard cap application, canonical ordering, and explicit excluded-candidate reasons with no filler positions.  
  **Story/Rule/NFR**: US-015; TGT-001..TGT-014; `NFR-U04-PERF-002`, `NFR-U04-DET-002`, `NFR-U04-DET-007`, `NFR-U04-DET-008`, `NFR-U04-TEST-013`.  
  **Verification**: `ideal-target.test.ts`, `rebalancing.property.test.ts`, benchmark ideal-target phase.

- [x] **Step 14: Create `server\portfolio\domain\construction\implementation-shortfall.ts`.**  
  Calculate exact weight, cash, notional, and drag gaps plus deterministic binding reasons between ideal and executable outputs; keep the calculation independent from summary rendering and order execution.  
  **Story/Rule/NFR**: US-015, US-018; PLN-009, PLN-010; `NFR-U04-OBS-005`, `NFR-U04-DET-002`, `NFR-U04-TEST-003`.  
  **Verification**: `executable-target.test.ts`, `rebalance-plan.test.ts`, `edge-cases.test.ts`.

### Domain Rebalancing Modules

- [x] **Step 15: Create `server\portfolio\domain\rebalancing\whole-share-greedy-allocator.ts`.**  
  Floor ideal targets to whole shares using finalized decision prices, preserve explicit residual cash, enforce no shorting, no leverage, no negative cash, delivery caps, deterministic increment ordering, and no-trade recognition.  
  **Story/Rule/NFR**: US-015, US-020; EXE-001..EXE-015, ABU-007; `NFR-U04-PERF-003`, `NFR-U04-PERF-004`, `NFR-U04-REL-004`, `NFR-U04-TEST-013`.  
  **Verification**: `executable-target.test.ts`, `rebalancing.property.test.ts`, benchmark seed and greedy phases.

- [x] **Step 16: Create `server\portfolio\domain\rebalancing\cost-estimator.ts`.**  
  Resolve selected cost-schedule version inputs into exact brokerage, STT, exchange, GST, SEBI, stamp duty, DP, spread, slippage, impact, and broker-fee estimates; missing cost inputs must block discretionary output instead of defaulting to zero.  
  **Story/Rule/NFR**: US-017; CTT-001..CTT-005, CTT-014, CTT-015; `NFR-U04-PERF-005`, `NFR-U04-REL-001`, `NFR-U04-OBS-005`.  
  **Verification**: `cost-tax.test.ts`, `edge-cases.test.ts`, benchmark cost phase.

- [x] **Step 17: Create `server\portfolio\domain\rebalancing\tax-lot-selection.ts`.**  
  Implement effective-dated tax-rule selection, deterministic FIFO and HIFO ordering, SPECIFIC-instruction enforcement, provisional FIFO estimation for mandatory hard-risk exits only, and exact short- versus long-term classification.  
  **Story/Rule/NFR**: US-017, US-019; CTT-006..CTT-015, INT-008; `NFR-U04-DET-008`, `NFR-U04-REL-008`, `NFR-U04-TEST-014`.  
  **Verification**: `cost-tax.test.ts`, `edge-cases.test.ts`, `rebalancing.property.test.ts`.

- [x] **Step 18: Create `server\portfolio\domain\rebalancing\cadence-and-turnover-policy.ts`.**  
  Enforce routine cadence, drift-review cadence, the greater-of absolute and relative drift band, preferred holds, hold-rank buffers, replacement hurdles, minimum-order-value netting inputs, and aggregate turnover-window consumption per portfolio.  
  **Story/Rule/NFR**: US-016, US-017; CAD-001..CAD-014, EXE-011; `NFR-U04-REL-006`, `NFR-U04-OBS-006`, `NFR-U04-TEST-013`, `NFR-U04-TEST-014`.  
  **Verification**: `cadence-turnover.test.ts`, `rebalancing.property.test.ts`, `rebalancing.model.test.ts`.

- [x] **Step 19: Create `server\portfolio\domain\rebalancing\interim-authorization.ts`.**  
  Deny interim planning by default, require exactly one verified reason family, reject AI-only evidence, constrain confirmed-regime exceptions to reductions or exits only, and preserve hard-risk override precedence without bypassing executable limits.  
  **Story/Rule/NFR**: US-019; INT-001..INT-010, ABU-008; `NFR-U04-SEC-006`, `NFR-U04-REL-008`, `NFR-U04-TEST-003`, `NFR-U04-TEST-014`.  
  **Verification**: `interim-authorization.test.ts`, `edge-cases.test.ts`, `rebalancing.model.test.ts`.

- [x] **Step 20: Create `server\portfolio\domain\rebalancing\action-buckets.ts`.**  
  Build immutable proposed, skipped, and blocked action buckets with stable reason bundles, urgency categories, logical-order-key inputs, and binding constraint references; keep action-state transitions explicit and fail closed.  
  **Story/Rule/NFR**: US-018, US-019; PLN-001..PLN-005, ABU-009; `NFR-U04-OBS-004`, `NFR-U04-OBS-007`, `NFR-U04-SEC-005`, `NFR-U04-SEC-011`.  
  **Verification**: `rebalance-plan.test.ts`, `edge-cases.test.ts`, `rebalancing.property.test.ts`.

- [x] **Step 21: Create `server\portfolio\domain\rebalancing\rebalance-plan.ts`.**  
  Define the immutable U04 aggregate, approval-ready summary builders, current-versus-projected concentration views, typed observability payloads, and canonical public DTO assembly without U05 approval or execution states.  
  **Story/Rule/NFR**: US-018; PLN-002, PLN-009..PLN-017; `NFR-U04-OBS-001`..`NFR-U04-OBS-008`, `NFR-U04-SEC-004`, `NFR-U04-SEC-007`.  
  **Verification**: `rebalance-plan.test.ts`, declaration review, `edge-cases.test.ts`.

- [x] **Step 22: Create `server\portfolio\domain\rebalancing\plan-equivalence.ts`.**  
  Derive logical-order keys, `planInputHash`, `planHash`, duplicate-prevention comparison helpers, and semantic-equivalence checks using the canonical hash helper and stable action ordering only.  
  **Story/Rule/NFR**: US-018, US-020; GAT-011, GAT-012, PLN-005..PLN-011, ABU-005; `NFR-U04-DET-003`..`NFR-U04-DET-010`, `NFR-U04-AVAIL-003`.  
  **Verification**: `rebalance-plan.test.ts`, `rebalancing.property.test.ts`, benchmark replay-equivalence phase.

- [x] **Step 23: Create `server\portfolio\domain\rebalancing\plan-lifecycle.ts`.**  
  Model only `DRAFT`, `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED`, enforce allowed transitions, preserve immutable history, and reject unsupported state changes or stale-ready reuse.  
  **Story/Rule/NFR**: US-018, US-019; PLN-012..PLN-016, ABU-009; `NFR-U04-REL-007`, `NFR-U04-TEST-009`, `NFR-U04-TEST-014`.  
  **Verification**: `rebalance-plan.test.ts`, `rebalancing.model.test.ts`, `edge-cases.test.ts`.

### Application Services and Optimizer Adapters

- [x] **Step 24: Create `server\portfolio\application\rebalancing\planning-snapshot-assembler.ts`.**  
  Assemble one immutable planning snapshot from the new ports, enforce explicit timeout budgets, freeze returned structures, and block oversized or cross-portfolio inputs before domain planning begins.  
  **Story/Rule/NFR**: US-015 through US-019; GAT-001..GAT-010; `NFR-U04-DET-005`, `NFR-U04-DET-006`, `NFR-U04-AVAIL-005`, `NFR-U04-REL-005`, `NFR-U04-REL-010`.  
  **Verification**: `architecture.test.ts`, `planning-gate.test.ts`, `rebalancing.model.test.ts`.

- [x] **Step 25: Create `server\portfolio\application\rebalancing\optimizer-orchestration-service.ts`.**  
  Decide optimizer eligibility, materialize bounded requests, call `OptimizerPort`, re-verify every response through the shared verifier, and surface deterministic fallback metadata on timeout, infeasibility, missing metadata, or verification rejection.  
  **Story/Rule/NFR**: US-020; OPT-001..OPT-010; `NFR-U04-PERF-010`, `NFR-U04-PERF-011`, `NFR-U04-PERF-013`, `NFR-U04-OBS-003`, `NFR-U04-AVAIL-006`.  
  **Verification**: `optimizer.test.ts`, `rebalancing.property.test.ts`, benchmark optimizer phases.

- [x] **Step 26: Create `server\portfolio\application\rebalancing\rebalance-planning-service.ts`.**  
  Orchestrate snapshot assembly, gate validation, candidate projection, ideal target construction, cost and tax estimation, cadence and interim policy, greedy allocation, optional optimizer path, plan assembly, equivalence, and lifecycle output. Keep the service pure with injected dependencies only.  
  **Story/Rule/NFR**: all U04 stories; all functional subsystems; `NFR-U04-PERF-008`, `NFR-U04-MAINT-001`..`NFR-U04-MAINT-004`, `NFR-U04-OBS-001`, `NFR-U04-REL-009`.  
  **Verification**: focused U04 suite, benchmark full-plan phase, declaration review.

- [x] **Step 27: Create `server\portfolio\adapters\optimization\greedy-baseline-optimizer-adapter.ts`.**  
  Implement `OptimizerPort` with deterministic greedy-shaped results, explicit metadata, and no objective search beyond the canonical greedy baseline.  
  **Story/Rule/NFR**: US-020; OPT-001, OPT-005..OPT-009; `NFR-U04-REL-004`, `NFR-U04-AVAIL-006`.  
  **Verification**: `optimizer.test.ts`, `rebalancing.property.test.ts`.

- [x] **Step 28: Create `server\portfolio\adapters\optimization\small-problem-oracle-optimizer-adapter.ts`.**  
  Implement a tiny bounded exhaustive or exact oracle for small reference problems only, expose strict input caps, and keep it test or benchmark focused rather than required for normal production planning.  
  **Story/Rule/NFR**: US-020; OPT-010; `NFR-U04-TEST-010`, `NFR-U04-SEC-012`, `NFR-U04-MAINT-008`.  
  **Verification**: `optimizer.test.ts`, `rebalancing.property.test.ts`, benchmark oracle phase.

### Public Export and Build Surface

- [x] **Step 29: Update `server\portfolio\index.ts` with explicit named U04 exports only.**  
  Export new shared constants, reason and hash helpers, types and constructors for U04 aggregate and domain modules, new rebalancing ports, application services, and optimizer adapters; preserve existing U01-U03 exports unchanged and avoid `export *`.  
  **Story/Rule/NFR**: all U04 stories; `NFR-U04-MAINT-005`, `NFR-U04-MAINT-006`, `NFR-U04-SEC-004`, `NFR-U04-SEC-009`.  
  **Verification**: root architecture test, declaration review, compile.

- [x] **Step 30: Reserve the strict TypeScript build-surface update for the U04 benchmark.**  
  Confirm `server\portfolio\tsconfig.json` needs only the additive `..\..\benchmark\portfolio-rebalancing.ts` include. Do not add the include until Step 50 creates the referenced file, do not weaken any strict compiler option, and do not touch `tsconfig.contracts.json` unless U04 execution proves it is necessary, which current include rules do not indicate.  
  **Story/Rule/NFR**: verification-only support; `NFR-U04-MAINT-004`, `NFR-U04-PERF-014`.  
  **Verification**: `tsc -p server/portfolio/tsconfig.json --noEmit`.

- [x] **Step 31: Update `package.json` with focused U04 scripts only.**  
  Add `test:portfolio:u04`, `bench:portfolio:u04`, and `verify:portfolio:u04`; keep existing scripts intact and do not alter default proxy, UI, or legacy compatibility commands.  
  **Story/Rule/NFR**: all U04 stories through verification; `NFR-U04-TEST-015`, `NFR-U04-PERF-014`, `NFR-U04-MAINT-010`.  
  **Verification**: script resolution succeeds for all new commands.

### Test Support and Architecture Boundaries

- [x] **Step 32: Create `tests\portfolio\rebalancing\support\fixtures.ts`.**  
  Build reusable fake-only planning snapshots, effective-dated schedules, turnover histories, plan-history cases, and the eight mandatory edge scenarios plus any approved AD-C-specific observability examples.  
  **Story/Rule/NFR**: all U04 stories; `NFR-U04-TEST-003`, `NFR-U04-TEST-004`, `NFR-U04-TEST-015`.  
  **Verification**: imported across example, property, model, and benchmark suites with no real credentials or persisted user data.

- [x] **Step 33: Create `tests\portfolio\rebalancing\support\arbitraries.ts`.**  
  Provide reusable `fast-check` generators for exact values, holdings, lots, candidates, schedules, turnover windows, interim proofs, optimizer responses, and hostile-input shapes; generators must preserve structural validity and shrinking usefulness.  
  **Story/Rule/NFR**: all U04 stories; PBT-07, PBT-08; `NFR-U04-TEST-006`..`NFR-U04-014`.  
  **Verification**: used by both property and model suites; shrinking remains enabled.

- [x] **Step 34: Create `tests\portfolio\rebalancing\support\oracle.ts`.**  
  Provide small-problem oracle helpers and exact equivalence or improvement checks used by optimizer tests and expensive PBT. Keep the helper detached from production planning service code.  
  **Story/Rule/NFR**: US-015, US-017, US-020; OPT-010; PBT-05; `NFR-U04-TEST-010`, `NFR-U04-TEST-014`.  
  **Verification**: consumed by `optimizer.test.ts` and `rebalancing.property.test.ts`.

- [x] **Step 35: Create `tests\portfolio\rebalancing\support\model-commands.ts`.**  
  Define stateful command generators and reference models for lifecycle, duplicate-plan replay, turnover aggregation, and interim-authorization safety. Keep generated command fixtures intentionally small (at most 10 holdings, 50 lots, and 5 candidates) so model depth, rather than boundary-scale data, is exercised; boundary capacities belong in Step 50 benchmarks.  
  **Story/Rule/NFR**: US-016, US-018, US-019; CAD-010..CAD-013, PLN-012..PLN-016, ABU-005, ABU-009; PBT-06; `NFR-U04-TEST-009`, `NFR-U04-TEST-014`.  
  **Verification**: imported by `rebalancing.model.test.ts`.

- [x] **Step 36: Create `tests\portfolio\rebalancing\support\u04-rule-evidence.ts`.**  
  Record 117 unique functional-rule entries with descriptions and one or more U04 test-file references; keep ordering deterministic by subsystem and rule ID.  
  **Story/Rule/NFR**: all U04 stories; all 117 functional rules; `NFR-U04-TEST-002`, `NFR-U04-MAINT-005`.  
  **Verification**: focused and root architecture tests assert the count and uniqueness.

- [x] **Step 37: Create `tests\portfolio\rebalancing\architecture.test.ts`.**  
  Add focused U04 import-boundary, no-wildcard-export, no-legacy-module-import, no-ambient-clock-randomness, no adapter leakage, and no forbidden persistence-internal import tests for all new runtime directories.  
  **Story/Rule/NFR**: all U04 stories; ABU-001..ABU-010; `NFR-U04-MAINT-001`..`NFR-U04-MAINT-010`, `NFR-U04-DET-005`, `NFR-U04-SEC-009`.  
  **Verification**: included in `test:portfolio:u04`.

- [x] **Step 38: Extend `tests\portfolio\architecture.test.ts` for U04 coverage.**  
  Add U04 rule-evidence count and uniqueness checks, add the new U04 directories to forbidden-import scanning, and preserve all existing U01-U03 assertions unchanged.  
  **Story/Rule/NFR**: repository-wide portfolio contract safety; `NFR-U04-TEST-002`, `NFR-U04-MAINT-002`, `NFR-U04-MAINT-003`, `NFR-U04-MAINT-005`.  
  **Verification**: root portfolio architecture suite passes with U01-U04 coverage.

### Example-Based Functional Tests

- [x] **Step 39: Create `tests\portfolio\rebalancing\planning-gate.test.ts`.**  
  Cover canonical scope validation, missing lineage, non-finalized data, invalid session metadata, oversized collections, unsupported enums, and fail-closed prerequisite rejection.  
  **Story/Rule/NFR**: US-015, US-016, US-017, US-019; GAT-001..GAT-012, ABU-001, ABU-002, ABU-004, ABU-006; `NFR-U04-REL-001`, `NFR-U04-SEC-001`..`NFR-U04-SEC-003`.  
  **Verification**: all named examples pass in focused U04 suite.

- [x] **Step 40: Create `tests\portfolio\rebalancing\ideal-target.test.ts`.**  
  Cover candidate retention, exclusion reasons, exact normalization, no filler positions, regime exposure caps, classification-required blocks, and canonical ordering.  
  **Story/Rule/NFR**: US-015; TGT-001..TGT-014; `NFR-U04-PERF-002`, `NFR-U04-DET-007`, `NFR-U04-TEST-001`, `NFR-U04-TEST-003`.  
  **Verification**: exact expected values for deterministic fixtures.

- [x] **Step 41: Create `tests\portfolio\rebalancing\executable-target.test.ts`.**  
  Cover whole-share seed behavior, residual cash preservation, no leverage or shorting, delivery limits, deterministic increment ordering, valid no-trade plans, and quantified implementation shortfall.  
  **Story/Rule/NFR**: US-015; EXE-001..EXE-015, PLN-010, ABU-007; `NFR-U04-PERF-003`, `NFR-U04-PERF-004`, `NFR-U04-TEST-003`, `NFR-U04-TEST-013`.  
  **Verification**: exact quantities, cash, and reason bundles pinned by examples.

- [x] **Step 42: Create `tests\portfolio\rebalancing\cost-tax.test.ts`.**  
  Cover effective-dated schedule resolution, full charge composition, missing-cost blocks, FIFO, HIFO, SPECIFIC, provisional FIFO for mandatory hard-risk exits, holding-period classification, and after-drag replacement skipping.  
  **Story/Rule/NFR**: US-017, US-019; CTT-001..CTT-015; `NFR-U04-PERF-005`, `NFR-U04-REL-008`, `NFR-U04-TEST-001`, `NFR-U04-TEST-003`.  
  **Verification**: exact cost and tax components pinned by named scenarios.

- [x] **Step 43: Create `tests\portfolio\rebalancing\cadence-turnover.test.ts`.**  
  Cover biweekly, monthly, and quarterly cadence gates; no-trade-band behavior; preferred holds; replacement hurdles; rolling, monthly, quarterly, and yearly turnover limits; and same-session routine rejection.  
  **Story/Rule/NFR**: US-016; CAD-001..CAD-014; `NFR-U04-REL-006`, `NFR-U04-OBS-006`, `NFR-U04-TEST-001`, `NFR-U04-TEST-003`.  
  **Verification**: named examples for all four window kinds and preset families.

- [x] **Step 44: Create `tests\portfolio\rebalancing\interim-authorization.test.ts`.**  
  Cover allowed and disallowed interim reason families, AI-only rejection, regime-reduction sell-only scope, verified-corporate-action minimal changes, and hard-risk override precedence.  
  **Story/Rule/NFR**: US-019; INT-001..INT-010; `NFR-U04-SEC-006`, `NFR-U04-REL-008`, `NFR-U04-TEST-001`, `NFR-U04-TEST-003`.  
  **Verification**: named exception cases remain deterministic and fail closed.

- [x] **Step 45: Create `tests\portfolio\rebalancing\rebalance-plan.test.ts`.**  
  Cover proposed/skipped/blocked buckets, approval-ready summaries, safe explanations, deterministic hashes, logical-order-key stability, supersession eligibility, invalidation, and expiry transitions.  
  **Story/Rule/NFR**: US-018; PLN-001..PLN-017, ABU-005, ABU-009; `NFR-U04-OBS-001`..`NFR-U04-OBS-008`, `NFR-U04-REL-007`, `NFR-U04-SEC-007`.  
  **Verification**: exact summary and hash expectations pinned by examples.

- [x] **Step 46: Create `tests\portfolio\rebalancing\optimizer.test.ts`.**  
  Cover bounded request validation, accepted verified output, timeout fallback, infeasible fallback, metadata requirements, verifier rejection, and small-problem oracle equivalence or improvement tolerance.  
  **Story/Rule/NFR**: US-020; OPT-001..OPT-010; `NFR-U04-PERF-010`, `NFR-U04-PERF-011`, `NFR-U04-OBS-003`, `NFR-U04-TEST-001`, `NFR-U04-TEST-003`.  
  **Verification**: exact fallback status and metadata pinned by examples.

- [x] **Step 47: Create `tests\portfolio\rebalancing\edge-cases.test.ts`.**  
  Pin the eight mandatory business-rule scenarios plus at least one observable example for every AD-C decision that materially affects runtime behavior, and reserve this file for future shrunk-regression additions.  
  **Story/Rule/NFR**: all U04 stories; mandatory example scenarios 1 through 8; `NFR-U04-TEST-003`, `NFR-U04-TEST-015`, PBT-10.  
  **Verification**: file stays pure example-based, stable, and human-readable.

### Property-Based and Model-Based Verification

- [x] **Step 48: Create `tests\portfolio\rebalancing\rebalancing.property.test.ts`.**  
  Implement >=1,000-run properties for canonical hash determinism, permutation-equivalent replay, exact weight and cash invariants, no shorting, no leverage, delivery limits, turnover monotonicity, greedy idempotence, verifier soundness, and optimizer fallback equivalence.  
  **Story/Rule/NFR**: all U04 stories, especially US-015 through US-020; PBT-02..PBT-08; `NFR-U04-TEST-008`, `NFR-U04-TEST-011`..`NFR-U04-014`.  
  **Verification**: seeds and shrunk counterexamples are visible on failure.

- [x] **Step 49: Create `tests\portfolio\rebalancing\rebalancing.model.test.ts`.**  
  Implement >=250 command-sequence model runs of length 1 through 100 for lifecycle legality, duplicate-plan replay, turnover aggregation across repeated runs, and interim-authorization safety under mixed routine and interim requests. Use the bounded model fixtures from Step 35 (at most 10 holdings, 50 lots, and 5 candidates per command) so the suite remains CI-executable.  
  **Story/Rule/NFR**: US-016, US-018, US-019; PBT-06; `NFR-U04-TEST-009`, `NFR-U04-TEST-014`, `NFR-U04-REL-007`, `NFR-U04-REL-010`.  
  **Verification**: model and real outputs remain equivalent after each generated command.

### Benchmark, Summary, and Final Verification

- [x] **Step 50: Create `benchmark\portfolio-rebalancing.ts`.**  
  Implement a boundary-aware custom harness with fixed seeds, warm-up, p50, p95, max, heap delta, input sizes, Node and OS metadata, and non-zero exit on threshold breach; cover hash, ideal target, executable seed, greedy allocation, cost and tax, verifier, full plan, replay equivalence, optimizer timeout, fallback, and oracle paths. In the same step, add the now-valid `..\..\benchmark\portfolio-rebalancing.ts` include to `server\portfolio\tsconfig.json` without changing strict options.  
  **Story/Rule/NFR**: US-015, US-017, US-018, US-020; `NFR-U04-PERF-001`..`NFR-U04-PERF-014`, `NFR-U04-CAP-013`, `NFR-U04-MAINT-010`.  
  **Verification**: `npm run bench:portfolio:u04` measures all declared thresholds without slowing `npm test`.

- [x] **Step 51: Create `aidlc-docs\construction\u04-construction-rebalancing\code\code-summary.md`.**  
  Summarize modified versus created files, exported U04 surfaces, story coverage, rule-evidence results, PBT coverage, benchmark outcomes, and compatibility results; do not add planning notes or duplicate design docs.  
  **Story/Rule/NFR**: stage closeout support; `NFR-U04-MAINT-006`, `NFR-U04-TEST-015`.  
  **Verification**: summary matches the executed plan and file list exactly.

- [x] **Step 52: Run declaration and typecheck verification.**  
  Execute `tsc -p server/portfolio/tsconfig.json --noEmit` and `tsc -p server/portfolio/tsconfig.contracts.json`; inspect emitted declaration changes under the existing contracts output path and block approval on unexpected public drift.  
  **Story/Rule/NFR**: all U04 stories through contract review; `NFR-U04-MAINT-004`, `NFR-U04-MAINT-006`.  
  **Verification**: both commands pass and declaration drift is reviewed.

- [x] **Step 53: Run focused U04 verification.**  
  Execute `npm run test:portfolio:u04` and `npm run verify:portfolio:u04`; require focused examples, properties, models, architecture checks, contracts, typecheck, and U04 benchmark enforcement to pass.  
  **Story/Rule/NFR**: all U04 stories; all 117 functional rules; all 100 U04 NFRs; PBT-02..PBT-10.  
  **Verification**: zero focused-suite failures and all benchmark gates green.

- [x] **Step 54: Run the complete portfolio and repository compatibility suites.**  
  Execute `npm run test:portfolio`, `npm run test:portfolio:persistence`, `npm run test:portfolio:u03`, and `npm test`; U04 must introduce zero regressions and must not increase the established unrelated full-repository legacy-failure baseline.  
  **Story/Rule/NFR**: portfolio-package compatibility and protected legacy behavior; `NFR-U04-MAINT-003`, `NFR-U04-MAINT-010`, AD-C15.  
  **Verification**: all portfolio suites pass; any remaining full-suite failures must match the known pre-U04 unrelated baseline exactly.

- [x] **Step 55: Perform final U04 completion review and update this plan.**  
  Confirm every created path is unique, every modified file stayed within scope, all 6 stories are covered, the `u04-rule-evidence.ts` table contains 117 unique rule entries, U04 NFR obligations remain 100/100 covered, Security/Resiliency/PBT-Full compliance stays non-blocking, no duplicate runtime files were created, and every completed step in this plan is marked `[x]` before stage close.  
  **Story/Rule/NFR**: entire unit closeout; all U04 stories, all rules, all NFRs, all enabled extensions.  
  **Verification**: checklist complete, no out-of-scope files changed, and this plan remains the final execution record.

## Expected Final Verification Thresholds

- **Stories**: US-015 through US-020 each have explicit example coverage plus supporting property or model coverage where applicable.
- **Functional rules**: 117 of 117 rules are represented in `tests\portfolio\rebalancing\support\u04-rule-evidence.ts` and validated by architecture tests.
- **NFRs**: 100 of 100 `NFR-U04-*` requirements remain mapped to code, tests, benchmark, or declaration review outcomes.
- **Property testing**: pure properties run with `numRuns >= 1000`; stateful model tests run `>= 250` sequences with lengths `1..100`; expensive optimizer or oracle properties run `>= 100` generated small problems.
- **Benchmarks**: U04 benchmark enforces the approved p95 and heap budgets from `nfr-requirements.md`, including `<40 ms` input hashing, `<250 ms` ideal target, `<60 ms` executable seed, `<300 ms` greedy allocation, `<200 ms` cost and tax, `<75 ms` verifier, `<80 ms` plan assembly and hash, `<120 ms` replay equivalence, `<1.8 s` full plan, `<=250 ms` default optimizer timeout with `<=750 ms` hard cap, `<400 ms` failure-to-fallback, `<192 MiB` full-plan heap delta, and `<64 MiB` optimizer-overhead heap delta.
- **Compatibility**: focused U04 verification passes, all portfolio-package suites pass, and the full repository suite shows no new failures.
- **Security**: no secrets, tokens, broker credentials, account numbers, or raw exception text appear in runtime exports, reasons, tests, or summary output.
- **Resiliency**: all dependency timeouts are explicit inputs, optimizer failure degrades only to verified greedy planning, and no same-session routine execution is emitted.
- **Scope discipline**: no schema or migration files, no API or frontend files, no deployment assets, no generated JavaScript, and no benchmark output files are committed for U04.

## Extension Compliance Plan

| Extension rule set | Planned result | U04 execution expectation |
|---|---|---|
| Security Baseline | Compliant or N/A only | Validate untrusted inputs, keep explanations allowlisted and secret-free, add no unsafe dependency or raw external text path, and fail closed on all unsafe conditions. |
| Resiliency Baseline | Compliant or N/A only | Preserve explicit dependency timeouts, deterministic replayability, bounded optimizer degradation, portfolio isolation, and no contradictory unit-level DR or deployment assumptions. |
| Property-Based Testing Full | Compliant | Deliver reusable arbitraries, round-trip and invariant properties, idempotence and oracle coverage, stateful models, shrinking, seeds, complementary examples, and permanent regression capture. |

No blocking Security, Resiliency, or Property-Based Testing finding is acceptable at Part 2 completion.
