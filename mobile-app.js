(() => {
  const state = {
    bootstrap: null,
    trades: [],
    allTransactions: [],
    candidates: [],
    liveQuotes: new Map(),
    stockSummaries: {},
    settings: {},
    overrides: {},
    settingDefaults: {},
    settingDescriptions: {},
    setupDefinitions: [],
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
    serverSimulationCandidates: { loaded:false, at:'', candidates:[], combinedCandidates:[], error:'' },
    serverSimulationStream: null,
    liveStream: null,
    liveStreamKey: '',
    stockQuoteStreams: [],
    stockQuoteStreamKey: '',
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
    ipoCalendar: { listed: [], upcoming: [], updatedAt: 0, loading: false, error: "" },
    allStocks: [],
    allStocksLoading: false,
    allStockUniverse: null,
    allStockUniversePromise: null,
    allStockStreamsScheduled: false,
    allStockFilter: localStorage.getItem('intradayx.mobile.allStockFilter') || 'all',
    allStockPage: 1,
    allStockSearch: '',
    freshNews: { loading:false, loaded:false, items:[], error:'' },
    earningsResults: { loading:false, loaded:false, items:[], fromDate:'', toDate:'', selectedDate:'', error:'' },
    decisionCalendarBySymbol: {},
    decisionCalendarLoadedSymbols: new Set(),
    decisionCalendarPendingSymbols: new Set(),
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

  function signalRecoverySummary(trade = {}) {
    const observation = trade?.signalRecoveryObservation;
    if (!observation) return null;
    if (observation.status === 'pending') {
      return {
        tone:'pending',
        text:`Rangebound recovery research: watching for VWAP reclaim before the original stop through ${formatTradeTime(observation.deadlineAt) || '--'}`,
      };
    }
    if (observation.recoveredBeforeStop === true) {
      return { tone:'positive', text:'Rangebound recovery research: VWAP reclaimed before the original stop' };
    }
    const outcomes = {
      'original-stop-hit-before-reclaim':'original stop hit before VWAP reclaim',
      'no-reclaim-within-window':'no VWAP reclaim within the observation window',
    };
    return {
      tone:'negative',
      text:`Rangebound recovery research: ${outcomes[observation.outcome] || String(observation.outcome || 'did not recover before the original stop')}`,
    };
  }

  function renderSignalRecoveryObservation(trade = {}) {
    const summary = signalRecoverySummary(trade);
    return summary ? `<div class="signal-recovery-observation ${summary.tone}"><b>Shadow:</b> ${escapeHTML(summary.text)}</div>` : '';
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
      const exitPrice = n(trade.exitPrice);
      const livePrice = n(quote.price);
      const price = status === 'closed' ? exitPrice : livePrice || n(trade.entryPrice);
      const target = n(trade.target);
      const pnl = tradePnl(trade, quote);
      const pnlPct = tradePnlPct(trade, quote);
      const priceChange = Number(quote.change);
      const mode = tradeBrokerLabel(trade);
      const entryTime = formatTradeTime(tradeEntryTimestamp(trade));
      const exitTime = formatTradeTime(tradeExitTimestamp(trade));
      const entryReason = tradeEntryReason(trade);
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
          <div class="trade-cell"><span>Entry</span><button type="button" class="setup-chart-trigger trade-entry-chart-trigger" data-chart-symbol="${sym}" aria-label="Open ${sym} 5-minute candle chart" title="Open 5-minute candle chart"><strong>${fmt(trade.entryPrice)}</strong></button><em>${entryTime}</em></div>
          <div class="trade-cell"><span>${status === 'closed' ? 'Exit' : 'Price'}</span><strong>${fmt(price)}</strong><em class="${status === 'closed' ? '' : cls(priceChange)}">${status === 'closed' ? exitTime : `Change ${pct(priceChange)}`}</em>${status === 'closed' ? `<em class="mobile-trade-live">Live ${livePrice ? fmt(livePrice) : '--'}</em>` : ''}${status === 'open' ? `<em class="mobile-trade-return ${cls(pnlPct)}">P/L ${pct(pnlPct)}</em>` : `<em class="mobile-trade-return ${cls(pnl)}">P/L ${inr(pnl)}</em>`}</div>
          <div class="trade-cell"><span>Target</span><strong>${target ? fmt(target) : '--'}</strong></div>
          <div class="trade-cell"><span>P/L</span><strong class="${cls(pnl)}">${inr(pnl)}</strong><em class="${cls(pnlPct)}">${fmt(pnlPct)}%</em></div>
          <div class="trade-actions">
            ${status === 'open' ? `<button type="button" data-exit="${trade.id}" data-symbol="${sym}" data-price="${price || ''}">Exit</button>` : `<span>${escapeHTML(status || 'closed')}${exitReason ? ` - ${escapeHTML(exitReason)}` : ''}</span>`}
          </div>
          <div class="trade-reasons"><span><b>Entry reason:</b> ${escapeHTML(entryReason)}</span>${status === 'closed' ? `<span><b>Exit reason:</b> ${escapeHTML(exitReason || '--')}</span>` : ''}</div>
          ${renderSignalRecoveryObservation(trade)}
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

  function setupEventItems(candidate = {}) {
    const indicators = candidate.indicators || {};
    const categorized = indicators.eventImpacts || candidate.eventImpacts || {};
    const fallback = indicators.newsImpact || candidate.newsImpact || null;
    const items = { results:categorized.result || null, news:categorized.news || null };
    if (!items.results && !items.news && fallback) {
      const fallbackKind = /result|earnings|financial/i.test(`${fallback.type || ''} ${fallback.title || ''}`) ? 'results' : 'news';
      items[fallbackKind] = fallback;
    }
    return items;
  }

  function setupEventPresentation(kind, item) {
    if (!item) return kind === 'results'
      ? { polarity:'neutral', sentiment:'Quarterly details', icon:'📊' }
      : { polarity:'neutral', sentiment:'Unavailable', icon:'➖' };
      const verdict = String(item.resultVerdict || item.newsSentiment || '').toLowerCase();
      const score = n(item.tradeImpactScore);
      const polarity = verdict === 'positive' || (!verdict && score > 0)
        ? 'positive'
        : verdict === 'negative' || (!verdict && score < 0) ? 'negative' : 'neutral';
      const sentiment = polarity === 'positive' ? 'Positive' : polarity === 'negative' ? 'Negative' : verdict === 'mixed' ? 'Mixed' : 'Neutral';
      const icon = polarity === 'positive' ? '👍' : polarity === 'negative' ? '👎' : '➖';
    return { polarity, sentiment, icon };
  }

  function setupEventBadges(candidate = {}) {
    const symbol = String(candidate.symbol || '').toUpperCase();
    const items = setupEventItems(candidate);
    return [
      { kind:'news', item:items.news },
      { kind:'results', item:items.results },
    ].map(({ kind, item }) => {
      const label = kind === 'results' ? 'Results' : 'News';
      const conciseLabel = kind === 'results' ? 'Result' : 'News';
      const presentation = setupEventPresentation(kind, item);
      const timing = item
        ? compactDecisionAge(item.publishedAt || item.filingDate || item.eventDate || item.dateKey)
        : kind === 'results' ? nextResultTiming(symbol) : '--';
      const timingLabel = timing === '--' ? '' : ` · ${timing}`;
      const title = item?.title || (kind === 'results' ? 'Upcoming earnings result' : 'No recent news loaded');
      return `<button type="button" class="setup-event-badge ${presentation.polarity}" data-card-event-kind="${kind}" data-card-event-symbol="${symbol}" title="${escapeHTML(`${label} ${presentation.sentiment} · ${title}`)}" aria-label="Open ${label.toLowerCase()} details for ${symbol}">${conciseLabel} <span aria-hidden="true">${presentation.icon}</span>${timingLabel}</button>`;
    }).join('');
  }

  function compactDecisionAge(value) {
    const timestamp = Number.isFinite(Number(value)) ? Number(value) : Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '--';
    const ageMs = Math.max(0, Date.now() - timestamp);
    if (ageMs < 60 * 60 * 1000) return `${Math.max(1, Math.round(ageMs / 60000))}m`;
    if (ageMs < 24 * 60 * 60 * 1000) return `${Math.round(ageMs / 3600000)}h`;
    return `${Math.round(ageMs / 86400000)}d`;
  }

  function trendChip(label, trend) {
    const value = String(trend || '').toLowerCase();
    const direction = ['up', 'bullish', 'positive'].includes(value) ? 'up' : ['down', 'bearish', 'negative'].includes(value) ? 'down' : 'flat';
    return `<span class="decision-chip trend-${direction}">${label} ${direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'}</span>`;
  }

  function numericTrend(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) < 0.05) return 'flat';
    return number > 0 ? 'up' : 'down';
  }

  function nextResultTiming(symbol) {
    const event = state.decisionCalendarBySymbol[String(symbol || '').toUpperCase()]?.[0];
    const dateKey = String(event?.dateKey || event?.eventDate || '').slice(0, 10);
    if (!dateKey) return '--';
    const today = Date.parse(`${todayKey()}T00:00:00Z`);
    const eventDate = Date.parse(`${dateKey}T00:00:00Z`);
    if (!Number.isFinite(eventDate) || !Number.isFinite(today)) return '--';
    const days = Math.max(0, Math.round((eventDate - today) / 86400000));
    return days === 0 ? 'Today' : `${days}d`;
  }

  function renderSetupDecisionContext(candidate = {}) {
    const indicators = candidate.indicators || {};
    const symbol = String(candidate.symbol || '').toUpperCase();
    const price = n(candidate.price || candidate.quote?.price || indicators.price);
    const entry = n(indicators.entryPrice || indicators.entry || candidate.entryPrice);
    const side = String(candidate.side || candidate.signal || indicators.signal || '').toLowerCase();
    const directionalDistance = price > 0 && entry > 0
      ? ((side === 'sell' ? entry - price : price - entry) / entry) * 100
      : null;
    const setupType = resolvedSetupType(candidate).toUpperCase();
    const chasing = setupType === 'CHASING' || (Number.isFinite(directionalDistance) && directionalDistance > (side === 'sell' ? 0.8 : 0.6));
    const entryLabel = !Number.isFinite(directionalDistance)
      ? 'Entry --'
      : Math.abs(directionalDistance) < 0.05
        ? 'At entry'
        : directionalDistance > 0
          ? `Extended ${fmt(Math.abs(directionalDistance))}%${chasing ? ' ⚠' : ''}`
          : `To entry ${fmt(Math.abs(directionalDistance))}%`;

    const depth = indicators.marketDepth || candidate.marketDepth || {};
    const sharekhanDepth = String(depth.source || '').toLowerCase() === 'sharekhan-ws';
    const spreadPct = sharekhanDepth && Number.isFinite(Number(depth.spreadPct)) ? Number(depth.spreadPct) : null;
    const depthAge = sharekhanDepth ? compactDecisionAge(depth.capturedAtMs || depth.capturedAt) : '--';
    const spreadClass = spreadPct == null ? 'neutral' : spreadPct <= 0.1 ? 'positive' : spreadPct > 0.25 ? 'negative' : 'warn';
    const bidQuantity = sharekhanDepth ? n(depth.totalBidQuantity || depth.bestBidQuantity) : 0;
    const askQuantity = sharekhanDepth ? n(depth.totalAskQuantity || depth.bestAskQuantity) : 0;
    const depthTotal = bidQuantity + askQuantity;
    const bidShare = depthTotal > 0 ? Math.max(0, Math.min(100, bidQuantity / depthTotal * 100)) : 50;
    const heavySide = !sharekhanDepth || !depthTotal ? 'Depth unavailable' : bidShare >= 55 ? `Bid heavy ${Math.round(bidShare)}%` : bidShare <= 45 ? `Ask heavy ${Math.round(100 - bidShare)}%` : 'Balanced';
    const heavyClass = bidShare >= 55 ? 'bid-heavy' : bidShare <= 45 ? 'ask-heavy' : 'balanced';

    const fallback5m = Number.isFinite(Number(indicators.ema9)) && Number.isFinite(Number(indicators.ema20))
      ? (Number(indicators.ema9) > Number(indicators.ema20) ? 'up' : 'down')
      : indicators.superTrendDirection;
    const sectorChange = state.sectorTrend?.[candidate.sector];
    const indices = state.market?.indices || {};
    const nifty = indices.nifty50 || indices.nifty || indices.NIFTY50 || {};
    const niftyChange = nifty.change ?? nifty.changePct ?? nifty.percentChange;
    return `<div class="setup-decision-context" aria-label="Entry quality, Sharekhan spread, trend alignment and event timing">
      <div class="decision-context-row">
        <span class="decision-chip ${chasing ? 'negative' : ''}" data-entry-quality="${symbol}">${entryLabel}</span>
        <span class="decision-chip ${spreadClass}" data-depth-spread="${symbol}" title="Sharekhan live bid ${depth.bestBidPrice || '--'} · ask ${depth.bestAskPrice || '--'} · age ${depthAge}">Spread ${spreadPct == null ? '--' : `${fmt(spreadPct)}%`} ${sharekhanDepth ? `· ${depthAge}` : ''}</span>
      </div>
      <div class="depth-liquidity-range" data-depth-liquidity="${symbol}" title="Sharekhan live best bid ${depth.bestBidPrice || '--'} · best ask ${depth.bestAskPrice || '--'}">
        <span class="depth-liquidity-head"><b>Sharekhan depth</b><em class="${heavyClass}">${heavySide}</em></span>
        <span class="depth-liquidity-values"><b>Bid ${bidQuantity ? compactVolume(bidQuantity) : '--'}</b><span class="depth-liquidity-track"><i class="depth-bid" style="width:${bidShare.toFixed(1)}%"></i><i class="depth-ask" style="width:${(100 - bidShare).toFixed(1)}%"></i></span><b>Ask ${askQuantity ? compactVolume(askQuantity) : '--'}</b></span>
      </div>
      <div class="decision-context-row decision-trends">
        ${trendChip('5 min', indicators.trend5m || fallback5m)}
        ${trendChip('15 min', indicators.trend15m)}
        ${trendChip('Daily', indicators.dailyTrend)}
        ${trendChip('Sector', numericTrend(sectorChange))}
        ${trendChip('Nifty', numericTrend(niftyChange))}
      </div>
      <div class="decision-context-row decision-events" data-event-line="${symbol}">${setupEventBadges(candidate)}</div>
    </div>`;
  }

  async function loadDecisionCalendar(symbols = []) {
    const missing = [...new Set(symbols.map(symbol => String(symbol || '').toUpperCase()).filter(Boolean))]
      .filter(symbol => !state.decisionCalendarLoadedSymbols.has(symbol) && !state.decisionCalendarPendingSymbols.has(symbol));
    if (!missing.length) return;
    missing.forEach(symbol => state.decisionCalendarPendingSymbols.add(symbol));
    try {
      const payload = await api('/result-calendar', {
        method:'POST',
        body:JSON.stringify({ symbols:missing, days:30, maxSymbols:400 }),
      });
      state.decisionCalendarBySymbol = { ...state.decisionCalendarBySymbol, ...(payload.resultCalendarBySymbol || {}) };
    } catch (_) {
      // Calendar timing is supplementary; leave the card at Result -- on transient errors.
    } finally {
      missing.forEach(symbol => {
        state.decisionCalendarPendingSymbols.delete(symbol);
        state.decisionCalendarLoadedSymbols.add(symbol);
      });
      renderSetups();
      renderAllStocks();
    }
  }

  function setupCategoryLabel(candidate = {}) {
    const setupType = resolvedSetupType(candidate).toUpperCase();
    if (['EARLY_MOMENTUM', 'MOMENTUM_RUNNER', 'LONG_MOMENTUM', 'VOLUME_SHOCK_BREAKOUT'].includes(setupType)) return 'Momentum';
    if (setupType === 'GAP_AND_GO') return 'Gap and Go';
    if (setupType === 'BULL_FLAG_CONTINUATION') return 'Bull Flag';
    if (setupType === 'RANGEBOUND') return 'Rangebound Scalping';
    if (['FRESH_BREAKOUT', 'TOP_GAINER_CONTINUATION'].includes(setupType)) return 'Breakout';
    if (['TOP_GAINER_PULLBACK_RECLAIM', 'OPENING_FLUSH_VWAP_RECLAIM', 'VWAP_PULLBACK_OR_HOLD'].includes(setupType)) return 'Pullback / Reclaim';
    if (setupType === 'VWAP_TREND_CONTINUATION') return 'Trend Continuation';
    if (setupType === 'BREAKDOWN') return 'Breakdown Short';
    if (['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupType)) return 'Bear Flag Short';
    if (setupType === 'VWAP_REJECTION') return 'VWAP Rejection';
    return setupType.replace(/_/g, ' ') || 'Unclassified';
  }

  function compactVolume(value) {
    const volume = Math.max(0, n(value));
    if (!volume) return '--';
    if (volume >= 10000000) return `${fmt(volume / 10000000)}Cr`;
    if (volume >= 100000) return `${fmt(volume / 100000)}L`;
    if (volume >= 1000) return `${fmt(volume / 1000)}K`;
    return String(Math.round(volume));
  }

  function setupSpecificIndicator(candidate = {}) {
    const setupType = resolvedSetupType(candidate).toUpperCase();
    const indicators = candidate.indicators || {};
    const price = n(candidate.price || candidate.quote?.price || indicators.price);
    const dayChange = candidate.quote?.change ?? indicators.dayChange;
    const relVolume = indicators.relVolumeTimeAdjusted ?? indicators.relVolume;
    const finite = value => value != null && Number.isFinite(Number(value));
    if (setupType === 'RANGEBOUND') {
      const range = indicators.rangebound || candidate.rangebound || {};
      if (finite(range.lower) && finite(range.upper)) {
        return `Range ${fmt(range.lower)}-${fmt(range.upper)}${finite(range.rangePct) ? ` · ${fmt(range.rangePct)}% wide` : ''}`;
      }
    }
    if (setupType === 'GAP_AND_GO' && finite(indicators.gapPct ?? candidate.gapPct)) {
      const quality = String(indicators.gapQuality || candidate.gapQuality || '').replace(/-/g, ' ');
      return `Opening gap ${pct(indicators.gapPct ?? candidate.gapPct)}${quality ? ` · ${quality}` : ''}`;
    }
    if (['EARLY_MOMENTUM', 'MOMENTUM_RUNNER', 'LONG_MOMENTUM', 'VOLUME_SHOCK_BREAKOUT', 'BULL_FLAG_CONTINUATION', 'BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupType)) {
      const parts = [];
      if (finite(indicators.rsi ?? indicators.rsi7)) parts.push(`RSI ${fmt(indicators.rsi ?? indicators.rsi7)}`);
      if (finite(relVolume)) parts.push(`Rel volume ${fmt(relVolume)}x`);
      if (parts.length) return parts.join(' · ');
    }
    if (setupType === 'BREAKDOWN') {
      const levels = [
        ['Opening low', indicators.openingLow],
        ['Previous-day low', indicators.prevDayLow],
        ['5-day low', indicators.low5],
        ['20-day low', indicators.low20],
      ].filter(([, value]) => finite(value) && price < Number(value));
      if (levels.length) {
        const [label, value] = levels.sort((left, right) => Number(left[1]) - Number(right[1]))[0];
        return `Break level ${label} ${fmt(value)}`;
      }
    }
    const vwap = Number(indicators.vwap);
    if (finite(vwap) && vwap > 0 && price > 0) return `VWAP distance ${pct((price - vwap) / vwap * 100)}`;
    if (finite(dayChange)) return `Day move ${pct(dayChange)}`;
    return '';
  }

  function setup52WeekRangeContent(candidate = {}) {
    const symbol = String(candidate.symbol || '').toUpperCase();
    const summary = state.stockSummaries[symbol] || {};
    const low = Number(summary.low52 ?? candidate.low52 ?? candidate.quote?.low52);
    const high = Number(summary.high52 ?? candidate.high52 ?? candidate.quote?.high52);
    const price = n(candidate.price || candidate.quote?.price);
    const hasRange = Number.isFinite(low) && low > 0 && Number.isFinite(high) && high > low;
    const position = hasRange && price > 0
      ? Math.max(0, Math.min(100, (price - low) / (high - low) * 100))
      : 50;
    return `<span class="setup-52w-label"><small>52W Low / High</small><em>Tap for 1M trend</em></span>
      <span class="setup-52w-values"><b>${hasRange ? fmt(low) : '--'}</b><span class="setup-52w-track"><i style="left:${position.toFixed(1)}%"></i></span><b>${hasRange ? fmt(high) : '--'}</b></span>`;
  }

  function renderSetup52WeekRange(candidate = {}) {
    const symbol = String(candidate.symbol || '').toUpperCase();
    return `<button type="button" class="setup-52w-range" data-52w-symbol="${symbol}" data-sparkline-symbol="${symbol}" aria-label="Open ${symbol} one month trend">${setup52WeekRangeContent(candidate)}</button>`;
  }

  function formatOpportunityMetric(value, suffix = '', digits = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : '--';
  }

  function renderOpportunityResearch(candidate = {}) {
    const observation = candidate?.shadowSetupObservations?.TOP_GAINER_CONTROLLED_RETEST || null;
    const indicators = candidate?.leaderIndicators || candidate?.indicators || {};
    const matched = observation?.matched === true || observation?.ok === true;
    const status = !observation ? 'Unavailable' : matched ? 'Matched' : 'Watching';
    const statusClass = matched ? 'matched' : 'watching';
    const reason = observation?.reason || (matched
      ? 'All controlled-retest shadow conditions match'
      : 'Controlled-retest shadow observation is unavailable for this snapshot');
    const metrics = [
      ['Top-5 persistence', formatOpportunityMetric(indicators.leaderRankPersistencePct30m, '%')],
      ['Rank stability', formatOpportunityMetric(indicators.leaderRankStability30m, '', 3)],
      ['High retest', formatOpportunityMetric(indicators.recentHighRetestPct, '%', 3)],
      ['EMA spread slope', formatOpportunityMetric(indicators.emaSpreadSlope3Bars, '', 3)],
      ['Trigger extension', formatOpportunityMetric(indicators.triggerExtensionAtr, ' ATR', 3)],
      ['Re-accelerating', indicators.leaderReacceleration === true ? 'Yes' : indicators.leaderReacceleration === false ? 'No' : '--'],
    ];
    const rejectionReasons = [...new Set([
      ...(Array.isArray(candidate.rejectionReasons) ? candidate.rejectionReasons : []),
      ...(Array.isArray(candidate.eligibilityReasons) ? candidate.eligibilityReasons : []),
      candidate.blockReason,
    ].map(value => String(value || '').trim()).filter(Boolean))];
    return `<div class="opportunity-research-panel">
      <div class="opportunity-research-head"><span class="opportunity-status ${statusClass}">Controlled Retest: ${escapeHTML(status)}</span><span class="opportunity-shadow-badge">Shadow only</span></div>
      <p class="opportunity-research-reason">${escapeHTML(reason)}</p>
      <div class="opportunity-metrics">${metrics.map(([label, value]) => `<span><small>${escapeHTML(label)}</small><b>${escapeHTML(value)}</b></span>`).join('')}</div>
      <div class="opportunity-rejections"><b>Selection / capacity evidence</b>${rejectionReasons.length
        ? `<ol>${rejectionReasons.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ol>`
        : '<p>No rejection recorded; candidate is inside current selection capacity.</p>'}</div>
    </div>`;
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
    const filters = {
      opportunity_research: () => true,
      simulation_top25: () => true,
      combined_top: () => true,
      tradeable: isTradeable,
      gainers: c => changeOf(c) > 0,
      losers: c => changeOf(c) < 0,
      favorites: c => favorites.has(String(c.symbol || '').toUpperCase()),
      runners: c => statusOf(c) === 'triggered' && runnerTypes.has(setupOf(c)),
      rangebound: c => setupOf(c) === 'RANGEBOUND',
      opening_flush: c => setupOf(c) === 'OPENING_FLUSH_VWAP_RECLAIM',
      top_gainer_pullback: c => setupOf(c) === 'TOP_GAINER_PULLBACK_RECLAIM',
      top_gainer_continuation: c => setupOf(c) === 'TOP_GAINER_CONTINUATION',
      gap_and_go: c => setupOf(c) === 'GAP_AND_GO',
      bull_flag: c => setupOf(c) === 'BULL_FLAG_CONTINUATION',
      vwap_continuation: c => setupOf(c) === 'VWAP_TREND_CONTINUATION',
      breakdown: c => setupOf(c) === 'BREAKDOWN',
      bear_flags: c => ['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'].includes(setupOf(c)),
      vwap_rejection: c => setupOf(c) === 'VWAP_REJECTION',
      vwap_pullback: c => setupOf(c) === 'VWAP_PULLBACK_OR_HOLD',
      best_pullbacks: c => isTradeable(c) && setupOf(c) === 'VWAP_PULLBACK_OR_HOLD',
    };
    const sorters = {
      opportunity_research: (a, b) => n(a.serverRank) - n(b.serverRank),
      simulation_top25: (a, b) => n(a.serverRank) - n(b.serverRank),
      combined_top: (a, b) => n(a.combinedRank) - n(b.combinedRank),
      gainers: (a, b) => changeOf(b) - changeOf(a) || Math.abs(n(b.score)) - Math.abs(n(a.score)),
      losers: (a, b) => changeOf(a) - changeOf(b) || Math.abs(n(b.score)) - Math.abs(n(a.score)),
      favorites: (a, b) => Math.abs(n(b.score)) - Math.abs(n(a.score)),
    };
    const setupPriority = setup => ({
      OPENING_FLUSH_VWAP_RECLAIM: 0,
      TOP_GAINER_PULLBACK_RECLAIM: 0,
      TOP_GAINER_CONTINUATION: 0,
      GAP_AND_GO: 0,
      BULL_FLAG_CONTINUATION: 0,
      EARLY_MOMENTUM: 0,
      MOMENTUM_RUNNER: 0,
      RANGEBOUND: 1,
      VWAP_TREND_CONTINUATION: 1,
      BREAKDOWN: 1,
      BEAR_FLAG_CONTINUATION: 1,
      TOP_LOSER_BEAR_FLAG: 1,
      VWAP_PULLBACK_OR_HOLD: 2,
      VWAP_REJECTION: 2,
      FRESH_BREAKOUT: 3,
      VOLUME_SHOCK_BREAKOUT: 4,
      LONG_MOMENTUM: 5,
    })[setupOf(setup)] ?? 9;
    const priorityScoreSort = (a, b) => setupPriority(a) - setupPriority(b) || Math.abs(n(b.score)) - Math.abs(n(a.score));
    const activeFilter = filters[state.setupFilter] ? state.setupFilter : 'tradeable';
    const serverFilter = ['simulation_top25', 'combined_top', 'opportunity_research'].includes(activeFilter);
    const researchFilter = activeFilter === 'opportunity_research';
    const setupCandidates = activeFilter === 'combined_top'
      ? state.serverSimulationCandidates.combinedCandidates
      : ['simulation_top25', 'opportunity_research'].includes(activeFilter)
        ? state.serverSimulationCandidates.candidates
        : state.candidates;
    const cards = setupCandidates
      .map(withLiveQuote)
      .filter(filters[activeFilter])
      .sort(sorters[activeFilter] || priorityScoreSort)
      .slice(0, serverFilter ? 25 : 24);
    const selector = $('setup-filter-select');
    if (selector) selector.value = activeFilter;
    const serverSnapshotTime = serverFilter && state.serverSimulationCandidates.at
      ? formatTradeTime(state.serverSimulationCandidates.at)
      : '';
    const serverReasonLabel = activeFilter === 'combined_top' ? 'Profitability ranking' : 'Entry selection';
    setText('setup-count', `${cards.length} shown${serverSnapshotTime ? ` · ${serverSnapshotTime}` : ''}`);
    $('setup-list').innerHTML = cards.length ? cards.map((c, index) => {
      const sym = String(c.symbol || '').toUpperCase();
      const price = n(c.price || c.quote?.price);
      const target = n(c.indicators?.target || c.target);
      const change = n(c.quote?.change ?? c.indicators?.dayChange);
      const side = String(c.side || c.signal || '').toLowerCase();
      const canTrade = !researchFilter && ['buy', 'sell'].includes(side);
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
      const pendingReason = c.combinedWatchReason || c.blockReason || (Array.isArray(c.eligibilityReasons) ? c.eligibilityReasons[0] : '') || '';
      const reason = serverFilter
        ? (activeFilter === 'combined_top'
          ? `${c.profitabilityReason || ''}${pendingReason ? ` | Watching: ${pendingReason}` : ' | Entry ready'}`
          : c.selectionReason)
        : c.blockReason || (Array.isArray(c.eligibilityReasons) ? c.eligibilityReasons[0] : '') || (Array.isArray(indicators.reasons) ? indicators.reasons[0] : '');
      const health = state.healthScores[sym];
      const healthLabel = Number.isFinite(Number(health)) ? `${health}/100` : 'Loading…';
      const profitability = c.profitability || {};
      const profitabilityLabel = Number.isFinite(Number(profitability.winRate))
        ? `${fmt(profitability.winRate)}% win · ${n(profitability.sample)} trades`
        : `Decision ${fmt(c.decisionScore ?? c.score)}`;
      const decisionContext = renderSetupDecisionContext(c);
      const setupCategory = setupCategoryLabel(c);
      const setupIndicator = setupSpecificIndicator(c);
      return `
        <article class="setup-card ${c.selected ? 'selected' : ''} ${lockedTrade ? 'is-locked' : ''} ${opening ? 'is-opening' : ''}">
          <div class="setup-head">
            <div>
              <button type="button" class="stock-detail-link setup-symbol-link" data-detail-symbol="${sym}" title="Open ${sym} stock details" aria-label="Open ${sym} stock details"><strong>${sym}</strong></button>
              <span>${activeFilter === 'combined_top' ? `Combined #${n(c.combinedRank) || index + 1}` : researchFilter ? `Research #${n(c.serverRank) || index + 1}` : activeFilter === 'simulation_top25' ? `Server #${n(c.serverRank) || index + 1}` : `#${index + 1} priority`}</span>
              <span>${resolvedSetupType(c)} · ${side.toUpperCase()} · ${Math.abs(n(c.score))}</span>
            </div>
            <button type="button" ${disabled} data-setup="${sym}">${opening ? 'Opening…' : lockedTrade ? 'Locked' : canTrade ? 'Trade' : 'Watch'}</button>
          </div>
          ${lockedTrade ? `<div class="stock-lock broker-status--${brokerState}"><b>Locked · Entry ${fmt(lockedTrade.entryPrice)}</b><span>${escapeHTML(brokerStatusLabel(lockedTrade.broker || { status:'open' }))}</span></div>` : ''}
          <div class="setup-trade-row">
            <button type="button" class="setup-chart-trigger" data-chart-symbol="${sym}" aria-label="Open ${sym} 5 or 15 minute intraday chart" title="Open 5/15 min intraday chart">
              <small>Price / Change</small><b>${fmt(price)} <em class="${cls(change)}">${pct(change)}</em></b>
            </button>
            <span><small>Target</small><b>${target ? fmt(target) : '--'}</b></span>
            <span><small>Score</small><b>${Math.abs(n(c.score))}</b></span>
            <span title="Volume ${volume ? volume.toLocaleString('en-IN') : '--'}"><small>Volume</small><b>${compactVolume(volume)}</b></span>
          </div>
          ${renderSetup52WeekRange(c)}
          ${decisionContext}
          <div class="setup-metrics">
            <span>Status <b>${status}</b></span>
            <span>Category <b>${escapeHTML(setupCategory)}</b></span>
            <span>Entry <b>${fmt(entry)}</b></span>
            <span>Stop <b>${stop ? fmt(stop) : '--'}</b></span>
            <span>R:R <b>${rr ? fmt(rr) : '--'}</b></span>
            <span>VWAP <b>${vwap ? fmt(vwap) : '--'}</b></span>
            <span>Sector <b>${c.sector || '--'}</b></span>
            <span>Net potential <b>${Number.isFinite(Number(c.cost?.netPct)) ? `${fmt(c.cost.netPct)}%` : '--'}</b></span>
            ${activeFilter === 'combined_top' ? `<span>Profitability <b>${escapeHTML(profitabilityLabel)}</b></span>` : ''}
            <span>Health <b data-health-symbol="${sym}" class="${Number(health) >= 80 ? 'positive' : Number.isFinite(Number(health)) && Number(health) < 50 ? 'negative' : ''}">${healthLabel}</b></span>
          </div>
          ${serverFilter || reason || setupIndicator ? `<p class="setup-reason ${serverFilter && c.selected ? 'selected' : ''}">${serverFilter ? `<b>${researchFilter ? 'Opportunity research' : serverReasonLabel}:</b> ${escapeHTML(reason || '--')}` : escapeHTML(reason || '')}${setupIndicator ? `<span class="setup-specific-indicator">${reason || serverFilter ? ' · ' : ''}${escapeHTML(setupIndicator)}</span>` : ''}</p>` : ''}
          ${researchFilter ? renderOpportunityResearch(c) : ''}
        </article>
      `;
    }).join('') : `<div class="empty">${serverFilter && state.serverSimulationCandidates.error
      ? escapeHTML(state.serverSimulationCandidates.error)
      : researchFilter ? 'No opportunity research candidates available' : 'No actionable setups'}</div>`;
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
        state.stockSummaries[symbol] = message.data;
        const candidate = cards.find(c => String(c.symbol || '').toUpperCase() === symbol);
        document.querySelectorAll(`[data-52w-symbol="${symbol}"]`).forEach(range => {
          range.innerHTML = setup52WeekRangeContent(candidate || { symbol });
        });
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

  async function loadMobileIpoCalendar() {
    if (state.ipoCalendar.loading) return;
    state.ipoCalendar.loading = true;
    renderAllStocks();
    try {
      const data = await api('/ipo-calendar');
      state.ipoCalendar = { ...data, listed: Array.isArray(data.listed) ? data.listed : [], upcoming: Array.isArray(data.upcoming) ? data.upcoming : [], loading: false };
    } catch (error) {
      state.ipoCalendar.loading = false;
      state.ipoCalendar.error = error.message || 'IPO feed unavailable';
    }
    renderAllStocks();
  }

  function mobileIpoRows(mode) {
    const today = todayKey();
    return (mode === 'new-ipo' ? state.ipoCalendar.listed : state.ipoCalendar.upcoming).filter(row => mode === 'new-ipo'
      ? row.listingDate && row.listingDate <= today && Date.now() - Date.parse(row.listingDate) < 90 * 86400000
      : row.closeDate >= today || row.listingDate > today);
  }

  function renderUpcomingIpoCard(row) {
    return `<article class="setup-card ipo-calendar-card">
      <div class="setup-head"><div><strong>${escapeHTML(row.name || row.sym)}</strong><span>${escapeHTML(row.sym || 'Symbol not provided')}</span></div></div>
      <p>Upcoming IPO · Informational · Not tradeable until listed</p>
      <div class="setup-metrics">${[['Opens', row.openDate], ['Closes', row.closeDate], ['Expected listing', row.listingDate || 'Not provided by NSE'], ['Issue price', row.price]].map(([label, value]) => `<span>${label} <b>${escapeHTML(value || '—')}</b></span>`).join('')}</div>
    </article>`;
  }

  function allStockRows() {
    const favoriteRows = state.bootstrap?.prefs?.stockFavorites || [];
    const favorites = new Set((Array.isArray(favoriteRows) ? favoriteRows : Object.keys(favoriteRows || {})).map(item => String(item?.sym || item?.symbol || item || '').toUpperCase()));
    const query = state.allStockSearch.trim().toUpperCase();
    if (state.allStockFilter === 'upcoming-ipo') return mobileIpoRows('upcoming-ipo').filter(row => !query || String(row.sym || '').toUpperCase().includes(query) || String(row.name || '').toUpperCase().includes(query));
    const rows = state.allStocks.map(withLiveQuote).filter(row => !query || row.symbol.includes(query) || String(row.name || '').toUpperCase().includes(query));
    if (state.allStockFilter === 'new-ipo') {
      const listed = new Set(mobileIpoRows('new-ipo').map(row => row.sym));
      return rows.filter(row => listed.has(row.symbol));
    }
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
    const ipoMode = ['new-ipo', 'upcoming-ipo'].includes(state.allStockFilter);
    const notice = $('all-stock-ipo-status');
    if (notice) {
      notice.hidden = !ipoMode;
      notice.textContent = ipoMode ? `${state.ipoCalendar.loading ? 'Loading IPO calendar…' : state.ipoCalendar.error ? 'IPO feed unavailable or incomplete. Cached entries shown where available.' : state.ipoCalendar.updatedAt ? 'NSE · Updated ' + new Date(state.ipoCalendar.updatedAt).toLocaleString() : 'IPO calendar not loaded.'} ${state.allStockFilter === 'new-ipo' ? 'New listings in the last 90 days, limited to subscribed stocks; may include non-IPO listings.' : 'Upcoming issues are informational and not tradeable until listed.'}` : '';
    }
    if (state.allStocksLoading && !state.allStocks.length && !ipoMode) {
      list.innerHTML = '<div class="empty">Loading stock profiles…</div>';
      setText('all-stock-count', 'Loading');
      return;
    }
    const rows = allStockRows();
    const pages = Math.max(1, Math.ceil(rows.length / 10));
    state.allStockPage = Math.min(Math.max(1, state.allStockPage), pages);
    const pageRows = rows.slice((state.allStockPage - 1) * 10, state.allStockPage * 10);
    setText('all-stock-count', `${rows.length} ${state.allStockFilter === 'upcoming-ipo' ? 'IPOs' : 'stocks'}${state.allStocksLoading ? ' · updating' : ''}`);
    setText('all-stock-page', `Page ${state.allStockPage} / ${pages}`);
    const prev = $('all-stock-prev');
    const next = $('all-stock-next');
    if (prev) prev.disabled = state.allStockPage <= 1;
    if (next) next.disabled = state.allStockPage >= pages;
    const selector = $('all-stock-filter-select');
    if (selector) selector.value = state.allStockFilter;
    list.innerHTML = pageRows.length ? pageRows.map((row, index) => {
      if (state.allStockFilter === 'upcoming-ipo') return renderUpcomingIpoCard(row);
      const health = state.healthScores[row.symbol];
      const healthLabel = Number.isFinite(Number(health)) ? `${health}/100` : 'Loading…';
      const side = String(row.side || row.signal || '').toLowerCase();
      const canTrade = ['buy', 'sell'].includes(side) && row.price > 0;
      const lockedTrade = openTradeForSymbol(row.symbol);
      const brokerState = String(lockedTrade?.broker?.status || 'open').toLowerCase();
      const opening = state.pendingTradeSymbols.has(row.symbol);
      const disabled = lockedTrade || opening || !canTrade ? 'disabled' : '';
      const indicators = row.indicators || {};
      const target = n(indicators.target || row.target);
      const entry = n(indicators.entryPrice || indicators.entry || row.price);
      const stop = n(indicators.stop || indicators.stopLoss || indicators.sl);
      const vwap = n(indicators.vwap);
      const volume = n(indicators.volume || indicators.dayVolume || row.quote?.volume || row.volume);
      const rr = n(indicators.rr || indicators.riskReward);
      const status = indicators.entryStatus || row.entryStatus || (canTrade ? 'Ready' : 'Watching');
      const reason = row.blockReason || (Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons[0] : '') || (Array.isArray(indicators.reasons) ? indicators.reasons[0] : '');
      const decisionContext = renderSetupDecisionContext(row);
      const setupCategory = setupCategoryLabel(row);
      const setupIndicator = setupSpecificIndicator(row);
      const setupType = resolvedSetupType(row);
      const absoluteRank = (state.allStockPage - 1) * 10 + index + 1;
      return `<article class="setup-card all-stock-card ${lockedTrade ? 'is-locked' : ''} ${opening ? 'is-opening' : ''}">
        <div class="setup-head">
          <div>
            <button type="button" class="stock-detail-link setup-symbol-link" data-detail-symbol="${row.symbol}" title="Open ${row.symbol} stock details" aria-label="Open ${row.symbol} stock details"><strong>${row.symbol}</strong></button>
            <span>#${absoluteRank} All Stocks</span>
            <span>${escapeHTML(setupType)} · ${side ? side.toUpperCase() : 'WATCH'} · ${Math.abs(n(row.score))}</span>
          </div>
          <button type="button" ${disabled} data-all-trade="${row.symbol}">${opening ? 'Opening…' : lockedTrade ? 'Locked' : canTrade ? 'Trade' : 'Watch'}</button>
        </div>
        ${lockedTrade ? `<div class="stock-lock broker-status--${brokerState}"><b>Locked · Entry ${fmt(lockedTrade.entryPrice)}</b><span>${escapeHTML(brokerStatusLabel(lockedTrade.broker || { status:'open' }))}</span></div>` : ''}
        <div class="setup-trade-row">
          <button type="button" class="setup-chart-trigger" data-chart-symbol="${row.symbol}" aria-label="Open ${row.symbol} 5 or 15 minute intraday chart" title="Open 5/15 min intraday chart">
            <small>Price / Change</small><b>${row.price ? fmt(row.price) : '--'} <em class="${cls(row.change)}">${pct(row.change)}</em></b>
          </button>
          <span><small>Target</small><b>${target ? fmt(target) : '--'}</b></span>
          <span><small>Score</small><b>${Math.abs(n(row.score))}</b></span>
          <span title="Volume ${volume ? volume.toLocaleString('en-IN') : '--'}"><small>Volume</small><b>${compactVolume(volume)}</b></span>
        </div>
        ${renderSetup52WeekRange(row)}
        ${decisionContext}
        <div class="setup-metrics">
          <span>Status <b>${escapeHTML(status)}</b></span>
          <span>Category <b>${escapeHTML(setupCategory)}</b></span>
          <span>Entry <b>${fmt(entry)}</b></span>
          <span>Stop <b>${stop ? fmt(stop) : '--'}</b></span>
          <span>R:R <b>${rr ? fmt(rr) : '--'}</b></span>
          <span>VWAP <b>${vwap ? fmt(vwap) : '--'}</b></span>
          <span>Sector <b>${escapeHTML(row.sector || '--')}</b></span>
          <span>Net potential <b>${Number.isFinite(Number(row.cost?.netPct)) ? `${fmt(row.cost.netPct)}%` : '--'}</b></span>
          <span>Health <b data-health-symbol="${row.symbol}" class="${Number(health) >= 80 ? 'positive' : Number.isFinite(Number(health)) && Number(health) < 50 ? 'negative' : ''}">${healthLabel}</b></span>
        </div>
        ${reason || setupIndicator ? `<p class="setup-reason">${escapeHTML(reason || '')}${setupIndicator ? `<span class="setup-specific-indicator">${reason ? ' · ' : ''}${escapeHTML(setupIndicator)}</span>` : ''}</p>` : ''}
      </article>`;
    }).join('') : '<div class="empty">No stocks match this profile</div>';
    syncDirectionalActionLabels();
  }

  function readCachedAllStockUniverse() {
    try {
      const cached = JSON.parse(localStorage.getItem('intradayx.mobile.stockUniverse') || 'null');
      return Array.isArray(cached?.stocks) && cached.stocks.length ? cached : null;
    } catch (_) {
      return null;
    }
  }

  function preloadAllStockUniverse() {
    if (state.allStockUniversePromise) return state.allStockUniversePromise;
    state.allStockUniversePromise = api('/mobile-stock-universe').then(universe => {
      state.allStockUniverse = universe;
      try {
        localStorage.setItem('intradayx.mobile.stockUniverse', JSON.stringify({
          savedAt:Date.now(),
          stocks:Array.isArray(universe.stocks) ? universe.stocks : [],
        }));
      } catch (_) {}
      return universe;
    }).finally(() => {
      state.allStockUniversePromise = null;
    });
    return state.allStockUniversePromise;
  }

  function populateAllStocks(universe = {}) {
    const source = Array.isArray(universe.stocks) ? universe.stocks : [];
    const meta = new Map(source.map(item => {
      const symbol = String(item?.sym || item?.symbol || item || '').toUpperCase();
      return [symbol, typeof item === 'object' ? item : { symbol }];
    }).filter(([symbol]) => symbol));
    const candidates = new Map(state.candidates.map(candidate => [String(candidate.symbol || '').toUpperCase(), candidate]));
    state.allStocks = [...meta.keys()].map(symbol => {
      const candidate = candidates.get(symbol) || {};
      const live = state.liveQuotes.get(symbol) || {};
      const quote = {
        ...(candidate.quote || {}),
        price:n(live.price || candidate.price || candidate.quote?.price),
        change:live.dayChange ?? live.change ?? candidate.quote?.change ?? candidate.indicators?.dayChange,
      };
      return {
        ...candidate,
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
  }

  function scheduleAllStockStreams() {
    if (state.allStockStreamsScheduled) return;
    state.allStockStreamsScheduled = true;
    // Two animation frames guarantee the initial table reaches the screen before
    // opening the live and chunked quote subscriptions.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      state.allStockStreamsScheduled = false;
      if (!state.allStocks.length) return;
      connectHealthStream(state.allStocks);
      connectAllStockQuoteStream();
      connectLiveStream();
      updateManualSymbolOptions();
    }));
  }

  function connectAllStockQuoteStream() {
    if (!window.EventSource) return;
    const symbols = state.allStocks.map(row => String(row.symbol || '').toUpperCase()).filter(Boolean);
    if (!symbols.length) return;
    const key = symbols.join(',');
    if (state.stockQuoteStreams.length && state.stockQuoteStreamKey === key) return;
    state.stockQuoteStreams.forEach(stream => stream.close());
    state.stockQuoteStreams = [];
    state.stockQuoteStreamKey = key;
    for (let offset = 0; offset < symbols.length; offset += 300) {
      const chunk = symbols.slice(offset, offset + 300);
      const stream = new EventSource(`/stream/mobile-stock-quotes?symbols=${encodeURIComponent(chunk.join(','))}`);
      state.stockQuoteStreams.push(stream);
      stream.onmessage = event => {
        try {
          const payload = JSON.parse(event.data || '{}');
          for (const [rawSymbol, quote] of Object.entries(payload.quotes || {})) {
            const symbol = String(rawSymbol).toUpperCase();
            const row = state.allStocks.find(item => item.symbol === symbol);
            if (!row || !quote) continue;
            const price = n(quote.price || row.price);
            const change = n(quote.change ?? quote.changePct ?? quote.percentChange ?? row.change);
            row.price = price;
            row.change = change;
            row.quote = { ...(row.quote || {}), ...quote, price, change };
            const previousLive = state.liveQuotes.get(symbol) || {};
            state.liveQuotes.set(symbol, { ...previousLive, ...quote, price, change, dayChange:change });
          }
          renderAllStocks();
          if (payload.done) {
            stream.close();
            state.stockQuoteStreams = state.stockQuoteStreams.filter(item => item !== stream);
          }
        } catch (_) {}
      };
      stream.onerror = () => {
        stream.close();
        state.stockQuoteStreams = state.stockQuoteStreams.filter(item => item !== stream);
      };
    }
  }

  async function loadAllStocks() {
    if (state.allStocksLoading) return;
    state.allStocksLoading = true;
    void loadMobileIpoCalendar();
    renderAllStocks();
    try {
      // A cached or prefetched universe makes the first table paint synchronous.
      if (state.allStockUniverse?.stocks?.length) {
        populateAllStocks(state.allStockUniverse);
        renderAllStocks();
        scheduleAllStockStreams();
      }

      const universe = await preloadAllStockUniverse();
      populateAllStocks(universe);
      renderAllStocks();
      scheduleAllStockStreams();
      void loadDecisionCalendar(state.allStocks.map(row => row.symbol));

      // EventSource is unavailable in a few embedded/legacy browsers. Keep the
      // previous bulk request only as a compatibility fallback for those clients.
      const symbols = state.allStocks.map(row => row.symbol);
      if (!window.EventSource && symbols.length) {
        const market = await api(`/dashboard-market?symbols=${encodeURIComponent(symbols.join(','))}`);
        for (const row of state.allStocks) {
          const quote = market.quotes?.[row.symbol];
          if (!quote) continue;
          row.quote = { ...(row.quote || {}), ...quote };
          row.price = n(quote.price || row.price);
          row.change = n(quote.change ?? row.change);
        }
        renderAllStocks();
      }
    } catch (error) {
      setStatus(error.message || 'Could not load all stocks', true);
    } finally {
      state.allStocksLoading = false;
      renderAllStocks();
      updateManualSymbolOptions();
      connectLiveStream();
    }
  }

  function formatMobileSetupSettingLabel(key, definition) {
    const prefix = [...(definition?.settingPrefixes || [])]
      .sort((left, right) => right.length - left.length)
      .find(candidate => key.startsWith(candidate));
    const clean = String(prefix ? key.slice(prefix.length) : key)
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, letter => letter.toUpperCase())
      .replace(/\bPct\b/g, '%')
      .replace(/\bVwap\b/g, 'VWAP')
      .replace(/\bRsi\b/g, 'RSI')
      .replace(/\bRs\b/g, 'RS')
      .replace(/\bAtr\b/g, 'ATR');
    return /MAX_POSITION_EXPOSURE$/.test(key) ? `${clean} (₹)` : clean;
  }

  function renderMobileSetupSettings() {
    const container = $('mobile-setup-settings-list');
    if (!container) return;
    const defaults = state.settingDefaults || {};
    const descriptions = state.settingDescriptions || {};
    const definitions = Array.isArray(state.setupDefinitions) ? state.setupDefinitions : [];
    if (!definitions.length || !Object.keys(defaults).length) {
      container.innerHTML = '<div class="empty">Setup configuration unavailable</div>';
      return;
    }
    const claimedKeys = new Set();
    const sections = definitions.map((definition, index) => {
      const prefixes = definition.settingPrefixes || [];
      const excludedPrefixes = definition.excludePrefixes || [];
      const configurationKeys = Object.keys(defaults).filter(key => (
        key !== definition.key &&
        !claimedKeys.has(key) &&
        prefixes.some(prefix => key.startsWith(prefix)) &&
        !excludedPrefixes.some(prefix => key.startsWith(prefix))
      ));
      configurationKeys.forEach(key => claimedKeys.add(key));
      claimedKeys.add(definition.key);
      const keys = [definition.key, ...configurationKeys];
      const fields = keys.map(key => {
        const defaultValue = defaults[key];
        const value = state.overrides?.[key] ?? state.settings?.[key] ?? defaultValue;
        const overridden = Object.prototype.hasOwnProperty.call(state.overrides || {}, key);
        const label = key === definition.key ? `Enable ${definition.label}` : formatMobileSetupSettingLabel(key, definition);
        const description = key === definition.key ? definition.description : descriptions[key];
        const kind = typeof defaultValue === 'boolean' ? 'boolean' : (typeof defaultValue === 'number' || defaultValue == null ? 'number' : 'text');
        const defaultAttribute = defaultValue == null ? '' : String(defaultValue);
        const checked = value === true || value === 1 || value === '1' || value === 'true';
        const numberAttributes = kind === 'number' && /MAX_POSITION_EXPOSURE$/.test(key)
          ? 'step="1000" min="10000" inputmode="numeric"'
          : (kind === 'number' ? 'step="any"' : '');
        const control = kind === 'boolean'
          ? `<input name="${escapeHTML(key)}" type="checkbox" data-setup-setting="true" data-setting-kind="boolean" data-default="${escapeHTML(defaultAttribute)}" ${checked ? 'checked' : ''}>`
          : `<input name="${escapeHTML(key)}" type="${kind}" data-setup-setting="true" data-setting-kind="${kind}" data-default="${escapeHTML(defaultAttribute)}" ${numberAttributes} value="${value == null ? '' : escapeHTML(String(value))}">`;
        return `
          <label class="${kind === 'boolean' ? 'check-row mobile-setup-toggle' : ''}">
            <span>${escapeHTML(label)}${overridden ? '<em class="mobile-setting-override">custom</em>' : ''}</span>
            ${control}
            ${description ? `<small>${escapeHTML(description)}</small>` : ''}
          </label>`;
      }).join('');
      return `
        <details class="mobile-setup-settings" ${index === 0 ? 'open' : ''}>
          <summary><span>${escapeHTML(definition.label)}</span><small>${escapeHTML(definition.side || '')} · ${keys.length} settings</small></summary>
          <div class="mobile-setup-description">${escapeHTML(definition.description || '')}</div>
          <div class="mobile-setup-settings-grid">${fields}</div>
        </details>`;
    });
    container.innerHTML = sections.join('');
  }

  function applyTradeSettingsPayload(payload = {}) {
    state.overrides = payload.overrides || {};
    state.settings = payload.effective || payload.defaults || state.settings;
    state.settingDefaults = payload.defaults || state.settingDefaults;
    state.settingDescriptions = payload.descriptions || state.settingDescriptions;
    state.setupDefinitions = payload.setupDefinitions || state.setupDefinitions;
  }

  function renderSettings() {
    setText('settings-state', Object.keys(state.overrides || {}).length ? 'Overrides active' : 'Defaults');
    renderMobileSetupSettings();
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

  function mergeLiveCandidateRecord(current = {}, value = {}, symbol = '') {
    const price = n(value.price || current.price || current.quote?.price);
    return {
      ...current,
      price,
      score: Number.isFinite(Number(value.score)) ? Number(value.score) : current.score,
      side: value.side || value.signal || current.side,
      derivedSetupType: value.derivedSetupType || current.derivedSetupType,
      setupType: resolvedSetupType({ ...current, ...value }),
      quote: {
        ...(current.quote || {}),
        price,
        change:value.dayChange ?? value.change ?? value.changePct ?? value.percentChange ?? current.quote?.change,
      },
      indicators: { ...(current.indicators || {}), ...value, price },
      symbol: current.symbol || symbol,
    };
  }

  function mergeLiveCandidates(payload = {}) {
    const live = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const bySymbol = new Map(state.candidates.map((candidate, index) => [String(candidate.symbol || '').toUpperCase(), index]));
    const liveBySymbol = new Map();
    let changed = false;
    for (const [rawSymbol, value] of Object.entries(live)) {
      if (!value || typeof value !== 'object') continue;
      const symbol = String(rawSymbol).toUpperCase();
      liveBySymbol.set(symbol, value);
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
        allStock.change = n(value.dayChange ?? value.change ?? value.changePct ?? value.percentChange ?? allStock.change);
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
      state.candidates[index] = mergeLiveCandidateRecord(current, value, symbol);
      changed = true;
    }
    if (liveBySymbol.size) {
      const mergeServerRows = rows => rows.map(current => {
        const symbol = String(current.symbol || '').toUpperCase();
        const value = liveBySymbol.get(symbol);
        return value ? mergeLiveCandidateRecord(current, value, symbol) : current;
      });
      state.serverSimulationCandidates = {
        ...state.serverSimulationCandidates,
        candidates:mergeServerRows(state.serverSimulationCandidates.candidates),
        combinedCandidates:mergeServerRows(state.serverSimulationCandidates.combinedCandidates),
      };
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
    const trackedTradeSymbols = state.trades
      .filter(trade => String(trade.status || '').toLowerCase() === 'open' || isToday(trade))
      .map(trade => String(trade.symbol || '').toUpperCase());
    const brokerPositionSymbols = (state.brokerPortfolio?.data?.portfolio?.positions?.list || [])
      .map(position => String(position.symbol || position.tradingsymbol || '').toUpperCase());
    const symbols = [...new Set([
      ...trackedTradeSymbols,
      ...brokerPositionSymbols,
      ...state.serverSimulationCandidates.candidates.map(candidate => String(candidate.symbol || '').toUpperCase()),
      ...state.candidates.map(c => String(c.symbol || '').toUpperCase()),
      ...state.allStocks.map(c => String(c.symbol || '').toUpperCase()),
    ].filter(Boolean))];
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

  function mobileSetupsViewActive() {
    return $('view-setups')?.classList.contains('active');
  }

  function applyServerSimulationCandidates(payload = {}) {
    if (payload.ok === false) {
      state.serverSimulationCandidates = {
        ...state.serverSimulationCandidates,
        loaded:true,
        error:payload.error || 'Server simulation candidates unavailable',
      };
      return false;
    }
    const candidates = (Array.isArray(payload.candidates) ? payload.candidates : [])
      .slice()
      .sort((a, b) => n(a.serverRank) - n(b.serverRank))
      .slice(0, 25);
    const combinedCandidates = (Array.isArray(payload.combinedCandidates) ? payload.combinedCandidates : [])
      .slice()
      .sort((a, b) => n(a.combinedRank) - n(b.combinedRank));
    state.serverSimulationCandidates = {
      loaded:true,
      at:String(payload.at || ''),
      candidates,
      combinedCandidates,
      error:'',
    };
    state.setupsLoaded = true;
    state.setupsLoading = false;
    return true;
  }

  function disconnectServerSimulationStream() {
    if (!state.serverSimulationStream) return;
    state.serverSimulationStream.close();
    state.serverSimulationStream = null;
  }

  function serverSimulationFilterActive() {
    return ['simulation_top25', 'combined_top', 'opportunity_research'].includes(state.setupFilter);
  }

  async function loadServerSimulationCandidatesFallback() {
    try {
      state.setupsLoading = true;
      renderSetups();
      const payload = await api('/simulation/analysis?source=mobile-top-25');
      applyServerSimulationCandidates(payload);
    } catch (error) {
      applyServerSimulationCandidates({ ok:false, error:error.message });
    }
    renderSetups();
  }

  function connectServerSimulationStream() {
    if (!serverSimulationFilterActive() || !mobileSetupsViewActive()) {
      disconnectServerSimulationStream();
      return;
    }
    if (!window.EventSource) {
      loadServerSimulationCandidatesFallback();
      return;
    }
    if (state.serverSimulationStream) return;
    const stream = new EventSource('/simulation/analysis/stream');
    state.serverSimulationStream = stream;
    stream.onmessage = event => {
      if (!serverSimulationFilterActive() || !mobileSetupsViewActive()) {
        disconnectServerSimulationStream();
        return;
      }
      try {
        applyServerSimulationCandidates(JSON.parse(event.data || '{}'));
        renderSetups();
        connectLiveStream();
      } catch (_) {}
    };
    stream.onerror = () => {
      if (!serverSimulationFilterActive() || !mobileSetupsViewActive()) disconnectServerSimulationStream();
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
      void loadDecisionCalendar(state.candidates.map(candidate => candidate.symbol));
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
        applyTradeSettingsPayload(settings);
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
      const summary = escapeHTML(item.summary || '');
      const sentiment = String(item.newsSentiment || item.type || 'News');
      const sentimentClass = /positive|bullish|upside/i.test(sentiment) ? 'news-positive' : /negative|bearish|downside/i.test(sentiment) ? 'news-negative' : 'news-neutral';
      const impactScore = Number(item.tradeImpactScore || 0);
      const impactLabel = `${sentiment} ${impactScore > 0 ? '+' : ''}${impactScore}`;
      return `<article class="news-row">
        <div class="news-row-head"><strong>${escapeHTML(item.symbol || '--')}</strong><span class="${sentimentClass}" title="${escapeHTML(item.tradeImpactReason || 'Trade impact score')}">${escapeHTML(impactLabel)}</span></div>
        ${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener">${title}</a>` : `<p>${title}</p>`}
        ${summary ? `<p class="news-row-summary">${summary}</p>` : ''}
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

  function setupEventCandidate(symbol) {
    const normalized = String(symbol || '').toUpperCase();
    const rows = [
      ...(state.serverSimulationCandidates?.candidates || []),
      ...(state.serverSimulationCandidates?.combinedCandidates || []),
      ...(state.candidates || []),
      ...(state.allStocks || []),
    ];
    return rows.find(row => String(row?.symbol || '').toUpperCase() === normalized) || { symbol:normalized };
  }

  function setupEventDate(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime())
      ? '--'
      : date.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  async function openSetupEventOverlay(symbol, kind) {
    const normalized = String(symbol || '').toUpperCase();
    const eventKind = kind === 'results' ? 'results' : 'news';
    const label = eventKind === 'results' ? 'Result' : 'News';
    const candidate = setupEventCandidate(normalized);
    const item = setupEventItems(candidate)[eventKind];
    const calendarItem = eventKind === 'results' ? state.decisionCalendarBySymbol[normalized]?.[0] : null;
    const presentation = setupEventPresentation(eventKind, item);
    const body = $('setup-event-body');
    $('setup-event-title').textContent = `${normalized} ${label}`;
    $('setup-event-eyebrow').textContent = eventKind === 'results' ? 'Results detail' : 'News detail';
    body.innerHTML = `<div class="empty">Loading ${label.toLowerCase()} details…</div>`;
    $('setup-event-overlay').hidden = false;
    document.body.classList.add('overlay-open');

    let quarterlyPayload = null;
    let quarterlyError = '';
    if (eventKind === 'results') {
      try {
        quarterlyPayload = await api(`/yahoo/quarterly-financials?symbol=${encodeURIComponent(normalized)}`);
      } catch (error) {
        quarterlyError = error.message || 'Quarterly financials could not be loaded';
      }
    }

    const quarters = Array.isArray(quarterlyPayload?.quarters) ? quarterlyPayload.quarters.slice(0, 3) : [];
    const detail = item || calendarItem || (quarters.length ? { title:`${normalized} quarterly financials`, source:quarterlyPayload.source, url:quarterlyPayload.sourceUrl } : null);
    const dateValue = detail?.publishedAt || detail?.filingDate || detail?.eventDate || detail?.dateKey;
    const score = item && Number.isFinite(Number(item.tradeImpactScore)) ? Number(item.tradeImpactScore) : null;
    const safeUrl = /^https?:\/\//i.test(String(detail?.url || '')) ? escapeHTML(detail.url) : '';
    const metrics = detail && [detail.revenueCr, detail.profitAfterTaxCr, detail.profitBeforeTaxCr, detail.eps]
      .some(value => value != null && Number.isFinite(Number(value)))
      ? `<div class="setup-event-metrics">
          <span>Revenue <b>${detail.revenueCr == null ? '--' : `${fmt(detail.revenueCr)} Cr`}</b></span>
          <span>PAT <b>${detail.profitAfterTaxCr == null ? '--' : `${fmt(detail.profitAfterTaxCr)} Cr`}</b></span>
          <span>PBT <b>${detail.profitBeforeTaxCr == null ? '--' : `${fmt(detail.profitBeforeTaxCr)} Cr`}</b></span>
          <span>EPS <b>${detail.eps == null ? '--' : fmt(detail.eps)}</b></span>
        </div>`
      : '';
    const quarterlyMetric = value => value == null || !Number.isFinite(Number(value)) ? '--' : `${fmt(value)} Cr`;
    const quarterlyTable = quarters.length ? `
      <div class="setup-event-quarterly" aria-label="Last three quarterly results">
        <div class="setup-event-quarterly-row setup-event-quarterly-head"><span>Quarter</span><span>Revenue</span><span>EBITDA</span><span>Net profit</span></div>
        ${quarters.map(quarter => `<div class="setup-event-quarterly-row"><b>${escapeHTML(quarter.period || 'Quarter')}</b><span>${quarterlyMetric(quarter.revenueCr)}</span><span>${quarterlyMetric(quarter.ebitdaCr)}</span><span>${quarterlyMetric(quarter.netProfitCr)}</span></div>`).join('')}
      </div>` : '';
    body.innerHTML = detail ? `
      <article class="setup-event-detail-card">
        <div class="setup-event-detail-head"><span class="setup-event-badge ${presentation.polarity}">${label} <span aria-hidden="true">${presentation.icon}</span> · ${presentation.sentiment}</span>${dateValue ? `<time>${escapeHTML(setupEventDate(dateValue))}</time>` : ''}</div>
        <h3>${escapeHTML(detail.title || detail.type || `${label} update`)}</h3>
        ${detail.summary ? `<p>${escapeHTML(detail.summary)}</p>` : ''}
        ${item?.tradeImpactReason ? `<p><b>Trade impact:</b> ${escapeHTML(item.tradeImpactReason)}</p>` : ''}
        <div class="setup-event-detail-meta">
          <span>Source <b>${escapeHTML(detail.source || quarterlyPayload?.source || 'Cached stock feed')}</b></span>
          ${score == null ? '' : `<span>Impact score <b>${score > 0 ? '+' : ''}${fmt(score)}</b></span>`}
          ${calendarItem && !item ? `<span>Next result <b>${escapeHTML(nextResultTiming(normalized))}</b></span>` : ''}
        </div>
        ${quarterlyTable}
        ${metrics}
        ${safeUrl ? `<a class="setup-event-source-link" href="${safeUrl}" target="_blank" rel="noopener">Open source</a>` : ''}
      </article>` : `<div class="empty">No ${label.toLowerCase()} details are currently available for ${escapeHTML(normalized)}.${quarterlyError ? ` ${escapeHTML(quarterlyError)}` : ''}</div>`;
  }

  function closeSetupEventOverlay() {
    $('setup-event-overlay').hidden = true;
    document.body.classList.remove('overlay-open');
  }

  function earningsResultDateKey(item) {
    return String(item?.dateKey || item?.eventDate || '').slice(0, 10);
  }

  function earningsResultDateRange(results) {
    const start = new Date(`${results.fromDate || ''}T00:00:00.000Z`);
    const end = new Date(`${results.toDate || ''}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return [...new Set(results.items.map(earningsResultDateKey).filter(Boolean))].sort();
    }
    const dates = [];
    for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
  }

  function earningsResultDisplayDate(dateKey) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    return Number.isNaN(date.getTime())
      ? dateKey
      : date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', timeZone:'UTC' });
  }

  function selectEarningsResultDate(dateKey) {
    state.earningsResults.selectedDate = String(dateKey || '');
    renderEarningsResults();
  }

  function renderEarningsResults() {
    const body = $('earnings-results-list');
    const status = $('earnings-results-status');
    const dateStrip = $('earnings-results-date-strip');
    if (!body || !status || !dateStrip) return;
    const results = state.earningsResults;
    if (results.loading) {
      dateStrip.innerHTML = '';
      status.textContent = 'Loading earnings calendar…';
      body.innerHTML = '<div class="empty">Loading upcoming earnings results…</div>';
      return;
    }
    if (results.error) {
      dateStrip.innerHTML = '';
      status.textContent = results.error;
      body.innerHTML = `<div class="empty negative">${escapeHTML(results.error)}</div>`;
      return;
    }
    const dates = earningsResultDateRange(results);
    const counts = {};
    for (const item of results.items) {
      const dateKey = earningsResultDateKey(item);
      if (dateKey) counts[dateKey] = (counts[dateKey] || 0) + 1;
    }
    if (!dates.includes(results.selectedDate)) {
      results.selectedDate = dates.find(date => counts[date] > 0) || dates[0] || '';
    }
    dateStrip.innerHTML = dates.map(date => `
      <button class="earnings-date-tab ${date === results.selectedDate ? 'active' : ''}" type="button" data-earnings-date="${escapeHTML(date)}">
        <span>${escapeHTML(earningsResultDisplayDate(date))}</span>
        <small>${counts[date] || 0} Events</small>
      </button>
    `).join('');
    status.textContent = results.fromDate && results.toDate
      ? `${results.items.length} events · ${results.fromDate} to ${results.toDate}`
      : `${results.items.length} upcoming events`;
    const selectedItems = results.items.filter(item =>
      !results.selectedDate || earningsResultDateKey(item) === results.selectedDate
    );
    body.innerHTML = selectedItems.length ? selectedItems.map(item => `
      <article class="earnings-result-row">
        <div><strong>${escapeHTML(item.symbol || '--')}</strong><span>${escapeHTML(item.name || item.symbol || '')}</span></div>
        <div><b class="${item.status === 'today' ? 'positive' : ''}">${escapeHTML(item.status === 'today' ? 'Today' : item.type || 'Financial Results')}</b><span>${escapeHTML(item.title || item.type || 'Earnings result')}</span></div>
      </article>
    `).join('') : '<div class="empty">No earnings results for the selected date</div>';
    requestAnimationFrame(() => {
      dateStrip.querySelector('.earnings-date-tab.active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
    });
  }

  async function openEarningsResultsOverlay() {
    $('earnings-results-overlay').hidden = false;
    document.body.classList.add('overlay-open');
    if (state.earningsResults.loading || (state.earningsResults.loaded && !state.earningsResults.error)) {
      renderEarningsResults();
      return;
    }
    state.earningsResults = { ...state.earningsResults, loading:true, error:'' };
    renderEarningsResults();
    try {
      const payload = await api('/result-calendar?days=30');
      state.earningsResults = {
        loading:false,
        loaded:true,
        items:Array.isArray(payload.items) ? payload.items : [],
        fromDate:payload.fromDate || '',
        toDate:payload.toDate || '',
        selectedDate:'',
        error:'',
      };
    } catch (error) {
      state.earningsResults = {
        ...state.earningsResults,
        loading:false,
        loaded:true,
        error:error.message || 'Could not load earnings results',
      };
    }
    renderEarningsResults();
  }

  function closeEarningsResultsOverlay() {
    $('earnings-results-overlay').hidden = true;
    document.body.classList.remove('overlay-open');
  }

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

  function renderSparklineSvg(points = [], symbol = '') {
    const rows = points.map(Number).filter(Number.isFinite);
    if (rows.length < 2) return '<div class="empty">No one-month trend data available</div>';
    const width = 640, height = 300, padX = 42, padY = 38;
    const low = Math.min(...rows);
    const high = Math.max(...rows);
    const span = Math.max(high - low, 0.1);
    const x = index => padX + index / Math.max(1, rows.length - 1) * (width - padX * 2);
    const y = value => padY + (high - value) / span * (height - padY * 2);
    const line = rows.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const area = `${padX},${height - padY} ${line} ${width - padX},${height - padY}`;
    const latest = rows[rows.length - 1];
    const color = latest >= rows[0] ? '#2fd17c' : '#ff626f';
    const zeroLine = low <= 0 && high >= 0
      ? `<line x1="${padX}" y1="${y(0).toFixed(1)}" x2="${width - padX}" y2="${y(0).toFixed(1)}" stroke="rgba(148,162,170,.35)" stroke-dasharray="5 5"/>`
      : '';
    return `<div class="mobile-sparkline-summary"><strong>${escapeHTML(symbol)}</strong><span class="${cls(latest)}">1M ${pct(latest)}</span></div>
      <svg class="mobile-sparkline-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(symbol)} one month price trend">
        <polygon points="${area}" fill="${color}" opacity=".12"/>
        ${zeroLine}
        <polyline points="${line}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${x(rows.length - 1).toFixed(1)}" cy="${y(latest).toFixed(1)}" r="7" fill="${color}"/>
        <text x="4" y="20">${pct(high)}</text><text x="4" y="${height - 8}">${pct(low)}</text>
      </svg>`;
  }

  async function openSparklineOverlay(symbol) {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return;
    state.candleChart = { symbol:sym, mode:'sparkline', points:[], loading:true };
    $('candle-overlay').hidden = false;
    $('candle-interval-toolbar').hidden = true;
    document.body.classList.add('overlay-open');
    setText('candle-title', `${sym} · 1 Month Trend`);
    $('candle-body').innerHTML = '<div class="empty">Loading one-month trend…</div>';
    try {
      const payload = await api(`/sparklines?symbols=${encodeURIComponent(sym)}`);
      if (state.candleChart.symbol !== sym || state.candleChart.mode !== 'sparkline') return;
      const points = payload.data?.[sym] || [];
      state.candleChart = { symbol:sym, mode:'sparkline', points, loading:false };
      $('candle-body').innerHTML = renderSparklineSvg(points, sym);
    } catch (error) {
      $('candle-body').innerHTML = `<div class="empty negative">${escapeHTML(error.message || 'Could not load one-month trend')}</div>`;
    }
  }

  async function openCandleOverlay(symbol, interval = '5m') {
    const sym = String(symbol || '').toUpperCase();
    if (!sym) return;
    const safeInterval = interval === '15m' ? '15m' : '5m';
    state.candleChart = { symbol:sym, mode:'candles', interval:safeInterval, candles:[], loading:true };
    $('candle-overlay').hidden = false;
    $('candle-interval-toolbar').hidden = false;
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
      state.candleChart = { symbol:sym, interval:safeInterval, candles:payload.candles || [], source:payload.source || '', loading:false };
      const sourceLabel = payload.source === 'sharekhan-historical' ? 'Sharekhan' : payload.source === 'yahoo' ? 'Yahoo fallback' : '';
      setText('candle-title', `${sym} · ${safeInterval} Candles${sourceLabel ? ` · ${sourceLabel}` : ''}`);
      $('candle-body').innerHTML = renderCandleSvg(state.candleChart.candles, safeInterval);
    } catch (error) {
      $('candle-body').innerHTML = `<div class="empty negative">${escapeHTML(error.message || 'Could not load candles')}</div>`;
    }
  }

  function setCandleInterval(interval) {
    if (state.candleChart.mode === 'sparkline') return;
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

  async function openStockDetailOverlay(symbol, refreshAttempt = 0) {
    const sym = String(symbol || '').toUpperCase();
    const row = withLiveQuote(state.allStocks.find(item => item.symbol === sym) || state.candidates.find(item => String(item.symbol || '').toUpperCase() === sym) || { symbol:sym });
    $('stock-detail-overlay').hidden = false;
    document.body.classList.add('overlay-open');
    setText('stock-detail-title', `${sym} Details`);
    if (refreshAttempt === 0) $('stock-detail-body').innerHTML = '<div class="empty">Loading fundamentals, quarterly financials and news…</div>';
    const [fundResult, quarterlyResult, newsResult] = await Promise.allSettled([
      api(`/yahoo/summary?symbols=${encodeURIComponent(sym)}`),
      api(`/yahoo/quarterly-financials?symbol=${encodeURIComponent(sym)}`),
      api(`/stock-news?symbol=${encodeURIComponent(sym)}&name=${encodeURIComponent(row.name || sym)}&assetType=stock`),
    ]);
    const meta = fundResult.status === 'fulfilled' ? fundResult.value?.metas?.[sym] || {} : {};
    const quarterlyPayload = quarterlyResult.status === 'fulfilled' ? quarterlyResult.value || {} : {};
    const quarters = (quarterlyPayload.quarters || []).slice(0, 3);
    const newsPayload = newsResult.status === 'fulfilled' ? newsResult.value || {} : {};
    const newsItems = (newsPayload.news || []).slice(0, 8);
    const events = (newsPayload.events || []).slice(0, 6);
    const openTrade = state.trades.find(trade => String(trade.symbol || '').toUpperCase() === sym && String(trade.status || '').toLowerCase() === 'open');
    const health = computeHealthScore(meta, n(row.price));
    const metric = value => value == null || !Number.isFinite(Number(value)) ? '--' : fmt(value);
    $('stock-detail-body').innerHTML = `
      <section class="detail-metrics">
        <span>Price<b data-live-price="${sym}">${row.price ? fmt(row.price) : '--'}</b></span><span>Health<b>${health == null ? '--' : `${health}/100`}</b></span>
        <span>EPS<b>${metric(meta.trailingEps)}</b></span><span>P/E<b>${metric(meta.trailingPE)}</b></span>
        <span>ROE<b>${meta.roe == null ? '--' : `${fmt(Math.abs(Number(meta.roe)) <= 1 ? Number(meta.roe) * 100 : meta.roe)}%`}</b></span><span>Sector<b>${escapeHTML(meta.sector || row.sector || '--')}</b></span>
      </section>
      <h3>Last 3 Quarters <small>₹ Cr</small></h3>
      <div class="quarterly-financials" aria-label="Last three quarters revenue EBITDA and net profit">
        ${quarters.length ? `
          <div class="quarterly-financials-row quarterly-financials-head"><span>Quarter</span><span>Revenue</span><span>EBITDA</span><span>Net Profit</span></div>
          ${quarters.map(quarter => `<div class="quarterly-financials-row"><b>${escapeHTML(quarter.period || 'Quarter')}</b><span>${metric(quarter.revenueCr)}</span><span>${metric(quarter.ebitdaCr)}</span><span>${metric(quarter.netProfitCr)}</span></div>`).join('')}
          <div class="quarterly-financials-source">Source: ${escapeHTML(quarterlyPayload.source || 'Yahoo Finance')}</div>`
          : `<div class="empty">${quarterlyResult.status === 'rejected' ? 'Quarterly financials are temporarily unavailable' : 'No quarterly financials available for this stock'}</div>`}
      </div>
      <h3>Decision Timeline</h3>
      <div class="detail-timeline">
        <div><span>Data</span><b data-live-summary="${sym}">Price ${row.price ? fmt(row.price) : '--'} · Change ${fmt(row.change)}%</b></div>
        <div><span>Signal</span><b>${escapeHTML(String(row.side || 'watch').toUpperCase())} · Score ${fmt(row.score)}</b></div>
        <div><span>Setup</span><b>${escapeHTML(row.setupType || row.entryStatus || 'No active setup')}</b></div>
        <div><span>Trade</span><b>${openTrade ? `${escapeHTML(String(openTrade.side).toUpperCase())} ${openTrade.qty} @ ${fmt(openTrade.entryPrice)}` : 'No open trade'}</b></div>
      </div>
      <h3>Results & Events</h3>
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
    if (newsPayload.refreshing && refreshAttempt < 8) {
      const retryDelay = Math.min(8000, 1000 * (refreshAttempt + 1));
      setTimeout(() => {
        if (!$('stock-detail-overlay').hidden && $('stock-detail-title').textContent === `${sym} Details`) {
          openStockDetailOverlay(sym, refreshAttempt + 1);
        }
      }, retryDelay);
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
    const normalized = String(sym || '').toUpperCase();
    const candidate = state.serverSimulationCandidates.candidates.find(c => String(c.symbol || '').toUpperCase() === normalized)
      || state.candidates.find(c => String(c.symbol || '').toUpperCase() === normalized);
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
    $('earnings-results-btn').addEventListener('click', openEarningsResultsOverlay);
    $('earnings-results-close').addEventListener('click', closeEarningsResultsOverlay);
    $('earnings-results-date-strip').addEventListener('click', event => {
      const button = event.target.closest('[data-earnings-date]');
      if (button) selectEarningsResultDate(button.dataset.earningsDate);
    });
    $('earnings-results-overlay').addEventListener('click', event => {
      if (event.target.id === 'earnings-results-overlay') closeEarningsResultsOverlay();
    });
    $('fresh-news-close').addEventListener('click', closeFreshNewsOverlay);
    $('fresh-news-overlay').addEventListener('click', event => {
      if (event.target.id === 'fresh-news-overlay') closeFreshNewsOverlay();
    });
    $('setup-event-close').addEventListener('click', closeSetupEventOverlay);
    $('setup-event-overlay').addEventListener('click', event => {
      if (event.target.id === 'setup-event-overlay') closeSetupEventOverlay();
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
        if (view === 'setups' && serverSimulationFilterActive()) {
          renderSetups();
          connectServerSimulationStream();
        } else {
          disconnectServerSimulationStream();
          if (view === 'setups' && !state.setupsLoaded && !state.setupsLoading) loadSetups();
        }
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
      if (serverSimulationFilterActive()) connectServerSimulationStream();
      else {
        disconnectServerSimulationStream();
        loadSetups();
      }
    };
    $('setup-filter-select')?.addEventListener('input', updateSetupSelection);
    $('setup-filter-select')?.addEventListener('change', updateSetupSelection);
    $('setup-refresh-btn')?.addEventListener('click', event => {
      event.preventDefault();
      if (serverSimulationFilterActive()) {
        disconnectServerSimulationStream();
        connectServerSimulationStream();
      } else loadSetups();
    });
    $('all-stock-filter-select')?.addEventListener('change', event => {
      state.allStockFilter = event.target.value;
      if (['new-ipo', 'upcoming-ipo'].includes(state.allStockFilter)) void loadMobileIpoCalendar();
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
      const eventButton = event.target.closest('[data-card-event-kind]');
      if (eventButton) {
        event.stopPropagation();
        await openSetupEventOverlay(eventButton.dataset.cardEventSymbol, eventButton.dataset.cardEventKind);
        return;
      }
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
      const sparklineRange = event.target.closest('[data-sparkline-symbol]');
      if (sparklineRange) {
        await openSparklineOverlay(sparklineRange.dataset.sparklineSymbol);
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
      const next = { ...(state.overrides || {}) };
      for (const el of event.currentTarget.elements) {
        if (!el.name) continue;
        const kind = el.dataset.settingKind || (el.type === 'checkbox' ? 'boolean' : 'number');
        const value = kind === 'boolean'
          ? el.checked
          : (kind === 'number' ? (String(el.value).trim() === '' ? null : Number(el.value)) : String(el.value));
        if (el.dataset.setupSetting === 'true') {
          const defaultValue = kind === 'boolean'
            ? el.dataset.default === 'true'
            : (kind === 'number' ? (el.dataset.default === '' ? null : Number(el.dataset.default)) : el.dataset.default);
          if (value == null || value === defaultValue) delete next[el.name];
          else next[el.name] = value;
        } else if (value != null) {
          next[el.name] = value;
        }
      }
      if (saveButton) saveButton.disabled = true;
      setSettingsStatus('Saving settings…');
      try {
        const payload = await api('/trade-settings', { method: 'POST', body: JSON.stringify({ overrides: next }) });
        applyTradeSettingsPayload({ ...payload, overrides:payload.overrides || next });
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
        applyTradeSettingsPayload(payload);
        renderSettings();
        setSettingsStatus('Overrides cleared successfully', false, true);
      } catch (e) { setSettingsStatus(e.message || 'Could not clear overrides', true); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    hydrateSetupCache();
    state.allStockUniverse = readCachedAllStockUniverse();
    preloadAllStockUniverse().catch(() => {});
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
      state.stockQuoteStreams.forEach(stream => stream.close());
      state.marketOverviewStream?.close();
      state.tradeStream?.close();
      state.healthStream?.close();
      state.serverSimulationStream?.close();
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
