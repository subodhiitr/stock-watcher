// zerodha-confirmation-poller.js

class ConfirmationPoller {
  constructor(kiteClient, paperTradesStore, brokerModeGetter) {
    this.kiteClient = kiteClient;
    this.paperTradesStore = paperTradesStore; // reference to paper_trades array
    this.brokerModeGetter = brokerModeGetter; // function that returns current brokerMode
    this.pollingInterval = null;
    this.pollIntervalMs = 10000; // 10 seconds
    this.maxTimeoutMs = 900000; // 15 minutes
    this.maxAttempts = 90;
  }

  start() {
    if (this.pollingInterval) return;
    
    this.pollingInterval = setInterval(() => this.pollPendingTrades(), this.pollIntervalMs);
    console.log('[confirmation-poller] Started polling every 10s');
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[confirmation-poller] Stopped polling');
    }
  }

  async pollPendingTrades() {
    try {
      const brokerMode = this.brokerModeGetter();
      
      // Only poll if in zerodha modes
      if (brokerMode !== 'zerodha_live' && brokerMode !== 'zerodha_dry_run') {
        return;
      }

      const trades = this.paperTradesStore.filter(t => 
        t.broker?.status === 'pending' && 
        t.broker?.mode === (brokerMode === 'zerodha_live' ? 'live' : 'dry-run')
      );

      for (const trade of trades) {
        await this.checkTradeConfirmation(trade);
      }
    } catch (err) {
      console.error('[confirmation-poller] Poll cycle error:', err.message);
    }
  }

  async checkTradeConfirmation(trade) {
    try {
      const elapsedMs = Date.now() - trade.broker.createdAt;
      
      // Check timeout: 15 minutes
      if (elapsedMs > this.maxTimeoutMs) {
        trade.broker.status = 'timeout';
        trade.broker.confirmationError = 'Order not confirmed within 15 minutes';
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'confirmation_timeout',
          elapsedMs,
          attempts: trade.broker.confirmationAttempts
        });
        console.warn(`[confirmation-poller] Trade ${trade.id} timeout after ${Math.round(elapsedMs/1000)}s`);
        return;
      }

      const orderStatus = await this.kiteClient.getOrderStatus(trade.broker.orderId);
      trade.broker.confirmationAttempts++;

      if (orderStatus.status === 'COMPLETE') {
        trade.broker.status = 'confirmed';
        trade.broker.confirmedAt = new Date().toISOString();
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_confirmed',
          filledQty: orderStatus.filledQuantity,
          avgPrice: orderStatus.averagePrice,
          attempts: trade.broker.confirmationAttempts
        });
        console.log(`[confirmation-poller] Trade ${trade.id} confirmed in ${Math.round(elapsedMs/1000)}s (attempt ${trade.broker.confirmationAttempts})`);
      } else if (orderStatus.status === 'REJECTED' || orderStatus.status === 'CANCELLED') {
        trade.broker.status = 'rejected';
        trade.broker.confirmationError = orderStatus.statusMessage || orderStatus.status;
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_rejected',
          reason: orderStatus.statusMessage,
          attempts: trade.broker.confirmationAttempts
        });
        console.warn(`[confirmation-poller] Trade ${trade.id} rejected: ${orderStatus.statusMessage}`);
      }
      // else: still pending, continue polling
    } catch (err) {
      if (err.message === 'AUTH_FAILED_REFRESH_NEEDED') {
        console.warn(`[confirmation-poller] Auth error on trade ${trade.id}, will retry`);
        // Kite client will handle token refresh
        return;
      }
      console.error(`[confirmation-poller] Error checking trade ${trade.id}:`, err.message);
    }
  }
}

module.exports = ConfirmationPoller;
