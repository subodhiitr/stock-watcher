# U04 Construction and Rebalancing NFR Design Plan

## Unit Context

- **Unit**: U04 Construction and Rebalancing
- **Primary stories**: US-015 through US-020
- **Criticality**: Financially critical in-process planning logic inside the approved project **High** workload class
- **Owned outputs only**: `aidlc-docs\construction\plans\u04-construction-rebalancing-nfr-design-plan.md`, `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\nfr-design-patterns.md`, and `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\logical-components.md`
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes – Full)
- **Current implemented portfolio layout consulted**: `server\portfolio\domain\shared`, `domain\portfolio`, `domain\market-data`, `domain\strategy`, `application\strategy`, `ports`, `adapters\persistence`, `infrastructure\persistence`, and `infrastructure\resilience`

## Autopilot Mode Notice

The user directed this stage to continue under autopilot. All material NFR-design ambiguities are therefore resolved below as safe numbered decisions with rationale and are treated as answered for this stage.

## Documented Safe Decisions

| # | Ambiguity | Safe decision | Rationale |
| --- | --- | --- | --- |
| AD-D01 | Deployment shape | Keep U04 as in-process local planning logic with no cloud, queue, worker, scheduler, or independent deployment resource. | Matches the approved local workstation topology and the user direction for exact deterministic planning only. |
| AD-D02 | Authoritative existing contract surface | Treat the current `server\portfolio\index.ts` and `server\portfolio\ports\index.ts` exports as the authoritative pre-U04 contract surface. | The implemented module layout already exposes U01 exact values, U02 persistence factories, U03 strategy contracts, and cross-cutting ports; U04 must extend that surface without bypassing it. |
| AD-D03 | Source placement | Add U04 only under `server\portfolio\domain\construction\`, `server\portfolio\domain\rebalancing\`, `server\portfolio\application\rebalancing\`, `server\portfolio\ports\rebalancing\`, and `server\portfolio\adapters\optimization\`. | Preserves the existing modular-monolith layout while keeping U04 isolated from persistence internals and UI/route code. |
| AD-D04 | Snapshot assembly | Assemble one immutable planning snapshot through dedicated ports before domain logic executes. | Eliminates ambient reads and gives the gate one place to validate scope, bounds, and lineage. |
| AD-D05 | Execution model | Use single-thread synchronous planning in the MVP; do not add worker threads unless future benchmark evidence proves the need. | Avoids nondeterministic scheduling and unnecessary operational complexity. |
| AD-D06 | Constraint model | Project one canonical hard-constraint set and reuse it for ideal construction, greedy allocation, optimizer verification, and explainability. | Prevents rule drift between planner paths and simplifies fail-closed verification. |
| AD-D07 | Canonical executable baseline | Make the deterministic greedy allocator the canonical executable planner; any optimizer path is optional and additive only. | Ensures there is always one authoritative safe result even when optional optimization fails or is bypassed. |
| AD-D08 | Optimizer adapters | Support only a greedy-baseline adapter and a small-problem oracle adapter in the MVP; external solvers remain future additive adapters behind `OptimizerPort`. | Meets the user requirement for no solver library while preserving a future migration path. |
| AD-D09 | Effective-dated policy resolution | Resolve cost schedules, tax rules, and turnover snapshots using the latest version effective on or before `asOf`; missing versions fail closed. | Avoids guessing regulatory or cost behavior and preserves replay correctness. |
| AD-D10 | Semantic equivalence | Define duplicate prevention and supersession through canonical hashes plus logical-order keys, never through timestamps or random identifiers. | Equivalent immutable inputs must not create a semantically new plan. |
| AD-D11 | Explainability boundary | Generate human explanations only from allowlisted templates and safe typed context; never surface raw provider, AI, or exception text. | Satisfies security and operator-safety goals while keeping explanations deterministic. |
| AD-D12 | Import boundary | Forbid imports from `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`, Remix routes, `/trade-execution`, `/paper-trades`, and persistence internals. | Preserves U04 as a clean portfolio-planning unit and honors repository guidance. |
| AD-D13 | Resiliency test posture | Capture deterministic failure-injection, replay, timeout, and benchmark scenarios in this stage; execute them later through code generation and build workflows rather than inventing separate DR topology for U04. | Satisfies the enabled resiliency and PBT design obligations without introducing non-existent deployment resources. |

## Plan Steps

- [x] Step 1: Read `.aidlc-rule-details\construction\nfr-design.md` plus the common content-validation and question-format rules.
- [x] Step 2: Read `aidlc-docs\aidlc-state.md` to confirm enabled Security Baseline, Resiliency Baseline, and Property-Based Testing (Full) extensions without modifying state.
- [x] Step 3: Read all approved U04 functional-design artifacts and the U04 functional-design plan.
- [x] Step 4: Read all approved U04 NFR requirements artifacts and the U04 NFR requirements plan.
- [x] Step 5: Read U01, U02, and U03 NFR design patterns and logical components for naming, layering, and compliance conventions.
- [x] Step 6: Inspect the actual implemented `server\portfolio\` module layout plus the current public contract surfaces in `server\portfolio\index.ts` and `server\portfolio\ports\index.ts`.
- [x] Step 7: Resolve all material NFR design ambiguities as numbered safe decisions and treat them as answered under autopilot mode.
- [x] Step 8: Define the in-process architecture, target source placement, and explicit cycle-free dependency direction for U04 runtime code.
- [x] Step 9: Design the validated bounded planning gate, canonical hashing model, deterministic ideal target construction, and constraint projection rules.
- [x] Step 10: Design whole-share greedy allocation and the optional optimizer port with timeout, post-verification, and deterministic fallback.
- [x] Step 11: Design effective-dated cost/tax behavior, cadence and turnover aggregation, interim authorization, immutable lifecycle, and safe explainability payloads.
- [x] Step 12: Design performance and capacity guardrails together with the property, oracle, model, and benchmark verification architecture.
- [x] Step 13: Write `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\nfr-design-patterns.md` with at least fourteen focused patterns and complete extension compliance tables.
- [x] Step 14: Write `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\logical-components.md` with 20–30 acyclic logical components spanning shared, domain, port, application, adapter, test, and benchmark layers.
- [x] Step 15: Validate markdown tables, NFR IDs, pattern count, component count, traceability coverage, component acyclicity, and plan checkboxes mechanically.
- [x] Step 16: Confirm that only the owned U04 NFR Design plan and artifact files were modified.

## Artifact Targets

| Artifact | Path |
| --- | --- |
| Plan | `aidlc-docs\construction\plans\u04-construction-rebalancing-nfr-design-plan.md` |
| NFR Design Patterns | `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\nfr-design-patterns.md` |
| Logical Components | `aidlc-docs\construction\u04-construction-rebalancing\nfr-design\logical-components.md` |

## Completion Checks

- [x] Fourteen focused U04 NFR design patterns are defined.
- [x] Twenty-eight acyclic logical components are defined across shared, domain, port, application, adapter, test, and benchmark layers.
- [x] All 100 unique `NFR-U04-*` identifiers are assigned to one or more patterns and to explicit logical components.
- [x] Security Baseline, Resiliency Baseline, and Property-Based Testing (Full) compliance tables classify every rule as Compliant or N/A with no blocking finding.
- [x] Markdown tables, dependency direction, component count, NFR coverage count, and plan checkboxes were validated mechanically before finalizing.
