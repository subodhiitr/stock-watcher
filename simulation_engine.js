(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./trade_rules'));
  } else {
    root.SimulationEngine = factory(root.TradeRules);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(TradeRules) {
  'use strict';

  const DEFAULT_SETTINGS = TradeRules.DEFAULT_SETTINGS;
  const withDefaults = TradeRules.withDefaults;

  function round1(n) {
    return Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : 0;
  }

  function round2(n) {
    return Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : 0;
  }

  function round3(n) {
    return Number.isFinite(Number(n)) ? Math.round(Number(n) * 1000) / 1000 : 0;
  }

  function hasFiniteNumber(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function getCandidatePrice(candidate) {
    return Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price ?? candidate?.indicators?.price);
  }

  // Fee calculation memoization cache
  const feeCache = new Map();
  const MAX_CACHE_SIZE = 10000;

  function getCacheKey(entryPrice, exitPrice, qty, side) {
    return `${entryPrice}:${exitPrice}:${qty}:${side}`;
  }

  function memoizedEstimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side) {
    const key = getCacheKey(entryPrice, exitPrice, qty, side);

    if (feeCache.has(key)) {
      return feeCache.get(key);
    }

    const result = estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side);

    // LRU eviction: remove oldest entry if cache is full
    if (feeCache.size >= MAX_CACHE_SIZE) {
      const firstKey = feeCache.keys().next().value;
      feeCache.delete(firstKey);
    }

    feeCache.set(key, result);
    return result;
  }

  function adjustedTradeSignal(score) {
    if (score >= 35) return 'buy';
    if (score <= -35) return 'sell';
    if (Math.abs(score) >= 18) return 'watch';
    return 'hold';
  }

  function setupPriority(setupType) {
    if (setupType === 'TOP_GAINER_CONTINUATION') return 0;
    if (setupType === 'MOMENTUM_RUNNER') return 0;
    if (setupType === 'VWAP_TREND_CONTINUATION') return 1;
    if (setupType === 'BREAKDOWN') return 1;
    if (setupType === 'VWAP_PULLBACK_OR_HOLD') return 2;
    if (setupType === 'VWAP_REJECTION') return 2;
    if (setupType === 'FRESH_BREAKOUT') return 3;
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') return 4;
    if (setupType === 'LONG_MOMENTUM') return 5;
    return 9;
  }

  function isSimulationSetupAllowed(setupType) {
    return ['TOP_GAINER_CONTINUATION', 'VOLUME_SHOCK_BREAKOUT', 'BREAKDOWN', 'VWAP_REJECTION', 'FRESH_BREAKOUT', 'VWAP_PULLBACK_OR_HOLD', 'VWAP_TREND_CONTINUATION', 'MOMENTUM_RUNNER', 'LONG_MOMENTUM'].includes(setupType);
  }

  function getMinScoreForSide(settings, side) {
    settings = withDefaults(settings);
    if (side === 'sell') return Number(settings.SIMULATION_SHORT_MIN_SCORE) || Number(settings.SIMULATION_MIN_SCORE) || 0;
    return Number(settings.SIMULATION_MIN_SCORE) || 0;
  }

  function getMinScoreForCandidate(settings, side, setupType, candidate = null) {
    settings = withDefaults(settings);
    const freshBreakoutMinScore = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_SCORE) || getMinScoreForSide(settings, side);
    if (['VOLUME_SHOCK_BREAKOUT', 'FRESH_BREAKOUT'].includes(setupType) && isStrongVolumeBreakoutCandidate(candidate, settings)) {
      return Math.min(
        setupType === 'FRESH_BREAKOUT' ? freshBreakoutMinScore : getMinScoreForSide(settings, side),
        Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_SCORE) || 55
      );
    }
    if (setupType === 'FRESH_BREAKOUT' && isRelaxedFreshBreakoutCandidate(candidate, settings)) {
      return Math.min(
        freshBreakoutMinScore,
        Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_SCORE) || 72
      );
    }
    if (setupType === 'MOMENTUM_RUNNER') {
      return Math.min(
        getMinScoreForSide(settings, side),
        Number(settings.SIMULATION_RUNNER_MIN_SCORE) || getMinScoreForSide(settings, side),
        Number(settings.SIMULATION_EARLY_RUNNER_MIN_SCORE) || getMinScoreForSide(settings, side)
      );
    }
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') {
      return getMinScoreForSide(settings, side);
    }
    if (setupType === 'FRESH_BREAKOUT') return freshBreakoutMinScore;
    return getMinScoreForSide(settings, side);
  }

  function getAllowedGuardLevelsForSide(settings, side) {
    settings = withDefaults(settings);
    const levels = ['ok', 'small'];
    if (side === 'sell' && settings.SIMULATION_SHORT_ALLOW_AVOID_GUARD) levels.push('avoid');
    return levels;
  }

  function getMaxStopPctForSide(settings, side) {
    settings = withDefaults(settings);
    if (side === 'sell') return Number(settings.SIMULATION_SHORT_MAX_STOP_PCT) || 0.75;
    return 0.75;
  }

  function getTriggerDistancePct(candidate, side) {
    const trigger = getEntryTriggerPrice(candidate);
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(trigger) || trigger <= 0 || !Number.isFinite(price) || price <= 0) return null;
    const buy = side !== 'sell';
    return buy ? ((price - trigger) / trigger) * 100 : ((trigger - price) / trigger) * 100;
  }

  function getDataQualityIssues(candidate, settings) {
    settings = withDefaults(settings);
    const issues = [];
    if (!candidate) return ['missing candidate'];
    const side = candidate.side || candidate.signal || adjustedTradeSignal(Number(candidate.score) || 0);
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(price) || price <= 0) issues.push('missing live price');
    if (candidate.freshness?.stale) issues.push(candidate.freshness.reason || 'stale signal');
    const indicators = candidate.indicators || {};
    const triggerDistancePct = getTriggerDistancePct(candidate, side);
    if (side === 'sell' && triggerDistancePct != null && Math.abs(triggerDistancePct) > Number(settings.SIMULATION_SHORT_TRIGGER_DISTANCE_PCT || 1.2)) {
      issues.push(`short trigger ${round2(Math.abs(triggerDistancePct))}% from price`);
    }
    if (indicators.entryStatus && !indicators.entryTrigger) issues.push('missing entry trigger text');
    if (indicators.ohlc?.latestBar?.time && candidate.freshness?.ageMin != null && Number(candidate.freshness.ageMin) > 5) {
      issues.push(`old candle ${candidate.freshness.ageMin}m`);
    }
    return issues;
  }

  function normalizeCandidateCandle(bar) {
    if (!bar || bar.time == null || !Number.isFinite(new Date(bar.time).getTime())) return null;
    const normalized = {
      time: new Date(bar.time).toISOString(),
      open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close),
      volume: Number.isFinite(Number(bar.volume)) ? Math.max(0, Number(bar.volume)) : null,
    };
    if (!['open', 'high', 'low', 'close'].every(key => Number.isFinite(normalized[key]) && normalized[key] > 0)) return null;
    if (normalized.high < Math.max(normalized.open, normalized.close) || normalized.low > Math.min(normalized.open, normalized.close)) return null;
    return normalized;
  }

  function getCandidateCandles(candidate) {
    const bars = [
      ...(Array.isArray(candidate?.candles) ? candidate.candles : []),
      candidate?.indicators?.ohlc?.previousBar,
      candidate?.indicators?.ohlc?.latestBar,
    ]
      .map(normalizeCandidateCandle)
      .filter(Boolean);
    const byTime = new Map(bars.map(bar => [bar.time, bar]));
    return [...byTime.values()].sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  function getLatestCandidateCandle(candidate) {
    return getCandidateCandles(candidate).at(-1) || null;
  }

  function getLatestCompletedCandidateCandle(candidate, at, intervalMin = 5) {
    const atMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || 0).getTime();
    if (!Number.isFinite(atMs)) return null;
    const intervalMs = Math.max(1, Number(intervalMin) || 5) * 60000;
    return getCandidateCandles(candidate)
      .filter(bar => new Date(bar.time).getTime() + intervalMs <= atMs)
      .at(-1) || null;
  }

  function getLongEntryConfirmation(candidate, previousCandidate, side, at, settings = {}) {
    settings = withDefaults(settings);
    const tradeSide = side || candidate?.side || candidate?.signal || 'buy';
    const configuredMode = String(settings.SIMULATION_LONG_CONFIRM_MODE || 'completed_candle_hold').toLowerCase();
    const globalLongGuards = settings.SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED !== false;
    const mode = globalLongGuards && settings.SIMULATION_LONG_REQUIRE_COMPLETED_CANDLE ? 'completed_candle_hold' : configuredMode;
    if (tradeSide === 'sell') return { ok:true, mode:'not-applicable', reason:'' };
    if (mode === 'two_snapshots') {
      const currentTriggeredAboveVwap = isTriggeredAboveVwap(candidate, tradeSide);
      const previousTriggeredAboveVwap = isTriggeredAboveVwap(previousCandidate, tradeSide);
      return {
        ok:currentTriggeredAboveVwap && previousTriggeredAboveVwap,
        mode,
        reason:currentTriggeredAboveVwap && previousTriggeredAboveVwap
          ? ''
          : 'long setup needs two triggered above-VWAP snapshots',
        currentTriggeredAboveVwap,
        previousTriggeredAboveVwap,
      };
    }
    const trigger = getEntryTriggerPrice(candidate);
    const price = getCandidatePrice(candidate);
    const vwap = Number(candidate?.indicators?.vwap);
    const snapshotAt = at || candidate?.__snapshotAt || candidate?.snapshotAt || candidate?.priceTime || candidate?.quote?.time;
    const snapshotMs = new Date(snapshotAt || 0).getTime();
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const candles = [
      ...getCandidateCandles(previousCandidate),
      ...getCandidateCandles(candidate),
    ];
    const byTime = new Map(candles.map(bar => [bar.time, bar]));
    const completed = [...byTime.values()]
      .filter(bar => Number.isFinite(snapshotMs) && new Date(bar.time).getTime() + intervalMs <= snapshotMs)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const confirmingCandle = completed.at(-1) || null;
    const candleBeyondTrigger = !!confirmingCandle && Number.isFinite(trigger) && confirmingCandle.close > trigger;
    const triggerHeld = Number.isFinite(price) && Number.isFinite(trigger) && price >= trigger;
    const vwapHeld = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0 && price >= vwap;
    const shock = getVolumeShockInfo(candidate);
    const volumeRatio3m = Number(shock.volumeRatio3m);
    const volumeRatio5m = Number(shock.volumeRatio5m);
    const confirmingCandleEndMs = confirmingCandle
      ? new Date(confirmingCandle.time).getTime() + intervalMs
      : NaN;
    const volumeObservedAfterConfirmation = Number.isFinite(snapshotMs) &&
      Number.isFinite(confirmingCandleEndMs) &&
      snapshotMs > confirmingCandleEndMs;
    const freshVolumeOk = !globalLongGuards || !settings.SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION || (
      volumeObservedAfterConfirmation && (
        (Number.isFinite(volumeRatio3m) && volumeRatio3m >= Number(settings.SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_3M || 1)) ||
        (Number.isFinite(volumeRatio5m) && volumeRatio5m >= Number(settings.SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_5M || 1))
      )
    );
    const ok = candleBeyondTrigger && triggerHeld && vwapHeld && freshVolumeOk;
    let reason = '';
    if (!Number.isFinite(trigger)) reason = 'long setup needs a numeric entry trigger';
    else if (!confirmingCandle) reason = `long setup needs a completed ${intervalMin}m candle beyond the trigger`;
    else if (!candleBeyondTrigger) reason = `completed candle close ${round2(confirmingCandle.close)} did not clear trigger ${round2(trigger)}`;
    else if (!triggerHeld || !vwapHeld) reason = `post-breakout hold failed: price ${round2(price)} must hold trigger ${round2(trigger)} and VWAP ${round2(vwap)}`;
    else if (!freshVolumeOk) reason = `long setup needs fresh post-confirmation volume (${Number.isFinite(volumeRatio3m) ? round2(volumeRatio3m) : '--'}x/3m or ${Number.isFinite(volumeRatio5m) ? round2(volumeRatio5m) : '--'}x/5m)`;
    return {
      ok,
      mode:'completed_candle_hold',
      reason,
      intervalMin,
      snapshotAt:Number.isFinite(snapshotMs) ? new Date(snapshotMs).toISOString() : null,
      candle:confirmingCandle,
      candleBeyondTrigger,
      trigger,
      vwap:Number.isFinite(vwap) ? vwap : null,
      price:Number.isFinite(price) ? price : null,
      triggerHeld,
      vwapHeld,
      volumeObservedAfterConfirmation,
      volumeRatio3m:Number.isFinite(volumeRatio3m) ? volumeRatio3m : null,
      volumeRatio5m:Number.isFinite(volumeRatio5m) ? volumeRatio5m : null,
      freshVolumeOk,
    };
  }

  function getSnapshotDataQuality(candidates, settings) {
    settings = withDefaults(settings);
    const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const total = list.length;
    let bad = 0;
    for (const candidate of list) {
      if (getDataQualityIssues(candidate, settings).length) bad += 1;
    }
    const badRatio = total > 0 ? bad / total : 0;
    const minSample = Math.max(1, Math.floor(Number(settings.SIMULATION_DATA_QUALITY_MIN_SAMPLE) || 25));
    const active = total >= minSample;
    const blockRatio = Math.max(0, Number(settings.SIMULATION_DATA_QUALITY_BLOCK_BAD_RATIO) || 0.45);
    const reduceRatio = Math.max(0, Number(settings.SIMULATION_DATA_QUALITY_REDUCE_BAD_RATIO) || 0.25);
    const mode = active && badRatio >= blockRatio
      ? 'block'
      : (active && badRatio >= reduceRatio ? 'reduce' : 'normal');
    return { total, bad, good: Math.max(0, total - bad), badRatio: round3(badRatio), mode };
  }

  function getEntryTriggerPrice(candidateOrIndicators) {
    const indicators = candidateOrIndicators?.indicators || candidateOrIndicators || {};
    const text = String(indicators.entryTrigger || '');
    const match = text.match(/(?:above|below)\s+([0-9,.]+)/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getRelativeVolume(candidateOrIndicators) {
    const indicators = candidateOrIndicators?.indicators || candidateOrIndicators || {};
    const relVol = Number(indicators.relVolumeTimeAdjusted ?? indicators.relVolume);
    return Number.isFinite(relVol) ? relVol : null;
  }

  function getCandidateDayChange(candidate) {
    const indicators = candidate?.indicators || {};
    const value = Number(indicators.dayChange ?? indicators.dayChangePct ?? candidate?.change ?? candidate?.quote?.change);
    return Number.isFinite(value) ? value : null;
  }

  function annotateTopGainerRanks(candidates, settings = {}) {
    settings = withDefaults(settings);
    const source = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    for (const candidate of source) {
      delete candidate.topGainerRank;
      if (candidate.indicators && typeof candidate.indicators === 'object') delete candidate.indicators.topGainerRank;
    }
    if (!settings.SIMULATION_TOP_GAINER_CONTINUATION_ENABLED) return source;
    const count = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_GAINER_COUNT) || 5));
    source
      .filter(candidate => String(candidate?.assetType || 'stock').toLowerCase() !== 'etf')
      .map(candidate => ({ candidate, dayChange:getCandidateDayChange(candidate) }))
      .filter(item => Number.isFinite(item.dayChange))
      .sort((a, b) => b.dayChange - a.dayChange)
      .slice(0, count)
      .forEach((item, index) => {
        item.candidate.topGainerRank = index + 1;
        if (item.candidate.indicators && typeof item.candidate.indicators === 'object') {
          item.candidate.indicators.topGainerRank = index + 1;
        }
      });
    return source;
  }

  function getTopGainerContinuationInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_TOP_GAINER_CONTINUATION_ENABLED) {
      return { ok:false, reason:'top-gainer continuation disabled' };
    }
    const side = candidate?.side || candidate?.signal || 'buy';
    const indicators = candidate?.indicators || {};
    const rank = Number(candidate?.topGainerRank ?? indicators.topGainerRank);
    const count = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_GAINER_COUNT) || 5));
    const dayChange = getCandidateDayChange(candidate);
    const minDayGain = Number(settings.SIMULATION_TOP_GAINER_MIN_DAY_GAIN_PCT) || 1.5;
    const maxDayGain = Number(settings.SIMULATION_TOP_GAINER_MAX_DAY_GAIN_PCT) || 6;
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const superTrend = String(indicators.superTrendDirection || '').toLowerCase();
    const shock = getVolumeShockInfo(indicators);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const change5m = Number(shock.change5m);
    const relVol = getRelativeVolume(indicators);
    const volumeOk =
      (Number.isFinite(ratio3m) && ratio3m >= Number(settings.SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_3M || 1)) ||
      (Number.isFinite(ratio5m) && ratio5m >= Number(settings.SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_5M || 1)) ||
      (relVol != null && relVol >= Number(settings.SIMULATION_TOP_GAINER_MIN_REL_VOL || 1.2));
    const triggerDistancePct = getTriggerDistancePct(candidate, side);
    const vwapExtensionPct = Number.isFinite(price) && price > 0 && Number.isFinite(vwap) && vwap > 0
      ? ((price - vwap) / vwap) * 100
      : null;
    const mins = TradeRules.getIstMinutes(at || candidate?.__snapshotAt || candidate?.snapshotAt);
    const avoidStart = Number(settings.SIMULATION_TOP_GAINER_AVOID_START_MIN);
    const avoidEnd = Number(settings.SIMULATION_TOP_GAINER_AVOID_END_MIN);
    const middayBlocked = mins != null && Number.isFinite(avoidStart) && Number.isFinite(avoidEnd)
      && mins >= avoidStart && mins < avoidEnd;
    let reason = '';
    if (side === 'sell') reason = 'top-gainer continuation is long-only';
    else if (!Number.isFinite(rank) || rank < 1 || rank > count) reason = `stock is not a top ${count} gainer`;
    else if (!Number.isFinite(dayChange) || dayChange < minDayGain || dayChange > maxDayGain) reason = `top-gainer day move ${Number.isFinite(dayChange) ? round2(dayChange) : '--'}% outside ${round2(minDayGain)}-${round2(maxDayGain)}%`;
    else if (String(indicators.entryStatus || '').toLowerCase() !== 'triggered') reason = 'top-gainer trigger is not active';
    else if (!Number.isFinite(price) || !Number.isFinite(vwap) || price <= vwap) reason = 'top-gainer price must hold above VWAP';
    else if (!Number.isFinite(ema9) || !Number.isFinite(ema20) || ema9 <= ema20) reason = 'top-gainer EMA9 must be above EMA20';
    else if (superTrend !== 'bullish') reason = 'top-gainer SuperTrend must be bullish';
    else if (!volumeOk) reason = 'top-gainer needs fresh 3m/5m volume or 1.2x relative volume';
    else if (Number.isFinite(change5m) && change5m < 0) reason = 'top-gainer five-minute momentum is fading';
    else if (triggerDistancePct == null || triggerDistancePct < 0 || triggerDistancePct > Number(settings.SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT || 0.6)) reason = `top-gainer trigger extension ${triggerDistancePct == null ? '--' : round2(triggerDistancePct)}% exceeds ${round2(settings.SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT || 0.6)}%`;
    else if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > Number(settings.SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT || 0.8)) reason = `top-gainer VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(settings.SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT || 0.8)}%`;
    else if (middayBlocked) reason = 'top-gainer entries blocked from 12:00 to 13:30 IST';
    return {
      ok:!reason,
      reason,
      rank:Number.isFinite(rank) ? rank : null,
      dayChange,
      triggerDistancePct,
      vwapExtensionPct,
      volumeRatio3m:Number.isFinite(ratio3m) ? ratio3m : null,
      volumeRatio5m:Number.isFinite(ratio5m) ? ratio5m : null,
      relVol,
      change5m:Number.isFinite(change5m) ? change5m : null,
      middayBlocked,
    };
  }

  function isStrongVolumeBreakoutCandidate(candidate, settings) {
    settings = withDefaults(settings);
    if (!candidate) return false;
    const side = candidate.side || candidate.signal || adjustedTradeSignal(Number(candidate.score) || 0);
    if (side === 'sell') return false;
    const indicators = candidate.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const relVol = getRelativeVolume(candidate);
    const dayChange = getCandidateDayChange(candidate);
    const rsi = Number(indicators.rsi);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const superTrend = String(indicators.superTrendDirection || '').toLowerCase();
    const triggerDistancePct = getTriggerDistancePct(candidate, side);
    const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0 && Number.isFinite(price) && price > 0
      ? ((price - vwap) / vwap) * 100
      : null;
    const confirmationCount = Object.values(getBreakoutConfirmations(candidate, side)).filter(Boolean).length;
    return Number.isFinite(price) && price > 0 &&
      Number.isFinite(vwap) && vwap > 0 &&
      price > vwap &&
      relVol != null && relVol >= Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL || 3) &&
      Number.isFinite(dayChange) &&
      dayChange >= Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT || 3) &&
      dayChange <= Number(settings.SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT || 8) &&
      Number.isFinite(rsi) && rsi >= 52 && rsi <= Number(settings.SIMULATION_STRONG_BREAKOUT_MAX_RSI || 75) &&
      Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 > ema20 &&
      superTrend === 'bullish' &&
      triggerDistancePct != null && triggerDistancePct >= 0 && triggerDistancePct <= 1.25 &&
      vwapExtensionPct != null && vwapExtensionPct <= 1.5 &&
      confirmationCount >= 3;
  }

  function isRelaxedFreshBreakoutCandidate(candidate, settings) {
    settings = withDefaults(settings);
    if (!candidate) return false;
    const side = candidate.side || candidate.signal || adjustedTradeSignal(Number(candidate.score) || 0);
    if (side === 'sell') return false;
    const price = getCandidatePrice(candidate);
    const indicators = candidate.indicators || {};
    const vwap = Number(indicators.vwap);
    const triggerDistancePct = getTriggerDistancePct(candidate, side);
    const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0 && Number.isFinite(price) && price > 0
      ? ((price - vwap) / vwap) * 100
      : null;
    const relVol = getRelativeVolume(candidate);
    const rsi = Number(indicators.rsi);
    const confirmations = getBreakoutConfirmations(candidate, side);
    const confirmationCount = Object.values(confirmations).filter(Boolean).length;
    const minRelVol = Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_REL_VOL) || 2;
    const maxTriggerExtension = Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_TRIGGER_EXTENSION_PCT) || 1;
    const maxVwapExtension = Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_VWAP_EXTENSION_PCT) || 1.1;
    const minConfirmations = Math.max(2, Math.floor(Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MIN_CONFIRMATIONS) || 3));
    const maxRsi = Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_RSI) || 78;
    return Number.isFinite(price) && price > 0 &&
      Number.isFinite(vwap) && vwap > 0 &&
      price > vwap &&
      relVol != null && relVol >= minRelVol &&
      triggerDistancePct != null &&
      triggerDistancePct > 0 &&
      triggerDistancePct <= maxTriggerExtension &&
      vwapExtensionPct != null &&
      vwapExtensionPct <= maxVwapExtension &&
      Number.isFinite(rsi) && rsi <= maxRsi &&
      confirmationCount >= minConfirmations;
  }

  function getVolumeShockInfo(candidateOrIndicators) {
    const indicators = candidateOrIndicators?.indicators || candidateOrIndicators || {};
    return indicators.volumeShock && typeof indicators.volumeShock === 'object' ? indicators.volumeShock : {};
  }

  function getRecentVolumeImpulseInfo(candidate, settings) {
    settings = withDefaults(settings);
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const recentHigh = Number(shock.recentHigh);
    const price = getCandidatePrice(candidate);
    const freshHighBreakout = !!shock.breakout || (
      Number.isFinite(price) &&
      Number.isFinite(recentHigh) &&
      recentHigh > 0 &&
      price >= recentHigh
    );
    const impulseOk =
      Number.isFinite(ratio3m) && ratio3m >= Number(settings.SIMULATION_RUNNER_MIN_VOLUME_RATIO_3M || 0.8) ||
      Number.isFinite(ratio5m) && ratio5m >= Number(settings.SIMULATION_RUNNER_MIN_VOLUME_RATIO_5M || 1) ||
      freshHighBreakout;
    return { shock, ratio3m, ratio5m, recentHigh, freshHighBreakout, impulseOk };
  }

  function isLateRunnerAllowed(candidate, settings) {
    settings = withDefaults(settings);
    const dayChange = getCandidateDayChange(candidate);
    const maxDayChange = Number(settings.SIMULATION_RUNNER_MAX_DAY_CHANGE_PCT) || 8;
    if (!Number.isFinite(dayChange) || dayChange <= maxDayChange) return true;
    const impulse = getRecentVolumeImpulseInfo(candidate, settings);
    const minBreakoutRatio5m = Number(settings.SIMULATION_RUNNER_LATE_BREAKOUT_MIN_VOLUME_RATIO_5M) || 1.2;
    return !!impulse.shock.isShock ||
      (impulse.freshHighBreakout && Number.isFinite(impulse.ratio5m) && impulse.ratio5m >= minBreakoutRatio5m);
  }

  function getMomentumRunnerSnapshotTime(candidate, at) {
    return at ||
      candidate?.__snapshotAt ||
      candidate?.snapshotAt ||
      candidate?.entryContext?.snapshotAt ||
      candidate?.priceTime ||
      candidate?.quote?.time ||
      null;
  }

  function getLateMomentumRunnerBlockReason(candidate, settings, info, at) {
    settings = withDefaults(settings);
    const mins = TradeRules.getIstMinutes(getMomentumRunnerSnapshotTime(candidate, at));
    if (mins == null) return '';
    const cutoff = Math.max(0, Number(settings.SIMULATION_RUNNER_ENTRY_CUTOFF_MIN) || (14 * 60 + 30));
    const strictStart = Math.max(0, Number(settings.SIMULATION_RUNNER_LATE_STRICT_START_MIN) || (13 * 60 + 45));
    if (mins >= cutoff) return 'momentum runner blocked after 14:30 IST';
    if (mins < strictStart) return '';
    const dayChange = Number(info?.dayChange);
    const triggerDistancePct = Number(info?.triggerDistancePct);
    const vwapExtensionPct = Number(info?.vwapExtensionPct);
    const ratio3m = Number(info?.volumeRatio3m);
    const ratio5m = Number(info?.volumeRatio5m);
    const maxDayChange = Number(settings.SIMULATION_RUNNER_LATE_MAX_DAY_CHANGE_PCT) || 7;
    const maxTrigger = Number(settings.SIMULATION_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT) || 2;
    const maxEarlyTrigger = Number(settings.SIMULATION_EARLY_RUNNER_LATE_MAX_TRIGGER_EXTENSION_PCT) || 2.5;
    const maxVwap = Number(settings.SIMULATION_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT) || 1;
    const maxEarlyVwap = Number(settings.SIMULATION_EARLY_RUNNER_LATE_MAX_VWAP_EXTENSION_PCT) || 1.3;
    const minRatio3m = Number(settings.SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_3M) || 0.8;
    const minRatio5m = Number(settings.SIMULATION_RUNNER_LATE_MIN_VOLUME_RATIO_5M) || 1;
    const mode = info?.mode;
    const triggerLimit = mode === 'early' ? maxEarlyTrigger : maxTrigger;
    const vwapLimit = mode === 'early' ? maxEarlyVwap : maxVwap;
    const hasFreshVolumeImpulse = !!info?.volumeShockActive ||
      (Number.isFinite(ratio3m) && ratio3m >= minRatio3m) ||
      (Number.isFinite(ratio5m) && ratio5m >= minRatio5m);
    if (!hasFreshVolumeImpulse) return 'late momentum runner needs fresh 3m/5m volume impulse';
    if (Number.isFinite(dayChange) && dayChange > maxDayChange) return `late momentum runner day move ${round2(dayChange)}% > ${round2(maxDayChange)}%`;
    if (Number.isFinite(triggerDistancePct) && triggerDistancePct > triggerLimit) return `late momentum runner trigger extension ${round2(triggerDistancePct)}% > ${round2(triggerLimit)}%`;
    if (Number.isFinite(vwapExtensionPct) && vwapExtensionPct > vwapLimit) return `late momentum runner VWAP extension ${round2(vwapExtensionPct)}% > ${round2(vwapLimit)}%`;
    return '';
  }

  function getMarketRegime(candidate, side, context = {}) {
    const settings = withDefaults(context.settings || context);
    const tradeSide = side || candidate?.side || candidate?.signal || adjustedTradeSignal(Number(candidate?.score) || 0);
    const strictShortGuard = tradeSide === 'sell' && settings.SIMULATION_SHORT_MARKET_GUARD_STRICT;
    const niftyThreshold = Math.abs(Number(strictShortGuard ? settings.SIMULATION_SHORT_MARKET_REGIME_NIFTY_PCT : settings.SIMULATION_MARKET_REGIME_NIFTY_PCT) || 0);
    const sectorThreshold = Math.abs(Number(strictShortGuard ? settings.SIMULATION_SHORT_MARKET_REGIME_SECTOR_PCT : settings.SIMULATION_MARKET_REGIME_SECTOR_PCT) || 0);
    const rsThreshold = Math.abs(Number(strictShortGuard ? settings.SIMULATION_SHORT_MARKET_REGIME_RS_PCT : settings.SIMULATION_MARKET_REGIME_RS_PCT) || 0);
    const existingBlock = String(candidate?.blockReason || candidate?.entryBlockReason || '');
    const existingReasons = /^market regime conflict/i.test(existingBlock)
      ? existingBlock.replace(/^market regime conflict:\s*/i, '').split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const market = context.market || {};
    const indices = market.indices || context.indices || {};
    const nifty = Number(context.niftyChange ?? indices.nifty50?.change ?? indices.nifty?.change);
    const breadth = market.breadth || context.breadth || {};
    const advances = Number(breadth.advances ?? breadth.advance ?? breadth.up);
    const declines = Number(breadth.declines ?? breadth.decline ?? breadth.down);
    const advPct = Number.isFinite(Number(breadth.advancePct))
      ? Number(breadth.advancePct)
      : (Number.isFinite(advances) && Number.isFinite(declines) && advances + declines > 0 ? round2((advances / (advances + declines)) * 100) : null);
    const breadthThreshold = Math.abs(Number(strictShortGuard ? settings.SIMULATION_SHORT_MARKET_BREADTH_PCT : settings.SIMULATION_MARKET_BREADTH_PCT) || 55);
    const sectorTrend = context.sectorTrend || {};
    const sectorAvg = Number(context.sectorAvg ?? sectorTrend[candidate?.sector]);
    const dayChange = getCandidateDayChange(candidate);
    const rs = Number.isFinite(dayChange) && Number.isFinite(nifty) ? round2(dayChange - nifty) : null;
    const setupType = candidate?.derivedSetupType || candidate?.setupType || deriveSetupType(candidate, settings);
    const entryTriggered = String(candidate?.indicators?.entryStatus || '').toLowerCase() === 'triggered';
    const score = Math.abs(Number(candidate?.score) || 0);
    const overrideMinSector = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SECTOR_PCT);
    const overrideMinScore = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SCORE);
    const overrideMinRs = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_RS_PCT);
    const overrideMaxNiftyDecline = Math.abs(Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MAX_NIFTY_DECLINE_PCT));
    const longSectorRsOverride = tradeSide === 'buy'
      && !!settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_ENABLED
      && ['MOMENTUM_RUNNER', 'TOP_GAINER_CONTINUATION'].includes(setupType)
      && entryTriggered
      && Number.isFinite(nifty)
      && nifty < -niftyThreshold
      && Number.isFinite(overrideMaxNiftyDecline)
      && nifty >= -overrideMaxNiftyDecline
      && Number.isFinite(sectorAvg)
      && sectorAvg >= overrideMinSector
      && score >= overrideMinScore
      && Number.isFinite(rs)
      && rs >= overrideMinRs;
    const sectorAligned = !!candidate?.sectorPriority?.aligned;
    let reasons = existingReasons;
    if (niftyThreshold >= 999 || longSectorRsOverride) reasons = reasons.filter(reason => !/^Nifty\b/i.test(reason));
    if (sectorAligned) reasons = reasons.filter(reason => !/^breadth\b/i.test(reason));
    if (rsThreshold >= 999) reasons = reasons.filter(reason => !/^RS\b/i.test(reason));
    if (tradeSide === 'buy') {
      if (Number.isFinite(nifty) && nifty < -niftyThreshold && !longSectorRsOverride) reasons.push(`Nifty ${nifty}%`);
      if (Number.isFinite(advPct) && advPct < 100 - breadthThreshold && !sectorAligned) reasons.push(`breadth ${advPct}% advances`);
      if (Number.isFinite(sectorAvg) && sectorAvg < -sectorThreshold) reasons.push(`sector ${round1(sectorAvg)}%`);
      if (Number.isFinite(rs) && rs < -rsThreshold) reasons.push(`RS ${rs}%`);
    } else if (tradeSide === 'sell') {
      if (settings.SIMULATION_REQUIRE_NIFTY_FOR_SHORTS && niftyThreshold < 999 && !Number.isFinite(nifty)) {
        reasons.push('Nifty unavailable');
      }
      if (Number.isFinite(nifty) && nifty > niftyThreshold) reasons.push(`Nifty ${nifty}%`);
      if (Number.isFinite(advPct) && advPct > breadthThreshold && !sectorAligned) reasons.push(`breadth ${advPct}% advances`);
      if (Number.isFinite(sectorAvg) && sectorAvg > sectorThreshold) reasons.push(`sector ${round1(sectorAvg)}%`);
      if (Number.isFinite(rs) && rs > rsThreshold) reasons.push(`RS ${rs}%`);
    }
    reasons = [...new Set(reasons)];
    return { ok:reasons.length === 0, reason:reasons.length ? `market regime conflict: ${reasons.join(', ')}` : (longSectorRsOverride ? 'market aligned: sector RS override' : 'market aligned'), nifty:Number.isFinite(nifty) ? nifty : null, sectorAvg:Number.isFinite(sectorAvg) ? sectorAvg : null, rs, advancePct:Number.isFinite(advPct) ? advPct : null, sectorRsOverride:longSectorRsOverride };
  }

  function buildSectorPriorityStats(candidates) {
    const groups = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const sector = String(candidate?.sector || '').trim();
      const change = getCandidateDayChange(candidate);
      if (!sector || !Number.isFinite(change) || candidate?.freshness?.stale) continue;
      if (!groups.has(sector)) groups.set(sector, new Map());
      groups.get(sector).set(String(candidate?.symbol || groups.get(sector).size), change);
    }
    const stats = {};
    for (const [sector, changesBySymbol] of groups) {
      const changes = [...changesBySymbol.values()];
      stats[sector] = {
        count:changes.length,
        avg:changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null,
        advancePct:changes.length ? changes.filter(value => value > 0).length / changes.length * 100 : null,
        declinePct:changes.length ? changes.filter(value => value < 0).length / changes.length * 100 : null,
      };
    }
    return stats;
  }

  function applySectorPriority(candidate, sectorStats, context, settings) {
    const side = candidate?.side || candidate?.signal;
    const direction = side === 'sell' ? -1 : 1;
    const sector = String(candidate?.sector || '').trim();
    const stats = sectorStats?.[sector] || {};
    const market = context.market || {};
    const indices = market.indices || context.indices || {};
    const nifty = Number(context.niftyChange ?? indices.nifty50?.change ?? indices.nifty?.change);
    const dayChange = getCandidateDayChange(candidate);
    const rs = Number.isFinite(dayChange) && Number.isFinite(nifty) ? dayChange - nifty : null;
    const configuredSectorAvg = Number(context.sectorTrend?.[sector]);
    const sectorAvg = Number.isFinite(configuredSectorAvg) ? configuredSectorAvg : Number(stats.avg);
    const directionalSector = Number.isFinite(sectorAvg) ? direction * sectorAvg : null;
    const directionalBreadth = direction > 0 ? Number(stats.advancePct) : Number(stats.declinePct);
    const directionalRs = Number.isFinite(rs) ? direction * rs : null;
    const score = Math.abs(Number(candidate?.score) || 0);
    const minScore = Number(settings.SIMULATION_SECTOR_PRIORITY_MIN_SCORE) || 80;
    const minSector = Number(settings.SIMULATION_SECTOR_PRIORITY_MIN_SECTOR_PCT) || 0.5;
    const minBreadth = Number(settings.SIMULATION_SECTOR_PRIORITY_MIN_BREADTH_PCT) || 60;
    const minRs = Number(settings.SIMULATION_SECTOR_PRIORITY_MIN_RS_PCT) || 0.5;
    const minConstituents = Math.max(1, Math.floor(Number(settings.SIMULATION_SECTOR_PRIORITY_MIN_CONSTITUENTS) || 3));
    const aligned = !!settings.SIMULATION_SECTOR_PRIORITY_ENABLED
      && ['buy', 'sell'].includes(side)
      && score >= minScore
      && Number(stats.count) >= minConstituents
      && Number.isFinite(directionalSector) && directionalSector >= minSector
      && Number.isFinite(directionalBreadth) && directionalBreadth >= minBreadth
      && Number.isFinite(directionalRs) && directionalRs >= minRs
      && String(candidate?.indicators?.entryStatus || '').toLowerCase() === 'triggered';
    const maxBoost = Math.max(0, Number(settings.SIMULATION_SECTOR_PRIORITY_MAX_BOOST) || 15);
    const sectorBoost = aligned ? Math.min(6, directionalSector * 4) : 0;
    const breadthBoost = aligned ? Math.min(4, Math.max(0, directionalBreadth - 50) / 50 * 4) : 0;
    const rsBoost = aligned ? Math.min(5, directionalRs * 2) : 0;
    const boost = Math.min(maxBoost, sectorBoost + breadthBoost + rsBoost);
    candidate.sectorPriority = {
      aligned,
      sector,
      sectorAvg:Number.isFinite(sectorAvg) ? round2(sectorAvg) : null,
      breadthPct:Number.isFinite(directionalBreadth) ? round2(directionalBreadth) : null,
      constituentCount:Number(stats.count) || 0,
      rs:Number.isFinite(rs) ? round2(rs) : null,
      boost:round2(boost),
      adjustedScore:round2(score + boost),
    };
    return candidate;
  }

  function isTriggeredAboveVwap(candidate, side = 'buy') {
    if (!candidate) return false;
    const indicators = candidate.indicators || {};
    if (String(indicators.entryStatus || '').toLowerCase() !== 'triggered') return false;
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    if (!Number.isFinite(price) || !Number.isFinite(vwap) || vwap <= 0) return false;
    return side === 'sell' ? price < vwap : price > vwap;
  }

  function hasFreshBreakoutConfirmation(candidate, previousCandidate, side = 'buy') {
    return isTriggeredAboveVwap(candidate, side) && isTriggeredAboveVwap(previousCandidate, side);
  }

  function toConfirmationCandidate(candidate) {
    if (!candidate) return null;
    const indicators = candidate.indicators || {};
    return {
      symbol: candidate.symbol,
      price: getCandidatePrice(candidate),
      priceAtSnapshot: getCandidatePrice(candidate),
      signal: candidate.signal,
      side: candidate.side,
      __snapshotAt:candidate.__snapshotAt || candidate.snapshotAt || candidate.priceTime || null,
      candles:getCandidateCandles(candidate),
      indicators: {
        entryStatus: indicators.entryStatus,
        entryTrigger: indicators.entryTrigger,
        vwap: indicators.vwap,
        ohlc:{
          previousBar:normalizeCandidateCandle(indicators?.ohlc?.previousBar),
          latestBar:normalizeCandidateCandle(indicators?.ohlc?.latestBar),
        },
      },
    };
  }

  function scoreBand(value) {
    const score = Math.max(0, Math.min(100, Math.abs(Number(value) || 0)));
    const floor = Math.floor(score / 10) * 10;
    return `${floor}-${Math.min(100, floor + 9)}`;
  }

  function summarizeExpectancyRows(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const wins = source.filter(row => Number(row.netPct) > 0);
    const losses = source.filter(row => Number(row.netPct) < 0);
    const winTotal = wins.reduce((sum, row) => sum + Number(row.netPct), 0);
    const lossTotal = losses.reduce((sum, row) => sum + Number(row.netPct), 0);
    return {
      sample:source.length,
      winRate:source.length ? round2(wins.length / source.length * 100) : 0,
      expectedNetPct:source.length ? round3(source.reduce((sum, row) => sum + Number(row.netPct), 0) / source.length) : 0,
      avgWinPct:wins.length ? round3(winTotal / wins.length) : 0,
      avgLossPct:losses.length ? round3(lossTotal / losses.length) : 0,
      profitFactor:lossTotal < 0 ? round2(winTotal / Math.abs(lossTotal)) : (winTotal > 0 ? null : 0),
    };
  }

  function buildNetExpectancyModel(trades, settings = {}) {
    settings = withDefaults(settings);
    const lookback = Math.max(1, Math.floor(Number(settings.SIMULATION_EXPECTANCY_LOOKBACK_TRADES) || 200));
    const closed = (Array.isArray(trades) ? trades : [])
      .filter(trade => String(trade?.status || '').toLowerCase() === 'closed')
      .filter(trade => String(trade?.source || '').toLowerCase() === 'simulation')
      .filter(trade => Number.isFinite(Number(trade?.pnl)))
      .sort((a, b) => new Date(b.closedAt || b.openedAt || 0) - new Date(a.closedAt || a.openedAt || 0))
      .slice(0, lookback * 2);
    const positions = new Map();
    for (const trade of closed) {
      const rootId = String(trade?.parentId || trade?.id || '');
      if (!rootId) continue;
      const current = positions.get(rootId) || {
        id:rootId,
        setupType:String(trade?.setupType || 'UNKNOWN').toUpperCase(),
        score:Math.abs(Number(trade?.score) || 0),
        pnl:0,
        exposure:0,
        closedAt:trade?.closedAt || trade?.openedAt || null,
      };
      current.pnl += Number(trade.pnl) || 0;
      current.exposure += Math.abs((Number(trade.entryPrice) || 0) * (Number(trade.qty) || 0));
      if ((!current.setupType || current.setupType === 'UNKNOWN') && trade?.setupType) current.setupType = String(trade.setupType).toUpperCase();
      if (!current.score && Number.isFinite(Number(trade?.score))) current.score = Math.abs(Number(trade.score));
      positions.set(rootId, current);
    }
    const rows = [...positions.values()]
      .filter(row => row.exposure > 0)
      .map(row => ({ ...row, netPct:row.pnl / row.exposure * 100 }))
      .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))
      .slice(0, lookback);
    const exact = {};
    const setup = {};
    for (const row of rows) {
      const exactKey = `${row.setupType}|${scoreBand(row.score)}`;
      (exact[exactKey] ||= []).push(row);
      (setup[row.setupType] ||= []).push(row);
    }
    return {
      schemaVersion:1,
      sample:rows.length,
      exact:Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, summarizeExpectancyRows(value)])),
      setup:Object.fromEntries(Object.entries(setup).map(([key, value]) => [key, summarizeExpectancyRows(value)])),
      overall:summarizeExpectancyRows(rows),
    };
  }

  function resolveCandidateExpectancy(candidate, model, settings = {}) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_EXPECTANCY_ENABLED || !model || !candidate) return null;
    const minSample = Math.max(1, Math.floor(Number(settings.SIMULATION_EXPECTANCY_MIN_SAMPLE) || 12));
    const setupType = String(candidate.derivedSetupType || candidate.setupType || 'UNKNOWN').toUpperCase();
    const exactKey = `${setupType}|${scoreBand(candidate.score)}`;
    const exact = model.exact?.[exactKey];
    if (exact && Number(exact.sample) >= minSample) return { ...exact, source:'setup-score-band', key:exactKey };
    const setup = model.setup?.[setupType];
    if (setup && Number(setup.sample) >= minSample) return { ...setup, source:'setup', key:setupType };
    if (model.overall && Number(model.overall.sample) >= minSample) return { ...model.overall, source:'overall', key:'ALL' };
    return null;
  }

  function getIndependentQualityScore(candidate, settings = {}) {
    settings = withDefaults(settings);
    const side = candidate?.side || candidate?.signal || adjustedTradeSignal(Number(candidate?.score) || 0);
    const buy = side !== 'sell';
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const superTrend = String(indicators.superTrendDirection || '').toLowerCase();
    const entryStatus = String(indicators.entryStatus || '').toLowerCase();
    const reasons = Array.isArray(indicators.reasons) ? indicators.reasons.join(' | ') : String(indicators.reasons || '');
    const relVol = getRelativeVolume(candidate);
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const change5m = Number(shock.change5m);
    const triggerDistance = getTriggerDistancePct(candidate, side);
    const rr = Number(candidate?.rr);
    const stopPct = Number(candidate?.preCalcStopPct ?? indicators.stopPct);
    const netPct = Number(candidate?.cost?.netPct);
    let evidence = 0;
    let trend = 0;
    if (Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0) {
      evidence += 1;
      if (buy ? price > vwap : price < vwap) trend += 8;
    }
    if (Number.isFinite(ema9) && Number.isFinite(ema20)) {
      evidence += 1;
      if (buy ? ema9 > ema20 : ema9 < ema20) trend += 8;
    }
    if (superTrend) {
      evidence += 1;
      if (buy ? superTrend === 'bullish' : superTrend === 'bearish') trend += 9;
    }
    let trigger = 0;
    if (entryStatus) {
      evidence += 1;
      if (entryStatus === 'triggered') trigger += 8;
    }
    if (reasons) {
      evidence += 1;
      const breakout = buy
        ? /Opening range breakout|previous day high|5D breakout|20D breakout/i.test(reasons)
        : /Opening range breakdown|previous day low|5D breakdown|20D breakdown/i.test(reasons);
      if (breakout) trigger += 8;
    }
    if (triggerDistance != null) {
      evidence += 1;
      if (triggerDistance >= 0 && triggerDistance <= 1.25) trigger += 5;
    }
    if (Number.isFinite(change5m)) {
      evidence += 1;
      if (buy ? change5m >= 0 : change5m <= 0) trigger += 4;
    }
    let participation = 0;
    if (relVol != null) {
      evidence += 1;
      participation += relVol >= 1.5 ? 10 : (relVol >= 1 ? 6 : 0);
    }
    if (Number.isFinite(ratio3m) || Number.isFinite(ratio5m) || indicators.volumeSpike || shock.isShock) {
      evidence += 1;
      const ratio = Math.max(Number.isFinite(ratio3m) ? ratio3m : 0, Number.isFinite(ratio5m) ? ratio5m : 0);
      participation += ratio >= 1.2 ? 6 : (ratio >= 1 ? 4 : 0);
      if (indicators.volumeSpike || shock.isShock) participation += 4;
    }
    let regime = 0;
    const priority = candidate?.sectorPriority || {};
    const directionalSector = (buy ? 1 : -1) * Number(priority.sectorAvg);
    const directionalRs = (buy ? 1 : -1) * Number(priority.rs);
    const breadth = Number(priority.breadthPct);
    if (Number.isFinite(directionalSector) || Number.isFinite(directionalRs) || Number.isFinite(breadth)) evidence += 1;
    if (Number.isFinite(directionalSector) && directionalSector >= 0.5) regime += 5;
    if (Number.isFinite(breadth) && breadth >= 60) regime += breadth > 85 ? 2 : 5;
    if (Number.isFinite(directionalRs) && directionalRs >= 0.5) regime += 5;
    let riskCost = 0;
    if (Number.isFinite(netPct)) {
      evidence += 1;
      const minNet = Number(settings.SIMULATION_MIN_NET_PROFIT_PCT) || 0;
      riskCost += netPct >= minNet + 0.5 ? 6 : (netPct >= minNet ? 4 : 0);
    }
    if (Number.isFinite(rr)) {
      evidence += 1;
      riskCost += rr >= 2.5 ? 5 : (rr >= 2 ? 3 : 0);
    }
    if (Number.isFinite(stopPct)) {
      evidence += 1;
      const maxStop = getMaxStopPctForSide(settings, side);
      riskCost += stopPct <= Math.min(0.8, maxStop) ? 4 : (stopPct <= maxStop ? 2 : 0);
    }
    return {
      score:Math.max(0, Math.min(100, round2(trend + trigger + participation + regime + riskCost))),
      evidence,
      components:{ trend, trigger, participation, regime, riskCost },
    };
  }

  function applyDecisionScore(candidate, expectancyModel, settings = {}) {
    settings = withDefaults(settings);
    if (!candidate) return candidate;
    const rawScore = Math.abs(Number(candidate.score) || 0);
    const quality = getIndependentQualityScore(candidate, settings);
    const expectancy = resolveCandidateExpectancy(candidate, expectancyModel, settings);
    const maxAdjustment = Math.max(0, Number(settings.SIMULATION_EXPECTANCY_MAX_SCORE_ADJUSTMENT) || 10);
    const expectancyAdjustment = expectancy
      ? Math.max(-maxAdjustment, Math.min(maxAdjustment, Number(expectancy.expectedNetPct) * 40))
      : 0;
    const baseDecisionScore = quality.evidence >= 5
      ? rawScore * 0.65 + Number(quality.score) * 0.35
      : rawScore;
    candidate.decisionScore = Math.max(0, Math.min(100, round2(baseDecisionScore + expectancyAdjustment)));
    candidate.scoreAudit = {
      schemaVersion:1,
      rawScore,
      independentQualityScore:quality.score,
      independentEvidenceCount:quality.evidence,
      components:quality.components,
      expectancy:expectancy ? { ...expectancy, adjustment:round2(expectancyAdjustment) } : null,
      decisionScore:candidate.decisionScore,
    };
    return candidate;
  }

  function getCandidateDecisionScore(candidate) {
    return Number.isFinite(Number(candidate?.decisionScore))
      ? Math.abs(Number(candidate.decisionScore))
      : Math.abs(Number(candidate?.score) || 0);
  }

  function getNegativeExpectancyBlockReason(candidate, settings = {}) {
    settings = withDefaults(settings);
    const expectancy = candidate?.scoreAudit?.expectancy;
    if (!settings.SIMULATION_EXPECTANCY_ENABLED || !expectancy || expectancy.source !== 'setup-score-band') return '';
    const minSample = Math.max(1, Math.floor(Number(settings.SIMULATION_EXPECTANCY_BLOCK_MIN_SAMPLE) || 25));
    const minNetPct = Number(settings.SIMULATION_EXPECTANCY_MIN_NET_PCT) || 0;
    const minProfitFactor = Number(settings.SIMULATION_EXPECTANCY_MIN_PROFIT_FACTOR) || 0.85;
    const profitFactor = expectancy.profitFactor == null ? Infinity : Number(expectancy.profitFactor);
    if (Number(expectancy.sample) >= minSample && Number(expectancy.expectedNetPct) < minNetPct && profitFactor < minProfitFactor) {
      return `negative net expectancy ${expectancy.expectedNetPct}% over ${expectancy.sample} ${expectancy.key} positions`;
    }
    return '';
  }

  const AUDIT_SETTING_KEYS = [
    'SIMULATION_MIN_SCORE', 'SIMULATION_SHORT_MIN_SCORE', 'SIMULATION_TOP_N',
    'SIMULATION_MAX_NEW_PER_CYCLE', 'SIMULATION_MAX_OPEN', 'SIMULATION_MAX_ACTIVE_OPEN',
    'SIMULATION_MAX_OPEN_PER_SECTOR', 'SIMULATION_DAILY_MAX_TRADES', 'SIMULATION_DAILY_MAX_STOPS',
    'SIMULATION_OVERRIDE_STOP_GUARD', 'SIMULATION_LONG_CONFIRM_BARS',
    'SIMULATION_LONG_CONFIRM_MODE', 'SIMULATION_LONG_CONFIRM_CANDLE_MIN',
    'SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED',
    'SIMULATION_LONG_REQUIRE_COMPLETED_CANDLE', 'SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION',
    'SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_3M', 'SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_5M',
    'SIMULATION_LONG_MAX_TRIGGER_EXTENSION_PCT', 'SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT',
    'SIMULATION_LONG_PROFIT_LOCK_PCT', 'SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN',
    'SIMULATION_TOP_GAINER_CONTINUATION_ENABLED', 'SIMULATION_TOP_GAINER_COUNT',
    'SIMULATION_TOP_GAINER_MIN_DAY_GAIN_PCT', 'SIMULATION_TOP_GAINER_MAX_DAY_GAIN_PCT',
    'SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_3M', 'SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_5M',
    'SIMULATION_TOP_GAINER_MIN_REL_VOL', 'SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT',
    'SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT', 'SIMULATION_TOP_GAINER_AVOID_START_MIN',
    'SIMULATION_TOP_GAINER_AVOID_END_MIN', 'SIMULATION_TOP_GAINER_PROFIT_LOCK_PCT',
    'SIMULATION_TOP_GAINER_PARTIAL_QTY_PCT', 'SIMULATION_TOP_GAINER_TRAIL_PCT',
    'SIMULATION_SECTOR_PRIORITY_MAX_BOOST', 'SIMULATION_MIN_NET_PROFIT_PCT',
    'SIMULATION_EXPECTANCY_ENABLED', 'SIMULATION_EXPECTANCY_MIN_SAMPLE',
    'SIMULATION_EXPECTANCY_BLOCK_MIN_SAMPLE', 'SIMULATION_EXPECTANCY_MIN_NET_PCT',
  ];

  function buildSettingsAuditSnapshot(settings = {}) {
    const effective = withDefaults(settings);
    return Object.fromEntries(AUDIT_SETTING_KEYS.map(key => [key, effective[key]]));
  }

  function stableAuditFingerprint(value) {
    const text = JSON.stringify(value, Object.keys(value || {}).sort());
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function buildIndicatorAuditSnapshot(candidate) {
    const indicators = candidate?.indicators || {};
    const shock = getVolumeShockInfo(indicators);
    return {
      price:getCandidatePrice(candidate),
      vwap:Number.isFinite(Number(indicators.vwap)) ? Number(indicators.vwap) : null,
      ema9:Number.isFinite(Number(indicators.ema9 ?? indicators.emaShort)) ? Number(indicators.ema9 ?? indicators.emaShort) : null,
      ema20:Number.isFinite(Number(indicators.ema20 ?? indicators.emaLong)) ? Number(indicators.ema20 ?? indicators.emaLong) : null,
      superTrendDirection:indicators.superTrendDirection || null,
      rsi:Number.isFinite(Number(indicators.rsi)) ? Number(indicators.rsi) : null,
      entryStatus:indicators.entryStatus || null,
      entryTrigger:indicators.entryTrigger || null,
      triggerDistancePct:getTriggerDistancePct(candidate, candidate?.side || candidate?.signal),
      vwapExtensionPct:Number.isFinite(Number(indicators.vwap)) && Number(indicators.vwap) > 0
        ? round3(Math.abs(getCandidatePrice(candidate) - Number(indicators.vwap)) / Number(indicators.vwap) * 100)
        : null,
      relVolume:getRelativeVolume(candidate),
      volumeRatio3m:Number.isFinite(Number(shock.volumeRatio3m)) ? Number(shock.volumeRatio3m) : null,
      volumeRatio5m:Number.isFinite(Number(shock.volumeRatio5m)) ? Number(shock.volumeRatio5m) : null,
      change5m:Number.isFinite(Number(shock.change5m)) ? Number(shock.change5m) : null,
      dayChange:getCandidateDayChange(candidate),
      topGainerRank:Number.isFinite(Number(candidate?.topGainerRank ?? indicators.topGainerRank))
        ? Number(candidate?.topGainerRank ?? indicators.topGainerRank)
        : null,
      stopPct:Number.isFinite(Number(candidate?.preCalcStopPct ?? indicators.stopPct)) ? Number(candidate?.preCalcStopPct ?? indicators.stopPct) : null,
      rr:Number.isFinite(Number(candidate?.rr)) ? Number(candidate.rr) : null,
      estimatedNetPct:Number.isFinite(Number(candidate?.cost?.netPct)) ? Number(candidate.cost.netPct) : null,
      reasons:Array.isArray(indicators.reasons) ? indicators.reasons.slice(0, 12) : [],
    };
  }

  function getBreakoutConfirmations(candidateOrIndicators, side = 'buy') {
    const indicators = candidateOrIndicators?.indicators || candidateOrIndicators || {};
    const rsi = Number(indicators.rsi);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const relVol = getRelativeVolume(indicators);
    const buy = side !== 'sell';
    return {
      rsi: Number.isFinite(rsi) && (buy ? rsi >= 55 && rsi <= 78 : rsi <= 45 && rsi >= 22),
      superTrend: buy ? st === 'bullish' : st === 'bearish',
      ema: Number.isFinite(ema9) && Number.isFinite(ema20) && (buy ? ema9 > ema20 : ema9 < ema20),
      volume: !!indicators.volumeSpike || (Number.isFinite(relVol) && relVol >= 1.5),
    };
  }

  function getShortBearishConfirmations(candidate) {
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const rsi = Number(indicators.rsi);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const score = Number(candidate?.score);
    const trigger = getEntryTriggerPrice(candidate);
    const triggerDistance = getTriggerDistancePct(candidate, 'sell');
    const relVol = getRelativeVolume(candidate);
    return {
      belowVwap: Number.isFinite(price) && Number.isFinite(vwap) && price < vwap,
      emaBearish: Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 < ema20,
      superTrendBearish: st === 'bearish',
      rsiWeak: Number.isFinite(rsi) && rsi <= 45,
      scoreBearish: Number.isFinite(score) && score < 0,
      triggerNearby: Number.isFinite(trigger) && trigger > 0 && triggerDistance != null && Math.abs(triggerDistance) <= 1.2,
      volumeOk: relVol != null && relVol >= 0.8,
    };
  }

  function getShortBearishConfirmationCount(candidate) {
    return Object.values(getShortBearishConfirmations(candidate)).filter(Boolean).length;
  }

  function isTradeMomentumHealthy(trade, candidate, price, settings) {
    settings = withDefaults(settings);
    if (!trade || !candidate || !Number.isFinite(Number(price))) return false;
    const side = String(trade.side || 'buy').toLowerCase();
    const indicators = candidate.indicators || {};
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const relVol = getRelativeVolume(candidate);
    const buy = side !== 'sell';
    const signalOk = buy ? signal === 'buy' : signal === 'sell';
    const vwapOk = !Number.isFinite(vwap) || (buy ? price >= vwap : price <= vwap);
    const emaOk = !Number.isFinite(ema9) || !Number.isFinite(ema20) || (buy ? ema9 >= ema20 : ema9 <= ema20);
    const stOk = !st || (buy ? st === 'bullish' : st === 'bearish');
    const volOk = relVol == null || relVol >= (buy ? 1 : Number(settings.SIMULATION_SHORT_MIN_REL_VOL || 0.8));
    return signalOk && vwapOk && emaOk && stOk && volOk;
  }

  function isCandidateContinuationReentryAllowed(candidate, settings) {
    settings = withDefaults(settings);
    if (!candidate) return false;
    const side = candidate.side || candidate.signal || adjustedTradeSignal(Number(candidate.score) || 0);
    const price = getCandidatePrice(candidate);
    const indicators = candidate.indicators || {};
    const score = Number(candidate.score) || 0;
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const relVol = getRelativeVolume(candidate);
    const buy = side !== 'sell';
    if (!Number.isFinite(price) || price <= 0 || String(indicators.entryStatus || '').toLowerCase() !== 'triggered') return false;
    if (Math.abs(score) < getMinScoreForSide(settings, side) + 10) return false;
    if (Number.isFinite(vwap) && (buy ? price < vwap : price > vwap)) return false;
    if (Number.isFinite(ema9) && Number.isFinite(ema20) && (buy ? ema9 < ema20 : ema9 > ema20)) return false;
    if (st && (buy ? st !== 'bullish' : st !== 'bearish')) return false;
    if (relVol != null && relVol < (buy ? 1.2 : Number(settings.SIMULATION_SHORT_MIN_REL_VOL || 0.8))) return false;
    return true;
  }

  function getMomentumRunnerInfo(candidate, settings, at = null) {
    settings = withDefaults(settings);
    const side = candidate?.side || candidate?.signal || 'buy';
    if (!candidate || side === 'sell') return { ok: false, reason: 'runner only supports buy side' };
    const indicators = candidate.indicators || {};
    const price = getCandidatePrice(candidate);
    const trigger = getEntryTriggerPrice(candidate);
    const vwap = Number(indicators.vwap);
    const score = Number(candidate.score);
    const relVol = Number(indicators.relVolumeTimeAdjusted ?? indicators.relVolume);
    const reasons = Array.isArray(indicators.reasons) ? indicators.reasons.join(' | ') : String(indicators.reasons || '');
    const triggerDistancePct = trigger ? ((price - trigger) / trigger) * 100 : null;
    const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0 ? ((price - vwap) / vwap) * 100 : null;
    const confirmations = getBreakoutConfirmations(candidate, side);
    const confirmationCount = Object.values(confirmations).filter(Boolean).length;
    const hasBreakoutReason = /Opening range breakout|previous day high|5D breakout|20D breakout/i.test(reasons);
    const dayChange = getCandidateDayChange(candidate);
    const rsi = Number(indicators.rsi);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const bullishSuperTrendOk = !settings.SIMULATION_RUNNER_REQUIRE_BULLISH_SUPERTREND || st === 'bullish';
    const volumeImpulse = getRecentVolumeImpulseInfo(candidate, settings);
    const lateRunnerOk = isLateRunnerAllowed(candidate, settings);
    const baseInfo = {
      score,
      relVol,
      dayChange,
      triggerDistancePct,
      vwapExtensionPct,
      confirmationCount,
      superTrend: st || null,
      volumeRatio3m: Number.isFinite(volumeImpulse.ratio3m) ? volumeImpulse.ratio3m : null,
      volumeRatio5m: Number.isFinite(volumeImpulse.ratio5m) ? volumeImpulse.ratio5m : null,
      volumeShockActive: !!volumeImpulse.shock.isShock,
      freshHighBreakout: volumeImpulse.freshHighBreakout,
      lateRunnerOk,
    };
    const normalBaseOk =
      Number.isFinite(price) && price > 0 &&
      Number.isFinite(score) && score >= settings.SIMULATION_RUNNER_MIN_SCORE &&
      Number.isFinite(relVol) && relVol >= settings.SIMULATION_RUNNER_MIN_REL_VOL &&
      bullishSuperTrendOk &&
      volumeImpulse.impulseOk &&
      lateRunnerOk &&
      hasBreakoutReason &&
      triggerDistancePct != null &&
      triggerDistancePct > 0.6 &&
      triggerDistancePct <= settings.SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT &&
      vwapExtensionPct != null &&
      vwapExtensionPct <= settings.SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT &&
      confirmationCount >= 1;
    const earlyBaseOk =
      Number.isFinite(price) && price > 0 &&
      Number.isFinite(score) && score >= settings.SIMULATION_EARLY_RUNNER_MIN_SCORE &&
      Number.isFinite(relVol) && relVol >= settings.SIMULATION_EARLY_RUNNER_MIN_REL_VOL &&
      Number.isFinite(dayChange) &&
      dayChange >= settings.SIMULATION_EARLY_RUNNER_MIN_DAY_CHANGE_PCT &&
      dayChange <= settings.SIMULATION_EARLY_RUNNER_MAX_DAY_CHANGE_PCT &&
      Number.isFinite(rsi) && rsi >= 52 && rsi <= 78 &&
      bullishSuperTrendOk &&
      volumeImpulse.impulseOk &&
      lateRunnerOk &&
      hasBreakoutReason &&
      triggerDistancePct != null &&
      triggerDistancePct >= 0 &&
      triggerDistancePct <= settings.SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT &&
      vwapExtensionPct != null &&
      vwapExtensionPct <= settings.SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT &&
      confirmationCount >= 3;
    const baseMode = earlyBaseOk && !normalBaseOk ? 'early' : (normalBaseOk ? 'confirmed' : null);
    const lateBlockReason = (normalBaseOk || earlyBaseOk)
      ? getLateMomentumRunnerBlockReason(candidate, settings, { ...baseInfo, mode: baseMode }, at)
      : '';
    const normalOk = normalBaseOk && !lateBlockReason;
    const earlyOk = earlyBaseOk && !lateBlockReason;
    const ok = normalOk || earlyOk;
    return {
      ok,
      mode: earlyOk && !normalOk ? 'early' : (normalOk ? 'confirmed' : null),
      ...baseInfo,
      lateBlockReason,
      reason: ok
        ? (earlyOk && !normalOk ? 'early momentum runner' : 'momentum runner')
        : (!bullishSuperTrendOk
          ? 'runner needs bullish SuperTrend'
          : (!volumeImpulse.impulseOk
            ? 'runner needs fresh volume impulse or high breakout'
            : (!lateRunnerOk ? 'late runner needs fresh shock/high breakout' : (lateBlockReason || 'not momentum runner')))),
    };
  }

  function getVwapContinuationInfo(candidate, settings) {
    settings = withDefaults(settings);
    const side = candidate?.side || candidate?.signal || 'buy';
    if (!candidate || side === 'sell') return { ok: false, reason: 'continuation only supports buy side' };
    const indicators = candidate.indicators || {};
    const price = getCandidatePrice(candidate);
    const trigger = getEntryTriggerPrice(candidate);
    const vwap = Number(indicators.vwap);
    const score = Number(candidate.score);
    const rsi = Number(indicators.rsi);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const band = String(indicators.vwapBandPosition || '');
    const net = Number(candidate.cost?.netPct);
    const relVol = getRelativeVolume(indicators);
    const minRelVol = Number(settings.SIMULATION_VWAP_CONT_MIN_REL_VOL) || 1.5;
    const shock = getVolumeShockInfo(indicators);
    const volumeRatio3m = Number(shock.volumeRatio3m);
    const volumeRatio5m = Number(shock.volumeRatio5m);
    const change5m = Number(shock.change5m);
    const recentHigh = Number(shock.recentHigh);
    const freshHighBreakout = !!shock.breakout || (
      Number.isFinite(price) &&
      Number.isFinite(recentHigh) &&
      recentHigh > 0 &&
      price >= recentHigh
    );
    const impulseOk =
      Number.isFinite(volumeRatio3m) && volumeRatio3m >= (Number(settings.SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_3M) || 0.8) ||
      Number.isFinite(volumeRatio5m) && volumeRatio5m >= (Number(settings.SIMULATION_VWAP_CONT_MIN_VOLUME_RATIO_5M) || 1);
    const change5mOk = !settings.SIMULATION_VWAP_CONT_BLOCK_NEGATIVE_5M_UNLESS_BREAKOUT ||
      !Number.isFinite(change5m) ||
      change5m >= 0 ||
      freshHighBreakout;
    const triggerDistancePct = trigger ? ((price - trigger) / trigger) * 100 : null;
    const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0 ? ((price - vwap) / vwap) * 100 : null;
    const ok =
      Number.isFinite(price) && price > 0 &&
      Number.isFinite(score) && score >= settings.SIMULATION_VWAP_CONT_MIN_SCORE &&
      relVol != null && relVol >= minRelVol &&
      impulseOk &&
      change5mOk &&
      ['upper-half', 'inside'].includes(band) &&
      st === 'bullish' &&
      Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 > ema20 &&
      Number.isFinite(rsi) && rsi >= 50 && rsi <= 78 &&
      Number.isFinite(net) && net >= settings.SIMULATION_MIN_NET_PROFIT_PCT &&
      triggerDistancePct != null &&
      triggerDistancePct > 0.6 &&
      triggerDistancePct <= settings.SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT &&
      vwapExtensionPct != null &&
      vwapExtensionPct <= settings.SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT;
    return {
      ok,
      score,
      triggerDistancePct,
      vwapExtensionPct,
      relVol,
      minRelVol,
      volumeRatio3m: Number.isFinite(volumeRatio3m) ? volumeRatio3m : null,
      volumeRatio5m: Number.isFinite(volumeRatio5m) ? volumeRatio5m : null,
      change5m: Number.isFinite(change5m) ? change5m : null,
      freshHighBreakout,
      net,
      reason: ok
        ? 'VWAP trend continuation'
        : (relVol == null || relVol < minRelVol
          ? `VWAP continuation volume ${relVol == null ? '--' : round2(relVol)}x < ${round2(minRelVol)}x`
          : (!impulseOk
            ? 'VWAP continuation needs fresh volume impulse'
            : (!change5mOk ? 'VWAP continuation 5m change fading without fresh high' : 'not VWAP continuation'))),
    };
  }

  function deriveSetupType(candidate, settings, at = null) {
    const indicators = candidate?.indicators || {};
    const side = candidate?.side || candidate?.signal || adjustedTradeSignal(Number(candidate?.score) || 0);
    const band = String(indicators.vwapBandPosition || '');
    const reasons = Array.isArray(indicators.reasons) ? indicators.reasons.join(' | ') : String(indicators.reasons || '');
    const relVol = getRelativeVolume(indicators);
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const extensionPct = Number.isFinite(price) && Number.isFinite(vwap) && price > 0 && vwap > 0
      ? Math.abs(price - vwap) / price * 100
      : null;
    if (getTopGainerContinuationInfo(candidate, settings, at).ok) return 'TOP_GAINER_CONTINUATION';
    if (indicators.volumeShock?.isShock) return 'VOLUME_SHOCK_BREAKOUT';
    if (getMomentumRunnerInfo(candidate, settings, at).ok) return 'MOMENTUM_RUNNER';
    if (getVwapContinuationInfo(candidate, settings).ok) return 'VWAP_TREND_CONTINUATION';
    if (candidate?.guard?.level === 'chasing' || band === 'above-upper' || band === 'below-lower' || (extensionPct != null && extensionPct > 1.2)) return 'CHASING';
    if (side === 'sell' && /Opening range breakdown|previous day low|5D breakdown|20D breakdown/i.test(reasons)) return 'BREAKDOWN';
    if (relVol != null && relVol < 0.7) return 'LOW_VOLUME';
    if (/Opening range breakout|previous day high|5D breakout|20D breakout/i.test(reasons)) return side === 'sell' ? 'BREAKDOWN' : 'FRESH_BREAKOUT';
    if (side === 'buy' && ['upper-half', 'inside'].includes(band)) return 'VWAP_PULLBACK_OR_HOLD';
    if (side === 'sell' && ['lower-half', 'inside'].includes(band)) return 'VWAP_REJECTION';
    return side === 'sell' ? 'SHORT_MOMENTUM' : 'LONG_MOMENTUM';
  }

  function getSetupBlockReason(candidate, setupType, at, settings, context = {}) {
    settings = withDefaults(settings);
    if (!candidate) return 'missing candidate';
    const side = candidate.side || candidate.signal || 'buy';
    const buy = side !== 'sell';
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(price) || price <= 0) return 'missing live price';
    const runnerInfo = getMomentumRunnerInfo(candidate, settings, at);
    if (setupType === 'MOMENTUM_RUNNER' && !runnerInfo.ok) return runnerInfo.reason || 'not momentum runner';
    const runner = runnerInfo.ok;
    const continuationInfo = getVwapContinuationInfo(candidate, settings);
    if (setupType === 'VWAP_TREND_CONTINUATION' && !continuationInfo.ok) return continuationInfo.reason || 'not VWAP continuation';
    const continuation = continuationInfo.ok;
    if (setupType === 'TOP_GAINER_CONTINUATION') {
      const topGainerInfo = getTopGainerContinuationInfo(candidate, settings, at);
      if (!topGainerInfo.ok) return topGainerInfo.reason || 'not a qualified top-gainer continuation';
    }
    const relVol = getRelativeVolume(candidate);
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    const globalLongGuards = settings.SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED !== false;
    const needsLongConfirmation = buy && (
      globalLongGuards
        ? isSimulationSetupAllowed(setupType)
        : ['TOP_GAINER_CONTINUATION', 'MOMENTUM_RUNNER', 'VWAP_TREND_CONTINUATION', 'FRESH_BREAKOUT'].includes(setupType)
    );
    if (needsLongConfirmation) {
      const confirmation = getLongEntryConfirmation(
        candidate,
        context.previousCandidate || candidate.previousCandidate,
        side,
        at,
        settings
      );
      if (!confirmation.ok) return confirmation.reason;
      if (globalLongGuards) {
        const triggerDistancePct = getTriggerDistancePct(candidate, side);
        const maxTriggerExtension = Number(settings.SIMULATION_LONG_MAX_TRIGGER_EXTENSION_PCT) || 0.6;
        if (triggerDistancePct == null || triggerDistancePct < 0 || triggerDistancePct > maxTriggerExtension) {
          return `long trigger extension ${triggerDistancePct == null ? '--' : round2(triggerDistancePct)}% exceeds ${round2(maxTriggerExtension)}%`;
        }
        const vwap = Number(candidate.indicators?.vwap);
        const vwapExtensionPct = Number.isFinite(vwap) && vwap > 0
          ? ((price - vwap) / vwap) * 100
          : null;
        const maxVwapExtension = Number(settings.SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT) || 0.8;
        if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > maxVwapExtension) {
          return `long VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(maxVwapExtension)}%`;
        }
      }
    }
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') {
      const shock = candidate.indicators?.volumeShock || {};
      if (!shock.isShock) return 'volume shock not active';
      if (!isStrongVolumeBreakoutCandidate(candidate, settings)) {
        return 'volume shock needs aligned VWAP, EMA, SuperTrend, RSI, volume and breakout proximity';
      }
      if (Number.isFinite(Number(shock.vwapExtensionPct)) && Number(shock.vwapExtensionPct) > 3.2) {
        return `volume shock extended ${round2(shock.vwapExtensionPct)}% from VWAP`;
      }
      if (Number.isFinite(Number(shock.dayChangePct)) && Number(shock.dayChangePct) > 9) {
        return `volume shock late after ${round2(shock.dayChangePct)}% day move`;
      }
    }
    if (setupType === 'VWAP_TREND_CONTINUATION') {
      const minVwapContRelVol = Number(settings.SIMULATION_VWAP_CONT_MIN_REL_VOL) || 1.5;
      if (relVol == null || relVol < minVwapContRelVol) {
        return `VWAP continuation volume ${relVol == null ? '--' : round2(relVol)}x < ${round2(minVwapContRelVol)}x`;
      }
    }
    if (buy && setupType === 'FRESH_BREAKOUT') {
      const shock = getVolumeShockInfo(candidate);
      const ratio3m = Number(shock.volumeRatio3m);
      const ratio5m = Number(shock.volumeRatio5m);
      const minRatio3m = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_3M) || 0.7;
      const minRatio5m = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_VOLUME_RATIO_5M) || 0.9;
      if (!(Number.isFinite(ratio3m) && ratio3m >= minRatio3m) && !(Number.isFinite(ratio5m) && ratio5m >= minRatio5m)) {
        return `fresh breakout volume impulse ${Number.isFinite(ratio3m) ? round2(ratio3m) : '--'}x/3m, ${Number.isFinite(ratio5m) ? round2(ratio5m) : '--'}x/5m`;
      }
      if (context.market) {
        const market = context.market;
        const nifty = Number(market.indices?.nifty50?.change ?? market.indices?.nifty?.change ?? market.niftyChange);
        const advancePct = Number(market.breadth?.advancePct);
        const minNifty = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_NIFTY_CHANGE_PCT);
        const minBreadth = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_BREADTH_PCT) || 50;
        if (!Number.isFinite(nifty) || nifty < minNifty) return `fresh breakout Nifty ${Number.isFinite(nifty) ? round2(nifty) : '--'}% < ${round2(minNifty)}%`;
        if (!Number.isFinite(advancePct) || advancePct < minBreadth) return `fresh breakout breadth ${Number.isFinite(advancePct) ? round2(advancePct) : '--'}% < ${round2(minBreadth)}%`;
      }
    }
    if (!buy && ['BREAKDOWN', 'VWAP_REJECTION'].includes(setupType)) {
      const vwap = Number(candidate.indicators?.vwap);
      const minShortRelVol = Number(settings.SIMULATION_SHORT_MIN_REL_VOL) || 0;
      const shortConfirmBars = Math.max(1, Math.floor(Number(settings.SIMULATION_SHORT_CONFIRM_BARS) || 2));
      const bearishConfirmations = getShortBearishConfirmationCount(candidate);
      const minBearishConfirmations = Math.max(1, Math.floor(Number(settings.SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS) || 2));
      if (!Number.isFinite(vwap) || price >= vwap) return 'short setup needs price below VWAP';
      if (relVol == null || relVol < minShortRelVol) return `short volume ${relVol == null ? '--' : round2(relVol)}x < ${round2(minShortRelVol)}x`;
      if (bearishConfirmations < minBearishConfirmations) return `short bearish confirmations ${bearishConfirmations}/${minBearishConfirmations}`;
      const confirmations = getBreakoutConfirmations(candidate, side);
      const count = Object.values(confirmations).filter(Boolean).length;
      if (setupType === 'BREAKDOWN' && shortConfirmBars > 1 && !hasFreshBreakoutConfirmation(candidate, context.previousCandidate || candidate.previousCandidate, side)) {
        return `breakdown needs ${shortConfirmBars} triggered below-VWAP snapshots`;
      }
      if (count < 2) return `short confirmations ${count}/2`;
    }
    if (guardLevel === 'small' && (relVol == null || relVol < 1)) {
      return `small guard with weak volume ${relVol == null ? '--' : round2(relVol)}x`;
    }
    const trigger = getEntryTriggerPrice(candidate);
    if (trigger) {
      const triggerDistancePct = buy ? ((price - trigger) / trigger) * 100 : ((trigger - price) / trigger) * 100;
      const relaxedFresh = setupType === 'FRESH_BREAKOUT' && isRelaxedFreshBreakoutCandidate(candidate, settings);
      const maxFreshTrigger = Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_TRIGGER_EXTENSION_PCT) || 1;
      const triggerLimit = relaxedFresh ? maxFreshTrigger : 0.6;
      if (triggerDistancePct > triggerLimit && setupType !== 'VOLUME_SHOCK_BREAKOUT' && !runner && !continuation) return `chasing ${round2(triggerDistancePct)}% from trigger`;
    }
    const vwap = Number(candidate.indicators?.vwap);
    if (Number.isFinite(vwap) && vwap > 0) {
      const vwapExtensionPct = buy ? ((price - vwap) / vwap) * 100 : ((vwap - price) / vwap) * 100;
      const baseFreshMax = Number(settings.SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT) || 0.8;
      const highRelVol = relVol != null && relVol >= (Number(settings.SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL) || 2);
      const relaxedFresh = setupType === 'FRESH_BREAKOUT' && isRelaxedFreshBreakoutCandidate(candidate, settings);
      const freshMax = setupType === 'FRESH_BREAKOUT' && highRelVol
        ? (relaxedFresh
          ? Number(settings.SIMULATION_FRESH_BREAKOUT_RELAXED_MAX_VWAP_EXTENSION_PCT) || 1.1
          : Number(settings.SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT) || 1)
        : baseFreshMax;
      if (vwapExtensionPct > freshMax && setupType !== 'VOLUME_SHOCK_BREAKOUT' && !runner && !continuation) return `extended ${round2(vwapExtensionPct)}% from VWAP`;
    }
    if (setupType === 'FRESH_BREAKOUT' && !runner) {
      const confirmations = getBreakoutConfirmations(candidate, side);
      const count = Object.values(confirmations).filter(Boolean).length;
      if (count < 2) return `breakout confirmations ${count}/2`;
      const mins = getIstMinutes(at);
      if (mins != null && mins < 10 * 60 && !(confirmations.rsi && confirmations.superTrend && confirmations.ema)) {
        return 'early breakout needs RSI + SuperTrend + EMA';
      }
    }
    return '';
  }

  function isReplayCandidateEligible(candidate, at, settings, context = {}) {
    settings = withDefaults(settings);
    if (!candidate) return false;
    const side = candidate.side || candidate.signal;
    if (candidate.assetType === 'etf' && !settings.SIMULATION_ENABLE_ETF) return false;
    if (candidate.assetType === 'etf' && side === 'sell') return false;
    if (!['buy', 'sell'].includes(side)) return false;
    if (!settings.SIMULATION_AUTO_SHORTS && side === 'sell') return false;
    const setupType = candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings, at);
    if (getCandidateDecisionScore(candidate) < getMinScoreForCandidate(settings, side, setupType, candidate)) return false;
    if (getNegativeExpectancyBlockReason(candidate, settings)) return false;
    if (!isSimulationSetupAllowed(setupType)) return false;
    if (getSetupBlockReason(candidate, setupType, at, settings, context)) return false;
    if (!getMarketRegime(candidate, side, { ...context, settings }).ok) return false;
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    if (guardLevel && !getAllowedGuardLevelsForSide(settings, side).includes(guardLevel)) return false;
    if (candidate.indicators?.entryStatus !== 'Triggered') return false;
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(price) || price <= 0) return false;
    if (candidate.freshness?.stale) return false;
    const cost = candidate.cost;
    if (!cost || !cost.ok || Number(cost.netPct) < settings.SIMULATION_MIN_NET_PROFIT_PCT) return false;
    // Use pre-calculated value if available, fall back to recalculation
    const stopPct = candidate.preCalcStopPct ?? Number(candidate.indicators?.stopPct);
    if (!Number.isFinite(stopPct) || stopPct > getMaxStopPctForSide(settings, side)) return false;
    return true;
  }

  function explainCandidateEligibility(candidate, at, settings, context = {}) {
    settings = withDefaults(settings);
    const reasons = [];
    if (!candidate) return { eligible:false, reasons:['missing candidate'], setupType:null, side:null };
    const side = candidate.side || candidate.signal;
    const setupType = candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings, at);
    if (candidate.assetType === 'etf' && !settings.SIMULATION_ENABLE_ETF) reasons.push('ETF simulation disabled');
    if (candidate.assetType === 'etf' && side === 'sell') reasons.push('ETF short disabled');
    if (!['buy', 'sell'].includes(side)) reasons.push(`signal ${side || '--'}`);
    if (!settings.SIMULATION_AUTO_SHORTS && side === 'sell') reasons.push('auto shorts disabled');
    const minScore = getMinScoreForCandidate(settings, side, setupType, candidate);
    const decisionScore = getCandidateDecisionScore(candidate);
    if (decisionScore < minScore) reasons.push(`decision score ${round2(decisionScore)} < ${minScore}`);
    const expectancyBlock = getNegativeExpectancyBlockReason(candidate, settings);
    if (expectancyBlock) reasons.push(expectancyBlock);
    if (!isSimulationSetupAllowed(setupType)) reasons.push(`setup ${setupType} not allowed`);
    const setupBlock = getSetupBlockReason(candidate, setupType, at, settings, context);
    if (setupBlock) reasons.push(setupBlock);
    const regime = getMarketRegime(candidate, side, { ...context, settings });
    if (!regime.ok) reasons.push(regime.reason);
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    if (guardLevel && !getAllowedGuardLevelsForSide(settings, side).includes(guardLevel)) reasons.push(`risk guard ${candidate.guard?.label || guardLevel}`);
    if (candidate.indicators?.entryStatus !== 'Triggered') reasons.push(`entry ${candidate.indicators?.entryStatus || 'not triggered'}`);
    const quality = getDataQualityIssues(candidate, settings);
    reasons.push(...quality);
    const cost = candidate.cost;
    if (!cost || !cost.ok || Number(cost.netPct) < settings.SIMULATION_MIN_NET_PROFIT_PCT) reasons.push(`net ${cost?.netPct ?? '--'}% < ${settings.SIMULATION_MIN_NET_PROFIT_PCT}%`);
    // Use pre-calculated value if available, fall back to recalculation
    const stopPct = candidate.preCalcStopPct ?? Number(candidate.indicators?.stopPct);
    const maxStop = getMaxStopPctForSide(settings, side);
    if (!Number.isFinite(stopPct) || stopPct > maxStop) reasons.push(`stop ${Number.isFinite(stopPct) ? round3(stopPct) : '--'}% > ${maxStop}%`);
    return { eligible:reasons.length === 0, reasons:[...new Set(reasons)], setupType, side, regime };
  }

  function compareCandidates(a, b) {
    const setupA = a.derivedSetupType || a.setupType;
    const setupB = b.derivedSetupType || b.setupType;
    const setupDiff = setupPriority(setupA) - setupPriority(setupB);
    if (setupDiff) return setupDiff;
    const decisionDiff = getCandidateDecisionScore(b) - getCandidateDecisionScore(a);
    if (decisionDiff) return decisionDiff;
    const sectorTierDiff = Number(!!b?.sectorPriority?.aligned) - Number(!!a?.sectorPriority?.aligned);
    if (sectorTierDiff) return sectorTierDiff;
    return Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0);
  }

  function selectSimulationEntryCandidates(candidates, at, settings, context = {}) {
    settings = withDefaults(settings);
    annotateTopGainerRanks(candidates, settings);
    const openSymbols = context.openSymbols instanceof Set
      ? context.openSymbols
      : new Set(Array.isArray(context.openSymbols) ? context.openSymbols : []);
    const openPositionCounts = context.openPositionCounts instanceof Map
      ? new Map(context.openPositionCounts)
      : new Map();
    for (const symbol of openSymbols) {
      if (!openPositionCounts.has(symbol)) openPositionCounts.set(symbol, 1);
    }
    // Warn if openSymbols not provided (could bypass duplicate checks)
    if (!(context.openSymbols instanceof Set) && !Array.isArray(context.openSymbols)) {
      console.warn('[selectSimulationEntryCandidates] WARNING: openSymbols not provided in context, duplicate entry checks may be bypassed');
    }
    
    const quality = getSnapshotDataQuality(candidates, settings);
    if (quality.mode === 'block') return [];
    const configuredTopN = Math.max(1, Math.floor(Number(context.topN ?? settings.SIMULATION_TOP_N) || 10));
    const reducedTopN = Math.max(1, Math.floor(Number(settings.SIMULATION_DATA_QUALITY_REDUCED_TOP_N) || 2));
    const topN = quality.mode === 'reduce' ? Math.min(configuredTopN, reducedTopN) : configuredTopN;
    const entryBlockReason = typeof context.entryBlockReason === 'function'
      ? context.entryBlockReason
      : () => '';
    const market = { ...(context.market || {}) };
    if (context.market && !Number.isFinite(Number(market.breadth?.advancePct))) {
      const directional = (Array.isArray(candidates) ? candidates : [])
        .map(item => getCandidateDayChange(item))
        .filter(Number.isFinite);
      if (directional.length) {
        market.breadth = {
          ...(market.breadth || {}),
          advancePct: round2((directional.filter(change => change > 0).length / directional.length) * 100),
        };
      }
    }
    const maxConcurrentPerSymbol = Math.max(1, Math.floor(Number(settings.SIMULATION_MAX_CONCURRENT_POSITIONS_PER_SYMBOL) || 2));
    const rollingEntryMax = Math.max(0, Math.floor(Number(settings.SIMULATION_ROLLING_ENTRY_MAX) || 0));
    const rollingEntries = Math.max(0, Math.floor(Number(context.dayStats?.rollingEntries) || 0));
    const rollingCapacity = rollingEntryMax > 0 ? Math.max(0, rollingEntryMax - rollingEntries) : topN;
    const sectorPriorityStats = buildSectorPriorityStats(candidates);
    const expectancyModel = context.expectancyModel || buildNetExpectancyModel(context.closedTrades || context.trades || [], settings);
    const sectorPriorityEnabled = !!settings.SIMULATION_SECTOR_PRIORITY_ENABLED;
    const ordinaryMax = sectorPriorityEnabled
      ? Math.max(0, Math.floor(Number(settings.SIMULATION_ROLLING_ORDINARY_ENTRY_MAX) || 1))
      : rollingEntryMax;
    const sectorMax = sectorPriorityEnabled
      ? Math.max(0, Math.floor(Number(settings.SIMULATION_ROLLING_SECTOR_ENTRY_MAX) || 1))
      : 0;
    let ordinaryCapacity = Math.max(0, ordinaryMax - Math.max(0, Number(context.dayStats?.rollingOrdinaryEntries) || 0));
    let sectorCapacity = Math.max(0, sectorMax - Math.max(0, Number(context.dayStats?.rollingSectorEntries) || 0));
    
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map(candidate => {
        if (!candidate) return null;
        const topGainerInfo = getTopGainerContinuationInfo(candidate, settings, at);
        candidate.derivedSetupType = topGainerInfo.ok
          ? 'TOP_GAINER_CONTINUATION'
          : (candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings, at));
        applySectorPriority(candidate, sectorPriorityStats, context, settings);
        return applyDecisionScore(candidate, expectancyModel, settings);
      })
      .filter(Boolean)
      .filter(candidate => settings.SIMULATION_ENABLE_ETF || candidate.assetType !== 'etf')
      .filter(candidate => !(candidate.assetType === 'etf' && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => ['buy', 'sell'].includes(candidate.side || candidate.signal))
      .filter(candidate => !(settings.REPLAY_LONG_ONLY && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => !(settings.REPLAY_SHORT_ONLY && (candidate.side || candidate.signal) !== 'sell'))
      .filter(candidate => isReplayCandidateEligible(candidate, at, settings, {
        previousCandidate: candidate.previousCandidate || context.previousCandidate,
        market: context.market ? market : null,
        indices: context.indices,
        sectorTrend: context.sectorTrend,
        sectorAvg: context.sectorAvg,
      }))
      .filter(candidate => {
        // Check concurrent positions instead of just binary open/closed check
        const positionCount = openPositionCounts.get(candidate.symbol) || 0;
        if (positionCount >= maxConcurrentPerSymbol) {
          candidate.entryBlockReason = `Already have ${positionCount} open position(s) for ${candidate.symbol}; max concurrent: ${maxConcurrentPerSymbol}`;
          return false;
        }
        return true;
      })
      .filter(candidate => {
        let block = entryBlockReason(candidate.symbol, candidate.derivedSetupType || candidate.setupType || '', at, candidate);
        if (/profit re-entry cooldown/i.test(String(block || '')) && isCandidateContinuationReentryAllowed(candidate, settings)) {
          block = '';
        }
        candidate.entryBlockReason = block || '';
        return !block;
      })
      .filter(candidate => {
        const price = getCandidatePrice(candidate);
        return Number.isFinite(price) && price > 0;
      })
      .sort(compareCandidates);
    const selected = [];
    const maxOpenPerSector = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_OPEN_PER_SECTOR) || 0));
    const sectorCounts = new Map();
    for (const trade of Array.isArray(context.openTrades) ? context.openTrades : []) {
      const sector = String(trade?.sector || trade?.entryContext?.sectorPriority?.sector || '').trim();
      if (sector) sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    }
    for (const candidate of ranked) {
      if (selected.length >= Math.min(topN, rollingCapacity)) break;
      const sector = String(candidate?.sector || candidate?.sectorPriority?.sector || '').trim();
      if (sector && maxOpenPerSector > 0 && (sectorCounts.get(sector) || 0) >= maxOpenPerSector) {
        candidate.entryBlockReason = `sector position limit ${sector} ${sectorCounts.get(sector)}/${maxOpenPerSector}`;
        continue;
      }
      if (candidate.sectorPriority?.aligned) {
        if (sectorCapacity <= 0) continue;
        sectorCapacity -= 1;
      } else {
        if (ordinaryCapacity <= 0) continue;
        ordinaryCapacity -= 1;
      }
      selected.push(candidate);
      if (sector) sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    }
    return selected;
  }

  function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy', profile = 'zerodha_intraday') {
    const entry = Number(entryPrice);
    const exit = Number(exitPrice);
    const quantity = Number(qty);
    if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(quantity) || entry <= 0 || exit <= 0 || quantity <= 0) {
      return { total: 0, totalPct: 0, brokerage: 0, stt: 0, transaction: 0, gst: 0, sebi: 0, stamp: 0, turnover: 0 };
    }
    const isShort = String(side || '').toLowerCase() === 'sell';
    const buyValue = (isShort ? exit : entry) * quantity;
    const sellValue = (isShort ? entry : exit) * quantity;
    const turnover = buyValue + sellValue;
    const normalizedProfile = String(profile || 'zerodha_intraday').toLowerCase();
    const brokerage = normalizedProfile === 'sharekhan_intraday'
      ? (buyValue + sellValue) * 0.0005
      : Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
    const stt = sellValue * 0.00025;
    const transaction = turnover * 0.0000307;
    const sebi = turnover * 0.000001;
    const stamp = buyValue * 0.00003;
    const gst = (brokerage + transaction + sebi) * 0.18;
    const total = brokerage + stt + transaction + sebi + stamp + gst;
    return {
      total: round2(total),
      totalPct: buyValue > 0 ? round3((total / buyValue) * 100) : 0,
      brokerage: round2(brokerage),
      stt: round2(stt),
      transaction: round2(transaction),
      gst: round2(gst),
      sebi: round2(sebi),
      stamp: round2(stamp),
      turnover: round2(turnover),
    };
  }

  function getPaperTradePnl(trade, currentPrice) {
    const entry = Number(trade?.entryPrice);
    const price = Number(currentPrice);
    const qty = Number(trade?.qty);
    if (!Number.isFinite(entry) || !Number.isFinite(price) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const grossPnl = side === 'sell' ? (entry - price) * qty : (price - entry) * qty;
    const profile = trade?.costProfile || trade?.executionCostProfile || 'zerodha_intraday';
    const charges = profile === 'zerodha_intraday'
      ? memoizedEstimateZerodhaIntradayCharges(entry, price, qty, side)
      : estimateZerodhaIntradayCharges(entry, price, qty, side, profile);
    const pnl = grossPnl - charges.total;
    return { pnl: round2(pnl), pnlPct: round2((pnl / (entry * qty)) * 100), grossPnl: round2(grossPnl), charges: charges.total, chargeBreakup: charges };
  }

  function applyAdverseSlippage(price, side, action, settings = {}) {
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) return value;
    const pct = Math.max(0, Number(settings.SIMULATION_SLIPPAGE_PCT) || 0) / 100;
    const isBuyOrder = action === 'entry' ? String(side).toLowerCase() !== 'sell' : String(side).toLowerCase() === 'sell';
    return round2(isBuyOrder ? value * (1 + pct) : value * (1 - pct));
  }

  function getPaperPlanForCandidate(candidate, side, price, settings = {}) {
    settings = withDefaults(settings);
    const indicators = candidate?.indicators || {};
    const entry = Number(price);
    const rawTarget = Number(indicators.target);
    const rawStop = Number(indicators.stop);
    const atr = Number(indicators.atr);
    const targetDistance = Number.isFinite(rawTarget) ? Math.abs(rawTarget - entry) : (Number.isFinite(atr) ? atr * 1.25 : entry * 0.008);
    let stopDistance = Number.isFinite(rawStop) ? Math.abs(entry - rawStop) : (Number.isFinite(atr) ? atr * 0.8 : entry * 0.005);
    const setupType = candidate?.derivedSetupType || candidate?.setupType || '';
    if (setupType === 'MOMENTUM_RUNNER' && Number.isFinite(atr) && atr > 0) {
      const atrFloor = atr * (Number(settings.SIMULATION_RUNNER_STOP_ATR_MULTIPLIER) || 1.2);
      const maxDistance = entry * ((Number(settings.SIMULATION_RUNNER_MAX_INITIAL_STOP_PCT) || 1.25) / 100);
      stopDistance = Math.min(Math.max(stopDistance, atrFloor), maxDistance);
    }
    if (side === 'sell') return { target: round2(entry - targetDistance), stop: round2(entry + stopDistance) };
    return { target: round2(entry + targetDistance), stop: round2(entry - stopDistance) };
  }

  function getNextRunnerTarget(trade, price, settings) {
    settings = withDefaults(settings);
    if (!trade || !Number.isFinite(Number(price))) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const stepPct = Math.max(0.1, Number(settings.SIMULATION_RUNNER_TARGET_STEP_PCT) || 1.2) / 100;
    const next = side === 'sell' ? Number(price) * (1 - stepPct) : Number(price) * (1 + stepPct);
    return Number.isFinite(next) && next > 0 ? round2(next) : null;
  }

  function getSuggestedQty(candidate, side, price, availableCash, maxExposure, settings, positionMultiplier = 1.0) {
    settings = withDefaults(settings);
    const entry = Number(price);
    if (!candidate || !Number.isFinite(entry) || entry <= 0) return { qty: 0, riskPerShare: null, maxLoss: 0, cashLimit: 0, exposureCap: maxExposure };
    const plan = getPaperPlanForCandidate(candidate, side, entry, settings);
    const riskPerShare = Math.abs(entry - Number(plan.stop));
    const maxLoss = settings.PORTFOLIO_INITIAL_CAPITAL * (settings.TRADE_RISK_PCT / 100);
    const cash = availableCash == null ? settings.PORTFOLIO_INITIAL_CAPITAL : availableCash;
    const exposureCap = Math.max(0, Math.min(Number(maxExposure) || settings.MAX_POSITION_EXPOSURE, Math.max(0, cash)));
    const byRisk = riskPerShare > 0 ? Math.floor(maxLoss / riskPerShare) : 0;
    const byCash = Math.floor(exposureCap / entry);
    const rawQty = Math.max(0, Math.min(byRisk || byCash, byCash));
    const setupType = candidate.derivedSetupType || candidate.setupType || '';
    const dayChange = getCandidateDayChange(candidate);
    const lateSizeThreshold = Number(settings.SIMULATION_RUNNER_LATE_SIZE_REDUCTION_DAY_CHANGE_PCT) || 7;
    const lateSizeFactor = Math.max(0.1, Math.min(1, Number(settings.SIMULATION_RUNNER_LATE_SIZE_FACTOR) || 0.5));
    const sizeFactor = setupType === 'MOMENTUM_RUNNER' && Number.isFinite(dayChange) && dayChange > lateSizeThreshold
      ? lateSizeFactor
      : 1;
    const baseQty = Math.max(0, Math.floor(rawQty * sizeFactor));
    const finalQty = Math.max(0, Math.floor(baseQty * positionMultiplier));
    const qty = Math.max(0, finalQty);
    return { qty, riskPerShare: round2(riskPerShare), maxLoss: round2(maxLoss), cashLimit: byCash, exposureCap: round2(exposureCap), plan, sizeFactor };
  }

  function isMomentumRunnerTrade(trade) {
    return String(trade?.setupType || '').toUpperCase() === 'MOMENTUM_RUNNER' || !!(trade?._partialTargetBooked && trade?._runnerArmed);
  }

  function isSimulationSignalDeteriorated(trade, candidate, price) {
    if (!candidate || !Number.isFinite(Number(price))) return false;
    const side = String(trade.side || 'buy').toLowerCase();
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const indicators = candidate.indicators || {};
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    if (side === 'sell') {
      if (signal === 'buy' || score > -25) return true;
      if (Number.isFinite(vwap) && price > vwap) return true;
      if (Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 > ema20) return true;
      return false;
    }
    if (signal === 'sell' || score < 25) return true;
    if (Number.isFinite(vwap) && price < vwap) return true;
    if (Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 < ema20) return true;
    return false;
  }

  function isSimulationStopDeteriorated(trade, candidate, settings) {
    settings = withDefaults(settings);
    if (!candidate) return false;
    const side = String(trade.side || 'buy').toLowerCase();
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const entryStatus = String(candidate.indicators?.entryStatus || '').toLowerCase();
    if (entryStatus === 'invalidated') return true;
    if (side === 'sell') return signal !== 'sell' || score > -getMinScoreForSide(settings, 'sell');
    return signal !== 'buy' || score < getMinScoreForSide(settings, 'buy');
  }

  function isMomentumRunnerBroken(trade, candidate, price, settings) {
    settings = withDefaults(settings);
    if (!candidate || !Number.isFinite(Number(price))) return false;
    const side = String(trade?.side || 'buy').toLowerCase();
    const buy = side !== 'sell';
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const indicators = candidate.indicators || {};
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    if (buy) {
      if (signal !== 'buy' || score < getMinScoreForSide(settings, 'buy')) return true;
      if (Number.isFinite(vwap) && price < vwap) return true;
      if (Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 < ema20) return true;
      if (st === 'bearish') return true;
      return false;
    }
    if (signal !== 'sell' || score > -getMinScoreForSide(settings, 'sell')) return true;
    if (Number.isFinite(vwap) && price > vwap) return true;
    if (Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 > ema20) return true;
    if (st === 'bullish') return true;
    return false;
  }

  function getTargetRunnerInfo(trade, candidate, price, settings) {
    settings = withDefaults(settings);
    if (!trade || !candidate || !Number.isFinite(Number(price))) return { ok: false, reason: 'missing target runner context' };
    const side = String(trade.side || 'buy').toLowerCase();
    const indicators = candidate.indicators || {};
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const relVol = getRelativeVolume(candidate);
    const buy = side !== 'sell';
    const alignedSignal = buy ? signal === 'buy' : signal === 'sell';
    const vwapOk = !Number.isFinite(vwap) || (buy ? price >= vwap : price <= vwap);
    const emaOk = !Number.isFinite(ema9) || !Number.isFinite(ema20) || (buy ? ema9 >= ema20 : ema9 <= ema20);
    const stOk = !st || (buy ? st === 'bullish' : st === 'bearish');
    const scoreOk = buy ? score >= settings.SIMULATION_TARGET_RUNNER_MIN_SCORE : score <= -settings.SIMULATION_TARGET_RUNNER_MIN_SCORE;
    const volOk = relVol != null && relVol >= settings.SIMULATION_TARGET_RUNNER_MIN_REL_VOL;
    const ok = alignedSignal && scoreOk && volOk && vwapOk && emaOk && stOk;
    return { ok, score, relVol, vwapOk, emaOk, stOk, reason: ok ? 'target runner override' : 'target reached without runner confirmation' };
  }

  function getProfitReentryBlockReason(trades, sym, setupType, at, settings) {
    return TradeRules.getProfitReentryBlockReason(trades, sym, setupType, at, settings);
  }

  function getSimulationStopExit(trade, price, candidate, at, settings) {
    settings = withDefaults(settings);
    const side = String(trade.side || 'buy').toLowerCase();
    const stop = Number(trade.stop);
    const entry = Number(trade.entryPrice);
    
    if (!Number.isFinite(stop) || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(Number(price))) {
      return null;
    }

    // Immediate stop logic (matches backtest behavior)
    if (side === 'buy' && price <= stop) {
      return {
        reason: 'Simulation stop loss breach',
        exitPrice: stop,
        confidence: 1.0
      };
    }
    
    if (side === 'sell' && price >= stop) {
      return {
        reason: 'Simulation stop loss breach',
        exitPrice: stop,
        confidence: 1.0
      };
    }

    return null;
  }

  function getMomentumRunnerExit(trade, price, candidate, settings) {
    settings = withDefaults(settings);
    if (!isMomentumRunnerTrade(trade) || !Number.isFinite(Number(price))) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const entry = Number(trade.entryPrice);
    const target = Number(trade.target);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    if (Number.isFinite(target) && (side === 'sell' ? price <= target : price >= target)) trade._runnerArmed = true;
    if (!trade._runnerArmed) return null;
    if (!trade._partialTargetBooked && isMomentumRunnerBroken(trade, candidate, price, settings)) {
      return { reason: 'Simulation momentum break', exitPrice: Number(price) };
    }
    const best = Number(trade._bestPrice);
    const hasProgress = side === 'sell' ? best < entry : best > entry;
    if (Number.isFinite(best) && hasProgress) {
      const trailPct = Number(trade._runnerWideTrail) ? settings.SIMULATION_RUNNER_WIDE_TRAIL_PCT : settings.SIMULATION_RUNNER_TRAIL_PCT;
      const trail = side === 'sell' ? best * (1 + trailPct / 100) : best * (1 - trailPct / 100);
      if (side === 'sell' && price >= trail) return { reason: 'Simulation runner trail', exitPrice: Number(price) };
      if (side !== 'sell' && price <= trail) return { reason: 'Simulation runner trail', exitPrice: Number(price) };
    }
    return null;
  }

  function getTradeHoldMinutes(trade, at) {
    const start = new Date(trade?.openedAt || 0).getTime();
    const end = at ? new Date(at).getTime() : new Date(trade?.closedAt || Date.now()).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return 0;
    return round1((end - start) / 60000);
  }

  function getTopGainerContinuationExit(trade, price, candidate, at, settings) {
    settings = withDefaults(settings);
    if (String(trade?.setupType || '').toUpperCase() !== 'TOP_GAINER_CONTINUATION') return null;
    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(Number(price))) return null;
    const indicators = candidate?.indicators || {};
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const completedCandle = getLatestCompletedCandidateCandle(candidate, at, intervalMin);
    const openedAtMs = new Date(trade.openedAt || 0).getTime();
    const completedAtMs = completedCandle
      ? new Date(completedCandle.time).getTime() + intervalMin * 60000
      : NaN;
    const entryIndicators = trade?.entryContext?.indicatorSnapshot || {};
    const trigger = getEntryTriggerPrice(entryIndicators) ?? getEntryTriggerPrice(candidate);
    const vwap = Number(indicators.vwap);
    if (
      completedCandle &&
      Number.isFinite(openedAtMs) &&
      Number.isFinite(completedAtMs) &&
      completedAtMs > openedAtMs &&
      Number.isFinite(trigger) &&
      Number.isFinite(vwap) &&
      completedCandle.close < trigger &&
      completedCandle.close < vwap
    ) {
      return {
        reason:'Simulation top-gainer trigger and VWAP loss',
        exitPrice:Number(price),
        exitFlags:['completed candle below trigger', 'completed candle below VWAP'],
      };
    }

    const profitLockPct = Math.max(0, Number(settings.SIMULATION_TOP_GAINER_PROFIT_LOCK_PCT) || 0.4);
    const maxFavorablePct = Number(trade._maxFavorablePct) || 0;
    if (maxFavorablePct < profitLockPct) return null;
    trade._topGainerProfitLockArmed = true;
    if (!trade._partialTargetBooked && Number(trade.qty) > 1) {
      return {
        reason:'Simulation top-gainer profit lock',
        exitPrice:Number(price),
        action:'partial',
        qtyPct:Math.min(90, Math.max(1, Number(settings.SIMULATION_TOP_GAINER_PARTIAL_QTY_PCT) || 50)),
        runner:true,
        newTarget:null,
      };
    }
    const best = Number(trade._bestPrice);
    const trailPct = Math.max(0.05, Number(settings.SIMULATION_TOP_GAINER_TRAIL_PCT) || 0.35) / 100;
    if (Number.isFinite(best) && best > entry) {
      const trail = best * (1 - trailPct);
      if (Number(price) <= trail) {
        return { reason:'Simulation top-gainer profit trail', exitPrice:trail };
      }
    }
    return null;
  }

  function getMomentumFadeExit(trade, price, candidate, at, settings) {
    settings = withDefaults(settings);
    if (!trade || !candidate || !Number.isFinite(Number(price))) return null;
    const holdMin = getTradeHoldMinutes(trade, at);
    if (holdMin < Number(settings.SIMULATION_EXIT_MIN_HOLD_MIN || 0)) {
      trade._fadeBreachCount = 0;
      return null;
    }
    const side = String(trade.side || 'buy').toLowerCase();
    const indicators = candidate.indicators || {};
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    const relVol = getRelativeVolume(candidate);
    const buy = side !== 'sell';
    const vwapLost = Number.isFinite(vwap) && (buy ? price < vwap : price > vwap);
    const emaLost = Number.isFinite(ema9) && Number.isFinite(ema20) && (buy ? ema9 < ema20 : ema9 > ema20);
    const trendLost = st && (buy ? st === 'bearish' : st === 'bullish');
    const scoreLost = buy ? signal !== 'buy' || score < 35 : signal !== 'sell' || score > -35;
    const volumeFade = relVol != null && relVol < (buy ? 0.8 : Number(settings.SIMULATION_SHORT_MIN_REL_VOL || 0.8) * 0.75);
    const reasons = [];
    if (vwapLost) reasons.push(buy ? 'VWAP loss' : 'VWAP reclaim');
    if (emaLost) reasons.push('EMA momentum fade');
    if (trendLost) reasons.push('SuperTrend flip');
    if (scoreLost) reasons.push('score fade');
    if (volumeFade) reasons.push('volume fade');
    const weak = vwapLost && (emaLost || trendLost || scoreLost || volumeFade);
    if (!weak) {
      trade._fadeBreachCount = 0;
      return null;
    }
    trade._fadeBreachCount = (Number(trade._fadeBreachCount) || 0) + 1;
    if (trade._fadeBreachCount < Math.max(1, Math.floor(Number(settings.SIMULATION_EXIT_FADE_CONFIRM_BARS) || 1))) return null;
    return {
      reason: `Simulation ${reasons[0] || 'momentum fade'}`,
      exitPrice: Number(price),
      exitFlags: reasons,
    };
  }

  // Exit when trade is in profit by at least SIMULATION_NEG_CANDLE_EXIT_MIN_GAIN_PCT and
  // SIMULATION_NEG_CANDLE_EXIT_COUNT consecutive adverse candles have formed.
  // Each unique latestBar.time is counted exactly once; a positive candle resets the streak.
  function getNegativeCandleExit(trade, price, candidate, settings) {
    settings = withDefaults(settings);
    if (!trade || !candidate) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const buy = side !== 'sell';
    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(Number(price))) return null;
    const minGainPct = Number(settings.SIMULATION_NEG_CANDLE_EXIT_MIN_GAIN_PCT) || 1.0;
    const requiredCount = Math.max(1, Math.floor(Number(settings.SIMULATION_NEG_CANDLE_EXIT_COUNT) || 3));
    const favorablePct = buy ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
    if (favorablePct < minGainPct) {
      trade._negCandleCount = 0;
      return null;
    }
    const bar = getLatestCandidateCandle(candidate);
    if (!bar || !bar.time) return null;
    const open = Number(bar.open);
    const close = Number(bar.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0) return null;
    const barTime = String(bar.time);
    if (trade._lastNegCandleBarTime !== barTime) {
      const isNegative = buy ? close < open : close > open;
      trade._negCandleCount = isNegative ? (Number(trade._negCandleCount) || 0) + 1 : 0;
      trade._lastNegCandleBarTime = barTime;
    }
    if ((Number(trade._negCandleCount) || 0) >= requiredCount) {
      return { reason: 'Simulation negative candle exit', exitPrice: Number(price) };
    }
    return null;
  }

  function getNoProgressExit(trade, price, candidate, at, settings) {
    settings = withDefaults(settings);
    if (!trade || !Number.isFinite(Number(price))) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const entry = Number(trade.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) return null;
    const nowMs = at ? new Date(at).getTime() : Date.now();
    const openedAt = new Date(trade.openedAt || 0).getTime();
    if (!Number.isFinite(openedAt) || openedAt <= 0) return null;
    const holdMs = nowMs - openedAt;
    const setupType = String(trade.setupType || candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase();
    const relVol = getRelativeVolume(candidate);
    let minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_EXIT_MIN) || 45);
    if (setupType === 'MOMENTUM_RUNNER' || Number(trade._runnerArmed)) {
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN) || 25);
    } else if (setupType === 'FRESH_BREAKOUT' || setupType === 'VOLUME_SHOCK_BREAKOUT') {
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN) || 30);
    } else if (setupType === 'VWAP_TREND_CONTINUATION') {
      const fadeThreshold = Number(settings.SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE) || 1.2;
      if (settings.SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE && !(relVol != null && relVol < fadeThreshold)) {
        return null;
      }
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN) || 30);
    }
    const minHoldMs = minHoldMin * 60000;
    if (holdMs < minHoldMs) return null;
    const favorablePct = side === 'sell' ? ((entry - Number(price)) / entry) * 100 : ((Number(price) - entry) / entry) * 100;
    const maxFavorablePct = Math.max(Number(trade._maxFavorablePct) || 0, favorablePct);
    const minFavorablePct = Math.max(0, Number(settings.SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT) || 0.2);
    if (maxFavorablePct >= minFavorablePct) return null;
    const adversePct = -favorablePct;
    const adverseTriggerPct = Math.max(0, Number(settings.SIMULATION_NO_PROGRESS_ADVERSE_PCT) || 0.15);
    const deteriorated = isSimulationSignalDeteriorated(trade, candidate, Number(price));
    const vwap = Number(candidate?.indicators?.vwap);
    const vwapLost = Number.isFinite(vwap) && (side === 'sell' ? Number(price) > vwap : Number(price) < vwap);
    if (adversePct >= adverseTriggerPct || deteriorated || vwapLost) {
      return { reason: 'Simulation zero-progress exit', exitPrice: Number(price) };
    }
    return null;
  }

  function getSimulationExit(trade, price, candidate, at, settings, opts) {
    settings = withDefaults(settings);
    opts = opts || {};
    if (!trade || !Number.isFinite(Number(price))) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const entry = Number(trade.entryPrice);
    const target = Number(trade.target);
    const nowMs = at ? new Date(at).getTime() : Date.now();
    const openedAt = new Date(trade.openedAt || 0).getTime();
    if (Number.isFinite(entry) && entry > 0) {
      const favorablePct = side === 'sell' ? ((entry - price) / entry) * 100 : ((price - entry) / entry) * 100;
      trade._maxFavorablePct = Math.max(Number(trade._maxFavorablePct) || 0, favorablePct);
      trade._bestPrice = side === 'sell'
        ? Math.min(Number(trade._bestPrice) || entry, price)
        : Math.max(Number(trade._bestPrice) || entry, price);
      const topGainerExit = getTopGainerContinuationExit(trade, price, candidate, at, settings);
      if (topGainerExit) return topGainerExit;
      const profitLockActivationPct = side === 'sell'
        ? Number(settings.SIMULATION_BREAKEVEN_PROTECT_PCT || 0.65)
        : Number(settings.SIMULATION_LONG_PROFIT_LOCK_PCT || 0.4);
      const breakevenMinHoldMs = side === 'sell'
        ? Math.max(0, Number(settings.SIMULATION_BREAKEVEN_MIN_HOLD_MIN) || 0) * 60000
        : Math.max(0, Number(settings.SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN) || 0) * 60000;
      if ((trade._maxFavorablePct || 0) >= profitLockActivationPct
          && Number.isFinite(openedAt) && nowMs - openedAt >= breakevenMinHoldMs) {
        const feeEstimate = estimateZerodhaIntradayCharges(entry, entry, Number(trade.qty) || 1, side);
        const exposure = entry * (Number(trade.qty) || 1);
        const costPct = exposure > 0 ? (Number(feeEstimate.total) || 0) / exposure * 100 : 0;
        const slippagePct = Math.max(0, Number(settings.SIMULATION_SLIPPAGE_PCT) || 0);
        const protectPct = (costPct + slippagePct + Math.max(0, Number(settings.SIMULATION_BREAKEVEN_COST_BUFFER_PCT) || 0)) / 100;
        const protectedPrice = side === 'sell' ? entry * (1 - protectPct) : entry * (1 + protectPct);
        if (side === 'sell' && price >= protectedPrice) {
          return { reason: 'Simulation breakeven guard', exitPrice:Number(price), protectedPrice, estimatedRoundTripCostPct:round3(costPct), slippagePct };
        }
        if (side !== 'sell' && price <= protectedPrice) {
          return { reason: 'Simulation breakeven guard', exitPrice:Number(price), protectedPrice, estimatedRoundTripCostPct:round3(costPct), slippagePct };
        }
      }
      if ((trade._maxFavorablePct || 0) >= Number(settings.SIMULATION_TRAIL_START_PCT || 0.8) && Number.isFinite(Number(trade._bestPrice))) {
        const baseTrailPct = side === 'sell'
          ? Number(settings.SIMULATION_SHORT_TRAIL_PCT || 0.4) / 100
          : Number(settings.SIMULATION_LONG_TRAIL_PCT || 0.4) / 100;
        const momentumHealthy = isTradeMomentumHealthy(trade, candidate, price, settings);
        const healthyTrailPct = side === 'sell'
          ? Math.max(baseTrailPct, Number(settings.SIMULATION_SHORT_TRAIL_PCT || 0.4) / 100)
          : Math.max(baseTrailPct, Number(settings.SIMULATION_RUNNER_TRAIL_PCT || 0.9) / 100);
        const trailPct = Number(trade._runnerWideTrail)
          ? settings.SIMULATION_RUNNER_WIDE_TRAIL_PCT / 100
          : (momentumHealthy ? healthyTrailPct : baseTrailPct);
        const trail = side === 'sell'
          ? Number(trade._bestPrice) * (1 + trailPct)
          : Number(trade._bestPrice) * (1 - trailPct);
        if (side === 'sell' && price >= trail) return { reason: momentumHealthy ? 'Simulation healthy momentum trail' : 'Simulation trailing stop', exitPrice: trail };
        if (side !== 'sell' && price <= trail) return { reason: momentumHealthy ? 'Simulation healthy momentum trail' : 'Simulation trailing stop', exitPrice: trail };
      }
      const negCandleExit = getNegativeCandleExit(trade, price, candidate, settings);
      if (negCandleExit) return negCandleExit;
      const noProgressExit = getNoProgressExit(trade, price, candidate, at, settings);
      if (noProgressExit) return noProgressExit;
      if (!isMomentumRunnerTrade(trade) && Number.isFinite(openedAt) && nowMs - openedAt >= Number(settings.SIMULATION_TIME_STOP_MIN || 45) * 60 * 1000 && favorablePct < Number(settings.SIMULATION_TIME_STOP_MIN_PROFIT_PCT || 0.2)) {
        const live = getPaperTradePnl(trade, price);
        if (isSimulationSignalDeteriorated(trade, candidate, price)) return { reason: 'Simulation signal deterioration', exitPrice: Number(price) };
        if (live && live.pnl <= 0 && favorablePct <= -0.15) return { reason: 'Simulation time stop cost guard', exitPrice: Number(price) };
      }
    }
    const runnerExit = getMomentumRunnerExit(trade, price, candidate, settings);
    if (runnerExit) return runnerExit;
    const fadeExit = getMomentumFadeExit(trade, price, candidate, at, settings);
    if (fadeExit) return fadeExit;
    if (side === 'sell') {
      if (!isMomentumRunnerTrade(trade) && Number.isFinite(target) && price <= target) {
        const runner = getTargetRunnerInfo(trade, candidate, price, settings);
        if (!trade._partialTargetBooked && Number(trade.qty) > 1) {
          return { reason: runner.ok ? 'Simulation partial target runner' : 'Simulation partial target', exitPrice: target, action: 'partial', qtyPct: settings.SIMULATION_TARGET_PARTIAL_QTY_PCT, runner: runner.ok, newTarget: runner.ok ? getNextRunnerTarget(trade, price, settings) : null };
        }
        return { reason: 'Simulation target', exitPrice: target };
      }
      const stopExit = getSimulationStopExit(trade, price, candidate, at, settings);
      if (stopExit) return stopExit;
      if (opts.isEodSettlement) return { reason: 'Simulation EOD square-off', exitPrice: Number(price) };
      return null;
    }
    if (!isMomentumRunnerTrade(trade) && Number.isFinite(target) && price >= target) {
      const runner = getTargetRunnerInfo(trade, candidate, price, settings);
      if (!trade._partialTargetBooked && Number(trade.qty) > 1) {
        return { reason: runner.ok ? 'Simulation partial target runner' : 'Simulation partial target', exitPrice: target, action: 'partial', qtyPct: settings.SIMULATION_TARGET_PARTIAL_QTY_PCT, runner: runner.ok, newTarget: runner.ok ? getNextRunnerTarget(trade, price, settings) : null };
      }
      return { reason: 'Simulation target', exitPrice: target };
    }
    const stopExit = getSimulationStopExit(trade, price, candidate, at, settings);
    if (stopExit) return stopExit;
    if (opts.isEodSettlement) return { reason: 'Simulation EOD square-off', exitPrice: Number(price) };
    return null;
  }

  function getSimulationExitIntent(trade, candidate, at, settings, opts) {
    const price = getCandidatePrice(candidate);
    if (!trade || !Number.isFinite(price) || price <= 0) return null;
    const exit = getSimulationExit(trade, price, candidate, at, settings, opts);
    if (!exit) return null;
    return {
      symbol: trade.symbol,
      trade,
      candidate,
      price,
      ...exit,
    };
  }

  function getSimulationEntryIntents(candidates, at, settings, context = {}) {
    const effectiveSettings = withDefaults(settings);
    const settingsSnapshot = buildSettingsAuditSnapshot(effectiveSettings);
    const settingsFingerprint = stableAuditFingerprint(settingsSnapshot);
    const availableCash = Number(context?.cashAvailable);
    const maxExposure = Number(effectiveSettings.MAX_POSITION_EXPOSURE);
    const positionMultiplier = Number.isFinite(Number(context?.positionMultiplier))
      ? Math.max(0.1, Math.min(1.0, Number(context.positionMultiplier)))
      : 1.0;
    let remainingCash = Number.isFinite(availableCash) ? Math.max(0, availableCash) : null;
    let remainingHeatRisk = Number.isFinite(Number(context.remainingHeatRisk)) ? Math.max(0, Number(context.remainingHeatRisk)) : null;
    const sectorHeatRemaining = context.sectorHeatRemaining && typeof context.sectorHeatRemaining === 'object' ? { ...context.sectorHeatRemaining } : null;
    return selectSimulationEntryCandidates(candidates, at, effectiveSettings, context)
      .map(candidate => {
        const side = candidate.side || candidate.signal || 'buy';
        const price = getCandidatePrice(candidate);
        const plan = getPaperPlanForCandidate(candidate, side, price, effectiveSettings);
        const explicitQtyRaw = Number(candidate?.qty ?? candidate?.entryContext?.qty);
        const sizing = getSuggestedQty(
          candidate,
          side,
          price,
          remainingCash,
          Number.isFinite(maxExposure) ? maxExposure : null,
          effectiveSettings,
          positionMultiplier
        );
        const computedQty = Math.floor(Number(sizing?.qty));
        let qty = Number.isFinite(explicitQtyRaw) && explicitQtyRaw > 0
          ? Math.floor(explicitQtyRaw)
          : (Number.isFinite(computedQty) && computedQty > 0 ? computedQty : 0);
        const riskPerShare = Number(sizing?.riskPerShare) || Math.abs(Number(plan.stop) - price);
        if (remainingHeatRisk != null && riskPerShare > 0) qty = Math.min(qty, Math.floor(remainingHeatRisk / riskPerShare));
        const sector = String(candidate?.sector || 'UNKNOWN');
        if (sectorHeatRemaining && Number.isFinite(Number(sectorHeatRemaining[sector])) && riskPerShare > 0) {
          qty = Math.min(qty, Math.floor(Math.max(0, Number(sectorHeatRemaining[sector])) / riskPerShare));
        }
        if (qty <= 0) return null;
        if (remainingCash != null) remainingCash = Math.max(0, remainingCash - (price * qty));
        if (remainingHeatRisk != null) remainingHeatRisk = Math.max(0, remainingHeatRisk - riskPerShare * qty);
        if (sectorHeatRemaining) sectorHeatRemaining[sector] = Math.max(0, Number(sectorHeatRemaining[sector]) - riskPerShare * qty);
        const target = hasFiniteNumber(candidate?.target)
          ? round2(Number(candidate.target))
          : (hasFiniteNumber(plan?.target) ? round2(Number(plan.target)) : null);
        const stop = hasFiniteNumber(candidate?.stop)
          ? round2(Number(candidate.stop))
          : (hasFiniteNumber(plan?.stop) ? round2(Number(plan.stop)) : null);
        const risk = Number.isFinite(price) && Number.isFinite(stop) ? Math.abs(price - stop) : null;
        const reward = Number.isFinite(price) && Number.isFinite(target) ? Math.abs(target - price) : null;
        const rr = Number.isFinite(risk) && risk > 0 && Number.isFinite(reward) ? round2(reward / risk) : null;
        const rawEntryContext = candidate.entryContext && typeof candidate.entryContext === 'object' ? candidate.entryContext : {};
        const snapshotAt = candidate.__snapshotAt || candidate.snapshotAt || rawEntryContext.snapshotAt || at || null;
        const snapshotId = candidate.__snapshotId || candidate.snapshotId || rawEntryContext.snapshotId || null;
        const snapshotSource = candidate.__snapshotSource || candidate.snapshotSource || rawEntryContext.snapshotSource || null;
        return {
          symbol: candidate.symbol,
          side,
          qty,
          price,
          entryPrice: price,
          target,
          stop,
          signal: candidate.signal || side,
          score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
          decisionScore: getCandidateDecisionScore(candidate),
          rr,
          sector:candidate.sector || candidate.sectorPriority?.sector || '',
          setupType: candidate.derivedSetupType || candidate.setupType || null,
          setup: candidate.setup || candidate.indicators?.setup || null,
          entryContext: {
            ...rawEntryContext,
            snapshotId,
            snapshotAt,
            snapshotSource,
            snapshotAgeMin: candidate.__snapshotAgeMin ?? rawEntryContext.snapshotAgeMin ?? null,
            candidateScore: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
            decisionScore:getCandidateDecisionScore(candidate),
            scoreAudit:candidate.scoreAudit || null,
            indicatorSnapshot:buildIndicatorAuditSnapshot(candidate),
            settingsSnapshot,
            settingsFingerprint,
            confirmation:getLongEntryConfirmation(candidate, candidate.previousCandidate, side, snapshotAt || at, effectiveSettings),
            candidateSetupType: candidate.derivedSetupType || candidate.setupType || null,
            sectorAligned:!!candidate.sectorPriority?.aligned,
            sectorPriority:candidate.sectorPriority || null,
          },
          snapshotId,
          snapshotAt,
          notes: candidate.notes || '',
          assetType: candidate.assetType || null,
          candidate,
        };
      })
      .filter(Boolean);
  }

  function exitBucket(reason) {
    const text = String(reason || '').toLowerCase();
    if (text.includes('target')) return 'Target';
    if (text.includes('trail')) return 'Trail';
    if (text.includes('vwap')) return 'VWAP';
    if (text.includes('zero-progress')) return 'Zero-progress';
    if (text.includes('breakeven')) return 'Breakeven guard';
    if (text.includes('negative candle')) return 'Candle exit';
    if (text.includes('momentum') || text.includes('deterioration') || text.includes('fade')) return 'Momentum fade';
    if (text.includes('stop')) return 'Stop';
    if (text.includes('eod') || text.includes('square')) return 'EOD';
    if (text.includes('mark')) return 'Marked';
    return reason || 'Other';
  }

  function summarizeTradeQuality(trades, settings) {
    settings = withDefaults(settings);
    const closed = (Array.isArray(trades) ? trades : []).filter(t => String(t?.status || '').toLowerCase() === 'closed');
    const add = (map, key, trade) => {
      const name = key || 'UNKNOWN';
      const row = map.get(name) || {
        key:name,
        trades:0,
        wins:0,
        losses:0,
        net:0,
        gross:0,
        fees:0,
        holdMin:0,
        netPct:0,
        targetHits:0,
        stopHits:0,
        trailHits:0,
        fadeHits:0,
        lateEntries:0,
      };
      const pnl = Number(trade.pnl) || 0;
      const reason = String(trade.closeReason || '');
      row.trades += 1;
      row.wins += pnl > 0 ? 1 : 0;
      row.losses += pnl <= 0 ? 1 : 0;
      row.net += pnl;
      row.gross += Number(trade.grossPnl) || 0;
      row.fees += Number(trade.charges) || 0;
      row.holdMin += getTradeHoldMinutes(trade, trade.closedAt);
      row.netPct += Number(trade.pnlPct) || 0;
      row.targetHits += /target/i.test(reason) ? 1 : 0;
      row.stopHits += /stop/i.test(reason) ? 1 : 0;
      row.trailHits += /trail|breakeven/i.test(reason) ? 1 : 0;
      row.fadeHits += /vwap|momentum|deterioration|fade/i.test(reason) ? 1 : 0;
      const openedMin = TradeRules.getIstMinutes(trade.openedAt);
      row.lateEntries += openedMin != null && openedMin >= 12 * 60 ? 1 : 0;
      map.set(name, row);
    };
    const finish = row => ({
      key:row.key,
      setup:row.key,
      trades:row.trades,
      wins:row.wins,
      losses:row.losses,
      winRate:round1((row.wins / Math.max(1, row.trades)) * 100),
      net:round2(row.net),
      gross:round2(row.gross),
      fees:round2(row.fees),
      avgHoldMin:round1(row.holdMin / Math.max(1, row.trades)),
      avgNetPct:round3(row.netPct / Math.max(1, row.trades)),
      targetHitPct:round1((row.targetHits / Math.max(1, row.trades)) * 100),
      stopHitPct:round1((row.stopHits / Math.max(1, row.trades)) * 100),
      trailHitPct:round1((row.trailHits / Math.max(1, row.trades)) * 100),
      fadeExitPct:round1((row.fadeHits / Math.max(1, row.trades)) * 100),
      lateEntryPct:round1((row.lateEntries / Math.max(1, row.trades)) * 100),
    });
    const bySetup = new Map();
    const byExit = new Map();
    const byHour = new Map();
    for (const trade of closed) {
      add(bySetup, trade.setupType || 'UNKNOWN', trade);
      add(byExit, exitBucket(trade.closeReason), trade);
      const mins = TradeRules.getIstMinutes(trade.openedAt);
      add(byHour, mins == null ? 'Unknown' : `${String(Math.floor(mins / 60)).padStart(2, '0')}:00`, trade);
    }
    const rows = map => [...map.values()].map(finish).sort((a, b) => b.net - a.net || b.trades - a.trades);
    const wins = closed.filter(t => Number(t.pnl) > 0).length;
    const net = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    return {
      summary:{
        trades:closed.length,
        wins,
        losses:closed.length - wins,
        winRate:round1((wins / Math.max(1, closed.length)) * 100),
        net:round2(net),
        avgHoldMin:round1(closed.reduce((sum, t) => sum + getTradeHoldMinutes(t, t.closedAt), 0) / Math.max(1, closed.length)),
        avgNetPct:round3(closed.reduce((sum, t) => sum + (Number(t.pnlPct) || 0), 0) / Math.max(1, closed.length)),
      },
      bySetup:rows(bySetup),
      byExit:rows(byExit),
      byHour:rows(byHour),
    };
  }

  function summarizeReplayParity(actualTrades, replayTrades) {
    const actual = (Array.isArray(actualTrades) ? actualTrades : []).filter(t => String(t?.source || '').toLowerCase() === 'simulation');
    const replay = Array.isArray(replayTrades) ? replayTrades : [];
    const key = t => `${String(t?.symbol || '').toUpperCase()}|${String(t?.side || 'buy').toUpperCase()}`;
    const actualMap = new Map(actual.map(t => [key(t), t]));
    const replayMap = new Map(replay.map(t => [key(t), t]));
    const matched = [...actualMap.keys()].filter(k => replayMap.has(k));
    const actualOnly = [...actualMap.keys()].filter(k => !replayMap.has(k));
    const replayOnly = [...replayMap.keys()].filter(k => !actualMap.has(k));
    const actualNet = actual.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    const replayNet = replay.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    return {
      matched:matched.length,
      actualCount:actual.length,
      replayCount:replay.length,
      actualOnly:actualOnly.slice(0, 12),
      replayOnly:replayOnly.slice(0, 12),
      matchPct:round1((matched.length / Math.max(1, new Set([...actualMap.keys(), ...replayMap.keys()]).size)) * 100),
      actualNet:round2(actualNet),
      replayNet:round2(replayNet),
      diff:round2(replayNet - actualNet),
    };
  }

  function summarizeSimulationSafety(trades, settings, context = {}) {
    settings = withDefaults(settings);
    const list = Array.isArray(trades) ? trades : [];
    const open = list.filter(t => {
      if (String(t?.status || '').toLowerCase() !== 'open') return false;
      const brokerStatus = String(t?.broker?.status || '').toLowerCase();
      return !['cancelled', 'rejected', 'timeout', 'failed'].includes(brokerStatus);
    });
    const simOpen = open.filter(t => String(t?.source || '').toLowerCase() === 'simulation');
    const dayStats = context.dayStats || TradeRules.buildDayStats(list, context.at || Date.now(), settings, context);
    const cash = Number(context.cashAvailable);
    const totalSlots = Math.max(0, Number(settings.SIMULATION_MAX_OPEN) - open.length);
    const activeSlots = Math.max(0, Number(settings.SIMULATION_MAX_ACTIVE_OPEN) - simOpen.length);
    const slots = Math.max(0, Math.min(totalSlots, activeSlots));
    const reasons = [];
    if (slots <= 0) reasons.push('open position limit reached');
    if (Number.isFinite(cash) && cash <= 0) reasons.push('no available cash');
    const stopLimit = Number(dayStats.dailyStopLimit ?? TradeRules.getEffectiveStopLimit(dayStats.netPnl, settings));
    const stopGuardOverride = !!settings.SIMULATION_OVERRIDE_STOP_GUARD;
    if (!stopGuardOverride && (Number(dayStats.stops) || 0) >= stopLimit) reasons.push(`daily stop guard ${dayStats.stops}/${stopLimit}`);
    if ((Number(dayStats.entries) || 0) >= Number(settings.SIMULATION_DAILY_MAX_TRADES)) reasons.push(`daily trade limit ${dayStats.entries}/${settings.SIMULATION_DAILY_MAX_TRADES}`);
    if ((Number(dayStats.netLossPct) || 0) >= Number(settings.SIMULATION_DAILY_MAX_NET_LOSS_PCT)) reasons.push(`daily loss guard ${dayStats.netLossPct}%`);
    return {
      state:context.state || 'off',
      open:open.length,
      simOpen:simOpen.length,
      totalSlots,
      activeSlots,
      slots,
      entries:Number(dayStats.entries) || 0,
      maxEntries:Number(settings.SIMULATION_DAILY_MAX_TRADES) || 0,
      firstHourEntries:Number(dayStats.firstHourEntries) || 0,
      firstHourMax:Number(settings.SIMULATION_FIRST_HOUR_MAX_ENTRIES) || 0,
      stops:Number(dayStats.stops) || 0,
      stopLimit,
      stopGuardOverride,
      netPnl:Number(dayStats.netPnl) || 0,
      netLossPct:Number(dayStats.netLossPct) || 0,
      cashAvailable:Number.isFinite(cash) ? round2(cash) : null,
      blocked:reasons.length > 0,
      reasons,
    };
  }

  function getIstMinutes(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
    return ist.getUTCHours() * 60 + ist.getUTCMinutes();
  }

  return {
    DEFAULT_SETTINGS,
    withDefaults,
    round1,
    round2,
    round3,
    getCandidatePrice,
    adjustedTradeSignal,
    setupPriority,
    isSimulationSetupAllowed,
    getEntryTriggerPrice,
    getRelativeVolume,
    annotateTopGainerRanks,
    getTopGainerContinuationInfo,
    isStrongVolumeBreakoutCandidate,
    getRecentVolumeImpulseInfo,
    isLateRunnerAllowed,
    getMarketRegime,
    isTriggeredAboveVwap,
    hasFreshBreakoutConfirmation,
    toConfirmationCandidate,
    buildNetExpectancyModel,
    resolveCandidateExpectancy,
    getIndependentQualityScore,
    applyDecisionScore,
    getCandidateDecisionScore,
    getNegativeExpectancyBlockReason,
    buildSettingsAuditSnapshot,
    stableAuditFingerprint,
    buildIndicatorAuditSnapshot,
    getMinScoreForSide,
    getMinScoreForCandidate,
    getAllowedGuardLevelsForSide,
    getMaxStopPctForSide,
    getTriggerDistancePct,
    getDataQualityIssues,
    getSnapshotDataQuality,
    explainCandidateEligibility,
    getBreakoutConfirmations,
    getShortBearishConfirmations,
    getShortBearishConfirmationCount,
    isTradeMomentumHealthy,
    isCandidateContinuationReentryAllowed,
    getMomentumRunnerInfo,
    getVwapContinuationInfo,
    deriveSetupType,
    getSetupBlockReason,
    isReplayCandidateEligible,
    compareCandidates,
    selectSimulationEntryCandidates,
    estimateZerodhaIntradayCharges,
    applyAdverseSlippage,
    getPaperTradePnl,
    getPaperPlanForCandidate,
    getNextRunnerTarget,
    getSuggestedQty,
    isMomentumRunnerTrade,
    isSimulationSignalDeteriorated,
    isSimulationStopDeteriorated,
    isMomentumRunnerBroken,
    getTargetRunnerInfo,
    getProfitReentryBlockReason,
    getSimulationStopExit,
    getMomentumRunnerExit,
    getSimulationExit,
    getLatestCandidateCandle,
    getLatestCompletedCandidateCandle,
    getCandidateCandles,
    getLongEntryConfirmation,
    getSimulationExitIntent,
    getSimulationEntryIntents,
    getMomentumFadeExit,
    getTopGainerContinuationExit,
    getTradeHoldMinutes,
    exitBucket,
    summarizeTradeQuality,
    summarizeReplayParity,
    summarizeSimulationSafety,
    clearFeeCache: function() {
      feeCache.clear();
    }
  };
});
