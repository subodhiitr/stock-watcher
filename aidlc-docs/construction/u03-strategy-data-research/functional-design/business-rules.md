# U03 Business Rules

## Rule Numbering Convention

Rules are grouped by subsystem. Each rule has a unique identifier and a precise statement. All rules are technology-agnostic. Implementation evidence is provided in code tests.

Subsystems: SR (Strategy Schema), SV (Strategy Version Lifecycle), MD (Market Data and Provenance), UE (Universe and Eligibility), SC (Signal Calculation), RM (Regime Logic), CA (Corporate Actions), BT (Backtesting Integrity), AI (AI Advisory Boundary), DF (Dependency Failure Handling).

---

## SR: Strategy Schema Validation Rules

**SR-001** — A strategy configuration JSON must be safely parsed using a schema-validated parser before any field access. Executable content, prototype methods, and constructor-overriding keys must be rejected.

**SR-002** — Factor weight fields `momentumWeight`, `qualityWeight`, and `lowRiskWeight` must sum to exactly 1.0 using scaled integer arithmetic. A sum outside [0.9999, 1.0001] after rounding is rejected.

**SR-003** — Each individual factor sub-component weight set (seven momentum weights, six quality weights, five risk weights) must independently sum to exactly 1.0 using the same scaled integer check.

**SR-004** — All threshold fields in EligibilityPolicy must be strictly positive. Any zero or negative value is rejected with a named error code.

**SR-005** — `maxHoldings` must be greater than or equal to `targetHoldings`. A strategy where `maxHoldings < targetHoldings` is rejected.

**SR-006** — `entryRank` must be strictly less than `holdRank`, which must be strictly less than `forcedReviewRank`. Any order violation is rejected.

**SR-007** — `minStockWeightPct` must be strictly less than `maxStockWeightPct`. A configuration where `minStockWeightPct >= maxStockWeightPct` is rejected.

**SR-008** — `cashBufferPct` must be in the range [0.5, 20.0]. Values outside this range are rejected.

**SR-009** — DrawdownKillSwitchPct must be strictly greater than drawdownRiskReductionPct, which must be strictly greater than drawdownWarningPct. Any order violation is rejected.

**SR-010** — Configurable enum fields (routineFrequency, defaultOrderType, mode) must match a declared valid value. Unknown enum values are rejected.

**SR-011** — Tax rate fields (ltcgRatePct, stcgRatePct, sttBuyPct, sttSellPct, gstPct) must be in the range [0.0, 100.0]. No tax rate may be negative.

**SR-012** — ExecutionPolicy.product must equal CNC. Any other product type is rejected. Short selling, margin, and options are structurally unrepresentable.

**SR-013** — ExecutionPolicy.startTime must be before ExecutionPolicy.endTime in Asia/Kolkata. Both must fall within normal NSE trading hours (09:15–15:30 IST).

**SR-014** — `benchmark` must be a non-blank, well-formed symbol string of 1 to 50 characters. Empty or whitespace-only benchmarks are rejected.

**SR-015** — A strategy schema must declare a horizon (SHORT, MEDIUM, or LONG). The horizon must be derivable from routineFrequency: BIWEEKLY maps to SHORT, MONTHLY maps to MEDIUM, QUARTERLY maps to LONG.

---

## SV: Strategy Version Lifecycle Rules

**SV-001** — Exactly one ACTIVE version may exist per strategyId at any instant. Activating a new version atomically supersedes the previous ACTIVE version in the same transaction.

**SV-002** — A DRAFT version transitions to ACTIVATION_PENDING only when at least one evidence reference is provided and the submitting actor is an authorized strategy editor.

**SV-003** — A version transitions from ACTIVATION_PENDING to ACTIVE only when all four mandatory evidence types (BACKTEST, WALK_FORWARD, OUT_OF_SAMPLE, SHADOW_OPERATION) are present and each has `passed = true`.

**SV-004** — Activation requires an explicit authorized actor approval recorded in the audit chain with actor identity, timestamp, strategy version hash, and evidence reference list.

**SV-005** — The three preset strategy versions (short-horizon-momentum-quality@1.0.0, adaptive-momentum-quality@1.0.0, long-horizon-quality-compounders@1.0.0) are registered at initialization exactly once and are idempotent on repeated initialization.

**SV-006** — Preset versions are seeded as DRAFT; they are not ACTIVE until explicit activation evidence is provided. Portfolios may assign DRAFT preset versions for PAPER and OBSERVE modes.

**SV-007** — An ACTIVE or SUPERSEDED strategy version is immutable. Its configHash, config, effectiveFrom, approvedAt, approvedBy, and evidenceRefs may never be modified.

**SV-008** — A WITHDRAWN version may not be reactivated. Its withdrawal reason and actor are permanently recorded.

**SV-009** — Emergency withdrawal of an ACTIVE version requires a privileged actor and a non-blank reason code. It produces a STRATEGY_VERSION_WITHDRAWN audit event.

**SV-010** — Every strategy lifecycle event (creation, activation submission, activation, supersession, withdrawal) produces an immutable audit event with actor, timestamp, strategy version hash, and correlation ID.

**SV-011** — Activation never sets AI-advisory output as evidence. Only verified deterministic test results count as evidence.

**SV-012** — The strategy hash is computed as SHA-256 of the canonical JSON representation (keys alphabetically sorted, UTF-8, no trailing whitespace, no indentation). The hash is computed deterministically and independently of storage.

**SV-013** — A new strategy version for an existing strategyId must not reuse a previous version string. Version strings are unique per strategyId.

**SV-014** — Strategy activation must never implicitly enable live trading. Activation changes status to ACTIVE for evaluation purposes only; live execution requires additional gates defined in U05.

**SV-015** — The three preset strategy configurations must exactly match the values in `strategy-presets.md`: factor weights, construction parameters, rebalance policy, turnover limits, drift bands, preferred hold days, and replacement hurdles.

---

## MD: Market Data and Provenance Rules

**MD-001** — Every market data record must carry source, fetchedAt, marketTimestamp, effectiveDate, version, and validationStatus. A record missing any provenance field is rejected and not stored.

**MD-002** — NSE prototype and Yahoo Finance data records always have `isProductionQuality = false`. They may not be used as inputs to production evaluation, production planning, or live order generation.

**MD-003** — A data record is stale when the current instant exceeds `staleAfterInstant`. Stale records must not be used for production evaluation. They may be used with an explicit research-mode label.

**MD-004** — Fundamentals are retrieved using publication-date-based access only. Any access pattern that could use data published after the decision date is rejected.

**MD-005** — Index membership for backtesting must use historical point-in-time membership records, not current live membership. A backtest that uses live membership without a point-in-time source is rejected.

**MD-006** — A DataVersionSnapshot captures the complete set of data records used in one evaluation pass. No evaluation result is valid without a corresponding DataVersionSnapshot identifier.

**MD-007** — A DataVersionSnapshot used in production planning must have `isProductionQuality = true` across all contributing sources.

**MD-008** — A data anomaly flag (unverified price jump or stale quote) is set when a price change exceeds a configurable threshold (default: 20% single-session move for non-corporate-action days). Anomaly flags block production planning until cleared or confirmed.

**MD-009** — Price adjustments for splits, bonuses, and dividends must be validated for consistency across the historical series before use. Inconsistencies produce a DATA_ADJUSTMENT_INCONSISTENT anomaly flag.

**MD-010** — An exchange calendar record must not be stale. All session timing (trading day check, next/previous trading day, execution window) fails closed when calendar data age exceeds the configured threshold.

**MD-011** — Broker instrument tokens must be validated against the provider registry before use in production planning. An instrument without a valid broker token is ineligible.

**MD-012** — Live quotes used for pre-trade price checks must have a marketTimestamp within the configured freshness window (default: 5 minutes before execution). Stale live quotes block order placement.

**MD-013** — A clock or timezone mismatch between the application server and the exchange calendar source produces a DATA_CLOCK_MISMATCH reason code and blocks production order generation.

**MD-014** — Provider health status is maintained separately from data freshness. A provider may be healthy but supply stale data (data gap) or may be reported unhealthy with recent data already cached.

**MD-015** — Fundamental data that is unavailable or inconsistent across two or more configured providers when the strategy requires fresh fundamentals produces a FUNDAMENTAL_DATA_UNAVAILABLE reason code and blocks production planning for affected instruments.

---

## UE: Universe and Eligibility Rules

**UE-001** — Universe membership is determined as-of the evaluation date using historical point-in-time records. An instrument not in the index on the evaluation date is excluded from the eligible universe.

**UE-002** — All twelve mandatory eligibility filters (listing history, price availability, minimum price, median traded value, corporate-action status, trading status, surveillance status, price adjustment validity, fundamental freshness, broker mapping, data anomaly) must pass for an instrument to enter a new position.

**UE-003** — A stock under any configured restricted surveillance category is automatically excluded from new position eligibility. Manual override requires explicit operator approval with audit.

**UE-004** — Missing data fields in an eligibility check never improve eligibility. Absent data is treated as failing the relevant rule.

**UE-005** — Eligibility results for the same instrument, strategy version, and data version are deterministic. Identical inputs always produce identical output.

**UE-006** — A stock meeting hold eligibility (within hold-rank buffer, no mandatory failure, within no-trade band) is treated as HOLD_ELIGIBLE and not forced to exit.

**UE-007** — A stock with rank below forcedReviewRank is marked FORCED_REVIEW, not automatically exited. Routine exit requires the additional sell-rule checks.

**UE-008** — Financial-sector companies (BFSI: banks, NBFCs, insurers) use sector-specific quality rules. Industrial-company debt and coverage metrics must not be applied to BFSI companies.

**UE-009** — Severe governance flags (confirmed default, insolvency, fraud, regulatory enforcement, material auditor resignation, delisting notice) produce a HARD_RISK_FLAG. Hard-risk flagged instruments are excluded from new buy eligibility and may trigger an exit review.

**UE-010** — An unresolved corporate-action mapping blocks the affected instrument from entering or increasing a position. Hold positions are retained with a CORPORATE_ACTION_UNRESOLVED reason code.

**UE-011** — A fundamental health exclusion (negative operating cash flow and deteriorating, debt or interest coverage breach, auditor issues, default/fraud/regulatory flag, excessive promoter pledge) produces a FUNDAMENTAL_HEALTH_EXCLUDE flag that reduces the score or triggers eligibility exclusion depending on severity.

**UE-012** — The eligible universe size and composition must be logged with the DataVersionSnapshot for full reproducibility.

**UE-013** — The minimum listing history filter uses calendar trading sessions (252 = approximately 1 year). Truncated history due to a recent listing blocks new position eligibility.

**UE-014** — Minimum median 20-day traded value (default INR 1 crore) is checked using the actual 20 most recent trading days ending on the evaluation date. Forward days are excluded.

**UE-015** — A data anomaly on an instrument's price series blocks that instrument from new buy eligibility until the anomaly is cleared or confirmed as valid.

**UE-016** — Broker instrument mapping validation must occur as part of eligibility. An instrument without a valid exchange code and broker token for the configured broker is ineligible.

**UE-017** — Eligibility rule thresholds are read from the strategy's EligibilityPolicy. They are not hardcoded. A strategy version change can alter thresholds for subsequent evaluations without affecting prior evaluations.

**UE-018** — The eligibility engine produces structured reason codes for every failed rule, enabling explainable exclusion decisions auditable by operators and strategy editors.

**UE-019** — An instrument that has passed eligibility but was subsequently suspended, placed under surveillance, or had its broker token revoked must have its eligibility status refreshed before the next planning run.

**UE-020** — Grade-A governance exclusion flags (confirmed fraud, insolvency, court-imposed trading restriction) are treated as hard-stop exclusions regardless of other eligibility rules passing.

---

## SC: Signal Calculation Rules

**SC-001** — All signal inputs use adjusted prices, point-in-time data, publication-date-based fundamentals, and a consistent exchange calendar. No future data is accessible in any signal calculation.

**SC-002** — Each of the seven momentum sub-components is independently z-scored within the eligible universe on the evaluation date using the cross-sectional mean and standard deviation.

**SC-003** — Z-score inputs are winsorized at ±3 standard deviations before z-scoring. Winsorization is applied consistently across the eligible universe to remove the effect of extreme outliers.

**SC-004** — A missing component value is treated as the component's neutral value (z-score of 0.0), not as a favorable value. The missing-data treatment is logged in the signal snapshot.

**SC-005** — The momentum score is the exact weighted sum of the seven z-scored components using the weights in the strategy's FactorPolicy. The formula is: MomentumScore = sum(weight_i × Z_i) for i in [1..7].

**SC-006** — Quality scoring must apply BFSI-specific metrics when `financialSectorFlag = true`. Using industrial debt metrics for banks, NBFCs, or insurers is a validation error.

**SC-007** — The composite score is the exact weighted sum: CompositeScore = momentumWeight × MomentumScore + qualityWeight × QualityScore + lowRiskWeight × LowRiskScore, using the FactorPolicy weights.

**SC-008** — The conviction multiplier applies the formula: ConvictionMultiplier = 0.80 + 0.40 × Percentile(CompositeScore), resulting in a value in [0.80, 1.20]. The formula and range are configurable per strategy.

**SC-009** — Inverse-volatility raw weights are calculated as: RawWeight_i = (1 / Volatility_i) × ConvictionMultiplier_i, where Volatility_i is the 60-day realized volatility of the instrument.

**SC-010** — Normalized scores and weights that produce NaN, Infinity, or negative-infinity at any intermediate step cause the affected instrument's signal to fail with a COMPUTATION_ERROR reason code. These do not silently propagate.

**SC-011** — Rank is assigned within the eligible universe only. Ineligible instruments have no rank. Rank 1 is the highest composite score. Ties in composite score are broken deterministically (descending instrumentId alphabetically, as a stable tiebreak).

**SC-012** — Signal outputs are immutable once produced for a given strategy version, data version, and as-of date. Recalculation with different inputs produces a new signal snapshot with a new DataVersionId.

**SC-013** — Optional sector-neutral ranking adjusts composite scores relative to sector median before cross-universe ranking. Sector-neutral mode must be explicitly configured; it is off by default.

**SC-014** — The low-risk score component is inverted: higher volatility, larger drawdown, greater downside deviation, higher beta, and higher liquidity risk produce a lower normalized score. This inversion is applied consistently before z-scoring.

**SC-015** — Every signal snapshot references the data version snapshot from which it was derived. The data version snapshot identifier is immutable once set on the signal snapshot.

---

## RM: Regime Logic Rules

**RM-001** — Market regime controls total equity exposure only. Regime logic must not select, rank, or weigh individual securities.

**RM-002** — RISK_ON regime requires: Nifty 50 above 200-DMA, Nifty 500 above 200-DMA, breadth above 50%, volatility below high-risk threshold. Target equity exposure: 90–100%.

**RM-003** — CAUTION regime triggers when indicators disagree (at least one but not all RISK_ON conditions met). Target equity exposure: 60–80%.

**RM-004** — RISK_OFF regime requires: both Nifty 50 and Nifty 500 below 200-DMA for the configured confirmation period, breadth below 35%, or portfolio-volatility trigger breached. Target equity exposure: 30–50%.

**RM-005** — CRISIS regime triggers immediately on data-independent hard criteria (benchmark drawdown beyond configured level, abnormal market closure, portfolio drawdown circuit breaker, stale/unreliable market data). No confirmation period applies. Target equity exposure: no new equity buys.

**RM-006** — Transition from a stronger regime to a weaker regime requires two consecutive closes meeting the weaker-regime conditions (configurable per preset; default 2). A single noisy observation may not trigger a regime downgrade.

**RM-007** — Transition from a weaker regime to a stronger regime requires five consecutive closes meeting the stronger-regime conditions (configurable per preset; default 5), or a weekly-close confirmation.

**RM-008** — When regime indicator data is unavailable or stale, the system defaults to CRISIS regime (fail closed). Reason code: REGIME_DATA_UNAVAILABLE.

**RM-009** — AI sentiment or advisory output alone must never trigger a regime change. Only verified structured indicators sourced from the configured data provider can alter regime state.

**RM-010** — Regime state is recorded per evaluation run with its data version snapshot. Historical regime states are immutable and auditable.

---

## CA: Corporate Action Processing Rules

**CA-001** — Value-preserving corporate actions (split, bonus, rights, ETF unit change) must conserve economic value within documented rounding tolerance (at most 1 minor-unit INR rounding per lot). Value conservation is verified before the action is marked PROCESSED.

**CA-002** — Historical prices must be adjusted retroactively for splits, bonuses, and rights issues before use in momentum calculations. Unadjusted historical price series must not be mixed with adjusted series.

**CA-003** — Quantity and average-price adjustments from corporate actions must preserve tax-lot lineage. Each original lot is adjusted in place; no new lot is created unless the action type requires it (e.g., bonus shares create new lots).

**CA-004** — A merger or demerger that changes the instrument symbol blocks rebalancing for the affected instrument until the operator confirms the new symbol mapping. Status: REQUIRES_MANUAL_REVIEW.

**CA-005** — An unresolved corporate-action mapping blocks all new buy orders and plan construction for the affected instrument. Existing positions are retained with a CORPORATE_ACTION_UNRESOLVED reason code visible in the rebalance plan.

**CA-006** — Corporate actions sourced from exchange filings take precedence over those sourced from data provider estimates. When sources conflict, the exchange filing is authoritative.

**CA-007** — Delisting notices set a deterministic HARD_RISK_FLAG on the affected instrument. Once confirmed as delisted, the instrument is permanently ineligible and must exit at the next valid execution opportunity.

**CA-008** — Cash dividends do not require a quantity adjustment. They are recorded as a cash event. Tax-lot acquisition prices are not adjusted for cash dividends.

**CA-009** — Buyback/tender offers require operator confirmation before any related order is generated. The system blocks automatic action on buyback events until the operator opts in or opts out.

**CA-010** — Every corporate action processing event is recorded in the audit ledger with the action type, effective date, pre-action and post-action quantities, prices, and the verifying actor.

**CA-011** — Broker holdings must be reconciled after the effective date of every processed corporate action. Planning is blocked for the affected instrument until reconciliation confirms the adjusted quantities.

**CA-012** — The system must distinguish between a price movement and a corporate-action adjustment in the historical series. Using unadjusted prices to compute returns through a split or bonus event is a validation error.

**CA-013** — When multiple corporate actions affect the same instrument on the same effective date, they are processed in exchange-specified order and their combined impact is validated.

**CA-014** — An ETF unit change (NAV reconstitution or structural change) is processed like a symbol-level adjustment. The affected ETF is blocked from new orders until the change is confirmed.

**CA-015** — Corporate action data must originate from exchange filings or a licensed structured provider. News articles, social media, or AI-classified news events must not create trade-impacting corporate action flags.

---

## BT: Backtesting Integrity Rules

**BT-001** — A production-quality backtest must use historical point-in-time index membership, not current membership. Using live membership produces a SURVIVORSHIP_BIAS_VIOLATION error.

**BT-002** — A production-quality backtest must use publication-date-based fundamentals. Using fundamentals published after the decision date produces a LOOK_AHEAD_VIOLATION error.

**BT-003** — The backtest must simulate T+1 execution: the decision is made at EOD of day T; execution is simulated in the next valid trading session on day T+1 within the execution window.

**BT-004** — Delisted and suspended instruments must be included in the backtest universe for the periods they were active. Excluding them retroactively produces a SURVIVORSHIP_BIAS_VIOLATION error.

**BT-005** — Backtest cost and slippage calculations must use the same configurable cost schedule as the live planner. The cost model is versioned with the strategy version.

**BT-006** — A backtest run must perform and record look-ahead and survivorship bias checks. A COMPLETED run must have `lookAheadViolations = 0` and `survivorshipViolations = 0`.

**BT-007** — A backtest with fewer than 5 calendar years of daily history is rejected as insufficient for production-quality evidence. Walk-forward evidence requires at least 3 rolling folds.

**BT-008** — The data completeness requirement for backtest inputs mirrors the live eligibility filter: at least 98% of required observations must be present. Missing data below this threshold rejects the period or the instrument for that period.

**BT-009** — Backtest results must not be extrapolated or presented as a guarantee of future returns. Every report output must include the `noReturnGuaranteeStatement` field.

**BT-010** — Identical backtestId, strategyVersionId, and dataVersionId always produce the same result. The result is deterministic and reproducible from the same seed data.

**BT-011** — A walk-forward backtest uses expanding or rolling windows. In-sample and out-of-sample periods must not overlap. Overlap produces a LOOK_AHEAD_VIOLATION error.

**BT-012** — Sensitivity analysis tests must vary one parameter at a time from the base strategy configuration. Results must be compared using the same point-in-time data version.

**BT-013** — Bootstrap or Monte Carlo tests must use controlled randomness with a logged seed for reproducibility. The seed is stored in the BacktestRun record.

**BT-014** — A backtest run must specify the exchange calendar version and timezone used. Inconsistency with the live calendar version must produce a warning in the evidence report.

**BT-015** — Regime logic in the backtest must use the same confirmation periods and indicator definitions as the live strategy. Using simplified regime proxies in backtests without documenting the deviation is a validation error.

---

## AI: AI Advisory Boundary Rules

**AI-001** — AI advisory operations are limited to six permitted functions: SUMMARIZE, CLASSIFY, EXTRACT, COMPARE, EXPLAIN, PRIORITIZE_REVIEW. Any operation outside this set is rejected at the port boundary before invocation.

**AI-002** — AI advisory output must not directly change any of the following: strategy version, strategy configuration, portfolio state, portfolio target, risk level, approval status, or order state. Attempt to apply AI output to these objects is rejected.

**AI-003** — AI advisory output must not determine order quantity, timing, price limit, or execution priority.

**AI-004** — AI advisory output may be incorporated into a human-readable explanation of an existing deterministic decision. The explanation clearly identifies which part is AI-generated advisory context.

**AI-005** — Every AI advisory interaction is recorded in the audit log with the requestId, permittedOperation, producedAt, model identifier (redacted for external exposure), and a summary hash of the output.

**AI-006** — An unverified AI-classified news allegation must not create a trade-impacting deterministic risk flag. Only verified exchange filings, company filings, or reliable structured sources can create HARD_RISK_FLAG or FUNDAMENTAL_HEALTH_EXCLUDE entries.

**AI-007** — AI advisory requests do not receive portfolio state, order details, broker credentials, account identifiers, or personally identifiable information as input.

**AI-008** — When the AI advisory service is unavailable, the non-critical advisory path degrades gracefully. The portfolio evaluation, signal calculation, regime determination, and planning pipeline continue without AI advisory output.

**AI-009** — AI advisory output alone cannot trigger or recommend a hard-risk exit. The decision to add or retain a HARD_RISK_FLAG is made deterministically from verified structured sources.

**AI-010** — AI advisory operations that attempt to invent return expectations, parameter changes, security selections, constraint bypasses, or order execution are rejected with a PROHIBITED_AI_OPERATION reason code and logged in the security audit trail.

---

## DF: Dependency Failure Handling Rules

**DF-001** — When a required data provider is unavailable and the missing data is needed for production planning, the evaluation run fails closed with a stable reason code (PROVIDER_UNAVAILABLE) and does not attempt to use stale data as a substitute.

**DF-002** — A stale data condition (data age exceeds staleAfterInstant) blocks production planning with a STALE_DATA reason code. Stale data may be used in research mode with an explicit label.

**DF-003** — Clock or timezone mismatch between application and exchange calendar source produces DATA_CLOCK_MISMATCH and blocks all order generation.

**DF-004** — All provider errors are logged with timestamp, correlation ID, provider identity, error type, and any retried attempt count. No provider-specific error message or internal detail is propagated to the external API response.

**DF-005** — Provider credentials, access tokens, and account details must be redacted from all log output, error messages, and audit events before any external or cross-component exposure.

**DF-006** — Retry behavior for transient provider failures uses a maximum retry count (default 3), exponential backoff with configurable jitter, and a per-call deadline. Exhausted retries produce a terminal provider-error event with the attempt count.

**DF-007** — A circuit breaker protects each external data provider. After a configurable number of consecutive failures (default 5), the circuit opens and subsequent calls fail immediately without network attempt. The circuit moves to half-open after a configurable cooldown period.

**DF-008** — Failure of a non-critical dependency (news provider, AI advisory service, optional sentiment feed) degrades the advisory output without blocking the deterministic evaluation pipeline. A DEGRADED_ADVISORY_CONTEXT warning is produced.

**DF-009** — When a non-critical provider is degraded, the result of that evaluation run is labelled as carrying DEGRADED_ADVISORY_CONTEXT. This label persists in the signal snapshot and research report.

**DF-010** — A provider health status record is maintained per provider and updated after every attempt. Provider health feeds into the portfolio health report defined in U06 without direct coupling to the evaluation pipeline.
