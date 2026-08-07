# U04 Business Rules

## Rule Numbering Convention

Rules are grouped by subsystem. Each rule has a unique identifier, a precise requirement, and one primary failure code.

| Subsystem ID | Scope |
|---|---|
| GAT | Planning gates and input integrity |
| TGT | Ideal target construction |
| EXE | Executable target and greedy allocation |
| OPT | Advanced optimizer port and deterministic fallback |
| CTT | Cost, tax, and lot-selection behavior |
| CAD | Cadence, drift, preferred-hold, and turnover policy |
| INT | Interim exception authorization |
| PLN | Plan assembly, lifecycle, explainability, and hash semantics |
| ABU | Misuse, abuse, and fail-closed behavior |

## GAT: Planning Gates and Input Integrity

| Rule | Requirement | Failure code |
|---|---|---|
| GAT-001 | A planning request must reference exactly one canonical `PortfolioId` and one canonical `RebalanceRunId`. | `INVALID_PLANNING_SCOPE` |
| GAT-002 | Every portfolio-scoped input to U04 must carry the same `PortfolioId`; cross-portfolio mixing is rejected. | `PORTFOLIO_SCOPE_MISMATCH` |
| GAT-003 | Planning input must include immutable strategy, evaluation, regime, holdings, lots, and reconciliation lineage identifiers before any target logic runs. | `MISSING_PLANNING_LINEAGE` |
| GAT-004 | Routine planning uses finalized EOD decision data only; pre-close, intraday, or provisional data is invalid. | `NON_FINALIZED_DECISION_DATA` |
| GAT-005 | Planning `asOf` must not precede the evaluation `asOf` date or the relevant portfolio snapshot date. | `INVALID_PLANNING_DATE` |
| GAT-006 | Archived portfolios cannot produce approval-ready rebalance plans. | `PORTFOLIO_ARCHIVED` |
| GAT-007 | A planning request must resolve one effective cost schedule version and one effective tax rule version for the planning date. | `EFFECTIVE_RULE_VERSION_MISSING` |
| GAT-008 | Planning must use a confirmed exchange session and canonical Asia/Kolkata session timing metadata. | `INVALID_SESSION_CONTEXT` |
| GAT-009 | Missing, stale, unresolved, or inconsistent prerequisite data never becomes favorable for a buy, increase, or discretionary replacement. | `PLANNING_PREREQUISITE_UNSAFE` |
| GAT-010 | U04 never reads a live system clock, broker position stream, or legacy intraday state directly; all timing and state arrive as validated inputs. | `CAPABILITY_BOUNDARY_VIOLATION` |
| GAT-011 | The planner must compute `planInputHash` from canonical immutable inputs before constructing targets. | `PLAN_INPUT_HASH_MISSING` |
| GAT-012 | The same canonical immutable inputs must be sufficient to reproduce the same target and plan output. | `NON_DETERMINISTIC_INPUT_MODEL` |

## TGT: Ideal Target Construction

| Rule | Requirement | Failure code |
|---|---|---|
| TGT-001 | Only instruments with immutable U03 evaluation outputs may enter U04 target construction. | `CANDIDATE_LINEAGE_MISSING` |
| TGT-002 | Mandatory exits caused by hard risk, mandatory eligibility failure, or verified corporate-action blocks target zero weight before discretionary scoring rules are evaluated. | `MANDATORY_EXIT_NOT_ZEROED` |
| TGT-003 | New buy candidates must satisfy all hard entry constraints before they participate in ideal target weighting. | `ENTRY_CONSTRAINT_FAILURE` |
| TGT-004 | Current holdings may remain in the ideal candidate set when they are still eligible or explicitly hold-eligible under the assigned strategy policy. | `INVALID_HOLD_RETENTION` |
| TGT-005 | Ideal target weighting uses inverse volatility adjusted by conviction: `rawIntent = convictionMultiplier / realizedVolatility`. | `INVALID_WEIGHTING_FORMULA` |
| TGT-006 | Realized volatility for new or increased positions must be positive, finite, and point-in-time valid. | `INVALID_VOLATILITY_INPUT` |
| TGT-007 | Conviction multipliers must come from immutable U03 signal output and are not recomputed or modified inside U04. | `CONVICTION_LINEAGE_MUTATION` |
| TGT-008 | The ideal target set may contain fewer names than the preset target-holdings count when no additional safe entrant exists. | `UNSAFE_FILLER_POSITION` |
| TGT-009 | Ideal target normalization must preserve exact exposure and cash arithmetic using U01 exact values only. | `IDEAL_TARGET_ARITHMETIC_FAILURE` |
| TGT-010 | Confirmed regime exposure caps and preset cash buffers apply before concentration constraints are relaxed or entrants are added. | `EXPOSURE_CAP_BYPASS` |
| TGT-011 | Single-name caps, sector caps, group caps, small-cap caps, and liquidity-derived notional caps are hard ceilings during ideal target construction. | `IDEAL_CONSTRAINT_VIOLATION` |
| TGT-012 | Missing sector, group, market-cap, or liquidity classification blocks a new buy or increase rather than defaulting to an unconstrained bucket. | `CLASSIFICATION_REQUIRED` |
| TGT-013 | Ideal target outputs must record every excluded candidate with a structured exclusion reason. | `EXCLUSION_REASON_MISSING` |
| TGT-014 | Ideal target positions are canonically ordered by `instrumentId` and do not depend on input ordering. | `NON_CANONICAL_TARGET_ORDER` |

## EXE: Executable Target and Greedy Allocation

| Rule | Requirement | Failure code |
|---|---|---|
| EXE-001 | Executable targets must be whole-share portfolios only. Fractional shares are invalid. | `FRACTIONAL_EXECUTABLE_TARGET` |
| EXE-002 | Executable targets must never create negative cash. | `NEGATIVE_EXECUTABLE_CASH` |
| EXE-003 | Executable targets must never create short positions. | `SHORT_POSITION_FORBIDDEN` |
| EXE-004 | Executable targets must never create leverage or margin-funded output. | `LEVERAGE_FORBIDDEN` |
| EXE-005 | Sells and reductions cannot exceed the reconciled available delivery quantity. | `DELIVERY_QUANTITY_EXCEEDED` |
| EXE-006 | The initial executable seed floors ideal target values to whole shares using finalized decision prices only. | `INVALID_WHOLE_SHARE_SEED` |
| EXE-007 | Residual cash after floor-rounding remains explicit cash until a feasible increment consumes it. | `RESIDUAL_CASH_LOST` |
| EXE-008 | Greedy allocation may add an increment only when the resulting portfolio still satisfies every hard constraint. | `GREEDY_INCREMENT_UNSAFE` |
| EXE-009 | Greedy allocation must evaluate increments using deterministic benefit ordering and deterministic tie-breakers. | `GREEDY_ORDER_NON_DETERMINISTIC` |
| EXE-010 | The greedy allocator must stop when no feasible increment exists; it may not force full investment by violating a hard constraint. | `FORCED_OVERALLOCATION` |
| EXE-011 | Minimum-order-value policy is evaluated after netting all changes for the same instrument. | `MIN_ORDER_VALUE_NOT_NETTED` |
| EXE-012 | An executable no-trade outcome is valid when the current reconciled state already satisfies all hard constraints and policy gates. | `INVALID_NO_TRADE_REJECTION` |
| EXE-013 | Every executable position that differs from the ideal target must record the binding constraint reasons responsible for the deviation. | `EXECUTABLE_REASON_MISSING` |
| EXE-014 | Executable position ordering is canonical by `instrumentId`; equivalent inputs cannot reorder positions semantically. | `NON_CANONICAL_EXECUTABLE_ORDER` |
| EXE-015 | Executable target weight, cash, and notional totals must reconcile exactly to the approved calculation tolerance. | `EXECUTABLE_RECONCILIATION_FAILURE` |

## OPT: Advanced Optimizer Port and Deterministic Fallback

| Rule | Requirement | Failure code |
|---|---|---|
| OPT-001 | Advanced optimization is optional and must be invoked through a dedicated port rather than embedded as implicit planner state. | `OPTIMIZER_PORT_REQUIRED` |
| OPT-002 | Supported optimizer modes are limited to verified integer tracking and verified risk parity under identical hard constraints. | `UNSUPPORTED_OPTIMIZER_MODE` |
| OPT-003 | Every optimizer request must include canonical candidate lineage, hard constraints, objective metadata, timeout budget, and request hash. | `OPTIMIZER_REQUEST_INCOMPLETE` |
| OPT-004 | The optimizer may optimize only inside the feasible set defined by U04 hard constraints. | `OPTIMIZER_CONSTRAINT_ESCAPE` |
| OPT-005 | Every optimizer response must provide duration, iteration count, and violated-constraint metadata. | `OPTIMIZER_METADATA_MISSING` |
| OPT-006 | Every optimizer response must be re-verified by U04 before it can affect the emitted executable target. | `OPTIMIZER_VERIFICATION_SKIPPED` |
| OPT-007 | A timeout, infeasible model, solver error, or verifier rejection must trigger deterministic fallback rather than partial acceptance. | `OPTIMIZER_FALLBACK_REQUIRED` |
| OPT-008 | Fallback output must be the same deterministic greedy target that would have been produced had the optimizer not been called. | `NON_DETERMINISTIC_FALLBACK` |
| OPT-009 | U04 must never emit an unconstrained or partially verified optimizer result. | `UNCONSTRAINED_OPTIMIZER_OUTPUT` |
| OPT-010 | Oracle comparison for reference small problems must use a precisely defined equivalence or objective-improvement tolerance. | `OPTIMIZER_ORACLE_UNDEFINED` |

## CTT: Cost, Tax, and Lot Selection

| Rule | Requirement | Failure code |
|---|---|---|
| CTT-001 | Cost schedules are configurable independently of strategy logic and referenced by effective-dated version. | `COST_SCHEDULE_UNBOUND` |
| CTT-002 | The selected cost schedule version for a plan is the latest version effective on or before the plan `asOf` date. | `COST_SCHEDULE_NOT_EFFECTIVE` |
| CTT-003 | Cost estimation for proposed orders must include brokerage, STT, exchange charges, GST, SEBI charges, stamp duty, DP charges, spread, slippage, market impact, and configured broker fees where applicable. | `INCOMPLETE_COST_ESTIMATE` |
| CTT-004 | Missing cost inputs block discretionary order generation rather than defaulting to zero drag. | `COST_INPUT_MISSING` |
| CTT-005 | Live and backtest planning must share the same conceptual cost model and effective schedule versions for matching dates. | `COST_MODEL_DIVERGENCE` |
| CTT-006 | Tax rule sets are configurable independently of strategy logic and referenced by effective-dated version. | `TAX_RULESET_UNBOUND` |
| CTT-007 | The selected tax rule version for a plan is the latest version effective on or before the plan `asOf` date. | `TAX_RULESET_NOT_EFFECTIVE` |
| CTT-008 | Tax estimation for a sell or reduction must operate on actual holding lots only. | `LOT_LINEAGE_MISSING` |
| CTT-009 | FIFO selects the earliest acquisition-date lots first; lot ID is the deterministic tie-breaker. | `FIFO_SELECTION_INVALID` |
| CTT-010 | HIFO selects the highest unit-cost lots first; acquisition date and then lot ID are deterministic tie-breakers. | `HIFO_SELECTION_INVALID` |
| CTT-011 | SPECIFIC lot selection requires an explicit deterministic lot instruction; otherwise discretionary selling is blocked. | `LOT_SELECTION_INSTRUCTION_MISSING` |
| CTT-012 | When a hard-risk exit must proceed but a SPECIFIC instruction is absent, U04 may compute a provisional FIFO tax estimate only to avoid delaying risk reduction. | `PROVISIONAL_TAX_ESTIMATE_REQUIRED` |
| CTT-013 | Tax estimates must distinguish short-term and long-term holding periods using the effective-dated holding-period rule set. | `HOLDING_PERIOD_CLASSIFICATION_INVALID` |
| CTT-014 | Expected improvement that does not exceed estimated costs, taxes, turnover drag, and configured replacement hurdle must be skipped for discretionary replacements. | `AFTER_DRAG_HURDLE_NOT_MET` |
| CTT-015 | Cost and tax preference never override a verified hard-risk exit or mandatory eligibility exit. | `RISK_EXIT_VETO_FORBIDDEN` |

## CAD: Cadence, Drift, Preferred Holds, and Turnover

| Rule | Requirement | Failure code |
|---|---|---|
| CAD-001 | Routine constituent changes are allowed only on the strategy’s assigned biweekly, monthly, or quarterly cadence. | `ROUTINE_CADENCE_NOT_OPEN` |
| CAD-002 | Drift-only reviews are allowed only on the assigned weekly or monthly drift-review cadence. | `DRIFT_REVIEW_NOT_OPEN` |
| CAD-003 | All routine planning decisions must be based on finalized EOD data and execute only in the next eligible session. | `ROUTINE_TIMING_VIOLATION` |
| CAD-004 | Manual triggering of routine planning does not bypass cadence controls. | `MANUAL_CADENCE_BYPASS` |
| CAD-005 | No-trade-band evaluation uses the greater of the absolute drift threshold and the relative fraction-of-target threshold. | `DRIFT_BAND_FORMULA_INVALID` |
| CAD-006 | Holdings inside the no-trade band are skipped unless a mandatory exception applies. | `NO_TRADE_BAND_BYPASS` |
| CAD-007 | Preferred minimum hold days suppress discretionary churn but do not block mandatory exits. | `PREFERRED_HOLD_MISAPPLIED` |
| CAD-008 | Hold-rank buffers allow healthy incumbents to remain without forcing a replacement solely because a non-materially better entrant exists. | `HOLD_BUFFER_BYPASS` |
| CAD-009 | Replacement candidates must clear the configured after-drag replacement score gap before they can displace an incumbent outside a mandatory exception. | `REPLACEMENT_HURDLE_NOT_MET` |
| CAD-010 | Turnover budgets are portfolio-scoped and aggregate across every plan inside their respective windows. | `TURNOVER_SCOPE_INVALID` |
| CAD-011 | U04 must support rolling 30-day, calendar-month, calendar-quarter, and calendar-year turnover windows when configured by the assigned preset. | `TURNOVER_WINDOW_UNSUPPORTED` |
| CAD-012 | Turnover consumption is measured conservatively as the greater of total buy notional or total sell notional divided by starting NAV. | `TURNOVER_FORMULA_INVALID` |
| CAD-013 | Discretionary actions that exceed any remaining turnover window budget are skipped with a structured reason. | `TURNOVER_BUDGET_EXCEEDED` |
| CAD-014 | Same-session routine trades, intentional same-day round trips, and legacy intraday rules are forbidden. | `INTRADAY_POLICY_FORBIDDEN` |

## INT: Interim Exception Authorization

| Rule | Requirement | Failure code |
|---|---|---|
| INT-001 | Interim planning is denied by default and must prove an allowed exception family. | `INTERIM_AUTHORIZATION_REQUIRED` |
| INT-002 | Allowed interim exception families are limited exactly to hard risk, mandatory eligibility failure, verified corporate action, and confirmed regime exposure reduction. | `INTERIM_REASON_UNSUPPORTED` |
| INT-003 | Exactly one primary interim reason family must anchor an interim plan; composite free-form exceptions are invalid. | `INTERIM_REASON_AMBIGUOUS` |
| INT-004 | AI advisory, AI sentiment, or AI explanation alone must never authorize an interim constituent change, reduction, or exit. | `AI_ADVISORY_NOT_AUTHORIZED` |
| INT-005 | Confirmed regime exposure reduction authorizes only sells or reductions that move realized exposure toward the already confirmed weaker regime band. | `REGIME_REDUCTION_SCOPE_INVALID` |
| INT-006 | Interim regime logic must not authorize opportunistic new buys, lateral swaps, or routine ranking refreshes. | `INTERIM_BUY_FORBIDDEN` |
| INT-007 | A verified corporate-action exception may authorize only the minimum changes required by the verified action state. | `CORPORATE_ACTION_SCOPE_EXCEEDED` |
| INT-008 | Mandatory eligibility failure and hard-risk exits override preferred holds, discretionary turnover ceilings, and discretionary cost/tax vetoes. | `MANDATORY_EXIT_OVERRIDE_MISSING` |
| INT-009 | Interim authorization must carry verified source references and attribution. | `INTERIM_PROOF_MISSING` |
| INT-010 | Unverified, stale, or conflicting exception evidence blocks interim plan creation. | `INTERIM_EVIDENCE_UNSAFE` |

## PLN: Plan Assembly, Lifecycle, Explainability, and Hash Semantics

| Rule | Requirement | Failure code |
|---|---|---|
| PLN-001 | Every evaluated instrument-level action must be categorized as proposed, skipped, or blocked. | `ACTION_BUCKET_MISSING` |
| PLN-002 | Proposed orders must include exact quantities, prices, notional values, costs, and target weights. | `PROPOSED_ORDER_INCOMPLETE` |
| PLN-003 | Skipped actions must include structured reason codes and a human explanation. | `SKIPPED_REASON_MISSING` |
| PLN-004 | Blocked actions must include the missing or unsafe prerequisite that caused the block. | `BLOCKED_REASON_MISSING` |
| PLN-005 | Every order or non-order action must carry a deterministic logical-order key derived from canonical semantics rather than output ordering. | `LOGICAL_ORDER_KEY_MISSING` |
| PLN-006 | Equivalent plan inputs must yield the same `planHash`. | `PLAN_HASH_NON_DETERMINISTIC` |
| PLN-007 | Equivalent plans must not duplicate logical orders semantically even if regenerated later. | `DUPLICATE_LOGICAL_ORDER` |
| PLN-008 | Non-equivalent later plans may supersede an earlier approval-ready plan only when the underlying immutable state changed materially. | `SUPERSEDE_WITHOUT_STATE_CHANGE` |
| PLN-009 | The plan summary must reconcile current versus projected cash, exposure, and concentration views exactly. | `PLAN_SUMMARY_RECONCILIATION_FAILURE` |
| PLN-010 | Implementation shortfall must quantify and explain the exact difference between ideal and executable targets. | `IMPLEMENTATION_SHORTFALL_MISSING` |
| PLN-011 | Approval-ready plans must preserve immutable `planInputHash`, `planHash`, strategy lineage, and data lineage for downstream approval binding. | `PLAN_LINEAGE_MISSING` |
| PLN-012 | U04 owns only `DRAFT`, `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED` plan states. | `PLAN_STATE_UNSUPPORTED` |
| PLN-013 | U04 may emit `APPROVAL_READY` only when the plan is fully validated and explainable. | `APPROVAL_READY_PREMATURE` |
| PLN-014 | `INVALIDATED` is required when the plan’s prerequisite lineage is no longer current or safe. | `PLAN_INVALIDATION_MISSING` |
| PLN-015 | `EXPIRED` is required when the next eligible execution window closes before U05 binds approval/execution to the plan. | `PLAN_EXPIRY_MISSING` |
| PLN-016 | `SUPERSEDED`, `INVALIDATED`, and `EXPIRED` plans remain immutable historical facts and are never rewritten into a new approval-ready plan. | `PLAN_HISTORY_MUTATION` |
| PLN-017 | Plan explanations must be safe, deterministic, and free of secrets, credentials, or arbitrary unvetted text. | `UNSAFE_PLAN_EXPLANATION` |

## ABU: Misuse, Abuse, and Fail-Closed Behavior

| Rule | Requirement | Failure code |
|---|---|---|
| ABU-001 | Missing required lineage, schedule, classification, or liquidity data must block the affected discretionary action rather than be inferred optimistically. | `MISSING_DATA_FAIL_CLOSED` |
| ABU-002 | Unknown enum values, unsupported reason families, or unsupported optimizer modes fail closed. | `UNKNOWN_VALUE_REJECTED` |
| ABU-003 | Planning must never degrade into a best-effort unconstrained portfolio because an optimizer, schedule lookup, or tax engine failed. | `UNSAFE_DEGRADED_PLANNING` |
| ABU-004 | Portfolio isolation is mandatory: one portfolio’s turnover, holdings, or plan lineage may never influence another portfolio’s plan state. | `PORTFOLIO_ISOLATION_BREACH` |
| ABU-005 | Re-running planning with identical immutable inputs must not generate a new semantic order basket for duplicate approval attempts. | `EQUIVALENT_PLAN_DUPLICATED` |
| ABU-006 | Stale, pre-close, or non-finalized market data must not become executable planning output even if the resulting plan appears profitable. | `STALE_DATA_NOT_EXECUTABLE` |
| ABU-007 | A verified hard-risk exit may reduce or exit an unsafe holding, but it still may not exceed available delivery quantity or create leverage. | `RISK_EXIT_EXECUTABLE_LIMIT` |
| ABU-008 | Human-readable explanations must not claim certainty about AI-advisory content or unverified corporate-action facts. | `UNVERIFIED_EXPLANATION_FORBIDDEN` |
| ABU-009 | A plan may never silently convert a blocked action into a skipped action or a skipped action into a proposed action without a rule-satisfying state change. | `ACTION_STATE_DOWNGRADE_FORBIDDEN` |
| ABU-010 | Any internal verifier disagreement about constraint satisfaction invalidates the candidate output and falls back to a safer state. | `VERIFIER_DISAGREEMENT_FAIL_CLOSED` |

## Mandatory Example Scenarios

1. Construct ideal and executable targets for a monthly preset portfolio that is already inside its no-trade band.
2. Skip a discretionary replacement because after-cost and after-tax improvement does not clear the replacement hurdle.
3. Block a new buy because group classification is missing even though its score is attractive.
4. Reduce a holding because a confirmed weaker regime requires exposure reduction, without authorizing a new buy.
5. Exit a hard-risk holding despite preferred hold, tax drag, and turnover pressure, while still respecting available delivery quantity.
6. Reject a solver result that violates a single-name cap and fall back to deterministic greedy output.
7. Produce an equivalent plan hash and logical order set when the same immutable inputs are replayed.
8. Mark a plan expired after its next eligible execution window closes without U05 approval binding.

## Rule Count

This artifact defines **117** unique U04 business rules across nine subsystems.

## Extension Compliance

### Security Baseline

| Rule | Status | Rationale |
|---|---|---|
| SECURITY-01 | N/A | U04 functional design defines no new persistence store or transport; encryption is owned by U02/U06. |
| SECURITY-02 | N/A | U04 defines no network intermediary. |
| SECURITY-03 | N/A | U04 is pure planning/domain logic in this stage and owns no deployed logging sink. |
| SECURITY-04 | N/A | U04 serves no HTML. |
| SECURITY-05 | Compliant | Canonical planning inputs, exact-value contracts, effective-dated schedules, and closed enums are all validated before planning. |
| SECURITY-06 | N/A | U04 defines no IAM or runtime permission policy. |
| SECURITY-07 | N/A | U04 defines no network configuration. |
| SECURITY-08 | N/A | Endpoint authentication and authorization belong to U07, though U04 still enforces portfolio scope and fail-closed plan lineage. |
| SECURITY-09 | N/A | U04 defines no deployed runtime hardening surface. |
| SECURITY-10 | N/A | Functional design introduces no dependency or CI/CD change. |
| SECURITY-11 | Compliant | Security-sensitive planning decisions are isolated, misuse scenarios are explicit, and AI/business-logic abuse is fail-closed. |
| SECURITY-12 | N/A | U04 handles no authentication, sessions, passwords, or secrets. |
| SECURITY-13 | Compliant | Canonical hashes, immutable lineage, lot provenance, and logical-order keys preserve software and data integrity. |
| SECURITY-14 | N/A | Alerting/monitoring ownership belongs to U06 rather than U04’s pure domain layer. |
| SECURITY-15 | Compliant | Missing prerequisites, solver failures, stale data, and verifier disagreements all fail closed with no unsafe fallback. |

No blocking U04 functional-design security findings remain.

### Resiliency Baseline

| Rule | Status | Rationale |
|---|---|---|
| RESILIENCY-01 | Compliant | U04 planning is documented as a High workload with explicit upstream and downstream dependencies. |
| RESILIENCY-02 | Compliant by reference | Approved project availability, RTO, and RPO targets already exist in requirements and U04 does not contradict them. |
| RESILIENCY-03 | N/A | Change-management process is project-level and not redefined in this pure-domain stage. |
| RESILIENCY-04 | N/A | U04 defines no deployment or rollback workflow. |
| RESILIENCY-05 | N/A | Monitoring and alerting design belongs to later operational stages. |
| RESILIENCY-06 | N/A | U04 is not a service and defines no health endpoint. |
| RESILIENCY-07 | N/A | U04 owns no deployed resiliency monitoring resource. |
| RESILIENCY-08 | N/A | U04 defines no compute topology and the approved target is local workstation deployment. |
| RESILIENCY-09 | N/A | U04 defines no auto-scaling runtime. |
| RESILIENCY-10 | Compliant | Optimizer and schedule dependencies are isolated through explicit contracts, timeouts, verification, and deterministic fallback behavior. |
| RESILIENCY-11 | N/A | Disaster-recovery strategy is tied to persistent state and operations, not U04’s pure planning layer. |
| RESILIENCY-12 | N/A | U04 owns no persistent backup or replication resource. |
| RESILIENCY-13 | N/A | Failover runbooks are outside functional design scope for this unit. |
| RESILIENCY-14 | N/A | Chaos/DR testing is captured later in NFR Design and Operations, not in this pure-domain stage. |
| RESILIENCY-15 | N/A | Incident-response process is project-level and not redefined by U04 functional design. |

No blocking U04 functional-design resiliency findings remain.

### Property-Based Testing

| Rule | Status | Rationale |
|---|---|---|
| PBT-01 | Compliant | U04 artifacts identify round-trip, invariant, idempotence, oracle, easy-verification, and stateful-model properties with domain generators. |
| PBT-02 | N/A at Functional Design | Round-trip targets are identified for later code generation and test implementation. |
| PBT-03 | N/A at Functional Design | Invariant targets are identified for later code generation and test implementation. |
| PBT-04 | N/A at Functional Design | Idempotent planner behaviors are identified for later code generation and test implementation. |
| PBT-05 | N/A at Functional Design | Oracle/model-based allocator and verifier comparisons are identified for later code generation and test implementation. |
| PBT-06 | N/A at Functional Design | Stateful plan-lifecycle and interim-authorization models are identified for later code generation and test implementation. |
| PBT-07 | N/A at Functional Design | Generator-quality requirements are documented for later code generation. |
| PBT-08 | N/A at Functional Design | Shrinking and reproducibility expectations are documented for later implementation and build integration. |
| PBT-09 | N/A at Functional Design | `fast-check` with Node test runner is already selected in approved NFR-TEST and will be enforced later. |
| PBT-10 | N/A at Functional Design | Complementary example-test expectations are documented for later code generation. |

PBT-01 has no blocking finding. Downstream PBT rules are intentionally deferred to the stages that implement tests.
