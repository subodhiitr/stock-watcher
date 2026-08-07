# U04 Construction and Rebalancing – NFR Design Patterns

## Pattern Overview

U04 uses in-process software patterns only. The design assumes a single local Node process, exact deterministic planning, and immutable U01/U02/U03 inputs. It introduces no cloud resource, queue, cache tier, daemon, worker thread, network listener, or deployment topology of its own.

## Safe Design Decisions Applied

| Decision | Resolved ambiguity | Adopted outcome |
| --- | --- | --- |
| AD-D01 | Deployment shape | Keep U04 as in-process local planning logic with no cloud, queue, worker, scheduler, or independent deployment resource. |
| AD-D02 | Authoritative existing contract surface | Treat the current `server\portfolio\index.ts` and `server\portfolio\ports\index.ts` exports as the authoritative pre-U04 contract surface. |
| AD-D03 | Source placement | Add U04 only under `server\portfolio\domain\construction\`, `server\portfolio\domain\rebalancing\`, `server\portfolio\application\rebalancing\`, `server\portfolio\ports\rebalancing\`, and `server\portfolio\adapters\optimization\`. |
| AD-D04 | Snapshot assembly | Assemble one immutable planning snapshot through dedicated ports before domain logic executes. |
| AD-D05 | Execution model | Use single-thread synchronous planning in the MVP; do not add worker threads unless future benchmark evidence proves the need. |
| AD-D06 | Constraint model | Project one canonical hard-constraint set and reuse it for ideal construction, greedy allocation, optimizer verification, and explainability. |
| AD-D07 | Canonical executable baseline | Make the deterministic greedy allocator the canonical executable planner; any optimizer path is optional and additive only. |
| AD-D08 | Optimizer adapters | Support only a greedy-baseline adapter and a small-problem oracle adapter in the MVP; external solvers remain future additive adapters behind `OptimizerPort`. |
| AD-D09 | Effective-dated policy resolution | Resolve cost schedules, tax rules, and turnover snapshots using the latest version effective on or before `asOf`; missing versions fail closed. |
| AD-D10 | Semantic equivalence | Define duplicate prevention and supersession through canonical hashes plus logical-order keys, never through timestamps or random identifiers. |
| AD-D11 | Explainability boundary | Generate human explanations only from allowlisted templates and safe typed context; never surface raw provider, AI, or exception text. |
| AD-D12 | Import boundary | Forbid imports from `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`, Remix routes, `/trade-execution`, `/paper-trades`, and persistence internals. |
| AD-D13 | Resiliency test posture | Capture deterministic failure-injection, replay, timeout, and benchmark scenarios in this stage; execute them later through code generation and build workflows rather than inventing separate DR topology for U04. |

## Current Implemented Contract Surface Used by U04

- `server\portfolio\index.ts` currently re-exports the reviewed U01 exact-value and portfolio contracts, U02 persistence factories and health types, and U03 strategy, market-data, application-service, and resilience types.
- `server\portfolio\ports\index.ts` currently exposes the shared repository, unit-of-work, clock, identifier-factory, strategy-evidence, and internal-event-bus interfaces.
- No U04 construction or rebalancing modules exist yet in the implemented codebase, so this design adds them as new isolated modules rather than modifying existing strategy, persistence, route, or UI layers.
- The actual implemented runtime layout already proves the repository convention of `domain` + `application` + `ports` + `adapters` + `infrastructure`; U04 follows that same layout and keeps its public contracts behind the existing reviewed export surfaces.

## Planned U04 Source Placement

- `server\portfolio\domain\construction\` for planning gates, candidate projection, ideal-target logic, and shared constraint projection.
- `server\portfolio\domain\rebalancing\` for executable allocation, cost and tax policy, cadence and turnover policy, interim authorization, plan assembly, and lifecycle revalidation.
- `server\portfolio\ports\rebalancing\` for planning snapshot, policy-resolution, plan-history, and optimizer contracts.
- `server\portfolio\application\rebalancing\` for snapshot assembly, optimizer orchestration, and the top-level planning service.
- `server\portfolio\adapters\optimization\` for the greedy baseline adapter and small-problem oracle adapter; any future external solver stays additive here behind `OptimizerPort`.
- `tests\portfolio\rebalancing\` for example, property, and model suites plus reusable arbitraries.
- `benchmark\portfolio-rebalancing.ts` for benchmark enforcement with no committed outputs.

## PAT-U04-001: Validated Bounded Planning Gate

### Intent

Reject unsafe, oversized, cross-scope, or non-finalized inputs before any ranking, tax, turnover, or optimization logic runs.

### Design

- Assemble one immutable planning snapshot per request carrying portfolio, holdings, lots, strategy, evaluation, regime, calendar, policy, turnover, and prior-plan lineage.
- Validate exactly one canonical `PortfolioId`, one canonical `RebalanceRunId`, finalized EOD session context, approved turnover-window count, and all configured capacity ceilings before domain planning starts.
- Resolve required effective-dated schedules and reject unknown enums, prototype-polluted objects, missing classifications, stale lineage, or unsupported planning intents with typed fail-closed reasons.
- Surface blocked or rejected outcomes as explicit domain failures rather than best-effort partial plans.

### Explicitly Excluded

- Direct reads from persistence internals or legacy UI and trade routes.
- Ambient clock, environment, filesystem, or network inspection inside the pure planning path.

### Primary NFR Coverage

- AVAIL-005; AVAIL-007; CAP-001; CAP-012; DET-006; REL-001; SEC-001..SEC-003; SEC-008

## PAT-U04-002: Exact Canonical Plan Hashing

### Intent

Guarantee semantic replay, duplicate prevention, and exact-value integrity for plan inputs, logical orders, and approval-ready plans.

### Design

- Reuse U01 `Money`, `Quantity`, `Weight`, and `ScaledRate` for every exact planning value and never downgrade them to floating-point accounting forms.
- Canonical JSON sorts keys recursively, omits `undefined`, encodes every `bigint` as a base-10 string, and hashes UTF-8 bytes with lowercase SHA-256 from `node:crypto`.
- Logical-order keys, `planInputHash`, and `planHash` derive only from semantic content, never from timestamps, random IDs, or incidental array order.

### Explicitly Excluded

- Hash salts, random tie-breaks, whitespace-sensitive serialization, or mutable global caches.
- Alternative decimal or money libraries in the MVP.

### Primary NFR Coverage

- AVAIL-003; DET-001..DET-004; DET-007; DET-010; PERF-001; PERF-007

## PAT-U04-003: Deterministic Ideal Target Construction

### Intent

Construct the same ideal target from the same immutable inputs every time while preserving exact exposure and cash policy.

### Design

- Project current holdings, mandatory exits, and eligible entrants from immutable U03 outputs and current portfolio state only.
- Rank candidates deterministically, then compute `rawIntent = convictionMultiplier / realizedVolatility` and normalize under regime exposure and cash-buffer policy.
- Treat missing or unsafe sector, group, market-cap, volatility, or liquidity lineage as blocking for buys and increases, leaving residual value in cash instead of inventing filler positions.

### Explicitly Excluded

- Recomputation of U03 signal or regime math inside U04.
- Random or order-dependent candidate selection.

### Primary NFR Coverage

- CAP-006; DET-009; PERF-002

## PAT-U04-004: Constraint Projection and Verification

### Intent

Materialize one hard-constraint model and reuse it for ideal construction, greedy allocation, optimizer verification, and explainability.

### Design

- Project single-name, sector, group, small-cap, liquidity, delivery, leverage, turnover, and timing constraints into stable machine-readable identifiers.
- Verify every candidate target or order basket with the same constraint families and bind exact actual-versus-limit values to failed checks.
- Emit deterministic binding reasons and verifier disagreements; any disagreement invalidates the candidate output.

### Explicitly Excluded

- Softening a hard constraint because of cost, tax, optimizer preference, or manual convenience.
- Different verifier rules for greedy and optimizer paths.

### Primary NFR Coverage

- DET-008; OBS-004; PERF-006; REL-002..REL-003; REL-008

## PAT-U04-005: Whole-Share Greedy Allocation

### Intent

Produce the canonical executable target without fractional shares, leverage, negative cash, or hidden state.

### Design

- Floor ideal target notionals to whole-share seeds using finalized decision prices and keep residual cash explicit.
- Apply deterministic increment ordering: residual benefit after drag, mandatory-risk-reduction priority, stronger rank, then lexicographic `instrumentId`.
- Stop when no feasible increment remains; a valid no-trade result is preferable to forcing unsafe investment.

### Explicitly Excluded

- Fractional shares, margin-funded output, shorting, or hidden same-session adjustments.
- Random or parallel increment selection in the MVP.

### Primary NFR Coverage

- DET-007; PERF-003..PERF-004; REL-004

## PAT-U04-006: Optional Optimizer Port with Timeout, Post-Verification, and Fallback

### Intent

Keep advanced optimization additive, bounded, and incapable of weakening the deterministic greedy baseline.

### Design

- Expose one `OptimizerPort` with bounded request shape, explicit timeout budget, canonical request hash, and required metadata for duration, iterations, and violated constraints.
- Permit only MVP-safe adapters: a greedy-baseline adapter and a small-problem oracle adapter; any future external solver remains optional behind the same port.
- Re-verify every optimizer response against the shared constraint model; timeouts, infeasible models, missing metadata, or verifier rejection fall back to the same greedy result that would have been produced without optimization.

### Explicitly Excluded

- Unverified solver output, unbounded waits, worker-thread orchestration without benchmark evidence, or solver-specific public schema leakage.

### Primary NFR Coverage

- AVAIL-005..AVAIL-006; CAP-010..CAP-011; MAINT-008; OBS-003; PERF-010..PERF-011; PERF-013; REL-003..REL-004; SEC-008; SEC-012

## PAT-U04-007: Effective-Dated Cost, Tax, and Lot Selection

### Intent

Apply one deterministic live-and-backtest-consistent drag model tied to the planning date and actual lots.

### Design

- Resolve the latest effective cost schedule and tax rule set at or before the planning `asOf` date and fail closed if either is missing.
- Estimate brokerage, statutory charges, spread, slippage, market impact, and configured fees for every proposed order.
- Perform deterministic FIFO, HIFO, or SPECIFIC lot selection; block discretionary SPECIFIC sells without instructions and allow provisional FIFO only for verified hard-risk exits.

### Explicitly Excluded

- Defaulting missing cost or tax inputs to zero.
- Inventing discretionary lot choices under `SPECIFIC` policy.

### Primary NFR Coverage

- AVAIL-007; CAP-009; DET-008; OBS-005; PERF-005; REL-001; REL-008

## PAT-U04-008: Cadence, Drift, Preferred-Hold, and Turnover Aggregation

### Intent

Keep routine rebalancing positional, low-churn, and portfolio-scoped across all approved turnover windows.

### Design

- Gate routine constituent changes by the assigned biweekly, monthly, or quarterly schedule and gate drift-only reviews by the assigned weekly or monthly review cadence.
- Apply the greater-of absolute and relative drift band, preferred hold days, hold-rank buffers, and replacement hurdles before discretionary trading.
- Aggregate turnover with `max(totalBuyNotional, totalSellNotional) / startingNav` across every applicable window and every prior plan for the same portfolio.

### Explicitly Excluded

- Same-session routine execution, intraday policy bypass, or per-run turnover resets.

### Primary NFR Coverage

- AVAIL-001; CAP-008; CAP-011; OBS-006; REL-006; SEC-008

## PAT-U04-009: Interim Exception Authorization

### Intent

Deny interim planning by default and allow it only for narrow, provable, risk-reducing exception families.

### Design

- Accept exactly one verified interim reason family: hard risk, mandatory eligibility failure, verified corporate action, or confirmed regime exposure reduction.
- Require explicit source references and attribution for interim proof, and prohibit AI advisory, AI sentiment, or free-form commentary from authorizing changes.
- Permit regime-driven interim plans to reduce or exit exposure only; no opportunistic buys, lateral swaps, or routine constituent refreshes are unlocked.

### Explicitly Excluded

- AI-only interim authorization or multi-family ambiguity.
- Interim actions that exceed available delivery or create leverage.

### Primary NFR Coverage

- AVAIL-007; REL-008; SEC-006

## PAT-U04-010: Immutable Plan Lifecycle and Equivalence

### Intent

Model plan history as immutable facts whose equivalence and supersession depend on canonical state, not timing accidents.

### Design

- U04 owns only `DRAFT`, `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED` states and enforces the allowed transitions only.
- Assemble exact current-versus-projected summaries, implementation shortfall, logical-order keys, `planInputHash`, and `planHash` before emitting `APPROVAL_READY`.
- Equivalent immutable inputs reproduce equivalent plan hashes and logical orders; materially changed immutable state can supersede, invalidate, or expire prior plans without rewriting history.

### Explicitly Excluded

- Approval, execution, fill-state, or broker reconciliation transitions.
- History mutation or duplicate logical-order generation from identical inputs.

### Primary NFR Coverage

- AVAIL-003..AVAIL-004; CAP-007; DET-007..DET-008; DET-010; OBS-001; OBS-007; PERF-007; PERF-009; REL-002; REL-007; SEC-007

## PAT-U04-011: Safe Explainability and Observability Payloads

### Intent

Expose the full planning rationale without leaking secrets, unstable text, or infrastructure concerns into the domain core.

### Design

- Build human explanations only from allowlisted reason templates plus bounded safe context derived from typed domain values.
- Expose immutable payloads for phase durations, optimizer metadata, action ledgers, turnover summaries, concentration summaries, and shortfall details.
- Keep routing to logs, traces, dashboards, alerts, and UI rendering outside U04; U04 only publishes typed data.

### Explicitly Excluded

- Raw provider exceptions, credentials, account numbers, arbitrary AI text, or embedded logging SDKs in domain modules.

### Primary NFR Coverage

- OBS-001..OBS-008; PERF-007; REL-002; REL-009; SEC-004..SEC-005; SEC-011

## PAT-U04-012: Performance and Capacity Guardrails

### Intent

Bind the design to explicit ceiling constants and benchmark gates so deterministic in-process planning stays inside the approved local envelope.

### Design

- Define named limits for holdings, lots, candidates, selected positions, action buckets, turnover windows, and optimizer problem size.
- Prefer `O(n)` or `O(n log n)` scans at boundary sizes and reject oversized inputs before expensive work begins.
- Validate latency, heap, and growth budgets through a dedicated benchmark harness that records environment, seed, p50, p95, max, sizes, and heap delta.

### Explicitly Excluded

- Hidden magic numbers, ad-hoc tuning flags, or worker-thread escalation without benchmark evidence.

### Primary NFR Coverage

- CAP-003..CAP-007; CAP-012..CAP-013; MAINT-009; PERF-001..PERF-014; SEC-002

## PAT-U04-013: Portfolio Isolation and Dependency Boundary

### Intent

Keep U04 as a portfolio-scoped in-process module that depends only on approved contracts and ports.

### Design

- Treat one portfolio snapshot as the only mutable planning universe; no batch state, turnover, lineage, or order identity from another portfolio may leak in.
- Import only approved U01 exact-value contracts, U03 immutable evaluation contracts, and dedicated U04 ports; never import persistence internals, legacy dashboard modules, replay code, HTTP handlers, or trade routes.
- Stay topology-neutral and dependency-light: zero new production runtime dependency in the MVP, no cloud resource assumption, and no distributed recovery behavior encoded in U04.

### Explicitly Excluded

- Cross-portfolio shared mutable caches, direct SQL or filesystem path construction, and legacy module coupling.

### Primary NFR Coverage

- AVAIL-001..AVAIL-002; AVAIL-004; AVAIL-008; CAP-002; DET-005; DET-009; MAINT-001..MAINT-008; MAINT-010; OBS-008; REL-005; REL-010; SEC-009; SEC-012

## PAT-U04-014: Test Generator, Oracle, and Model Verification Architecture

### Intent

Satisfy Full PBT obligations and complementary example coverage for deterministic financial planning logic.

### Design

- Use reusable `fast-check` arbitraries for snapshots, candidates, policies, schedules, lots, interim proofs, optimizer outcomes, and lifecycle command sequences.
- Require named example tests for every story and mandatory scenario, plus 1,000-run pure properties, 250 stateful command sequences, and 100 small-problem oracle runs for expensive optimizer checks.
- Keep shrinking enabled, log seeds and shrunk counterexamples, and promote production-relevant failures to permanent regression examples.

### Explicitly Excluded

- A second PBT framework, real credentials or portfolio data in fixtures, or PBT as the only coverage for critical behavior.

### Primary NFR Coverage

- SEC-010; TEST-001..TEST-015

## Complete NFR Traceability Matrix

This matrix records the primary design-pattern and logical-component ownership for every approved U04 NFR. The coverage count is validated mechanically against the 100 unique identifiers in `nfr-requirements.md`.

| NFR ID | Assigned pattern(s) | Assigned logical component(s) |
| --- | --- | --- |
| `NFR-U04-CAP-001` | `PAT-U04-001` Validated Bounded Planning Gate | `LC-U04-05` PlanningGate<br>`LC-U04-16` PlanningSnapshotPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-CAP-002` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-05` PlanningGate<br>`LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-CAP-003` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-CAP-004` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-CAP-005` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-CAP-006` | `PAT-U04-003` Deterministic Ideal Target Construction<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-07` IdealTargetConstructor |
| `NFR-U04-CAP-007` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-CAP-008` | `PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-17` PolicyAndTurnoverPort |
| `NFR-U04-CAP-009` | `PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-17` PolicyAndTurnoverPort |
| `NFR-U04-CAP-010` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-19` OptimizerPort<br>`LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-CAP-011` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-19` OptimizerPort<br>`LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-CAP-012` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-CAP-013` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-07` IdealTargetConstructor<br>`LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-001` | `PAT-U04-002` Exact Canonical Plan Hashing<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-002` | `PAT-U04-003` Deterministic Ideal Target Construction<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-07` IdealTargetConstructor<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-003` | `PAT-U04-005` Whole-Share Greedy Allocation<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-004` | `PAT-U04-005` Whole-Share Greedy Allocation<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-005` | `PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-006` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-007` | `PAT-U04-002` Exact Canonical Plan Hashing<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-011` Safe Explainability and Observability Payloads<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-008` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-23` RebalancePlanningApplicationService<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-009` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-010` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-19` OptimizerPort<br>`LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-011` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-012` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-23` RebalancePlanningApplicationService<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-013` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-PERF-014` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-DET-001` | `PAT-U04-002` Exact Canonical Plan Hashing | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-DET-002` | `PAT-U04-002` Exact Canonical Plan Hashing | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-07` IdealTargetConstructor<br>`LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-DET-003` | `PAT-U04-002` Exact Canonical Plan Hashing | `LC-U04-03` CanonicalPlanHashCodec |
| `NFR-U04-DET-004` | `PAT-U04-002` Exact Canonical Plan Hashing | `LC-U04-03` CanonicalPlanHashCodec |
| `NFR-U04-DET-005` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-DET-006` | `PAT-U04-001` Validated Bounded Planning Gate | `LC-U04-05` PlanningGate<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-DET-007` | `PAT-U04-002` Exact Canonical Plan Hashing<br>`PAT-U04-005` Whole-Share Greedy Allocation<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-DET-008` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-DET-009` | `PAT-U04-003` Deterministic Ideal Target Construction<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-06` CandidateProjectionService<br>`LC-U04-07` IdealTargetConstructor<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-DET-010` | `PAT-U04-002` Exact Canonical Plan Hashing<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator |
| `NFR-U04-REL-001` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection | `LC-U04-05` PlanningGate<br>`LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-17` PolicyAndTurnoverPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-REL-002` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator |
| `NFR-U04-REL-003` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-19` OptimizerPort<br>`LC-U04-22` OptimizerOrchestrationService |
| `NFR-U04-REL-004` | `PAT-U04-005` Whole-Share Greedy Allocation<br>`PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback | `LC-U04-09` WholeShareGreedyAllocator<br>`LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-24` GreedyBaselineOptimizerAdapter<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-REL-005` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-05` PlanningGate<br>`LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-REL-006` | `PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation | `LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator |
| `NFR-U04-REL-007` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-15` PlanLifecycleRevalidator<br>`LC-U04-18` PlanHistoryPort<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-REL-008` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection<br>`PAT-U04-009` Interim Exception Authorization | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-13` InterimAuthorizationPolicy<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-REL-009` | `PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-02` PlanningReasonCatalog<br>`LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-REL-010` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-23` RebalancePlanningApplicationService<br>`LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-AVAIL-001` | `PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-AVAIL-002` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-AVAIL-003` | `PAT-U04-002` Exact Canonical Plan Hashing<br>`PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-03` CanonicalPlanHashCodec<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-18` PlanHistoryPort<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-AVAIL-004` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-18` PlanHistoryPort<br>`LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-AVAIL-005` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback | `LC-U04-17` PolicyAndTurnoverPort<br>`LC-U04-19` OptimizerPort<br>`LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-22` OptimizerOrchestrationService |
| `NFR-U04-AVAIL-006` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback | `LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-24` GreedyBaselineOptimizerAdapter<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-AVAIL-007` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection<br>`PAT-U04-009` Interim Exception Authorization | `LC-U04-05` PlanningGate<br>`LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-13` InterimAuthorizationPolicy<br>`LC-U04-17` PolicyAndTurnoverPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-AVAIL-008` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-SEC-001` | `PAT-U04-001` Validated Bounded Planning Gate | `LC-U04-05` PlanningGate<br>`LC-U04-16` PlanningSnapshotPort<br>`LC-U04-17` PolicyAndTurnoverPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-SEC-002` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-05` PlanningGate<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-SEC-003` | `PAT-U04-001` Validated Bounded Planning Gate | `LC-U04-05` PlanningGate<br>`LC-U04-16` PlanningSnapshotPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-SEC-004` | `PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-SEC-005` | `PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-02` PlanningReasonCatalog<br>`LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-SEC-006` | `PAT-U04-009` Interim Exception Authorization | `LC-U04-13` InterimAuthorizationPolicy<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-SEC-007` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence | `LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator<br>`LC-U04-18` PlanHistoryPort |
| `NFR-U04-SEC-008` | `PAT-U04-001` Validated Bounded Planning Gate<br>`PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation | `LC-U04-05` PlanningGate<br>`LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-19` OptimizerPort<br>`LC-U04-21` PlanningSnapshotAssembler |
| `NFR-U04-SEC-009` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-21` PlanningSnapshotAssembler<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-SEC-010` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-26` RebalancingDomainArbitraries<br>`LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-SEC-011` | `PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-02` PlanningReasonCatalog<br>`LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-SEC-012` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-19` OptimizerPort<br>`LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-OBS-001` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-OBS-002` | `PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-OBS-003` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-22` OptimizerOrchestrationService<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-OBS-004` | `PAT-U04-004` Constraint Projection and Verification<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-08` ConstraintProjectorAndVerifier<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-OBS-005` | `PAT-U04-007` Effective-Dated Cost, Tax, and Lot Selection<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-10` EffectiveDatedCostEstimator<br>`LC-U04-11` EffectiveDatedTaxLotSelector<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-OBS-006` | `PAT-U04-008` Cadence, Drift, Preferred-Hold, and Turnover Aggregation<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-12` CadenceAndTurnoverPolicy<br>`LC-U04-14` PlanAssemblyAndEquivalenceService |
| `NFR-U04-OBS-007` | `PAT-U04-010` Immutable Plan Lifecycle and Equivalence<br>`PAT-U04-011` Safe Explainability and Observability Payloads | `LC-U04-14` PlanAssemblyAndEquivalenceService<br>`LC-U04-15` PlanLifecycleRevalidator<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-OBS-008` | `PAT-U04-011` Safe Explainability and Observability Payloads<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-04` SafeObservabilityPayloadBuilder<br>`LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-TEST-001` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-002` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-003` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-004` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-26` RebalancingDomainArbitraries |
| `NFR-U04-TEST-005` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-006` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-26` RebalancingDomainArbitraries<br>`LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-007` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-26` RebalancingDomainArbitraries |
| `NFR-U04-TEST-008` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-009` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-010` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-TEST-011` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-26` RebalancingDomainArbitraries<br>`LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-012` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-013` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-014` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness |
| `NFR-U04-TEST-015` | `PAT-U04-014` Test Generator, Oracle, and Model Verification Architecture | `LC-U04-27` PlannerPropertyAndModelHarness<br>`LC-U04-28` RebalancingBenchmarkHarness |
| `NFR-U04-MAINT-001` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-MAINT-002` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-MAINT-003` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-MAINT-004` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-23` RebalancePlanningApplicationService |
| `NFR-U04-MAINT-005` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-MAINT-006` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-MAINT-007` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-MAINT-008` | `PAT-U04-006` Optional Optimizer Port with Timeout, Post-Verification, and Fallback<br>`PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-19` OptimizerPort<br>`LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-25` SmallProblemOracleOptimizerAdapter |
| `NFR-U04-MAINT-009` | `PAT-U04-012` Performance and Capacity Guardrails | `LC-U04-01` RebalancingConstantsAndLimits<br>`LC-U04-20` RebalancingPublicContractGate |
| `NFR-U04-MAINT-010` | `PAT-U04-013` Portfolio Isolation and Dependency Boundary | `LC-U04-20` RebalancingPublicContractGate<br>`LC-U04-28` RebalancingBenchmarkHarness |

## Extension Compliance

### Security Baseline

| Rule | Status | Rationale | Supporting pattern(s) |
| --- | --- | --- | --- |
| SECURITY-01 | N/A | U04 owns no persistence store or transport channel; encryption remains an outer-layer concern inherited from persistence and operations stages. | Inherited from U02 and later operations work |
| SECURITY-02 | N/A | U04 defines no network-facing intermediary. | N/A |
| SECURITY-03 | N/A | U04 emits typed observability payloads only and does not own a logging sink or deployed entry point. | `PAT-U04-011` |
| SECURITY-04 | N/A | U04 serves no HTML or HTTP response. | N/A |
| SECURITY-05 | Compliant | Schema, bounds, identifier, hostile-input, and fail-closed validation happen before planning work begins. | `PAT-U04-001`, `PAT-U04-012` |
| SECURITY-06 | N/A | U04 defines no IAM policy or permission boundary. | N/A |
| SECURITY-07 | N/A | U04 defines no network configuration. | N/A |
| SECURITY-08 | N/A | Authentication and route-level authorization belong to outer delivery layers, although U04 still enforces portfolio scope defensively. | `PAT-U04-013` |
| SECURITY-09 | N/A | U04 has no deployed runtime hardening surface, directory listing, or object-storage policy. | N/A |
| SECURITY-10 | Compliant | The MVP adds no production dependency, and any future solver remains port-isolated, version-locked, scanned, and SBOM-listed before use. | `PAT-U04-006`, `PAT-U04-013` |
| SECURITY-11 | Compliant | Security-sensitive validation, AI prohibition, misuse cases, and defense-in-depth boundaries are explicit in the design. | `PAT-U04-001`, `PAT-U04-009`, `PAT-U04-013` |
| SECURITY-12 | N/A | U04 manages no credentials, sessions, MFA, or login flow. | N/A |
| SECURITY-13 | Compliant | Canonical hashes, immutable lineage, exact lot provenance, and explicit public-contract gates preserve data and software integrity. | `PAT-U04-002`, `PAT-U04-010`, `PAT-U04-013` |
| SECURITY-14 | N/A | Alert routing, retention, and dashboards remain outer operational concerns; U04 only emits typed metadata. | `PAT-U04-011` |
| SECURITY-15 | Compliant | Unsafe inputs, verifier disagreement, missing prerequisites, and optimizer failures all deny the operation rather than failing open. | `PAT-U04-001`, `PAT-U04-004`, `PAT-U04-006`, `PAT-U04-011` |

No blocking U04 NFR Design security finding remains.

### Resiliency Baseline

| Rule | Status | Rationale | Supporting pattern(s) |
| --- | --- | --- | --- |
| RESILIENCY-01 | Compliant | U04 is documented as financially critical planning logic in the approved High workload class with explicit upstream and downstream dependencies. | `PAT-U04-013` |
| RESILIENCY-02 | Compliant by reference | U04 inherits approved availability, RTO, and RPO targets and does not define contradictory unit-specific recovery objectives. | `PAT-U04-010`, `PAT-U04-013` |
| RESILIENCY-03 | N/A | Change-management process is already owned at the project level and is not redefined in this in-process design stage. | N/A |
| RESILIENCY-04 | N/A | U04 defines no deployment or rollback workflow because it is not a deployable standalone service. | N/A |
| RESILIENCY-05 | N/A | U04 is not a monitored deployment target; it provides typed payloads for outer observability only. | `PAT-U04-011` |
| RESILIENCY-06 | N/A | U04 exposes no health endpoint or traffic-serving process. | N/A |
| RESILIENCY-07 | N/A | U04 owns no resiliency monitoring resource or autoscaling alarm surface. | N/A |
| RESILIENCY-08 | N/A | The approved deployment context remains a local workstation process, and U04 owns no zone or region topology. | `PAT-U04-013` |
| RESILIENCY-09 | N/A | U04 defines no auto-scaling runtime. | N/A |
| RESILIENCY-10 | Compliant | Schedule lookups and optimizer calls are explicitly bounded, dependency failures are isolated, and the optional optimizer degrades to the canonical greedy path. | `PAT-U04-001`, `PAT-U04-006`, `PAT-U04-013` |
| RESILIENCY-11 | N/A | Disaster-recovery strategy is tied to persisted state and later operational planning rather than this pure planning library. | `PAT-U04-010` |
| RESILIENCY-12 | N/A | Backups, replication, and retention are owned by persistence and operations layers. | N/A |
| RESILIENCY-13 | N/A | Failover and failback runbooks are outside the scope of a non-deployable in-process module. | N/A |
| RESILIENCY-14 | Compliant | This design captures deterministic timeout, replay, oracle, failure-injection, and benchmark scenarios for later execution without inventing non-existent DR infrastructure. | `PAT-U04-006`, `PAT-U04-012`, `PAT-U04-014` |
| RESILIENCY-15 | N/A | Incident-response process remains project-level and is not redefined by U04 NFR Design. | N/A |

No blocking U04 NFR Design resiliency finding remains.

### Property-Based Testing (Full Enforcement)

| Rule | Status | Rationale | Supporting pattern(s) |
| --- | --- | --- | --- |
| PBT-01 | Compliant by reference | U04 Functional Design already identified round-trip, invariant, idempotence, oracle, easy-verification, and stateful-model properties, and this stage preserves them as design obligations. | `PAT-U04-014` |
| PBT-02 | Compliant | Round-trip and replay properties are explicitly required for canonical hashing, serialization views, and semantic duplicate detection. | `PAT-U04-002`, `PAT-U04-014` |
| PBT-03 | Compliant | Invariant properties cover cash, leverage, delivery quantity, concentration, exposure, turnover, and lifecycle legality. | `PAT-U04-004`, `PAT-U04-005`, `PAT-U04-008`, `PAT-U04-014` |
| PBT-04 | Compliant | Idempotent re-planning and duplicate-prevention behavior are modeled explicitly. | `PAT-U04-005`, `PAT-U04-010`, `PAT-U04-014` |
| PBT-05 | Compliant | Optimizer and greedy behavior must be compared against a small-problem oracle or simplified reference model. | `PAT-U04-006`, `PAT-U04-014` |
| PBT-06 | Compliant | Lifecycle and interim-authorization stateful models are required. | `PAT-U04-009`, `PAT-U04-010`, `PAT-U04-014` |
| PBT-07 | Compliant | Reusable constrained arbitraries are defined as first-class test architecture. | `PAT-U04-014` |
| PBT-08 | Compliant | Shrinking, seed logging, replay, and counterexample preservation are mandatory. | `PAT-U04-014` |
| PBT-09 | Compliant | The selected framework remains the existing repository `fast-check` integration with Node's built-in test runner. | `PAT-U04-014` |
| PBT-10 | Compliant | Critical example tests remain mandatory alongside properties, and shrunk failures become permanent regressions. | `PAT-U04-014` |

No blocking U04 NFR Design property-based testing finding remains.

## Validation Summary

- Pattern count: **14**.
- Unique traced NFR IDs: **100 / 100**.
- Cloud, deployment, queue, worker-thread, and independent topology resources: **absent by design**.
- Future external solver: **optional additive adapter only**, not required for the MVP.
