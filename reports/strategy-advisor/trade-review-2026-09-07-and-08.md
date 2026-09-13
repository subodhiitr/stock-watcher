# Simulation trade review — 7–8 September 2026

Closed, reconciled positions. Analytics-reviewed; not replay-tested or validated. No settings changed.

| Date | Trades | Winners | Gross P&L | Charges | Net P&L |
|---|---:|---:|---:|---:|---:|
| 2026-09-07 | 9 | 4 | ₹-1204.33 | ₹699.27 | ₹-1903.60 |
| 2026-09-08 | 4 | 1 | ₹-660.15 | ₹471.95 | ₹-1132.10 |

Combined net loss: ₹3,035.70 on 13 trades, including ₹1,171.22 charges. Five trades profitable.

## Individual trades

| Date | Stock | Setup | Side | Net P&L | Exit |
|---|---|---|---|---:|---|
| 2026-09-07 | CPPLUS | RANGEBOUND | buy | ₹710.93 | Simulation target |
| 2026-09-07 | GPIL | RANGEBOUND | buy | ₹-513.08 | Simulation confirmed stop |
| 2026-09-07 | OLECTRA | BREAKDOWN | sell | ₹296.76 | Simulation 0.7% gain milestone |
| 2026-09-07 | VOEPL | RANGEBOUND | buy | ₹-425.58 | Simulation signal deterioration |
| 2026-09-07 | ANGELONE | RANGEBOUND | buy | ₹438.33 | Simulation target |
| 2026-09-07 | CPL | RANGEBOUND | buy | ₹-1070.08 | Simulation signal deterioration |
| 2026-09-07 | GODREJCP | BREAKDOWN | sell | ₹-295.18 | Simulation time stop cost guard |
| 2026-09-07 | CHENNPETRO | BREAKDOWN | sell | ₹-1076.60 | Simulation zero-progress exit |
| 2026-09-07 | SBIN | BREAKDOWN | sell | ₹30.90 | Simulation signal deterioration |
| 2026-09-08 | AMAL | RANGEBOUND | sell | ₹-1641.78 | Simulation confirmed stop |
| 2026-09-08 | RAMBHAJO | RANGEBOUND | buy | ₹-1354.40 | Simulation confirmed stop |
| 2026-09-08 | TECHNOCRAF | RANGEBOUND | buy | ₹-17.58 | Simulation signal deterioration |
| 2026-09-08 | KDGREEN | RANGEBOUND | sell | ₹1881.66 | Simulation 1% gain milestone |

## Main findings

Today: AMAL and RAMBHAJO lost ₹2,996.18 combined. Both admitted stale depth; AMAL spread was 0.530%, above the configured 0.150% limit, but the depth was 15.34 seconds old and the optional gate was bypassed. RAMBHAJO depth was 15.14 seconds old. KDGREEN also had stale depth and won ₹1,881.66: mandatory depth does exclude winners. TECHNOCRAF gross profit ₹100.60 was less than charges ₹118.18.

Yesterday: Rangebound lost ₹859.48 over five trades; Breakdown lost ₹1,044.12 over four trades. CHENNPETRO (-₹1,076.60) and CPL (-₹1,070.08) were the largest losses. Higher score alone is not a fix: CHENNPETRO scored 82.7, while today’s KDGREEN winner scored 51.25.

Stop oversight: AMAL gross loss was about 0.764% versus recorded entry stop distance 0.480%; RAMBHAJO gross loss was about 0.619% versus 0.248%. Inspect quote gaps and two-bar confirmation before changing stop distance. Those facts do not establish the first executable stop price. Actual stop orders also do not guarantee a stop-price fill ([FINRA explanation](https://www.finra.org/investors/insights/stop-orders-factors-consider-during-volatile-markets)); the present trades are simulation outcomes.

Do not broadly delay signal exits. TECHNOCRAF’s later snapshot implies ₹3,546.15 upside after exit, but yesterday VOEPL and CPL exits protected ₹5,326.40 against the stored close benchmark. These are hindsight comparisons, not realizable strategy returns, and benchmark quotes require freshness verification.

## Proposed changes — approval required before application

### SIMULATION_RANGEBOUND_MAX_POSITION_EXPOSURE

Current **200000** → proposed **100000**; default **200000**; source **default**; overridden **false**. Catalog description: Maximum rupee exposure allowed for one Rangebound position without increasing the shared cap for other setups.

Reduce Rangebound concentration to the existing shared Rs100,000 cap while execution and data quality are reviewed. This is a risk reduction, not evidence that smaller size improves entry selection.

Seven-session review: 21 affected of 28 Rangebound trades. Affected recorded net P&L ₹-4366.24; unaffected 7 trades net ₹-1.39. 5 dates support, 1 contradict, 1 lack affected trades. Confidence **low**; status **analytics-reviewed**.

Smaller exposure also cuts profitable trades; Aug 31 contradicts the loss concentration and the Sep 7 window additionally includes profitable larger positions on Aug 26. No predicted savings are claimed. Observed group P&L is not a rerun or a forecast. Freed capacity, quantity rounding, costs, and replacement trades are unmodeled.

Contradictory winners: KDGREEN ₹1881.66; APLAPOLLO ₹1106.19; LODHA ₹873.99; ANANDRATHI ₹945.43; QUESS ₹72.23.

### SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH

Current **false** → proposed **true**; default **false**; source **current-override**; overridden **true**. Catalog description: Blocks Rangebound entries when fresh live order-book depth is unavailable instead of applying gates opportunistically.

Make the existing fresh-depth requirement mandatory so stale depth cannot bypass spread and imbalance checks. Preserve MAX_DEPTH_AGE_SEC=15, MAX_SPREAD_PCT=0.15 and LIQUIDITY_GATE_ENABLED=true.

Seven-session review: 19 affected of 28 Rangebound trades. Affected recorded net P&L ₹-1791.77; unaffected 9 trades net ₹-2575.86. 5 dates support, 1 contradict, 1 lack affected trades. Confidence **low**; status **analytics-reviewed**.

May block most Rangebound entries until depth delivery is improved. Winners KDGREEN, CPPLUS, ANGELONE and others also entered with stale depth. Fresh-depth trades themselves lost money; this is a data-integrity safeguard, not a proven alpha filter. Observed group P&L is not a rerun or a forecast. Freed capacity, quantity rounding, costs, and replacement trades are unmodeled.

Contradictory winners: KDGREEN ₹1881.66; CPPLUS ₹710.93; ANGELONE ₹438.33; APLAPOLLO ₹1106.19; ANANDRATHI ₹945.43; SUVEN ₹585.26; QUESS ₹72.23.

## Seven-session coverage

Separate evidence was refreshed for every available transaction date. Today’s window: 2026-09-08, 2026-09-07, 2026-09-04, 2026-09-03, 2026-08-31, 2026-08-28, 2026-08-27. Yesterday’s window: 2026-09-07, 2026-09-04, 2026-09-03, 2026-08-31, 2026-08-28, 2026-08-27, 2026-08-26. No later date was used to assess yesterday. No shortfall. Dates without transactions were not substituted for available transaction dates. Today’s seven-session window has 41 trades net -₹5,157.44, of which 28 Rangebound trades net -₹4,367.63. These two overlapping windows must not be added together.

Keep the existing 15-second depth age, 0.15% spread limit, two-bar stop confirmation and recovery shadow observation unchanged pending evidence. Do not enable new setups or loosen targets on the basis of snapshot appearance counts. Prioritize data/exit-path audits, then consider the two exact changes independently.

## Limitations

- Closed reconciled positions only; not account equity or unrealized P&L.
- Day-close benchmarks come from simulation-closing-snapshot and may inherit the stale-quote issues identified today; they are not independently verified exchange closes.
- Configuration records are current at evidence generation; historical snapshots include different fingerprints.
- Snapshot actionable labels are not proof that every entry gate or capacity constraint passed.
- No replay, backtest, sweep, or alternate-value trial was run.
