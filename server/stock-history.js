'use strict';

function parseHistory(result) {
  const closes = result?.indicators?.quote?.[0]?.close || [];
  return (result?.timestamp || []).map((time, i) => ({ time: time * 1000, close: closes[i] }))
    .filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.time - b.time);
}

function createStockHistoryService({ fetchChart, now = Date.now }) {
  const cache = new Map();
  const pending = new Map();
  async function load(symbol) {
    if (!/^[A-Z0-9&_.-]{1,40}$/.test(symbol)) throw new Error('Invalid stock symbol');
    if (cache.has(symbol) && now() - cache.get(symbol).at < 15 * 60 * 1000) return cache.get(symbol).data;
    if (pending.has(symbol)) return pending.get(symbol);
    const job = (async () => {
      const result = await fetchChart(symbol);
      const prices = parseHistory(result);
      if (prices.length < 2) throw new Error('Daily price history is unavailable. Please retry.');
      const events = [];
      for (const event of Object.values(result.events?.dividends || {})) {
        events.push({ category: 'Actions', date: new Date(event.date * 1000).toISOString(), title: `Dividend: ${event.amount} ${result.meta?.currency || 'INR'} per share`, source: 'Yahoo Finance' });
      }
      for (const event of Object.values(result.events?.splits || {})) {
        events.push({ category: 'Actions', date: new Date(event.date * 1000).toISOString(), title: `Stock split: ${event.splitRatio}`, source: 'Yahoo Finance' });
      }
      const data = { symbol, prices, events, currency: result.meta?.currency || 'INR', source: 'Yahoo Finance · daily close (split-adjusted)' };
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(symbol, { at: now(), data });
      return data;
    })().finally(() => pending.delete(symbol));
    pending.set(symbol, job);
    return job;
  }
  return { load };
}

module.exports = { createStockHistoryService, parseHistory };
