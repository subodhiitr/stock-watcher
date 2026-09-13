'use strict';

const { cleanHtmlText } = require('./screener-news');

const SCREENER_BASE_URL = 'https://www.screener.in';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_REQUEST_GAP_MS = 300;
const DEFAULT_TIMEOUT_MS = 10000;

function normalizedLabel(value) {
  return cleanHtmlText(value).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function croreNumber(value) {
  const text = cleanHtmlText(value).replace(/,/g, '').trim();
  if (!text || text === '--' || text === '-') return null;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()%]/g, '').trim());
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

function parseScreenerQuarterlyFinancials(html) {
  const source = String(html || '');
  const marker = source.search(/<section\b[^>]*id=["']quarters["'][^>]*>/i);
  if (marker < 0) return [];
  const sectionEnd = source.indexOf('</section>', marker);
  const section = source.slice(marker, sectionEnd >= 0 ? sectionEnd + 10 : source.length);
  const tableStart = section.search(/<table\b/i);
  const tableEnd = section.indexOf('</table>', tableStart);
  if (tableStart < 0 || tableEnd < 0) return [];
  const table = section.slice(tableStart, tableEnd + 8);

  const periods = [];
  const headerPattern = /<th\b[^>]*data-date-key=["'](\d{4}-\d{2}-\d{2})["'][^>]*>([\s\S]*?)<\/th>/gi;
  let headerMatch;
  while ((headerMatch = headerPattern.exec(table))) {
    const endDate = Math.floor(Date.parse(`${headerMatch[1]}T00:00:00.000Z`) / 1000);
    periods.push({ dateKey:headerMatch[1], endDate, period:cleanHtmlText(headerMatch[2]) || headerMatch[1] });
  }
  if (!periods.length) return [];

  const valuesByLabel = new Map();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(table))) {
    const cells = [];
    const cellPattern = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) cells.push(cellMatch[1]);
    if (cells.length < 2) continue;
    const label = normalizedLabel(cells[0]);
    if (label) valuesByLabel.set(label, cells.slice(1).map(croreNumber));
  }

  const findValues = (...labels) => {
    for (const label of labels) {
      const exact = valuesByLabel.get(label);
      if (exact) return exact;
    }
    return [];
  };
  const revenue = findValues('sales', 'revenue', 'total income');
  const ebitda = findValues('operating profit', 'ebitda');
  const netProfit = findValues('net profit', 'profit after tax');

  return periods.map((period, index) => ({
    period:period.period,
    endDate:period.endDate,
    revenueCr:revenue[index] ?? null,
    ebitdaCr:ebitda[index] ?? null,
    netProfitCr:netProfit[index] ?? null,
  }))
    .filter(row => row.revenueCr != null || row.ebitdaCr != null || row.netProfitCr != null)
    .sort((a, b) => b.endDate - a.endDate)
    .slice(0, 3);
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function createScreenerQuarterlyFinancialsProvider(deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const now = deps.now || (() => Date.now());
  const cacheTtlMs = Math.max(0, Number(deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const minRequestGapMs = Math.max(0, Number(deps.minRequestGapMs ?? DEFAULT_MIN_REQUEST_GAP_MS));
  const timeoutMs = Math.max(1000, Number(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const cache = new Map();
  let startQueue = Promise.resolve();
  let lastRequestAt = 0;

  function reserveRequestStart() {
    const reservation = startQueue.then(async () => {
      const waitMs = Math.max(0, minRequestGapMs - (now() - lastRequestAt));
      await delay(waitMs);
      lastRequestAt = now();
    });
    startQueue = reservation.then(() => undefined, () => undefined);
    return reservation;
  }

  async function fetchPage(url) {
    await reserveRequestStart();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal:controller.signal,
        headers:{
          accept:'text/html,application/xhtml+xml',
          'user-agent':'Mozilla/5.0 (compatible; StockWatcher/1.0; local-personal-use)',
        },
      });
      if (!response.ok) throw new Error(`Screener HTTP ${response.status}`);
      return response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchUncached(symbol) {
    let lastError = null;
    for (const suffix of ['consolidated/', '']) {
      const url = `${SCREENER_BASE_URL}/company/${encodeURIComponent(symbol)}/${suffix}`;
      try {
        const quarters = parseScreenerQuarterlyFinancials(await fetchPage(url));
        if (quarters.length) return { quarters, source:'Screener.in', url };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return { quarters:[], source:'Screener.in', url:'' };
  }

  async function fetchStockQuarterlyFinancials(stockOrSymbol) {
    const symbol = String(typeof stockOrSymbol === 'string' ? stockOrSymbol : stockOrSymbol?.symbol || stockOrSymbol?.sym || '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9&.-]{1,32}$/.test(symbol)) throw new Error('Invalid Screener symbol');
    const cached = cache.get(symbol);
    if (cached && now() - cached.savedAt < cacheTtlMs) return { ...cached.data, quarters:cached.data.quarters.map(row => ({ ...row })) };
    const pending = cached?.pending || fetchUncached(symbol);
    cache.set(symbol, { savedAt:0, data:{ quarters:[], source:'Screener.in', url:'' }, pending });
    try {
      const data = await pending;
      cache.set(symbol, { savedAt:now(), data });
      return { ...data, quarters:data.quarters.map(row => ({ ...row })) };
    } catch (error) {
      cache.delete(symbol);
      throw error;
    }
  }

  return { fetchStockQuarterlyFinancials };
}

module.exports = {
  croreNumber,
  parseScreenerQuarterlyFinancials,
  createScreenerQuarterlyFinancialsProvider,
};
