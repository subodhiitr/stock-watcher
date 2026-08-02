const SimulationEngine = require('../../simulation_engine');

function toOpenSymbols(openTrades, context = {}) {
  const openSymbols = context.openSymbols instanceof Set
    ? new Set(context.openSymbols)
    : new Set(Array.isArray(context.openSymbols) ? context.openSymbols : []);
  for (const trade of Array.isArray(openTrades) ? openTrades : []) {
    if (trade?.symbol) openSymbols.add(trade.symbol);
  }
  return openSymbols;
}

function toOpenPositionCounts(openTrades, context = {}) {
  const counts = context.openPositionCounts instanceof Map
    ? new Map(context.openPositionCounts)
    : new Map();
  for (const trade of Array.isArray(openTrades) ? openTrades : []) {
    if (trade?.symbol) {
      counts.set(trade.symbol, (counts.get(trade.symbol) || 0) + 1);
    }
  }
  return counts;
}

function toOpenSideCounts(openTrades, context = {}) {
  const counts = context.openSideCounts instanceof Map ? new Map(context.openSideCounts) : new Map();
  for (const trade of Array.isArray(openTrades) ? openTrades : []) {
    const side = String(trade?.side || '').toLowerCase();
    if (side) counts.set(side, (counts.get(side) || 0) + 1);
  }
  return counts;
}

function toExitContext(context = {}, isEodSettlement) {
  return {
    ...(typeof context.exitOptions === 'object' && context.exitOptions ? context.exitOptions : {}),
    isEodSettlement: !!isEodSettlement,
    market:context.market || context.exitOptions?.market || {},
    indices:context.indices || context.exitOptions?.indices || context.market?.indices || {},
  };
}

function manageExits({ openTrades, at, settings, context = {}, isEodSettlement = false } = {}, deps = {}) {
  const engine = deps.engine || SimulationEngine;
  const candidateBySymbol = context.candidateBySymbol instanceof Map ? context.candidateBySymbol : new Map();
  const lastKnownBySymbol = context.lastKnownBySymbol instanceof Map ? context.lastKnownBySymbol : new Map();
  const exitOptions = toExitContext(context, isEodSettlement);
  const intents = [];

  for (const trade of Array.isArray(openTrades) ? openTrades : []) {
    const candidate = candidateBySymbol.get(trade.symbol) || lastKnownBySymbol.get(trade.symbol) || null;
    const intent = engine.getSimulationExitIntent(trade, candidate, at, settings, exitOptions);
    if (intent) intents.push(intent);
  }

  return intents;
}

function selectEntries({ candidates, at, settings, context = {} } = {}, deps = {}) {
  const engine = deps.engine || SimulationEngine;
  return engine.getSimulationEntryIntents(Array.isArray(candidates) ? candidates : [], at, settings, context) || [];
}

function selectScaleIns({ openTrades, at, settings, context = {}, exitIntents = [] } = {}, deps = {}) {
  const engine = deps.engine || SimulationEngine;
  if (typeof engine.getMomentumRunnerScaleInIntent !== 'function') return [];
  const candidateBySymbol = context.candidateBySymbol instanceof Map ? context.candidateBySymbol : new Map();
  const exitingSymbols = new Set((Array.isArray(exitIntents) ? exitIntents : []).map(intent => intent?.symbol).filter(Boolean));
  let cashAvailable = Number(context.cashAvailable);
  const portfolioEquity = Number(context.portfolioEquity);
  const openExposure = Math.max(0, Number(context.openExposure) || 0);
  const maxGrossExposurePct = Math.max(0, Number(settings?.SIMULATION_MAX_GROSS_EXPOSURE_PCT) || 80);
  let remainingGrossCapacity = Number.isFinite(portfolioEquity) && portfolioEquity > 0
    ? Math.max(0, portfolioEquity * maxGrossExposurePct / 100 - openExposure)
    : null;
  let remainingHeatRisk = Number(context.remainingHeatRisk);
  const sectorHeatRemaining = context.sectorHeatRemaining && typeof context.sectorHeatRemaining === 'object'
    ? { ...context.sectorHeatRemaining }
    : null;
  const intents = [];

  for (const trade of Array.isArray(openTrades) ? openTrades : []) {
    if (exitingSymbols.has(trade?.symbol)) continue;
    const candidate = candidateBySymbol.get(trade?.symbol) || null;
    const sector = String(trade?.sector || candidate?.sector || 'UNKNOWN');
    const intent = engine.getMomentumRunnerScaleInIntent(trade, candidate, candidate?.price ?? candidate?.priceAtSnapshot, settings, {
      cashAvailable,
      remainingGrossCapacity,
      remainingHeatRisk,
      sectorHeatRemaining:sectorHeatRemaining ? sectorHeatRemaining[sector] : null,
    });
    if (!intent) continue;
    intents.push(intent);
    const exposure = Number(intent.price) * Number(intent.qty);
    const riskPerShare = Math.abs(Number(trade.entryPrice) - Number(trade.stop));
    if (Number.isFinite(cashAvailable)) cashAvailable = Math.max(0, cashAvailable - exposure);
    if (remainingGrossCapacity != null) remainingGrossCapacity = Math.max(0, remainingGrossCapacity - exposure);
    if (Number.isFinite(remainingHeatRisk) && riskPerShare > 0) {
      remainingHeatRisk = Math.max(0, remainingHeatRisk - riskPerShare * Number(intent.qty));
    }
    if (sectorHeatRemaining && Number.isFinite(Number(sectorHeatRemaining[sector])) && riskPerShare > 0) {
      sectorHeatRemaining[sector] = Math.max(0, Number(sectorHeatRemaining[sector]) - riskPerShare * Number(intent.qty));
    }
  }
  return intents;
}

function applyExitIntentsToOpenSymbols(openSymbols, exitIntents) {
  const next = new Set(openSymbols);
  for (const intent of Array.isArray(exitIntents) ? exitIntents : []) {
    if (String(intent?.action || '').toLowerCase() === 'partial') continue;
    if (intent?.symbol) next.delete(intent.symbol);
  }
  return next;
}

function applyExitIntentsToOpenPositionCounts(openPositionCounts, exitIntents) {
  const next = new Map(openPositionCounts);
  for (const intent of Array.isArray(exitIntents) ? exitIntents : []) {
    if (String(intent?.action || '').toLowerCase() === 'partial') continue;
    if (intent?.symbol) {
      const count = (next.get(intent.symbol) || 1) - 1;
      if (count > 0) {
        next.set(intent.symbol, count);
      } else {
        next.delete(intent.symbol);
      }
    }
  }
  return next;
}

function applyExitIntentsToOpenSideCounts(openSideCounts, exitIntents) {
  const next = new Map(openSideCounts);
  for (const intent of Array.isArray(exitIntents) ? exitIntents : []) {
    if (String(intent?.action || '').toLowerCase() === 'partial') continue;
    const side = String(intent?.trade?.side || intent?.side || '').toLowerCase();
    if (!side) continue;
    const count = (next.get(side) || 1) - 1;
    if (count > 0) next.set(side, count);
    else next.delete(side);
  }
  return next;
}

function runSimulationDomainCycle({ openTrades, candidates, at, settings, context = {}, isEodSettlement = false } = {}, deps = {}) {
  const exitIntents = manageExits({ openTrades, at, settings, context, isEodSettlement }, deps);
  const scaleInIntents = isEodSettlement
    ? []
    : selectScaleIns({ openTrades, at, settings, context, exitIntents }, deps);
  const scaleInExposure = scaleInIntents.reduce((sum, intent) => sum + Number(intent?.price || 0) * Number(intent?.qty || 0), 0);
  const scaleInRisk = scaleInIntents.reduce((sum, intent) => {
    const riskPerShare = Math.abs(Number(intent?.trade?.entryPrice) - Number(intent?.trade?.stop));
    return sum + (Number.isFinite(riskPerShare) ? riskPerShare * Number(intent?.qty || 0) : 0);
  }, 0);
  const sectorHeatRemainingForEntries = context.sectorHeatRemaining && typeof context.sectorHeatRemaining === 'object'
    ? { ...context.sectorHeatRemaining }
    : context.sectorHeatRemaining;
  if (sectorHeatRemainingForEntries && typeof sectorHeatRemainingForEntries === 'object') {
    for (const intent of scaleInIntents) {
      const sector = String(intent?.trade?.sector || intent?.candidate?.sector || 'UNKNOWN');
      const riskPerShare = Math.abs(Number(intent?.trade?.entryPrice) - Number(intent?.trade?.stop));
      if (Number.isFinite(Number(sectorHeatRemainingForEntries[sector])) && Number.isFinite(riskPerShare)) {
        sectorHeatRemainingForEntries[sector] = Math.max(
          0,
          Number(sectorHeatRemainingForEntries[sector]) - riskPerShare * Number(intent?.qty || 0)
        );
      }
    }
  }
  const openSymbolsBeforeEntries = toOpenSymbols(openTrades, context);
  const openPositionCountsBeforeEntries = toOpenPositionCounts(openTrades, context);
  const openSideCountsBeforeEntries = toOpenSideCounts(openTrades, context);
  const openSymbolsForEntries = applyExitIntentsToOpenSymbols(openSymbolsBeforeEntries, exitIntents);
  const openPositionCountsForEntries = applyExitIntentsToOpenPositionCounts(openPositionCountsBeforeEntries, exitIntents);
  const openSideCountsForEntries = applyExitIntentsToOpenSideCounts(openSideCountsBeforeEntries, exitIntents);
  const entryContext = { 
    ...context, 
    cashAvailable:Number.isFinite(Number(context.cashAvailable))
      ? Math.max(0, Number(context.cashAvailable) - scaleInExposure)
      : context.cashAvailable,
    openExposure:Math.max(0, Number(context.openExposure) || 0) + scaleInExposure,
    remainingHeatRisk:Number.isFinite(Number(context.remainingHeatRisk))
      ? Math.max(0, Number(context.remainingHeatRisk) - scaleInRisk)
      : context.remainingHeatRisk,
    sectorHeatRemaining:sectorHeatRemainingForEntries,
    openSymbols: openSymbolsForEntries,
    openPositionCounts: openPositionCountsForEntries,
    openSideCounts: openSideCountsForEntries,
  };
  const selectedEntryIntents = selectEntries({ candidates, at, settings, context: entryContext }, deps);
  const perCycleLimit = Math.max(0, Math.floor(Number(settings?.SIMULATION_MAX_NEW_PER_CYCLE) || 0));
  const entryIntents = perCycleLimit > 0
    ? (Array.isArray(selectedEntryIntents) ? selectedEntryIntents.slice(0, perCycleLimit) : [])
    : (Array.isArray(selectedEntryIntents) ? selectedEntryIntents : []);
  return { exitIntents, scaleInIntents, entryIntents };
}

module.exports = {
  manageExits,
  selectScaleIns,
  selectEntries,
  runSimulationDomainCycle,
  toOpenSymbols,
  toOpenPositionCounts,
  toOpenSideCounts,
  applyExitIntentsToOpenSymbols,
  applyExitIntentsToOpenPositionCounts,
  applyExitIntentsToOpenSideCounts,
};
