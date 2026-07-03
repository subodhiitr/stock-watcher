(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TradeRules = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const DEFAULT_SETTINGS = {
    PORTFOLIO_INITIAL_CAPITAL: 500000, // fallback only; dashboard/backtest replace this from portfolio state
    MAX_POSITION_EXPOSURE: 100000,
    TRADE_RISK_PCT: 1,
    SIMULATION_MIN_NET_PROFIT_PCT: 1,
    SIMULATION_MAX_OPEN: 20,
    SIMULATION_MAX_ACTIVE_OPEN: 15,
    SIMULATION_MAX_NEW_PER_CYCLE: 4,
    SIMULATION_TOP_N: 10,
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 25,
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 0.25,
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 0.45,
    SIMULATION_DATA_QUALITY_REDUCED_TOP_N: 2,
    SIMULATION_DAILY_MAX_TRADES: 25,
    SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN: 3,
    SIMULATION_DAILY_MAX_STOPS: 4,
    SIMULATION_CLUSTERED_STOP_COUNT: 2,
    SIMULATION_CLUSTERED_STOP_WINDOW_MIN: 60,
    SIMULATION_CLUSTERED_STOP_COOLDOWN_MIN: 45,
    SIMULATION_OVERRIDE_STOP_GUARD: false,
    SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER: 2,
    SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT: 0.2,
    SIMULATION_DAILY_MAX_NET_LOSS_PCT: 0.6,
    SIMULATION_SYMBOL_COOLDOWN_MIN: 90,
    SIMULATION_SETUP_COOLDOWN_MIN: 90,
    SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT: 2,
    SIMULATION_FIRST_HOUR_MAX_ENTRIES: 2,
    SIMULATION_STOP_GRACE_MIN: 10,
    SIMULATION_NO_PROGRESS_EXIT_MIN: 12,
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN: 9,
    SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN: 12,
    SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN: 8,
    SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE: true,
    SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE: 1.5,
    SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 0.2,
    SIMULATION_NO_PROGRESS_ADVERSE_PCT: 0.15,
    SIMULATION_STOP_CONFIRM_BARS: 2,
    SIMULATION_EMERGENCY_STOP_PCT: 1.25,
    SIMULATION_RUNNER_MIN_SCORE: 65,
    SIMULATION_RUNNER_MIN_REL_VOL: 3,
    SIMULATION_RUNNER_MAX_DAY_CHANGE_PCT: 8,
    SIMULATION_RUNNER_LATE_SIZE_REDUCTION_DAY_CHANGE_PCT: 7,
    SIMULATION_RUNNER_LATE_SIZE_FACTOR: 0.5,
    SIMULATION_RUNNER_REQUIRE_BULLISH_SUPERTREND: true,
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_3M: 0.8,
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_RUNNER_LATE_BREAKOUT_MIN_VOLUME_RATIO_5M: 1.2,
    SIMULATION_EARLY_RUNNER_MIN_SCORE: 40,
    SIMULATION_EARLY_RUNNER_MIN_REL_VOL: 1.8,
    SIMULATION_EARLY_RUNNER_MIN_DAY_CHANGE_PCT: 3,
    SIMULATION_EARLY_RUNNER_MAX_DAY_CHANGE_PCT: 8,
    SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 4.25,
    SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT: 2.2,
    SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 3.25,
    SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT: 1.25,
    SIMULATION_STRONG_BREAKOUT_MIN_SCORE: 55,
    SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL: 3,
    SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT: 3,
    SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT: 8,
    SIMULATION_STRONG_BREAKOUT_MAX_RSI: 75,
    SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT: 1,
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL: 2,
    SIMULATION_RUNNER_TRAIL_PCT: 0.9,
    SIMULATION_RUNNER_WIDE_TRAIL_PCT: 1.35,
    SIMULATION_RUNNER_TARGET_STEP_PCT: 1.2,
    SIMULATION_BREAKEVEN_PROTECT_PCT: 0.65,
    SIMULATION_TRAIL_START_PCT: 0.8,
    SIMULATION_LONG_TRAIL_PCT: 0.4,
    SIMULATION_TIME_STOP_MIN: 45,
    SIMULATION_TIME_STOP_MIN_PROFIT_PCT: 0.2,
    SIMULATION_EXIT_MIN_HOLD_MIN: 12,
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 3,
    SIMULATION_TARGET_PARTIAL_QTY_PCT: 50,
    SIMULATION_TARGET_RUNNER_MIN_SCORE: 60,
    SIMULATION_TARGET_RUNNER_MIN_REL_VOL: 1.5,
    SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN: 45,
    SIMULATION_VWAP_CONT_MIN_SCORE: 85,
    SIMULATION_VWAP_CONT_MIN_REL_VOL: 1.5,
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_3M: 0.8,
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_VWAP_CONT_BLOCK_NEGATIVE_5M_UNLESS_BREAKOUT: true,
    SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT: 2.5,
    SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT: 1.1,
    SIMULATION_MIN_SCORE: 70,
    SIMULATION_SHORT_MIN_SCORE: 65,
    SIMULATION_SHORT_MIN_REL_VOL: 0.8,
    SIMULATION_SHORT_ALLOW_AVOID_GUARD: true,
    SIMULATION_SHORT_TRIGGER_DISTANCE_PCT: 1.2,
    SIMULATION_SHORT_CONFIRM_BARS: 2,
    SIMULATION_SHORT_MAX_STOP_PCT: 0.75,
    SIMULATION_SHORT_TRAIL_PCT: 0.4,
    SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS: 2,
    SIMULATION_REQUIRE_NIFTY_FOR_SHORTS: true,
    SIMULATION_MARKET_BREADTH_PCT: 55,
    SIMULATION_MARKET_REGIME_NIFTY_PCT: 0.25,
    SIMULATION_MARKET_REGIME_SECTOR_PCT: 0.15,
    SIMULATION_MARKET_REGIME_RS_PCT: 0.2,
    SIMULATION_AUTO_SHORTS: true,
    SIMULATION_AUTO_MANUAL_EXITS: false,
    SIMULATION_ENABLE_ETF: false,
    SIMULATION_HIGH_PROFIT_EXIT_THRESHOLD_PCT: 17,
    SIMULATION_HIGH_PROFIT_EXIT_PROFIT_PCT: 1.5,
    SIMULATION_HIGH_PROFIT_EXIT_STOP_PCT: 1,
    SIMULATION_HIGH_PROFIT_EXIT_HOUR_CUTOFF: 13,
    SIMULATION_NEG_CANDLE_EXIT_MIN_GAIN_PCT: 1.0,
    SIMULATION_NEG_CANDLE_EXIT_COUNT: 3,
  };

  const SETTING_DESCRIPTIONS = {
    PORTFOLIO_INITIAL_CAPITAL: 'Fallback portfolio capital used for risk, return, and daily-loss calculations. Dashboard and backtest should replace this with saved portfolio capital.',
    MAX_POSITION_EXPOSURE: 'Maximum rupee exposure allowed in one position. Manual and simulation sizing should not allocate more than this to a single stock or ETF.',
    TRADE_RISK_PCT: 'Maximum portfolio capital risked per trade, based on entry price versus stop loss.',
    SIMULATION_MIN_NET_PROFIT_PCT: 'Minimum expected net profit percent required after estimated brokerage and charges before a trade is suggested or auto-entered.',
    SIMULATION_MAX_OPEN: 'Maximum total simulation trades allowed to remain open at the same time.',
    SIMULATION_MAX_ACTIVE_OPEN: 'Maximum active simulation positions allowed at the same time. This can be lower than total open when partial runners are active.',
    SIMULATION_MAX_NEW_PER_CYCLE: 'Maximum new simulation entries allowed during one refresh cycle.',
    SIMULATION_TOP_N: 'Number of highest-ranked candidates considered first for simulation entries.',
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 'Minimum candidate sample size before snapshot-level data-quality throttles activate.',
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 'Bad-candidate ratio that reduces entry selection during degraded intraday data quality.',
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 'Bad-candidate ratio that blocks new entries during degraded intraday data quality.',
    SIMULATION_DATA_QUALITY_REDUCED_TOP_N: 'Maximum top-N candidates considered while intraday data quality is degraded but not blocked.',
    SIMULATION_DAILY_MAX_TRADES: 'Maximum number of new simulation entries allowed in one trading day.',
    SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN: 'Maximum age in minutes allowed between the candidate snapshot and automated entry.',
    SIMULATION_DAILY_MAX_STOPS: 'Base number of losing stop exits allowed in one day before blocking fresh entries.',
    SIMULATION_CLUSTERED_STOP_COUNT: 'Number of recent losing stop exits that trigger a temporary fresh-entry cooldown.',
    SIMULATION_CLUSTERED_STOP_WINDOW_MIN: 'Lookback minutes for clustered losing stop exits.',
    SIMULATION_CLUSTERED_STOP_COOLDOWN_MIN: 'Minutes to pause fresh entries after clustered losing stop exits.',
    SIMULATION_OVERRIDE_STOP_GUARD: 'When enabled, simulation does not block fresh entries after hitting the daily stop guard. Other guards (daily loss, trade limit, cooldowns) still apply.',
    SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER: 'Multiplier applied to the daily stop limit after the day has enough profit buffer.',
    SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT: 'Portfolio profit percent needed before the higher daily stop limit is allowed.',
    SIMULATION_DAILY_MAX_NET_LOSS_PCT: 'Maximum net daily loss percent of portfolio capital before fresh entries are blocked.',
    SIMULATION_SYMBOL_COOLDOWN_MIN: 'Minutes to wait before re-entering the same symbol after a losing stop exit.',
    SIMULATION_SETUP_COOLDOWN_MIN: 'Minutes to wait before re-entering the same symbol and setup type after a losing stop exit.',
    SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT: 'Blocks fresh entries for a setup type after this many losing trades in the same setup during the day.',
    SIMULATION_FIRST_HOUR_MAX_ENTRIES: 'Maximum new entries allowed during the first trading hour to avoid overtrading early volatility.',
    SIMULATION_STOP_GRACE_MIN: 'Minutes after entry during which normal stop checks are softened unless emergency conditions occur.',
    SIMULATION_NO_PROGRESS_EXIT_MIN: 'Minutes after entry before an unproductive trade can be closed early.',
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN: 'No-progress exit window for momentum-runner or target-runner trades.',
    SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN: 'No-progress exit window for fresh-breakout trades.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN: 'No-progress exit window for VWAP trend-continuation trades when the rule is active.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE: 'When true, VWAP continuation no-progress exits only activate after relative volume fades.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE: 'Relative-volume threshold below which VWAP continuation is considered faded for no-progress exits.',
    SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 'Minimum favorable move expected by the no-progress window.',
    SIMULATION_NO_PROGRESS_ADVERSE_PCT: 'Adverse move percent that can close a no-progress trade before full stop damage.',
    SIMULATION_STOP_CONFIRM_BARS: 'Number of consecutive refreshes required to confirm a normal stop exit.',
    SIMULATION_EMERGENCY_STOP_PCT: 'Hard adverse move percent from entry that can exit immediately, even during stop grace.',
    SIMULATION_RUNNER_MIN_SCORE: 'Minimum trade score required for momentum-runner entries.',
    SIMULATION_RUNNER_MIN_REL_VOL: 'Minimum relative volume required for momentum-runner entries.',
    SIMULATION_RUNNER_MAX_DAY_CHANGE_PCT: 'Maximum day gain allowed for normal momentum-runner entries unless fresh shock/high breakout confirms continuation.',
    SIMULATION_RUNNER_LATE_SIZE_REDUCTION_DAY_CHANGE_PCT: 'Day gain where momentum-runner sizing is reduced because the move is already extended.',
    SIMULATION_RUNNER_LATE_SIZE_FACTOR: 'Quantity multiplier applied to late momentum-runner entries.',
    SIMULATION_RUNNER_REQUIRE_BULLISH_SUPERTREND: 'When true, buy-side momentum runners require bullish SuperTrend.',
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_3M: 'Minimum recent 3-minute volume impulse accepted for momentum-runner entries unless a fresh high breakout confirms.',
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_5M: 'Minimum recent 5-minute volume impulse accepted for momentum-runner entries unless a fresh high breakout confirms.',
    SIMULATION_RUNNER_LATE_BREAKOUT_MIN_VOLUME_RATIO_5M: 'Minimum 5-minute volume impulse required when a late runner is allowed by a fresh high breakout.',
    SIMULATION_EARLY_RUNNER_MIN_SCORE: 'Lower score floor for early momentum-runner entries when volume, trend, and breakout confirmations are already aligned.',
    SIMULATION_EARLY_RUNNER_MIN_REL_VOL: 'Minimum relative volume required for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MIN_DAY_CHANGE_PCT: 'Minimum day gain required for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MAX_DAY_CHANGE_PCT: 'Maximum day gain allowed before early momentum-runner entries are considered too late.',
    SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 'Maximum trigger extension allowed for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for early momentum-runner entries.',
    SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 'Maximum allowed price extension above the trigger for momentum-runner entries.',
    SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT: 'Maximum allowed price extension above VWAP for momentum-runner entries.',
    SIMULATION_STRONG_BREAKOUT_MIN_SCORE: 'Lower score floor for strong volume-shock or high-relative-volume fresh breakouts.',
    SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL: 'Minimum relative volume required for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT: 'Minimum day gain required for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT: 'Maximum day gain allowed for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MAX_RSI: 'Maximum RSI allowed for strong volume-breakout score relaxation.',
    SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT: 'Normal maximum VWAP extension allowed for fresh-breakout entries.',
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for fresh breakouts when relative volume is high.',
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL: 'Relative-volume threshold that allows the relaxed fresh-breakout VWAP extension.',
    SIMULATION_RUNNER_TRAIL_PCT: 'Normal trailing stop percent used for momentum-runner exits.',
    SIMULATION_RUNNER_WIDE_TRAIL_PCT: 'Wider trailing stop percent used when momentum remains strong.',
    SIMULATION_RUNNER_TARGET_STEP_PCT: 'Next target step percent applied to remaining runner quantity after a momentum-confirmed partial target.',
    SIMULATION_BREAKEVEN_PROTECT_PCT: 'Favorable move percent after which simulation protects capital around breakeven.',
    SIMULATION_TRAIL_START_PCT: 'Favorable move percent after which non-runner positions start using a trailing-profit guard.',
    SIMULATION_LONG_TRAIL_PCT: 'Trailing stop percent used for long positions after enough profit cushion is built.',
    SIMULATION_TIME_STOP_MIN: 'Minutes after entry before a non-performing trade can be exited by time-stop logic.',
    SIMULATION_TIME_STOP_MIN_PROFIT_PCT: 'Minimum favorable move expected by the time-stop window before a weak trade can be closed.',
    SIMULATION_EXIT_MIN_HOLD_MIN: 'Minimum hold time before VWAP-loss or momentum-fade exits can close a trade.',
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 'Number of consecutive refreshes required before VWAP-loss or momentum-fade exits are confirmed.',
    SIMULATION_TARGET_PARTIAL_QTY_PCT: 'Percent of position quantity booked at partial target before leaving a runner.',
    SIMULATION_TARGET_RUNNER_MIN_SCORE: 'Minimum score required to keep the remaining quantity as a target runner.',
    SIMULATION_TARGET_RUNNER_MIN_REL_VOL: 'Minimum relative volume required to keep the remaining quantity as a target runner.',
    SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN: 'Minutes to wait before re-entering a symbol after a profitable exit.',
    SIMULATION_VWAP_CONT_MIN_SCORE: 'Minimum score required for VWAP trend-continuation entries.',
    SIMULATION_VWAP_CONT_MIN_REL_VOL: 'Minimum relative volume required for VWAP trend-continuation entries.',
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_3M: 'Minimum recent 3-minute volume impulse accepted for VWAP trend-continuation entries.',
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_5M: 'Minimum recent 5-minute volume impulse accepted for VWAP trend-continuation entries.',
    SIMULATION_VWAP_CONT_BLOCK_NEGATIVE_5M_UNLESS_BREAKOUT: 'Blocks VWAP trend-continuation entries when 5-minute price change is negative unless price is making a fresh high.',
    SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT: 'Maximum allowed price extension above the trigger for VWAP trend-continuation entries.',
    SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT: 'Maximum allowed price extension above VWAP for VWAP trend-continuation entries.',
    SIMULATION_MIN_SCORE: 'Minimum general long-side trade score required before simulation can consider a buy candidate.',
    SIMULATION_SHORT_MIN_SCORE: 'Minimum absolute short-side score required before simulation can consider a sell candidate.',
    SIMULATION_SHORT_MIN_REL_VOL: 'Minimum time-adjusted relative volume required for short breakdown or VWAP-rejection entries.',
    SIMULATION_SHORT_ALLOW_AVOID_GUARD: 'Allows risk guard level Avoid for short entries. Some long-side avoid reasons are actually bearish confirmations for shorts.',
    SIMULATION_SHORT_TRIGGER_DISTANCE_PCT: 'Maximum distance from current price to short trigger before it is flagged as too far for intraday short analysis.',
    SIMULATION_SHORT_CONFIRM_BARS: 'Number of triggered below-VWAP snapshots required to confirm short breakdown entries.',
    SIMULATION_SHORT_MAX_STOP_PCT: 'Maximum stop-loss distance allowed for short entries.',
    SIMULATION_SHORT_TRAIL_PCT: 'Trailing stop percent used after a short trade moves sufficiently in favor.',
    SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS: 'Minimum bearish confirmation count required for short entries, using VWAP, EMA, SuperTrend, RSI, trigger and score alignment.',
    SIMULATION_REQUIRE_NIFTY_FOR_SHORTS: 'When true, short entries are blocked if Nifty regime data is unavailable.',
    SIMULATION_MARKET_BREADTH_PCT: 'Advance/decline breadth threshold used by the market-regime guard when breadth data is available.',
    SIMULATION_MARKET_REGIME_NIFTY_PCT: 'Nifty change threshold used by the market-regime guard. Long entries are blocked below negative threshold; short entries are blocked above positive threshold.',
    SIMULATION_MARKET_REGIME_SECTOR_PCT: 'Sector average change threshold used by the market-regime guard. Long entries are blocked when sector is weaker than this negative threshold; shorts are blocked when sector is stronger than this positive threshold.',
    SIMULATION_MARKET_REGIME_RS_PCT: 'Relative strength threshold against Nifty used by the market-regime guard. Long entries need stock RS above negative threshold; shorts need stock RS below positive threshold.',
    SIMULATION_AUTO_SHORTS: 'When true, simulation may open short/sell-side entries. When false, it only auto-buys long setups.',
    SIMULATION_AUTO_MANUAL_EXITS: 'When true, manual open trades use simulation exit logic for target, stop-loss, trailing, time-stop, and EOD square-off.',
    SIMULATION_ENABLE_ETF: 'When true, simulation may open long ETF entries. ETF shorts remain disabled.',
    SIMULATION_HIGH_PROFIT_EXIT_THRESHOLD_PCT: 'Stock gain percentage before the hour cutoff that triggers an automatic short entry. When stock increases this much before 1 PM IST, simulation will open a short to capture mean reversion.',
    SIMULATION_HIGH_PROFIT_EXIT_PROFIT_PCT: 'Target profit percent for the automatic short entry triggered by high gains. Default is 1.5% (stock drops 1.5% from entry).',
    SIMULATION_HIGH_PROFIT_EXIT_STOP_PCT: 'Stop loss percent for the automatic short entry. Default is 1% (stock rises 1% from entry triggers stop).',
    SIMULATION_HIGH_PROFIT_EXIT_HOUR_CUTOFF: 'Hour (24-hour IST) after which the high-profit short trigger no longer applies. Default is 13 (1 PM IST). After this hour, stocks are not triggered for short entry even if they gained 17%+.',
    SIMULATION_NEG_CANDLE_EXIT_MIN_GAIN_PCT: 'Minimum current favorable move percent required before the consecutive negative candle exit rule becomes active. Default is 1.0 (trade must be at least 1% in profit).',
    SIMULATION_NEG_CANDLE_EXIT_COUNT: 'Number of consecutive bearish candles (close < open for longs; close > open for shorts) required to exit a trade that is at least SIMULATION_NEG_CANDLE_EXIT_MIN_GAIN_PCT in profit.',
  };

  function withDefaults(settings) {
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  function round3(n) {
    return Number.isFinite(Number(n)) ? Math.round(Number(n) * 1000) / 1000 : 0;
  }

  function getIstMinutes(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  }

  function isLosingStopExit(trade) {
    return /stop/i.test(String(trade?.closeReason || '')) && Number(trade?.pnl) < 0;
  }

  function getEffectiveStopLimit(netPnl, settings) {
    settings = withDefaults(settings);
    const base = Number(settings.SIMULATION_DAILY_MAX_STOPS) || 0;
    const multiplier = Number(settings.SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER) || 1;
    const bufferPct = Number(settings.SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT) || 0;
    const profitBuffer = Math.max(0, Number(settings.PORTFOLIO_INITIAL_CAPITAL) || 0) * bufferPct / 100;
    return Number(netPnl) >= profitBuffer ? base * multiplier : base;
  }

  function getProfitReentryBlockReason(trades, sym, setupType, at, settings) {
    settings = withDefaults(settings);
    if (!Array.isArray(trades) || !sym) return '';
    const now = at ? new Date(at).getTime() : Date.now();
    const cooldownMs = settings.SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN * 60000;
    const recentWin = trades
      .filter(t => t && t.symbol === sym && t.status === 'closed' && Number(t.pnl) > 0)
      .filter(t => !setupType || !t.setupType || t.setupType === setupType)
      .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0))[0];
    if (!recentWin) return '';
    const closedAt = new Date(recentWin.closedAt || recentWin.openedAt || 0).getTime();
    if (Number.isFinite(closedAt) && now - closedAt < cooldownMs) {
      return `profit re-entry cooldown after ${recentWin.closeReason || 'win'}`;
    }
    return '';
  }

  function buildDayStats(trades, at, settings, helpers = {}) {
    settings = withDefaults(settings);
    const list = Array.isArray(trades) ? trades : [];
    const sameDay = helpers.sameDay || (() => true);
    const isTodayTrade = helpers.isTodayTrade || (trade => sameDay(trade?.openedAt, at) || sameDay(trade?.closedAt, at));
    const isBrokerFailed = t => ['cancelled','rejected','timeout','failed'].includes(String(t?.broker?.status||'').toLowerCase());
    const dayTrades = list.filter(isTodayTrade);
    const closed = dayTrades.filter(t => t.status === 'closed' && !isBrokerFailed(t));
    const netPnl = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const firstHourEntries = dayTrades.filter(t => {
      const mins = getIstMinutes(t.openedAt);
      return mins != null && mins >= 9 * 60 + 15 && mins < 10 * 60 + 15;
    }).length;
    return {
      trades: dayTrades,
      dayTrades,
      closed,
      entries: dayTrades.filter(t => !isBrokerFailed(t) && (!helpers.sameDay || sameDay(t.openedAt, at))).length,
      firstHourEntries,
      stops: closed.filter(isLosingStopExit).length,
      dailyStopLimit: getEffectiveStopLimit(netPnl, settings),
      netPnl:+netPnl.toFixed(2),
      netLossPct:+Math.max(0, (-netPnl / Math.max(1, Number(settings.PORTFOLIO_INITIAL_CAPITAL) || 1)) * 100).toFixed(3),
    };
  }

  function getEntryBlockReason(sym, setupType = '', at = Date.now(), stats = {}, settings = {}) {
    settings = withDefaults(settings);
    if ((Number(stats.entries) || 0) >= settings.SIMULATION_DAILY_MAX_TRADES) return `daily trade limit ${settings.SIMULATION_DAILY_MAX_TRADES}`;
    const stopLimit = Number(stats.dailyStopLimit ?? getEffectiveStopLimit(stats.netPnl, settings));
    const stopGuardOverride = !!settings.SIMULATION_OVERRIDE_STOP_GUARD;
    if (!stopGuardOverride && (Number(stats.stops) || 0) >= stopLimit) {
      return `daily stop limit ${stopLimit}${stopLimit > settings.SIMULATION_DAILY_MAX_STOPS ? ' (profit buffer)' : ''}`;
    }
    const clusteredStopCount = Math.max(0, Math.floor(Number(settings.SIMULATION_CLUSTERED_STOP_COUNT) || 0));
    if (!stopGuardOverride && clusteredStopCount > 0) {
      const now = at ? new Date(at).getTime() : Date.now();
      const windowMs = Math.max(1, Number(settings.SIMULATION_CLUSTERED_STOP_WINDOW_MIN) || 60) * 60000;
      const cooldownMs = Math.max(1, Number(settings.SIMULATION_CLUSTERED_STOP_COOLDOWN_MIN) || 45) * 60000;
      const clusteredStops = (Array.isArray(stats.closed) ? stats.closed : [])
        .filter(isLosingStopExit)
        .map(t => new Date(t.closedAt || t.openedAt || 0).getTime())
        .filter(ms => Number.isFinite(ms) && ms > 0 && now - ms <= windowMs)
        .sort((a, b) => b - a);
      if (clusteredStops.length >= clusteredStopCount && now - clusteredStops[0] < cooldownMs) {
        return `clustered stop cooldown ${clusteredStops.length}/${clusteredStopCount}`;
      }
    }
    if ((Number(stats.netLossPct) || 0) >= settings.SIMULATION_DAILY_MAX_NET_LOSS_PCT) return `daily loss guard ${round3(stats.netLossPct)}%`;
    const profitBlock = getProfitReentryBlockReason(stats.closed, sym, setupType, at, settings);
    if (profitBlock) return profitBlock;
    const mins = getIstMinutes(at);
    if (mins != null && mins < 10 * 60 + 15 && (Number(stats.firstHourEntries) || 0) >= settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES) {
      return `first-hour trade limit ${settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES}`;
    }

    const now = at ? new Date(at).getTime() : Date.now();
    const closed = Array.isArray(stats.closed) ? stats.closed : [];
    if (setupType) {
      const guardCount = Math.max(1, Math.floor(Number(settings.SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT) || 2));
      const recentBadSetups = closed
        .filter(t => t.setupType === setupType)
        .filter(t => isLosingStopExit(t) || Number(t.pnl) < 0)
        .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0));
      const recentBadSetup = recentBadSetups[0];
      if (recentBadSetups.length >= guardCount && recentBadSetup) {
        const closedAt = new Date(recentBadSetup.closedAt || recentBadSetup.openedAt || 0).getTime();
        if (Number.isFinite(closedAt) && now - closedAt < settings.SIMULATION_SETUP_COOLDOWN_MIN * 60000) {
          return `setup loss guard after ${recentBadSetups.length} failed ${setupType}`;
        }
      }
    }

    const recentBad = closed
      .filter(t => t.symbol === sym)
      .filter(t => {
        if (isLosingStopExit(t)) return true;
        if (Number(t.pnl) < 0) return true;
        // Any loss exit (including VWAP/signal/time-stop) triggers cooldown for VWAP_TREND_CONTINUATION
        if (setupType === 'VWAP_TREND_CONTINUATION' && t.setupType === 'VWAP_TREND_CONTINUATION' && Number(t.pnl) <= 0) return true;
        return false;
      })
      .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0))[0];
    if (recentBad) {
      const closedAt = new Date(recentBad.closedAt || recentBad.openedAt || 0).getTime();
      if (Number.isFinite(closedAt) && now - closedAt < settings.SIMULATION_SYMBOL_COOLDOWN_MIN * 60000) {
        return `cooldown after ${recentBad.closeReason || 'loss'}`;
      }
    }

    // Short cooldown after a cancelled or timed-out entry on the same symbol+setup to prevent immediate retries
    const CANCEL_COOLDOWN_MS = 15 * 60000;
    const isBrokerCancelledEntry = t =>
      ['cancelled', 'timeout'].includes(String(t?.broker?.status || '').toLowerCase()) &&
      (!setupType || !t.setupType || t.setupType === setupType);
    const allDayTrades = Array.isArray(stats.dayTrades || stats.trades) ? (stats.dayTrades || stats.trades) : [];
    const recentCancel = allDayTrades
      .filter(t => t.symbol === sym && t.status === 'closed' && isBrokerCancelledEntry(t))
      .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0))[0];
    if (recentCancel) {
      const closedAt = new Date(recentCancel.closedAt || recentCancel.openedAt || 0).getTime();
      if (Number.isFinite(closedAt) && now - closedAt < CANCEL_COOLDOWN_MS) {
        return `entry retry cooldown after cancel/timeout`;
      }
    }

    return '';
  }

  function checkHighProfitShortTrigger(priceChangePercent, at = Date.now(), settings = {}) {
    settings = withDefaults(settings);
    const gainThreshold = Number(settings.SIMULATION_HIGH_PROFIT_EXIT_THRESHOLD_PCT) || 17;
    const hourCutoff = Number(settings.SIMULATION_HIGH_PROFIT_EXIT_HOUR_CUTOFF) || 13;
    
    if (Number(priceChangePercent) < gainThreshold) return false;
    
    const mins = getIstMinutes(at);
    if (mins == null) return false;
    
    const hour = Math.floor(mins / 60);
    return hour < hourCutoff;
  }

  return {
    DEFAULT_SETTINGS,
    SETTING_DESCRIPTIONS,
    withDefaults,
    getIstMinutes,
    isLosingStopExit,
    getEffectiveStopLimit,
    getProfitReentryBlockReason,
    buildDayStats,
    getEntryBlockReason,
    checkHighProfitShortTrigger,
  };
});
