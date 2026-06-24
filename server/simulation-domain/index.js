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

function toExitContext(context = {}, isEodSettlement) {
  if (typeof context.exitOptions === 'object' && context.exitOptions) {
    return context.exitOptions;
  }
  return { isEodSettlement: !!isEodSettlement };
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

function applyExitIntentsToOpenSymbols(openSymbols, exitIntents) {
  const next = new Set(openSymbols);
  for (const intent of Array.isArray(exitIntents) ? exitIntents : []) {
    if (String(intent?.action || '').toLowerCase() === 'partial') continue;
    if (intent?.symbol) next.delete(intent.symbol);
  }
  return next;
}

function runSimulationDomainCycle({ openTrades, candidates, at, settings, context = {}, isEodSettlement = false } = {}, deps = {}) {
  const exitIntents = manageExits({ openTrades, at, settings, context, isEodSettlement }, deps);
  const openSymbolsBeforeEntries = toOpenSymbols(openTrades, context);
  const openSymbolsForEntries = applyExitIntentsToOpenSymbols(openSymbolsBeforeEntries, exitIntents);
  const entryContext = { ...context, openSymbols: openSymbolsForEntries };
  const entryIntents = selectEntries({ candidates, at, settings, context: entryContext }, deps);
  return { exitIntents, entryIntents };
}

module.exports = {
  manageExits,
  selectEntries,
  runSimulationDomainCycle,
};
