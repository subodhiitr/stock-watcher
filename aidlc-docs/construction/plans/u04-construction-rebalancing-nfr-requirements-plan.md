# U04 Construction and Rebalancing NFR Requirements Plan

## Unit Context

- **Unit**: U04 Construction and Rebalancing
- **Primary stories**: US-015 through US-020
- **Criticality**: Financially critical in-process planning logic; approved project workload classification remains **High**.
- **Depends on**: U01 exact-value and portfolio contracts, U02 persistence lineage, U03 eligibility/signal/regime outputs, effective-dated cost/tax schedules, and turnover snapshots.
- **Extensions enabled**: Security Baseline (Full), Resiliency Baseline (Full), Property-Based Testing (Full)
- **Owned outputs only**: This stage updates only the U04 NFR plan plus `nfr-requirements.md` and `tech-stack-decisions.md`. `aidlc-state.md`, `audit.md`, code, tests, and package files remain untouched.

## Autopilot Mode Notice

The roadmap was directed to continue in autopilot mode. All material NFR ambiguities are resolved below using the safest deterministic decision that preserves exact arithmetic, fail-closed planning, portfolio isolation, and bounded local execution.

## Documented Autopilot NFR Decisions

| # | Ambiguity | Recommended decision | Source and rationale |
|---|---|---|---|
| AD-N01 | Workload classification | Classify U04 as financially critical in-process planning logic, but keep the approved project workload taxonomy of **High** rather than independently deployable **Critical**. U04 therefore has no separate deployment SLA. | Approved project NFR-REL classifies planning as High while the user explicitly requires financially critical treatment. This preserves both safety emphasis and project convention. |
| AD-N02 | Per-plan capacity envelope | Plan exactly one portfolio at a time, support up to 1,000 holdings, 10,000 open lots, 1,000 candidate instruments, 100 selected positions, 250 proposed net orders, and 4 active turnover windows. | Matches U01/U03 aggregate ceilings, stays above current preset needs, and is realistic for local Node 24 execution. |
| AD-N03 | Optimizer eligibility envelope | Permit advanced optimizer calls only for bounded problems up to 75 decision instruments, 250 hard constraints, and 800 participating sell-side lots; larger problems bypass the optimizer and use deterministic greedy planning directly. | Keeps optional optimization testable and bounded in the local MVP without weakening constraints. |
| AD-N04 | Latency and heap budgets | Use sub-second budgets for component operations and a `<1.8 s` p95 / `<192 MiB` incremental heap budget for a full boundary plan. Optimizer attempts use a 250 ms default timeout with a 750 ms hard cap. | Targets are realistic for a local Node 24 workstation and tight enough for CI benchmark enforcement. |
| AD-N05 | Exact arithmetic and hashing | Reuse U01 `Money`, `Quantity`, `Weight`, and `ScaledRate` for exact values. Use canonical JSON plus lowercase SHA-256 from `node:crypto`; no floating-point accounting values after conversion to exact units. | Required by the user and consistent with U01/U02/U03 contracts. |
| AD-N06 | Deterministic inputs only | Forbid ambient clock, randomness, process state, or mutable globals inside plan construction. Session timing, lineage, and any identifiers must be injected as validated inputs. Equivalent permutations of inputs must yield equivalent plans. | Preserves replayability, duplicate prevention, and exact equivalence semantics. |
| AD-N07 | Fail-closed planning posture | Never emit partial, unconstrained, or same-session routine output. Missing finalized data, missing schedules, stale lineage, verifier disagreement, or unsafe optimizer output must block or invalidate the plan. | Matches FR-011/060/070 and U04 functional fail-closed rules. |
| AD-N08 | Observability boundary | Expose typed immutable plan lineage, timings, optimizer metadata, turnover summaries, and reason bundles from the pure domain, but do not embed logger, tracer, dashboard, or alert infrastructure in U04. | Satisfies observability needs while respecting pure-domain boundaries and Security/Resiliency ownership splits. |
| AD-N09 | Security posture | Treat every U04 input as untrusted until schema, bounds, and scope validation pass; keep explanations allowlisted and secret-free; prohibit AI advisory from authorizing interim actions or changing plan parameters. | Directly required by the user and aligned with the Security Baseline. |
| AD-N10 | Inherited resiliency targets | Inherit the approved local-workstation availability target (99% of configured windows), hours-level RTO, and one-hour RPO by reference. U04 recovery is deterministic replay from U02/U03 state rather than unit-owned failover or backup logic. | Matches approved project resiliency decisions and U04’s non-deployable nature. |
| AD-N11 | Testing counts | Require `fast-check` with Node's test runner, pure properties with >=1,000 runs, stateful models with >=250 sequences of length 1-100, and expensive optimizer/oracle properties with >=100 generated small problems unless explicitly justified otherwise. | The user explicitly required Full PBT enforcement with concrete run counts. |
| AD-N12 | Technology stack floor | Retain Node >=24.3, strict erasable TypeScript, NodeNext ESM, `node:crypto`, Node's built-in test runner, existing root `fast-check`, and custom benchmark scripts. Add no new production dependency in U04 MVP. | Matches repository package and tsconfig conventions and prior U01-U03 decisions. |
| AD-N13 | Architecture boundary | Keep U04 code isolated under `server/portfolio/` planning and optimization modules; forbid dependencies on legacy dashboard, simulation, execution-route, or trade-state code. | Required by project maintainability rules and repository guidance. |
| AD-N14 | Solver roadmap | Keep `OptimizerPort` optional and initially satisfiable by in-process deterministic greedy/oracle adapters only. Any future external solver remains additive, behind the port, and unnecessary for initial code generation. | Meets the user direction to avoid a solver library in the MVP while preserving a migration path. |

## Plan Steps

- [x] Step 1: Read the required AI-DLC rule detail files for NFR Requirements, content validation, and question formatting.
- [x] Step 2: Read `aidlc-docs/aidlc-state.md` for stage context and enabled extension confirmation without modifying it.
- [x] Step 3: Read the approved U04 functional design plan plus all U04 functional design artifacts.
- [x] Step 4: Read U01, U02, and U03 NFR requirements and technology decisions for established conventions.
- [x] Step 5: Read U04 stories US-015 through US-020, FR-011/050/060/070, strategy presets, and approved project NFRs and ACs.
- [x] Step 6: Read the live repository runtime conventions in `package.json`, `server/portfolio/package.json`, and `server/portfolio/tsconfig.json`.
- [x] Step 7: Inspect implemented U01-U03 contract files for exact-value, canonicalization, eligibility, signal, regime, holdings, lot, and portfolio boundaries.
- [x] Step 8: Record all material NFR ambiguities as safe numbered autopilot decisions with rationale and treat them as answered for this stage.
- [x] Step 9: Define measurable capacity bounds for portfolios, holdings, candidates, lots, orders, turnover windows, and optimizer problem sizes.
- [x] Step 10: Define measurable p95 latency and heap budgets for hashing, ideal construction, greedy allocation, cost/tax estimation, constraint verification, full plan generation, and optimizer fallback.
- [x] Step 11: Define determinism, exactness, fail-closed reliability, inherited availability, dependency isolation, and recovery reproducibility requirements.
- [x] Step 12: Define security, observability, testing, PBT, maintainability, and compatibility requirements with explicit measurable verification.
- [x] Step 13: Classify all Security Baseline, Resiliency Baseline, and Property-Based Testing Full obligations with compliant or N/A rationale.
- [x] Step 14: Write `aidlc-docs/construction/plans/u04-construction-rebalancing-nfr-requirements-plan.md` with completed checkboxes only.
- [x] Step 15: Write `aidlc-docs/construction/u04-construction-rebalancing/nfr-requirements/nfr-requirements.md`.
- [x] Step 16: Write `aidlc-docs/construction/u04-construction-rebalancing/nfr-requirements/tech-stack-decisions.md`.
- [x] Step 17: Validate Markdown tables, code spans, NFR IDs, counts, and internal trace references before finalizing.
- [x] Step 18: Confirm that only the owned U04 NFR plan and artifact files were modified.

## Artifact Targets

| Artifact | Path |
|---|---|
| Plan | `aidlc-docs/construction/plans/u04-construction-rebalancing-nfr-requirements-plan.md` |
| NFR Requirements | `aidlc-docs/construction/u04-construction-rebalancing/nfr-requirements/nfr-requirements.md` |
| Technology Stack Decisions | `aidlc-docs/construction/u04-construction-rebalancing/nfr-requirements/tech-stack-decisions.md` |

## Completion Checks

- [x] At least 80 unique U04 NFR IDs are defined; the generated artifact contains **100** unique NFRs across nine subsystems.
- [x] All six U04 stories and FR-011/050/060/070 are traced.
- [x] All enabled Security Baseline, Resiliency Baseline, and Property-Based Testing Full obligations are classified with rationale.
- [x] Markdown tables, code spans, NFR ID counts, and internal references are validated before finalizing.
