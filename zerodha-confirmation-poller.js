// zerodha-confirmation-poller.js

class ConfirmationPoller {
  constructor(kiteClient, deps, brokerModeGetter) {
    this.kiteClient = kiteClient;
    if (Array.isArray(deps)) {
      // Backward compatibility for older constructor usage.
      this.loadTrades = () => deps;
      this.saveTrades = () => {};
      this.broadcast = () => {};
    } else {
      this.loadTrades = typeof deps?.loadTrades === 'function' ? deps.loadTrades : () => [];
      this.saveTrades = typeof deps?.saveTrades === 'function' ? deps.saveTrades : () => {};
      this.broadcast = typeof deps?.broadcast === 'function' ? deps.broadcast : () => {};
    }
    this.brokerModeGetter = brokerModeGetter; // function that returns current brokerMode
    this.pollingInterval = null;
    this.pollIntervalMs = 10000; // 10 seconds
    this.maxTimeoutMs = 900000; // 15 minutes
    this.maxAttempts = 90;
  }

  normalizeOrderStatus(status) {
    return String(status || '').trim().toUpperCase().replace(/\s+/g, '_');
  }

  classifyOrderStatus(status) {
    const normalized = this.normalizeOrderStatus(status);
    if (normalized === 'COMPLETE') return 'confirmed';
    if (normalized === 'REJECTED') return 'rejected';
    if (normalized === 'CANCELLED') return 'cancelled';
    if ([
      'OPEN',
      'PENDING',
      'OPEN_PENDING',
      'TRIGGER_PENDING',
      'VALIDATION_PENDING',
      'PUT_ORDER_REQ_RECEIVED',
      'MODIFY_PENDING',
      'MODIFY_VALIDATION_PENDING',
      'CANCEL_PENDING',
      'AMO_REQ_RECEIVED'
    ].includes(normalized)) return 'pending';
    return 'unknown';
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

      const allTrades = this.loadTrades();
      const trades = allTrades.filter(t => 
        t.broker?.status === 'pending' && 
        t.broker?.mode === (brokerMode === 'zerodha_live' ? 'live' : 'dry-run')
      );

      for (const trade of trades) {
        await this.checkTradeConfirmation(trade, allTrades);
      }
    } catch (err) {
      console.error('[confirmation-poller] Poll cycle error:', err.message);
    }
  }

  persistTradeUpdates(trades, reason = 'broker-update') {
    try {
      this.saveTrades(trades);
      this.broadcast(reason);
    } catch (err) {
      console.error('[confirmation-poller] Persist error:', err.message);
    }
  }

  async checkTradeConfirmation(trade, trades) {
    try {
      const createdAtMs = new Date(trade.broker.createdAt || 0).getTime();
      const elapsedMs = Date.now() - (Number.isFinite(createdAtMs) ? createdAtMs : Date.now());
      
      // Check timeout: 15 minutes
      if (elapsedMs > this.maxTimeoutMs) {
        let cancelled = false;
        if (trade.broker?.orderId) {
          cancelled = await this.kiteClient.cancelOrder(trade.broker.orderId);
        }
        const nowIso = new Date().toISOString();
        trade.broker.status = cancelled ? 'cancelled' : 'timeout';
        trade.broker.confirmationError = 'Order not confirmed within 15 minutes';
        trade.broker.audit.push({
          at: nowIso,
          event: 'confirmation_timeout',
          elapsedMs,
          attempts: trade.broker.confirmationAttempts
        });
        if (cancelled) {
          trade.broker.audit.push({
            at: nowIso,
            event: 'timeout_auto_cancelled',
            orderId: trade.broker.orderId,
          });
        }

        // Auto-close local trade because entry was never confirmed.
        trade.status = 'closed';
        trade.closedAt = nowIso;
        trade.closeReason = cancelled
          ? 'Auto-cancelled after entry timeout'
          : 'Auto-timeout without confirmation';
        trade.exitPrice = Number(trade.entryPrice) || null;
        trade.pnl = 0;
        trade.pnlPct = 0;
        trade.grossPnl = 0;
        trade.charges = 0;
        trade.chargeBreakup = trade.chargeBreakup || null;

        this.persistTradeUpdates(trades, 'timeout-auto-exit');
        console.warn(`[confirmation-poller] Trade ${trade.id} timeout after ${Math.round(elapsedMs/1000)}s`);
        return;
      }

      const orderStatus = await this.kiteClient.getOrderStatus(trade.broker.orderId);
      trade.broker.confirmationAttempts++;
      trade.broker.lastBrokerStatus = orderStatus.status;
      trade.broker.lastBrokerStatusMessage = orderStatus.statusMessage || orderStatus.status;
      trade.broker.lastFilledQuantity = Number(orderStatus.filledQuantity || 0);
      trade.broker.lastPendingQuantity = Number(orderStatus.pendingQuantity || 0);

      const statusClass = this.classifyOrderStatus(orderStatus.status);

      if (statusClass === 'confirmed') {
        trade.broker.status = 'confirmed';
        trade.broker.confirmedAt = new Date().toISOString();
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_confirmed',
          filledQty: orderStatus.filledQuantity,
          avgPrice: orderStatus.averagePrice,
          attempts: trade.broker.confirmationAttempts
        });
        this.persistTradeUpdates(trades, 'order-confirmed');
        console.log(`[confirmation-poller] Trade ${trade.id} confirmed in ${Math.round(elapsedMs/1000)}s (attempt ${trade.broker.confirmationAttempts})`);
      } else if (statusClass === 'rejected' || statusClass === 'cancelled') {
        trade.broker.status = statusClass;
        trade.broker.confirmationError = orderStatus.statusMessage || orderStatus.status;
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: statusClass === 'cancelled' ? 'order_cancelled' : 'order_rejected',
          reason: orderStatus.statusMessage,
          attempts: trade.broker.confirmationAttempts
        });
        trade.status = 'closed';
        trade.closedAt = new Date().toISOString();
        trade.closeReason = `Entry ${statusClass}`;
        trade.exitPrice = Number(trade.entryPrice) || null;
        trade.pnl = 0;
        trade.pnlPct = 0;
        trade.grossPnl = 0;
        trade.charges = 0;
        trade.chargeBreakup = trade.chargeBreakup || null;
        this.persistTradeUpdates(trades, statusClass === 'cancelled' ? 'order-cancelled' : 'order-rejected');
        console.warn(`[confirmation-poller] Trade ${trade.id} ${statusClass}: ${orderStatus.statusMessage}`);
      } else if (statusClass === 'unknown') {
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_status_unknown',
          status: orderStatus.status,
          reason: orderStatus.statusMessage,
          attempts: trade.broker.confirmationAttempts
        });
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
