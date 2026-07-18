(() => {
  const state = {
    bootstrap: null,
    trades: [],
    allTransactions: [],
    candidates: [],
    liveQuotes: new Map(),
    settings: {},
    overrides: {},
    brokerMode: 'paper',
    brokerStatus: null,
    brokerPortfolio: { loading: false, ok: false, data: null, error: '' },
    simulationState: 'off',
    loadError: '',
    autoRefreshEnabled: localStorage.getItem('intradayx.mobile.autoRefresh5m') === '1',
    autoRefreshTimer: null,
    lastRefreshAt: 0,
    market: {},
    sectorTrend: {},
    sectorTrendStreamed: false,
    setupFilter: localStorage.getItem('intradayx.mobile.setupFilter') || 'tradeable',
    liveStream: null,
    liveStreamKey: '',
    marketOverviewStream: null,
    tradeStream: null,
    liveReconnectTimer: null,
    tradeReconnectTimer: null,
    setupsLoaded: false,
    setupsLoading: false,
    setupRequestId: 0,
    setupSelectionAt: 0,
    healthScores: {},
    healthLoadedSymbols: new Set(),
    healthStream: null,
    healthStreamKey: '',
    allStocks: [],
    allStocksLoading: false,
    allStockFilter: localStorage.getItem('intradayx.mobile.allStockFilter') || 'all',
    allStockPage: 1,
    allStockSearch: '',
    freshNews: { loading:false, loaded:false, items:[], error:'' },
    pendingTradeSymbols: new Set(),
    statusTimer: null,
    candleChart: { symbol:'', interval:'5m', candles:[], loading:false },
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
  const pct = value => Number.isFinite(Number(value)) ? `${n(value) > 0 ? '+' : ''}${fmt(value)}%` : '--';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
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
    const prices = tradePriceMap();
    const unrealizedPnl = state.trades
      .filter(trade => String(trade.status || '').toLowerCase() === 'open')
      .reduce((sum, trade) => sum + tradePnl(trade, prices.get(String(trade.symbol || '').toUpperCase()) || {}), 0);
    return n(portfolio.initialCapital) + added + n(portfolio.realizedPnl) + unrealizedPnl;
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
    const rows = [...state.allStocks, ...state.candidates];
    for (const c of rows) {
      const row = withLiveQuote(c);
      map.set(String(c.symbol || '').toUpperCase(), {
        price: n(row.price || row.quote?.price || row.indicators?.price),
        change: n(row.quote?.change ?? row.indicators?.dayChange),
        target: n(row.indicators?.target || row.target),
        entry: n(row.indicators?.entryPrice || row.price),
      });
    }
    for (const [symbol, live] of state.liveQuotes) {
      const previous = map.get(symbol) || {};
      map.set(symbol, {
        ...previous,
        price: n(live.price || previous.price),
        change: n(live.dayChange ?? live.change ?? previous.change),
        target: n(live.target || previous.target),
      });
    }
    return map;
  }

  function liveQuote(symbol) {
    return state.liveQuotes.get(String(symbol || '').trim().toUpperCase()) || null;
  }

  function withLiveQuote(row = {}) {
    const symbol = String(row.symbol || row.sym || '').trim().toUpperCase();
    const live = liveQuote(symbol);
    if (!live) return row;
    const price = n(live.price || row.price || row.quote?.price || row.indicators?.price);
    const change = n(live.dayChange ?? live.change ?? row.change ?? row.quote?.change ?? row.indicators?.dayChange);
    return {
      ...row,
      symbol,
      price,
      change,
      score: Number.isFinite(Number(live.score)) ? Number(live.score) : row.score,
      target: n(live.target || row.target),
      setupType: resolvedSetupType({ ...row, ...live }),
      derivedSetupType: live.derivedSetupType || row.derivedSetupType,
      entryStatus: live.entryStatus || row.entryStatus,
      side: live.side || live.signal || row.side,
      quote: { ...(row.quote || {}), price, change },
      indicators: { ...(row.indicators || {}), ...live, price, dayChange: change },
    };
  }

  function resolvedSetupType(row = {}) {
    const values = [
      row.derivedSetupType,
      row.setupType,
      row.indicators?.derivedSetupType,
      row.indicators?.setupType,
    ].map(value => String(value || '').trim()).filter(Boolean);
    return values.find(value => value.toUpperCase() !== 'NO_SIGNAL') || values[0] || 'NO_SIGNAL';
  }

  function tradePnl(trade, quote) {
    if (String(trade.status || '').toLowerCase() === 'closed') return n(trade.pnl);
    const price = quote?.price || n(trade.entryPrice);
    const dir = String(trade.side || '').toLowerCase() === 'sell' ? -1 : 1;
    return (price - n(trade.entryPrice)) * n(trade.qty) * dir;
  }

  function tradePnlPct(trade, quote) {
    if (String(trade.status || '').toLowerCase() === 'closed' && Number.isFinite(Number(trade.pnlPct))) return Number(trade.pnlPct);
    const price = quote?.price || n(trade.entryPrice);
    const entry = n(trade.entryPrice);
    if (!entry || !price) return 0;
    const dir = String(trade.side || '').toLowerCase() === 'sell' ? -1 : 1;
    return ((price - entry) / entry) * 100 * dir;
  }

  function tradeTimestamp(trade) {
    return trade.closedAt || trade.updatedAt || trade.openedAt || trade.createdAt || '';
  }

  function tradeEntryTimestamp(trade = {}) {
    return trade.openedAt || trade.entryTime || trade.entryAt || trade.createdAt || '';
  }

  function tradeExitTimestamp(trade = {}) {
    return trade.closedAt || trade.exitTime || trade.exitAt || '';
  }

  function tradeEntryReason(trade = {}) {
    const context = trade.entryContext && typeof trade.entryContext === 'object' ? trade.entryContext : {};
    const indicators = context.indicators && typeof context.indicators === 'object' ? context.indicators : {};
    const detailReasons = Array.isArray(indicators.reasons)
      ? indicators.reasons
      : (Array.isArray(context.reasons) ? context.reasons : []);
    const parts = [
      context.reason,
      trade.setupType || context.setupType || context.candidateSetupType,
      indicators.entryTrigger || context.entryTrigger,
      ...detailReasons.slice(0, 2),
    ].map(value => String(value || '').trim()).filter(Boolean);
    const unique = parts.filter((value, index) => parts.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index);
    if (unique.length) return unique.join(' | ');
    if (String(trade.setup || '').trim()) return String(trade.setup).trim();
    return String(trade.source || '').toLowerCase() === 'simulation' ? 'Simulation selected' : 'Manual entry';
  }

  function formatTradeTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function manualSymbolRows() {
    const rows = new Map();
    const remember = item => {
      const symbol = String(item?.symbol || item?.sym || item || '').trim().toUpperCase();
      if (!symbol) return;
      const previous = rows.get(symbol) || {};
      rows.set(symbol, typeof item === 'object' ? { ...previous, ...item, symbol } : { ...previous, symbol });
    };
    (state.bootstrap?.prefs?.stocks || []).forEach(remember);
    state.allStocks.forEach(remember);
    state.candidates.forEach(remember);
    return rows;
  }

  function updateManualSymbolOptions() {
    const list = $('manual-symbol-options');
    if (!list) return;
    const fragment = document.createDocumentFragment();
    for (const [symbol, row] of [...manualSymbolRows()].sort(([a], [b]) => a.localeCompare(b))) {
      const option = document.createElement('option');
      option.value = symbol;
      option.label = row.name && row.name !== symbol ? row.name : symbol;
      fragment.appendChild(option);
    }
    list.replaceChildren(fragment);
  }

  function populateManualEntry(symbolValue) {
    const symbol = String(symbolValue || '').trim().toUpperCase();
    const row = manualSymbolRows().get(symbol);
    if (!row) return;
    const candidate = withLiveQuote(state.candidates.find(item => String(item.symbol || '').toUpperCase() === symbol) || row);
    const price = n(candidate.price || candidate.quote?.price || candidate.indicators?.price || candidate.indicators?.entryPrice || candidate.entryPrice);
    const target = n(candidate.indicators?.target || candidate.target);
    const cap = n(state.overrides?.MAX_POSITION_EXPOSURE ?? state.settings?.MAX_POSITION_EXPOSURE) || 100000;
    $('manual-symbol').value = symbol;
    if (price > 0) {
      $('manual-price').value = Number(price.toFixed(2));
      $('manual-qty').value = Math.max(1, Math.floor(cap / price));
    } else {
      $('manual-price').value = '';
      $('manual-qty').value = '';
    }
    $('manual-target').value = target > 0 ? Number(target.toFixed(2)) : '';
  }

  function paperTodayPnl() {
    const todayPnl = todayTrades().reduce((sum, trade) => {
      if (String(trade.status || '').toLowerCase() === 'open') {
        const quote = tradePriceMap().get(String(trade.symbol || '').toUpperCase());
        return sum + tradePnl(trade, quote || {});
      }
      return sum + n(trade.pnl);
    }, 0);
    return todayTrades().length ? todayPnl : n(state.bootstrap?.dayPnl?.[todayKey()]);
  }

  function activeBroker() {
    if (state.brokerMode === 'sharekhan_live') return 'sharekhan';
    if (state.brokerMode === 'zerodha_live') return 'zerodha';
    return 'paper';
  }

  function activeBrokerLabel() {
    const broker = activeBroker();
    if (broker === 'sharekhan') return 'Sharekhan';
    if (broker === 'zerodha') return 'Zerodha';
    return 'Paper';
  }

  function activeBrokerAuthenticated() {
    const broker = activeBroker();
    if (broker === 'paper') return true;
    return !!state.brokerStatus?.[broker]?.clientsInitialized;
  }

  function activeBrokerPnl() {
    const broker = activeBroker();
    if (broker === 'paper') return paperTodayPnl();
    if (state.brokerPortfolio?.ok) {
      const value = Number(state.brokerPortfolio?.data?.portfolio?.positions?.dayPnl);
      const positions = state.brokerPortfolio?.data?.portfolio?.positions?.list || [];
      const liveAdjustment = Array.isArray(positions) ? positions.reduce((sum, position) => {
        const updated = brokerPositionWithLiveQuote(position);
        return sum + (n(updated.pnl) - n(position.pnl));
      }, 0) : 0;
      const positionSymbols = new Set((Array.isArray(positions) ? positions : [])
        .map(position => String(position.symbol || position.tradingsymbol || '').toUpperCase()));
      const prices = tradePriceMap();
      const unmatchedOpenPnl = todayTrades()
        .filter(trade => String(trade.status || '').toLowerCase() === 'open')
        .filter(trade => tradeMatchesActiveBroker(trade, broker))
        .filter(trade => !positionSymbols.has(String(trade.symbol || '').toUpperCase()))
        .reduce((sum, trade) => sum + tradePnl(trade, prices.get(String(trade.symbol || '').toUpperCase()) || {}), 0);
      return Number.isFinite(value) ? value + liveAdjustment + unmatchedOpenPnl : null;
    }
    return null;
  }

  function activeBrokerPortfolioEndpoint() {
    const broker = activeBroker();
    if (broker === 'sharekhan') return '/sharekhan-portfolio';
    if (broker === 'zerodha') return '/zerodha-portfolio';
    return '';
  }

  async function refreshActiveBrokerPortfolio() {
    const endpoint = activeBrokerPortfolioEndpoint();
    if (!endpoint || !activeBrokerAuthenticated()) {
      state.brokerPortfolio = { loading: false, ok: false, data: null, error: '' };
      return;
    }
    state.brokerPortfolio = { loading: true, ok: false, data: null, error: '' };
    try {
      const payload = await api(endpoint);
      state.brokerPortfolio = { loading: false, ok: true, data: payload, error: '' };
      connectLiveStream();
    } catch (error) {
      state.brokerPortfolio = { loading: false, ok: false, data: null, error: error.message || 'Broker portfolio unavailable' };
    }
  }

  function brokerPositionWithLiveQuote(position = {}) {
    const symbol = String(position.symbol || position.tradingsymbol || '').toUpperCase();
    const quote = liveQuote(symbol);
    const price = n(quote?.price);
    if (!price) return position;
    const qty = n(position.qty ?? position.quantity);
    const avgPrice = n(position.avgPrice ?? position.averagePrice ?? position.entryPrice);
    return {
      ...position,
      symbol,
      ltp: price,
      currentPrice: price,
      currentValue: price * qty,
      pnl: avgPrice && qty ? (price - avgPrice) * qty : n(position.pnl),
    };
  }

  function renderHeader() {
    const portfolio = state.bootstrap?.portfolio || {};
    const brokerPnl = activeBrokerPnl();
    const brokerLabel = activeBrokerLabel();
    setText('portfolio-total', inr(portfolioTotal(portfolio)));
    setText('today-pnl-label', `Today P/L (${brokerLabel})`);
    setText('broker-mode-label', state.brokerPortfolio.loading && brokerPnl === null ? 'Loading' : brokerPnl === null ? '--' : inr(brokerPnl));
    const pnlEl = $('broker-mode-label');
    if (pnlEl) pnlEl.className = brokerPnl === null ? '' : cls(brokerPnl);
    setText('simulation-label', state.simulationState.toUpperCase());
    setText('updated-at', new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    const brokerSelect = $('broker-mode-select');
    if (brokerSelect) brokerSelect.value = state.brokerMode;
    for (const broker of ['zerodha', 'sharekhan']) {
      const login = $(`${broker}-login-icon`);
      if (!login) continue;
      const status = state.brokerStatus?.[broker] || {};
      const connected = !!status.clientsInitialized;
      login.classList.toggle('connected', connected);
      login.disabled = !!status.isDisabled;
      login.title = status.isDisabled
        ? `${broker === 'zerodha' ? 'Zerodha' : 'Sharekhan'} is disabled`
        : `${broker === 'zerodha' ? 'Zerodha' : 'Sharekhan'} ${connected ? 'connected — log in again' : 'login'}`;
      login.setAttribute('aria-label', login.title);
    }
    const simBtn = $('simulation-toggle');
    if (simBtn) simBtn.textContent = state.simulationState === 'running' || state.simulationState === 'settling'
      ? `Stop Simulation (${state.simulationState})`
      : 'Start Simulation';
    renderNotificationBadge();
    renderAutoRefresh();
  }

  function buildNotifications() {
    const items = [];
    const now = Date.now();
    if (state.loadError) {
      items.push({
        level: 'danger',
        title: 'Refresh failed',
        text: state.loadError,
        at: now,
      });
    }
    const broker = state.brokerStatus || {};
    if (state.simulationState === 'running') {
      items.push({
        level: 'good',
        title: 'Simulation active',
        text: 'Simulation is scanning and managing entries.',
        at: now,
      });
    } else if (state.simulationState === 'settling') {
      items.push({
        level: 'warn',
        title: 'Simulation settling',
        text: 'New entries are paused; exits continue to be managed.',
        at: now,
      });
    }
    if (broker.zerodha?.isDisabled) {
      items.push({
        level: 'danger',
        title: 'Zerodha disabled',
        text: 'Repeated broker failures disabled Zerodha live handling.',
        at: now,
      });
    }
    if (broker.sharekhan?.isDisabled) {
      items.push({
        level: 'danger',
        title: 'Sharekhan disabled',
        text: 'Repeated broker failures disabled Sharekhan live handling.',
        at: now,
      });
    }
    const todayPnl = todayTrades().reduce((sum, trade) => {
      if (String(trade.status || '').toLowerCase() === 'open') {
        const quote = tradePriceMap().get(String(trade.symbol || '').toUpperCase());
        return sum + tradePnl(trade, quote || {});
      }
      return sum + n(trade.pnl);
    }, 0);
    const liveBrokerPnl = activeBrokerPnl();
    const dayPnl = liveBrokerPnl === null ? todayPnl : liveBrokerPnl;
    if (Math.abs(dayPnl) > 0) {
      items.push({
        level: dayPnl >= 0 ? 'good' : 'danger',
        title: 'Today P/L',
        text: inr(dayPnl),
        at: now,
      });
    }
    const openSymbols = new Set(state.trades
      .filter(t => String(t.status || '').toLowerCase() === 'open')
      .map(t => String(t.symbol || '').toUpperCase()));
    state.candidates
      .map(withLiveQuote)
      .filter(c => ['buy', 'sell'].includes(String(c.side || '').toLowerCase()))
      .filter(c => {
        const text = `${c.entryStatus || ''} ${resolvedSetupType(c)}`;
        return c.selected || /trigger|fresh|breakout|momentum|shock/i.test(text);
      })
      .sort((a, b) => (b.selected ? 1 : 0) - (a.selected ? 1 : 0) || Math.abs(n(b.score)) - Math.abs(n(a.score)))
      .slice(0, 8)
      .forEach(c => {
        const sym = String(c.symbol || '').toUpperCase();
        const side = String(c.side || '').toUpperCase();
        const setup = resolvedSetupType(c);
        const price = n(c.price || c.quote?.price);
        items.push({
          level: side === 'SELL' ? 'danger' : 'good',
          title: `${sym} ${setup}`,
          text: `${side} | Score ${Math.abs(n(c.score))}${price ? ` | Price ${fmt(price)}` : ''}${openSymbols.has(sym) ? ' | already open' : ''}`,
          change: n(c.quote?.change ?? c.indicators?.dayChange),
          at: now,
        });
      });
    for (const trade of todayTrades()) {
      const sym = String(trade.symbol || '').toUpperCase();
      const status = String(trade.status || '').toLowerCase();
      const brokerStatus = String(trade.broker?.status || '').toLowerCase();
      const failed = ['failed', 'cancelled', 'rejected', 'timeout', 'exit_failed'].includes(brokerStatus);
      if (failed) {
        items.push({
          level: 'danger',
          title: `${sym} broker ${brokerStatus.replace(/_/g, ' ')}`,
          text: trade.broker?.error || trade.broker?.confirmationError || 'Check broker order status',
          at: tradeTimestamp(trade),
        });
      } else if (status === 'open') {
        const quote = tradePriceMap().get(sym) || {};
        const pnl = tradePnl(trade, quote);
        items.push({
          level: n(pnl) < 0 ? 'warn' : '',
          title: `${sym} open ${String(trade.side || '').toUpperCase()}`,
          text: `${trade.qty || '--'} qty | P/L ${inr(pnl)}`,
          at: tradeTimestamp(trade),
        });
      } else if (status === 'closed') {
        items.push({
          level: n(trade.pnl) < 0 ? 'warn' : '',
          title: `${sym} closed`,
          text: `${trade.closeReason || trade.exitReason || 'Trade closed'} | P/L ${inr(trade.pnl)}`,
          at: tradeTimestamp(trade),
        });
      }
    }
    return items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 20);
  }

  function renderNotificationBadge() {
    const btn = $('notification-btn');
    const count = $('notification-count');
    if (!btn || !count) return;
    const items = buildNotifications();
    count.textContent = String(items.length);
    btn.classList.toggle('no-alerts', items.length === 0);
  }

  function renderNotificationOverlay() {
    const list = $('notification-list');
    if (!list) return;
    const items = buildNotifications();
    list.innerHTML = items.length ? items.map(item => {
      const when = item.at
        ? new Date(item.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '--';
      return `
        <article class="notification-item ${item.level || ''}">
          <strong>${item.title}</strong>
          <span>${item.text}</span>
          ${Number.isFinite(Number(item.change)) ? `<span class="${cls(item.change)}">Change ${pct(item.change)}</span>` : ''}
          <time>${when}</time>
        </article>
      `;
    }).join('') : '<div class="empty">No notifications right now</div>';
  }

  function todayTrades() {
    return state.trades.filter(isToday);
  }

  function openTradeForSymbol(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    return state.trades
      .filter(trade => String(trade.status || '').toLowerCase() === 'open' && String(trade.symbol || '').toUpperCase() === normalized)
      .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))[0] || null;
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
      const priceChange = Number(quote.change);
      const mode = tradeBrokerLabel(trade);
      const entryTime = formatTradeTime(tradeEntryTimestamp(trade));
      const exitTime = formatTradeTime(tradeExitTimestamp(trade));
      const exitReason = trade.closeReason || trade.exitReason || '';
      return `
        <article class="trade-row ${status === 'open' ? 'is-open' : ''}">
          <div class="trade-cell symbol">
            <strong>${sym}</strong>
            <span>${status || '--'} · ${mode}</span>
            <span>${String(trade.side || '').toUpperCase()} · ${trade.qty || '--'}</span>
            ${status === 'open' && trade.broker?.orderId ? `<span class="order-id">Order: ${trade.broker.orderId}</span>` : ''}
            ${trade.broker?.status ? `<span class="broker-status broker-status--${trade.broker.status}">${brokerStatusLabel(trade.broker)}</span>` : ''}
          </div>
          <div class="trade-cell"><span>Entry</span><strong>${fmt(trade.entryPrice)}</strong><em>${entryTime}</em></div>
          <div class="trade-cell"><span>${status === 'closed' ? 'Exit' : 'Price'}</span><strong>${fmt(price)}</strong><em class="${status === 'closed' ? '' : cls(priceChange)}">${status === 'closed' ? exitTime : `Change ${pct(priceChange)}`}</em>${status === 'open' ? `<em class="mobile-trade-return ${cls(pnlPct)}">P/L ${pct(pnlPct)}</em>` : `<em class="mobile-trade-return ${cls(pnl)}">P/L ${inr(pnl)}</em>`}</div>
          <div class="trade-cell"><span>Target</span><strong>${target ? fmt(target) : '--'}</strong></div>
          <div class="trade-cell"><span>P/L</span><strong class="${cls(pnl)}">${inr(pnl)}</strong><em class="${cls(pnlPct)}">${fmt(pnlPct)}%</em></div>
          <div class="trade-actions">
            ${status === 'open' ? `<button type="button" data-exit="${trade.id}" data-symbol="${sym}" data-price="${price || ''}">Exit</button>` : `<span>${escapeHTML(status || 'closed')}${exitReason ? ` - ${escapeHTML(exitReason)}` : ''}</span>`}
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

  function tradeMatchesActiveBroker(trade, broker = activeBroker()) {
    if (broker === 'paper') return true;
    const name = String(trade?.broker?.name || '').toLowerCase();
    const mode = String(trade?.broker?.mode || trade?.executionMode || '').toLowerCase();
    return name === broker && (mode === 'live' || mode === `${broker}_live`);
  }

  function openBrokerLogin(broker) {
    const name = broker === 'sharekhan' ? 'sharekhan' : broker === 'zerodha' ? 'zerodha' : '';
    if (!name) return;
    const w = 520;
    const h = 720;
    const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || screen.width) - w) / 2));
    const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || screen.height) - h) / 2));
    const popup = window.open(`/broker/login?name=${encodeURIComponent(name)}`, `broker-login-${name}`, `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!popup) setStatus('Popup blocked. Allow popups and try broker login again.', true);
    else popup.focus?.();
  }

  function brokerStatusLabel(broker = {}) {
    const s = String(broker.status || '');
    const exitId = broker.exitOrderId ? ` · Exit: ${broker.exitOrderId}` : '';
    switch (s) {
      case 'pending':        return '⏳ Pending confirmation';
      case 'confirmed':      return '✓ Filled';
      case 'entry_dry_run':  return 'Dry-run position open';
      case 'failed':         return `Failed: ${broker.error || broker.confirmationError || 'broker rejected the request'}`;
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
    if (state.setupsLoading) {
      setText('setup-count', 'Loading');
      $('setup-list').innerHTML = '<div class="empty">Loading selected setups…</div>';
      return;
    }
    if (!state.setupsLoaded) {
      setText('setup-count', 'On demand');
      $('setup-list').innerHTML = '<div class="empty">Open Setups or choose a category to load stocks</div>';
      return;
    }
    const favoriteRows = state.bootstrap?.prefs?.stockFavorites || [];
    const favorites = new Set((Array.isArray(favoriteRows) ? favoriteRows : Object.keys(favoriteRows || {})).map(item => String(item?.sym || item?.symbol || item || '').toUpperCase()));
    const changeOf = c => n(c.quote?.change ?? c.indicators?.dayChange);
    const setupOf = c => resolvedSetupType(c).toUpperCase();
    const statusOf = c => String(c.indicators?.entryStatus || c.entryStatus || '').toLowerCase();
    const isDirectional = c => ['buy', 'sell'].includes(String(c.side || c.signal || '').toLowerCase());
    const isTradeable = c => isDirectional(c)
      && !['CHASING', 'LOW_VOLUME', 'NO_SIGNAL'].includes(setupOf(c))
      && !['avoid', 'invalid', 'chasing'].includes(String(c.guard?.level || c.guard || '').toLowerCase())
      && (!!c.selected || !!c.wouldEnter || !String(c.blockReason || '').trim());
    const runnerTypes = new Set(['VOLUME_SHOCK_BREAKOUT', 'MOMENTUM_RUNNER', 'VWAP_TREND_CONTINUATION', 'FRESH_BREAKOUT']);
    const shortTypes = new Set(['VWAP_REJECTION', 'BREAKDOWN', 'SHORT_MOMENTUM']);
    const filters = {
      tradeable: isTradeable,
      gainers: c => changeOf(c) > 0,
      losers: c => changeOf(c) < 0,
      favorites: c => favorites.has(String(c.symbol || '').toUpperCase()),
      runners: c => statusOf(c) === 'triggered' && runnerTypes.has(setupOf(c)),
      shorts: c => String(c.side || c.signal || '').toLowerCase() === 'sell' && shortTypes.has(setupOf(c)),
      best_pullbacks: c => isTradeable(c) && setupOf(c) === 'VWAP_PULLBACK_OR_HOLD',
      near_trigger: c => statusOf(c) === 'near trigger'
        && !['CHASING', 'LOW_VOLUME', 'NO_SIGNAL'].includes(setupOf(c)),
    };
    const sorters = {
      gainers: (a, b) => changeOf(b) - changeOf(a) || Math.abs(n(b.score)) - Math.abs(n(a.score)),
      losers: (a, b) => changeOf(a) - changeOf(b) || Math.abs(n(b.score)) - Math.abs(n(a.score)),
      favorites: (a, b) => Math.abs(n(b.score)) - Math.abs(n(a.score)),
    };
    const setupPriority = setup => ({
      MOMENTUM_RUNNER: 0,
      VWAP_TREND_CONTINUATION: 1,
      BREAKDOWN: 1,
      VWAP_PULLBACK_OR_HOLD: 2,
      VWAP_REJECTION: 2,
      FRESH_BREAKOUT: 3,
      VOLUME_SHOCK_BREAKOUT: 4,
      LONG_MOMENTUM: 5,
    })[setupOf(setup)] ?? 9;
    const priorityScoreSort = (a, b) => setupPriority(a) - setupPriority(b) || Math.abs(n(b.score)) - Math.abs(n(a.score));
    const activeFilter = filters[state.setupFilter] ? state.setupFilter : 'tradeable';
    const cards = state.candidates
      .map(withLiveQuote)
      .filter(filters[activeFilter])
      .sort(sorters[activeFilter] || priorityScoreSort)
      .slice(0, 24);
    const selector = $('setup-filter-select');
    if (selector) selector.value = activeFilter;
    setText('setup-count', `${cards.length} shown`);
    $('setup-list').innerHTML = cards.length ? cards.map((c, index) => {
      const sym = String(c.symbol || '').toUpperCase();
      const price = n(c.price || c.quote?.price);
      const target = n(c.indicators?.target || c.target);
      const change = n(c.quote?.change ?? c.indicators?.dayChange);
      const side = String(c.side || c.signal || '').toLowerCase();
      const canTrade = ['buy', 'sell'].includes(side);
      const lockedTrade = openTradeForSymbol(sym);
      const brokerState = String(lockedTrade?.broker?.status || 'open').toLowerCase();
      const opening = state.pendingTradeSymbols.has(sym);
      const disabled = lockedTrade || opening || !canTrade ? 'disabled' : '';
      const indicators = c.indicators || {};
      const entry = n(indicators.entryPrice || indicators.entry || price);
      const stop = n(indicators.stop || indicators.stopLoss || indicators.sl);
      const vwap = n(indicators.vwap);
      const volume = n(indicators.volume || indicators.dayVolume);
      const rr = n(indicators.rr || indicators.riskReward);
      const status = indicators.entryStatus || c.entryStatus || (c.selected ? 'Ready' : 'Watching');
      const reason = c.blockReason || (Array.isArray(c.eligibilityReasons) ? c.eligibilityReasons[0] : '') || (Array.isArray(indicators.reasons) ? indicators.reasons[0] : '');
      const health = state.healthScores[sym];
      const healthLabel = Number.isFinite(Number(health)) ? `${health}/100` : 'Loading…';
      return `
        <article class="setup-card ${c.selected ? 'selected' : ''} ${lockedTrade ? 'is-locked' : ''} ${opening ? 'is-opening' : ''}">
          <div class="setup-head">
            <div>
              <strong>${sym}</strong>
              <span>#${index + 1} priority</span>
              <span>${resolvedSetupType(c)} · ${side.toUpperCase()} · ${Math.abs(n(c.score))}</span>
            </div>
            <button type="button" ${disabled} data-setup="${sym}">${opening ? 'Opening…' : lockedTrade ? 'Locked' : canTrade ? 'Trade' : 'Watch'}</button>
          </div>
          ${lockedTrade ? `<div class="stock-lock broker-status--${brokerState}"><b>Locked · Entry ${fmt(lockedTrade.entryPrice)}</b><span>${escapeHTML(brokerStatusLabel(lockedTrade.broker || { status:'open' }))}</span></div>` : ''}
          <div class="setup-trade-row">
            <span><small>Price</small><b>${fmt(price)}</b></span>
            <span class="${cls(change)}"><small>Change</small><b>${pct(change)}</b></span>
            <span><small>Target</small><b>${target ? fmt(target) : '--'}</b></span>
            <span><small>Score</small><b>${Math.abs(n(c.score))}</b></span>
          </div>
          <div class="setup-metrics">
            <span>Score <b>${Math.abs(n(c.score))}</b></span>
            <span>Status <b>${status}</b></span>
            <span>Entry <b>${fmt(entry)}</b></span>
            <span>Stop <b>${stop ? fmt(stop) : '--'}</b></span>
            <span>Target <b>${target ? fmt(target) : '--'}</b></span>
            <span>R:R <b>${rr ? fmt(rr) : '--'}</b></span>
            <span>Price <b>${fmt(price)}</b></span>
            <span class="${cls(change)}">Chg <b>${pct(change)}</b></span>
            <span>VWAP <b>${vwap ? fmt(vwap) : '--'}</b></span>
            <span>Volume <b>${volume ? volume.toLocaleString('en-IN') : '--'}</b></span>
            <span>Sector <b>${c.sector || '--'}</b></span>
            <span>Net potential <b>${Number.isFinite(Number(c.cost?.netPct)) ? `${fmt(c.cost.netPct)}%` : '--'}</b></span>
            <span>Health <b data-health-symbol="${sym}" class="${Number(health) >= 80 ? 'positive' : Number.isFinite(Number(health)) && Number(health) < 50 ? 'negative' : ''}">${healthLabel}</b></span>
          </div>
          ${reason ? `<p class="setup-reason">${reason}</p>` : ''}
        </article>
      `;
    }).join('') : '<div class="empty">No actionable setups</div>';
    syncDirectionalActionLabels();
    if (cards.length) connectHealthStream(cards);
    updateManualSymbolOptions();
  }

  function syncDirectionalActionLabels() {
    document.querySelectorAll('[data-setup], [data-all-trade]').forEach(button => {
      if (button.disabled) return;
      const symbol = String(button.dataset.setup || button.dataset.allTrade || '').toUpperCase();
      const row = state.candidates.find(item => String(item.symbol || '').toUpperCase() === symbol)
        || state.allStocks.find(item => String(item.symbol || '').toUpperCase() === symbol);
      const side = String(withLiveQuote(row || {}).side || '').toLowerCase();
      if (side === 'buy' || side === 'sell') button.textContent = side.toUpperCase();
    });
  }

  function computeHealthScore(meta, price) {
    if (!meta || typeof meta !== 'object') return null;
    const metric = value => value == null || value === '' ? NaN : Number(value);
    const eps = metric(meta.trailingEps);
    const trailingPe = metric(meta.trailingPE);
    const pe = Number.isFinite(trailingPe) && trailingPe !== 0 ? trailingPe : (price > 0 && eps ? price / eps : NaN);
    const roeRaw = metric(meta.roe);
    const roe = Number.isFinite(roeRaw) ? (Math.abs(roeRaw) <= 1 ? roeRaw * 100 : roeRaw) : NaN;
    const debt = metric(meta.totalDebt);
    const equity = metric(meta.totalEquity);
    const de = Number.isFinite(debt) && Number.isFinite(equity) && equity !== 0 ? debt / equity : NaN;
    let peg = metric(meta.peg);
    const growthRaw = metric(meta.epsGrowth);
    if (!Number.isFinite(peg) && Number.isFinite(growthRaw) && Number.isFinite(pe)) {
      const growth = growthRaw > 1 ? growthRaw : growthRaw * 100;
      if (growth) peg = pe / growth;
    }
    if (![eps, pe, roe, de, peg].some(Number.isFinite)) return null;
    let score = 0;
    if (Number.isFinite(eps) && eps > 0) score += 20;
    if (Number.isFinite(pe) && pe > 0) score += pe <= 15 ? 20 : pe <= 25 ? 10 : 0;
    if (Number.isFinite(roe)) score += roe >= 20 ? 20 : roe >= 10 ? 10 : 0;
    if (Number.isFinite(de)) score += de < 1 ? 20 : de < 2 ? 10 : 0;
    if (Number.isFinite(peg) && peg > 0) score += peg <= 2 ? 20 : peg <= 4 ? 10 : 0;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function connectHealthStream(cards) {
    if (!window.EventSource) return;
    const symbols = [...new Set(cards.filter(c => String(c.assetType || '').toLowerCase() !== 'etf').map(c => String(c.symbol || '').toUpperCase()).filter(symbol => symbol && !state.healthLoadedSymbols.has(symbol)))];
    if (!symbols.length) return;
    const key = symbols.slice().sort().join(',');
    if (state.healthStream && state.healthStreamKey === key) return;
    state.healthStream?.close();
    state.healthStreamKey = key;
    const stream = new EventSource(`/stream/yahoo-summary?symbols=${encodeURIComponent(symbols.join(','))}`);
    state.healthStream = stream;
    stream.onmessage = event => {
      try {
        const message = JSON.parse(event.data || '{}');
        if (message.done) {
          stream.close();
          if (state.healthStream === stream) state.healthStream = null;
          if (state.allStockFilter === 'all') renderAllStocks();
          return;
        }
        if (!message.sym) return;
        const symbol = String(message.sym).toUpperCase();
        state.healthLoadedSymbols.add(symbol);
        if (!message.data) return;
        const candidate = cards.find(c => String(c.symbol || '').toUpperCase() === symbol);
        const health = computeHealthScore(message.data, n(candidate?.price || candidate?.quote?.price));
        if (!Number.isFinite(health)) return;
        state.healthScores[symbol] = health;
        document.querySelectorAll(`[data-health-symbol="${symbol}"]`).forEach(cell => {
          cell.textContent = `${health}/100`;
          cell.className = health >= 80 ? 'positive' : health < 50 ? 'negative' : '';
        });
      } catch (_) {}
    };
    stream.onerror = () => {
      stream.close();
      if (state.healthStream === stream) state.healthStream = null;
    };
  }

  function allStockRows() {
    const favoriteRows = state.bootstrap?.prefs?.stockFavorites || [];
    const favorites = new Set((Array.isArray(favoriteRows) ? favoriteRows : Object.keys(favoriteRows || {})).map(item => String(item?.sym || item?.symbol || item || '').toUpperCase()));
    const query = state.allStockSearch.trim().toUpperCase();
    const rows = state.allStocks.map(withLiveQuote).filter(row => !query || row.symbol.includes(query) || String(row.name || '').toUpperCase().includes(query));
    if (state.allStockFilter === 'favorites') return rows.filter(row => favorites.has(row.symbol)).sort((a, b) => Math.abs(n(b.score)) - Math.abs(n(a.score)));
    if (state.allStockFilter === 'gainers') return rows.filter(row => n(row.change) > 0).sort((a, b) => n(b.change) - n(a.change));
    if (state.allStockFilter === 'losers') return rows.filter(row => n(row.change) < 0).sort((a, b) => n(a.change) - n(b.change));
    return rows.sort((a, b) => {
      const healthA = Number(state.healthScores[a.symbol]);
      const healthB = Number(state.healthScores[b.symbol]);
      const rankedA = Number.isFinite(healthA) ? healthA : -1;
      const rankedB = Number.isFinite(healthB) ? healthB : -1;
      return rankedB - rankedA || a.symbol.localeCompare(b.symbol);
    });
  }

  function renderAllStocks() {
    const list = $('all-stock-list');
    if (!list) return;
    if (state.allStocksLoading && !state.allStocks.length) {
      list.innerHTML = '<div class="empty">Loading stock profiles…</div>';
      setText('all-stock-count', 'Loading');
      return;
    }
    const rows = allStockRows();
    const pages = Math.max(1, Math.ceil(rows.length / 10));
    state.allStockPage = Math.min(Math.max(1, state.allStockPage), pages);
    const pageRows = rows.slice((state.allStockPage - 1) * 10, state.allStockPage * 10);
    setText('all-stock-count', `${rows.length} stocks`);
    setText('all-stock-page', `Page ${state.allStockPage} / ${pages}`);
    const prev = $('all-stock-prev');
    const next = $('all-stock-next');
    if (prev) prev.disabled = state.allStockPage <= 1;
    if (next) next.disabled = state.allStockPage >= pages;
    const selector = $('all-stock-filter-select');
    if (selector) selector.value = state.allStockFilter;
    list.innerHTML = pageRows.length ? pageRows.map(row => {
      const health = state.healthScores[row.symbol];
      const canTrade = ['buy', 'sell'].includes(String(row.side || '').toLowerCase()) && row.price > 0;
      const lockedTrade = openTradeForSymbol(row.symbol);
      const brokerState = String(lockedTrade?.broker?.status || 'open').toLowerCase();
      const opening = state.pendingTradeSymbols.has(row.symbol);
      return `<article class="all-stock-row ${lockedTrade ? 'is-locked' : ''} ${opening ? 'is-opening' : ''}" data-chart-symbol="${row.symbol}" title="Open 5-minute candle chart">
        <button class="stock-symbol stock-detail-link" type="button" data-detail-symbol="${row.symbol}" title="Open stock details"><small>Stock</small><b>${row.symbol}</b></button>
        <span><small>Price</small><b>${row.price ? fmt(row.price) : '--'}</b></span>
        <span class="${cls(row.change)}"><small>Change</small><b class="${cls(row.change)}">${pct(row.change)}</b></span>
        <span><small>Health</small><b data-health-symbol="${row.symbol}" class="${Number(health) >= 80 ? 'positive' : Number.isFinite(Number(health)) && Number(health) < 50 ? 'negative' : ''}">${Number.isFinite(Number(health)) ? `${health}/100` : 'Loading…'}</b></span>
        ${lockedTrade ? `<div class="stock-lock broker-status--${brokerState}"><b>Locked · Entry ${fmt(lockedTrade.entryPrice)}</b><span>${escapeHTML(brokerStatusLabel(lockedTrade.broker || { status:'open' }))}</span></div>` : ''}
        <div class="all-stock-trade-info">
          <span><small>Target</small><b>${row.target ? fmt(row.target) : '--'}</b></span>
          <span><small>Score</small><b>${fmt(row.score)}</b></span>
          <span><small>Setup</small><b>${row.setupType || row.entryStatus || 'Watch'}</b></span>
          <button type="button" data-all-trade="${row.symbol}" ${canTrade && !lockedTrade && !opening ? '' : 'disabled'}>${opening ? 'Opening…' : lockedTrade ? 'Locked' : canTrade ? 'Trade' : 'Watch'}</button>
        </div>
      </article>`;
    }).join('') : '<div class="empty">No stocks match this profile</div>';
    syncDirectionalActionLabels();
    if (rows.length) connectHealthStream(rows);
  }

  async function loadAllStocks() {
    if (state.allStocksLoading) return;
    state.allStocksLoading = true;
    renderAllStocks();
    try {
      if (!state.bootstrap?.prefs?.stocks) {
        const bootstrap = await api('/dashboard-bootstrap');
        state.bootstrap = { ...(state.bootstrap || {}), ...bootstrap };
      }
      const universe = await api('/mobile-stock-universe');
      const source = Array.isArray(universe.stocks) ? universe.stocks : [];
      const meta = new Map(source.map(item => {
        const symbol = String(item?.sym || item?.symbol || item || '').toUpperCase();
        return [symbol, typeof item === 'object' ? item : { symbol }];
      }).filter(([symbol]) => symbol));
      const symbols = [...meta.keys()].slice(0, 300);
      const market = symbols.length ? await api(`/dashboard-market?symbols=${encodeURIComponent(symbols.join(','))}`) : { quotes:{} };
      const candidates = new Map(state.candidates.map(candidate => [String(candidate.symbol || '').toUpperCase(), candidate]));
      state.allStocks = symbols.map(symbol => {
        const quote = market.quotes?.[symbol] || {};
        const candidate = candidates.get(symbol) || {};
        return {
          symbol,
          name:meta.get(symbol)?.name || symbol,
          sector:meta.get(symbol)?.sector || candidate.sector || '',
          assetType:'stock',
          price:n(quote.price || candidate.price || candidate.quote?.price),
          change:n(quote.change ?? candidate.quote?.change ?? candidate.indicators?.dayChange),
          score:n(candidate.score),
          target:n(candidate.indicators?.target || candidate.target),
          setupType:resolvedSetupType(candidate),
          entryStatus:candidate.indicators?.entryStatus || candidate.entryStatus || '',
          side:candidate.side || candidate.signal || '',
          indicators:candidate.indicators || {},
          quote,
        };
      });
    } catch (error) {
      setStatus(error.message || 'Could not load all stocks', true);
    } finally {
      state.allStocksLoading = false;
      renderAllStocks();
      updateManualSymbolOptions();
      connectLiveStream();
    }
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
    const brokerPnl = activeBrokerPnl();
    const brokerLabel = activeBrokerLabel();
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
        <div><span>Today P/L (${brokerLabel})</span><strong class="${brokerPnl === null ? '' : cls(brokerPnl)}">${brokerPnl === null ? '--' : inr(brokerPnl)}</strong></div>
        <div><span>Open Exposure</span><strong>${inr(openExposure)}</strong></div>
        <div><span>Total</span><strong>${inr(portfolioTotal(portfolio))}</strong></div>
      `;
    }
    setText('portfolio-transaction-count', `${transactions.length} today`);
    const list = $('portfolio-transactions');
    if (!list) return;
    const quotes = tradePriceMap();
    transactions.sort((a, b) => new Date(tradeTimestamp(b) || 0) - new Date(tradeTimestamp(a) || 0));
    list.innerHTML = transactions.length ? transactions.map(trade => {
      const status = String(trade.status || '').toLowerCase() || '--';
      const time = tradeTimestamp(trade)
        ? new Date(tradeTimestamp(trade)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '--';
      const quote = quotes.get(String(trade.symbol || '').toUpperCase()) || {};
      const currentPrice = status === 'open' ? n(quote.price || trade.entryPrice) : n(trade.exitPrice);
      const priceChange = Number(quote.change);
      const pnl = tradePnl(trade, quote);
      const brokerExitInfo = trade.broker?.exitOrderId
        ? `Exit order: ${trade.broker.exitOrderId}`
        : (trade.broker?.status === 'exit_failed' ? `⚠ Exit failed: ${trade.broker.error || ''}` : '');
      const closeNote = trade.closeReason || trade.exitReason || '';
      const entryReason = tradeEntryReason(trade);
      const entryTime = formatTradeTime(tradeEntryTimestamp(trade));
      const exitTime = formatTradeTime(tradeExitTimestamp(trade));
      return `
        <article class="transaction-row">
          <div>
            <strong>${String(trade.symbol || '').toUpperCase()}</strong>
            <span>${status} · ${tradeBrokerLabel(trade)} · ${time}</span>
          </div>
          <div>
            <strong>${String(trade.side || '').toUpperCase()} ${trade.qty || '--'}</strong>
            <span>Entry ${fmt(trade.entryPrice)} · Exit ${trade.exitPrice ? fmt(trade.exitPrice) : '--'}</span>
            ${status === 'open' ? `<span>Current ${fmt(currentPrice)} · <b class="${cls(priceChange)}">Change ${pct(priceChange)}</b></span>` : ''}
            <span>Entry time ${entryTime}</span>
            <span>Exit time ${status === 'closed' ? exitTime : '--'}</span>
            <span><b>Entry why:</b> ${escapeHTML(entryReason)}</span>
          </div>
          <div>
            <strong class="${cls(pnl)}">${inr(pnl)}</strong>
            <span>${closeNote}</span>
            ${brokerExitInfo ? `<span class="order-id">${brokerExitInfo}</span>` : ''}
          </div>
        </article>
      `;
    }).join('') : '<div class="empty">No transactions found</div>';
  }

  function renderMarketStrip() {
    const indices = state.market?.indices || {};
    const nifty = indices.nifty50 || indices.nifty || indices.NIFTY50 || {};
    const midcap = indices.midcap || indices.midcap150 || indices.niftyMidcap150 || {};
    const renderIndex = (prefix, quote) => {
      const price = n(quote.price || quote.last || quote.value);
      const change = Number(quote.change ?? quote.changePct ?? quote.percentChange);
      setText(`market-${prefix}-price`, price ? fmt(price) : '--');
      const changeEl = $(`market-${prefix}-change`);
      if (changeEl) {
        changeEl.textContent = Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${fmt(change)}%` : '--';
        changeEl.className = cls(change);
      }
    };
    renderIndex('nifty', nifty);
    renderIndex('midcap', midcap);
    const sectorTrend = { ...(state.sectorTrend || {}) };
    if (!Object.keys(sectorTrend).length) {
      const grouped = new Map();
      for (const candidate of state.candidates) {
        const sector = String(candidate.sector || '').trim();
        const rawChange = candidate.quote?.change ?? candidate.indicators?.dayChange;
        const change = Number(rawChange);
        if (!sector || !Number.isFinite(change)) continue;
        const values = grouped.get(sector) || [];
        values.push(change);
        grouped.set(sector, values);
      }
      for (const [sector, values] of grouped) {
        sectorTrend[sector] = values.reduce((sum, value) => sum + value, 0) / values.length;
      }
    }
    const leaders = Object.entries(sectorTrend)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 5);
    const el = $('sector-leaders');
    if (el) el.innerHTML = `<span>Top sectors</span>${leaders.length ? leaders.map(([name, value]) => `<strong>${name} <b class="${cls(value)}">${Number(value) >= 0 ? '+' : ''}${fmt(value)}%</b></strong>`).join('') : '<strong>--</strong>'}`;
  }

  function mergeLiveCandidates(payload = {}) {
    const live = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const bySymbol = new Map(state.candidates.map((candidate, index) => [String(candidate.symbol || '').toUpperCase(), index]));
    let changed = false;
    for (const [rawSymbol, value] of Object.entries(live)) {
      if (!value || typeof value !== 'object') continue;
      const symbol = String(rawSymbol).toUpperCase();
      const previousLive = state.liveQuotes.get(symbol) || {};
      state.liveQuotes.set(symbol, { ...previousLive, ...value, symbol, receivedAt: payload.at || Date.now() });
      document.querySelectorAll(`[data-live-price="${symbol}"]`).forEach(element => {
        const price = n(value.price || previousLive.price);
        element.textContent = price ? fmt(price) : '--';
      });
      document.querySelectorAll(`[data-live-summary="${symbol}"]`).forEach(element => {
        const price = n(value.price || previousLive.price);
        const change = n(value.dayChange ?? value.change ?? previousLive.dayChange ?? previousLive.change);
        element.className = cls(change);
        element.textContent = `Price ${price ? fmt(price) : '--'} · Change ${fmt(change)}%`;
      });
      if (String($('manual-symbol')?.value || '').trim().toUpperCase() === symbol && document.activeElement !== $('manual-price')) {
        populateManualEntry(symbol);
      }
      changed = true;
      const allStock = state.allStocks.find(row => row.symbol === symbol);
      if (allStock) {
        allStock.price = n(value.price || allStock.price);
        allStock.change = n(value.dayChange ?? allStock.change);
        allStock.score = Number.isFinite(Number(value.score)) ? Number(value.score) : allStock.score;
        allStock.target = n(value.target || allStock.target);
        allStock.derivedSetupType = value.derivedSetupType || allStock.derivedSetupType;
        allStock.setupType = resolvedSetupType({ ...allStock, ...value });
        allStock.entryStatus = value.entryStatus || allStock.entryStatus;
        allStock.side = value.side || value.signal || allStock.side;
        allStock.indicators = { ...(allStock.indicators || {}), ...value };
        changed = true;
      }
      const index = bySymbol.get(symbol);
      if (index == null) continue;
      const current = state.candidates[index];
      const price = n(value.price || current.price || current.quote?.price);
      state.candidates[index] = {
        ...current,
        price,
        score: Number.isFinite(Number(value.score)) ? Number(value.score) : current.score,
        side: value.side || value.signal || current.side,
        derivedSetupType: value.derivedSetupType || current.derivedSetupType,
        setupType: resolvedSetupType({ ...current, ...value }),
        quote: { ...(current.quote || {}), price, change: value.dayChange ?? current.quote?.change },
        indicators: { ...(current.indicators || {}), ...value, price },
      };
      changed = true;
    }
    if (payload.sectorTrend && Object.keys(payload.sectorTrend).length) {
      state.sectorTrend = payload.sectorTrend;
      state.sectorTrendStreamed = true;
    }
    if (changed) {
      state.lastRefreshAt = Date.now();
      renderHeader();
      renderSetups();
      renderTrades();
      renderAllStocks();
      renderMarketStrip();
      renderNotificationBadge();
      if (!$('notification-overlay')?.hidden) renderNotificationOverlay();
      if (!$('portfolio-overlay')?.hidden) renderPortfolioOverlay();
      if (!$('pnl-overlay')?.hidden) renderPnlOverlay();
      setText('updated-at', 'LIVE');
    }
  }

  function scheduleStreamReconnect(kind, connect) {
    const key = kind === 'live' ? 'liveReconnectTimer' : 'tradeReconnectTimer';
    if (state[key]) return;
    state[key] = setTimeout(() => {
      state[key] = null;
      connect();
    }, 3000);
  }

  function connectLiveStream() {
    if (!window.EventSource) return;
    const openTradeSymbols = state.trades
      .filter(trade => String(trade.status || '').toLowerCase() === 'open')
      .map(trade => String(trade.symbol || '').toUpperCase());
    const brokerPositionSymbols = (state.brokerPortfolio?.data?.portfolio?.positions?.list || [])
      .map(position => String(position.symbol || position.tradingsymbol || '').toUpperCase());
    const symbols = [...new Set([
      ...openTradeSymbols,
      ...brokerPositionSymbols,
      ...state.candidates.map(c => String(c.symbol || '').toUpperCase()),
      ...state.allStocks.map(c => String(c.symbol || '').toUpperCase()),
    ].filter(Boolean))].slice(0, 300);
    if (!symbols.length) return;
    const streamKey = symbols.slice().sort().join(',');
    if (state.liveStream && state.liveStreamKey === streamKey) return;
    state.liveStream?.close();
    state.liveStream = null;
    state.liveStreamKey = streamKey;
    const connect = () => {
      try {
        const stream = new EventSource(`/stream/intraday-live?symbols=${encodeURIComponent(symbols.join(','))}`);
        state.liveStream = stream;
        stream.onmessage = event => {
          try { mergeLiveCandidates(JSON.parse(event.data || '{}')); } catch (_) {}
        };
        stream.onerror = () => {
          stream.close();
          if (state.liveStream === stream) state.liveStream = null;
          scheduleStreamReconnect('live', connect);
        };
      } catch (_) { scheduleStreamReconnect('live', connect); }
    };
    connect();
  }

  function connectMarketOverviewStream() {
    if (!window.EventSource || state.marketOverviewStream) return;
    const stream = new EventSource('/stream/market-overview');
    state.marketOverviewStream = stream;
    stream.onmessage = event => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.sectorTrend && Object.keys(payload.sectorTrend).length) {
          state.sectorTrend = payload.sectorTrend;
          state.sectorTrendStreamed = true;
        }
        const incomingIndices = payload.indices || {};
        if (Object.keys(incomingIndices).length) state.market = { ...state.market, indices:{ ...(state.market?.indices || {}), ...incomingIndices } };
        renderMarketStrip();
      } catch (_) {}
    };
    stream.onerror = () => {
      // Native EventSource reconnects automatically. Drop the reference only if closed permanently.
      if (stream.readyState === EventSource.CLOSED) state.marketOverviewStream = null;
    };
  }

  function connectTradeStream() {
    if (!window.EventSource || state.tradeStream) return;
    const connect = () => {
      try {
        const stream = new EventSource('/trade-execution/stream');
        state.tradeStream = stream;
        stream.onmessage = event => {
          try {
            const payload = JSON.parse(event.data || '{}');
            if (Array.isArray(payload.trades)) state.trades = payload.trades;
            if (payload.portfolio) {
              state.bootstrap = state.bootstrap || {};
              state.bootstrap.portfolio = payload.portfolio;
            }
            if (payload.dayPnl) {
              state.bootstrap = state.bootstrap || {};
              state.bootstrap.dayPnl = payload.dayPnl;
            }
            if (payload.simulationRuntime?.state) state.simulationState = payload.simulationRuntime.state;
            renderHeader();
            renderTrades();
            renderSetups();
            renderAllStocks();
            connectLiveStream();
          } catch (_) {}
        };
        stream.onerror = () => {
          stream.close();
          if (state.tradeStream === stream) state.tradeStream = null;
          scheduleStreamReconnect('trade', connect);
        };
      } catch (_) { scheduleStreamReconnect('trade', connect); }
    };
    connect();
  }

  function buildTodayPnlBreakdown() {
    const broker = activeBroker();
    if (broker !== 'paper') {
      const portfolio = state.brokerPortfolio?.data?.portfolio || {};
      const positions = Array.isArray(portfolio?.positions?.list) ? portfolio.positions.list.map(brokerPositionWithLiveQuote) : [];
      const closed = todayTrades()
        .filter(trade => String(trade.status || '').toLowerCase() === 'closed' && tradeMatchesActiveBroker(trade, broker));
      return [
        ...positions.map(pos => ({
          symbol: String(pos.symbol || '--').toUpperCase(),
          broker: activeBrokerLabel(),
          trades: 1,
          qty: n(pos.qty),
          exposure: Math.abs(n(pos.investedValue || n(pos.avgPrice) * n(pos.qty))),
          pnl: n(pos.pnl),
          open: 1,
          closed: 0,
          lastPrice: n(pos.ltp),
          entryPrice: n(pos.avgPrice || pos.entryPrice),
          exitPrice: null,
          entryTime: tradeEntryTimestamp(pos),
          exitTime: '',
          exitReason: '',
          source: 'broker-open',
        })),
        ...closed.map(trade => ({
          symbol: String(trade.symbol || '--').toUpperCase(),
          broker: activeBrokerLabel(),
          trades: 1,
          qty: n(trade.qty),
          exposure: Math.abs(n(trade.entryPrice) * n(trade.qty)),
          pnl: n(trade.pnl),
          open: 0,
          closed: 1,
          lastPrice: n(trade.exitPrice),
          entryPrice: n(trade.entryPrice),
          exitPrice: n(trade.exitPrice),
          entryTime: tradeEntryTimestamp(trade),
          exitTime: tradeExitTimestamp(trade),
          exitReason: trade.closeReason || trade.exitReason || '',
          source: 'app-closed',
        })),
      ].map(row => ({
        ...row,
        pct: row.exposure ? (row.pnl / row.exposure) * 100 : 0,
      })).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || a.symbol.localeCompare(b.symbol));
    }
    const quotes = tradePriceMap();
    const groups = new Map();
    for (const trade of todayTrades()) {
      const sym = String(trade.symbol || '').toUpperCase();
      if (!sym) continue;
      const broker = tradeBrokerLabel(trade);
      const key = `${sym}|${broker}`;
      const quote = quotes.get(sym) || {};
      const qty = n(trade.qty);
      const entry = n(trade.entryPrice);
      const status = String(trade.status || '').toLowerCase();
      const pnl = tradePnl(trade, quote);
      const current = status === 'closed' ? n(trade.exitPrice || entry) : n(quote.price || entry);
      const exposure = Math.abs(entry * qty);
      const row = groups.get(key) || {
        symbol: sym,
        broker,
        trades: 0,
        qty: 0,
        exposure: 0,
        pnl: 0,
        open: 0,
        closed: 0,
        lastPrice: 0,
        entryValue: 0,
        exitValue: 0,
        exitQty: 0,
        entryTime: '',
        exitTime: '',
        exitReason: '',
      };
      row.trades += 1;
      row.qty += qty;
      row.exposure += exposure;
      row.pnl += pnl;
      row.entryValue += entry * qty;
      if (!row.entryTime || new Date(tradeEntryTimestamp(trade) || 0) < new Date(row.entryTime)) row.entryTime = tradeEntryTimestamp(trade);
      if (status === 'open') row.open += 1;
      if (status === 'closed') {
        row.closed += 1;
        row.exitValue += n(trade.exitPrice) * qty;
        row.exitQty += qty;
        if (!row.exitTime || new Date(tradeExitTimestamp(trade) || 0) > new Date(row.exitTime)) {
          row.exitTime = tradeExitTimestamp(trade);
          row.exitReason = trade.closeReason || trade.exitReason || row.exitReason;
        }
      }
      if (current) row.lastPrice = current;
      groups.set(key, row);
    }
    return [...groups.values()]
      .map(row => ({
        ...row,
        entryPrice: row.qty ? row.entryValue / row.qty : 0,
        exitPrice: row.exitQty ? row.exitValue / row.exitQty : null,
        pct: row.exposure ? (row.pnl / row.exposure) * 100 : 0,
      }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl) || a.symbol.localeCompare(b.symbol));
  }

  function renderPnlOverlay() {
    const rows = buildTodayPnlBreakdown();
    const broker = activeBroker();
    const brokerPnl = activeBrokerPnl();
    const net = broker !== 'paper' && brokerPnl !== null ? brokerPnl : rows.reduce((sum, row) => sum + row.pnl, 0);
    const exposure = rows.reduce((sum, row) => sum + row.exposure, 0);
    const summary = $('pnl-summary');
    if (summary) {
      summary.innerHTML = `
        <div><span>${activeBrokerLabel()} Day P/L</span><strong class="${cls(net)}">${inr(net)}</strong></div>
        <div><span>Gain</span><strong class="${cls(net)}">${fmt(exposure ? (net / exposure) * 100 : 0)}%</strong></div>
        <div><span>Stocks</span><strong>${rows.length}</strong></div>
        <div><span>Trades</span><strong>${rows.reduce((sum, row) => sum + row.trades, 0)}</strong></div>
      `;
    }
    const list = $('pnl-list');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map(row => `
      <article class="pnl-row">
        <div>
          <strong>${row.symbol}</strong>
          <span>${row.broker}${row.source === 'broker-open' ? ' open' : row.source === 'app-closed' ? ' closed today' : ''}</span>
        </div>
        <div>
          <strong class="${cls(row.pnl)}">${inr(row.pnl)}</strong>
          <span class="${cls(row.pct)}">${fmt(row.pct)}% gain</span>
        </div>
        <div>
          <strong>${row.qty || '--'} qty</strong>
          <span>${row.open ? `${row.open} open` : ''}${row.open && row.closed ? ' / ' : ''}${row.closed ? `${row.closed} closed` : ''}</span>
          <span>Entry ${fmt(row.entryPrice)} · ${formatTradeTime(row.entryTime)}</span>
          <span>Exit ${row.exitPrice ? fmt(row.exitPrice) : '--'} · ${row.exitTime ? formatTradeTime(row.exitTime) : '--'}</span>
          ${row.exitReason ? `<span>${escapeHTML(row.exitReason)}</span>` : ''}
        </div>
      </article>
    `).join('') : '<div class="empty">No P/L for today yet</div>';
  }

  function renderAll() {
    renderHeader();
    renderTrades();
    renderSetups();
    renderSettings();
    renderMarketStrip();
  }

  function hydrateSetupCache() {
    try {
      const cached = JSON.parse(localStorage.getItem('intradayx.mobile.setupData') || 'null');
      if (!cached || !Array.isArray(cached.candidates) || !cached.candidates.length) return false;
      state.candidates = cached.candidates;
      state.sectorTrend = cached.sectorTrend || {};
      state.market = cached.market || state.market;
      state.setupsLoaded = true;
      return true;
    } catch (_) { return false; }
  }

  async function loadSetups() {
    const requestId = ++state.setupRequestId;
    if (!state.setupsLoaded) hydrateSetupCache();
    state.setupsLoading = !state.setupsLoaded;
    renderSetups();
    const refreshButton = $('setup-refresh-btn');
    if (refreshButton) refreshButton.disabled = true;
    if (state.setupsLoaded) setText('setup-count', 'Refreshing…');
    try {
      const analysis = await api(`/mobile-setups?filter=${encodeURIComponent(state.setupFilter)}`);
      if (requestId !== state.setupRequestId) return;
      state.settings = analysis.settings || state.settings;
      state.candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
      const incomingIndices = analysis.market?.indices || {};
      state.market = {
        ...state.market,
        ...(analysis.market || {}),
        indices:Object.keys(incomingIndices).length ? incomingIndices : (state.market?.indices || {}),
      };
      // A setup response is a point-in-time analysis snapshot. Once the
      // market stream has supplied sector values, do not let selecting or
      // refreshing a setup replace those newer streamed percentages.
      if (!state.sectorTrendStreamed) state.sectorTrend = analysis.sectorTrend || {};
      state.setupsLoaded = true;
      try {
        localStorage.setItem('intradayx.mobile.setupData', JSON.stringify({
          savedAt:Date.now(),
          candidates:state.candidates,
          sectorTrend:state.sectorTrend,
          market:state.market,
        }));
      } catch (_) {}
      state.lastRefreshAt = Date.now();
      renderSettings();
      renderMarketStrip();
      connectLiveStream();
    } catch (error) {
      if (requestId !== state.setupRequestId) return;
      setStatus(error.message || 'Could not load setups', true);
    } finally {
      if (requestId === state.setupRequestId) {
        state.setupsLoading = false;
        if (refreshButton) refreshButton.disabled = false;
        renderSetups();
      }
    }
  }

  async function refreshAll() {
    state.bootstrap = state.bootstrap || {};
    const failures = [];
    const run = (promise, apply) => promise.then(payload => {
      apply(payload);
      state.lastRefreshAt = Date.now();
    }).catch(error => failures.push(error));
    const tasks = [
      run(api('/dashboard-bootstrap'), bootstrap => {
        state.bootstrap = { ...state.bootstrap, ...bootstrap };
        renderHeader();
        updateManualSymbolOptions();
      }),
      run(api('/trade-execution'), tradeState => {
        state.trades = Array.isArray(tradeState.trades) ? tradeState.trades : [];
        state.bootstrap.portfolio = tradeState.portfolio || state.bootstrap.portfolio;
        renderHeader();
        renderTrades();
        connectLiveStream();
      }),
      run(api('/broker-status'), brokerStatus => {
        state.brokerStatus = brokerStatus;
        state.brokerMode = brokerStatus.mode || 'paper';
        renderHeader();
        refreshActiveBrokerPortfolio().then(() => {
          renderHeader();
          if (!$('pnl-overlay')?.hidden) renderPnlOverlay();
        });
      }),
      run(api('/simulation/status'), simStatus => {
        state.simulationState = simStatus.state || 'off';
        renderHeader();
      }),
      run(api('/trade-settings'), settings => {
        state.overrides = settings.overrides || {};
        renderSettings();
      }),
      run(api('/dashboard-market'), market => {
        state.market = { ...state.market, indices: market.indices || state.market?.indices || {} };
        renderMarketStrip();
      }),
    ];
    connectTradeStream();
    await Promise.all(tasks);
    state.loadError = failures.length ? failures[0]?.message || 'Some data could not load' : '';
    if (!$('notification-overlay')?.hidden) renderNotificationOverlay();
    if (!$('pnl-overlay')?.hidden) renderPnlOverlay();
    setStatus(failures.length ? state.loadError : '', failures.length > 0);
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
      await refreshActiveBrokerPortfolio();
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

  async function openPnlOverlay() {
    if (activeBroker() !== 'paper' && !activeBrokerAuthenticated()) {
      openBrokerLogin(activeBroker());
      return;
    }
    const overlay = $('pnl-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    const list = $('pnl-list');
    if (list) list.innerHTML = '<div class="empty">Loading P/L breakdown</div>';
    try {
      const payload = await api('/trade-execution');
      state.trades = Array.isArray(payload.trades) ? payload.trades : state.trades;
      if (payload.portfolio) {
        state.bootstrap = state.bootstrap || {};
        state.bootstrap.portfolio = payload.portfolio;
      }
      await refreshActiveBrokerPortfolio();
      renderHeader();
      renderTrades();
      renderPnlOverlay();
    } catch (error) {
      if (list) list.innerHTML = `<div class="empty negative">${error.message || 'Could not load P/L breakdown'}</div>`;
    }
  }

  function closePnlOverlay() {
    const overlay = $('pnl-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function openNotificationOverlay() {
    const overlay = $('notification-overlay');
    if (!overlay) return;
    renderNotificationOverlay();
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
  }

  function closeNotificationOverlay() {
    const overlay = $('notification-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function renderFreshNews() {
    const list = $('fresh-news-list');
    if (!list) return;
    const news = state.freshNews;
    setText('fresh-news-status', news.loading ? 'Loading fresh news…' : news.error ? `Error: ${news.error}` : `${news.items.length} fresh items`);
    list.innerHTML = news.items.length ? news.items.map(item => {
      const published = item.publishedAt ? new Date(item.publishedAt).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '--';
      const safeUrl = /^https?:\/\//i.test(String(item.url || '')) ? escapeHTML(item.url) : '';
      const title = escapeHTML(item.title || 'News');
      const sentiment = String(item.newsSentiment || item.type || 'News');
      const sentimentClass = /positive|bullish|upside/i.test(sentiment) ? 'news-positive' : /negative|bearish|downside/i.test(sentiment) ? 'news-negative' : 'news-neutral';
      const impactScore = Number(item.tradeImpactScore || 0);
      const impactLabel = `${sentiment} ${impactScore > 0 ? '+' : ''}${impactScore}`;
      return `<article class="news-row">
        <div class="news-row-head"><strong>${escapeHTML(item.symbol || '--')}</strong><span class="${sentimentClass}" title="${escapeHTML(item.tradeImpactReason || 'Trade impact score')}">${escapeHTML(impactLabel)}</span></div>
        ${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener">${title}</a>` : `<p>${title}</p>`}
        <div class="news-row-meta">${escapeHTML(item.source || '--')} · ${escapeHTML(published)}</div>
      </article>`;
    }).join('') : `<div class="empty">${news.loading ? 'Loading fresh news…' : news.error ? escapeHTML(news.error) : 'No fresh news found'}</div>`;
  }

  async function openFreshNewsOverlay() {
    const overlay = $('fresh-news-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    if (state.freshNews.loading || (state.freshNews.loaded && !state.freshNews.error)) {
      renderFreshNews();
      return;
    }
    state.freshNews = { ...state.freshNews, loading:true, error:'' };
    renderFreshNews();
    try {
      const payload = await api('/fresh-stock-news?maxSymbols=260&limit=30&offset=0');
      state.freshNews = { loading:false, loaded:true, items:Array.isArray(payload.items) ? payload.items : [], error:'' };
    } catch (error) {
      state.freshNews = { loading:false, loaded:true, items:[], error:error.message || 'Could not load fresh news' };
    }
    renderFreshNews();
  }

  function closeFreshNewsOverlay() {
    const overlay = $('fresh-news-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
  }
  window.openMobileFreshNews = openFreshNewsOverlay;

  function renderCandleSvg(candles = [], interval = '5m') {
    const rows = candles.filter(c => [c.open, c.high, c.low, c.close].every(value => Number.isFinite(Number(value)) && Number(value) > 0)).slice(-72);
    if (!rows.length) return `<div class="empty">No ${interval === '15m' ? '15-minute' : '5-minute'} candles available</div>`;
    const width = 640, height = 330, pad = 32;
    const low = Math.min(...rows.map(c => Number(c.low)));
    const high = Math.max(...rows.map(c => Number(c.high)));
    const range = Math.max(high - low, high * 0.001);
    const step = (width - pad * 2) / rows.length;
    const y = value => pad + ((high - Number(value)) / range) * (height - pad * 2);
    const candlesSvg = rows.map((c, index) => {
      const x = pad + index * step + step / 2;
      const openY = y(c.open), closeY = y(c.close);
      const up = Number(c.close) >= Number(c.open);
      const color = up ? '#2fd17c' : '#ff626f';
      return `<line x1="${x}" y1="${y(c.high)}" x2="${x}" y2="${y(c.low)}" stroke="${color}" stroke-width="1"/><rect x="${x - Math.max(1, step * .3)}" y="${Math.min(openY, closeY)}" width="${Math.max(2, step * .6)}" height="${Math.max(1, Math.abs(closeY - openY))}" fill="${color}"/>`;
    }).join('');
    return `<svg class="mobile-candle-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${interval === '15m' ? '15-minute' : '5-minute'} candlestick chart"><text x="4" y="20">${fmt(high)}</text><text x="4" y="${height - 8}">${fmt(low)}</text>${candlesSvg}</svg>`;
  }

  async function openCandleOverlay(symbol, interval = '5m') {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return;
    const safeInterval = interval === '15m' ? '15m' : '5m';
    state.candleChart = { symbol:sym, interval:safeInterval, candles:[], loading:true };
    $('candle-overlay').hidden = false;
    document.body.classList.add('overlay-open');
    setText('candle-title', `${sym} · ${safeInterval} Candles`);
    $('candle-interval-5m')?.classList.toggle('active', safeInterval === '5m');
    $('candle-interval-15m')?.classList.toggle('active', safeInterval === '15m');
    setText('candle-title', `${sym} · 5m Candles`);
    $('candle-body').innerHTML = '<div class="empty">Loading 5-minute candles…</div>';
    try {
      setText('candle-title', `${sym} · ${safeInterval} Candles`);
      $('candle-body').innerHTML = `<div class="empty">Loading ${safeInterval === '15m' ? '15-minute' : '5-minute'} candles…</div>`;
      const payload = await api(`/intraday-candles?symbol=${encodeURIComponent(sym)}&range=1d&interval=${safeInterval}`);
      if (state.candleChart.symbol !== sym || state.candleChart.interval !== safeInterval) return;
      state.candleChart = { symbol:sym, interval:safeInterval, candles:payload.candles || [], loading:false };
      $('candle-body').innerHTML = renderCandleSvg(state.candleChart.candles, safeInterval);
    } catch (error) {
      $('candle-body').innerHTML = `<div class="empty negative">${escapeHTML(error.message || 'Could not load candles')}</div>`;
    }
  }

  function setCandleInterval(interval) {
    if (!state.candleChart.symbol || (state.candleChart.loading && state.candleChart.interval === interval)) return;
    openCandleOverlay(state.candleChart.symbol, interval);
  }

  function closeCandleOverlay() {
    $('candle-overlay').hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function detailImpact(item = {}) {
    if (item.newsSentiment) return { label:item.newsSentiment, score:n(item.tradeImpactScore) };
    const verdict = String(item.resultVerdict || '').toLowerCase();
    const text = `${item.type || ''} ${item.title || ''}`.toLowerCase();
    if (verdict === 'positive' || /order win|contract|dividend|buyback|bonus|approval|expansion/.test(text)) return { label:'Positive', score:verdict === 'positive' ? 90 : 70 };
    if (verdict === 'negative' || /loss|default|fraud|penalty|litigation|downgrade|shutdown/.test(text)) return { label:'Negative', score:verdict === 'negative' ? -90 : -75 };
    return { label:verdict === 'mixed' ? 'Neutral' : 'Neutral', score:verdict === 'mixed' ? 35 : 0 };
  }

  function detailImpactBadge(item) {
    const impact = detailImpact(item);
    const className = impact.label === 'Positive' ? 'news-positive' : impact.label === 'Negative' ? 'news-negative' : 'news-neutral';
    return `<span class="detail-impact ${className}" title="${escapeHTML(item.tradeImpactReason || item.resultVerdictReason || 'Trade impact')}">${escapeHTML(impact.label)} ${impact.score > 0 ? '+' : ''}${impact.score}</span>`;
  }

  async function openStockDetailOverlay(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const row = withLiveQuote(state.allStocks.find(item => item.symbol === sym) || state.candidates.find(item => String(item.symbol || '').toUpperCase() === sym) || { symbol:sym });
    $('stock-detail-overlay').hidden = false;
    document.body.classList.add('overlay-open');
    setText('stock-detail-title', `${sym} Details`);
    $('stock-detail-body').innerHTML = '<div class="empty">Loading fundamentals and news…</div>';
    const [fundResult, newsResult] = await Promise.allSettled([
      api(`/yahoo/summary?symbols=${encodeURIComponent(sym)}`),
      api(`/stock-news?symbol=${encodeURIComponent(sym)}&name=${encodeURIComponent(row.name || sym)}&assetType=stock`),
    ]);
    const meta = fundResult.status === 'fulfilled' ? fundResult.value?.metas?.[sym] || {} : {};
    const newsItems = newsResult.status === 'fulfilled' ? (newsResult.value?.news || []).slice(0, 8) : [];
    const events = newsResult.status === 'fulfilled' ? (newsResult.value?.events || []).slice(0, 6) : [];
    const openTrade = state.trades.find(trade => String(trade.symbol || '').toUpperCase() === sym && String(trade.status || '').toLowerCase() === 'open');
    const health = computeHealthScore(meta, n(row.price));
    const metric = value => value == null || !Number.isFinite(Number(value)) ? '--' : fmt(value);
    $('stock-detail-body').innerHTML = `
      <section class="detail-metrics">
        <span>Price<b data-live-price="${sym}">${row.price ? fmt(row.price) : '--'}</b></span><span>Health<b>${health == null ? '--' : `${health}/100`}</b></span>
        <span>EPS<b>${metric(meta.trailingEps)}</b></span><span>P/E<b>${metric(meta.trailingPE)}</b></span>
        <span>ROE<b>${meta.roe == null ? '--' : `${fmt(Math.abs(Number(meta.roe)) <= 1 ? Number(meta.roe) * 100 : meta.roe)}%`}</b></span><span>Sector<b>${escapeHTML(meta.sector || row.sector || '--')}</b></span>
      </section>
      <h3>Decision Timeline</h3>
      <div class="detail-timeline">
        <div><span>Data</span><b data-live-summary="${sym}">Price ${row.price ? fmt(row.price) : '--'} · Change ${fmt(row.change)}%</b></div>
        <div><span>Signal</span><b>${escapeHTML(String(row.side || 'watch').toUpperCase())} · Score ${fmt(row.score)}</b></div>
        <div><span>Setup</span><b>${escapeHTML(row.setupType || row.entryStatus || 'No active setup')}</b></div>
        <div><span>Trade</span><b>${openTrade ? `${escapeHTML(String(openTrade.side).toUpperCase())} ${openTrade.qty} @ ${fmt(openTrade.entryPrice)}` : 'No open trade'}</b></div>
      </div>
      <h3>Quarterly Results & Events</h3>
      <div class="detail-news">${events.length ? events.map(item => {
        const hasResultMetrics = [item.revenueCr, item.profitAfterTaxCr, item.profitBeforeTaxCr, item.eps]
          .some(value => value != null && Number.isFinite(Number(value)));
        const metrics = hasResultMetrics
          ? `<div class="result-metrics"><span>Revenue ${item.revenueCr == null ? '--' : `${fmt(item.revenueCr)} Cr`}</span><span>PAT ${item.profitAfterTaxCr == null ? '--' : `${fmt(item.profitAfterTaxCr)} Cr`}</span><span>PBT ${item.profitBeforeTaxCr == null ? '--' : `${fmt(item.profitBeforeTaxCr)} Cr`}</span><span>EPS ${item.eps == null ? '--' : fmt(item.eps)}</span></div>`
          : '';
        return `<article><div class="detail-news-head"><b>${escapeHTML(item.title || item.type || 'Event')}</b>${detailImpactBadge(item)}</div><span>${escapeHTML(item.type || 'Event')} · ${escapeHTML(item.filingDate || item.eventDate || item.source || '')}</span>${metrics}</article>`;
      }).join('') : '<div class="empty">No quarterly results or events loaded</div>'}</div>
      <h3>News & Events</h3>
      <div class="detail-news">${newsItems.length ? newsItems.map(item => `<article><div class="detail-news-head"><b>${escapeHTML(item.title || item.type || 'Update')}</b>${detailImpactBadge(item)}</div><span>${escapeHTML(item.source || item.date || item.publishedAt || '')}</span></article>`).join('') : '<div class="empty">No recent news loaded</div>'}</div>`;
    const liveSummary = document.querySelector(`[data-live-summary="${sym}"]`);
    if (liveSummary) {
      liveSummary.textContent = `Price ${row.price ? fmt(row.price) : '--'} · Change ${pct(row.change)}`;
      liveSummary.className = cls(row.change);
    }
  }

  function closeStockDetailOverlay() {
    $('stock-detail-overlay').hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function setStatus(message, isError = false, isSuccess = false) {
    const el = $('trade-status');
    if (el) {
      el.textContent = message || '';
      el.classList.toggle('negative', !!isError);
    }
    const toast = $('global-status');
    if (!toast) return;
    if (state.statusTimer) clearTimeout(state.statusTimer);
    toast.textContent = message || '';
    toast.classList.toggle('negative', !!isError);
    toast.classList.toggle('positive', !!isSuccess);
    toast.classList.toggle('visible', !!message);
    if (message) state.statusTimer = setTimeout(() => toast.classList.remove('visible'), isError ? 6000 : 3500);
  }

  function setSettingsStatus(message, isError = false, isSuccess = false) {
    const el = $('settings-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('negative', !!isError);
    el.classList.toggle('positive', !!isSuccess);
  }

  function setupBySymbol(sym) {
    const candidate = state.candidates.find(c => String(c.symbol || '').toUpperCase() === String(sym || '').toUpperCase());
    return candidate ? withLiveQuote(candidate) : null;
  }

  async function openTrade(payload) {
    const symbol = String(payload.symbol || '').toUpperCase();
    if (state.pendingTradeSymbols.has(symbol)) return null;
    state.pendingTradeSymbols.add(symbol);
    setStatus(`Opening ${symbol}…`);
    renderSetups();
    renderAllStocks();
    try {
      const liveMode = state.brokerMode === 'zerodha_live' || state.brokerMode === 'sharekhan_live';
      const result = await api('/trade-execution', {
        method: 'POST',
        headers: liveMode ? { 'X-Live-Trade-Confirm': 'LIVE' } : {},
        body: JSON.stringify({ action: 'open', brokerMode: state.brokerMode, source: 'manual', ...payload, ...(liveMode ? { liveConfirm:'LIVE' } : {}) }),
      });
      if (result.trade) {
        state.trades = [...state.trades.filter(trade => trade.id !== result.trade.id), result.trade];
      }
      state.pendingTradeSymbols.delete(symbol);
      renderTrades();
      renderSetups();
      renderAllStocks();
      const brokerState = String(result.trade?.broker?.status || '').toLowerCase();
      const failed = String(result.trade?.status || '').toLowerCase() === 'failed'
        || ['failed', 'rejected', 'cancelled', 'timeout'].includes(brokerState);
      const statusText = result.trade?.broker ? brokerStatusLabel(result.trade.broker) : 'Position open';
      if (failed) setStatus(`${symbol} trade failed: ${statusText}`, true);
      else if (brokerState === 'pending') setStatus(`${symbol} order submitted · ${statusText}`);
      else setStatus(`${symbol} opened at ${fmt(result.trade?.entryPrice || payload.entryPrice)} · ${statusText}`, false, true);
      refreshAll();
      return result;
    } catch (error) {
      state.pendingTradeSymbols.delete(symbol);
      renderSetups();
      renderAllStocks();
      setStatus(`${symbol} trade failed: ${error.message || 'Unknown error'}`, true);
      throw error;
    }
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
    $('fresh-news-close').addEventListener('click', closeFreshNewsOverlay);
    $('fresh-news-overlay').addEventListener('click', event => {
      if (event.target.id === 'fresh-news-overlay') closeFreshNewsOverlay();
    });
    $('candle-close').addEventListener('click', closeCandleOverlay);
    $('candle-interval-5m').addEventListener('click', () => setCandleInterval('5m'));
    $('candle-interval-15m').addEventListener('click', () => setCandleInterval('15m'));
    $('candle-overlay').addEventListener('click', event => { if (event.target.id === 'candle-overlay') closeCandleOverlay(); });
    $('stock-detail-close').addEventListener('click', closeStockDetailOverlay);
    $('stock-detail-overlay').addEventListener('click', event => { if (event.target.id === 'stock-detail-overlay') closeStockDetailOverlay(); });
    $('zerodha-login-icon').addEventListener('click', () => openBrokerLogin('zerodha'));
    $('sharekhan-login-icon').addEventListener('click', () => openBrokerLogin('sharekhan'));
    $('settings-icon').addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === 'view-settings'));
    });
    $('notification-btn').addEventListener('click', openNotificationOverlay);
    $('notification-close').addEventListener('click', closeNotificationOverlay);
    $('notification-overlay').addEventListener('click', event => {
      if (event.target.id === 'notification-overlay') closeNotificationOverlay();
    });
    $('today-pnl-card').addEventListener('click', openPnlOverlay);
    $('pnl-close').addEventListener('click', closePnlOverlay);
    $('pnl-overlay').addEventListener('click', event => {
      if (event.target.id === 'pnl-overlay') closePnlOverlay();
    });
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
        if (view === 'setups' && !state.setupsLoaded && !state.setupsLoading) loadSetups();
        if (view === 'stocks' && !state.allStocks.length && !state.allStocksLoading) loadAllStocks();
      });
    });
    const updateSetupSelection = event => {
      const nextFilter = event.target.value;
      const now = Date.now();
      if (nextFilter === state.setupFilter && now - state.setupSelectionAt < 400) return;
      state.setupFilter = nextFilter;
      state.setupSelectionAt = now;
      localStorage.setItem('intradayx.mobile.setupFilter', state.setupFilter);
      renderSetups();
      loadSetups();
    };
    $('setup-filter-select')?.addEventListener('input', updateSetupSelection);
    $('setup-filter-select')?.addEventListener('change', updateSetupSelection);
    $('setup-refresh-btn')?.addEventListener('click', event => {
      event.preventDefault();
      loadSetups();
    });
    $('all-stock-filter-select')?.addEventListener('change', event => {
      state.allStockFilter = event.target.value;
      state.allStockPage = 1;
      localStorage.setItem('intradayx.mobile.allStockFilter', state.allStockFilter);
      renderAllStocks();
    });
    $('all-stock-search')?.addEventListener('input', event => {
      state.allStockSearch = event.target.value;
      state.allStockPage = 1;
      renderAllStocks();
    });
    $('all-stock-prev')?.addEventListener('click', () => {
      state.allStockPage -= 1;
      renderAllStocks();
    });
    $('all-stock-next')?.addEventListener('click', () => {
      state.allStockPage += 1;
      renderAllStocks();
    });
    $('manual-symbol')?.addEventListener('input', event => populateManualEntry(event.target.value));
    $('manual-symbol')?.addEventListener('change', event => populateManualEntry(event.target.value));

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
      const detailButton = event.target.closest('[data-detail-symbol]');
      if (detailButton) {
        event.stopPropagation();
        await openStockDetailOverlay(detailButton.dataset.detailSymbol);
        return;
      }
      const allTradeButton = event.target.closest('[data-all-trade]');
      if (allTradeButton) {
        event.stopPropagation();
        const lockedTrade = openTradeForSymbol(allTradeButton.dataset.allTrade);
        if (lockedTrade) {
          setStatus(`${lockedTrade.symbol} is locked at entry ${fmt(lockedTrade.entryPrice)}`);
          return;
        }
        const storedRow = state.allStocks.find(item => item.symbol === allTradeButton.dataset.allTrade);
        const row = storedRow ? withLiveQuote(storedRow) : null;
        if (!row || !row.price) return;
        const cap = n(state.overrides?.MAX_POSITION_EXPOSURE ?? state.settings?.MAX_POSITION_EXPOSURE) || 100000;
        try {
          await openTrade({ symbol:row.symbol, name:row.name, assetType:'stock', side:row.side, qty:Math.max(1, Math.floor(cap / row.price)), entryPrice:row.price, target:row.target || undefined, score:row.score, setupType:row.setupType, entryContext:row });
        } catch (error) { setStatus(error.message, true); }
        return;
      }
      const chartCard = event.target.closest('[data-chart-symbol]');
      if (chartCard) {
        await openCandleOverlay(chartCard.dataset.chartSymbol);
        return;
      }
      const exitBtn = event.target.closest('[data-exit]');
      if (exitBtn) {
        try { await closeTrade(exitBtn.dataset.exit, exitBtn.dataset.symbol, exitBtn.dataset.price); }
        catch (e) { setStatus(e.message, true); }
        return;
      }
      const setupBtn = event.target.closest('[data-setup]');
      if (setupBtn) {
        const lockedTrade = openTradeForSymbol(setupBtn.dataset.setup);
        if (lockedTrade) {
          setStatus(`${lockedTrade.symbol} is locked at entry ${fmt(lockedTrade.entryPrice)}`);
          return;
        }
        const c = setupBySymbol(setupBtn.dataset.setup);
        if (!c) return;
        const price = n(c.price || c.quote?.price || c.indicators?.price || c.indicators?.entryPrice);
        const qty = Math.max(1, Math.floor(100000 / Math.max(price, 1)));
        try {
          await openTrade({
            symbol: c.symbol,
            name: c.name || c.symbol,
            assetType: c.assetType || 'stock',
            side: c.side || c.signal,
            qty,
            entryPrice: price,
            target: n(c.indicators?.target || c.target) || undefined,
            stop: n(c.indicators?.stop || c.stop) || undefined,
            signal: c.signal,
            score: n(c.score),
            setupType: resolvedSetupType(c),
            setup: resolvedSetupType(c),
            entryContext: c,
          });
        } catch (e) { setStatus(e.message, true); }
      }
    });

    $('broker-mode-select').addEventListener('change', async event => {
      const select = event.target;
      const previousMode = state.brokerMode;
      const requestedMode = select.value;
      const isLiveMode = requestedMode === 'zerodha_live' || requestedMode === 'sharekhan_live';
      try {
        select.disabled = true;
        state.brokerMode = requestedMode;
        state.brokerPortfolio = { loading: true, ok: false, data: null, error: '' };
        renderHeader();
        const payload = await api('/broker-mode', {
          method: 'POST',
          headers: isLiveMode ? { 'X-Live-Trade-Confirm': 'LIVE' } : {},
          body: JSON.stringify({ mode: requestedMode, ...(isLiveMode ? { liveConfirm: 'LIVE' } : {}) }),
        });
        state.brokerMode = payload.mode || requestedMode;
        state.brokerStatus = await api('/broker-status');
        await refreshActiveBrokerPortfolio();
        renderHeader();
        if (!$('pnl-overlay')?.hidden) renderPnlOverlay();
        setStatus(`Broker mode changed to ${activeBrokerLabel()}`);
      } catch (e) {
        state.brokerMode = previousMode;
        select.value = previousMode;
        await refreshActiveBrokerPortfolio();
        renderHeader();
        setStatus(e.message, true);
      } finally {
        select.disabled = false;
      }
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
      const saveButton = $('settings-save');
      const next = {};
      for (const el of event.currentTarget.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') next[el.name] = el.checked ? 1 : 0;
        else if (String(el.value).trim() !== '') next[el.name] = Number(el.value);
      }
      if (saveButton) saveButton.disabled = true;
      setSettingsStatus('Saving settings…');
      try {
        const payload = await api('/trade-settings', { method: 'POST', body: JSON.stringify({ overrides: next }) });
        state.overrides = payload.overrides || next;
        renderSettings();
        await loadSetups();
        setSettingsStatus('Settings saved successfully', false, true);
      } catch (e) {
        setSettingsStatus(e.message || 'Could not save settings', true);
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    });

    $('settings-reset').addEventListener('click', async () => {
      setSettingsStatus('Clearing overrides…');
      try {
        const payload = await api('/trade-settings', { method: 'POST', body: JSON.stringify({ overrides: {} }) });
        state.overrides = payload.overrides || {};
        renderSettings();
        setSettingsStatus('Overrides cleared successfully', false, true);
      } catch (e) { setSettingsStatus(e.message || 'Could not clear overrides', true); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    hydrateSetupCache();
    updateManualSymbolOptions();
    window.addEventListener('message', event => {
      const data = event.data || {};
      if (!data || data.type !== 'broker-auth') return;
      if (data.ok) {
        refreshAll();
        setStatus(`${data.broker || 'Broker'} login complete`);
      } else {
        setStatus(data.message || 'Broker login failed', true);
      }
    });
    setAutoRefresh(state.autoRefreshEnabled);
    connectTradeStream();
    connectMarketOverviewStream();
    window.addEventListener('pagehide', () => {
      state.liveStream?.close();
      state.marketOverviewStream?.close();
      state.tradeStream?.close();
      state.healthStream?.close();
    });
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
