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
   * @param {Map}      [config.scripToSymbol]   - Map<scripCode(number), symbol(string)> for callback
   * @param {function} [config.onCandleUpdate]  - (symbol, candles[]) called on every tick
   */
  constructor(config = {}) {
    this.accessToken = String(config.accessToken || '');
    this.scripToSymbol = config.scripToSymbol instanceof Map ? config.scripToSymbol : new Map();
    this.onCandleUpdate = typeof config.onCandleUpdate === 'function' ? config.onCandleUpdate : null;

    this._closedBars = new Map();  // scripCode(number) → candle[] (closed bars only)
    this._openBar = new Map();     // scripCode(number) → current open bar

    this._ws = null;
    this._connected = false;
    this._subscribedCodes = new Set();
    this._reconnectTimer = null;
    this._reconnectDelayMs = 5000;
    this._stopped = false;
  }

  // Returns all candles including the current open bar, or null if no data yet.
  getCandlesWithOpenBar(scripCode) {
    const code = Number(scripCode);
    const closed = this._closedBars.get(code) || [];
    const open = this._openBar.get(code);
    if (!open && !closed.length) return null;
    return open ? [...closed, { ...open }] : closed.slice();
  }

  // Subscribe to live feed for these scripCodes (iterable of numbers).
  // symMap: Map<code(number), sym(string)> — registers for onCandleUpdate callbacks.
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
      for (const [code, sym] of symMap) this.scripToSymbol.set(Number(code), String(sym));
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
      openBar.vol   = vol;
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
