// zerodha-confirmation-poller.js

class ConfirmationPoller {
  constructor(brokerClient, deps, brokerModeGetter, options = {}) {
    this.brokerClient = brokerClient;
    if (Array.isArray(deps)) {
      // Backward compatibility for older constructor usage.
      this.loadTrades = () => deps;
      this.saveTrades = () => {};
      this.broadcast = () => {};
      this.computePnl = null;
      this.journal = () => {};
    } else {
      this.loadTrades = typeof deps?.loadTrades === 'function' ? deps.loadTrades : () => [];
      this.saveTrades = typeof deps?.saveTrades === 'function' ? deps.saveTrades : () => {};
      this.broadcast = typeof deps?.broadcast === 'function' ? deps.broadcast : () => {};
      this.computePnl = typeof deps?.computePnl === 'function' ? deps.computePnl : null;
      this.journal = typeof deps?.journal === 'function' ? deps.journal : () => {};
    }
    this.brokerModeGetter = brokerModeGetter; // function that returns current brokerMode
    this.options = {
      brokerName: options.brokerName || 'zerodha',
      liveMode: options.liveMode || 'zerodha_live',
      dryMode: Object.prototype.hasOwnProperty.call(options, 'dryMode') ? options.dryMode : 'zerodha_dry_run',
      liveTradeMode: options.liveTradeMode || 'live',
      dryTradeMode: options.dryTradeMode || 'dry-run',
      classifyOrderStatus: typeof options.classifyOrderStatus === 'function' ? options.classifyOrderStatus : null,
    };
    this.pollingInterval = null;
    this.pollIntervalMs = 10000; // 10 seconds
    this.maxTimeoutMs = 900000; // 15 minutes
    this.maxAttempts = 90;
  }

  normalizeOrderStatus(status) {
    return String(status || '').trim().toUpperCase().replace(/\s+/g, '_');
  }

  classifyOrderStatus(status) {
    if (this.options.classifyOrderStatus) {
      return this.options.classifyOrderStatus(status);
    }
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
    
    this.pollingInterval = setInterval(() => this.pollCycle(), this.pollIntervalMs);
    console.log('[confirmation-poller] Started polling every 10s');
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[confirmation-poller] Stopped polling');
    }
  }

  async pollCycle() {
    await this.pollPendingTrades();
    await this.pollExitPlacedTrades();
  }

  async pollPendingTrades() {
    try {
      const brokerMode = this.brokerModeGetter();
      const inLiveMode = brokerMode === this.options.liveMode;
      const inDryMode = this.options.dryMode ? brokerMode === this.options.dryMode : false;
      if (!inLiveMode && !inDryMode) {
        return;
      }

      const allTrades = this.loadTrades();
      const targetTradeMode = inLiveMode ? this.options.liveTradeMode : this.options.dryTradeMode;
      const trades = allTrades.filter(t => 
        t.broker?.name === this.options.brokerName &&
        t.broker?.status === 'pending' && 
        t.broker?.mode === targetTradeMode
      );

      for (const trade of trades) {
        await this.checkTradeConfirmation(trade, allTrades);
      }
    } catch (err) {
      console.error('[confirmation-poller] Poll cycle error:', err.message);
    }
  }

  async pollExitPlacedTrades() {
    try {
      const allTrades = this.loadTrades();
      const trades = allTrades.filter(t =>
        t.broker?.name === this.options.brokerName &&
        t.broker?.status === 'exit_placed' &&
        t.broker?.exitOrderId
      );

      for (const trade of trades) {
        await this.checkExitConfirmation(trade, allTrades);
      }
    } catch (err) {
      console.error('[confirmation-poller] Exit poll cycle error:', err.message);
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

  async checkExitConfirmation(trade, trades) {
    try {
      const exitPlacedAt = trade.broker.exitPlacedAt || trade.broker.confirmedAt || trade.broker.createdAt;
      const exitPlacedMs = new Date(exitPlacedAt || 0).getTime();
      const elapsedMs = Date.now() - (Number.isFinite(exitPlacedMs) ? exitPlacedMs : Date.now());
      const nowIso = new Date().toISOString();

      if (elapsedMs > this.maxTimeoutMs) {
        trade.broker.status = 'exit_timeout';
        trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
        trade.broker.audit.push({ at: nowIso, event: 'exit_confirmation_timeout', elapsedMs, exitOrderId: trade.broker.exitOrderId });
        this.persistTradeUpdates(trades, 'exit-timeout');
        console.warn(`[confirmation-poller] Exit order timeout for trade ${trade.id} (${trade.symbol})`);
        return;
      }

      const orderStatus = await this.brokerClient.getOrderStatus(trade.broker.exitOrderId, trade.broker.exchange);
      const statusClass = this.classifyOrderStatus(orderStatus.status);

      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];

      if (statusClass === 'confirmed') {
        const fillPrice = Number(orderStatus.averagePrice);
        const exitPrice = Number.isFinite(fillPrice) && fillPrice > 0 ? fillPrice : Number(trade.pendingExit?.requestedPrice ?? trade.pendingPartialExit?.requestedPrice);
        const pendingPartial = trade.pendingPartialExit;
        if (pendingPartial) {
          const requestedQty = Math.max(1, Math.floor(Number(pendingPartial.qty) || 0));
          const reportedFilled = Math.floor(Number(orderStatus.filledQuantity) || requestedQty);
          const filledQty = Math.min(Number(trade.qty) || 0, requestedQty, reportedFilled);
          if (filledQty <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) return;
          const partial = {
            ...trade,
            id:`${trade.id}-partial-${Date.now()}`,
            parentId:trade.id,
            status:'closed',
            qty:filledQty,
            reservedCapital:+(Number(trade.entryPrice) * filledQty).toFixed(2),
            exitPrice:+exitPrice.toFixed(2),
            closedAt:nowIso,
            closeReason:pendingPartial.reason || 'Simulation partial exit',
            pendingPartialExit:null,
            pendingExit:null,
          };
          if (typeof this.computePnl === 'function') Object.assign(partial, this.computePnl(partial, exitPrice) || {});
          trade.qty = Math.max(0, Number(trade.qty) - filledQty);
          trade.reservedCapital = +(Number(trade.entryPrice) * trade.qty).toFixed(2);
          trade._partialTargetBooked = true;
          trade._runnerArmed = true;
          trade._runnerWideTrail = !!pendingPartial.runner;
          if (Number.isFinite(Number(pendingPartial.newTarget))) trade.target = Number(pendingPartial.newTarget);
          if (pendingPartial.protectRemainder) {
            if (String(trade.side || '').toLowerCase() === 'sell') trade._shortProfitLockArmed = true;
            else trade._longProfitLockArmed = true;
          }
          trade.partialExits = [...(trade.partialExits || []), { id:partial.id, qty:filledQty, exitPrice:+exitPrice.toFixed(2), closedAt:nowIso, reason:partial.closeReason, pnl:partial.pnl }];
          trade.pendingPartialExit = null;
          trade.broker.status = 'confirmed';
          trade.broker.exitOrderId = null;
          trade.broker.exitPlacedAt = null;
          trades.unshift(partial);
        } else {
          trade.status = 'closed';
          trade.closedAt = nowIso;
          trade.closeReason = trade.pendingExit?.reason || trade.closeReason || 'Simulation exit';
          trade.broker.status = 'exit_confirmed';
          trade.pendingExit = null;
        }
        trade.broker.exitConfirmedAt = nowIso;
        trade.broker.audit.push({ at: nowIso, event: 'exit_order_confirmed', exitOrderId: trade.broker.exitOrderId, fillPrice, filledQty: orderStatus.filledQuantity });
        // Update exit price and recompute pnl from actual fill price
        if (!pendingPartial && Number.isFinite(exitPrice) && exitPrice > 0) {
          trade.exitPrice = +exitPrice.toFixed(2);
          if (typeof this.computePnl === 'function') {
            const pnl = this.computePnl(trade, exitPrice);
            if (pnl) {
              trade.pnl = pnl.pnl;
              trade.pnlPct = pnl.pnlPct;
              trade.grossPnl = pnl.grossPnl;
              trade.charges = pnl.charges;
              trade.chargeBreakup = pnl.chargeBreakup;
            }
          }
        }
        this.persistTradeUpdates(trades, 'exit-confirmed');
        this.journal(pendingPartial ? 'partial_exit_confirmed' : 'exit_confirmed', { tradeId:trade.id, symbol:trade.symbol, exitPrice, filledQuantity:orderStatus.filledQuantity, orderId:orderStatus.orderId || trade.broker.exitOrderId }, nowIso);
        console.log(`[confirmation-poller] Exit confirmed for trade ${trade.id} (${trade.symbol}) @ ${exitPrice}`);
      } else if (statusClass === 'rejected' || statusClass === 'cancelled') {
        // Exit order failed — reopen the trade so it can be exited again
        trade.broker.status = 'confirmed';
        trade.broker.exitOrderId = null;
        trade.broker.error = orderStatus.statusMessage || orderStatus.status;
        trade.broker.audit.push({ at: nowIso, event: `exit_order_${statusClass}`, exitOrderId: trade.broker.exitOrderId, reason: orderStatus.statusMessage });
        trade.pendingExit = null;
        trade.pendingPartialExit = null;
        // Reopen local trade
        trade.status = 'open';
        trade.exitPrice = null;
        trade.closedAt = null;
        trade.closeReason = null;
        trade.pnl = null;
        trade.pnlPct = null;
        trade.grossPnl = null;
        trade.charges = null;
        trade.chargeBreakup = null;
        this.persistTradeUpdates(trades, 'exit-reverted');
        this.journal('exit_reverted', { tradeId:trade.id, symbol:trade.symbol, status:statusClass, reason:orderStatus.statusMessage }, nowIso);
        console.warn(`[confirmation-poller] Exit order ${statusClass} for trade ${trade.id} (${trade.symbol}) — trade reopened`);
      }
      // else: still pending, keep polling
    } catch (err) {
      if (err.message === 'AUTH_FAILED_REFRESH_NEEDED') {
        console.warn(`[confirmation-poller] Auth error on exit check for trade ${trade.id}, will retry`);
        return;
      }
      console.error(`[confirmation-poller] Error checking exit for trade ${trade.id}:`, err.message);
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
          cancelled = await this.brokerClient.cancelOrder(trade.broker);
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

      const orderStatus = await this.brokerClient.getOrderStatus(trade.broker.orderId, trade.broker.exchange);
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
        // Broker client will handle token refresh
        return;
      }
      console.error(`[confirmation-poller] Error checking trade ${trade.id}:`, err.message);
    }
  }
}

module.exports = ConfirmationPoller;
