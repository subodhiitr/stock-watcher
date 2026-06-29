(() => {
  const state = {
    bootstrap: null,
    trades: [],
    allTransactions: [],
    candidates: [],
    settings: {},
    overrides: {},
    brokerMode: 'paper',
    simulationState: 'off',
    autoRefreshEnabled: localStorage.getItem('intradayx.mobile.autoRefresh5m') === '1',
    autoRefreshTimer: null,
    lastRefreshAt: 0,
  };

  const $ = id => document.getElementById(id);
  const todayKey = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const n = value => Number(value || 0);
  const inr = value => Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
    : '--';
  const fmt = value => Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : '--';
  const cls = value => n(value) > 0 ? 'positive' : n(value) < 0 ? 'negative' : '';
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  async function api(url, options = {}) {
    const res = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${res.status}`);
    return payload;
  }

  function portfolioTotal(portfolio = {}) {
    const added = Array.isArray(portfolio.capitalAdds)
      ? portfolio.capitalAdds.reduce((sum, item) => sum + n(item?.amount), 0)
      : 0;
    return n(portfolio.initialCapital) + added + n(portfolio.realizedPnl);
  }

  function isToday(trade) {
    const stamp = trade.closedAt || trade.openedAt;
    if (!stamp) return false;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(stamp)) === todayKey();
  }

  function tradePriceMap() {
    const map = new Map();
    for (const c of state.candidates) {
      map.set(String(c.symbol || '').toUpperCase(), {
        price: n(c.price || c.quote?.price || c.indicators?.price),
        change: n(c.quote?.change ?? c.indicators?.dayChange),
        target: n(c.indicators?.target || c.target),
        entry: n(c.indicators?.entryPrice || c.price),
      });
    }
    return map;
  }

  function tradePnl(trade, quote) {
    if (String(trade.status || '').toLowerCase() === 'closed') return n(trade.pnl);
    const price = quote?.price || n(trade.entryPrice);
    const dir = String(trade.side || '').toLowerCase() === 'sell' ? -1 : 1;
    return (price - n(trade.entryPrice)) * n(trade.qty) * dir;
  }

  function tradePnlPct(trade, quote) {
    if (Number.isFinite(Number(trade.pnlPct))) return Number(trade.pnlPct);
    const price = quote?.price || n(trade.entryPrice);
    const entry = n(trade.entryPrice);
    if (!entry || !price) return 0;
    const dir = String(trade.side || '').toLowerCase() === 'sell' ? -1 : 1;
    return ((price - entry) / entry) * 100 * dir;
  }

  function tradeTimestamp(trade) {
    return trade.closedAt || trade.updatedAt || trade.openedAt || trade.createdAt || '';
  }

  function renderHeader() {
    const portfolio = state.bootstrap?.portfolio || {};
    const todayPnl = todayTrades().reduce((sum, trade) => {
      if (String(trade.status || '').toLowerCase() === 'open') {
        const quote = tradePriceMap().get(String(trade.symbol || '').toUpperCase());
        return sum + tradePnl(trade, quote || {});
      }
      return sum + n(trade.pnl);
    }, 0);
    setText('portfolio-total', inr(portfolioTotal(portfolio)));
    setText('broker-mode-label', inr(todayPnl));
    const pnlEl = $('broker-mode-label');
    if (pnlEl) pnlEl.className = cls(todayPnl);
    setText('simulation-label', state.simulationState.toUpperCase());
    setText('updated-at', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    const brokerSelect = $('broker-mode-select');
    if (brokerSelect) brokerSelect.value = state.brokerMode;
    const simBtn = $('simulation-toggle');
    if (simBtn) simBtn.textContent = state.simulationState === 'running' || state.simulationState === 'settling'
      ? `Stop Simulation (${state.simulationState})`
      : 'Start Simulation';
    renderAutoRefresh();
  }

  function todayTrades() {
    return state.trades.filter(isToday);
  }

  function brokerLabel(mode) {
    return ({
      paper: 'Paper',
      zerodha_dry_run: 'Zerodha Dry',
      zerodha_live: 'Zerodha Live',
      sharekhan_live: 'Sharekhan Live',
    })[mode] || mode || '--';
  }

  function renderTrades() {
    const quotes = tradePriceMap();
    const rows = todayTrades()
      .sort((a, b) => {
        const openA = String(a.status || '').toLowerCase() === 'open' ? 1 : 0;
        const openB = String(b.status || '').toLowerCase() === 'open' ? 1 : 0;
        return openB - openA || new Date(b.openedAt || 0) - new Date(a.openedAt || 0);
      });
    setText('trade-count', `${rows.length} today`);
    $('trade-list').innerHTML = rows.length ? rows.map(trade => {
      const sym = String(trade.symbol || '').toUpperCase();
      const quote = quotes.get(sym) || {};
      const status = String(trade.status || '').toLowerCase();
      const price = status === 'closed' ? n(trade.exitPrice) : quote.price || n(trade.entryPrice);
      const target = n(trade.target);
      const pnl = tradePnl(trade, quote);
      const pnlPct = tradePnlPct(trade, quote);
      const mode = tradeBrokerLabel(trade);
      return `
        <article class="trade-row ${status === 'open' ? 'is-open' : ''}">
          <div class="trade-cell symbol">
            <strong>${sym}</strong>
            <span>${status || '--'} · ${mode}</span>
            <span>${String(trade.side || '').toUpperCase()} · ${trade.qty || '--'}</span>
            ${status === 'open' && trade.broker?.orderId ? `<span class="order-id">Order: ${trade.broker.orderId}</span>` : ''}
            ${status === 'open' && trade.broker?.status ? `<span class="broker-status broker-status--${trade.broker.status}">${brokerStatusLabel(trade.broker)}</span>` : ''}
          </div>
          <div class="trade-cell"><span>Entry</span><strong>${fmt(trade.entryPrice)}</strong></div>
          <div class="trade-cell"><span>Price</span><strong>${fmt(price)}</strong><em class="${cls(quote.change)}">${fmt(quote.change)}%</em></div>
          <div class="trade-cell"><span>Target</span><strong>${target ? fmt(target) : '--'}</strong></div>
          <div class="trade-cell"><span>P/L</span><strong class="${cls(pnl)}">${inr(pnl)}</strong><em class="${cls(pnlPct)}">${fmt(pnlPct)}%</em></div>
          <div class="trade-actions">
            ${status === 'open' ? `<button type="button" data-exit="${trade.id}" data-symbol="${sym}" data-price="${price || ''}">Exit</button>` : '<span>Closed</span>'}
          </div>
        </article>
      `;
    }).join('') : '<div class="empty">No open or closed positions today</div>';
  }

  function tradeBrokerLabel(trade) {
    const broker = trade?.broker || {};
    const mode = String(trade.executionMode || broker.mode || '').toLowerCase();
    if (broker.name === 'zerodha' && mode === 'live') return 'Zerodha Live';
    if (broker.name === 'sharekhan' && mode === 'live') return 'Sharekhan Live';
    if (mode === 'zerodha_live') return 'Zerodha Live';
    if (mode === 'sharekhan_live') return 'Sharekhan Live';
    if (mode === 'zerodha_dry_run' || broker.status === 'entry_dry_run' || broker.status === 'exit_dry_run') return 'Zerodha Dry';
    if (mode === 'paper' || !mode) return 'Paper';
    return mode.replace(/_/g, ' ');
  }

  function brokerStatusLabel(broker = {}) {
    const s = String(broker.status || '');
    const exitId = broker.exitOrderId ? ` · Exit: ${broker.exitOrderId}` : '';
    switch (s) {
      case 'pending':        return '⏳ Pending confirmation';
      case 'confirmed':      return '✓ Filled';
      case 'exit_placed':    return `↩ Exit placed${exitId}`;
      case 'exit_failed':    return `⚠ Exit failed: ${broker.error || 'unknown'}`;
      case 'exit_dry_run':   return '↩ Exit dry-run';
      case 'cancelled':      return '✕ Cancelled';
      case 'rejected':       return `✕ Rejected: ${broker.confirmationError || ''}`;
      case 'timeout':        return '⏱ Timed out';
      default:               return s.replace(/_/g, ' ');
    }
  }

  function renderSetups() {
    const openSymbols = new Set(state.trades.filter(t => String(t.status || '').toLowerCase() === 'open').map(t => String(t.symbol || '').toUpperCase()));
    const cards = state.candidates
      .filter(c => c.side === 'buy' || c.side === 'sell')
      .sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0) || Math.abs(n(b.score)) - Math.abs(n(a.score)))
      .slice(0, 24);
    setText('setup-count', `${cards.length} shown`);
    $('setup-list').innerHTML = cards.length ? cards.map(c => {
      const sym = String(c.symbol || '').toUpperCase();
      const price = n(c.price || c.quote?.price);
      const target = n(c.indicators?.target || c.target);
      const change = n(c.quote?.change ?? c.indicators?.dayChange);
      const side = String(c.side || '').toLowerCase();
      const disabled = openSymbols.has(sym) ? 'disabled' : '';
      return `
        <article class="setup-card ${c.selected ? 'selected' : ''}">
          <div class="setup-head">
            <div>
              <strong>${sym}</strong>
              <span>${c.setupType || c.derivedSetupType || '--'} · ${side.toUpperCase()} · ${Math.abs(n(c.score))}</span>
            </div>
            <button type="button" ${disabled} data-setup="${sym}">${disabled ? 'Open' : 'Trade'}</button>
          </div>
          <div class="setup-metrics">
            <span>Price <b>${fmt(price)}</b></span>
            <span class="${cls(change)}">Chg <b>${fmt(change)}%</b></span>
            <span>Target <b>${target ? fmt(target) : '--'}</b></span>
          </div>
        </article>
      `;
    }).join('') : '<div class="empty">No actionable setups</div>';
  }

  function renderSettings() {
    setText('settings-state', Object.keys(state.overrides || {}).length ? 'Overrides active' : 'Defaults');
    const form = $('settings-form');
    if (!form) return;
    for (const el of form.elements) {
      if (!el.name) continue;
      const value = state.overrides?.[el.name] ?? state.settings?.[el.name] ?? '';
      if (el.type === 'checkbox') el.checked = !!Number(value || 0);
      else el.value = value;
    }
  }

  function renderAutoRefresh() {
    const toggle = $('auto-refresh-toggle');
    if (toggle) toggle.checked = !!state.autoRefreshEnabled;
    setText('auto-refresh-state', state.autoRefreshEnabled ? 'Auto refresh on' : 'Auto refresh off');
  }

  function setAutoRefresh(enabled) {
    state.autoRefreshEnabled = !!enabled;
    localStorage.setItem('intradayx.mobile.autoRefresh5m', state.autoRefreshEnabled ? '1' : '0');
    if (state.autoRefreshTimer) {
      clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
    if (state.autoRefreshEnabled) {
      state.autoRefreshTimer = setInterval(() => {
        refreshAll();
      }, AUTO_REFRESH_MS);
    }
    renderAutoRefresh();
  }

  function renderPortfolioOverlay() {
    const portfolio = state.bootstrap?.portfolio || {};
    const transactions = Array.isArray(state.allTransactions) ? [...state.allTransactions] : [];
    const added = Array.isArray(portfolio.capitalAdds)
      ? portfolio.capitalAdds.reduce((sum, item) => sum + n(item?.amount), 0)
      : 0;
    const openExposure = transactions.reduce((sum, trade) => {
      if (String(trade.status || '').toLowerCase() !== 'open') return sum;
      return sum + (n(trade.entryPrice) * n(trade.qty));
    }, 0);
    const summary = $('portfolio-summary');
    if (summary) {
      summary.innerHTML = `
        <div><span>Initial</span><strong>${inr(portfolio.initialCapital)}</strong></div>
        <div><span>Added</span><strong>${inr(added)}</strong></div>
        <div><span>Realized P/L</span><strong class="${cls(portfolio.realizedPnl)}">${inr(portfolio.realizedPnl)}</strong></div>
        <div><span>Open Exposure</span><strong>${inr(openExposure)}</strong></div>
        <div><span>Total</span><strong>${inr(portfolioTotal(portfolio))}</strong></div>
      `;
    }
    setText('portfolio-transaction-count', `${transactions.length} today`);
    const list = $('portfolio-transactions');
    if (!list) return;
    transactions.sort((a, b) => new Date(tradeTimestamp(b) || 0) - new Date(tradeTimestamp(a) || 0));
    list.innerHTML = transactions.length ? transactions.map(trade => {
      const status = String(trade.status || '').toLowerCase() || '--';
      const time = tradeTimestamp(trade)
        ? new Date(tradeTimestamp(trade)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '--';
      const pnl = status === 'open' ? 0 : n(trade.pnl);
      const brokerExitInfo = trade.broker?.exitOrderId
        ? `Exit order: ${trade.broker.exitOrderId}`
        : (trade.broker?.status === 'exit_failed' ? `⚠ Exit failed: ${trade.broker.error || ''}` : '');
      const closeNote = trade.closeReason || trade.exitReason || '';
      return `
        <article class="transaction-row">
          <div>
            <strong>${String(trade.symbol || '').toUpperCase()}</strong>
            <span>${status} · ${tradeBrokerLabel(trade)} · ${time}</span>
          </div>
          <div>
            <strong>${String(trade.side || '').toUpperCase()} ${trade.qty || '--'}</strong>
            <span>Entry ${fmt(trade.entryPrice)} · Exit ${trade.exitPrice ? fmt(trade.exitPrice) : '--'}</span>
          </div>
          <div>
            <strong class="${cls(pnl)}">${status === 'open' ? 'Open' : inr(pnl)}</strong>
            <span>${closeNote}</span>
            ${brokerExitInfo ? `<span class="order-id">${brokerExitInfo}</span>` : ''}
          </div>
        </article>
      `;
    }).join('') : '<div class="empty">No transactions found</div>';
  }

  function renderAll() {
    renderHeader();
    renderTrades();
    renderSetups();
    renderSettings();
  }

  async function refreshAll() {
    try {
      const [bootstrap, tradeState, brokerStatus, simStatus, settings, analysis] = await Promise.all([
        api('/dashboard-bootstrap'),
        api('/trade-execution'),
        api('/broker-status'),
        api('/simulation/status'),
        api('/trade-settings'),
        api('/simulation/analysis?source=mobile'),
      ]);
      state.bootstrap = bootstrap;
      state.trades = Array.isArray(tradeState.trades) ? tradeState.trades : [];
      state.bootstrap.portfolio = tradeState.portfolio || bootstrap.portfolio;
      state.brokerMode = brokerStatus.mode || 'paper';
      state.simulationState = simStatus.state || 'off';
      state.settings = analysis.settings || {};
      state.overrides = settings.overrides || {};
      state.candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
      state.lastRefreshAt = Date.now();
      renderAll();
      setStatus('');
    } catch (error) {
      setStatus(error.message || 'Load failed', true);
    }
  }

  async function openPortfolioOverlay() {
    const overlay = $('portfolio-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    setText('portfolio-transaction-count', 'Loading');
    $('portfolio-transactions').innerHTML = '<div class="empty">Loading transactions</div>';
    try {
      const payload = await api('/trade-execution');
      state.allTransactions = Array.isArray(payload.trades) ? payload.trades.filter(isToday) : [];
      if (payload.portfolio) {
        state.bootstrap = state.bootstrap || {};
        state.bootstrap.portfolio = payload.portfolio;
      }
      renderHeader();
      renderPortfolioOverlay();
    } catch (error) {
      $('portfolio-transactions').innerHTML = `<div class="empty negative">${error.message || 'Could not load portfolio'}</div>`;
    }
  }

  function closePortfolioOverlay() {
    const overlay = $('portfolio-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function setStatus(message, isError = false) {
    const el = $('trade-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('negative', !!isError);
  }

  function setupBySymbol(sym) {
    return state.candidates.find(c => String(c.symbol || '').toUpperCase() === String(sym || '').toUpperCase());
  }

  async function openTrade(payload) {
    const result = await api('/trade-execution', {
      method: 'POST',
      body: JSON.stringify({ action: 'open', brokerMode: state.brokerMode, source: 'manual', ...payload }),
    });
    setStatus(`Entered ${result.trade?.symbol || payload.symbol}`);
    await refreshAll();
  }

  async function closeTrade(id, symbol, price) {
    const typed = prompt(`Exit ${symbol} at price`, price ? String(Number(price).toFixed(2)) : '');
    if (typed == null) return;
    const exitPrice = Number(typed);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      setStatus('Enter a valid exit price', true);
      return;
    }
    try {
      await api('/trade-execution', {
        method: 'POST',
        body: JSON.stringify({ action: 'close', id, exitPrice, reason: 'Mobile manual exit' }),
      });
      setStatus(`Exited ${symbol}`);
    } catch (error) {
      setStatus(`Exit failed for ${symbol}: ${error.message}`, true);
    }
    await refreshAll();
  }

  function bindEvents() {
    $('refresh-btn').addEventListener('click', refreshAll);
    $('portfolio-card').addEventListener('click', openPortfolioOverlay);
    $('portfolio-close').addEventListener('click', closePortfolioOverlay);
    $('portfolio-overlay').addEventListener('click', event => {
      if (event.target.id === 'portfolio-overlay') closePortfolioOverlay();
    });
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.dataset.view;
        document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
        document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
      });
    });

    $('manual-entry-form').addEventListener('submit', async event => {
      event.preventDefault();
      const payload = {
        symbol: $('manual-symbol').value.trim().toUpperCase(),
        side: $('manual-side').value,
        qty: Math.floor(Number($('manual-qty').value)),
        entryPrice: Number($('manual-price').value),
        target: Number($('manual-target').value) || undefined,
      };
      if (!payload.symbol || !payload.qty || !payload.entryPrice) {
        setStatus('Symbol, qty and price are required', true);
        return;
      }
      try { await openTrade(payload); } catch (e) { setStatus(e.message, true); }
    });

    document.body.addEventListener('click', async event => {
      const exitBtn = event.target.closest('[data-exit]');
      if (exitBtn) {
        try { await closeTrade(exitBtn.dataset.exit, exitBtn.dataset.symbol, exitBtn.dataset.price); }
        catch (e) { setStatus(e.message, true); }
        return;
      }
      const setupBtn = event.target.closest('[data-setup]');
      if (setupBtn) {
        const c = setupBySymbol(setupBtn.dataset.setup);
        if (!c) return;
        const price = n(c.price || c.quote?.price || c.indicators?.price || c.indicators?.entryPrice);
        const qty = Math.max(1, Math.floor(100000 / Math.max(price, 1)));
        try {
          await openTrade({
            symbol: c.symbol,
            name: c.name || c.symbol,
            assetType: c.assetType || 'stock',
            side: c.side,
            qty,
            entryPrice: price,
            target: n(c.indicators?.target || c.target) || undefined,
            stop: n(c.indicators?.stop || c.stop) || undefined,
            signal: c.signal,
            score: n(c.score),
            setupType: c.setupType || c.derivedSetupType,
            setup: c.setupType || c.derivedSetupType,
            entryContext: c,
          });
        } catch (e) { setStatus(e.message, true); }
      }
    });

    $('broker-mode-select').addEventListener('change', async event => {
      try {
        const payload = await api('/broker-mode', {
          method: 'POST',
          body: JSON.stringify({ mode: event.target.value }),
        });
        state.brokerMode = payload.mode || event.target.value;
        renderHeader();
      } catch (e) { setStatus(e.message, true); }
    });

    $('simulation-toggle').addEventListener('click', async () => {
      const running = state.simulationState === 'running' || state.simulationState === 'settling';
      try {
        const payload = running
          ? await api('/simulation/stop', { method: 'POST', body: JSON.stringify({ mode: 'settle' }) })
          : await api('/simulation/start', { method: 'POST', body: JSON.stringify({}) });
        state.simulationState = payload.state || state.simulationState;
        renderHeader();
      } catch (e) { setStatus(e.message, true); }
    });

    $('simulation-stop-now').addEventListener('click', async () => {
      try {
        const payload = await api('/simulation/stop', { method: 'POST', body: JSON.stringify({ mode: 'immediate' }) });
        state.simulationState = payload.state || 'off';
        renderHeader();
      } catch (e) { setStatus(e.message, true); }
    });

    $('auto-refresh-toggle').addEventListener('change', event => {
      setAutoRefresh(event.target.checked);
      setStatus(event.target.checked ? 'Auto refresh enabled every 5 minutes' : 'Auto refresh disabled');
    });

    $('settings-form').addEventListener('submit', async event => {
      event.preventDefault();
      const next = {};
      for (const el of event.currentTarget.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') next[el.name] = el.checked ? 1 : 0;
        else if (String(el.value).trim() !== '') next[el.name] = Number(el.value);
      }
      try {
        const payload = await api('/trade-settings', { method: 'POST', body: JSON.stringify({ overrides: next }) });
        state.overrides = payload.overrides || next;
        renderSettings();
        setStatus('Settings saved');
      } catch (e) { setStatus(e.message, true); }
    });

    $('settings-reset').addEventListener('click', async () => {
      try {
        const payload = await api('/trade-settings', { method: 'POST', body: JSON.stringify({ overrides: {} }) });
        state.overrides = payload.overrides || {};
        renderSettings();
        setStatus('Overrides cleared');
      } catch (e) { setStatus(e.message, true); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    setAutoRefresh(state.autoRefreshEnabled);
    refreshAll();

    // Mobile browsers throttle/pause setInterval when the page is backgrounded.
    // On visibility restore, refresh immediately if auto-refresh is on and the
    // interval has already elapsed.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.autoRefreshEnabled) {
        if (Date.now() - state.lastRefreshAt >= AUTO_REFRESH_MS) {
          refreshAll();
        }
      }
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile-sw.js').catch(() => {});
    }
  });
})();
