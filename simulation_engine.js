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
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') return 0;
    if (setupType === 'BREAKDOWN') return 0;
    if (setupType === 'VWAP_REJECTION') return 1;
    if (setupType === 'VWAP_PULLBACK_OR_HOLD') return 0;
    if (setupType === 'VWAP_TREND_CONTINUATION') return 1;
    if (setupType === 'MOMENTUM_RUNNER') return 2;
    if (setupType === 'LONG_MOMENTUM') return 3;
    if (setupType === 'FRESH_BREAKOUT') return 4;
    return 9;
  }

  function isSimulationSetupAllowed(setupType) {
    return ['VOLUME_SHOCK_BREAKOUT', 'BREAKDOWN', 'VWAP_REJECTION', 'FRESH_BREAKOUT', 'VWAP_PULLBACK_OR_HOLD', 'VWAP_TREND_CONTINUATION', 'MOMENTUM_RUNNER', 'LONG_MOMENTUM'].includes(setupType);
  }

  function getMinScoreForSide(settings, side) {
    settings = withDefaults(settings);
    if (side === 'sell') return Number(settings.SIMULATION_SHORT_MIN_SCORE) || Number(settings.SIMULATION_MIN_SCORE) || 0;
    return Number(settings.SIMULATION_MIN_SCORE) || 0;
  }

  function getMinScoreForCandidate(settings, side, setupType, candidate = null) {
    settings = withDefaults(settings);
    if (['VOLUME_SHOCK_BREAKOUT', 'FRESH_BREAKOUT'].includes(setupType) && isStrongVolumeBreakoutCandidate(candidate, settings)) {
      return Math.min(
        getMinScoreForSide(settings, side),
        Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_SCORE) || 55
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
    return Number.isFinite(price) && price > 0 &&
      Number.isFinite(vwap) && vwap > 0 &&
      price > vwap &&
      relVol != null && relVol >= Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_REL_VOL || 3) &&
      Number.isFinite(dayChange) &&
      dayChange >= Number(settings.SIMULATION_STRONG_BREAKOUT_MIN_DAY_GAIN_PCT || 3) &&
      dayChange <= Number(settings.SIMULATION_STRONG_BREAKOUT_MAX_DAY_GAIN_PCT || 8) &&
      Number.isFinite(rsi) && rsi <= Number(settings.SIMULATION_STRONG_BREAKOUT_MAX_RSI || 75);
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

  function getMarketRegime(candidate, side, context = {}) {
    const settings = withDefaults(context.settings || context);
    const niftyThreshold = Math.abs(Number(settings.SIMULATION_MARKET_REGIME_NIFTY_PCT) || 0);
    const sectorThreshold = Math.abs(Number(settings.SIMULATION_MARKET_REGIME_SECTOR_PCT) || 0);
    const rsThreshold = Math.abs(Number(settings.SIMULATION_MARKET_REGIME_RS_PCT) || 0);
    const existingBlock = String(candidate?.blockReason || candidate?.entryBlockReason || '');
    if (/^market regime conflict/i.test(existingBlock)) {
      const rawReasons = existingBlock.replace(/^market regime conflict:\s*/i, '').split(',').map(s => s.trim()).filter(Boolean);
      let reasons = rawReasons;
      if (niftyThreshold >= 999) reasons = reasons.filter(r => !/^Nifty\b/i.test(r));
      if (rsThreshold >= 999) reasons = reasons.filter(r => !/^RS\b/i.test(r));
      if (reasons.length) return { ok:false, reason:`market regime conflict: ${reasons.join(', ')}` };
    }
    const market = context.market || {};
    const indices = market.indices || context.indices || {};
    const nifty = Number(context.niftyChange ?? indices.nifty50?.change ?? indices.nifty?.change);
    const breadth = market.breadth || context.breadth || {};
    const advances = Number(breadth.advances ?? breadth.advance ?? breadth.up);
    const declines = Number(breadth.declines ?? breadth.decline ?? breadth.down);
    const advPct = Number.isFinite(Number(breadth.advancePct))
      ? Number(breadth.advancePct)
      : (Number.isFinite(advances) && Number.isFinite(declines) && advances + declines > 0 ? round2((advances / (advances + declines)) * 100) : null);
    const breadthThreshold = Math.abs(Number(settings.SIMULATION_MARKET_BREADTH_PCT) || 55);
    const sectorTrend = context.sectorTrend || {};
    const sectorAvg = Number(context.sectorAvg ?? sectorTrend[candidate?.sector]);
    const dayChange = getCandidateDayChange(candidate);
    const rs = Number.isFinite(dayChange) && Number.isFinite(nifty) ? round2(dayChange - nifty) : null;
    const tradeSide = side || candidate?.side || candidate?.signal || adjustedTradeSignal(Number(candidate?.score) || 0);
    const reasons = [];
    if (tradeSide === 'buy') {
      if (Number.isFinite(nifty) && nifty < -niftyThreshold) reasons.push(`Nifty ${nifty}%`);
      if (Number.isFinite(advPct) && advPct < 100 - breadthThreshold) reasons.push(`breadth ${advPct}% advances`);
      if (Number.isFinite(sectorAvg) && sectorAvg < -sectorThreshold) reasons.push(`sector ${round1(sectorAvg)}%`);
      if (Number.isFinite(rs) && rs < -rsThreshold) reasons.push(`RS ${rs}%`);
    } else if (tradeSide === 'sell') {
      if (settings.SIMULATION_REQUIRE_NIFTY_FOR_SHORTS && niftyThreshold < 999 && !Number.isFinite(nifty)) {
        reasons.push('Nifty unavailable');
      }
      if (Number.isFinite(nifty) && nifty > niftyThreshold) reasons.push(`Nifty ${nifty}%`);
      if (Number.isFinite(advPct) && advPct > breadthThreshold) reasons.push(`breadth ${advPct}% advances`);
      if (Number.isFinite(sectorAvg) && sectorAvg > sectorThreshold) reasons.push(`sector ${round1(sectorAvg)}%`);
      if (Number.isFinite(rs) && rs > rsThreshold) reasons.push(`RS ${rs}%`);
    }
    return { ok:reasons.length === 0, reason:reasons.length ? `market regime conflict: ${reasons.join(', ')}` : 'market aligned', nifty:Number.isFinite(nifty) ? nifty : null, sectorAvg:Number.isFinite(sectorAvg) ? sectorAvg : null, rs, advancePct:Number.isFinite(advPct) ? advPct : null };
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
      indicators: {
        entryStatus: indicators.entryStatus,
        vwap: indicators.vwap,
      },
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

  function getMomentumRunnerInfo(candidate, settings) {
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
    const normalOk =
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
    const earlyOk =
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
      triggerDistancePct > 0.6 &&
      triggerDistancePct <= settings.SIMULATION_EARLY_RUNNER_MAX_TRIGGER_EXTENSION_PCT &&
      vwapExtensionPct != null &&
      vwapExtensionPct <= settings.SIMULATION_EARLY_RUNNER_MAX_VWAP_EXTENSION_PCT &&
      confirmationCount >= 3;
    const ok = normalOk || earlyOk;
    return {
      ok,
      mode: earlyOk && !normalOk ? 'early' : (normalOk ? 'confirmed' : null),
      score,
      relVol,
      dayChange,
      triggerDistancePct,
      vwapExtensionPct,
      confirmationCount,
      superTrend: st || null,
      volumeRatio3m: Number.isFinite(volumeImpulse.ratio3m) ? volumeImpulse.ratio3m : null,
      volumeRatio5m: Number.isFinite(volumeImpulse.ratio5m) ? volumeImpulse.ratio5m : null,
      freshHighBreakout: volumeImpulse.freshHighBreakout,
      lateRunnerOk,
      reason: ok
        ? (earlyOk && !normalOk ? 'early momentum runner' : 'momentum runner')
        : (!bullishSuperTrendOk
          ? 'runner needs bullish SuperTrend'
          : (!volumeImpulse.impulseOk
            ? 'runner needs fresh volume impulse or high breakout'
            : (!lateRunnerOk ? 'late runner needs fresh shock/high breakout' : 'not momentum runner'))),
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

  function deriveSetupType(candidate, settings) {
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
    if (indicators.volumeShock?.isShock) return 'VOLUME_SHOCK_BREAKOUT';
    if (getMomentumRunnerInfo(candidate, settings).ok) return 'MOMENTUM_RUNNER';
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
    const runnerInfo = getMomentumRunnerInfo(candidate, settings);
    if (setupType === 'MOMENTUM_RUNNER' && !runnerInfo.ok) return runnerInfo.reason || 'not momentum runner';
    const runner = runnerInfo.ok;
    const continuationInfo = getVwapContinuationInfo(candidate, settings);
    if (setupType === 'VWAP_TREND_CONTINUATION' && !continuationInfo.ok) return continuationInfo.reason || 'not VWAP continuation';
    const continuation = continuationInfo.ok;
    const relVol = getRelativeVolume(candidate);
    const guardLevel = String(candidate.guard?.level || '').toLowerCase();
    if (setupType === 'VOLUME_SHOCK_BREAKOUT') {
      const shock = candidate.indicators?.volumeShock || {};
      if (!shock.isShock) return 'volume shock not active';
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
      if (setupType === 'BREAKDOWN' && shortConfirmBars > 1 && !hasFreshBreakoutConfirmation(candidate, context.previousCandidate, side)) {
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
      if (triggerDistancePct > 0.6 && setupType !== 'VOLUME_SHOCK_BREAKOUT' && !runner && !continuation) return `chasing ${round2(triggerDistancePct)}% from trigger`;
    }
    const vwap = Number(candidate.indicators?.vwap);
    if (Number.isFinite(vwap) && vwap > 0) {
      const vwapExtensionPct = buy ? ((price - vwap) / vwap) * 100 : ((vwap - price) / vwap) * 100;
      const baseFreshMax = Number(settings.SIMULATION_FRESH_BREAKOUT_MAX_VWAP_EXTENSION_PCT) || 0.8;
      const highRelVol = relVol != null && relVol >= (Number(settings.SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL) || 2);
      const freshMax = setupType === 'FRESH_BREAKOUT' && highRelVol
        ? Number(settings.SIMULATION_FRESH_BREAKOUT_HIGH_REL_VOL_MAX_VWAP_EXTENSION_PCT) || 1
        : baseFreshMax;
      if (vwapExtensionPct > freshMax && setupType !== 'VOLUME_SHOCK_BREAKOUT' && !runner && !continuation) return `extended ${round2(vwapExtensionPct)}% from VWAP`;
    }
    if (setupType === 'FRESH_BREAKOUT' && !runner) {
      if (!hasFreshBreakoutConfirmation(candidate, context.previousCandidate, side)) {
        return 'fresh breakout needs 2 triggered above-VWAP snapshots';
      }
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
    const setupType = candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings);
    if (Math.abs(Number(candidate.score) || 0) < getMinScoreForCandidate(settings, side, setupType, candidate)) return false;
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
    const setupType = candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings);
    if (candidate.assetType === 'etf' && !settings.SIMULATION_ENABLE_ETF) reasons.push('ETF simulation disabled');
    if (candidate.assetType === 'etf' && side === 'sell') reasons.push('ETF short disabled');
    if (!['buy', 'sell'].includes(side)) reasons.push(`signal ${side || '--'}`);
    if (!settings.SIMULATION_AUTO_SHORTS && side === 'sell') reasons.push('auto shorts disabled');
    const minScore = getMinScoreForCandidate(settings, side, setupType, candidate);
    if (Math.abs(Number(candidate.score) || 0) < minScore) reasons.push(`score ${Math.abs(Number(candidate.score) || 0)} < ${minScore}`);
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
    return Math.abs(Number(b.score) || 0) - Math.abs(Number(a.score) || 0);
  }

  function selectSimulationEntryCandidates(candidates, at, settings, context = {}) {
    settings = withDefaults(settings);
    const openSymbols = context.openSymbols instanceof Set
      ? context.openSymbols
      : new Set(Array.isArray(context.openSymbols) ? context.openSymbols : []);
    const quality = getSnapshotDataQuality(candidates, settings);
    if (quality.mode === 'block') return [];
    const configuredTopN = Math.max(1, Math.floor(Number(context.topN ?? settings.SIMULATION_TOP_N) || 10));
    const reducedTopN = Math.max(1, Math.floor(Number(settings.SIMULATION_DATA_QUALITY_REDUCED_TOP_N) || 2));
    const topN = quality.mode === 'reduce' ? Math.min(configuredTopN, reducedTopN) : configuredTopN;
    const entryBlockReason = typeof context.entryBlockReason === 'function'
      ? context.entryBlockReason
      : () => '';
    const market = context.market || {};
    return (Array.isArray(candidates) ? candidates : [])
      .map(candidate => {
        if (!candidate) return null;
        candidate.derivedSetupType = candidate.derivedSetupType || candidate.setupType || deriveSetupType(candidate, settings);
        return candidate;
      })
      .filter(Boolean)
      .filter(candidate => settings.SIMULATION_ENABLE_ETF || candidate.assetType !== 'etf')
      .filter(candidate => !(candidate.assetType === 'etf' && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => ['buy', 'sell'].includes(candidate.side || candidate.signal))
      .filter(candidate => !(settings.REPLAY_LONG_ONLY && (candidate.side || candidate.signal) === 'sell'))
      .filter(candidate => !(settings.REPLAY_SHORT_ONLY && (candidate.side || candidate.signal) !== 'sell'))
      .filter(candidate => isReplayCandidateEligible(candidate, at, settings, {
        previousCandidate: candidate.previousCandidate || context.previousCandidate,
        market,
      }))
      .filter(candidate => !openSymbols.has(candidate.symbol))
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
      .sort(compareCandidates)
      .slice(0, topN);
  }

  function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy') {
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
    const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
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
    const charges = memoizedEstimateZerodhaIntradayCharges(entry, price, qty, side);
    const pnl = grossPnl - charges.total;
    return { pnl: round2(pnl), pnlPct: round2((pnl / (entry * qty)) * 100), grossPnl: round2(grossPnl), charges: charges.total, chargeBreakup: charges };
  }

  function getPaperPlanForCandidate(candidate, side, price) {
    const indicators = candidate?.indicators || {};
    const entry = Number(price);
    const rawTarget = Number(indicators.target);
    const rawStop = Number(indicators.stop);
    const atr = Number(indicators.atr);
    const targetDistance = Number.isFinite(rawTarget) ? Math.abs(rawTarget - entry) : (Number.isFinite(atr) ? atr * 1.25 : entry * 0.008);
    const stopDistance = Number.isFinite(rawStop) ? Math.abs(entry - rawStop) : (Number.isFinite(atr) ? atr * 0.8 : entry * 0.005);
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
    const plan = getPaperPlanForCandidate(candidate, side, entry);
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
    const score = Number(candidate.score) || 0;
    const signal = adjustedTradeSignal(score);
    const indicators = candidate.indicators || {};
    const vwap = Number(indicators.vwap);
    const ema9 = Number(indicators.ema9 ?? indicators.emaShort);
    const ema20 = Number(indicators.ema20 ?? indicators.emaLong);
    const st = String(indicators.superTrendDirection || '').toLowerCase();
    if (signal !== 'buy' || score < settings.SIMULATION_MIN_SCORE) return true;
    if (Number.isFinite(vwap) && price < vwap) return true;
    if (Number.isFinite(ema9) && Number.isFinite(ema20) && ema9 < ema20) return true;
    if (st === 'bearish') return true;
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
    if (isMomentumRunnerBroken(trade, candidate, price, settings)) return { reason: 'Simulation momentum break', exitPrice: Number(price) };
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
    const bar = candidate?.indicators?.ohlc?.latestBar;
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
    let minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_EXIT_MIN) || 12);
    if (setupType === 'MOMENTUM_RUNNER' || Number(trade._runnerArmed)) {
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_RUNNER_EXIT_MIN) || 9);
    } else if (setupType === 'FRESH_BREAKOUT' || setupType === 'VOLUME_SHOCK_BREAKOUT') {
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_FRESH_BREAKOUT_EXIT_MIN) || 12);
    } else if (setupType === 'VWAP_TREND_CONTINUATION') {
      const fadeThreshold = Number(settings.SIMULATION_NO_PROGRESS_VWAP_CONT_REL_VOL_FADE) || 1.2;
      if (settings.SIMULATION_NO_PROGRESS_VWAP_CONT_REQUIRE_REL_VOL_FADE && !(relVol != null && relVol < fadeThreshold)) {
        return null;
      }
      minHoldMin = Math.max(1, Number(settings.SIMULATION_NO_PROGRESS_VWAP_CONT_EXIT_MIN) || 8);
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
      if ((trade._maxFavorablePct || 0) >= Number(settings.SIMULATION_BREAKEVEN_PROTECT_PCT || 0.5)) {
        const breakevenBuffer = entry * 0.001;
        if (side === 'sell' && price >= entry - breakevenBuffer) return { reason: 'Simulation breakeven protect', exitPrice: entry };
        if (side !== 'sell' && price <= entry + breakevenBuffer) return { reason: 'Simulation breakeven protect', exitPrice: entry };
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
    const availableCash = Number(context?.cashAvailable);
    const maxExposure = Number(effectiveSettings.MAX_POSITION_EXPOSURE);
    const positionMultiplier = Number.isFinite(Number(context?.positionMultiplier))
      ? Math.max(0.1, Math.min(1.0, Number(context.positionMultiplier)))
      : 1.0;
    return selectSimulationEntryCandidates(candidates, at, effectiveSettings, context)
      .map(candidate => {
        const side = candidate.side || candidate.signal || 'buy';
        const price = getCandidatePrice(candidate);
        const plan = getPaperPlanForCandidate(candidate, side, price);
        const explicitQtyRaw = Number(candidate?.qty ?? candidate?.entryContext?.qty);
        const sizing = getSuggestedQty(
          candidate,
          side,
          price,
          Number.isFinite(availableCash) ? availableCash : null,
          Number.isFinite(maxExposure) ? maxExposure : null,
          effectiveSettings,
          positionMultiplier
        );
        const computedQty = Math.floor(Number(sizing?.qty));
        const qty = Number.isFinite(explicitQtyRaw) && explicitQtyRaw > 0
          ? Math.floor(explicitQtyRaw)
          : (Number.isFinite(computedQty) && computedQty > 0 ? computedQty : 1);
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
          rr,
          setupType: candidate.derivedSetupType || candidate.setupType || null,
          setup: candidate.setup || candidate.indicators?.setup || null,
          entryContext: {
            ...rawEntryContext,
            snapshotId,
            snapshotAt,
            snapshotSource,
            snapshotAgeMin: candidate.__snapshotAgeMin ?? rawEntryContext.snapshotAgeMin ?? null,
            candidateScore: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
            candidateSetupType: candidate.derivedSetupType || candidate.setupType || null,
          },
          snapshotId,
          snapshotAt,
          notes: candidate.notes || '',
          assetType: candidate.assetType || null,
          candidate,
        };
      });
  }

  function exitBucket(reason) {
    const text = String(reason || '').toLowerCase();
    if (text.includes('target')) return 'Target';
    if (text.includes('trail')) return 'Trail';
    if (text.includes('vwap')) return 'VWAP';
    if (text.includes('zero-progress')) return 'Zero-progress';
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
    isStrongVolumeBreakoutCandidate,
    getRecentVolumeImpulseInfo,
    isLateRunnerAllowed,
    getMarketRegime,
    isTriggeredAboveVwap,
    hasFreshBreakoutConfirmation,
    toConfirmationCandidate,
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
    getSimulationExitIntent,
    getSimulationEntryIntents,
    getMomentumFadeExit,
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
