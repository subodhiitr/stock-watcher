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
    if (setupType === 'OPENING_FLUSH_VWAP_RECLAIM') return 0;
    if (setupType === 'TOP_GAINER_PULLBACK_RECLAIM') return 0;
    if (setupType === 'TOP_GAINER_CONTINUATION') return 0;
    if (setupType === 'GAP_AND_GO') return 0;
    if (setupType === 'BULL_FLAG_CONTINUATION') return 0;
    if (setupType === 'EARLY_MOMENTUM') return 0;
    if (setupType === 'MOMENTUM_RUNNER') return 0;
    if (setupType === 'VWAP_TREND_CONTINUATION') return 1;
    if (setupType === 'BREAKDOWN' || setupType === 'BEAR_FLAG_CONTINUATION' || setupType === 'TOP_LOSER_BEAR_FLAG') return 1;
    if (setupType === 'RANGEBOUND') return 1;
    if (setupType === 'VWAP_PULLBACK_OR_HOLD') return 2;
    if (setupType === 'VWAP_REJECTION') return 2;
    if (setupType === 'FRESH_BREAKOUT') return 3;
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') return 4;
    if (setupType === 'LONG_MOMENTUM') return 5;
    return 9;
  }

  function isSimulationSetupAllowed(setupType, settings = {}) {
    const definition = (TradeRules.SIMULATION_SETUP_DEFINITIONS || []).find(item => item.type === setupType);
    if (!definition) return false;
    const effective = withDefaults(settings);
    return effective[definition.key] !== false;
  }

  function getMinScoreForSide(settings, side) {
    settings = withDefaults(settings);
    if (side === 'sell') return Number(settings.SIMULATION_SHORT_MIN_SCORE) || Number(settings.SIMULATION_MIN_SCORE) || 0;
    return Number(settings.SIMULATION_MIN_SCORE) || 0;
  }

  function getMinScoreForCandidate(settings, side, setupType, candidate = null) {
    settings = withDefaults(settings);
    const freshBreakoutMinScore = Number(settings.SIMULATION_FRESH_BREAKOUT_MIN_SCORE) || getMinScoreForSide(settings, side);
    if (setupType === 'EARLY_MOMENTUM') {
      return Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_SCORE) || 55;
    }
    if (setupType === 'OPENING_FLUSH_VWAP_RECLAIM') {
      return Number(settings.SIMULATION_OPENING_FLUSH_MIN_SCORE) || 60;
    }
    if (setupType === 'TOP_LOSER_BEAR_FLAG') {
      return Number(settings.SIMULATION_TOP_LOSER_BEAR_FLAG_MIN_SCORE) || 55;
    }
    if (setupType === 'RANGEBOUND') {
      return Math.max(0, Number(settings.SIMULATION_RANGEBOUND_MIN_SCORE) || 35);
    }
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

  function getRangeboundInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    const source = candidate?.indicators?.rangebound || candidate?.rangebound || {};
    const depth = candidate?.indicators?.marketDepth || candidate?.marketDepth || {};
    const price = getCandidatePrice(candidate);
    const lower = Number(source.lower);
    const upper = Number(source.upper);
    const rangePct = Number(source.rangePct);
    const windowMin = Number(source.windowMin);
    const lowerTouches = Math.max(0, Number(source.lowerTouches) || 0);
    const upperTouches = Math.max(0, Number(source.upperTouches) || 0);
    const midpointCrosses = Math.max(0, Number(source.midpointCrosses) || 0);
    const requiredWindowMin = Math.max(5, Number(settings.SIMULATION_RANGEBOUND_WINDOW_MIN) || 45);
    const minRangePct = Math.max(0, Number(settings.SIMULATION_RANGEBOUND_MIN_RANGE_PCT) || 0.75);
    const maxLowerDistancePct = Math.max(0, Number(settings.SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT) || 0.15);
    const minTouches = Math.max(1, Math.floor(Number(settings.SIMULATION_RANGEBOUND_MIN_TOUCHES_PER_SIDE) || 2));
    const minCrosses = Math.max(1, Math.floor(Number(settings.SIMULATION_RANGEBOUND_MIN_MIDPOINT_CROSSES) || 2));
    const lowerDistancePct = Number.isFinite(price) && price > 0 && Number.isFinite(lower) && lower > 0
      ? ((price - lower) / lower) * 100
      : null;
    const completeWindow = Number.isFinite(windowMin) && windowMin >= requiredWindowMin;
    const validBounds = Number.isFinite(lower) && lower > 0 && Number.isFinite(upper) && upper > lower;
    const wideEnough = Number.isFinite(rangePct) && rangePct >= minRangePct;
    const oscillating = lowerTouches >= minTouches && upperTouches >= minTouches && midpointCrosses >= minCrosses;
    const atLower = Number.isFinite(lowerDistancePct) && lowerDistancePct >= -0.1 && lowerDistancePct <= maxLowerDistancePct;
    const liquidityGateEnabled = settings.SIMULATION_RANGEBOUND_LIQUIDITY_GATE_ENABLED !== false;
    const requireLiveDepth = settings.SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH === true;
    const configuredDepthAgeSec = Number(settings.SIMULATION_RANGEBOUND_MAX_DEPTH_AGE_SEC);
    const configuredSpreadPct = Number(settings.SIMULATION_RANGEBOUND_MAX_SPREAD_PCT);
    const configuredBookImbalance = Number(settings.SIMULATION_RANGEBOUND_MIN_BOOK_IMBALANCE);
    const configuredCombinedDepthQty = Number(settings.SIMULATION_RANGEBOUND_MIN_COMBINED_DEPTH_QTY);
    const maxDepthAgeSec = Math.max(1, Number.isFinite(configuredDepthAgeSec) ? configuredDepthAgeSec : 15);
    const maxSpreadPct = Math.max(0, Number.isFinite(configuredSpreadPct) ? configuredSpreadPct : 0.15);
    const minBookImbalance = Math.max(0, Math.min(1, Number.isFinite(configuredBookImbalance) ? configuredBookImbalance : 0.5));
    const minCombinedDepthQty = Math.max(0, Number.isFinite(configuredCombinedDepthQty) ? configuredCombinedDepthQty : 1);
    const bestBidPrice = Number(depth.bestBidPrice);
    const bestAskPrice = Number(depth.bestAskPrice);
    const totalBidQuantity = Number(depth.totalBidQuantity ?? depth.bestBidQuantity);
    const totalAskQuantity = Number(depth.totalAskQuantity ?? depth.bestAskQuantity);
    const combinedDepthQty = Number.isFinite(Number(depth.combinedQuantity))
      ? Number(depth.combinedQuantity)
      : totalBidQuantity + totalAskQuantity;
    const midpoint = (bestBidPrice + bestAskPrice) / 2;
    const spreadPct = Number.isFinite(Number(depth.spreadPct))
      ? Number(depth.spreadPct)
      : (midpoint > 0 ? (bestAskPrice - bestBidPrice) / midpoint * 100 : null);
    const bookImbalance = Number.isFinite(Number(depth.imbalance))
      ? Number(depth.imbalance)
      : (combinedDepthQty > 0 ? totalBidQuantity / combinedDepthQty : null);
    const depthCapturedAtMs = Number(depth.capturedAtMs) || new Date(depth.capturedAt || 0).getTime();
    const referenceAtMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || Date.now()).getTime();
    const depthAgeSec = Number.isFinite(depthCapturedAtMs) && depthCapturedAtMs > 0 && Number.isFinite(referenceAtMs)
      ? Math.max(0, (referenceAtMs - depthCapturedAtMs) / 1000)
      : null;
    const depthAvailable = bestBidPrice > 0 && bestAskPrice >= bestBidPrice && totalBidQuantity > 0 && totalAskQuantity > 0
      && Number.isFinite(spreadPct) && Number.isFinite(bookImbalance) && Number.isFinite(combinedDepthQty);
    const depthFresh = depthAvailable && depthAgeSec != null && depthAgeSec <= maxDepthAgeSec;
    let liquidityReason = '';
    let liquidityOk = true;
    let liquidityApplied = false;
    if (liquidityGateEnabled && depthFresh) {
      liquidityApplied = true;
      if (spreadPct > maxSpreadPct) liquidityReason = `rangebound spread ${round3(spreadPct)}% > ${round3(maxSpreadPct)}%`;
      else if (combinedDepthQty < minCombinedDepthQty) liquidityReason = `rangebound combined depth ${Math.round(combinedDepthQty)} < ${Math.round(minCombinedDepthQty)}`;
      else if (bookImbalance < minBookImbalance) liquidityReason = `rangebound bid imbalance ${round3(bookImbalance)} < ${round3(minBookImbalance)}`;
      liquidityOk = !liquidityReason;
    } else if (liquidityGateEnabled && requireLiveDepth) {
      liquidityOk = false;
      liquidityReason = depthAvailable
        ? `rangebound market depth stale at ${depthAgeSec == null ? '--' : round2(depthAgeSec)}s (max ${round2(maxDepthAgeSec)}s)`
        : 'rangebound live bid/ask depth unavailable';
    }
    const detected = settings.SIMULATION_RANGEBOUND_ENABLED !== false && completeWindow && validBounds && wideEnough && oscillating;
    const ok = detected && atLower && liquidityOk;
    let reason = 'rangebound lower boundary reached';
    if (settings.SIMULATION_RANGEBOUND_ENABLED === false) reason = 'rangebound setup disabled';
    else if (!completeWindow) reason = `rangebound window ${Number.isFinite(windowMin) ? round2(windowMin) : '--'}m < ${round2(requiredWindowMin)}m`;
    else if (!validBounds) reason = 'rangebound boundaries unavailable';
    else if (!wideEnough) reason = `rangebound width ${Number.isFinite(rangePct) ? round2(rangePct) : '--'}% < ${round2(minRangePct)}%`;
    else if (!oscillating) reason = `rangebound oscillation needs ${minTouches} touches/side and ${minCrosses} midpoint crosses`;
    else if (!atLower) reason = `rangebound price ${Number.isFinite(lowerDistancePct) ? round3(lowerDistancePct) : '--'}% above lower boundary (max ${round3(maxLowerDistancePct)}%)`;
    else if (!liquidityOk) reason = liquidityReason;
    return {
      ok,
      detected,
      atLower,
      lower:Number.isFinite(lower) ? lower : null,
      upper:Number.isFinite(upper) ? upper : null,
      rangePct:Number.isFinite(rangePct) ? rangePct : null,
      lowerDistancePct:Number.isFinite(lowerDistancePct) ? lowerDistancePct : null,
      windowMin:Number.isFinite(windowMin) ? windowMin : null,
      lowerTouches,
      upperTouches,
      midpointCrosses,
      liquidity: {
        enabled:liquidityGateEnabled,
        required:requireLiveDepth,
        applied:liquidityApplied,
        ok:liquidityOk,
        reason:liquidityReason,
        bestBidPrice:Number.isFinite(bestBidPrice) ? bestBidPrice : null,
        bestAskPrice:Number.isFinite(bestAskPrice) ? bestAskPrice : null,
        totalBidQuantity:Number.isFinite(totalBidQuantity) ? totalBidQuantity : null,
        totalAskQuantity:Number.isFinite(totalAskQuantity) ? totalAskQuantity : null,
        combinedDepthQty:Number.isFinite(combinedDepthQty) ? combinedDepthQty : null,
        spreadPct:Number.isFinite(spreadPct) ? round3(spreadPct) : null,
        bookImbalance:Number.isFinite(bookImbalance) ? round3(bookImbalance) : null,
        depthAgeSec:Number.isFinite(depthAgeSec) ? round2(depthAgeSec) : null,
        source:depth.source || null,
      },
      reason,
    };
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
    const confirmationAgeMin = Number.isFinite(snapshotMs) && Number.isFinite(confirmingCandleEndMs)
      ? Math.max(0, (snapshotMs - confirmingCandleEndMs) / 60000)
      : null;
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
      confirmationAgeMin,
    };
  }

  function getShortEntryConfirmation(candidate, previousCandidate, side, at, settings = {}) {
    settings = withDefaults(settings);
    const tradeSide = side || candidate?.side || candidate?.signal || 'sell';
    if (tradeSide !== 'sell') return { ok:true, mode:'not-applicable', reason:'' };
    if (!settings.SIMULATION_SHORT_REQUIRE_COMPLETED_CANDLE) {
      const current = isTriggeredAboveVwap(candidate, 'sell');
      const previous = isTriggeredAboveVwap(previousCandidate, 'sell');
      const ok = current && previous;
      return { ok, mode:'two_snapshots', reason:ok ? '' : 'short setup needs two triggered below-VWAP snapshots' };
    }
    const trigger = getEntryTriggerPrice(candidate);
    const price = getCandidatePrice(candidate);
    const vwap = Number(candidate?.indicators?.vwap);
    const snapshotAt = at || candidate?.__snapshotAt || candidate?.snapshotAt || candidate?.priceTime || candidate?.quote?.time;
    const snapshotMs = new Date(snapshotAt || 0).getTime();
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const candles = [...getCandidateCandles(previousCandidate), ...getCandidateCandles(candidate)];
    const byTime = new Map(candles.map(bar => [bar.time, bar]));
    const completed = [...byTime.values()]
      .filter(bar => Number.isFinite(snapshotMs) && new Date(bar.time).getTime() + intervalMs <= snapshotMs)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const requiredBars = Math.max(1, Math.floor(Number(settings.SIMULATION_SHORT_CONFIRM_BARS) || 2));
    const persistenceCandles = completed.slice(-requiredBars);
    const confirmingCandle = persistenceCandles[0] || null;
    const holdCandle = persistenceCandles.at(-1) || null;
    const persistenceOk = persistenceCandles.length >= requiredBars && persistenceCandles.every(bar =>
      Number.isFinite(trigger) && bar.close < trigger &&
      Number.isFinite(vwap) && vwap > 0 && bar.close < vwap
    );
    const candleBelowTrigger = !!confirmingCandle && Number.isFinite(trigger) && confirmingCandle.close < trigger;
    const candleBelowVwap = !!confirmingCandle && Number.isFinite(vwap) && vwap > 0 && confirmingCandle.close < vwap;
    const bearishCandle = !!confirmingCandle && confirmingCandle.close < confirmingCandle.open;
    const range = confirmingCandle ? confirmingCandle.high - confirmingCandle.low : NaN;
    const lowerWick = confirmingCandle ? Math.min(confirmingCandle.open, confirmingCandle.close) - confirmingCandle.low : NaN;
    const lowerWickRatio = Number.isFinite(range) && range > 0 ? lowerWick / range : null;
    const wickOk = lowerWickRatio == null || lowerWickRatio <= Number(settings.SIMULATION_SHORT_MAX_CONFIRM_LOWER_WICK_RATIO || 0.45);
    const triggerHeld = Number.isFinite(price) && Number.isFinite(trigger) && price <= trigger;
    const vwapHeld = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0 && price <= vwap;
    const shock = getVolumeShockInfo(candidate);
    const volumeRatio3m = Number(shock.volumeRatio3m);
    const volumeRatio5m = Number(shock.volumeRatio5m);
    const confirmingCandleEndMs = holdCandle ? new Date(holdCandle.time).getTime() + intervalMs : NaN;
    const volumeObservedAfterConfirmation = Number.isFinite(snapshotMs) && Number.isFinite(confirmingCandleEndMs) && snapshotMs > confirmingCandleEndMs;
    const freshVolumeOk = !settings.SIMULATION_SHORT_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION || (
      volumeObservedAfterConfirmation && (
        (Number.isFinite(volumeRatio3m) && volumeRatio3m >= Number(settings.SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_3M || 1)) ||
        (Number.isFinite(volumeRatio5m) && volumeRatio5m >= Number(settings.SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_5M || 1))
      )
    );
    const retestRejected = !!confirmingCandle && Number.isFinite(vwap) && Number.isFinite(trigger) &&
      confirmingCandle.high >= Math.min(vwap, trigger) && candleBelowTrigger && candleBelowVwap && bearishCandle;
    const ok = candleBelowTrigger && candleBelowVwap && bearishCandle && persistenceOk && wickOk && triggerHeld && vwapHeld && freshVolumeOk;
    let reason = '';
    if (!Number.isFinite(trigger)) reason = 'short setup needs a numeric entry trigger';
    else if (!confirmingCandle) reason = `short setup needs a completed ${intervalMin}m candle below the trigger`;
    else if (!candleBelowTrigger || !candleBelowVwap) reason = `completed short candle must close below trigger ${round2(trigger)} and VWAP ${round2(vwap)}`;
    else if (!bearishCandle) reason = 'completed short confirmation candle must close bearish';
    else if (!persistenceOk) reason = `short setup needs ${requiredBars} completed candles holding below trigger and VWAP`;
    else if (!wickOk) reason = `short confirmation lower wick ${round2((lowerWickRatio || 0) * 100)}% is too large`;
    else if (!triggerHeld || !vwapHeld) reason = `post-breakdown hold failed: price ${round2(price)} must remain below trigger ${round2(trigger)} and VWAP ${round2(vwap)}`;
    else if (!freshVolumeOk) reason = `short setup needs fresh post-confirmation volume (${Number.isFinite(volumeRatio3m) ? round2(volumeRatio3m) : '--'}x/3m or ${Number.isFinite(volumeRatio5m) ? round2(volumeRatio5m) : '--'}x/5m)`;
    return {
      ok,
      mode:'completed_candle_hold',
      reason,
      intervalMin,
      snapshotAt:Number.isFinite(snapshotMs) ? new Date(snapshotMs).toISOString() : null,
      candle:confirmingCandle,
      holdCandle,
      persistenceCandles,
      requiredBars,
      persistenceOk,
      candleBelowTrigger,
      candleBelowVwap,
      bearishCandle,
      lowerWickRatio:lowerWickRatio == null ? null : round3(lowerWickRatio),
      wickOk,
      trigger,
      vwap:Number.isFinite(vwap) ? vwap : null,
      price:Number.isFinite(price) ? price : null,
      triggerHeld,
      vwapHeld,
      volumeObservedAfterConfirmation,
      volumeRatio3m:Number.isFinite(volumeRatio3m) ? volumeRatio3m : null,
      volumeRatio5m:Number.isFinite(volumeRatio5m) ? volumeRatio5m : null,
      freshVolumeOk,
      retestRejected,
    };
  }

  function getEntryConfirmation(candidate, previousCandidate, side, at, settings = {}) {
    return String(side || candidate?.side || candidate?.signal || '').toLowerCase() === 'sell'
      ? getShortEntryConfirmation(candidate, previousCandidate, 'sell', at, settings)
      : getLongEntryConfirmation(candidate, previousCandidate, side, at, settings);
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

  function parseEntryTriggerPrice(candidateOrIndicators) {
    const indicators = candidateOrIndicators?.indicators || candidateOrIndicators || {};
    const setupType = String(candidateOrIndicators?.derivedSetupType || candidateOrIndicators?.setupType || '').toUpperCase();
    const earlyTrigger = Number(indicators?.earlyMomentum?.trigger);
    if (setupType === 'EARLY_MOMENTUM' && Number.isFinite(earlyTrigger) && earlyTrigger > 0) return earlyTrigger;
    const text = String(indicators.entryTrigger || '');
    const match = text.match(/(?:above|below)\s+([0-9,.]+)/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function getEntryTriggerPrice(candidateOrIndicators) {
    const setupTrigger = Number(candidateOrIndicators?.__setupEntryTrigger);
    if (Number.isFinite(setupTrigger) && setupTrigger > 0) return setupTrigger;
    const frozenTrigger = Number(candidateOrIndicators?.__frozenEntryTrigger);
    if (Number.isFinite(frozenTrigger) && frozenTrigger > 0) return frozenTrigger;
    return parseEntryTriggerPrice(candidateOrIndicators);
  }

  function applyFrozenEntryTrigger(candidate, previousCandidate, at, settings = {}) {
    settings = withDefaults(settings);
    if (!candidate || !settings.SIMULATION_ENTRY_TRIGGER_FREEZE_ENABLED) return candidate;
    const currentTrigger = parseEntryTriggerPrice(candidate);
    if (!Number.isFinite(currentTrigger) || currentTrigger <= 0) return candidate;
    const status = String(candidate?.indicators?.entryStatus || '').toLowerCase();
    if (!['near trigger', 'triggered'].includes(status)) return candidate;
    const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
    const previousSide = String(previousCandidate?.side || previousCandidate?.signal || '').toLowerCase();
    const nowMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || Date.now()).getTime();
    const previousAt = Number(previousCandidate?.__frozenTriggerAt);
    const freezeMs = Math.max(1, Number(settings.SIMULATION_ENTRY_TRIGGER_FREEZE_MIN) || 15) * 60000;
    const canReuse = previousSide === side && Number.isFinite(Number(previousCandidate?.__frozenEntryTrigger)) &&
      Number.isFinite(previousAt) && Number.isFinite(nowMs) && nowMs - previousAt >= 0 && nowMs - previousAt <= freezeMs;
    candidate.__frozenEntryTrigger = canReuse ? Number(previousCandidate.__frozenEntryTrigger) : currentTrigger;
    candidate.__frozenTriggerAt = canReuse ? previousAt : nowMs;
    return candidate;
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
      delete candidate.topLoserRank;
      if (candidate.indicators && typeof candidate.indicators === 'object') delete candidate.indicators.topGainerRank;
      if (candidate.indicators && typeof candidate.indicators === 'object') delete candidate.indicators.topLoserRank;
    }
    const count = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_GAINER_COUNT) || 5));
    if (settings.SIMULATION_TOP_GAINER_CONTINUATION_ENABLED) source
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
    if (settings.SIMULATION_TOP_LOSER_BEAR_FLAG_ENABLED) {
      const loserCount = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_LOSER_COUNT) || 5));
      source
        .filter(candidate => String(candidate?.assetType || 'stock').toLowerCase() !== 'etf')
        .map(candidate => ({ candidate, dayChange:getCandidateDayChange(candidate) }))
        .filter(item => Number.isFinite(item.dayChange))
        .sort((a, b) => a.dayChange - b.dayChange)
        .slice(0, loserCount)
        .forEach((item, index) => {
          item.candidate.topLoserRank = index + 1;
          if (item.candidate.indicators && typeof item.candidate.indicators === 'object') {
            item.candidate.indicators.topLoserRank = index + 1;
          }
        });
    }
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

  function getCompletedCandles(candidate, previousCandidate, at, intervalMin = 5) {
    const snapshotMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || 0).getTime();
    if (!Number.isFinite(snapshotMs)) return [];
    const intervalMs = Math.max(1, Number(intervalMin) || 5) * 60000;
    const bars = [...getCandidateCandles(previousCandidate), ...getCandidateCandles(candidate)];
    const byTime = new Map(bars.map(bar => [bar.time, bar]));
    return [...byTime.values()]
      .filter(bar => new Date(bar.time).getTime() + intervalMs <= snapshotMs)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  function getCandleClosePosition(candle) {
    if (!candle) return null;
    const range = Number(candle.high) - Number(candle.low);
    return Number.isFinite(range) && range > 0 ? (Number(candle.close) - Number(candle.low)) / range : null;
  }

  function getTopGainerPullbackReclaimInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_TOP_GAINER_PULLBACK_RECLAIM_ENABLED) return { ok:false, reason:'top-gainer pullback reclaim disabled' };
    const side = candidate?.side || candidate?.signal || 'buy';
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const dayChange = getCandidateDayChange(candidate);
    const rank = Number(candidate?.topGainerRank ?? indicators.topGainerRank);
    const count = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_GAINER_COUNT) || 5));
    const minGain = Number(settings.SIMULATION_TOP_GAINER_PULLBACK_MIN_DAY_GAIN_PCT) || 5;
    const maxGain = Number(settings.SIMULATION_TOP_GAINER_PULLBACK_MAX_DAY_GAIN_PCT) || 12;
    const maxVwapExtension = Number(settings.SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_EXTENSION_PCT) || 0.5;
    const touchPct = Number(settings.SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_TOUCH_PCT) || 0.25;
    const completed = getCompletedCandles(candidate, candidate?.previousCandidate, at, 5);
    const reclaim = completed.at(-1) || null;
    const reclaimLowDistancePct = reclaim && Number.isFinite(vwap) && vwap > 0 ? Math.abs(reclaim.low - vwap) / vwap * 100 : null;
    const bullishReclaim = !!reclaim && reclaim.close > reclaim.open && reclaim.close > vwap &&
      (reclaim.low <= vwap || (reclaimLowDistancePct != null && reclaimLowDistancePct <= touchPct));
    const vwapExtensionPct = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0 ? (price - vwap) / vwap * 100 : null;
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const freshVolume = (Number.isFinite(ratio3m) && ratio3m >= 1) || (Number.isFinite(ratio5m) && ratio5m >= 1);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const trendOk = Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 > ema20 && String(indicators.superTrendDirection || '').toLowerCase() === 'bullish';
    const holdOk = !!reclaim && Number.isFinite(price) && price >= reclaim.high && price > vwap;
    let reason = '';
    if (side === 'sell') reason = 'top-gainer pullback reclaim is long-only';
    else if (!Number.isFinite(rank) || rank < 1 || rank > count) reason = `stock is not a top ${count} gainer`;
    else if (!Number.isFinite(dayChange) || dayChange < minGain || dayChange > maxGain) reason = `top-gainer pullback day move ${Number.isFinite(dayChange) ? round2(dayChange) : '--'}% outside ${round2(minGain)}-${round2(maxGain)}%`;
    else if (!bullishReclaim) reason = 'top-gainer needs a completed bullish VWAP reclaim candle';
    else if (!holdOk) reason = 'top-gainer must hold above the reclaim candle high and VWAP';
    else if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > maxVwapExtension) reason = `top-gainer reclaim VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(maxVwapExtension)}%`;
    else if (!freshVolume) reason = 'top-gainer reclaim needs fresh 3m/5m volume';
    else if (!trendOk) reason = 'top-gainer reclaim needs bullish EMA and SuperTrend alignment';
    const ok = !reason;
    if (ok) candidate.__setupEntryTrigger = reclaim.high;
    return { ok, reason, reclaim, rank:Number.isFinite(rank) ? rank : null, dayChange, vwapExtensionPct, freshVolume, trendOk, holdOk };
  }

  function getBearFlagContinuationInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_BEAR_FLAG_CONTINUATION_ENABLED) return { ok:false, reason:'bear-flag continuation disabled' };
    const side = candidate?.side || candidate?.signal || 'sell';
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const dayChange = getCandidateDayChange(candidate);
    const decline = Number.isFinite(dayChange) ? Math.abs(Math.min(0, dayChange)) : null;
    const minDecline = Number(settings.SIMULATION_BEAR_FLAG_MIN_DAY_DECLINE_PCT) || 2;
    const maxDecline = Number(settings.SIMULATION_BEAR_FLAG_MAX_DAY_DECLINE_PCT) || 6;
    const minConsolidation = Math.max(2, Math.floor(Number(settings.SIMULATION_BEAR_FLAG_MIN_CONSOLIDATION_CANDLES) || 2));
    const completed = getCompletedCandles(candidate, candidate?.previousCandidate, at, 5);
    const breakdown = completed.at(-1) || null;
    const consolidation = completed.slice(-(minConsolidation + 1), -1);
    const flagLow = consolidation.length === minConsolidation ? Math.min(...consolidation.map(bar => bar.low)) : null;
    const flagHigh = consolidation.length === minConsolidation ? Math.max(...consolidation.map(bar => bar.high)) : null;
    const consolidationWidthPct = Number.isFinite(flagLow) && flagLow > 0 && Number.isFinite(flagHigh) ? (flagHigh - flagLow) / flagLow * 100 : null;
    const lowerHighs = consolidation.length === minConsolidation && consolidation.every((bar, index) => index === 0 || bar.high <= consolidation[index - 1].high * 1.001);
    const bearishBreak = !!breakdown && Number.isFinite(flagLow) && breakdown.close < flagLow && breakdown.close < breakdown.open;
    const vwapExtensionPct = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0 ? (vwap - price) / vwap * 100 : null;
    const maxVwapExtension = Number(settings.SIMULATION_BEAR_FLAG_MAX_VWAP_EXTENSION_PCT) || 0.8;
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const freshVolume = (Number.isFinite(ratio3m) && ratio3m >= 1) || (Number.isFinite(ratio5m) && ratio5m >= 1);
    const initialBreakdown = String(candidate?.previousCandidate?.side || candidate?.previousCandidate?.signal || '').toLowerCase() === 'sell' &&
      Number(candidate?.previousCandidate?.price) < Number(candidate?.previousCandidate?.indicators?.vwap);
    let reason = '';
    if (side !== 'sell') reason = 'bear-flag continuation is short-only';
    else if (!Number.isFinite(decline) || decline < minDecline || decline > maxDecline) reason = `bear-flag day decline ${Number.isFinite(decline) ? round2(decline) : '--'}% outside ${round2(minDecline)}-${round2(maxDecline)}%`;
    else if (!initialBreakdown) reason = 'bear flag needs a prior below-VWAP breakdown';
    else if (consolidation.length < minConsolidation || consolidationWidthPct == null || consolidationWidthPct > 1.2 || !lowerHighs) reason = `bear flag needs ${minConsolidation} tight lower-high consolidation candles`;
    else if (!bearishBreak) reason = 'bear flag needs a completed bearish close below the flag low';
    else if (!Number.isFinite(price) || price > flagLow) reason = 'bear flag breakdown must hold below the flag low';
    else if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > maxVwapExtension) reason = `bear-flag VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(maxVwapExtension)}%`;
    else if (!freshVolume) reason = 'bear flag needs fresh 3m/5m volume';
    const ok = !reason;
    if (ok) candidate.__setupEntryTrigger = flagLow;
    return { ok, reason, breakdown, flagLow, flagHigh, consolidationWidthPct, lowerHighs, dayChange, vwapExtensionPct, freshVolume };
  }

  function getBullFlagContinuationInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_BULL_FLAG_CONTINUATION_ENABLED) return { ok:false, reason:'bull-flag continuation disabled' };
    const side = candidate?.side || candidate?.signal || 'buy';
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const dayChange = getCandidateDayChange(candidate);
    const minGain = Number(settings.SIMULATION_BULL_FLAG_MIN_DAY_GAIN_PCT) || 2;
    const maxGain = Number(settings.SIMULATION_BULL_FLAG_MAX_DAY_GAIN_PCT) || 6;
    const minConsolidation = Math.max(2, Math.floor(Number(settings.SIMULATION_BULL_FLAG_MIN_CONSOLIDATION_CANDLES) || 2));
    const completed = getCompletedCandles(candidate, candidate?.previousCandidate, at, 5);
    const breakout = completed.at(-1) || null;
    const consolidation = completed.slice(-(minConsolidation + 1), -1);
    const pole = completed.at(-(minConsolidation + 2)) || null;
    const flagLow = consolidation.length === minConsolidation ? Math.min(...consolidation.map(bar => bar.low)) : null;
    const flagHigh = consolidation.length === minConsolidation ? Math.max(...consolidation.map(bar => bar.high)) : null;
    const consolidationWidthPct = Number.isFinite(flagLow) && flagLow > 0 && Number.isFinite(flagHigh) ? (flagHigh - flagLow) / flagLow * 100 : null;
    const higherLows = consolidation.length === minConsolidation && consolidation.every((bar, index) => index === 0 || bar.low >= consolidation[index - 1].low * 0.999);
    const bullishBreak = !!breakout && Number.isFinite(flagHigh) && breakout.close > flagHigh && breakout.close > breakout.open;
    const vwapExtensionPct = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0 ? (price - vwap) / vwap * 100 : null;
    const maxWidth = Number(settings.SIMULATION_BULL_FLAG_MAX_CONSOLIDATION_WIDTH_PCT) || 1.2;
    const poleGainPct = pole && Number(pole.open) > 0 ? (Number(pole.close) - Number(pole.open)) / Number(pole.open) * 100 : null;
    const consolidationAvgVolume = consolidation.length && consolidation.every(bar => Number.isFinite(Number(bar.volume)))
      ? consolidation.reduce((sum, bar) => sum + Number(bar.volume), 0) / consolidation.length
      : null;
    const poleVolumeMultiple = pole && Number.isFinite(Number(pole.volume)) && Number.isFinite(consolidationAvgVolume) && consolidationAvgVolume > 0
      ? Number(pole.volume) / consolidationAvgVolume
      : null;
    const minPoleGain = Number(settings.SIMULATION_BULL_FLAG_MIN_POLE_GAIN_PCT) || 0.5;
    const minPoleVolumeMultiple = Number(settings.SIMULATION_BULL_FLAG_MIN_POLE_VOLUME_MULTIPLE) || 1.2;
    const maxVwapExtension = Number(settings.SIMULATION_BULL_FLAG_MAX_VWAP_EXTENSION_PCT) || 0.8;
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const freshVolume = (Number.isFinite(ratio3m) && ratio3m >= 1) || (Number.isFinite(ratio5m) && ratio5m >= 1);
    const priorAboveVwap = String(candidate?.previousCandidate?.side || candidate?.previousCandidate?.signal || '').toLowerCase() !== 'sell' &&
      Number(candidate?.previousCandidate?.price) > Number(candidate?.previousCandidate?.indicators?.vwap);
    let reason = '';
    if (side === 'sell') reason = 'bull-flag continuation is long-only';
    else if (!Number.isFinite(dayChange) || dayChange < minGain || dayChange > maxGain) reason = `bull-flag day gain ${Number.isFinite(dayChange) ? round2(dayChange) : '--'}% outside ${round2(minGain)}-${round2(maxGain)}%`;
    else if (!priorAboveVwap) reason = 'bull flag needs a prior above-VWAP advance';
    else if (!pole || poleGainPct == null || poleGainPct < minPoleGain) reason = `bull flag pole gain ${poleGainPct == null ? '--' : round2(poleGainPct)}% < ${round2(minPoleGain)}%`;
    else if (poleVolumeMultiple == null || poleVolumeMultiple < minPoleVolumeMultiple) reason = `bull flag pole volume ${poleVolumeMultiple == null ? '--' : round2(poleVolumeMultiple)}x < ${round2(minPoleVolumeMultiple)}x consolidation volume`;
    else if (consolidation.length < minConsolidation || consolidationWidthPct == null || consolidationWidthPct > maxWidth || !higherLows) reason = `bull flag needs ${minConsolidation} tight higher-low consolidation candles`;
    else if (!bullishBreak) reason = 'bull flag needs a completed bullish close above the flag high';
    else if (!Number.isFinite(price) || price < flagHigh) reason = 'bull flag breakout must hold above the flag high';
    else if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > maxVwapExtension) reason = `bull-flag VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(maxVwapExtension)}%`;
    else if (!freshVolume) reason = 'bull flag needs fresh 3m/5m volume';
    const ok = !reason;
    if (ok) candidate.__setupEntryTrigger = flagHigh;
    return { ok, reason, pole, poleGainPct, poleVolumeMultiple, breakout, flagLow, flagHigh, consolidationWidthPct, higherLows, dayChange, vwapExtensionPct, freshVolume };
  }

  function getGapAndGoInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_GAP_AND_GO_ENABLED) return { ok:false, reason:'gap-and-go disabled' };
    const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
    const buy = side !== 'sell';
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const open = Number(candidate?.open ?? indicators.open ?? indicators.ohlc?.session?.open);
    const gapPct = Number(indicators.gapPct ?? candidate?.gapPct);
    const gapMagnitude = Math.abs(gapPct);
    const prevDayHigh = Number(indicators.prevDayHigh);
    const prevDayLow = Number(indicators.prevDayLow);
    const relVol = getRelativeVolume(candidate);
    const shock = getVolumeShockInfo(candidate);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const minGap = Number(settings.SIMULATION_GAP_AND_GO_MIN_GAP_PCT) || 0.75;
    const maxGap = Number(settings.SIMULATION_GAP_AND_GO_MAX_GAP_PCT) || 4;
    const cutoffMin = Number(settings.SIMULATION_GAP_AND_GO_ENTRY_CUTOFF_MIN) || (10 * 60 + 30);
    const mins = TradeRules.getIstMinutes(at || candidate?.__snapshotAt || candidate?.snapshotAt);
    const directionOk = buy ? gapPct > 0 : gapPct < 0;
    const level = buy ? prevDayHigh : prevDayLow;
    const levelOk = Number.isFinite(open) && Number.isFinite(level) && (buy ? open > level : open < level);
    const holdOk = Number.isFinite(price) && Number.isFinite(open) && (buy ? price >= open : price <= open);
    const quality = String(indicators.gapQuality || '').toLowerCase();
    const qualityOk = buy ? quality === 'gap-up holding' : quality === 'gap-down weak';
    const volumeOk = relVol != null && relVol >= Number(settings.SIMULATION_GAP_AND_GO_MIN_REL_VOL || 1.5) && (
      (Number.isFinite(ratio3m) && ratio3m >= Number(settings.SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_3M || 1)) ||
      (Number.isFinite(ratio5m) && ratio5m >= Number(settings.SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_5M || 1))
    );
    let reason = '';
    if (!['buy', 'sell'].includes(side)) reason = 'gap-and-go needs a directional signal';
    else if (!Number.isFinite(gapMagnitude) || gapMagnitude < minGap || gapMagnitude > maxGap || !directionOk) reason = `gap-and-go opening gap ${Number.isFinite(gapPct) ? round2(gapPct) : '--'}% outside directional ${round2(minGap)}-${round2(maxGap)}%`;
    else if (!levelOk) reason = buy ? 'gap-up open must clear previous-day high' : 'gap-down open must clear previous-day low';
    else if (Number.isFinite(mins) && mins >= cutoffMin) reason = `gap-and-go blocked after ${String(Math.floor(cutoffMin / 60)).padStart(2, '0')}:${String(cutoffMin % 60).padStart(2, '0')} IST`;
    else if (!holdOk || !qualityOk) reason = buy ? 'gap-up must hold the opening price' : 'gap-down must remain below the opening price';
    else if (!volumeOk) reason = 'gap-and-go needs high relative volume and a fresh 3m/5m impulse';
    const ok = !reason;
    if (ok) candidate.__setupEntryTrigger = open;
    return { ok, reason, gapPct, gapMagnitude, open, prevDayHigh, prevDayLow, relVol, ratio3m, ratio5m, levelOk, holdOk, volumeOk };
  }

  function getTopLoserBearFlagInfo(candidate, settings = {}, at = null) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_TOP_LOSER_BEAR_FLAG_ENABLED) return { ok:false, reason:'top-loser bear flag disabled' };
    const rank = Number(candidate?.topLoserRank ?? candidate?.indicators?.topLoserRank);
    const count = Math.max(1, Math.floor(Number(settings.SIMULATION_TOP_LOSER_COUNT) || 5));
    if (!Number.isFinite(rank) || rank < 1 || rank > count) return { ok:false, reason:`stock is not a top ${count} loser`, rank:null };
    const bearFlag = getBearFlagContinuationInfo(candidate, settings, at);
    if (!bearFlag.ok) return { ...bearFlag, rank, ok:false };
    return { ...bearFlag, rank, ok:true };
  }

  function getOpeningFlushReversalInfo(candidate, settings = {}, at = null, context = {}) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_OPENING_FLUSH_REVERSAL_ENABLED) return { ok:false, reason:'opening-flush reversal disabled' };
    const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
    const indicators = candidate?.indicators || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const previousClose = Number(indicators.ohlc?.previousClose ?? indicators.prevDayClose);
    const sessionLow = Number(indicators.ohlc?.session?.low ?? indicators.sessionLow);
    const declinePct = Number.isFinite(previousClose) && previousClose > 0 && Number.isFinite(sessionLow)
      ? (previousClose - sessionLow) / previousClose * 100
      : null;
    const completed = getCompletedCandles(candidate, candidate?.previousCandidate, at, 5);
    const latest = completed.at(-1) || null;
    const prior = completed.at(-2) || null;
    const lastThree = completed.slice(-3);
    const twoHigherCloses = lastThree.length === 3 && lastThree[1].close > lastThree[0].close && lastThree[2].close > lastThree[1].close;
    const vwapReclaim = !!latest && !!prior && Number.isFinite(vwap) && vwap > 0 && prior.close <= vwap && latest.close > vwap;
    const openingHigh = Number(indicators.openingHigh);
    const parsedTrigger = parseEntryTriggerPrice(candidate);
    const reclaimTrigger = Number.isFinite(openingHigh) && latest?.close > openingHigh
      ? openingHigh
      : (Number.isFinite(parsedTrigger) && latest?.close > parsedTrigger ? parsedTrigger : vwap);
    const triggerExtensionPct = Number.isFinite(price) && Number.isFinite(reclaimTrigger) && reclaimTrigger > 0
      ? (price - reclaimTrigger) / reclaimTrigger * 100
      : null;
    const shock = getVolumeShockInfo(candidate);
    const freshVolume = Number(shock.volumeRatio3m) >= 1 || Number(shock.volumeRatio5m) >= 1;
    const currentNifty = Number(context.market?.indices?.nifty50?.change ?? context.market?.indices?.nifty?.change ?? context.indices?.nifty50?.change);
    const priorNifty = (Array.isArray(context.marketHistory) ? context.marketHistory : [])
      .map(item => Number(item?.market?.indices?.nifty50?.change ?? item?.market?.indices?.nifty?.change))
      .filter(Number.isFinite);
    const indexRecoveryPct = Number.isFinite(currentNifty) && priorNifty.length ? currentNifty - Math.min(...priorNifty, currentNifty) : null;
    let reason = '';
    if (side !== 'buy') reason = 'opening-flush reversal is long-only';
    else if (declinePct == null || declinePct < Number(settings.SIMULATION_OPENING_FLUSH_MIN_DECLINE_PCT || 1)) reason = `opening flush decline ${declinePct == null ? '--' : round2(declinePct)}% is too small`;
    else if (!vwapReclaim) reason = 'opening flush needs a completed 5m VWAP reclaim';
    else if (!twoHigherCloses) reason = 'opening flush needs two consecutive higher completed closes';
    else if (!freshVolume) reason = 'opening flush needs fresh 3m/5m volume';
    else if (indexRecoveryPct == null || indexRecoveryPct < Number(settings.SIMULATION_OPENING_FLUSH_MIN_INDEX_RECOVERY_PCT || 0.5)) reason = `index recovery ${indexRecoveryPct == null ? '--' : round2(indexRecoveryPct)}pp is below requirement`;
    else if (triggerExtensionPct == null || triggerExtensionPct < 0 || triggerExtensionPct > Number(settings.SIMULATION_OPENING_FLUSH_MAX_TRIGGER_EXTENSION_PCT || 0.4)) reason = `opening-flush trigger extension ${triggerExtensionPct == null ? '--' : round2(triggerExtensionPct)}% exceeds limit`;
    const ok = !reason;
    if (ok) candidate.__setupEntryTrigger = reclaimTrigger;
    return { ok, reason, declinePct, latest, prior, twoHigherCloses, vwapReclaim, freshVolume, indexRecoveryPct, reclaimTrigger, triggerExtensionPct };
  }

  function getLateShortAccelerationInfo(candidate, at, context = {}, settings = {}, confirmation = null) {
    settings = withDefaults(settings);
    const mins = TradeRules.getIstMinutes(at || candidate?.__snapshotAt || candidate?.snapshotAt);
    const startMin = Number(settings.SIMULATION_SHORT_LATE_ACCELERATION_START_MIN) || 630;
    if (!settings.SIMULATION_SHORT_LATE_ACCELERATION_ENABLED || mins == null || mins < startMin) {
      return { ok:true, active:false, count:0, required:0, signals:{} };
    }
    const shock = getVolumeShockInfo(candidate);
    const change5m = Number(shock.change5m);
    const stockAccelerating = Number.isFinite(change5m) && change5m <= Number(settings.SIMULATION_SHORT_LATE_ACCELERATION_MAX_CHANGE_5M_PCT ?? -0.25);
    const candle = confirmation?.candle || getLatestCompletedCandidateCandle(candidate, at, 5);
    const closePosition = getCandleClosePosition(candle);
    const candleNearLow = closePosition != null && closePosition <= Number(settings.SIMULATION_SHORT_LATE_ACCELERATION_MAX_CLOSE_POSITION || 0.3);
    const nowMs = new Date(at || 0).getTime();
    const lookbackMs = Math.max(1, Number(settings.SIMULATION_SHORT_LATE_ACCELERATION_LOOKBACK_MIN) || 15) * 60000;
    const history = Array.isArray(context.marketHistory) ? context.marketHistory : [];
    const recent = history.filter(item => {
      const itemMs = new Date(item?.at || 0).getTime();
      return Number.isFinite(nowMs) && Number.isFinite(itemMs) && itemMs < nowMs && nowMs - itemMs <= lookbackMs;
    });
    const currentMarket = context.market || {};
    const currentNifty = Number(currentMarket.indices?.nifty50?.change ?? currentMarket.indices?.nifty?.change ?? context.indices?.nifty50?.change);
    const priorNifty = recent
      .map(item => Number(item?.market?.indices?.nifty50?.change ?? item?.market?.indices?.nifty?.change ?? item?.indices?.nifty50?.change))
      .filter(Number.isFinite);
    const niftyNewLow = Number.isFinite(currentNifty) && priorNifty.length > 0 && currentNifty < Math.min(...priorNifty);
    const sector = String(candidate?.sector || '');
    const currentSector = Number(context.sectorTrend?.[sector]);
    const priorSector = recent.map(item => Number(item?.sectorTrend?.[sector])).filter(Number.isFinite);
    const sectorNewLow = Number.isFinite(currentSector) && priorSector.length > 0 && currentSector < Math.min(...priorSector);
    const signals = { stockAccelerating, candleNearLow, niftyNewLow, sectorNewLow };
    const count = Object.values(signals).filter(Boolean).length;
    const required = Math.max(1, Math.floor(Number(settings.SIMULATION_SHORT_LATE_ACCELERATION_MIN_SIGNALS) || 2));
    const requireStockSignal = settings.SIMULATION_SHORT_LATE_ACCELERATION_REQUIRE_STOCK_SIGNAL !== false;
    return { ok:count >= required && (!requireStockSignal || stockAccelerating), active:true, count, required, requireStockSignal, signals, change5m:Number.isFinite(change5m) ? change5m : null, closePosition:closePosition == null ? null : round3(closePosition), currentNifty:Number.isFinite(currentNifty) ? currentNifty : null, currentSector:Number.isFinite(currentSector) ? currentSector : null };
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
    if (tradeSide === 'buy' && setupType === 'RANGEBOUND') {
      const maxNiftyDecline = Math.abs(Number(settings.SIMULATION_RANGEBOUND_MAX_NIFTY_DECLINE_PCT) || 0.5);
      const minBreadth = Number(settings.SIMULATION_RANGEBOUND_MIN_BREADTH_PCT) || 25;
      const minSector = Number(settings.SIMULATION_RANGEBOUND_MIN_SECTOR_PCT);
      const minRs = Number(settings.SIMULATION_RANGEBOUND_MIN_RS_PCT);
      const rangeReasons = [];
      if (Number.isFinite(nifty) && nifty < -maxNiftyDecline) rangeReasons.push(`Nifty ${nifty}%`);
      if (Number.isFinite(advPct) && advPct < minBreadth) rangeReasons.push(`breadth ${round2(advPct)}% advances`);
      if (Number.isFinite(sectorAvg) && Number.isFinite(minSector) && sectorAvg < minSector) rangeReasons.push(`sector ${round1(sectorAvg)}%`);
      if (Number.isFinite(rs) && Number.isFinite(minRs) && rs < minRs) rangeReasons.push(`RS ${rs}%`);
      return {
        ok:rangeReasons.length === 0,
        reason:rangeReasons.length ? `rangebound market conflict: ${rangeReasons.join(', ')}` : 'rangebound market aligned',
        nifty:Number.isFinite(nifty) ? nifty : null,
        sectorAvg:Number.isFinite(sectorAvg) ? sectorAvg : null,
        rs,
        advancePct:Number.isFinite(advPct) ? advPct : null,
        sectorRsOverride:false,
      };
    }
    const entryTriggered = String(candidate?.indicators?.entryStatus || '').toLowerCase() === 'triggered';
    const score = Math.abs(Number(candidate?.score) || 0);
    const overrideMinSector = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SECTOR_PCT);
    const overrideMinScore = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_SCORE);
    const overrideMinRs = Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MIN_RS_PCT);
    const overrideMaxNiftyDecline = Math.abs(Number(settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_MAX_NIFTY_DECLINE_PCT));
    const longSectorRsOverride = tradeSide === 'buy'
      && !!settings.SIMULATION_LONG_SECTOR_RS_OVERRIDE_ENABLED
      && ['MOMENTUM_RUNNER', 'TOP_GAINER_CONTINUATION', 'TOP_GAINER_PULLBACK_RECLAIM'].includes(setupType)
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
    const sectorValues = new Map();
    for (const [name, value] of Object.entries(context.sectorTrend || {})) {
      if (Number.isFinite(Number(value))) sectorValues.set(name, Number(value));
    }
    for (const [name, value] of Object.entries(sectorStats || {})) {
      if (!sectorValues.has(name) && Number.isFinite(Number(value?.avg))) sectorValues.set(name, Number(value.avg));
    }
    const rankedSectors = [...sectorValues.entries()]
      .sort((a, b) => direction * (b[1] - a[1]));
    const sectorRankIndex = rankedSectors.findIndex(([name]) => name === sector);
    const sectorRank = sectorRankIndex >= 0 ? sectorRankIndex + 1 : null;
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
      sectorRank,
      sectorCount:rankedSectors.length,
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

  function getConfirmedVwapReclaimInfo(candidate, at, settings = {}) {
    settings = withDefaults(settings);
    const side = String(candidate?.side || candidate?.signal || 'buy').toLowerCase();
    if (side === 'sell') return { ok:false, reason:'VWAP reclaim exception is long-only' };
    const price = getCandidatePrice(candidate);
    const vwap = Number(candidate?.indicators?.vwap);
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const snapshotMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || 0).getTime();
    const completed = getCandidateCandles(candidate)
      .filter(bar => Number.isFinite(snapshotMs) && new Date(bar.time).getTime() + intervalMs <= snapshotMs)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const prior = completed.at(-2);
    const reclaim = completed.at(-1);
    const touchTolerancePct = Math.max(0, Number(settings.SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_TOUCH_PCT) || 0.25);
    const touchCeiling = Number.isFinite(vwap) ? vwap * (1 + touchTolerancePct / 100) : NaN;
    const priorTouched = !!prior && Number.isFinite(vwap) && Number(prior.low) <= touchCeiling && Number(prior.close) <= touchCeiling;
    const reclaimClosedAbove = !!reclaim && Number.isFinite(vwap) && Number(reclaim.close) > vwap;
    const bullishReclaim = !!reclaim && Number(reclaim.close) > Number(reclaim.open);
    const liveHold = Number.isFinite(price) && Number.isFinite(vwap) && price >= vwap;
    const ok = priorTouched && reclaimClosedAbove && bullishReclaim && liveHold;
    return {
      ok,
      priorBarTime:prior?.time || null,
      reclaimBarTime:reclaim?.time || null,
      reason:ok ? 'completed bullish VWAP reclaim' : 'runner needs positive 5m momentum or a completed bullish VWAP reclaim',
    };
  }

  function isDominantSectorLeader(candidate, settings = {}) {
    settings = withDefaults(settings);
    const priority = candidate?.sectorPriority || candidate?.entryContext?.sectorPriority || {};
    const sectorAvg = Number(priority.sectorAvg);
    const breadthPct = Number(priority.breadthPct);
    const rs = Number(priority.rs);
    const sectorRank = Number(priority.sectorRank);
    const maxSectorRank = Math.max(1, Math.floor(Number(settings.SIMULATION_DOMINANT_LEADER_MAX_SECTOR_RANK) || 3));
    return (
      Number.isFinite(sectorRank) && sectorRank >= 1 && sectorRank <= maxSectorRank &&
      Number.isFinite(sectorAvg) && sectorAvg >= Number(settings.SIMULATION_DOMINANT_LEADER_MIN_SECTOR_PCT) &&
      Number.isFinite(breadthPct) && breadthPct >= Number(settings.SIMULATION_DOMINANT_LEADER_MIN_SECTOR_BREADTH_PCT) &&
      Number.isFinite(rs) && rs >= Number(settings.SIMULATION_DOMINANT_LEADER_MIN_RS_PCT)
    );
  }

  function getFragmentedMarketInfo(context = {}, settings = {}) {
    settings = withDefaults(settings);
    const indices = context?.market?.indices || context?.indices || {};
    const nifty = Number(indices.nifty50?.change ?? indices.nifty?.change ?? context?.niftyChange);
    const bank = Number(indices.banknifty?.change ?? indices.bankNifty?.change);
    const smallcap = Number(indices.smallcap?.change ?? indices.smallCap?.change);
    const flatLimit = Math.abs(Number(settings.SIMULATION_FRAGMENTED_MARKET_FLAT_NIFTY_ABS_PCT) || 0.2);
    const fragmented = !!settings.SIMULATION_FRAGMENTED_MARKET_FILTER_ENABLED &&
      Number.isFinite(nifty) && Math.abs(nifty) <= flatLimit &&
      Number.isFinite(bank) && bank < Number(settings.SIMULATION_FRAGMENTED_MARKET_MAX_BANK_PCT) &&
      Number.isFinite(smallcap) && smallcap < Number(settings.SIMULATION_FRAGMENTED_MARKET_MAX_SMALLCAP_PCT);
    return { fragmented, nifty:Number.isFinite(nifty) ? nifty : null, bank:Number.isFinite(bank) ? bank : null, smallcap:Number.isFinite(smallcap) ? smallcap : null };
  }

  function getGrossToCostBlockReason(candidate, settings = {}) {
    settings = withDefaults(settings);
    const cost = candidate?.cost || {};
    const grossPct = Number(cost.targetPct);
    const modeledCostPct = Math.max(0, Number(cost.costPct) || 0) + Math.max(0, Number(cost.slippagePct) || 0);
    const setupType = String(candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase();
    const configuredMultiple = Number(setupType === 'RANGEBOUND'
      ? settings.SIMULATION_RANGEBOUND_MIN_GROSS_TO_COST_MULTIPLE
      : settings.SIMULATION_MIN_GROSS_TO_COST_MULTIPLE);
    const minMultiple = Math.max(0, Number.isFinite(configuredMultiple) ? configuredMultiple : 2.5);
    if (!Number.isFinite(grossPct) || modeledCostPct <= 0 || minMultiple <= 0) return '';
    const requiredGrossPct = modeledCostPct * minMultiple;
    return grossPct + 1e-9 < requiredGrossPct
      ? `expected gross ${round3(grossPct)}% < ${round3(requiredGrossPct)}% (${round2(minMultiple)}x modeled costs)`
      : '';
  }

  function getMinNetProfitPctForSetup(setupType, settings = {}) {
    settings = withDefaults(settings);
    return String(setupType || '').toUpperCase() === 'RANGEBOUND'
      ? Math.max(0, Number(settings.SIMULATION_RANGEBOUND_MIN_NET_PROFIT_PCT) || 0.4)
      : Math.max(0, Number(settings.SIMULATION_MIN_NET_PROFIT_PCT) || 0);
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
      __frozenEntryTrigger:Number.isFinite(Number(candidate.__frozenEntryTrigger)) ? Number(candidate.__frozenEntryTrigger) : null,
      __frozenTriggerAt:Number.isFinite(Number(candidate.__frozenTriggerAt)) ? Number(candidate.__frozenTriggerAt) : null,
      derivedSetupType:candidate.derivedSetupType || candidate.setupType || null,
      candles:getCandidateCandles(candidate),
      indicators: {
        entryStatus: indicators.entryStatus,
        entryTrigger: indicators.entryTrigger,
        vwap: indicators.vwap,
        dayChange:indicators.dayChange,
        ema9:indicators.ema9 ?? indicators.emaShort,
        ema20:indicators.ema20 ?? indicators.emaLong,
        superTrendDirection:indicators.superTrendDirection,
        relVolumeTimeAdjusted:indicators.relVolumeTimeAdjusted ?? indicators.relVolume,
        volumeShock:indicators.volumeShock ? { ...indicators.volumeShock } : null,
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

  function getMomentumCatalystAdjustment(candidate, settings = {}) {
    settings = withDefaults(settings);
    const setupType = String(candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase();
    if (!settings.SIMULATION_MOMENTUM_CATALYST_ENABLED || !['EARLY_MOMENTUM', 'MOMENTUM_RUNNER', 'LONG_MOMENTUM'].includes(setupType)) {
      return { adjustment:0, applied:false, reason:'' };
    }
    const impact = candidate?.newsImpact || candidate?.indicators?.newsImpact;
    const impactScore = Number(impact?.tradeImpactScore);
    const minAbsImpact = Math.max(0, Number(settings.SIMULATION_MOMENTUM_CATALYST_MIN_ABS_IMPACT) || 60);
    if (!Number.isFinite(impactScore) || Math.abs(impactScore) < minAbsImpact) return { adjustment:0, applied:false, reason:'' };
    const publishedMs = new Date(impact?.publishedAt || impact?.dateKey || 0).getTime();
    const snapshotMs = new Date(candidate?.__snapshotAt || candidate?.snapshotAt || Date.now()).getTime();
    const ageHours = Number.isFinite(publishedMs) && publishedMs > 0 && Number.isFinite(snapshotMs)
      ? Math.max(0, (snapshotMs - publishedMs) / 3600000)
      : null;
    const maxAgeHours = Math.max(1, Number(settings.SIMULATION_MOMENTUM_CATALYST_MAX_AGE_HOURS) || 48);
    if (ageHours == null || ageHours > maxAgeHours) return { adjustment:0, applied:false, ageHours, reason:'catalyst is stale or undated' };
    const side = String(candidate?.side || candidate?.signal || 'buy').toLowerCase();
    const directionalImpact = side === 'sell' ? -impactScore : impactScore;
    const maxAdjustment = Math.max(0, Number(settings.SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT) || 5);
    const adjustment = round2(Math.max(-maxAdjustment, Math.min(maxAdjustment, directionalImpact / 100 * maxAdjustment)));
    return {
      adjustment,
      applied:adjustment !== 0,
      ageHours:round2(ageHours),
      impactScore,
      sentiment:impact.newsSentiment || null,
      reason:impact.tradeImpactReason || impact.title || 'fresh directional catalyst',
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
    const catalyst = getMomentumCatalystAdjustment(candidate, settings);
    const baseDecisionScore = quality.evidence >= 5
      ? rawScore * 0.65 + Number(quality.score) * 0.35
      : rawScore;
    candidate.decisionScore = Math.max(0, Math.min(100, round2(baseDecisionScore + expectancyAdjustment + catalyst.adjustment)));
    candidate.scoreAudit = {
      schemaVersion:1,
      rawScore,
      independentQualityScore:quality.score,
      independentEvidenceCount:quality.evidence,
      components:quality.components,
      expectancy:expectancy ? { ...expectancy, adjustment:round2(expectancyAdjustment) } : null,
      catalyst,
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
    'SIMULATION_MAX_CONCURRENT_SHORTS', 'SIMULATION_MAX_GROSS_EXPOSURE_PCT',
    'SIMULATION_MAX_OPEN_PER_SECTOR', 'SIMULATION_DAILY_MAX_TRADES', 'SIMULATION_DAILY_MAX_STOPS',
    'SIMULATION_OVERRIDE_STOP_GUARD', 'SIMULATION_LONG_CONFIRM_BARS',
    'SIMULATION_LONG_CONFIRM_MODE', 'SIMULATION_LONG_CONFIRM_CANDLE_MIN',
    'SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED',
    'SIMULATION_LONG_REQUIRE_COMPLETED_CANDLE', 'SIMULATION_LONG_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION',
    'SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_3M', 'SIMULATION_LONG_MIN_POST_CONFIRM_VOLUME_RATIO_5M',
    'SIMULATION_LONG_MAX_TRIGGER_EXTENSION_PCT', 'SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT',
    'SIMULATION_LONG_HARD_MIN_DECISION_SCORE_ENABLED', 'SIMULATION_LONG_HARD_MIN_DECISION_SCORE',
    'SIMULATION_LONG_BLOCK_NEGATIVE_5M', 'SIMULATION_LONG_NEGATIVE_5M_RECLAIM_POSITION_MULTIPLIER',
    'SIMULATION_LONG_ENTRY_CUTOFF_MIN', 'SIMULATION_LATE_LONG_EXCEPTION_ENABLED',
    'SIMULATION_LATE_LONG_EXCEPTION_MIN_SCORE', 'SIMULATION_LATE_LONG_EXCEPTION_MIN_CHANGE_5M_PCT',
    'SIMULATION_LATE_LONG_EXCEPTION_MIN_REL_VOL',
    'SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_3M', 'SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_5M',
    'SIMULATION_LONG_PROFIT_LOCK_PCT', 'SIMULATION_LONG_PROFIT_LOCK_PARTIAL_QTY_PCT', 'SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN',
    'SIMULATION_LONG_WEAK_MARKET_RUNNER_PROFIT_LOCK_PCT', 'SIMULATION_LONG_FLAT_MARKET_ABS_PCT',
    'SIMULATION_GAIN_MILESTONE_ENABLED', 'SIMULATION_GAIN_MILESTONES_PCT',
    'SIMULATION_MOMENTUM_RUNNER_MAX_VWAP_EXTENSION_PCT', 'SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN',
    'SIMULATION_MOMENTUM_CATALYST_ENABLED', 'SIMULATION_MOMENTUM_CATALYST_MIN_ABS_IMPACT',
    'SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT', 'SIMULATION_MOMENTUM_CATALYST_MAX_AGE_HOURS',
    'SIMULATION_RUNNER_MIN_CHANGE_5M_PCT', 'SIMULATION_RUNNER_ALLOW_CONFIRMED_VWAP_RECLAIM',
    'SIMULATION_RUNNER_REQUIRE_SECTOR_ALIGNMENT_OR_RS', 'SIMULATION_RUNNER_MIN_STRONG_RS_PCT',
    'SIMULATION_RUNNER_CHASE_MAX_DAY_GAIN_PCT', 'SIMULATION_RUNNER_CHASE_MAX_IMPULSE_AGE_MIN',
    'SIMULATION_RUNNER_MAX_BELOW_RECENT_HIGH_PCT', 'SIMULATION_RUNNER_MAX_RECENT_HIGH_AGE_MIN',
    'SIMULATION_RANGEBOUND_ENABLED', 'SIMULATION_RANGEBOUND_WINDOW_MIN',
    'SIMULATION_RANGEBOUND_LIQUIDITY_GATE_ENABLED', 'SIMULATION_RANGEBOUND_REQUIRE_LIVE_DEPTH',
    'SIMULATION_RANGEBOUND_MAX_DEPTH_AGE_SEC', 'SIMULATION_RANGEBOUND_MAX_SPREAD_PCT',
    'SIMULATION_RANGEBOUND_MIN_BOOK_IMBALANCE', 'SIMULATION_RANGEBOUND_MIN_COMBINED_DEPTH_QTY',
    'SIMULATION_RANGEBOUND_ENTRY_START_MIN', 'SIMULATION_RANGEBOUND_ENTRY_CUTOFF_MIN',
    'SIMULATION_RANGEBOUND_MIN_RANGE_PCT',
    'SIMULATION_RANGEBOUND_MAX_LOWER_DISTANCE_PCT', 'SIMULATION_RANGEBOUND_MIN_TOUCHES_PER_SIDE',
    'SIMULATION_RANGEBOUND_MIN_MIDPOINT_CROSSES', 'SIMULATION_RANGEBOUND_MIN_SCORE',
    'SIMULATION_RANGEBOUND_POSITION_MULTIPLIER', 'SIMULATION_RANGEBOUND_MIN_NET_PROFIT_PCT',
    'SIMULATION_RANGEBOUND_MIN_GROSS_TO_COST_MULTIPLE', 'SIMULATION_RANGEBOUND_MAX_NIFTY_DECLINE_PCT',
    'SIMULATION_RANGEBOUND_MIN_BREADTH_PCT', 'SIMULATION_RANGEBOUND_MIN_SECTOR_PCT',
    'SIMULATION_RANGEBOUND_MIN_RS_PCT',
    'SIMULATION_GAP_AND_GO_ENABLED', 'SIMULATION_GAP_AND_GO_MIN_GAP_PCT',
    'SIMULATION_GAP_AND_GO_MAX_GAP_PCT', 'SIMULATION_GAP_AND_GO_ENTRY_CUTOFF_MIN',
    'SIMULATION_GAP_AND_GO_MIN_REL_VOL', 'SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_3M',
    'SIMULATION_GAP_AND_GO_MIN_VOLUME_RATIO_5M',
    'SIMULATION_FRAGMENTED_MARKET_FILTER_ENABLED', 'SIMULATION_FRAGMENTED_MARKET_FLAT_NIFTY_ABS_PCT',
    'SIMULATION_FRAGMENTED_MARKET_MAX_BANK_PCT', 'SIMULATION_FRAGMENTED_MARKET_MAX_SMALLCAP_PCT',
    'SIMULATION_DOMINANT_LEADER_MAX_SECTOR_RANK',
    'SIMULATION_DOMINANT_LEADER_MIN_SECTOR_PCT', 'SIMULATION_DOMINANT_LEADER_MIN_SECTOR_BREADTH_PCT',
    'SIMULATION_DOMINANT_LEADER_MIN_RS_PCT', 'SIMULATION_MIN_GROSS_TO_COST_MULTIPLE',
    'SIMULATION_MANUAL_ENTRY_MAX_LIVE_DEVIATION_PCT',
    'SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER', 'SIMULATION_RUNNER_SCALE_IN_ENABLED',
    'SIMULATION_RUNNER_SCALE_IN_MIN_MFE_PCT', 'SIMULATION_RUNNER_INITIAL_STOP_PCT',
    'SIMULATION_ENTRY_TRIGGER_FREEZE_ENABLED',
    'SIMULATION_ENTRY_TRIGGER_FREEZE_MIN',
    'SIMULATION_EARLY_MOMENTUM_ENABLED', 'SIMULATION_EARLY_MOMENTUM_MIN_SCORE',
    'SIMULATION_EARLY_MOMENTUM_MIN_REL_VOL', 'SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_3M',
    'SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_5M', 'SIMULATION_EARLY_MOMENTUM_ENTRY_CUTOFF_MIN',
    'SIMULATION_EARLY_MOMENTUM_REQUIRE_SECTOR_ALIGNMENT_OR_RS', 'SIMULATION_EARLY_MOMENTUM_MIN_STRONG_RS_PCT',
    'SIMULATION_BULL_FLAG_CONTINUATION_ENABLED', 'SIMULATION_BULL_FLAG_MIN_DAY_GAIN_PCT',
    'SIMULATION_BULL_FLAG_MAX_DAY_GAIN_PCT', 'SIMULATION_BULL_FLAG_MIN_CONSOLIDATION_CANDLES',
    'SIMULATION_BULL_FLAG_MAX_CONSOLIDATION_WIDTH_PCT', 'SIMULATION_BULL_FLAG_MIN_POLE_GAIN_PCT',
    'SIMULATION_BULL_FLAG_MIN_POLE_VOLUME_MULTIPLE', 'SIMULATION_BULL_FLAG_MAX_VWAP_EXTENSION_PCT',
    'SIMULATION_SHORT_REQUIRE_COMPLETED_CANDLE', 'SIMULATION_SHORT_REQUIRE_FRESH_VOLUME_AFTER_CONFIRMATION',
    'SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_3M', 'SIMULATION_SHORT_MIN_POST_CONFIRM_VOLUME_RATIO_5M',
    'SIMULATION_SHORT_MAX_CONFIRM_LOWER_WICK_RATIO', 'SIMULATION_SHORT_LATE_DEEP_DECLINE_GUARD_ENABLED',
    'SIMULATION_SHORT_LATE_DEEP_DECLINE_START_MIN', 'SIMULATION_SHORT_LATE_DEEP_DECLINE_MAX_PCT',
    'SIMULATION_SHORT_LATE_ACCELERATION_ENABLED', 'SIMULATION_SHORT_LATE_ACCELERATION_START_MIN',
    'SIMULATION_SHORT_LATE_ACCELERATION_MIN_SIGNALS', 'SIMULATION_SHORT_LATE_ACCELERATION_REQUIRE_STOCK_SIGNAL',
    'SIMULATION_SHORT_LATE_ACCELERATION_MAX_CHANGE_5M_PCT',
    'SIMULATION_SHORT_LATE_ACCELERATION_MAX_CLOSE_POSITION', 'SIMULATION_SHORT_LATE_ACCELERATION_LOOKBACK_MIN',
    'SIMULATION_BEAR_FLAG_CONTINUATION_ENABLED', 'SIMULATION_BEAR_FLAG_MIN_DAY_DECLINE_PCT',
    'SIMULATION_BEAR_FLAG_MAX_DAY_DECLINE_PCT', 'SIMULATION_BEAR_FLAG_MIN_CONSOLIDATION_CANDLES',
    'SIMULATION_BEAR_FLAG_MAX_VWAP_EXTENSION_PCT', 'SIMULATION_SHORT_MAX_TRIGGER_EXTENSION_PCT',
    'SIMULATION_TOP_LOSER_BEAR_FLAG_ENABLED', 'SIMULATION_TOP_LOSER_COUNT',
    'SIMULATION_TOP_LOSER_BEAR_FLAG_MIN_SCORE', 'SIMULATION_TOP_LOSER_POSITION_MULTIPLIER',
    'SIMULATION_SHORT_PROFIT_LOCK_PCT', 'SIMULATION_SHORT_PROFIT_LOCK_PARTIAL_QTY_PCT',
    'SIMULATION_TOP_GAINER_CONTINUATION_ENABLED', 'SIMULATION_TOP_GAINER_COUNT',
    'SIMULATION_TOP_GAINER_MIN_DAY_GAIN_PCT', 'SIMULATION_TOP_GAINER_MAX_DAY_GAIN_PCT',
    'SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_3M', 'SIMULATION_TOP_GAINER_MIN_VOLUME_RATIO_5M',
    'SIMULATION_TOP_GAINER_MIN_REL_VOL', 'SIMULATION_TOP_GAINER_MAX_TRIGGER_EXTENSION_PCT',
    'SIMULATION_TOP_GAINER_MAX_VWAP_EXTENSION_PCT', 'SIMULATION_TOP_GAINER_AVOID_START_MIN',
    'SIMULATION_TOP_GAINER_AVOID_END_MIN', 'SIMULATION_TOP_GAINER_PROFIT_LOCK_PCT',
    'SIMULATION_TOP_GAINER_PARTIAL_QTY_PCT', 'SIMULATION_TOP_GAINER_TRAIL_PCT',
    'SIMULATION_TOP_GAINER_PULLBACK_RECLAIM_ENABLED', 'SIMULATION_TOP_GAINER_PULLBACK_MIN_DAY_GAIN_PCT',
    'SIMULATION_TOP_GAINER_PULLBACK_MAX_DAY_GAIN_PCT', 'SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_EXTENSION_PCT',
    'SIMULATION_TOP_GAINER_PULLBACK_MAX_VWAP_TOUCH_PCT', 'SIMULATION_TOP_GAINER_PULLBACK_POSITION_MULTIPLIER',
    'SIMULATION_OPENING_FLUSH_REVERSAL_ENABLED', 'SIMULATION_OPENING_FLUSH_MIN_DECLINE_PCT',
    'SIMULATION_OPENING_FLUSH_MIN_INDEX_RECOVERY_PCT', 'SIMULATION_OPENING_FLUSH_MAX_TRIGGER_EXTENSION_PCT',
    'SIMULATION_OPENING_FLUSH_MIN_SCORE', 'SIMULATION_CONTINUATION_REENTRY_ENABLED',
    'SIMULATION_CONTINUATION_REENTRY_COOLDOWN_MIN', 'SIMULATION_CONTINUATION_REENTRY_MAX_PER_SYMBOL',
    'SIMULATION_SECTOR_PRIORITY_MAX_BOOST', 'SIMULATION_MIN_NET_PROFIT_PCT', 'SIMULATION_MAX_POSITION_MULTIPLIER',
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
      ema5:Number.isFinite(Number(indicators.ema5)) ? Number(indicators.ema5) : null,
      ema9:Number.isFinite(Number(indicators.ema9 ?? indicators.emaShort)) ? Number(indicators.ema9 ?? indicators.emaShort) : null,
      ema20:Number.isFinite(Number(indicators.ema20 ?? indicators.emaLong)) ? Number(indicators.ema20 ?? indicators.emaLong) : null,
      superTrendDirection:indicators.superTrendDirection || null,
      rsi:Number.isFinite(Number(indicators.rsi)) ? Number(indicators.rsi) : null,
      rsi7:Number.isFinite(Number(indicators.rsi7)) ? Number(indicators.rsi7) : null,
      earlyMomentum:indicators.earlyMomentum || null,
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
      gapPct:Number.isFinite(Number(indicators.gapPct)) ? Number(indicators.gapPct) : null,
      gapQuality:indicators.gapQuality || null,
      newsImpact:indicators.newsImpact || candidate?.newsImpact || null,
      marketDepth:indicators.marketDepth || candidate?.marketDepth || null,
      topGainerRank:Number.isFinite(Number(candidate?.topGainerRank ?? indicators.topGainerRank))
        ? Number(candidate?.topGainerRank ?? indicators.topGainerRank)
        : null,
      stopPct:Number.isFinite(Number(candidate?.preCalcStopPct ?? indicators.stopPct)) ? Number(candidate?.preCalcStopPct ?? indicators.stopPct) : null,
      rr:Number.isFinite(Number(candidate?.rr)) ? Number(candidate.rr) : null,
      estimatedNetPct:Number.isFinite(Number(candidate?.cost?.netPct)) ? Number(candidate.cost.netPct) : null,
      reasons:Array.isArray(indicators.reasons) ? indicators.reasons.slice(0, 12) : [],
    };
  }

  function buildManagementCandidateSnapshot(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const indicators = candidate.indicators || {};
    const candles = getCandidateCandles(candidate).slice(-4);
    return {
      symbol:String(candidate.symbol || '').toUpperCase(),
      name:candidate.name || candidate.symbol || '',
      side:candidate.side || candidate.signal || null,
      signal:candidate.signal || candidate.side || null,
      score:Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
      decisionScore:Number.isFinite(Number(candidate.decisionScore)) ? Number(candidate.decisionScore) : null,
      sector:candidate.sector || candidate.sectorPriority?.sector || '',
      assetType:candidate.assetType || 'stock',
      dataSource:candidate.dataSource || candidate.freshness?.dataSource || '',
      price:getCandidatePrice(candidate),
      priceAtSnapshot:getCandidatePrice(candidate),
      quote:candidate.quote && typeof candidate.quote === 'object' ? { ...candidate.quote } : null,
      freshness:candidate.freshness && typeof candidate.freshness === 'object' ? { ...candidate.freshness } : null,
      setupType:candidate.setupType || candidate.derivedSetupType || null,
      derivedSetupType:candidate.derivedSetupType || candidate.setupType || null,
      sectorPriority:candidate.sectorPriority && typeof candidate.sectorPriority === 'object'
        ? { ...candidate.sectorPriority }
        : null,
      guard:candidate.guard && typeof candidate.guard === 'object' ? { ...candidate.guard } : null,
      blockReason:candidate.blockReason || candidate.entryBlockReason || '',
      candles,
      indicators:{
        ...indicators,
        price:getCandidatePrice(candidate),
        ohlc:indicators.ohlc || (candles.length ? {
          previousBar:candles.at(-2) || null,
          latestBar:candles.at(-1) || null,
        } : null),
      },
      cost:candidate.cost && typeof candidate.cost === 'object' ? { ...candidate.cost } : null,
      capturedAt:candidate.__snapshotAt || candidate.snapshotAt || indicators.savedAt || null,
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

  function isTimedContinuationReentryAllowed(candidate, at, context, settings) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_CONTINUATION_REENTRY_ENABLED || !isCandidateContinuationReentryAllowed(candidate, settings)) return false;
    const symbol = String(candidate?.symbol || '').toUpperCase();
    const nowMs = new Date(at || 0).getTime();
    const closed = (Array.isArray(context?.closedTrades) ? context.closedTrades : [])
      .filter(trade => String(trade?.symbol || '').toUpperCase() === symbol && trade?.status === 'closed')
      .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0));
    const last = closed.find(trade => /no.progress|zero.progress/i.test(String(trade.closeReason || '')));
    if (!last) return false;
    const closedMs = new Date(last.closedAt || 0).getTime();
    const cooldownMs = Math.max(1, Number(settings.SIMULATION_CONTINUATION_REENTRY_COOLDOWN_MIN) || 15) * 60000;
    if (!Number.isFinite(nowMs) || !Number.isFinite(closedMs) || nowMs - closedMs < cooldownMs) return false;
    const maxReentries = Math.max(0, Math.floor(Number(settings.SIMULATION_CONTINUATION_REENTRY_MAX_PER_SYMBOL) || 1));
    const reentryCount = [...closed, ...(Array.isArray(context?.openTrades) ? context.openTrades : [])]
      .filter(trade => String(trade?.symbol || '').toUpperCase() === symbol && trade?.entryContext?.continuationReentry)
      .length;
    if (reentryCount >= maxReentries) return false;
    if (!getConfirmedVwapReclaimInfo(candidate, at, settings).ok) return false;
    const shock = getVolumeShockInfo(candidate);
    return Number(shock.volumeRatio3m) >= 1 || Number(shock.volumeRatio5m) >= 1;
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

  function getEarlyMomentumInfo(candidate, settings = {}, at = null, context = {}) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_EARLY_MOMENTUM_ENABLED) {
      return { ok:false, reason:'early momentum disabled' };
    }
    const side = candidate?.side || candidate?.signal || adjustedTradeSignal(Number(candidate?.score) || 0);
    const indicators = candidate?.indicators || {};
    const warmup = indicators.earlyMomentum || {};
    const price = getCandidatePrice(candidate);
    const vwap = Number(indicators.vwap);
    const relVol = getRelativeVolume(indicators);
    const score = Number(candidate?.score);
    const shock = getVolumeShockInfo(indicators);
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const trigger = Number(warmup.trigger);
    const mins = TradeRules.getIstMinutes(at || candidate?.__snapshotAt || candidate?.snapshotAt);
    const cutoffMin = Number(settings.SIMULATION_EARLY_MOMENTUM_ENTRY_CUTOFF_MIN);
    const withinEntryWindow = !Number.isFinite(mins) || !Number.isFinite(cutoffMin) || mins < cutoffMin;
    const priority = candidate?.sectorPriority || {};
    const strongRs = Number.isFinite(Number(priority.rs)) &&
      Number(priority.rs) >= Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_STRONG_RS_PCT);
    const hasSectorEvidence = !!context.market ||
      Number.isFinite(Number(priority.sectorAvg)) ||
      Number.isFinite(Number(priority.rs));
    const sectorOk = !settings.SIMULATION_EARLY_MOMENTUM_REQUIRE_SECTOR_ALIGNMENT_OR_RS ||
      !hasSectorEvidence ||
      !!priority.aligned ||
      strongRs;
    const triggerExtensionPct = Number.isFinite(price) && Number.isFinite(trigger) && trigger > 0
      ? ((price - trigger) / trigger) * 100
      : null;
    const vwapExtensionPct = Number.isFinite(price) && Number.isFinite(vwap) && vwap > 0
      ? ((price - vwap) / vwap) * 100
      : null;
    const volumeOk =
      (Number.isFinite(ratio3m) && ratio3m >= Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_3M || 1)) ||
      (Number.isFinite(ratio5m) && ratio5m >= Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_VOLUME_RATIO_5M || 1));
    const ok = side !== 'sell' && withinEntryWindow && sectorOk &&
      warmup.active === true && warmup.warmup === true &&
      Number.isFinite(score) && score >= Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_SCORE || 55) &&
      Number.isFinite(price) && Number.isFinite(vwap) && price > vwap &&
      relVol != null && relVol >= Number(settings.SIMULATION_EARLY_MOMENTUM_MIN_REL_VOL || 1.3) &&
      volumeOk && warmup.emaBullish === true && warmup.higherCloses === true &&
      warmup.higherLows === true && warmup.rsiHealthy === true && warmup.freshVolume === true &&
      triggerExtensionPct != null && triggerExtensionPct >= 0 && triggerExtensionPct <= 0.6 &&
      vwapExtensionPct != null && vwapExtensionPct >= 0 && vwapExtensionPct <= 0.8;
    return {
      ok,
      score,
      trigger:Number.isFinite(trigger) ? trigger : null,
      triggerExtensionPct,
      vwapExtensionPct,
      relVol,
      volumeRatio3m:Number.isFinite(ratio3m) ? ratio3m : null,
      volumeRatio5m:Number.isFinite(ratio5m) ? ratio5m : null,
      reason:ok
        ? 'early momentum warm-up confirmed'
        : (!withinEntryWindow
          ? `early momentum blocked after ${String(Math.floor(cutoffMin / 60)).padStart(2, '0')}:${String(cutoffMin % 60).padStart(2, '0')} IST`
          : (!sectorOk
            ? `early momentum needs sector alignment or RS >= ${round2(settings.SIMULATION_EARLY_MOMENTUM_MIN_STRONG_RS_PCT)}%`
            : 'early momentum needs aligned micro-trend, fresh volume and strict trigger/VWAP proximity')),
    };
  }

  function deriveSetupType(candidate, settings, at = null, context = {}) {
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
    if (getRangeboundInfo(candidate, settings, at).detected) return 'RANGEBOUND';
    if (getOpeningFlushReversalInfo(candidate, settings, at, context).ok) return 'OPENING_FLUSH_VWAP_RECLAIM';
    if (getGapAndGoInfo(candidate, settings, at).ok) return 'GAP_AND_GO';
    if (getEarlyMomentumInfo(candidate, settings, at, context).ok) return 'EARLY_MOMENTUM';
    if (getTopGainerPullbackReclaimInfo(candidate, settings, at).ok) return 'TOP_GAINER_PULLBACK_RECLAIM';
    if (getTopGainerContinuationInfo(candidate, settings, at).ok) return 'TOP_GAINER_CONTINUATION';
    if (getBullFlagContinuationInfo(candidate, settings, at).ok) return 'BULL_FLAG_CONTINUATION';
    if (getTopLoserBearFlagInfo(candidate, settings, at).ok) return 'TOP_LOSER_BEAR_FLAG';
    if (getBearFlagContinuationInfo(candidate, settings, at).ok) return 'BEAR_FLAG_CONTINUATION';
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

  function isFormalLongPullbackReclaimSetup(setupType) {
    return ['TOP_GAINER_PULLBACK_RECLAIM', 'OPENING_FLUSH_VWAP_RECLAIM'].includes(String(setupType || '').toUpperCase());
  }

  function getLongEntryQualityBlockReason(candidate, setupType, at, settings) {
    settings = withDefaults(settings);
    const side = String(candidate?.side || candidate?.signal || 'buy').toLowerCase();
    if (side === 'sell') return '';
    if (String(setupType || '').toUpperCase() === 'RANGEBOUND') return '';

    const decisionScore = getCandidateDecisionScore(candidate);
    const hardMinScore = Math.max(0, Number(settings.SIMULATION_LONG_HARD_MIN_DECISION_SCORE) || 65);
    if (settings.SIMULATION_LONG_HARD_MIN_DECISION_SCORE_ENABLED !== false && decisionScore < hardMinScore) {
      return `long hard decision score ${round2(decisionScore)} < ${round2(hardMinScore)}`;
    }

    const shock = getVolumeShockInfo(candidate);
    const change5m = Number(shock.change5m);
    if (settings.SIMULATION_LONG_BLOCK_NEGATIVE_5M !== false &&
        Number.isFinite(change5m) && change5m < 0 &&
        !isFormalLongPullbackReclaimSetup(setupType)) {
      return `long 5m momentum ${round3(change5m)}% is negative outside a formal pullback/reclaim setup`;
    }

    const mins = getIstMinutes(at);
    const cutoffMin = Math.max(0, Number(settings.SIMULATION_LONG_ENTRY_CUTOFF_MIN) || (14 * 60 + 15));
    if (mins == null || mins < cutoffMin) return '';

    const allowedLateSetups = new Set([
      'TOP_GAINER_CONTINUATION',
      'TOP_GAINER_PULLBACK_RECLAIM',
      'VWAP_TREND_CONTINUATION',
    ]);
    if (settings.SIMULATION_LATE_LONG_EXCEPTION_ENABLED === false || !allowedLateSetups.has(String(setupType || '').toUpperCase())) {
      return `ordinary long entries blocked after ${String(Math.floor(cutoffMin / 60)).padStart(2, '0')}:${String(cutoffMin % 60).padStart(2, '0')} IST`;
    }

    const minScore = Math.max(hardMinScore, Number(settings.SIMULATION_LATE_LONG_EXCEPTION_MIN_SCORE) || 90);
    if (decisionScore < minScore) return `late long decision score ${round2(decisionScore)} < ${round2(minScore)}`;
    const minChange5m = Number(settings.SIMULATION_LATE_LONG_EXCEPTION_MIN_CHANGE_5M_PCT) || 0.2;
    if (!Number.isFinite(change5m) || change5m < minChange5m) {
      return `late long 5m momentum ${Number.isFinite(change5m) ? round3(change5m) : '--'}% < ${round3(minChange5m)}%`;
    }
    const relVol = getRelativeVolume(candidate);
    const minRelVol = Math.max(0, Number(settings.SIMULATION_LATE_LONG_EXCEPTION_MIN_REL_VOL) || 2);
    if (relVol == null || relVol < minRelVol) {
      return `late long relative volume ${relVol == null ? '--' : round2(relVol)}x < ${round2(minRelVol)}x`;
    }
    const ratio3m = Number(shock.volumeRatio3m);
    const ratio5m = Number(shock.volumeRatio5m);
    const minRatio3m = Math.max(0, Number(settings.SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_3M) || 1.2);
    const minRatio5m = Math.max(0, Number(settings.SIMULATION_LATE_LONG_EXCEPTION_MIN_VOLUME_RATIO_5M) || 1.2);
    if (!(Number.isFinite(ratio3m) && ratio3m >= minRatio3m) &&
        !(Number.isFinite(ratio5m) && ratio5m >= minRatio5m)) {
      return `late long volume impulse ${Number.isFinite(ratio3m) ? round2(ratio3m) : '--'}x/3m, ${Number.isFinite(ratio5m) ? round2(ratio5m) : '--'}x/5m`;
    }
    if (getGrossToCostBlockReason(candidate, settings)) {
      return 'late long expected move does not clear the configured cost multiple';
    }
    return '';
  }

  function getSetupBlockReason(candidate, setupType, at, settings, context = {}) {
    settings = withDefaults(settings);
    if (!candidate) return 'missing candidate';
    const side = candidate.side || candidate.signal || 'buy';
    const buy = side !== 'sell';
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(price) || price <= 0) return 'missing live price';
    const longEntryQualityBlock = getLongEntryQualityBlockReason(candidate, setupType, at, settings);
    if (longEntryQualityBlock) return longEntryQualityBlock;
    if (setupType === 'RANGEBOUND') {
      const mins = TradeRules.getIstMinutes(at);
      const startMin = Math.max(0, Number(settings.SIMULATION_RANGEBOUND_ENTRY_START_MIN) || (10 * 60));
      const cutoffMin = Math.max(startMin, Number(settings.SIMULATION_RANGEBOUND_ENTRY_CUTOFF_MIN) || (14 * 60 + 45));
      if (mins != null && mins < startMin) {
        return `rangebound entries start at ${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')} IST`;
      }
      if (mins != null && mins >= cutoffMin) {
        return `rangebound entries blocked after ${String(Math.floor(cutoffMin / 60)).padStart(2, '0')}:${String(cutoffMin % 60).padStart(2, '0')} IST`;
      }
      const rangeboundInfo = getRangeboundInfo(candidate, settings, at);
      if (!rangeboundInfo.ok) return rangeboundInfo.reason;
    }
    if (setupType === 'GAP_AND_GO') {
      const gapAndGoInfo = getGapAndGoInfo(candidate, settings, at);
      if (!gapAndGoInfo.ok) return gapAndGoInfo.reason || 'not a qualified gap-and-go setup';
    }
    const earlyMomentumInfo = getEarlyMomentumInfo(candidate, settings, at, context);
    if (setupType === 'EARLY_MOMENTUM' && !earlyMomentumInfo.ok) {
      return earlyMomentumInfo.reason || 'not early momentum';
    }
    const runnerInfo = getMomentumRunnerInfo(candidate, settings, at);
    if (setupType === 'MOMENTUM_RUNNER' && !runnerInfo.ok) return runnerInfo.reason || 'not momentum runner';
    const runner = runnerInfo.ok;
    if (setupType === 'MOMENTUM_RUNNER') {
      const shock = getVolumeShockInfo(candidate);
      const change5m = Number(shock.change5m);
      const minChange5m = Number(settings.SIMULATION_RUNNER_MIN_CHANGE_5M_PCT);
      const reclaim = settings.SIMULATION_RUNNER_ALLOW_CONFIRMED_VWAP_RECLAIM
        ? getConfirmedVwapReclaimInfo(candidate, at, settings)
        : { ok:false };
      if ((!Number.isFinite(change5m) || change5m < minChange5m) && !reclaim.ok) {
        return `momentum runner 5m change ${Number.isFinite(change5m) ? round3(change5m) : '--'}% < ${round3(minChange5m)}% without confirmed VWAP reclaim`;
      }
      const recentHigh = Number(shock.recentHigh);
      const belowRecentHighPct = Number.isFinite(recentHigh) && recentHigh > 0
        ? Math.max(0, (recentHigh - price) / recentHigh * 100)
        : null;
      const maxBelowRecentHighPct = Math.max(0, Number(settings.SIMULATION_RUNNER_MAX_BELOW_RECENT_HIGH_PCT) || 0.15);
      const recentHighAtMs = new Date(shock.recentHighAt || 0).getTime();
      const snapshotMs = new Date(at || candidate?.__snapshotAt || candidate?.snapshotAt || 0).getTime();
      const recentHighAgeMin = Number.isFinite(recentHighAtMs) && recentHighAtMs > 0 && Number.isFinite(snapshotMs)
        ? (snapshotMs - recentHighAtMs) / 60000
        : null;
      const maxRecentHighAgeMin = Math.max(1, Number(settings.SIMULATION_RUNNER_MAX_RECENT_HIGH_AGE_MIN) || 10);
      if (!shock.breakout && !reclaim.ok && Number.isFinite(belowRecentHighPct) && belowRecentHighPct > maxBelowRecentHighPct) {
        return `momentum runner impulse faded: price ${round3(belowRecentHighPct)}% below prior high (max ${round3(maxBelowRecentHighPct)}%)`;
      }
      if (!shock.breakout && !reclaim.ok && Number.isFinite(recentHighAgeMin) && recentHighAgeMin > maxRecentHighAgeMin) {
        return `momentum runner impulse high is ${round2(recentHighAgeMin)}m old (max ${round2(maxRecentHighAgeMin)}m)`;
      }
      const priority = candidate?.sectorPriority || {};
      const strongRs = priority.rs != null && Number.isFinite(Number(priority.rs)) &&
        Number(priority.rs) >= Number(settings.SIMULATION_RUNNER_MIN_STRONG_RS_PCT);
      const hasSectorOrRsEvidence = !!context.market ||
        (priority.rs != null && Number.isFinite(Number(priority.rs))) ||
        (priority.sectorAvg != null && Number.isFinite(Number(priority.sectorAvg)));
      if (settings.SIMULATION_RUNNER_REQUIRE_SECTOR_ALIGNMENT_OR_RS && hasSectorOrRsEvidence && !priority.aligned && !strongRs) {
        return `momentum runner needs sector alignment or RS >= ${round2(settings.SIMULATION_RUNNER_MIN_STRONG_RS_PCT)}%`;
      }
      const dayGain = getCandidateDayChange(candidate);
      const maxDayGain = Number(settings.SIMULATION_RUNNER_CHASE_MAX_DAY_GAIN_PCT);
      if (Number.isFinite(dayGain) && Number.isFinite(maxDayGain) && dayGain > maxDayGain && !reclaim.ok) {
        return `momentum runner chase: day gain ${round2(dayGain)}% > ${round2(maxDayGain)}% without VWAP reclaim`;
      }
    }
    const continuationInfo = getVwapContinuationInfo(candidate, settings);
    if (setupType === 'VWAP_TREND_CONTINUATION' && !continuationInfo.ok) return continuationInfo.reason || 'not VWAP continuation';
    const continuation = continuationInfo.ok;
    if (setupType === 'TOP_GAINER_CONTINUATION') {
      const topGainerInfo = getTopGainerContinuationInfo(candidate, settings, at);
      if (!topGainerInfo.ok) return topGainerInfo.reason || 'not a qualified top-gainer continuation';
    }
    if (setupType === 'TOP_GAINER_PULLBACK_RECLAIM') {
      const reclaimInfo = getTopGainerPullbackReclaimInfo(candidate, settings, at);
      if (!reclaimInfo.ok) return reclaimInfo.reason || 'not a qualified top-gainer pullback reclaim';
    }
    if (setupType === 'BULL_FLAG_CONTINUATION') {
      const bullFlagInfo = getBullFlagContinuationInfo(candidate, settings, at);
      if (!bullFlagInfo.ok) return bullFlagInfo.reason || 'not a qualified bull-flag continuation';
    }
    if (setupType === 'BEAR_FLAG_CONTINUATION') {
      const bearFlagInfo = getBearFlagContinuationInfo(candidate, settings, at);
      if (!bearFlagInfo.ok) return bearFlagInfo.reason || 'not a qualified bear-flag continuation';
    }
    if (setupType === 'TOP_LOSER_BEAR_FLAG') {
      const topLoserInfo = getTopLoserBearFlagInfo(candidate, settings, at);
      if (!topLoserInfo.ok) return topLoserInfo.reason || 'not a qualified top-loser bear flag';
    }
    if (setupType === 'OPENING_FLUSH_VWAP_RECLAIM') {
      const reversalInfo = getOpeningFlushReversalInfo(candidate, settings, at, context);
      if (!reversalInfo.ok) return reversalInfo.reason || 'not a qualified opening-flush reversal';
    }
    const relVol = getRelativeVolume(candidate);
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    const globalLongGuards = settings.SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED !== false;
    const needsLongConfirmation = buy && !['TOP_GAINER_PULLBACK_RECLAIM', 'RANGEBOUND'].includes(setupType) && (
      globalLongGuards
        ? isSimulationSetupAllowed(setupType, settings)
        : ['TOP_GAINER_CONTINUATION', 'EARLY_MOMENTUM', 'MOMENTUM_RUNNER', 'VWAP_TREND_CONTINUATION', 'FRESH_BREAKOUT'].includes(setupType)
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
      const legacyImpulseAgeLimit = Number(settings.SIMULATION_MOMENTUM_RUNNER_MAX_CONFIRMATION_AGE_MIN) || 10;
      const explicitChaseAgeLimit = Number(settings.SIMULATION_RUNNER_CHASE_MAX_IMPULSE_AGE_MIN);
      const runnerImpulseAgeLimit = Number.isFinite(explicitChaseAgeLimit) && explicitChaseAgeLimit > 0
        ? Math.min(legacyImpulseAgeLimit, explicitChaseAgeLimit)
        : legacyImpulseAgeLimit;
      if (setupType === 'MOMENTUM_RUNNER' && Number(confirmation.confirmationAgeMin) > runnerImpulseAgeLimit) {
        return `momentum-runner confirmation is ${round2(confirmation.confirmationAgeMin)}m old (max ${round2(runnerImpulseAgeLimit)}m)`;
      }
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
        const maxVwapExtension = setupType === 'MOMENTUM_RUNNER'
          ? Number(settings.SIMULATION_MOMENTUM_RUNNER_MAX_VWAP_EXTENSION_PCT) || 0.5
          : Number(settings.SIMULATION_LONG_MAX_VWAP_EXTENSION_PCT) || 0.8;
        if (vwapExtensionPct == null || vwapExtensionPct < 0 || vwapExtensionPct > maxVwapExtension) {
          return `long VWAP extension ${vwapExtensionPct == null ? '--' : round2(vwapExtensionPct)}% exceeds ${round2(maxVwapExtension)}%`;
        }
      }
    }
    if (buy && setupType !== 'RANGEBOUND') {
      const fragmented = getFragmentedMarketInfo(context, settings);
      if (fragmented.fragmented && !isDominantSectorLeader(candidate, settings)) {
        return `fragmented market: Nifty ${round2(fragmented.nifty)}%, Bank Nifty ${round2(fragmented.bank)}%, Smallcap ${round2(fragmented.smallcap)}%; long is not a dominant-sector leader`;
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
    if (!buy && ['BREAKDOWN', 'VWAP_REJECTION', 'BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupType)) {
      const vwap = Number(candidate.indicators?.vwap);
      const minShortRelVol = Number(settings.SIMULATION_SHORT_MIN_REL_VOL) || 0;
      const shortConfirmation = getShortEntryConfirmation(
        candidate,
        context.previousCandidate || candidate.previousCandidate,
        side,
        at,
        settings
      );
      if (!shortConfirmation.ok) return shortConfirmation.reason;
      const bearishConfirmations = getShortBearishConfirmationCount(candidate);
      const minBearishConfirmations = Math.max(1, Math.floor(Number(settings.SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS) || 2));
      if (!Number.isFinite(vwap) || price >= vwap) return 'short setup needs price below VWAP';
      if (!['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupType)) {
        const liveTrigger = parseEntryTriggerPrice(candidate);
        const liveTriggerDistancePct = Number.isFinite(liveTrigger) && liveTrigger > 0 ? (liveTrigger - price) / liveTrigger * 100 : null;
        const maxShortTriggerExtension = Number(settings.SIMULATION_SHORT_MAX_TRIGGER_EXTENSION_PCT) || 0.3;
        if (liveTriggerDistancePct == null || liveTriggerDistancePct < 0 || liveTriggerDistancePct > maxShortTriggerExtension) {
          return `short live-trigger extension ${liveTriggerDistancePct == null ? '--' : round2(liveTriggerDistancePct)}% exceeds ${round2(maxShortTriggerExtension)}%`;
        }
      }
      if (relVol == null || relVol < minShortRelVol) return `short volume ${relVol == null ? '--' : round2(relVol)}x < ${round2(minShortRelVol)}x`;
      if (bearishConfirmations < minBearishConfirmations) return `short bearish confirmations ${bearishConfirmations}/${minBearishConfirmations}`;
      const confirmations = getBreakoutConfirmations(candidate, side);
      const count = Object.values(confirmations).filter(Boolean).length;
      if (count < 2) return `short confirmations ${count}/2`;
      const acceleration = getLateShortAccelerationInfo(candidate, at, context, settings, shortConfirmation);
      if (!acceleration.ok) return `late short acceleration ${acceleration.count}/${acceleration.required}`;
      const mins = getIstMinutes(at);
      const dayChange = getCandidateDayChange(candidate);
      const lateStart = Number(settings.SIMULATION_SHORT_LATE_DEEP_DECLINE_START_MIN) || 630;
      const maxDecline = Math.abs(Number(settings.SIMULATION_SHORT_LATE_DEEP_DECLINE_MAX_PCT) || 2);
      if (settings.SIMULATION_SHORT_LATE_DEEP_DECLINE_GUARD_ENABLED && mins != null && mins >= lateStart &&
          Number.isFinite(dayChange) && dayChange <= -maxDecline && !shortConfirmation.retestRejected && !['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupType)) {
        return `late short blocked after ${round2(dayChange)}% day decline without completed VWAP/trigger retest rejection`;
      }
    }
    if (setupType !== 'RANGEBOUND' && guardLevel === 'small' && (relVol == null || relVol < 1)) {
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
    if (!isSimulationSetupAllowed(setupType, settings)) return false;
    if (getSetupBlockReason(candidate, setupType, at, settings, context)) return false;
    if (!getMarketRegime(candidate, side, { ...context, settings }).ok) return false;
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    if (guardLevel && !getAllowedGuardLevelsForSide(settings, side).includes(guardLevel)) return false;
    if (candidate.indicators?.entryStatus !== 'Triggered') return false;
    const price = getCandidatePrice(candidate);
    if (!Number.isFinite(price) || price <= 0) return false;
    if (candidate.freshness?.stale) return false;
    const cost = candidate.cost;
    const minNetProfitPct = getMinNetProfitPctForSetup(setupType, settings);
    if (!cost || Number(cost.netPct) < minNetProfitPct) return false;
    if (getGrossToCostBlockReason(candidate, settings)) return false;
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
    if (!isSimulationSetupAllowed(setupType, settings)) reasons.push(`setup ${setupType} disabled`);
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
    const minNetProfitPct = getMinNetProfitPctForSetup(setupType, settings);
    if (!cost || Number(cost.netPct) < minNetProfitPct) reasons.push(`net ${cost?.netPct ?? '--'}% < ${minNetProfitPct}%`);
    const costMultipleBlock = getGrossToCostBlockReason(candidate, settings);
    if (costMultipleBlock) reasons.push(costMultipleBlock);
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

  function getCandidateProfitabilityMetrics(candidate) {
    const expectancy = candidate?.scoreAudit?.expectancy || null;
    const sample = Number(expectancy?.sample);
    const winRate = Number(expectancy?.winRate);
    const expectedNetPct = Number(expectancy?.expectedNetPct);
    const decisionScore = getCandidateDecisionScore(candidate);
    const hasExpectancy = Number.isFinite(sample) && sample > 0 && Number.isFinite(winRate);
    return {
      chanceScore:hasExpectancy ? winRate : decisionScore,
      decisionScore,
      expectedNetPct:Number.isFinite(expectedNetPct) ? expectedNetPct : null,
      winRate:hasExpectancy ? winRate : null,
      sample:hasExpectancy ? sample : 0,
      source:hasExpectancy ? String(expectancy.source || 'historical-expectancy') : 'decision-score',
    };
  }

  function compareCandidatesByProfitability(a, b) {
    const profitabilityA = getCandidateProfitabilityMetrics(a);
    const profitabilityB = getCandidateProfitabilityMetrics(b);
    const chanceDiff = profitabilityB.chanceScore - profitabilityA.chanceScore;
    if (chanceDiff) return chanceDiff;
    const netDiff = Number(profitabilityB.expectedNetPct ?? -Infinity) - Number(profitabilityA.expectedNetPct ?? -Infinity);
    if (Number.isFinite(netDiff) && netDiff) return netDiff;
    const decisionDiff = profitabilityB.decisionScore - profitabilityA.decisionScore;
    if (decisionDiff) return decisionDiff;
    const potentialDiff = Number(b?.cost?.netPct ?? -Infinity) - Number(a?.cost?.netPct ?? -Infinity);
    if (Number.isFinite(potentialDiff) && potentialDiff) return potentialDiff;
    return Math.abs(Number(b?.score) || 0) - Math.abs(Number(a?.score) || 0);
  }

  function selectTopCandidatesBySetup(candidates = []) {
    const configuredSetups = new Set((TradeRules.SIMULATION_SETUP_DEFINITIONS || []).map(definition => definition.type));
    const leaders = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const setupType = String(candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase();
      if (!configuredSetups.has(setupType)) continue;
      const current = leaders.get(setupType);
      if (!current || compareCandidatesByProfitability(candidate, current) < 0) leaders.set(setupType, candidate);
    }
    return [...leaders.values()].sort(compareCandidatesByProfitability);
  }

  function selectSimulationEntryCandidates(candidates, at, settings, context = {}) {
    settings = withDefaults(settings);
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      applyFrozenEntryTrigger(candidate, candidate?.previousCandidate || context.previousCandidate, at, settings);
    }
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
    const openPositionTotal = [...openPositionCounts.values()].reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
    const totalSlots = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_OPEN) || 0) - openPositionTotal);
    const activeSlots = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_ACTIVE_OPEN) || 0) - openPositionTotal);
    const openSideCounts = context.openSideCounts instanceof Map ? new Map(context.openSideCounts) : new Map();
    const maxConcurrentShorts = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_CONCURRENT_SHORTS) || 4));
    let shortCapacity = Math.max(0, maxConcurrentShorts - Math.max(0, Number(openSideCounts.get('sell')) || 0));
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
        const pullbackInfo = getTopGainerPullbackReclaimInfo(candidate, settings, at);
        const topGainerInfo = getTopGainerContinuationInfo(candidate, settings, at);
        const openingFlushInfo = getOpeningFlushReversalInfo(candidate, settings, at, context);
        const gapAndGoInfo = getGapAndGoInfo(candidate, settings, at);
        const bullFlagInfo = getBullFlagContinuationInfo(candidate, settings, at);
        const topLoserInfo = getTopLoserBearFlagInfo(candidate, settings, at);
        const bearFlagInfo = getBearFlagContinuationInfo(candidate, settings, at);
        candidate.derivedSetupType = openingFlushInfo.ok
          ? 'OPENING_FLUSH_VWAP_RECLAIM'
          : (gapAndGoInfo.ok
          ? 'GAP_AND_GO'
          : (pullbackInfo.ok
          ? 'TOP_GAINER_PULLBACK_RECLAIM'
          : (topGainerInfo.ok
            ? 'TOP_GAINER_CONTINUATION'
            : (bullFlagInfo.ok
              ? 'BULL_FLAG_CONTINUATION'
              : (topLoserInfo.ok
                ? 'TOP_LOSER_BEAR_FLAG'
                : (bearFlagInfo.ok ? 'BEAR_FLAG_CONTINUATION' : (candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings, at, context))))))));
        applySectorPriority(candidate, sectorPriorityStats, context, settings);
        return applyDecisionScore(candidate, expectancyModel, settings);
      })
      .filter(Boolean)
      .filter(candidate => settings.SIMULATION_ENABLE_ETF || candidate.assetType !== 'etf')
      .filter(candidate => !(candidate.assetType === 'etf' && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => ['buy', 'sell'].includes(candidate.side || candidate.signal))
      .filter(candidate => !(settings.REPLAY_LONG_ONLY && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => !(settings.REPLAY_SHORT_ONLY && (candidate.side || candidate.signal) !== 'sell'))
      .filter(candidate => {
        const auditContext = {
          previousCandidate: candidate.previousCandidate || context.previousCandidate,
          market: context.market ? market : null,
          indices: context.indices,
          sectorTrend: context.sectorTrend,
          sectorAvg: context.sectorAvg,
          marketHistory: context.marketHistory,
        };
        const eligible = isReplayCandidateEligible(candidate, at, settings, auditContext);
        candidate.eligibilityAudit = eligible
          ? { eligible:true, reasons:[], setupType:candidate.derivedSetupType || candidate.setupType, side:candidate.side || candidate.signal }
          : explainCandidateEligibility(candidate, at, settings, auditContext);
        return eligible;
      })
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
        if (/cooldown after/i.test(String(block || '')) && isTimedContinuationReentryAllowed(candidate, at, context, settings)) {
          block = '';
          candidate.entryContext = { ...(candidate.entryContext || {}), continuationReentry:true };
        }
        candidate.entryBlockReason = block || '';
        return !block;
      })
      .filter(candidate => {
        const price = getCandidatePrice(candidate);
        return Number.isFinite(price) && price > 0;
      })
      .sort(compareCandidates);
    ranked.forEach((candidate, index) => { candidate.selectionRank = index + 1; });
    const selected = [];
    const maxOpenPerSector = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_OPEN_PER_SECTOR) || 0));
    const sectorCounts = new Map();
    for (const trade of Array.isArray(context.openTrades) ? context.openTrades : []) {
      const sector = String(trade?.sector || trade?.entryContext?.sectorPriority?.sector || '').trim();
      if (sector) sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    }
    for (const candidate of ranked) {
      const cycleLimit = Math.max(0, Math.floor(Number(settings.SIMULATION_MAX_NEW_PER_CYCLE) || 0));
      if (selected.length >= Math.min(topN, rollingCapacity, totalSlots, activeSlots, cycleLimit || Infinity)) break;
      const side = String(candidate?.side || candidate?.signal || '').toLowerCase();
      if (side === 'sell' && shortCapacity <= 0) {
        candidate.entryBlockReason = `concurrent short limit ${maxConcurrentShorts}`;
        continue;
      }
      const sector = String(candidate?.sector || candidate?.sectorPriority?.sector || '').trim();
      if (sector && maxOpenPerSector > 0 && (sectorCounts.get(sector) || 0) >= maxOpenPerSector) {
        candidate.entryBlockReason = `sector position limit ${sector} ${sectorCounts.get(sector)}/${maxOpenPerSector}`;
        continue;
      }
      if (candidate.sectorPriority?.aligned) {
        if (sectorCapacity <= 0) {
          candidate.entryBlockReason = 'sector-aligned cycle capacity exhausted';
          continue;
        }
        sectorCapacity -= 1;
      } else {
        if (ordinaryCapacity <= 0) {
          candidate.entryBlockReason = 'ordinary cycle capacity exhausted';
          continue;
        }
        ordinaryCapacity -= 1;
      }
      selected.push(candidate);
      if (side === 'sell') shortCapacity -= 1;
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
    if (setupType === 'MOMENTUM_RUNNER') {
      const stopPct = Math.max(0.1, Number(settings.SIMULATION_RUNNER_INITIAL_STOP_PCT) || 0.8);
      stopDistance = entry * stopPct / 100;
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

  function getMomentumRunnerScaleInIntent(trade, candidate, price, settings = {}, context = {}) {
    settings = withDefaults(settings);
    if (settings.SIMULATION_RUNNER_SCALE_IN_ENABLED === false || !trade || !candidate) return null;
    if (String(trade.setupType || '').toUpperCase() !== 'MOMENTUM_RUNNER' || trade._momentumRunnerScaledIn) return null;
    const side = String(trade.side || 'buy').toLowerCase();
    const entry = Number(trade.entryPrice);
    const currentPrice = Number(price);
    const currentQty = Math.max(0, Math.floor(Number(trade.qty) || 0));
    const plannedFullQty = Math.max(
      currentQty,
      Math.floor(Number(trade._momentumRunnerFullQty ?? trade.entryContext?.plannedFullQty) || 0)
    );
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0 ||
        currentQty <= 0 || plannedFullQty <= currentQty) return null;

    const favorablePct = side === 'sell'
      ? ((entry - currentPrice) / entry) * 100
      : ((currentPrice - entry) / entry) * 100;
    const maxFavorablePct = Math.max(Number(trade._maxFavorablePct) || 0, favorablePct);
    const firstMilestonePct = getConfiguredGainMilestones(settings).at(0) || 0.5;
    const minMfePct = Math.max(firstMilestonePct, Number(settings.SIMULATION_RUNNER_SCALE_IN_MIN_MFE_PCT) || 0.5);
    if (maxFavorablePct < minMfePct) return null;

    const vwap = Number(candidate?.indicators?.vwap);
    const trigger = Number(getEntryTriggerPrice(candidate));
    if (!Number.isFinite(vwap) || vwap <= 0 || !Number.isFinite(trigger) || trigger <= 0) return null;
    const holdingLevels = side === 'sell'
      ? currentPrice <= vwap && currentPrice <= trigger
      : currentPrice >= vwap && currentPrice >= trigger;
    if (!holdingLevels) return null;

    let qty = plannedFullQty - currentQty;
    const cashAvailable = Number(context.cashAvailable);
    if (Number.isFinite(cashAvailable)) qty = Math.min(qty, Math.floor(Math.max(0, cashAvailable) / currentPrice));
    const grossCapacity = Number(context.remainingGrossCapacity);
    if (Number.isFinite(grossCapacity)) qty = Math.min(qty, Math.floor(Math.max(0, grossCapacity) / currentPrice));
    const riskPerShare = Math.abs(entry - Number(trade.stop));
    const remainingHeatRisk = Number(context.remainingHeatRisk);
    if (Number.isFinite(remainingHeatRisk) && riskPerShare > 0) {
      qty = Math.min(qty, Math.floor(Math.max(0, remainingHeatRisk) / riskPerShare));
    }
    const sectorHeatRemaining = Number(context.sectorHeatRemaining);
    if (Number.isFinite(sectorHeatRemaining) && riskPerShare > 0) {
      qty = Math.min(qty, Math.floor(Math.max(0, sectorHeatRemaining) / riskPerShare));
    }
    qty = Math.max(0, Math.floor(qty));
    if (qty <= 0) return null;
    return {
      action:'scale_in',
      symbol:trade.symbol,
      side,
      qty,
      price:currentPrice,
      trade,
      candidate,
      plannedFullQty,
      maxFavorablePct:round3(maxFavorablePct),
      vwap:round2(vwap),
      trigger:round2(trigger),
      reason:`Momentum Runner scale-in after reaching the ${round2(minMfePct)}% milestone while holding VWAP/trigger`,
    };
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

    const breached = side === 'sell' ? Number(price) >= stop : Number(price) <= stop;
    if (!breached) {
      trade._stopBreachCount = 0;
      trade._stopFirstBreachedAt = null;
      trade._stopLastBreachBarTime = null;
      return null;
    }

    const adversePct = side === 'sell'
      ? ((Number(price) - entry) / entry) * 100
      : ((entry - Number(price)) / entry) * 100;
    if (adversePct >= Math.max(0, Number(settings.SIMULATION_EMERGENCY_STOP_PCT) || 1.25)) {
      return {
        reason: 'Simulation emergency stop',
        exitPrice: Number(price),
        confidence: 1.0
      };
    }

    const nowMs = new Date(at || Date.now()).getTime();
    const openedAtMs = new Date(trade.openedAt || 0).getTime();
    const holdMs = Number.isFinite(nowMs) && Number.isFinite(openedAtMs) ? nowMs - openedAtMs : 0;
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const completedBar = getLatestCompletedCandidateCandle(candidate, at, intervalMin);
    const barTimeMs = completedBar ? new Date(completedBar.time).getTime() : NaN;
    const barClose = Number(completedBar?.close);
    const completedBarBreached = Number.isFinite(barClose) &&
      (side === 'sell' ? barClose >= stop : barClose <= stop);

    if (!completedBarBreached || !Number.isFinite(barTimeMs) ||
        (Number.isFinite(openedAtMs) && barTimeMs + intervalMs <= openedAtMs)) {
      trade._stopBreachCount = 0;
      trade._stopFirstBreachedAt = null;
      trade._stopLastBreachBarTime = null;
      return null;
    }

    const barTime = completedBar.time;
    if (trade._stopLastBreachBarTime !== barTime) {
      const previousBarMs = new Date(trade._stopLastBreachBarTime || 0).getTime();
      const consecutive = Number.isFinite(previousBarMs) &&
        barTimeMs > previousBarMs &&
        barTimeMs - previousBarMs <= intervalMs * 1.5;
      trade._stopBreachCount = consecutive ? (Number(trade._stopBreachCount) || 0) + 1 : 1;
      trade._stopFirstBreachedAt = consecutive && trade._stopFirstBreachedAt
        ? trade._stopFirstBreachedAt
        : nowMs;
      trade._stopLastBreachBarTime = barTime;
    }

    const graceMs = Math.max(0, Number(settings.SIMULATION_STOP_GRACE_MIN) || 0) * 60000;
    if (holdMs < graceMs) return null;
    const requiredBars = Math.max(1, Math.floor(Number(settings.SIMULATION_STOP_CONFIRM_BARS) || 1));
    if ((Number(trade._stopBreachCount) || 0) < requiredBars) return null;
    return {
      reason: 'Simulation confirmed stop',
      exitPrice: Number(price),
      confidence: 1.0,
      confirmedBars: Number(trade._stopBreachCount) || 0,
      confirmationBarTime: barTime
    };
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
      trade._fadeLastBreachBarTime = null;
      return null;
    }
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const completedBar = getLatestCompletedCandidateCandle(candidate, at, intervalMin);
    const completedBarMs = completedBar ? new Date(completedBar.time).getTime() : NaN;
    const openedAtMs = new Date(trade.openedAt || 0).getTime();
    const completedClose = Number(completedBar?.close);
    const completedVwapLost = Number.isFinite(completedClose) && Number.isFinite(vwap) &&
      (buy ? completedClose < vwap : completedClose > vwap);
    if (!completedBar || !Number.isFinite(completedBarMs) ||
        !completedVwapLost ||
        (Number.isFinite(openedAtMs) && completedBarMs + intervalMs <= openedAtMs)) {
      trade._fadeBreachCount = 0;
      trade._fadeLastBreachBarTime = null;
      return null;
    }
    if (trade._fadeLastBreachBarTime !== completedBar.time) {
      const previousBarMs = new Date(trade._fadeLastBreachBarTime || 0).getTime();
      const consecutive = Number.isFinite(previousBarMs) &&
        completedBarMs > previousBarMs &&
        completedBarMs - previousBarMs <= intervalMs * 1.5;
      trade._fadeBreachCount = consecutive ? (Number(trade._fadeBreachCount) || 0) + 1 : 1;
      trade._fadeLastBreachBarTime = completedBar.time;
    }
    if (trade._fadeBreachCount < Math.max(1, Math.floor(Number(settings.SIMULATION_EXIT_FADE_CONFIRM_BARS) || 1))) return null;
    return {
      reason: `Simulation ${reasons[0] || 'momentum fade'}`,
      exitPrice: Number(price),
      exitFlags: reasons,
      confirmedBars: Number(trade._fadeBreachCount) || 0,
      confirmationBarTime: completedBar.time,
    };
  }

  function getConfirmedBreakevenExit(trade, price, candidate, at, settings, details = {}) {
    settings = withDefaults(settings);
    const side = String(trade?.side || 'buy').toLowerCase();
    const buy = side !== 'sell';
    const protectedPrice = Number(details.protectedPrice);
    if (!trade || !Number.isFinite(Number(price)) || !Number.isFinite(protectedPrice)) return null;

    const costBreached = buy ? Number(price) <= protectedPrice : Number(price) >= protectedPrice;
    const vwap = Number(candidate?.indicators?.vwap);
    const currentVwapLost = Number.isFinite(vwap) && (buy ? Number(price) < vwap : Number(price) > vwap);
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const completedBar = getLatestCompletedCandidateCandle(candidate, at, intervalMin);
    const completedBarMs = completedBar ? new Date(completedBar.time).getTime() : NaN;
    const completedClose = Number(completedBar?.close);
    const completedVwapLost = Number.isFinite(completedClose) && Number.isFinite(vwap) &&
      (buy ? completedClose < vwap : completedClose > vwap);
    const openedAtMs = new Date(trade.openedAt || 0).getTime();
    const postEntryBar = Number.isFinite(completedBarMs) &&
      (!Number.isFinite(openedAtMs) || completedBarMs + intervalMs > openedAtMs);

    if (!costBreached || !currentVwapLost || !completedVwapLost || !postEntryBar) {
      trade._breakevenBreachCount = 0;
      trade._breakevenLastBreachBarTime = null;
      return null;
    }

    if (trade._breakevenLastBreachBarTime !== completedBar.time) {
      const previousBarMs = new Date(trade._breakevenLastBreachBarTime || 0).getTime();
      const consecutive = Number.isFinite(previousBarMs) &&
        completedBarMs > previousBarMs &&
        completedBarMs - previousBarMs <= intervalMs * 1.5;
      trade._breakevenBreachCount = consecutive
        ? (Number(trade._breakevenBreachCount) || 0) + 1
        : 1;
      trade._breakevenLastBreachBarTime = completedBar.time;
    }

    const requiredBars = Math.max(1, Math.floor(Number(settings.SIMULATION_EXIT_FADE_CONFIRM_BARS) || 1));
    if ((Number(trade._breakevenBreachCount) || 0) < requiredBars) return null;
    return {
      reason: 'Simulation breakeven guard',
      exitPrice: Number(price),
      protectedPrice,
      estimatedRoundTripCostPct: round3(details.costPct),
      slippagePct: Math.max(0, Number(details.slippagePct) || 0),
      confirmedBars: Number(trade._breakevenBreachCount) || 0,
      confirmationBarTime: completedBar.time,
      exitFlags: ['cost-adjusted breakeven breached', buy ? 'completed candle below VWAP' : 'completed candle above VWAP'],
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
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN) || 45);
    } else if (setupType === 'EARLY_MOMENTUM' || setupType === 'FRESH_BREAKOUT' || setupType === 'VOLUME_SHOCK_BREAKOUT') {
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN) || 35);
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
    const minFavorablePct = Math.max(0, Number(settings.SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT) || 0.15);
    const resetConfirmation = () => {
      trade._noProgressBreachCount = 0;
      trade._noProgressLastBreachBarTime = null;
    };
    if (maxFavorablePct >= minFavorablePct) {
      resetConfirmation();
      return null;
    }
    const adversePct = -favorablePct;
    const adverseTriggerPct = Math.max(0, Number(settings.SIMULATION_NO_PROGRESS_ADVERSE_PCT) || 0.1);
    const vwap = Number(candidate?.indicators?.vwap);
    const priority = candidate?.sectorPriority || trade?.entryContext?.sectorPriority || {};
    const directionalSector = (side === 'sell' ? -1 : 1) * Number(priority.sectorAvg);
    const sectorStrong = !!priority.aligned || (Number.isFinite(directionalSector) && directionalSector >= Number(settings.SIMULATION_DOMINANT_LEADER_MIN_SECTOR_PCT));
    const intervalMin = Math.max(1, Number(settings.SIMULATION_LONG_CONFIRM_CANDLE_MIN) || 5);
    const intervalMs = intervalMin * 60000;
    const completedBars = getCandidateCandles(candidate)
      .filter(bar => new Date(bar.time).getTime() + intervalMs <= nowMs)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    const latestCompleted = completedBars.at(-1);
    const priorCompleted = completedBars.at(-2);
    const reclaimDistancePct = Number.isFinite(vwap) && vwap > 0 && latestCompleted
      ? Math.abs(Number(latestCompleted.close) - vwap) / vwap * 100
      : null;
    const reclaimingVwap = Number.isFinite(vwap) && (
      (side === 'sell' ? Number(price) <= vwap : Number(price) >= vwap) ||
      (
        latestCompleted && priorCompleted &&
        (side === 'sell'
          ? Number(latestCompleted.close) < Number(priorCompleted.close)
          : Number(latestCompleted.close) > Number(priorCompleted.close)) &&
        Number.isFinite(reclaimDistancePct) && reclaimDistancePct <= 0.15
      )
    );
    if (sectorStrong && reclaimingVwap && adversePct <= adverseTriggerPct) {
      trade._noProgressHoldReason = 'strong sector with VWAP reclaim in progress';
      resetConfirmation();
      return null;
    }
    trade._noProgressHoldReason = null;
    if (adversePct < adverseTriggerPct) {
      resetConfirmation();
      return null;
    }
    const deteriorated = isSimulationSignalDeteriorated(trade, candidate, Number(price));
    const vwapLost = Number.isFinite(vwap) && (side === 'sell' ? Number(price) > vwap : Number(price) < vwap);
    const completedBar = getLatestCompletedCandidateCandle(candidate, at, intervalMin);
    const completedBarMs = completedBar ? new Date(completedBar.time).getTime() : NaN;
    const completedClose = Number(completedBar?.close);
    const completedVwapLost = Number.isFinite(completedClose) && Number.isFinite(vwap) &&
      (side === 'sell' ? completedClose > vwap : completedClose < vwap);
    const postEntryBar = Number.isFinite(completedBarMs) &&
      (!Number.isFinite(openedAt) || completedBarMs + intervalMs > openedAt);
    if (!deteriorated || !vwapLost || !completedVwapLost || !postEntryBar) {
      resetConfirmation();
      return null;
    }
    if (trade._noProgressLastBreachBarTime !== completedBar.time) {
      const previousBarMs = new Date(trade._noProgressLastBreachBarTime || 0).getTime();
      const consecutive = Number.isFinite(previousBarMs) &&
        completedBarMs > previousBarMs &&
        completedBarMs - previousBarMs <= intervalMs * 1.5;
      trade._noProgressBreachCount = consecutive
        ? (Number(trade._noProgressBreachCount) || 0) + 1
        : 1;
      trade._noProgressLastBreachBarTime = completedBar.time;
    }
    const requiredBars = Math.max(1, Math.floor(Number(settings.SIMULATION_NO_PROGRESS_CONFIRM_BARS) || 1));
    if ((Number(trade._noProgressBreachCount) || 0) < requiredBars) return null;
    return {
      reason: 'Simulation zero-progress exit',
      exitPrice: Number(price),
      adversePct: round3(adversePct),
      confirmedBars: Number(trade._noProgressBreachCount) || 0,
      confirmationBarTime: completedBar.time,
      exitFlags: [
        `${round3(adversePct)}% adverse after ${round2(holdMs / 60000)}m without progress`,
        side === 'sell' ? 'completed candles above VWAP' : 'completed candles below VWAP',
      ],
    };
  }

  function getAdaptiveLongProfitLockPct(trade, candidate, settings = {}, opts = {}) {
    settings = withDefaults(settings);
    const basePct = Math.max(0, Number(settings.SIMULATION_LONG_PROFIT_LOCK_PCT) || 0.8);
    const setupType = String(trade?.setupType || candidate?.derivedSetupType || candidate?.setupType || '').toUpperCase();
    if (setupType.startsWith('TOP_GAINER_') || isDominantSectorLeader(candidate || trade, settings)) return basePct;
    if (setupType !== 'MOMENTUM_RUNNER') return basePct;
    const indices = opts?.market?.indices || opts?.indices || {};
    const nifty = Number(indices.nifty50?.change ?? indices.nifty?.change ?? opts?.niftyChange);
    const bank = Number(indices.banknifty?.change ?? indices.bankNifty?.change);
    const smallcap = Number(indices.smallcap?.change ?? indices.smallCap?.change);
    const flatLimit = Math.abs(Number(settings.SIMULATION_LONG_FLAT_MARKET_ABS_PCT) || 0.2);
    const flatOrWeak = (Number.isFinite(nifty) && nifty <= flatLimit) ||
      (Number.isFinite(bank) && bank < 0 && Number.isFinite(smallcap) && smallcap < 0);
    return flatOrWeak
      ? Math.max(0, Number(settings.SIMULATION_LONG_WEAK_MARKET_RUNNER_PROFIT_LOCK_PCT) || 0.55)
      : basePct;
  }

  function getConfiguredGainMilestones(settings = {}) {
    const raw = settings.SIMULATION_GAIN_MILESTONES_PCT;
    const values = Array.isArray(raw) ? raw : String(raw || '0.5,1,1.5,2').split(',');
    return [...new Set(values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0)
      .map(value => round3(value)))]
      .sort((a, b) => a - b);
  }

  function getGainMilestoneExit(trade, price, at, settings = {}) {
    settings = withDefaults(settings);
    if (!settings.SIMULATION_GAIN_MILESTONE_ENABLED || !trade || !Number.isFinite(Number(price))) return null;
    const entry = Number(trade.entryPrice);
    const maxFavorablePct = Number(trade._maxFavorablePct) || 0;
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const configuredMilestones = getConfiguredGainMilestones(settings);
    const reachedMilestones = configuredMilestones
      .filter(milestone => maxFavorablePct + 1e-9 >= milestone);
    const reached = reachedMilestones.at(-1);
    const previousFloorPct = Math.max(0, Number(trade._gainMilestoneFloorPct) || 0);
    let newlyArmed = false;
    if (Number.isFinite(reached) && reached > previousFloorPct + 1e-9) {
      const reachedAt = at ? new Date(at).toISOString() : new Date().toISOString();
      const existingHistory = Array.isArray(trade.gainMilestones) ? trade.gainMilestones : [];
      const newlyReached = reachedMilestones
        .filter(milestone => milestone > previousFloorPct + 1e-9)
        .map(milestone => ({
          symbol:String(trade.symbol || '').toUpperCase(),
          milestonePct:milestone,
          reachedAt,
          price:round2(Number(price)),
          holdMin:getTradeHoldMinutes(trade, at),
        }));
      trade._gainMilestoneFloorPct = reached;
      trade._gainMilestoneArmedAt = reachedAt;
      trade.gainMilestoneFloorPct = reached;
      trade.gainMilestones = [...existingHistory, ...newlyReached];
      newlyArmed = true;
    }

    const floorPct = Math.max(previousFloorPct, Number(trade._gainMilestoneFloorPct) || 0);
    if (floorPct <= 0) return null;
    trade.gainMilestoneFloorPct = floorPct;
    const side = String(trade.side || 'buy').toLowerCase();
    const currentFavorablePct = side === 'sell'
      ? ((entry - Number(price)) / entry) * 100
      : ((Number(price) - entry) / entry) * 100;
    // Do not exit on the tick that reaches a floor. Exit only after a later
    // observation falls back through the highest milestone already achieved.
    if (currentFavorablePct + 1e-9 >= floorPct) return null;

    const floorPrice = side === 'sell'
      ? entry * (1 - floorPct / 100)
      : entry * (1 + floorPct / 100);
    return {
      reason: `Simulation ${round2(floorPct)}% gain milestone`,
      // On deployment/restart an older open trade may have historical MFE but
      // no persisted milestone state. Do not backfill an impossible floor fill.
      exitPrice: newlyArmed ? round2(Number(price)) : round2(floorPrice),
      gainMilestonePct: floorPct,
      milestoneReachedAt: trade._gainMilestoneArmedAt || null,
      holdMin: getTradeHoldMinutes(trade, at),
    };
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
      const favorablePctForThreshold = round3(favorablePct);
      const maxFavorablePctForThreshold = round3(Number(trade._maxFavorablePct) || 0);
      trade._bestPrice = side === 'sell'
        ? Math.min(Number(trade._bestPrice) || entry, price)
        : Math.max(Number(trade._bestPrice) || entry, price);
      const gainMilestoneExit = getGainMilestoneExit(trade, price, at, settings);
      if (gainMilestoneExit) return gainMilestoneExit;
      const topGainerExit = getTopGainerContinuationExit(trade, price, candidate, at, settings);
      if (topGainerExit) return topGainerExit;
      const adaptiveLongProfitLockPct = getAdaptiveLongProfitLockPct(trade, candidate, settings, opts);
      if (side !== 'sell') trade._activeLongProfitLockPct = round3(adaptiveLongProfitLockPct);
      if (side !== 'sell' && maxFavorablePctForThreshold >= adaptiveLongProfitLockPct) {
        trade._longProfitLockArmed = true;
        const longProfitLockMinHoldMs = Math.max(0, Number(settings.SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN) || 0) * 60000;
        if (!trade._partialTargetBooked && Number(trade.qty) > 1 && favorablePctForThreshold >= adaptiveLongProfitLockPct &&
            Number.isFinite(openedAt) && nowMs - openedAt >= longProfitLockMinHoldMs && (!Number.isFinite(target) || price < target)) {
          return {
            reason:'Simulation long profit lock',
            exitPrice:Number(price),
            action:'partial',
            qtyPct:Math.min(90, Math.max(1, Number(settings.SIMULATION_LONG_PROFIT_LOCK_PARTIAL_QTY_PCT) || 50)),
            runner:false,
            newTarget:Number.isFinite(target) ? target : null,
            protectRemainder:true,
          };
        }
      }
      if (side === 'sell' && maxFavorablePctForThreshold >= Number(settings.SIMULATION_SHORT_PROFIT_LOCK_PCT || 0.25)) {
        trade._shortProfitLockArmed = true;
        if (!trade._partialTargetBooked && Number(trade.qty) > 1 && favorablePctForThreshold >= Number(settings.SIMULATION_SHORT_PROFIT_LOCK_PCT || 0.25)) {
          return {
            reason:'Simulation short profit lock',
            exitPrice:Number(price),
            action:'partial',
            qtyPct:Math.min(90, Math.max(1, Number(settings.SIMULATION_SHORT_PROFIT_LOCK_PARTIAL_QTY_PCT) || 50)),
            runner:false,
            newTarget:Number.isFinite(target) ? target : null,
            protectRemainder:true,
          };
        }
      }
      const profitLockActivationPct = side === 'sell'
        ? Number(settings.SIMULATION_SHORT_PROFIT_LOCK_PCT || 0.25)
        : adaptiveLongProfitLockPct;
      const breakevenMinHoldMs = side === 'sell'
        ? Math.max(0, Number(settings.SIMULATION_BREAKEVEN_MIN_HOLD_MIN) || 0) * 60000
        : Math.max(0, Number(settings.SIMULATION_LONG_PROFIT_LOCK_MIN_HOLD_MIN) || 0) * 60000;
      const remainderProtectionArmed = side === 'sell' || !!trade._partialTargetBooked;
      if (remainderProtectionArmed && maxFavorablePctForThreshold >= profitLockActivationPct
          && Number.isFinite(openedAt) && nowMs - openedAt >= breakevenMinHoldMs) {
        const feeEstimate = estimateZerodhaIntradayCharges(entry, entry, Number(trade.qty) || 1, side);
        const exposure = entry * (Number(trade.qty) || 1);
        const costPct = exposure > 0 ? (Number(feeEstimate.total) || 0) / exposure * 100 : 0;
        const slippagePct = Math.max(0, Number(settings.SIMULATION_SLIPPAGE_PCT) || 0);
        const protectPct = (costPct + slippagePct + Math.max(0, Number(settings.SIMULATION_BREAKEVEN_COST_BUFFER_PCT) || 0)) / 100;
        const protectedPrice = side === 'sell' ? entry * (1 - protectPct) : entry * (1 + protectPct);
        trade._costAdjustedBreakevenPrice = round2(protectedPrice);
        const breakevenExit = getConfirmedBreakevenExit(
          trade,
          price,
          candidate,
          at,
          settings,
          { protectedPrice, costPct, slippagePct }
        );
        if (breakevenExit) return breakevenExit;
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
      const madeMinimumProgress = maxFavorablePctForThreshold >=
        Math.max(0, Number(settings.SIMULATION_NO_PROGRESS_MIN_FAVORABLE_PCT) || 0.15);
      if (madeMinimumProgress && !isMomentumRunnerTrade(trade) && Number.isFinite(openedAt) && nowMs - openedAt >= Number(settings.SIMULATION_TIME_STOP_MIN || 45) * 60 * 1000 && favorablePct < Number(settings.SIMULATION_TIME_STOP_MIN_PROFIT_PCT || 0.2)) {
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
    const portfolioEquity = Number(context?.portfolioEquity);
    const openExposure = Math.max(0, Number(context?.openExposure) || 0);
    const maxGrossExposurePct = Math.max(0, Number(effectiveSettings.SIMULATION_MAX_GROSS_EXPOSURE_PCT) || 80);
    let remainingGrossCapacity = Number.isFinite(portfolioEquity) && portfolioEquity > 0
      ? Math.max(0, portfolioEquity * maxGrossExposurePct / 100 - openExposure)
      : null;
    const maxExposure = Number(effectiveSettings.MAX_POSITION_EXPOSURE);
    const maxPositionMultiplier = Math.max(0.1, Math.min(1, Number(effectiveSettings.SIMULATION_MAX_POSITION_MULTIPLIER) || 1));
    const positionMultiplier = Number.isFinite(Number(context?.positionMultiplier))
      ? Math.max(0.1, Math.min(maxPositionMultiplier, Number(context.positionMultiplier)))
      : maxPositionMultiplier;
    let remainingCash = Number.isFinite(availableCash) ? Math.max(0, availableCash) : null;
    let remainingHeatRisk = Number.isFinite(Number(context.remainingHeatRisk)) ? Math.max(0, Number(context.remainingHeatRisk)) : null;
    const sectorHeatRemaining = context.sectorHeatRemaining && typeof context.sectorHeatRemaining === 'object' ? { ...context.sectorHeatRemaining } : null;
    return selectSimulationEntryCandidates(candidates, at, effectiveSettings, context)
      .map(candidate => {
        const side = candidate.side || candidate.signal || 'buy';
        const price = getCandidatePrice(candidate);
        const plan = getPaperPlanForCandidate(candidate, side, price, effectiveSettings);
        const explicitQtyRaw = Number(candidate?.qty ?? candidate?.entryContext?.qty);
        const setupType = candidate.derivedSetupType || candidate.setupType || null;
        const runnerInitialMultiplier = Math.max(
          0.1,
          Math.min(1, Number(effectiveSettings.SIMULATION_RUNNER_INITIAL_POSITION_MULTIPLIER) || 0.5)
        );
        const setupPositionMultiplier = setupType === 'TOP_GAINER_PULLBACK_RECLAIM'
          ? Math.max(0.1, Math.min(1, Number(effectiveSettings.SIMULATION_TOP_GAINER_PULLBACK_POSITION_MULTIPLIER) || 0.5))
          : (setupType === 'TOP_LOSER_BEAR_FLAG'
            ? Math.max(0.1, Math.min(1, Number(effectiveSettings.SIMULATION_TOP_LOSER_POSITION_MULTIPLIER) || 0.5))
            : (setupType === 'RANGEBOUND'
              ? Math.max(0.1, Math.min(1, Number(effectiveSettings.SIMULATION_RANGEBOUND_POSITION_MULTIPLIER) || 0.5))
              : (setupType === 'MOMENTUM_RUNNER' ? runnerInitialMultiplier : 1)));
        const sideText = String(side || '').toLowerCase();
        const change5m = Number(getVolumeShockInfo(candidate).change5m);
        const negativeMomentumReclaimMultiplier = sideText !== 'sell' && change5m < 0 && isFormalLongPullbackReclaimSetup(setupType)
          ? Math.max(0.1, Math.min(1, Number(effectiveSettings.SIMULATION_LONG_NEGATIVE_5M_RECLAIM_POSITION_MULTIPLIER) || 0.5))
          : 1;
        const effectiveSetupPositionMultiplier = Math.min(setupPositionMultiplier, negativeMomentumReclaimMultiplier);
        const fullSizing = setupType === 'MOMENTUM_RUNNER'
          ? getSuggestedQty(
              candidate,
              side,
              price,
              remainingCash,
              Number.isFinite(maxExposure) ? maxExposure : null,
              effectiveSettings,
              positionMultiplier
            )
          : null;
        const sizing = getSuggestedQty(
          candidate,
          side,
          price,
          remainingCash,
          Number.isFinite(maxExposure) ? maxExposure : null,
          effectiveSettings,
          positionMultiplier * effectiveSetupPositionMultiplier
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
        if (remainingGrossCapacity != null && Number.isFinite(price) && price > 0) {
          qty = Math.min(qty, Math.floor(remainingGrossCapacity / price));
        }
        if (qty <= 0) return null;
        if (remainingCash != null) remainingCash = Math.max(0, remainingCash - (price * qty));
        if (remainingGrossCapacity != null) remainingGrossCapacity = Math.max(0, remainingGrossCapacity - price * qty);
        if (remainingHeatRisk != null) remainingHeatRisk = Math.max(0, remainingHeatRisk - riskPerShare * qty);
        if (sectorHeatRemaining) sectorHeatRemaining[sector] = Math.max(0, Number(sectorHeatRemaining[sector]) - riskPerShare * qty);
        const target = hasFiniteNumber(candidate?.target)
          ? round2(Number(candidate.target))
          : (hasFiniteNumber(plan?.target) ? round2(Number(plan.target)) : null);
        const stop = setupType !== 'MOMENTUM_RUNNER' && hasFiniteNumber(candidate?.stop)
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
          setupType,
          setup: candidate.setup || candidate.indicators?.setup || null,
          entryContext: {
            ...rawEntryContext,
            plannedFullQty:setupType === 'MOMENTUM_RUNNER'
              ? Math.max(qty, Math.floor(Number(fullSizing?.qty) || 0))
              : undefined,
            initialPositionMultiplier:setupType === 'MOMENTUM_RUNNER' ? runnerInitialMultiplier : undefined,
            entryPositionMultiplier:round3(positionMultiplier * effectiveSetupPositionMultiplier),
            negativeMomentumReclaimSizeReduced:negativeMomentumReclaimMultiplier < 1,
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
            confirmation:getEntryConfirmation(candidate, candidate.previousCandidate, side, snapshotAt || at, effectiveSettings),
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
    parseEntryTriggerPrice,
    getEntryTriggerPrice,
    applyFrozenEntryTrigger,
    getRelativeVolume,
    annotateTopGainerRanks,
    getTopGainerContinuationInfo,
    getTopGainerPullbackReclaimInfo,
    getGapAndGoInfo,
    getBullFlagContinuationInfo,
    getBearFlagContinuationInfo,
    getTopLoserBearFlagInfo,
    getOpeningFlushReversalInfo,
    getLateShortAccelerationInfo,
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
    getMomentumCatalystAdjustment,
    applyDecisionScore,
    getCandidateDecisionScore,
    getNegativeExpectancyBlockReason,
    buildSettingsAuditSnapshot,
    stableAuditFingerprint,
    buildIndicatorAuditSnapshot,
    buildManagementCandidateSnapshot,
    buildSectorPriorityStats,
    applySectorPriority,
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
    isTimedContinuationReentryAllowed,
    getMomentumRunnerInfo,
    getVwapContinuationInfo,
    getEarlyMomentumInfo,
    getRangeboundInfo,
    deriveSetupType,
    getSetupBlockReason,
    isReplayCandidateEligible,
    compareCandidates,
    getCandidateProfitabilityMetrics,
    compareCandidatesByProfitability,
    selectTopCandidatesBySetup,
    selectSimulationEntryCandidates,
    estimateZerodhaIntradayCharges,
    applyAdverseSlippage,
    getPaperTradePnl,
    getPaperPlanForCandidate,
    getNextRunnerTarget,
    getSuggestedQty,
    getMomentumRunnerScaleInIntent,
    isMomentumRunnerTrade,
    isSimulationSignalDeteriorated,
    isSimulationStopDeteriorated,
    isMomentumRunnerBroken,
    getTargetRunnerInfo,
    getProfitReentryBlockReason,
    getSimulationStopExit,
    getConfirmedBreakevenExit,
    getMomentumRunnerExit,
    getSimulationExit,
    getLatestCandidateCandle,
    getLatestCompletedCandidateCandle,
    getCandidateCandles,
    getLongEntryConfirmation,
    getShortEntryConfirmation,
    getEntryConfirmation,
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
