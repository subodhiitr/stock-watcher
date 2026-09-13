# Trade review: September 9–10, 2026

Checked about 08:15 IST on September 10, before market open. Simulation is off. Today has no closed trades or snapshots; no performance conclusion is possible. No settings changed.

## September 9

| Stock | Side / setup | Exposure | Net P&L | Exit | Holding time |
|---|---|---:|---:|---|---:|
| TATAELXSI | sell / BREAKDOWN | ₹99267.00 | ₹-607.36 | Simulation confirmed stop | 48.1 min |
| KANSAINER | sell / BREAKDOWN | ₹49851.12 | ₹295.64 | Simulation 0.7% gain milestone | 32.9 min |
| GODREJPROP | sell / BREAKDOWN | ₹99555.20 | ₹614.47 | Simulation 0.7% gain milestone | 14.2 min |

Three closed trades, two winners (66.7%), gross profit ₹520.53, charges ₹217.78, net profit ₹302.75. Profit factor 1.50. Charges consumed 41.8% of gross profit. Better than September 8 (-₹1,132.10) and September 7 (-₹1,903.60), but the setup mix changed and the sample is too small for causal conclusions.

## Improvements and decisions

1. Keep SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH=true, SIMULATION_RANGEBOUND_MAX_DEPTH_AGE_SEC=15 and SIMULATION_RANGEBOUND_MAX_SPREAD_PCT=0.15. Zero Rangebound trades despite 2,041 repeated appearances across 261 symbols is a reason to collect decision-time rejection reasons, not to loosen protection. The evidence has no blocked-reason counts, so freshness, spread, imbalance, timing and capacity cannot be separated.
2. Retain 0.7% milestone behavior. KANSAINER protected ₹992.64 versus its stored close, whereas GODREJPROP left ₹431.95 at that later benchmark. Evidence for wider targets is mixed.
3. Inspect TATAELXSI stop path but retain SIMULATION_STOP_CONFIRM_BARS=2. It shorted at 3423, exited at 3441.10, then had a stored close of 3383. The ₹1,684.90 hindsight difference does not establish that holding was tolerable or executable. Examine first breach, confirmation, quote freshness and adverse excursion.
4. Keep SIMULATION_SHORT_MIN_SCORE=75. Yesterday's winners had higher scores than its loser, but September 7 CHENNPETRO (82.7) and GODREJCP (82.6) lost. Seven Breakdown trades across only two dates total -₹741.37: not enough to tune the score.
5. Optional concentration reduction carried forward: SIMULATION_RANGEBOUND_MAX_POSITION_EXPOSURE 200000 → 100000. Current/default 200000, source default, not overridden. Description: maximum rupee exposure for one Rangebound position without increasing shared caps. Confidence low; not implemented.

## Seven-session review

Dates: 2026-09-09, 2026-09-08, 2026-09-07, 2026-09-04, 2026-09-03, 2026-08-31, 2026-08-28. Separate evidence refreshed for each; no shortfall. September 10 is recorded separately as empty; its review uses the seven most recent available transaction dates no later than the selected date. No future dates used for September 9.

42 trades net -₹5,268.60. Rangebound: 28 trades net -₹4,367.63. Positions above ₹1 lakh: 21 trades net -₹4,366.24; seven at or below ₹1 lakh: -₹1.39. Five dates support reducing concentration, August 31 contradicts, September 9 has no relevant trades. Winners affected include KDGREEN, APLAPOLLO, LODHA, ANANDRATHI and QUESS. Groups differ in selection, dates and costs; these numbers are not predicted savings. No new Rangebound transaction sample supports an upgrade in confidence.

All proposals are analytics-reviewed with low confidence, not validated. No replay, backtest, sweep or targeted threshold trial. Snapshot rows are not independent trades. No new setup is justified by appearance counts alone.

## Limitations

Closing benchmarks are simulation-closing-snapshot values, not independently verified exchange closes, and may inherit stale-data problems. Current configuration does not prove historical entry settings; fingerprints differ across sessions. Reconciled closed positions are not account-level or unrealized returns. Review September 10 again only after trades exist. The already-running proxy was left running.
