# U04 Construction and Rebalancing Functional Design Plan

## Unit Context

- **Unit**: U04 Construction and Rebalancing
- **Primary stories**: US-015 through US-020
- **Criticality**: High
- **Depends on**: U01 exact domain contracts, U02 persistence boundaries, U03 strategy/data/regime/corporate-action outputs
- **Expected code areas**: `server/portfolio/domain/construction/`, `server/portfolio/domain/rebalancing/`, `server/portfolio/application/rebalancing/`, `server/portfolio/adapters/optimization/`
- **Extensions enabled**: Security Baseline (Full), Resiliency Baseline (Full), Property-Based Testing (Full)
- **Frontend applicability**: N/A. U04 produces approval-ready planning contracts only; dedicated UI work belongs to U08.

## Autopilot Mode Notice

The user directed the stage to continue in autopilot mode. Functional-design ambiguities are resolved below using the safest deterministic recommendation that preserves hard-risk controls, portfolio isolation, exact-value arithmetic, and fail-closed behavior.

## Documented Autopilot Decisions

| # | Ambiguity | Recommended decision | Source and rationale |
|---|---|---|---|
| AD-01 | How should plan determinism and duplicate-prevention hashing work? | Use canonical UTF-8 JSON with recursively sorted keys, omit `undefined`, stringify `bigint` exact values as base-10 strings, and compute two hashes: `planInputHash` for immutable inputs and `planHash` for the resulting plan view. | U02 canonical JSON helper, U03 config hashing, FR-060(6-7). This preserves reproducibility and equivalent-plan detection. |
| AD-02 | What happens when fewer eligible instruments exist than the preset target-holdings count? | Build the ideal target from only eligible instruments that clear all hard entry constraints; leave the residual as cash rather than inventing filler positions. | FR-050(1-4), FR-030, US-015. This avoids weakening eligibility or concentration rules. |
| AD-03 | How should regime exposure and preset cash buffer interact? | First cap gross equity exposure to the confirmed regime band, then reserve at least the preset cash buffer inside the remaining exposure budget; any additional unallocatable residual also stays in cash. | FR-050(3-5), FR-060, U03 RM rules. This guarantees no leverage or negative cash. |
| AD-04 | What is the authoritative source for sector/group concentration attributes? | Use the point-in-time classification carried in the immutable evaluation snapshot. Missing group classification blocks new buys and increases, but still allows holds and verified exits. | FR-050(3), FR-020(3), U03 UE-004. Missing data must never become favorable. |
| AD-05 | How should small-cap status be determined? | Use the immutable point-in-time market-cap classification from the evaluation snapshot; if unavailable, the instrument cannot be increased or newly entered. | FR-050(3), FR-020(3), U03 UE-004. This preserves fail-closed eligibility. |
| AD-06 | Which liquidity measure should construction use for executable sizing? | Use finalized decision-date liquidity metrics from U03/U02 snapshots, including median traded-value eligibility plus an executable notional cap derived from configured liquidity fractions. Missing liquidity data blocks buys and increases. | FR-050(3), FR-060(3), FR-020(3). Liquidity must be point-in-time and non-stale. |
| AD-07 | How should the deterministic greedy allocator break ties? | Rank each candidate next-share increment by descending residual benefit after constraints and drag, then by mandatory-risk-reduction priority, then by better composite rank, then by lexicographic `instrumentId`. | FR-050(6-8), US-015, US-020. This gives a stable, explainable, non-random allocator. |
| AD-08 | Which advanced optimization modes are supported in scope? | Expose one `OptimizerPort` supporting verified integer tracking-error minimization and verified risk-parity optimization under the same hard constraints; both must pass deterministic post-solve verification or be rejected. | FR-050(7), US-020. The port remains optional and never weakens constraints. |
| AD-09 | How are effective-dated cost schedules and tax rules selected? | Select the latest schedule or rule version whose effective date is less than or equal to the planning `asOf` date. Missing versions block discretionary planning output and surface a fail-closed reason. | FR-070(1-5), US-017. Planning must not guess active tax or charge rules. |
| AD-10 | What if `SPECIFIC` lot selection is configured but no deterministic lot instruction exists? | For discretionary sells, block the sell and record `LOT_SELECTION_INSTRUCTION_MISSING`. For mandatory hard-risk exits only, estimate tax using FIFO and mark the estimate provisional so risk can still reduce. | FR-070(4-6), US-017, US-019. This preserves risk-exit priority without silently inventing tax intent. |
| AD-11 | How does minimum-order-value enforcement apply to tiny adjustments? | Apply minimum-order-value after instrument-level netting. Orders below threshold are skipped unless they are mandatory exits or are required to complete a verified paired basket that still respects all hard constraints. | FR-060(3-4), US-016, US-019. This reduces churn without trapping unsafe positions. |
| AD-12 | How is turnover budget consumption measured? | Consume turnover budget using the higher of total buy notional or total sell notional divided by starting portfolio NAV for that run, aggregated across all plans in the relevant rolling/calendar window. | FR-060(8), strategy-presets.md rules 8-9. This conservative measure prevents split-run bypasses. |
| AD-13 | How are routine cadence dates anchored? | Anchor cadence to the strategy’s effective schedule: biweekly to the approved two-week cycle, monthly to month-end review, quarterly to quarter-end review. Routine plans use finalized EOD data and become executable only in the next eligible session, normally 09:45-11:30 Asia/Kolkata. | FR-011(2-7), FR-060(1), strategy-presets.md common rules 1-2. This preserves positional behavior. |
| AD-14 | What is the exact semantic difference between proposed, skipped, and blocked orders? | `proposed` means feasible and selected; `skipped` means evaluated but not chosen because of cadence, drift, cost, tax, hurdle, hold, or turnover policy; `blocked` means a hard precondition is missing or unsafe (stale data, missing schedule, unsafe mapping, unresolved corporate action, unavailable quantity). | FR-060(4-5), US-018. Operators need structured explainability instead of one generic “not traded” bucket. |
| AD-15 | What qualifies as confirmed regime-driven interim exposure reduction? | Only sell or reduce actions that move realized equity exposure toward an already confirmed weaker U03 regime band qualify; interim regime logic never authorizes new buys, lateral swaps, or AI-driven constituent changes. | FR-060(9), FR-150(2-4), U03 RM-006 through RM-010, US-019. |
| AD-16 | Which plan lifecycle states belong to U04 versus U05? | U04 owns an ephemeral `DRAFT` assembly state plus immutable persisted outcomes `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED`. Approval and execution states are deferred to U05. | FR-060(6-7), unit-of-work-dependency.md boundaries, U04 scope statement. This keeps planning independent from broker submission. |

## Functional Design Plan

- [x] Step 1: Read and internalize U04 scope, dependencies, primary stories, FR-011, FR-050, FR-060, FR-070, and relevant AC/NFR requirements.
- [x] Step 2: Read strategy presets, application-design components, component methods, and U01/U03 functional-design baselines.
- [x] Step 3: Read enabled extension rules and content-validation constraints.
- [x] Step 4: Record all material ambiguities and resolve them as numbered autopilot decisions with supporting rationale.
- [x] Step 5: Define the exact-value and canonicalization model reusing U01 `Money`, `Quantity`, `Weight`, identifiers, time, and integrity-hash conventions.
- [x] Step 6: Design ideal target construction, including candidate selection, inverse-volatility times conviction weighting, exposure scaling, and hard constraints.
- [x] Step 7: Design executable target construction, deterministic whole-share greedy allocation, and implementation-shortfall reporting.
- [x] Step 8: Design advanced optimizer port behavior, verification rules, deterministic fallback, and constraint-preserving failure handling.
- [x] Step 9: Design effective-dated cost schedules, tax-rule selection, lot-selection semantics, and hard-risk override precedence.
- [x] Step 10: Design cadence, drift bands, preferred holds, rank buffers, replacement hurdles, minimum order value, and period-aware turnover budgets.
- [x] Step 11: Design interim exception authorization limited exactly to hard risk, mandatory eligibility failure, verified corporate action, or confirmed regime exposure reduction.
- [x] Step 12: Design immutable proposed/skipped/blocked orders, structured reasons, plan hashes, equivalence semantics, lifecycle states, and approval-ready views.
- [x] Step 13: Write `aidlc-docs/construction/u04-construction-rebalancing/functional-design/domain-entities.md`.
- [x] Step 14: Write `aidlc-docs/construction/u04-construction-rebalancing/functional-design/business-logic-model.md`.
- [x] Step 15: Write `aidlc-docs/construction/u04-construction-rebalancing/functional-design/business-rules.md` with unique subsystem IDs and at least 90 precise rules if naturally supported.
- [x] Step 16: Perform comprehensive PBT-01 analysis including round-trip, invariants, idempotence, oracle/model-based checks, easy verification, stateful models, domain generators, and shrink/reproducibility expectations.
- [x] Step 17: Perform security, resiliency, misuse/abuse, and fail-closed compliance review with explicit applicable/N/A classification.
- [x] Step 18: Validate story traceability, terminology consistency, markdown formatting, and confirm no frontend artifact is required for U04.

## Category Assessment

| Category | Assessment |
|---|---|
| Business logic modeling | Applicable. U04 owns multi-stage construction, executable planning, drag-aware trade selection, and immutable plan assembly. |
| Domain model | Applicable. U04 introduces targets, plan views, cost/tax schedules, turnover ledgers, reason codes, and plan lifecycle types. |
| Business rules | Applicable. Constraint enforcement, cadence, interim exceptions, and plan equivalence require precise fail-closed rules. |
| Data flow | Applicable. U04 consumes immutable portfolio, holdings, lots, strategy, signal, regime, and reconciliation snapshots and emits approval-ready plans only. |
| Integration points | Applicable. U04 depends on U01/U03 contracts and publishes stable plan/order contracts for U05 and U07/U08. |
| Error handling | Applicable. Missing schedules, missing lot instructions, infeasible constraints, stale data, and solver failures must fail closed with structured reasons. |
| Business scenarios | Applicable. Routine rebalances, drift-only corrections, hard-risk exits, verified corporate actions, regime de-risking, and optimizer failure all need explicit behavior. |
| Frontend components | N/A. U04 defines backend/domain planning contracts only. U08 renders them later. |

## Traceability Overview

| Story | Planned coverage |
|---|---|
| US-015 | Ideal target, executable target, constraint system, whole-share allocation, implementation shortfall |
| US-016 | Preset cadence, drift review, preferred holds, rank buffers, EOD-only timing, turnover budgets |
| US-017 | Effective-dated costs and taxes, lot selection, drag-aware replacement hurdle, hard-risk precedence |
| US-018 | Proposed/skipped/blocked orders, structured reasons, plan hash/equivalence, approval-ready view |
| US-019 | Interim authorization gates, AI prohibition, mandatory-exit override precedence, fail-closed exceptions |
| US-020 | Verified optimizer port, deterministic verifier, oracle comparison scope, fallback behavior |

## Answer Validation Gate

Autopilot decisions AD-01 through AD-16 act as the resolved functional-design answers for this stage. Artifact generation proceeds only after verifying that each decision is:

1. Complete enough to remove the ambiguity.
2. Safe under hard-risk and fail-closed constraints.
3. Consistent with U01/U03 implemented contracts and the approved U04 scope.
4. Non-contradictory with preset cadence, EOD timing, and the no-intraday requirement.

## Answer Analysis

- **Completeness**: All 16 autopilot decisions resolve the material ambiguities required to generate U04 domain entities, business logic, and business rules without waiting for further user input.
- **Ambiguity**: None remaining. Open specification edges were converted into explicit safe decisions and then propagated consistently across all three artifacts.
- **Contradictions**: None detected. EOD-only timing, positional cadence, exact-value arithmetic, portfolio isolation, hard-risk precedence, and optimizer fallback semantics are mutually consistent.
- **Design consequence**: U04 remains a pure immutable planning domain that never places orders, never weakens constraints, and never uses binary-floating accounting for money, quantity, or weight.
