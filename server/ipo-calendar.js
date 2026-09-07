'use strict';

const DAY = 86400000;
function isoDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const dateOnly = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  if (dateOnly) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(dateOnly[2].toLowerCase());
    if (month < 0) return null;
    const date = new Date(Date.UTC(Number(dateOnly[3]), month, Number(dateOnly[1])));
    return date.getUTCMonth() === month && date.getUTCDate() === Number(dateOnly[1]) ? date.toISOString().slice(0, 10) : null;
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
function parseListedStocks(csv, now = Date.now()) {
  const lines = String(csv).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cells = line => (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || []).filter(Boolean).map(v => v.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  const headers = cells(lines.shift() || '').map(v => v.toUpperCase());
  const index = name => headers.indexOf(name);
  if (index('SYMBOL') < 0 || index('DATE OF LISTING') < 0) throw new Error('Invalid NSE listing feed');
  return lines.map(line => {
    const row = cells(line);
    return { sym: row[index('SYMBOL')], name: row[index('NAME OF COMPANY')], series: row[index('SERIES')], listingDate: isoDate(row[index('DATE OF LISTING')]) };
  }).filter(row => /^[A-Z0-9&-]+$/.test(row.sym) && row.series === 'EQ' && row.listingDate && now - Date.parse(row.listingDate) >= 0 && now - Date.parse(row.listingDate) < 90 * DAY);
}
function parseUpcoming(payload, now = Date.now()) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('Invalid NSE IPO calendar');
  const today = new Date(now + 19800000).toISOString().slice(0, 10);
  return rows.map(row => ({
    sym: String(row.symbol || '').trim().toUpperCase(),
    name: String(row.companyName || row.company || row.name || row.symbol || ''),
    openDate: isoDate(row.issueStartDate || row.issueOpenDate),
    closeDate: isoDate(row.issueEndDate || row.issueCloseDate),
    listingDate: isoDate(row.listingDate),
    price: String(row.issuePrice || row.priceBand || ''),
  })).filter(row => row.name && ((row.listingDate && row.listingDate > today) || (row.closeDate && row.closeDate >= today)));
}
function createIpoCalendarService(deps) {
  let cached = { listed: [], upcoming: [], updatedAt: 0 };
  let loaded = false;
  let inFlight;
  let attemptedAt = 0;
  async function refresh() {
    if (!loaded) {
      cached = deps.readCache?.() || cached;
      loaded = true;
    }
    if (inFlight) return inFlight;
    if (Date.now() - attemptedAt < 15 * 60000 || (cached.version === 2 && Date.now() - cached.updatedAt < 6 * 3600000)) return cached;
    attemptedAt = Date.now();
    inFlight = (async () => {
      const results = await Promise.allSettled([deps.fetchListings(), deps.fetchUpcoming()]);
      const errors = [];
      const next = { ...cached };
      for (const [i, key] of ['listed', 'upcoming'].entries()) {
        try {
          if (results[i].status === 'rejected') throw results[i].reason;
          next[key] = i === 0 ? parseListedStocks(results[i].value) : parseUpcoming(results[i].value);
        } catch (error) { errors.push(`${key}: ${error.message}`); }
      }
      const existing = new Set(deps.getStocks().map(row => String(row.sym || row.symbol).toUpperCase()));
      const added = next.listed.filter(row => !existing.has(row.sym));
      if (added.length) deps.addStocks(added.map(row => ({ ...row, sector: 'Custom', cap: 'custom' })));
      next.error = errors.join('; ') || null;
      next.updatedAt = errors.length ? cached.updatedAt : Date.now();
      next.version = errors.length ? cached.version : 2;
      cached = next;
      deps.writeCache?.(cached);
      return cached;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return { refresh, snapshot: () => cached };
}
module.exports = { createIpoCalendarService, parseListedStocks, parseUpcoming };
