'use strict';
const WebSocketClient = require('ws');

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeDepthLevels(levels, side) {
  if (!Array.isArray(levels)) return [];
  const normalized = levels.map(level => {
    if (Array.isArray(level)) {
      const price = positiveNumber(level[0]);
      const quantity = positiveNumber(level[1]);
      return price && quantity ? { price, quantity } : null;
    }
    if (!level || typeof level !== 'object') return null;
    const price = positiveNumber(level.price ?? level.rate ?? level[`${side}Price`] ?? level[`${side}_price`]);
    const quantity = positiveNumber(level.quantity ?? level.qty ?? level.volume ?? level[`${side}Qty`] ?? level[`${side}Quantity`] ?? level[`${side}_qty`]);
    return price && quantity ? { price, quantity } : null;
  }).filter(Boolean);
  normalized.sort((left, right) => side === 'bid' ? right.price - left.price : left.price - right.price);
  return normalized.slice(0, 5);
}

function normalizeSharekhanMarketDepth(tick, capturedAt = Date.now()) {
  if (!tick || typeof tick !== 'object') return null;
  const book = tick.marketDepth || tick.market_depth || tick.depth || tick.orderBook || tick.order_book || {};
  const bidLevels = normalizeDepthLevels(book.bids || book.bid || book.buy || book.buyOrders || tick.bids, 'bid');
  const askLevels = normalizeDepthLevels(book.asks || book.ask || book.sell || book.sellOrders || tick.asks, 'ask');
  const bestBidPrice = positiveNumber(tick.bestBidPrice ?? tick.bidPrice ?? tick.bestBid ?? tick.bid ?? book.bestBidPrice ?? book.bidPrice)
    || bidLevels[0]?.price || null;
  const bestAskPrice = positiveNumber(tick.bestAskPrice ?? tick.askPrice ?? tick.bestAsk ?? tick.ask ?? book.bestAskPrice ?? book.askPrice)
    || askLevels[0]?.price || null;
  const bestBidQuantity = positiveNumber(tick.bestBidQuantity ?? tick.bestBidQty ?? tick.bidQuantity ?? tick.bidQty ?? book.bestBidQuantity ?? book.bestBidQty)
    || bidLevels[0]?.quantity || null;
  const bestAskQuantity = positiveNumber(tick.bestAskQuantity ?? tick.bestAskQty ?? tick.askQuantity ?? tick.askQty ?? book.bestAskQuantity ?? book.bestAskQty)
    || askLevels[0]?.quantity || null;
  if (!bestBidPrice || !bestAskPrice || !bestBidQuantity || !bestAskQuantity) return null;
  const summedBidQuantity = bidLevels.reduce((sum, level) => sum + level.quantity, 0);
  const summedAskQuantity = askLevels.reduce((sum, level) => sum + level.quantity, 0);
  const totalBidQuantity = positiveNumber(tick.totalBidQuantity ?? tick.totalBidQty ?? tick.totalBuyQuantity ?? tick.totalBuyQty ?? book.totalBidQuantity ?? book.totalBuyQuantity)
    || summedBidQuantity || bestBidQuantity;
  const totalAskQuantity = positiveNumber(tick.totalAskQuantity ?? tick.totalAskQty ?? tick.totalSellQuantity ?? tick.totalSellQty ?? book.totalAskQuantity ?? book.totalSellQuantity)
    || summedAskQuantity || bestAskQuantity;
  const combinedQuantity = totalBidQuantity + totalAskQuantity;
  const spread = bestAskPrice - bestBidPrice;
  const midpoint = (bestAskPrice + bestBidPrice) / 2;
  const requestedCapturedAtMs = new Date(capturedAt).getTime();
  const capturedAtMs = Number.isFinite(requestedCapturedAtMs) ? requestedCapturedAtMs : Date.now();
  return {
    bestBidPrice,
    bestBidQuantity,
    bestAskPrice,
    bestAskQuantity,
    bidLevels,
    askLevels,
    totalBidQuantity,
    totalAskQuantity,
    combinedQuantity,
    spread,
    spreadPct: midpoint > 0 ? spread / midpoint * 100 : null,
    imbalance: combinedQuantity > 0 ? totalBidQuantity / combinedQuantity : null,
    crossed: spread < 0,
    capturedAt: new Date(capturedAtMs).toISOString(),
    capturedAtMs,
    source:'sharekhan-ws',
  };
}

const BAR_MINUTES = 5;
const MAX_CANDLES = 80; // slightly over full trading day of 5-min bars
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19800000 ms
const SHAREKHAN_STREAM_URL = 'wss://stream.sharekhan.com/skstream/api/stream';

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

function isFatalAuthClose(code, reason) {
  const text = String(reason || '').toLowerCase();
  return text.includes('invalid api key') ||
    text.includes('invalid access token') ||
    text.includes('unauthorized') ||
    text.includes('forbidden') ||
    text.includes('token expired') ||
    text.includes('invalid token') ||
    Number(code) === 4001 ||
    Number(code) === 4003;
}

class SharekhanTicker {
  /**
   * @param {object} config
   * @param {string}   config.accessToken       - Sharekhan access token
   * @param {Map}      [config.scripToSymbol]   - Map<scripCode(number), symbol(string)> for callback
   * @param {function} [config.onCandleUpdate]  - (symbol, candles[]) called on every tick
   * @param {function} [config.onTick]          - (tick) called on every raw tick
   * @param {function} [config.webSocketFactory]- Test hook for creating WebSocket clients
   */
  constructor(config = {}) {
    this.accessToken = String(config.accessToken || '');
    this.scripToSymbol = config.scripToSymbol instanceof Map ? config.scripToSymbol : new Map();
    this.onCandleUpdate = typeof config.onCandleUpdate === 'function' ? config.onCandleUpdate : null;
    this.onTick = typeof config.onTick === 'function' ? config.onTick : null;
    this.onFatalAuth = typeof config.onFatalAuth === 'function' ? config.onFatalAuth : null;
    this.onAuthenticated = typeof config.onAuthenticated === 'function' ? config.onAuthenticated : null;
    this.connectionLabel = String(config.connectionLabel || '').trim();
    this._webSocketFactory = typeof config.webSocketFactory === 'function'
      ? config.webSocketFactory
      : url => new WebSocketClient(url);

    this._closedBars = new Map();  // scripCode(number) → candle[] (closed bars only)
    this._openBar = new Map();     // scripCode(number) → current open bar

    this._ws = null;
    this._connected = false;
    this._subscribedCodes = new Set();
    this._reconnectTimer = null;
    this._reconnectDelayMs = Number.isFinite(Number(config.reconnectDelayMs)) ? Math.max(0, Number(config.reconnectDelayMs)) : 5000;
    this._idleTimeoutMs = Number.isFinite(Number(config.idleTimeoutMs)) ? Math.max(0, Number(config.idleTimeoutMs)) : 90000;
    this._stopped = false;
    this._authBlocked = false;
    this._connectAttempt = 0;
    this._connectTimeout = null;
    this._idleTimer = null;
    this._lastTickAt = 0;
    this._subscriptionAcceptedLogged = false;
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
    this._authBlocked = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._connectTimeout) { clearTimeout(this._connectTimeout); this._connectTimeout = null; }
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._ws) {
      try { this._ws.removeAllListeners?.(); } catch (_) {}
      try { this._ws.close?.(); } catch (_) {}
      this._ws = null;
    }
    this._connected = false;
    console.log('[sharekhan-ticker] Stopped');
  }

  updateToken(newToken) {
    const token = String(newToken || '').trim();
    if (!token) return;
    const needsResume = this._stopped || this._authBlocked;
    if (token === this.accessToken && !needsResume) return;
    this.accessToken = token;
    this._authBlocked = false;
    this._stopped = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    console.log('[sharekhan-ticker] Token updated — reconnecting');
    if (this._ws) {
      try { this._ws.removeAllListeners?.(); } catch (_) {}
      try { this._ws.close?.(); } catch (_) {}
      this._ws = null;
    }
    this._connected = false;
    this._connect();
  }

  _connect() {
    if (this._stopped) return;
    if (!this.accessToken) {
      console.warn('[sharekhan-ticker] Connect skipped: missing access token');
      return;
    }
    const attempt = ++this._connectAttempt;
    const url = `${SHAREKHAN_STREAM_URL}?ACCESS_TOKEN=${encodeURIComponent(this.accessToken)}`;
    if (this._connectTimeout) { clearTimeout(this._connectTimeout); this._connectTimeout = null; }
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._ws) {
      try { this._ws.removeAllListeners?.(); } catch (_) {}
      try { this._ws.close?.(); } catch (_) {}
      this._ws = null;
    }
    try {
      const ws = this._webSocketFactory(url);
      this._ws = ws;

      const isCurrent = () => !this._stopped && this._ws === ws && this._connectAttempt === attempt;
      const clearConnectTimeout = () => {
        if (this._connectTimeout) { clearTimeout(this._connectTimeout); this._connectTimeout = null; }
      };
      const clearIdleTimer = () => {
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
      };
      const reconnect = reason => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        clearIdleTimer();
        if (reason) console.warn('[sharekhan-ticker] Connect failed:', reason);
        this._connected = false;
        this._scheduleReconnect();
      };
      const armIdleTimer = () => {
        clearIdleTimer();
        if (!this._idleTimeoutMs) return;
        this._idleTimer = setTimeout(() => {
          if (!isCurrent() || !this._connected) return;
          console.warn(`[sharekhan-ticker] No ticks received for ${this._idleTimeoutMs}ms — forcing reconnect`);
          this._connected = false;
          try { ws.removeAllListeners?.(); } catch (_) {}
          try { ws.terminate?.(); } catch (_) {
            try { ws.close?.(); } catch (_) {}
          }
          if (this._ws === ws) this._ws = null;
          this._scheduleReconnect();
        }, this._idleTimeoutMs);
      };

      ws.on?.('open', () => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        this._connected = true;
        this._subscriptionAcceptedLogged = false;
        console.log(`[sharekhan-ticker]${this.connectionLabel ? ` ${this.connectionLabel}` : ''} Connected`);
        this._sendJson({ action: 'subscribe', key: ['feed'], value: [''] });
        if (this._subscribedCodes.size) this._sendFeed([...this._subscribedCodes]);
        armIdleTimer();
      });
      ws.on?.('message', raw => {
        armIdleTimer();
        if (!this._subscriptionAcceptedLogged) {
          this._subscriptionAcceptedLogged = true;
          console.log(`[sharekhan-ticker]${this.connectionLabel ? ` ${this.connectionLabel}` : ''} Subscription accepted (${this._subscribedCodes.size} instruments)`);
          if (this.onAuthenticated) {
            try { this.onAuthenticated(); } catch (_) {}
          }
        }
        this._onTick(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
      });
      ws.on?.('unexpected-response', (_req, res) => {
        const status = `${res?.statusCode || 0}${res?.statusMessage ? ` ${res.statusMessage}` : ''}`.trim();
        try { res?.resume?.(); } catch (_) {}
        reconnect(status ? `Unexpected server response: ${status}` : 'Unexpected server response');
      });
      ws.on?.('error', e => reconnect(e?.message || e));
      ws.on?.('close', (code, reason) => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        clearIdleTimer();
        this._connected = false;
        const text = reason ? reason.toString() : '';
        if (!this._stopped) console.warn(`[sharekhan-ticker] Closed${code ? ` (${code})` : ''}${text ? `: ${text}` : ''}`);
        if (isFatalAuthClose(code, text)) {
          this._stopped = true;
          this._authBlocked = true;
          this._ws = null;
          console.warn('[sharekhan-ticker] Stopped after auth rejection. Refresh Sharekhan token/API key to resume live ticks; Yahoo fallback remains available.');
          if (this.onFatalAuth) {
            try { this.onFatalAuth({ code, reason: text }); } catch (_) {}
          }
          return;
        }
        this._scheduleReconnect();
      });
      this._connectTimeout = setTimeout(() => reconnect('Timed out waiting for open'), 15000);
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
    this._sendJson({ action: 'feed', key: ['ltp'], value: codes.map(c => `NC${c}`) });
  }

  _sendJson(payload) {
    if (!this._ws || this._ws.readyState !== WebSocketClient.OPEN) return;
    try {
      this._ws.send(JSON.stringify(payload));
    } catch (e) {
      console.warn('[sharekhan-ticker] send failed:', e?.message || e);
      this._scheduleReconnect();
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
    this._lastTickAt = Date.now();
    if (this.onTick) {
      try { this.onTick(tick); } catch (_) {}
    }

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

class SharekhanTickerPool {
  constructor(config = {}) {
    const size = Math.max(1, Math.floor(Number(config.poolSize) || 5));
    this._startStaggerMs = Math.max(0, Number(config.startStaggerMs) || 0);
    this._startTimers = [];
    this._fatalAuthHandled = false;
    this._startedConnections = new Set();
    this._pendingToken = '';
    this._tickers = Array.from({ length: size }, (_, index) => new SharekhanTicker({
      ...config,
      connectionLabel: `Connection ${index + 1}/${size}`,
      onFatalAuth: details => this._handleFatalAuth(index, details),
      onAuthenticated: () => this._handleAuthenticated(index),
    }));
    this._codeToTicker = new Map();
    this._nextTicker = 0;
    this._heartbeatTimer = null;
  }

  get _connected() { return this._tickers.some(ticker => ticker._connected); }
  get _subscribedCodes() { return new Set(this._codeToTicker.keys()); }
  get _lastTickAt() { return Math.max(0, ...this._tickers.map(ticker => Number(ticker._lastTickAt) || 0)); }
  get _reconnectTimer() { return this._tickers.some(ticker => !!ticker._reconnectTimer); }
  get _authBlocked() { return this._tickers.some(ticker => !!ticker._authBlocked); }
  get _idleTimeoutMs() { return Number(this._tickers[0]?._idleTimeoutMs) || 0; }
  get connectionCount() { return this._tickers.length; }
  get connectedCount() { return this._tickers.filter(ticker => ticker._connected).length; }
  getConnectionIndex(scripCode) {
    const index = this._codeToTicker.get(Number(scripCode));
    return Number.isInteger(index) ? index : -1;
  }
  getSymbol(scripCode) {
    const tickerIndex = this._codeToTicker.get(Number(scripCode));
    return tickerIndex == null ? '' : String(this._tickers[tickerIndex]?.scripToSymbol?.get(Number(scripCode)) || '');
  }

  subscribe(scripCodes, symMap = null) {
    const maps = this._tickers.map(() => new Map());
    const codes = this._tickers.map(() => []);
    for (const rawCode of scripCodes) {
      const code = Number(rawCode);
      if (!code || this._codeToTicker.has(code)) continue;
      const tickerIndex = this._nextTicker++ % this._tickers.length;
      this._codeToTicker.set(code, tickerIndex);
      codes[tickerIndex].push(code);
      if (symMap instanceof Map && symMap.has(code)) maps[tickerIndex].set(code, symMap.get(code));
    }
    this._tickers.forEach((ticker, index) => {
      if (codes[index].length) ticker.subscribe(codes[index], maps[index]);
    });
  }

  start() {
    this._startTimers.forEach(timer => clearTimeout(timer));
    this._startTimers = [];
    this._fatalAuthHandled = false;
    this._pendingToken = '';
    this._startedConnections = new Set([0]);
    this._tickers[0]?.start();
  }
  stop() {
    this._startTimers.forEach(timer => clearTimeout(timer));
    this._startTimers = [];
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    this._tickers.forEach(ticker => ticker.stop());
  }
  updateToken(token) {
    this._fatalAuthHandled = false;
    this._startTimers.forEach(timer => clearTimeout(timer));
    this._startTimers = [];
    this._pendingToken = String(token || '').trim();
    this._tickers.forEach(ticker => ticker.stop());
    this._startedConnections = new Set([0]);
    this._tickers[0]?.updateToken(this._pendingToken);
  }
  getCandlesWithOpenBar(scripCode) {
    const tickerIndex = this._codeToTicker.get(Number(scripCode));
    return tickerIndex == null ? null : this._tickers[tickerIndex].getCandlesWithOpenBar(scripCode);
  }

  _handleAuthenticated(connectionIndex) {
    if (this._fatalAuthHandled) return;
    const nextIndex = connectionIndex + 1;
    if (nextIndex >= this._tickers.length || this._startedConnections.has(nextIndex)) return;
    this._startedConnections.add(nextIndex);
    if (this._pendingToken) this._tickers[nextIndex].updateToken(this._pendingToken);
    else this._tickers[nextIndex].start();
  }

  _handleFatalAuth(connectionIndex, details = {}) {
    if (this._fatalAuthHandled) return;
    this._fatalAuthHandled = true;
    this._startTimers.forEach(timer => clearTimeout(timer));
    this._startTimers = [];
    console.warn(`[sharekhan-ticker] Connection ${connectionIndex + 1}/${this.connectionCount} reported fatal authentication failure${details.reason ? `: ${details.reason}` : ''}; stopping all pooled connections.`);
    this._tickers.forEach(ticker => ticker.stop());
    if (this._tickers[connectionIndex]) this._tickers[connectionIndex]._authBlocked = true;
  }
}

module.exports = { SharekhanTicker, SharekhanTickerPool, parseTickTime, normalizeSharekhanMarketDepth };
