# U03 Domain Entities

## Aggregate Boundary

U03 owns two domain aggregates: **StrategyVersion** and **BacktestRun**. All remaining types are value objects, ports, or read-model projections. No U03 type directly references persistence infrastructure, HTTP, broker SDKs, or React.

## Aggregate and Entity Relationship Model

```text
StrategyVersion 1---1 StrategyConfig (value)
StrategyVersion 1---* EvidenceReference (value)
StrategyVersion 1---1 StrategyVersionStatus (enum)

BacktestRun 1---1 BacktestRunStatus (enum)
BacktestRun 0---1 BacktestResult (value)

EvaluationRun (value) 1---1 UniverseSnapshot
EvaluationRun (value) 1---* EligibilityResult
EvaluationRun (value) 1---* SignalSnapshot
EvaluationRun (value) 1---1 RegimeState

MarketDataRecord (value) 1---1 DataProvenance
MarketDataRecord (value) 1---1 DataValidationStatus

CorporateAction 1---1 CorporateActionStatus
CorporateAction 1---1 CorporateActionDetails (union type)
CorporateAction 0---1 CorporateActionImpact (value, post-processing)

AiAdvisoryRequest (value) 1---1 AiPermittedOperation (enum)
AiAdvisoryResult (value) has canInfluenceState = false (constant)
```

---

## StrategyVersion Aggregate

### Identity and State

| Field | Type | Rule |
|---|---|---|
| `strategyId` | StrategyId | Branded string; immutable after creation |
| `version` | StrategyVersionLabel | Semantic version string (major.minor.patch); immutable after creation |
| `configHash` | StrategyConfigHash | SHA-256 of canonical JSON (keys sorted, UTF-8, no extra whitespace); immutable after creation |
| `horizon` | StrategyHorizon | SHORT \| MEDIUM \| LONG; derived from config at creation time |
| `config` | StrategyConfig | Complete declarative configuration; immutable after creation |
| `status` | StrategyVersionStatus | DRAFT → ACTIVATION_PENDING → ACTIVE → SUPERSEDED or WITHDRAWN |
| `createdBy` | ActorId | From U01 domain |
| `createdAt` | Instant | Immutable |
| `effectiveFrom` | LocalDate | First date the strategy is eligible for evaluation |
| `approvedAt` | Instant or absent | Present only when ACTIVE |
| `approvedBy` | ActorId or absent | Present only when ACTIVE |
| `evidenceRefs` | EvidenceReference[] | Required for ACTIVE transition; empty for DRAFT |
| `withdrawalReason` | ReasonCode or absent | Present only when WITHDRAWN |

### Public Behaviors

- `registerPreset`: create an immutable preset strategy version with validated config; status starts as DRAFT.
- `createVersion`: create a new DRAFT version with safe parsed and schema-validated config.
- `submitForActivation`: transition DRAFT to ACTIVATION_PENDING with evidence references.
- `activate`: transition ACTIVATION_PENDING to ACTIVE after all evidence checks pass and authorized actor approves.
- `supersede`: transition ACTIVE to SUPERSEDED when a newer version is activated for the same strategy.
- `withdraw`: transition any non-ACTIVE status to WITHDRAWN with a reason.
- `validateConfig`: pure validation returning structured errors without mutating state.
- `computeConfigHash`: return the deterministic hash for any config value.

### StrategyVersionStatus State Machine

```text
DRAFT
  -> ACTIVATION_PENDING  (submitForActivation, evidence references provided)
  -> WITHDRAWN           (withdraw)

ACTIVATION_PENDING
  -> ACTIVE              (activate, all evidence checks pass, authorized actor)
  -> DRAFT               (revoke submission)
  -> WITHDRAWN           (withdraw)

ACTIVE
  -> SUPERSEDED          (supersede, when a newer version activates for same strategyId)
  -> WITHDRAWN           (emergency withdrawal, requires privileged actor and reason)

SUPERSEDED              (terminal – no further transitions)
WITHDRAWN               (terminal – no further transitions)
```

Invariants: Exactly one ACTIVE version per strategyId at any instant; ACTIVE status is set atomically with audit by U02.

---

## StrategyConfig Value Object

A completely immutable declarative configuration. Parsed and validated once at creation. Never mutated in place.

### Fields

| Sub-object | Key fields | Rule |
|---|---|---|
| `UniversePolicy` | type (INDEX_MEMBERSHIP \| CUSTOM_WATCHLIST \| STOCKS_PLUS_ETF), symbol, pointInTimeRequired | INDEX_MEMBERSHIP requires historical point-in-time data for backtest |
| `EligibilityPolicy` | minListingDays, minPrice (INR), minMedian20DTradedValueINR, minDataCompletenessPct, excludeSuspended, excludeRestrictedSurveillance, requireBrokerMapping, fundamentalFreshnessRequired | All thresholds must be positive; minDataCompletenessPct in [0, 100] |
| `FactorPolicy` | momentumWeight, qualityWeight, lowRiskWeight, momentumComponents (7 weights), qualityComponents, riskComponents | momentumWeight + qualityWeight + lowRiskWeight = exactly 1.0; each component sub-weight set sums to 1.0 |
| `CompositePolicy` | formula reference, sector-neutral flag | Must reference valid factor weight IDs |
| `ConstructionPolicy` | targetHoldings, maxHoldings, entryRank, holdRank, forcedReviewRank, weighting, minStockWeightPct, maxStockWeightPct, maxSectorWeightPct, maxGroupWeightPct, cashBufferPct | maxHoldings >= targetHoldings; entryRank < holdRank < forcedReviewRank; all weights sum-valid |
| `RegimePolicy` | confirmationPeriodsWeakening, confirmationPeriodsStrengthening, exposureByState (RISK_ON: 90-100%, CAUTION: 60-80%, RISK_OFF: 30-50%, CRISIS: 0-0% new buys) | Confirmation periods configurable; crisis has no confirmation period |
| `RebalancePolicy` | routineFrequency (BIWEEKLY \| MONTHLY \| QUARTERLY), absoluteDriftBandPct, relativeDriftBandPct, minOrderValueINR, minOrderPortfolioPct, maxDailyTurnoverPct, maxMonthlyTurnoverPct (or per-period limits), replacementScoreGapPercentile, preferredHoldDays | All limits > 0; drift band uses the greater of absolute and relative |
| `ExecutionPolicy` | product (CNC only), defaultOrderType, startTime, endTime, maxRetries, sellBeforeBuy, allowMarketOrder | CNC is enforced; no intraday; startTime and endTime in Asia/Kolkata |
| `RiskPolicy` | maxStockWeightPct, maxSectorWeightPct, drawdownWarningPct, drawdownRiskReductionPct, drawdownKillSwitchPct, maxConsecutiveErrors, maxUnresolvedBrokerMismatch | Kill switch threshold > risk reduction threshold > warning threshold |
| `TaxPolicy` | holdingPeriodThresholdDays (365 for LTCG), ltcgRatePct, stcgRatePct, sttBuyPct, sttSellPct, exchangeChargeBps, gstPct, sebiChargeBps, stampDutyPct, dpChargeINR, lotSelectionMethod (FIFO \| HIFO \| SPECIFIC) | Rates configurable; never hardcoded; lotSelectionMethod defaults to FIFO |
| `AutomationPolicy` | mode (OBSERVE \| PAPER \| RECOMMENDATION \| APPROVAL_REQUIRED \| RESTRICTED_AUTO), maxOrdersPerDay, maxDailyNotionalPct, requireReconciliation, blockOnWarningSeverity | Default mode is APPROVAL_REQUIRED |
| `benchmark` | BenchmarkSymbol string | Non-blank |

---

## BacktestRun Aggregate

### Identity and State

| Field | Type | Rule |
|---|---|---|
| `backtestId` | BacktestId | Branded string; immutable |
| `strategyVersionId` | StrategyVersionId | Version being tested; immutable |
| `startDate` | LocalDate | Inclusive; at least 5 years before endDate for production-quality |
| `endDate` | LocalDate | Exclusive |
| `dataVersionId` | DataVersionId | Point-in-time data snapshot identifier; immutable |
| `status` | BacktestStatus | PENDING → RUNNING → COMPLETED → FAILED |
| `result` | BacktestResult or absent | Present when COMPLETED |
| `lookAheadChecksPerformed` | boolean | Must be true before COMPLETED |
| `survivorshipBiasChecksPerformed` | boolean | Must be true before COMPLETED |
| `initiatedBy` | ActorId | Immutable |
| `initiatedAt` | Instant | Immutable |
| `completedAt` | Instant or absent | Present when terminal |
| `failureReason` | ReasonCode or absent | Present when FAILED |

### BacktestResult Value Object

| Field | Type | Rule |
|---|---|---|
| `cagr` | ScaledRate | Annualized return, not guaranteed or promoted |
| `maxDrawdown` | ScaledRate | Maximum peak-to-trough loss |
| `sharpe` | ScaledRate | Risk-adjusted return using configurable risk-free rate |
| `calmar` | ScaledRate | CAGR / MaxDrawdown |
| `annualTurnover` | ScaledRate | Average annual portfolio turnover |
| `estimatedCostDragBps` | integer | After-cost impact |
| `estimatedTaxDragBps` | integer | After-tax impact |
| `folds` | WalkForwardFold[] | At least 3 for production-quality evidence |
| `regimeBreakdown` | RegimePerformance[] | Performance per regime state |
| `horizonAppropriateMetrics` | HorizonMetrics | Rolling period metrics appropriate to preset horizon |
| `dataVersion` | DataVersionId | Must match the run's dataVersionId |
| `lookAheadViolations` | integer | Must be 0 for production-quality |
| `survivorshipViolations` | integer | Must be 0 for production-quality |

---

## Market Data Value Objects

### MarketDataRecord

Represents a single immutable point-in-time data item with full provenance.

| Field | Type | Rule |
|---|---|---|
| `recordId` | DataRecordId | Immutable |
| `instrumentId` | InstrumentId | May be universe-level for index data |
| `dataType` | MarketDataType | Enum: EOD_PRICE \| FUNDAMENTALS \| INDEX_MEMBERSHIP \| INSTRUMENT_DETAILS \| EXCHANGE_CALENDAR \| LIVE_QUOTE \| CORPORATE_ACTION_SCHEDULE |
| `effectiveDate` | LocalDate | The business date the data represents |
| `fetchedAt` | Instant | When the data was retrieved |
| `marketTimestamp` | Instant | When the exchange or provider published the data |
| `source` | DataProvider | NSE_OFFICIAL \| YAHOO_RESEARCH \| LICENSED_EOD \| BROKER_API \| EXCHANGE_FILING |
| `version` | DataVersion | Checksum or version string of the payload |
| `validationStatus` | DataValidationStatus | VALID \| STALE \| INCOMPLETE \| ANOMALY_DETECTED \| FAILED_VALIDATION |
| `isProductionQuality` | boolean | false for NSE/Yahoo prototype sources |
| `staleAfterInstant` | Instant | Data must not be used after this instant |
| `payload` | DataPayload | Typed union per dataType; never contains broker credentials |

### DataProvenance

Embedded in MarketDataRecord. Contains source, version, fetchedAt, and validation details for audit and reproducibility.

### DataVersionSnapshot

Immutable named snapshot of all data records used in a single evaluation or backtest.

| Field | Type | Rule |
|---|---|---|
| `dataVersionId` | DataVersionId | Unique per snapshot |
| `asOf` | LocalDate | Decision date this snapshot represents |
| `createdAt` | Instant | Immutable |
| `recordCount` | PositiveInteger | |
| `sources` | DataProvider[] | All providers contributing to this snapshot |
| `completenessChecks` | CompletenessCheck[] | Per-dataType pass/fail with coverage percentage |
| `isProductionQuality` | boolean | All contributing sources must be production-quality |

---

## Eligibility Value Objects

### EligibilityResult

Immutable determination of whether an instrument passes all mandatory eligibility rules for a given strategy and date.

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | InstrumentId | Immutable |
| `asOf` | LocalDate | Decision date |
| `strategyVersionId` | StrategyVersionId | Immutable |
| `dataVersionId` | DataVersionId | Links to the data snapshot used |
| `isEligible` | boolean | True only when all mandatory rules pass |
| `ruleResults` | EligibilityRuleResult[] | One per rule in the strategy's EligibilityPolicy |
| `reasonCodes` | ReasonCode[] | Machine-readable codes for each failure |
| `financialSectorFlag` | boolean | Triggers BFSI-specific quality metrics |

### EligibilityRuleResult

| Field | Type | Rule |
|---|---|---|
| `ruleId` | EligibilityRuleId | One of: LISTING_HISTORY, PRICE_AVAILABILITY, MIN_PRICE, TRADED_VALUE, CORPORATE_ACTION_STATUS, TRADING_STATUS, SURVEILLANCE_STATUS, FUNDAMENTAL_FRESHNESS, BROKER_MAPPING, DATA_ANOMALY, FUNDAMENTAL_HEALTH |
| `passed` | boolean | |
| `actual` | ScaledRate or absent | Observed value for numeric rules |
| `threshold` | ScaledRate or absent | Configured threshold |
| `reasonCode` | ReasonCode | |

---

## Signal Value Objects

### SignalSnapshot

Immutable per-instrument evaluation output for one as-of date.

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | InstrumentId | Immutable |
| `strategyVersionId` | StrategyVersionId | Immutable |
| `asOf` | LocalDate | Decision date |
| `dataVersionId` | DataVersionId | Immutable |
| `eligibilityStatus` | EligibilityStatus | ELIGIBLE \| INELIGIBLE \| HOLD_ELIGIBLE \| FORCED_REVIEW |
| `momentumComponents` | MomentumComponents | Seven z-scored component values |
| `momentumScore` | NormalizedScore | Weighted sum of momentum components |
| `qualityComponents` | QualityComponents | Six z-scored component values (BFSI-aware) |
| `qualityScore` | NormalizedScore | Weighted sum of quality components |
| `riskComponents` | RiskComponents | Five z-scored component values |
| `riskScore` | NormalizedScore | Weighted sum of risk components (inverted: low risk = high score) |
| `compositeScore` | CompositeScore | Weighted combination per FactorPolicy |
| `convictionMultiplier` | ScaledRate | Per AD-12: 0.80 + 0.40 × percentile(composite), range [0.80, 1.20] |
| `rank` | Rank | 1-based rank within eligible universe; absent for INELIGIBLE |
| `riskFlags` | RiskFlag[] | Verified structured risk flags; AI flags are advisory-only |
| `reasonCodes` | ReasonCode[] | Machine-readable reasons for hold, review, or exit signals |

### MomentumComponents

| Field | Description |
|---|---|
| `return12_1` | z-score of 12-month-to-1-month return |
| `return6_1` | z-score of 6-month-to-1-month return |
| `return3_1` | z-score of 3-month-to-1-month return |
| `relativeStrength6M` | z-score of stock return minus benchmark return over 6 months |
| `priceTo200DMA` | z-score of price relative to 200-day moving average |
| `priceTo100DMA` | z-score of price relative to 100-day moving average |
| `earningsMomentum` | z-score of earnings/revenue surprise or revision proxy |

### RegimeState Value Object

| Field | Type | Rule |
|---|---|---|
| `asOf` | LocalDate | Decision date |
| `state` | RegimeCategory | RISK_ON \| CAUTION \| RISK_OFF \| CRISIS |
| `equityExposureTarget` | WeightRange | Minimum and maximum equity weight per regime definition |
| `indicatorValues` | RegimeIndicators | All seven regime indicator values |
| `confirmationCount` | NonNegativeInteger | Consecutive closes in current or candidate state |
| `pendingTransition` | RegimeTransition or absent | Present when in confirmation window |
| `dataVersionId` | DataVersionId | Regime data provenance |
| `isCrisisImmediate` | boolean | True when triggered by data-independent hard criteria |
| `reasonCodes` | ReasonCode[] | |

### RegimeIndicators

| Field | Description |
|---|---|
| `nifty50AboveDMA200` | boolean |
| `nifty500AboveDMA200` | boolean |
| `breadthAbove200DMA_pct` | percentage of eligible stocks above 200-day MA |
| `breadthAbove100DMA_pct` | percentage of eligible stocks above 100-day MA |
| `benchmarkVolatility20D` | 20-day realized volatility |
| `marketDrawdownFrom52W` | drawdown percentage from 52-week high |
| `creditStressProxy` | optional; absent if not configured |

---

## Corporate Action Entities

### CorporateAction

| Field | Type | Rule |
|---|---|---|
| `actionId` | CorporateActionId | Immutable branded string |
| `instrumentId` | InstrumentId | Affected instrument |
| `actionType` | CorporateActionType | SPLIT \| BONUS \| CASH_DIVIDEND \| RIGHTS \| MERGER \| DEMERGER \| SYMBOL_CHANGE \| DELISTING \| BUYBACK_TENDER \| ETF_UNIT_CHANGE |
| `announcedDate` | LocalDate | Exchange or company filing date |
| `effectiveDate` | LocalDate | Date adjustments apply |
| `source` | DataProvider | Must be EXCHANGE_FILING or licensed provider |
| `details` | CorporateActionDetails | Type-specific immutable value (ratio, cash amount, new symbol, etc.) |
| `processingStatus` | CorporateActionStatus | PENDING \| PROCESSED \| BLOCKED \| REQUIRES_MANUAL_REVIEW |
| `impactSummary` | CorporateActionImpact or absent | Post-processing; absent until PROCESSED |
| `auditLineage` | AuditLineageRef | Reference to audit event recording processing |

### CorporateActionStatus State Machine

```text
PENDING
  -> BLOCKED                 (unresolved mapping, unprocessable condition)
  -> PROCESSED               (all adjustments applied, broker state reconciles)
  -> REQUIRES_MANUAL_REVIEW  (merger/demerger symbol change, ambiguous event)

BLOCKED
  -> PROCESSED               (after operator resolves mapping)
  -> REQUIRES_MANUAL_REVIEW  (operator escalates)

REQUIRES_MANUAL_REVIEW
  -> PROCESSED               (operator confirms mapping and adjustments)
  -> BLOCKED                 (operator defers resolution)

PROCESSED  (terminal)
```

### CorporateActionImpact Value Object

Records the deterministic outcome of applying the corporate action.

| Field | Type | Rule |
|---|---|---|
| `priceAdjustmentFactor` | ScaledRate | Multiplier for historical price adjustment |
| `quantityAdjustmentFactor` | ScaledRate | Multiplier for quantity adjustment |
| `taxLotLineagePreserved` | boolean | Must be true for value-preserving actions |
| `symbolMapping` | SymbolMapping or absent | New symbol and instrument token |
| `economicValueConserved` | boolean | Verified within documented rounding tolerance |

---

## Evidence and Research Value Objects

### EvidenceReference

Reference from a StrategyVersion to a completed evidence report.

| Field | Type | Rule |
|---|---|---|
| `evidenceId` | EvidenceId | Links to evidence store |
| `evidenceType` | EvidenceType | BACKTEST \| WALK_FORWARD \| OUT_OF_SAMPLE \| SHADOW_OPERATION \| SENSITIVITY \| BOOTSTRAP_MONTE_CARLO \| REGIME_STRESS |
| `passed` | boolean | Evidence supports activation |
| `summaryHash` | EvidenceHash | SHA-256 of evidence JSON payload |

Required evidence types for ACTIVE transition: BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION.

### ResearchComparisonReport Value Object

Produced when comparing multiple strategy versions or presets.

| Field | Type | Rule |
|---|---|---|
| `reportId` | ReportId | Immutable |
| `comparedVersions` | StrategyVersionId[] | Two or more |
| `horizonMetrics` | Map from StrategyVersionId to HorizonMetrics | Same data conventions and cost model for all |
| `dataVersionId` | DataVersionId | Same point-in-time basis |
| `noReturnGuaranteeStatement` | string | Immutable disclaimer text |
| `producedAt` | Instant | |

---

## AI Advisory Value Objects

### AiAdvisoryRequest

| Field | Type | Rule |
|---|---|---|
| `requestId` | AiAdvisoryRequestId | Immutable correlation ID |
| `permittedOperation` | AiPermittedOperation | SUMMARIZE \| CLASSIFY \| EXTRACT \| COMPARE \| EXPLAIN \| PRIORITIZE_REVIEW – one of these six operations only |
| `inputContent` | AiAdvisoryInput | Read-only structured data; no portfolio state, orders, or credentials |
| `requestedBy` | ActorId | |
| `requestedAt` | Instant | |

AiPermittedOperation is a closed enum. Any unlisted operation is structurally unrepresentable.

### AiAdvisoryResult

| Field | Type | Rule |
|---|---|---|
| `requestId` | AiAdvisoryRequestId | Must match request |
| `output` | AiAdvisoryContent | Textual or structured non-binding output |
| `canInfluenceState` | false | Enforced compile-time constant; never true |
| `canDetermineOrderQuantity` | false | Enforced compile-time constant |
| `canAlterParameters` | false | Enforced compile-time constant |
| `producedAt` | Instant | |
| `model` | string | For audit trail; redacted before external exposure |

---

## Provider Ports

| Port | Operations | Failure behavior |
|---|---|---|
| `MarketDataPort` | `fetchEodPrices(instruments, asOf)`, `fetchLatestQuote(instrument)`, `getDataVersion(asOf)` | Throws `ProviderUnavailableError`; never returns partial success as full success |
| `FundamentalsPort` | `fetchFundamentals(instruments, publicationDateAsOf)` | Publication-date-based; throws on missing data |
| `IndexMembershipPort` | `getMembership(index, asOf)` | Point-in-time only; throws on missing historical data |
| `CorporateActionPort` | `getActions(instruments, fromDate, toDate)`, `confirmMapping(actionId, mapping)` | Throws on unresolvable mapping |
| `ExchangeCalendarPort` | `isTradingDay(date)`, `nextTradingDay(date)`, `prevTradingDay(date)`, `getSessionWindow(date)` | Throws when calendar data is stale |
| `InstrumentRegistryPort` | `resolve(symbol)`, `getBrokerToken(instrumentId, broker)` | Throws when broker mapping absent |
| `AiAdvisoryPort` | `submitRequest(AiAdvisoryRequest): AiAdvisoryResult` | Throws on prohibited operation; non-critical path degrades without blocking execution |

---

## Identifier Types

All identifiers are branded strings from the U01 domain contracts. U03 introduces:

| Identifier | Branding purpose |
|---|---|
| `StrategyId` | Strategy family identity (e.g., `adaptive-momentum-quality`) |
| `StrategyVersionId` | Specific immutable version (StrategyId + version string) |
| `DataRecordId` | Single market data record |
| `DataVersionId` | Named point-in-time data snapshot |
| `BacktestId` | Single backtest execution |
| `CorporateActionId` | Single corporate action event |
| `EvidenceId` | Single evidence report |
| `AiAdvisoryRequestId` | Single AI advisory interaction |

---

## Testable Properties (PBT-01 Compliance)

| Component | Property Category | Description |
|---|---|---|
| StrategyConfig serialization | Round-trip (PBT-02) | Serialize → deserialize returns structurally equal config |
| StrategyConfig hash | Invariant (PBT-03) | Two structurally equal configs always produce the same hash; two different configs produce different hashes with high probability |
| StrategyVersionStatus machine | Stateful (PBT-06) | Random valid command sequences never produce invalid status transitions |
| EligibilityResult | Invariant (PBT-03) | Identical inputs with same strategy and data version always produce identical output |
| EligibilityResult | Idempotency (PBT-04) | Running eligibility twice with same inputs produces same result |
| SignalSnapshot | Invariant (PBT-03) | Factor weights sum invariant holds after normalization for any universe subset |
| SignalSnapshot | Oracle (PBT-05) | Composite score matches brute-force weighted sum within exact tolerance |
| NormalizedScore | Invariant (PBT-03) | All normalized scores in [-3.0, 3.0] after winsorization; no NaN or Infinity |
| RegimeState | Stateful (PBT-06) | Confirmation counter never exceeds configured confirmation period; regime never transitions without meeting confirmation |
| CorporateActionImpact | Invariant (PBT-03) | Value-preserving actions conserve economic value within documented tolerance |
| BacktestRun | Idempotency (PBT-04) | Identical strategyVersionId + dataVersionId + date range produces equivalent result |
| BacktestRun | Invariant (PBT-03) | lookAheadViolations and survivorshipViolations always 0 for valid COMPLETED run |
| AiAdvisoryResult | Invariant (PBT-03) | canInfluenceState always false; canDetermineOrderQuantity always false |
| DataVersionSnapshot | Round-trip (PBT-02) | Snapshot ID → restore all records round-trips without data loss |
