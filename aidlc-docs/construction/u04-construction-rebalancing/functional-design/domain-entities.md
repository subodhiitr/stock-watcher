# U04 Domain Entities

## Aggregate Boundary

U04 owns one immutable planning aggregate: `RebalancePlan`. It is produced from immutable portfolio, holdings, lots, strategy, evaluation, regime, calendar, and reconciliation snapshots. U04 does not mutate holdings, cash, lots, approvals, orders, broker state, or legacy intraday systems.

All U04 child entities share one `PortfolioId`, one `RebalanceRunId`, one planning `asOf` date, one `planInputHash`, and one `planHash`. No child entity is independently mutable or executable.

## Relationship Model

- One `RebalancePlan` has exactly one `PlanningContextSnapshot`.
- One `RebalancePlan` has exactly one `IdealTarget`.
- One `RebalancePlan` has exactly one `ExecutableTarget`.
- One `RebalancePlan` has exactly one `ImplementationShortfall`.
- One `RebalancePlan` has zero or more `ProposedOrder` values.
- One `RebalancePlan` has zero or more `SkippedOrder` values.
- One `RebalancePlan` has zero or more `BlockedOrder` values.
- One `RebalancePlan` has zero or more `PlanWarning` values.
- One `RebalancePlan` has exactly one `TurnoverBudgetSnapshot`.
- One `RebalancePlan` has exactly one `PlanTiming`.
- One `ExecutableTargetPosition` may reference zero or more `LotDisposition` values when the position is being reduced or exited.
- One `ProposedOrder` may reference zero or more `AppliedConstraintReason` values and one optional `TaxEstimate`.
- One `InterimAuthorization` is either absent or bound to exactly one allowed interim reason family.

## Exact-Value and Canonical Type Reuse

U04 reuses U01 and U03 approved contracts without redefining them.

| Concept | U04 representation | Rule |
|---|---|---|
| Cash, cost, tax, value, notional | `Money` from U01 (`currency: 'INR'`, `minorUnits: bigint`) | Exact arithmetic only; no binary floating point accounting |
| Shares, lots, available delivery | `Quantity` from U01 (`shares: bigint`) | Non-negative whole shares only |
| Portfolio, target, sector, group, exposure weights | `Weight` from U01 (`partsPerMillion: bigint`) | Exact 0 through 1,000,000 PPM only |
| Volatility, conviction, drag rates, turnover ratios | `ScaledRate` from U01 | Scale is explicit and conversions are never implicit |
| Portfolio and run scope | `PortfolioId`, `RebalanceRunId`, `InstrumentId`, `StrategyVersionId`, `DataVersionId` | All branded and non-interchangeable |
| Dates and instants | `LocalDate`, `Instant` from U01 | Planning uses finalized EOD `LocalDate` plus canonical UTC instants |
| Canonical integrity hash | `IntegrityHash` from U01/U03 | Lowercase 64-character SHA-256 hex of canonical JSON |

U04 additionally uses U03 outputs as immutable inputs:

- `StrategyConfig` and `StrategyConfigHash`
- `EligibilityResult`
- `SignalSnapshot`
- `RegimeState`
- `CorporateAction`

And U01/U02 portfolio state baselines:

- `PortfolioSnapshot`
- `Holding`
- `HoldingLot`

## RebalancePlan Aggregate

### Identity and State

| Field | Type | Rule |
|---|---|---|
| `rebalanceRunId` | `RebalanceRunId` | Immutable unique plan identity |
| `portfolioId` | `PortfolioId` | Must equal every child entity portfolio scope |
| `state` | `PlanLifecycleState` | U04-owned states only |
| `planningIntent` | `PlanningIntent` | `ROUTINE` or `INTERIM_EXCEPTION` |
| `asOf` | `LocalDate` | Finalized decision date |
| `createdAt` | `Instant` | Canonical UTC creation instant |
| `planInputHash` | `IntegrityHash` | Canonical hash of immutable planning inputs |
| `planHash` | `IntegrityHash` | Canonical hash of the resulting approval-ready plan |
| `context` | `PlanningContextSnapshot` | Full immutable dependency lineage |
| `idealTarget` | `IdealTarget` | Unconstrained intent within allowed exposure/cash policy |
| `executableTarget` | `ExecutableTarget` | Constraint-valid whole-share target |
| `implementationShortfall` | `ImplementationShortfall` | Exact quantified difference between ideal and executable outputs |
| `proposedOrders` | `readonly ProposedOrder[]` | Canonical immutable order basket |
| `skippedOrders` | `readonly SkippedOrder[]` | Canonical immutable evaluated-but-not-selected actions |
| `blockedOrders` | `readonly BlockedOrder[]` | Canonical immutable fail-closed actions |
| `turnoverBudget` | `TurnoverBudgetSnapshot` | Portfolio-scoped aggregate budget state |
| `timing` | `PlanTiming` | EOD-only decision and next-eligible-session execution window |
| `warnings` | `readonly PlanWarning[]` | Non-fatal but explainable planner warnings |
| `summary` | `ApprovalReadySummary` | Read projection for downstream approval and UI use |

### U04-Owned Lifecycle States

| State | Meaning | Produced by |
|---|---|---|
| `DRAFT` | Ephemeral in-memory assembly state only; never persisted or exposed outside U04 | Planner internals |
| `APPROVAL_READY` | Immutable plan is complete, equivalent-safe, and ready for U05 approval binding | Successful U04 planning |
| `SUPERSEDED` | A later non-equivalent plan replaced this one before approval binding | Subsequent U04 planning |
| `INVALIDATED` | The plan became unsafe because input lineage, portfolio state, or required prerequisites changed | U04 revalidation |
| `EXPIRED` | The plan aged beyond its next eligible execution window without being rebound by U05 | U04 timing revalidation |

U04 does not define `APPROVED`, `REJECTED`, `EXECUTING`, `PARTIALLY_FILLED`, or `RECONCILED`. Those belong to U05.

`PlanLifecycleState` is closed to `DRAFT`, `APPROVAL_READY`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED`.

## PlanningContextSnapshot

| Field | Type | Rule |
|---|---|---|
| `portfolioSnapshotVersion` | `PortfolioStateVersion` | Must match the exact portfolio snapshot used for planning |
| `portfolioMode` | U01 `OperatingMode` | Planning never upgrades authority implied by mode |
| `strategyVersionId` | `StrategyVersionId` | Immutable active or assigned strategy version |
| `strategyConfigHash` | `StrategyConfigHash` | Exact strategy lineage anchor |
| `dataVersionId` | `DataVersionId` | Immutable evaluation data lineage |
| `evaluationAsOf` | `LocalDate` | Must equal or precede the planning `asOf` date |
| `regimeCategory` | U03 `RegimeCategory` | Confirmed regime only; provisional states do not authorize interim changes |
| `calendarSessionId` | typed string | Identifies the finalized exchange session being planned from |
| `costScheduleVersionId` | typed string | Effective-dated cost schedule used for every estimate |
| `taxRuleVersionId` | typed string | Effective-dated tax rule set used for every estimate |
| `turnoverLedgerVersionId` | typed string | Exact aggregated turnover ledger snapshot |
| `reconciliationSnapshotId` | typed string | Confirms actual broker or paper position baseline |
| `interimAuthorization` | `InterimAuthorization` or absent | Present only for allowed interim planning |

## PlanningIntent and Authorization Values

### PlanningIntent

| Value | Meaning |
|---|---|
| `ROUTINE` | Cadence-driven portfolio review using preset schedule and finalized EOD data |
| `INTERIM_EXCEPTION` | A non-routine plan limited to one approved exception family |

### InterimAuthorization

| Field | Type | Rule |
|---|---|---|
| `reasonFamily` | `InterimReasonFamily` | Exactly one allowed family |
| `sourceIds` | `readonly string[]` | Canonical references to the verified facts that justify the exception |
| `verifiedAt` | `Instant` | Must be at or before plan creation |
| `verifiedBy` | `ActorId` or system identity | Deterministic attribution |
| `exposureDeltaOnly` | boolean | `true` only for regime-driven exposure reduction |
| `advisoryEvidenceExcluded` | boolean | Must be `true`; AI-only evidence is forbidden |

`InterimReasonFamily` is closed to exactly:

- `HARD_RISK_EXIT`
- `MANDATORY_ELIGIBILITY_FAILURE`
- `VERIFIED_CORPORATE_ACTION`
- `CONFIRMED_REGIME_EXPOSURE_REDUCTION`

## Constraint and Policy Values

### ConstructionConstraintSet

| Field | Type | Rule |
|---|---|---|
| `targetHoldings` | positive integer | Preset target holdings count |
| `maxHoldings` | positive integer | Cannot be less than `targetHoldings` |
| `maxStockWeight` | `Weight` | Hard single-name cap |
| `maxSectorWeight` | `Weight` | Hard sector cap |
| `maxGroupWeight` | `Weight` | Hard corporate-group cap |
| `maxSmallCapWeight` | `Weight` | Hard aggregate small-cap cap |
| `maxLiquidityParticipation` | `ScaledRate` | Hard liquidity sizing cap |
| `cashBufferFloor` | `Weight` | Minimum residual cash floor |
| `regimeExposureCap` | `Weight` | Hard gross equity exposure cap from confirmed regime |
| `turnoverBudgetCeiling` | `ScaledRate` | Portfolio-scoped turnover availability for this run |
| `minimumOrderValue` | `Money` | Netted logical-order floor |
| `replacementScoreGap` | `ScaledRate` | Minimum after-drag improvement hurdle |
| `preferredMinimumHoldDays` | non-negative integer | Churn-suppression policy only |
| `absoluteDriftBand` | `Weight` | Absolute no-trade band floor |
| `relativeDriftBand` | `ScaledRate` | Relative no-trade band multiplier |

### CadencePolicySnapshot

| Field | Type | Rule |
|---|---|---|
| `strategyHorizon` | `SHORT \| MEDIUM \| LONG` | Derived from immutable strategy configuration |
| `routineFrequency` | `BIWEEKLY \| MONTHLY \| QUARTERLY` | Routine constituent cadence |
| `driftReviewFrequency` | `WEEKLY \| MONTHLY` | Weight-only review cadence |
| `nextRoutineDecisionDate` | `LocalDate` | First eligible post-schedule planning date |
| `nextDriftReviewDate` | `LocalDate` | First eligible post-drift-review date |
| `preferredMinimumHoldDays` | integer | Horizon-specific preferred hold |
| `turnoverWindowDefinitions` | `readonly TurnoverWindowDefinition[]` | Rolling/calendar windows required by the preset |

## Target Entities

### CandidateInstrument

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Canonical portfolio/exchange instrument identity |
| `eligibility` | `EligibilityResult` | Must be immutable and as-of the plan date |
| `signal` | `SignalSnapshot` | Supplies rank, composite score, conviction, risk flags |
| `currentHolding` | `Holding` or absent | Present when already owned |
| `sectorId` | typed string | Point-in-time classification |
| `groupId` | typed string or absent | Missing value blocks new buy/increase |
| `marketCapBucket` | enum | Includes `SMALL_CAP` classification for cap constraints |
| `price` | `Money` | Finalized per-share decision price |
| `realizedVolatility` | `ScaledRate` | Input to inverse-volatility weighting |
| `availableDeliveryQuantity` | `Quantity` | Actual executable baseline for sells |
| `liquidityCapacity` | `Money` | Maximum notional increment allowed by liquidity policy |

### IdealTarget

| Field | Type | Rule |
|---|---|---|
| `totalEquityWeight` | `Weight` | At or below regime exposure cap |
| `cashWeight` | `Weight` | At or above cash buffer floor |
| `positions` | `readonly IdealTargetPosition[]` | Canonical by `instrumentId` |
| `excludedCandidates` | `readonly CandidateExclusion[]` | Structured explanations for omitted names |

### IdealTargetPosition

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Canonical identity |
| `rank` | positive integer | Rank from immutable signal snapshot |
| `compositeScore` | `ScaledRate` | Deterministic score lineage |
| `convictionMultiplier` | `ScaledRate` | Derived from immutable signal |
| `inverseVolatilityWeight` | `Weight` | Pre-normalization contribution after conviction |
| `targetWeight` | `Weight` | Ideal post-normalization portfolio weight |
| `targetValue` | `Money` | Exact notional using investable NAV |
| `constraintAnnotations` | `readonly AppliedConstraintReason[]` | Hard or soft constraints applied at ideal stage |

### ExecutableTarget

| Field | Type | Rule |
|---|---|---|
| `allocationMethod` | `GREEDY` or `OPTIMIZER_VERIFIED_FALLBACK` or `OPTIMIZER_PRIMARY` | Visible planner path |
| `totalEquityWeight` | `Weight` | Must satisfy every hard exposure constraint |
| `cashWeight` | `Weight` | Residual or reserved cash after whole-share allocation |
| `residualCash` | `Money` | Never negative |
| `positions` | `readonly ExecutableTargetPosition[]` | Canonical by `instrumentId` |
| `constraintChecks` | `readonly ConstraintCheck[]` | Verifier result set |
| `optimizerOutcome` | `OptimizerOutcome` or absent | Present only when optimizer port was invoked |

### ExecutableTargetPosition

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Canonical identity |
| `targetWeight` | `Weight` | Executable post-rounding weight |
| `targetQuantity` | `Quantity` | Non-negative whole-share target |
| `targetValue` | `Money` | Exact `price × targetQuantity` |
| `deltaQuantity` | signed whole-share exact integer | Positive for buy, negative for sell, zero for hold |
| `deltaValue` | signed `Money` | Signed notional impact |
| `lotDispositions` | `readonly LotDisposition[]` | Present only for sells/reductions |
| `bindingReasons` | `readonly AppliedConstraintReason[]` | Explains why executable target differs from ideal |

## Allocation and Optimization Support Values

### GreedyAllocationStep

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Candidate receiving or losing one logical increment |
| `incrementQuantity` | `Quantity` | Normally one share for buys; exact feasible decrement for sells |
| `incrementBenefit` | `ScaledRate` | Residual benefit after estimated drag and penalties |
| `eligibleAfterIncrement` | boolean | `false` increments are never applied |
| `rejectionReason` | reason code or absent | Present when the increment is not feasible |

### OptimizerRequest

| Field | Type | Rule |
|---|---|---|
| `mode` | `INTEGER_TRACKING` or `RISK_PARITY` | Explicit requested optimization mode |
| `candidateSetHash` | `IntegrityHash` | Canonical input binding |
| `hardConstraints` | `ConstructionConstraintSet` | Must be identical to greedy verifier constraints |
| `objective` | structured object | Objective metadata only; never replaces hard constraints |
| `timeoutBudget` | bounded duration value | Required for fail-fast behavior |

### OptimizerOutcome

| Field | Type | Rule |
|---|---|---|
| `status` | `VERIFIED_ACCEPTED`, `TIMEOUT`, `INFEASIBLE`, `SOLVER_ERROR`, `VERIFICATION_REJECTED`, `FALLBACK_USED` | Closed outcome set |
| `durationMs` | non-negative integer | Required when optimizer invoked |
| `iterationCount` | non-negative integer | Required when optimizer invoked |
| `violatedConstraintIds` | `readonly string[]` | Empty only when accepted |
| `fallbackPlanHash` | `IntegrityHash` or absent | Present when fallback output is used |
| `oracleComparison` | `OracleComparison` or absent | Present for documented reference problems |

## Support Reason and Verification Values

### CandidateExclusion

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Canonical identity |
| `reasonBundle` | `ReasonBundle` | Required structured exclusion reason |
| `excludedAtStage` | `ELIGIBILITY_GATE`, `IDEAL_TARGET`, or `EXECUTABLE_TARGET` | Closed stage set |

### AppliedConstraintReason

| Field | Type | Rule |
|---|---|---|
| `constraintId` | typed string | Stable machine-readable constraint identifier |
| `constraintFamily` | `EXPOSURE`, `CASH`, `SECTOR`, `GROUP`, `SMALL_CAP`, `LIQUIDITY`, `TURNOVER`, `MIN_ORDER_VALUE`, `PREFERRED_HOLD`, `REPLACEMENT_HURDLE`, or `LOT_SELECTION` | Closed family set |
| `binding` | boolean | `true` when the constraint changed the final target or order decision |
| `detail` | safe string | Deterministic explanation fragment |

### ConstraintCheck

| Field | Type | Rule |
|---|---|---|
| `constraintId` | typed string | Stable verifier identifier |
| `passed` | boolean | `false` checks block acceptance |
| `actual` | exact value or absent | Optional measured outcome |
| `limit` | exact value or absent | Optional configured bound |
| `reasonBundle` | `ReasonBundle` or absent | Present when `passed = false` |

### OracleComparison

| Field | Type | Rule |
|---|---|---|
| `referenceProblemId` | typed string | Named small verified problem |
| `oracleObjectiveValue` | `ScaledRate` or exact numeric surrogate | Deterministic reference objective |
| `candidateObjectiveValue` | `ScaledRate` or exact numeric surrogate | Optimizer or fallback objective |
| `equivalentWithinTolerance` | boolean | Explicit oracle acceptance result |
| `toleranceDescription` | safe string | Documents exact acceptance tolerance |

### PlanWarning

| Field | Type | Rule |
|---|---|---|
| `warningCode` | typed string | Stable machine-readable warning code |
| `severity` | `INFO`, `WARN`, or `MANDATORY_REVIEW` | Closed severity set |
| `message` | safe string | Human-readable warning summary |
| `relatedInstrumentIds` | `readonly InstrumentId[]` | Optional canonical affected instruments |

## Cost, Tax, and Lot Entities

### CostSchedule

| Field | Type | Rule |
|---|---|---|
| `scheduleVersionId` | typed string | Immutable version identifier |
| `effectiveFrom` | `LocalDate` | Inclusive effective date |
| `brokerageRule` | structured rate table | Configurable and strategy-independent |
| `statutoryChargeRules` | `readonly ChargeRule[]` | STT, exchange, GST, SEBI, stamp duty, DP, broker fees |
| `slippageRule` | structured function | Deterministic estimate only |
| `impactRule` | structured function | Deterministic estimate only |

### ChargeRule

| Field | Type | Rule |
|---|---|---|
| `chargeCode` | `BROKERAGE`, `STT`, `EXCHANGE`, `GST`, `SEBI`, `STAMP_DUTY`, `DP`, or `BROKER_FEE` | Closed component set |
| `calculationBasis` | structured rate or fixed-fee definition | Exact schedule component |
| `appliesToSide` | `BUY`, `SELL`, or `BOTH` | Closed applicability set |

### CostEstimate

| Field | Type | Rule |
|---|---|---|
| `grossNotional` | `Money` | Order-side notional before costs |
| `brokerage` | `Money` | Exact component |
| `statutoryCharges` | `Money` | Exact sum of statutory components |
| `spreadCost` | `Money` | Deterministic estimate |
| `slippageCost` | `Money` | Deterministic estimate |
| `impactCost` | `Money` | Deterministic estimate |
| `otherFees` | `Money` | Exact configured additional fees |
| `totalCost` | `Money` | Exact sum of all components |

### TaxRuleSet

| Field | Type | Rule |
|---|---|---|
| `taxRuleVersionId` | typed string | Immutable version identifier |
| `effectiveFrom` | `LocalDate` | Inclusive effective date |
| `holdingPeriodThresholdDays` | positive integer | Distinguishes short vs long term |
| `shortTermRate` | `ScaledRate` | Configurable exact rate |
| `longTermRate` | `ScaledRate` | Configurable exact rate |
| `lotSelectionPolicy` | `FIFO \| HIFO \| SPECIFIC` | Closed set |

### LotDisposition

| Field | Type | Rule |
|---|---|---|
| `lotId` | `HoldingLotId` | Existing portfolio lot only |
| `sellQuantity` | `Quantity` | Positive and not above open quantity |
| `acquiredOn` | `LocalDate` | Lot holding-period anchor |
| `unitCost` | `Money` | Exact historical lot cost |
| `estimatedGainOrLoss` | signed `Money` | Exact tax basis delta |
| `termClassification` | `SHORT_TERM` or `LONG_TERM` | Derived from holding-period rule set |

### TaxEstimate

| Field | Type | Rule |
|---|---|---|
| `selectedLots` | `readonly LotDisposition[]` | Canonical and non-overlapping |
| `taxableGainOrLoss` | signed `Money` | Exact lot-aggregated basis result |
| `estimatedTax` | signed `Money` | Exact estimated tax effect |
| `taxRuleVersionId` | typed string | Effective rule lineage |
| `isProvisional` | boolean | `true` only when a hard-risk exit required fallback estimation |

## Turnover and Timing Entities

### TurnoverWindowDefinition

| Field | Type | Rule |
|---|---|---|
| `windowKind` | `ROLLING_30_DAY`, `CALENDAR_MONTH`, `CALENDAR_QUARTER`, `CALENDAR_YEAR` | Closed set |
| `budgetLimit` | `ScaledRate` | Exact portfolio-level turnover cap |
| `aggregationMethod` | `MAX_OF_BUY_OR_SELL_NOTIONAL` | Closed safe method |

### TurnoverWindowBalance

| Field | Type | Rule |
|---|---|---|
| `windowKind` | `ROLLING_30_DAY`, `CALENDAR_MONTH`, `CALENDAR_QUARTER`, or `CALENDAR_YEAR` | Matches the definition kind exactly |
| `consumedBeforePlan` | `ScaledRate` | Exact budget already used before this run |
| `remainingBeforePlan` | `ScaledRate` | Exact available headroom before this run |
| `consumedAfterPlan` | `ScaledRate` | Exact budget that would be used if the plan is accepted |
| `remainingAfterPlan` | `ScaledRate` | Exact headroom after the plan |

### TurnoverBudgetSnapshot

| Field | Type | Rule |
|---|---|---|
| `startingNav` | `Money` | Baseline denominator for this run |
| `windows` | `readonly TurnoverWindowBalance[]` | One entry per applicable preset window |
| `proposedConsumption` | `ScaledRate` | Budget impact of this plan |
| `remainingAfterPlan` | `readonly TurnoverWindowBalance[]` | Exact post-plan balances |

### PlanTiming

| Field | Type | Rule |
|---|---|---|
| `decisionSessionDate` | `LocalDate` | Finalized EOD session used for planning |
| `decisionReadyAt` | `Instant` | After-market-close planning timestamp |
| `eligibleExecutionDate` | `LocalDate` | Next eligible trading session only |
| `eligibleExecutionWindowStart` | local time string | Normally `09:45` Asia/Kolkata |
| `eligibleExecutionWindowEnd` | local time string | Normally `11:30` Asia/Kolkata |
| `sameSessionExecutionAllowed` | boolean | Always `false` for routine plans |

## Order and Explainability Entities

### ProposedOrder

| Field | Type | Rule |
|---|---|---|
| `logicalOrderKey` | `IntegrityHash` | Canonical duplicate-prevention key |
| `instrumentId` | `InstrumentId` | Canonical identity |
| `side` | `BUY`, `SELL`, or `REDUCE` | Closed side set |
| `quantity` | `Quantity` | Exact whole-share quantity |
| `estimatedPrice` | `Money` | Finalized planning reference price |
| `estimatedNotional` | `Money` | Exact signed or side-specific notional |
| `targetWeightBefore` | `Weight` | Current realized weight |
| `targetWeightAfter` | `Weight` | Planned realized weight |
| `costEstimate` | `CostEstimate` | Required for all proposed orders |
| `taxEstimate` | `TaxEstimate` or absent | Required for sell/reduce orders |
| `reasonBundle` | `ReasonBundle` | Structured codes and human explanation |
| `urgency` | `MANDATORY`, `ROUTINE`, or `DRIFT` | Derived from trigger family |

### SkippedOrder

| Field | Type | Rule |
|---|---|---|
| `logicalOrderKey` | `IntegrityHash` | Deterministic evaluated action identity |
| `instrumentId` | `InstrumentId` | Canonical identity |
| `candidateSide` | `BUY`, `SELL`, `REDUCE`, or `REPLACE` | Evaluated but not selected |
| `reasonBundle` | `ReasonBundle` | Required structured explanation |
| `foregoneTargetWeight` | `Weight` or absent | Present when an ideal/executable delta existed |
| `foregoneBenefit` | `ScaledRate` or absent | Estimated improvement that failed policy |

### BlockedOrder

| Field | Type | Rule |
|---|---|---|
| `logicalOrderKey` | `IntegrityHash` | Deterministic blocked action identity |
| `instrumentId` | `InstrumentId` | Canonical identity |
| `candidateSide` | `BUY`, `SELL`, `REDUCE`, or `REPLACE` | Action forbidden by unsafe prerequisites |
| `blockingPrerequisite` | typed code | Missing or unsafe dependency |
| `reasonBundle` | `ReasonBundle` | Required structured explanation |

### ReasonBundle

| Field | Type | Rule |
|---|---|---|
| `primaryCode` | typed string | Machine-stable reason code |
| `secondaryCodes` | `readonly string[]` | Deterministic supporting codes |
| `humanExplanation` | safe string | Human-readable but non-freeform arbitrary input |
| `constraintIds` | `readonly string[]` | Constraint lineage supporting the reason |

### ImplementationShortfall

| Field | Type | Rule |
|---|---|---|
| `weightGap` | `Weight` | Aggregate ideal-vs-executable equity gap |
| `cashGap` | `Weight` | Additional retained cash caused by constraints/rounding |
| `notionalGap` | `Money` | Exact absolute notional difference |
| `dragGap` | `Money` | Extra cost/tax drag versus ideal |
| `bindingReasons` | `readonly AppliedConstraintReason[]` | Deterministic shortfall explanations |

### SectorWeightSnapshot

| Field | Type | Rule |
|---|---|---|
| `sectorId` | typed string | Point-in-time sector identity |
| `weight` | `Weight` | Exact aggregate sector weight |
| `limit` | `Weight` | Applicable hard or soft sector limit |

### GroupWeightSnapshot

| Field | Type | Rule |
|---|---|---|
| `groupId` | typed string | Point-in-time corporate-group identity |
| `weight` | `Weight` | Exact aggregate group weight |
| `limit` | `Weight` | Applicable hard or soft group limit |

### ApprovalReadySummary

| Field | Type | Rule |
|---|---|---|
| `currentCash` | `Money` | Reconciled baseline cash |
| `projectedCash` | `Money` | Planned post-order residual cash |
| `currentExposure` | `Weight` | Reconciled baseline equity exposure |
| `projectedExposure` | `Weight` | Planned post-order exposure |
| `currentSectorWeights` | `readonly SectorWeightSnapshot[]` | Exact baseline concentration view |
| `projectedSectorWeights` | `readonly SectorWeightSnapshot[]` | Exact planned concentration view |
| `currentGroupWeights` | `readonly GroupWeightSnapshot[]` | Exact baseline group view |
| `projectedGroupWeights` | `readonly GroupWeightSnapshot[]` | Exact planned group view |
| `warnings` | `readonly PlanWarning[]` | Safe explainability feed |

## Primary Story Coverage

| Story | Domain-entity coverage |
|---|---|
| US-015 | `IdealTarget`, `ExecutableTarget`, `CandidateInstrument`, `ConstructionConstraintSet`, `ImplementationShortfall` |
| US-016 | `CadencePolicySnapshot`, `TurnoverBudgetSnapshot`, `PlanTiming`, `SkippedOrder` |
| US-017 | `CostSchedule`, `CostEstimate`, `TaxRuleSet`, `TaxEstimate`, `LotDisposition` |
| US-018 | `RebalancePlan`, `ProposedOrder`, `SkippedOrder`, `BlockedOrder`, `ApprovalReadySummary`, `ReasonBundle` |
| US-019 | `InterimAuthorization`, `PlanningIntent`, `ProposedOrder.urgency`, `BlockedOrder` |
| US-020 | `OptimizerRequest`, `OptimizerOutcome`, `ExecutableTarget.allocationMethod`, `ConstraintCheck` |

## Testable Properties

| Component | Property category | Property |
|---|---|---|
| Canonical hashes | Round-trip | Canonical serialization of the same immutable inputs always yields the same `planInputHash` and `planHash` |
| Exact-value targets | Invariant | `ExecutableTarget` never produces negative cash, short quantity, leverage, or weight sums outside the approved tolerance |
| Greedy allocation | Idempotence | Re-running the greedy allocator on its own executable output and identical inputs yields an equivalent target |
| Optimizer verifier | Oracle | Accepted optimizer output matches or improves a verified small-problem oracle without violating any hard constraint |
| Constraint checks | Easy verification | Any emitted target is expensive to search for but easy to verify against explicit constraint-check rows |
| Turnover ledger | Invariant | Aggregated turnover consumption never becomes negative and never exceeds the configured remaining window budget for accepted routine actions |
| Interim authorization | Stateful model | Random sequences of routine and interim planning requests never permit an unauthorized exception family or AI-only override |
| Plan lifecycle | Stateful model | `APPROVAL_READY -> SUPERSEDED/INVALIDATED/EXPIRED` transitions preserve immutable prior plans and never duplicate logical order keys |

## Frontend Artifact Applicability

No `frontend-components.md` artifact is required for U04. The unit exposes immutable planning contracts only; U08 later renders those contracts in `RebalancePreviewPanel`.
