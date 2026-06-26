// zerodha-kite-client.js
const { KiteConnect } = require('kiteconnect');

class KiteClient {
  constructor(apiKey, apiSecret, accessToken, isDryRun = false, opts = {}) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.accessToken = accessToken;
    this.isDryRun = isDryRun;
    this.refreshToken = opts.refreshToken || '';
    this.onTokenUpdate = typeof opts.onTokenUpdate === 'function' ? opts.onTokenUpdate : null;
    this.kc = new KiteConnect({ api_key: apiKey });
    this.kc.setAccessToken(accessToken);
    this.kc.setSessionExpiryHook(() => {
      console.warn('[kite] Session expired (TokenException). API token refresh/re-login required.');
    });
    this.lastTokenRefreshAt = Date.now();
  }

  setTokens({ accessToken, refreshToken }) {
    if (accessToken) {
      this.accessToken = accessToken;
      this.kc.setAccessToken(accessToken);
    }
    if (refreshToken) this.refreshToken = refreshToken;
  }

  isAuthError(err) {
    const status = Number(err?.statusCode || err?.response?.status || err?.status || 0);
    const type = String(err?.error_type || err?.name || '').toLowerCase();
    // Only treat as auth error for genuine token/permission failures, not business rejections
    // TokenException from Zerodha can mean expired token OR rejected order — check status code too
    const isTokenType = type.includes('token') || type.includes('permission');
    return status === 401 || status === 403 || (isTokenType && (status === 401 || status === 403 || status === 0));
  }

  // Refresh access token using apiKey + apiSecret
  async refreshAccessToken() {
    try {
      if (!this.refreshToken) {
        console.warn('[kite] Refresh token missing. Cannot auto-renew access token.');
        return false;
      }
      console.log('[kite] Access token renew requested');
      const session = await this.kc.renewAccessToken(this.refreshToken, this.apiSecret);
      if (!session?.access_token) {
        console.error('[kite] Renew did not return access token');
        return false;
      }
      this.accessToken = session.access_token;
      this.kc.setAccessToken(this.accessToken);
      if (session.refresh_token) this.refreshToken = session.refresh_token;
      if (this.onTokenUpdate) {
        try {
          this.onTokenUpdate({ accessToken: this.accessToken, refreshToken: this.refreshToken });
        } catch (_) {}
      }
      this.lastTokenRefreshAt = Date.now();
      console.log('[kite] Access token renewed successfully');
      return true;
    } catch (err) {
      console.error('[kite] Token refresh failed:', err.message);
      return false;
    }
  }

  async withAuthRetry(task) {
    try {
      return await task();
    } catch (err) {
      if (!this.isAuthError(err)) throw err;
      const renewed = await this.refreshAccessToken();
      if (!renewed) throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      return task();
    }
  }

  // Place order on Kite
  async placeOrder(orderData) {
    try {
      const orderId = await this.withAuthRetry(async () => {
        const payload = { ...orderData };
        const variety = payload.variety || 'regular';
        delete payload.variety;
        return this.kc.placeOrder(variety, payload);
      });
      if (orderId) return orderId;
      throw new Error('No order_id in response');
    } catch (err) {
      // Re-throw with original Zerodha message preserved — avoids hiding business errors
      if (this.isAuthError(err)) {
        const origMsg = err?.message || String(err);
        throw new Error(`AUTH_FAILED_REFRESH_NEEDED: ${origMsg}`);
      }
      throw err;
    }
  }

  // Get order status
  async getOrderStatus(orderId) {
    try {
      const history = await this.withAuthRetry(() => this.kc.getOrderHistory(orderId));
      const entries = Array.isArray(history) ? history : [];
      if (!entries.length) throw new Error(`Order history not found for ${orderId}`);
      const orderData = entries[entries.length - 1] || {};
      const quantity = Number(orderData.quantity || 0);
      const filled = Number(orderData.filled_quantity || 0);
      return {
        orderId: orderData.order_id || orderId,
        status: orderData.status, // COMPLETE, REJECTED, CANCELLED, PENDING
        filledQuantity: filled,
        pendingQuantity: Math.max(0, quantity - filled),
        averagePrice: Number(orderData.average_price || 0),
        statusMessage: orderData.status_message || orderData.status
      };
    } catch (err) {
      if (this.isAuthError(err)) {
        throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      }
      throw err;
    }
  }

  // Cancel order
  async cancelOrder(orderLike) {
    const orderId = typeof orderLike === 'string' ? orderLike : orderLike?.orderId;
    if (!orderId) return false;
    try {
      await this.withAuthRetry(() => this.kc.cancelOrder('regular', orderId));
      return true;
    } catch (err) {
      if (this.isAuthError(err)) {
        console.warn('[kite] Cancel failed due to auth; token refresh/re-login required.');
      }
      console.error('[kite] Cancel order failed:', err.message);
      return false;
    }
  }

  async getPortfolioState() {
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const pickNum = (obj, paths, fallback = 0) => {
      for (const p of paths) {
        const val = p.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
        const n = Number(val);
        if (Number.isFinite(n)) return n;
      }
      return fallback;
    };

    const [margins, positions, holdings] = await this.withAuthRetry(() => Promise.all([
      this.kc.getMargins(),
      this.kc.getPositions(),
      this.kc.getHoldings(),
    ]));

    const equity = margins?.equity || {};
    const netPositions = Array.isArray(positions?.net) ? positions.net : [];
    const dayPositions = Array.isArray(positions?.day) ? positions.day : [];
    const holdingsList = Array.isArray(holdings) ? holdings : [];

    const availableCash = pickNum(equity, [
      'available.cash',
      'available.live_balance',
      'available.opening_balance',
      'available.net',
      'net',
    ], 0);
    const utilizedMargin = pickNum(equity, [
      'utilised.debits',
      'utilised.span',
      'utilised.exposure',
      'utilised.m2m_realised',
    ], 0);
    const netEquity = pickNum(equity, ['net'], availableCash);

    const openPositions = netPositions.filter(p => Math.abs(toNum(p.quantity)) > 0);
    const dayPnl = dayPositions.reduce((sum, p) => sum + toNum(p.pnl), 0);
    const totalPnl = netPositions.reduce((sum, p) => sum + toNum(p.pnl), 0);
    const holdingsValue = holdingsList.reduce((sum, h) => {
      const qty = toNum(h.quantity);
      const ltp = toNum(h.last_price);
      return sum + (qty * ltp);
    }, 0);

    const positionsList = openPositions
      .map(p => ({
        symbol: String(p.tradingsymbol || p.symbol || '--'),
        qty: toNum(p.quantity),
        pnl: toNum(p.pnl),
        ltp: toNum(p.last_price || 0),
        avgPrice: toNum(p.average_price || 0),
        investedValue: toNum(p.average_price || 0) * Math.abs(toNum(p.quantity)),
        exchange: String(p.exchange || ''),
      }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

    const holdingsDetails = holdingsList
      .map(h => {
        const qty = toNum(h.quantity);
        const avgPrice = toNum(h.average_price);
        const ltp = toNum(h.last_price);
        const investedValue = qty * avgPrice;
        const marketValue = qty * ltp;
        const unrealizedPnl = Number.isFinite(Number(h.pnl)) ? toNum(h.pnl) : marketValue - investedValue;
        return {
          symbol: String(h.tradingsymbol || h.symbol || '--'),
          exchange: String(h.exchange || ''),
          isin: String(h.isin || ''),
          qty,
          t1Qty: toNum(h.t1_quantity),
          avgPrice,
          ltp,
          closePrice: toNum(h.close_price),
          dayChangePct: toNum(h.day_change_percentage),
          investedValue,
          marketValue,
          pnl: unrealizedPnl,
        };
      })
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));

    return {
      asOf: Date.now(),
      funds: {
        availableCash,
        utilizedMargin,
        netEquity,
      },
      positions: {
        openCount: openPositions.length,
        dayCount: dayPositions.length,
        dayPnl,
        totalPnl,
        list: positionsList,
      },
      holdings: {
        count: holdingsList.length,
        marketValue: holdingsValue,
        list: holdingsDetails,
      },
    };
  }
}

module.exports = KiteClient;
