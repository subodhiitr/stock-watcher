# Sharekhan Intraday Data Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Yahoo Finance as the primary 5-minute intraday OHLC data source with Sharekhan API, keeping Yahoo as automatic fallback.

**Architecture:** A new `sharekhan-intraday.js` module handles scrip code caching (from Sharekhan master API, file-cached 24h) and 5-min candle fetching, normalizing the response to the exact object shape that `buildIntradaySignal` already consumes. `fetchIntradaySignal` in `ticker_proxy.js` tries Sharekhan first; on failure/empty response it falls through to the existing Yahoo path unchanged.

**Tech Stack:** Node.js, `sharekhan-api` npm package (already installed), existing `SharekhanClient` class, `buildIntradaySignal` in `ticker_proxy.js`

**Important known constraints:**
- `getActiveScriptOfDay` SDK method maps to the `master/` endpoint — it works at any time (not just market hours). The real issue causing code=0 was that the file cache was absent on cold start. The fix is persisting the map to disk after first successful fetch.
- Sharekhan `getHistoricalIntervalData` returns empty string/array outside market hours — this is expected and handled by null return → Yahoo fallback.
- Candles from Sharekhan may arrive in any order — always sort ascending by timestamp before use.
- `previousClose` is not available in Sharekhan intraday candles. Must backfill from Yahoo daily fetch. If Yahoo daily also fails, set `previousClose = null` explicitly (NOT `closes[0]`) to avoid silently wrong gap %/day-change calculations.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `sharekhan-intraday.js` | **Create** | Scrip code map (master API, file-cached 24h) + `fetchSharekhanIntraday(sym)` returning Yahoo-compatible result object |
| `sharekhan-client.js` | **Modify** | Expose `getScripCode(sym)` and `fetchRawCandles()` adapter methods; persist scrip code map to disk after first successful master fetch |
| `ticker_proxy.js` | **Modify** | In `fetchIntradaySignal`: try Sharekhan first → fall back to Yahoo if null/error; reuse existing Yahoo query2 retry for daily backfill |
| `test/sharekhan-intraday.test.js` | **Create** | Unit tests for candle normalization (including sort correctness, cold-start, fallback) |

---

## Task 1: Scrip code cache from Sharekhan master

**Why:** `getActiveScriptOfDay` returns 404 outside market hours. The `master` endpoint (same underlying API) works any time and returns 5,245 scripts with `scripCode` + `tradingSymbol`. We need to cache this daily so scrip codes are always available.

**Files:**
- Create: `sharekhan-intraday.js`
- Create: `test/sharekhan-intraday.test.js`

**Context — master API response shape (from live test):**
```js
// Each item looks like:
{ scripCode: 676, tradingSymbol: 'EXIDEIND', instType: 'EQ', isinCode: 'INE302A01020', ... }
```

**Context — scrip code file path:** `cache/sharekhan_scrip_codes.json`
```js
{ savedAt: 1234567890, symbols: { EXIDEIND: 676, ITC: 1660, ... } }
```

- [ ] **Step 1: Write failing test for buildScripCodeMap**

Create `test/sharekhan-intraday.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildScripCodeMap, normalizeSharekhanCandles } = require('../sharekhan-intraday');

test('buildScripCodeMap extracts EQ scripts only and maps symbol → scripCode', () => {
  const masterData = [
    { scripCode: 676,  tradingSymbol: 'EXIDEIND', instType: 'EQ' },
    { scripCode: 1660, tradingSymbol: 'ITC',      instType: 'EQ' },
    { scripCode: 9999, tradingSymbol: 'NIFTY-FUT', instType: 'FU' }, // excluded
    { scripCode: 0,    tradingSymbol: 'BADSCRIPT', instType: 'EQ' }, // excluded (no code)
    { scripCode: 100,  tradingSymbol: '',          instType: 'EQ' }, // excluded (no symbol)
  ];
  const map = buildScripCodeMap(masterData);
  assert.equal(map.get('EXIDEIND'), 676);
  assert.equal(map.get('ITC'), 1660);
  assert.equal(map.has('NIFTY-FUT'), false);
  assert.equal(map.has('BADSCRIPT'), false);
  assert.equal(map.size, 2);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: `Cannot find module '../sharekhan-intraday'`

- [ ] **Step 3: Create `sharekhan-intraday.js` with `buildScripCodeMap`**

```js
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

function loadScripCache() {
  try {
    if (!fs.existsSync(SCRIP_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(SCRIP_CACHE_FILE, 'utf8'));
    if (!raw || Date.now() - Number(raw.savedAt || 0) > SCRIP_CACHE_TTL) return null;
    return new Map(Object.entries(raw.symbols || {}));
  } catch (_) { return null; }
}

function saveScripCache(map) {
  try {
    const dir = path.dirname(SCRIP_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const symbols = Object.fromEntries([...map.entries()].map(([k, v]) => [k, v]));
    fs.writeFileSync(SCRIP_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), symbols }, null, 2), 'utf8');
  } catch (_) {}
}

module.exports = { buildScripCodeMap, loadScripCache, saveScripCache };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: `✔ buildScripCodeMap extracts EQ scripts only...`

- [ ] **Step 5: Commit**

```bash
git add sharekhan-intraday.js test/sharekhan-intraday.test.js
git commit -m "feat: sharekhan-intraday - scrip code map builder and cache"
```

---

## Task 2: Candle normalizer — Sharekhan → Yahoo-compatible result object

**Why:** `buildIntradaySignal(sym, result, dailyContext)` in `ticker_proxy.js` (line 4443) expects `result` in Yahoo chart format:
```js
result = {
  meta: { regularMarketPrice, regularMarketOpen, previousClose },
  timestamp: [unixSec, ...],
  indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] }
}
```

We need to convert Sharekhan's candle array into this exact shape.

**Context — Sharekhan candle format (inferred from API, market-hours only):**
The API returns an array of candles. Based on Sharekhan API patterns and the `intervalHistoric` endpoint, each candle is expected to be:
```js
{ time: "2026-06-27T04:15:00.000Z", open: 390.5, high: 392.0, low: 389.0, close: 391.5, volume: 12500 }
// OR: { datetime: "...", o: 390.5, h: 392.0, l: 389.0, c: 391.5, v: 12500 }
// OR: { dt: 1782500000, open: ..., high: ..., low: ..., close: ..., vol: ... }
```
The normalizer must handle all these variants defensively.

**Files:**
- Modify: `sharekhan-intraday.js`
- Modify: `test/sharekhan-intraday.test.js`

- [ ] **Step 1: Write failing tests for `normalizeSharekhanCandles`**

Append to `test/sharekhan-intraday.test.js`:
```js
test('normalizeSharekhanCandles returns null for empty/invalid input', () => {
  assert.equal(normalizeSharekhanCandles('EXIDEIND', null), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', ''), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', []), null);
  assert.equal(normalizeSharekhanCandles('EXIDEIND', 'not-json'), null);
});

test('normalizeSharekhanCandles converts candle array to Yahoo-compatible result', () => {
  const candles = [
    { time: '2026-06-27T04:15:00.000Z', open: 390.0, high: 392.0, low: 389.0, close: 391.0, volume: 10000 },
    { time: '2026-06-27T04:20:00.000Z', open: 391.0, high: 393.0, low: 390.5, close: 392.5, volume: 12000 },
    { time: '2026-06-27T04:25:00.000Z', open: 392.5, high: 394.0, low: 391.5, close: 393.0, volume: 8000  },
  ];
  const result = normalizeSharekhanCandles('EXIDEIND', candles);
  assert.ok(result, 'result must not be null');
  assert.ok(Array.isArray(result.timestamp), 'must have timestamp array');
  assert.equal(result.timestamp.length, 3);
  assert.ok(Number.isFinite(result.timestamp[0]));  // unix seconds
  assert.deepEqual(result.indicators.quote[0].open,   [390.0, 391.0, 392.5]);
  assert.deepEqual(result.indicators.quote[0].high,   [392.0, 393.0, 394.0]);
  assert.deepEqual(result.indicators.quote[0].low,    [389.0, 390.5, 391.5]);
  assert.deepEqual(result.indicators.quote[0].close,  [391.0, 392.5, 393.0]);
  assert.deepEqual(result.indicators.quote[0].volume, [10000, 12000, 8000]);
  // meta fields derived from candles
  assert.equal(result.meta.regularMarketPrice, 393.0);  // last close
  assert.equal(result.meta.regularMarketOpen,  390.0);  // first open
  assert.equal(result.meta.previousClose,      null);   // not available from Sharekhan candles
});

test('normalizeSharekhanCandles sorts candles ascending by timestamp (reverse-order input)', () => {
  const candles = [
    { time: '2026-06-27T04:25:00.000Z', open: 392.5, high: 394.0, low: 391.5, close: 393.0, volume: 8000  },
    { time: '2026-06-27T04:20:00.000Z', open: 391.0, high: 393.0, low: 390.5, close: 392.5, volume: 12000 },
    { time: '2026-06-27T04:15:00.000Z', open: 390.0, high: 392.0, low: 389.0, close: 391.0, volume: 10000 },
  ];
  const result = normalizeSharekhanCandles('EXIDEIND', candles);
  assert.ok(result);
  // After sort: first open = 390.0 (earliest), last close = 393.0 (latest)
  assert.equal(result.meta.regularMarketOpen,  390.0);
  assert.equal(result.meta.regularMarketPrice, 393.0);
  assert.equal(result.indicators.quote[0].open[0],  390.0);
  assert.equal(result.indicators.quote[0].close[2], 393.0);
  // timestamps should be ascending
  assert.ok(result.timestamp[0] < result.timestamp[1]);
  assert.ok(result.timestamp[1] < result.timestamp[2]);
});
  const candles = [
    { dt: 1782542000, o: 100.0, h: 105.0, l: 99.0, c: 103.0, v: 5000 },
    { dt: 1782542300, o: 103.0, h: 106.0, l: 102.0, c: 105.0, v: 6000 },
  ];
  const result = normalizeSharekhanCandles('ITC', candles);
  assert.ok(result);
  assert.equal(result.timestamp[0], 1782542000);
  assert.equal(result.indicators.quote[0].open[0], 100.0);
  assert.equal(result.indicators.quote[0].close[1], 105.0);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: `✗ normalizeSharekhanCandles returns null for empty/invalid input` (not exported yet)

- [ ] **Step 3: Implement `normalizeSharekhanCandles` in `sharekhan-intraday.js`**

Add after `buildScripCodeMap`:
```js
// Parse a single candle from Sharekhan's response (handles multiple field name variants).
function parseCandle(c) {
  const time  = c.time || c.datetime || c.date || c.dt || null;
  const open  = Number(c.open  ?? c.o ?? NaN);
  const high  = Number(c.high  ?? c.h ?? NaN);
  const low   = Number(c.low   ?? c.l ?? NaN);
  const close = Number(c.close ?? c.c ?? NaN);
  const vol   = Number(c.volume ?? c.vol ?? c.v ?? NaN);

  // Convert time to unix seconds
  let unixSec = null;
  if (typeof time === 'number' && time > 1e9) {
    unixSec = time > 1e12 ? Math.floor(time / 1000) : time;
  } else if (typeof time === 'string' && time) {
    const ms = Date.parse(time);
    if (Number.isFinite(ms)) unixSec = Math.floor(ms / 1000);
  }

  if (!unixSec || !Number.isFinite(open) || !Number.isFinite(close)) return null;
  return { unixSec, open, high: Number.isFinite(high) ? high : close, low: Number.isFinite(low) ? low : close, close, vol: Number.isFinite(vol) ? vol : 0 };
}

// Convert Sharekhan candle array/string into the Yahoo chart result shape
// that buildIntradaySignal expects. Returns null if data is unusable.
function normalizeSharekhanCandles(sym, raw) {
  // Accept string (JSON), array, or object with data property
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
    seen.has(c.unixSec) ? (deduped[deduped.findIndex(x => x.unixSec === c.unixSec)] = c) : (seen.add(c.unixSec), deduped.push(c));
  }

  const timestamps = deduped.map(c => c.unixSec);
  const opens   = deduped.map(c => c.open);
  const highs   = deduped.map(c => c.high);
  const lows    = deduped.map(c => c.low);
  const closes  = deduped.map(c => c.close);
  const volumes = deduped.map(c => c.vol);

  const lastClose = closes[closes.length - 1];
  const firstOpen = opens[0];

  return {
    meta: {
      regularMarketPrice: lastClose,
      regularMarketOpen:  firstOpen,
      previousClose:      null,  // Sharekhan candles don't include prev day close — must backfill from Yahoo daily
    },
    timestamp: timestamps,
    indicators: { quote: [{ open: opens, high: highs, low: lows, close: closes, volume: volumes }] },
  };
}

module.exports = { buildScripCodeMap, loadScripCache, saveScripCache, normalizeSharekhanCandles };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add sharekhan-intraday.js test/sharekhan-intraday.test.js
git commit -m "feat: sharekhan-intraday - candle normalizer to Yahoo-compatible result format"
```

---

## Task 3: `fetchSharekhanIntraday(sym, client)` function

**Why:** This is the function that wires together scrip code lookup + API call + normalization. It returns a Yahoo-compatible result object or `null` (triggering Yahoo fallback). The scrip code map is loaded from cache or fetched fresh from master.

**Files:**
- Modify: `sharekhan-intraday.js`
- Modify: `test/sharekhan-intraday.test.js`

- [ ] **Step 1: Write failing test using a mock client**

Append to `test/sharekhan-intraday.test.js`:
```js
test('fetchSharekhanIntraday returns normalized result when client returns candles', async () => {
  const { fetchSharekhanIntraday } = require('../sharekhan-intraday');
  const mockClient = {
    getScripCode: async (sym) => sym === 'EXIDEIND' ? 676 : 0,
    fetchRawCandles: async (exchange, code, interval) => [
      { time: '2026-06-27T04:15:00.000Z', open: 390, high: 392, low: 389, close: 391, volume: 10000 },
      { time: '2026-06-27T04:20:00.000Z', open: 391, high: 393, low: 390, close: 392, volume: 11000 },
      { time: '2026-06-27T04:25:00.000Z', open: 392, high: 394, low: 391, close: 393, volume: 12000 },
      { time: '2026-06-27T04:30:00.000Z', open: 393, high: 395, low: 392, close: 394, volume: 9000  },
      { time: '2026-06-27T04:35:00.000Z', open: 394, high: 396, low: 393, close: 395, volume: 8000  },
      { time: '2026-06-27T04:40:00.000Z', open: 395, high: 397, low: 394, close: 396, volume: 7000  },
    ],
  };
  const result = await fetchSharekhanIntraday('EXIDEIND', mockClient);
  assert.ok(result, 'must return result');
  assert.equal(result.indicators.quote[0].close.length, 6);
  assert.equal(result.meta.regularMarketPrice, 396);
});

test('fetchSharekhanIntraday returns null when scrip code not found', async () => {
  const { fetchSharekhanIntraday } = require('../sharekhan-intraday');
  const mockClient = {
    getScripCode: async () => 0,
    fetchRawCandles: async () => { throw new Error('should not be called'); },
  };
  const result = await fetchSharekhanIntraday('UNKNOWN', mockClient);
  assert.equal(result, null);
});

test('fetchSharekhanIntraday returns null when API returns empty', async () => {
  const { fetchSharekhanIntraday } = require('../sharekhan-intraday');
  const mockClient = {
    getScripCode: async () => 676,
    fetchRawCandles: async () => [],
  };
  const result = await fetchSharekhanIntraday('EXIDEIND', mockClient);
  assert.equal(result, null);
});

test('fetchSharekhanIntraday returns null on API error (triggers fallback)', async () => {
  const { fetchSharekhanIntraday } = require('../sharekhan-intraday');
  const mockClient = {
    getScripCode: async () => 676,
    fetchRawCandles: async () => { throw new Error('network error'); },
  };
  const result = await fetchSharekhanIntraday('EXIDEIND', mockClient);
  assert.equal(result, null);
});

test('fetchSharekhanIntraday returns null on cold-start when getScripCode throws (outside market hours, no cache)', async () => {
  const { fetchSharekhanIntraday } = require('../sharekhan-intraday');
  const mockClient = {
    getScripCode: async () => { throw new Error('404 not found'); },
    fetchRawCandles: async () => { throw new Error('should not be called'); },
  };
  const result = await fetchSharekhanIntraday('EXIDEIND', mockClient);
  assert.equal(result, null); // graceful null → Yahoo fallback
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: new tests fail with "fetchSharekhanIntraday is not a function"

- [ ] **Step 3: Add `fetchSharekhanIntraday` to `sharekhan-intraday.js`**

Add before `module.exports`:
```js
// Fetch 5-min intraday candles for sym using the provided client adapter.
// Client must implement: getScripCode(sym) → Promise<number>, fetchRawCandles(exchange, code, interval) → Promise<array|string>
// Returns Yahoo-compatible result object or null (caller should fall back to Yahoo).
async function fetchSharekhanIntraday(sym, client) {
  try {
    const code = await client.getScripCode(sym);
    if (!code || code <= 0) return null;
    const raw = await client.fetchRawCandles('NSE', code, '5');
    return normalizeSharekhanCandles(sym, raw);
  } catch (_) {
    return null;
  }
}
```

Update `module.exports`:
```js
module.exports = { buildScripCodeMap, loadScripCache, saveScripCache, normalizeSharekhanCandles, fetchSharekhanIntraday };
```

- [ ] **Step 4: Run all tests to confirm they pass**

```bash
node --test test/sharekhan-intraday.test.js
```
Expected: all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add sharekhan-intraday.js test/sharekhan-intraday.test.js
git commit -m "feat: sharekhan-intraday - fetchSharekhanIntraday with null fallback on error/empty"
```

---

## Task 4: Add `getScripCode` and `fetchRawCandles` to `sharekhan-client.js`

**Why:** `SharekhanClient` needs to expose the two methods the `fetchSharekhanIntraday` adapter contract requires. **Note:** `getActiveScriptOfDay` already calls the `master/` endpoint — it works at any time. The real problem was that scrip codes were never persisted to disk, so every server restart needed a fresh API call. The fix is persisting the map to `cache/sharekhan_scrip_codes.json` after first successful fetch so cold starts resolve scrip codes instantly from disk.

**Files:**
- Modify: `sharekhan-client.js`

**Context:**
- Current broken path: `ensureSymbolCodeMap` → `getActiveScriptOfDay` → 404 outside hours
- New path: `ensureSymbolCodeMap` → `getActiveScriptOfDay` (master) but now using `buildScripCodeMap` from `sharekhan-intraday.js` and file cache

- [ ] **Step 1: Modify `sharekhan-client.js`**

At top, add require:
```js
const { buildScripCodeMap, loadScripCache, saveScripCache } = require('./sharekhan-intraday');
```

Replace the entire `ensureSymbolCodeMap` method (lines 77-95):
```js
async ensureSymbolCodeMap(exchange = 'NC') {
  const now = Date.now();
  // Return early if in-memory cache is fresh
  if (this.symbolCodeCache.size && now - this.symbolCacheUpdatedAt < this.symbolCacheTtlMs) return;
  // Try file cache first (avoids API call on every server start)
  const cached = loadScripCache();
  if (cached && cached.size) {
    this.symbolCodeCache = cached;
    this.symbolCacheUpdatedAt = now;
    return;
  }
  // Fetch from master endpoint (works any time, unlike getActiveScriptOfDay)
  try {
    const result = await this.withAuthRetry(() => this.client.getActiveScriptOfDay(exchange));
    const payload = this.parseResponse(result);
    const list = Array.isArray(payload) ? payload
      : (Array.isArray(payload?.data) ? payload.data
      : (Array.isArray(payload?.result) ? payload.result : []));
    const nextMap = buildScripCodeMap(list);
    if (nextMap.size) {
      this.symbolCodeCache = nextMap;
      this.symbolCacheUpdatedAt = now;
      saveScripCache(nextMap);
    }
  } catch (_) {}
}
```

Add new methods after `resolveScripCode`:
```js
// Adapter method for fetchSharekhanIntraday contract
async getScripCode(symbol) {
  return this.resolveScripCode(symbol, 'NC');
}

// Adapter method for fetchSharekhanIntraday contract
// Returns raw candle data (array, string, or empty array on market-closed)
async fetchRawCandles(exchange, scripCode, interval) {
  try {
    const res = await this.withAuthRetry(() =>
      this.client.getHistoricalIntervalData(exchange, scripCode, interval)
    );
    const data = this.parseResponse(res);
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (typeof data === 'string') return data; // normalizer handles string
    return [];
  } catch (_) {
    return [];
  }
}
```

- [ ] **Step 2: Run existing tests to confirm no regressions**

```bash
npm test
```
Expected: same pass/fail count as baseline (80 pass, 7 pre-existing failures)

- [ ] **Step 3: Commit**

```bash
git add sharekhan-client.js
git commit -m "feat: sharekhan-client - add getScripCode/fetchRawCandles adapter methods; use file-cached master for scrip codes"
```

---

## Task 5: Wire Sharekhan into `fetchIntradaySignal` with Yahoo fallback

**Why:** This is the integration point. `fetchIntradaySignal` in `ticker_proxy.js` currently goes straight to Yahoo. We want it to try Sharekhan first (if `sharekhanClientLive` exists), and fall back to Yahoo if Sharekhan returns null.

**Files:**
- Modify: `ticker_proxy.js` (lines 4775-4823)

- [ ] **Step 1: Add require at the top of ticker_proxy.js**

Find the require block near the top (around line 53) and add:
```js
const { fetchSharekhanIntraday } = require('./sharekhan-intraday');
```

- [ ] **Step 2: Modify `fetchIntradaySignal` to try Sharekhan first**

In `ticker_proxy.js`, find `fetchIntradaySignal` (line 4775). Replace the try block opening to add Sharekhan-first logic:

```js
async function fetchIntradaySignal(sym) {
  const now = Date.now();
  if (intradaySignalCache[sym] && (now - intradaySignalCache[sym].t) < INTRADAY_SIGNAL_TTL) {
    return intradaySignalCache[sym].v;
  }

  // Try Sharekhan first (real-time, no delay) — fall back to Yahoo on null/error
  if (sharekhanClientLive) {
    try {
      const skResult = await fetchSharekhanIntraday(sym, sharekhanClientLive);
      if (skResult) {
        // Sharekhan candles don't include prev-day context — fetch Yahoo daily for levels
        // Use same query1→query2 retry pattern as existing Yahoo path
        const yahooSym = resolveNseSymbol(sym);
        const dailyPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=1d&range=1mo&includePrePost=false`;
        let daily = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS })
          .catch(() => ({ status: 0, body: null }));
        if (daily.status !== 200) {
          daily = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS })
            .catch(() => ({ status: 0, body: null }));
        }
        const dailyResult = daily?.status === 200 ? JSON.parse(daily.body)?.chart?.result?.[0] : null;
        // Backfill previousClose — explicitly set null if unavailable (NOT closes[0])
        skResult.meta.previousClose = dailyResult?.meta?.previousClose ?? null;
        const signal = buildIntradaySignal(sym, skResult, buildDailyTradeContext(dailyResult));
        if (signal) {
          signal.dataSource = 'sharekhan';
          intradaySignalCache[sym] = { v: signal, t: now };
          return signal;
        }
      }
    } catch (_) {
      // Sharekhan failed — fall through to Yahoo
    }
  }

  // Yahoo Finance fallback (original path unchanged)
  try {
    const yahooSym = resolveNseSymbol(sym);
    // ... (rest of existing Yahoo code unchanged)
```

**Important:** The `// ... (rest of existing Yahoo code unchanged)` comment means you leave the rest of the existing try block exactly as-is. Only add the Sharekhan block before the existing Yahoo `try {`.

- [ ] **Step 3: Run all tests**

```bash
npm test
```
Expected: same pass/fail count (80 pass, 7 pre-existing failures). The Sharekhan path only activates if `sharekhanClientLive` is non-null.

- [ ] **Step 4: Verify `dataSource` field appears in intraday signals when Sharekhan is active**

During market hours, test manually:
```bash
curl -s "http://localhost:3001/intraday-signals?symbols=EXIDEIND" | node -e "
process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{ const j=JSON.parse(d); console.log('dataSource:', j.data?.EXIDEIND?.dataSource); });
"
```
Expected: `dataSource: 'sharekhan'` when Sharekhan candles are available, or `undefined`/missing when falling back to Yahoo.

- [ ] **Step 5: Commit**

```bash
git add ticker_proxy.js
git commit -m "feat: use Sharekhan 5m candles as primary intraday source; Yahoo as fallback

When sharekhanClientLive is initialized, fetchIntradaySignal tries Sharekhan
getHistoricalIntervalData first. Falls back to Yahoo if Sharekhan returns null
(scrip code not found, empty response, or any error). Yahoo daily candles are
still fetched for prev-day levels (pivot, 5D/20D high-low) regardless of source.
Signals include dataSource='sharekhan' when Sharekhan data is used."
```

---

## Testing During Market Hours

The Sharekhan candle API returns empty outside market hours (9:15–15:30 IST, Mon–Fri). During market hours, verify:

1. `dataSource: 'sharekhan'` appears in signals for symbols with valid scrip codes
2. Simulation candidates show non-stale data (`stale: false`)
3. Symbols not in Sharekhan universe (ETFs, newly listed) fall back to Yahoo transparently
4. Server logs show no errors from the Sharekhan path

---

## Rollback

If Sharekhan API becomes unreliable, set `sharekhanClientLive = null` temporarily (or stop Sharekhan credentials from loading) — all symbols automatically fall back to Yahoo with zero code changes.
