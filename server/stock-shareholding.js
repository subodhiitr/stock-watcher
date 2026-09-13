'use strict';

const ORIGIN = 'https://trendlyne.com';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function decode(value) {
  return String(value).replace(/&quot;|&#34;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');
}
function percent(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/%$/, '').trim());
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}
function periodTime(label) {
  const match = /^(Mar|Jun|Sep|Dec) (\d{4})$/.exec(label);
  return match ? Date.UTC(Number(match[2]), MONTHS.indexOf(match[1]) + 1, 0) : null;
}
function parseShareholding(html) {
  const rows = new Map();
  const getRow = period => {
    if (!rows.has(period)) rows.set(period, { period, endDate: periodTime(period), promoter: null, pledge: null, fii: null, mf: null });
    return rows.get(period);
  };
  for (const [attribute, field] of [['promoter', 'promoter'], ['fii', 'fii'], ['mf', 'mf']]) {
    const match = new RegExp(`data-${attribute}BarChart=["']([^"']*)["']`, 'i').exec(html);
    if (!match) continue;
    let chart;
    try { chart = JSON.parse(decode(match[1])); } catch { continue; }
    if (!Array.isArray(chart) || !Array.isArray(chart[0])) continue;
    const pledgeIndex = chart[0].findIndex(value => typeof value === 'string' && /pledges as % of promoter shares/i.test(value));
    for (const entry of chart.slice(1)) {
      if (!Array.isArray(entry) || periodTime(entry[0]) == null) continue;
      const row = getRow(entry[0]);
      row[field] = percent(entry[1]);
      if (field === 'promoter' && pledgeIndex >= 0) row.pledge = percent(entry[pledgeIndex]);
    }
  }
  // This provider's promoter summary subgroup also reports pledge / promoter shares.
  // Join by the table's own dates, never by chart position (off-quarter filings exist).
  const table = /<table\b[^>]*id=["']shareSummaryTable["'][^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] || '';
  const periods = [...(table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(match => match[1].replace(/<[^>]+>/g, '').trim()).slice(1);
  for (const match of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    if (!/Promoter-holding/.test(match[1])) continue;
    const cells = [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replace(/<[^>]+>/g, '').trim());
    if (cells[0] !== 'Pledged') continue;
    periods.forEach((period, index) => { if (rows.has(period) && rows.get(period).pledge == null) rows.get(period).pledge = percent(cells[index + 1]); });
  }
  return [...rows.values()].filter(row => [row.promoter, row.fii, row.mf].some(value => value != null)).sort((a, b) => a.endDate - b.endDate).slice(-5);
}

function createShareholdingService({ fetchImpl = global.fetch, now = Date.now, cacheTtlMs = 86400000, minRequestGapMs = 300 } = {}) {
  const cache = new Map(), pending = new Map();
  let queue = Promise.resolve(), lastStart = 0;
  async function request(url) {
    const reservation = queue.then(async () => {
      const wait = Math.max(0, minRequestGapMs - (now() - lastStart));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastStart = now();
    });
    queue = reservation.catch(() => {});
    await reservation;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockWatcher/1.0)', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json,text/html' } });
    if (!response.ok) throw new Error(`Shareholding provider HTTP ${response.status}`);
    return response.text();
  }
  async function load(symbol) {
    symbol = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9&_.-]{1,40}$/.test(symbol)) throw new Error('Invalid stock symbol');
    const cached = cache.get(symbol);
    if (cached && now() - cached.at < cacheTtlMs) return cached.data;
    if (pending.has(symbol)) return pending.get(symbol);
    const job = (async () => {
      const results = JSON.parse(await request(`${ORIGIN}/member/api/ac_snames/stock/?term=${encodeURIComponent(symbol)}`));
      const stock = Array.isArray(results) ? results.find(item => item.country === 'IND' && item.NSEcode === symbol) : null;
      const sourceUrl = stock?.urls?.find(item => item[0] === 'Share Holding')?.[1];
      if (!sourceUrl || new URL(sourceUrl).origin !== ORIGIN || !new URL(sourceUrl).pathname.startsWith('/equity/share-holding/')) throw new Error('Shareholding history is unavailable for this stock.');
      const quarters = parseShareholding(await request(sourceUrl));
      if (!quarters.length) throw new Error('No quarterly shareholding history reported by the provider.');
      const data = { symbol, quarters, source: 'Trendlyne', sourceUrl, fetchedAt: new Date(now()).toISOString() };
      if (cache.size >= 250) cache.delete(cache.keys().next().value);
      cache.set(symbol, { at: now(), data });
      return data;
    })().finally(() => pending.delete(symbol));
    pending.set(symbol, job);
    return job;
  }
  return { load };
}
module.exports = { parseShareholding, createShareholdingService };
