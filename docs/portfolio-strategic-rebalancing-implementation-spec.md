# Strategic Rebalancing Implementation Specification

Status: Proposed  
Target system: `stock-watcher-g1` Portfolio Strategy/Rebalance  
Research basis: Rattray, Granger, Harvey, and Van Hemert, "Strategic Rebalancing," December 19, 2019, SSRN 3330134  
Safety boundary: PAPER and OBSERVE only until separately validated and authorized

## 1. Purpose

Implement a trend-aware rebalance timing policy based on the paper's central result: mechanically buying an underperforming risk asset back to its target can increase drawdowns when relative returns are trending. The system must separate:

1. target selection and target sizing;
2. the decision whether a routine rebalance should proceed now; and
3. mandatory risk exits, which must never be delayed by the trend policy.

The feature does not replace the existing six-factor stock-selection model. It controls the timing and fraction of otherwise valid rebalance trades.

## 2. Paper Findings Implemented

The specification implements the following findings from the paper:

- Fixed-weight rebalancing has negative convexity because it sells relative winners and buys relative losers. It underperforms buy-and-hold when relative performance continues in the same direction (Equation 5, page 5).
- Monthly half- and quarter-rebalancing reduce turnover and generally improve severe drawdowns relative to full monthly rebalancing (Table 2, pages 13-14).
- The strongest tested strategic rule delays rebalancing when the stock-minus-bond return trend is negative (Table 3, pages 14-15).
- When a rebalance is permitted, the paper's strategic tests move halfway toward target rather than fully to target (Table 3).
- The 12-month negative relative-trend rule produced the largest average drawdown improvement in the paper's sample, while 1- and 3-month variants reacted more frequently (Table 3 and Figure 7).
- Delaying for positive trends did not improve drawdowns and is not part of the recommended implementation (page 16).
- The paper uses full-sample average relative returns of 0.8%, 2.3%, and 9.1% for 1-, 3-, and 12-month horizons. These constants are US-sample results and must not be copied into an Indian portfolio without point-in-time validation (footnote 26, page 15).

## 3. Required Adaptation

The paper studies a two-asset stock-bond portfolio. The current application constructs an individual-equity portfolio with cash. The implementation therefore applies the paper at the portfolio risk-exposure layer:

- `risk benchmark`: the assigned strategy benchmark, such as NIFTY 500 Total Return;
- `defensive benchmark`: a configured INR government-bond total-return index;
- `relative return`: risk benchmark total return minus defensive benchmark total return;
- `risk-increasing trade`: a buy or quantity increase in an equity holding;
- `risk-reducing trade`: a sell, partial exit, mandatory exit, or reduction required by position-risk rules;
- `delayed rebalance`: suppression of routine risk-increasing trades while retaining proceeds as cash.

This asymmetry is deliberate. During a negative risk-minus-defensive trend, the paper's harmful mechanical action is buying the falling risk asset back toward target. The application must still permit risk-reducing actions.

### Paper fidelity versus system extensions

| Rule | Source |
| --- | --- |
| Negative stock-minus-bond trend delays rebalancing | Directly from the paper |
| Halfway movement toward target when permitted | Directly from Table 3 |
| 1-, 3-, and 12-month signal variants | Directly from the paper |
| 12-month primary signal | Recommended from the paper's strongest average drawdown result |
| Rolling point-in-time baseline | Engineering correction to avoid full-sample look-ahead |
| 3-month confirmation | Application risk-control extension; must be tested separately |
| Mandatory-exit override | Existing application safety requirement |
| Maximum delay and forced review | Application governance extension |
| Equity-buy suppression with cash retention | Adaptation from a stock-bond portfolio to the current equity-and-cash portfolio |

## 4. Functional Requirements

### SRB-001 - Feature mode

Add a versioned strategy policy:

```ts
type StrategicRebalancePolicy = Readonly<{
  enabled: boolean
  mode: 'OBSERVE' | 'PAPER'
  riskBenchmark: string
  defensiveBenchmark: string
  primaryHorizonMonths: 1 | 3 | 12
  confirmationHorizonMonths?: 1 | 3 | 12
  baselineLookbackMonths: number
  minimumBaselineObservations: number
  permittedRebalanceFraction: number
  negativeTrendBuyFraction: number
  maximumDelayCalendarDays: number
  staleAfterHours: number
}>
```

Initial recommended preset:

```json
{
  "enabled": true,
  "mode": "PAPER",
  "riskBenchmark": "NIFTY500TR",
  "defensiveBenchmark": "CONFIGURED_INR_GSEC_TOTAL_RETURN_INDEX",
  "primaryHorizonMonths": 12,
  "confirmationHorizonMonths": 3,
  "baselineLookbackMonths": 120,
  "minimumBaselineObservations": 60,
  "permittedRebalanceFraction": 0.5,
  "negativeTrendBuyFraction": 0,
  "maximumDelayCalendarDays": 93,
  "staleAfterHours": 36
}
```

The defensive benchmark must be explicitly configured to a supported market-data identifier before the policy can generate an approval-ready plan. The placeholder value is invalid at runtime.

### SRB-002 - Point-in-time signal

For horizon `N`, calculate using adjusted total-return levels available at the decision cutoff:

```text
riskReturn(N)      = riskLevel(t) / riskLevel(t-N) - 1
defensiveReturn(N) = defensiveLevel(t) / defensiveLevel(t-N) - 1
relativeReturn(N)  = riskReturn(N) - defensiveReturn(N)
baseline(N)        = mean of historical N-month relative returns whose end dates are < t
relativeExcess(N)  = relativeReturn(N) - baseline(N)
```

Classification:

```text
NEGATIVE when relativeExcess(primary) < 0
POSITIVE when relativeExcess(primary) >= 0
```

If a confirmation horizon is configured, classify as `NEGATIVE_CONFIRMED` only when both primary and confirmation signals are negative. If only the primary signal is negative, classify as `NEGATIVE_UNCONFIRMED` and run in observe-only mode for that plan.

The baseline must be rolling or expanding using only observations available at `t`. No full-sample mean, revised future data, or look-ahead constituent information is allowed.

### SRB-003 - Data completeness gate

An approval-ready signal requires:

- both benchmark series use total-return or consistently adjusted levels;
- both series are denominated in INR;
- both latest observations belong to the same completed market session;
- no observation used was published after the decision cutoff;
- enough history exists for the primary horizon and baseline;
- latest data age is within `staleAfterHours`;
- source, retrieval time, observation dates, adjustment policy, and content hash are recorded.

Failure produces `STRATEGIC_REBALANCE_DATA_BLOCKED`. The plan may show ordinary target research but cannot apply trend-based trade suppression or claim paper-based protection.

### SRB-004 - Trade classification

Classify every pre-policy draft action before turnover and cash allocation:

| Classification | Condition |
| --- | --- |
| `MANDATORY_EXIT` | Existing exit-risk assessment has `mandatoryExit=true` |
| `RISK_REDUCING` | Target quantity is below current quantity |
| `RISK_INCREASING` | Target quantity is above current quantity |
| `NO_CHANGE` | Target quantity equals current quantity |

The classification must use the current aggregated holding quantity. It must not create duplicate holding rows or treat lots as separate positions.

### SRB-005 - Timing and sizing policy

Apply the policy to the unconstrained strategic target delta:

```text
idealDelta = strategicTargetQuantity - currentQuantity

if mandatory exit:
    policyDelta = idealDelta
else if idealDelta < 0:
    policyDelta = roundTowardZero(idealDelta * permittedRebalanceFraction)
else if signal is NEGATIVE_CONFIRMED:
    policyDelta = roundTowardZero(idealDelta * negativeTrendBuyFraction)
else:
    policyDelta = roundTowardZero(idealDelta * permittedRebalanceFraction)
```

With the recommended policy:

- mandatory exits execute the full risk-required quantity;
- routine reductions move halfway toward target;
- normal buys move halfway toward target;
- confirmed-negative-trend buys are delayed completely;
- sale proceeds remain cash and are not redirected into other risk-increasing equity buys.

Whole-share rounding must be deterministic. A non-zero fractional result below one share becomes zero unless a mandatory exit requires the complete current quantity.

### SRB-006 - Maximum delay

Trend delay must not silently continue forever. Record `delayStartedOn` when the first confirmed-negative plan suppresses a risk-increasing delta.

- Before `maximumDelayCalendarDays`, continue suppression while the signal remains confirmed negative.
- On or after the limit, create a `FORCED_REVIEW` plan.
- `FORCED_REVIEW` is not auto-approved. It requires a fresh plan and explicit PAPER approval.
- Mandatory exits remain unaffected throughout the delay.

The forced review must show current drift, delayed notional, cash accumulated, signal history, and estimated implementation cost.

### SRB-007 - Existing constraints remain authoritative

After strategic timing is applied, retain all current constraints:

1. mandatory exit and position-risk policy;
2. minimum holding-period protection where no mandatory exit exists;
3. no-trade band;
4. maximum stock weight;
5. cash buffer;
6. daily and rolling turnover limits;
7. charges and tax estimates;
8. whole-share affordability;
9. stale portfolio and strategy version checks.

Strategic timing may reduce a trade but may never enlarge it beyond the pre-policy target.

### SRB-008 - Cash-flow-aware rebalancing

New deposits, dividends, and sale proceeds should first fund permitted underweights without causing avoidable sales. During a confirmed negative trend:

- do not deploy flows into suppressed equity buys;
- preserve required cash buffer plus delayed cash;
- allow withdrawals only through existing cash and then the normal risk-aware sell sequence;
- report cash retained because of the trend gate separately from the configured strategic cash buffer.

### SRB-009 - Immutable plan evidence

Every generated plan must include the complete signal snapshot in its canonical payload and plan hash:

```ts
type StrategicRebalanceSnapshot = Readonly<{
  policyVersion: 'STRATEGIC_REBALANCE_V1'
  state: 'NORMAL' | 'NEGATIVE_UNCONFIRMED' | 'NEGATIVE_CONFIRMED' | 'DATA_BLOCKED' | 'FORCED_REVIEW'
  decisionSessionDate: string
  riskBenchmark: BenchmarkObservation
  defensiveBenchmark: BenchmarkObservation
  horizons: readonly Readonly<{
    months: 1 | 3 | 12
    riskReturn: number
    defensiveReturn: number
    relativeReturn: number
    pointInTimeBaseline: number
    relativeExcess: number
    negative: boolean
  }>[]
  delayStartedOn: string | null
  delayedBuyMinorUnits: string
  retainedCashMinorUnits: string
  dataHash: string
  calculatedAt: string
}>
```

Changing any observation, baseline, classification, policy setting, holding, price, or strategy version must produce a different plan hash. Existing immutable plan and append-only event behavior remains unchanged.

### SRB-010 - Approval safety

- The feature must remain PAPER-only in its first release.
- Approval must never send a live broker order.
- Approval must reject a stale portfolio state version, stale signal, changed strategy hash, changed market-data hash, superseded plan, or expired execution date.
- A quote-only fallback plan cannot apply strategic timing because it lacks point-in-time benchmark history.
- An `OBSERVE` plan displays counterfactual actions but cannot update holdings.

## 5. Decision Pipeline

The implementation order must be:

1. load immutable strategy and portfolio snapshot;
2. fetch point-in-time constituent research and benchmark histories;
3. rank candidates and construct strategic target holdings;
4. calculate existing position exit-risk assessments;
5. calculate the strategic relative-trend signal;
6. classify pre-policy action direction;
7. apply mandatory-exit override and strategic timing fraction;
8. apply minimum-hold and no-trade-band rules;
9. apply turnover, cash, whole-share, cost, and tax constraints;
10. persist an immutable plan with complete lineage;
11. require explicit PAPER approval;
12. atomically update aggregated holdings and lots without duplicates.

## 6. Domain Services

Add focused services rather than embedding signal logic in the API controller:

```text
server/portfolio/domain/rebalancing/strategic-rebalance-policy.ts
server/portfolio/application/rebalancing/relative-trend-signal.ts
server/portfolio/application/rebalancing/strategic-trade-timing.ts
server/portfolio/application/rebalancing/strategic-rebalance-snapshot.ts
```

Responsibilities:

- `relative-trend-signal.ts`: point-in-time returns, rolling baseline, classification, completeness failures;
- `strategic-trade-timing.ts`: mandatory-exit override, directional trade fraction, whole-share rounding;
- `strategic-rebalance-snapshot.ts`: immutable evidence, hashes, delayed cash and notional;
- `strategic-rebalance-policy.ts`: validated policy and invariants.

Integrate orchestration into `generateResearchRebalance` in `server/portfolio/application/api/portfolio-api-service.ts`. Do not duplicate candidate ranking or position exit-risk logic.

## 7. Market Data Contract

Extend the market-analysis provider request to include:

```ts
type StrategicBenchmarkHistoryRequest = Readonly<{
  symbols: readonly [riskBenchmark: string, defensiveBenchmark: string]
  adjusted: true
  frequency: 'DAILY'
  throughSession: string
  minimumStartDate: string
}>
```

The provider response must include session date, adjusted level, publication timestamp if available, source identifier, adjustment method, and retrieval timestamp for every point.

Yahoo data may support PAPER research, but absence of a reliable defensive total-return series must fail closed. Do not substitute an unadjusted yield, bond price, ETF, or cash rate without an explicitly versioned policy change and separate validation.

## 8. Strategy Configuration Changes

Extend `RebalancePolicy` or add a sibling `strategicRebalance` policy in `server/portfolio/domain/strategy/strategy-config.ts`. A sibling policy is preferred because the signal has its own data, lineage, and failure modes.

Validation invariants:

- fractions are in `[0, 1]`;
- `negativeTrendBuyFraction <= permittedRebalanceFraction`;
- primary and confirmation horizons differ;
- baseline lookback exceeds the primary horizon;
- minimum baseline observations is positive and feasible;
- maximum delay is positive;
- mode cannot be `LIVE` in V1;
- benchmark identifiers are non-empty and distinct.

Existing strategy versions remain valid with `enabled=false` as the backward-compatible default. Enabling the policy requires a new semantic strategy version and config hash.

## 9. Persistence

The immutable plan JSON already stores the signal snapshot. Add a separate append-only observation table for audit and performance attribution in proposed migration `008-strategic-rebalance-regime.ts`:

```sql
CREATE TABLE portfolio_strategic_rebalance_observations (
  observation_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES portfolio_rebalance_plans(plan_id),
  policy_version TEXT NOT NULL,
  decision_session_date TEXT NOT NULL,
  state TEXT NOT NULL,
  risk_benchmark TEXT NOT NULL,
  defensive_benchmark TEXT NOT NULL,
  signal_json TEXT NOT NULL,
  data_hash TEXT NOT NULL,
  delayed_buy_minor_units TEXT NOT NULL,
  retained_cash_minor_units TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
```

Apply no-update and no-delete triggers consistent with existing plan tables. Use deterministic latest-row ordering when timestamps tie.

## 10. API and UI Contract

### API response additions

Add to the rebalance plan:

```json
{
  "strategicRebalance": {
    "policyVersion": "STRATEGIC_REBALANCE_V1",
    "state": "NEGATIVE_CONFIRMED",
    "headline": "Routine equity buys delayed by negative 12-month relative trend",
    "permittedRebalanceFraction": 0.5,
    "appliedBuyFraction": 0,
    "delayedBuyMinorUnits": "12500000",
    "retainedCashMinorUnits": "12500000",
    "signal": {}
  }
}
```

Each action adds:

```text
preTimingTargetQuantity
strategicTimingClassification
strategicTimingFraction
delayedQuantity
delayedNotionalMinorUnits
strategicTimingReasonCode
```

Reason codes:

```text
STRATEGIC_NEGATIVE_TREND_DELAY
STRATEGIC_NEGATIVE_TREND_UNCONFIRMED
STRATEGIC_HALF_REBALANCE
STRATEGIC_MANDATORY_EXIT_OVERRIDE
STRATEGIC_DATA_BLOCKED
STRATEGIC_MAX_DELAY_FORCED_REVIEW
```

### UI requirements

The Rebalance tab must show:

- signal state and decision date;
- risk and defensive benchmark identifiers;
- 1-, 3-, and 12-month relative returns, point-in-time baselines, and excess values;
- whether the signal is confirmed;
- normal and applied rebalance fractions;
- delayed buy quantity and notional by holding;
- retained cash caused by the policy;
- delay start and forced-review date;
- explicit statement that mandatory exits are not delayed;
- data source, freshness, and PAPER-only boundary.

Use `Delayed` as an action presentation state while retaining the underlying intended `BUY` delta for audit. The approval button must remain disabled for `DATA_BLOCKED`, `NEGATIVE_UNCONFIRMED` in V1, stale data, or `OBSERVE` mode.

## 11. Performance Attribution

Extend Performance observations with counterfactual fields:

```text
baselineFullRebalanceNav
baselineHalfRebalanceNav
strategicRebalanceNav
strategicTimingReturnImpact
strategicTimingDrawdownImpact
delayedBuyOpportunityCost
retainedCashReturnImpact
turnoverSavedMinorUnits
chargesSavedMinorUnits
taxDeferredMinorUnits
```

Attribution must distinguish:

- stock-selection return;
- ordinary sizing/drift return;
- strategic timing return;
- cash drag or protection;
- transaction charges;
- realized and estimated tax.

No benefit should be claimed until enough live PAPER observations exist. Historical results must be labeled backtested; forward observations must be labeled PAPER-observed.

## 12. Backtest and Validation Protocol

Before enabling PAPER approval, run a point-in-time Indian-market study comparing:

1. existing full rebalance baseline;
2. monthly half rebalance;
3. existing no-trade-band policy;
4. delay on negative 1-month relative trend;
5. delay on negative 3-month relative trend;
6. delay on negative 12-month relative trend;
7. recommended 12-month primary plus 3-month confirmation;
8. risk-benchmark-only trend as a fallback research comparison.

All variants must use identical candidate snapshots, prices, corporate-action adjustments, taxes, charges, slippage, execution lag, whole-share rules, and cash flows. Report:

- CAGR and net CAGR after charges and taxes;
- annualized volatility and downside deviation;
- maximum drawdown and time under water;
- average improvement at the five worst baseline drawdown troughs;
- expected shortfall/CVaR;
- turnover and implementation shortfall;
- average and maximum equity underweight;
- retained cash and cash drag;
- tracking error versus the ordinary rebalance;
- number and duration of delayed episodes;
- delayed-buy opportunity cost after false negative signals.

Use walk-forward baseline estimation. Do not calibrate thresholds on the complete test period. Include subperiod and crisis analysis, and report confidence intervals where feasible.

### Initial go/no-go criteria

The PAPER rollout may proceed only if:

- no invariant or safety test fails;
- net maximum drawdown is not worse than the ordinary policy in the full sample and most major stress periods;
- average five-worst-drawdown improvement is positive after costs;
- net CAGR degradation is within an explicitly approved tolerance;
- turnover and charge savings are non-negative;
- no result depends on look-ahead data;
- sensitivity is stable across reasonable horizons and baseline windows.

These are engineering release gates, not a guarantee of future investment performance.

## 13. Test Requirements

### Unit tests

- relative return and rolling baseline calculations;
- exact decision-cutoff and no-look-ahead behavior;
- positive, negative, unconfirmed, blocked, and forced-review states;
- half-rebalance deterministic whole-share rounding;
- confirmed-negative buy suppression;
- full mandatory-exit override;
- missing and stale benchmark data failures;
- maximum-delay calculation;
- config validation and immutable hashes.

### Property tests

- strategic timing never increases absolute trade size;
- confirmed-negative state never produces a routine risk-increasing delta when buy fraction is zero;
- mandatory exits are never reduced or delayed;
- target movement is monotonic toward the pre-policy target;
- resulting cash is never negative;
- holdings remain unique by instrument after approval;
- repeated approval is idempotent;
- any signal input change changes the plan hash.

### Integration tests

- market-history provider through plan generation;
- immutable plan and append-only observation persistence;
- stale plan rejection after holdings, strategy, or signal changes;
- PAPER approval updates holdings atomically;
- OBSERVE mode never mutates holdings;
- quote-only fallback cannot claim strategic timing;
- UI exposes delayed quantities and mandatory-exit exceptions.

### Regression tests

- existing strategies with the policy disabled produce equivalent plans;
- candidate ranking, valuation, exit-risk flags, cost/tax estimates, and performance observations remain unchanged unless strategic timing is enabled;
- no duplicate holdings or lots are created.

## 14. Rollout Plan

1. Implement signal calculation and persistence behind `enabled=false`.
2. Run historical point-in-time backtests and publish a validation report.
3. Enable `OBSERVE` for selected PAPER portfolios and collect counterfactual plans.
4. Compare ordinary and strategic plans for at least three routine rebalance cycles and one negative-signal episode where practicable.
5. Enable explicit PAPER approval for a new immutable strategy version.
6. Keep LIVE mode prohibited until a separate authorization, broker-reconciliation, and production-data review is completed.

## 15. File Change Map

| Area | Expected change |
| --- | --- |
| `server/portfolio/domain/strategy/strategy-config.ts` | Add and validate the immutable strategic-rebalance policy |
| `server/portfolio/domain/strategy/strategy-presets.ts` | Add new semantic preset versions; leave existing versions unchanged |
| `server/portfolio/domain/rebalancing/strategic-rebalance-policy.ts` | Add policy invariants and domain types |
| `server/portfolio/application/rebalancing/relative-trend-signal.ts` | Implement point-in-time signal and completeness checks |
| `server/portfolio/application/rebalancing/strategic-trade-timing.ts` | Apply directional fractions and mandatory-exit override |
| `server/portfolio/application/api/research-candidate-selection.ts` | No scoring change; expose existing target output to timing stage |
| `server/portfolio/application/api/portfolio-api-service.ts` | Orchestrate history fetch, signal, timing, plan evidence, and approval gates |
| `ticker_proxy.js` | Provide adjusted benchmark histories with provenance for PAPER research |
| `server/portfolio/infrastructure/persistence/migrations/008-strategic-rebalance-regime.ts` | Add append-only signal observation storage |
| `server/portfolio/adapters/api/sqlite-api-store.ts` | Persist and read strategic signal observations atomically |
| `my-remix-app/app/portfolio/types/views.ts` | Add strategic plan and action fields |
| `my-remix-app/app/portfolio/components/strategy-rebalance.tsx` | Display signal, delayed trades, retained cash, and blockers |
| `server/portfolio/application/api/performance-observation.ts` | Add strategic-versus-counterfactual attribution |
| `tests/portfolio/rebalancing/` | Add unit, property, lineage, and allocator tests |
| `tests/portfolio/api/` | Add API, approval, stale-state, uniqueness, and UI-contract tests |

## 16. Non-Goals

- Direct allocation to futures or a managed-futures trend product.
- Leverage, short selling, or derivatives execution.
- Copying the paper's US 0.8%, 2.3%, and 9.1% baselines into Indian production.
- Delaying mandatory exits or severe adverse-event reductions.
- Replacing stock ranking, sector-relative valuation, or constituent discovery.
- Claiming the paper's historical drawdown improvement will transfer unchanged to this portfolio.

## 17. Acceptance Summary

The implementation is complete when a versioned strategy can generate an immutable, point-in-time, PAPER-only rebalance plan that:

- calculates an auditable risk-minus-defensive trend state;
- moves halfway toward target under normal conditions;
- delays routine equity buys during a confirmed negative relative trend;
- continues mandatory and risk-reducing exits;
- records delayed quantities, retained cash, lineage, and counterfactual performance;
- remains subject to all existing risk, tax, turnover, freshness, authorization, and duplicate-holding safeguards.
