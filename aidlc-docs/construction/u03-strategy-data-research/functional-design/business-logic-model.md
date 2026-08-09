# U03 Business Logic Model

## Design Objective

U03 defines strategy configuration and version management, deterministic market data ingestion with full provenance, universe eligibility filtering, factor-signal scoring, market-regime determination, corporate action processing, backtesting integrity, and the AI advisory boundary policy. All algorithms are technology-agnostic, deterministic, and free of persistence infrastructure, HTTP transport, broker SDKs, or React.

Every U03 evaluation function accepts immutable inputs, produces immutable outputs, and either succeeds with a fully populated result or fails closed with a stable typed reason code. No partial success is permitted on the critical data path.

---

## Functional Boundary

### Inputs

- Validated strategy configurations and version identifiers from the application layer.
- Point-in-time market data records retrieved through typed ports (MarketDataPort, FundamentalsPort, IndexMembershipPort, CorporateActionPort, ExchangeCalendarPort, InstrumentRegistryPort).
- Actor, correlation, causation, and command identifiers for all state-changing operations.
- Evidence references provided by authorized strategy editors for version activation.
- AI advisory results produced by AiAdvisoryPort; these are non-binding by structural contract.

### Outputs

- Immutable StrategyVersion aggregates and lifecycle events.
- Immutable DataVersionSnapshot with provenance for all evaluation passes.
- EligibilityResult per instrument per evaluation date.
- SignalSnapshot per instrument per evaluation date.
- RegimeState per evaluation date.
- CorporateActionImpact per processed corporate action.
- BacktestResult with bias-check certificates and walk-forward folds.
- AiAdvisoryResult with structural guarantee that `canInfluenceState = false`.
- Typed DomainFailure with stable reason codes; never throws unhandled exceptions on the critical path.

### Excluded Behavior

- SQL transactions, WAL files, locking, and persistence infrastructure (owned by U02).
- Broker order routing, execution, and reconciliation (owned by U05).
- Portfolio construction, rebalancing, and target weight generation (owned by U04).
- HTTP request handling, authentication, and authorization (owned by U07).
- React UI and Remix route logic (owned by U08).
- Real-time live quote streaming and WebSocket feeds beyond freshness validation.

---

## Exact-Value Model

| Concept | Representation | Valid range and rule |
|---|---|---|
| Score | Signed scaled integer or BigDecimal with declared scale | No NaN, Infinity, or negative-infinity at any step |
| Weight fraction | Integer parts per million (0–1,000,000) | Sums verified as exactly 1,000,000 using scaled integer arithmetic |
| Rate (returns, pct) | Signed scaled integer with declared decimal places | Scale is part of the type |
| Conviction multiplier | Scaled decimal in [0.80, 1.20] | Formula: 0.80 + 0.40 × Percentile(CompositeScore) |
| Hash | 64-character lowercase hex string | SHA-256 of canonical UTF-8 JSON |
| LocalDate | Canonical `YYYY-MM-DD` | Calendar validity checked at construction |
| Instant | Canonical UTC instant | Parsed and canonicalized before domain use |

Z-scores are never stored as binary IEEE 754 floats for cross-comparison. Scoring arithmetic uses a consistent fixed-decimal scale throughout a single evaluation pass.

---

## Strategy Schema Validation Flow

Purpose: ensure no unsafe, malformed, or internally inconsistent configuration enters the domain.

### Flow

1. Accept raw JSON configuration string from an authorized strategy editor or seeding process.
2. Parse using a schema-validated parser that rejects: prototype-polluting keys, constructor-override patterns, executable content fields, and keys outside the declared schema.
3. Reject if any field violates:
   - Weight sum invariants (SR-002, SR-003): all three factor weights sum to exactly 1.0; each sub-component weight set independently sums to 1.0.
   - Threshold positivity (SR-004): all EligibilityPolicy thresholds strictly positive.
   - Construction coherence (SR-005 through SR-009): maxHoldings ≥ targetHoldings; entryRank < holdRank < forcedReviewRank; minStockWeightPct < maxStockWeightPct; cashBufferPct in [0.5, 20.0]; drawdown thresholds ordered.
   - Enum validity (SR-010): all enum fields match declared valid values.
   - Tax rates (SR-011): all rates in [0.0, 100.0].
   - Execution constraints (SR-012, SR-013): product is CNC only; execution window falls within NSE trading hours in Asia/Kolkata.
   - Benchmark (SR-014): non-blank string of 1–50 characters.
   - Horizon derivation (SR-015): horizon matches routineFrequency mapping.
4. Compute the canonical JSON by sorting all keys alphabetically (recursively for nested objects), encoding as UTF-8, no trailing whitespace, no indentation.
5. Compute `configHash` as SHA-256 of the canonical JSON, encoded as 64-character lowercase hex.
6. Return the validated immutable `StrategyConfig` and its hash, or a structured list of named validation errors.

No partial success: any validation failure returns the complete error list without creating a StrategyConfig object.

---

## Strategy Version Lifecycle Flow

### Registration and DRAFT Creation

1. Verify the proposing actor has a strategy-editor role (supplied as opaque evidence by the application layer).
2. Ensure no existing ACTIVE or ACTIVATION_PENDING version for the same `strategyId` + `version` pair already exists (checked through the repository port).
3. Validate the full configuration using the schema validation flow above.
4. Create an immutable `StrategyVersion` with status DRAFT, `createdAt = now()`, `createdBy = actor`, and empty `evidenceRefs`.
5. Emit `StrategyVersionCreated` event with actor, configHash, and correlation metadata.

### Preset Seeding (Idempotent)

1. Check whether all three preset identifiers (`short-horizon-momentum-quality@1.0.0`, `adaptive-momentum-quality@1.0.0`, `long-horizon-quality-compounders@1.0.0`) already exist.
2. For each missing preset: apply schema validation against the exact values in `strategy-presets.md` and create a DRAFT StrategyVersion.
3. Idempotent: already-present presets are not modified.
4. Emit `StrategyVersionCreated` once per newly created preset.

### DRAFT → ACTIVATION_PENDING

1. Verify submitting actor is an authorized strategy editor.
2. Verify at least one `EvidenceReference` is provided.
3. Transition status to ACTIVATION_PENDING; record actor, timestamp, and evidence reference list.
4. Emit `StrategyVersionSubmittedForActivation`.

### ACTIVATION_PENDING → ACTIVE

1. Verify activating actor is an authorized strategy approver (separate from the submitter).
2. Check that all four mandatory evidence types are present in `evidenceRefs`: BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION.
3. Check that every evidence reference has `passed = true`.
4. AI advisory output must not appear as evidence (SV-011).
5. Check that no other version for the same `strategyId` is currently ACTIVE.
6. Atomically: transition this version to ACTIVE; transition the previous ACTIVE version to SUPERSEDED (if any). This atomicity is enforced by U02 at the database transaction level.
7. Record `approvedAt`, `approvedBy`, and the full evidence reference set.
8. Emit `StrategyVersionActivated` and `StrategyVersionSuperseded` (if applicable).

### ACTIVATION_PENDING → DRAFT (Revoke)

1. Verify revoking actor is the submitter or a strategy manager.
2. Transition status back to DRAFT; clear evidence references.
3. Emit `StrategyVersionSubmissionRevoked`.

### Any Non-ACTIVE → WITHDRAWN

1. Verify withdrawing actor identity and non-blank reason code.
2. Transition to WITHDRAWN.
3. Emit `StrategyVersionWithdrawn` with reason, actor, and timestamp.
4. WITHDRAWN is terminal; no further transitions are permitted.

### ACTIVE → WITHDRAWN (Emergency)

1. Requires a privileged actor identity confirmed by the application layer.
2. Requires a non-blank reason code.
3. Transitions to WITHDRAWN; ACTIVE to WITHDRAWN is an emergency exit.
4. Emit `StrategyVersionWithdrawn` with the EMERGENCY flag.

### StrategyVersionStatus State Machine

```text
DRAFT
  --[submitForActivation, evidence provided, authorized editor]--> ACTIVATION_PENDING
  --[withdraw, any actor, reason]--> WITHDRAWN

ACTIVATION_PENDING
  --[activate, all 4 evidence types present and passed, authorized approver]--> ACTIVE
  --[revokeSubmission, submitter or manager]--> DRAFT
  --[withdraw, reason]--> WITHDRAWN

ACTIVE
  --[supersede, atomically when newer version activates]--> SUPERSEDED
  --[withdraw, privileged actor, non-blank reason]--> WITHDRAWN

SUPERSEDED  [terminal]
WITHDRAWN   [terminal]
```

Invariant: exactly one ACTIVE version per `strategyId` at any instant.

---

## Market Data Ingestion and Provenance Flow

Purpose: ensure every data record used in evaluation carries verifiable provenance and freshness guarantees (US-010).

### Single-Record Ingestion

1. Accept raw provider response through a typed port adapter.
2. Validate the presence of all mandatory provenance fields: source, fetchedAt, marketTimestamp, effectiveDate, version, validationStatus.
3. Assign `isProductionQuality = false` for NSE_OFFICIAL and YAHOO_RESEARCH sources (AD-09).
4. Compute `staleAfterInstant` based on source-specific TTL rules.
5. Perform payload-level validation against the declared dataType schema.
6. Set validationStatus: VALID if all checks pass; INCOMPLETE if required fields are absent; ANOMALY_DETECTED if price change exceeds threshold (MD-008, default 20% single-session move on non-corporate-action days); FAILED_VALIDATION if schema fails.
7. Return the immutable `MarketDataRecord`; do not store invalid records.

### DataVersionSnapshot Assembly

1. Collect all MarketDataRecord objects needed for a single evaluation pass.
2. For each contributing dataType, compute a completeness percentage: records-present / expected-records.
3. If any required dataType completeness falls below 98% (BT-008 / AD-05), mark the snapshot incomplete and fail the evaluation.
4. If any contributing source has `isProductionQuality = false`, set snapshot `isProductionQuality = false`.
5. Assign a unique `DataVersionId` to the completed snapshot.
6. Record all contributing sources in the `sources` array.
7. Return the immutable snapshot.

### Data Anomaly Detection

1. For EOD_PRICE records, compare the closing price to the prior-session close.
2. If the change (absolute or in percentage) exceeds the configured anomaly threshold and no corporate action was scheduled on that date, set `validationStatus = ANOMALY_DETECTED`.
3. Anomaly-flagged instruments block production planning until the anomaly is cleared or confirmed as valid (MD-008).
4. Price adjustment consistency check: when applying corporate-action-adjusted prices to a historical series, verify the adjustment factor is consistent across adjacent sessions (MD-009).

### Staleness Check

1. Before every evaluation use of a record, compare `now()` against `staleAfterInstant`.
2. If `now() > staleAfterInstant`, treat the record as STALE.
3. STALE records block production planning (DF-002) but may be used in research mode with an explicit STALE label in the output.

### NSE vs Yahoo Priority (Research Mode, AD-09)

- When both NSE_OFFICIAL and YAHOO_RESEARCH data are available for the same instrument and date in research mode: use NSE_OFFICIAL as primary.
- Label Yahoo data as YAHOO_RESEARCH with `isProductionQuality = false`.
- Neither source may be used as input to production evaluation or live order generation.

---

## Universe Eligibility Engine

Purpose: apply all strategy-configured eligibility rules to determine which instruments may enter, hold, or exit (US-011).

### Input

- `EligibilityPolicy` from the active `StrategyConfig`.
- `DataVersionSnapshot` with point-in-time membership, price, fundamental, and instrument data for the evaluation date.
- `CorporateAction` records for the evaluation date.

### Algorithm

For each instrument in the candidate universe:

1. **INDEX_MEMBERSHIP check**: instrument must appear in historical point-in-time index membership for the evaluation date (UE-001). Failure reason: INDEX_NOT_MEMBER.
2. **LISTING_HISTORY check**: trading days in exchange since listing ≥ `minListingDays`. Uses 252 sessions per year convention (UE-013). Failure reason: INSUFFICIENT_LISTING_HISTORY.
3. **PRICE_AVAILABILITY check**: at least one valid EOD_PRICE record exists for the evaluation date. Failure reason: PRICE_UNAVAILABLE.
4. **MIN_PRICE check**: latest adjusted close ≥ `minPrice` (INR). Failure reason: BELOW_MIN_PRICE.
5. **TRADED_VALUE check**: median 20-day traded value of actual most-recent 20 sessions ≥ `minMedian20DTradedValueINR`. Forward sessions are excluded (UE-014). Failure reason: INSUFFICIENT_LIQUIDITY.
6. **CORPORATE_ACTION_STATUS check**: instrument has no unresolved corporate action blocking eligibility (UE-010). Failure reason: CORPORATE_ACTION_UNRESOLVED.
7. **TRADING_STATUS check**: instrument not suspended (CA-007 / UE-003). Failure reason: SUSPENDED_TRADING.
8. **SURVEILLANCE_STATUS check**: instrument not under any configured restricted surveillance category (UE-003). Failure reason: RESTRICTED_SURVEILLANCE.
9. **PRICE_ADJUSTMENT_VALIDITY check**: adjusted price series passes consistency validation (MD-009). Failure reason: ADJUSTMENT_INCONSISTENT.
10. **DATA_ANOMALY check**: no active unresolved anomaly flag on the price series (UE-015). Failure reason: PRICE_ANOMALY.
11. **FUNDAMENTAL_FRESHNESS check** (if `fundamentalFreshnessRequired`): fundamental record exists and was published before the evaluation date with no FUNDAMENTAL_DATA_UNAVAILABLE flag (MD-015). Failure reason: STALE_FUNDAMENTALS.
12. **BROKER_MAPPING check** (if `requireBrokerMapping`): valid broker token exists in InstrumentRegistryPort (UE-016). Failure reason: MISSING_BROKER_MAPPING.

Hard-stop exclusions (applied regardless of the above – UE-009, UE-020):

- Any confirmed fraud, insolvency, court-imposed restriction, or confirmed delisting → HARD_RISK_FLAG → excluded from new buy eligibility.
- Grade-A governance flags are structural hard stops with no exception.

FUNDAMENTAL_HEALTH check (if `requireFundamentals`, UE-011):

- Non-BFSI: negative operating cash flow (consecutive periods), debt-to-equity or interest-coverage breach, auditor issues, or promoter-pledge excess → FUNDAMENTAL_HEALTH_EXCLUDE.
- BFSI: NIM below threshold, GNPA above threshold, CAR below threshold, or interest coverage breach → FUNDAMENTAL_HEALTH_EXCLUDE using sector-appropriate metrics (AD-10, UE-008).

### Eligibility Status Assignment

- `ELIGIBLE`: all applicable rules pass; no hard-stop flag.
- `INELIGIBLE`: any mandatory rule fails or a HARD_RISK_FLAG is present.
- `HOLD_ELIGIBLE`: instrument already in portfolio, within hold-rank buffer, no mandatory rule failure, and within no-trade drift band. May be retained but not bought.
- `FORCED_REVIEW`: rank has fallen below `forcedReviewRank`; instrument is not auto-exited but flagged for operator review (UE-007).

### Missing Data Treatment

- Any eligibility field that is absent or unavailable is treated as failing the relevant rule (UE-004). Missing data never improves eligibility.

### Determinism Guarantee

- For identical `instrumentId`, `strategyVersionId`, and `dataVersionId`, the eligibility output is deterministic (UE-005). The eligible universe size and composition are recorded in the DataVersionSnapshot (UE-012).

---

## Signal Calculation Engine

Purpose: compute z-scored factor components, composite scores, conviction multipliers, and ranks for the eligible universe (US-012).

### Inputs

- `EligibilityResult[]` for the evaluation date (only ELIGIBLE and HOLD_ELIGIBLE instruments).
- `DataVersionSnapshot` with adjusted prices and fundamentals.
- `FactorPolicy` from the active `StrategyConfig`.

### Step 1: Compute Raw Factor Inputs

For each eligible instrument and each of the 18 factor components (7 momentum, 6 quality, 5 risk), compute the raw numeric value using point-in-time adjusted prices and publication-date fundamentals:

Momentum components:
- `return12_1`: log return from 12 months ago to 1 month ago (excludes the most recent month to avoid short-term reversal).
- `return6_1`: log return from 6 months ago to 1 month ago.
- `return3_1`: log return from 3 months ago to 1 month ago.
- `relativeStrength6M`: stock 6-month return minus Nifty 50 6-month return.
- `priceTo200DMA`: close price divided by 200-day simple moving average minus 1.
- `priceTo100DMA`: close price divided by 100-day simple moving average minus 1.
- `earningsMomentum`: earnings surprise or analyst revision proxy (EPS actual vs consensus for last available quarter).

Quality components (BFSI branching per AD-10):
- Non-BFSI: return-on-equity (TTM), return-on-capital-employed (TTM), operating-cash-flow-to-debt ratio, debt-to-equity (inverted), interest-coverage ratio, revenue growth (TTM YoY).
- BFSI: net interest margin (NIM), gross non-performing asset ratio (GNPA, inverted), capital adequacy ratio (CAR), return-on-equity (TTM), operating leverage efficiency, revenue growth (TTM YoY).
- Both sets use six factors; `financialSectorFlag` from EligibilityResult drives branching.

Risk components (all inverted: lower risk = higher score):
- 60-day realized daily return volatility (annualized).
- Maximum drawdown over trailing 12 months.
- Downside deviation (semi-deviation below zero).
- Beta relative to Nifty 50 (trailing 252 days).
- Liquidity risk proxy (bid-ask spread estimate or inverse of average daily volume).

### Step 2: Winsorize at ±3σ

For each component across the eligible universe:
1. Compute the cross-sectional mean and standard deviation.
2. Clip each value to [mean − 3 × std, mean + 3 × std] (SC-003).
3. Apply inversion to risk components before winsorization: raw = −raw_risk so that lower risk yields a higher value entering the z-scoring step.

### Step 3: Z-Score Cross-Sectionally

For each winsorized component value in the universe:

```
Z_i = (winsorized_i - cross_sectional_mean) / cross_sectional_std
```

- If a component value is missing for an instrument, treat it as z-score = 0.0 (the neutral value) and log the missing-data treatment in the signal snapshot (SC-004).
- If the cross-sectional standard deviation is zero (all instruments have the same value), all z-scores for that component are set to 0.0.

### Step 4: Compute Factor Scores

```
MomentumScore = sum(momentumWeight_j × Z_momentum_j)  for j = 1..7
QualityScore  = sum(qualityWeight_k × Z_quality_k)    for k = 1..6
RiskScore     = sum(riskWeight_l × Z_risk_l)          for l = 1..5
```

Using the exact weights from `FactorPolicy` (SC-005, SC-006).

### Step 5: Compute Composite Score

```
CompositeScore = momentumWeight × MomentumScore
               + qualityWeight  × QualityScore
               + lowRiskWeight  × RiskScore
```

Using the three top-level weights from `FactorPolicy` (SC-007).

### Step 6: Compute Conviction Multiplier

For each eligible instrument compute its cross-sectional percentile of CompositeScore within the eligible universe, then (AD-12, SC-008):

```
ConvictionMultiplier = 0.80 + 0.40 × Percentile(CompositeScore_i)
```

Result is in [0.80, 1.20] inclusive. Percentile is computed using interpolation across the ranked eligible universe. Ties are broken deterministically by descending `instrumentId` alphabetical order (SC-011).

### Step 7: Sector-Neutral Adjustment (Optional, SC-013)

If `sectorNeutral = true` in the `CompositePolicy`:
1. Group eligible instruments by NIC/GICS sector.
2. For each sector, compute the sector median CompositeScore.
3. Adjust each instrument's CompositeScore by subtracting the sector median before final ranking.

Sector-neutral mode is off by default and must be explicitly configured.

### Step 8: Rank Assignment

Rank 1 = highest CompositeScore (or adjusted score) within the eligible universe. Ineligible instruments receive no rank. Ties are broken by descending `instrumentId` alphabetical order (deterministic tiebreak, SC-011).

### Computation Error Handling

- If any intermediate computation produces NaN, Infinity, or negative-infinity, the affected instrument's signal is set to COMPUTATION_ERROR status (SC-010). This does not propagate silently.
- Instruments in COMPUTATION_ERROR are treated as INELIGIBLE for construction purposes.

### Signal Snapshot Immutability

Once produced for a given `strategyVersionId`, `dataVersionId`, and `asOf` date, the signal snapshot is immutable. Recalculation with different inputs produces a new snapshot with a new `DataVersionId` (SC-012, SC-015).

---

## Regime Determination Engine

Purpose: classify the current market regime and compute equity-exposure targets. Regime logic controls total portfolio equity allocation only; it never selects, ranks, or weights individual securities (RM-001).

### Regime Indicator Computation

From the DataVersionSnapshot, compute seven indicators for the evaluation date:

| Indicator | Computation |
|---|---|
| `nifty50AboveDMA200` | Nifty 50 close > 200-day SMA of Nifty 50 closes |
| `nifty500AboveDMA200` | Nifty 500 close > 200-day SMA of Nifty 500 closes |
| `breadthAbove200DMA_pct` | Percentage of eligible stocks whose close > their 200-day SMA |
| `breadthAbove100DMA_pct` | Percentage of eligible stocks whose close > their 100-day SMA |
| `benchmarkVolatility20D` | 20-day realized daily return volatility of Nifty 50 (annualized) |
| `marketDrawdownFrom52W` | (52-week high − current close) / 52-week high |
| `creditStressProxy` | Optional; absent if not configured by the strategy |

Data source (AD-11): Nifty index history from the same licensed EOD provider. Yahoo Nifty data is used only in research mode.

### Crisis Regime (Immediate – No Confirmation)

Crisis triggers immediately (no confirmation period, AD-03) when ANY of these data-independent hard criteria are met:

- Benchmark drawdown from 52-week high exceeds the configured `crisisDrawdownPct`.
- Market is abnormally closed (exchange-declared closure outside the exchange calendar).
- Portfolio drawdown circuit-breaker threshold (`drawdownKillSwitchPct`) has been reached.
- Market data is stale or unavailable (fail closed per AD-08: treat unavailable regime data as CRISIS with reason code REGIME_DATA_UNAVAILABLE).

### Regime Classification Logic

Applied when Crisis criteria are not met:

```
RISK_ON:
  nifty50AboveDMA200 = true
  AND nifty500AboveDMA200 = true
  AND breadthAbove200DMA_pct > 50%
  AND benchmarkVolatility20D < highVolatilityThreshold

RISK_OFF:
  (nifty50AboveDMA200 = false AND nifty500AboveDMA200 = false)
  AND (breadthAbove200DMA_pct < 35% OR portfolioVolatilityTriggered)
  [applies confirmation period: default 2 closes for weakening]

CAUTION:
  conditions are mixed (at least one RISK_ON condition met, not all met)

CRISIS:
  triggered by hard criteria (see above)
```

Equity exposure targets per regime state:

| Regime | Target equity exposure |
|---|---|
| RISK_ON | 90% – 100% |
| CAUTION | 60% – 80% |
| RISK_OFF | 30% – 50% |
| CRISIS | 0% new buys; existing positions held unless drawdown circuit breaker fires |

### Confirmation Period Rules

Weakening transitions (RISK_ON → CAUTION, CAUTION → RISK_OFF):
- Require `confirmationPeriodsWeakening` consecutive closes meeting the weaker regime conditions (AD-02, default: 2).
- A single noisy observation below the threshold does not trigger a downgrade (RM-006).

Strengthening transitions (RISK_OFF → CAUTION, CAUTION → RISK_ON):
- Require `confirmationPeriodsStrengthening` consecutive closes meeting the stronger regime conditions (AD-02, default: 5), or a weekly-close confirmation (RM-007).

### Confirmation Counter State Machine

```text
CurrentRegime = RISK_ON, confirmationCount = 0

On each evaluation date:

IF crisis criteria met:
  -> transition immediately to CRISIS, confirmationCount = 0, isCrisisImmediate = true

ELSE IF current regime is stronger than candidate regime:
  confirmationCount += 1
  IF confirmationCount >= confirmationPeriodsWeakening:
    -> transition to candidate regime, confirmationCount = 0
  ELSE:
    -> remain in current regime with pendingTransition recorded

ELSE IF current regime is weaker than candidate regime:
  confirmationCount += 1
  IF confirmationCount >= confirmationPeriodsStrengthening:
    -> transition to candidate regime, confirmationCount = 0
  ELSE:
    -> remain in current regime with pendingTransition recorded

ELSE (no change to candidate):
  confirmationCount = 0, pendingTransition = absent
```

Invariant: confirmationCount never exceeds max(confirmationPeriodsWeakening, confirmationPeriodsStrengthening). AI sentiment or advisory output alone must never trigger a regime change (RM-009).

### Regime Data Failure

When any indicator is unavailable or stale (AD-08):
- Default to CRISIS regime immediately.
- Log reason code: REGIME_DATA_UNAVAILABLE.
- Record `isCrisisImmediate = true` in the RegimeState.

### Regime Immutability

Recorded regime states are immutable and auditable. Each regime state is associated with its evaluation date and data version snapshot (RM-010).

---

## Corporate Action Processing Flow

Purpose: apply corporate actions to historical price series, quantity records, and tax-lot lineage without losing economic value or historical accuracy (US-014).

### Action Classification and Source Priority

Sources in priority order (CA-006): EXCHANGE_FILING > licensed structured provider > broker API schedule.
Unverified AI-classified news events must not create trade-impacting corporate action flags (CA-015).

### Value-Preserving Actions (Split, Bonus, Rights)

1. Retrieve the corporate action schedule for the effective date from CorporateActionPort.
2. Validate the adjustment factor for the action type:
   - Split (e.g., 2:1): price adjustment factor = 1/2; quantity adjustment factor = 2.
   - Bonus (e.g., 1:1 bonus): price adjustment factor = 1/2; quantity adjustment factor = 2.
   - Rights: price and quantity factors derived from subscription ratio and rights price.
3. Retroactively adjust all historical price records in the series: adjusted_price = unadjusted_price × price_adjustment_factor.
4. Verify economic value conservation: (post-adjustment quantity × post-adjustment price) = (pre-adjustment quantity × pre-adjustment price) within documented rounding tolerance of 1 minor-unit INR per lot (CA-001).
5. Adjust open lot quantities and preserve tax-lot lineage. Bonus share events create new lots; all other value-preserving actions adjust in place (CA-003).
6. Set `economicValueConserved = true` and `taxLotLineagePreserved = true` in the CorporateActionImpact.
7. Transition status PENDING → PROCESSED.
8. Emit corporate action audit event (CA-010).

### Cash Dividend

1. Record as a cash event.
2. Do not adjust quantity or acquisition price (CA-008).
3. Set status PENDING → PROCESSED.

### Merger / Demerger / Symbol Change (AD-04)

1. Detect symbol-change event.
2. Block all rebalancing for the affected instrument immediately.
3. Set status to REQUIRES_MANUAL_REVIEW.
4. The instrument remains blocked until the operator confirms the new symbol mapping and broker token.
5. On operator confirmation: update the symbol mapping, reconcile broker state, and transition to PROCESSED.

### Delisting

1. Set a deterministic HARD_RISK_FLAG on the instrument (CA-007).
2. Once delisting is confirmed: instrument is permanently ineligible and must exit at the next valid execution opportunity.
3. Transition status to PROCESSED or REQUIRES_MANUAL_REVIEW if the exit cannot be completed.

### Buyback / Tender Offer

1. Block automatic action; transition to REQUIRES_MANUAL_REVIEW (CA-009).
2. Operator must explicitly opt in or opt out before any related order is generated.

### ETF Unit Change

1. Treat as a symbol-level adjustment (CA-014).
2. Block new orders until the change is confirmed.
3. Transition to REQUIRES_MANUAL_REVIEW.

### Post-Processing Reconciliation

After every PROCESSED action:
1. Initiate a broker-holdings reconciliation pass for the affected instrument (CA-011).
2. Block further planning for the instrument until reconciliation confirms adjusted quantities.

### Corporate Action State Machine

```text
PENDING
  --[unresolvable condition or blocked mapping]--> BLOCKED
  --[all adjustments applied, reconciliation confirmed]--> PROCESSED
  --[merger/demerger/buyback/ETF symbol change]--> REQUIRES_MANUAL_REVIEW

BLOCKED
  --[operator resolves mapping]--> PROCESSED
  --[operator escalates]--> REQUIRES_MANUAL_REVIEW

REQUIRES_MANUAL_REVIEW
  --[operator confirms mapping and adjustments]--> PROCESSED
  --[operator defers resolution]--> BLOCKED

PROCESSED [terminal]
```

---

## Backtesting Integrity Flow

Purpose: reproduce strategy behavior historically without look-ahead bias or survivorship bias (US-036, US-037).

### Bias Certification

Before any backtest run transitions to COMPLETED:
1. **Look-ahead check**: verify that every data access in the replay used the publication date for fundamentals (BT-002), point-in-time index membership (BT-001 / MD-005), and end-of-day prices from no later than the decision day T (AD-13). Any access to data published after day T is a LOOK_AHEAD_VIOLATION.
2. **Survivorship check**: verify that delisted and suspended instruments were included in the universe for periods they were active (BT-004). Retrospective exclusion produces SURVIVORSHIP_BIAS_VIOLATION.
3. Both checks must produce a result of 0 violations before COMPLETED status is assigned (BT-006).
4. `lookAheadChecksPerformed = true` and `survivorshipBiasChecksPerformed = true` are recorded in the BacktestRun.

### T+1 Execution Model (AD-13)

- Decision day T: signals are computed using data available at EOD of day T.
- Execution day T+1: orders are simulated at the next valid trading session after T within the configured execution window (09:45–11:30 IST default per executionPolicy).
- Slippage is applied using the configurable cost schedule.
- Incomplete trading sessions (partial exchange closures) are handled using the exchange calendar version specified in the backtest.

### Minimum History and Walk-Forward Requirements

- Minimum historical data: 5 calendar years of daily EOD history (BT-007).
- Walk-forward: at least 3 rolling folds required for production-quality evidence (AD-15).
- In-sample and out-of-sample periods must not overlap; overlap triggers LOOK_AHEAD_VIOLATION (BT-011).
- Each fold records: in-sample date range, out-of-sample date range, key metrics, and the data version snapshot.

### Data Completeness Threshold

- ≥ 98% of required observations must be present for each instrument-period (BT-008 / AD-05).
- An instrument-period falling below this threshold is excluded from that fold with a DATA_INCOMPLETE reason code.
- A backtest with insufficient universe coverage for any fold is rejected as not production-quality.

### Cost Model Consistency

- Backtest cost and slippage use the same configurable cost schedule as the live planner (BT-005).
- The cost model is versioned with the strategy version; a change in costs requires a new backtest run.
- Estimated cost drag (bps) and tax drag (bps) are computed and stored in BacktestResult.

### Bootstrap and Monte Carlo

- Controlled randomness only; the random seed is logged in the BacktestRun record (BT-013).
- The seed enables exact reproducibility of any run.

### Evidence Report

- Every completed BacktestRun produces an `EvidenceReport` JSON payload (AD-07).
- A human-readable markdown summary is available for export and audit.
- The `noReturnGuaranteeStatement` is required in every output (BT-009).
- `BacktestResult.dataVersion` must equal the run's `dataVersionId` (immutable binding).

### Determinism

- Identical `backtestId`, `strategyVersionId`, `dataVersionId`, and date range always produce the same result (BT-010).
- Exchange calendar version and timezone are recorded in the BacktestRun. Inconsistency with the live calendar produces a WARNING in the evidence report (BT-014).
- Regime logic in the backtest uses the same confirmation periods and indicator definitions as the live strategy (BT-015).

### BacktestRun Status State Machine

```text
PENDING
  --[engine starts, all bias checks initialized]--> RUNNING

RUNNING
  --[all folds complete, both bias checks pass, 0 violations]--> COMPLETED
  --[unrecoverable error or bias violation detected]--> FAILED

COMPLETED [terminal]
FAILED    [terminal]
```

---

## AI Advisory Boundary Flow

Purpose: enforce the structural boundary that AI output is advisory-only and can never alter deterministic domain state (US-038).

### Permitted Operations

The `AiPermittedOperation` enum contains exactly six values:

| Operation | Permitted use |
|---|---|
| SUMMARIZE | Produce a text summary of provided structured data |
| CLASSIFY | Classify news article, filing, or structured text into a provided category schema |
| EXTRACT | Extract named entities or structured fields from text |
| COMPARE | Compare two or more data objects and produce a differential summary |
| EXPLAIN | Explain the reasoning behind an existing deterministic output in plain language |
| PRIORITIZE_REVIEW | Rank a list of items for human operator review priority |

Any operation outside this set is rejected at the port boundary before invocation (AI-001). The enum is closed; structural unrepresentability prevents extension without a code change.

### Prohibited Operations (AI-010)

Any advisory request that attempts to:
- Invent or predict return expectations.
- Alter strategy parameters or configuration.
- Select securities or determine portfolio composition.
- Determine order quantities, timing, prices, or execution priority.
- Bypass or relax risk, validation, or authorization controls.
- Turn unverified allegations into deterministic risk flags.
- Create HARD_RISK_FLAG, FUNDAMENTAL_HEALTH_EXCLUDE, or corporate action entries.

…is rejected with a `PROHIBITED_AI_OPERATION` reason code and logged in the security audit trail.

### Input Constraints

AI advisory requests must not include (AI-007):
- Portfolio state, holdings, or orders.
- Broker credentials or account identifiers.
- Personally identifiable information.
- Strategy execution parameters, approval status, or order state.

The `inputContent` field of `AiAdvisoryRequest` is a structurally constrained type that excludes these fields by design.

### Output Constraints

`AiAdvisoryResult` carries three structural constants:

```
canInfluenceState          = false  (compile-time constant)
canDetermineOrderQuantity  = false  (compile-time constant)
canAlterParameters         = false  (compile-time constant)
```

These are not runtime flags; they are type-system constants that cannot be set to `true` in any code path.

### Trade-Impacting Flag Boundary

Only verified sources may set deterministic trade-impacting flags (AD-14):
- Verified exchange filings → may set HARD_RISK_FLAG.
- Verified company filings → may set HARD_RISK_FLAG.
- Licensed structured provider data → may set FUNDAMENTAL_HEALTH_EXCLUDE or corporate action flags.
- AI classification of a news article → advisory context only; cannot set any deterministic flag (AI-006, AI-009).

### Graceful Degradation

When the AI advisory service is unavailable (AI-008):
- The deterministic evaluation pipeline (eligibility, signal scoring, regime determination, planning) continues without interruption.
- Produce a `DEGRADED_ADVISORY_CONTEXT` warning in the affected signal snapshot and research report (DF-008, DF-009).
- Advisory context is absent for that evaluation; the portfolio is fully operational without it.

### Audit Trail

Every AI advisory interaction is recorded in the audit log (AI-005):
- `requestId`
- `permittedOperation`
- `producedAt`
- Model identifier (redacted before external exposure)
- SHA-256 summary hash of the output content

---

## Provider Failure Handling Flow

Purpose: fail closed when dependencies are unavailable, degrade gracefully for non-critical paths (US-013).

### Critical Path (Production Evaluation)

For each required provider call (MarketDataPort, FundamentalsPort, IndexMembershipPort, ExchangeCalendarPort, InstrumentRegistryPort):

1. Attempt the call.
2. On transient failure: retry up to `maxRetries` (default 3) times with exponential backoff and configurable jitter, subject to a per-call deadline (DF-006).
3. After exhausted retries, emit a terminal `ProviderErrorEvent` with attempt count.
4. If the missing data is required for production planning: fail closed with `PROVIDER_UNAVAILABLE` reason code. Do not use stale data as a substitute (DF-001).
5. The evaluation run is abandoned; no partial result is emitted.

### Circuit Breaker

Each external provider has its own circuit breaker (DF-007):

```text
Circuit states:

CLOSED (normal)
  --[consecutive failures >= failureThreshold (default 5)]--> OPEN

OPEN (failing immediately without network attempt)
  --[cooldown period elapsed]--> HALF_OPEN

HALF_OPEN (allow one probe call)
  --[probe succeeds]--> CLOSED
  --[probe fails]--> OPEN
```

The circuit breaker is per-provider and does not affect other providers.

### Staleness Handling

- If data is available but stale (`now() > staleAfterInstant`): block production planning with `STALE_DATA` reason code (DF-002).
- Stale data may be used in research mode with an explicit STALE label.

### Clock or Timezone Mismatch

- If the application server clock and exchange calendar source disagree by more than the configured threshold: emit `DATA_CLOCK_MISMATCH` reason code and block all order generation (DF-003, MD-013).

### Non-Critical Path (Advisory, News, Sentiment)

- Failure of AiAdvisoryPort, news provider, or optional sentiment feed degrades the advisory output without blocking the deterministic pipeline (DF-008).
- Produce `DEGRADED_ADVISORY_CONTEXT` warning; label the evaluation result accordingly (DF-009).
- The pipeline continues.

### Log Discipline

- All provider errors log: timestamp, correlation ID, provider identity, error type, retry count (DF-004).
- Provider credentials, access tokens, and account details are redacted from all log output (DF-005).
- Internal provider error messages are not propagated to the external API response.

### Provider Health Status

- A `ProviderHealthRecord` is maintained per provider and updated after every call attempt (DF-010).
- Provider health feeds into the portfolio health report in U06 without direct coupling to the evaluation pipeline.

---

## Strategy Evidence and Research Comparison Flow

Purpose: support validation of multiple strategy versions using horizon-appropriate metrics and reproducible comparison (US-037).

### Evidence Assembly

For a candidate StrategyVersion to transition from ACTIVATION_PENDING to ACTIVE, all four mandatory evidence types must be present and each must have `passed = true`:

| Evidence Type | Description |
|---|---|
| BACKTEST | Full historical replay ≥ 5 years; 0 look-ahead and survivorship violations |
| WALK_FORWARD | ≥ 3 rolling folds, no in-sample/out-of-sample overlap |
| OUT_OF_SAMPLE | True holdout period not used in any model fitting or parameter tuning |
| SHADOW_OPERATION | Paper or shadow portfolio run with real market data, not affecting live state |

Optional supplementary evidence types (SENSITIVITY, BOOTSTRAP_MONTE_CARLO, REGIME_STRESS) may be included but are not mandatory for activation.

### ResearchComparisonReport

When comparing two or more strategy versions:
1. All compared versions must use the same `DataVersionId` (same point-in-time basis).
2. All compared versions must use the same cost model and tax schedule.
3. Horizon-appropriate rolling metrics are computed for each version:
   - SHORT horizon: rolling 3-month and 6-month returns, drawdown, and cost.
   - MEDIUM horizon: rolling 6-month and 12-month returns, drawdown, and cost.
   - LONG horizon: rolling 12-month and 36-month returns, drawdown, compound growth, and dividend yield.
4. Every report output includes the `noReturnGuaranteeStatement` (BT-009).
5. An apparent best CAGR that fails risk, instability, cost, or turnover thresholds must keep the approval blocked (US-037 acceptance criteria).

### Walk-Forward Window Configuration (AD-15)

- Rolling 12-month folds.
- Minimum 3 folds required.
- Minimum 5 years of history (to accommodate at least 5 folds with some overlap).
- Each fold's evidence is stored as a `WalkForwardFold` in the `BacktestResult`.

---

## Downstream Data Flow

| Consumer | U03 contract supplied |
|---|---|
| U02 Persistence | StrategyVersion aggregate snapshots, BacktestRun records, EvidenceReport payloads, CorporateAction records, DataVersionSnapshot identifiers |
| U01 Domain | Strategy-version activation evidence contract (opaque evidence token), strategyVersionId references |
| U04 Construction | EligibilityResult, SignalSnapshot, RegimeState, conviction multipliers, target equity exposure |
| U05 Execution | StrategyVersionId for cost schedule, CorporateActionImpact for quantity adjustments |
| U06 Operations | ProviderHealthRecord, DEGRADED_ADVISORY_CONTEXT labels, audit events |
| U07 API | Strategy lifecycle commands and read models, research comparison API |
| U08 React | Strategy version list, activation status, backtest summary (via U07 API types) |
| U09 Verification | Deterministic evaluation generators, state machines, PBT invariants |

---

## Primary Story Coverage

| Story | Business Logic Model Coverage |
|---|---|
| US-006 | Preset seeding idempotency; DRAFT creation; exact config match against strategy-presets.md; SV-005, SV-006 |
| US-007 | Schema validation flow; canonical hash computation; DRAFT creation and versioning; SR-001 through SR-015; SV-012, SV-013 |
| US-008 | Activation flow; four mandatory evidence types; authorized approver requirement; SV-002 through SV-004; SV-011; SV-014 |
| US-010 | Data ingestion flow; provenance fields; staleness check; production-quality flag; NSE vs Yahoo priority; MD-001 through MD-015 |
| US-011 | Eligibility engine; 12-rule filter sequence; BFSI branching; hard-stop exclusions; hold-eligibility; determinism guarantee; UE-001 through UE-020 |
| US-012 | Signal calculation engine; 7 momentum + 6 quality + 5 risk components; winsorization; z-scoring; composite score; conviction multiplier; regime confirmation state machine; SC-001 through SC-015; RM-001 through RM-010 |
| US-013 | Provider failure flow; circuit breaker; retry with backoff; fail-closed behavior; non-critical degradation; DF-001 through DF-010 |
| US-014 | Corporate action processing; value conservation; tax-lot lineage; symbol-change blocking; reconciliation gate; CA-001 through CA-015 |
| US-036 | Backtesting bias certification; T+1 execution model; walk-forward; data completeness; BT-001 through BT-015 |
| US-037 | Evidence assembly; four mandatory types; research comparison report; horizon-appropriate metrics; walk-forward window; no-guarantee statement |
| US-038 | AI advisory boundary; six permitted operations; prohibited operations list; structural constants; trade-impacting flag boundary; degradation; AI-001 through AI-010 |

---

## PBT Generator Specifications (PBT-07 Compliance)

### StrategyConfig Generator

- Randomly generate valid factor weights that sum to exactly 1.0 (integers summing to 1,000,000 then normalized).
- Randomly generate sub-component weight sets (7+6+5) that each independently sum to 1.0.
- Generate valid enum values from the declared valid set.
- Generate EligibilityPolicy thresholds as strictly positive values within expected ranges.
- Generate drawdown thresholds as ordered tuples: warning < riskReduction < killSwitch.
- Occasionally inject boundary values: minimum cash buffer (0.5), maximum holdings boundary, equal entryRank/holdRank (should fail), etc.

### EligibilityResult Generator

- Generate universe subsets of arbitrary size (2 to 500 instruments).
- Randomly assign eligibility rule pass/fail outcomes while ensuring: ELIGIBLE requires all rules pass; INELIGIBLE requires at least one mandatory failure.
- Generate BFSI and non-BFSI subsets to test sector-branching.
- Generate pathological cases: all instruments INELIGIBLE; single instrument ELIGIBLE; all instruments HOLD_ELIGIBLE.

### SignalSnapshot Generator

- Generate arbitrary universe sizes.
- Generate raw factor values with occasional NaN, Infinity, missing values to test error handling.
- Generate cases where all instruments have the same component value (std = 0 case).
- Generate post-winsorization cases to verify NaN/Infinity cannot leak into z-scores.

### RegimeState Generator

- Generate sequences of regime indicator tuples (7 values per date, multiple consecutive dates).
- Include sequences designed to trigger confirmation-period boundaries.
- Include sequences with mid-sequence crisis criteria injected.
- Include sequences of all-missing regime data to test fail-closed behavior.

### BacktestRun Generator

- Generate strategy versions with valid configs.
- Generate data snapshots with varying completeness levels (below and above 98%).
- Generate date ranges shorter than 5 years (should fail), exactly 5 years, and longer.
- Generate cases where look-ahead conditions are artificially injected.

### CorporateActionImpact Generator

- Generate split ratios (2:1, 3:2, 10:1).
- Generate bonus ratios (1:1, 1:2).
- Verify economic value conservation formula holds for all generated ratios.

### AiAdvisoryRequest Generator

- Generate all six permitted operation types.
- Generate prohibited operation strings that must be rejected.
- Verify `canInfluenceState` is always `false` regardless of operation.

---

## Testable Properties (PBT-01 Compliance)

### StrategyConfig

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-01 | Config round-trip | Round-trip (PBT-02) | serialize(config) → deserialize → structurally equal to original config |
| P-02 | Config hash determinism | Invariant (PBT-03) | Structurally equal configs always produce the same hash; different configs produce different hashes with high probability |
| P-03 | Weight sum invariant | Invariant (PBT-03) | momentumWeight + qualityWeight + lowRiskWeight = exactly 1.0 after any valid operation |
| P-04 | Sub-component weight sums | Invariant (PBT-03) | Each of the three sub-component weight sets sums to exactly 1.0 independently |
| P-05 | Schema validation rejection | Invariant (PBT-03) | Any generated invalid config (weight sum ≠ 1, enum violation, etc.) is rejected with a named error code |

### StrategyVersionStatus State Machine

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-06 | No invalid transitions | Stateful (PBT-06) | Random valid command sequences applied to the state machine never produce an invalid status transition |
| P-07 | Terminal state finality | Invariant (PBT-03) | SUPERSEDED and WITHDRAWN are terminal; no further transitions are accepted |
| P-08 | Exactly-one ACTIVE invariant | Invariant (PBT-03) | After any sequence including activation, at most one version per strategyId is ACTIVE |

### Eligibility Engine

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-09 | Determinism | Invariant (PBT-03) | Identical instrumentId, strategyVersionId, dataVersionId always produce identical EligibilityResult |
| P-10 | Idempotency | Idempotency (PBT-04) | Running the eligibility engine twice with the same inputs produces the same result |
| P-11 | Missing-data pessimism | Invariant (PBT-03) | Any eligibility input with a missing field never produces a more favorable outcome than the same input with the field present and failing |
| P-12 | Oracle cross-check | Oracle (PBT-05) | Brute-force per-rule evaluation matches the engine output for every generated instrument |

### Signal Calculation

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-13 | Z-score range after winsorization | Invariant (PBT-03) | All z-scores remain in [-3.0, 3.0]; no NaN or Infinity propagates beyond the computation step |
| P-14 | Composite score oracle | Oracle (PBT-05) | CompositeScore matches brute-force weighted sum within exact tolerance for all generated universes |
| P-15 | Conviction multiplier range | Invariant (PBT-03) | ConvictionMultiplier is always in [0.80, 1.20] for any generated universe |
| P-16 | BFSI branching isolation | Invariant (PBT-03) | BFSI instruments never use industrial debt ratios; non-BFSI instruments never use NIM/GNPA/CAR |
| P-17 | Rank determinism | Invariant (PBT-03) | Identical universe and scores always produce the same rank ordering |
| P-18 | Weight sum propagation | Invariant (PBT-03) | Factor weights sum invariant holds after normalization for any generated universe subset |

### Regime Engine

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-19 | Confirmation counter bound | Stateful (PBT-06) | confirmationCount never exceeds max(confirmationPeriodsWeakening, confirmationPeriodsStrengthening) |
| P-20 | No transition without confirmation | Stateful (PBT-06) | Regime never transitions from a stronger to a weaker state without meeting the required consecutive count |
| P-21 | Crisis immediacy | Invariant (PBT-03) | Any input sequence containing hard crisis criteria immediately produces CRISIS regime regardless of prior state |
| P-22 | Fail-closed on missing data | Invariant (PBT-03) | All-missing indicator input produces CRISIS regime with REGIME_DATA_UNAVAILABLE reason code |

### Corporate Action

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-23 | Economic value conservation | Invariant (PBT-03) | For all generated split and bonus ratios, (pre-qty × pre-price) equals (post-qty × post-price) within documented 1 minor-unit INR tolerance |
| P-24 | Tax-lot lineage preservation | Invariant (PBT-03) | Value-preserving actions never lose or duplicate lot records |

### Backtesting

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-25 | Idempotency | Idempotency (PBT-04) | Identical strategyVersionId + dataVersionId + date range produces an equivalent BacktestResult |
| P-26 | Zero violations invariant | Invariant (PBT-03) | A COMPLETED BacktestRun always has lookAheadViolations = 0 and survivorshipViolations = 0 |
| P-27 | Reproducibility with seed | Round-trip (PBT-02) | Bootstrap/Monte Carlo run with the same seed produces bitwise-identical results |

### AI Advisory

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-28 | canInfluenceState constant | Invariant (PBT-03) | AiAdvisoryResult.canInfluenceState is always false for any generated request and any permitted operation |
| P-29 | canDetermineOrderQuantity constant | Invariant (PBT-03) | AiAdvisoryResult.canDetermineOrderQuantity is always false |
| P-30 | Prohibited operation rejection | Invariant (PBT-03) | Any request with an operation not in the six-element permitted set is rejected at the port boundary |

### DataVersionSnapshot

| ID | Property | Category | Assertion |
|---|---|---|---|
| P-31 | Round-trip integrity | Round-trip (PBT-02) | Snapshot ID → restore all records round-trips without data loss or provenance truncation |
| P-32 | Production-quality propagation | Invariant (PBT-03) | A snapshot containing any non-production-quality source always has isProductionQuality = false |

### Shrinking and Reproducibility (PBT-08)

All generated test cases use a deterministic seed. Shrinking must:
- Reduce universe sizes while preserving the violating condition.
- Reduce weight arrays to minimal failing examples that still sum incorrectly.
- Reduce regime indicator sequences to the minimal sequence that triggers the violating transition.

---

## Extension Compliance Summary

### Security Baseline

| Rule | Applicable | Compliance |
|---|---|---|
| SECURITY-01 Encryption at rest/transit | N/A – U03 defines no persistence (owned by U02) | N/A |
| SECURITY-02 Network logging | N/A – no HTTP intermediary in U03 | N/A |
| SECURITY-03 Application logging | Yes – provider errors log correlation IDs; credentials are redacted | Compliant: DF-004, DF-005 |
| SECURITY-04 HTTP security headers | N/A – U03 serves no HTTP | N/A |
| SECURITY-05 Input validation | Yes – strategy config and data payloads are schema-validated | Compliant: SR-001 through SR-015; MD-001 |
| SECURITY-08 Least privilege | N/A – U03 defines no authorization layer; boundary is structural | N/A |
| SECURITY-11 Execution limits | Yes – AI advisory cannot alter state; structural constants enforce this | Compliant: AI-001 through AI-010 |
| SECURITY-13 Audit logging | Yes – strategy lifecycle events and AI interactions audited | Compliant: SV-010; AI-005 |
| SECURITY-15 Input sanitization | Yes – config JSON is safely parsed before field access | Compliant: SR-001 through SR-004 |

**Security finding**: No blocking finding.

### Resiliency Baseline

| Rule | Applicable | Compliance |
|---|---|---|
| RESILIENCY-01 Workload criticality | Yes – U03 is a critical evaluation pipeline | Compliant: documented in design objective and failure flows |
| RESILIENCY-05 Dependency failure | Yes – data providers may fail | Compliant: DF-001 through DF-010 |
| RESILIENCY-06 Circuit breaking | Yes – provider retries with circuit breaker | Compliant: DF-006, DF-007 |
| RESILIENCY-10 Degradation | Yes – non-critical AI/news path degrades without blocking deterministic engine | Compliant: DF-008, DF-009; AI-008 |

**Resiliency finding**: No blocking finding.

### Property-Based Testing (Full)

| Rule | Applicable | Compliance |
|---|---|---|
| PBT-01 Property identification | Yes | Compliant: 32 testable properties identified above |
| PBT-02 Round-trip | Yes – config serialization; snapshot round-trip; bootstrap seed reproducibility | Compliant: P-01, P-27, P-31 |
| PBT-03 Invariant | Yes – weights, scores, ranges, constants, determinism | Compliant: P-02 through P-05, P-07 through P-18, P-21 through P-26, P-28 through P-30, P-32 |
| PBT-04 Idempotency | Yes – eligibility runs; backtest replays | Compliant: P-10, P-25 |
| PBT-05 Oracle/model-based | Yes – signal scoring oracle vs brute force; eligibility cross-check | Compliant: P-12, P-14 |
| PBT-06 Stateful | Yes – strategy version state machine; regime confirmation counter | Compliant: P-06, P-08, P-19, P-20 |
| PBT-07 Generator quality | Yes – generators specified per component | Compliant: generator specifications section above |
| PBT-08 Shrinking/reproducibility | Yes – shrinking strategy and seed discipline documented | Compliant: shrinking section above |

**PBT finding**: No blocking finding.

**Overall extension finding**: No blocking Security, Resiliency, or Property-Based Testing finding.
