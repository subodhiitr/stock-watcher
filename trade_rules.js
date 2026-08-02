(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TradeRules = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SIMULATION_SETUP_DEFINITIONS = [
    { type:'OPENING_FLUSH_VWAP_RECLAIM', key:'SIMULATION_OPENING_FLUSH_REVERSAL_ENABLED', label:'Opening Flush Reclaim', side:'long', description:'Buys a sharp opening dip after price reclaims VWAP.' },
    { type:'TOP_GAINER_PULLBACK_RECLAIM', key:'SIMULATION_TOP_GAINER_PULLBACK_RECLAIM_ENABLED', label:'Top Gainer Pullback', side:'long', description:'Enters a strong top gainer after a controlled VWAP pullback and reclaim.' },
    { type:'TOP_GAINER_CONTINUATION', key:'SIMULATION_TOP_GAINER_CONTINUATION_ENABLED', label:'Top Gainer Continuation', side:'long', description:'Follows sustained strength in one of the session’s leading gainers.' },
    { type:'EARLY_MOMENTUM', key:'SIMULATION_EARLY_MOMENTUM_ENABLED', label:'Early Momentum', side:'long', description:'Captures high-volume momentum shortly after the opening range forms.' },
    { type:'GAP_AND_GO', key:'SIMULATION_GAP_AND_GO_ENABLED', label:'Gap and Go', side:'both', description:'Trades an opening gap beyond the previous day range only while price holds the gap with fresh volume.' },
    { type:'VOLUME_SHOCK_BREAKOUT', key:'SIMULATION_VOLUME_SHOCK_BREAKOUT_ENABLED', label:'Volume Shock Breakout', side:'long', description:'Looks for a breakout supported by an exceptional burst in volume.' },
    { type:'BULL_FLAG_CONTINUATION', key:'SIMULATION_BULL_FLAG_CONTINUATION_ENABLED', label:'Bull Flag Continuation', side:'long', description:'Buys a fresh break above a tight higher-low consolidation after an established intraday advance.' },
    { type:'FRESH_BREAKOUT', key:'SIMULATION_FRESH_BREAKOUT_ENABLED', label:'Fresh Breakout', side:'long', description:'Enters a newly triggered breakout before it becomes extended.' },
    { type:'VWAP_PULLBACK_OR_HOLD', key:'SIMULATION_VWAP_PULLBACK_ENABLED', label:'VWAP Pullback / Hold', side:'long', description:'Buys a constructive pullback that holds or promptly reclaims VWAP.' },
    { type:'VWAP_TREND_CONTINUATION', key:'SIMULATION_VWAP_TREND_CONTINUATION_ENABLED', label:'VWAP Trend Continuation', side:'long', description:'Continues an established intraday uptrend while price holds above VWAP.' },
    { type:'MOMENTUM_RUNNER', key:'SIMULATION_MOMENTUM_RUNNER_ENABLED', label:'Momentum Runner', side:'long', description:'Trades persistent relative-strength leaders with strong participation.' },
    { type:'RANGEBOUND', key:'SIMULATION_RANGEBOUND_ENABLED', label:'Rangebound Reversion', side:'long', description:'Buys near a proven intraday range floor for a move back through the range.' },
    { type:'LONG_MOMENTUM', key:'SIMULATION_LONG_MOMENTUM_ENABLED', label:'Long Momentum', side:'long', description:'General long-side momentum setup used when no specialist setup is stronger.' },
    { type:'BREAKDOWN', key:'SIMULATION_BREAKDOWN_ENABLED', label:'Breakdown', side:'short', description:'Shorts a fresh support break with bearish price and volume confirmation.' },
    { type:'VWAP_REJECTION', key:'SIMULATION_VWAP_REJECTION_ENABLED', label:'VWAP Rejection', side:'short', description:'Shorts a failed recovery when price is rejected at VWAP.' },
    { type:'BEAR_FLAG_CONTINUATION', key:'SIMULATION_BEAR_FLAG_CONTINUATION_ENABLED', label:'Bear Flag Continuation', side:'short', description:'Re-enters downside momentum after a compact bearish consolidation.' },
    { type:'TOP_LOSER_BEAR_FLAG', key:'SIMULATION_TOP_LOSER_BEAR_FLAG_ENABLED', label:'Top Loser Bear Flag', side:'short', description:'Targets a weak top loser that consolidates before another leg down.' },
  ];
  const SIMULATION_SETUP_CONFIG_PREFIXES = {
    OPENING_FLUSH_VWAP_RECLAIM: ['SIMULATION_OPENING_FLUSH_'],
    TOP_GAINER_PULLBACK_RECLAIM: ['SIMULATION_TOP_GAINER_PULLBACK_'],
    TOP_GAINER_CONTINUATION: ['SIMULATION_TOP_GAINER_'],
    EARLY_MOMENTUM: ['SIMULATION_EARLY_MOMENTUM_', 'SIMULATION_MOMENTUM_CATALYST_'],
    GAP_AND_GO: ['SIMULATION_GAP_AND_GO_'],
    VOLUME_SHOCK_BREAKOUT: ['SIMULATION_VOLUME_SHOCK_'],
    BULL_FLAG_CONTINUATION: ['SIMULATION_BULL_FLAG_'],
    FRESH_BREAKOUT: ['SIMULATION_FRESH_BREAKOUT_'],
    VWAP_PULLBACK_OR_HOLD: ['SIMULATION_VWAP_PULLBACK_'],
    VWAP_TREND_CONTINUATION: ['SIMULATION_VWAP_TREND_CONTINUATION_', 'SIMULATION_VWAP_CONT_'],
    MOMENTUM_RUNNER: ['SIMULATION_MOMENTUM_RUNNER_', 'SIMULATION_RUNNER_', 'SIMULATION_MOMENTUM_CATALYST_'],
    RANGEBOUND: ['SIMULATION_RANGEBOUND_'],
    LONG_MOMENTUM: ['SIMULATION_LONG_MOMENTUM_', 'SIMULATION_MOMENTUM_CATALYST_'],
    BREAKDOWN: ['SIMULATION_BREAKDOWN_'],
    VWAP_REJECTION: ['SIMULATION_VWAP_REJECTION_'],
    BEAR_FLAG_CONTINUATION: ['SIMULATION_BEAR_FLAG_'],
    TOP_LOSER_BEAR_FLAG: ['SIMULATION_TOP_LOSER_'],
  };
  SIMULATION_SETUP_DEFINITIONS.forEach(definition => {
    definition.settingPrefixes = SIMULATION_SETUP_CONFIG_PREFIXES[definition.type] || [];
    definition.excludePrefixes = definition.type === 'TOP_GAINER_CONTINUATION'
      ? ['SIMULATION_TOP_GAINER_PULLBACK_']
      : [];
  });

  const DEFAULT_SETTINGS = {
    PORTFOLIO_INITIAL_CAPITAL: 500000, // fallback only; dashboard/backtest replace this from portfolio state
    MAX_POSITION_EXPOSURE: 100000,
    TRADE_RISK_PCT: 1,
    SIMULATION_MAX_PORTFOLIO_HEAT_PCT: 5,
    SIMULATION_MAX_SECTOR_HEAT_PCT: 2,
    SIMULATION_ENTRY_START_MIN: 9 * 60 + 30,
    SIMULATION_ENTRY_END_MIN: 14 * 60 + 45,
    SIMULATION_EOD_SETTLEMENT_MIN: 15 * 60 + 15,
    SIMULATION_AUTO_STOP_MIN: 15 * 60 + 30,
    SIMULATION_COST_PROFILE: 'zerodha_intraday',
    SIMULATION_SLIPPAGE_PCT: 0.06,
    SIMULATION_MIN_NET_PROFIT_PCT: 1,
    SIMULATION_MAX_OPEN: 10,
    SIMULATION_MAX_ACTIVE_OPEN: 8,
    SIMULATION_MAX_CONCURRENT_SHORTS: 4,
    SIMULATION_MAX_GROSS_EXPOSURE_PCT: 80,
    SIMULATION_MAX_NEW_PER_CYCLE: 1,
    SIMULATION_MAX_CONCURRENT_POSITIONS_PER_SYMBOL: 1,
    SIMULATION_MAX_DAILY_ENTRIES_PER_SYMBOL: 2,
    SIMULATION_MAX_OPEN_PER_SECTOR: 2,
    SIMULATION_ROLLING_ENTRY_WINDOW_MIN: 5,
    SIMULATION_ROLLING_ENTRY_MAX: 2,
    SIMULATION_ROLLING_ORDINARY_ENTRY_MAX: 1,
    SIMULATION_ROLLING_SECTOR_ENTRY_MAX: 1,
    SIMULATION_SECTOR_PRIORITY_ENABLED: true,
    SIMULATION_SECTOR_PRIORITY_MIN_SCORE: 80,
    SIMULATION_SECTOR_PRIORITY_MIN_SECTOR_PCT: 0.5,
    SIMULATION_SECTOR_PRIORITY_MIN_BREADTH_PCT: 60,
    SIMULATION_SECTOR_PRIORITY_MIN_RS_PCT: 0.5,
    SIMULATION_SECTOR_PRIORITY_MIN_CONSTITUENTS: 3,
    SIMULATION_SECTOR_PRIORITY_MAX_BOOST: 5,
    SIMULATION_TOP_N: 10,
    SIMULATION_DATA_QUALITY_MIN_SAMPLE: 25,
    SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO: 0.25,
    SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO: 0.45,
    SIMULATION_DATA_QUALITY_REDUCED_TOP_N: 2,
    SIMULATION_DAILY_MAX_TRADES: 12,
    SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN: 3,
    SIMULATION_DAILY_MAX_STOPS: 4,
    SIMULATION_CLUSTERED_STOP_COUNT: 2,
    SIMULATION_CLUSTERED_STOP_WINDOW_MIN: 60,
    SIMULATION_CLUSTERED_STOP_COOLDOWN_MIN: 45,
    SIMULATION_OVERRIDE_STOP_GUARD: false,
    SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER: 2,
    SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT: 0.2,
    SIMULATION_DAILY_MAX_NET_LOSS_PCT: 0.3,
    SIMULATION_SYMBOL_COOLDOWN_MIN: 90,
    SIMULATION_SETUP_COOLDOWN_MIN: 90,
    SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT: 2,
    SIMULATION_FIRST_HOUR_MAX_ENTRIES: 2,
    SIMULATION_STOP_GRACE_MIN: 10,
    SIMULATION_NO_PROGRESS_EXIT_MIN: 45,
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN: 45,
    SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN: 35,
    SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN: 30,
    SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE: true,
    SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE: 1.5,
    SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 0.15,
    SIMULATION_NO_PROGRESS_ADVERSE_PCT: 0.1,
    SIMULATION_NO_PROGRESS_CONFIRM_BARS: 1,
    SIMULATION_STOP_CONFIRM_BARS: 2,
    SIMULATION_LONG_CONFIRM_BARS: 2,
    SIMULATION_LONG_CONFIRM_MODE: 'completed_candle_hold',
    SIMULATION_LONG_CONFIRM_CANDLE_MIN: 5,
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: true,
    SIMULATION_LONG_REQUIRE_COMPLETED_CANDLE: true,
    SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION: true,
    SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_3M: 1,
    SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_5M: 1,
    SIMULATION_LONG_MAX_TRIGGER_EXTENSION_PCT: 0.6,
    SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_LONG_HARD_MIN_DECISION_SCORE_ENABLED: true,
    SIMULATION_LONG_HARD_MIN_DECISION_SCORE: 65,
    SIMULATION_LONG_BLOCK_NEGATIVE_5M: true,
    SIMULATION_LONG_NEGATIVE_5M_RECLAIM_POSITION_MULTIPLIER: 0.5,
    SIMULATION_LONG_ENTRY_CUTOFF_MIN: 14 * 60 + 15,
    SIMULATION_LATE_LONG_EXCEPTION_ENABLED: true,
    SIMULATION_LATE_LONG_EXCEPTION_MIN_SCORE: 90,
    SIMULATION_LATE_LONG_EXCEPTION_MIN_CHANGE_5M_PCT: 0.2,
    SIMULATION_LATE_LONG_EXCEPTION_MIN_REL_VOL: 2,
    SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_3M: 1.2,
    SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_5M: 1.2,
    SIMULATION_LONG_PROFIT_LOCK_PCT: 0.8,
    SIMULATION_LONG_PROFIT_LOCK_PARTIAL_QTY_PCT: 25,
    SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN: 15,
    SIMULATION_LONG_WEAK_MARKET_RUNNER_PROFIT_LOCK_PCT: 0.55,
    SIMULATION_GAIN_MILESTONE_ENABLED: true,
    SIMULATION_GAIN_MILESTONES_PCT: '0.5,1,1.5,2',
    SIMULATION_LONG_FLAT_MARKET_ABS_PCT: 0.2,
    SIMULATION_MOMENTUM_RUNNER_MAX_VWAP_EXTENSION_PCT: 0.5,
    SIMULATION_MOMENTUM_RUNNER_ENABLED: true,
    SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN: 10,
    SIMULATION_MOMENTUM_CATALYST_ENABLED: true,
    SIMULATION_MOMENTUM_CATALYST_MIN_ABS_IMPACT: 60,
    SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT: 5,
    SIMULATION_MOMENTUM_CATALYST_MAX_AGE_HOURS: 48,
    SIMULATION_RUNNER_MIN_CHANGE_5M_PCT: 0.1,
    SIMULATION_RUNNER_ALLOW_CONFIRMED_VWAP_RECLAIM: true,
    SIMULATION_RUNNER_REQUIRE_SECTOR_ALIGNMENT_OR_RS: true,
    SIMULATION_RUNNER_MIN_STRONG_RS_PCT: 0.75,
    SIMULATION_RUNNER_CHASE_MAX_DAY_GAIN_PCT: 6,
    SIMULATION_RUNNER_CHASE_MAX_IMPULSE_AGE_MIN: null,
    SIMULATION_RUNNER_MAX_BELOW_RECENT_HIGH_PCT: 0.15,
    SIMULATION_RUNNER_MAX_RECENT_HIGH_AGE_MIN: 10,
    SIMULATION_RANGEBOUND_ENABLED: true,
    SIMULATION_RANGEBOUND_LIQUIDITY_GATE_ENABLED: true,
    SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH: false,
    SIMULATION_RANGEBOUND_MAX_DEPTH_AGE_SEC: 15,
    SIMULATION_RANGEBOUND_MAX_SPREAD_PCT: 0.15,
    SIMULATION_RANGEBOUND_MIN_BOOK_IMBALANCE: 0.5,
    SIMULATION_RANGEBOUND_MIN_COMBINED_DEPTH_QTY: 1,
    SIMULATION_GAP_AND_GO_ENABLED: true,
    SIMULATION_GAP_AND_GO_MIN_GAP_PCT: 0.75,
    SIMULATION_GAP_AND_GO_MAX_GAP_PCT: 4,
    SIMULATION_GAP_AND_GO_ENTRY_CUTOFF_MIN: 10 * 60 + 30,
    SIMULATION_GAP_AND_GO_MIN_REL_VOL: 1.5,
    SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_3M: 1,
    SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_VOLUME_SHOCK_BREAKOUT_ENABLED: true,
    SIMULATION_BULL_FLAG_CONTINUATION_ENABLED: true,
    SIMULATION_BULL_FLAG_MIN_DAY_GAIN_PCT: 2,
    SIMULATION_BULL_FLAG_MAX_DAY_GAIN_PCT: 6,
    SIMULATION_BULL_FLAG_MIN_CONSOLIDATION_CANDLES: 2,
    SIMULATION_BULL_FLAG_MAX_CONSOLIDATION_WIDTH_PCT: 1.2,
    SIMULATION_BULL_FLAG_MIN_POLE_GAIN_PCT: 0.5,
    SIMULATION_BULL_FLAG_MIN_POLE_VOLUME_MULTIPLE: 1.2,
    SIMULATION_BULL_FLAG_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_FRESH_BREAKOUT_ENABLED: true,
    SIMULATION_VWAP_PULLBACK_ENABLED: true,
    SIMULATION_VWAP_TREND_CONTINUATION_ENABLED: true,
    SIMULATION_LONG_MOMENTUM_ENABLED: true,
    SIMULATION_RANGEBOUND_WINDOW_MIN: 45,
    SIMULATION_RANGEBOUND_ENTRY_START_MIN: 10 * 60,
    SIMULATION_RANGEBOUND_ENTRY_CUTOFF_MIN: 14 * 60 + 45,
    SIMULATION_RANGEBOUND_MIN_RANGE_PCT: 0.75,
    SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT: 0.15,
    SIMULATION_RANGEBOUND_MIN_TOUCHES_PER_SIDE: 2,
    SIMULATION_RANGEBOUND_MIN_MIDPOINT_CROSSES: 2,
    SIMULATION_RANGEBOUND_MIN_SCORE: 35,
    SIMULATION_RANGEBOUND_POSITION_MULTIPLIER: 0.5,
    SIMULATION_RANGEBOUND_MIN_NET_PROFIT_PCT: 0.4,
    SIMULATION_RANGEBOUND_MIN_GROSS_TO_COST_MULTIPLE: 1.5,
    SIMULATION_RANGEBOUND_MAX_NIFTY_DECLINE_PCT: 0.5,
    SIMULATION_RANGEBOUND_MIN_BREADTH_PCT: 25,
    SIMULATION_RANGEBOUND_MIN_SECTOR_PCT: -1,
    SIMULATION_RANGEBOUND_MIN_RS_PCT: -1.5,
    SIMULATION_FRAGMENTED_MARKET_FILTER_ENABLED: true,
    SIMULATION_FRAGMENTED_MARKET_FLAT_NIFTY_ABS_PCT: 0.2,
    SIMULATION_FRAGMENTED_MARKET_MAX_BANK_PCT: 0,
    SIMULATION_FRAGMENTED_MARKET_MAX_SMALLCAP_PCT: 0,
    SIMULATION_DOMINANT_LEADER_MAX_SECTOR_RANK: 3,
    SIMULATION_DOMINANT_LEADER_MIN_SECTOR_PCT: 0.5,
    SIMULATION_DOMINANT_LEADER_MIN_SECTOR_BREADTH_PCT: 60,
    SIMULATION_DOMINANT_LEADER_MIN_RS_PCT: 0.75,
    SIMULATION_MIN_GROSS_TO_COST_MULTIPLE: 2.5,
    SIMULATION_MANUAL_ENTRY_MAX_LIVE_DEVIATION_PCT: 0.25,
    SIMULATION_ENTRY_TRIGGER_FREEZE_ENABLED: true,
    SIMULATION_ENTRY_TRIGGER_FREEZE_MIN: 15,
    SIMULATION_EARLY_MOMENTUM_ENABLED: true,
    SIMULATION_EARLY_MOMENTUM_MIN_SCORE: 55,
    SIMULATION_EARLY_MOMENTUM_MIN_REL_VOL: 1.3,
    SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_3M: 1,
    SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_EARLY_MOMENTUM_ENTRY_CUTOFF_MIN: 10 * 60 + 15,
    SIMULATION_EARLY_MOMENTUM_REQUIRE_SECTOR_ALIGNMENT_OR_RS: true,
    SIMULATION_EARLY_MOMENTUM_MIN_STRONG_RS_PCT: 0.75,
    SIMULATION_TOP_GAINER_CONTINUATION_ENABLED: true,
    SIMULATION_TOP_GAINER_COUNT: 5,
    SIMULATION_TOP_GAINER_MIN_DAY_GAIN_PCT: 1.5,
    SIMULATION_TOP_GAINER_MAX_DAY_GAIN_PCT: 6,
    SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_3M: 1,
    SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_TOP_GAINER_MIN_REL_VOL: 1.2,
    SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT: 0.6,
    SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_TOP_GAINER_AVOID_START_MIN: 12 * 60,
    SIMULATION_TOP_GAINER_AVOID_END_MIN: 13 * 60 + 30,
    SIMULATION_TOP_GAINER_PROFIT_LOCK_PCT: 0.8,
    SIMULATION_TOP_GAINER_PARTIAL_QTY_PCT: 25,
    SIMULATION_TOP_GAINER_TRAIL_PCT: 0.35,
    SIMULATION_TOP_GAINER_PULLBACK_RECLAIM_ENABLED: true,
    SIMULATION_TOP_GAINER_PULLBACK_MIN_DAY_GAIN_PCT: 5,
    SIMULATION_TOP_GAINER_PULLBACK_MAX_DAY_GAIN_PCT: 12,
    SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_EXTENSION_PCT: 0.5,
    SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_TOUCH_PCT: 0.25,
    SIMULATION_TOP_GAINER_PULLBACK_POSITION_MULTIPLIER: 0.5,
    SIMULATION_OPENING_FLUSH_REVERSAL_ENABLED: true,
    SIMULATION_OPENING_FLUSH_MIN_DECLINE_PCT: 1,
    SIMULATION_OPENING_FLUSH_MIN_INDEX_RECOVERY_PCT: 0.5,
    SIMULATION_OPENING_FLUSH_MAX_TRIGGER_EXTENSION_PCT: 0.4,
    SIMULATION_OPENING_FLUSH_MIN_SCORE: 60,
    SIMULATION_EMERGENCY_STOP_PCT: 1.25,
    SIMULATION_RUNNER_MIN_SCORE: 65,
    SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER: 0.5,
    SIMULATION_RUNNER_SCALE_IN_ENABLED: true,
    SIMULATION_RUNNER_SCALE_IN_MIN_MFE_PCT: 0.5,
    SIMULATION_RUNNER_INITIAL_STOP_PCT: 0.8,
    SIMULATION_RUNNER_STOP_ATR_MULTIPLIER: 1.2,
    SIMULATION_RUNNER_MAX_INITIAL_STOP_PCT: 1.25,
    SIMULATION_RUNNER_MIN_REL_VOL: 3,
    SIMULATION_RUNNER_MAX_DAY_CHANGE_PCT: 8,
    SIMULATION_RUNNER_LATE_SIZE_REDUCTION_DAY_CHANGE_PCT: 7,
    SIMULATION_RUNNER_LATE_SIZE_FACTOR: 0.5,
    SIMULATION_RUNNER_REQUIRE_BULLISH_SUPERTREND: true,
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_3M: 0.8,
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_RUNNER_LATE_BREAKOUT_MIN_VOLUME_RATIO_5M: 1.2,
    SIMULATION_RUNNER_LATE_STRICT_START_MIN: 13 * 60 + 45,
    SIMULATION_RUNNER_ENTRY_CUTOFF_MIN: 14 * 60 + 30,
    SIMULATION_RUNNER_LATE_MAX_DAY_CHANGE_PCT: 7,
    SIMULATION_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT: 2,
    SIMULATION_EARLY_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT: 2.5,
    SIMULATION_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT: 1,
    SIMULATION_EARLY_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT: 1.3,
    SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_3M: 0.8,
    SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_EARLY_RUNNER_MIN_SCORE: 40,
    SIMULATION_EARLY_RUNNER_MIN_REL_VOL: 1.3,
    SIMULATION_EARLY_RUNNER_MIN_DAY_CHANGE_PCT: 0.5,
    SIMULATION_EARLY_RUNNER_MAX_DAY_CHANGE_PCT: 8,
    SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 1.25,
    SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT: 1.5,
    SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 3.25,
    SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT: 1.25,
    SIMULATION_STRONG_BREAKOUT_MIN_SCORE: 55,
    SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL: 3,
    SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT: 3,
    SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT: 8,
    SIMULATION_STRONG_BREAKOUT_MAX_RSI: 75,
    SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_FRESH_BREAKOUT_MIN_SCORE: 60,
    SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_3M: 0.7,
    SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_5M: 0.9,
    SIMULATION_FRESH_BREAKOUT_MIN_NIFTY_CHANGE_PCT: -0.1,
    SIMULATION_FRESH_BREAKOUT_MIN_BREADTH_PCT: 50,
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT: 1,
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL: 2,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_SCORE: 72,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_REL_VOL: 2,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_TRIGGER_EXTENSION_PCT: 1,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_VWAP_EXTENSION_PCT: 1.1,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_CONFIRMATIONS: 3,
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_RSI: 78,
    SIMULATION_RUNNER_TRAIL_PCT: 0.9,
    SIMULATION_RUNNER_WIDE_TRAIL_PCT: 1.35,
    SIMULATION_RUNNER_TARGET_STEP_PCT: 1.2,
    SIMULATION_BREAKEVEN_PROTECT_PCT: 0.65,
    SIMULATION_BREAKEVEN_MIN_HOLD_MIN: 5,
    SIMULATION_BREAKEVEN_COST_BUFFER_PCT: 0.02,
    SIMULATION_TRAIL_START_PCT: 0.8,
    SIMULATION_LONG_TRAIL_PCT: 0.4,
    SIMULATION_TIME_STOP_MIN: 45,
    SIMULATION_TIME_STOP_MIN_PROFIT_PCT: 0.2,
    SIMULATION_EXIT_MIN_HOLD_MIN: 30,
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 3,
    SIMULATION_TARGET_PARTIAL_QTY_PCT: 50,
    SIMULATION_TARGET_RUNNER_MIN_SCORE: 60,
    SIMULATION_TARGET_RUNNER_MIN_REL_VOL: 1.5,
    SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN: 45,
    SIMULATION_CONTINUATION_REENTRY_ENABLED: true,
    SIMULATION_CONTINUATION_REENTRY_COOLDOWN_MIN: 15,
    SIMULATION_CONTINUATION_REENTRY_MAX_PER_SYMBOL: 1,
    SIMULATION_VWAP_CONT_MIN_SCORE: 85,
    SIMULATION_VWAP_CONT_MIN_REL_VOL: 1.5,
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_3M: 0.8,
    SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_5M: 1,
    SIMULATION_VWAP_CONT_BLOCK_NEGATIVE_5M_UNLESS_BREAKOUT: true,
    SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT: 2.5,
    SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT: 1.1,
    SIMULATION_EXPECTANCY_ENABLED: true,
    SIMULATION_EXPECTANCY_MIN_SAMPLE: 12,
    SIMULATION_EXPECTANCY_BLOCK_MIN_SAMPLE: 25,
    SIMULATION_EXPECTANCY_MIN_NET_PCT: 0,
    SIMULATION_EXPECTANCY_MIN_PROFIT_FACTOR: 0.85,
    SIMULATION_EXPECTANCY_LOOKBACK_TRADES: 200,
    SIMULATION_EXPECTANCY_MAX_SCORE_ADJUSTMENT: 10,
    SIMULATION_MIN_SCORE: 65,
    SIMULATION_MAX_POSITION_MULTIPLIER: 1,
    SIMULATION_SHORT_MIN_SCORE: 60,
    SIMULATION_SHORT_MIN_REL_VOL: 0.8,
    SIMULATION_SHORT_ALLOW_AVOID_GUARD: true,
    SIMULATION_SHORT_TRIGGER_DISTANCE_PCT: 1.2,
    SIMULATION_SHORT_CONFIRM_BARS: 2,
    SIMULATION_SHORT_MAX_TRIGGER_EXTENSION_PCT: 0.3,
    SIMULATION_SHORT_REQUIRE_COMPLETED_CANDLE: true,
    SIMULATION_SHORT_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION: true,
    SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_3M: 1,
    SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_5M: 1,
    SIMULATION_SHORT_MAX_CONFIRM_LOWER_WICK_RATIO: 0.45,
    SIMULATION_SHORT_LATE_DEEP_DECLINE_GUARD_ENABLED: true,
    SIMULATION_SHORT_LATE_DEEP_DECLINE_START_MIN: 10 * 60 + 30,
    SIMULATION_SHORT_LATE_DEEP_DECLINE_MAX_PCT: 2,
    SIMULATION_SHORT_LATE_ACCELERATION_ENABLED: true,
    SIMULATION_SHORT_LATE_ACCELERATION_START_MIN: 10 * 60 + 30,
    SIMULATION_SHORT_LATE_ACCELERATION_MIN_SIGNALS: 4,
    SIMULATION_SHORT_LATE_ACCELERATION_REQUIRE_STOCK_SIGNAL: true,
    SIMULATION_SHORT_LATE_ACCELERATION_MAX_CHANGE_5M_PCT: -0.25,
    SIMULATION_SHORT_LATE_ACCELERATION_MAX_CLOSE_POSITION: 0.3,
    SIMULATION_SHORT_LATE_ACCELERATION_LOOKBACK_MIN: 15,
    SIMULATION_BEAR_FLAG_CONTINUATION_ENABLED: true,
    SIMULATION_BREAKDOWN_ENABLED: true,
    SIMULATION_VWAP_REJECTION_ENABLED: true,
    SIMULATION_BEAR_FLAG_MIN_DAY_DECLINE_PCT: 2,
    SIMULATION_BEAR_FLAG_MAX_DAY_DECLINE_PCT: 6,
    SIMULATION_BEAR_FLAG_MIN_CONSOLIDATION_CANDLES: 2,
    SIMULATION_BEAR_FLAG_MAX_VWAP_EXTENSION_PCT: 0.8,
    SIMULATION_TOP_LOSER_BEAR_FLAG_ENABLED: true,
    SIMULATION_TOP_LOSER_COUNT: 5,
    SIMULATION_TOP_LOSER_BEAR_FLAG_MIN_SCORE: 55,
    SIMULATION_TOP_LOSER_POSITION_MULTIPLIER: 0.5,
    SIMULATION_SHORT_PROFIT_LOCK_PCT: 0.25,
    SIMULATION_SHORT_PROFIT_LOCK_PARTIAL_QTY_PCT: 50,
    SIMULATION_SHORT_MAX_STOP_PCT: 0.75,
    SIMULATION_SHORT_TRAIL_PCT: 0.4,
    SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS: 2,
    SIMULATION_REQUIRE_NIFTY_FOR_SHORTS: true,
    SIMULATION_SHORT_MARKET_GUARD_STRICT: true,
    SIMULATION_SHORT_MARKET_REGIME_NIFTY_PCT: 0.1,
    SIMULATION_SHORT_MARKET_BREADTH_PCT: 52,
    SIMULATION_SHORT_MARKET_REGIME_SECTOR_PCT: 0.05,
    SIMULATION_SHORT_MARKET_REGIME_RS_PCT: 0.1,
    SIMULATION_MARKET_BREADTH_PCT: 55,
    SIMULATION_MARKET_REGIME_NIFTY_PCT: 0.25,
    SIMULATION_MARKET_REGIME_SECTOR_PCT: 0.15,
    SIMULATION_MARKET_REGIME_RS_PCT: 0.2,
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_ENABLED: true,
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SECTOR_PCT: 0.5,
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SCORE: 85,
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_RS_PCT: 0.5,
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MAX_NIFTY_DECLINE_PCT: 0.75,
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
    SIMULATION_MAX_CONCURRENT_SHORTS: 'Maximum simultaneous open simulation short positions.',
    SIMULATION_MAX_GROSS_EXPOSURE_PCT: 'Maximum reserved open notional as a percent of current portfolio equity.',
    SIMULATION_MAX_NEW_PER_CYCLE: 'Maximum new simulation entries allowed during one refresh cycle.',
    SIMULATION_MAX_OPEN_PER_SECTOR: 'Maximum simultaneous open positions allowed in one sector.',
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
    SIMULATION_ROLLING_ENTRY_WINDOW_MIN: 'Rolling time window in minutes used to rate-limit new simulation entries.',
    SIMULATION_ROLLING_ENTRY_MAX: 'Maximum new simulation entries allowed inside the rolling entry window.',
    SIMULATION_ROLLING_ORDINARY_ENTRY_MAX: 'Maximum non-sector-aligned entries allowed inside the rolling entry window.',
    SIMULATION_ROLLING_SECTOR_ENTRY_MAX: 'Maximum strongly sector-aligned entries allowed inside the rolling entry window.',
    SIMULATION_SECTOR_PRIORITY_ENABLED: 'Prioritizes high-quality candidates aligned with a broad, sufficiently covered sector trend.',
    SIMULATION_SECTOR_PRIORITY_MIN_SCORE: 'Minimum absolute candidate score required for strong sector-alignment priority.',
    SIMULATION_SECTOR_PRIORITY_MIN_SECTOR_PCT: 'Minimum directional sector move required for strong sector-alignment priority.',
    SIMULATION_SECTOR_PRIORITY_MIN_BREADTH_PCT: 'Minimum percentage of sector constituents moving in the trade direction.',
    SIMULATION_SECTOR_PRIORITY_MIN_RS_PCT: 'Minimum directional stock relative strength versus Nifty required for sector priority.',
    SIMULATION_SECTOR_PRIORITY_MIN_CONSTITUENTS: 'Minimum fresh sector constituents required before sector priority is trusted.',
    SIMULATION_SECTOR_PRIORITY_MAX_BOOST: 'Maximum ranking-score boost contributed by sector trend, breadth, and relative strength.',
    SIMULATION_STOP_GRACE_MIN: 'Minutes after entry during which normal stop checks are softened unless emergency conditions occur.',
    SIMULATION_NO_PROGRESS_EXIT_MIN: 'Minutes after entry before an unproductive trade can be closed early.',
    SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN: 'No-progress exit window for momentum-runner or target-runner trades.',
    SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN: 'No-progress exit window for fresh-breakout trades.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN: 'No-progress exit window for VWAP trend-continuation trades when the rule is active.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE: 'When true, VWAP continuation no-progress exits only activate after relative volume fades.',
    SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE: 'Relative-volume threshold below which VWAP continuation is considered faded for no-progress exits.',
    SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT: 'Minimum favorable move expected by the no-progress window.',
    SIMULATION_NO_PROGRESS_ADVERSE_PCT: 'Minimum adverse move required before confirmed no-progress deterioration can close a trade.',
    SIMULATION_NO_PROGRESS_CONFIRM_BARS: 'Number of consecutive completed candles beyond VWAP required to confirm a no-progress exit.',
    SIMULATION_STOP_CONFIRM_BARS: 'Number of consecutive completed candles beyond the stop required to confirm a normal stop exit.',
    SIMULATION_LONG_CONFIRM_BARS: 'Legacy snapshot-confirmation count used only when long confirmation mode is two_snapshots.',
    SIMULATION_LONG_CONFIRM_MODE: 'Long-entry persistence rule: completed_candle_hold requires a completed breakout candle followed by a live trigger/VWAP hold; two_snapshots retains the legacy rule.',
    SIMULATION_LONG_CONFIRM_CANDLE_MIN: 'Candle duration in minutes used to determine whether the breakout candle is complete.',
    SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: 'Master switch for mandatory long completed-candle, post-confirmation volume, and extension controls.',
    SIMULATION_LONG_REQUIRE_COMPLETED_CANDLE: 'When true, every allowed long setup must use completed-candle confirmation even if a legacy confirmation mode is configured.',
    SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION: 'When true, every long entry requires a current 3m or 5m volume impulse after its confirming candle completes.',
    SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_3M: 'Minimum current three-minute volume ratio required after long candle confirmation.',
    SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_5M: 'Minimum current five-minute volume ratio required after long candle confirmation.',
    SIMULATION_LONG_MAX_TRIGGER_EXTENSION_PCT: 'Maximum price extension above the entry trigger for every long setup.',
    SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT: 'Maximum price extension above VWAP for every long setup.',
    SIMULATION_LONG_HARD_MIN_DECISION_SCORE_ENABLED: 'When true, no long-side setup relaxation may enter below the hard decision-score floor.',
    SIMULATION_LONG_HARD_MIN_DECISION_SCORE: 'Hard long-side decision-score floor applied after setup-specific score relaxations.',
    SIMULATION_LONG_BLOCK_NEGATIVE_5M: 'Blocks long entries with explicit negative five-minute momentum unless the setup is a formal pullback/VWAP-reclaim setup.',
    SIMULATION_LONG_NEGATIVE_5M_RECLAIM_POSITION_MULTIPLIER: 'Maximum position multiplier for a formal pullback/reclaim entry while five-minute momentum is negative.',
    SIMULATION_LONG_ENTRY_CUTOFF_MIN: 'IST minute after which ordinary new long entries are blocked.',
    SIMULATION_LATE_LONG_EXCEPTION_ENABLED: 'Allows only strict top-gainer/VWAP continuation exceptions after the ordinary long-entry cutoff.',
    SIMULATION_LATE_LONG_EXCEPTION_MIN_SCORE: 'Minimum decision score for an exceptional late long entry.',
    SIMULATION_LATE_LONG_EXCEPTION_MIN_CHANGE_5M_PCT: 'Minimum positive five-minute move required for an exceptional late long entry.',
    SIMULATION_LATE_LONG_EXCEPTION_MIN_REL_VOL: 'Minimum relative volume required for an exceptional late long entry.',
    SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_3M: 'Minimum three-minute volume ratio accepted for an exceptional late long entry.',
    SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_5M: 'Minimum five-minute volume ratio accepted for an exceptional late long entry.',
    SIMULATION_LONG_PROFIT_LOCK_PCT: 'Favorable move that activates the cost-protecting profit lock for long positions.',
    SIMULATION_LONG_PROFIT_LOCK_PARTIAL_QTY_PCT: 'Percentage of a standard long position booked when the 0.80% profit lock activates.',
    SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN: 'Minimum hold before the long profit lock can activate.',
    SIMULATION_LONG_WEAK_MARKET_RUNNER_PROFIT_LOCK_PCT: 'Earlier profit-lock threshold for a generic momentum runner when the broad market is flat or weak.',
    SIMULATION_GAIN_MILESTONE_ENABLED: 'Protect reached gain milestones before later exit rules can turn a profitable trade negative.',
    SIMULATION_GAIN_MILESTONES_PCT: 'Comma-separated persistent gain floors. Defaults to 0.5%, 1%, 1.5%, and 2%.',
    SIMULATION_LONG_FLAT_MARKET_ABS_PCT: 'Absolute Nifty change treated as flat when selecting the adaptive long profit-lock threshold.',
    SIMULATION_MOMENTUM_RUNNER_MAX_VWAP_EXTENSION_PCT: 'Setup-specific maximum VWAP extension for Momentum Runner entries.',
    SIMULATION_MOMENTUM_RUNNER_ENABLED: 'Allows Momentum Runner candidates to open new simulation trades.',
    SIMULATION_MOMENTUM_CATALYST_ENABLED: 'Allow fresh directional company news to adjust momentum candidate ranking without bypassing entry eligibility.',
    SIMULATION_MOMENTUM_CATALYST_MIN_ABS_IMPACT: 'Minimum absolute classified news-impact score required before momentum ranking is adjusted.',
    SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT: 'Maximum positive or negative momentum decision-score adjustment contributed by fresh company news.',
    SIMULATION_MOMENTUM_CATALYST_MAX_AGE_HOURS: 'Maximum news age accepted for a momentum catalyst ranking adjustment.',
    SIMULATION_RUNNER_MIN_CHANGE_5M_PCT: 'Minimum positive five-minute price change for long momentum runners unless a completed VWAP reclaim is confirmed.',
    SIMULATION_RUNNER_ALLOW_CONFIRMED_VWAP_RECLAIM: 'Allow a runner with weaker five-minute momentum only after a completed bullish VWAP reclaim.',
    SIMULATION_RUNNER_REQUIRE_SECTOR_ALIGNMENT_OR_RS: 'Require momentum runners to be sector aligned or show strong stock-relative strength.',
    SIMULATION_RUNNER_MIN_STRONG_RS_PCT: 'Minimum stock return over Nifty return that qualifies as strong relative strength for a runner.',
    SIMULATION_RUNNER_CHASE_MAX_DAY_GAIN_PCT: 'Maximum existing day gain for an ordinary momentum-runner entry.',
    SIMULATION_RUNNER_CHASE_MAX_IMPULSE_AGE_MIN: 'Maximum age of the completed entry impulse for a momentum-runner entry.',
    SIMULATION_RUNNER_MAX_BELOW_RECENT_HIGH_PCT: 'Maximum distance below the prior impulse high accepted without a fresh breakout or completed VWAP reclaim.',
    SIMULATION_RUNNER_MAX_RECENT_HIGH_AGE_MIN: 'Maximum age of the prior impulse high accepted without a fresh breakout or completed VWAP reclaim.',
    SIMULATION_RANGEBOUND_ENABLED: 'Enables 45-minute range detection and lower-bound mean-reversion entries.',
    SIMULATION_RANGEBOUND_LIQUIDITY_GATE_ENABLED: 'Applies live order-book spread, depth and imbalance checks to Rangebound entries when Sharekhan depth is available.',
    SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH: 'Blocks Rangebound entries when fresh live order-book depth is unavailable instead of applying gates opportunistically.',
    SIMULATION_RANGEBOUND_MAX_DEPTH_AGE_SEC: 'Maximum age in seconds accepted for live order-book depth used by Rangebound entries.',
    SIMULATION_RANGEBOUND_MAX_SPREAD_PCT: 'Maximum best bid-to-ask spread as a percentage of midpoint accepted for Rangebound entries.',
    SIMULATION_RANGEBOUND_MIN_BOOK_IMBALANCE: 'Minimum bid quantity divided by combined bid and ask quantity required for a Rangebound long entry.',
    SIMULATION_RANGEBOUND_MIN_COMBINED_DEPTH_QTY: 'Minimum combined live bid and ask quantity required across available market-depth levels.',
    SIMULATION_GAP_AND_GO_ENABLED: 'Enable the distinct first-hour Gap and Go setup on either side of the market.',
    SIMULATION_GAP_AND_GO_MIN_GAP_PCT: 'Minimum absolute opening gap required for Gap and Go.',
    SIMULATION_GAP_AND_GO_MAX_GAP_PCT: 'Maximum absolute opening gap allowed before Gap and Go is considered too extended.',
    SIMULATION_GAP_AND_GO_ENTRY_CUTOFF_MIN: 'IST minute after which new Gap and Go entries are blocked.',
    SIMULATION_GAP_AND_GO_MIN_REL_VOL: 'Minimum time-adjusted relative volume required for Gap and Go.',
    SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_3M: 'Minimum fresh three-minute volume ratio accepted for Gap and Go.',
    SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_5M: 'Minimum fresh five-minute volume ratio accepted for Gap and Go.',
    SIMULATION_VOLUME_SHOCK_BREAKOUT_ENABLED: 'Allows Volume Shock Breakout candidates to open new simulation trades.',
    SIMULATION_FRESH_BREAKOUT_ENABLED: 'Allows Fresh Breakout candidates to open new simulation trades.',
    SIMULATION_VWAP_PULLBACK_ENABLED: 'Allows VWAP Pullback or Hold candidates to open new simulation trades.',
    SIMULATION_VWAP_TREND_CONTINUATION_ENABLED: 'Allows VWAP Trend Continuation candidates to open new simulation trades.',
    SIMULATION_LONG_MOMENTUM_ENABLED: 'Allows general Long Momentum candidates to open new simulation trades.',
    SIMULATION_RANGEBOUND_WINDOW_MIN: 'Intraday lookback window in minutes used to identify a rangebound stock.',
    SIMULATION_RANGEBOUND_ENTRY_START_MIN: 'Earliest IST minute when a rangebound setup may open a new position.',
    SIMULATION_RANGEBOUND_ENTRY_CUTOFF_MIN: 'IST minute when new rangebound entries stop for the day.',
    SIMULATION_RANGEBOUND_MIN_RANGE_PCT: 'Minimum percentage distance between the detected lower and upper range boundaries.',
    SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT: 'Maximum live-price distance above the lower boundary accepted for a rangebound buy.',
    SIMULATION_RANGEBOUND_MIN_TOUCHES_PER_SIDE: 'Minimum number of candles that must touch each side of the detected range.',
    SIMULATION_RANGEBOUND_MIN_MIDPOINT_CROSSES: 'Minimum close-price crossings through the range midpoint required to prove oscillation.',
    SIMULATION_RANGEBOUND_MIN_SCORE: 'Setup-specific decision-score floor for rangebound lower-bound entries.',
    SIMULATION_RANGEBOUND_POSITION_MULTIPLIER: 'Position-size multiplier for the lower-criteria rangebound setup.',
    SIMULATION_RANGEBOUND_MIN_NET_PROFIT_PCT: 'Minimum modeled net profit accepted for a rangebound lower-to-upper move.',
    SIMULATION_RANGEBOUND_MIN_GROSS_TO_COST_MULTIPLE: 'Minimum rangebound gross move as a multiple of modeled costs.',
    SIMULATION_RANGEBOUND_MAX_NIFTY_DECLINE_PCT: 'Maximum Nifty decline tolerated by a rangebound long entry.',
    SIMULATION_RANGEBOUND_MIN_BREADTH_PCT: 'Minimum advancing-market breadth accepted by a rangebound long entry.',
    SIMULATION_RANGEBOUND_MIN_SECTOR_PCT: 'Minimum sector change accepted by a rangebound long entry.',
    SIMULATION_RANGEBOUND_MIN_RS_PCT: 'Minimum stock-relative strength accepted by a rangebound long entry.',
    SIMULATION_FRAGMENTED_MARKET_FILTER_ENABLED: 'In a flat Nifty with weak Bank Nifty and Smallcap indices, restrict longs to dominant-sector leaders.',
    SIMULATION_FRAGMENTED_MARKET_FLAT_NIFTY_ABS_PCT: 'Maximum absolute Nifty change treated as flat by the fragmented-market filter.',
    SIMULATION_FRAGMENTED_MARKET_MAX_BANK_PCT: 'Maximum Bank Nifty change that participates in the fragmented-market filter.',
    SIMULATION_FRAGMENTED_MARKET_MAX_SMALLCAP_PCT: 'Maximum Smallcap change that participates in the fragmented-market filter.',
    SIMULATION_DOMINANT_LEADER_MAX_SECTOR_RANK: 'Maximum directional sector rank that qualifies as dominant in a fragmented market.',
    SIMULATION_DOMINANT_LEADER_MIN_SECTOR_PCT: 'Minimum sector change for a long to qualify as a dominant-sector leader.',
    SIMULATION_DOMINANT_LEADER_MIN_SECTOR_BREADTH_PCT: 'Minimum directional sector breadth for a dominant-sector leader.',
    SIMULATION_DOMINANT_LEADER_MIN_RS_PCT: 'Minimum stock-relative strength for a dominant-sector leader.',
    SIMULATION_MIN_GROSS_TO_COST_MULTIPLE: 'Minimum expected gross move as a multiple of modeled round-trip charges plus slippage.',
    SIMULATION_MANUAL_ENTRY_MAX_LIVE_DEVIATION_PCT: 'Maximum allowed difference between a manual order price and the validated live candidate price.',
    SIMULATION_ENTRY_TRIGGER_FREEZE_ENABLED: 'Freeze an armed entry trigger so completed-candle confirmation is not measured against a moving trigger.',
    SIMULATION_ENTRY_TRIGGER_FREEZE_MIN: 'Minutes an armed entry trigger remains frozen before it may re-arm at a new level.',
    SIMULATION_EARLY_MOMENTUM_ENABLED: 'Allow lower-weight EMA5/EMA9, RSI7 and higher-close evidence while full intraday indicators are warming up.',
    SIMULATION_EARLY_MOMENTUM_MIN_SCORE: 'Independent minimum score for the early-momentum setup.',
    SIMULATION_EARLY_MOMENTUM_MIN_REL_VOL: 'Minimum time-adjusted relative volume required for early momentum.',
    SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_3M: 'Minimum fresh three-minute volume ratio required for early momentum.',
    SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_5M: 'Minimum fresh five-minute volume ratio required for early momentum.',
    SIMULATION_EARLY_MOMENTUM_ENTRY_CUTOFF_MIN: 'IST minute after which new early-momentum entries are blocked.',
    SIMULATION_EARLY_MOMENTUM_REQUIRE_SECTOR_ALIGNMENT_OR_RS: 'Require early momentum to have sector alignment or strong stock-relative strength when market evidence is available.',
    SIMULATION_EARLY_MOMENTUM_MIN_STRONG_RS_PCT: 'Minimum stock-relative strength accepted instead of sector alignment for early momentum.',
    SIMULATION_TOP_GAINER_CONTINUATION_ENABLED: 'Enables the dedicated top-gainer continuation setup.',
    SIMULATION_TOP_GAINER_COUNT: 'Number of highest day-change stocks treated as the top-gainer candidate pool.',
    SIMULATION_TOP_GAINER_MIN_DAY_GAIN_PCT: 'Minimum day gain required for a top-gainer continuation entry.',
    SIMULATION_TOP_GAINER_MAX_DAY_GAIN_PCT: 'Maximum day gain allowed before a top-gainer continuation is considered overextended.',
    SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_3M: 'Minimum fresh three-minute volume ratio accepted by top-gainer continuation.',
    SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_5M: 'Minimum fresh five-minute volume ratio accepted by top-gainer continuation.',
    SIMULATION_TOP_GAINER_MIN_REL_VOL: 'Fallback minimum time-adjusted relative volume for top-gainer continuation.',
    SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT: 'Maximum entry extension above the trigger for top-gainer continuation.',
    SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT: 'Maximum entry extension above VWAP for top-gainer continuation.',
    SIMULATION_TOP_GAINER_AVOID_START_MIN: 'Start of the IST minute window in which new top-gainer continuation entries are blocked.',
    SIMULATION_TOP_GAINER_AVOID_END_MIN: 'End of the IST minute window in which new top-gainer continuation entries are blocked.',
    SIMULATION_TOP_GAINER_PROFIT_LOCK_PCT: 'Favorable move that books a partial top-gainer profit and arms the remainder trail.',
    SIMULATION_TOP_GAINER_PARTIAL_QTY_PCT: 'Percentage of a top-gainer position booked when its profit lock is reached.',
    SIMULATION_TOP_GAINER_TRAIL_PCT: 'Trailing distance applied to the remaining top-gainer position after profit lock.',
    SIMULATION_TOP_GAINER_PULLBACK_RECLAIM_ENABLED: 'Enable a half-sized top-gainer entry only after a completed VWAP pullback and bullish reclaim.',
    SIMULATION_TOP_GAINER_PULLBACK_MIN_DAY_GAIN_PCT: 'Minimum day gain for a top-gainer pullback-reclaim candidate.',
    SIMULATION_TOP_GAINER_PULLBACK_MAX_DAY_GAIN_PCT: 'Maximum day gain for a top-gainer pullback-reclaim candidate.',
    SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_EXTENSION_PCT: 'Maximum entry extension above VWAP after a top-gainer reclaim.',
    SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_TOUCH_PCT: 'Maximum distance from VWAP that counts as the required pullback touch.',
    SIMULATION_TOP_GAINER_PULLBACK_POSITION_MULTIPLIER: 'Position-size multiplier for top-gainer pullback-reclaim entries.',
    SIMULATION_EMERGENCY_STOP_PCT: 'Hard adverse move percent from entry that can exit immediately, even during stop grace.',
    SIMULATION_RUNNER_MIN_SCORE: 'Minimum trade score required for momentum-runner entries.',
    SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER: 'Initial Momentum Runner quantity multiplier; the remaining planned quantity is added only after scale-in confirmation.',
    SIMULATION_RUNNER_SCALE_IN_ENABLED: 'Allow a half-sized Momentum Runner to add its remaining planned quantity after favourable movement while holding VWAP and trigger.',
    SIMULATION_RUNNER_SCALE_IN_MIN_MFE_PCT: 'Minimum Momentum Runner favourable excursion required before adding the remaining planned quantity.',
    SIMULATION_RUNNER_INITIAL_STOP_PCT: 'Momentum Runner stop-loss distance as a percentage of the weighted-average entry price.',
    SIMULATION_RUNNER_STOP_ATR_MULTIPLIER: 'Minimum ATR multiple used for a momentum-runner initial stop so normal volatility does not cause an immediate exit.',
    SIMULATION_RUNNER_MAX_INITIAL_STOP_PCT: 'Maximum initial momentum-runner stop distance as a percentage of entry price.',
    SIMULATION_RUNNER_MIN_REL_VOL: 'Minimum relative volume required for momentum-runner entries.',
    SIMULATION_RUNNER_MAX_DAY_CHANGE_PCT: 'Maximum day gain allowed for normal momentum-runner entries unless fresh shock/high breakout confirms continuation.',
    SIMULATION_RUNNER_LATE_SIZE_REDUCTION_DAY_CHANGE_PCT: 'Day gain where momentum-runner sizing is reduced because the move is already extended.',
    SIMULATION_RUNNER_LATE_SIZE_FACTOR: 'Quantity multiplier applied to late momentum-runner entries.',
    SIMULATION_RUNNER_REQUIRE_BULLISH_SUPERTREND: 'When true, buy-side momentum runners require bullish SuperTrend.',
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_3M: 'Minimum recent 3-minute volume impulse accepted for momentum-runner entries unless a fresh high breakout confirms.',
    SIMULATION_RUNNER_MIN_VOLUME_RATIO_5M: 'Minimum recent 5-minute volume impulse accepted for momentum-runner entries unless a fresh high breakout confirms.',
    SIMULATION_RUNNER_LATE_BREAKOUT_MIN_VOLUME_RATIO_5M: 'Minimum 5-minute volume impulse required when a late runner is allowed by a fresh high breakout.',
    SIMULATION_RUNNER_LATE_STRICT_START_MIN: 'IST minute of day when momentum-runner entries switch to stricter late-entry filters.',
    SIMULATION_RUNNER_ENTRY_CUTOFF_MIN: 'IST minute of day after which new momentum-runner entries are blocked.',
    SIMULATION_RUNNER_LATE_MAX_DAY_CHANGE_PCT: 'Maximum day gain allowed for momentum-runner entries during the late strict window.',
    SIMULATION_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT: 'Maximum trigger extension allowed for confirmed momentum-runner entries during the late strict window.',
    SIMULATION_EARLY_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT: 'Maximum trigger extension allowed for early momentum-runner entries during the late strict window.',
    SIMULATION_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for confirmed momentum-runner entries during the late strict window.',
    SIMULATION_EARLY_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for early momentum-runner entries during the late strict window.',
    SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_3M: 'Minimum recent 3-minute volume impulse required during the late strict momentum-runner window.',
    SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_5M: 'Minimum recent 5-minute volume impulse required during the late strict momentum-runner window.',
    SIMULATION_EARLY_RUNNER_MIN_SCORE: 'Lower score floor for early momentum-runner entries when volume, trend, and breakout confirmations are already aligned.',
    SIMULATION_EARLY_RUNNER_MIN_REL_VOL: 'Minimum relative volume required for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MIN_DAY_CHANGE_PCT: 'Minimum day gain required for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MAX_DAY_CHANGE_PCT: 'Maximum day gain allowed before early momentum-runner entries are considered too late.',
    SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 'Maximum trigger extension allowed for early momentum-runner entries.',
    SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for early momentum-runner entries.',
    SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT: 'Maximum allowed price extension above the trigger for momentum-runner entries.',
    SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT: 'Maximum allowed price extension above VWAP for momentum-runner entries.',
    SIMULATION_STRONG_BREAKOUT_MIN_SCORE: 'Lower score floor for strong volume-shock or high-relative-volume fresh breakouts.',
    SIMULATION_FRESH_BREAKOUT_MIN_SCORE: 'Independent minimum score for normal fresh-breakout entries; momentum runners use their own score thresholds.',
    SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_3M: 'Minimum recent 3-minute volume ratio accepted for a fresh breakout when the 5-minute ratio does not qualify.',
    SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_5M: 'Minimum recent 5-minute volume ratio accepted for a fresh breakout when the 3-minute ratio does not qualify.',
    SIMULATION_FRESH_BREAKOUT_MIN_NIFTY_CHANGE_PCT: 'Minimum Nifty session change required for a long fresh-breakout entry.',
    SIMULATION_FRESH_BREAKOUT_MIN_BREADTH_PCT: 'Minimum percentage of advancing candidates required for a long fresh-breakout entry.',
    SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL: 'Minimum relative volume required for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT: 'Minimum day gain required for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT: 'Maximum day gain allowed for strong volume-breakout score relaxation.',
    SIMULATION_STRONG_BREAKOUT_MAX_RSI: 'Maximum RSI allowed for strong volume-breakout score relaxation.',
    SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT: 'Normal maximum VWAP extension allowed for fresh-breakout entries.',
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for fresh breakouts when relative volume is high.',
    SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL: 'Relative-volume threshold that allows the relaxed fresh-breakout VWAP extension.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_SCORE: 'Lower score floor for quality fresh breakouts that narrowly miss the general long score threshold.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_REL_VOL: 'Minimum relative volume required for the quality fresh-breakout near-miss relaxation.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_TRIGGER_EXTENSION_PCT: 'Maximum trigger extension allowed for quality fresh breakouts under near-miss relaxation.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_VWAP_EXTENSION_PCT: 'Maximum VWAP extension allowed for quality fresh breakouts under near-miss relaxation.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_CONFIRMATIONS: 'Minimum breakout confirmations required for quality fresh-breakout near-miss relaxation.',
    SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_RSI: 'Maximum RSI allowed for quality fresh-breakout near-miss relaxation.',
    SIMULATION_BULL_FLAG_CONTINUATION_ENABLED: 'Enable a distinct long continuation after an established advance and tight higher-low consolidation.',
    SIMULATION_BULL_FLAG_MIN_DAY_GAIN_PCT: 'Minimum existing day gain required before a bull-flag continuation can form.',
    SIMULATION_BULL_FLAG_MAX_DAY_GAIN_PCT: 'Maximum existing day gain allowed before a bull-flag continuation is considered extended.',
    SIMULATION_BULL_FLAG_MIN_CONSOLIDATION_CANDLES: 'Minimum tight higher-low consolidation candles required before a bull-flag breakout.',
    SIMULATION_BULL_FLAG_MAX_CONSOLIDATION_WIDTH_PCT: 'Maximum high-to-low width of the bull-flag consolidation.',
    SIMULATION_BULL_FLAG_MIN_POLE_GAIN_PCT: 'Minimum bullish body gain required in the flagpole candle immediately before consolidation.',
    SIMULATION_BULL_FLAG_MIN_POLE_VOLUME_MULTIPLE: 'Minimum flagpole volume as a multiple of average consolidation-candle volume.',
    SIMULATION_BULL_FLAG_MAX_VWAP_EXTENSION_PCT: 'Maximum price extension above VWAP for a bull-flag continuation entry.',
    SIMULATION_RUNNER_TRAIL_PCT: 'Normal trailing stop percent used for momentum-runner exits.',
    SIMULATION_RUNNER_WIDE_TRAIL_PCT: 'Wider trailing stop percent used when momentum remains strong.',
    SIMULATION_RUNNER_TARGET_STEP_PCT: 'Next target step percent applied to remaining runner quantity after a momentum-confirmed partial target.',
    SIMULATION_BREAKEVEN_PROTECT_PCT: 'Favorable move percent after which simulation protects capital around breakeven.',
    SIMULATION_BREAKEVEN_MIN_HOLD_MIN: 'Minimum holding time before breakeven protection may close a trade.',
    SIMULATION_BREAKEVEN_COST_BUFFER_PCT: 'Extra favorable-price buffer above estimated round-trip costs for breakeven protection.',
    SIMULATION_TRAIL_START_PCT: 'Favorable move percent after which non-runner positions start using a trailing-profit guard.',
    SIMULATION_LONG_TRAIL_PCT: 'Trailing stop percent used for long positions after enough profit cushion is built.',
    SIMULATION_TIME_STOP_MIN: 'Minutes after entry before a non-performing trade can be exited by time-stop logic.',
    SIMULATION_TIME_STOP_MIN_PROFIT_PCT: 'Minimum favorable move expected by the time-stop window before a weak trade can be closed.',
    SIMULATION_EXIT_MIN_HOLD_MIN: 'Minimum hold time before VWAP-loss or momentum-fade exits can close a trade.',
    SIMULATION_EXIT_FADE_CONFIRM_BARS: 'Number of consecutive completed candles required before VWAP-loss or momentum-fade exits are confirmed.',
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
    SIMULATION_EXPECTANCY_ENABLED: 'Uses realized net outcomes to calibrate candidate ranking and block sufficiently sampled negative-expectancy score bands.',
    SIMULATION_EXPECTANCY_MIN_SAMPLE: 'Minimum closed positions required before realized expectancy can adjust a candidate score.',
    SIMULATION_EXPECTANCY_BLOCK_MIN_SAMPLE: 'Minimum exact setup and score-band sample required before negative expectancy can block an entry.',
    SIMULATION_EXPECTANCY_MIN_NET_PCT: 'Minimum average realized net return required for a sufficiently sampled setup and score band.',
    SIMULATION_EXPECTANCY_MIN_PROFIT_FACTOR: 'Minimum realized profit factor required for a sufficiently sampled setup and score band.',
    SIMULATION_EXPECTANCY_LOOKBACK_TRADES: 'Maximum recent closed positions used to calibrate net expectancy.',
    SIMULATION_EXPECTANCY_MAX_SCORE_ADJUSTMENT: 'Maximum positive or negative score adjustment contributed by realized net expectancy.',
    SIMULATION_MIN_SCORE: 'Minimum general long-side trade score required before simulation can consider a buy candidate.',
    SIMULATION_MAX_POSITION_MULTIPLIER: 'Hard ceiling for the portfolio-level simulation position multiplier; 1 prevents sizing above the normal risk budget.',
    SIMULATION_SHORT_MIN_SCORE: 'Minimum absolute short-side score required before simulation can consider a sell candidate.',
    SIMULATION_SHORT_MIN_REL_VOL: 'Minimum time-adjusted relative volume required for short breakdown or VWAP-rejection entries.',
    SIMULATION_SHORT_ALLOW_AVOID_GUARD: 'Allows risk guard level Avoid for short entries. Some long-side avoid reasons are actually bearish confirmations for shorts.',
    SIMULATION_SHORT_TRIGGER_DISTANCE_PCT: 'Maximum distance from current price to short trigger before it is flagged as too far for intraday short analysis.',
    SIMULATION_SHORT_CONFIRM_BARS: 'Number of triggered below-VWAP snapshots required to confirm short breakdown entries.',
    SIMULATION_SHORT_REQUIRE_COMPLETED_CANDLE: 'Require a completed breakdown candle followed by a live trigger and VWAP rejection hold for shorts.',
    SIMULATION_SHORT_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION: 'Require fresh 3m or 5m selling volume after the completed short confirmation candle.',
    SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_3M: 'Minimum post-confirmation three-minute volume ratio for shorts.',
    SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_5M: 'Minimum post-confirmation five-minute volume ratio for shorts.',
    SIMULATION_SHORT_MAX_CONFIRM_LOWER_WICK_RATIO: 'Maximum lower-wick share of the confirming short candle range.',
    SIMULATION_SHORT_LATE_DEEP_DECLINE_GUARD_ENABLED: 'Block late shorts after a deep existing decline unless a completed VWAP/trigger rejection is confirmed.',
    SIMULATION_SHORT_LATE_DEEP_DECLINE_START_MIN: 'IST minute after which the deep-decline short guard applies.',
    SIMULATION_SHORT_LATE_DEEP_DECLINE_MAX_PCT: 'Maximum existing day decline allowed for an ordinary late short without a retest rejection.',
    SIMULATION_SHORT_LATE_ACCELERATION_ENABLED: 'Require multiple fresh downside-acceleration signals for short entries after the configured late-start time.',
    SIMULATION_SHORT_LATE_ACCELERATION_START_MIN: 'IST minute after which the short acceleration gate applies.',
    SIMULATION_SHORT_LATE_ACCELERATION_MIN_SIGNALS: 'Minimum qualifying stock, candle, Nifty-new-low and sector-new-low signals for a late short; four requires full alignment.',
    SIMULATION_SHORT_LATE_ACCELERATION_REQUIRE_STOCK_SIGNAL: 'Require stock-level five-minute downside acceleration in addition to the multi-signal late-short threshold.',
    SIMULATION_SHORT_LATE_ACCELERATION_MAX_CHANGE_5M_PCT: 'Maximum five-minute stock change that qualifies as fresh downside acceleration.',
    SIMULATION_SHORT_LATE_ACCELERATION_MAX_CLOSE_POSITION: 'Maximum candle close position within its range; 0.30 means the bottom 30%.',
    SIMULATION_SHORT_LATE_ACCELERATION_LOOKBACK_MIN: 'Lookback window used to test whether Nifty and the stock sector are making new lows.',
    SIMULATION_BEAR_FLAG_CONTINUATION_ENABLED: 'Enable a distinct short continuation after an initial breakdown and multi-candle bear-flag consolidation.',
    SIMULATION_BREAKDOWN_ENABLED: 'Allows Breakdown candidates to open new short simulation trades.',
    SIMULATION_VWAP_REJECTION_ENABLED: 'Allows VWAP Rejection candidates to open new short simulation trades.',
    SIMULATION_BEAR_FLAG_MIN_DAY_DECLINE_PCT: 'Minimum existing day decline required for a bear-flag continuation.',
    SIMULATION_BEAR_FLAG_MAX_DAY_DECLINE_PCT: 'Maximum existing day decline allowed for a bear-flag continuation.',
    SIMULATION_BEAR_FLAG_MIN_CONSOLIDATION_CANDLES: 'Minimum consolidation candles required before a bear-flag breakdown.',
    SIMULATION_BEAR_FLAG_MAX_VWAP_EXTENSION_PCT: 'Maximum price extension below VWAP for a bear-flag continuation entry.',
    SIMULATION_SHORT_PROFIT_LOCK_PCT: 'Favorable short move that books a partial profit and protects the remainder for costs.',
    SIMULATION_SHORT_PROFIT_LOCK_PARTIAL_QTY_PCT: 'Short quantity booked when the short profit lock activates.',
    SIMULATION_SHORT_MAX_STOP_PCT: 'Maximum stop-loss distance allowed for short entries.',
    SIMULATION_SHORT_TRAIL_PCT: 'Trailing stop percent used after a short trade moves sufficiently in favor.',
    SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS: 'Minimum bearish confirmation count required for short entries, using VWAP, EMA, SuperTrend, RSI, trigger and score alignment.',
    SIMULATION_REQUIRE_NIFTY_FOR_SHORTS: 'When true, short entries are blocked if Nifty regime data is unavailable.',
    SIMULATION_SHORT_MARKET_GUARD_STRICT: 'When true, shorts use stricter Nifty, breadth, sector, and relative-strength thresholds than long-side market regime checks.',
    SIMULATION_SHORT_MARKET_REGIME_NIFTY_PCT: 'Nifty gain threshold that blocks new short entries when strict short market guard is enabled.',
    SIMULATION_SHORT_MARKET_BREADTH_PCT: 'Advance breadth threshold that blocks new short entries when strict short market guard is enabled.',
    SIMULATION_SHORT_MARKET_REGIME_SECTOR_PCT: 'Sector gain threshold that blocks new short entries when strict short market guard is enabled.',
    SIMULATION_SHORT_MARKET_REGIME_RS_PCT: 'Relative-strength threshold that blocks new short entries when strict short market guard is enabled.',
    SIMULATION_MARKET_BREADTH_PCT: 'Advance/decline breadth threshold used by the market-regime guard when breadth data is available.',
    SIMULATION_MARKET_REGIME_NIFTY_PCT: 'Nifty change threshold used by the market-regime guard. Long entries are blocked below negative threshold; short entries are blocked above positive threshold.',
    SIMULATION_MARKET_REGIME_SECTOR_PCT: 'Sector average change threshold used by the market-regime guard. Long entries are blocked when sector is weaker than this negative threshold; shorts are blocked when sector is stronger than this positive threshold.',
    SIMULATION_MARKET_REGIME_RS_PCT: 'Relative strength threshold against Nifty used by the market-regime guard. Long entries need stock RS above negative threshold; shorts need stock RS below positive threshold.',
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_ENABLED: 'Allows a triggered high-score momentum runner or top-gainer continuation in a strongly positive sector to ignore only a mild negative-Nifty conflict. Breadth, sector, relative-strength, setup, cost, stop, heat, and daily-risk guards still apply.',
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SECTOR_PCT: 'Minimum sector average gain required for the long sector-relative-strength Nifty override.',
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SCORE: 'Minimum long score required for the sector-relative-strength Nifty override.',
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_RS_PCT: 'Minimum stock relative strength versus Nifty required for the sector-relative-strength Nifty override.',
    SIMULATION_LONG_SECTOR_RS_OVERRIDE_MAX_NIFTY_DECLINE_PCT: 'Largest Nifty decline that the long sector-relative-strength override may tolerate.',
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

  function getIstDay(value) {
    const d = new Date(value || Date.now());
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() + 5.5 * 3600 * 1000).getUTCDay();
  }

  function isSimulationEntryWindow(value, settings = {}) {
    settings = withDefaults(settings);
    const day = getIstDay(value);
    const mins = getIstMinutes(value);
    return day >= 1 && day <= 5 && mins >= Number(settings.SIMULATION_ENTRY_START_MIN) && mins < Number(settings.SIMULATION_ENTRY_END_MIN);
  }

  function isSimulationEodSettlement(value, settings = {}) {
    settings = withDefaults(settings);
    const day = getIstDay(value);
    const mins = getIstMinutes(value);
    return day === 0 || day === 6 || mins >= Number(settings.SIMULATION_EOD_SETTLEMENT_MIN);
  }

  function shouldAutoStopSimulation(value, settings = {}) {
    settings = withDefaults(settings);
    const day = getIstDay(value);
    const mins = getIstMinutes(value);
    return day >= 1 && day <= 5 && mins >= Number(settings.SIMULATION_AUTO_STOP_MIN);
  }

  function computePortfolioEquity(portfolio = {}, trades = [], fallbackCapital = 500000) {
    const base = Number(portfolio.initialCapital) > 0 ? Number(portfolio.initialCapital) : Number(fallbackCapital) || 500000;
    const added = Array.isArray(portfolio.capitalAdds) ? portfolio.capitalAdds.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0) : 0;
    const closed = (Array.isArray(trades) ? trades : []).filter(t => String(t?.status || '').toLowerCase() === 'closed');
    const open = (Array.isArray(trades) ? trades : []).filter(t => String(t?.status || '').toLowerCase() === 'open');
    const realized = closed.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
    const openExposure = open.reduce((sum, trade) => sum + (Number(trade.reservedCapital) || Number(trade.entryPrice) * Number(trade.qty) || 0), 0);
    const capital = base + added;
    return { base, added, capital, realized, equity: capital + realized, openExposure, cashAvailable: Math.max(0, capital + realized - openExposure) };
  }

  function computePortfolioHeat(trades = [], equity = 0) {
    const open = (Array.isArray(trades) ? trades : []).filter(t => String(t?.status || '').toLowerCase() === 'open');
    let risk = 0;
    const bySector = {};
    for (const trade of open) {
      const qty = Number(trade.qty), entry = Number(trade.entryPrice), stop = Number(trade.stop);
      const tradeRisk = Number.isFinite(qty) && Number.isFinite(entry) && Number.isFinite(stop) ? Math.abs(entry - stop) * qty : 0;
      risk += tradeRisk;
      const sector = String(trade.sector || 'UNKNOWN');
      bySector[sector] = (bySector[sector] || 0) + tradeRisk;
    }
    return { risk, heatPct: equity > 0 ? risk / equity * 100 : 0, bySector };
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
    const entries = dayTrades.filter(t => !isBrokerFailed(t) && (!helpers.sameDay || sameDay(t.openedAt, at)));
    const symbolEntries = entries.reduce((counts, trade) => {
      const symbol = String(trade?.symbol || '').trim().toUpperCase();
      if (symbol) counts[symbol] = (counts[symbol] || 0) + 1;
      return counts;
    }, {});
    const netPnl = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const firstHourEntries = dayTrades.filter(t => {
      const mins = getIstMinutes(t.openedAt);
      return mins != null && mins >= 9 * 60 + 15 && mins < 10 * 60 + 15;
    }).length;
    const now = at ? new Date(at).getTime() : Date.now();
    const rollingWindowMin = Math.max(1, Number(settings.SIMULATION_ROLLING_ENTRY_WINDOW_MIN) || 5);
    const rollingWindowMs = rollingWindowMin * 60000;
    const rollingEntries = entries.filter(trade => {
      const openedAt = new Date(trade?.openedAt || 0).getTime();
      return Number.isFinite(openedAt) && openedAt <= now && now - openedAt < rollingWindowMs;
    }).length;
    const rollingEntryTrades = entries.filter(trade => {
      const openedAt = new Date(trade?.openedAt || 0).getTime();
      return Number.isFinite(openedAt) && openedAt <= now && now - openedAt < rollingWindowMs;
    });
    const isSectorAlignedEntry = trade => !!(trade?.entryContext?.sectorAligned || trade?.sectorPriority?.aligned);
    return {
      trades: dayTrades,
      dayTrades,
      closed,
      entries: entries.length,
      symbolEntries,
      firstHourEntries,
      rollingEntries,
      rollingOrdinaryEntries:rollingEntryTrades.filter(trade => !isSectorAlignedEntry(trade)).length,
      rollingSectorEntries:rollingEntryTrades.filter(isSectorAlignedEntry).length,
      stops: closed.filter(isLosingStopExit).length,
      dailyStopLimit: getEffectiveStopLimit(netPnl, settings),
      netPnl:+netPnl.toFixed(2),
      netLossPct:+Math.max(0, (-netPnl / Math.max(1, Number(settings.PORTFOLIO_INITIAL_CAPITAL) || 1)) * 100).toFixed(3),
    };
  }

  function getEntryBlockReason(sym, setupType = '', at = Date.now(), stats = {}, settings = {}) {
    settings = withDefaults(settings);
    if ((Number(stats.entries) || 0) >= settings.SIMULATION_DAILY_MAX_TRADES) return `daily trade limit ${settings.SIMULATION_DAILY_MAX_TRADES}`;
    const rollingEntryMax = Math.max(0, Math.floor(Number(settings.SIMULATION_ROLLING_ENTRY_MAX) || 0));
    const rollingWindowMin = Math.max(1, Number(settings.SIMULATION_ROLLING_ENTRY_WINDOW_MIN) || 5);
    if (rollingEntryMax > 0 && (Number(stats.rollingEntries) || 0) >= rollingEntryMax) {
      return `rolling entry limit ${rollingEntryMax}/${rollingWindowMin}m`;
    }
    const symbol = String(sym || '').trim().toUpperCase();
    const symbolEntryLimit = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_DAILY_ENTRIES_PER_SYMBOL) || 0));
    const symbolEntryCount = Number(stats.symbolEntries?.[symbol]) || 0;
    if (symbol && symbolEntryLimit > 0 && symbolEntryCount >= symbolEntryLimit) {
      return `daily symbol entry limit ${symbolEntryLimit}`;
    }
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

  function computePositionSizeMultiplier(closedTrades) {
    // Reduce position size when losing streak develops
    if (!Array.isArray(closedTrades) || closedTrades.length === 0) {
      return 1.0; // Full size on first trade
    }

    const recentTrades = closedTrades.slice(-10);
    const wins = recentTrades.filter(t => Number(t.pnl) > 0).length;
    const losses = recentTrades.filter(t => Number(t.pnl) < 0).length;
    const winRate = recentTrades.length > 0 ? wins / recentTrades.length : 0;

    // Count current loss streak
    let currentLossStreak = 0;
    for (let i = recentTrades.length - 1; i >= 0; i--) {
      if (Number(recentTrades[i].pnl) < 0) {
        currentLossStreak += 1;
      } else {
        break;
      }
    }

    // Position sizing: scale down aggressively when losing
    let multiplier = 1.0;
    if (currentLossStreak >= 3) multiplier = 0.3;  // 3+ losses: 30% position
    else if (currentLossStreak === 2) multiplier = 0.5;  // 2 losses: 50% position
    else if (currentLossStreak === 1 && losses > wins) multiplier = 0.7;  // 1 loss + more losses than wins: 70%
    else if (winRate < 0.25 && recentTrades.length >= 4) multiplier = 0.6;  // Low win rate: 60%

    return multiplier;
  }

  return {
    DEFAULT_SETTINGS,
    SETTING_DESCRIPTIONS,
    SIMULATION_SETUP_DEFINITIONS,
    withDefaults,
    getIstMinutes,
    isSimulationEntryWindow,
    isSimulationEodSettlement,
    shouldAutoStopSimulation,
    computePortfolioEquity,
    computePortfolioHeat,
    isLosingStopExit,
    getEffectiveStopLimit,
    getProfitReentryBlockReason,
    buildDayStats,
    getEntryBlockReason,
    checkHighProfitShortTrigger,
    computePositionSizeMultiplier,
  };
});
