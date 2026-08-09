# U04 Business Logic Model

## Design Objective

U04 converts immutable portfolio state and immutable U03 evaluation outputs into deterministic, constraint-valid, approval-ready rebalance plans. The unit is technology-agnostic, pure-domain, and side-effect free: it never submits orders, never mutates persistent state directly, never reads intraday policies, and never relaxes a hard constraint because of cost, tax, optimization, or advisory input.

## Functional Boundary

### Inputs

- Immutable `PortfolioSnapshot`, `Holding`, and `HoldingLot` state from U01/U02.
- Immutable `StrategyConfig`, `StrategyConfigHash`, `EligibilityResult`, `SignalSnapshot`, `RegimeState`, and `CorporateAction` outputs from U03.
- Immutable effective-dated `CostSchedule`, `TaxRuleSet`, turnover ledger snapshots, and exchange-calendar session metadata.
- A planning request carrying `PortfolioId`, `RebalanceRunId`, planning intent, `asOf` date, and the exact immutable input lineage needed to derive `planInputHash`.

### Outputs

- One immutable `RebalancePlan` in `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, or `EXPIRED` state.
- Exact `IdealTarget` and `ExecutableTarget` outputs.
- Exact proposed, skipped, and blocked logical orders with structured reasons.
- Exact `ImplementationShortfall`, cost, tax, turnover, and warning summaries.
- Deterministic optimizer metadata, including visible fallback reasons when advanced optimization is attempted.

### Excluded Behavior

- Approval, rejection, broker submission, reconciliation mutation, kill-switch mutation, or fill handling.
- Persistent deduplication storage mechanics and transactional state updates.
- HTTP, authentication, authorization, React rendering, scheduler leasing, or legacy intraday execution logic.
- Any AI-selected security, quantity, or parameter override.

## Criticality and Dependency Baseline

| Concern | U04 treatment |
|---|---|
| Workload criticality | Planning is a **High** workload per approved NFRs; output must be deterministic, explainable, and fail closed. |
| Upstream contract dependence | U04 accepts only approved U01/U03 exact-value and lineage contracts and does not re-interpret them loosely. |
| Downstream contract publication | U04 publishes stable plan/order hashes and approval-ready views for U05/U07/U08 without embedding execution logic. |
| Infrastructure scope | Pure domain only. Optimizer process isolation, if later required, is handled in NFR Design rather than here. |

## Core Planning Flow

### Flow 1: Planning Readiness Gate

1. Validate request scope: `PortfolioId`, `RebalanceRunId`, `asOf`, planning intent, strategy lineage, and exact snapshot lineage must all be present and canonical.
2. Confirm the portfolio is not archived and that the planning request references exactly one portfolio.
3. Confirm the evaluation snapshot uses finalized EOD data and a confirmed exchange session.
4. Confirm the strategy preset or assigned strategy version is positional, CNC-only, and not intraday.
5. Confirm the data version, regime state, and reconciliation snapshot are complete enough for planning.
6. Resolve the effective-dated `CostSchedule`, `TaxRuleSet`, and turnover ledger snapshots for `asOf`.
7. If any required immutable dependency is stale, missing, incomplete, unresolved, or ambiguous, fail closed by producing blocked actions or rejecting plan creation.
8. Compute `planInputHash` from the canonicalized immutable inputs before any planning algorithm runs.

### Flow 2: Candidate Classification

1. Partition instruments into:
   1. current holdings requiring mandatory review or exit;
   2. current holdings still eligible to hold;
   3. new eligible entrants;
   4. ineligible, unresolved, or unsafe candidates.
2. Current holdings with verified hard risk, mandatory eligibility failure, confirmed delisting, or unresolved corporate-action blocks are never silently retained as healthy discretionary holds.
3. New entrants must satisfy:
   1. immutable U03 eligibility;
   2. positive and finite volatility input;
   3. verified point-in-time sector/group/small-cap classification;
   4. executable liquidity capacity;
   5. no unresolved blocking data anomaly or mapping issue.
4. Candidates missing any hard input may remain in the audit trail as blocked or skipped, but they cannot become new buys or increased positions.
5. Preferred holds, hold-rank buffers, and replacement hurdles are applied only after mandatory exits and hard constraints are established.

### Flow 3: Ideal Target Construction

1. Determine the investable portfolio NAV from reconciled holdings plus cash using exact `Money`.
2. Determine the gross equity exposure ceiling from the confirmed `RegimeState`.
3. Reserve at least the preset cash buffer inside the investable budget.
4. Rank candidates using immutable U03 composite scores and deterministic tie-breaks.
5. Select the ideal candidate set by:
   1. forcing mandatory exits to zero target weight;
   2. retaining eligible or hold-eligible incumbents within policy;
   3. adding highest-ranked eligible entrants up to target holdings or until no safe entrant remains.
6. For each selected candidate compute the raw intent signal:
   - `rawIntent_i = convictionMultiplier_i / realizedVolatility_i`
7. Reject any candidate with missing, zero, negative, or non-finite volatility input from new allocation.
8. Normalize the raw intent values across the selected candidate set.
9. Apply hard per-name, sector, group, small-cap, liquidity, turnover-preference, and exposure ceilings iteratively until every ideal weight is feasible as a continuous target.
10. If fewer safe candidates remain than target holdings, preserve the residual as cash instead of inventing filler positions.
11. Emit `IdealTarget` positions, exclusions, and exact target values.

### Flow 4: Executable Target Construction

1. Convert each ideal target value to an initial whole-share target by dividing by the finalized decision price and flooring to whole shares.
2. For current holdings, cap any sell at the actually available delivery quantity from the reconciled holding state.
3. Enforce no leverage, no shorting, no margin-funded output, no unavailable delivery quantity, and no negative residual cash.
4. Recompute post-floor realized weights and residual cash.
5. Run the deterministic greedy allocator across remaining residual cash or required reductions:
   1. generate feasible next-share increments or decrements;
   2. score each increment by residual benefit after estimated cost, tax, turnover, and replacement penalties;
   3. discard any increment that would violate a hard constraint;
   4. select the best feasible increment using the deterministic tie-break order from AD-07;
   5. repeat until no feasible increment remains.
6. If the current holdings already satisfy executable constraints and all net deltas are zero, emit an approval-ready no-trade plan instead of manufacturing activity.
7. Record every binding constraint that caused executable weights to differ from ideal weights.
8. Emit `ExecutableTarget`, residual cash, and whole-share deltas.

### Flow 5: Advanced Optimizer Port with Deterministic Fallback

1. Invoke the optional `OptimizerPort` only after the same hard constraints used by the greedy allocator have been materialized into a verified request.
2. Supported optimization modes are:
   1. `INTEGER_TRACKING`: minimize constraint-respecting deviation between ideal and executable targets;
   2. `RISK_PARITY`: produce a whole-share portfolio whose realized risk contributions are closer to parity without weakening any hard cap.
3. Every optimizer request includes:
   1. canonical candidate lineage;
   2. exact hard constraints;
   3. explicit timeout budget;
   4. objective metadata;
   5. request hash.
4. The optimizer output is never trusted directly. U04 always re-verifies:
   1. whole-share integrality;
   2. residual cash non-negativity;
   3. no short quantity;
   4. exposure, concentration, liquidity, and turnover ceilings;
   5. no use of unavailable delivery quantity.
5. If the solver times out, reports infeasibility, errors, omits metadata, or fails post-solve verification, the output is rejected.
6. Rejection always falls back to the deterministic greedy allocator and records `durationMs`, `iterationCount`, and `violatedConstraintIds`.
7. U04 never emits an unconstrained or partially verified optimizer output.
8. Reference small problems are reserved for oracle comparison during code generation and verification.

### Flow 6: Cost, Tax, and Lot Evaluation

1. Resolve the effective cost schedule version and tax rule version for `asOf`.
2. Estimate order drag for every proposed and replacement candidate using:
   1. brokerage;
   2. STT;
   3. exchange charges;
   4. GST;
   5. SEBI charges;
   6. stamp duty;
   7. DP charges;
   8. spread;
   9. slippage;
   10. market impact;
   11. configured broker fees.
3. For sells and reductions, select lots according to the configured tax policy:
   1. `FIFO` uses earliest acquisition date first;
   2. `HIFO` uses highest unit cost first, deterministic by acquisition date and lot ID on ties;
   3. `SPECIFIC` requires a deterministic lot instruction or else blocks discretionary selling.
4. Compute exact gain/loss and estimated tax using the effective-dated short-term and long-term rules.
5. Replacement or resize logic compares expected benefit against:
   1. total estimated cost;
   2. total estimated tax;
   3. turnover budget consumption;
   4. replacement hurdle;
   5. preferred hold friction.
6. Costs and taxes may skip a discretionary trade.
7. Costs and taxes may not override a verified hard-risk exit, mandatory eligibility exit, or verified corporate-action reduction.

### Flow 7: Cadence, Drift, Preferred Holds, and Turnover

1. Determine whether the request is a routine cadence run or an interim exception run.
2. For routine runs:
   1. constituent changes are allowed only on the preset schedule;
   2. weight-only drift corrections are allowed only on the preset drift-review schedule;
   3. same-session or intraday execution remains forbidden.
3. For each current holding, evaluate:
   1. no-trade band using the greater of absolute and relative drift thresholds;
   2. preferred minimum hold days;
   3. hold-rank buffer;
   4. forced-review threshold;
   5. after-drag replacement hurdle.
4. A holding inside the no-trade band or preferred hold normally becomes a skipped action unless a mandatory exception exists.
5. Compute turnover consumption using the conservative `max(totalBuyNotional, totalSellNotional) / startingNav` method.
6. Apply all relevant preset windows:
   1. rolling 30-day;
   2. calendar month;
   3. calendar quarter;
   4. calendar year.
7. Aggregate turnover across every plan for the same portfolio; one run may not reset or ignore previous consumption inside the same window.
8. If a discretionary trade would exceed a remaining turnover budget, skip it with a structured reason.

### Flow 8: Interim Exception Authorization

1. Interim planning is denied by default.
2. Interim planning is allowed only when exactly one verified reason family exists:
   1. hard risk;
   2. mandatory eligibility failure;
   3. verified corporate action;
   4. confirmed regime exposure reduction.
3. AI sentiment, AI classification, AI summary, or AI advisory alone never authorize an interim constituent change or interim sell.
4. Confirmed regime exposure reduction authorizes only reductions or exits that move the realized exposure toward the already confirmed weaker regime band.
5. Interim exceptions do not authorize opportunistic new buys, lateral swaps, or higher turnover than the verified exception requires.
6. Hard-risk exits override preferred holds, replacement hurdles, discretionary cost/tax vetoes, and discretionary turnover ceilings, but still obey executable hard constraints such as available delivery quantity.

### Flow 9: Plan Assembly and Explainability

1. Build exact current and projected portfolio views:
   1. cash;
   2. total exposure;
   3. per-instrument weight and quantity;
   4. sector and group concentration;
   5. cost and tax totals;
   6. warnings and urgency.
2. Emit one logical action bucket per evaluated instrument:
   1. `proposed` for selected executable actions;
   2. `skipped` for policy-driven non-actions;
   3. `blocked` for unsafe or incomplete prerequisites.
3. Every action bucket receives:
   1. a deterministic logical-order key;
   2. stable reason codes;
   3. a safe human explanation;
   4. linked constraint identifiers.
4. Compute `ImplementationShortfall` from ideal versus executable positions, residual cash, and drag.
5. Canonicalize the plan output and compute `planHash`.
6. Compare `planHash` with any prior plan created from the same immutable inputs:
   1. equal hashes mean equivalent plans and no duplicate logical orders;
   2. different hashes create a distinct logical plan and supersede the prior approval-ready plan only if the underlying state changed.
7. Publish the final immutable plan in `APPROVAL_READY` state with an approval-ready summary for downstream consumers.

## Plan Lifecycle Revalidation

1. `APPROVAL_READY -> SUPERSEDED` when a later non-equivalent plan replaces it for the same portfolio and newer immutable state.
2. `APPROVAL_READY -> INVALIDATED` when required input lineage changes, such as portfolio version, unresolved corporate-action state, or missing prerequisite.
3. `APPROVAL_READY -> EXPIRED` when the next eligible execution window passes before U05 binds approval/execution to the plan.
4. `SUPERSEDED`, `INVALIDATED`, and `EXPIRED` are immutable historical facts; U04 does not mutate them back to ready.

## Failure and Misuse Scenarios

| Scenario | Unsafe attempt | U04 fail-closed behavior |
|---|---|---|
| AI-only interim sell | Advisory sentiment proposes a same-day exit | Record `AI_ADVISORY_NOT_AUTHORIZED`, produce blocked action, no interim authorization |
| Non-finalized data | Planning request uses pre-close or stale EOD inputs | Reject plan creation or block affected instruments; never emit approval-ready routine plan |
| Cross-portfolio contamination | Holdings or lots from another `PortfolioId` appear in input | Reject the entire plan as scope-corrupt |
| Missing cost or tax schedule | Effective-dated schedule cannot be resolved | Block discretionary plan output and surface prerequisite failure |
| Missing group or liquidity classification | New buy candidate lacks required concentration or liquidity lineage | Block the increase/buy; allow only verified reductions |
| Unsafe optimizer result | Solver returns a lower-drift basket that violates a hard cap | Reject solver output, record verifier failure, use deterministic fallback only |
| Turnover bypass | Multiple small routine plans attempt to evade the same window budget | Aggregate turnover across runs and skip the excess activity |
| Same-session routine trade attempt | A manual trigger tries to treat a same-day request as routine permission | Keep routine plan timing on next eligible session only |
| Missing lot instruction under `SPECIFIC` | Planner would need to invent lot choice | Block discretionary sale and record structured reason |
| Duplicate logical orders | Re-run with identical immutable inputs | Produce an equivalent plan hash with no duplicate logical order identity |

## Primary Story Coverage

| Story | Functional-model coverage |
|---|---|
| US-015 | Flows 2 through 5 define ideal target, executable target, constraints, whole-share allocation, and implementation shortfall |
| US-016 | Flow 7 and `PlanTiming` enforce cadence, drift bands, preferred holds, turnover budgets, and EOD-only timing |
| US-017 | Flow 6 defines effective-dated costs, taxes, lot selection, and drag-aware trade suppression |
| US-018 | Flow 9 defines proposed/skipped/blocked orders, deterministic hashes, explanations, and approval-ready summaries |
| US-019 | Flow 8 defines the exact interim exception families, AI prohibition, and hard-risk precedence |
| US-020 | Flow 5 defines the optimizer port, deterministic verifier, oracle scope, and mandatory fallback behavior |

## Testable Properties

### Property Families by Component

| Component | Property category | Property to preserve |
|---|---|---|
| Canonical input and plan hashes | Round-trip | Canonicalize → hash → canonicalize the same immutable value graph always preserves the same `IntegrityHash` |
| Ideal target normalization | Invariant | Sum of ideal weights plus cash equals 1,000,000 PPM within the approved tolerance and never exceeds regime exposure |
| Executable target | Invariant | No output contains negative cash, short quantity, leverage, or unavailable delivery quantity |
| Greedy allocator | Idempotence | Running greedy allocation again on its own executable output with identical inputs produces an equivalent executable target |
| Turnover ledger | Invariant | Remaining turnover balance is monotone non-increasing for accepted plans inside a window and never drops below zero |
| Optimizer verifier | Oracle | Any accepted optimizer result satisfies every verifier check and is at least as good as the greedy result on documented small reference problems |
| Constraint verification | Easy verification | Even when the planner search is complex, the emitted target is easy to verify against explicit cash, quantity, concentration, liquidity, turnover, and timing checks |
| Plan lifecycle | Stateful model | Random sequences of plan, replan, supersede, invalidate, and expire transitions preserve hash identity and immutable history |
| Interim authorization | Stateful model | Random routine/interim requests never unlock an unauthorized exception family or AI-only override |

### Domain Generators Required for Later Code Generation

1. Exact-value generators for `Money`, `Quantity`, `Weight`, and `ScaledRate` that respect U01 bounds and scales.
2. Portfolio generators with isolated `PortfolioId`, canonical holdings, lots, available delivery quantities, and non-negative cash.
3. Candidate-instrument generators that preserve linkage among eligibility, signal, sector/group, liquidity, and volatility fields.
4. Strategy-policy generators for cadence, turnover windows, rank buffers, replacement hurdles, and minimum order values.
5. Effective-dated cost/tax schedule generators with overlapping and non-overlapping date ranges.
6. Lot-selection generators that produce FIFO/HIFO/SPECIFIC-compatible lot graphs and edge cases such as tiny residual quantities.
7. Calendar generators for finalized session dates, next eligible trading dates, and invalid same-session timing attempts.
8. Optimizer outcome generators that cover accepted, timeout, infeasible, solver-error, and verifier-rejected responses.

### Shrinking and Reproducibility Expectations

- Shrinking must preserve structural validity: total target weights remain exact, lots remain non-negative, and turnover windows remain well-formed.
- Counterexamples should shrink toward:
  - fewer holdings,
  - fewer lots,
  - smaller turnover budgets,
  - narrower drift deltas,
  - smaller residual cash,
  - minimal conflicting constraints.
- Failing property runs must record the `fast-check` seed and the final shrunk counterexample.
- Any property failure discovered later in code generation should produce a permanent example-based regression test alongside the property test.

### Framework Alignment

Per approved NFR-TEST, later code generation should use `fast-check` with Node’s test runner. U04 functional design does not add new tooling; it specifies the properties and generators that later tests must implement.

## Frontend Scope

No frontend artifact is produced in U04. This model is intentionally backend/domain-only and feeds U08’s future preview and approval screens through stable contracts.
