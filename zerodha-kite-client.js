// zerodha-kite-client.js
const https = require('https');
const querystring = require('querystring');

const KITE_BASE_URL = 'api.kite.trade';
const KITE_SANDBOX_URL = 'sandbox-api.kite.trade';

class KiteClient {
  constructor(apiKey, apiSecret, accessToken, isDryRun = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.accessToken = accessToken;
    this.isDryRun = isDryRun;
    this.host = isDryRun ? KITE_SANDBOX_URL : KITE_BASE_URL;
    this.lastTokenRefreshAt = Date.now();
  }

  // HTTP request helper
  async request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        path: path,
        method: method,
        headers: {
          'Authorization': `token ${this.apiKey}:${this.accessToken}`,
          'X-Kite-Version': '3',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode >= 400) {
              const err = new Error(json.message || `HTTP ${res.statusCode}`);
              err.statusCode = res.statusCode;
              err.response = json;
              reject(err);
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);

      if (data) {
        req.write(querystring.stringify(data));
      }
      req.end();
    });
  }

  // Refresh access token using apiKey + apiSecret
  async refreshAccessToken() {
    try {
      console.log('[kite] Access token refresh requested');
      // In real Kite API, you'd POST to /session/token with credentials
      // For now, this is a placeholder - implement with actual Kite session endpoint
      this.lastTokenRefreshAt = Date.now();
      return true;
    } catch (err) {
      console.error('[kite] Token refresh failed:', err.message);
      return false;
    }
  }

  // Place order on Kite
  async placeOrder(orderData) {
    try {
      const response = await this.request('POST', '/orders/regular', orderData);
      
      if (response.data && response.data.order_id) {
        return response.data.order_id;
      } else if (response.order_id) {
        return response.order_id;
      }
      throw new Error('No order_id in response');
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        console.warn('[kite] Auth error, attempting token refresh...');
        await this.refreshAccessToken();
        throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      }
      throw err;
    }
  }

  // Get order status
  async getOrderStatus(orderId) {
    try {
      const response = await this.request('GET', `/orders/${orderId}`);
      
      const orderData = response.data || response;
      return {
        orderId: orderData.order_id || orderId,
        status: orderData.status, // COMPLETE, REJECTED, CANCELLED, PENDING
        filledQuantity: orderData.filled_quantity || 0,
        pendingQuantity: (orderData.quantity || 0) - (orderData.filled_quantity || 0),
        averagePrice: orderData.average_price || 0,
        statusMessage: orderData.status_message || orderData.status
      };
    } catch (err) {
      if (err.statusCode === 401 || err.statusCode === 403) {
        throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      }
      throw err;
    }
  }

  // Cancel order
  async cancelOrder(orderId) {
    try {
      await this.request('DELETE', `/orders/${orderId}`);
      return true;
    } catch (err) {
      console.error('[kite] Cancel order failed:', err.message);
      return false;
    }
  }
}

module.exports = KiteClient;
