# Portfolio Rebalance Strategy Presets

## Purpose

These presets define distinct short-, medium-, and long-horizon portfolio strategies. They are positional investment strategies, not intraday trading strategies. All parameters are versioned, schema-validated, backtested, and independently assignable to portfolios.

## Common Non-Intraday Rules

1. Signals and rankings use finalized end-of-day data only.
2. Routine plans are generated after market close and may execute only in the next eligible session, normally between 09:45 and 11:30 Asia/Kolkata.
3. All equity orders use delivery/CNC. Short selling, leverage, margin-funded positions, and intentional same-day round trips are prohibited.
4. Daily checks may trigger a risk review, but they do not continuously optimize or trade the portfolio.
5. Routine constituent changes occur only on the preset schedule. Interim changes require a hard-risk exit, loss of mandatory eligibility, a verified corporate action, or a confirmed regime-driven exposure reduction.
6. Preferred holding periods suppress unnecessary churn but never block a hard-risk exit.
7. New cash, dividends, and sale proceeds are used to reduce drift before selling otherwise healthy holdings.
8. A replacement must clear the configured score-improvement hurdle after estimated costs and taxes.
9. Turnover limits apply per portfolio and cannot be bypassed by splitting one rebalance across multiple runs.
10. Presets are available initially for PAPER and OBSERVE modes. Live activation requires approved out-of-sample evidence and explicit authorization.

## Preset Summary

| Parameter | Short Horizon | Medium Horizon | Long Horizon |
|---|---|---|---|
| Strategy ID | `short-horizon-momentum-quality` | `adaptive-momentum-quality` | `long-horizon-quality-compounders` |
| Initial version | `1.0.0` | `1.0.0` | `1.0.0` |
| Intended holding horizon | 1-3 months | 3-12 months | 1-5 years |
| Primary objective | Capture persistent positional momentum with quality and liquidity controls | Balance medium-term momentum, quality, and risk | Compound through durable quality with low churn and risk control |
| Momentum weight | 65% | 55% | 20% |
| Quality weight | 20% | 30% | 55% |
| Low-risk weight | 15% | 15% | 25% |
| Target holdings | 20 | 25 | 30 |
| Maximum holdings | 25 | 30 | 35 |
| Routine constituent rebalance | Every 2 weeks | Monthly | Quarterly |
| Drift review | Weekly | Monthly | Monthly |
| Preferred minimum hold | 20 trading days | 60 trading days | 252 trading days |
| No-trade band | Greater of 0.75 percentage points or 20% of target weight | Greater of 0.50 percentage points or 20% of target weight | Greater of 1.00 percentage points or 25% of target weight |
| Replacement score gap | 15 percentile points | 10 percentile points | 20 percentile points |
| Maximum daily turnover | 10% | 10% | 5% |
| Period turnover budget | 40% per rolling 30 days | 25% per calendar month | 15% per quarter and 30% per year |
| Cash buffer | 3% | 2% | 3% |

## Short-Horizon Preset

The short-horizon preset is a positional momentum strategy, not a day-trading strategy.

- It emphasizes 3-1 month, 6-1 month, relative-strength, trend, earnings-momentum, liquidity, and volatility inputs.
- A new constituent must pass the stricter entry rank and 15-percentile replacement hurdle.
- Routine constituent review occurs every second week using the latest completed session's data.
- Weight-only corrections occur at most weekly and only outside the no-trade band.
- A 20-trading-day preferred hold discourages churn; confirmed hard-risk and mandatory-eligibility exits remain immediate at the next valid delivery execution window.

## Medium-Horizon Preset

The medium-horizon preset is the supplied `adaptive-momentum-quality@1.0.0` strategy and remains the default for `Paper Portfolio`.

- It uses the supplied 55% momentum, 30% quality, and 15% low-risk factor mix.
- It evaluates health, risk, regime, and ranks after each trading day.
- Routine constituent changes occur monthly with the supplied rank buffers, cost-aware replacement hurdle, and 25% monthly turnover cap.
- A 60-trading-day preferred hold formalizes the existing turnover-minimization intent without preventing risk exits.

## Long-Horizon Preset

The long-horizon preset favors durable quality, balance-sheet strength, profitability, earnings stability, and lower risk while retaining a modest trend filter.

- Routine constituent changes occur quarterly.
- Monthly drift reviews normally use contributions and dividends before sales.
- A 252-trading-day preferred hold, wider no-trade band, and 20-percentile replacement hurdle limit tax and transaction-cost drag.
- Long holding intent never permits a failed mandatory eligibility rule or hard-risk condition to remain unaddressed.

## Configuration and Validation

1. The strategy schema shall represent intended horizon, EOD-only decision timing, routine frequency, drift-review frequency, preferred minimum holding days, and daily, monthly, quarterly, and annual turnover limits.
2. Factor weights must total 100%, sleeve weights must total 100%, and construction constraints must remain feasible.
3. A preset parameter change creates a new immutable version and requires backtest, walk-forward, turnover, cost, tax, drawdown, and shadow-operation evidence.
4. Performance comparisons shall use horizon-appropriate rolling periods and shall not claim that any preset guarantees returns.
