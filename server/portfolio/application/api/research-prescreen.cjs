'use strict';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentileBySymbol(rows, valueOf, descending = false) {
  const observed = rows
    .map(row => ({ symbol: row.symbol, value: finite(valueOf(row)) }))
    .filter(row => row.value !== null)
    .sort((left, right) => descending ? right.value - left.value : left.value - right.value);
  const output = new Map();
  if (observed.length === 1) output.set(observed[0].symbol, 1);
  else observed.forEach((row, index) => output.set(row.symbol, index / Math.max(1, observed.length - 1)));
  return output;
}

function percentile(map, symbol) {
  return map.get(symbol) ?? 0.5;
}

function rankResearchUniverse(input) {
  const rows = input.symbols.map(symbol => {
    const quote = input.quotes[symbol] || {};
    const history = input.histories[symbol] || {};
    const high52 = finite(quote.high52);
    const low52 = finite(quote.low52);
    const price = finite(quote.price) ?? finite(history.price);
    const rangePosition = high52 !== null && low52 !== null && price !== null && high52 > low52
      ? Math.max(0, Math.min(1, (price - low52) / (high52 - low52)))
      : null;
    const currentTradedValueLakh = price !== null && finite(quote.volume) !== null
      ? Math.max(0, price * finite(quote.volume) / 100000)
      : null;
    return {
      symbol,
      sector: String(input.sectors?.[symbol] || '').trim() || null,
      rangePosition,
      m3m1: finite(history.m3m1),
      m6m1: finite(history.m6m1),
      trend: finite(history.trend),
      liquidity: finite(history.median20dTradedValueLakh) ?? currentTradedValueLakh,
      volatility: finite(history.volatility60d),
      drawdown: finite(history.maxDrawdown),
    };
  });
  const percentiles = {
    range: percentileBySymbol(rows, row => row.rangePosition),
    m3m1: percentileBySymbol(rows, row => row.m3m1),
    m6m1: percentileBySymbol(rows, row => row.m6m1),
    trend: percentileBySymbol(rows, row => row.trend),
    liquidity: percentileBySymbol(rows, row => row.liquidity),
    volatility: percentileBySymbol(rows, row => row.volatility, true),
    drawdown: percentileBySymbol(rows, row => row.drawdown, true),
  };
  return rows.map(row => {
    const momentumScore = (
      percentile(percentiles.range, row.symbol) * 0.15
      + percentile(percentiles.m3m1, row.symbol) * 0.25
      + percentile(percentiles.m6m1, row.symbol) * 0.40
      + percentile(percentiles.trend, row.symbol) * 0.20
    );
    const liquidityScore = percentile(percentiles.liquidity, row.symbol);
    const lowRiskScore = (
      percentile(percentiles.volatility, row.symbol) * 0.55
      + percentile(percentiles.drawdown, row.symbol) * 0.45
    );
    return {
      ...row,
      momentumScore,
      liquidityScore,
      lowRiskScore,
      score: momentumScore * 0.55 + liquidityScore * 0.30 + lowRiskScore * 0.15,
    };
  }).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
}

function selectDetailedResearchPool(input) {
  const ranked = rankResearchUniverse(input);
  const target = Math.min(input.maxPool, Math.max(input.minimumPool, input.targetHoldings * 8));
  const selected = new Set();
  const add = row => {
    if (row && selected.size < target) selected.add(row.symbol);
  };
  ranked.slice(0, Math.ceil(target * 0.55)).forEach(add);
  [...ranked].sort((left, right) => right.momentumScore - left.momentumScore).slice(0, Math.ceil(target * 0.25)).forEach(add);
  [...ranked].sort((left, right) => right.liquidityScore - left.liquidityScore).slice(0, Math.ceil(target * 0.10)).forEach(add);
  const sectorCounts = new Map();
  for (const row of ranked) {
    if (!row.sector || (sectorCounts.get(row.sector) || 0) >= 3) continue;
    add(row);
    sectorCounts.set(row.sector, (sectorCounts.get(row.sector) || 0) + 1);
  }
  ranked.forEach(add);
  for (const symbol of input.includeSymbols || []) selected.add(String(symbol).trim().toUpperCase());
  return { ranked, symbols: [...selected], target };
}

module.exports = { rankResearchUniverse, selectDetailedResearchPool };
