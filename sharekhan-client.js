const { SharekhanApi } = require('sharekhan-api/lib');

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
    this.symbolCacheUpdatedAt = 0;
    this.symbolCacheTtlMs = 6 * 60 * 60 * 1000;

    this.client = new SharekhanApi({
      api_key: this.apiKey,
      customer_id: this.customerId,
      access_token: this.accessToken || undefined,
      vender_key: this.vendorKey || undefined,
    });
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
    if (this.symbolCodeCache.size && now - this.symbolCacheUpdatedAt < this.symbolCacheTtlMs) return;
    const result = await this.withAuthRetry(() => this.client.getActiveScriptOfDay(exchange));
    const payload = this.parseResponse(result);
    const list = Array.isArray(payload) ? payload
      : (Array.isArray(payload?.data) ? payload.data
      : (Array.isArray(payload?.result) ? payload.result : []));
    const nextMap = new Map();
    for (const item of list) {
      const symbol = String(item?.tradingSymbol || item?.symbol || item?.name || '').trim().toUpperCase();
      const scripCode = Number(item?.scripCode || item?.scrip_code || item?.scriptCode || 0);
      if (symbol && Number.isFinite(scripCode) && scripCode > 0) nextMap.set(symbol, scripCode);
    }
    if (nextMap.size) {
      this.symbolCodeCache = nextMap;
      this.symbolCacheUpdatedAt = now;
    }
  }

  async resolveScripCode(symbol, exchange = 'NC') {
    const clean = String(symbol || '').trim().toUpperCase().replace(/\.NS$/i, '');
    if (!clean) return 0;
    await this.ensureSymbolCodeMap(exchange);
    return Number(this.symbolCodeCache.get(clean) || 0);
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
    const [fundRes, holdingsRes] = await this.withAuthRetry(() => Promise.all([
      this.client.getFundsDetails('NC'),
      this.client.getHoldings(),
    ]));

    const fundPayload = this.parseResponse(fundRes);
    const holdingsPayload = this.parseResponse(holdingsRes);
    const fundRow = Array.isArray(fundPayload?.data) && fundPayload.data.length ? fundPayload.data[0]
      : (Array.isArray(fundPayload) && fundPayload.length ? fundPayload[0] : (fundPayload || {}));
    const holdings = Array.isArray(holdingsPayload?.data) ? holdingsPayload.data
      : (Array.isArray(holdingsPayload) ? holdingsPayload : []);

    const holdingsList = holdings.map(h => {
      const qty = this.toNum(h.quantity || h.qty || h.holdingQty);
      const ltp = this.toNum(h.ltp || h.lastPrice || h.last_price);
      const avgPrice = this.toNum(h.avgPrice || h.averagePrice || h.avg_cost || h.costPrice);
      const marketValue = this.toNum(h.marketValue || (qty * ltp));
      const investedValue = this.toNum(h.investedValue || (qty * avgPrice));
      const pnl = this.toNum(h.pnl || h.unrealizedPnl || (marketValue - investedValue));
      return {
        symbol: String(h.tradingSymbol || h.symbol || '--'),
        exchange: String(h.exchange || 'NC'),
        isin: String(h.isin || ''),
        qty,
        t1Qty: this.toNum(h.t1Qty || h.t1_quantity),
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
    const availableCash = this.toNum(fundRow.availableCash || fundRow.available || fundRow.netAvailable || fundRow.cash);
    const utilizedMargin = this.toNum(fundRow.utilized || fundRow.marginUsed || fundRow.blockedAmount);
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
