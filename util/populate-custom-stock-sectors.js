#!/usr/bin/env node
'use strict';

const https = require('https');
const zlib = require('zlib');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'stock-watcher.db');
const NSE_INDEX_SOURCES = [
  { file: 'ind_nifty50list.csv', cap: 'large' },
  { file: 'ind_niftynext50list.csv', cap: 'large' },
  { file: 'ind_nifty100list.csv', cap: 'large' },
  { file: 'ind_niftymidcap150list.csv', cap: 'mid' },
  { file: 'ind_niftysmallcap250list.csv', cap: 'small' },
  { file: 'ind_niftymicrocap250_list.csv', cap: 'small' },
  { file: 'ind_nifty500list.csv', cap: null },
  { file: 'ind_niftytotalmarket_list.csv', cap: null },
  { file: 'ind_niftylargemidcap250list.csv', cap: null },
];
const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.nseindia.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'keep-alive',
};

function httpsGet(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip' ? res.pipe(zlib.createGunzip()) :
        enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      stream.on('error', reject);
    });
    req.setTimeout(opts.timeout || 15000);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

async function httpsText(url) {
  const parsed = new URL(url);
  const res = await httpsGet({
    hostname: parsed.hostname,
    path: `${parsed.pathname}${parsed.search}`,
    method: 'GET',
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'Accept': 'text/csv,text/plain,*/*',
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  if (res.status !== 200) throw new Error(`${url} HTTP ${res.status}`);
  return res.body;
}

function harvestCookies(store, res) {
  const raw = res.headers['set-cookie'];
  if (!raw || !raw.length) return store;
  const map = Object.fromEntries(
    String(store || '').split('; ').filter(Boolean).map(pair => {
      const i = pair.indexOf('=');
      return i > -1 ? [pair.slice(0, i).trim(), pair.slice(i + 1).trim()] : [pair.trim(), ''];
    })
  );
  for (const cookie of raw) {
    const pair = cookie.split(';')[0];
    const i = pair.indexOf('=');
    if (i > -1) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return Object.entries(map).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function createNseFetcher() {
  let cookies = '';
  for (const warmPath of ['/', '/market-data/live-equity-market-data']) {
    const res = await httpsGet({
      hostname: 'www.nseindia.com',
      path: warmPath,
      method: 'GET',
      timeout: 15000,
      headers: { ...NSE_HEADERS, ...(cookies ? { Cookie: cookies } : {}) },
    });
    cookies = harvestCookies(cookies, res);
    if (res.status >= 200 && res.status < 400 && cookies) break;
  }
  return async function fetchNseQuote(symbol) {
    const quotePagePath = `/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;
    const apiPath = `/api/quote-equity?symbol=${encodeURIComponent(symbol)}`;
    const headers = { ...NSE_HEADERS, Referer: `https://www.nseindia.com${quotePagePath}` };
    const quotePage = await httpsGet({
      hostname: 'www.nseindia.com',
      path: quotePagePath,
      method: 'GET',
      timeout: 15000,
      headers: { ...headers, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...(cookies ? { Cookie: cookies } : {}) },
    });
    cookies = harvestCookies(cookies, quotePage);
    const res = await httpsGet({
      hostname: 'www.nseindia.com',
      path: apiPath,
      method: 'GET',
      timeout: 15000,
      headers: { ...headers, ...(cookies ? { Cookie: cookies } : {}) },
    });
    cookies = harvestCookies(cookies, res);
    if (res.status !== 200) throw new Error(`NSE quote ${symbol} HTTP ${res.status}`);
    const text = String(res.body || '').trim();
    if (text.startsWith('<')) throw new Error(`NSE quote ${symbol} returned HTML`);
    return JSON.parse(text || '{}');
  };
}

function cleanText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text && !/^[-–—]|n\.?a\.?$/i.test(text) ? text : '';
}

function extractNseSector(payload) {
  const info = payload && typeof payload === 'object' ? payload : {};
  return cleanText(info.industryInfo?.sector)
    || cleanText(info.industryInfo?.industry)
    || cleanText(info.industryInfo?.macro)
    || cleanText(info.info?.sector)
    || cleanText(info.info?.industry)
    || cleanText(info.metadata?.sector)
    || cleanText(info.metadata?.industry);
}

function extractNseCompanyName(payload) {
  const info = payload && typeof payload === 'object' ? payload : {};
  return cleanText(info.info?.companyName)
    || cleanText(info.info?.companyNameLong)
    || cleanText(info.metadata?.companyName)
    || cleanText(info.metadata?.name);
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(cleanText);
}

function parseNseIndexSectorCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(cell => cell.toLowerCase());
  const companyIdx = header.indexOf('company name');
  const industryIdx = header.indexOf('industry');
  const symbolIdx = header.indexOf('symbol');
  if (companyIdx < 0 || industryIdx < 0 || symbolIdx < 0) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const symbol = cleanText(cells[symbolIdx]).toUpperCase();
    const sector = cleanText(cells[industryIdx]);
    if (!symbol || !sector) continue;
    rows.push({
      symbol,
      name: cleanText(cells[companyIdx]) || null,
      sector,
    });
  }
  return rows;
}

function parseNseIndexCapCsv(csv, cap) {
  const bucket = cleanText(cap).toLowerCase();
  if (!['large', 'mid', 'small'].includes(bucket)) return [];
  const lines = String(csv || '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(cell => cell.toLowerCase());
  const symbolIdx = header.indexOf('symbol');
  if (symbolIdx < 0) return [];
  return lines.slice(1)
    .map(line => cleanText(parseCsvLine(line)[symbolIdx]).toUpperCase())
    .filter(Boolean)
    .map(symbol => ({ symbol, cap: bucket }));
}

async function fetchNseIndexCsvs() {
  const csvs = [];
  for (const source of NSE_INDEX_SOURCES) {
    csvs.push({
      ...source,
      csv: await httpsText(`https://nsearchives.nseindia.com/content/indices/${source.file}`),
    });
    await sleep(250);
  }
  return csvs;
}

function buildSectorMapFromIndexCsvs(csvs) {
  const map = new Map();
  for (const entry of Array.isArray(csvs) ? csvs : []) {
    const csv = typeof entry === 'string' ? entry : entry?.csv;
    const capRows = typeof entry === 'string' ? [] : parseNseIndexCapCsv(csv, entry?.cap);
    for (const row of capRows) {
      const existing = map.get(row.symbol) || { symbol: row.symbol };
      if (!existing.cap) map.set(row.symbol, { ...existing, cap: row.cap });
    }
    for (const row of parseNseIndexSectorCsv(csv)) {
      const existing = map.get(row.symbol) || {};
      map.set(row.symbol, { ...row, cap: existing.cap || row.cap || null });
    }
  }
  return map;
}

function isCustomSector(value) {
  const sector = String(value || '').trim();
  return /^custom$/i.test(sector);
}

function isCustomCap(value) {
  const cap = String(value || '').trim();
  return !cap || /^custom$/i.test(cap);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateCustomStockSectors(options = {}) {
  const dbPath = options.dbPath || process.env.STOCK_WATCHER_DB_PATH || DEFAULT_DB_PATH;
  const csvs = options.sectorMap ? [] : await (options.fetchIndexCsvs || fetchNseIndexCsvs)();
  const sectorMap = options.sectorMap || buildSectorMapFromIndexCsvs(csvs);
  const useQuoteApi = options.useQuoteApi === true || !!options.fetchQuote;
  const fetchQuote = useQuoteApi ? (options.fetchQuote || await createNseFetcher()) : null;
  const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : null;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Math.max(0, Number(options.delayMs)) : 1500;
  const db = new Database(dbPath);
  const updated = [];
  const capUpdated = [];
  const skipped = [];
  const failed = [];
  try {
    let rows = db.prepare(`
      SELECT symbol, name, sector, cap, source
      FROM symbols
      WHERE lower(coalesce(sector, '')) = 'custom'
         OR lower(coalesce(cap, '')) = 'custom'
      ORDER BY symbol ASC
    `).all();
    if (limit) rows = rows.slice(0, limit);
    const stmt = db.prepare(`
      UPDATE symbols
      SET name = COALESCE(?, name),
          sector = ?,
          cap = ?,
          updated_at = ?
      WHERE symbol = ?
    `);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (i > 0 && delayMs > 0) await sleep(delayMs);
      try {
        const mapped = sectorMap.get(row.symbol);
        const payload = mapped ? null : (fetchQuote ? await fetchQuote(row.symbol) : null);
        const sector = isCustomSector(row.sector) ? (mapped?.sector || extractNseSector(payload)) : row.sector;
        const cap = isCustomCap(row.cap) ? (mapped?.cap || row.cap) : row.cap;
        const hasSectorChange = isCustomSector(row.sector) && !!sector && sector !== row.sector;
        const hasCapChange = isCustomCap(row.cap) && !!cap && cap !== row.cap;
        if (!hasSectorChange && !hasCapChange) {
          skipped.push({ symbol: row.symbol, reason: 'sector/cap not found' });
          continue;
        }
        const name = cleanText(row.name) || mapped?.name || extractNseCompanyName(payload) || null;
        stmt.run(name, sector || row.sector, cap || row.cap, Date.now(), row.symbol);
        if (hasSectorChange) updated.push({ symbol: row.symbol, name, sector });
        if (hasCapChange) capUpdated.push({ symbol: row.symbol, cap });
      } catch (e) {
        failed.push({ symbol: row.symbol, error: e.message || String(e) });
      }
    }
  } finally {
    db.close();
  }
  return { updated, capUpdated, skipped, failed };
}

async function main() {
  const result = await updateCustomStockSectors();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.stack || err.message || String(err));
    process.exitCode = 1;
  });
}

module.exports = {
  extractNseSector,
  parseNseIndexCapCsv,
  parseNseIndexSectorCsv,
  updateCustomStockSectors,
};
