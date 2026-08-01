'use strict';

const { HOUR_MS, PERIODS, isTradingDate } = require('./setup-efficiency');

const EXIT_CATEGORIES = Object.freeze([
  'Target',
  'Stop',
  'Trailing',
  'Breakeven',
  'Momentum / Signal',
  'Time / No progress',
  'VWAP',
  'EOD',
  'Manual',
  'Other',
]);

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function asTime(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
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

function categorizeExit(reason, exitOwner = '') {
  const text = String(reason || '').toLowerCase();
  if (String(exitOwner || '').toLowerCase() === 'manual' || text.includes('manual')) return 'Manual';
  if (text.includes('partial target') || text.includes('target') || text.includes('milestone')) return 'Target';
  if (text.includes('breakeven')) return 'Breakeven';
  if (text.includes('trail') || text.includes('profit lock')) return 'Trailing';
  if (text.includes('vwap')) return 'VWAP';
  if (text.includes('no-progress') || text.includes('no progress') || text.includes('zero-progress') || text.includes('time stop')) return 'Time / No progress';
  if (text.includes('momentum') || text.includes('signal') || text.includes('negative candle') || text.includes('deterioration') || text.includes('fade')) return 'Momentum / Signal';
  if (text.includes('stop')) return 'Stop';
  if (text.includes('eod') || text.includes('square-off') || text.includes('square off')) return 'EOD';
  return 'Other';
}

function buildExitFact(row, dayCloseResolution = null) {
  const trade = row?.trade;
  if (!trade || String(trade.status || '').toLowerCase() !== 'closed') return null;
  const exitPrice = Number(trade.exitPrice);
  const entryPrice = Number(trade.entryPrice);
  const qty = Math.abs(Number(trade.qty) || 0);
  const closedAt = asTime(trade.closedAt || trade.openedAt);
  if (!(exitPrice > 0) || !(entryPrice > 0) || !qty || !closedAt) return null;
  const side = String(trade.side || trade.signal || 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
  const storedClose = Number(trade.exitState?.dayClosePrice || trade.dayClosePrice);
  const resolvedClose = Number(dayCloseResolution?.price ?? dayCloseResolution);
  const dayClosePrice = storedClose > 0 ? storedClose : (resolvedClose > 0 ? resolvedClose : null);
  const direction = side === 'sell' ? -1 : 1;
  const opportunityPerShare = dayClosePrice == null ? null : direction * (dayClosePrice - exitPrice);
  const opportunityPnl = opportunityPerShare == null ? null : opportunityPerShare * qty;
  const opportunityPct = opportunityPerShare == null ? null : opportunityPerShare / exitPrice * 100;
  const exposure = entryPrice * qty;
  const pnl = Number(trade.pnl) || 0;
  const charges = Number(trade.charges) || 0;
  const exitCategory = categorizeExit(trade.closeReason, trade.exitOwner);
  return {
    exitId:String(trade.id || row.id),
    positionId:String(trade.parentId || trade.id || row.id),
    setupType:String(trade.setupType || 'UNKNOWN').toUpperCase(),
    symbol:String(trade.symbol || ''),
    side,
    qty,
    entryPrice:round(entryPrice),
    exitPrice:round(exitPrice),
    closedAt,
    tradeDay:istDay(closedAt),
    sourceUpdatedAt:Number(row.updatedAt) || 0,
    closeReason:String(trade.closeReason || 'Other'),
    exitCategory,
    pnl:round(pnl),
    grossPnl:round(Number(trade.grossPnl) || 0),
    charges:round(charges),
    exposure:round(exposure),
    netPct:exposure > 0 ? round(pnl / exposure * 100, 4) : 0,
    dayClosePrice:dayClosePrice == null ? null : round(dayClosePrice),
    dayCloseSource:dayClosePrice == null ? '' : String(trade.exitState?.dayCloseSource || dayCloseResolution?.source || 'captured'),
    opportunityPnl:opportunityPnl == null ? null : round(opportunityPnl),
    opportunityPct:opportunityPct == null ? null : round(opportunityPct, 4),
    perfectExit:opportunityPct != null ? opportunityPct <= 0.1 : false,
    beatDayClose:opportunityPct != null ? opportunityPct <= 0 : false,
  };
}

function summarizeCategory(exitCategory, period, sourceFacts) {
  const facts = [...sourceFacts].sort((a, b) => Number(a.closedAt) - Number(b.closedAt));
  const benchmarked = facts.filter(fact => Number.isFinite(Number(fact.dayClosePrice)) && Number(fact.dayClosePrice) > 0);
  const wins = facts.filter(fact => Number(fact.pnl) > 0);
  const netPnl = facts.reduce((sum, fact) => sum + Number(fact.pnl || 0), 0);
  const grossPnl = facts.reduce((sum, fact) => sum + Number(fact.grossPnl || 0), 0);
  const charges = facts.reduce((sum, fact) => sum + Number(fact.charges || 0), 0);
  const avgNetPct = facts.length ? facts.reduce((sum, fact) => sum + Number(fact.netPct || 0), 0) / facts.length : 0;
  const avgOpportunityPct = benchmarked.length
    ? benchmarked.reduce((sum, fact) => sum + Number(fact.opportunityPct || 0), 0) / benchmarked.length
    : 0;
  const opportunityLoss = benchmarked.reduce((sum, fact) => sum + Math.max(0, Number(fact.opportunityPnl) || 0), 0);
  const valueProtected = benchmarked.reduce((sum, fact) => sum + Math.max(0, -(Number(fact.opportunityPnl) || 0)), 0);
  const perfectExitPct = benchmarked.length ? benchmarked.filter(fact => fact.perfectExit).length / benchmarked.length * 100 : 0;
  const beatClosePct = benchmarked.length ? benchmarked.filter(fact => fact.beatDayClose).length / benchmarked.length * 100 : 0;
  const costDragPct = Math.abs(grossPnl) > 0 ? charges / Math.abs(grossPnl) * 100 : (charges > 0 ? 100 : 0);
  const days = new Set(facts.map(fact => fact.tradeDay).filter(Boolean));
  const sampleConfidence = Math.min(1, Math.sqrt(facts.length / 30));
  const benchmarkConfidence = facts.length ? benchmarked.length / facts.length : 0;
  const confidence = sampleConfidence * benchmarkConfidence;
  const profitComponent = clamp(50 + avgNetPct * 70);
  const opportunityComponent = clamp(70 - avgOpportunityPct * 80);
  const perfectComponent = clamp(perfectExitPct);
  const costComponent = clamp(100 - costDragPct * 3);
  const rawScore = profitComponent * 0.35 + opportunityComponent * 0.35 + perfectComponent * 0.20 + costComponent * 0.10;
  const qualityScore = facts.length ? 50 + (rawScore - 50) * confidence : 0;
  const insufficient = facts.length < 12 || benchmarked.length < 5;
  const grade = insufficient ? 'Insufficient data'
    : qualityScore >= 75 ? 'Excellent'
      : qualityScore >= 60 ? 'Good'
        : qualityScore >= 45 ? 'Watch'
          : 'Poor';
  const recommendation = insufficient ? `Need ${Math.max(0, 12 - facts.length)} more exits and ${Math.max(0, 5 - benchmarked.length)} close benchmarks`
    : avgOpportunityPct > 0.5 ? 'Exits are leaving material day-close upside'
      : beatClosePct >= 60 ? 'Exit timing is protecting value'
        : netPnl < 0 ? 'Review this exit category and its triggers'
          : 'Maintain and monitor';
  return {
    exitCategory,
    period,
    exits:facts.length,
    positions:new Set(facts.map(fact => fact.positionId)).size,
    tradingDays:days.size,
    benchmarkedExits:benchmarked.length,
    benchmarkCoveragePct:facts.length ? round(benchmarked.length / facts.length * 100, 1) : 0,
    wins:wins.length,
    winRate:facts.length ? round(wins.length / facts.length * 100, 1) : 0,
    netPnl:round(netPnl),
    avgNetPct:round(avgNetPct, 3),
    charges:round(charges),
    costDragPct:round(costDragPct, 1),
    opportunityLoss:round(opportunityLoss),
    valueProtected:round(valueProtected),
    avgOpportunityPct:round(avgOpportunityPct, 3),
    perfectExitPct:round(perfectExitPct, 1),
    beatClosePct:round(beatClosePct, 1),
    confidencePct:round(confidence * 100, 1),
    qualityScore:round(qualityScore, 1),
    grade,
    recommendation,
    lastClosedAt:facts.at(-1)?.closedAt || 0,
  };
}

function createExitQualityService({ db, resolveDayClose, intervalMs = HOUR_MS, now = () => Date.now(), logger = console } = {}) {
  let timer = null;
  let inFlight = null;
  const subscribers = new Set();

  function summarizeFacts(facts, period) {
    const categories = new Set(EXIT_CATEGORIES);
    facts.forEach(fact => categories.add(fact.exitCategory));
    return [...categories]
      .map(category => summarizeCategory(category, period, facts.filter(fact => fact.exitCategory === category)))
      .sort((a, b) => Number(b.qualityScore) - Number(a.qualityScore) || a.exitCategory.localeCompare(b.exitCategory));
  }

  function buildSummaries(facts) {
    const computedAt = now();
    return Object.entries(PERIODS).flatMap(([period, duration]) => {
      const cutoff = duration == null ? 0 : computedAt - duration;
      return summarizeFacts(facts.filter(fact => Number(fact.closedAt) >= cutoff), period)
        .map(row => ({ ...row, computedAt }));
    });
  }

  function getPayload(period = 'all', tradeDate = '') {
    const selectedPeriod = Object.prototype.hasOwnProperty.call(PERIODS, period) ? period : 'all';
    const selectedDate = isTradingDate(tradeDate) ? String(tradeDate) : '';
    const allFacts = db.listExitQualityFacts();
    const facts = selectedDate
      ? allFacts.filter(fact => fact.tradeDay === selectedDate)
      : allFacts.filter(fact => {
        const duration = PERIODS[selectedPeriod];
        return duration == null || Number(fact.closedAt) >= now() - duration;
      });
    const resultPeriod = selectedDate ? 'date' : selectedPeriod;
    const categories = selectedDate ? summarizeFacts(facts, resultPeriod) : db.listExitQualitySummaries(selectedPeriod);
    const active = categories.filter(row => row.exits > 0);
    const overall = summarizeCategory('All exits', resultPeriod, facts);
    return {
      ok:true,
      period:resultPeriod,
      date:selectedDate || null,
      generatedAt:now(),
      overall,
      categories,
      summary:{
        exits:overall.exits,
        benchmarkCoveragePct:overall.benchmarkCoveragePct,
        opportunityLoss:overall.opportunityLoss,
        valueProtected:overall.valueProtected,
        perfectExitPct:overall.perfectExitPct,
        bestCategory:active[0]?.exitCategory || '--',
      },
      reconciliation:db.loadExitQualityReconciliation() || {},
    };
  }

  async function resolveFact(row) {
    const trade = row.trade;
    const day = istDay(asTime(trade.closedAt || trade.openedAt));
    let resolution = null;
    const existing = Number(trade.exitState?.dayClosePrice || trade.dayClosePrice);
    if (!(existing > 0) && resolveDayClose) {
      resolution = await resolveDayClose(String(trade.symbol || ''), day);
    }
    const fact = buildExitFact(row, resolution);
    let captured = false;
    const categoryChanged = fact && String(trade.exitState?.category || trade.exitCategory || '') !== fact.exitCategory;
    if (fact && (categoryChanged || (fact.dayClosePrice && !(existing > 0)))) {
      db.saveTrade({
        id:trade.id,
        exitState:{
          ...(trade.exitState || {}),
          exitPrice:Number(trade.exitPrice) || null,
          closedAt:trade.closedAt || null,
          reason:trade.closeReason || '',
          category:fact.exitCategory,
          dayClosePrice:fact.dayClosePrice || null,
          dayCloseSource:fact.dayCloseSource || '',
          dayCloseCapturedAt:fact.dayClosePrice ? new Date(now()).toISOString() : null,
          benchmarkStatus:fact.dayClosePrice ? 'resolved' : 'pending',
        },
      });
      captured = Boolean(fact.dayClosePrice && !(existing > 0));
    }
    return { fact, captured };
  }

  async function reconcile(reason = 'scheduled') {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const startedAt = now();
      const previous = db.loadExitQualityReconciliation() || {};
      db.saveExitQualityReconciliation({ ...previous, status:'running', lastStartedAt:startedAt, error:'' });
      let cursorUpdatedAt = Number(previous.cursorUpdatedAt) || 0;
      let cursorTradeId = String(previous.cursorTradeId || '');
      let rowsScanned = 0;
      let exitsUpdated = 0;
      let closePricesResolved = 0;
      const touched = new Set();
      while (true) {
        const batch = db.listTradeRowsUpdatedAfter(cursorUpdatedAt, cursorTradeId, 5000);
        if (!batch.length) break;
        rowsScanned += batch.length;
        for (let index = 0; index < batch.length; index += 1) {
          const row = batch[index];
          cursorUpdatedAt = row.updatedAt;
          cursorTradeId = row.id;
          touched.add(String(row.id));
          if (String(row.trade.status || '').toLowerCase() !== 'closed') {
            db.deleteExitQualityFact(row.id);
            continue;
          }
          const result = await resolveFact(row);
          if (result.fact) db.upsertExitQualityFact(result.fact);
          else db.deleteExitQualityFact(row.id);
          exitsUpdated += 1;
          if (result.captured) closePricesResolved += 1;
          await yieldToEventLoop();
        }
        if (batch.length < 5000) break;
      }

      const pending = db.listExitQualityFacts().filter(fact => !fact.dayClosePrice && !touched.has(String(fact.exitId)));
      for (let index = 0; index < pending.length; index += 1) {
        const fact = pending[index];
        const trade = db.getTrade(fact.exitId);
        if (!trade) continue;
        const result = await resolveFact({ id:fact.exitId, updatedAt:fact.sourceUpdatedAt, trade });
        if (result.fact) db.upsertExitQualityFact(result.fact);
        if (result.captured) {
          closePricesResolved += 1;
          exitsUpdated += 1;
        }
        await yieldToEventLoop();
      }

      if (exitsUpdated > 0 || !db.listExitQualitySummaries('all').length) {
        db.replaceExitQualitySummaries(buildSummaries(db.listExitQualityFacts()));
      }
      const completed = db.saveExitQualityReconciliation({
        cursorUpdatedAt,
        cursorTradeId,
        lastStartedAt:startedAt,
        lastCompletedAt:now(),
        status:'idle',
        rowsScanned,
        exitsUpdated,
        closePricesResolved,
        error:'',
      });
      subscribers.forEach(listener => {
        try { listener(); } catch (_) {}
      });
      return { ok:true, reason, rowsScanned, exitsUpdated, closePricesResolved, reconciliation:completed };
    })().catch(error => {
      const message = error?.message || String(error);
      db.saveExitQualityReconciliation({ status:'error', lastCompletedAt:now(), error:message });
      logger.warn?.('[exit-quality] Reconciliation failed:', message);
      return { ok:false, reason, error:message };
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    if (timer) return;
    setImmediate(() => reconcile('startup').catch(() => {}));
    timer = setInterval(() => reconcile('scheduled-hourly').catch(() => {}), Math.max(HOUR_MS, Number(intervalMs) || HOUR_MS));
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
  EXIT_CATEGORIES,
  buildExitFact,
  categorizeExit,
  createExitQualityService,
  summarizeCategory,
};
