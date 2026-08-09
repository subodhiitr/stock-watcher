'use strict';

const TradeRules = require('../trade_rules');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PERIODS = Object.freeze({
  '10d': 10 * DAY_MS,
  '30d': 30 * DAY_MS,
  '90d': 90 * DAY_MS,
  all: null,
});

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function asTime(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function istDay(timestamp) {
  if (!timestamp) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Kolkata',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
  }).formatToParts(new Date(timestamp));
  const pick = type => parts.find(part => part.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function isTradingDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function exitBucket(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('target') || text.includes('milestone')) return 'Target';
  if (text.includes('trail')) return 'Trail';
  if (text.includes('vwap')) return 'VWAP';
  if (text.includes('zero-progress') || text.includes('no-progress')) return 'No progress';
  if (text.includes('breakeven')) return 'Breakeven';
  if (text.includes('negative candle')) return 'Candle exit';
  if (text.includes('momentum') || text.includes('deterioration') || text.includes('fade')) return 'Momentum fade';
  if (text.includes('stop')) return 'Stop';
  if (text.includes('eod') || text.includes('square')) return 'EOD';
  return reason || 'Other';
}

function buildPositionFact(positionId, rows) {
  const legs = rows.map(row => row.trade).filter(Boolean);
  if (!legs.length || legs.some(trade => String(trade.status || '').toLowerCase() !== 'closed')) return null;
  const root = legs.find(trade => String(trade.id) === String(positionId)) || legs[0];
  const setupType = String(root.setupType || legs.find(trade => trade.setupType)?.setupType || 'UNKNOWN').toUpperCase();
  const openedTimes = legs.map(trade => asTime(trade.openedAt)).filter(Boolean);
  const closedTimes = legs.map(trade => asTime(trade.closedAt || trade.openedAt)).filter(Boolean);
  const openedAt = openedTimes.length ? Math.min(...openedTimes) : 0;
  const closedAt = closedTimes.length ? Math.max(...closedTimes) : 0;
  const pnl = legs.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
  const grossPnl = legs.reduce((sum, trade) => sum + (Number(trade.grossPnl) || 0), 0);
  const charges = legs.reduce((sum, trade) => sum + (Number(trade.charges) || 0), 0);
  const exposure = legs.reduce((sum, trade) => (
    sum + Math.abs((Number(trade.entryPrice) || 0) * (Number(trade.qty) || 0))
  ), 0);
  const finalLeg = [...legs].sort((a, b) => asTime(a.closedAt) - asTime(b.closedAt)).at(-1);
  const sourceUpdatedAt = Math.max(...rows.map(row => Number(row.updatedAt) || 0));
  const openedMinute = TradeRules.getIstMinutes(root.openedAt);
  return {
    positionId:String(positionId),
    setupType,
    side:String(root.side || root.signal || 'buy').toLowerCase(),
    symbol:String(root.symbol || ''),
    openedAt,
    closedAt,
    tradeDay:istDay(closedAt),
    sourceUpdatedAt,
    legs:legs.length,
    score:Math.abs(Number(root.score) || 0),
    decisionScore:Number.isFinite(Number(root.decisionScore ?? root.entryContext?.decisionScore))
      ? Number(root.decisionScore ?? root.entryContext?.decisionScore)
      : null,
    rangeboundAdmission:setupType === 'RANGEBOUND' && root.entryContext?.rangeboundAdmission
      && typeof root.entryContext.rangeboundAdmission === 'object'
      ? { ...root.entryContext.rangeboundAdmission }
      : null,
    exposure:round(exposure),
    pnl:round(pnl),
    grossPnl:round(grossPnl),
    charges:round(charges),
    netPct:exposure > 0 ? round(pnl / exposure * 100, 4) : 0,
    holdMin:openedAt && closedAt ? round((closedAt - openedAt) / 60000, 1) : 0,
    exitReason:String(finalLeg?.closeReason || ''),
    exitBucket:exitBucket(finalLeg?.closeReason),
    targetHit:legs.some(trade => /target|milestone/i.test(String(trade.closeReason || ''))),
    stopHit:legs.some(trade => /stop/i.test(String(trade.closeReason || ''))),
    trailHit:legs.some(trade => /trail|breakeven/i.test(String(trade.closeReason || ''))),
    lateEntry:openedMinute != null && openedMinute >= 12 * 60,
  };
}

function maxLosingStreak(facts) {
  let current = 0;
  let maximum = 0;
  for (const fact of facts) {
    current = Number(fact.pnl) <= 0 ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function drawdownStats(facts) {
  let cumulativePnl = 0;
  let pnlPeak = 0;
  let maxDrawdown = 0;
  let cumulativePct = 0;
  let pctPeak = 0;
  let maxDrawdownPct = 0;
  for (const fact of facts) {
    cumulativePnl += Number(fact.pnl) || 0;
    pnlPeak = Math.max(pnlPeak, cumulativePnl);
    maxDrawdown = Math.max(maxDrawdown, pnlPeak - cumulativePnl);
    cumulativePct += Number(fact.netPct) || 0;
    pctPeak = Math.max(pctPeak, cumulativePct);
    maxDrawdownPct = Math.max(maxDrawdownPct, pctPeak - cumulativePct);
  }
  return { maxDrawdown:round(maxDrawdown), maxDrawdownPct:round(maxDrawdownPct, 3) };
}

function summarizeSetup(setupType, period, sourceFacts, definition = {}) {
  const facts = [...sourceFacts].sort((a, b) => Number(a.closedAt) - Number(b.closedAt));
  const wins = facts.filter(fact => Number(fact.pnl) > 0);
  const losses = facts.filter(fact => Number(fact.pnl) <= 0);
  const grossWins = wins.reduce((sum, fact) => sum + (Number(fact.pnl) || 0), 0);
  const grossLosses = losses.reduce((sum, fact) => sum + (Number(fact.pnl) || 0), 0);
  const netPnl = grossWins + grossLosses;
  const grossPnl = facts.reduce((sum, fact) => sum + (Number(fact.grossPnl) || 0), 0);
  const charges = facts.reduce((sum, fact) => sum + (Number(fact.charges) || 0), 0);
  const exposure = facts.reduce((sum, fact) => sum + (Number(fact.exposure) || 0), 0);
  const avgNetPct = facts.length ? facts.reduce((sum, fact) => sum + (Number(fact.netPct) || 0), 0) / facts.length : 0;
  const avgWinPct = wins.length ? wins.reduce((sum, fact) => sum + Number(fact.netPct), 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((sum, fact) => sum + Number(fact.netPct), 0) / losses.length : 0;
  const profitFactor = grossLosses < 0 ? grossWins / Math.abs(grossLosses) : (grossWins > 0 ? 4 : 0);
  const payoffRatio = avgLossPct < 0 ? avgWinPct / Math.abs(avgLossPct) : (avgWinPct > 0 ? 4 : 0);
  const avgHoldMin = facts.length ? facts.reduce((sum, fact) => sum + Number(fact.holdMin || 0), 0) / facts.length : 0;
  const recent = facts.slice(-20);
  const previous = facts.slice(-40, -20);
  const recentAvgNetPct = recent.length ? recent.reduce((sum, fact) => sum + Number(fact.netPct || 0), 0) / recent.length : 0;
  const previousAvgNetPct = previous.length ? previous.reduce((sum, fact) => sum + Number(fact.netPct || 0), 0) / previous.length : recentAvgNetPct;
  const recentTrendPct = recentAvgNetPct - previousAvgNetPct;
  const days = new Map();
  for (const fact of facts) days.set(fact.tradeDay, (days.get(fact.tradeDay) || 0) + Number(fact.pnl || 0));
  const profitableDays = [...days.values()].filter(value => value > 0).length;
  const consistencyPct = days.size ? profitableDays / days.size * 100 : 0;
  const costDragPct = Math.abs(grossPnl) > 0 ? charges / Math.abs(grossPnl) * 100 : (charges > 0 ? 100 : 0);
  const drawdown = drawdownStats(facts);

  const expectancyComponent = clamp(50 + avgNetPct * 80);
  const profitFactorComponent = clamp(profitFactor * 50);
  const drawdownComponent = clamp(100 - drawdown.maxDrawdownPct * 25);
  const payoffComponent = clamp(payoffRatio * 50);
  const recentComponent = clamp(50 + recentTrendPct * 100);
  const consistencyComponent = clamp(consistencyPct);
  const costComponent = clamp(100 - costDragPct * 3);
  const rawScore = (
    expectancyComponent * 0.30
    + profitFactorComponent * 0.20
    + drawdownComponent * 0.15
    + payoffComponent * 0.10
    + recentComponent * 0.10
    + consistencyComponent * 0.10
    + costComponent * 0.05
  );
  const confidence = Math.min(1, Math.sqrt(facts.length / 30)) * Math.min(1, days.size / 10);
  const efficiencyScore = facts.length ? 50 + (rawScore - 50) * confidence : 0;
  const insufficient = facts.length < 12;
  const grade = insufficient ? 'Insufficient data'
    : efficiencyScore >= 75 ? 'Strong'
      : efficiencyScore >= 60 ? 'Efficient'
        : efficiencyScore >= 45 ? 'Watch'
          : 'Review';
  const recommendation = insufficient ? `Collect ${Math.max(0, 12 - facts.length)} more closed positions`
    : efficiencyScore < 45 ? 'Review setup rules before enabling'
      : recentTrendPct < -0.15 ? 'Watch recent deterioration'
        : efficiencyScore >= 75 ? 'Keep enabled and monitor'
          : 'Keep under observation';

  return {
    setupType,
    label:definition.label || setupType.replace(/_/g, ' '),
    side:definition.side || facts[0]?.side || '',
    period,
    trades:facts.length,
    tradingDays:days.size,
    wins:wins.length,
    losses:losses.length,
    winRate:facts.length ? round(wins.length / facts.length * 100, 1) : 0,
    netPnl:round(netPnl),
    grossPnl:round(grossPnl),
    charges:round(charges),
    exposure:round(exposure),
    avgNetPct:round(avgNetPct, 3),
    avgWinPct:round(avgWinPct, 3),
    avgLossPct:round(avgLossPct, 3),
    profitFactor:round(profitFactor, 2),
    payoffRatio:round(payoffRatio, 2),
    maxDrawdown:drawdown.maxDrawdown,
    maxDrawdownPct:drawdown.maxDrawdownPct,
    maxLosingStreak:maxLosingStreak(facts),
    avgHoldMin:round(avgHoldMin, 1),
    returnPerHoldHour:avgHoldMin > 0 ? round(avgNetPct / (avgHoldMin / 60), 3) : 0,
    targetHitPct:facts.length ? round(facts.filter(fact => fact.targetHit).length / facts.length * 100, 1) : 0,
    stopHitPct:facts.length ? round(facts.filter(fact => fact.stopHit).length / facts.length * 100, 1) : 0,
    trailHitPct:facts.length ? round(facts.filter(fact => fact.trailHit).length / facts.length * 100, 1) : 0,
    lateEntryPct:facts.length ? round(facts.filter(fact => fact.lateEntry).length / facts.length * 100, 1) : 0,
    costDragPct:round(costDragPct, 1),
    consistencyPct:round(consistencyPct, 1),
    recentAvgNetPct:round(recentAvgNetPct, 3),
    recentTrendPct:round(recentTrendPct, 3),
    confidencePct:round(confidence * 100, 1),
    efficiencyScore:round(efficiencyScore, 1),
    grade,
    recommendation,
    lastClosedAt:facts.at(-1)?.closedAt || 0,
  };
}

function createSetupEfficiencyService({ db, intervalMs = HOUR_MS, now = () => Date.now(), logger = console } = {}) {
  let timer = null;
  let inFlight = null;
  const subscribers = new Set();

  function buildSummaries(facts) {
    const definitions = TradeRules.SIMULATION_SETUP_DEFINITIONS || [];
    const byType = new Map(definitions.map(definition => [definition.type, definition]));
    for (const fact of facts) {
      if (!byType.has(fact.setupType)) byType.set(fact.setupType, { type:fact.setupType, label:String(fact.setupType).replace(/_/g, ' '), side:fact.side });
    }
    const computedAt = now();
    const rows = [];
    for (const [period, duration] of Object.entries(PERIODS)) {
      const cutoff = duration == null ? 0 : computedAt - duration;
      for (const [setupType, definition] of byType) {
        const selected = facts.filter(fact => fact.setupType === setupType && Number(fact.closedAt) >= cutoff);
        rows.push({ ...summarizeSetup(setupType, period, selected, definition), computedAt });
      }
    }
    return rows;
  }

  function summarizeFacts(facts, period) {
    const definitions = TradeRules.SIMULATION_SETUP_DEFINITIONS || [];
    const byType = new Map(definitions.map(definition => [definition.type, definition]));
    for (const fact of facts) {
      if (!byType.has(fact.setupType)) {
        byType.set(fact.setupType, {
          type:fact.setupType,
          label:String(fact.setupType).replace(/_/g, ' '),
          side:fact.side,
        });
      }
    }
    return [...byType.entries()]
      .map(([setupType, definition]) => summarizeSetup(
        setupType,
        period,
        facts.filter(fact => fact.setupType === setupType),
        definition
      ))
      .sort((a, b) => Number(b.efficiencyScore) - Number(a.efficiencyScore) || a.setupType.localeCompare(b.setupType));
  }

  function getPayload(period = 'all', tradeDate = '') {
    const selectedPeriod = Object.prototype.hasOwnProperty.call(PERIODS, period) ? period : 'all';
    const selectedDate = isTradingDate(tradeDate) ? String(tradeDate) : '';
    const allFacts = db.listSetupEfficiencyFacts();
    const selectedFacts = selectedDate
      ? allFacts.filter(fact => fact.tradeDay === selectedDate)
      : allFacts.filter(fact => {
        const duration = PERIODS[selectedPeriod];
        return duration == null || Number(fact.closedAt) >= now() - duration;
      });
    const resultPeriod = selectedDate ? 'date' : selectedPeriod;
    const setups = selectedDate
      ? summarizeFacts(selectedFacts, resultPeriod)
      : db.listSetupEfficiencySummaries(selectedPeriod);
    const active = setups.filter(row => row.trades > 0);
    const reconciliation = db.loadSetupEfficiencyReconciliation() || {};
    const overall = summarizeSetup('ALL', resultPeriod, selectedFacts, { label:'All setups', side:'both' });
    return {
      ok:true,
      period:resultPeriod,
      date:selectedDate || null,
      generatedAt:now(),
      overall,
      setups,
      summary:{
        closedPositions:overall.trades,
        efficientSetups:active.filter(row => ['Strong', 'Efficient'].includes(row.grade)).length,
        profitableSetups:active.filter(row => Number(row.netPnl) > 0).length,
        bestSetup:active[0]?.label || '--',
        reviewSetups:active.filter(row => row.grade === 'Review').length,
      },
      reconciliation,
    };
  }

  function publish() {
    for (const listener of subscribers) {
      try { listener(); } catch (_) {}
    }
  }

  async function reconcile(reason = 'scheduled') {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(() => {
      const startedAt = now();
      const previous = db.loadSetupEfficiencyReconciliation() || {};
      db.saveSetupEfficiencyReconciliation({ ...previous, status:'running', lastStartedAt:startedAt, error:'' });
      let cursorUpdatedAt = Number(previous.cursorUpdatedAt) || 0;
      let cursorTradeId = String(previous.cursorTradeId || '');
      let rowsScanned = 0;
      const changedRoots = new Set();
      while (true) {
        const batch = db.listTradeRowsUpdatedAfter(cursorUpdatedAt, cursorTradeId, 5000);
        if (!batch.length) break;
        rowsScanned += batch.length;
        for (const row of batch) {
          changedRoots.add(String(row.trade.parentId || row.trade.id || row.id));
          cursorUpdatedAt = row.updatedAt;
          cursorTradeId = row.id;
        }
        if (batch.length < 5000) break;
      }

      let positionsUpdated = 0;
      const roots = [...changedRoots];
      for (let index = 0; index < roots.length; index += 300) {
        const chunk = roots.slice(index, index + 300);
        const rows = db.listSimulationTradesForRoots(chunk);
        const byRoot = new Map();
        for (const row of rows) {
          const rootId = String(row.trade.parentId || row.trade.id || row.id);
          if (!byRoot.has(rootId)) byRoot.set(rootId, []);
          byRoot.get(rootId).push(row);
        }
        for (const rootId of chunk) {
          const fact = buildPositionFact(rootId, byRoot.get(rootId) || []);
          if (fact) db.upsertSetupEfficiencyFact(fact);
          else db.deleteSetupEfficiencyFact(rootId);
          positionsUpdated += 1;
        }
      }

      if (rowsScanned > 0 || !db.listSetupEfficiencySummaries('all').length) {
        db.replaceSetupEfficiencySummaries(buildSummaries(db.listSetupEfficiencyFacts()));
      }
      const completed = db.saveSetupEfficiencyReconciliation({
        cursorUpdatedAt,
        cursorTradeId,
        lastStartedAt:startedAt,
        lastCompletedAt:now(),
        status:'idle',
        rowsScanned,
        positionsUpdated,
        error:'',
        reason,
      });
      publish();
      return { ok:true, reason, rowsScanned, positionsUpdated, reconciliation:completed };
    }).catch(error => {
      const message = error?.message || String(error);
      db.saveSetupEfficiencyReconciliation({
        status:'error',
        lastCompletedAt:now(),
        error:message,
      });
      publish();
      logger.warn?.('[setup-efficiency] Reconciliation failed:', message);
      return { ok:false, reason, error:message };
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    if (timer) return;
    setImmediate(() => {
      reconcile('startup').catch(() => {});
    });
    timer = setInterval(() => {
      reconcile('scheduled-hourly').catch(() => {});
    }, Math.max(HOUR_MS, Number(intervalMs) || HOUR_MS));
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  return { getPayload, reconcile, start, stop, subscribe };
}

module.exports = {
  HOUR_MS,
  PERIODS,
  buildPositionFact,
  createSetupEfficiencyService,
  isTradingDate,
  summarizeSetup,
};
