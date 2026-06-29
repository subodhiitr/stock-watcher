'use strict';
const fs   = require('fs');
const path = require('path');

const SCRIP_CACHE_FILE = path.join(__dirname, 'cache', 'sharekhan_scrip_codes.json');
const SCRIP_CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 hours

// Build symbol → scripCode map from Sharekhan master response array.
// Keeps only EQ (equity) scripts with valid symbol and non-zero code.
function buildScripCodeMap(masterData = []) {
  const map = new Map();
  for (const item of masterData) {
    if (item.instType !== 'EQ') continue;
    const sym  = String(item.tradingSymbol || '').trim().toUpperCase();
    const code = Number(item.scripCode || 0);
    if (sym && Number.isFinite(code) && code > 0) map.set(sym, code);
  }
  return map;
}

function loadScripCache(cacheFile = SCRIP_CACHE_FILE) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (!raw || Date.now() - Number(raw.savedAt || 0) > SCRIP_CACHE_TTL) return null;
    if (!raw.symbols || typeof raw.symbols !== 'object') return null;
    return new Map(Object.entries(raw.symbols));
  } catch (_) { return null; }
}

function saveScripCache(map, cacheFile = SCRIP_CACHE_FILE) {
  try {
    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const symbols = Object.fromEntries([...map.entries()].map(([k, v]) => [k, v]));
    fs.writeFileSync(cacheFile, JSON.stringify({ savedAt: Date.now(), symbols }, null, 2), 'utf8');
  } catch (_) {}
}

// Parse a single candle from Sharekhan's response (handles multiple field name variants).
function parseCandle(c) {
  const time  = c.time ?? c.datetime ?? c.date ?? c.dt ?? null;
  const open  = Number(c.open  ?? c.o ?? NaN);
  const high  = Number(c.high  ?? c.h ?? NaN);
  const low   = Number(c.low   ?? c.l ?? NaN);
  const close = Number(c.close ?? c.c ?? NaN);
  const vol   = Number(c.volume ?? c.vol ?? c.v ?? NaN);

  let unixSec = null;
  if (typeof time === 'number' && time > 1e9) {
    unixSec = time >= 1e12 ? Math.floor(time / 1000) : time;
  } else if (typeof time === 'string' && time) {
    const ms = Date.parse(time);
    if (Number.isFinite(ms)) unixSec = Math.floor(ms / 1000);
  }

  if (!unixSec || !Number.isFinite(open) || !Number.isFinite(close)) return null;
  return {
    unixSec,
    open,
    high: Number.isFinite(high) ? high : close,
    low:  Number.isFinite(low)  ? low  : close,
    close,
    vol: Number.isFinite(vol) ? vol : 0,
  };
}

// Convert Sharekhan candle array/string into the Yahoo chart result shape
// that buildIntradaySignal expects. Returns null if data is unusable.
function normalizeSharekhanCandles(sym, raw) {
  let candles = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { candles = JSON.parse(raw); } catch (_) { return null; }
  }
  if (candles && !Array.isArray(candles) && Array.isArray(candles.data)) candles = candles.data;
  if (!Array.isArray(candles) || candles.length === 0) return null;

  const parsed = candles.map(parseCandle).filter(Boolean);
  if (parsed.length === 0) return null;

  // Sort ascending by timestamp — Sharekhan may return any order
  parsed.sort((a, b) => a.unixSec - b.unixSec);
  // De-duplicate by timestamp (keep last occurrence)
  const deduped = [];
  const seen = new Set();
  for (const c of parsed) {
    if (seen.has(c.unixSec)) {
      deduped[deduped.findIndex(x => x.unixSec === c.unixSec)] = c;
    } else {
      seen.add(c.unixSec);
      deduped.push(c);
    }
  }

  const timestamps = deduped.map(c => c.unixSec);
  const opens      = deduped.map(c => c.open);
  const highs      = deduped.map(c => c.high);
  const lows       = deduped.map(c => c.low);
  const closes     = deduped.map(c => c.close);
  const volumes    = deduped.map(c => c.vol);

  return {
    meta: {
      regularMarketPrice: closes[closes.length - 1],
      regularMarketOpen:  opens[0],
      previousClose:      null,  // backfilled from Yahoo daily by caller
    },
    timestamp: timestamps,
    indicators: { quote: [{ open: opens, high: highs, low: lows, close: closes, volume: volumes }] },
  };
}

// Fetch 5-min intraday candles for sym using the provided client adapter.
// Returns Yahoo-compatible result object or null (caller should fall back to Yahoo).
async function fetchSharekhanIntraday(sym, client) {
  try {
    const code = await client.getScripCode(sym);
    if (!code || code <= 0) return null;
    const raw = await client.fetchRawCandles('NSE', code, '5');
    const result = normalizeSharekhanCandles(sym, raw);
    return result;
  } catch (err) {
    console.warn(`[sharekhan-intraday] ${sym}: fetch error — ${err?.message || err}`);
    return null;
  }
}

module.exports = { buildScripCodeMap, loadScripCache, saveScripCache, normalizeSharekhanCandles, fetchSharekhanIntraday, SCRIP_CACHE_FILE };
