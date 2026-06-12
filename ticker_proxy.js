#!/usr/bin/env node
/**
 * NSE + Yahoo Finance Local Proxy Server
 * ─────────────────────────────────────────────────────────────────
 * Run:  node ticker_proxy.js          (self-applies --max-http-header-size)
 * Port: 3001
 *
 * Routes:
 *   GET /health                 → status check
 *   GET /nse?path=/api/...      → NSE India API (handles session)
 *   GET /yahoo?symbols=A,B,C    → Yahoo Finance v7 quotes
 *   GET /yahoo/indices          → Nifty index quotes
 * ─────────────────────────────────────────────────────────────────
 */

// ── SELF-RESPAWN ──────────────────────────────────────────────────
// Yahoo Finance responses contain huge Set-Cookie headers that exceed
// Node's default 8 KB HTTP parser limit.  The ONLY reliable fix is the
// --max-http-header-size CLI flag (agent-level options don't work).
// If we weren't started with it, re-exec ourselves with it right now.
const HEADER_FLAG = '--max-http-header-size=65536';
if (!process.execArgv.includes(HEADER_FLAG)) {
  const { spawnSync } = require('child_process');
  console.log('[proxy] Re-starting with', HEADER_FLAG, '…');
  const result = spawnSync(
    process.execPath,
    [HEADER_FLAG, ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 0);
}
// ─────────────────────────────────────────────────────────────────

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');
const PORT  = 3001;
const SAVED_ETF_FILE = path.join(__dirname, 'saved_etfs.json');
const SAVED_STOCK_FILE = path.join(__dirname, 'saved_stocks.json');
const SAVED_ETF_FAV_FILE  = path.join(__dirname, 'saved_etf_favs.json');
const ETF_LIST_CACHE_FILE  = path.join(__dirname, 'etf_list_cache.json');
const ETF_LIST_CACHE_TTL   = 24 * 60 * 60 * 1000;        // 24 hours (NSE price/nav batch)
const ETF_META_TTL         = 30 * 24 * 60 * 60 * 1000;   // 30 days (static: TER, family, 1Y/3Y/5Y — stored in etf_list_cache.json under "meta" key)
const FUND_CACHE_FILE      = path.join(__dirname, 'fundamentals_cache.json');
const FUND_CACHE_TTL       = 7  * 24 * 60 * 60 * 1000;   // 7 days
const ETF_SUM_CACHE_FILE   = path.join(__dirname, 'etf_summary_cache.json');
const ETF_1M_RETURN_TTL    = 24 * 60 * 60 * 1000;        // 24 hours (1M return — base shifts daily)
const ETF_SUM_CACHE_VERSION = 3;                          // v3: 1M-return-only cache (static fields moved to etf_list_cache meta)
const NSE_IDX_CACHE_FILE   = path.join(__dirname, 'nse_index_cache.json');
const NSE_IDX_CACHE_TTL    = 24 * 60 * 60 * 1000;        // 24 hours
const SAVED_STOCK_FAV_FILE = path.join(__dirname, 'saved_stock_favs.json');

function parseVolumeField(item) {
  const raw = item.totalTradedVolume ?? item.tradedVolume ?? item.volume ?? item.totalTradedQty ?? item.quantityTraded ?? item.qtyTraded ?? 0;
  if (typeof raw === 'number') return raw || null;
  const parsed = parseFloat(String(raw).replace(/,/g, ''));
  return parsed || null;
}

function loadSavedETFsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FILE)) fs.writeFileSync(SAVED_ETF_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF prefs:', e.message);
  }
}

function loadSavedStocksFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FILE)) fs.writeFileSync(SAVED_STOCK_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStocksFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock prefs:', e.message);
  }
}

// ── Fundamentals cache (per-symbol, 7-day TTL) ──────────────────────────────
// Structure: { [SYM]: { data: {...}, savedAt: timestamp } }
let fundCache = {};
function loadFundCache() {
  try {
    if (fs.existsSync(FUND_CACHE_FILE)) {
      fundCache = JSON.parse(fs.readFileSync(FUND_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(fundCache).length;
      if (count) console.log(`[fund-cache] Loaded ${count} cached fundamentals from file`);
    }
  } catch(e) { console.warn('[fund-cache] Load error:', e.message); fundCache = {}; }
}
function saveFundCache() {
  try {
    fs.writeFileSync(FUND_CACHE_FILE, JSON.stringify(fundCache, null, 2), 'utf8');
  } catch(e) { console.warn('[fund-cache] Save error:', e.message); }
}
loadFundCache();

// ── ETF summary cache (1M return only, 24h TTL) ─────────────────────────────
// Static fields (TER, category, fundFamily, 1Y/3Y/5Y) now live in etf_list_cache.json under "meta".
// Structure: { [SYM]: { oneMonthReturn: number, savedAt: timestamp, version: 3 } }
let etfSumCache = {};
function loadEtfSumCache() {
  try {
    if (fs.existsSync(ETF_SUM_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ETF_SUM_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(raw).length;
      // Version 3 = 1M-only format. Any older cache (v2 mixed format) is cleared.
      const isCurrent = count === 0 || Object.values(raw).some(e => e.version === ETF_SUM_CACHE_VERSION);
      if (!isCurrent) {
        console.log('[etf-sum-cache] Old mixed-format cache detected (pre-v3) — clearing');
        fs.unlinkSync(ETF_SUM_CACHE_FILE);
        etfSumCache = {};
      } else {
        etfSumCache = raw;
        if (count) console.log(`[etf-sum-cache] Loaded ${count} cached 1M returns`);
      }
    }
  } catch(e) { console.warn('[etf-sum-cache] Load error:', e.message); etfSumCache = {}; }
}
function saveEtfSumCache() {
  try { fs.writeFileSync(ETF_SUM_CACHE_FILE, JSON.stringify(etfSumCache, null, 2), 'utf8'); }
  catch(e) { console.warn('[etf-sum-cache] Save error:', e.message); }
}
loadEtfSumCache();

// ── ETF meta cache (static fields: TER, category, fundFamily, 1Y/3Y/5Y — 30d TTL) ──
// Stored inside etf_list_cache.json as a top-level "meta" dict so we don't need
// a separate file.  Loaded on startup and written back whenever a symbol is fetched.
// Structure: { [SYM]: { expenseRatio, category, fundFamily, ytdReturn, oneYearReturn,
//                        threeYearReturn, fiveYearReturn, savedAt } }
let etfMetaCache = {};
function loadEtfMetaCache() {
  try {
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8')) || {};
      etfMetaCache = raw.meta || {};
      const count = Object.keys(etfMetaCache).length;
      if (count) console.log(`[etf-meta-cache] Loaded ${count} static ETF records from etf_list_cache.json`);
    }
  } catch(e) { console.warn('[etf-meta-cache] Load error:', e.message); etfMetaCache = {}; }
}
function saveEtfMetaCache() {
  try {
    // Merge into existing etf_list_cache.json without overwriting the etfs array
    let existing = {};
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      existing = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8')) || {};
    }
    existing.meta = etfMetaCache;
    fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify(existing, null, 2), 'utf8');
  } catch(e) { console.warn('[etf-meta-cache] Save error:', e.message); }
}
loadEtfMetaCache();

function getETFExpenseRatio(sym) {
  const key = String(sym || '').toUpperCase();
  return etfMetaCache[key]?.expenseRatio ?? STATIC_TER[key] ?? null;
}


// ── NSE index membership cache (per-index, 24h TTL) ─────────────────────────
let nseIdxCache = {};
function loadNseIdxCache() {
  try {
    if (fs.existsSync(NSE_IDX_CACHE_FILE)) {
      nseIdxCache = JSON.parse(fs.readFileSync(NSE_IDX_CACHE_FILE, 'utf8')) || {};
      const count = Object.keys(nseIdxCache).length;
      if (count) console.log(`[nse-idx-cache] Loaded ${count} cached index lists`);
    }
  } catch(e) { console.warn('[nse-idx-cache] Load error:', e.message); nseIdxCache = {}; }
}
function saveNseIdxCache() {
  try { fs.writeFileSync(NSE_IDX_CACHE_FILE, JSON.stringify(nseIdxCache, null, 2), 'utf8'); }
  catch(e) { console.warn('[nse-idx-cache] Save error:', e.message); }
}
loadNseIdxCache();

function loadSavedETFFavsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FAV_FILE)) fs.writeFileSync(SAVED_ETF_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF favorites:', e.message);
  }
}

function loadSavedStockFavsFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FAV_FILE)) fs.writeFileSync(SAVED_STOCK_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStockFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock favorites:', e.message);
  }
}

// ══════════════════════════════════════════════════════════
//  SHARED HELPER — HTTPS GET with auto-decompression
// ══════════════════════════════════════════════════
function httpsGet(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      const enc    = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data',  c  => chunks.push(c));
      stream.on('end',   () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════
//  NSE SESSION
// ══════════════════════════════════════════════════════════
const nse = { cookies: '', lastRefresh: 0, refreshing: false, TTL: 5 * 60 * 1000 };

const NSE_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer'        : 'https://www.nseindia.com/',
  'Sec-Fetch-Dest' : 'empty',
  'Sec-Fetch-Mode' : 'cors',
  'Sec-Fetch-Site' : 'same-origin',
  'Connection'     : 'keep-alive',
};

function harvestCookies(store, res) {
  const raw = res.headers['set-cookie'];
  if (!raw || !raw.length) return store;
  const map = Object.fromEntries(
    store.split('; ').filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i > -1 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
    })
  );
  for (const c of raw) {
    const pair = c.split(';')[0];
    const i    = pair.indexOf('=');
    if (i > -1) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function nseGet(path) {
  const res = await httpsGet({
    hostname: 'www.nseindia.com', path, method: 'GET', timeout: 15000,
    headers : { ...NSE_HEADERS, ...(nse.cookies ? { Cookie: nse.cookies } : {}) },
  });
  nse.cookies = harvestCookies(nse.cookies, res);
  return res;
}

async function warmNSESession() {
  if (nse.refreshing) return;
  nse.refreshing = true;
  console.log('[NSE] Warming session…');
  try {
    await nseGet('/');
    await nseGet('/market-data/live-equity-market-data');
    nse.lastRefresh = Date.now();
    console.log('[NSE] Session ready (' + nse.cookies.length + ' chars)');
  } catch(e) {
    console.warn('[NSE] Warm failed:', e.message);
  } finally {
    nse.refreshing = false;
  }
}

const NSE_ALLOWED = new Set(['/api/allIndices', '/api/marketStatus']);
const NSE_PREFIXES = ['/api/equity-stockIndices', '/api/quote-equity', '/api/chart-databyindex'];
const isNSEAllowed = p => NSE_ALLOWED.has(p) || NSE_PREFIXES.some(pre => p.startsWith(pre));

// ══════════════════════════════════════════════════════════
//  YAHOO FINANCE  —  crumb-free via v8/finance/chart
// ══════════════════════════════════════════════════════════
// Yahoo locked down v7/quote behind a consent-cookie crumb in 2024.
// v8/finance/chart is the replacement: it needs NO crumb, NO session,
// and returns price + 52-week range + volume for any symbol.
// We fetch symbols in parallel (Promise.allSettled) for speed.
// ──────────────────────────────────────────────────────────

const YAHOO_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Referer'        : 'https://finance.yahoo.com/',
};

// Fetch a single symbol via v8/finance/chart (1-day range, 1-day interval).
// Returns the parsed JSON or null on error.
async function yahooChart(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}` +
               `?interval=1d&range=1d&includePrePost=false`;
  try {
    const res = await httpsGet({
      hostname: 'query1.finance.yahoo.com',
      path, method: 'GET', timeout: 10000,
      headers: YAHOO_HEADERS,
    });
    if (res.status !== 200) {
      // Fallback to query2 on any non-200
      const res2 = await httpsGet({
        hostname: 'query2.finance.yahoo.com',
        path, method: 'GET', timeout: 10000,
        headers: YAHOO_HEADERS,
      });
      if (res2.status !== 200) return null;
      return JSON.parse(res2.body);
    }
    return JSON.parse(res.body);
  } catch(e) {
    return null;
  }
}

// Extract a clean quote object from a v8/chart response
function chartToQuote(sym, data) {
  try {
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta || {};
    const prev   = meta.chartPreviousClose || meta.previousClose || 0;
    const price  = meta.regularMarketPrice || 0;
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol     : sym,
      price      : price,
      change     : parseFloat(change.toFixed(2)),
      high52     : meta.fiftyTwoWeekHigh  || 0,
      low52      : meta.fiftyTwoWeekLow   || 0,
      volume     : meta.regularMarketVolume || 0,
      open       : meta.regularMarketDayHigh ? (result.indicators?.quote?.[0]?.open?.[0] || 0) : 0,
      prevClose  : prev,
      marketState: meta.marketState || 'CLOSED',
    };
  } catch(e) {
    return null;
  }
}

// Fetch a batch of NSE symbols concurrently (max CONCURRENCY at a time)
const CONCURRENCY = 8;
async function yahooQuote(nseSymbols) {
  const results = {};
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => yahooChart(sym + '.NS').then(data => ({ sym, data })))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) {
        const q = chartToQuote(r.value.sym, r.value.data);
        if (q) results[r.value.sym] = q;
      }
    }
  }
  // Return in the shape the dashboard expects: { SYMBOL: { price, change, ... } }
  return { ok: true, quotes: results };
}

// ══════════════════════════════════════════════════════════
//  COMPUTED RETURNS  — derive 1M / YTD / 1Y / 3Y / 5Y from chart history
// ══════════════════════════════════════════════════════════
async function computeReturns(sym) {
  // Single fetch: 5Y daily chart gives a real trailing 1M base and covers all periods.
  try {
    const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=5y&includePrePost=false`;
    let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS });
    if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS });
    if (r.status !== 200) return {};
    const result = JSON.parse(r.body)?.chart?.result?.[0];
    if (!result) return {};
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
    if (!timestamps.length || !closes.length) return {};

    const msNow = Date.now();

    const findIdx = (targetMs) => {
      const targetSec = targetMs / 1000;
      let best = -1, bestDiff = Infinity;
      for (let i = 0; i < timestamps.length; i++) {
        const diff = Math.abs(timestamps[i] - targetSec);
        if (diff < bestDiff && closes[i] != null) { bestDiff = diff; best = i; }
      }
      return best;
    };

    const lastIdx = closes.reduce((bi, v, i) => v != null ? i : bi, -1);
    if (lastIdx < 0) return {};
    const currentPrice = closes[lastIdx]; // current/partial month — updates intraday

    const oneMonthStart = msNow - 30 * 24 * 3600 * 1000;
    const oneMonthIdx = findIdx(oneMonthStart);
    const oneMonthReturn = (oneMonthIdx >= 0 && closes[oneMonthIdx] > 0)
      ? +((currentPrice - closes[oneMonthIdx]) / closes[oneMonthIdx]).toFixed(4)
      : null;
    console.log(`[computeReturns] ${sym} 1M: current=${currentPrice} base=${closes[oneMonthIdx]} return=${oneMonthReturn}`);

    const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const y1Start  = msNow - 365     * 24 * 3600 * 1000;
    const y3Start  = msNow - 3 * 365 * 24 * 3600 * 1000;
    const y5Start  = msNow - 5 * 365 * 24 * 3600 * 1000;

    const ret = (startMs, years) => {
      const idx = findIdx(startMs);
      if (idx < 0 || closes[idx] == null || closes[idx] === 0) return null;
      const raw = (currentPrice - closes[idx]) / closes[idx];
      if (years <= 1) return +raw.toFixed(4);
      return +(Math.pow(1 + raw, 1 / years) - 1).toFixed(4);
    };

    return {
      oneMonthReturn,
      ytdReturn      : ret(ytdStart, (msNow - ytdStart) / (365 * 24 * 3600 * 1000)),
      oneYearReturn  : ret(y1Start,  1),
      threeYearReturn: ret(y3Start,  3),
      fiveYearReturn : ret(y5Start,  5),
    };
  } catch(e) {
    console.warn(`[computeReturns] ${sym}:`, e.message);
    return {};
  }
}

// ══════════════════════════════════════════════════════════
//  SPARKLINES  — 1-month daily closes, normalised to % change
// ══════════════════════════════════════════════════════════
function normaliseReturnValue(v) {
  const raw = v?.raw ?? v;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const n = Number(raw);
  return Math.abs(n) > 1 ? +(n / 100).toFixed(4) : +n.toFixed(4);
}

function parseDirectReturns(performance) {
  const trailing = performance?.trailingReturns || {};
  return {
    oneMonthReturn  : normaliseReturnValue(trailing.oneMonth ?? trailing.oneMonthReturn ?? trailing.month1),
    ytdReturn       : normaliseReturnValue(trailing.ytd),
    oneYearReturn   : normaliseReturnValue(trailing.oneYear ?? trailing.oneYearReturn ?? trailing.year1),
    threeYearReturn : normaliseReturnValue(trailing.threeYear ?? trailing.threeYearReturn ?? trailing.year3),
    fiveYearReturn  : normaliseReturnValue(trailing.fiveYear ?? trailing.fiveYearReturn ?? trailing.year5),
  };
}

const sparkCache = {};                              // in-memory only, no disk persistence
const SPARK_TTL  = 2 * 60 * 60 * 1000;             // 2 hours

async function fetchSparkline(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1mo&includePrePost=false`;
  let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
  if (r.status !== 200) return null;
  const result = JSON.parse(r.body)?.chart?.result?.[0];
  if (!result) return null;
  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter(v => v != null);
  if (valid.length < 2) return null;
  // Downsample to ≤15 points, normalise to % change from first
  const step = Math.max(1, Math.floor(valid.length / 15));
  const sampled = [];
  for (let i = 0; i < valid.length; i += step) sampled.push(valid[i]);
  if (sampled[sampled.length - 1] !== valid[valid.length - 1]) sampled.push(valid[valid.length - 1]);
  const base = sampled[0];
  return sampled.map(v => +((v - base) / base * 100).toFixed(2));
}

// ══════════════════════════════════════════════════════════
//  STATIC AMC LOOKUP  — fund house name by symbol pattern
//  Yahoo fundProfile.family is often null for Indian ETFs
// ══════════════════════════════════════════════════════════
const AMC_RULES = [
  { re: /^(NIFTYBEES|BANKBEES|JUNIORBEES|LIQUIDBEES|MID150BEES|NIF100BEES|PSUBNKBEES|INFRABEES|SETF|NIF|NETF|NIFTY|.*BEES$)/, name: 'Nippon India AMC' },
  { re: /^HDFC/,      name: 'HDFC AMC' },
  { re: /^(ICICI|ICICIB|ICICINN|ICICIPSUBK|ICICIPHARM|ICICIPRB|ICICINIFTY|ICICINXT|ICICISILVER|ICICIGOLD)/, name: 'ICICI Prudential AMC' },
  { re: /^(KOTAK|KOTAKGOLD|KOTAKBANK|KOTAKIT|KOTAKSILV|KOTAKPHARMA|KOTAKNN50|KOTAKPSUBK)/, name: 'Kotak Mahindra AMC' },
  { re: /^(SBI|SBIETF|SBINIFTY|SBINMID|SBISMLETF|SBIETFIT|SBIETFCON|SBIETFPB|SBIGETS|SBIBANK|SBIBPB|SBINEQWETF|LIQUIDSBI)/, name: 'SBI Funds Management' },
  { re: /^AXIS/,      name: 'Axis AMC' },
  { re: /^(MIRAE|MAFANG|MASP)|CASE$/, name: 'Mirae Asset AMC' },
  { re: /^UTINIFTY|^UTISENSX/, name: 'UTI AMC' },
  { re: /^(ABSL|BSL|ABGSEC|GSEC10ABSL)|ADD$/, name: 'Aditya Birla Sun Life AMC' },
  { re: /^(MOSL|MO|MON|MOBANK|MOIPO|MOSMALL|MOMIDCAP|MOSERVICE|MOCAPITAL|MOMNC|MOTOUR)/, name: 'Motilal Oswal AMC' },
  { re: /^GROWW/,     name: 'Groww AMC' },
  { re: /^NIP|^NIPPON/, name: 'Nippon India AMC' },
  { re: /^LIC/,       name: 'LIC Mutual Fund' },
  { re: /^DSP/,       name: 'DSP AMC' },
  { re: /^(TATA|TAT|TNID)/, name: 'Tata AMC' },
  { re: /^PGIM/,      name: 'PGIM India AMC' },
  { re: /^FRANK|^TEMPLETON/, name: 'Franklin Templeton AMC' },
  { re: /^INVESCO|^IVZ/, name: 'Invesco AMC' },
  { re: /^MAHINDRA|^MAH/, name: 'Mahindra Manulife AMC' },
  { re: /^(EDELWEISS|ELM|EBANK|EBBETF|BBETF|E(GOLD|SILVER|NIFTY|NEXT|LIQUID|SENSEX|MULTI)|ECAP)/, name: 'Edelweiss AMC' },
  { re: /^QUANTUM|^QNIFTY|^QGOLD/, name: 'Quantum AMC' },
  { re: /^HSBC/,      name: 'HSBC AMC' },
  { re: /^CPSE|^CPSEETF/, name: 'Bharat Bond / CPSE ETF' },
  { re: /^AONE/, name: 'Angel One AMC' },
  { re: /^ITI/, name: 'ITI Mutual Fund' },
  { re: /^LIQUIDSHRI/, name: 'Shriram AMC' },
  { re: /^UNION/, name: 'Union Mutual Fund' },
  { re: /^BBNPP/, name: 'Baroda BNP Paribas Mutual Fund' },
  { re: /^IDF/, name: 'Bandhan Mutual Fund' },
  { re: /IETF$/, name: 'ICICI Prudential AMC' },
];

function lookupAMC(sym) {
  for (const rule of AMC_RULES) {
    if (rule.re.test(sym)) return rule.name;
  }
  return null;
}


const ETF_SECTOR_RULES = [
  // Broad market / index
  { sector: 'Broad Market',  syms: /NIFTYBEES|UTINIFTY|KOTAKNIFTY|HDFCNIFTY|SETFNIF50|ICICINIFTY|AXISLNIFTY|SBINIFTY|BSLNIFTY/, names: /nifty 50|nifty50|sensex|broad market/i },
  { sector: 'Next 50',       syms: /JUNIORBEES|SETFNN50|ICICINN50|KOTAKNN50|MAFANG/, names: /next 50|nifty next|junior/i },
  { sector: 'Midcap',        syms: /MIDCAPETF|MID150|MIDCAP|NIFMDCP/, names: /midcap|mid cap|mid-cap/i },
  { sector: 'Smallcap',      syms: /SMALLCAP|NIFSMCP/, names: /smallcap|small cap|small-cap/i },

  // Commodities
  { sector: 'Gold',          syms: /GOLDBEES|KOTAKGOLD|SBIGETS|HDFCGOLD|AXISGOLD|BSLGOLDETF|NIPGOLD|SETFGOLD|ICICIGOLD|LICMFGOLD|DSPGOLD|QGOLDHALF/, names: /gold/i },
  { sector: 'Silver',        syms: /SILVERBEES|SILVERETF|SETFSILVER|KOTAKSILV|ICICISILVER|SILVERCASE/, names: /silver/i },

  // Sectoral
  { sector: 'Banking',       syms: /BANKBEES|KOTAKBANK|SETFBANK|HDFCNIFBAN|ICICIB22|AXISNIFBK|SBIBANK/, names: /bank|banking/i },
  { sector: 'Private Bank',  syms: /PVTBANKETF|SETFPVTB|HDFCPVTBAN|ICICIPRB|AXISPVTBNK/, names: /private bank|pvt bank/i },
  { sector: 'IT',            syms: /ITBEES|SETFIT|KOTAKIT|HDFCIT|ICICINXT50|AXISIT/, names: /\bIT\b|information tech|nifty it/i },
  { sector: 'Pharma',        syms: /PHARMABEES|SETFPHARMA|KOTAKPHARMA|HDFCPHARMA|ICICIPHARM|AXISPHARMA/, names: /pharma|healthcare|health care/i },
  { sector: 'PSU',           syms: /CPSE|PSUBNKBEES|SETFPB|KOTAKPSUBK|HDFCPSUBK|ICICIPSUBK|AXISPSUBK/, names: /psu|public sector|cpse/i },
  { sector: 'Infrastructure',syms: /NIFTYINFRA|INFRABEES|SETFINFRA/, names: /infra/i },
  { sector: 'Consumption',   syms: /CONS|FMCG|CONSUMBEES/, names: /consum|fmcg/i },
  { sector: 'Auto',          syms: /AUTOETF|SETFAUTO/, names: /auto(?:mobile)?/i },
  { sector: 'Energy',        syms: /ENERGYBEES|SETFENERGY/, names: /energy/i },
  { sector: 'Realty',        syms: /REIETF|SETFREALTY/, names: /realt|real estate/i },
  { sector: 'Metal',         syms: /METALBEES|SETFMETAL/, names: /metal/i },
  { sector: 'Media',         syms: /MEDIABEES|SETFMEDIA/, names: /media/i },

  // Strategy / factor
  { sector: 'Dividend',      syms: /DIVOPPS|DIVIDEND|DIVBEES/, names: /dividend/i },
  { sector: 'Value',         syms: /VALUEETF|SETFVALUE/, names: /value/i },
  { sector: 'Momentum',      syms: /MOMENTUMETF|SETFMOM/, names: /momentum/i },
  { sector: 'Quality',       syms: /QUALITYETF|SETFQUAL/, names: /quality/i },
  { sector: 'Low Volatility',syms: /LOWVOLETF|SETFLV/, names: /low vol/i },
  { sector: 'Alpha',         syms: /ALPHAETF|SETFALPHA/, names: /alpha/i },

  // International
  { sector: 'International', syms: /NIPPOFFSH|MAFANG|FANG|NASDAQ|WORLD|HANGSENG|US|N100/, names: /nasdaq|s&p|global|world|us equity|hang seng|international|offshore|fang/i },

  // Debt / liquid
  { sector: 'Debt',          syms: /LIQUIDBEES|LIQUIDETF|GSEC|GILT|BOND|SDL|CORP/, names: /liquid|gilt|g-sec|bond|debt|sdl|corporate/i },
];

function categorizeETF(sym, name) {
  const s = sym.toUpperCase();
  const n = (name || '').toLowerCase();
  for (const rule of ETF_SECTOR_RULES) {
    if (rule.syms.test(s) || rule.names.test(n)) return rule.sector;
  }
  return 'Other';
}

// ══════════════════════════════════════════════════════════
//  STATIC TER LOOKUP  — expense ratios for Indian ETFs
//  Values sourced from AMC fact sheets / NSE disclosures (decimal fractions, e.g. 0.05% = 0.0005)
// ══════════════════════════════════════════════════════════
const STATIC_TER = {
  // ── Broad Market / Nifty 50 ──
  NIFTYBEES:0.0004, BSLNIFTY:0.0005, HDFCNIFTY:0.0005, HDFCSENSEX:0.0005,
  AXISNIFTY:0.0005, NETF:0.0004,
  SETFNIF50:0.0007, AXSENSEX:0.0005, ESENSEX:0.0007, SENSEXADD:0.0005,
  SENSEXBETA:0.0010, SENSEXETF:0.0007, SENSEXIETF:0.0013, MONIFTY500:0.0014,
  LICNETFN50:0.0005, LICNETFSEN:0.0005, GROWWNIFTY:0.0005, ENIFTY:0.0005,
  NIFTYBETF:0.0007, NIFTYCASE:0.0007, NIFTYIETF:0.0013, NIFTYETF:0.0007,
  QNIFTY:0.0005, IDFNIFTYET:0.0005, NIFTY1:0.0007, IVZINNIFTY:0.0005,
  AONENIFTY:0.0005, NIFTYADD:0.0005, NIFTYBETA:0.0010,

  // ── Nifty 100 / 200 / 500 ──
  NIF100BEES:0.0015, NIF100IETF:0.0015, MONIFTY100:0.0015, HDFCNIF100:0.0015,
  BSE500IETF:0.0015, HDFCBSE500:0.0015, GROWWN200:0.0015, ELM250:0.0015,
  MSCI360:0.0020, MSCIINDIA:0.0020, MSCIADD:0.0020, ABSLMSCIN:0.0020,

  // ── Next 50 ──
  JUNIORBEES:0.0019, SETFNN50:0.0013, ENEXT50:0.0013,
  NEXT50:0.0013, NEXT50ADD:0.0013, NEXT50BETA:0.0013, NEXT50ETF:0.0013,
  NEXT50IETF:0.0013, MONEXT50:0.0013, ABSLNN50ET:0.0013, GROWWNXT50:0.0013,
  SNXT50BETA:0.0013, HDFCNEXT50:0.0013, SNXT30BEES:0.0013,

  // ── Midcap ──
  MID150BEES:0.0015, HDFCMID150:0.0020, MID150:0.0020, MID150CASE:0.0020,
  MIDCAP:0.0020, MIDCAPADD:0.0020, MIDCAPBETA:0.0020, MIDCAPETF:0.0020,
  MIDCAPIETF:0.0020, SBINMID150:0.0020, GROWWMC150:0.0020, LICNMID100:0.0020,
  MIDSELIETF:0.0020, MIDQ50ADD:0.0020, MIDSMALL:0.0020, MOMIDMTM:0.0035,

  // ── Smallcap ──
  SMALLCAP:0.0030, SMALL250:0.0030, SMALLADD:0.0030, SML100CASE:0.0030,
  MOSMALL250:0.0030, HDFCSML250:0.0030, GROWWSC250:0.0030, SBISMLETF:0.0030,

  // ── Banking ──
  BANKBEES:0.0019, BANKBETF:0.0019, BANKETF:0.0019, BANKIETF:0.0019,
  HDFCNIFBAN:0.0020, ICICIB22:0.0014, EBANKNIFTY:0.0015, PSUBANK:0.0019,
  ABSL10BANK:0.0020, BANK10ADD:0.0019, BANKADD:0.0019, BANKBETA:0.0020,
  BANKNIFTY1:0.0020, BANKPSU:0.0019, MOBANK10:0.0020, PSUBANKADD:0.0020,
  PVTBANKADD:0.0020, SETFNIFBK:0.0015, AXISBNKETF:0.0020, BBNPNBETF:0.0020,

  // ── Private Bank ──
  HDFCPVTBAN:0.0020, SBIBPB:0.0014, SBIETFPB:0.0014, PVTBANIETF:0.0020,
  PVTBKGROWW:0.0020, HDFCPVTBAN:0.0020,

  // ── PSU / CPSE ──
  PSUBNKBEES:0.0035, CPSEETF:0.0015, HDFCPSUBK:0.0020, GROWWPSUBK:0.0020,
  PSUBNKIETF:0.0035, ABSLPSE:0.0015, MOPSE:0.0020, GROWWPSE:0.0020,

  // ── IT / Technology ──
  ITBEES:0.0035, IT:0.0035, ITADD:0.0035, ITBETA:0.0035,
  ITETF:0.0035, ITIETF:0.0035, SBIETFIT:0.0020, MAHKTECH:0.0040,
  AXISTECETF:0.0035, TECH:0.0035, INTERNET:0.0050, GROWWNET:0.0050,
  HDFCNIFIT:0.0020,

  // ── Equal Weight / NQ50 ──
  EQUAL200:0.0030, EQUAL50:0.0030, EQUAL50ADD:0.0030, MON50EQUAL:0.0030,
  SBINEQWETF:0.0030, NIFTY100EW:0.0030, MONQ50:0.0013,

  // ── NV20 / Others ──
  NV20:0.0040, NV20BEES:0.0040, NV20IETF:0.0040,
  SHARIABEES:0.0030, ESG:0.0040, BFSI:0.0035, FINIETF:0.0035,
  SELECTIPO:0.0050, MOIPO:0.0050, MNC:0.0035, MOMNC:0.0035,
  MOTOUR:0.0040, MULTICAP:0.0040, FLEXIADD:0.0040,
  MASPTOP50:0.0025, TOP100CASE:0.0015, TOP20:0.0015, TOP15IETF:0.0015,
  TOP10ADD:0.0020, NEXT30ADD:0.0020, ALPL30IETF:0.0020,
  AONETMMQ50:0.0020, AONETOTAL:0.0015, TNIDETF:0.0020,
  NPBET:0.0020, MOCAPITAL:0.0035, MOSERVICE:0.0035,
  SBIETFCON:0.0035, SBIETFPB:0.0014, BSLSENETFG:0.0005,
  EMULTIMQ:0.0020, GROWWCAPM:0.0040, MANUFGBEES:0.0035,

  // ── International ──
  MAFANG:0.0065, MON100:0.0065, HNGSNGBEES:0.0065,
  ABSLBANETF:0.0060, ABSLNN50ET:0.0013, LIQUIDPLUS:0.0005,
  MSCIINDIA:0.0020,
};

// ══════════════════════════════════════════════════════════
//  ETF DATA  — 52W range + NAV discount/premium via quoteSummary
// ══════════════════════════════════════════════════════════

// In-memory cache for NSE iNAV batch — stale-while-revalidate
// Cached data is served immediately; NSE is refreshed in the background when stale
const navMapCache = { data: {}, savedAt: 0, TTL: 15 * 60 * 1000, refreshing: false };

async function refreshNavMapFromNSE() {
  if (navMapCache.refreshing) return;
  navMapCache.refreshing = true;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const nseRes = await nseGet('/api/etf');
      const items = JSON.parse(nseRes.body)?.data || [];
      const newMap = {};
      for (const item of items) {
        const sym = (item.symbol || item.Symbol || '').trim().toUpperCase();
        if (!sym) continue;
        newMap[sym] = {
          nav     : parseFloat(item.iNavValue || item.nav || item.NAV || 0) || null,
          high52  : parseFloat(item['52WeekHigh'] || item.yearHigh || 0) || null,
          low52   : parseFloat(item['52WeekLow']  || item.yearLow  || 0) || null,
          volume  : parseVolumeField(item),
          aum     : item.aum || item.AUM || null,
          expRatio: item.expenseRatio || getETFExpenseRatio(sym),
        };
      }
      navMapCache.data    = newMap;
      navMapCache.savedAt = Date.now();
      console.log('[etf-nav] NSE ETF data refreshed, count:', Object.keys(newMap).length);
      break;
    } catch(e) {
      const retryable = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' ||
                        e.code === 'ETIMEDOUT'   || e.message.includes('timed out');
      if (retryable && attempt < MAX_RETRIES) {
        const delay = attempt * 1500;
        console.warn(`[etf-nav] NSE refresh failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message} — retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.warn(`[etf-nav] NSE refresh failed after ${attempt} attempt(s): ${e.message}`);
        // Stamp savedAt so the next request doesn't immediately retry NSE again
        if (navMapCache.savedAt === 0) navMapCache.savedAt = Date.now();
      }
    }
  }
  navMapCache.refreshing = false;
}

async function fetchETFData(etfSymbols) {
  const results = {};

  // Stale-while-revalidate: always serve from cache immediately, refresh NSE in background
  let navMap = {};
  const hasData = navMapCache.savedAt > 0;
  const isStale = (Date.now() - navMapCache.savedAt) >= navMapCache.TTL;

  if (hasData) {
    // Serve cached navMap instantly (even if stale)
    navMap = navMapCache.data;
    if (isStale) {
      const ageMin = Math.round((Date.now() - navMapCache.savedAt) / 60000);
      console.log(`[etf-nav] serving stale navMap (age ${ageMin}m), triggering background NSE refresh`);
      refreshNavMapFromNSE().catch(e => console.warn('[etf-nav] background NSE refresh failed:', e.message));
    } else {
      console.log(`[etf-nav] using navMap from memory cache (age ${Math.round((Date.now()-navMapCache.savedAt)/1000)}s)`);
    }
  } else {
    // First run: no cached data yet — must block until NSE responds (or fails)
    await refreshNavMapFromNSE();
    navMap = navMapCache.data;
  }

  // Seed 52W range from etf_list_cache for any symbol navMap doesn't have it
  // (etf_list_cache is 24h; avoids Yahoo chart calls just for range data)
  const etfListData = {};
  try {
    if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
      for (const e of (cached.etfs || [])) etfListData[e.sym] = e;
    }
  } catch(_) {}

  // For each symbol, merge NSE nav data with Yahoo price data
  for (let i = 0; i < etfSymbols.length; i += CONCURRENCY) {
    const chunk = etfSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => (async () => {
        const nse  = navMap[sym] || {};
        const disk = etfListData[sym] || {};
        // Yahoo chart for live price only (skip if we already have 52W from NSE/disk cache)
        try {
          const path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
          let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
          if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
          const meta = r.status === 200 ? JSON.parse(r.body)?.chart?.result?.[0]?.meta : null;

          // Price: live chart first; fall back to cached previousClose from etf-summary
          // (thinly-traded ETFs may have no intraday chart data)
          const price  = meta?.regularMarketPrice ?? etfSumCache[sym]?.data?.price ?? null;
          const volume = meta?.regularMarketVolume ?? nse.volume ?? disk.volume ?? null;
          // 52W: prefer NSE navMap → disk etf_list_cache → Yahoo chart
          const high52 = nse.high52 || disk.high52 || meta?.fiftyTwoWeekHigh || null;
          const low52  = nse.low52  || disk.low52  || meta?.fiftyTwoWeekLow  || null;
          // NAV: NSE iNAV → Yahoo chart navPrice → Yahoo quoteSummary/price → etf_list_cache disk
          let nav = nse.nav || meta?.navPrice || null;

          if (!nav) {
            // Try quoteSummary?modules=price — returns navPrice for Indian ETFs
            try {
              await ensureCrumb();
              let qPath, qHeaders;
              if (yahooCrumb.value) {
                qPath    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=price&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                qHeaders = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
              } else {
                qPath    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=price`;
                qHeaders = YAHOO_HEADERS;
              }
              let qr = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: qPath, method: 'GET', timeout: 10000, headers: qHeaders });
              if (qr.status !== 200) qr = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: qPath, method: 'GET', timeout: 10000, headers: qHeaders });
              if (qr.status === 200) {
                const pr = JSON.parse(qr.body)?.quoteSummary?.result?.[0]?.price;
                nav = pr?.navPrice?.raw ?? pr?.regularMarketPrice?.raw ?? null;
                if (nav) console.log(`[etf-nav] ${sym} navPrice from quoteSummary/price: ${nav}`);
              }
            } catch(qe) {
              console.warn(`[etf-nav] ${sym} quoteSummary/price fallback error: ${qe.message}`);
            }
          }

          // Final fallback: etf_list_cache disk nav (NSE iNAV from last batch fetch)
          if (!nav) nav = disk.nav || null;

          const navPremium = (nav && price) ? +((( price - nav) / nav) * 100).toFixed(2) : null;

          console.log(`[etf-nav] ${sym} price:${price} nav:${nav} volume:${volume ?? '–'} (nseNav:${nse.nav??'–'} yahooNav:${meta?.navPrice??'–'}) premium:${navPremium}% 52W:${low52}-${high52}`);
          return { sym, data: { price, nav, navPremium, high52, low52, volume, aum: nse.aum || null, expRatio: nse.expRatio || null } };
        } catch(e) {
          return { sym, data: { nav: nse.nav||disk.nav||null, high52: nse.high52||disk.high52||null, low52: nse.low52||disk.low52||null, volume: nse.volume||disk.volume||null, navPremium: null, aum: nse.aum||null, expRatio: nse.expRatio||null } };
        }
      })())
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) results[r.value.sym] = r.value.data;
    }
  }
  return { ok: true, etfs: results };
}

// ══════════════════════════════════════════════════════════
//  YAHOO CRUMB SESSION  (needed for quoteSummary fundamentals)
// ══════════════════════════════════════════════════════════
const yahooCrumb = { value: null, cookies: '', lastFetch: 0, TTL: 30 * 60 * 1000, fetching: false };

async function refreshYahooCrumb() {
  if (yahooCrumb.fetching) return;
  yahooCrumb.fetching = true;
  try {
    console.log('[crumb] Fetching Yahoo session...');
    // Step 1: hit a quote page to get A1/A3 cookies (root '/' doesn't always yield crumb-valid cookies)
    const r0 = await httpsGet({
      hostname: 'finance.yahoo.com', path: '/quote/AAPL',
      method: 'GET', timeout: 10000,
      headers: { ...YAHOO_HEADERS, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br' }
    });
    const rawCookies = r0.headers['set-cookie'] || [];
    const cookieMap = {};
    for (const c of rawCookies) {
      const pair = c.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > -1) cookieMap[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    yahooCrumb.cookies = Object.entries(cookieMap).map(([k,v]) => `${k}=${v}`).join('; ');
    console.log('[crumb] Got cookies, length:', yahooCrumb.cookies.length);

    // Step 2: fetch crumb
    const r1 = await httpsGet({
      hostname: 'query1.finance.yahoo.com', path: '/v1/test/getcrumb',
      method: 'GET', timeout: 10000,
      headers: { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies }
    });
    if (r1.status === 200 && r1.body && !r1.body.includes('<!DOCTYPE')) {
      yahooCrumb.value = r1.body.trim();
      yahooCrumb.lastFetch = Date.now();
      console.log('[crumb] Got crumb:', yahooCrumb.value);
    } else {
      console.warn('[crumb] Failed to get crumb, status:', r1.status, r1.body.slice(0, 100));
    }
  } catch(e) {
    console.warn('[crumb] Error:', e.message);
  } finally {
    yahooCrumb.fetching = false;
  }
}

async function ensureCrumb() {
  if (yahooCrumb.value && (Date.now() - yahooCrumb.lastFetch) < yahooCrumb.TTL) return true;
  await refreshYahooCrumb();
  return !!yahooCrumb.value;
}

// Fetch fundamentals via Yahoo quoteSummary (requires crumb session)
async function yahooSummary(nseSymbols) {
  const results = {};
  const hasCrumb = await ensureCrumb();

  const MODULES = 'financialData,defaultKeyStatistics,summaryDetail,assetProfile';

  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => (async () => {
        try {
          let path, headers;
          if (hasCrumb && yahooCrumb.value) {
            // Use quoteSummary with crumb — returns full fundamentals
            path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
            headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
          } else {
            // Fallback: v8/chart meta (limited fields only)
            path = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
            headers = YAHOO_HEADERS;
          }

          let res = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
          // Retry with query2 on failure
          if (res.status !== 200) {
            res = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
          }
          // If crumb expired, refresh and retry once
          if (res.status === 401 || res.status === 403) {
            await refreshYahooCrumb();
            if (yahooCrumb.value) {
              path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
              headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
              res = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
            }
          }
          if (res.status !== 200) {
            console.warn(`[summary] ${sym} HTTP ${res.status}`);
            return { sym, data: null };
          }

          const json = JSON.parse(res.body);

          // Parse quoteSummary response
          const r = json?.quoteSummary?.result?.[0];
          if (r) {
            const fin   = r.financialData || {};
            const stats = r.defaultKeyStatistics || {};
            const detail = r.summaryDetail || {};
            const profile = r.assetProfile || {};

            const trailingEps   = fin.trailingEps?.raw ?? stats.trailingEps?.raw ?? null;
            const trailingPE    = fin.trailingPE?.raw ?? stats.trailingPE?.raw ?? detail.trailingPE?.raw ?? null;
            const forwardPE     = fin.forwardPE?.raw ?? detail.forwardPE?.raw ?? null;
            const marketCap     = detail.marketCap?.raw ?? null;
            const priceToBook   = stats.priceToBook?.raw ?? null;
            const dividendYield = detail.dividendYield?.raw ?? detail.trailingAnnualDividendYield?.raw ?? null;
            const roe           = fin.returnOnEquity?.raw ?? null;
            const totalDebt     = fin.totalDebt?.raw ?? null;
            const totalEquity   = fin.totalStockholdersEquity?.raw ?? null;
            const epsGrowth     = fin.earningsGrowth?.raw ?? null;
            const peg           = stats.pegRatio?.raw ?? null;
            const priceTarget   = fin.targetMeanPrice?.raw ?? fin.targetMedianPrice?.raw ?? null;
            const sharesOut     = stats.sharesOutstanding?.raw ?? null;
            const sector        = profile.sector ?? null;
            const industry      = profile.industry ?? null;
            const fiftyDayAvg   = detail.fiftyDayAverage?.raw ?? null;
            const twoHundredDayAvg = detail.twoHundredDayAverage?.raw ?? null;
            const high52        = detail.fiftyTwoWeekHigh?.raw ?? null;
            const low52         = detail.fiftyTwoWeekLow?.raw ?? null;
            const forwardEps    = stats.forwardEps?.raw ?? null;

            
            return { sym, data: { trailingEps, forwardEps, trailingPE, forwardPE, marketCap, priceToBook,
              dividendYield, fiftyDayAvg, twoHundredDayAvg, high52, low52, roe, totalDebt, totalEquity,
              epsGrowth, peg, priceTarget, sharesOutstanding: sharesOut, sector, industry } };
          }

          // Fallback: parse v8/chart meta
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta) {
            const trailingEps = meta.epsTrailingTwelveMonths ?? null;
            const forwardEps  = meta.epsForward ?? null;
            const trailingPE  = meta.trailingPE ?? null;
            const price       = meta.regularMarketPrice ?? null;
            const forwardPE   = (forwardEps && price) ? +(price / forwardEps).toFixed(2) : null;
            console.log(`[summary] ${sym} chart-meta fallback — PE:${trailingPE} EPS:${trailingEps}`);
            return { sym, data: { trailingEps, forwardEps, trailingPE, forwardPE,
              marketCap: meta.marketCap ?? null, priceToBook: meta.priceToBook ?? null,
              dividendYield: meta.dividendYield ?? null,
              fiftyDayAvg: meta.fiftyDayAverage ?? null, twoHundredDayAvg: meta.twoHundredDayAverage ?? null,
              high52: meta.fiftyTwoWeekHigh ?? null, low52: meta.fiftyTwoWeekLow ?? null,
              roe: null, totalDebt: null, totalEquity: null, epsGrowth: null,
              peg: null, priceTarget: null, sharesOutstanding: null, sector: null, industry: null } };
          }

          console.warn(`[summary] ${sym} no parseable data`);
          return { sym, data: null };
        } catch(e) {
          console.warn(`[summary] ${sym} error:`, e.message);
          return { sym, data: null };
        }
      })())
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) results[r.value.sym] = r.value.data;
    }
  }
  return { ok: true, metas: results };
}

// Indices via v8/chart
const INDEX_MAP = {
  '^NSEI'   : 'nifty50',
  '^NSMIDCP': 'midcap',
  '^NSEBANK': 'banknifty',
  '^CNXSC'  : 'smallcap',
};
async function yahooIndices() {
  const settled = await Promise.allSettled(
    Object.keys(INDEX_MAP).map(sym =>
      yahooChart(sym).then(data => ({ sym, data }))
    )
  );
  const out = {};
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.data) {
      const q   = chartToQuote(r.value.sym, r.value.data);
      const key = INDEX_MAP[r.value.sym];
      if (q && key) out[key] = { price: q.price, change: q.change };
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname, searchParams } = new URL(req.url, `http://localhost:${PORT}`);
  // Log incoming requests for debugging client 404s
  try { console.log('[proxy] >>', req.method, pathname, req.socket && req.socket.remoteAddress); } catch (e) {}

  // /health
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true,
      nse  : { cookies: nse.cookies.length, lastRefresh: nse.lastRefresh },
      yahoo: { mode: 'v8/chart (crumb-free)', ok: true },
    }));
    return;
  }

  // /nse?path=...
  if (pathname === '/nse') {
    const nsePath = searchParams.get('path') || '';
    if (!isNSEAllowed(nsePath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path not allowed' })); return;
    }
    if (Date.now() - nse.lastRefresh > nse.TTL) await warmNSESession();
    try {
      let r = await nseGet(nsePath);
      if (r.status === 401 || r.status === 403) { await warmNSESession(); r = await nseGet(nsePath); }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body);
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /nse/index-symbols?index=NIFTY%20MIDCAP%20150  -- symbol+name list only, cached 24h
  // Used by dashboard on startup to detect quarterly index rebalancing
  if (pathname === '/nse/index-symbols') {
    const index = searchParams.get('index') || '';
    if (!index) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No index' })); return; }
    try {
      const cacheKey = index.toUpperCase();
      const entry = nseIdxCache[cacheKey];
      if (entry && (Date.now() - entry.savedAt) < NSE_IDX_CACHE_TTL) {
        console.log(`[nse-idx-cache] serving ${entry.symbols.length} symbols for "${index}" from cache`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, index, symbols: entry.symbols, fromCache: true }));
        return;
      }
      // Fetch fresh
      const r = await nseGet(`/api/equity-stockIndices?index=${encodeURIComponent(index)}`);
      const items = JSON.parse(r.body)?.data || [];
      const symbols = items
        .map(item => ({ sym: (item.symbol||'').trim().toUpperCase(), name: item.meta?.companyName || item.symbol || '' }))
        .filter(s => s.sym);
      nseIdxCache[cacheKey] = { symbols, savedAt: Date.now() };
      saveNseIdxCache();
      console.log(`[nse-idx-cache] fetched ${symbols.length} symbols for "${index}", saved to cache`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, index, symbols }));
    } catch(e) {
      // Serve stale cache on error
      const cacheKey = index.toUpperCase();
      if (nseIdxCache[cacheKey]) {
        console.warn(`[nse-idx-cache] serving stale cache for "${index}" after error: ${e.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, index, symbols: nseIdxCache[cacheKey].symbols, stale: true }));
      } else {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  // /etf-list  -- return full NSE ETF list (all ~300+ ETFs) with NAV, price, 52W from NSE batch
  if (pathname === '/etf-list') {
    try {
      // Serve from cache if fresh and has fundFamily (invalidate old cache that predates this field)
      if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
        const hasFundFamily = (cached.etfs || []).some(e => e.fundFamily != null);
        if (!hasFundFamily) {
          console.log('[etf-list] cache predates fundFamily — deleting for re-fetch');
          fs.unlinkSync(ETF_LIST_CACHE_FILE);
        } else if (Date.now() - (cached.savedAt || 0) < ETF_LIST_CACHE_TTL) {
          let patchedFamily = false;
          for (const etf of (cached.etfs || [])) {
            if (etf?.sym && etf.fundFamily == null) {
              const family = lookupAMC(etf.sym);
              if (family) { etf.fundFamily = family; patchedFamily = true; }
            }
            if (etf?.sym && etf.expRatio == null && getETFExpenseRatio(etf.sym) != null) {
              etf.expRatio = getETFExpenseRatio(etf.sym);
              patchedFamily = true;
            }
          }
          if (patchedFamily) {
            try {
              fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify(cached, null, 2), 'utf8');
            } catch(e) {
              console.warn('[etf-list] cache family patch save failed:', e.message);
            }
          }
          console.log(`[etf-list] serving ${cached.etfs.length} ETFs from cache (age ${Math.round((Date.now()-cached.savedAt)/60000)}m)`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: cached.etfs.length, etfs: cached.etfs, fromCache: true }));
          return;
        } else {
          console.log('[etf-list] cache stale, refreshing from NSE…');
        }
      }

      // Fetch fresh from NSE — retry up to 3 times on ECONNRESET
      let raw = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const nseRes = await nseGet('/api/etf');
          raw = JSON.parse(nseRes.body)?.data || [];
          break;
        } catch(e) {
          const retryable = e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT';
          if (retryable && attempt < 3) {
            console.warn(`[etf-list] NSE attempt ${attempt}/3 failed (${e.message}), retrying in ${attempt*1500}ms…`);
            await new Promise(r => setTimeout(r, attempt * 1500));
          } else { throw e; }
        }
      }
      const etfs = raw.map(item => {
        const sym     = (item.symbol || item.Symbol || '').trim().toUpperCase();
        const name    = item.companyName || item.name || item.schemeName || sym;
        const price   = parseFloat(item.lastPrice  || item.ltp || item.LTP || 0) || null;
        const nav     = parseFloat(item.iNavValue  || item.nav || item.NAV || 0) || null;
        const high52  = parseFloat(item['52WeekHigh'] || item.yearHigh || 0) || null;
        const low52   = parseFloat(item['52WeekLow']  || item.yearLow  || 0) || null;
        const volume  = parseVolumeField(item);
        const aum     = item.aum || item.AUM || null;
        const expRatio= item.expenseRatio || getETFExpenseRatio(sym);
        const chg     = parseFloat(item.change || item.pChange || 0) || null;
        const chgPct  = parseFloat(item.pChange || item.perChange || 0) || null;
        const navPremium = (nav && price) ? +((( price - nav) / nav) * 100).toFixed(2) : null;
        const sector     = categorizeETF(sym, name);
        const fundFamily = lookupAMC(sym);
        return { sym, name, sector, fundFamily, price, nav, navPremium, high52, low52, volume, aum, expRatio, chg, chgPct };
      }).filter(e => e.sym);

      // Persist to cache file
      fs.writeFileSync(ETF_LIST_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), etfs, meta: etfMetaCache }, null, 2), 'utf8');
      console.log(`[etf-list] fetched ${etfs.length} ETFs from NSE, saved to cache`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: etfs.length, etfs }));
    } catch(e) {
      console.warn('[etf-list] NSE fetch error:', e.message);
      // Try to serve stale cache rather than failing completely
      if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
        try {
          const cached = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          console.warn(`[etf-list] serving stale cache (age ${Math.round((Date.now()-cached.savedAt)/60000)}m) after error`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, count: cached.etfs.length, etfs: cached.etfs, fromCache: true, stale: true }));
          return;
        } catch(_) {}
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /debug-meta?symbol=X  -- dump raw Yahoo chart meta for debugging
  if (pathname === '/debug-meta') {
    const sym = searchParams.get('symbol') || 'RELIANCE';
    try {
      // Try both 1d and 3mo ranges to see which has more fields
      const path1d  = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=1d&includePrePost=false`;
      const path3mo = `/v8/finance/chart/${encodeURIComponent(sym)}.NS?interval=1d&range=3mo&includePrePost=false`;
      const [r1, r3] = await Promise.all([
        httpsGet({ hostname: 'query1.finance.yahoo.com', path: path1d,  method: 'GET', timeout: 12000, headers: YAHOO_HEADERS }),
        httpsGet({ hostname: 'query1.finance.yahoo.com', path: path3mo, method: 'GET', timeout: 12000, headers: YAHOO_HEADERS }),
      ]);
      const meta1d  = JSON.parse(r1.body)?.chart?.result?.[0]?.meta || {};
      const meta3mo = JSON.parse(r3.body)?.chart?.result?.[0]?.meta || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sym, range_1d: meta1d, range_3mo: meta3mo }, null, 2));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /etf-nav?symbols=A,B  -- fetch ETF-specific data: NAV, 52W range, expense ratio via quoteSummary
  if (pathname === '/etf-nav') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await fetchETFData(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo?symbols=...
  if (pathname === '/yahoo') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await yahooQuote(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/indices
  if (pathname === '/yahoo/indices') {
    try {
      const data = await yahooIndices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /sparklines?symbols=A,B  -- 1-month daily closes normalised to % (in-memory cache, 2h TTL)
  if (pathname === '/sparklines') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const results = {};
      const stale = [];
      for (const sym of symbols) {
        if (sparkCache[sym] && (now - sparkCache[sym].t) < SPARK_TTL) {
          results[sym] = sparkCache[sym].v;
        } else {
          stale.push(sym);
        }
      }
      if (stale.length) {
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          const chunk = stale.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(chunk.map(sym => fetchSparkline(sym).then(v => ({ sym, v }))));
          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value?.v) {
              const { sym, v } = r.value;
              results[sym] = v;
              sparkCache[sym] = { v, t: now };
            }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: results }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /etf-summary?symbols=A,B  -- fetch ETF-specific data: NAV, expense ratio, category (slow fields cached 30 days)
  if (pathname === '/etf-summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const results = {};

      // Read etf_list_cache once upfront — used as nav fallback for both cached and fresh fetches
      // (Yahoo quoteSummary rarely returns nav for Indian ETFs like BANKIETF)
      const etfListForSum = {};
      try {
        if (fs.existsSync(ETF_LIST_CACHE_FILE)) {
          const lc = JSON.parse(fs.readFileSync(ETF_LIST_CACHE_FILE, 'utf8'));
          for (const e of (lc.etfs || [])) etfListForSum[e.sym] = e;
        }
      } catch(_) {}

      // ── Cache read: two-tier lookup ─────────────────────────────────────────
      // etfMetaCache  → static fields (TER, category, fundFamily, 1Y/3Y/5Y) — 30d TTL
      // etfSumCache   → oneMonthReturn only — 24h TTL
      // etfListForSum → nav fallback (from NSE batch, always fresh from etf_list_cache.json)
      // A symbol goes to stale[] only when its static meta is missing/expired.
      // staleOneMOnly[] = static fields are fresh but 1M return is >24h old.
      const stale = [];
      const staleOneMOnly = [];
      for (const sym of symbols) {
        const meta     = etfMetaCache[sym];
        const metaFresh = meta && (now - (meta.savedAt || 0)) < ETF_META_TTL;
        const oneMEntry = etfSumCache[sym];
        const oneMFresh = oneMEntry && oneMEntry.version === ETF_SUM_CACHE_VERSION
                          && (now - (oneMEntry.savedAt || 0)) < ETF_1M_RETURN_TTL;

        if (metaFresh) {
          // Assemble result from the two caches + live nav from etfListForSum
          const nav    = etfListForSum[sym]?.nav ?? null;
          const price  = etfListForSum[sym]?.price ?? null;
          const premium = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
          results[sym] = {
            nav, price, premium,
            expenseRatio   : getETFExpenseRatio(sym),
            category       : meta.category       ?? null,
            fundFamily     : meta.fundFamily      ?? lookupAMC(sym),
            ytdReturn      : meta.ytdReturn       ?? null,
            oneMonthReturn : oneMEntry?.oneMonthReturn ?? null,
            oneYearReturn  : meta.oneYearReturn   ?? null,
            threeYearReturn: meta.threeYearReturn ?? null,
            fiveYearReturn : meta.fiveYearReturn  ?? null,
            high52         : etfListForSum[sym]?.high52 ?? null,
            low52          : etfListForSum[sym]?.low52  ?? null,
          };
          if (!oneMFresh) staleOneMOnly.push(sym);
        } else {
          stale.push(sym);
        }
      }
      const hits = symbols.length - stale.length - staleOneMOnly.length;
      if (hits || staleOneMOnly.length)
        console.log(`[etf-cache] ${hits} full-hits, ${staleOneMOnly.length} 1M-stale, ${stale.length} full-miss`);

      // Fetch only stale/missing symbols from Yahoo
      if (stale.length) {

        const hasCrumb = await ensureCrumb();
        const MODULES = 'defaultKeyStatistics,summaryDetail,fundProfile,fundPerformance';
        for (let i = 0; i < stale.length; i += CONCURRENCY) {
          const chunk = stale.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(chunk.map(sym => (async () => {
            try {
              // Base fields from quoteSummary (or chart meta fallback)
              let nav = null, price = null, premium = null, expenseRatio = null,
                  category = null, fundFamily = null, high52 = null, low52 = null,
                  directReturns = {};

              if (hasCrumb && yahooCrumb.value) {
                const path    = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}&crumb=${encodeURIComponent(yahooCrumb.value)}`;
                const headers = { ...YAHOO_HEADERS, 'Cookie': yahooCrumb.cookies };
                let r = await httpsGet({ hostname: 'query1.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status !== 200) r = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 12000, headers });
                if (r.status === 200) {
                  const json   = JSON.parse(r.body);
                  const result = json?.quoteSummary?.result?.[0];
                  if (result) {
                    const stats    = result.defaultKeyStatistics || {};
                    const detail   = result.summaryDetail || {};
                    const profile  = result.fundProfile || {};
                    const performance = result.fundPerformance || {};
                    nav          = stats.nav?.raw ?? stats.navPrice?.raw ?? null;
                    price        = detail.previousClose?.raw ?? null;
                    premium      = (nav && price) ? +((price - nav) / nav * 100).toFixed(2) : null;
                    expenseRatio = profile.annualReportExpenseRatio?.raw ?? stats.annualReportExpenseRatio?.raw ?? null;
                    category     = profile.categoryName ?? null;
                    fundFamily   = profile.family ?? null;
                    high52       = detail.fiftyTwoWeekHigh?.raw ?? null;
                    low52        = detail.fiftyTwoWeekLow?.raw  ?? null;
                    directReturns = parseDirectReturns(performance);
                  }
                }
              }

              // Fallback: static TER table (Yahoo rarely has this for Indian ETFs)
              if (expenseRatio == null) expenseRatio = getETFExpenseRatio(sym);
              // Fallback: static AMC lookup when Yahoo fundProfile.family is null
              if (fundFamily == null) fundFamily = lookupAMC(sym);

              // Fallback: etf_list_cache nav (NSE iNAV) when Yahoo quoteSummary has none
              // Also recompute premium if we now have nav from fallback
              if (nav == null) nav = etfListForSum[sym]?.nav ?? null;
              if (nav && price && premium == null) premium = +((price - nav) / nav * 100).toFixed(2);

              // Prefer Yahoo's direct trailing returns; fall back to local chart-derived values.
              const needsComputedReturns = ['oneMonthReturn', 'ytdReturn', 'oneYearReturn', 'threeYearReturn', 'fiveYearReturn']
                .some(k => directReturns[k] == null);
              const computed = needsComputedReturns ? await computeReturns(sym) : {};
              const oneMonthReturn  = directReturns.oneMonthReturn  ?? computed.oneMonthReturn  ?? null;
              const ytdReturn       = directReturns.ytdReturn       ?? computed.ytdReturn       ?? null;
              const oneYearReturn   = directReturns.oneYearReturn   ?? computed.oneYearReturn   ?? null;
              const threeYearReturn = directReturns.threeYearReturn ?? computed.threeYearReturn ?? null;
              const fiveYearReturn  = directReturns.fiveYearReturn  ?? computed.fiveYearReturn  ?? null;
              if (ytdReturn != null)
                console.log(`[etf-summary] ${sym} 1M=${oneMonthReturn!=null?(oneMonthReturn*100).toFixed(1)+'%':'–'} YTD=${(ytdReturn*100).toFixed(1)}% 1Y=${oneYearReturn!=null?(oneYearReturn*100).toFixed(1)+'%':'–'} source=${directReturns.oneMonthReturn != null ? 'direct' : 'computed'}`);

              return { sym, data: { nav, price, premium, expenseRatio, category, fundFamily, oneMonthReturn, ytdReturn, oneYearReturn, threeYearReturn, fiveYearReturn, high52, low52 } };
            } catch(e) { console.warn(`[etf-summary] ${sym} error:`, e.message); return { sym, data: null }; }
          })()));
          for (const r of settled) {
            if (r.status === 'fulfilled' && r.value?.data) {
              const { sym, data } = r.value;
              results[sym] = data;
              // Write static fields to etfMetaCache (30d TTL in etf_list_cache.json)
              if (data.expenseRatio != null || data.fundFamily != null || data.oneYearReturn != null) {
                etfMetaCache[sym] = {
                  expenseRatio   : data.expenseRatio    ?? null,
                  category       : data.category        ?? null,
                  fundFamily     : data.fundFamily       ?? null,
                  ytdReturn      : data.ytdReturn        ?? null,
                  oneYearReturn  : data.oneYearReturn    ?? null,
                  threeYearReturn: data.threeYearReturn  ?? null,
                  fiveYearReturn : data.fiveYearReturn   ?? null,
                  savedAt        : now,
                };
              }
              // Write 1M return to etfSumCache (24h TTL in etf_summary_cache.json)
              if (data.oneMonthReturn != null) {
                etfSumCache[sym] = { oneMonthReturn: data.oneMonthReturn, savedAt: now, version: ETF_SUM_CACHE_VERSION };
              }
            }
          }
        }
        saveEtfMetaCache();
        saveEtfSumCache();
      } // end if (stale.length)

      // ── Background 1M return refresh ────────────────────────────────────────
      // For symbols with fresh static fields but a stale 1M return (>24h), recompute
      // oneMonthReturn from chart history and update the cache entry in the background.
      // Results are NOT awaited — response has already been built from cached values;
      // the next request will see the fresh 1M return.
      if (staleOneMOnly.length) {
        console.log(`[etf-cache] refreshing 1M return in background for ${staleOneMOnly.length} symbols`);
        (async () => {
          const refreshNow = Date.now();
          for (let i = 0; i < staleOneMOnly.length; i += CONCURRENCY) {
            const chunk = staleOneMOnly.slice(i, i + CONCURRENCY);
            await Promise.allSettled(chunk.map(async sym => {
              try {
                const computed = await computeReturns(sym);
                if (computed.oneMonthReturn == null) return;
                etfSumCache[sym] = { oneMonthReturn: computed.oneMonthReturn, savedAt: refreshNow, version: ETF_SUM_CACHE_VERSION };
                // Also patch into the already-sent results (in-memory only; next request will see it)
                console.log(`[etf-cache] ${sym} 1M return refreshed: ${(computed.oneMonthReturn * 100).toFixed(2)}%`);
              } catch(e) { console.warn(`[etf-cache] 1M refresh error ${sym}:`, e.message); }
            }));
            if (i + CONCURRENCY < staleOneMOnly.length) await new Promise(r => setTimeout(r, 300));
          }
          saveEtfSumCache();
        })().catch(e => console.warn('[etf-cache] background 1M refresh failed:', e.message));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, etfs: results }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/summary?symbols=A,B  -- fetch assetProfile + marketCap metadata (cached 7 days)
  if (pathname === '/yahoo/summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const now = Date.now();
      const metas = {};

      // Serve fresh entries from cache
      const stale = [];
      for (const sym of symbols) {
        const entry = fundCache[sym];
        if (entry && (now - entry.savedAt) < FUND_CACHE_TTL) {
          metas[sym] = entry.data;
        } else {
          stale.push(sym);
        }
      }

      const cacheHits = symbols.length - stale.length;
      if (cacheHits) console.log(`[fund-cache] ${cacheHits} hits, ${stale.length} stale/missing for ${symbols.length} symbols`);

      // Fetch only stale/missing symbols from Yahoo
      if (stale.length) {
        const fetched = await yahooSummary(stale);
        for (const sym of Object.keys(fetched.metas || {})) {
          const data = fetched.metas[sym];
          if (data) {
            metas[sym] = data;
            fundCache[sym] = { data, savedAt: now };
          }
        }
        saveFundCache();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, metas }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Holdings are populated as a side-effect of /etf-summary fetches.
  // This endpoint ONLY serves from cache — no live fetch.
  // /etf-prefs  -- persist custom ETF symbols in workspace
  if (pathname === '/etf-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedETFsFile();
      console.log('[proxy] /etf-prefs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /etf-favs  -- persist ETF favorites in workspace
  if (pathname === '/etf-favs') {
    if (req.method === 'GET') {
      const list = loadSavedETFFavsFile();
      console.log('[proxy] /etf-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-prefs  -- persist custom stock symbols in workspace
  if (pathname === '/stock-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedStocksFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          let toSave = [];
          if (Array.isArray(payload)) {
            // Support array of strings or array of objects { sym, sector, cap }
            if (payload.length && typeof payload[0] === 'string') {
              toSave = payload.map(s => String(s).trim().toUpperCase()).filter(Boolean);
            } else {
              toSave = payload.map(item => {
                if (!item || typeof item === 'string') return null;
                const sym = String(item.sym||item.symbol||'').trim().toUpperCase();
                if (!sym) return null;
                return { sym, sector: item.sector||null, cap: item.cap||null };
              }).filter(Boolean);
            }
          }
          console.log('[proxy] saving stock prefs:', JSON.stringify(toSave));
          saveSavedStocksFile(toSave);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: toSave.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-favs  -- persist Stock favorites in workspace
  if (pathname === '/stock-favs') {
    if (req.method === 'GET') {
      const list = loadSavedStockFavsFile();
      console.log('[proxy] /stock-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedStockFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── Static file serving (serve dashboard and assets from repo) ──
  try {
    // Map '/' -> dashboard HTML
    const safePath = pathname === '/' ? '/nse_midcap_dashboard.html' : pathname;
    // Prevent path traversal
    const resolved = path.normalize(path.join(__dirname, safePath));
    if (!resolved.startsWith(path.join(__dirname, path.sep))) throw new Error('Invalid path');
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      const stream = fs.createReadStream(resolved);
      stream.pipe(res);
      return;
    }
  } catch (e) {
    // fallthrough to 404
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  NSE + Yahoo Finance Proxy → http://localhost:${PORT}  ║
║  Yahoo: v8/finance/chart (crumb-free) ✓          ║
╠══════════════════════════════════════════════════╣
║  GET /health                                     ║
║  GET /nse?path=/api/...     NSE India            ║
║  GET /yahoo?symbols=A,B     Yahoo Finance        ║
║  GET /yahoo/indices         Nifty indices        ║
║  GET /etf-prefs             ETF prefs storage    ║
║  GET /etf-favs              ETF favorites storage ║
║  GET /stock-prefs           Stock prefs storage  ║
║  GET /stock-favs            Stock favorites storage║
║                                                  ║
║  Press Ctrl+C to stop.                           ║
╚══════════════════════════════════════════════════╝
`);
  // Warm NSE session and fetch Yahoo crumb in parallel
  await Promise.all([warmNSESession(), refreshYahooCrumb()]);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⚠  Port ${PORT} already in use. Stop the other process or change PORT.\n`);
    process.exit(1);
  }
});
