async function handleTradeExecutionRoute(req, res, pathname, searchParams, deps) {
  if (pathname === deps.tradeExecutionStreamPath || pathname === deps.paperTradesAliasStreamPath) {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const client = {
      res,
      keepAlive: setInterval(() => {
        try { res.write(': ping\n\n'); } catch (_) {}
      }, 25000),
    };
    deps.paperTradeStreamClients.add(client);
    deps.writeSseEvent(res, deps.buildPaperTradeStreamPayload('init'));
    req.on('close', () => {
      if (client.keepAlive) clearInterval(client.keepAlive);
      deps.paperTradeStreamClients.delete(client);
    });
    return true;
  }

  if (pathname !== deps.tradeExecutionPath && pathname !== deps.paperTradesAliasPath) return false;

  if (req.method === 'GET') {
    const includeAll = searchParams.get('scope') === 'all' || searchParams.get('all') === '1';
    const selectedDate = String(searchParams.get('date') || '').trim();
    if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid date; expected YYYY-MM-DD' }));
      return true;
    }
    const state = deps.loadPaperStateFile({ includeAll, date: selectedDate || null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, trades: state.trades, portfolio: state.portfolio }));
    return true;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  await deps.runWithMutationLock(async () => {
    try {
      const payload = await deps.readJsonBody(req);
      const action = String(payload.action || '').toLowerCase();
      const state = deps.loadPaperStateFile();
      const trades = state.trades;

      if (action === 'add-capital') {
        const amount = Number(payload.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Positive amount is required' }));
          return;
        }
        state.portfolio = state.portfolio || deps.defaultPaperPortfolio();
        state.portfolio.capitalAdds = Array.isArray(state.portfolio.capitalAdds) ? state.portfolio.capitalAdds : [];
        state.portfolio.capitalAdds.push({
          amount:+amount.toFixed(2),
          at: new Date().toISOString(),
          note: String(payload.note || 'Manual capital add'),
        });
        deps.savePaperStateFile(state);
        deps.broadcastPaperTradeState('add-capital');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, portfolio: state.portfolio }));
        return;
      }

      if (action === 'set-initial-capital') {
        const amount = Number(payload.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Positive initial capital is required' }));
          return;
        }
        state.portfolio = state.portfolio || deps.defaultPaperPortfolio();
        state.portfolio.initialCapital = +amount.toFixed(2);
        state.portfolio.capitalAdds = Array.isArray(state.portfolio.capitalAdds) ? state.portfolio.capitalAdds : [];
        deps.savePaperStateFile(state);
        deps.broadcastPaperTradeState('set-initial-capital');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, portfolio: state.portfolio }));
        return;
      }

      if (action === 'open') {
        await handleOpenTrade(req, res, payload, trades, deps);
        return;
      }

      if (action === 'close') {
        await handleCloseTrade(res, payload, trades, deps);
        return;
      }

      if (action === 'partial-close') {
        await handlePartialCloseTrade(res, payload, trades, deps);
        return;
      }

      if (action === 'delete') {
        const id = String(payload.id || '');
        const trade = trades.find(t => t.id === id);
        if (trade && trade.status !== 'closed') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Only closed trades can be deleted', code: 'TRADE_NOT_CLOSED' }));
          return;
        }
        if (deps.isDbReady() && id) {
          try { deps.deleteTrade(id); } catch (e) { console.warn('[trades] Delete failed:', id, e.message); }
        }
        const next = trades.filter(t => t.id !== id);
        deps.savePaperTradesFile(next);
        deps.broadcastPaperTradeState('delete');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted: trades.length - next.length }));
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown action' }));
    } catch (e) {
      res.writeHead(deps.jsonBodyErrorStatus(e), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || 'Invalid JSON' }));
    }
  });
  return true;
}

async function handleOpenTrade(req, res, payload, trades, deps) {
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  const side = String(payload.side || 'buy').toLowerCase();
  const qty = Number(payload.qty);
  const entryPrice = Number(payload.entryPrice);
  if (!symbol || !['buy', 'sell'].includes(side) || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'symbol, side, qty and entryPrice are required' }));
    return;
  }
  const existing = trades.find(t => t.symbol === symbol && t.status === 'open');
  if (existing) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open paper trade already exists for this symbol', trade: existing }));
    return;
  }
  const requestedMode = String(payload.brokerMode || payload.executionMode || '').toLowerCase();
  const executionMode = deps.validBrokerModes.has(requestedMode) ? requestedMode : 'zerodha_dry_run';
  if (executionMode !== 'zerodha_dry_run' && !deps.hasLiveTradeConfirmation(req, payload)) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Live trade execution requires confirmation token LIVE' }));
    return;
  }
  const dryRunEntryOrder = executionMode === 'zerodha_dry_run'
    ? deps.buildZerodhaDryRunOrder({ ...payload, symbol, side, qty, entryPrice, assetType: payload.assetType === 'etf' ? 'etf' : 'stock' }, null, 'entry')
    : null;
  const trade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'open',
    symbol,
    name: String(payload.name || symbol),
    side,
    qty,
    entryPrice:+entryPrice.toFixed(2),
    target: Number.isFinite(Number(payload.target)) ? +Number(payload.target).toFixed(2) : null,
    stop: Number.isFinite(Number(payload.stop)) ? +Number(payload.stop).toFixed(2) : null,
    signal: payload.signal || null,
    score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
    rr: Number.isFinite(Number(payload.rr)) ? Number(payload.rr) : null,
    reservedCapital: Number.isFinite(Number(payload.reservedCapital)) ? +Number(payload.reservedCapital).toFixed(2) : +(entryPrice * qty).toFixed(2),
    portfolioInitial: Number.isFinite(Number(payload.portfolioInitial)) ? +Number(payload.portfolioInitial).toFixed(2) : null,
    source: payload.source === 'simulation' ? 'simulation' : 'manual',
    assetType: payload.assetType === 'etf' ? 'etf' : 'stock',
    setupType: payload.setupType || null,
    setup: payload.setup || null,
    entryContext: payload.entryContext && typeof payload.entryContext === 'object' ? payload.entryContext : null,
    notes: payload.notes || '',
    openedAt: String(payload.transactionTime || '').match(/\d{4}-\d{2}-\d{2}T/) ? payload.transactionTime : new Date().toISOString(),
    executionMode,
  };
  Object.assign(
    trade,
    deps.normalizeTradeOwnership(
      trade,
      deps.getTradeOwnershipContext('off', deps.loadTradeSettingsFile().overrides || {}),
      { applyTransitions: false }
    )
  );
  if (dryRunEntryOrder) {
    trade.broker = {
      name: 'zerodha',
      mode: 'dry-run',
      status: 'entry_dry_run',
      entryOrder: dryRunEntryOrder,
      exitPlan: { target: trade.target, stop: trade.stop, squareOff: 'intraday dashboard managed exit' },
      audit: [{ at: trade.openedAt, event: 'entry_dry_run_created', order: dryRunEntryOrder }],
    };
  } else if (executionMode === 'zerodha_live' && ((deps.getKiteClientLive() && deps.getZerodhaCredentials()) || await deps.ensureZerodhaInitialized({ force: true }))) {
    const kiteClientLive = deps.getKiteClientLive();
    const liveEntryOrder = deps.buildZerodhaDryRunOrder({ ...payload, symbol, side, qty, entryPrice, assetType: payload.assetType === 'etf' ? 'etf' : 'stock' }, null, 'entry');
    try {
      const orderId = await kiteClientLive.placeOrder(liveEntryOrder);
      trade.broker = {
        name: 'zerodha',
        mode: 'live',
        orderId,
        status: 'pending',
        createdAt: trade.openedAt,
        confirmedAt: null,
        confirmationAttempts: 0,
        confirmationError: null,
        exitPlan: { target: trade.target, stop: trade.stop, squareOff: 'intraday dashboard managed exit' },
        audit: [{ at: trade.openedAt, event: 'live_order_placed', orderId, elapsed: 0, attempts: 1 }],
      };
      deps.setZerodhaLiveFailureCount(0);
      console.log(`[zerodha-live] Order placed: ${orderId} for ${symbol}`);
    } catch (e) {
      if (!deps.isZerodhaIpBlockError(e)) deps.setZerodhaLiveFailureCount(deps.getZerodhaLiveFailureCount() + 1);
      console.error(`[zerodha-live] Order placement failed (${deps.getZerodhaLiveFailureCount()}):`, e.message);
      if (deps.getZerodhaLiveFailureCount() >= 3) {
        console.warn('[zerodha-live] Too many failures. Disabling zerodha_live mode, falling back to Zerodha dry-run mode.');
        deps.setBrokerMode('zerodha_dry_run');
      }
      trade.status = 'failed';
      trade.broker = { name: 'zerodha', mode: 'live', status: 'failed', error: e.message, createdAt: trade.openedAt, audit: [{ at: trade.openedAt, event: 'live_order_failed', error: e.message }] };
    }
  } else if (executionMode === 'sharekhan_live' && ((deps.getSharekhanClientLive() && deps.getSharekhanCredentials()) || await deps.ensureSharekhanInitialized({ force: true }))) {
    const sharekhanClientLive = deps.getSharekhanClientLive();
    try {
      const scripCode = await deps.withSharekhanCredentialReload(() => sharekhanClientLive.resolveScripCode(symbol, 'NC'));
      const sharekhanEntryOrder = deps.buildSharekhanLiveOrder({ ...payload, symbol, side, qty, entryPrice }, null, 'entry', scripCode);
      if (!sharekhanEntryOrder) throw new Error(`Unable to build Sharekhan order for ${symbol}. Ensure scrip code is available.`);
      const orderId = await deps.withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(sharekhanEntryOrder));
      trade.broker = {
        name: 'sharekhan',
        mode: 'live',
        orderId,
        exchange: sharekhanEntryOrder.exchange,
        scripCode,
        status: 'pending',
        createdAt: trade.openedAt,
        confirmedAt: null,
        confirmationAttempts: 0,
        confirmationError: null,
        exitPlan: { target: trade.target, stop: trade.stop, squareOff: 'intraday dashboard managed exit' },
        audit: [{ at: trade.openedAt, event: 'live_order_placed', orderId, elapsed: 0, attempts: 1 }],
      };
      deps.setSharekhanLiveFailureCount(0);
      console.log(`[sharekhan-live] Order placed: ${orderId} for ${symbol}`);
    } catch (e) {
      deps.setSharekhanLiveFailureCount(deps.getSharekhanLiveFailureCount() + 1);
      console.error(`[sharekhan-live] Order placement failed (${deps.getSharekhanLiveFailureCount()}):`, e.message);
      if (deps.getSharekhanLiveFailureCount() >= 3) {
        console.warn('[sharekhan-live] Too many failures. Disabling sharekhan_live mode, falling back to Zerodha dry-run mode.');
        deps.setBrokerMode('zerodha_dry_run');
      }
      trade.status = 'failed';
      trade.broker = { name: 'sharekhan', mode: 'live', status: 'failed', error: e.message, createdAt: trade.openedAt, audit: [{ at: trade.openedAt, event: 'live_order_failed', error: e.message }] };
    }
  }
  trades.unshift(trade);
  deps.savePaperTradesFile(trades);
  deps.broadcastPaperTradeState('open');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, trade }));
}

async function handleCloseTrade(res, payload, trades, deps) {
  const id = String(payload.id || '');
  const exitPrice = Number(payload.exitPrice);
  const trade = trades.find(t => t.id === id && t.status === 'open');
  if (!trade) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open trade id is required', code: 'OPEN_TRADE_REQUIRED' }));
    return;
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open trade id and exitPrice are required' }));
    return;
  }
  const closedAt = String(payload.transactionTime || '').match(/\d{4}-\d{2}-\d{2}T/) ? payload.transactionTime : new Date().toISOString();
  const isZerodhaLive = trade.broker?.name === 'zerodha' && trade.broker?.mode === 'live' && trade.broker?.orderId;
  const isSharekhanLive = trade.broker?.name === 'sharekhan' && trade.broker?.mode === 'live' && trade.broker?.orderId;

  if (isZerodhaLive && (deps.getKiteClientLive() || await deps.ensureZerodhaInitialized({ force: true }))) {
    const kiteClientLive = deps.getKiteClientLive();
    try {
      const orderId = trade.broker.orderId;
      if (trade.broker.status === 'pending') {
        await kiteClientLive.cancelOrder(orderId);
        trade.broker.status = 'cancelled';
      } else if (trade.broker.status === 'confirmed') {
        const exitOrder = deps.buildZerodhaDryRunOrder({ ...trade, exitPrice }, trade, 'exit');
        const exitOrderId = await kiteClientLive.placeOrder(exitOrder);
        trade.broker.exitOrderId = exitOrderId;
        trade.broker.status = 'exit_placed';
        trade.broker.exitPlacedAt = closedAt;
      }
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'live_exit_processed', reason: payload.reason || 'Manual exit', orderId: trade.broker.orderId });
      deps.setZerodhaLiveFailureCount(0);
      console.log(`[zerodha-live] Exit processed for order: ${orderId}`);
    } catch (e) {
      if (!deps.isZerodhaIpBlockError(e)) deps.setZerodhaLiveFailureCount(deps.getZerodhaLiveFailureCount() + 1);
      if (deps.getZerodhaLiveFailureCount() >= 3) deps.setBrokerMode('zerodha_dry_run');
      trade.broker.status = 'exit_failed';
      trade.broker.error = e.message;
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'live_exit_failed', error: e.message });
      deps.savePaperTradesFile(trades);
      deps.broadcastPaperTradeState('exit-failed');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Zerodha exit failed: ${e.message}`, code: 'EXIT_FAILED', trade }));
      return;
    }
  } else if (isSharekhanLive && (deps.getSharekhanClientLive() || await deps.ensureSharekhanInitialized({ force: true }))) {
    const sharekhanClientLive = deps.getSharekhanClientLive();
    try {
      const orderId = trade.broker.orderId;
      if (trade.broker.status === 'pending') {
        await deps.withSharekhanCredentialReload(() => sharekhanClientLive.cancelOrder(trade.broker));
        trade.broker.status = 'cancelled';
      } else if (trade.broker.status === 'confirmed') {
        const exitOrder = deps.buildSharekhanLiveOrder({ ...trade, exitPrice }, trade, 'exit', trade.broker.scripCode);
        if (!exitOrder) throw new Error('Unable to build Sharekhan exit order');
        const exitOrderId = await deps.withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(exitOrder));
        trade.broker.exitOrderId = exitOrderId;
        trade.broker.status = 'exit_placed';
        trade.broker.exitPlacedAt = closedAt;
      }
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'live_exit_processed', reason: payload.reason || 'Manual exit', orderId: trade.broker.orderId });
      deps.setSharekhanLiveFailureCount(0);
      console.log(`[sharekhan-live] Exit processed for order: ${orderId}`);
    } catch (e) {
      deps.setSharekhanLiveFailureCount(deps.getSharekhanLiveFailureCount() + 1);
      if (deps.getSharekhanLiveFailureCount() >= 3) deps.setBrokerMode('zerodha_dry_run');
      trade.broker.status = 'exit_failed';
      trade.broker.error = e.message;
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'live_exit_failed', error: e.message });
      deps.savePaperTradesFile(trades);
      deps.broadcastPaperTradeState('exit-failed');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Sharekhan exit failed: ${e.message}`, code: 'EXIT_FAILED', trade }));
      return;
    }
  }

  const pnl = deps.computePaperTradePnl(trade, exitPrice);
  Object.assign(trade, {
    status: 'closed',
    exitPrice:+exitPrice.toFixed(2),
    closedAt,
    closeReason: payload.reason || 'Manual exit',
    pnl: pnl.pnl,
    pnlPct: pnl.pnlPct,
    grossPnl: pnl.grossPnl,
    charges: pnl.charges,
    chargeBreakup: pnl.chargeBreakup,
    exitOwner: 'manual',
    managedBySimulation: false,
    managementState: 'manual_only',
  });
  if (trade.broker?.name === 'zerodha' && trade.broker?.mode === 'dry-run') {
    const exitOrder = deps.buildZerodhaDryRunOrder({ ...trade, exitPrice }, trade, 'exit');
    trade.broker.status = 'exit_dry_run';
    trade.broker.exitOrder = exitOrder;
    trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
    trade.broker.audit.push({ at: closedAt, event: 'exit_dry_run_created', reason: trade.closeReason, order: exitOrder });
  }
  deps.savePaperTradesFile(trades);
  deps.broadcastPaperTradeState('close');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, trade }));
}

async function handlePartialCloseTrade(res, payload, trades, deps) {
  const id = String(payload.id || '');
  const exitPrice = Number(payload.exitPrice);
  const requestedQty = Number(payload.qty);
  const trade = trades.find(t => t.id === id && t.status === 'open');
  const openQty = Math.floor(Number(trade?.qty || 0));
  if (!trade) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open trade id is required', code: 'OPEN_TRADE_REQUIRED' }));
    return;
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0 || !Number.isInteger(requestedQty) || requestedQty <= 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open trade id, partial qty below open qty, and exitPrice are required' }));
    return;
  }
  if (requestedQty >= openQty) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Partial qty must be lower than open qty', code: 'PARTIAL_QTY_CONFLICT' }));
    return;
  }
  const closedAt = String(payload.transactionTime || '').match(/\d{4}-\d{2}-\d{2}T/) ? payload.transactionTime : new Date().toISOString();
  const partialTrade = {
    ...trade,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    parentId: trade.id,
    status: 'closed',
    qty: requestedQty,
    reservedCapital:+(Number(trade.entryPrice) * requestedQty).toFixed(2),
    exitPrice:+exitPrice.toFixed(2),
    closedAt,
    closeReason: payload.reason || 'Partial exit',
    entryOwner: trade.entryOwner,
    exitOwner: 'manual',
    managedBySimulation: false,
    managementState: 'manual_only',
  };
  const pnl = deps.computePaperTradePnl(partialTrade, exitPrice);
  Object.assign(partialTrade, { pnl: pnl.pnl, pnlPct: pnl.pnlPct, grossPnl: pnl.grossPnl, charges: pnl.charges, chargeBreakup: pnl.chargeBreakup });
  trade.qty = openQty - requestedQty;
  trade.reservedCapital = +(Number(trade.entryPrice) * trade.qty).toFixed(2);
  trade.partialExits = Array.isArray(trade.partialExits) ? trade.partialExits : [];
  trade.partialExits.push({ id: partialTrade.id, qty: requestedQty, exitPrice:+exitPrice.toFixed(2), closedAt, reason: partialTrade.closeReason, pnl: pnl.pnl });
  trade._partialTargetBooked = true;
  trade._runnerArmed = true;
  trade._runnerWideTrail = !!payload.runner;
  trade.target = payload.runner && Number.isFinite(Number(payload.target)) ? +Number(payload.target).toFixed(2) : null;
  trade.setupType = trade.setupType || 'TARGET_RUNNER';
  if (trade.broker?.name === 'zerodha' && trade.broker?.mode === 'dry-run') {
    const exitOrder = deps.buildZerodhaDryRunOrder({ ...partialTrade, exitPrice, qty: requestedQty }, partialTrade, 'exit');
    partialTrade.broker = partialTrade.broker || {};
    partialTrade.broker.exitOrder = exitOrder;
    trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
    trade.broker.audit.push({ at: closedAt, event: 'partial_exit_dry_run_created', reason: partialTrade.closeReason, order: exitOrder });
  } else if (trade.broker?.name === 'sharekhan' && trade.broker?.mode === 'live' && (deps.getSharekhanClientLive() || await deps.ensureSharekhanInitialized({ force: true }))) {
    try {
      const sharekhanClientLive = deps.getSharekhanClientLive();
      const exitOrder = deps.buildSharekhanLiveOrder({ ...partialTrade, exitPrice, qty: requestedQty }, partialTrade, 'exit', trade.broker?.scripCode);
      if (!exitOrder) throw new Error('Unable to build Sharekhan partial exit order');
      const exitOrderId = await deps.withSharekhanCredentialReload(() => sharekhanClientLive.placeOrder(exitOrder));
      partialTrade.broker = partialTrade.broker || {};
      partialTrade.broker.exitOrderId = exitOrderId;
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'partial_exit_live_placed', reason: partialTrade.closeReason, orderId: exitOrderId });
      deps.setSharekhanLiveFailureCount(0);
    } catch (e) {
      deps.setSharekhanLiveFailureCount(deps.getSharekhanLiveFailureCount() + 1);
      trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
      trade.broker.audit.push({ at: closedAt, event: 'partial_exit_live_failed', reason: partialTrade.closeReason, error: e.message });
    }
  }
  trades.unshift(partialTrade);
  deps.savePaperTradesFile(trades);
  deps.broadcastPaperTradeState('partial-close');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, trade, partial: partialTrade }));
}

module.exports = {
  handleTradeExecutionRoute,
};
