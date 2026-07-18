const { SharekhanApi } = require('sharekhan-api/lib');
const { buildScripCodeMap } = require('./sharekhan-intraday');
const { getScripCode, upsertScripCodes } = require('./server/db');

class SharekhanClient {
  constructor(config = {}) {
    this.apiKey = String(config.apiKey || '');
    this.customerId = String(config.customerId || '');
    this.accessToken = String(config.accessToken || '');
    this.secretKey = String(config.secretKey || '');
    this.requestToken = String(config.requestToken || '');
    this.versionId = String(config.versionId || '');
    this.vendorKey = String(config.vendorKey || '');
    this.onTokenUpdate = typeof config.onTokenUpdate === 'function' ? config.onTokenUpdate : null;
    this.lastTokenRefreshAt = null;
    this.symbolCodeCache = new Map();
    this.streamingSymbolCodeCache = new Map();
    this.symbolCacheUpdatedAt = 0;
    this.symbolCacheTtlMs = 6 * 60 * 60 * 1000;
    this.historicalRequestQueue = Promise.resolve();
    this.historicalNextRequestAt = 0;
    this.historicalRequestSpacingMs = 1500;

    this.client = new SharekhanApi({
      api_key: this.apiKey,
      customer_id: this.customerId,
      access_token: this.accessToken || undefined,
      vender_key: this.vendorKey || undefined,
    });
    if (this.accessToken) this.client.setAccessToken(this.accessToken);
  }

  setAccessToken(token) {
    const next = String(token || '').trim();
    if (!next) return;
    this.accessToken = next;
    this.client.setAccessToken(next);
  }

  parseResponse(response) {
    if (response && typeof response === 'object' && response.data != null) return response.data;
    return response;
  }

  normalizeOrderStatus(status) {
    const s = String(status || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!s) return '';
    if (['COMPLETE', 'EXECUTED', 'TRADED', 'SUCCESS'].includes(s)) return 'COMPLETE';
    if (['REJECTED', 'FAILED', 'FAIL'].includes(s)) return 'REJECTED';
    if (['CANCELLED', 'CANCELED'].includes(s)) return 'CANCELLED';
    return s;
  }

  async refreshAccessToken() {
    if (!this.requestToken || !this.secretKey) return false;
    const result = this.versionId
      ? await this.client.generateSessionWithVersionID(this.requestToken, this.secretKey, this.versionId)
      : await this.client.generateSessionWithoutVersionID(this.requestToken, this.secretKey);
    const payload = this.parseResponse(result);
    const token = String(payload?.token || payload?.accessToken || payload?.jwtToken || '');
    if (!token) return false;
    this.setAccessToken(token);
    this.lastTokenRefreshAt = Date.now();
    if (this.onTokenUpdate) {
      try { this.onTokenUpdate({ accessToken: token }); } catch (_) {}
    }
    return true;
  }

  async withAuthRetry(task) {
    const res = await task();
    const status = Number(res?.status || 0);
    // Surface server errors so callers get clear failure instead of silent empty data
    if (status >= 500) {
      const msg = String(res?.message || res?.error || 'Server error');
      throw new Error(`SHAREKHAN_SERVER_ERROR_${status}: ${msg}`);
    }
    if (status !== 401 && status !== 403) return res;
    const refreshed = await this.refreshAccessToken();
    if (!refreshed) throw new Error('AUTH_FAILED_REFRESH_NEEDED');
    return task();
  }

  toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async ensureSymbolCodeMap(exchange = 'NC') {
    const now = Date.now();
    // Return early if in-memory cache is fresh
    if (this.symbolCodeCache.size && this.streamingSymbolCodeCache.size && now - this.symbolCacheUpdatedAt < this.symbolCacheTtlMs) return;
    // Fetch from master endpoint
    try {
      const result = await this.withAuthRetry(() => this.client.getActiveScriptOfDay(exchange));
      const payload = this.parseResponse(result);
      const list = Array.isArray(payload) ? payload
        : (Array.isArray(payload?.data) ? payload.data
        : (Array.isArray(payload?.result) ? payload.result : []));
      const nextMap = buildScripCodeMap(list);
      const nextStreamingMap = new Map();
      for (const item of list) {
        const symbol = String(item?.tradingSymbol || '').trim().toUpperCase();
        const code = Number(item?.scripCode || 0);
        if (symbol && Number.isFinite(code) && code > 0) nextStreamingMap.set(symbol, code);
      }
      if (nextStreamingMap.size) this.streamingSymbolCodeCache = nextStreamingMap;
      if (nextMap.size) {
        this.symbolCodeCache = nextMap;
        this.symbolCacheUpdatedAt = now;
        // Save to DB: convert Map to array of {symbol, sharekhan_code}
        const rows = Array.from(nextMap.entries()).map(([symbol, code]) => ({
          symbol,
          sharekhan_code: code
        }));
        upsertScripCodes(rows, 'sharekhan');
      }
    } catch (_) {}
  }

  async resolveScripCode(symbol, exchange = 'NC') {
    const clean = String(symbol || '').trim().toUpperCase().replace(/\.NS$/i, '');
    if (!clean) return 0;
    
    // Check in-memory cache first
    const cached = this.symbolCodeCache.get(clean);
    if (cached) return Number(cached);
    
    // Check DB cache second
    const dbCode = getScripCode(clean, 'sharekhan');
    if (dbCode) {
      // Populate in-memory cache for future use
      this.symbolCodeCache.set(clean, dbCode);
      this.symbolCacheUpdatedAt = Date.now();
      return Number(dbCode);
    }
    
    // If not in memory or DB, try to fetch from API
    await this.ensureSymbolCodeMap(exchange);
    return Number(this.symbolCodeCache.get(clean) || 0);
  }

  // Adapter method satisfying fetchSharekhanIntraday client contract
  async getScripCode(symbol) {
    return this.resolveScripCode(symbol, 'NC');
  }

  // Adapter method satisfying fetchSharekhanIntraday client contract
  // Returns raw candle data (array or string) — normalizeSharekhanCandles handles both
  async fetchRawCandles(exchange, scripCode, interval) {
    const run = async () => {
      const waitMs = Math.max(0, this.historicalNextRequestAt - Date.now());
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      this.historicalNextRequestAt = Date.now() + this.historicalRequestSpacingMs;
      try {
        let res = await this.withAuthRetry(() =>
          this.client.getHistoricalIntervalData(exchange, scripCode, interval)
        );
        if (Number(res?.status) === 429) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          res = await this.withAuthRetry(() =>
            this.client.getHistoricalIntervalData(exchange, scripCode, interval)
          );
        }
        const data = this.parseResponse(res);
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.data)) return data.data;
        if (typeof data === 'string') return data;
        return [];
      } catch (err) {
        console.warn(`[sharekhan-client] fetchRawCandles(${exchange}, ${scripCode}, ${interval}) failed: ${err?.message || err}`);
        throw err;
      }
    };
    const queued = this.historicalRequestQueue.then(run, run);
    this.historicalRequestQueue = queued.catch(() => {});
    return queued;
  }

  // Index instruments are present in Sharekhan's active-script response but
  // are intentionally excluded from the equity-only order/candle cache.
  async resolveStreamingScripCode(symbol, exchange = 'NC') {
    const clean = String(symbol || '').trim().toUpperCase().replace(/\.NS$/i, '');
    if (!clean) return 0;
    const cached = this.streamingSymbolCodeCache.get(clean);
    if (cached) return Number(cached);
    await this.ensureSymbolCodeMap(exchange);
    return Number(this.streamingSymbolCodeCache.get(clean) || this.symbolCodeCache.get(clean) || 0);
  }

  buildOrderPayload(order = {}) {
    const symbol = String(order.tradingSymbol || '').trim().toUpperCase();
    const quantity = Math.floor(Number(order.quantity || 0));
    const scripCode = Number(order.scripCode || 0);
    if (!symbol || !quantity || !scripCode) {
      throw new Error('Sharekhan order requires tradingSymbol, quantity and scripCode');
    }
    const transactionType = String(order.transactionType || 'B').toUpperCase() === 'S' ? 'S' : 'B';
    return {
      customerId: Number(this.customerId),
      scripCode,
      tradingSymbol: symbol,
      exchange: String(order.exchange || 'NC').toUpperCase(),
      transactionType,
      quantity,
      disclosedQty: 0,
      price: `${this.toNum(order.price).toFixed(2)}`,
      triggerPrice: '0',
      rmsCode: String(order.rmsCode || 'ANY'),
      afterHour: 'N',
      orderType: String(order.orderType || 'NORMAL'),
      channelUser: String(order.channelUser || this.customerId),
      validity: String(order.validity || 'GFD'),
      requestType: String(order.requestType || 'NEW'),
      productType: String(order.productType || 'INTRADAY'),
    };
  }

  async placeOrder(order) {
    const payload = this.buildOrderPayload(order);
    const result = await this.withAuthRetry(() => this.client.placeNewOrder(payload));
    const parsed = this.parseResponse(result);
    const status = Number(result?.status || 200);
    if (status >= 400) throw new Error(parsed?.message || result?.message || 'Sharekhan place order failed');
    const orderId = String(parsed?.orderId || parsed?.orderID || parsed?.id || parsed?.data?.orderId || '');
    if (!orderId) throw new Error('Sharekhan order id not returned');
    return orderId;
  }

  async getOrderStatus(orderId, exchange = 'NC') {
    const result = await this.withAuthRetry(() => this.client.getHistoryByOrderID(exchange, orderId));
    const payload = this.parseResponse(result);
    const list = Array.isArray(payload) ? payload
      : (Array.isArray(payload?.data) ? payload.data
      : (Array.isArray(payload?.result) ? payload.result : []));
    const row = list.length ? list[list.length - 1] : (payload || {});
    const statusRaw = row?.orderStatus || row?.status || row?.order_status || '';
    return {
      orderId: String(row?.orderId || row?.orderID || orderId),
      status: this.normalizeOrderStatus(statusRaw),
      filledQuantity: this.toNum(row?.filledQty || row?.filledQuantity || row?.executedQty),
      pendingQuantity: this.toNum(row?.pendingQty || row?.pendingQuantity),
      averagePrice: this.toNum(row?.avgPrice || row?.averagePrice || row?.price),
      statusMessage: String(row?.message || row?.statusMessage || statusRaw || ''),
    };
  }

  async cancelOrder(orderLike = {}) {
    const payload = this.buildOrderPayload({
      ...orderLike,
      requestType: 'CANCEL',
      price: Number(orderLike.price || orderLike.avgPrice || orderLike.entryPrice || 0.01),
    });
    if (orderLike.orderId) payload.orderId = String(orderLike.orderId);
    const result = await this.withAuthRetry(() => this.client.cancelOrder(payload));
    const status = Number(result?.status || 200);
    return status < 400;
  }

  async getPortfolioState() {
    // Fetch funds and holdings independently so errors surface per-call
    const checkStatus = (res, name) => {
      const status = Number(res?.status || 0);
      if (status >= 500) throw new Error(`SHAREKHAN_SERVER_ERROR_${status} on ${name}: ${res?.message || 'Bad Gateway'}`);
      if (status === 401 || status === 403) throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      return res;
    };

    const [fundRes, holdingsRes] = await Promise.all([
      this.client.getFundsDetails('NC').then(r => checkStatus(r, 'getFundsDetails')),
      this.client.getHoldings().then(r => checkStatus(r, 'getHoldings')),
    ]);

    const fundPayload = this.parseResponse(fundRes);
    const holdingsPayload = this.parseResponse(holdingsRes);
    const fundRow = Array.isArray(fundPayload?.data) && fundPayload.data.length ? fundPayload.data[0]
      : (Array.isArray(fundPayload) && fundPayload.length ? fundPayload[0] : (fundPayload || {}));
    const holdings = Array.isArray(holdingsPayload?.data) ? holdingsPayload.data
      : (Array.isArray(holdingsPayload) ? holdingsPayload : []);

    const holdingsList = holdings.map(h => {
      // Sharekhan API uses: dp (available qty), holdPrice (avg price), invstQty, aval, cncqty
      const qty = this.toNum(h.dp || h.aval || h.quantity || h.qty || h.holdingQty);
      const avgPrice = this.toNum(h.holdPrice || h.avgPrice || h.averagePrice || h.avg_cost || h.costPrice);
      const ltp = this.toNum(h.ltp || h.lastPrice || h.last_price);
      const marketValue = this.toNum(h.marketValue || (qty * ltp) || (qty * avgPrice));
      const investedValue = this.toNum(h.investedValue || (qty * avgPrice));
      const pnl = this.toNum(h.pnl || h.unrealizedPnl || (marketValue - investedValue));
      return {
        symbol: String(h.tradingSymbol || h.symbol || '--'),
        exchange: String(h.exchange || 'NC'),
        isin: String(h.isin || ''),
        qty,
        t1Qty: this.toNum(h.t1Qty || h.t1_quantity || h.invstQty),
        avgPrice,
        ltp,
        closePrice: this.toNum(h.closePrice || h.close_price),
        dayChangePct: this.toNum(h.dayChangePct || h.day_change_percentage),
        investedValue,
        marketValue,
        pnl,
      };
    });

    const holdingsValue = holdingsList.reduce((sum, h) => sum + this.toNum(h.marketValue), 0);
    // Sharekhan API uses: currentCashBalance, intradayMarginCash, limitAgainstShares
    const availableCash = this.toNum(fundRow.currentCashBalance || fundRow.availableCash || fundRow.available || fundRow.netAvailable || fundRow.cash);
    const utilizedMargin = this.toNum(fundRow.intradayMarginCash || fundRow.utilized || fundRow.marginUsed || fundRow.blockedAmount);
    const netEquity = this.toNum(fundRow.netEquity || fundRow.net || availableCash);

    return {
      asOf: Date.now(),
      funds: {
        availableCash,
        utilizedMargin,
        netEquity,
      },
      positions: {
        openCount: 0,
        dayCount: 0,
        dayPnl: 0,
        totalPnl: 0,
        list: [],
      },
      holdings: {
        count: holdingsList.length,
        marketValue: holdingsValue,
        list: holdingsList,
      },
    };
  }
}

module.exports = SharekhanClient;
