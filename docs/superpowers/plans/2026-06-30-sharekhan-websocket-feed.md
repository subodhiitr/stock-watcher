# Sharekhan WebSocket Live Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-working Sharekhan REST candle fetch with a persistent WebSocket feed that streams real-time ticks, aggregates them into 5-min OHLCV candles, and pushes updates directly into `intradayLiveCache` so signals update in near real-time instead of every 60 seconds.

**Architecture:** A new `sharekhan-ticker.js` manages a single persistent WebSocket connection to Sharekhan's feed, aggregates raw ticks into 5-min candles per scripCode, and calls a provided `onCandleUpdate(sym, candles)` callback whenever a bar closes or the current bar updates. `ticker_proxy.js` starts/stops the ticker alongside `sharekhanClientLive`, and the callback directly triggers `fetchIntradaySignal` → `intradayLiveCache` update for affected symbols — bypassing the 60s Yahoo poll cycle. The existing Yahoo Finance path remains as a fallback when the ticker has no data yet.

**Tech Stack:** `sharekhan-api/lib` WebSocket class, existing `buildYahooShapeFromCandles` helper (extracted from `sharekhan-intraday.js`), existing `buildIntradaySignal` + `intradayLiveCache` pipeline.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `sharekhan-ticker.js` | **Create** | WebSocket connection, tick aggregation → 5-min candles, reconnect, `onCandleUpdate` callback |
| `sharekhan-intraday.js` | **Modify** | Export `buildYahooShapeFromCandles` (extracted from `normalizeSharekhanCandles`) |
| `ticker_proxy.js` | **Modify** | Start/stop ticker, subscribe universe, push WS candles into `intradayLiveCache` in real-time |
| `tests/sharekhan-ticker.test.js` | **Create** | Unit tests for `parseTickTime` and tick aggregation |

---

## Task 1: Extract `buildYahooShapeFromCandles` from `sharekhan-intraday.js`

The ticker will produce `{unixSec, open, high, low, close, vol}[]` candles identical to those in `normalizeSharekhanCandles`. Extract the final array→Yahoo-shape step so both share it.

**Files:**
- Modify: `sharekhan-intraday.js`
- Create: `tests/sharekhan-ticker.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/sharekhan-ticker.test.js`:

```js
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildYahooShapeFromCandles } = require('../sharekhan-intraday');

test('buildYahooShapeFromCandles returns null for empty input', () => {
  assert.equal(buildYahooShapeFromCandles('TEST', []), null);
});

test('buildYahooShapeFromCandles returns correct Yahoo-shape', () => {
  const candles = [
    { unixSec: 1000, open: 100, high: 105, low: 99, close: 103, vol: 500 },
    { unixSec: 1300, open: 103, high: 107, low: 102, close: 106, vol: 800 },
  ];
  const result = buildYahooShapeFromCandles('TEST', candles);
  assert.ok(result);
  assert.deepEqual(result.timestamp, [1000, 1300]);
  assert.deepEqual(result.indicators.quote[0].open,  [100, 103]);
  assert.deepEqual(result.indicators.quote[0].close, [103, 106]);
  assert.equal(result.meta.regularMarketPrice, 106);
  assert.equal(result.meta.regularMarketOpen, 100);
  assert.equal(result.meta.previousClose, null);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: `TypeError: buildYahooShapeFromCandles is not a function`

- [ ] **Step 3: Extract the function in `sharekhan-intraday.js`**

Add after `saveScripCache`:

```js
// Convert a sorted, deduped candle array into the Yahoo chart result shape.
// Input: [{ unixSec, open, high, low, close, vol }, ...]
// Output: Yahoo-compatible result object, or null if input is empty.
function buildYahooShapeFromCandles(sym, candles) {
  if (!Array.isArray(candles) || candles.length === 0) return null;
  return {
    meta: {
      regularMarketPrice: candles[candles.length - 1].close,
      regularMarketOpen:  candles[0].open,
      previousClose:      null,
    },
    timestamp: candles.map(c => c.unixSec),
    indicators: { quote: [{ open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close), volume: candles.map(c => c.vol) }] },
  };
}
```

Simplify the bottom of `normalizeSharekhanCandles` — replace the 10-line array-building block with:

```js
  return buildYahooShapeFromCandles(sym, deduped);
```

Add to `module.exports`:
```js
module.exports = { buildScripCodeMap, loadScripCache, saveScripCache, normalizeSharekhanCandles, fetchSharekhanIntraday, buildYahooShapeFromCandles, SCRIP_CACHE_FILE };
```

- [ ] **Step 4: Run tests to confirm they pass**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: `✔ buildYahooShapeFromCandles returns null for empty input` and `✔ buildYahooShapeFromCandles returns correct Yahoo-shape`

- [ ] **Step 5: Commit**

```
git add sharekhan-intraday.js tests/sharekhan-ticker.test.js
git commit -m "refactor: extract buildYahooShapeFromCandles from sharekhan-intraday"
```

---

## Task 2: `parseTickTime` utility with IST-aware 5-min bucketing

Sharekhan tick `lastUpdatedTime` is `"MM/DD/YYYY HH:MM:SS"` (verified from live data: `"06/30/2026 13:48:20"` — month first, not day first). Floor to the 5-min bar start in IST.

**Files:**
- Create: `sharekhan-ticker.js` (stub with just `parseTickTime`)
- Modify: `tests/sharekhan-ticker.test.js`

- [ ] **Step 1: Write failing tests for `parseTickTime`**

Append to `tests/sharekhan-ticker.test.js`:

```js
const { parseTickTime } = require('../sharekhan-ticker');

test('parseTickTime floors to 5-min bar start (unix seconds)', () => {
  // "06/30/2026 09:32:45" IST → bar start 09:30:00 IST
  // IST = UTC+5:30, so 09:30 IST = 04:00 UTC
  const result = parseTickTime('06/30/2026 09:32:45');
  assert.ok(result !== null);
  // Bar should be same as 09:30:00 IST
  const barStart = parseTickTime('06/30/2026 09:30:00');
  assert.equal(result, barStart);
});

test('parseTickTime returns different bar for different 5-min window', () => {
  const bar1 = parseTickTime('06/30/2026 09:30:00');
  const bar2 = parseTickTime('06/30/2026 09:35:00');
  assert.ok(bar1 !== null && bar2 !== null);
  assert.equal(bar2 - bar1, 300); // 5 minutes = 300 seconds
});

test('parseTickTime returns null for invalid input', () => {
  assert.equal(parseTickTime(null), null);
  assert.equal(parseTickTime('0'), null);
  assert.equal(parseTickTime('bad'), null);
});
```

- [ ] **Step 2: Run to confirm failure**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: `Error: Cannot find module '../sharekhan-ticker'`

- [ ] **Step 3: Create `sharekhan-ticker.js` with `parseTickTime`**

`lastUpdatedTime` is IST wall-clock (`"06/30/2026 13:48:20"`). Convert to true UTC first by subtracting the IST offset (5h30m = 19800 seconds), then floor to 5-min bar. The result is a UTC unix-seconds bar key — consistent with how the rest of the codebase uses timestamps.

```js
'use strict';

const BAR_MINUTES = 5;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19800000 ms

// Parse Sharekhan tick lastUpdatedTime "MM/DD/YYYY HH:MM:SS" (IST wall-clock) →
// UTC unix seconds of the 5-min bar start.
// Returns null for invalid/zero input.
function parseTickTime(str) {
  if (!str || str === '0') return null;
  const m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  // Interpret fields as IST, convert to UTC
  const istMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
  if (!Number.isFinite(istMs)) return null;
  const utcMs = istMs - IST_OFFSET_MS;
  // Floor to 5-min bar boundary in UTC
  return Math.floor(utcMs / (BAR_MINUTES * 60 * 1000)) * (BAR_MINUTES * 60);
}

module.exports = { parseTickTime };
```

**Update the tests** to use concrete UTC expectations:

```js
test('parseTickTime floors to 5-min bar start (unix seconds)', () => {
  // "06/30/2026 09:32:45" IST = 04:02:45 UTC → bar start 04:00:00 UTC
  const result = parseTickTime('06/30/2026 09:32:45');
  assert.ok(result !== null);
  const barStart = parseTickTime('06/30/2026 09:30:00'); // 04:00 UTC
  assert.equal(result, barStart);
  // Verify it's actually 04:00 UTC on that date
  assert.equal(new Date(result * 1000).toISOString(), '2026-06-30T04:00:00.000Z');
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: all `parseTickTime` tests pass (plus the earlier `buildYahooShapeFromCandles` tests).

- [ ] **Step 5: Commit**

```
git add sharekhan-ticker.js tests/sharekhan-ticker.test.js
git commit -m "feat: add parseTickTime for Sharekhan 5-min bar bucketing"
```

---

## Task 3: Full `SharekhanTicker` class with candle aggregation

**Files:**
- Modify: `sharekhan-ticker.js`
- Modify: `tests/sharekhan-ticker.test.js`

- [ ] **Step 1: Write failing aggregation tests**

Append to `tests/sharekhan-ticker.test.js`:

```js
const { SharekhanTicker } = require('../sharekhan-ticker');

test('processTick builds first candle from tick (open = first ltp)', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 1000, lastUpdatedTime: '06/30/2026 09:30:10' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.ok(Array.isArray(candles) && candles.length === 1);
  assert.equal(candles[0].open, 100);
  assert.equal(candles[0].close, 100);
  assert.equal(candles[0].high, 100);
  assert.equal(candles[0].low, 100);
});

test('processTick updates same candle for same 5-min bar', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 108, qty: 700, lastUpdatedTime: '06/30/2026 09:32:45' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].open, 100);   // first ltp in bar
  assert.equal(candles[0].close, 108);  // last ltp in bar
  assert.equal(candles[0].high, 108);
  assert.equal(candles[0].low, 100);
  assert.equal(candles[0].vol, 700);    // latest cumulative qty
});

test('processTick closes bar and opens new one on 5-min boundary', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 106, qty: 900, lastUpdatedTime: '06/30/2026 09:35:20' });
  const candles = ticker.getCandlesWithOpenBar(2885);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].close, 100);  // closed bar
  assert.equal(candles[1].open, 106);   // new bar open = first ltp
  assert.equal(candles[1].close, 106);
});

test('getCandlesWithOpenBar returns null for unknown scripCode', () => {
  const ticker = new SharekhanTicker({ accessToken: 'fake' });
  assert.equal(ticker.getCandlesWithOpenBar(9999), null);
});

test('onCandleUpdate callback is called on tick', () => {
  let called = false;
  let cbSym, cbCandles;
  const ticker = new SharekhanTicker({
    accessToken: 'fake',
    scripToSymbol: new Map([[2885, 'RELIANCE']]),
    onCandleUpdate: (sym, candles) => { called = true; cbSym = sym; cbCandles = candles; },
  });
  ticker._processTick({ exchangeCode: 'NC', scripCode: 2885, ltp: 100, qty: 500, lastUpdatedTime: '06/30/2026 09:30:10' });
  assert.ok(called);
  assert.equal(cbSym, 'RELIANCE');
  assert.ok(Array.isArray(cbCandles) && cbCandles.length === 1);
});
```

- [ ] **Step 2: Run to confirm failure**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: `TypeError: SharekhanTicker is not a constructor`

- [ ] **Step 3: Implement full `SharekhanTicker` class in `sharekhan-ticker.js`**

Replace the entire file content with:

```js
'use strict';
const { WebSocket } = require('sharekhan-api/lib');

const BAR_MINUTES = 5;
const MAX_CANDLES = 80; // slightly over full trading day of 5-min bars
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19800000 ms

// Parse Sharekhan lastUpdatedTime "MM/DD/YYYY HH:MM:SS" (IST wall-clock) →
// UTC unix seconds of the 5-min bar start. Returns null for invalid/zero input.
function parseTickTime(str) {
  if (!str || str === '0') return null;
  const m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  const istMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
  if (!Number.isFinite(istMs)) return null;
  const utcMs = istMs - IST_OFFSET_MS; // convert IST wall-clock → true UTC
  return Math.floor(utcMs / (BAR_MINUTES * 60 * 1000)) * (BAR_MINUTES * 60);
}

class SharekhanTicker {
  /**
   * @param {object} config
   * @param {string}   config.accessToken       - Sharekhan access token
   * @param {Map}      [config.scripToSymbol]   - Map<scripCode, symbol> for callback
   * @param {function} [config.onCandleUpdate]  - (symbol, candles[]) called on every tick
   */
  constructor(config = {}) {
    this.accessToken = String(config.accessToken || '');
    // Map<number, string>: scripCode → NSE symbol (e.g. 2885 → 'RELIANCE')
    this.scripToSymbol = config.scripToSymbol instanceof Map ? config.scripToSymbol : new Map();
    this.onCandleUpdate = typeof config.onCandleUpdate === 'function' ? config.onCandleUpdate : null;

    // scripCode(number) → candle[]  (closed bars only)
    this._closedBars = new Map();
    // scripCode(number) → current open bar { unixSec, open, high, low, close, vol }
    this._openBar = new Map();

    this._ws = null;
    this._connected = false;
    this._subscribedCodes = new Set();
    this._reconnectTimer = null;
    this._reconnectDelayMs = 5000;
    this._stopped = false;
  }

  // --- Public API ---

  // Returns all candles including the current open bar, or null if no data yet.
  getCandlesWithOpenBar(scripCode) {
    const code = Number(scripCode);
    const closed = this._closedBars.get(code) || [];
    const open = this._openBar.get(code);
    if (!open && !closed.length) return null;
    return open ? [...closed, { ...open }] : closed.slice();
  }

  // Subscribe to live feed for these scripCodes (iterable of numbers).
  // Also registers the sym→code mapping if provided as Map.
  subscribe(scripCodes, symMap = null) {
    const newCodes = [];
    for (const c of scripCodes) {
      const code = Number(c);
      if (!this._subscribedCodes.has(code)) {
        this._subscribedCodes.add(code);
        newCodes.push(code);
      }
    }
    if (symMap instanceof Map) {
      for (const [sym, code] of symMap) this.scripToSymbol.set(Number(code), String(sym));
    }
    if (newCodes.length && this._connected) this._sendFeed(newCodes);
  }

  start() {
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { try { this._ws.disconnect?.(); } catch (_) {} this._ws = null; }
    this._connected = false;
    console.log('[sharekhan-ticker] Stopped');
  }

  updateToken(newToken) {
    const token = String(newToken || '').trim();
    if (!token || token === this.accessToken) return;
    this.accessToken = token;
    console.log('[sharekhan-ticker] Token updated — reconnecting');
    if (this._ws) { try { this._ws.disconnect?.(); } catch (_) {} this._ws = null; }
    this._connected = false;
    if (!this._stopped) this._connect();
  }

  // --- Internal ---

  _connect() {
    if (this._stopped) return;
    try {
      this._ws = new WebSocket({ access_token: this.accessToken });
      this._ws.connect().then(() => {
        this._connected = true;
        console.log('[sharekhan-ticker] Connected');
        this._ws.subscribe({ action: 'subscribe', key: ['feed'], value: [''] });
        if (this._subscribedCodes.size) this._sendFeed([...this._subscribedCodes]);
        this._ws.on('tick', raw => this._onTick(raw));
        this._ws.on('error', e => {
          console.warn('[sharekhan-ticker] WS error:', e?.message || e);
          this._scheduleReconnect();
        });
      }).catch(e => {
        console.warn('[sharekhan-ticker] Connect failed:', e?.message || e);
        this._connected = false;
        this._scheduleReconnect();
      });
    } catch (e) {
      console.warn('[sharekhan-ticker] Connect exception:', e?.message || e);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._stopped || this._reconnectTimer) return;
    this._connected = false;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this._reconnectDelayMs);
  }

  _sendFeed(codes) {
    if (!codes.length || !this._ws) return;
    try {
      this._ws.fetchData({ action: 'feed', key: ['ltp'], value: codes.map(c => `NC${c}`) });
    } catch (e) {
      console.warn('[sharekhan-ticker] fetchData failed:', e?.message);
    }
  }

  _onTick(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const data = parsed?.data;
      if (!data) return;
      const ticks = Array.isArray(data) ? data : [data];
      for (const tick of ticks) {
        if (tick && typeof tick === 'object' && tick.exchangeCode === 'NC' && tick.scripCode) {
          this._processTick(tick);
        }
      }
    } catch (_) {}
  }

  _processTick(tick) {
    const code = Number(tick.scripCode);
    const ltp = Number(tick.ltp);
    if (!code || !Number.isFinite(ltp) || ltp <= 0) return;

    const barSec = parseTickTime(tick.lastUpdatedTime)
      ?? Math.floor(Date.now() / (BAR_MINUTES * 60 * 1000)) * (BAR_MINUTES * 60);
    const vol = Number(tick.qty) || 0;

    let openBar = this._openBar.get(code);

    if (!openBar || openBar.unixSec !== barSec) {
      // Close the previous bar into history
      if (openBar) {
        const closed = this._closedBars.get(code) || [];
        closed.push({ ...openBar });
        if (closed.length > MAX_CANDLES) closed.shift();
        this._closedBars.set(code, closed);
      }
      // Open new bar — first ltp is the open
      openBar = { unixSec: barSec, open: ltp, high: ltp, low: ltp, close: ltp, vol };
      this._openBar.set(code, openBar);
    } else {
      openBar.high  = Math.max(openBar.high, ltp);
      openBar.low   = Math.min(openBar.low, ltp);
      openBar.close = ltp;
      openBar.vol   = vol; // Sharekhan qty is cumulative for the day
    }

    // Fire callback with all candles including updated open bar
    if (this.onCandleUpdate) {
      const sym = this.scripToSymbol.get(code);
      if (sym) {
        const closed = this._closedBars.get(code) || [];
        this.onCandleUpdate(sym, [...closed, { ...openBar }]);
      }
    }
  }
}

module.exports = { SharekhanTicker, parseTickTime };
```

- [ ] **Step 4: Run tests to confirm they all pass**

```
node --test tests/sharekhan-ticker.test.js
```
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```
git add sharekhan-ticker.js tests/sharekhan-ticker.test.js
git commit -m "feat: SharekhanTicker WebSocket tick aggregator with candle building"
```

---

## Task 4: Wire ticker into `ticker_proxy.js` — real-time cache push

The key design: the `onCandleUpdate` callback directly triggers `fetchIntradaySignal` for that symbol and updates `intradayLiveCache` — bypassing the 60s polling loop entirely.

**Files:**
- Modify: `ticker_proxy.js`

- [ ] **Step 1: Import at the top of `ticker_proxy.js`**

Find:
```js
const { fetchSharekhanIntraday } = require('./sharekhan-intraday');
```
Replace with:
```js
const { fetchSharekhanIntraday, buildYahooShapeFromCandles } = require('./sharekhan-intraday');
const { SharekhanTicker } = require('./sharekhan-ticker');
```

- [ ] **Step 2: Add ticker instance variable near other Sharekhan vars**

Find `let sharekhanClientLive = null;`, add below:
```js
let sharekhanTicker = null;
```

- [ ] **Step 3: Build a helper to push WS candles into the live cache**

Add near the `fetchIntradaySignal` function (around line 5501):

```js
// Called by SharekhanTicker.onCandleUpdate — pushes real-time candles directly into
// intradayLiveCache, bypassing the 60s Yahoo poll for this symbol.
async function pushSharekhanTickerCandles(sym, candles) {
  try {
    const skResult = buildYahooShapeFromCandles(sym, candles);
    if (!skResult) return; // no candles yet
    // Fetch Yahoo daily once for prev-close / daily context (cached for 2 min)
    const yahooSym = resolveNseSymbol(sym);
    const dailyPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}.NS?interval=1d&range=1mo&includePrePost=false`;
    let daily = await httpsGet({ hostname: 'query1.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
    if (daily.status !== 200) {
      daily = await httpsGet({ hostname: 'query2.finance.yahoo.com', path: dailyPath, method: 'GET', timeout: 20000, headers: YAHOO_HEADERS }).catch(() => ({ status: 0, body: null }));
    }
    const dailyResult = daily?.status === 200
      ? (() => { try { return JSON.parse(daily.body)?.chart?.result?.[0] ?? null; } catch (_) { return null; } })()
      : null;
    const closes = skResult.indicators?.quote?.[0]?.close || [];
    skResult.meta.previousClose = dailyResult?.meta?.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : null) ?? undefined;
    const signal = buildIntradaySignal(sym, skResult, buildDailyTradeContext(dailyResult));
    if (!signal) return;
    signal.dataSource = 'sharekhan-ws';
    // Update signal cache and live cache — same path as fetchIntradaySignal
    intradaySignalCache[sym] = { v: signal, t: Date.now() };
    const nextValue = normalizeIntradayLiveSignal(sym, signal);
    const prev = intradayLiveCache.get(sym);
    intradayLiveCache.set(sym, nextValue);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(nextValue)) {
      broadcastIntradayLive('sharekhan-ws-tick', [sym]);
    }
  } catch (e) {
    console.warn(`[sharekhan-ticker] pushCandles ${sym}:`, e.message);
  }
}
```

- [ ] **Step 4: Start ticker in `initializeSharekhan()`**

Find the end of `initializeSharekhan()`, just before `sharekhanConfirmationPoller.start()`. Add:

```js
    // Build scripCode → symbol map for the current universe
    const universeSyms = [...getIntradayLiveUniverseSymbols()];
    const symToCode = new Map();
    await Promise.all(universeSyms.map(async sym => {
      const code = await sharekhanClientLive.getScripCode(sym).catch(() => 0);
      if (code > 0) symToCode.set(sym, code);
    }));
    const scripToSymbol = new Map([...symToCode.entries()].map(([sym, code]) => [code, sym]));

    if (sharekhanTicker) { try { sharekhanTicker.stop(); } catch (_) {} }
    sharekhanTicker = new SharekhanTicker({
      accessToken: sharekhanCredentials.accessToken,
      scripToSymbol,
      onCandleUpdate: (sym, candles) => { pushSharekhanTickerCandles(sym, candles).catch(() => {}); },
    });
    sharekhanTicker.subscribe([...symToCode.values()]);
    sharekhanTicker.start();
    console.log(`[sharekhan-ticker] Started, subscribed to ${symToCode.size} symbols`);
```

- [ ] **Step 5: Stop ticker in `ensureSharekhanInitialized`**

Find where credentials are reset:
```js
    sharekhanCredentials = null;
    sharekhanClientLive = null;
```
Add before it:
```js
    if (sharekhanTicker) { try { sharekhanTicker.stop(); } catch (_) {} sharekhanTicker = null; }
```

- [ ] **Step 6: Subscribe new symbols when universe grows**

Find `rememberSimulationUniverse`. After `saveSimulationUniverseState(universe)`, add:

```js
  // Subscribe any newly added symbols to the Sharekhan ticker
  if (changed && sharekhanTicker && sharekhanClientLive) {
    const addedSyms = symbols
      .map(s => String(s || '').trim().toUpperCase())
      .filter(sym => sym && getSimulationUniverseSymbols().has(sym));
    if (addedSyms.length) {
      Promise.all(addedSyms.map(sym =>
        sharekhanClientLive.getScripCode(sym).then(code => ({ sym, code })).catch(() => null)
      )).then(results => {
        const valid = results.filter(r => r && r.code > 0);
        const codes = valid.map(r => r.code);
        // scripToSymbol map: code → sym (not sym → code)
        if (codes.length) sharekhanTicker.subscribe(codes, new Map(valid.map(r => [r.code, r.sym])));
      }).catch(() => {});
    }
  }
```

- [ ] **Step 7: Wire token refresh to ticker**

Find the `onTokenUpdate` callback in `initializeSharekhan`:
```js
      onTokenUpdate: ({ accessToken: nextAccessToken }) => {
        if (nextAccessToken) {
          sharekhanCredentials.accessToken = nextAccessToken;
          saveSharekhanAccessToken(nextAccessToken);
        }
      },
```
Add one line:
```js
          if (sharekhanTicker) sharekhanTicker.updateToken(nextAccessToken);
```

- [ ] **Step 8: Remove the non-working Sharekhan REST fallback from `fetchIntradaySignal`**

Inside `fetchIntradaySignal`, find the block starting with:
```js
  // Try Sharekhan first (real-time, no delay) — fall back to REST then Yahoo
  if (sharekhanClientLive) {
```
**Delete this entire block** (it calls `fetchSharekhanIntraday` which uses the non-working `historical/` REST endpoint). The WS push via `pushSharekhanTickerCandles` already updates `intradaySignalCache` before `fetchIntradaySignal` is even called, so the cache-hit at the top of `fetchIntradaySignal` will serve the WS data. Yahoo remains as the fallback when the WS has no data yet.

- [ ] **Step 9: Run full test suite**

```
node --test
```
Expected: 159 pass, 1 fail (pre-existing `db-migrate`).

- [ ] **Step 10: Commit**

```
git add ticker_proxy.js
git commit -m "feat: wire SharekhanTicker WebSocket feed into intradayLiveCache real-time push"
```

---

## Task 5: Expose ticker status in `/broker-mode` endpoint

**Files:**
- Modify: `ticker_proxy.js`

- [ ] **Step 1: Update the broker-mode GET response**

Find:
```js
res.end(JSON.stringify({ ok: true, mode: brokerMode }));
```
Replace with:
```js
res.end(JSON.stringify({
  ok: true,
  mode: brokerMode,
  sharekhanTickerConnected: sharekhanTicker?._connected ?? false,
  sharekhanTickerSymbols: sharekhanTicker ? sharekhanTicker._subscribedCodes.size : 0,
}));
```

- [ ] **Step 2: Run tests**

```
node --test
```
Expected: 159 pass, 1 fail (pre-existing).

- [ ] **Step 3: Commit**

```
git add ticker_proxy.js
git commit -m "feat: expose sharekhan ticker status in /broker-mode"
```

---

## Manual Verification

After all tasks, restart the server and verify:

1. `GET /broker-mode` → `sharekhanTickerConnected: true`, `sharekhanTickerSymbols: N`
2. Signals for subscribed symbols should start updating within seconds (first update as soon as the first tick arrives — no minimum bar wait)
3. Fetch a signal for a symbol in the universe → `dataSource: 'sharekhan-ws'` in the response
4. Confirm the signal updates within ~1 second of a live price move (vs the old 60s Yahoo cadence)
5. Kill and restart server → ticker reconnects automatically within 5 seconds
