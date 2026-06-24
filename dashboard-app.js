// ═══════════════════════════════════
//  CONFIG
// ═══════════════════════════════════
// Adaptive refresh: 2 min during market hours (9:15–15:30 IST), 10 min outside
function getRefreshInterval() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return 600; // weekend
  const hhmm = ist.getUTCHours() * 100 + ist.getUTCMinutes();
  return (hhmm >= 915 && hhmm < 1530) ? 120 : 600;
}
const PROXY = location.protocol === 'file:' ? 'http://localhost:3001' : location.origin;
const DASHBOARD_BOOTSTRAP_ENDPOINT = `${PROXY}/dashboard-bootstrap`;
const ETF_PREFS_ENDPOINT = `${PROXY}/etf-prefs`;
const ETF_STORAGE_KEY = 'stock-watcher-etf-symbols';
const ETF_FAVS_ENDPOINT = `${PROXY}/etf-favs`;
const ETF_FAV_STORAGE_KEY = 'stock-watcher-etf-favorites';
const STOCK_PREFS_ENDPOINT = `${PROXY}/stock-prefs`;
const STOCK_STORAGE_KEY = 'stock-watcher-stock-symbols';
const STOCK_FAVS_ENDPOINT = `${PROXY}/stock-favs`;
const STOCK_FAV_STORAGE_KEY = 'stock-watcher-stock-favorites';
const PAPER_TRADES_ENDPOINT = `${PROXY}/paper-trades`;
const PAPER_TRADES_STREAM_ENDPOINT = `${PAPER_TRADES_ENDPOINT}/stream`;
const FRESH_STOCK_NEWS_ENDPOINT = `${PROXY}/fresh-stock-news`;
const SIM_SNAPSHOT_ENDPOINT = `${PROXY}/simulation-snapshots`;
const SIM_REPLAY_ENDPOINT = `${PROXY}/simulation-replay`;
const SIM_REPLAY_JOB_ENDPOINT = `${PROXY}/simulation-replay/jobs`;
const SIM_REPLAY_WHY_ENDPOINT = `${PROXY}/simulation-replay/why`;
const BROKER_REFRESH_TOKEN_ENDPOINT = `${PROXY}/broker-refresh-token`;
const ZERODHA_PORTFOLIO_ENDPOINT = `${PROXY}/zerodha-portfolio`;
const SHAREKHAN_PORTFOLIO_ENDPOINT = `${PROXY}/sharekhan-portfolio`;
const REPLAY_FETCH_TIMEOUT_MS = 120000;
const TRADE_SETTINGS_ENDPOINT = `${PROXY}/trade-settings`;
const TRADE_SETTING_OVERRIDES_KEY = 'stock-watcher-trade-setting-overrides';
const OPENAI_ENDPOINT = `${PROXY}/openai`;
const OLLAMA_CHAT_ENDPOINT = `${PROXY}/ollama/chat`;
const DEBUG_INTRADAY_LOGS = false;
const DEBUG_SIM_LOGS = false;
const DEBUG_EVENT_LOGS = false;

let STOCK_FAVORITES = new Set();
let ETF_FAVORITES = new Set();
let tradeSettingOverrides = null;
let dashboardBootstrap = null;
let dashboardBootstrapLoaded = false;

async function loadDashboardBootstrap() {
  if (dashboardBootstrapLoaded) return dashboardBootstrap;
  dashboardBootstrapLoaded = true;
  try {
    const res = await fetch(DASHBOARD_BOOTSTRAP_ENDPOINT, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`);
    const payload = await res.json();
    dashboardBootstrap = payload && payload.ok ? payload : null;
  } catch (e) {
    console.warn('Dashboard bootstrap failed:', e.message);
    dashboardBootstrap = null;
  }
  return dashboardBootstrap;
}

function bootstrapArray(path, fallback = null) {
  const value = path.reduce((obj, key) => (obj && obj[key] != null ? obj[key] : null), dashboardBootstrap);
  return Array.isArray(value) ? value : fallback;
}

function loadSavedETFsFromStorage() {
  try {
    const raw = localStorage.getItem(ETF_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
function saveSavedETFsToStorage(symbols) {
  try {
    localStorage.setItem(ETF_STORAGE_KEY, JSON.stringify(Array.isArray(symbols) ? symbols : []));
  } catch (e) {
    console.warn('ETF local save failed:', e.message);
  }
}

function loadFavoriteETFsFromStorage() {
  try {
    const raw = localStorage.getItem(ETF_FAV_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
function saveFavoriteETFsToStorage(symbols) {
  try {
    localStorage.setItem(ETF_FAV_STORAGE_KEY, JSON.stringify(Array.isArray(symbols) ? symbols : []));
  } catch (e) {
    console.warn('ETF fav local save failed:', e.message);
  }
}

function loadSavedStocksFromStorage() {
  try {
    const raw = localStorage.getItem(STOCK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
function saveSavedStocksToStorage(symbols) {
  try {
    localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(Array.isArray(symbols) ? symbols : []));
  } catch (e) {
    console.warn('Stock local save failed:', e.message);
  }
}

function loadFavoriteStocksFromStorage() {
  try {
    const raw = localStorage.getItem(STOCK_FAV_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
function saveFavoriteStocksToStorage(symbols) {
  try {
    localStorage.setItem(STOCK_FAV_STORAGE_KEY, JSON.stringify(Array.isArray(symbols) ? symbols : []));
  } catch (e) {
    console.warn('Stock fav local save failed:', e.message);
  }
}

async function loadFavoriteETFs() {
  let saved = [];
  const boot = bootstrapArray(['prefs', 'etfFavorites']);
  if (boot) {
    saved = boot;
    saveFavoriteETFsToStorage(saved);
  } else {
    try {
      const res = await fetch(ETF_FAVS_ENDPOINT);
      if (!res.ok) throw new Error('ETF favs endpoint unavailable');
      const payload = await res.json();
      if (Array.isArray(payload)) {
        saved = payload;
        saveFavoriteETFsToStorage(saved);
      }
    } catch (e) {
      console.warn('Saved ETF favorites load failed:', e.message);
      saved = loadFavoriteETFsFromStorage();
    }
  }
  if (!Array.isArray(saved)) return;
  ETF_FAVORITES = new Set(saved.filter(s => typeof s === 'string').map(s => s.trim().toUpperCase()).filter(Boolean));
}

async function loadFavoriteStocks() {
  let saved = [];
  const boot = bootstrapArray(['prefs', 'stockFavorites']);
  if (boot) {
    saved = boot;
    saveFavoriteStocksToStorage(saved);
  } else {
    try {
      const res = await fetch(STOCK_FAVS_ENDPOINT);
      if (!res.ok) throw new Error('Stock favs endpoint unavailable');
      const payload = await res.json();
      if (Array.isArray(payload)) {
        saved = payload;
        saveFavoriteStocksToStorage(saved);
      }
    } catch (e) {
      console.warn('Saved stock favorites load failed:', e.message);
      saved = loadFavoriteStocksFromStorage();
    }
  }
  if (!Array.isArray(saved)) return;
  STOCK_FAVORITES = new Set(saved.filter(s => typeof s === 'string').map(s => s.trim().toUpperCase()).filter(Boolean));
}

async function loadSavedETFs() {
  let saved = [];
  const boot = bootstrapArray(['prefs', 'etfs']);
  if (boot) {
    saved = boot;
    saveSavedETFsToStorage(saved);
  } else {
    try {
      const res = await fetch(ETF_PREFS_ENDPOINT);
      if (!res.ok) throw new Error('ETF prefs endpoint unavailable');
      const payload = await res.json();
      if (Array.isArray(payload)) {
        saved = payload;
        saveSavedETFsToStorage(saved);
      }
    } catch (e) {
      console.warn('Saved ETFs load failed:', e.message);
      saved = loadSavedETFsFromStorage();
    }
  }
  if (!Array.isArray(saved)) return;
  const newSymbols = [];
  for (const rawSym of saved) {
    // support stored formats: string or object { sym, sector, cap }
    if (typeof rawSym === 'string') {
      const sym = rawSym.trim().toUpperCase();
      if (!sym) continue;
      if (MIDCAP_STOCKS.some(s=>s.sym===sym) || ETF_ASSETS.some(e=>e.sym===sym) || EXTRA_SYMBOLS.includes(sym)) continue;
      EXTRA_SYMBOLS.push(sym);
      ETF_ASSETS.push({ sym, name: sym, sector: 'ETF', cap: 'etf' });
      newSymbols.push(sym);
    } else if (rawSym && typeof rawSym === 'object' && rawSym.sym) {
      const sym = String(rawSym.sym).trim().toUpperCase();
      if (!sym) continue;
      if (MIDCAP_STOCKS.some(s=>s.sym===sym) || ETF_ASSETS.some(e=>e.sym===sym) || EXTRA_SYMBOLS.includes(sym)) continue;
      EXTRA_SYMBOLS.push(sym);
      ETF_ASSETS.push({ sym, name: rawSym.name||sym, sector: rawSym.sector||'ETF', cap: rawSym.cap||'etf' });
      newSymbols.push(sym);
    }
  }
  if (newSymbols.length && dataSource) {
    await fetchAdditionalSymbols(newSymbols);
  }
  // Initialize preset ETFs if no saved ETFs exist (fallback on page load)
  if (!ETF_ASSETS.length) {
    for (const etf of PRESET_ETFS) {
      if (MIDCAP_STOCKS.some(s=>s.sym===etf.sym)) continue;
      ETF_ASSETS.push({ ...etf });
    }
  }
  renderETFSection();
}

// Check NSE index membership via cached /nse/index-symbols and add any new symbols
// not already in MIDCAP_STOCKS (handles quarterly rebalancing without hardcoding)
async function refreshIndexMembership() {
  const INDICES = [
    'NIFTY 50',
    'NIFTY NEXT 50',
    'NIFTY MIDCAP 150',
  ];
  let added = 0;
  for (const index of INDICES) {
    try {
      const res = await fetch(`${PROXY}/nse/index-symbols?index=${encodeURIComponent(index)}`);
      if (!res.ok) continue;
      const json = await res.json();
      for (const { sym, name } of (json.symbols || [])) {
        if (!sym) continue;
        if (MIDCAP_STOCKS.some(s => s.sym === sym)) continue;
        // New symbol not in hardcoded list — add it dynamically
        const cap = index === 'NIFTY MIDCAP 150' ? 'midcap' : 'largecap';
        MIDCAP_STOCKS.push({ sym, name: name || sym, sector: 'Other', cap });
        added++;
        console.log(`[index-membership] New symbol from "${index}": ${sym}`);
      }
    } catch(e) { console.warn(`[index-membership] ${index}:`, e.message); }
  }
  if (added) {
    console.log(`[index-membership] Added ${added} new symbols from index rebalancing`);
    renderSectors();
    renderTable();
  }
}

async function loadSavedStocks() {
  let saved = [];
  const boot = bootstrapArray(['prefs', 'stocks']);
  if (boot) {
    saved = boot;
    saveSavedStocksToStorage(saved);
  } else {
    try {
      const res = await fetch(STOCK_PREFS_ENDPOINT);
      if (!res.ok) throw new Error('Stock prefs endpoint unavailable');
      const payload = await res.json();
      if (Array.isArray(payload)) {
        saved = payload;
        saveSavedStocksToStorage(saved);
      }
    } catch (e) {
      console.warn('Saved stocks load failed:', e.message);
      saved = loadSavedStocksFromStorage();
    }
  }
  if (!Array.isArray(saved)) return;
  const newSymbols = [];
  for (const rawSym of saved) {
    // Support both plain strings and objects { sym, sector, cap }
    const sym = typeof rawSym === 'string'
      ? rawSym.trim().toUpperCase()
      : String(rawSym?.sym || '').trim().toUpperCase();
    if (!sym) continue;
    const name   = typeof rawSym === 'string' ? sym : (rawSym?.name || sym);
    const sector = rawSym?.sector || 'Custom';
    const cap    = rawSym?.cap    || 'custom';
    if (MIDCAP_STOCKS.some(s=>s.sym===sym) || STOCK_ASSETS.some(e=>e.sym===sym) || STOCK_EXTRA_SYMBOLS.includes(sym)) continue;
    STOCK_EXTRA_SYMBOLS.push(sym);
    STOCK_ASSETS.push({ sym, name, sector, cap });
    newSymbols.push(sym);
  }
  if (newSymbols.length && dataSource) {
    await fetchAdditionalSymbols(STOCK_ASSETS.map(e=>e.sym));
  }
}

async function saveFavoriteETFs() {
  const favorites = Array.from(ETF_FAVORITES);
  saveFavoriteETFsToStorage(favorites);
  try {
    await fetch(ETF_FAVS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(favorites),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('ETF favs save failed:', e.message);
  }
}

async function saveFavoriteStocks() {
  const favorites = Array.from(STOCK_FAVORITES);
  saveFavoriteStocksToStorage(favorites);
  try {
    await fetch(STOCK_FAVS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(favorites),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    console.warn('Stock favs save failed:', e.message);
  }
}

function isStockFavorite(sym) {
  return STOCK_FAVORITES.has(sym);
}
function isETFFavorite(sym) {
  return ETF_FAVORITES.has(sym);
}

function toggleStockFavorite(sym, event) {
  if (event) event.stopPropagation();
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return;
  if (STOCK_FAVORITES.has(s)) STOCK_FAVORITES.delete(s);
  else STOCK_FAVORITES.add(s);
  renderTable();
  saveFavoriteStocks().catch(e => console.warn('Stock favs save failed:', e.message));
}

function toggleETFFavorite(sym, event) {
  if (event) event.stopPropagation();
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return;
  if (ETF_FAVORITES.has(s)) ETF_FAVORITES.delete(s);
  else ETF_FAVORITES.add(s);
  renderETFSection();
  saveFavoriteETFs().catch(e => console.warn('ETF favs save failed:', e.message));
}

// cap: 'large' = Nifty 100 (Nifty 50 + Nifty Next 50), 'mid' = Nifty Midcap 150
const MIDCAP_STOCKS = [
  // ── NIFTY 50 (Large Cap) ──────────────────────────────────────────
  {sym:'RELIANCE',   name:'Reliance Industries',      sector:'Energy',       cap:'large'},
  {sym:'TCS',        name:'Tata Consultancy Svcs',    sector:'IT',           cap:'large'},
  {sym:'HDFCBANK',   name:'HDFC Bank',                sector:'Banking',      cap:'large'},
  {sym:'ICICIBANK',  name:'ICICI Bank',               sector:'Banking',      cap:'large'},
  {sym:'INFY',       name:'Infosys',                  sector:'IT',           cap:'large'},
  {sym:'HINDUNILVR', name:'Hindustan Unilever',       sector:'FMCG',         cap:'large'},
  {sym:'ITC',        name:'ITC Ltd',                  sector:'FMCG',         cap:'large'},
  {sym:'SBIN',       name:'State Bank of India',      sector:'Banking',      cap:'large'},
  {sym:'BHARTIARTL', name:'Bharti Airtel',            sector:'Telecom',      cap:'large'},
  {sym:'BAJFINANCE', name:'Bajaj Finance',            sector:'Finance',      cap:'large'},
  {sym:'LT',         name:'Larsen & Toubro',          sector:'Engineering',  cap:'large'},
  {sym:'KOTAKBANK',  name:'Kotak Mahindra Bank',      sector:'Banking',      cap:'large'},
  {sym:'AXISBANK',   name:'Axis Bank',                sector:'Banking',      cap:'large'},
  {sym:'ASIANPAINT', name:'Asian Paints',             sector:'Chemicals',    cap:'large'},
  {sym:'MARUTI',     name:'Maruti Suzuki',            sector:'Auto',         cap:'large'},
  {sym:'SUNPHARMA',  name:'Sun Pharmaceutical',       sector:'Pharma',       cap:'large'},
  {sym:'TITAN',      name:'Titan Company',            sector:'Consumer',     cap:'large'},
  {sym:'WIPRO',      name:'Wipro',                    sector:'IT',           cap:'large'},
  {sym:'ULTRACEMCO', name:'UltraTech Cement',         sector:'Cement',       cap:'large'},
  {sym:'BAJAJFINSV', name:'Bajaj Finserv',            sector:'Finance',      cap:'large'},
  {sym:'NESTLEIND',  name:'Nestle India',             sector:'FMCG',         cap:'large'},
  {sym:'ADANIENT',   name:'Adani Enterprises',        sector:'Conglomerate', cap:'large'},
  {sym:'NTPC',       name:'NTPC',                     sector:'Energy',       cap:'large'},
  {sym:'TATASTEEL',  name:'Tata Steel',               sector:'Metals',       cap:'large'},
  {sym:'POWERGRID',  name:'Power Grid Corp',          sector:'Energy',       cap:'large'},
  {sym:'HCLTECH',    name:'HCL Technologies',         sector:'IT',           cap:'large'},
  {sym:'M&M',        name:'Mahindra & Mahindra',      sector:'Auto',         cap:'large'},
  {sym:'TMPV',       name:'Tata Motors Passenger Vehicles', sector:'Auto',   cap:'large'},
  {sym:'ONGC',       name:'ONGC',                     sector:'Energy',       cap:'large'},
  {sym:'COALINDIA',  name:'Coal India',               sector:'Energy',       cap:'large'},
  {sym:'INDUSINDBK', name:'IndusInd Bank',            sector:'Banking',      cap:'large'},
  {sym:'TECHM',      name:'Tech Mahindra',            sector:'IT',           cap:'large'},
  {sym:'GRASIM',     name:'Grasim Industries',        sector:'Cement',       cap:'large'},
  {sym:'CIPLA',      name:'Cipla',                    sector:'Pharma',       cap:'large'},
  {sym:'DIVISLAB',   name:'Divis Laboratories',       sector:'Pharma',       cap:'large'},
  {sym:'EICHERMOT',  name:'Eicher Motors',            sector:'Auto',         cap:'large'},
  {sym:'TATACONSUM', name:'Tata Consumer Products',   sector:'FMCG',         cap:'large'},
  {sym:'BPCL',       name:'BPCL',                     sector:'Energy',       cap:'large'},
  {sym:'DRREDDY',    name:'Dr Reddys Labs',           sector:'Pharma',       cap:'large'},
  {sym:'APOLLOHOSP', name:'Apollo Hospitals',         sector:'Healthcare',   cap:'large'},
  {sym:'BAJAJ-AUTO', name:'Bajaj Auto',               sector:'Auto',         cap:'large'},
  {sym:'HEROMOTOCO', name:'Hero MotoCorp',            sector:'Auto',         cap:'large'},
  {sym:'JSWSTEEL',   name:'JSW Steel',                sector:'Metals',       cap:'large'},
  {sym:'BRITANNIA',  name:'Britannia Industries',     sector:'FMCG',         cap:'large'},
  {sym:'SHRIRAMFIN', name:'Shriram Finance',          sector:'Finance',      cap:'large'},
  {sym:'ADANIPORTS', name:'Adani Ports',              sector:'Logistics',    cap:'large'},
  {sym:'SBILIFE',    name:'SBI Life Insurance',       sector:'Insurance',    cap:'large'},
  {sym:'HDFCLIFE',   name:'HDFC Life Insurance',      sector:'Insurance',    cap:'large'},
  {sym:'ETERNAL',    name:'Eternal',                  sector:'Food',         cap:'large'},
  {sym:'BEL',        name:'Bharat Electronics',       sector:'Defence',      cap:'large'},

  // ── NIFTY NEXT 50 (Large Cap) ─────────────────────────────────────
  {sym:'ADANIGREEN', name:'Adani Green Energy',       sector:'Energy',       cap:'large'},
  {sym:'ADANIPOWER', name:'Adani Power',              sector:'Energy',       cap:'large'},
  {sym:'AMBUJACEM',  name:'Ambuja Cements',           sector:'Cement',       cap:'large'},
  {sym:'DMART',      name:'Avenue Supermarts (DMart)',sector:'Retail',       cap:'large'},
  {sym:'SIEMENS',    name:'Siemens',                  sector:'Engineering',  cap:'large'},
  {sym:'IOC',        name:'Indian Oil Corp',          sector:'Energy',       cap:'large'},
  {sym:'DLF',        name:'DLF',                      sector:'Realty',       cap:'large'},
  {sym:'HAL',        name:'Hindustan Aeronautics',    sector:'Defence',      cap:'large'},
  {sym:'PIDILITIND', name:'Pidilite Industries',      sector:'Chemicals',    cap:'large'},
  {sym:'VBL',        name:'Varun Beverages',          sector:'FMCG',         cap:'large'},
  {sym:'GODREJCP',   name:'Godrej Consumer Products', sector:'FMCG',         cap:'large'},
  {sym:'DABUR',      name:'Dabur India',              sector:'FMCG',         cap:'large'},
  {sym:'MARICO',     name:'Marico',                   sector:'FMCG',         cap:'large'},
  {sym:'BERGEPAINT', name:'Berger Paints',            sector:'Chemicals',    cap:'large'},
  {sym:'TORNTPHARM', name:'Torrent Pharmaceuticals',  sector:'Pharma',       cap:'large'},
  {sym:'HAVELLS',    name:'Havells India',            sector:'Consumer',     cap:'large'},
  {sym:'LTM',        name:'LTM',                      sector:'IT',           cap:'large'},
  {sym:'INDHOTEL',   name:'Indian Hotels (Taj)',      sector:'Hospitality',  cap:'large'},
  {sym:'HINDCOPPER', name:'Hindustan Copper',         sector:'Metals',       cap:'large'},
  {sym:'NAUKRI',     name:'Info Edge (Naukri)',        sector:'IT',           cap:'large'},
  {sym:'MUTHOOTFIN', name:'Muthoot Finance',          sector:'Finance',      cap:'large'},
  {sym:'POLYCAB',    name:'Polycab India',            sector:'Engineering',  cap:'large'},
  {sym:'ICICIPRULI', name:'ICICI Pru Life Insurance', sector:'Insurance',    cap:'large'},
  {sym:'NYKAA',      name:'FSN E-Commerce (Nykaa)',   sector:'Retail',       cap:'large'},
  {sym:'PAYTM',      name:'One97 Communications',     sector:'Finance',      cap:'large'},
  {sym:'RECLTD',     name:'REC Ltd',                  sector:'Finance',      cap:'large'},
  {sym:'PFC',        name:'Power Finance Corp',       sector:'Finance',      cap:'large'},
  {sym:'MOTHERSON',  name:'Samvardhana Motherson',    sector:'Auto',         cap:'large'},
  {sym:'VEDL',       name:'Vedanta',                  sector:'Metals',       cap:'large'},
  {sym:'HINDZINC',   name:'Hindustan Zinc',           sector:'Metals',       cap:'large'},
  {sym:'IRFC',       name:'Indian Railway Finance',   sector:'Finance',      cap:'large'},
  {sym:'CHOLAFIN',   name:'Cholamandalam Finance',    sector:'Finance',      cap:'large'},
  {sym:'ZYDUSLIFE',  name:'Zydus Lifesciences',       sector:'Pharma',       cap:'large'},
  {sym:'TVSMOTOR',   name:'TVS Motor Company',        sector:'Auto',         cap:'large'},
  {sym:'LODHA',      name:'Macrotech Developers',     sector:'Realty',       cap:'large'},
  {sym:'SWIGGY',     name:'Swiggy',                   sector:'Food',         cap:'large'},
  {sym:'MANKIND',    name:'Mankind Pharma',           sector:'Pharma',       cap:'large'},
  {sym:'JSWENERGY',  name:'JSW Energy',               sector:'Energy',       cap:'large'},
  {sym:'ABCAPITAL',  name:'Aditya Birla Capital',     sector:'Finance',      cap:'large'},
  {sym:'CANBK',      name:'Canara Bank',              sector:'Banking',      cap:'large'},
  {sym:'UNIONBANK',  name:'Union Bank of India',      sector:'Banking',      cap:'large'},
  {sym:'MAXHEALTH',  name:'Max Healthcare',           sector:'Healthcare',   cap:'large'},
  {sym:'BAJAJHLDNG', name:'Bajaj Holdings',           sector:'Finance',      cap:'large'},
  {sym:'SOLARINDS',  name:'Solar Industries',         sector:'Defence',      cap:'large'},
  {sym:'NHPC',       name:'NHPC',                     sector:'Energy',       cap:'large'},
  {sym:'TATATECH',   name:'Tata Technologies',        sector:'IT',           cap:'large'},
  {sym:'PERSISTENT', name:'Persistent Systems',       sector:'IT',           cap:'large'},
  {sym:'BANKBARODA', name:'Bank of Baroda',           sector:'Banking',      cap:'large'},
  {sym:'ICICIGI',    name:'ICICI Lombard General Ins',sector:'Insurance',    cap:'large'},
  {sym:'ABB',        name:'ABB India',                sector:'Engineering',  cap:'large'},
  {sym:'ASHOKLEY',   name:'Ashok Leyland',            sector:'Auto',         cap:'large'},
  {sym:'COLPAL',     name:'Colgate-Palmolive India',  sector:'FMCG',         cap:'large'},
  {sym:'GAIL',       name:'GAIL India',               sector:'Energy',       cap:'large'},
  {sym:'GODREJPROP', name:'Godrej Properties',        sector:'Realty',       cap:'large'},
  {sym:'HINDPETRO',  name:'Hindustan Petroleum',      sector:'Energy',       cap:'large'},
  {sym:'JINDALSTEL', name:'Jindal Steel & Power',     sector:'Metals',       cap:'large'},
  {sym:'JIOFIN',     name:'Jio Financial Services',   sector:'Finance',      cap:'large'},
  {sym:'NMDC',       name:'NMDC',                     sector:'Metals',       cap:'large'},
  {sym:'PNB',        name:'Punjab National Bank',     sector:'Banking',      cap:'large'},
  {sym:'SAIL',       name:'Steel Authority of India', sector:'Metals',       cap:'large'},
  {sym:'UPL',        name:'UPL',                      sector:'Agro',         cap:'large'},

  // ── NIFTY MIDCAP 150 ─────────────────────────────────────────────
  {sym:'3MINDIA',    name:'3M India',                 sector:'Industrials',  cap:'mid'},
  {sym:'ABBOTINDIA', name:'Abbott India',             sector:'Pharma',       cap:'mid'},
  {sym:'ACC',        name:'ACC Ltd',                  sector:'Cement',       cap:'mid'},
  {sym:'ABFRL',      name:'Aditya Birla Fashion',     sector:'Retail',       cap:'mid'},
  {sym:'AIAENG',     name:'AIA Engineering',          sector:'Engineering',  cap:'mid'},
  {sym:'ALKEM',      name:'Alkem Laboratories',       sector:'Pharma',       cap:'mid'},
  {sym:'APLLTD',     name:'APL Apollo Tubes',         sector:'Metals',       cap:'mid'},
  {sym:'ASTRAL',     name:'Astral Ltd',               sector:'Chemicals',    cap:'mid'},
  {sym:'AUROPHARMA', name:'Aurobindo Pharma',         sector:'Pharma',       cap:'mid'},
  {sym:'BALKRISIND', name:'Balkrishna Industries',    sector:'Auto',         cap:'mid'},
  {sym:'BANDHANBNK', name:'Bandhan Bank',             sector:'Banking',      cap:'mid'},
  {sym:'BATAINDIA',  name:'Bata India',               sector:'Retail',       cap:'mid'},
  {sym:'BDL',        name:'Bharat Dynamics',          sector:'Defence',      cap:'mid'},
  {sym:'BHARATFORG', name:'Bharat Forge',             sector:'Auto',         cap:'mid'},
  {sym:'BHEL',       name:'BHEL',                     sector:'Industrials',  cap:'mid'},
  {sym:'BIOCON',     name:'Biocon',                   sector:'Pharma',       cap:'mid'},
  {sym:'BOSCHLTD',   name:'Bosch Ltd',                sector:'Auto',         cap:'mid'},
  {sym:'CANFINHOME', name:'Can Fin Homes',            sector:'Finance',      cap:'mid'},
  {sym:'CGPOWER',    name:'CG Power',                 sector:'Industrials',  cap:'mid'},
  {sym:'COFORGE',    name:'Coforge',                  sector:'IT',           cap:'mid'},
  {sym:'CONCOR',     name:'Container Corp',           sector:'Logistics',    cap:'mid'},
  {sym:'CROMPTON',   name:'Crompton Greaves',         sector:'Consumer',     cap:'mid'},
  {sym:'CUB',        name:'City Union Bank',          sector:'Banking',      cap:'mid'},
  {sym:'CYIENT',     name:'Cyient Ltd',               sector:'IT',           cap:'mid'},
  {sym:'CUMMINSIND', name:'Cummins India',            sector:'Engineering',  cap:'mid'},
  {sym:'DALBHARAT',  name:'Dalmia Bharat',            sector:'Cement',       cap:'mid'},
  {sym:'DEEPAKNTR',  name:'Deepak Nitrite',           sector:'Chemicals',    cap:'mid'},
  {sym:'DELTACORP',  name:'Delta Corp',               sector:'Media',        cap:'mid'},
  {sym:'DIXON',      name:'Dixon Technologies',       sector:'Electronics',  cap:'mid'},
  {sym:'ESCORTS',    name:'Escorts Kubota',           sector:'Auto',         cap:'mid'},
  {sym:'FEDERALBNK', name:'Federal Bank',             sector:'Banking',      cap:'mid'},
  {sym:'GLENMARK',   name:'Glenmark Pharma',          sector:'Pharma',       cap:'mid'},
  {sym:'GLAND',      name:'Gland Pharma',             sector:'Pharma',       cap:'mid'},
  {sym:'GNFC',       name:'Gujarat Narmada Fert.',    sector:'Chemicals',    cap:'mid'},
  {sym:'GODREJIND',  name:'Godrej Industries',        sector:'Conglomerate', cap:'mid'},
  {sym:'GUJGASLTD',  name:'Gujarat Gas',              sector:'Energy',       cap:'mid'},
  {sym:'HDFCAMC',    name:'HDFC AMC',                 sector:'Finance',      cap:'mid'},
  {sym:'HONAUT',     name:'Honeywell Automation',     sector:'Engineering',  cap:'mid'},
  {sym:'IDFCFIRSTB', name:'IDFC First Bank',          sector:'Banking',      cap:'mid'},
  {sym:'IDEA',       name:'Vodafone Idea',            sector:'Telecom',      cap:'mid'},
  {sym:'IEX',        name:'Indian Energy Exchange',   sector:'Energy',       cap:'mid'},
  {sym:'IGL',        name:'Indraprastha Gas',         sector:'Energy',       cap:'mid'},
  {sym:'IPCALAB',    name:'Ipca Laboratories',        sector:'Pharma',       cap:'mid'},
  {sym:'INDIAMART',  name:'IndiaMART',                sector:'IT',           cap:'mid'},
  {sym:'INDUSTOWER', name:'Indus Towers',             sector:'Telecom',      cap:'mid'},
  {sym:'INTELLECT',  name:'Intellect Design',         sector:'IT',           cap:'mid'},
  {sym:'JKCEMENT',   name:'JK Cement',               sector:'Cement',       cap:'mid'},
  {sym:'JUBLFOOD',   name:'Jubilant FoodWorks',       sector:'Food',         cap:'mid'},
  {sym:'KAJARIACER', name:'Kajaria Ceramics',         sector:'Consumer',     cap:'mid'},
  {sym:'KANSAINER',  name:'Kansai Nerolac',           sector:'Chemicals',    cap:'mid'},
  {sym:'LICHSGFIN',  name:'LIC Housing Finance',      sector:'Finance',      cap:'mid'},
  {sym:'LALPATHLAB', name:'Dr Lal PathLabs',          sector:'Healthcare',   cap:'mid'},
  {sym:'LTTS',       name:'L&T Technology Services',  sector:'IT',           cap:'mid'},
  {sym:'LUPIN',      name:'Lupin',                    sector:'Pharma',       cap:'mid'},
  {sym:'MGL',        name:'Mahanagar Gas',            sector:'Energy',       cap:'mid'},
  {sym:'MFSL',       name:'Max Financial Services',   sector:'Insurance',    cap:'mid'},
  {sym:'MPHASIS',    name:'Mphasis',                  sector:'IT',           cap:'mid'},
  {sym:'MRPL',       name:'MRPL',                     sector:'Energy',       cap:'mid'},
  {sym:'OBEROIRLTY', name:'Oberoi Realty',            sector:'Realty',       cap:'mid'},
  {sym:'OFSS',       name:'Oracle Financial Services',sector:'IT',           cap:'mid'},
  {sym:'PAGEIND',    name:'Page Industries',          sector:'Textile',      cap:'mid'},
  {sym:'PRICOLLTD',  name:'Pricol Ltd',               sector:'Auto',         cap:'mid'},
  {sym:'PETRONET',   name:'Petronet LNG',             sector:'Energy',       cap:'mid'},
  {sym:'PIRAMALFIN', name:'Piramal Finance',          sector:'Finance',      cap:'mid'},
  {sym:'PIIND',      name:'PI Industries',            sector:'Agro',         cap:'mid'},
  {sym:'POLICYBZR',  name:'PB Fintech',               sector:'Finance',      cap:'mid'},
  {sym:'PVRINOX',    name:'PVR INOX',                 sector:'Media',        cap:'mid'},
  {sym:'RBLBANK',    name:'RBL Bank',                 sector:'Banking',      cap:'mid'},
  {sym:'RAMCOCEM',   name:'Ramco Cements',            sector:'Cement',       cap:'mid'},
  {sym:'SBICARD',    name:'SBI Cards & Payment Svcs', sector:'Finance',      cap:'mid'},
  {sym:'SRF',        name:'SRF Ltd',                  sector:'Chemicals',    cap:'mid'},
  {sym:'STARHEALTH', name:'Star Health Insurance',    sector:'Insurance',    cap:'mid'},
  {sym:'SUNDARMFIN', name:'Sundaram Finance',         sector:'Finance',      cap:'mid'},
  {sym:'SUPREMEIND', name:'Supreme Industries',       sector:'Plastics',     cap:'mid'},
  {sym:'TATACOMM',   name:'Tata Communications',      sector:'Telecom',      cap:'mid'},
  {sym:'TATACHEM',   name:'Tata Chemicals',           sector:'Chemicals',    cap:'mid'},
  {sym:'TATAELXSI',  name:'Tata Elxsi',               sector:'IT',           cap:'mid'},
  {sym:'TATAPOWER',  name:'Tata Power',               sector:'Energy',       cap:'mid'},
  {sym:'TIINDIA',    name:'Tube Investments of India', sector:'Engineering', cap:'mid'},
  {sym:'TORNTPOWER', name:'Torrent Power',            sector:'Energy',       cap:'mid'},
  {sym:'TRENT',      name:'Trent Ltd',                sector:'Retail',       cap:'mid'},
  {sym:'TRIDENT',    name:'Trident Ltd',              sector:'Textile',      cap:'mid'},
  {sym:'UBL',        name:'United Breweries',         sector:'FMCG',         cap:'mid'},
  {sym:'VOLTAS',     name:'Voltas',                   sector:'Consumer',     cap:'mid'},
  {sym:'WHIRLPOOL',  name:'Whirlpool of India',       sector:'Consumer',     cap:'mid'},
  {sym:'ATGL',       name:'Adani Total Gas',          sector:'Energy',       cap:'mid'},
  {sym:'APLAPOLLO',  name:'APL Apollo Tubes',         sector:'Metals',       cap:'mid'},
  {sym:'ANGELONE',   name:'Angel One',                sector:'Finance',      cap:'mid'},
  {sym:'AUBANK',     name:'AU Small Finance Bank',    sector:'Banking',      cap:'mid'},
  {sym:'BSOFT',      name:'Birlasoft',                sector:'IT',           cap:'mid'},
  {sym:'BRIGADE',    name:'Brigade Enterprises',      sector:'Realty',       cap:'mid'},
  {sym:'CHOLAHLDNG', name:'Cholamandalam Inv & Fin',  sector:'Finance',      cap:'mid'},
  {sym:'COCHINSHIP', name:'Cochin Shipyard',          sector:'Defence',      cap:'mid'},
  {sym:'COROMANDEL', name:'Coromandel International', sector:'Agro',         cap:'mid'},
  {sym:'CRISIL',     name:'CRISIL',                   sector:'Finance',      cap:'mid'},
  {sym:'DOMS',       name:'DOMS Industries',          sector:'Consumer',     cap:'mid'},
  {sym:'ELGIEQUIP',  name:'Elgi Equipments',          sector:'Engineering',  cap:'mid'},
  {sym:'EMAMILTD',   name:'Emami',                    sector:'FMCG',         cap:'mid'},
  {sym:'FINCABLES',  name:'Finolex Cables',           sector:'Engineering',  cap:'mid'},
  {sym:'FLUOROCHEM', name:'Gujarat Fluorochemicals',  sector:'Chemicals',    cap:'mid'},
  {sym:'GPPL',       name:'Gujarat Pipavav Port',     sector:'Logistics',    cap:'mid'},
  {sym:'GRINDWELL',  name:'Grindwell Norton',         sector:'Engineering',  cap:'mid'},
  {sym:'HFCL',       name:'HFCL',                     sector:'Telecom',      cap:'mid'},
  {sym:'IIFL',       name:'IIFL Finance',             sector:'Finance',      cap:'mid'},
  {sym:'IRCTC',      name:'IRCTC',                    sector:'Logistics',    cap:'mid'},
  {sym:'JKPAPER',    name:'JK Paper',                 sector:'Paper',        cap:'mid'},
  {sym:'JSWINFRA',   name:'JSW Infrastructure',       sector:'Logistics',    cap:'mid'},
  {sym:'KPITTECH',   name:'KPIT Technologies',        sector:'IT',           cap:'mid'},
  {sym:'KALYANKJIL', name:'Kalyan Jewellers',         sector:'Retail',       cap:'mid'},
  {sym:'KENNAMET',   name:'Kennametal India',         sector:'Engineering',  cap:'mid'},
  {sym:'LAURUSLABS',  name:'Laurus Labs',             sector:'Pharma',       cap:'mid'},
  {sym:'MAZDOCK',    name:'Mazagon Dock',             sector:'Defence',      cap:'mid'},
  {sym:'METROPOLIS', name:'Metropolis Healthcare',    sector:'Healthcare',   cap:'mid'},
  {sym:'NAVINFLUOR', name:'Navin Fluorine',           sector:'Chemicals',    cap:'mid'},
  {sym:'NUVOCO',     name:'Nuvoco Vistas Corp',       sector:'Cement',       cap:'mid'},
  {sym:'OLECTRA',    name:'Olectra Greentech',        sector:'Auto',         cap:'mid'},
  {sym:'PGHH',       name:'Procter & Gamble Hygiene', sector:'FMCG',         cap:'mid'},
  {sym:'PNBHOUSING', name:'PNB Housing Finance',      sector:'Finance',      cap:'mid'},
  {sym:'RADICO',     name:'Radico Khaitan',           sector:'FMCG',         cap:'mid'},
  {sym:'RAINBOW',    name:'Rainbow Childrens Med',    sector:'Healthcare',   cap:'mid'},
  {sym:'RITES',      name:'RITES Ltd',                sector:'Logistics',    cap:'mid'},
  {sym:'ROUTE',      name:'Route Mobile',             sector:'IT',           cap:'mid'},
  {sym:'SCHAEFFLER', name:'Schaeffler India',         sector:'Auto',         cap:'mid'},
  {sym:'SUNDRMFAST', name:'Sundram Fasteners',        sector:'Auto',         cap:'mid'},
  {sym:'SUVEN',      name:'Suven Pharmaceuticals',    sector:'Pharma',       cap:'mid'},
  {sym:'TEAMLEASE',  name:'TeamLease Services',       sector:'Services',     cap:'mid'},
  {sym:'THERMAX',    name:'Thermax',                  sector:'Engineering',  cap:'mid'},
  {sym:'TIMKEN',     name:'Timken India',             sector:'Engineering',  cap:'mid'},
  {sym:'UFLEX',      name:'UFLEX',                    sector:'Plastics',     cap:'mid'},
  {sym:'UTIAMC',     name:'UTI AMC',                  sector:'Finance',      cap:'mid'},
  {sym:'VIJAYA',     name:'Vijaya Diagnostic Centre', sector:'Healthcare',   cap:'mid'},
  {sym:'WONDERLA',   name:'Wonderla Holidays',        sector:'Hospitality',  cap:'mid'},
  {sym:'ZEEL',       name:'Zee Entertainment',        sector:'Media',        cap:'mid'},
];

// ═══════════════════════════════════
//  STATE
// ═══════════════════════════════════
let dataSource = null; // 'yahoo' | 'nse' | 'ai'
let aiReady    = false;
let stockData  = {};
let indexData  = {};
let marketUp   = null;
let marketOpen = null;
let paused     = false;
let countdownSec  = 60; // initialised before getRefreshInterval() is first called in startCountdown()
let countdownTimer = null;
let stockFilters   = new Set(); // empty = show all; multi-select AND logic
let activeSetupCard = null;     // tracks which setup card is currently selected
let currentSort    = { col:'change', dir:-1 };
let etfFilters     = new Set(); // empty = show all; multi-select AND logic
let _etfRenderTimer = null;
// scheduleETFRender — coalesces background batch re-renders to ≤1 per 400ms.
// Direct user interactions (sector select, filter click) call renderETFSection() immediately.
function scheduleETFRender() {
  if (currentView !== 'etfs') return; // don't re-render ETF table when on stock tab
  if (_etfRenderTimer) return;
  _etfRenderTimer = setTimeout(() => { _etfRenderTimer = null; renderETFSection(); }, 400);
}

// scheduleTableRender — debounced renderTable for SSE streaming (coalesces per-symbol renders)
let _tableRenderTimer = null;
function scheduleTableRender() {
  if (_tableRenderTimer) return;
  _tableRenderTimer = setTimeout(() => {
    _tableRenderTimer = null;
    renderTable();
    if (currentView === 'etfs') renderETFSection();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  }, 250);
}

// openSSEStream — opens an EventSource to a streaming endpoint, calling onData for each parsed event.
// Returns a Promise that resolves when the stream is done or times out. Falls back gracefully on error.
function openSSEStream(url, onData, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve) => {
    let es;
    try { es = new EventSource(url); } catch(e) { 
      console.error('EventSource creation failed:', e.message);
      resolve({ ok: false, error: e.message }); 
      return; 
    }
    const cleanup = () => { try { es.close(); } catch(_) {} };
    const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: 'timeout after ' + timeoutMs + 'ms' }); }, timeoutMs);
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.done) { clearTimeout(timer); cleanup(); resolve({ ok: true }); return; }
        if (msg.error) { console.warn('SSE stream error event:', msg.error); return; }
        onData(msg);
      } catch(e) { console.warn('SSE parse error:', e.message, 'data:', event.data.substring(0, 100)); }
    };
    es.onerror = (err) => { clearTimeout(timer); cleanup(); console.error('SSE connection error:', err); resolve({ ok: false, error: 'connection error' }); };
  });
}
const sparklineData = {};  // sym -> normalised % array from /sparklines
const intradayData = {};   // sym -> short-term VWAP/EMA/RSI/ATR setup
let intradayDataUpdateCount = 0;  // track how many times we store intraday data
const setupOutcomeTracker = new Map(); // setup key -> rolling max favorable/adverse move
const simulationPreviousSignalCandidates = new Map(); // sym -> previous refresh candidate for confirmation
const INTRADAY_STALE_MS = 5 * 60 * 1000;
let paperTrades = [];      // local paper trades loaded from proxy JSON file
let paperTradesLoaded = false;
let paperTradesLoading = null;
let paperTradesStream = null;
let paperTradesStreamReconnectTimer = null;
let etfSort        = { col:'change', dir:-1 };
let etfSearch      = '';
let targetFilter   = 'all';
let activeSectors  = new Set();   // sectors clicked in heatmap, empty = show all (supports multi-select)
let EXTRA_SYMBOLS = []; // user-added ETF/custom symbols (keeps track to avoid duplicates)
let ETF_ASSETS = [];
let etfListLoaded = false; // true when loaded from /etf-list (NSE batch)
let STOCK_EXTRA_SYMBOLS = [];
let STOCK_ASSETS = [];
const sectorTrendCache = {};
const PORTFOLIO_FALLBACK_INITIAL_CAPITAL = 500000;
const TRADE_RULE_DEFAULTS = TradeRules.DEFAULT_SETTINGS;
const MAX_POSITION_EXPOSURE = TRADE_RULE_DEFAULTS.MAX_POSITION_EXPOSURE;
let portfolioState = { initialCapital: PORTFOLIO_FALLBACK_INITIAL_CAPITAL, capitalAdds: [] };
const TRADE_RISK_PCT = Number(localStorage.getItem('trade-risk-pct') || TRADE_RULE_DEFAULTS.TRADE_RISK_PCT);
const MIN_NET_PROFIT_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MIN_NET_PROFIT_PCT;
const SIMULATION_MIN_NET_PROFIT_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MIN_NET_PROFIT_PCT;
const SIMULATION_STATE_KEY = 'stock-watcher-simulation-state';
const SIMULATION_NEW_TRADES_KEY = 'stock-watcher-new-simulation-trades';
const SIMULATION_MAX_OPEN = TRADE_RULE_DEFAULTS.SIMULATION_MAX_OPEN;
const SIMULATION_MAX_ACTIVE_OPEN = TRADE_RULE_DEFAULTS.SIMULATION_MAX_ACTIVE_OPEN;
const SIMULATION_TOP_N = TRADE_RULE_DEFAULTS.SIMULATION_TOP_N;
const SIMULATION_DAILY_MAX_TRADES = TRADE_RULE_DEFAULTS.SIMULATION_DAILY_MAX_TRADES;
const SIMULATION_DAILY_MAX_STOPS = TRADE_RULE_DEFAULTS.SIMULATION_DAILY_MAX_STOPS;
const SIMULATION_OVERRIDE_STOP_GUARD = !!TRADE_RULE_DEFAULTS.SIMULATION_OVERRIDE_STOP_GUARD;
const SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER = TRADE_RULE_DEFAULTS.SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER;
const SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT = TRADE_RULE_DEFAULTS.SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT;
const SIMULATION_DAILY_MAX_NET_LOSS_PCT = TRADE_RULE_DEFAULTS.SIMULATION_DAILY_MAX_NET_LOSS_PCT;
const SIMULATION_SYMBOL_COOLDOWN_MIN = TRADE_RULE_DEFAULTS.SIMULATION_SYMBOL_COOLDOWN_MIN;
const SIMULATION_SETUP_COOLDOWN_MIN = TRADE_RULE_DEFAULTS.SIMULATION_SETUP_COOLDOWN_MIN;
const SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT = TRADE_RULE_DEFAULTS.SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT;
const SIMULATION_FIRST_HOUR_MAX_ENTRIES = TRADE_RULE_DEFAULTS.SIMULATION_FIRST_HOUR_MAX_ENTRIES;
const SIMULATION_STOP_GRACE_MIN = TRADE_RULE_DEFAULTS.SIMULATION_STOP_GRACE_MIN;
const SIMULATION_STOP_CONFIRM_BARS = TRADE_RULE_DEFAULTS.SIMULATION_STOP_CONFIRM_BARS;
const SIMULATION_EMERGENCY_STOP_PCT = TRADE_RULE_DEFAULTS.SIMULATION_EMERGENCY_STOP_PCT;
const SIMULATION_RUNNER_MIN_SCORE = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_MIN_SCORE;
const SIMULATION_RUNNER_MIN_REL_VOL = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_MIN_REL_VOL;
const SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT;
const SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT;
const SIMULATION_RUNNER_TRAIL_PCT = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_TRAIL_PCT;
const SIMULATION_RUNNER_WIDE_TRAIL_PCT = TRADE_RULE_DEFAULTS.SIMULATION_RUNNER_WIDE_TRAIL_PCT;
const SIMULATION_BREAKEVEN_PROTECT_PCT = TRADE_RULE_DEFAULTS.SIMULATION_BREAKEVEN_PROTECT_PCT;
const SIMULATION_TRAIL_START_PCT = TRADE_RULE_DEFAULTS.SIMULATION_TRAIL_START_PCT;
const SIMULATION_LONG_TRAIL_PCT = TRADE_RULE_DEFAULTS.SIMULATION_LONG_TRAIL_PCT;
const SIMULATION_TIME_STOP_MIN = TRADE_RULE_DEFAULTS.SIMULATION_TIME_STOP_MIN;
const SIMULATION_TIME_STOP_MIN_PROFIT_PCT = TRADE_RULE_DEFAULTS.SIMULATION_TIME_STOP_MIN_PROFIT_PCT;
const SIMULATION_TARGET_PARTIAL_QTY_PCT = TRADE_RULE_DEFAULTS.SIMULATION_TARGET_PARTIAL_QTY_PCT;
const SIMULATION_TARGET_RUNNER_MIN_SCORE = TRADE_RULE_DEFAULTS.SIMULATION_TARGET_RUNNER_MIN_SCORE;
const SIMULATION_TARGET_RUNNER_MIN_REL_VOL = TRADE_RULE_DEFAULTS.SIMULATION_TARGET_RUNNER_MIN_REL_VOL;
const SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN = TRADE_RULE_DEFAULTS.SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN;
const SIMULATION_VWAP_CONT_MIN_SCORE = TRADE_RULE_DEFAULTS.SIMULATION_VWAP_CONT_MIN_SCORE;
const SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT = TRADE_RULE_DEFAULTS.SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT;
const SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT = TRADE_RULE_DEFAULTS.SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT;
const SIMULATION_MAX_NEW_PER_CYCLE = TRADE_RULE_DEFAULTS.SIMULATION_MAX_NEW_PER_CYCLE;
const SIMULATION_MIN_SCORE = TRADE_RULE_DEFAULTS.SIMULATION_MIN_SCORE;
const SIMULATION_SHORT_MIN_SCORE = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_MIN_SCORE;
const SIMULATION_SHORT_MIN_REL_VOL = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_MIN_REL_VOL;
const SIMULATION_SHORT_ALLOW_AVOID_GUARD = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_ALLOW_AVOID_GUARD;
const SIMULATION_SHORT_TRIGGER_DISTANCE_PCT = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_TRIGGER_DISTANCE_PCT;
const SIMULATION_SHORT_CONFIRM_BARS = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_CONFIRM_BARS;
const SIMULATION_SHORT_MAX_STOP_PCT = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_MAX_STOP_PCT;
const SIMULATION_SHORT_TRAIL_PCT = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_TRAIL_PCT;
const SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS = TRADE_RULE_DEFAULTS.SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS;
const SIMULATION_MARKET_BREADTH_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MARKET_BREADTH_PCT;
const SIMULATION_MARKET_REGIME_NIFTY_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MARKET_REGIME_NIFTY_PCT;
const SIMULATION_MARKET_REGIME_SECTOR_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MARKET_REGIME_SECTOR_PCT;
const SIMULATION_MARKET_REGIME_RS_PCT = TRADE_RULE_DEFAULTS.SIMULATION_MARKET_REGIME_RS_PCT;
const SIMULATION_AUTO_SHORTS = TRADE_RULE_DEFAULTS.SIMULATION_AUTO_SHORTS;
const SIMULATION_AUTO_MANUAL_EXITS = !!TRADE_RULE_DEFAULTS.SIMULATION_AUTO_MANUAL_EXITS;
const BROKER_MODE_KEY = 'stock-watcher-broker-mode';
let simulationState = localStorage.getItem(SIMULATION_STATE_KEY) || 'off'; // off | running | settling
let simulationBusy = false;
let brokerMode = ['paper', 'zerodha_dry_run', 'zerodha_live', 'sharekhan_live'].includes(localStorage.getItem(BROKER_MODE_KEY))
  ? localStorage.getItem(BROKER_MODE_KEY)
  : 'paper';
let brokerConnectionStatus = null; // { mode, zerodha: { credentialsLoaded, clientsInitialized, pollerRunning, failureCount, isDisabled } }
let brokerRefreshState = { busy:false, ok:null, message:'' };
let zerodhaPortfolioState = { loading:false, ok:false, data:null, error:'' };
let zerodhaPositionsPanelOpen = false;
const COLUMN_PRESET_KEY = 'stock-watcher-column-preset';
let columnPreset = localStorage.getItem(COLUMN_PRESET_KEY) || 'trading';
let notificationsOpen = false;
let newSimulationTradeKeys = loadNewSimulationTradeKeys();
let openTradesModalMode = 'all'; // all | new
let freshNewsSummary = { loading:false, loaded:false, date:null, count:0, symbolCount:0, items:[], scanned:0, error:'' };
let freshNewsLastFetchAt = 0;
let freshNewsBusy = false;
const FRESH_NEWS_PAGE_SIZE = 25;
let freshNewsOffset = 0;
let secondaryLoadActive = false;
let fundamentalsBackgroundStarted = false;
const detailMetadataLoading = new Set();
const detailMetadataAttempted = new Set();
let lastDashboardRefreshAt = null;
let tableRenderScheduled = false;
let tableRenderPending = false;
let dashboardRenderScheduled = false;
let simulationCycleTimer = null;
let openTradesModalSort = { col:'time', dir:-1 }; // time desc by default

function yieldToBrowser() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function scheduleWork(fn, delay = 0) {
  return setTimeout(() => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => fn(), { timeout: 800 });
    } else {
      fn();
    }
  }, delay);
}

// Broker mode helpers
function isZerodhaLive() { return brokerMode === 'zerodha_live'; }
function isZeodhaMode() { return brokerMode.startsWith('zerodha'); }

function startSimulationCycleTimer() {
  if (simulationCycleTimer) return;
  // Keep exits progressing even when feed events are sparse; ensures EOD settlement execution.
  simulationCycleTimer = setInterval(() => {
    runSimulationCycle({ allowEntries:false }).catch(e => console.warn('simulation timer cycle failed', e.message));
  }, 15000);
}

const PRESET_ETFS = [
  { sym:'NIFTYBEES',   name:'Nippon India Nifty 50 BeES',               sector:'ETF', cap:'etf' },
  { sym:'JUNIORBEES',  name:'Nippon India Nifty Next 50 BeES',          sector:'ETF', cap:'etf' },
  { sym:'GOLDBEES',    name:'Nippon India Gold ETF',                    sector:'ETF', cap:'etf' },
  { sym:'KOTAKGOLD',   name:'Kotak Gold ETF',                           sector:'ETF', cap:'etf' },
  { sym:'SBIGETS',     name:'SBI ETF Gold',                             sector:'ETF', cap:'etf' },
  { sym:'NIFTYINFRA',  name:'Nippon India Nifty Infrastructure ETF',    sector:'ETF', cap:'etf' },
  { sym:'CPSE',        name:'CPSE ETF',                                 sector:'ETF', cap:'etf' },
  { sym:'DIVOPPS',     name:'Nippon India Nifty Dividend Opportunities',sector:'ETF', cap:'etf' },
  { sym:'UTIETF',      name:'UTI Nifty 50 ETF',                         sector:'ETF', cap:'etf' },
  { sym:'KOTAKNIFTY',  name:'Kotak Nifty ETF',                          sector:'ETF', cap:'etf' },
  { sym:'NIPPOFFSH',   name:'Nippon India ETF Offshore',                sector:'ETF', cap:'etf' },
  { sym:'HDFCNETF',    name:'HDFC Nifty ETF',                           sector:'ETF', cap:'etf' },
  { sym:'BANKBEES',    name:'BANKBEES Nifty Bank ETF',                  sector:'Bank', cap:'etf' },
  { sym:'ITBEES',      name:'ITBEES Nifty IT ETF',                      sector:'IT', cap:'etf' },
  { sym:'PHARMABEES',  name:'Pharma BeES Nifty Pharma ETF',             sector:'Pharma', cap:'etf' },
];


// ═══════════════════════════════════
//  CLOCK
// ═══════════════════════════════════
function updateClock() {
  const ist = new Date(Date.now() + 5.5*3600*1000);
  document.getElementById('clock').textContent = ist.toISOString().replace('T',' ').slice(0,19)+' IST';
}
setInterval(updateClock, 1000); updateClock();

function setProgress(pct) {
  const lp = document.getElementById('loading-prog'); if(lp) lp.style.width = pct+'%';
}

// ═══════════════════════════════════
//  SOURCE PANEL
// ═══════════════════════════════════
function selectSource(src) {
  if (!src) return;
  const card = document.getElementById('card-'+src);
  if (!card) {
    console.warn('Source card not found:', src);
    return;
  }
  document.querySelectorAll('.source-card').forEach(c=>c.classList.remove('selected'));
  card.classList.add('selected');
  ['yahoo','nse','ai'].forEach(s => {
    const extra = document.getElementById('extra-'+s);
    if (extra) extra.style.display = s===src ? 'block' : 'none';
  });
  document.getElementById('connect-err-yahoo').textContent='';
  document.getElementById('connect-err-nse').textContent='';
  document.getElementById('connect-err-ai').textContent='';
  const psy = document.getElementById('proxy-status-yahoo'); if(psy) psy.style.display='none';
  const psn = document.getElementById('proxy-status-nse'); if(psn) psn.style.display='none';
}

function changeSource() {
  dataSource=null; stockData={}; indexData={}; ETF_ASSETS=[]; etfListLoaded=false; etfSectorFilter=''; etfFilters=new Set(); stockFilters=new Set();
  clearInterval(countdownTimer);
  ['source-panel'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='block'; });
  ['index-bar','sector-section','main-section',
   'pause-btn','change-src-btn','source-indicator','top-action-bar','dashboard-health-banner','notification-panel']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
}

function activateDashboard(src) {
  const sp = document.getElementById('source-panel'); if(sp) sp.style.display = 'none';
  const ib = document.getElementById('index-bar'); if(ib) ib.style.display = 'grid';
  ['sector-section','main-section'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='block'; });
  const actionBar = document.getElementById('top-action-bar'); if(actionBar) actionBar.style.display='flex';
  ['pause-btn','change-src-btn','broker-mode-btn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });
  updateSimulationButton();

  const si = document.getElementById('source-indicator');
  if(si) si.style.display = 'inline-block';
  if (src==='yahoo') { si.textContent='💜 Yahoo Finance'; si.className='source-indicator yahoo'; }
  else if (src==='nse') { si.textContent='🏛️ NSE Direct'; si.className='source-indicator nse'; }
  else { si.textContent='🤖 AI Mode'; si.className='source-indicator ai'; }

  renderDashboardShell('Preparing live rows...');
  fetchAll();
  if (currentView === 'etfs') setView('etfs', document.getElementById('tab-etfs')).catch(e => console.warn('initial ETF view failed', e.message));
  else setView('stocks', document.getElementById('tab-stocks')).catch(e => console.warn('initial stock view failed', e.message));
  startCountdown();
  // Background: check NSE index membership for quarterly rebalancing (cached 24h on proxy)
  refreshIndexMembership().catch(e => console.warn('[index-membership]', e.message));
}

function renderDashboardShell(message = 'Loading live data...') {
  renderIndices();
  renderSectors();
  renderTable({ immediate:true });
  renderTopActionBar();
  const status = document.getElementById('status-bar');
  if (status) {
    status.className = '';
    status.textContent = message;
  }
}

// ═══════════════════════════════════
//  PROXY CHECK
// ═══════════════════════════════════
async function checkProxy() {
  const r = await fetch(PROXY+'/health', { signal: AbortSignal.timeout(4000) });
  const j = await r.json();
  if (!j.ok) throw new Error('Proxy unhealthy');
  return j;
}

// ═══════════════════════════════════
//  YAHOO FINANCE
// ═══════════════════════════════════
async function connectYahoo() {
  const ps=document.getElementById('proxy-status-yahoo');
  const ce=document.getElementById('connect-err-yahoo');
  ps.style.display='block'; ps.className='proxy-status'; ps.textContent='⏳ Checking proxy…'; ce.textContent='';
  try {
    await checkProxy();
    ps.className='proxy-status ok'; ps.textContent='✓ Proxy running! Loading dashboard…';
    dataSource='yahoo'; activateDashboard('yahoo');
  } catch(e) {
    ps.style.display='none';
    ce.textContent='✗ Cannot reach backend proxy. Start Remix server (or node ticker_proxy.js for standalone mode).';
  }
}

async function fetchYahooIndices() {
  const r   = await fetch(PROXY+'/yahoo/indices', { signal: AbortSignal.timeout(15000) });
  const raw = await r.json();
  // Proxy now returns { nifty50: {price, change}, midcap: ..., ... } directly
  if (raw && raw.nifty50) {
    indexData = raw;
  }
}

function applyYahooQuotes(quotes) {
  let changed = false;
  let sawMarketState = false;
  let hasRegularSession = false;
  for (const [sym, q] of Object.entries(quotes || {})) {
    if (!q) continue;
    const marketState = String(q.marketState || '').toUpperCase();
    if (marketState) {
      sawMarketState = true;
      if (/REGULAR|OPEN/.test(marketState)) hasRegularSession = true;
    }
    const prev = stockData[sym] || {};
    stockData[sym] = {
      price    : q.price    || prev.price    || 0,
      change   : (q.change  != null) ? q.change  : (prev.change  ?? 0),
      high52   : q.high52   || prev.high52   || 0,
      low52    : q.low52    || prev.low52    || 0,
      volume   : q.volume   || prev.volume   || 0,
      open     : q.open     || prev.open     || 0,
      prevClose: q.prevClose || prev.prevClose || 0,
    };
    changed = true;
  }
  if (sawMarketState) marketOpen = hasRegularSession;
  return changed;
}

async function fetchYahooStocks(firstLoad = false) {
  const symbols = MIDCAP_STOCKS.map(s=>s.sym);
  const totalRefreshUniverse = MIDCAP_STOCKS.length + STOCK_ASSETS.length;
  if (firstLoad) {
    document.getElementById('loading-msg').textContent = 'Fetching Yahoo Finance data…';
    document.getElementById('loading-sub').textContent = 'Source: query1.finance.yahoo.com/v8/finance/chart (crumb-free)';
    setProgress(15);
  }

  if (firstLoad) {
    try {
      const r = await fetch(`${PROXY}/dashboard-market?symbols=${encodeURIComponent(symbols.join(','))}`, { signal: AbortSignal.timeout(45000) });
      const payload = await r.json().catch(() => ({}));
      if (r.ok && payload?.ok) {
        if (payload.indices?.nifty50) indexData = payload.indices;
        const changed = applyYahooQuotes(payload.quotes || {});
        if (changed) {
          setProgress(90);
          setBgProgress(90);
          renderMarketStatus();
          renderSectors();
          renderTable({ immediate:true });
          if (currentView === 'etfs') renderETFSection();
          await yieldToBrowser();
          return;
        }
      }
    } catch(e) {
      console.warn('dashboard-market failed, falling back to batches:', e.message);
    }
  }

  const batchSize = 25;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const pct = Math.round(((i + batchSize) / symbols.length) * 100);

    if (firstLoad) {
      document.getElementById('loading-msg').textContent =
        `Fetching Yahoo Finance… (${i+1}–${Math.min(i+batchSize, symbols.length)} of ${symbols.length})`;
      setProgress(15 + ((i / symbols.length) * 75));
    } else {
      const total = Math.max(totalRefreshUniverse, symbols.length);
      showBgRefreshing(`Refreshing ${i+1}–${Math.min(i+batchSize, symbols.length)} of ${total}…`);
      setBgProgress(20 + (i / symbols.length) * 75);
    }

    try {
      const url = `${PROXY}/yahoo?symbols=${encodeURIComponent(batch.join(','))}`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const raw = await r.json();
      const changed = applyYahooQuotes(raw?.quotes || {});
      // Render incrementally after each batch so UI stays live
      if (changed) {
        renderMarketStatus();
        renderSectors();
        renderTable();
        if (currentView === 'etfs') renderETFSection();
        await yieldToBrowser();
      }
    } catch(e) {
      console.warn('Yahoo batch error:', e.message);
    }

    if (i + batchSize < symbols.length) await new Promise(r=>setTimeout(r, 200));
  }
  renderMarketStatus();
}

// ═══════════════════════════════════
//  NSE DIRECT
// ═══════════════════════════════════
async function connectNSE() {
  const ps=document.getElementById('proxy-status-nse');
  const ce=document.getElementById('connect-err-nse');
  ps.style.display='block'; ps.className='proxy-status'; ps.textContent='⏳ Checking proxy…'; ce.textContent='';
  try {
    await checkProxy();
    ps.className='proxy-status ok'; ps.textContent='✓ Proxy running! Loading dashboard…';
    dataSource='nse'; activateDashboard('nse');
  } catch(e) {
    ps.style.display='none';
    ce.textContent='✗ Cannot reach backend proxy. Start Remix server (or node ticker_proxy.js for standalone mode).';
  }
}

async function nseGet(path) {
  const r = await fetch(`${PROXY}/nse?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`NSE proxy ${r.status}`);
  return r.json();
}

async function fetchNSEIndices() {
  const data = await nseGet('/api/allIndices');
  const items = data.data || [];
  const find = n => items.find(i=>i.indexSymbol===n||i.index===n);
  function toIdx(d) { return d ? { price: parseFloat(d.last||d.indexValue||0), change: parseFloat(d.percentChange||d.pChange||0) } : null; }
  indexData = {
    nifty50  : toIdx(find('NIFTY 50')          || find('Nifty 50')),
    midcap   : toIdx(find('NIFTY MIDCAP 150')  || find('Nifty Midcap 150')),
    smallcap : toIdx(find('NIFTY SMLCAP 100')  || find('Nifty Smallcap 100')),
    banknifty: toIdx(find('NIFTY BANK')         || find('Nifty Bank')),
  };
}

async function fetchNSEMarketStatus() {
  try {
    const data = await nseGet('/api/marketStatus');
    const states = Array.isArray(data?.marketState) ? data.marketState : [];
    const seg = states.find(s => /capital\s*market/i.test(String(s?.market || '')))
      || states.find(s => /equity|capital|cm/i.test(String(s?.market || '')))
      || null;
    const statusText = String(seg?.marketStatus || '').toLowerCase();
    if (statusText.includes('open')) marketOpen = true;
    else if (statusText.includes('close')) marketOpen = false;
    else marketOpen = isMarketHoursNow();
    renderMarketStatus();
  } catch(e) { console.warn('NSE market status:', e.message); }
}

async function fetchNSEStocks(firstLoad = false) {
  if (firstLoad) {
    document.getElementById('loading-msg').textContent = 'Fetching Nifty Midcap 150 from NSE…';
    document.getElementById('loading-sub').textContent = 'Source: nseindia.com/api/equity-stockIndices';
    setProgress(20);
  } else {
    showBgRefreshing('Refreshing NSE data…');
    setBgProgress(25);
  }
  const data  = await nseGet('/api/equity-stockIndices?index=NIFTY%20MIDCAP%20150');
  const items = data.data || [];
  for (const item of items) {
    const sym = item.symbol; if (!sym) continue;
    stockData[sym] = {
      price    : parseFloat(item.lastPrice||item.ltp||0),
      change   : parseFloat(item.pChange||item.perChange||0),
      high52   : parseFloat(item.yearHigh||0),
      low52    : parseFloat(item.yearLow||0),
      volume   : parseInt(item.totalTradedVolume||0,10),
      open     : parseFloat(item.open||0),
      prevClose: parseFloat(item.previousClose||0),
    };
  }
  // Render immediately after bulk fetch so table is live
  renderTable(firstLoad ? { immediate:true } : undefined);
  renderSectors();
  if (firstLoad) {
    setProgress(80);
    setBgProgress(80);
    await yieldToBrowser();
  } else setBgProgress(75);

  // Fill missing symbols
  const missing = MIDCAP_STOCKS.filter(s=>!stockData[s.sym]||stockData[s.sym].price===0);
  if (missing.length && missing.length<=15) {
    for (const s of missing) {
      try {
        const q  = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(s.sym)}`);
        const pd = q.priceInfo||{};
        stockData[s.sym] = { price:parseFloat(pd.lastPrice||0), change:parseFloat(pd.pChange||0), high52:parseFloat(pd.weekHighLow?.max||0), low52:parseFloat(pd.weekHighLow?.min||0), volume:0, open:parseFloat(pd.open||0), prevClose:parseFloat(pd.previousClose||0) };
        renderTable();
      } catch(e) {}
      await new Promise(r=>setTimeout(r,120));
    }
  }
}

// ═══════════════════════════════════
//  AI MODE
// ═══════════════════════════════════
async function connectAI() {
  const ce=document.getElementById('connect-err-ai');
  ce.textContent='Checking OpenAI proxy...';
  try {
    const r = await fetch(`${OPENAI_ENDPOINT}/status`);
    const data = await r.json().catch(()=>({}));
    if (!r.ok || !data.configured) throw new Error(data.error || 'OPENAI_API_KEY is not configured in the proxy');
    aiReady=true; dataSource='ai'; ce.textContent='';
    activateDashboard('ai');
  } catch(e) {
    aiReady=false;
    ce.textContent=`OpenAI not ready: ${e.message}. Start proxy with OPENAI_API_KEY.`;
  }
}

async function callOpenAI(prompt, opts = {}) {
  const r = await fetch(OPENAI_ENDPOINT, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      prompt,
      mode: opts.mode || 'json',
      maxOutputTokens: opts.maxOutputTokens || 2000,
      webSearch: opts.webSearch !== false,
    })
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function extractJSON(data) {
  const txt=data.output_text || data.text || (data.content || []).filter(b=>b.type==='text').map(b=>b.text).join('');
  const clean=txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  try{return JSON.parse(clean);}catch(e){const m=clean.match(/\{[\s\S]*\}/);if(m){try{return JSON.parse(m[0]);}catch(e2){}}return null;}
}

async function fetchAIData(firstLoad = false) {
  if (firstLoad) {
    document.getElementById('loading-msg').textContent='Fetching indices via AI…';
    setProgress(10);
  } else {
    showBgRefreshing('Refreshing via AI…');
    setBgProgress(10);
  }
  try {
    const d=await callOpenAI(`Current prices of: Nifty 50, Bank Nifty, Nifty Midcap 150, Nifty Smallcap 100.
Return raw JSON only: {"nifty50":{"price":24500,"change":0.45},"banknifty":{"price":52000,"change":-0.2},"midcap":{"price":12500,"change":0.3},"smallcap":{"price":8900,"change":0.15}}`);
    const p=extractJSON(d); if(p) indexData=p;
  } catch(e){console.warn('AI indices:',e.message);}
  if (firstLoad) setProgress(20); else setBgProgress(20);
  if (!firstLoad) { renderIndices(); renderSectors(); }

  const batches=[];
  for (let i=0;i<MIDCAP_STOCKS.length;i+=20) batches.push(MIDCAP_STOCKS.slice(i,i+20));
  for (let bi=0;bi<batches.length;bi++) {
    const batch=batches[bi];
    const pct = 20 + ((bi+1)/batches.length)*70;
    if (firstLoad) {
      document.getElementById('loading-msg').textContent=`AI fetch batch ${bi+1}/${batches.length}…`;
      document.getElementById('loading-sub').textContent=batch.map(s=>s.sym).join(', ');
      setProgress(pct);
    } else {
      showBgRefreshing(`AI batch ${bi+1}/${batches.length}…`);
      setBgProgress(pct);
    }
    const syms=batch.map(s=>s.sym).join(', ');
    try {
      const d=await callOpenAI(`NSE stock prices for: ${syms}. Raw JSON only: {"SYMBOL":{"price":1234.5,"change":1.23,"high52":1500,"low52":900,"volume":1250000}}`);
      const p=extractJSON(d); if(p) Object.assign(stockData,p);
      // Render incrementally in background mode
      if (!firstLoad) { renderTable(); renderSectors(); }
    } catch(e){console.warn(`AI batch ${bi+1}:`,e);}
    if (bi<batches.length-1) await new Promise(r=>setTimeout(r,400));
  }
}

// ═══════════════════════════════════
//  BACKGROUND REFRESH HELPERS
// ═══════════════════════════════════
let isFirstLoad = true;
let bgRefreshActive = false;

function setBgProgress(pct) {
  const bar = document.getElementById('bg-progress-bar');
  if (!bar) return;
  bar.style.width = pct + '%';
  if (pct > 0) bar.classList.add('active');
  else { bar.classList.remove('active'); bar.style.width = '0'; }
}

function showBgRefreshing(text) {
  const pill = document.getElementById('bg-refresh-pill');
  const txt  = document.getElementById('bg-refresh-txt');
  if (pill) pill.classList.add('show');
  if (txt)  txt.textContent = text || 'Refreshing…';
}

function hideBgRefreshing() {
  const pill = document.getElementById('bg-refresh-pill');
  if (pill) pill.classList.remove('show');
  setBgProgress(0);
}

// ═══════════════════════════════════
//  UNIFIED FETCH
// ═══════════════════════════════════
async function fetchAll() {
  if (!dataSource) return;
  if (bgRefreshActive) return; // prevent concurrent refreshes
  bgRefreshActive = true;

  const firstLoad = isFirstLoad;
  isFirstLoad = false;

  const refreshCard = document.getElementById('last-refresh-card');
  if (refreshCard) refreshCard.disabled = true;
  renderTopActionBar();

  if (firstLoad) {
    showBgRefreshing('Loading live data...');
    setProgress(5);
    setBgProgress(5);
    renderDashboardShell('Loading prices...');
    await yieldToBrowser();
  } else {
    // Subsequent: show subtle top bar + pill only
    setBgProgress(3);
    showBgRefreshing('Refreshing data…');
  }

  try {
    if (dataSource === 'yahoo') {
      if (firstLoad) document.getElementById('loading-msg').textContent = 'Fetching indices from Yahoo Finance…';
      if (!firstLoad) {
        await fetchYahooIndices();
        renderIndices();
        renderSectors();
        setBgProgress(20);
      } else {
        setProgress(10);
        setBgProgress(10);
      }
      await fetchYahooStocks(firstLoad);
      if (firstLoad && !indexData?.nifty50) await fetchYahooIndices();
      renderIndices();
      renderSectors();
      await yieldToBrowser();
    } else if (dataSource === 'nse') {
      if (firstLoad) document.getElementById('loading-msg').textContent = 'Fetching NSE indices…';
      await fetchNSEMarketStatus();
      await fetchNSEIndices();
      renderIndices();
      renderSectors();
      if (firstLoad) setProgress(20);
      else setBgProgress(20);
      await yieldToBrowser();
      await fetchNSEStocks(firstLoad);
    } else {
      await fetchAIData(firstLoad);
    }

    // Only fetch ETF prices when the ETF tab is active. Metadata/NAV details load
    // in the secondary queue so the stock table becomes usable first.
    const etfSymsToFetch = currentView === 'etfs' ? ETF_ASSETS.map(e=>e.sym) : [];
    const baseCount = MIDCAP_STOCKS.length;
    const totalStockProgress = baseCount + STOCK_ASSETS.length;
    await fetchAdditionalSymbols(STOCK_ASSETS.map(e=>e.sym), {
      force: true,
      progressOffset: baseCount,
      progressTotal: totalStockProgress,
    });
    await yieldToBrowser();
    if (etfSymsToFetch.length) {
      await fetchAdditionalSymbols(etfSymsToFetch, { force: true });
    }

    await loadPaperTrades(true);

    if (firstLoad) setProgress(100);
    else setBgProgress(100);

    renderDashboard({ immediate:true });
    queueSecondaryDashboardLoads(firstLoad);

    document.getElementById('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString('en-IN') + ' via ' +
      (dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'nse' ? 'NSE Direct' : 'AI');
    lastDashboardRefreshAt = Date.now();
    document.getElementById('status-bar').className = 'success';
    const stockUniverse = [...MIDCAP_STOCKS, ...STOCK_ASSETS];
    const loaded = stockUniverse.filter(s => stockData[s.sym] && stockData[s.sym].price > 0).length;
    document.getElementById('status-bar').textContent = `✓ ${loaded}/${stockUniverse.length} stocks loaded`;
    renderTopActionBar();
  } catch(e) {
    document.getElementById('status-bar').className = 'error';
    document.getElementById('status-bar').textContent = '⚠ ' + e.message;
  } finally {
    document.getElementById('loading-overlay').classList.remove('show');
    hideBgRefreshing();
    if (refreshCard) refreshCard.disabled = false;
    bgRefreshActive = false;
    setProgress(0);
    renderTopActionBar();
  }
}

function queueSecondaryDashboardLoads(firstLoad = false) {
  if (secondaryLoadActive || !dataSource) return;
  secondaryLoadActive = true;
  const baseDelay = firstLoad ? 700 : 150;
  const stockSyms = [...MIDCAP_STOCKS.map(s=>s.sym), ...STOCK_ASSETS.map(s=>s.sym)];
  const etfSymsToFetch = currentView === 'etfs' ? ETF_ASSETS.map(e=>e.sym) : [];
  const allSyms = [...new Set([...stockSyms, ...etfSymsToFetch])];

  showBgRefreshing('Loading indicators...');
  setBgProgress(12);

  scheduleWork(() => {
    fetchSparklines(allSyms).catch(e => console.warn('fetchSparklines failed', e.message));
    setBgProgress(30);
  }, baseDelay);

  scheduleWork(() => {
    fetchIntradaySignals(allSyms).catch(e => console.warn('fetchIntradaySignals failed', e.message));
    setBgProgress(55);
  }, baseDelay + 650);

  if (etfSymsToFetch.length) {
    scheduleWork(() => {
      fetchETFSummary(etfSymsToFetch).catch(e=>console.warn('ETF summary failed',e));
      setBgProgress(70);
    }, baseDelay + 1300);
  }

  if (!fundamentalsBackgroundStarted) {
    fundamentalsBackgroundStarted = true;
    scheduleWork(() => {
      const needsMeta = stockSyms.filter(sym => {
        const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym);
        return !asset?.fund?.computed?.pe;
      });
      if (needsMeta.length) fetchSymbolMetadata(needsMeta).catch(e => console.warn('bg metadata failed', e));
      setBgProgress(92);
    }, firstLoad ? 4200 : 1800);
  }

  setTimeout(() => {
    setBgProgress(100);
    setTimeout(hideBgRefreshing, 450);
    secondaryLoadActive = false;
  }, firstLoad ? 5200 : 2600);
}

// ═══════════════════════════════════
//  COUNTDOWN
// ═══════════════════════════════════
function startCountdown() {
  clearInterval(countdownTimer);
  let interval = getRefreshInterval();
  countdownSec = interval;
  countdownTimer=setInterval(()=>{
    if(paused) return;
    countdownSec--;
    const pct=(countdownSec/interval)*100;
    document.getElementById('countdown-fill').style.width=pct+'%';
    const display = countdownSec >= 60
      ? Math.ceil(countdownSec/60)+'m'
      : countdownSec+'s';
    document.getElementById('countdown-txt').textContent=display;
    if(countdownSec<=0){
      interval=getRefreshInterval(); // re-evaluate each cycle (market open/close)
      countdownSec=interval;
      fetchAll();
    }
  },1000);
}
function togglePause(){
  paused=!paused;
  document.getElementById('pause-btn').textContent=paused?'▶ Resume':'⏸ Pause';
}

// ═══════════════════════════════════
//  RENDER
// ═══════════════════════════════════
function renderMarketStatus(){
  // Market status row removed from UI; keep this as a no-op to avoid touching call sites.
  return;
}

function renderIndices(){
  const map={nifty50:['nifty50-price','nifty50-chg','idx-nifty50'],midcap:['midcap-price','midcap-chg','idx-midcap'],smallcap:['smallcap-price','smallcap-chg','idx-smallcap'],banknifty:['banknifty-price','banknifty-chg','idx-bank']};
  for(const[key,[pId,cId,cardId]] of Object.entries(map)){
    const d=indexData[key];if(!d)continue;
    document.getElementById(pId).textContent='₹'+(d.price||0).toLocaleString('en-IN',{maximumFractionDigits:2});
    const chgEl=document.getElementById(cId);
    const chg=d.change||0;
    chgEl.textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
    chgEl.className='index-chg '+(chg>=0?'up':'down');
    document.getElementById(cardId).className='index-card '+(chg>=0?'up':'down');
  }
  marketUp=(indexData.nifty50?.change||0)>=0;
}

function renderSectors(){
  // Pre-seed every sector that exists in MIDCAP_STOCKS so tiles NEVER disappear
  // even when stockData is partially populated (NSE source only fetches Midcap 150,
  // leaving Nifty 50 / Next 50 members undefined; Yahoo batches may lag).
  const sectorChanges = {};   // sector → [change values of loaded stocks]
  const sectorTotal   = {};   // sector → total stock count (for the count badge)
  for(const s of MIDCAP_STOCKS){
    if(!sectorChanges[s.sector]){ sectorChanges[s.sector]=[]; sectorTotal[s.sector]=0; }
    sectorTotal[s.sector]++;
    const d=stockData[s.sym];
    if(d && d.price>0) sectorChanges[s.sector].push(d.change||0);
  }
  // Always render all sectors; those with no loaded data yet show 0% in neutral grey
  const avgs=Object.keys(sectorChanges)
    .map(n=>({
      name:n,
      avg: sectorChanges[n].length ? sectorChanges[n].reduce((a,b)=>a+b,0)/sectorChanges[n].length : 0,
      count: sectorChanges[n].length,   // loaded stock count
      total: sectorTotal[n]             // total stock count in sector
    }))
    .sort((a,b)=>b.avg-a.avg);
  Object.keys(sectorTrendCache).forEach(k => delete sectorTrendCache[k]);
  avgs.forEach(s => { sectorTrendCache[s.name] = s.avg; });
  const grid=document.getElementById('sector-grid');grid.innerHTML='';
  for(const s of avgs){
    const hasData = s.count > 0;
    const intensity=hasData ? Math.min(Math.abs(s.avg)/3,1) : 0;
    const isSelected = activeSectors.has(s.name);
    const tile=document.createElement('div');
    tile.className='sector-tile' + (isSelected ? ' sector-selected' : '');
    if(hasData){
      tile.style.background=s.avg>=0?`rgba(16,185,129,${.08+intensity*.25})`:`rgba(244,63,94,${.08+intensity*.25})`;
      tile.style.borderColor=isSelected?'var(--text)':(s.avg>=0?`rgba(16,185,129,${.15+intensity*.4})`:`rgba(244,63,94,${.15+intensity*.4})`);
    } else {
      tile.style.background='rgba(51,65,85,.15)';
      tile.style.borderColor='var(--dim)';
    }
    tile.style.outline = isSelected ? '2px solid var(--text)' : 'none';
    tile.style.cursor = 'pointer';
    const chgColor = hasData ? (s.avg>=0?'var(--green)':'var(--red)') : 'var(--muted)';
    const chgText  = hasData ? ((s.avg>=0?'+':'')+s.avg.toFixed(2)+'%') : '--.--%';
    tile.innerHTML=`<div class="sector-name">${s.name} <span style="opacity:.5;font-size:10px">${s.count}/${s.total}</span></div><div class="sector-chg" style="color:${chgColor}">${chgText}</div>`;
    tile.onclick = () => {
      if (activeSectors.has(s.name)) activeSectors.delete(s.name);
      else activeSectors.add(s.name);
      // When user selects any sector(s), reset stock filter to All
      if (activeSectors.size) {
        const allBtn = document.getElementById('filter-all');
        if (allBtn) setFilter('all', allBtn);
        else { stockFilters.clear(); }
      }
      renderSectors();
      // If setFilter wasn't called (no button), ensure table updates
      if (!document.getElementById('filter-all')) renderTable();
      if(activeSectors.size) document.getElementById('main-section').scrollIntoView({behavior:'smooth',block:'start'});
    };
    grid.appendChild(tile);
  }
}

function getSignal(stock,data){
  if(!data) return 'hold';
  const chg=data.change||0;
  if(chg>=1.5&&marketUp) return 'buy';
  if(chg>=0.5&&marketUp) return 'watch';
  if(chg<=-1.5) return 'sell';
  return 'hold';
}

function sparkBars(sym, chg) {
  const pts = sparklineData[sym];
  const color = chg >= 0 ? 'var(--green)' : 'var(--red)';
  if (pts && pts.length >= 2) {
    const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 0.01;
    return pts.map((v, i) => {
      const h = Math.round(((v - mn) / rng) * 22) + 6;
      const op = (0.35 + (i / (pts.length - 1)) * 0.65).toFixed(2);
      return `<div class="spark-bar" style="height:${h}px;background:${color};opacity:${op}"></div>`;
    }).join('');
  }
  // Fallback: directional fake bars while real data loads
  const trend = chg > 0 ? 1 : -1;
  const bars = [0,1,2,3,4].map(i => Math.max(20, Math.min(100, 100 + trend*i*4 + (Math.random()-.5)*16)));
  const mn = Math.min(...bars), mx = Math.max(...bars), rng = mx - mn || 1;
  return bars.map((v,i) => `<div class="spark-bar" style="height:${Math.round(((v-mn)/rng)*22)+6}px;background:${color};opacity:${0.4+i*.15}"></div>`).join('');
}

async function fetchSparklines(symbols) {
  if (!symbols || !symbols.length) return;
  const BATCH = 20;
  const PARALLEL = 3; // run up to 3 batches concurrently
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));
  for (let i = 0; i < batches.length; i += PARALLEL) {
    await Promise.allSettled(batches.slice(i, i + PARALLEL).map(async batch => {
      try {
        const res = await fetch(`${PROXY}/sparklines?symbols=${encodeURIComponent(batch.join(','))}`);
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        if (!payload?.data) return;
        let updated = false;
        for (const [sym, pts] of Object.entries(payload.data)) {
          if (pts && pts.length >= 2) { sparklineData[sym] = pts; updated = true; }
        }
        if (updated) renderDashboard();
      } catch(e) { console.warn('fetchSparklines batch failed', e.message); }
    }));
  }
}

async function fetchIntradaySignalBatch(batch, attempt = 1) {
  try {
    // Increased timeout to 60 seconds (25 symbols * 20s / 8 concurrent = ~62.5s per batch)
    const res = await fetch(`${PROXY}/intraday-signals?symbols=${encodeURIComponent(batch.join(','))}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`intraday HTTP ${res.status}`);
    const payload = await res.json().catch(() => null);
    const data = payload?.data || {};
    let updated = 0;
    const now = Date.now();
    for (const sym of batch) {
      const setup = data[sym];
      if (setup && typeof setup === 'object') {
        // Accept any setup object, even if it doesn't have signal (partial data is ok)
        rememberPreviousSimulationSignal(sym);
        intradayData[sym] = {
          ...setup,
          fetchedAt: now,
          stale: !!setup.stale,
          fetchFailed: !!setup.fetchFailed,
          retryAttempt: attempt,
        };
        intradayDataUpdateCount++;
        updated++;
        console.debug(`[batch] ${sym}: stored (update #${intradayDataUpdateCount}), keys: ${Object.keys(setup).slice(0,4).join(',')}`);
      } else if (setup === null || setup === undefined) {
        // Data explicitly null - mark as stale to indicate we tried but failed
        if (!intradayData[sym]) {
          intradayData[sym] = { fetchedAt:now, stale:true, fetchFailed:true, staleReason:'No data from server', retryAttempt:attempt };
          intradayDataUpdateCount++;
        }
      }
    }
    console.info(`batch fetch: ${batch.length} symbols → ${updated} updated (total: ${intradayDataUpdateCount})`);
    return updated > 0;
  } catch (err) {
    console.error('fetchIntradaySignalBatch error:', err.message);
    throw err;
  }
}

function markIntradayBatchStale(batch, reason) {
  const now = Date.now();
  for (const sym of batch) {
    if (intradayData[sym]) {
      intradayData[sym] = { ...intradayData[sym], stale:true, fetchFailed:true, staleReason:reason, lastFetchFailedAt:now };
    }
  }
}

async function fetchIntradaySignals(symbols) {
  if (!symbols || !symbols.length) return;
  let anyUpdated = false;
  let sseCount = 0, batchCount = 0;

  if (DEBUG_INTRADAY_LOGS) console.info(`[fetchIntradaySignals] starting for ${symbols.length} symbols, current intradayData has ${Object.keys(intradayData).length}`);
  const url = `${PROXY}/stream/intraday-signals?symbols=${encodeURIComponent(symbols.join(','))}`;
  // Increased timeout to 180s (3 min) since fetching intraday data from Yahoo can take time with retries
  const result = await openSSEStream(url, (msg) => {
    if (msg.sym && msg.data && typeof msg.data === 'object') {
      // Accept any msg.data, even if it doesn't have signal yet (allow partial updates)
      const fetchedAt = Date.now();
      rememberPreviousSimulationSignal(msg.sym);
      intradayData[msg.sym] = {
        ...msg.data,
        fetchedAt,
        stale: !!msg.data.stale,
        fetchFailed: !!msg.data.fetchFailed,
      };
      intradayDataUpdateCount++;
      anyUpdated = true;
      sseCount++;
      if (DEBUG_INTRADAY_LOGS) console.debug(`[intraday] ${msg.sym}: stored (update #${intradayDataUpdateCount}), keys: target=${msg.data.target}, signal=${msg.data.signal}, stale=${msg.data.stale}`);
      scheduleTableRender(); // debounced: coalesces per-symbol renders
    } else if (msg.sym) {
      if (DEBUG_INTRADAY_LOGS) console.warn('intraday SSE: invalid data for', msg.sym, 'data:', msg.data);
    }
  }, { timeoutMs: 180000 });

  if (!result.ok) {
    // SSE failed — fall back to parallel batches
    if (DEBUG_INTRADAY_LOGS) console.warn('intraday SSE failed, falling back to batch:', result.error, `(received ${sseCount} items before failure)`);
    const BATCH = 25, PARALLEL = 3;
    const batches = [];
    for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));
    for (let i = 0; i < batches.length; i += PARALLEL) {
      await Promise.allSettled(batches.slice(i, i + PARALLEL).map(async batch => {
        try {
          const updated = await fetchIntradaySignalBatch(batch, 1);
          if (updated) { anyUpdated = true; batchCount += batch.length; scheduleTableRender(); }
        } catch(e) {
          if (DEBUG_INTRADAY_LOGS) console.warn('fallback batch failed:', e.message);
          markIntradayBatchStale(batch, e.message);
        }
      }));
    }
    if (DEBUG_INTRADAY_LOGS) console.info(`intraday: SSE${sseCount > 0 ? ' partial' : ''} + batch fallback completed (${sseCount} SSE + ${batchCount} batch = ${sseCount + batchCount} items, total updates: ${intradayDataUpdateCount})`);
  } else {
    if (DEBUG_INTRADAY_LOGS) console.info(`intraday: SSE stream completed successfully (${sseCount} items, total updates: ${intradayDataUpdateCount})`);
  }

  if (anyUpdated) {
    if (DEBUG_INTRADAY_LOGS) console.info(`[fetchIntradaySignals] completed: intradayData now has ${Object.keys(intradayData).length} symbols, total updates: ${intradayDataUpdateCount}`);
    saveSimulationSnapshot('intraday-refresh').catch(e => console.warn('simulation snapshot failed', e.message));
    runSimulationCycle({ allowEntries:true }).catch(e => console.warn('simulation cycle failed', e.message));
  }
}

function adjustedTradeScore(rowOrSym) {
  const sym = typeof rowOrSym === 'string' ? rowOrSym : rowOrSym?.sym;
  const row = typeof rowOrSym === 'string' ? null : rowOrSym;
  const t = intradayData[sym];
  if (!t) return -999;
  let score = Number.isFinite(Number(t.score)) ? Number(t.score) : 0;
  const bullish = score >= 0;
  const sectorAvg = row ? sectorTrendCache[row.sector] : null;
  if (sectorAvg != null) {
    if (bullish && sectorAvg > 0.25) score += 10;
    else if (bullish && sectorAvg < -0.25) score -= 12;
    else if (!bullish && sectorAvg < -0.25) score -= 10;
    else if (!bullish && sectorAvg > 0.25) score += 12;
  }
  const flag = getEventFlag(sym);
  if (flag?.danger) score += bullish ? -10 : 10;
  const cost = getTradeCostContext(row || sym, t);
  if (cost) {
    if (!cost.ok) score += bullish ? -30 : 30;
    else if (cost.netPct >= 0.75) score += bullish ? 4 : -4;
  }
  return Math.max(-100, Math.min(100, Math.round(score)));
}

function tradeScore(sym) {
  return adjustedTradeScore(sym);
}

function adjustedTradeSignal(score) {
  if (score >= 35) return 'buy';
  if (score <= -35) return 'sell';
  if (Math.abs(score) >= 18) return 'watch';
  return 'hold';
}

function getLiquidityInfo(t) {
  if (!t?.dayVolume || !t.price) return { label:'Liq --', tradedCr:null, level:'unknown' };
  const tradedCr = (Number(t.dayVolume) * Number(t.price)) / 10000000;
  if (tradedCr >= 25) return { label:'Liq OK', tradedCr:+tradedCr.toFixed(1), level:'ok' };
  if (tradedCr >= 5) return { label:'Liq Fair', tradedCr:+tradedCr.toFixed(1), level:'fair' };
  return { label:'Thin', tradedCr:+tradedCr.toFixed(1), level:'thin' };
}

function getIntradayFreshness(t) {
  if (!t) return { stale:true, ageMs:null, label:'No signal', reason:'Intraday signal not loaded' };
  const fetchedAt = Number(t.fetchedAt);
  const ageMs = Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : null;
  const stale = !!t.stale || !!t.fetchFailed || ageMs == null || ageMs > INTRADAY_STALE_MS;
  const ageMin = ageMs == null ? null : Math.max(0, Math.round(ageMs / 60000));
  const label = stale ? `Stale${ageMin != null ? ' ' + ageMin + 'm' : ''}` : `Fresh${ageMin != null ? ' ' + ageMin + 'm' : ''}`;
  const reason = t.staleReason || (ageMs == null ? 'Signal freshness unknown' : `Signal age ${ageMin}m`);
  return { stale, ageMs, ageMin, label, reason };
}

function getTimeWarning() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const open = 9 * 60 + 15, close = 15 * 60 + 30;
  if (day === 0 || day === 6 || mins < open || mins >= close) return { label:'Closed', level:'warn' };
  if (mins < 9 * 60 + 30) return { label:'Open noise', level:'warn' };
  if (mins >= 11 * 60 + 30 && mins <= 13 * 60 + 30) return { label:'Midday lull', level:'caution' };
  if (mins >= 14 * 60 + 45) return { label:'Late risk', level:'warn' };
  return { label:'Time OK', level:'ok' };
}

function getPositionSize(t) {
  if (!t?.price || !t.stop) return null;
  const riskPerShare = Math.abs(Number(t.price) - Number(t.stop));
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null;
  const capital = getPortfolioCapital();
  const maxLoss = capital * (TRADE_RISK_PCT / 100);
  const byRisk = Math.floor(maxLoss / riskPerShare);
  const byCapital = Math.floor(capital / Number(t.price));
  const qty = Math.max(0, Math.min(byRisk, byCapital));
  return { qty, riskPerShare:+riskPerShare.toFixed(2), maxLoss:+maxLoss.toFixed(0), capital, riskPct:TRADE_RISK_PCT };
}

function moneyINR(v) {
  return v != null && Number.isFinite(Number(v)) ? 'Rs ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '--';
}

function getCurrentTradePrice(sym) {
  const price = Number(intradayData[sym]?.price ?? stockData[sym]?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function getPortfolioCapital() {
  const initial = Number(portfolioState?.initialCapital);
  const base = Number.isFinite(initial) && initial > 0 ? initial : PORTFOLIO_FALLBACK_INITIAL_CAPITAL;
  const added = Array.isArray(portfolioState?.capitalAdds)
    ? portfolioState.capitalAdds.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0)
    : 0;
  return +(base + added).toFixed(2);
}

function getOpenPaperTrade(sym) {
  return paperTrades.find(t => String(t.status || '').toLowerCase() === 'open' && t.symbol === sym) || null;
}

function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy') {
  return SimulationEngine.estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side);
}

function getEstimatedSlippagePct(row, t) {
  const liq = getLiquidityInfo(t);
  let pct = isETFAsset(row) ? 0.04 : 0.06;
  if (liq.level === 'fair') pct += isETFAsset(row) ? 0.04 : 0.06;
  else if (liq.level === 'thin') pct += isETFAsset(row) ? 0.12 : 0.18;
  const bandWidth = Number(t?.vwapBandWidthPct);
  if (Number.isFinite(bandWidth)) {
    if (bandWidth > 2.5) pct += 0.06;
    else if (bandWidth > 1.5) pct += 0.03;
  }
  return +pct.toFixed(3);
}

function getTradeCostContext(rowOrSym, t, side = null) {
  if (!t) return null;
  const sym = typeof rowOrSym === 'string' ? rowOrSym : rowOrSym?.sym;
  const row = typeof rowOrSym === 'string'
    ? (MIDCAP_STOCKS.find(s => s.sym === sym) || STOCK_ASSETS.find(s => s.sym === sym) || ETF_ASSETS.find(s => s.sym === sym) || { sym })
    : rowOrSym;
  const entry = Number(t.price);
  const target = Number(t.target);
  const qty = getPositionSize(t)?.qty || 1;
  if (!Number.isFinite(entry) || !Number.isFinite(target) || entry <= 0 || target <= 0) return null;
  const tradeSide = side || (target >= entry ? 'buy' : 'sell');
  const targetPct = Math.abs(target - entry) / entry * 100;
  const charges = estimateZerodhaIntradayCharges(entry, target, qty, tradeSide);
  const slippagePct = getEstimatedSlippagePct(row, t);
  const minTargetPct = isETFAsset(row) ? 0.25 : 0.35;
  const netPct = targetPct - charges.totalPct - slippagePct;
  const requiredPct = Math.max(minTargetPct, MIN_NET_PROFIT_PCT + charges.totalPct + slippagePct);
  return {
    side:tradeSide,
    targetPct:+targetPct.toFixed(3),
    costPct:charges.totalPct,
    charges,
    slippagePct,
    netPct:+netPct.toFixed(3),
    requiredPct:+requiredPct.toFixed(3),
    ok: netPct >= MIN_NET_PROFIT_PCT,
    minNetPct: MIN_NET_PROFIT_PCT,
  };
}

function getPaperTradePnl(trade, currentPrice) {
  return SimulationEngine.getPaperTradePnl(trade, currentPrice);
}

function getPaperPlanForSide(t, side, price) {
  return SimulationEngine.getPaperPlanForCandidate({ indicators:t || {} }, side, price);
}

function paperTradeExposure(trade) {
  const entry = Number(trade?.entryPrice);
  const qty = Number(trade?.qty);
  return Number.isFinite(entry) && Number.isFinite(qty) ? entry * qty : 0;
}

function getSuggestedPaperQty(t, side, price, availableCash = null, maxExposure = MAX_POSITION_EXPOSURE) {
  const cash = availableCash == null ? getPortfolioSummary().cashAvailable : availableCash;
  return SimulationEngine.getSuggestedQty(
    { indicators:t || {} },
    side,
    price,
    cash,
    maxExposure,
    getSimulationEngineSettings()
  );
}

function paperQtyInputId(sym) {
  return `paper-qty-${String(sym || '').replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

function getManualPaperQty(sym, suggestion) {
  const input = document.getElementById(paperQtyInputId(sym));
  const raw = input?.value;
  if (raw == null || String(raw).trim() === '') return Number(suggestion.qty || 0);
  return Math.floor(Number(raw));
}

function getTradeDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'2-digit' });
}

function getTradeDateISO(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeReplayDay(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const iso = getTradeDateISO(raw || Date.now());
  return iso || getTradeDateISO();
}

function formatTradeDateTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', {
    hour:'2-digit',
    minute:'2-digit',
    hour12:false,
  });
}

function getIstMinutes(value = Date.now()) {
  const d = new Date(new Date(value).getTime() + 5.5 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isTradeToday(trade) {
  const todayKey = getTradeDateKey();
  return getTradeDateKey(trade?.openedAt) === todayKey || getTradeDateKey(trade?.closedAt) === todayKey;
}

function getTodaysSimulationTrades() {
  return paperTrades.filter(t => t.source === 'simulation' && isTradeToday(t));
}

function isLosingStopExit(trade) {
  return TradeRules.isLosingStopExit(trade);
}

function getSimulationDayStats() {
  return TradeRules.buildDayStats(getTodaysSimulationTrades(), Date.now(), getSimulationEngineSettings(), {
    sameDay: () => true,
  });
}

function getSimulationSafetySummary() {
  const summary = getPortfolioSummary();
  return SimulationEngine.summarizeSimulationSafety(paperTrades, getSimulationEngineSettings(), {
    at:Date.now(),
    state:simulationState,
    dayStats:getSimulationDayStats(),
    cashAvailable:summary.cashAvailable,
    sameDay:(a, b) => getTradeDateKey(a) === getTradeDateKey(b),
  });
}

function getEffectiveSimulationStopLimit(netPnl, capital = getPortfolioCapital()) {
  return TradeRules.getEffectiveStopLimit(netPnl, { ...getSimulationEngineSettings(), PORTFOLIO_INITIAL_CAPITAL:capital });
}

function getPortfolioSummary() {
  let realized = 0;
  let unrealized = 0;
  let openExposure = 0;
  const dayPnl = {};
  const initialCapital = Number(portfolioState?.initialCapital);
  const baseCapital = Number.isFinite(initialCapital) && initialCapital > 0
    ? initialCapital
    : PORTFOLIO_FALLBACK_INITIAL_CAPITAL;
  const addedCapital = Array.isArray(portfolioState?.capitalAdds)
    ? portfolioState.capitalAdds.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0)
    : 0;
  const capital = +(baseCapital + addedCapital).toFixed(2);
  for (const trade of paperTrades) {
    const status = String(trade.status || '').toLowerCase();
    if (status === 'open') {
      openExposure += paperTradeExposure(trade);
      const pnl = getPaperTradePnl(trade, getCurrentTradePrice(trade.symbol));
      if (pnl) unrealized += pnl.pnl;
      continue;
    }
    if (status === 'closed') {
      let pnl = Number(trade.pnl);
      if (!Number.isFinite(pnl)) pnl = Number(computeClosedPaperPnl(trade));
      if (Number.isFinite(pnl)) {
        realized += pnl;
        const key = getTradeDateKey(trade.closedAt || trade.openedAt);
        dayPnl[key] = (dayPnl[key] || 0) + pnl;
      }
    }
  }
  const totalPnl = realized + unrealized;
  return {
    initial:+baseCapital.toFixed(2),
    addedCapital:+addedCapital.toFixed(2),
    capital,
    realized:+realized.toFixed(2),
    unrealized:+unrealized.toFixed(2),
    totalPnl:+totalPnl.toFixed(2),
    openExposure:+openExposure.toFixed(2),
    cashAvailable:+(capital + realized - openExposure).toFixed(2),
    portfolioValue:+(capital + totalPnl).toFixed(2),
    dayPnl,
  };
}

function todaysClosedPnl() {
  const key = getTradeDateKey();
  return paperTrades
    .filter(t => String(t.status || '').toLowerCase() === 'closed' && getTradeDateKey(t.closedAt || t.openedAt) === key)
    .reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
}

function simulationTradeKey(trade) {
  if (!trade) return '';
  return String(trade.id || `${trade.symbol || ''}|${trade.openedAt || ''}|${trade.entryPrice || ''}`);
}

function loadNewSimulationTradeKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SIMULATION_NEW_TRADES_KEY) || '[]');
    return Array.isArray(parsed) ? new Set(parsed.map(String).filter(Boolean)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function saveNewSimulationTradeKeys() {
  localStorage.setItem(SIMULATION_NEW_TRADES_KEY, JSON.stringify([...newSimulationTradeKeys]));
}

function registerNewSimulationTrade(trade) {
  const key = simulationTradeKey(trade);
  if (!key) return;
  newSimulationTradeKeys.add(key);
  saveNewSimulationTradeKeys();
  renderTopActionBar();
  if (document.getElementById('open-trades-modal')?.style.display === 'flex') renderOpenTradesModal();
}

function pruneNewSimulationTradeKeys() {
  const activeKeys = new Set(paperTrades.map(simulationTradeKey).filter(Boolean));
  const before = newSimulationTradeKeys.size;
  newSimulationTradeKeys = new Set([...newSimulationTradeKeys].filter(key => activeKeys.has(key)));
  if (newSimulationTradeKeys.size !== before) saveNewSimulationTradeKeys();
}

function getNewSimulationOpenTrades() {
  const keys = newSimulationTradeKeys;
  return paperTrades.filter(t => isOpenTrade(t) && keys.has(simulationTradeKey(t)));
}

function getNewSimulationEventTrades() {
  const keys = newSimulationTradeKeys;
  return paperTrades.filter(t => keys.has(simulationTradeKey(t)));
}

function applyPaperTradesState(payload, { trackNewTrades = false } = {}) {
  if (!payload || !Array.isArray(payload.trades)) return;
  const prevOpenKeys = new Set(paperTrades.filter(isOpenTrade).map(simulationTradeKey).filter(Boolean));
  const prevStatusByKey = new Map(
    paperTrades
      .map(trade => [simulationTradeKey(trade), String(trade?.status || '').toLowerCase()])
      .filter(([key]) => !!key)
  );
  paperTrades = payload.trades;
  paperTradesLoaded = true;

  if (payload.portfolio && typeof payload.portfolio === 'object') {
    portfolioState = {
      initialCapital: Number(payload.portfolio.initialCapital) || PORTFOLIO_FALLBACK_INITIAL_CAPITAL,
      capitalAdds: Array.isArray(payload.portfolio.capitalAdds) ? payload.portfolio.capitalAdds : [],
    };
  }

  if (trackNewTrades) {
    let changed = false;
    const nowMs = Date.now();
    for (const trade of paperTrades) {
      const key = simulationTradeKey(trade);
      if (!key) continue;
      const prevStatus = prevStatusByKey.get(key) || '';
      const nowOpen = isOpenTrade(trade);
      const nowClosed = isClosedTrade(trade);

      // New open entries
      if (nowOpen && !prevOpenKeys.has(key)) {
        newSimulationTradeKeys.add(key);
        changed = true;
        continue;
      }

      // Exit events for tracked positions (open -> closed)
      if (nowClosed && prevStatus === 'open') {
        newSimulationTradeKeys.add(key);
        changed = true;
        continue;
      }

      // Some simulation exits create a new closed record (e.g. partial close) with no previous key.
      // Mark only very recent closed simulation rows to avoid flooding old history.
      if (nowClosed && !prevStatus && String(trade?.source || '').toLowerCase() === 'simulation') {
        const closedAtMs = new Date(trade.closedAt || trade.openedAt || 0).getTime();
        if (Number.isFinite(closedAtMs) && (nowMs - closedAtMs) <= 3 * 60 * 1000) {
          newSimulationTradeKeys.add(key);
          changed = true;
        }
      }
    }
    if (changed) saveNewSimulationTradeKeys();
  }

  pruneNewSimulationTradeKeys();
  if (simulationState === 'settling' && !getSimulationOpenTrades().length) {
    simulationState = 'off';
    localStorage.setItem(SIMULATION_STATE_KEY, simulationState);
  }
  updateSimulationButton();
  updateBrokerModeButton();
  renderTopActionBar();
  renderTable();
  if (currentView === 'etfs') renderETFSection();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  if (document.getElementById('open-trades-modal')?.style.display === 'flex') renderOpenTradesModal();
}

function subscribePaperTradesStream() {
  if (paperTradesStream) return;

  const connect = () => {
    if (paperTradesStream) return;
    try {
      paperTradesStream = new EventSource(PAPER_TRADES_STREAM_ENDPOINT);
    } catch (e) {
      console.warn('paper-trades SSE init failed', e.message);
      if (!paperTradesStreamReconnectTimer) {
        paperTradesStreamReconnectTimer = setTimeout(() => {
          paperTradesStreamReconnectTimer = null;
          connect();
        }, 3000);
      }
      return;
    }

    paperTradesStream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (Array.isArray(payload?.trades)) {
          applyPaperTradesState(payload, { trackNewTrades: payload.reason !== 'init' });
        }
      } catch (e) {
        console.warn('paper-trades SSE parse failed', e.message);
      }
    };

    paperTradesStream.onerror = () => {
      try { paperTradesStream?.close(); } catch (_) {}
      paperTradesStream = null;
      if (!paperTradesStreamReconnectTimer) {
        paperTradesStreamReconnectTimer = setTimeout(() => {
          paperTradesStreamReconnectTimer = null;
          connect();
        }, 3000);
      }
    };
  };

  connect();
}

function renderOpenTradeRows(openTrades, newKeys, mode = 'all') {
  const manualAutoExitEnabled = !!getSimulationEngineSettings().SIMULATION_AUTO_MANUAL_EXITS;
  return openTrades.length ? openTrades.map(trade => {
    const isOpen = isOpenTrade(trade);
    const eventType = getTradeEventType(trade);
    const transactionTime = getTradeTransactionTime(trade);
    const current = isOpen ? getCurrentTradePrice(trade.symbol) : Number(trade.exitPrice);
    const pnl = isOpen
      ? getPaperTradePnl(trade, current)
      : {
          pnl: Number(trade.pnl),
          pnlPct: Number(trade.pnlPct),
          grossPnl: Number(trade.grossPnl),
          charges: Number(trade.charges),
          chargeBreakup: trade.chargeBreakup,
        };
    const key = simulationTradeKey(trade);
    const isNew = newKeys.has(key);
    const cls = Number.isFinite(Number(pnl?.pnl)) ? portfolioValueClass(Number(pnl.pnl)) : '';
    const isPartialExitEvent = !isOpen && (Boolean(trade.parentId) || /partial/i.test(String(trade.closeReason || '')));
    const qtyDisplay = `${Number(trade.qty || 0).toLocaleString('en-IN')}${isPartialExitEvent ? ' (partial)' : ''}`;
    const isManual = trade.source !== 'simulation';
    const action = isOpen
      ? (isManual
        ? `<button class="paper-btn exit" onclick="closePaperTrade('${escapeHTML(trade.id)}','${escapeHTML(trade.symbol)}')">Exit</button>`
        : '<span style="color:var(--muted);font-size:11px">Auto managed</span>')
      : `<span style="color:var(--muted);font-size:11px">${escapeHTML(trade.closeReason || 'Exited')}</span>`;
    
    // Broker status indicator
    let statusHTML = '--';
    if (trade.broker?.name === 'zerodha') {
      const closeReason = String(trade.closeReason || '').toLowerCase();
      const isTimeoutAutoCancel = closeReason.includes('auto-cancelled') && closeReason.includes('timeout');
      if (trade.broker.status === 'pending') {
        statusHTML = '⏳ Pending';
      } else if (trade.broker.status === 'confirmed') {
        statusHTML = '✅ Confirmed';
      } else if (trade.broker.status === 'rejected') {
        statusHTML = '❌ Rejected';
      } else if (trade.broker.status === 'timeout') {
        statusHTML = '⚠️ Timeout';
      } else if (trade.broker.status === 'failed') {
        statusHTML = '❌ Failed';
      } else if (trade.broker.status === 'exit_placed') {
        statusHTML = '🚪 Exiting';
      } else if (trade.broker.status === 'cancelled') {
        statusHTML = isTimeoutAutoCancel ? '✗ Auto-cancelled (timeout)' : '✗ Cancelled';
      } else if (trade.broker.status === 'entry_dry_run') {
        statusHTML = '🔄 Dry Entry';
      } else if (trade.broker.status === 'exit_dry_run') {
        statusHTML = '🔄 Dry Exit';
      }
    }
    
    // In new events modal, show exit reason for closed trades, entry reason for open trades
    const reasonDisplay = mode === 'new' && !isOpen
      ? escapeHTML(trade.closeReason || '--')
      : escapeHTML(formatEntryJournal(trade));
    const reasonTitle = mode === 'new' && !isOpen
      ? escapeHTML(trade.closeReason || '--')
      : escapeHTML(formatEntryJournal(trade));
    const modeCell = trade.source === 'simulation'
      ? 'Sim'
      : `Manual <span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.5;background:${manualAutoExitEnabled ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.18)'};color:${manualAutoExitEnabled ? 'var(--green)' : 'var(--muted)'};border:1px solid ${manualAutoExitEnabled ? 'rgba(16,185,129,.35)' : 'rgba(148,163,184,.35)'}">Auto-exit ${manualAutoExitEnabled ? 'On' : 'Off'}</span>`;
    
    return `<tr class="${isNew ? 'new-trade-highlight' : ''}">
      <td>${eventType}</td>
      <td>${escapeHTML(formatTradeDateTime(transactionTime))}</td>
      <td>${modeCell}</td>
      <td>${escapeHTML(trade.symbol || '--')}</td>
      <td>${escapeHTML(String(trade.side || '--').toUpperCase())}</td>
      <td>${escapeHTML(qtyDisplay)}</td>
      <td>${moneyINR(trade.entryPrice)}</td>
      <td>${moneyINR(current)}</td>
      <td>${statusHTML}</td>
      <td>${moneyINR(trade.target)}</td>
      <td>${moneyINR(trade.stop)}</td>
      <td class="portfolio-pnl ${cls}">${pnl ? `${moneyINR(pnl.pnl)} (${pnl.pnlPct}% net)` : '--'}</td>
      <td class="portfolio-journal-cell" title="${reasonTitle}">${reasonDisplay}</td>
      <td>${action}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="14" style="color:var(--muted);text-align:center;padding:16px">No trades</td></tr>`;
}

function getTradeEventType(trade) {
  const isOpen = isOpenTrade(trade);
  if (isOpen) return 'Entry';
  const brokerStatus = String(trade?.broker?.status || '').toLowerCase();
  if (brokerStatus === 'cancelled') return 'Cancelled';
  if (brokerStatus === 'rejected') return 'Rejected';
  if (brokerStatus === 'timeout') return 'Timeout';
  return 'Exit';
}

function getTradeTransactionTime(trade) {
  const isOpen = isOpenTrade(trade);
  return isOpen ? trade.openedAt : (trade.closedAt || trade.openedAt);
}

function openTradesSortIndicator(col) {
  if (openTradesModalSort.col !== col) return '↕';
  return openTradesModalSort.dir === -1 ? '↓' : '↑';
}

function setOpenTradesModalSort(col) {
  if (!['event', 'time'].includes(col)) return;
  if (openTradesModalSort.col === col) {
    openTradesModalSort.dir *= -1;
  } else {
    openTradesModalSort.col = col;
    openTradesModalSort.dir = col === 'time' ? -1 : 1;
  }
  renderOpenTradesModal();
}

function renderOpenTradesModal() {
  const body = document.getElementById('open-trades-modal-body');
  if (!body) return;
  const title = document.querySelector('#open-trades-modal .modal-header h3');
  if (title) title.textContent = openTradesModalMode === 'new' ? 'New Events' : 'Open Trades';
  pruneNewSimulationTradeKeys();
  const allOpenTrades = paperTrades
    .filter(isOpenTrade)
    .slice()
    .sort((a, b) => {
      const anew = newSimulationTradeKeys.has(simulationTradeKey(a)) ? 1 : 0;
      const bnew = newSimulationTradeKeys.has(simulationTradeKey(b)) ? 1 : 0;
      if (anew !== bnew) return bnew - anew;
      return new Date(b.openedAt || 0) - new Date(a.openedAt || 0);
    });
  const newEventTrades = paperTrades
    .filter(t => newSimulationTradeKeys.has(simulationTradeKey(t)))
    .slice()
    .sort((a, b) => {
      const col = openTradesModalSort.col;
      const dir = openTradesModalSort.dir;
      if (col === 'event') {
        const cmp = getTradeEventType(a).localeCompare(getTradeEventType(b));
        if (cmp !== 0) return cmp * dir;
      }
      const at = new Date(getTradeTransactionTime(a) || 0).getTime() || 0;
      const bt = new Date(getTradeTransactionTime(b) || 0).getTime() || 0;
      return (at - bt) * dir;
    });
  const newCount = allOpenTrades.filter(t => newSimulationTradeKeys.has(simulationTradeKey(t))).length;
  const visibleTrades = openTradesModalMode === 'new'
    ? newEventTrades
    : allOpenTrades;
  const visibleOpenTrades = visibleTrades.filter(isOpenTrade);
  const pnlBaseTrades = openTradesModalMode === 'new' ? visibleTrades : visibleOpenTrades;
  const rows = renderOpenTradeRows(visibleTrades, newSimulationTradeKeys, openTradesModalMode);
  body.innerHTML = `
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Open trades</div><div class="value">${allOpenTrades.length}</div></div>
      <div class="portfolio-card"><div class="label">${openTradesModalMode === 'new' ? 'New events' : 'New open trades'}</div><div class="value ${newEventTrades.length ? 'up' : ''}">${openTradesModalMode === 'new' ? newEventTrades.length : newCount}</div></div>
      <div class="portfolio-card"><div class="label">Open exposure</div><div class="value">${moneyINR(visibleOpenTrades.reduce((sum, t) => sum + paperTradeExposure(t), 0))}</div></div>
      <div class="portfolio-card"><div class="label">${openTradesModalMode === 'new' ? 'Net P&L' : 'Open P&L'}</div><div class="value ${portfolioValueClass(pnlBaseTrades.reduce((sum, t) => sum + (isOpenTrade(t) ? (getPaperTradePnl(t, getCurrentTradePrice(t.symbol))?.pnl || 0) : (Number(t.pnl) || 0)), 0))}">${moneyINR(pnlBaseTrades.reduce((sum, t) => sum + (isOpenTrade(t) ? (getPaperTradePnl(t, getCurrentTradePrice(t.symbol))?.pnl || 0) : (Number(t.pnl) || 0)), 0))}</div></div>
    </div>
    <div class="portfolio-section-title">${openTradesModalMode === 'new' ? 'New Trade Events' : 'All Open Trades'}</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table open-trades-table">
        <thead><tr><th${openTradesModalMode === 'new' ? ` onclick="setOpenTradesModalSort('event')" style="cursor:pointer"` : ''}>Event ${openTradesModalMode === 'new' ? openTradesSortIndicator('event') : ''}</th><th${openTradesModalMode === 'new' ? ` onclick="setOpenTradesModalSort('time')" style="cursor:pointer"` : ''}>Txn Time ${openTradesModalMode === 'new' ? openTradesSortIndicator('time') : ''}</th><th>Mode</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Live</th><th>Status</th><th>Target</th><th>SL</th><th>Net P&L</th><th>${openTradesModalMode === 'new' ? 'Reason' : 'Entry Why'}</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  // Update Mark Seen button visibility based on mode
  const markSeenBtn = document.querySelector('#open-trades-modal [onclick="markNewSimulationTradesSeen()"]');
  if (markSeenBtn) markSeenBtn.style.display = openTradesModalMode === 'new' ? 'block' : 'none';
}

async function openOpenTradesModal(mode = 'all') {
  openTradesModalMode = mode === 'new' ? 'new' : 'all';
  renderOpenTradesModal();
  const modal = document.getElementById('open-trades-modal');
  if (modal) modal.style.display = 'flex';
  // Show/hide Mark Seen button based on mode
  const markSeenBtn = modal?.querySelector('[onclick="markNewSimulationTradesSeen()"]');
  if (markSeenBtn) markSeenBtn.style.display = openTradesModalMode === 'new' ? 'block' : 'none';
  if (!paperTradesLoaded) {
    const body = document.getElementById('open-trades-modal-body');
    if (body) body.innerHTML = `<div style="color:var(--muted);padding:16px">Loading open trades...</div>`;
    await loadPaperTrades();
    renderOpenTradesModal();
    // Update button visibility after reload too
    const mkBtn = modal?.querySelector('[onclick="markNewSimulationTradesSeen()"]');
    if (mkBtn) mkBtn.style.display = openTradesModalMode === 'new' ? 'block' : 'none';
  }
}

function closeOpenTradesModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('open-trades-modal');
  if (modal) modal.style.display = 'none';
}

function markNewSimulationTradesSeen() {
  newSimulationTradeKeys.clear();
  saveNewSimulationTradeKeys();
  openTradesModalMode = 'all';
  renderTopActionBar();
  renderOpenTradesModal();
}

function getDashboardHealthItems() {
  const items = [];
  if (!dataSource) items.push('No data source connected');
  const allSymbols = [...MIDCAP_STOCKS, ...STOCK_ASSETS];
  const priced = allSymbols.filter(s => Number(stockData[s.sym]?.price) > 0).length;
  if (dataSource && priced < Math.max(5, Math.floor(allSymbols.length * 0.5))) items.push(`Only ${priced}/${allSymbols.length} stock prices loaded`);
  const intradayValues = Object.values(intradayData || {});
  const stale = intradayValues.filter(t => getIntradayFreshness(t).stale).length;
  if (stale) items.push(`${stale} intraday signals stale`);
  const missingOhlc = intradayValues.filter(t => !getIntradayFreshness(t).stale && !t?.ohlc?.latestBar && !t?.ohlc?.bars?.length).length;
  if (missingOhlc && intradayValues.length) items.push(`${missingOhlc} signals missing OHLC`);
  if (simulationState === 'running' && !isMarketHoursNow()) items.push('Simulation is on outside market hours');
  if (marketOpen === false) items.push('Market is closed');
  return items;
}

function buildDashboardNotifications() {
  const items = [];
  const now = Date.now();
  const openSim = getSimulationOpenTrades();
  const newSim = getNewSimulationOpenTrades();
  const dayPnl = todaysClosedPnl();
  const health = getDashboardHealthItems();
  health.slice(0, 4).forEach(text => items.push({ level:'warn', title:'Dashboard health', text, at:now }));
  if (newSim.length) items.push({ level:'good', title:'New simulation trades', text:`${newSim.length} new open trade${newSim.length === 1 ? '' : 's'}: ${newSim.map(t => t.symbol).join(', ')}`, at:now });
  if (simulationState === 'running') items.push({ level:'good', title:'Simulation active', text:`${openSim.length} simulation positions open`, at:now });
  if (simulationState === 'settling') items.push({ level:'warn', title:'Simulation settling', text:'No new entries; exits continue to be managed', at:now });
  if (Math.abs(dayPnl) > 0) items.push({ level:dayPnl >= 0 ? 'good' : 'danger', title:'Today P/L', text:moneyINR(dayPnl), at:now });
  getAllStockRows().slice(0, 220).forEach(row => {
    const t = intradayData[row.sym];
    if (!t || getIntradayFreshness(t).stale) return;
    const score = adjustedTradeScore(row);
    const sig = adjustedTradeSignal(score);
    const guard = getRiskGuard(row, t, score);
    const setup = getSetupType(row, t, guard);
    if (t.entryStatus === 'Triggered' && /FRESH_BREAKOUT|MOMENTUM_RUNNER|VOLUME_SHOCK/i.test(setup)) {
      items.push({ level:'good', title:`${row.sym} ${setup}`, text:`Score ${score} | ${t.entryTrigger || 'Triggered'}`, at:now });
    } else if (sig === 'sell' && t.entryStatus === 'Triggered') {
      items.push({ level:'danger', title:`${row.sym} short setup`, text:`Score ${score} | ${setup}`, at:now });
    }
  });
  paperTrades
    .filter(t => isTradeToday(t))
    .slice(-5)
    .reverse()
    .forEach(t => items.push({
      level:String(t.status).toLowerCase() === 'open' ? 'good' : (Number(t.pnl) >= 0 ? 'good' : 'danger'),
      title:`${String(t.status || '').toUpperCase()} ${t.symbol}`,
      text:[String(t.side || '').toUpperCase(), t.qty ? `${t.qty} qty` : '', t.pnl != null ? moneyINR(t.pnl) : moneyINR(t.entryPrice)].filter(Boolean).join(' | '),
      at:now,
    }));
  Object.entries(stockNewsCache).slice(-10).forEach(([key, value]) => {
    const sym = key.split('|')[0];
    const ev = (value.events || []).find(e => e?.type === 'Results' || /dividend|result|board/i.test(`${e?.type || ''} ${e?.title || ''}`));
    if (ev) items.push({ level:/dividend/i.test(`${ev.type || ''} ${ev.title || ''}`) ? 'good' : 'warn', title:`${sym} event`, text:ev.title || ev.type || 'Event', at:now });
  });
  return items.slice(0, 12);
}

function renderNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  const btn = document.getElementById('notification-btn');
  const items = buildDashboardNotifications();
  if (btn) {
    btn.textContent = items.length ? String(Math.min(9, items.length)) : '!';
    btn.classList.toggle('has-items', items.length > 0);
  }
  if (!panel) return;
  panel.style.display = notificationsOpen ? 'block' : 'none';
  const content = items.length
    ? items.map(item => {
        const timeStr = item.at ? formatTradeDateTime(item.at) : '--';
        return `<div class="notification-item ${escapeHTML(item.level || '')}"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.text)}</span><div class="notification-time">${escapeHTML(timeStr)}</div></div>`;
      }).join('')
    : '<div class="notification-item"><strong>No alerts</strong><span>Dashboard looks quiet right now.</span></div>';
  panel.innerHTML = `
    <div class="notification-panel-header">
      <strong>Notifications</strong>
      <button class="notification-panel-close" type="button" onclick="toggleNotifications()" aria-label="Close notifications">✕</button>
    </div>
    <div class="notification-panel-body">${content}</div>
  `;
}

function toggleNotifications() {
  notificationsOpen = !notificationsOpen;
  renderNotificationPanel();
}

function renderTopActionBar() {
  const bar = document.getElementById('top-action-bar');
  if (!bar) return;
  bar.style.display = dataSource ? 'flex' : 'none';
  const summary = getPortfolioSummary();
  const openTrades = paperTrades.filter(t => String(t.status || '').toLowerCase() === 'open');
  pruneNewSimulationTradeKeys();
  const newOpenTrades = getNewSimulationOpenTrades();
  const newEventTrades = getNewSimulationEventTrades();
  const dayPnl = todaysClosedPnl();
  const tabSyms = new Set(
    currentView === 'etfs'
      ? ETF_ASSETS.map(e => e.sym)
      : [...MIDCAP_STOCKS, ...STOCK_ASSETS].map(s => s.sym)
  );
  const intradayValues = Object.entries(intradayData || {})
    .filter(([sym]) => tabSyms.has(sym))
    .map(([, v]) => v);
  const stale = intradayValues.filter(t => getIntradayFreshness(t).stale).length;
  const freshText = intradayValues.length ? `${Math.max(0, intradayValues.length - stale)}/${intradayValues.length} fresh` : '--';
  const set = (id, text, cls = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = cls;
  };
  const effectiveMarketOpen = (marketOpen === true || marketOpen === false) ? marketOpen : isMarketHoursNow();
  set('action-market', effectiveMarketOpen ? 'Open' : 'Closed', effectiveMarketOpen ? 'up' : 'down');
  set('action-freshness', freshText, stale ? 'down' : '');
  set('action-simulation', simulationState.toUpperCase(), simulationState === 'running' ? 'up' : simulationState === 'settling' ? 'down' : '');
  set('action-open-trades', `${openTrades.length} / ${moneyINR(summary.openExposure)}`);
  set('action-new-trades', String(newEventTrades.length), newEventTrades.length ? 'up' : '');
  set('action-day-pnl', moneyINR(dayPnl), portfolioValueClass(dayPnl));
  set('action-last-refresh', bgRefreshActive ? 'Refreshing...' : lastDashboardRefreshAt ? new Date(lastDashboardRefreshAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '--');
  const stockSearch = document.getElementById('search-box');
  if (stockSearch) stockSearch.style.display = currentView === 'stocks' ? '' : 'none';
  const newCard = document.getElementById('new-trades-card');
  if (newCard) newCard.classList.toggle('has-new', newEventTrades.length > 0);
  const openCard = document.getElementById('open-trades-card');
  if (openCard) openCard.classList.toggle('has-open', openTrades.length > 0);
  const simCard = document.getElementById('simulation-card');
  if (simCard) {
    simCard.classList.toggle('has-open', simulationState === 'settling');
    simCard.classList.toggle('has-new', simulationState === 'running');
    simCard.title = simulationState === 'running'
      ? 'Simulation is running. Click to stop new buys and settle open trades.'
      : simulationState === 'settling'
        ? 'Simulation is settling. Click to resume new buys.'
        : 'Simulation is off. Click to start automatic paper trades.';
  }
  const refreshCard = document.getElementById('last-refresh-card');
  if (refreshCard) {
    refreshCard.classList.toggle('has-new', !!bgRefreshActive);
    refreshCard.title = bgRefreshActive ? 'Refresh is running' : 'Refresh dashboard data now';
  }
  renderDashboardHealthBanner();
  renderNotificationPanel();
}

function renderDashboardHealthBanner() {
  const banner = document.getElementById('dashboard-health-banner');
  if (!banner) return;
  const items = getDashboardHealthItems();
  if (!dataSource) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  banner.className = items.length ? '' : 'ok';
  banner.textContent = items.length ? items.join(' | ') : 'Dashboard health OK';
}

function setColumnPreset(value) {
  columnPreset = value || 'trading';
  localStorage.setItem(COLUMN_PRESET_KEY, columnPreset);
  applyColumnPreset();
  if (columnPreset === 'etf' && dataSource && currentView !== 'etfs') setView('etfs', document.getElementById('tab-etfs'));
}

function applyColumnPreset() {
  document.body.classList.remove('preset-trading', 'preset-fundamentals', 'preset-risk', 'preset-compact', 'preset-etf', 'preset-all');
  document.body.classList.add(`preset-${columnPreset || 'trading'}`);
  const select = document.getElementById('column-preset-select');
  if (select && select.value !== columnPreset) select.value = columnPreset;
  syncStockScrollSizing();
}

function computeClosedPaperPnl(trade) {
  const exit = Number(trade?.exitPrice);
  return getPaperTradePnl(trade, exit)?.pnl ?? null;
}

function isOpenTrade(trade) {
  const status = String(trade?.status || '').toLowerCase();
  if (status !== 'open') return false;
  const brokerStatus = String(trade?.broker?.status || '').toLowerCase();
  if (['cancelled', 'rejected', 'timeout', 'failed'].includes(brokerStatus)) return false;
  return true;
}

function isClosedTrade(trade) {
  const status = String(trade?.status || '').toLowerCase();
  if (status === 'closed') return true;
  if (status !== 'open') return false;
  const brokerStatus = String(trade?.broker?.status || '').toLowerCase();
  return ['cancelled', 'rejected', 'timeout', 'failed'].includes(brokerStatus);
}

function portfolioValueClass(v) {
  const n = Number(v);
  return n >= 0 ? 'up' : 'down';
}

function getPortfolioRiskStats(trades = paperTrades, capital = getPortfolioCapital()) {
  const closed = (Array.isArray(trades) ? trades : [])
    .filter(t => String(t.status || '').toLowerCase() === 'closed')
    .slice()
    .sort((a, b) => new Date(a.closedAt || a.openedAt || 0) - new Date(b.closedAt || b.openedAt || 0));
  let equity = Number(capital) || 0;
  let peak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;
  let currentLossStreak = 0;
  for (const trade of closed) {
    const pnl = Number.isFinite(Number(trade.pnl)) ? Number(trade.pnl) : Number(computeClosedPaperPnl(trade) || 0);
    equity += pnl;
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
    if (pnl < 0) {
      lossStreak += 1;
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
      currentLossStreak = 0;
    }
  }
  return {
    maxDrawdown:+maxDrawdown.toFixed(2),
    maxDrawdownPct:+maxDrawdownPct.toFixed(3),
    maxLossStreak,
    currentLossStreak,
  };
}

function formatEntryJournal(trade) {
  const ctx = trade?.entryContext || {};
  const bits = [
    ctx.reason || (trade?.source === 'simulation' ? 'simulation selected' : 'manual entry'),
    trade?.setupType || '',
    ctx.indicators?.entryTrigger || '',
    ctx.indicators?.relVolume != null ? `Vol ${Number(ctx.indicators.relVolume).toFixed(2)}x` : '',
  ].filter(Boolean);
  return bits.join(' | ') || '--';
}

function renderPortfolioModal() {
  const body = document.getElementById('portfolio-modal-body');
  if (!body) return;
  const summary = getPortfolioSummary();
  const riskStats = getPortfolioRiskStats(paperTrades, summary.capital);
  const safety = getSimulationSafetySummary();
  const openCount = paperTrades.filter(isOpenTrade).length;
  const closedCount = paperTrades.filter(isClosedTrade).length;
  const todaysTrades = paperTrades.filter(isTradeToday);
  const transactionRows = todaysTrades.length ? todaysTrades.map(trade => {
    const isOpen = isOpenTrade(trade);
    const current = isOpen ? getCurrentTradePrice(trade.symbol) : Number(trade.exitPrice);
    const livePnl = getPaperTradePnl(trade, current);
    const pnlObj = isOpen ? livePnl : { pnl:Number(trade.pnl), pnlPct:Number(trade.pnlPct), grossPnl:Number(trade.grossPnl), charges:Number(trade.charges), chargeBreakup:trade.chargeBreakup };
    const pnl = Number.isFinite(pnlObj?.pnl) ? pnlObj.pnl : computeClosedPaperPnl(trade);
    const cls = portfolioValueClass(pnl || 0);
    const brokerLabel = getBrokerLabel(trade);
    const brokerOrder = trade.broker?.entryOrder ? formatZerodhaOrder(trade.broker.entryOrder) : brokerLabel;
    const breakdown = pnlObj?.chargeBreakup || livePnl?.chargeBreakup || {};
    const grossPnl = Number.isFinite(Number(pnlObj?.grossPnl)) ? Number(pnlObj.grossPnl) : null;
    const costTitle = `Brokerage ${moneyINR(breakdown.brokerage)} | STT ${moneyINR(breakdown.stt)} | Txn ${moneyINR(breakdown.transaction)} | GST ${moneyINR(breakdown.gst)} | SEBI ${moneyINR(breakdown.sebi)} | Stamp ${moneyINR(breakdown.stamp)}`;
    return `<tr>
      <td>${escapeHTML(trade.status || '--')}</td>
      <td>${escapeHTML(trade.source === 'simulation' ? 'Sim' : 'Manual')}</td>
      <td title="${escapeHTML(brokerOrder)}">${escapeHTML(brokerLabel)}</td>
      <td>${escapeHTML(trade.symbol || '--')}</td>
      <td>${escapeHTML(String(trade.side || '--').toUpperCase())}</td>
      <td>${Number(trade.qty || 0).toLocaleString('en-IN')}</td>
      <td>${moneyINR(trade.entryPrice)}</td>
      <td>${moneyINR(current)}</td>
      <td>${moneyINR(paperTradeExposure(trade))}</td>
      <td>${escapeHTML(formatTradeDateTime(trade.openedAt))}</td>
      <td>${escapeHTML(isOpen ? '--' : formatTradeDateTime(trade.closedAt))}</td>
      <td class="portfolio-journal-cell" title="${escapeHTML(formatEntryJournal(trade))}">${escapeHTML(formatEntryJournal(trade))}</td>
      <td class="portfolio-journal-cell" title="${escapeHTML(trade.closeReason || '--')}">${escapeHTML(trade.closeReason || '--')}</td>
      <td title="${escapeHTML(costTitle)}">${moneyINR(pnlObj?.charges)}</td>
      <td class="portfolio-pnl ${portfolioValueClass(grossPnl || 0)}">${moneyINR(grossPnl)}</td>
      <td class="portfolio-pnl ${cls}">${moneyINR(pnl)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="16" style="color:var(--muted);text-align:center;padding:16px">No transactions today</td></tr>`;
  const dayRows = Object.entries(summary.dayPnl).length ? Object.entries(summary.dayPnl)
    .map(([day, pnl]) => `<tr><td>${escapeHTML(day)}</td><td class="portfolio-pnl ${portfolioValueClass(pnl)}">${moneyINR(pnl)}</td></tr>`)
    .join('') : `<tr><td colspan="2" style="color:var(--muted);text-align:center;padding:16px">No closed trades yet</td></tr>`;

  body.innerHTML = `
    <div class="portfolio-capital-row">
      <div>
        <div class="portfolio-section-title" style="margin:0 0 4px">Capital</div>
        <div style="font-size:11px;color:var(--muted)">Add funds to paper portfolio; saved in paper_trades.json.</div>
      </div>
      <div class="portfolio-capital-actions">
        <input id="portfolio-add-capital-input" class="portfolio-capital-input" type="number" min="1" step="1000" placeholder="Amount" />
        <button class="paper-btn buy" onclick="addPortfolioCapital()">Add</button>
      </div>
    </div>
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Initial capital</div><div class="value">${moneyINR(summary.initial)}</div></div>
      <div class="portfolio-card"><div class="label">Added capital</div><div class="value">${moneyINR(summary.addedCapital)}</div></div>
      <div class="portfolio-card"><div class="label">Total capital</div><div class="value">${moneyINR(summary.capital)}</div></div>
      <div class="portfolio-card"><div class="label">Portfolio value</div><div class="value ${portfolioValueClass(summary.totalPnl)}">${moneyINR(summary.portfolioValue)}</div></div>
      <div class="portfolio-card"><div class="label">Total P&L</div><div class="value ${portfolioValueClass(summary.totalPnl)}">${moneyINR(summary.totalPnl)}</div></div>
      <div class="portfolio-card"><div class="label">Available cash</div><div class="value ${summary.cashAvailable >= 0 ? '' : 'down'}">${moneyINR(summary.cashAvailable)}</div></div>
      <div class="portfolio-card"><div class="label">Realized P&L</div><div class="value ${portfolioValueClass(summary.realized)}">${moneyINR(summary.realized)}</div></div>
      <div class="portfolio-card"><div class="label">Open P&L</div><div class="value ${portfolioValueClass(summary.unrealized)}">${moneyINR(summary.unrealized)}</div></div>
      <div class="portfolio-card"><div class="label">Open exposure</div><div class="value">${moneyINR(summary.openExposure)}</div></div>
      <div class="portfolio-card"><div class="label">Trades</div><div class="value">${openCount} open / ${closedCount} closed</div></div>
      <div class="portfolio-card"><div class="label">Max drawdown</div><div class="value ${riskStats.maxDrawdown > 0 ? 'down' : ''}">${moneyINR(riskStats.maxDrawdown)} (${riskStats.maxDrawdownPct}%)</div></div>
      <div class="portfolio-card"><div class="label">Loss streak</div><div class="value ${riskStats.currentLossStreak > 0 ? 'down' : ''}">${riskStats.currentLossStreak} now / ${riskStats.maxLossStreak} max</div></div>
    </div>
    <div class="portfolio-section-title">Simulation Safety</div>
    <div class="portfolio-grid safety-grid">
      <div class="portfolio-card"><div class="label">State</div><div class="value">${escapeHTML(String(safety.state || '--').toUpperCase())}</div></div>
      <div class="portfolio-card"><div class="label">Open slots</div><div class="value">${safety.slots} usable / ${safety.activeSlots} active</div></div>
      <div class="portfolio-card"><div class="label">Daily entries</div><div class="value">${safety.entries} / ${safety.maxEntries}</div></div>
      <div class="portfolio-card"><div class="label">First hour</div><div class="value">${safety.firstHourEntries} / ${safety.firstHourMax}</div></div>
      <div class="portfolio-card"><div class="label">Stop guard</div><div class="value ${safety.stops >= safety.stopLimit ? 'down' : ''}">${safety.stops} / ${safety.stopLimit}</div></div>
      <div class="portfolio-card"><div class="label">Fresh-entry status</div><div class="value ${safety.blocked ? 'down' : ''}">${escapeHTML(safety.blocked ? safety.reasons.join(' | ') : 'Allowed')}</div></div>
    </div>
    <div class="portfolio-section-title">Today's Transactions (${todaysTrades.length})</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table">
        <thead><tr><th>Status</th><th>Mode</th><th>Broker</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit/Live</th><th>Capital</th><th>Entry Time</th><th>Exit Time</th><th>Entry Why</th><th>Exit Reason</th><th>Total Cost</th><th>Gross P&L</th><th>Net P&L</th></tr></thead>
        <tbody>${transactionRows}</tbody>
      </table>
    </div>
    <div class="portfolio-section-title">Zerodha Connection Status</div>
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Mode</div><div class="value">${escapeHTML(brokerConnectionStatus?.mode || 'paper')}</div></div>
      <div class="portfolio-card"><div class="label">Credentials</div><div class="value">${brokerConnectionStatus?.zerodha?.credentialsLoaded ? '✅ Loaded' : '❌ Missing'}</div></div>
      <div class="portfolio-card"><div class="label">API Clients</div><div class="value">${brokerConnectionStatus?.zerodha?.clientsInitialized ? '✅ Ready' : '⚠️ Not initialized'}</div></div>
      <div class="portfolio-card"><div class="label">Poller</div><div class="value">${brokerConnectionStatus?.zerodha?.pollerRunning ? '🟢 Running' : '⚫ Stopped'}</div></div>
      <div class="portfolio-card"><div class="label">Failures</div><div class="value">${brokerConnectionStatus?.zerodha?.failureCount || 0} / 3 (threshold)</div></div>
      <div class="portfolio-card"><div class="label">Live Status</div><div class="value">${brokerConnectionStatus?.zerodha?.isDisabled ? '🔴 Disabled' : '🟢 Enabled'}</div></div>
      <div class="portfolio-card"><div class="label">Zerodha cash</div><div class="value">${zerodhaPortfolioState?.ok ? moneyINR(zerodhaPortfolioState?.data?.portfolio?.funds?.availableCash || 0) : '--'}</div></div>
      <div class="portfolio-card"><div class="label">Zerodha day P&L</div><div class="value ${Number(zerodhaPortfolioState?.data?.portfolio?.positions?.dayPnl || 0) < 0 ? 'down' : ''}">${zerodhaPortfolioState?.ok ? moneyINR(zerodhaPortfolioState?.data?.portfolio?.positions?.dayPnl || 0) : '--'}</div></div>
    </div>
    <div class="portfolio-section-title">Recent Trade Confirmations</div>
    <div class="portfolio-table-wrap" id="zerodha-confirmations-table">
      <table class="portfolio-table" style="min-width:500px">
        <thead><tr><th>Symbol</th><th>Order ID</th><th>Status</th><th>Attempts</th><th>Last Event</th></tr></thead>
        <tbody id="zerodha-confirmations-tbody">
          <tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px">No recent confirmations</td></tr>
        </tbody>
      </table>
    </div>
    <div class="portfolio-section-title">Day Wise Realized P&L</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table" style="min-width:360px">
        <thead><tr><th>Day</th><th>P&L</th></tr></thead>
        <tbody>${dayRows}</tbody>
      </table>
    </div>
  `;
}

async function addPortfolioCapital() {
  const input = document.getElementById('portfolio-add-capital-input');
  const amount = Number(input?.value);
  if (!Number.isFinite(amount) || amount <= 0) { alert('Enter a positive capital amount.'); return; }
  try {
    await postPaperTrade('add-capital', { amount, note:'Manual portfolio capital add' });
    if (input) input.value = '';
    await loadPaperTrades();
    renderTable();
    if (currentView === 'etfs') renderETFSection();
    renderPortfolioModal();
  } catch (e) {
    alert(e.message || 'Could not add capital');
  }
}

async function openPortfolioModal() {
  const modal = document.getElementById('portfolio-modal');
  if (modal) modal.style.display = 'flex';
  const body = document.getElementById('portfolio-modal-body');
  if (!paperTradesLoaded && body) {
    body.innerHTML = `<div style="color:var(--muted);padding:16px">Loading portfolio...</div>`;
    await loadPaperTrades();
  }
  renderPortfolioModal();
  updateZerodhaConfirmationsTable();
}

function closePortfolioModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('portfolio-modal');
  if (modal) modal.style.display = 'none';
}

function formatSettingValue(value, key) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (key === 'PORTFOLIO_INITIAL_CAPITAL' || key === 'MAX_POSITION_EXPOSURE') return moneyINR(n);
  if (/_PCT$/.test(key)) return `${n.toLocaleString('en-IN', { maximumFractionDigits: 3 })}%`;
  if (/_MIN$/.test(key)) return `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} min`;
  return n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function loadTradeSettingOverrides() {
  if (tradeSettingOverrides && typeof tradeSettingOverrides === 'object') return tradeSettingOverrides;
  try {
    const parsed = JSON.parse(localStorage.getItem(TRADE_SETTING_OVERRIDES_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function loadTradeSettingOverridesFromServer() {
  const bootOverrides = dashboardBootstrap?.tradeSettings?.overrides;
  if (bootOverrides && typeof bootOverrides === 'object' && !Array.isArray(bootOverrides)) {
    tradeSettingOverrides = bootOverrides;
    localStorage.setItem(TRADE_SETTING_OVERRIDES_KEY, JSON.stringify(tradeSettingOverrides));
    return;
  }
  try {
    const res = await fetch(TRADE_SETTINGS_ENDPOINT, { signal:AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('trade-settings HTTP ' + res.status);
    const payload = await res.json().catch(() => ({}));
    tradeSettingOverrides = payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {};
    localStorage.setItem(TRADE_SETTING_OVERRIDES_KEY, JSON.stringify(tradeSettingOverrides));
  } catch (e) {
    tradeSettingOverrides = loadTradeSettingOverrides();
    console.warn('trade settings load failed', e.message);
  }
}

async function saveTradeSettingOverrides(overrides) {
  tradeSettingOverrides = overrides || {};
  localStorage.setItem(TRADE_SETTING_OVERRIDES_KEY, JSON.stringify(tradeSettingOverrides));
  try {
    const res = await fetch(TRADE_SETTINGS_ENDPOINT, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ overrides:tradeSettingOverrides }),
      signal:AbortSignal.timeout(5000),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || 'trade-settings HTTP ' + res.status);
    tradeSettingOverrides = payload.overrides || tradeSettingOverrides;
  } catch(e) {
    console.warn('trade settings save failed', e.message);
  }
}

async function toggleSimulationStopGuardOverride() {
  const current = loadTradeSettingOverrides();
  const enabledNow = !!(current?.SIMULATION_OVERRIDE_STOP_GUARD ?? SIMULATION_OVERRIDE_STOP_GUARD);
  const next = { ...current, SIMULATION_OVERRIDE_STOP_GUARD: !enabledNow };
  await saveTradeSettingOverrides(next);
  renderTopActionBar();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

async function toggleManualTradeAutoExitOverride() {
  const current = loadTradeSettingOverrides();
  const enabledNow = !!(current?.SIMULATION_AUTO_MANUAL_EXITS ?? SIMULATION_AUTO_MANUAL_EXITS);
  const next = { ...current, SIMULATION_AUTO_MANUAL_EXITS: !enabledNow };
  await saveTradeSettingOverrides(next);
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

async function setNiftyRegimeOverride(valueStr) {
  const current = loadTradeSettingOverrides();
  const value = parseFloat(valueStr);
  if (Number.isFinite(value) && value >= -1 && value <= 1) {
    const next = { ...current, SIMULATION_MARKET_REGIME_NIFTY_PCT: value };
    await saveTradeSettingOverrides(next);
    if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
  }
}

async function setSectorRegimeOverride(valueStr) {
  const current = loadTradeSettingOverrides();
  const value = parseFloat(valueStr);
  if (Number.isFinite(value) && value >= -1 && value <= 1) {
    const next = { ...current, SIMULATION_MARKET_REGIME_SECTOR_PCT: value };
    await saveTradeSettingOverrides(next);
    if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
  }
}

async function setDailyMaxTradesOverride(valueStr) {
  const current = loadTradeSettingOverrides();
  const value = Math.round(Number(valueStr));
  if (Number.isFinite(value) && value >= 1 && value <= 200) {
    const next = { ...current, SIMULATION_DAILY_MAX_TRADES: value };
    await saveTradeSettingOverrides(next);
    if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
  }
}

async function setMaxOpenTradesOverride(valueStr) {
  const current = loadTradeSettingOverrides();
  const value = Math.round(Number(valueStr));
  if (Number.isFinite(value) && value >= 1 && value <= 100) {
    const next = { ...current, SIMULATION_MAX_OPEN: value };
    await saveTradeSettingOverrides(next);
    if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
  }
}

function clearMaxOpenTradesOverride() {
  const current = loadTradeSettingOverrides();
  const next = { ...current };
  delete next.SIMULATION_MAX_OPEN;
  saveTradeSettingOverrides(next);
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

function clearDailyMaxTradesOverride() {
  const current = loadTradeSettingOverrides();
  const next = { ...current };
  delete next.SIMULATION_DAILY_MAX_TRADES;
  saveTradeSettingOverrides(next);
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

function clearNiftyRegimeOverride() {
  const current = loadTradeSettingOverrides();
  const next = { ...current };
  delete next.SIMULATION_MARKET_REGIME_NIFTY_PCT;
  saveTradeSettingOverrides(next);
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

function clearSectorRegimeOverride() {
  const current = loadTradeSettingOverrides();
  const next = { ...current };
  delete next.SIMULATION_MARKET_REGIME_SECTOR_PCT;
  saveTradeSettingOverrides(next);
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

async function applyReplaySettings(row) {
  if (!row) return;
  const current = loadTradeSettingOverrides();
  const next = {
    ...current,
    SIMULATION_MIN_SCORE:Number(row.minScore),
    SIMULATION_TOP_N:Number(row.topN),
    SIMULATION_MAX_NEW_PER_CYCLE:Number(row.perCycle),
    SIMULATION_FIRST_HOUR_MAX_ENTRIES:Number(row.firstHour),
    SIMULATION_LONG_TRAIL_PCT:Number(row.trail),
    SIMULATION_STOP_CONFIRM_BARS:Number(row.stopConfirm),
    SIMULATION_EXIT_FADE_CONFIRM_BARS:Number(row.fadeConfirm),
    SIMULATION_STOP_GRACE_MIN:Number(row.stopGrace),
    SIMULATION_TARGET_PARTIAL_QTY_PCT:Number(row.partialQty),
  };
  Object.keys(next).forEach(key => {
    if (!Number.isFinite(Number(next[key]))) delete next[key];
  });
  await saveTradeSettingOverrides(next);
  alert('Applied replay settings. New simulation cycles will use them.');
  if (document.getElementById('settings-modal')?.style.display === 'flex') renderSettingsModal();
}

function renderSettingsModal() {
  const body = document.getElementById('settings-modal-body');
  if (!body) return;
  const defaults = TradeRules.DEFAULT_SETTINGS || {};
  const descriptions = TradeRules.SETTING_DESCRIPTIONS || {};
  const overrides = loadTradeSettingOverrides();
  const effective = TradeRules.withDefaults ? TradeRules.withDefaults(getSimulationEngineSettings()) : { ...defaults, ...getSimulationEngineSettings() };
  const summary = getPortfolioSummary();
  const stopGuardOverride = !!effective.SIMULATION_OVERRIDE_STOP_GUARD;
  const manualAutoExitEnabled = !!effective.SIMULATION_AUTO_MANUAL_EXITS;
  const niftyRegimeOverride = overrides.SIMULATION_MARKET_REGIME_NIFTY_PCT;
  const niftyRegimeValue = Number.isFinite(niftyRegimeOverride) ? niftyRegimeOverride : effective.SIMULATION_MARKET_REGIME_NIFTY_PCT;
  const sectorRegimeOverride = overrides.SIMULATION_MARKET_REGIME_SECTOR_PCT;
  const sectorRegimeValue = Number.isFinite(sectorRegimeOverride) ? sectorRegimeOverride : effective.SIMULATION_MARKET_REGIME_SECTOR_PCT;
  const dailyMaxTradesOverrideRaw = overrides.SIMULATION_DAILY_MAX_TRADES;
  const dailyMaxTradesOverride = Number.isFinite(Number(dailyMaxTradesOverrideRaw)) ? Number(dailyMaxTradesOverrideRaw) : null;
  const dailyMaxTradesValue = Number.isFinite(dailyMaxTradesOverride)
    ? Math.round(dailyMaxTradesOverride)
    : Math.round(Number(effective.SIMULATION_DAILY_MAX_TRADES) || Number(defaults.SIMULATION_DAILY_MAX_TRADES) || 0);
  const maxOpenTradesOverrideRaw = overrides.SIMULATION_MAX_OPEN;
  const maxOpenTradesOverride = Number.isFinite(Number(maxOpenTradesOverrideRaw)) ? Number(maxOpenTradesOverrideRaw) : null;
  const maxOpenTradesValue = Number.isFinite(maxOpenTradesOverride)
    ? Math.round(maxOpenTradesOverride)
    : Math.round(Number(effective.SIMULATION_MAX_OPEN) || Number(defaults.SIMULATION_MAX_OPEN) || 0);
  const liveBroker = brokerMode === 'sharekhan_live' ? 'sharekhan' : 'zerodha';
  const brokerStatus = liveBroker === 'sharekhan' ? brokerConnectionStatus?.sharekhan : brokerConnectionStatus?.zerodha;
  const autoRenewConfigured = !!brokerStatus?.autoRenewConfigured;
  const lastRefreshAtTs = Number(brokerStatus?.lastTokenRefreshAt || 0);
  const lastRefreshAt = lastRefreshAtTs ? toIST(lastRefreshAtTs) : '--';
  const refreshHint = brokerRefreshState.message || (autoRenewConfigured ? 'Ready for manual refresh' : `Add ${liveBroker} token credentials`);
  const rows = Object.keys(defaults).map(key => {
    const current = effective[key];
    const def = defaults[key];
    return `<tr>
      <td class="settings-key">${escapeHTML(key)}</td>
      <td class="settings-desc">${escapeHTML(descriptions[key] || 'No description available.')}</td>
      <td class="settings-value">${overrides[key] != null ? '<span class="settings-override">override</span> ' : ''}${escapeHTML(formatSettingValue(current, key))}</td>
      <td class="settings-value">${escapeHTML(formatSettingValue(def, key))}</td>
    </tr>`;
  }).join('');
  body.innerHTML = `
    <div class="settings-summary">
      <div class="settings-card"><div class="label">Portfolio capital</div><div class="value">${moneyINR(effective.PORTFOLIO_INITIAL_CAPITAL)}</div></div>
      <div class="settings-card"><div class="label">Per position cap</div><div class="value">${moneyINR(effective.MAX_POSITION_EXPOSURE)}</div></div>
      <div class="settings-card"><div class="label">Minimum net profit</div><div class="value">${formatSettingValue(effective.SIMULATION_MIN_NET_PROFIT_PCT, 'SIMULATION_MIN_NET_PROFIT_PCT')}</div></div>
      <div class="settings-card"><div class="label">Max open trades</div><div class="value ${Number.isFinite(maxOpenTradesOverride) ? 'up' : ''}">${maxOpenTradesValue}</div><div style="margin-top:8px"><input type="number" step="1" min="1" max="100" value="${maxOpenTradesValue}" onchange="setMaxOpenTradesOverride(this.value)" style="width:80px; padding:4px"><span style="margin-left:8px; font-size:11px">${Number.isFinite(maxOpenTradesOverride) ? 'Override active' : 'Using default'}</span>${Number.isFinite(maxOpenTradesOverride) ? ` <button class="btn" type="button" onclick="clearMaxOpenTradesOverride()" style="margin-left:8px; font-size:12px">Reset</button>` : ''}</div></div>
      <div class="settings-card"><div class="label">Daily max trades</div><div class="value ${Number.isFinite(dailyMaxTradesOverride) ? 'up' : ''}">${dailyMaxTradesValue}</div><div style="margin-top:8px"><input type="number" step="1" min="1" max="200" value="${dailyMaxTradesValue}" onchange="setDailyMaxTradesOverride(this.value)" style="width:80px; padding:4px"><span style="margin-left:8px; font-size:11px">${Number.isFinite(dailyMaxTradesOverride) ? 'Override active' : 'Using default'}</span>${Number.isFinite(dailyMaxTradesOverride) ? ` <button class="btn" type="button" onclick="clearDailyMaxTradesOverride()" style="margin-left:8px; font-size:12px">Reset</button>` : ''}</div></div>
      <div class="settings-card"><div class="label">${liveBroker === 'sharekhan' ? 'Sharekhan token' : 'Zerodha token'}</div><div class="value ${brokerRefreshState.ok === false ? 'down' : (brokerRefreshState.ok ? 'up' : '')}">${autoRenewConfigured ? 'Auto-renew ready' : 'Refresh token missing'}</div><div style="margin-top:8px"><button class="btn" type="button" onclick="refreshZerodhaTokenFromSettings()" ${brokerRefreshState.busy || !autoRenewConfigured ? 'disabled' : ''}>${brokerRefreshState.busy ? 'Refreshing...' : 'Refresh token now'}</button><span style="margin-left:8px; font-size:11px">Last refresh: ${escapeHTML(lastRefreshAt)}</span></div><div style="margin-top:6px; font-size:11px; color:${brokerRefreshState.ok === false ? 'var(--red)' : 'var(--muted)'}">${escapeHTML(refreshHint)}</div></div>
      <div class="settings-card"><div class="label">Stop guard override</div><div class="value ${stopGuardOverride ? 'up' : ''}">${stopGuardOverride ? 'Enabled' : 'Disabled'}</div><div style="margin-top:8px"><button class="btn" type="button" onclick="toggleSimulationStopGuardOverride()">${stopGuardOverride ? 'Disable override' : 'Enable override'}</button></div></div>
      <div class="settings-card"><div class="label">Auto-exit manual trades</div><div class="value ${manualAutoExitEnabled ? 'up' : ''}">${manualAutoExitEnabled ? 'Enabled' : 'Disabled'}</div><div style="margin-top:8px"><button class="btn" type="button" onclick="toggleManualTradeAutoExitOverride()">${manualAutoExitEnabled ? 'Disable auto exits' : 'Enable auto exits'}</button></div><div style="margin-top:6px;font-size:11px;color:var(--muted)">Uses same simulation exit rules (target, SL, trailing, time-stop, EOD).</div></div>
      <div class="settings-card"><div class="label">Nifty regime threshold</div><div class="value ${Number.isFinite(niftyRegimeOverride) ? 'up' : ''}">${niftyRegimeValue.toFixed(3)}</div><div style="margin-top:8px"><input type="number" step="0.001" min="-1" max="1" value="${niftyRegimeValue.toFixed(3)}" onchange="setNiftyRegimeOverride(this.value)" style="width:80px; padding:4px"><span style="margin-left:8px; font-size:11px">${Number.isFinite(niftyRegimeOverride) ? 'Override active' : 'Using default'}</span>${Number.isFinite(niftyRegimeOverride) ? ` <button class="btn" type="button" onclick="clearNiftyRegimeOverride()" style="margin-left:8px; font-size:12px">Reset</button>` : ''}</div><div style="margin-top:6px;font-size:11px;color:var(--muted)">Blocks longs below -threshold, blocks shorts above +threshold.</div></div>
      <div class="settings-card"><div class="label">Sector regime threshold</div><div class="value ${Number.isFinite(sectorRegimeOverride) ? 'up' : ''}">${sectorRegimeValue.toFixed(3)}</div><div style="margin-top:8px"><input type="number" step="0.001" min="-1" max="1" value="${sectorRegimeValue.toFixed(3)}" onchange="setSectorRegimeOverride(this.value)" style="width:80px; padding:4px"><span style="margin-left:8px; font-size:11px">${Number.isFinite(sectorRegimeOverride) ? 'Override active' : 'Using default'}</span>${Number.isFinite(sectorRegimeOverride) ? ` <button class="btn" type="button" onclick="clearSectorRegimeOverride()" style="margin-left:8px; font-size:12px">Reset</button>` : ''}</div><div style="margin-top:6px;font-size:11px;color:var(--muted)">Uses sector average move with the same long/short threshold logic.</div></div>
    </div>
    <div class="portfolio-section-title">Effective Trade Rule Settings</div>
    <div class="settings-table-wrap">
      <table class="settings-table">
        <thead><tr><th>Setting</th><th>Description</th><th>Current value</th><th>Default</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function openSettingsModal() {
  renderSettingsModal();
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'flex';
}

function closeSettingsModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('settings-modal');
  if (modal) modal.style.display = 'none';
}

async function refreshZerodhaTokenFromSettings() {
  if (brokerRefreshState.busy) return;
  brokerRefreshState = { busy:true, ok:null, message:'Refreshing token...' };
  renderSettingsModal();
  try {
    const res = await fetch(BROKER_REFRESH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual:true, broker: brokerMode === 'sharekhan_live' ? 'sharekhan' : 'zerodha' }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      throw new Error(payload.error || payload.hint || `HTTP ${res.status}`);
    }
    brokerRefreshState = { busy:false, ok:true, message:'Token refreshed successfully' };
    await pollBrokerStatus();
  } catch (e) {
    brokerRefreshState = { busy:false, ok:false, message: e.message || 'Token refresh failed' };
  }
  renderSettingsModal();
}

function isZerodhaDryRun() {
  return brokerMode === 'zerodha_dry_run';
}

function getBrokerLabel(trade) {
  const broker = trade?.broker;
  if (broker?.name === 'zerodha' && broker?.mode === 'dry-run') return 'Zerodha Dry';
  if (broker?.name === 'zerodha' && broker?.mode === 'live') return 'Zerodha Live';
  if (broker?.name === 'sharekhan' && broker?.mode === 'live') return 'Sharekhan Live';
  return 'Paper';
}

function formatZerodhaOrder(order) {
  if (!order) return '--';
  return [
    order.exchange,
    order.tradingsymbol,
    order.transaction_type,
    order.quantity,
    order.product,
    order.order_type,
    moneyINR(order.price),
  ].filter(v => v != null && v !== '').join(' ');
}

function formatZerodhaPillMoney(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const compact = abs >= 10000000 ? `${(n / 10000000).toFixed(2)}Cr` : abs >= 100000 ? `${(n / 100000).toFixed(2)}L` : `${Math.round(n).toLocaleString('en-IN')}`;
  return `${n < 0 ? '-' : ''}₹${compact.replace('-', '')}`;
}

function updateZerodhaPortfolioPill() {
  const pill = document.getElementById('zerodha-portfolio-pill');
  if (!pill) return;
  const brokerName = brokerMode === 'sharekhan_live' ? 'Sharekhan' : 'Zerodha';
  pill.classList.remove('live', 'warn', 'down');

  if (zerodhaPortfolioState.loading) {
    pill.textContent = `${brokerName} ...`;
    pill.title = `Fetching ${brokerName} portfolio state... Click for positions`;
    pill.classList.add('warn');
    return;
  }

  if (!zerodhaPortfolioState.ok || !zerodhaPortfolioState.data?.portfolio) {
    pill.textContent = `${brokerName} N/A`;
    pill.title = zerodhaPortfolioState.error || `${brokerName} portfolio is unavailable.`;
    pill.classList.add('down');
    return;
  }

  const p = zerodhaPortfolioState.data.portfolio;
  const cash = Number(p?.funds?.availableCash || 0);
  const dayPnl = Number(p?.positions?.dayPnl || 0);
  const openCount = Number(p?.positions?.openCount || 0);
  const holdingsCount = Number(p?.holdings?.count || 0);
  const asOf = Number(p?.asOf || 0);

  pill.textContent = `${brokerName} ${formatZerodhaPillMoney(cash)} | P&L ${formatZerodhaPillMoney(dayPnl)}`;
  pill.title = [
    `Available cash: ${moneyINR(cash)}`,
    `Day P&L: ${moneyINR(dayPnl)}`,
    `Open positions: ${openCount}`,
    `Holdings: ${holdingsCount}`,
    `As of: ${asOf ? toIST(asOf) : '--'}`,
    'Click to view positions',
  ].join(' | ');
  pill.classList.add(dayPnl >= 0 ? 'live' : 'warn');
}

function toggleZerodhaPositionsPanel() {
  const panel = document.getElementById('zerodha-positions-panel');
  if (!panel) return;
  zerodhaPositionsPanelOpen = !zerodhaPositionsPanelOpen;
  if (zerodhaPositionsPanelOpen) {
    renderZerodhaPositionsPanel();
  } else {
    panel.style.display = 'none';
  }
}

function closeZerodhaPositionsPanel() {
  const panel = document.getElementById('zerodha-positions-panel');
  if (panel) panel.style.display = 'none';
  zerodhaPositionsPanelOpen = false;
}

function renderZerodhaPortfolioModal() {
  const body = document.getElementById('zerodha-portfolio-modal-body');
  if (!body) return;

  if (zerodhaPortfolioState.loading) {
    body.innerHTML = `<div style="color:var(--muted);padding:16px">Loading Zerodha portfolio...</div>`;
    return;
  }

  if (!zerodhaPortfolioState.ok || !zerodhaPortfolioState.data?.portfolio) {
    body.innerHTML = `<div style="color:var(--red);padding:16px">${escapeHTML(zerodhaPortfolioState.error || 'Portfolio data not available')}</div>`;
    return;
  }

  const p = zerodhaPortfolioState.data.portfolio;
  const funds = p?.funds || {};
  const holdings = Array.isArray(p?.holdings?.list) ? p.holdings.list : [];
  const positions = Array.isArray(p?.positions?.list) ? p.positions.list : [];

  const holdingRows = holdings.length
    ? holdings.map(h => {
      const pnl = Number(h.pnl || 0);
      const dayChangePct = Number(h.dayChangePct || 0);
      const dayClass = dayChangePct < 0 ? 'down' : 'up';
      return `<tr>
        <td>${escapeHTML(h.symbol || '--')}</td>
        <td>${Number(h.qty || 0).toLocaleString('en-IN')}</td>
        <td>${moneyINR(h.avgPrice)}</td>
        <td>${moneyINR(h.ltp)}</td>
        <td>${moneyINR(h.investedValue)}</td>
        <td>${moneyINR(h.marketValue)}</td>
        <td class="portfolio-pnl ${portfolioValueClass(pnl)}">${moneyINR(pnl)}</td>
        <td class="portfolio-pnl ${dayClass}">${Number.isFinite(dayChangePct) ? `${dayChangePct.toFixed(2)}%` : '--'}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:16px">No holdings</td></tr>`;

  const positionRows = positions.length
    ? positions.map(pos => {
      const pnl = Number(pos.pnl || 0);
      return `<tr>
        <td>${escapeHTML(pos.symbol || '--')}</td>
        <td>${Number(pos.qty || 0).toLocaleString('en-IN')}</td>
        <td>${moneyINR(pos.avgPrice)}</td>
        <td>${moneyINR(pos.ltp)}</td>
        <td>${moneyINR(pos.investedValue)}</td>
        <td class="portfolio-pnl ${portfolioValueClass(pnl)}">${moneyINR(pnl)}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:16px">No open positions</td></tr>`;

  body.innerHTML = `
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Available cash</div><div class="value">${moneyINR(funds.availableCash)}</div></div>
      <div class="portfolio-card"><div class="label">Utilized margin</div><div class="value">${moneyINR(funds.utilizedMargin)}</div></div>
      <div class="portfolio-card"><div class="label">Net equity</div><div class="value">${moneyINR(funds.netEquity)}</div></div>
      <div class="portfolio-card"><div class="label">Holdings</div><div class="value">${Number(p?.holdings?.count || 0).toLocaleString('en-IN')}</div></div>
      <div class="portfolio-card"><div class="label">Holdings value</div><div class="value">${moneyINR(p?.holdings?.marketValue || 0)}</div></div>
      <div class="portfolio-card"><div class="label">Open positions</div><div class="value">${Number(p?.positions?.openCount || 0).toLocaleString('en-IN')}</div></div>
      <div class="portfolio-card"><div class="label">Day P&L</div><div class="value ${portfolioValueClass(p?.positions?.dayPnl || 0)}">${moneyINR(p?.positions?.dayPnl || 0)}</div></div>
      <div class="portfolio-card"><div class="label">Total P&L</div><div class="value ${portfolioValueClass(p?.positions?.totalPnl || 0)}">${moneyINR(p?.positions?.totalPnl || 0)}</div></div>
    </div>
    <div class="portfolio-section-title">Holdings (${holdings.length})</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table" style="min-width:980px">
        <thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Invested</th><th>Market Value</th><th>P&L</th><th>Day %</th></tr></thead>
        <tbody>${holdingRows}</tbody>
      </table>
    </div>
    <div class="portfolio-section-title">Open Positions (${positions.length})</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table" style="min-width:820px">
        <thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Invested</th><th>P&L</th></tr></thead>
        <tbody>${positionRows}</tbody>
      </table>
    </div>
  `;
}

async function openZerodhaPortfolioModal() {
  const modal = document.getElementById('zerodha-portfolio-modal');
  if (modal) modal.style.display = 'flex';
  renderZerodhaPortfolioModal();
  if (!zerodhaPortfolioState.ok && !zerodhaPortfolioState.loading) {
    await pollZerodhaPortfolioState();
  }
}

function closeZerodhaPortfolioModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('zerodha-portfolio-modal');
  if (modal) modal.style.display = 'none';
}

function renderZerodhaPositionsPanel() {
  const panel = document.getElementById('zerodha-positions-panel');
  if (!panel) return;

  if (!zerodhaPortfolioState.ok || !zerodhaPortfolioState.data) {
    panel.innerHTML = `<div class="empty">Portfolio data not available</div>`;
    panel.style.display = 'block';
    return;
  }

  const p = zerodhaPortfolioState.data.portfolio;
  const positions = p?.positions || {};
  const openCount = Number(positions.openCount || 0);
  const posList = positions.list || [];

  if (openCount === 0) {
    panel.innerHTML = `<div class="empty">No open positions</div>`;
    panel.style.display = 'block';
    return;
  }

  const header = `<div class="header"><span>Open Positions (${openCount})</span><button class="header-close" onclick="closeZerodhaPositionsPanel()">×</button></div>`;
  let rows = '';
  for (const pos of posList.slice(0, 10)) {
    const pnlColor = pos.pnl >= 0 ? 'var(--green)' : 'var(--red)';
    const pnlSign = pos.pnl >= 0 ? '+' : '';
    rows += `<div class="pos-row">
      <div class="pos-symbol">${pos.symbol}</div>
      <div class="pos-qty">${Math.round(pos.qty)}</div>
      <div class="pos-pnl" style="color:${pnlColor}">${pnlSign}${moneyINR(pos.pnl)}</div>
    </div>`;
  }
  panel.innerHTML = header + rows;
  panel.style.display = 'block';
}

function setupZerodhaPositionsPanelClickAway() {
  document.addEventListener('click', (e) => {
    if (!zerodhaPositionsPanelOpen) return;
    const panel = document.getElementById('zerodha-positions-panel');
    const pill = document.getElementById('zerodha-portfolio-pill');
    if (panel && pill && !panel.contains(e.target) && !pill.contains(e.target)) {
      closeZerodhaPositionsPanel();
    }
  });
}

function updateBrokerModeButton() {
  const btn = document.getElementById('broker-mode-btn');
  if (!btn) return;
  btn.classList.remove('broker-dry', 'broker-live', 'primary');
  
  if (brokerMode === 'zerodha_live') {
    btn.classList.add('broker-live');
    const status = brokerConnectionStatus?.zerodha?.isDisabled ? '🔴' : '🟢';
    btn.textContent = `${status} Zerodha Live`;
    btn.title = brokerConnectionStatus?.zerodha?.isDisabled 
      ? 'Zerodha Live is disabled due to repeated failures. Switch mode to reset.' 
      : 'Live mode: trades are executed against real Zerodha account.';
  } else if (brokerMode === 'zerodha_dry_run') {
    btn.classList.add('broker-dry');
    const status = brokerConnectionStatus?.zerodha?.clientsInitialized ? '🟡' : '🔴';
    btn.textContent = `${status} Zerodha Dry`;
    btn.title = 'Dry-run mode: trades remain virtual and Zerodha order payloads are saved for validation.';
  } else if (brokerMode === 'sharekhan_live') {
    btn.classList.add('broker-live');
    const status = brokerConnectionStatus?.sharekhan?.isDisabled ? '🔴' : '🟢';
    btn.textContent = `${status} Sharekhan Live`;
    btn.title = brokerConnectionStatus?.sharekhan?.isDisabled
      ? 'Sharekhan Live is disabled due to repeated failures. Switch mode to reset.'
      : 'Live mode: trades are executed against real Sharekhan account.';
  } else {
    btn.textContent = '📄 Paper';
    btn.title = 'Paper mode: trades are virtual only.';
  }
}

function toggleBrokerMode() {
  // Cycle through: paper → zerodha_dry_run → zerodha_live → sharekhan_live → paper
  if (brokerMode === 'paper') {
    brokerMode = 'zerodha_dry_run';
  } else if (brokerMode === 'zerodha_dry_run') {
    brokerMode = 'zerodha_live';
  } else if (brokerMode === 'zerodha_live') {
    brokerMode = 'sharekhan_live';
  } else if (brokerMode === 'sharekhan_live') {
    brokerMode = 'paper';
  } else {
    brokerMode = 'paper';
  }
  localStorage.setItem(BROKER_MODE_KEY, brokerMode);
  
  // Update mode on backend
  fetch('/broker-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: brokerMode }),
  }).catch(e => console.warn('[broker] Mode change failed:', e.message));
  
  updateBrokerModeButton();
  renderTable();
  if (currentView === 'etfs') renderETFSection();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
}

function setSimulationState(state) {
  simulationState = ['running', 'settling'].includes(state) ? state : 'off';
  localStorage.setItem(SIMULATION_STATE_KEY, simulationState);
  updateSimulationButton();
  renderTopActionBar();
}

function updateSimulationButton() {
  const btn = document.getElementById('simulation-btn');
  const openSim = paperTrades.filter(t => isOpenTrade(t) && t.source === 'simulation').length;
  if (btn) {
    btn.classList.remove('primary', 'sim-running', 'sim-settling');
    if (simulationState === 'running') {
      btn.classList.add('sim-running');
      btn.textContent = `Stop Sim (${openSim})`;
      btn.title = 'Simulation is opening top-10 suggested trades and managing exits';
    } else if (simulationState === 'settling') {
      btn.classList.add('sim-settling');
      btn.textContent = `Settling (${openSim})`;
      btn.title = 'No new simulation trades. Existing simulation trades exit at target, stop, or end of day.';
    } else {
      btn.classList.add('primary');
      btn.textContent = 'Start Simulation';
      btn.title = 'Auto paper-trade top-10 buy suggestions with Rs 5L portfolio limit';
    }
  }
  renderTopActionBar();
}

async function toggleSimulation() {
  if (!paperTradesLoaded) await loadPaperTrades();
  if (simulationState === 'running') {
    setSimulationState('settling');
    runSimulationCycle({ allowEntries:false }).catch(e => console.warn('simulation settle failed', e.message));
    return;
  }
  setSimulationState('running');
  runSimulationCycle({ allowEntries:true }).catch(e => console.warn('simulation start failed', e.message));
}

function getIstClockParts() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return { day: ist.getUTCDay(), mins: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

function isMarketHoursNow() {
  const { day, mins } = getIstClockParts();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins < 15 * 60 + 30;
}

function isSimulationEntryWindow() {
  const { day, mins } = getIstClockParts();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 14 * 60 + 45;
}

function isSimulationEodSettlementTime() {
  const { day, mins } = getIstClockParts();
  return day === 0 || day === 6 || mins >= 15 * 60 + 15;
}

function getSimulationOpenTrades() {
  return paperTrades.filter(t => isOpenTrade(t) && t.source === 'simulation');
}

function getSimulationEngineSettings() {
  const settings = {
    PORTFOLIO_INITIAL_CAPITAL:getPortfolioCapital(),
    MAX_POSITION_EXPOSURE,
    TRADE_RISK_PCT,
    SIMULATION_MIN_NET_PROFIT_PCT,
    SIMULATION_MAX_OPEN,
    SIMULATION_MAX_ACTIVE_OPEN,
    SIMULATION_MAX_NEW_PER_CYCLE,
    SIMULATION_TOP_N,
    SIMULATION_DAILY_MAX_TRADES,
    SIMULATION_DAILY_MAX_STOPS,
    SIMULATION_OVERRIDE_STOP_GUARD,
    SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER,
    SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT,
    SIMULATION_DAILY_MAX_NET_LOSS_PCT,
    SIMULATION_SYMBOL_COOLDOWN_MIN,
    SIMULATION_SETUP_COOLDOWN_MIN,
    SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT,
    SIMULATION_FIRST_HOUR_MAX_ENTRIES,
    SIMULATION_STOP_GRACE_MIN,
    SIMULATION_STOP_CONFIRM_BARS,
    SIMULATION_EMERGENCY_STOP_PCT,
    SIMULATION_RUNNER_MIN_SCORE,
    SIMULATION_RUNNER_MIN_REL_VOL,
    SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT,
    SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT,
    SIMULATION_RUNNER_TRAIL_PCT,
    SIMULATION_RUNNER_WIDE_TRAIL_PCT,
    SIMULATION_BREAKEVEN_PROTECT_PCT,
    SIMULATION_TRAIL_START_PCT,
    SIMULATION_LONG_TRAIL_PCT,
    SIMULATION_TIME_STOP_MIN,
    SIMULATION_TIME_STOP_MIN_PROFIT_PCT,
    SIMULATION_TARGET_PARTIAL_QTY_PCT,
    SIMULATION_TARGET_RUNNER_MIN_SCORE,
    SIMULATION_TARGET_RUNNER_MIN_REL_VOL,
    SIMULATION_PROFIT_REENTRY_COOLDOWN_MIN,
    SIMULATION_VWAP_CONT_MIN_SCORE,
    SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT,
    SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT,
    SIMULATION_MIN_SCORE,
    SIMULATION_SHORT_MIN_SCORE,
    SIMULATION_SHORT_MIN_REL_VOL,
    SIMULATION_SHORT_ALLOW_AVOID_GUARD,
    SIMULATION_SHORT_TRIGGER_DISTANCE_PCT,
    SIMULATION_SHORT_CONFIRM_BARS,
    SIMULATION_SHORT_MAX_STOP_PCT,
    SIMULATION_SHORT_TRAIL_PCT,
    SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS,
    SIMULATION_MARKET_BREADTH_PCT,
    SIMULATION_MARKET_REGIME_NIFTY_PCT,
    SIMULATION_MARKET_REGIME_SECTOR_PCT,
    SIMULATION_MARKET_REGIME_RS_PCT,
    SIMULATION_AUTO_SHORTS,
    SIMULATION_AUTO_MANUAL_EXITS,
  };
  return TradeRules.withDefaults ? TradeRules.withDefaults({ ...settings, ...loadTradeSettingOverrides() }) : { ...settings, ...loadTradeSettingOverrides() };
}

function buildSimulationEngineCandidate(rowOrSym, t = null, score = null, side = null, guard = null, cost = null) {
  const sym = typeof rowOrSym === 'string' ? rowOrSym : rowOrSym?.sym;
  const row = typeof rowOrSym === 'string'
    ? (MIDCAP_STOCKS.find(s => s.sym === sym) || STOCK_ASSETS.find(s => s.sym === sym) || ETF_ASSETS.find(s => s.sym === sym) || { sym })
    : rowOrSym;
  const setup = t || intradayData[sym];
  const finalScore = score == null ? adjustedTradeScore(row || sym) : score;
  const signal = adjustedTradeSignal(finalScore);
  const finalSide = side || (signal === 'sell' ? 'sell' : signal === 'buy' ? 'buy' : null);
  const finalGuard = guard || (setup ? getRiskGuard(row || { sym }, setup, finalScore) : null);
  const finalCost = cost || (setup && finalSide ? getTradeCostContext(row || sym, setup, finalSide) : null);
  const price = getCurrentTradePrice(sym) ?? Number(setup?.price);
  return {
    symbol:sym,
    name:row?.name || sym,
    assetType:isETFAsset(row || sym) ? 'etf' : 'stock',
    sector:row?.sector || '',
    cap:row?.cap || '',
    price,
    priceAtSnapshot:price,
    score:finalScore,
    rawScore:setup?.score ?? null,
    signal,
    side:finalSide,
    guard:finalGuard,
    cost:finalCost,
    freshness:setup ? getIntradayFreshness(setup) : null,
    indicators:setup ? { ...setup, price, reasons:Array.isArray(setup.reasons) ? setup.reasons : [] } : null,
    quote:row?.data || stockData[sym] || null,
    row,
    t:setup,
  };
}

function getEntryTriggerPrice(t) {
  return SimulationEngine.getEntryTriggerPrice({ indicators:t });
}

function getBreakoutConfirmations(t, side = 'buy') {
  return SimulationEngine.getBreakoutConfirmations({ indicators:t }, side);
}

function getMomentumRunnerInfo(row, t, side = 'buy') {
  return SimulationEngine.getMomentumRunnerInfo(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    getSimulationEngineSettings()
  );
}

function getVwapContinuationInfo(row, t, side = 'buy') {
  return SimulationEngine.getVwapContinuationInfo(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    getSimulationEngineSettings()
  );
}

function rememberPreviousSimulationSignal(sym) {
  const setup = intradayData[sym];
  if (!setup) return;
  const candidate = buildSimulationEngineCandidate(sym, setup);
  const compact = SimulationEngine.toConfirmationCandidate(candidate);
  if (compact?.indicators) simulationPreviousSignalCandidates.set(sym, compact);
}

function getSimulationSetupBlockReason(row, t, side, setupType) {
  return SimulationEngine.getSetupBlockReason(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    setupType,
    Date.now(),
    getSimulationEngineSettings(),
    { previousCandidate: simulationPreviousSignalCandidates.get(row?.sym || row) || null }
  );
}

function isSimulationSignalDeteriorated(trade, price) {
  return SimulationEngine.isSimulationSignalDeteriorated(
    trade,
    buildSimulationEngineCandidate(trade?.symbol, intradayData[trade?.symbol], adjustedTradeScore(trade?.symbol), trade?.side),
    price
  );
}

function isSimulationStopDeteriorated(trade) {
  return SimulationEngine.isSimulationStopDeteriorated(
    trade,
    buildSimulationEngineCandidate(trade?.symbol, intradayData[trade?.symbol], adjustedTradeScore(trade?.symbol), trade?.side),
    getSimulationEngineSettings()
  );
}

function getSimulationStopExit(trade, price, side, entry, stop, openedAt) {
  if (!Number.isFinite(stop) || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(Number(price))) return null;
  const breached = side === 'sell' ? price >= stop : price <= stop;
  if (!breached) {
    trade._stopBreachCount = 0;
    trade._stopFirstBreachedAt = null;
    return null;
  }
  const adversePct = side === 'sell'
    ? ((price - entry) / entry) * 100
    : ((entry - price) / entry) * 100;
  if (adversePct >= SIMULATION_EMERGENCY_STOP_PCT) {
    return { reason:'Simulation emergency stop', exitPrice:Number(price) };
  }
  const now = Date.now();
  const holdMs = Number.isFinite(openedAt) ? now - openedAt : 0;
  trade._stopBreachCount = (Number(trade._stopBreachCount) || 0) + 1;
  trade._stopFirstBreachedAt = trade._stopFirstBreachedAt || now;
  if (holdMs < SIMULATION_STOP_GRACE_MIN * 60000) return null;
  if (trade._stopBreachCount >= SIMULATION_STOP_CONFIRM_BARS) {
    if (isSimulationStopDeteriorated(trade)) {
      return { reason:'Simulation confirmed stop', exitPrice:Number(price) };
    }
    return null;
  }
  return null;
}

function getSimulationEntryBlockReason(sym, setupType = '') {
  const stats = getSimulationDayStats();
  return TradeRules.getEntryBlockReason(sym, setupType, Date.now(), stats, getSimulationEngineSettings());
}

function isETFAsset(rowOrSym) {
  const sym = typeof rowOrSym === 'string' ? rowOrSym : rowOrSym?.sym;
  return !!ETF_ASSETS.find(e => e.sym === sym);
}

function getETFTradeSafety(row, t) {
  if (!isETFAsset(row)) return { ok:true, reason:'' };
  const sym = row.sym || '';
  if (/LIQUID|OVERNIGHT|MONEY|CASH|GILT/i.test(`${sym} ${row.name || ''} ${row.sector || ''}`)) {
    return { ok:false, reason:'cash-like ETF skipped' };
  }
  const liq = getLiquidityInfo(t);
  if (liq.level === 'thin') return { ok:false, reason:'thin ETF liquidity' };
  const prem = Number(row.etfData?.premium);
  if (Number.isFinite(prem) && prem > 5) return { ok:false, reason:'ETF premium extreme' };
  if (Number.isFinite(prem) && prem < -5) return { ok:false, reason:'ETF discount extreme' };
  if (!Number.isFinite(Number(t?.target)) || !Number.isFinite(Number(t?.stop))) return { ok:false, reason:'missing ETF target/SL' };
  if (Number.isFinite(prem) && prem > 2.5) return { ok:true, warn:true, reason:'ETF premium elevated' };
  if (Number.isFinite(prem) && prem < -2.5) return { ok:true, warn:true, reason:'ETF discount elevated' };
  return { ok:true, warn:false, reason:'' };
}

function getSimulationMarketRegime(row, t, side) {
  return SimulationEngine.getMarketRegime(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    side,
    { ...getSimulationEngineSettings(), indices:indexData, sectorTrend:sectorTrendCache }
  );
}

function isSimulationSetupAllowed(setupType) {
  return SimulationEngine.isSimulationSetupAllowed(setupType);
}

function getSimulationSetupPriority(setupType) {
  return SimulationEngine.setupPriority(setupType);
}

function compareSimulationCandidates(a, b) {
  const candidateA = buildSimulationEngineCandidate(a.row, a.t, a.score, a.side || a.signal, a.guard);
  const candidateB = buildSimulationEngineCandidate(b.row, b.t, b.score, b.side || b.signal, b.guard);
  candidateA.derivedSetupType = a.setupType || getSetupType(a.row, a.t, a.guard);
  candidateB.derivedSetupType = b.setupType || getSetupType(b.row, b.t, b.guard);
  return SimulationEngine.compareCandidates(candidateA, candidateB);
}

function isMomentumRunnerTrade(trade) {
  return SimulationEngine.isMomentumRunnerTrade(trade);
}

function isMomentumRunnerBroken(trade, price) {
  return SimulationEngine.isMomentumRunnerBroken(
    trade,
    buildSimulationEngineCandidate(trade?.symbol, intradayData[trade?.symbol], adjustedTradeScore(trade?.symbol), trade?.side),
    price,
    getSimulationEngineSettings()
  );
}

function getMomentumRunnerExit(trade, price, entry, target) {
  return SimulationEngine.getMomentumRunnerExit(
    trade,
    price,
    buildSimulationEngineCandidate(trade?.symbol, intradayData[trade?.symbol], adjustedTradeScore(trade?.symbol), trade?.side),
    getSimulationEngineSettings()
  );
}

function getSimulationExit(trade, price) {
  return SimulationEngine.getSimulationExit(
    trade,
    price,
    buildSimulationEngineCandidate(trade?.symbol, intradayData[trade?.symbol], adjustedTradeScore(trade?.symbol), trade?.side),
    Date.now(),
    getSimulationEngineSettings(),
    { isEodSettlement:isSimulationEodSettlementTime() }
  );
}

function getSimulationExitReason(trade, price) {
  return getSimulationExit(trade, price)?.reason || null;
}

function getSimulationCandidates() {
  const universe = [
    ...MIDCAP_STOCKS.map((s, i) => ({ ...s, rank:i + 1, data:stockData[s.sym] || null })),
    ...STOCK_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + i + 1, data:stockData[s.sym] || null })),
    ...ETF_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + STOCK_ASSETS.length + i + 1, data:stockData[s.sym] || null, cap:'etf' })),
  ];
  const candidates = universe
    .map(row => {
      const t = intradayData[row.sym];
      const score = t ? adjustedTradeScore(row) : -999;
      const signal = adjustedTradeSignal(score);
      let guard = t ? getRiskGuard(row, t, score) : null;
      let side = signal === 'sell' ? 'sell' : signal === 'buy' ? 'buy' : null;
      let setupType = t ? getSetupType(row, t, guard) : 'NO_SIGNAL';
      
      // Check for high-profit short trigger: stocks up 17%+ before 1 PM get marked as sell candidates
      if (t && !side && TradeRules.checkHighProfitShortTrigger(Number(t.dayChangePercent || 0))) {
        side = 'sell';
        setupType = 'High Profit Short';
      }
      
      const cost = t && side ? getTradeCostContext(row, t, side) : null;
      const candidate = buildSimulationEngineCandidate(row, t, score, side, guard, cost);
      candidate.row = row;
      candidate.t = t;
      candidate.signal = signal;
      candidate.side = side;
      candidate.guard = guard;
      candidate.previousCandidate = simulationPreviousSignalCandidates.get(row.sym) || null;
      candidate.derivedSetupType = setupType;
      return candidate;
    })
    .filter(candidate => candidate.t);
  return SimulationEngine.selectSimulationEntryCandidates(
    candidates,
    Date.now(),
    getSimulationEngineSettings(),
    {
      openSymbols:new Set(paperTrades.filter(isOpenTrade).map(t => t.symbol)),
      entryBlockReason:(sym, setupType) => getSimulationEntryBlockReason(sym, setupType),
      market:{ indices:indexData },
    }
  );
}

function getSimulationCandidateFailure(item) {
  if (!item.t) return 'missing intraday signal';
  const freshness = getIntradayFreshness(item.t);
  if (freshness.stale) return `stale signal: ${freshness.reason}`;
  if (!['buy', 'sell'].includes(item.signal)) return `signal ${item.signal}`;
  if (!SIMULATION_AUTO_SHORTS && item.signal === 'sell') return 'auto shorts disabled';
  const settings = getSimulationEngineSettings();
  const minScore = SimulationEngine.getMinScoreForSide(settings, item.signal);
  if (Math.abs(item.score) < minScore) return `score ${Math.abs(item.score)} < ${minScore}`;
  if (isETFAsset(item.row) && item.signal === 'sell') return 'ETF short disabled';
  if (isETFAsset(item.row)) return 'ETF auto simulation disabled';
  const setupType = getSetupType(item.row, item.t, item.guard);
  if (!isSimulationSetupAllowed(setupType)) return `setup ${setupType}`;
  const setupBlock = getSimulationSetupBlockReason(item.row, item.t, item.side || item.signal, setupType);
  if (setupBlock) return setupBlock;
  const regime = getSimulationMarketRegime(item.row, item.t, item.side || item.signal);
  if (!regime.ok) return regime.reason;
  const allowedGuards = SimulationEngine.getAllowedGuardLevelsForSide(settings, item.side || item.signal);
  if (item.guard?.level && !allowedGuards.includes(String(item.guard.level).toLowerCase())) return `risk guard ${item.guard?.label || item.guard?.level || 'blocked'}`;
  if (item.t.entryStatus !== 'Triggered') return `entry ${item.t.entryStatus || 'not triggered'}`;
  if (getOpenPaperTrade(item.row.sym)) return 'already open';
  if (!getCurrentTradePrice(item.row.sym)) return 'missing live price';
  const blockReason = getSimulationEntryBlockReason(item.row.sym, setupType);
  if (blockReason) return blockReason;
  const cost = getTradeCostContext(item.row, item.t, item.side || item.signal);
  if (!cost) return 'missing cost/target context';
  if (!cost.ok || cost.netPct < SIMULATION_MIN_NET_PROFIT_PCT) return `net ${cost.netPct}% < ${SIMULATION_MIN_NET_PROFIT_PCT}%`;
  const stopPct = Math.abs(Number(item.t.price) - Number(item.t.stop)) / Number(item.t.price) * 100;
  const maxStopPct = SimulationEngine.getMaxStopPctForSide(settings, item.side || item.signal);
  if (!Number.isFinite(stopPct) || stopPct > maxStopPct) return `stop ${Number.isFinite(stopPct) ? stopPct.toFixed(2) : '--'}% > ${maxStopPct}%`;
  const etfSafety = getETFTradeSafety(item.row, item.t);
  if (!etfSafety.ok || etfSafety.warn) return etfSafety.reason || 'ETF safety';
  return '';
}

function getSetupType(row, t, guard) {
  if (!t) return 'NO_SIGNAL';
  const score = adjustedTradeScore(row);
  const side = adjustedTradeSignal(score);
  return SimulationEngine.deriveSetupType(
    buildSimulationEngineCandidate(row, t, score, side, guard),
    getSimulationEngineSettings()
  );
}

function updateSetupOutcome(symbol, side, setupType, price, target, stop) {
  if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(Number(price)) || Number(price) <= 0) return null;
  const now = Date.now();
  const key = `${symbol}|${side}|${setupType}`;
  let rec = setupOutcomeTracker.get(key);
  if (!rec || now - rec.firstSeenAt > 90 * 60 * 1000 || rec.hitTarget || rec.hitStop) {
    rec = {
      symbol,
      side,
      setupType,
      firstSeenAt:now,
      firstSeenIso:new Date(now).toISOString(),
      entryPrice:Number(price),
      target:Number.isFinite(Number(target)) ? Number(target) : null,
      stop:Number.isFinite(Number(stop)) ? Number(stop) : null,
      maxProfitPct:0,
      maxDrawdownPct:0,
      hitTarget:false,
      hitStop:false,
    };
    setupOutcomeTracker.set(key, rec);
  }
  const current = Number(price);
  const favorable = side === 'sell'
    ? ((rec.entryPrice - current) / rec.entryPrice) * 100
    : ((current - rec.entryPrice) / rec.entryPrice) * 100;
  const adverse = side === 'sell'
    ? ((current - rec.entryPrice) / rec.entryPrice) * 100
    : ((rec.entryPrice - current) / rec.entryPrice) * 100;
  rec.maxProfitPct = +Math.max(rec.maxProfitPct, favorable).toFixed(3);
  rec.maxDrawdownPct = +Math.max(rec.maxDrawdownPct, adverse).toFixed(3);
  rec.lastPrice = +current.toFixed(2);
  rec.lastSeenAt = now;
  rec.lastSeenIso = new Date(now).toISOString();
  rec.ageMin = Math.max(0, Math.round((now - rec.firstSeenAt) / 60000));
  if (side === 'sell') {
    if (rec.target != null && current <= rec.target) rec.hitTarget = true;
    if (rec.stop != null && current >= rec.stop) rec.hitStop = true;
  } else {
    if (rec.target != null && current >= rec.target) rec.hitTarget = true;
    if (rec.stop != null && current <= rec.stop) rec.hitStop = true;
  }
  for (const [k, v] of setupOutcomeTracker) {
    if (now - v.lastSeenAt > 2 * 60 * 60 * 1000) setupOutcomeTracker.delete(k);
  }
  return {
    firstSeenAt:rec.firstSeenIso,
    ageMin:rec.ageMin,
    entryPrice:+rec.entryPrice.toFixed(2),
    lastPrice:rec.lastPrice,
    maxProfitPct:rec.maxProfitPct,
    maxDrawdownPct:rec.maxDrawdownPct,
    hitTarget:rec.hitTarget,
    hitStop:rec.hitStop,
  };
}

function buildSimulationSnapshotCandidates(limit = 30, lowestLimit = 30) {
  const universe = [
    ...MIDCAP_STOCKS.map((s, i) => ({ ...s, rank:i + 1, data:stockData[s.sym] || null })),
    ...STOCK_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + i + 1, data:stockData[s.sym] || null })),
    ...ETF_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + STOCK_ASSETS.length + i + 1, data:stockData[s.sym] || null, cap:'etf' })),
  ];
  const candidates = universe
    .map(row => {
      const t = intradayData[row.sym];
      const score = t ? adjustedTradeScore(row) : -999;
      const signal = adjustedTradeSignal(score);
      const side = signal === 'sell' ? 'sell' : signal === 'buy' ? 'buy' : null;
      const guard = t ? getRiskGuard(row, t, score) : null;
      const cost = t && side ? getTradeCostContext(row, t, side) : null;
      const liquidity = t ? getLiquidityInfo(t) : null;
      const freshness = t ? getIntradayFreshness(t) : null;
      const stopPct = t?.price && t?.stop ? Math.abs(Number(t.price) - Number(t.stop)) / Number(t.price) * 100 : null;
      const item = { row, t, score, signal, side, guard };
      const failure = getSimulationCandidateFailure(item);
      const priceAtSnapshot = getCurrentTradePrice(row.sym) ?? row.data?.price ?? t?.price ?? null;
      const setupType = getSetupType(row, t, guard);
      const entryPrice = t ? getEntryTriggerPrice(t) : null;
      const triggerDistancePct = t && entryPrice && Number.isFinite(Number(priceAtSnapshot)) && Number(priceAtSnapshot) > 0
        ? (side === 'sell' ? ((entryPrice - Number(priceAtSnapshot)) / entryPrice) * 100 : ((Number(priceAtSnapshot) - entryPrice) / entryPrice) * 100)
        : null;
      const engineCandidate = t ? buildSimulationEngineCandidate(row, t, score, side, guard, cost) : null;
      if (engineCandidate) engineCandidate.derivedSetupType = setupType;
      const dataQuality = engineCandidate ? SimulationEngine.getDataQualityIssues(engineCandidate, getSimulationEngineSettings()) : [];
      const outcome = t && side
        ? updateSetupOutcome(row.sym, side, setupType, priceAtSnapshot, t.target, t.stop)
        : null;
      return {
        symbol:row.sym,
        name:row.name || row.sym,
        universeRank:row.rank ?? null,
        assetType:isETFAsset(row) ? 'etf' : 'stock',
        sector:row.sector || '',
        cap:row.cap || '',
        price:priceAtSnapshot,
        priceAtSnapshot,
        change:row.data?.change ?? null,
        quote:{
          price:priceAtSnapshot,
          change:row.data?.change ?? null,
          open:row.data?.open ?? null,
          prevClose:row.data?.prevClose ?? null,
          high52:row.data?.high52 ?? null,
          low52:row.data?.low52 ?? null,
          volume:row.data?.volume ?? t?.dayVolume ?? null,
        },
        marketContext:{
          niftyChange:indexData?.nifty50?.change ?? indexData?.nifty?.change ?? null,
          bankNiftyChange:indexData?.bankNifty?.change ?? null,
          sectorAvg:sectorTrendCache[row.sector] ?? null,
          relativeStrength:row.data?.change != null && (indexData?.nifty50?.change ?? indexData?.nifty?.change) != null
            ? +(Number(row.data.change) - Number(indexData?.nifty50?.change ?? indexData?.nifty?.change)).toFixed(3)
            : null,
        },
        ohlc:t?.ohlc || null,
        spreadEstimatePct:t?.spreadEstimatePct ?? row.data?.spreadEstimatePct ?? null,
        setupType,
        previousCandidate:simulationPreviousSignalCandidates.get(row.sym) || null,
        outcome,
        score,
        rawScore:t?.score ?? null,
        signal,
        side,
        wouldEnter:!failure,
        blockReason:failure || '',
        decision:{ selected:false, selectionRank:null, reason:failure || '', reasons:failure ? [failure] : [] },
        guard:guard ? { level:guard.level, label:guard.label, reason:guard.reason } : null,
        cost:cost ? { targetPct:cost.targetPct, costPct:cost.costPct, slippagePct:cost.slippagePct, netPct:cost.netPct, requiredPct:cost.requiredPct, ok:cost.ok } : null,
        liquidity,
        freshness,
        indicators:t ? {
          entryStatus:t.entryStatus || '',
          entryTrigger:t.entryTrigger || '',
          entryPrice,
          triggerDistancePct:Number.isFinite(triggerDistancePct) ? +triggerDistancePct.toFixed(3) : null,
          reasons:Array.isArray(t.reasons) ? t.reasons.slice(0, 6) : [],
          vwap:t.vwap ?? null,
          vwapBandPosition:t.vwapBandPosition ?? null,
          vwapBandWidthPct:t.vwapBandWidthPct ?? null,
          ema9:t.ema9 ?? t.emaShort ?? null,
          ema20:t.ema20 ?? t.emaLong ?? null,
          rsi:t.rsi ?? null,
          atr:t.atr ?? null,
          superTrendDirection:t.superTrendDirection ?? null,
          target:t.target ?? null,
          stop:t.stop ?? null,
          rr:t.rr ?? null,
          stopPct:Number.isFinite(stopPct) ? +stopPct.toFixed(3) : null,
          dayVolume:t.dayVolume ?? null,
          relVolume:t.relVolume ?? null,
          relVolumeTimeAdjusted:t.relVolumeTimeAdjusted ?? null,
          expectedVolumeFraction:t.expectedVolumeFraction ?? null,
          volumeShock:t.volumeShock ?? null,
          dataQuality,
        } : null,
      };
    })
    .filter(c => c.indicators)
    .sort(compareSimulationCandidates);
  const settings = getSimulationEngineSettings();
  const selectedEntries = SimulationEngine.selectSimulationEntryCandidates(
    candidates,
    Date.now(),
    settings,
    {
      openSymbols:new Set(paperTrades.filter(isOpenTrade).map(t => t.symbol)),
      entryBlockReason:(sym, setupType) => getSimulationEntryBlockReason(sym, setupType),
      market:{ indices:indexData },
      topN:SIMULATION_TOP_N,
    }
  );
  const selectedRank = new Map(selectedEntries.map((candidate, index) => [candidate.symbol, index + 1]));
  for (const candidate of candidates) {
    const side = candidate.side || candidate.signal;
    const explanation = SimulationEngine.explainCandidateEligibility(candidate, Date.now(), settings, {
      previousCandidate:candidate.previousCandidate,
      market:{ indices:indexData },
    });
    const rank = selectedRank.get(candidate.symbol) || null;
    candidate.selectionRank = rank;
    candidate.decision = {
      selected:!!rank,
      selectionRank:rank,
      side,
      setupType:explanation.setupType || candidate.setupType || '',
      reason:rank ? `selected rank ${rank}` : (explanation.reasons?.[0] || candidate.blockReason || 'not selected'),
      reasons:rank ? [`selected rank ${rank}`] : (explanation.reasons || (candidate.blockReason ? [candidate.blockReason] : [])),
    };
    candidate.wouldEnter = !!rank;
    candidate.blockReason = rank ? '' : candidate.decision.reason;
  }
  const selected = [];
  const addCandidate = (candidate, reason) => {
    const existing = selected.find(c => c.symbol === candidate.symbol);
    if (existing) {
      existing.captureReasons = Array.isArray(existing.captureReasons) ? existing.captureReasons : [];
      if (!existing.captureReasons.includes(reason)) existing.captureReasons.push(reason);
      return;
    }
    selected.push({ ...candidate, captureReasons:[reason] });
  };
  candidates.slice(0, limit).forEach(candidate => addCandidate(candidate, 'top-ranked'));
  candidates
    .filter(candidate => candidate.assetType !== 'etf')
    .slice()
    .sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0))
    .slice(0, lowestLimit)
    .forEach(candidate => addCandidate(candidate, 'lowest-score'));
  for (const candidate of candidates) {
    if (candidate.indicators?.volumeShock?.isShock) addCandidate(candidate, 'volume-shock');
  }
  return selected;
}

async function saveSimulationSnapshot(source = 'intraday-refresh') {
  const candidates = buildSimulationSnapshotCandidates(30, 30);
  const outcomes = candidates.map(c => c.outcome).filter(Boolean);
  const avg = (field) => outcomes.length
    ? +(outcomes.reduce((sum, item) => sum + (Number(item[field]) || 0), 0) / outcomes.length).toFixed(3)
    : null;
  const payload = {
    source,
    dataSource,
    currentView,
    simulationState,
    caps:{
      snapshotTopRanked:30,
      snapshotLowestScorers:30,
      maxOpen:SIMULATION_MAX_OPEN,
      maxActiveOpen:SIMULATION_MAX_ACTIVE_OPEN,
      topN:SIMULATION_TOP_N,
      dailyMaxTrades:SIMULATION_DAILY_MAX_TRADES,
      dailyMaxStops:SIMULATION_DAILY_MAX_STOPS,
      dailyMaxStopsWhenProfitBuffer:SIMULATION_DAILY_MAX_STOPS * SIMULATION_DAILY_MAX_STOPS_PROFIT_MULTIPLIER,
      dailyStopProfitBufferPct:SIMULATION_DAILY_STOP_PROFIT_BUFFER_PCT,
      dailyMaxNetLossPct:SIMULATION_DAILY_MAX_NET_LOSS_PCT,
      maxNewPerCycle:SIMULATION_MAX_NEW_PER_CYCLE,
      firstHourMaxEntries:SIMULATION_FIRST_HOUR_MAX_ENTRIES,
      stopGraceMin:SIMULATION_STOP_GRACE_MIN,
      stopConfirmBars:SIMULATION_STOP_CONFIRM_BARS,
      emergencyStopPct:SIMULATION_EMERGENCY_STOP_PCT,
      runnerMinScore:SIMULATION_RUNNER_MIN_SCORE,
      runnerMinRelVol:SIMULATION_RUNNER_MIN_REL_VOL,
      runnerMaxTriggerExtensionPct:SIMULATION_RUNNER_MAX_TRIGGER_EXTENSION_PCT,
      runnerMaxVwapExtensionPct:SIMULATION_RUNNER_MAX_VWAP_EXTENSION_PCT,
      runnerTrailPct:SIMULATION_RUNNER_TRAIL_PCT,
      breakevenProtectPct:SIMULATION_BREAKEVEN_PROTECT_PCT,
      trailStartPct:SIMULATION_TRAIL_START_PCT,
      longTrailPct:SIMULATION_LONG_TRAIL_PCT,
      timeStopMin:SIMULATION_TIME_STOP_MIN,
      timeStopMinProfitPct:SIMULATION_TIME_STOP_MIN_PROFIT_PCT,
      vwapContinuationMinScore:SIMULATION_VWAP_CONT_MIN_SCORE,
      vwapContinuationMaxTriggerExtensionPct:SIMULATION_VWAP_CONT_MAX_TRIGGER_EXTENSION_PCT,
      vwapContinuationMaxVwapExtensionPct:SIMULATION_VWAP_CONT_MAX_VWAP_EXTENSION_PCT,
      minScore:SIMULATION_MIN_SCORE,
      shortMinScore:SIMULATION_SHORT_MIN_SCORE,
      shortMinRelVol:SIMULATION_SHORT_MIN_REL_VOL,
      shortAllowAvoidGuard:SIMULATION_SHORT_ALLOW_AVOID_GUARD,
      shortTriggerDistancePct:SIMULATION_SHORT_TRIGGER_DISTANCE_PCT,
      shortConfirmBars:SIMULATION_SHORT_CONFIRM_BARS,
      shortMaxStopPct:SIMULATION_SHORT_MAX_STOP_PCT,
      shortTrailPct:SIMULATION_SHORT_TRAIL_PCT,
      shortMinBearishConfirmations:SIMULATION_SHORT_MIN_BEARISH_CONFIRMATIONS,
      marketBreadthPct:SIMULATION_MARKET_BREADTH_PCT,
      marketRegimeNiftyPct:SIMULATION_MARKET_REGIME_NIFTY_PCT,
      marketRegimeSectorPct:SIMULATION_MARKET_REGIME_SECTOR_PCT,
      marketRegimeRsPct:SIMULATION_MARKET_REGIME_RS_PCT,
      autoShorts:SIMULATION_AUTO_SHORTS,
      minNetProfitPct:SIMULATION_MIN_NET_PROFIT_PCT,
      symbolCooldownMin:SIMULATION_SYMBOL_COOLDOWN_MIN,
      setupCooldownMin:SIMULATION_SETUP_COOLDOWN_MIN,
      setupDailyLossGuardCount:SIMULATION_SETUP_DAILY_LOSS_GUARD_COUNT,
      maxPositionExposure:MAX_POSITION_EXPOSURE,
    },
    dayStats:getSimulationDayStats(),
    market:{ marketOpen, timeWarning:getTimeWarning(), indices:indexData },
    openSimulationTrades:getSimulationOpenTrades().map(t => ({
      symbol:t.symbol,
      side:t.side,
      qty:t.qty,
      entryPrice:t.entryPrice,
      priceAtSnapshot:getCurrentTradePrice(t.symbol),
      ohlc:intradayData[t.symbol]?.ohlc || null,
      setupType:t.setupType || null,
      target:t.target,
      stop:t.stop,
      openedAt:t.openedAt,
      pnl:getPaperTradePnl(t, getCurrentTradePrice(t.symbol)),
    })),
    outcomeSummary:{
      tracked:outcomes.length,
      hitTarget:outcomes.filter(o => o.hitTarget).length,
      hitStop:outcomes.filter(o => o.hitStop).length,
      avgMaxProfitPct:avg('maxProfitPct'),
      avgMaxDrawdownPct:avg('maxDrawdownPct'),
    },
    candidateCount:candidates.length,
    candidates,
  };
  const res = await fetch(SIM_SNAPSHOT_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err.error || `simulation-snapshots HTTP ${res.status}`);
  }
}

function closeReplayModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('replay-modal');
  if (modal) modal.style.display = 'none';
}

function replayMoney(n) {
  return moneyINR(Number.isFinite(Number(n)) ? Number(n) : 0);
}

function replayTradeNet(trade) {
  return Number.isFinite(Number(trade?.pnl)) ? Number(trade.pnl) : Number(trade?.net) || 0;
}

function replayTradeFees(trade) {
  return Number.isFinite(Number(trade?.charges)) ? Number(trade.charges) : Number(trade?.fees) || 0;
}

function replayTradeSetup(trade) {
  return trade?.setupType || trade?.setup || 'UNKNOWN';
}

function replayTradeEntry(trade) {
  return Number.isFinite(Number(trade?.entryPrice)) ? Number(trade.entryPrice) : Number(trade?.entry);
}

function replayTradeExit(trade) {
  return Number.isFinite(Number(trade?.exitPrice)) ? Number(trade.exitPrice) : Number(trade?.exit);
}

function replayTradeOpened(trade) {
  return trade?.openedAt || trade?.opened || null;
}

function replayTradeClosed(trade) {
  return trade?.closedAt || trade?.closed || null;
}

function replayTradeReason(trade) {
  return trade?.closeReason || trade?.reason || '--';
}

function summarizeReplaySetupPerformance(trades) {
  const buckets = {};
  for (const trade of trades || []) {
    const key = replayTradeSetup(trade);
    buckets[key] ||= { setup:key, trades:0, wins:0, net:0, fees:0 };
    buckets[key].trades += 1;
    if (replayTradeNet(trade) > 0) buckets[key].wins += 1;
    buckets[key].net += replayTradeNet(trade);
    buckets[key].fees += replayTradeFees(trade);
  }
  return Object.values(buckets)
    .map(row => ({
      ...row,
      losses:row.trades - row.wins,
      winRate:+((row.wins / Math.max(1, row.trades)) * 100).toFixed(1),
      net:+row.net.toFixed(2),
      fees:+row.fees.toFixed(2),
    }))
    .sort((a, b) => b.net - a.net);
}

function compareReplayWithActual(day, replayTrades) {
  const replayDay = normalizeReplayDay(day);
  const actual = paperTrades
    .filter(t => t.source === 'simulation' && normalizeReplayDay(t.closedAt || t.openedAt) === replayDay)
    .filter(t => String(t.status || '').toLowerCase() === 'closed');
  const parity = SimulationEngine.summarizeReplayParity(actual, replayTrades || []);
  const outcome = summarizeOutcomeParity(actual, replayTrades || []);
  // Calculate actual net P&L from closed simulation trades
  const actualNet = actual.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const replayNet = (replayTrades || []).reduce((sum, t) => sum + replayTradeNet(t), 0);
  return {
    ...parity,
    outcome,
    replayNet: +(replayNet || 0).toFixed(2),
    actualNet: +(actualNet || 0).toFixed(2),
    diff: +((replayNet || 0) - (actualNet || 0)).toFixed(2),
    onlyReplay:parity.replayOnly || [],
    onlyActual:parity.actualOnly || [],
  };
}

function summarizeOutcomeBuckets(trades) {
  const buckets = new Map();
  for (const trade of (trades || [])) {
    const symbol = String(trade?.symbol || '').toUpperCase();
    const side = String(trade?.side || 'buy').toUpperCase();
    if (!symbol) continue;
    const key = `${symbol}|${side}`;
    const row = buckets.get(key) || {
      key,
      symbol,
      side,
      trades:0,
      wins:0,
      losses:0,
      net:0,
      gross:0,
      fees:0,
    };
    const pnl = replayTradeNet(trade);
    const gross = Number.isFinite(Number(trade?.grossPnl))
      ? Number(trade.grossPnl)
      : (Number(trade?.gross) || 0);
    const fees = replayTradeFees(trade);
    row.trades += 1;
    row.wins += pnl > 0 ? 1 : 0;
    row.losses += pnl <= 0 ? 1 : 0;
    row.net += pnl;
    row.gross += gross;
    row.fees += fees;
    buckets.set(key, row);
  }
  return buckets;
}

function summarizeOutcomeParity(actualTrades, replayTrades) {
  const actualMap = summarizeOutcomeBuckets(actualTrades);
  const replayMap = summarizeOutcomeBuckets(replayTrades);
  const keys = [...new Set([...actualMap.keys(), ...replayMap.keys()])];
  const rows = keys.map(key => {
    const a = actualMap.get(key) || { symbol:key.split('|')[0], side:key.split('|')[1], trades:0, wins:0, net:0, fees:0 };
    const r = replayMap.get(key) || { symbol:key.split('|')[0], side:key.split('|')[1], trades:0, wins:0, net:0, fees:0 };
    const aWinRate = a.trades ? (a.wins / a.trades) * 100 : 0;
    const rWinRate = r.trades ? (r.wins / r.trades) * 100 : 0;
    return {
      key,
      symbol:a.symbol,
      side:a.side,
      status:a.trades && r.trades ? 'matched' : (a.trades ? 'actual-only' : 'replay-only'),
      actualTrades:a.trades,
      replayTrades:r.trades,
      actualNet:+(a.net || 0).toFixed(2),
      replayNet:+(r.net || 0).toFixed(2),
      netDiff:+((r.net || 0) - (a.net || 0)).toFixed(2),
      winRateDiff:+(rWinRate - aWinRate).toFixed(1),
      feeDiff:+((r.fees || 0) - (a.fees || 0)).toFixed(2),
      tradeCountDiff:(r.trades || 0) - (a.trades || 0),
    };
  }).sort((a, b) => Math.abs(b.netDiff) - Math.abs(a.netDiff) || Math.abs(b.tradeCountDiff) - Math.abs(a.tradeCountDiff));

  const matched = rows.filter(r => r.status === 'matched').length;
  const actualOnly = rows.filter(r => r.status === 'actual-only').length;
  const replayOnly = rows.filter(r => r.status === 'replay-only').length;
  const totalActualNet = rows.reduce((sum, r) => sum + (r.actualNet || 0), 0);
  const totalReplayNet = rows.reduce((sum, r) => sum + (r.replayNet || 0), 0);
  return {
    rows,
    matched,
    actualOnly,
    replayOnly,
    outcomes:rows.length,
    parityPct:+((matched / Math.max(1, rows.length)) * 100).toFixed(1),
    totalActualNet:+totalActualNet.toFixed(2),
    totalReplayNet:+totalReplayNet.toFixed(2),
    netDiff:+(totalReplayNet - totalActualNet).toFixed(2),
    absNetDeviation:+rows.reduce((sum, r) => sum + Math.abs(Number(r.netDiff) || 0), 0).toFixed(2),
  };
}

function outcomeDeviationRows(outcome) {
  const rows = (outcome?.rows || []).slice(0, 30);
  return rows.map(row => `<tr>
    <td>${escapeHTML(row.symbol)}</td>
    <td>${escapeHTML(row.side)}</td>
    <td>${escapeHTML(row.status)}</td>
    <td>${row.actualTrades}</td>
    <td>${row.replayTrades}</td>
    <td class="portfolio-pnl ${portfolioValueClass(row.actualNet)}">${moneyINR(row.actualNet)}</td>
    <td class="portfolio-pnl ${portfolioValueClass(row.replayNet)}">${moneyINR(row.replayNet)}</td>
    <td class="portfolio-pnl ${portfolioValueClass(row.netDiff)}">${moneyINR(row.netDiff)}</td>
    <td class="portfolio-pnl ${portfolioValueClass(-row.winRateDiff)}">${row.winRateDiff}%</td>
  </tr>`).join('') || `<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:16px">No outcome deviations available</td></tr>`;
}

function buildReplayImprovementHints(compare, quality, settings = getSimulationEngineSettings()) {
  const hints = [];
  const outcome = compare?.outcome || {};
  if ((outcome.replayOnly || 0) >= (outcome.actualOnly || 0) + 2) {
    hints.push(`Replay is over-trading vs actual (${outcome.replayOnly} replay-only outcomes). Consider tighter entries: raise SIMULATION_MIN_SCORE above ${settings.SIMULATION_MIN_SCORE}, reduce SIMULATION_TOP_N below ${settings.SIMULATION_TOP_N}, or reduce SIMULATION_MAX_NEW_PER_CYCLE below ${settings.SIMULATION_MAX_NEW_PER_CYCLE}.`);
  }
  if ((outcome.actualOnly || 0) >= (outcome.replayOnly || 0) + 2) {
    hints.push(`Replay is under-trading vs actual (${outcome.actualOnly} actual-only outcomes). Consider looser entries: lower SIMULATION_MIN_SCORE below ${settings.SIMULATION_MIN_SCORE}, increase SIMULATION_TOP_N above ${settings.SIMULATION_TOP_N}, or increase SIMULATION_MAX_NEW_PER_CYCLE above ${settings.SIMULATION_MAX_NEW_PER_CYCLE}.`);
  }
  if ((outcome.netDiff || 0) < 0) {
    hints.push(`Replay net is below actual by ${moneyINR(Math.abs(outcome.netDiff || 0))}. Focus on exits: tune SIMULATION_LONG_TRAIL_PCT (now ${settings.SIMULATION_LONG_TRAIL_PCT}%), SIMULATION_STOP_CONFIRM_BARS (now ${settings.SIMULATION_STOP_CONFIRM_BARS}), and SIMULATION_EXIT_FADE_CONFIRM_BARS (now ${settings.SIMULATION_EXIT_FADE_CONFIRM_BARS}).`);
  }
  const byExit = quality?.byExit || [];
  const stopExit = byExit.find(r => /stop/i.test(String(r?.key || r?.setup || '')));
  if (stopExit && Number(stopExit.trades) >= 3 && Number(stopExit.net) < 0) {
    hints.push(`Stop exits are net negative (${moneyINR(stopExit.net)} over ${stopExit.trades} trades). Consider increasing stop confirmation/grace (SIMULATION_STOP_CONFIRM_BARS, SIMULATION_STOP_GRACE_MIN) to avoid whipsaws.`);
  }
  if (!hints.length) {
    hints.push('Outcome parity is reasonably aligned. For incremental improvement, test small parameter steps: SIMULATION_MIN_SCORE ±5, SIMULATION_TOP_N ±2, SIMULATION_LONG_TRAIL_PCT ±0.2, then compare outcome deviations again.');
  }
  return hints;
}

function replayHintsHTML(hints) {
  return (hints || []).map((hint, index) => `<div class="replay-note">${index + 1}. ${escapeHTML(hint)}</div>`).join('');
}

function cloneReplaySnapshots(snapshots) {
  return JSON.parse(JSON.stringify(snapshots || []));
}

function runReplaySweep(snapshots, limit = 10) {
  const base = getSimulationEngineSettings();
  const values = list => [...new Set(list.filter(v => Number.isFinite(Number(v))))];
  const minScores = values([base.SIMULATION_MIN_SCORE, 50, 55, 60, 65]);
  const topNs = values([base.SIMULATION_TOP_N, 8, 10, 12, 15]);
  const perCycles = values([base.SIMULATION_MAX_NEW_PER_CYCLE, 3, 4, 5]);
  const trails = values([base.SIMULATION_LONG_TRAIL_PCT, 0.4, 0.6, 0.8]);
  const rows = [];
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const perCycle of perCycles) {
        for (const trail of trails) {
          const settings = { ...base, SIMULATION_MIN_SCORE:minScore, SIMULATION_TOP_N:topN, SIMULATION_MAX_NEW_PER_CYCLE:perCycle, SIMULATION_LONG_TRAIL_PCT:trail };
          const result = runSnapshotsReplay(cloneReplaySnapshots(snapshots), settings);
          rows.push({
            minScore, topN, perCycle, trail,
            trades:result.summary.trades,
            winRate:result.summary.winRate,
            net:result.summary.net,
            drawdown:result.summary.maxDrawdown,
            lossStreak:result.summary.maxLossStreak,
          });
        }
      }
    }
  }
  return rows.sort((a, b) => b.net - a.net || a.drawdown - b.drawdown || b.winRate - a.winRate).slice(0, limit);
}

async function runReplaySweepAsync(snapshots, limit = 10, onProgress = null) {
  const base = getSimulationEngineSettings();
  const values = list => [...new Set(list.filter(v => Number.isFinite(Number(v))))];
  const minScores = values([base.SIMULATION_MIN_SCORE, 50, 55, 60, 65]);
  const topNs = values([base.SIMULATION_TOP_N, 8, 10, 12, 15]);
  const perCycles = values([base.SIMULATION_MAX_NEW_PER_CYCLE, 3, 4, 5]);
  const trails = values([base.SIMULATION_LONG_TRAIL_PCT, 0.4, 0.6, 0.8]);
  const rows = [];
  const total = minScores.length * topNs.length * perCycles.length * trails.length;
  let done = 0;
  for (const minScore of minScores) {
    for (const topN of topNs) {
      for (const perCycle of perCycles) {
        for (const trail of trails) {
          const settings = { ...base, SIMULATION_MIN_SCORE:minScore, SIMULATION_TOP_N:topN, SIMULATION_MAX_NEW_PER_CYCLE:perCycle, SIMULATION_LONG_TRAIL_PCT:trail };
          const result = runSnapshotsReplay(cloneReplaySnapshots(snapshots), settings);
          rows.push({
            minScore, topN, perCycle, trail,
            trades:result.summary.trades,
            winRate:result.summary.winRate,
            net:result.summary.net,
            drawdown:result.summary.maxDrawdown,
            lossStreak:result.summary.maxLossStreak,
          });
          done += 1;
          if (done % 5 === 0) {
            if (typeof onProgress === 'function') onProgress(done, total);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
      }
    }
  }
  if (typeof onProgress === 'function') onProgress(done, total);
  return rows.sort((a, b) => b.net - a.net || a.drawdown - b.drawdown || b.winRate - a.winRate).slice(0, limit);
}

let lastReplayDebugResult = null;
let replayJobHistory = [];
let replayJobBusyMode = null;

function runSnapshotsReplay(snapshots, settingsOverride = null) {
  const settings = settingsOverride ? TradeRules.withDefaults(settingsOverride) : getSimulationEngineSettings();
  const capital = getPortfolioCapital();
  const trades = [];
  const rejectedByKey = new Map();
  const selectedLog = [];
  let nextId = 1;
  let currentBySymbol = new Map();
  const lastKnownBySymbol = new Map();
  const previousCandidateBySymbol = new Map();
  const openTrades = () => trades.filter(isOpenTrade);
  const simOpenTrades = () => openTrades().filter(t => t.source === 'simulation');
  const realizedPnl = () => trades.filter(isClosedTrade).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const openExposure = () => openTrades().reduce((sum, t) => sum + ((Number(t.entryPrice) || 0) * (Number(t.qty) || 0)), 0);
  const cashAvailable = () => capital + realizedPnl() - openExposure();
  const sameDay = (a, b) => getTradeDateKey(a) === getTradeDateKey(b);
  const dayStats = at => TradeRules.buildDayStats(trades, at, settings, { sameDay });
  const entryBlockReason = (sym, setupType, at) => TradeRules.getEntryBlockReason(sym, setupType, at, dayStats(at), settings);
  const replayClock = value => {
    const d = new Date(new Date(value || Date.now()).getTime() + 5.5 * 3600 * 1000);
    return { day:d.getUTCDay(), mins:d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  const isReplayEntryWindow = value => {
    const { day, mins } = replayClock(value);
    return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 14 * 60 + 45;
  };
  const isReplayEod = value => {
    const { day, mins } = replayClock(value);
    return day === 0 || day === 6 || mins >= 15 * 60 + 20;
  };
  const closeTrade = (trade, exitPrice, reason, at, mark = false) => {
    const pnl = SimulationEngine.getPaperTradePnl(trade, exitPrice);
    Object.assign(trade, {
      status:'closed',
      exitPrice:+Number(exitPrice).toFixed(2),
      closedAt:at,
      closeReason:reason,
      pnl:pnl?.pnl || 0,
      pnlPct:pnl?.pnlPct || 0,
      grossPnl:pnl?.grossPnl || 0,
      charges:pnl?.charges || 0,
      mark,
    });
  };
  const partialCloseTrade = (trade, exitPrice, reason, at, qty, runner = false) => {
    const closeQty = Math.floor(Number(qty));
    const openQty = Math.floor(Number(trade.qty));
    if (!Number.isFinite(closeQty) || closeQty <= 0 || closeQty >= openQty) return;
    const partial = { ...trade, id:nextId++, parentId:trade.id, status:'closed', qty:closeQty, exitPrice:+Number(exitPrice).toFixed(2), closedAt:at, closeReason:reason };
    const pnl = SimulationEngine.getPaperTradePnl(partial, exitPrice);
    Object.assign(partial, { pnl:pnl?.pnl || 0, pnlPct:pnl?.pnlPct || 0, grossPnl:pnl?.grossPnl || 0, charges:pnl?.charges || 0 });
    trade.qty = openQty - closeQty;
    trade.reservedCapital = +(Number(trade.entryPrice) * Number(trade.qty)).toFixed(2);
    trade._partialTargetBooked = true;
    trade._runnerArmed = true;
    trade._runnerWideTrail = !!runner;
    trade.target = null;
    trades.push(partial);
  };

  const ordered = (Array.isArray(snapshots) ? snapshots : []).slice().sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  for (const snapshot of ordered) {
    currentBySymbol = new Map();
    for (const candidate of snapshot.candidates || []) {
      candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || candidate.previousCandidate || null;
      candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings);
      currentBySymbol.set(candidate.symbol, candidate);
      lastKnownBySymbol.set(candidate.symbol, candidate);
      previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
    }
    for (const trade of simOpenTrades().slice()) {
      const candidate = currentBySymbol.get(trade.symbol) || lastKnownBySymbol.get(trade.symbol);
      const price = Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const exit = SimulationEngine.getSimulationExit(trade, price, candidate, snapshot.at, settings, { isEodSettlement:isReplayEod(snapshot.at) });
      if (exit?.action === 'partial') {
        partialCloseTrade(trade, exit.exitPrice, exit.reason, snapshot.at, Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100)), exit.runner);
      } else if (exit) {
        closeTrade(trade, exit.exitPrice, exit.reason, snapshot.at);
      }
    }
    if (!isReplayEntryWindow(snapshot.at) || isReplayEod(snapshot.at) || cashAvailable() <= 0) continue;
    let slots = Math.max(0, Math.min(settings.SIMULATION_MAX_OPEN - openTrades().length, settings.SIMULATION_MAX_ACTIVE_OPEN - simOpenTrades().length));
    if (slots <= 0) continue;
    const candidates = SimulationEngine.selectSimulationEntryCandidates(snapshot.candidates || [], snapshot.at, settings, {
      openSymbols:new Set(openTrades().map(t => t.symbol)),
      entryBlockReason:(symbol, setupType) => entryBlockReason(symbol, setupType, snapshot.at),
      market:snapshot.market,
    });
    const selectedKeys = new Set(candidates.map(c => `${c.symbol}|${c.side || c.signal}`));
    const rankedAll = (snapshot.candidates || [])
      .filter(c => c && c.assetType !== 'etf' && ['buy', 'sell'].includes(c.side || c.signal))
      .map(c => {
        c.previousCandidate = previousCandidateBySymbol.get(c.symbol) || c.previousCandidate || null;
        c.derivedSetupType = c.derivedSetupType || c.setupType || SimulationEngine.deriveSetupType(c, settings);
        return c;
      })
      .sort(SimulationEngine.compareCandidates);
    rankedAll.forEach((candidate, index) => {
      const side = candidate.side || candidate.signal;
      const key = `${candidate.symbol}|${side}`;
      if (selectedKeys.has(key)) return;
      const explanation = SimulationEngine.explainCandidateEligibility(candidate, snapshot.at, settings, {
        previousCandidate:candidate.previousCandidate,
        market:snapshot.market,
      });
      const setupType = explanation.setupType || candidate.derivedSetupType || candidate.setupType || '';
      let block = entryBlockReason(candidate.symbol, setupType, snapshot.at);
      if (/profit re-entry cooldown/i.test(String(block || '')) && SimulationEngine.isCandidateContinuationReentryAllowed(candidate, settings)) block = '';
      const reasons = explanation.eligible
        ? [block || `not selected: rank ${index + 1}, slots ${slots}, topN ${settings.SIMULATION_TOP_N}, cash ${moneyINR(cashAvailable())}`]
        : explanation.reasons;
      const absScore = Math.abs(Number(candidate.score) || 0);
      const existing = rejectedByKey.get(key);
      if (!existing || absScore > existing.absScore) {
        rejectedByKey.set(key, {
          symbol:candidate.symbol,
          side,
          setupType,
          score:Number(candidate.score) || 0,
          absScore,
          rank:index + 1,
          at:snapshot.at,
          price:Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price) || null,
          reason:(reasons || []).slice(0, 4).join(' | '),
          reasons,
        });
      }
    });
    let openedThisCycle = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (slots <= 0 || openedThisCycle >= settings.SIMULATION_MAX_NEW_PER_CYCLE) break;
      const candidate = candidates[i];
      const setupType = candidate.derivedSetupType || candidate.setupType || '';
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const remainingSlots = Math.max(1, Math.min(slots, Math.max(1, candidates.length - i)));
      const allocation = Math.min(settings.MAX_POSITION_EXPOSURE, cashAvailable() / remainingSlots);
      const side = candidate.side || candidate.signal || 'buy';
      const suggestion = SimulationEngine.getSuggestedQty(candidate, side, price, cashAvailable(), allocation, settings);
      if (suggestion.qty <= 0) continue;
      trades.push({
        id:nextId++,
        symbol:candidate.symbol,
        name:candidate.name || candidate.symbol,
        side,
        qty:suggestion.qty,
        entryPrice:+price.toFixed(2),
        target:suggestion.plan.target,
        stop:suggestion.plan.stop,
        signal:side,
        score:Math.abs(Number(candidate.score) || 0),
        source:'simulation',
        assetType:'stock',
        reservedCapital:+(suggestion.qty * price).toFixed(2),
        setupType,
        setup:['Replay', setupType, candidate.indicators?.entryStatus, candidate.indicators?.entryTrigger].filter(Boolean).join(' | '),
        entryContext:{ reason:`selected rank ${i + 1}`, selectedRank:i + 1 },
        openedAt:snapshot.at,
        status:'open',
      });
      selectedLog.push({ symbol:candidate.symbol, side, setupType, score:Number(candidate.score) || 0, rank:i + 1, at:snapshot.at, price });
      slots -= 1;
      openedThisCycle += 1;
    }
  }
  const lastPrice = new Map();
  const lastAt = new Map();
  for (const snapshot of ordered) {
    for (const candidate of snapshot.candidates || []) {
      const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
      if (Number.isFinite(price) && price > 0) {
        lastPrice.set(candidate.symbol, price);
        lastAt.set(candidate.symbol, snapshot.at);
      }
    }
  }
  for (const trade of simOpenTrades().slice()) {
    const price = lastPrice.get(trade.symbol);
    if (Number.isFinite(price)) closeTrade(trade, price, 'Replay mark at last snapshot', lastAt.get(trade.symbol) || ordered.at(-1)?.at, true);
  }
  const closed = trades.filter(isClosedTrade);
  const wins = closed.filter(t => Number(t.pnl) > 0).length;
  const net = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const fees = closed.reduce((sum, t) => sum + (Number(t.charges) || 0), 0);
  const risk = getPortfolioRiskStats(closed, capital);
  const setupStats = summarizeReplaySetupPerformance(closed);
  const quality = SimulationEngine.summarizeTradeQuality(closed, settings);
  return {
    snapshots:ordered.length,
    trades:closed,
    rejected:[...rejectedByKey.values()].sort((a, b) => b.absScore - a.absScore).slice(0, 40),
    selected:selectedLog,
    setupStats,
    quality,
    summary:{
      trades:closed.length,
      wins,
      losses:closed.length - wins,
      winRate:+((wins / Math.max(1, closed.length)) * 100).toFixed(1),
      net:+net.toFixed(2),
      fees:+fees.toFixed(2),
      returnPct:+((net / Math.max(1, capital)) * 100).toFixed(3),
      ...risk,
    },
  };
}

function replayTableRows(trades) {
  return trades.slice(0, 80).map(trade => `<tr>
    <td>${escapeHTML(trade.symbol)}</td>
    <td>${escapeHTML(String(trade.side || '').toUpperCase())}</td>
    <td>${escapeHTML(replayTradeSetup(trade) || '--')}</td>
    <td>${Number(trade.qty || 0).toLocaleString('en-IN')}</td>
    <td>${moneyINR(replayTradeEntry(trade))}</td>
    <td>${moneyINR(replayTradeExit(trade))}</td>
    <td class="portfolio-pnl ${portfolioValueClass(replayTradeNet(trade))}">${moneyINR(replayTradeNet(trade))}</td>
    <td>${escapeHTML(formatTradeDateTime(replayTradeOpened(trade)))}</td>
    <td>${escapeHTML(formatTradeDateTime(replayTradeClosed(trade)))}</td>
    <td>${escapeHTML(replayTradeReason(trade))}${trade.mark ? ' [mark]' : ''}</td>
  </tr>`).join('') || `<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:16px">No replay trades</td></tr>`;
}

function rejectedReplayRows(rejected) {
  return (rejected || []).slice(0, 30).map(row => `<tr>
    <td>${escapeHTML(row.symbol)}</td>
    <td>${escapeHTML(String(row.side || '').toUpperCase())}</td>
    <td>${escapeHTML(row.setupType || '--')}</td>
    <td>${row.rank || '--'}</td>
    <td>${row.score}</td>
    <td>${moneyINR(row.price)}</td>
    <td class="replay-reason-cell">${escapeHTML(row.reason || '--')}</td>
  </tr>`).join('') || `<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:16px">No rejected candidates captured</td></tr>`;
}

function setupReplayRows(setupStats) {
  return (setupStats || []).map(row => `<tr>
    <td>${escapeHTML(row.setup)}</td>
    <td>${row.trades}</td>
    <td>${row.winRate}%</td>
    <td class="portfolio-pnl ${portfolioValueClass(row.net)}">${moneyINR(row.net)}</td>
    <td>${moneyINR(row.fees)}</td>
  </tr>`).join('') || `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px">No setup performance yet</td></tr>`;
}

function tradeQualityRows(rows) {
  return (rows || []).map(row => `<tr>
    <td>${escapeHTML(row.setup || row.key || '--')}</td>
    <td>${row.trades}</td>
    <td>${row.winRate}%</td>
    <td class="portfolio-pnl ${portfolioValueClass(row.net)}">${moneyINR(row.net)}</td>
    <td>${row.avgNetPct}%</td>
    <td>${row.avgHoldMin}m</td>
    <td>${row.targetHitPct}%</td>
    <td>${row.stopHitPct}%</td>
    <td>${row.fadeExitPct}%</td>
    <td>${row.lateEntryPct}%</td>
  </tr>`).join('') || `<tr><td colspan="10" style="color:var(--muted);text-align:center;padding:16px">No trade quality data yet</td></tr>`;
}

function replayNetValue(rowOrSummary) {
  const candidates = [
    rowOrSummary?.net,
    rowOrSummary?.pnl,
    rowOrSummary?.netPnl,
    rowOrSummary?.totalNet,
    rowOrSummary?.summary?.net,
    rowOrSummary?.summary?.pnl,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function sweepReplayRows(rows) {
  return (rows || []).map((row, index) => {
    const rowNet = replayNetValue(row);
    return `<tr>
    <td>${index + 1}</td>
    <td>${row.minScore}</td>
    <td>${row.topN}</td>
    <td>${row.perCycle}</td>
    <td>${row.firstHour ?? '--'}</td>
    <td>${row.trail}%</td>
    <td>${row.stopConfirm ?? '--'}</td>
    <td>${row.fadeConfirm ?? '--'}</td>
    <td>${row.stopGrace ?? '--'}</td>
    <td>${row.partialQty ?? '--'}%</td>
    <td>${row.trades}</td>
    <td>${row.winRate}%</td>
    <td class="portfolio-pnl ${portfolioValueClass(rowNet)}">${moneyINR(rowNet)}</td>
    <td>${moneyINR(row.drawdown)}</td>
    <td><button class="paper-btn" onclick="applyReplaySettingsFromRow(${index}, 'sweep')">Apply</button></td>
  </tr>`;
  }).join('') || `<tr><td colspan="15" style="color:var(--muted);text-align:center;padding:16px">Sweep not run yet</td></tr>`;
}

function replayComparisonHTML(currentSummary, rows) {
  const best = (rows || [])[0];
  if (!best) return '<div class="replay-note">Run Best Settings or Auto Tune to compare current rules with a tuned variant.</div>';
  const currentNet = replayNetValue(currentSummary);
  const bestNet = replayNetValue(best);
  const diff = bestNet - currentNet;
  const guard = analyzeAutoTuneGuardrails(best, currentSummary);
  const settings = getSimulationEngineSettings();
  const changed = key => {
    const map = {
      minScore:'SIMULATION_MIN_SCORE',
      topN:'SIMULATION_TOP_N',
      perCycle:'SIMULATION_MAX_NEW_PER_CYCLE',
      firstHour:'SIMULATION_FIRST_HOUR_MAX_ENTRIES',
      trail:'SIMULATION_LONG_TRAIL_PCT',
      stopConfirm:'SIMULATION_STOP_CONFIRM_BARS',
      fadeConfirm:'SIMULATION_EXIT_FADE_CONFIRM_BARS',
      stopGrace:'SIMULATION_STOP_GRACE_MIN',
      partialQty:'SIMULATION_TARGET_PARTIAL_QTY_PCT',
    };
    const current = Number(settings[map[key]]);
    const next = Number(best[key]);
    return Number.isFinite(current) && Number.isFinite(next) && Math.abs(current - next) > 0.0001 ? 'changed' : '';
  };
  return `<div class="replay-compare-grid">
    <div><span>Current net</span><strong class="${portfolioValueClass(currentNet)}">${moneyINR(currentNet)}</strong></div>
    <div><span>Best net</span><strong class="${portfolioValueClass(bestNet)}">${moneyINR(bestNet)}</strong></div>
    <div><span>Difference</span><strong class="${portfolioValueClass(diff)}">${moneyINR(diff)}</strong></div>
    <div><span>Best settings</span><strong>
      <mark class="${changed('minScore')}">Score ${best.minScore}</mark>
      <mark class="${changed('topN')}">Top ${best.topN}</mark>
      <mark class="${changed('perCycle')}">Cycle ${best.perCycle}</mark>
      <mark class="${changed('firstHour')}">First hour ${best.firstHour ?? '--'}</mark>
      <mark class="${changed('trail')}">Trail ${best.trail}%</mark>
      <mark class="${changed('stopConfirm')}">Stop confirm ${best.stopConfirm ?? '--'}</mark>
      <mark class="${changed('fadeConfirm')}">Fade confirm ${best.fadeConfirm ?? '--'}</mark>
      <mark class="${changed('stopGrace')}">Stop grace ${best.stopGrace ?? '--'}m</mark>
      <mark class="${changed('partialQty')}">Partial ${best.partialQty ?? '--'}%</mark>
    </strong></div>
  </div><div class="replay-note ${guard.level === 'warn' ? 'warn' : ''}">${escapeHTML(guard.message)}</div>`;
}

function describeReplaySettingsRow(row) {
  if (!row) return '--';
  return `Score ${row.minScore}, Top ${row.topN}, Cycle ${row.perCycle}, First hour ${row.firstHour ?? '--'}, Trail ${row.trail}%, Stop confirm ${row.stopConfirm ?? '--'}, Fade confirm ${row.fadeConfirm ?? '--'}, Stop grace ${row.stopGrace ?? '--'}m, Partial qty ${row.partialQty ?? '--'}%`;
}

function analyzeAutoTuneGuardrails(row, currentSummary = {}) {
  if (!row) return { level:'info', message:'No auto-tune row selected.' };
  const trades = Number(row.trades) || 0;
  const currentNet = replayNetValue(currentSummary);
  const diff = replayNetValue(row) - currentNet;
  const warnings = [];
  if (trades < 5) warnings.push('few trades');
  if ((Number(row.maxDrawdownPct) || 0) > 0.25) warnings.push(`drawdown ${row.maxDrawdownPct}%`);
  if (Number(row.lossStreak) >= 4) warnings.push(`loss streak ${row.lossStreak}`);
  if (diff <= 0) warnings.push('not better than current replay');
  if (warnings.length) return { level:'warn', message:`Guardrail: review before applying (${warnings.join(', ')}).` };
  return { level:'ok', message:'Guardrail: candidate setting improves replay without obvious small-sample or drawdown warning.' };
}

function applyReplaySettingsFromRow(index, source = 'sweep') {
  const rows = source === 'auto' ? lastReplayDebugResult?.autoTuneRows : lastReplayDebugResult?.sweepRows;
  const row = rows?.[index];
  if (!row) return;
  const guard = analyzeAutoTuneGuardrails(row, lastReplayDebugResult?.result?.summary || {});
  const ok = confirm(`Apply ${source === 'auto' ? 'auto-tune' : 'sweep'} settings?\n\n${describeReplaySettingsRow(row)}\nNet: ${moneyINR(row.net)} | Trades: ${row.trades} | Drawdown: ${row.maxDrawdownPct ?? '--'}%\n\n${guard.message}`);
  if (!ok) return;
  applyReplaySettings(row);
}

function replayJobRows(jobs) {
  return (jobs || []).slice(0, 8).map(job => {
    const best = job.result?.sweepRows?.[0] || job.result?.autoTuneRows?.[0] || null;
    const bestNet = replayNetValue(best);
    const started = job.createdAt ? formatTradeDateTime(job.createdAt) : '--';
    const flags = [job.cached ? 'cached' : '', job.reused ? 'reused' : '', job.workerPid ? `pid ${job.workerPid}` : ''].filter(Boolean).join(' | ') || '--';
    return `<tr>
      <td>${escapeHTML(job.mode || '--')}</td>
      <td>${escapeHTML(job.day || '--')}</td>
      <td><span class="job-status ${escapeHTML(job.status || '')}">${escapeHTML(job.status || '--')}</span></td>
      <td>${escapeHTML(started)}</td>
      <td>${escapeHTML(flags)}</td>
      <td>${best ? `Score ${escapeHTML(best.minScore)} / FH ${escapeHTML(best.firstHour ?? '--')} / ${moneyINR(bestNet)}` : escapeHTML(job.error || '--')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:12px">No replay jobs yet</td></tr>`;
}

function updateReplayJobHistory(jobs) {
  if (Array.isArray(jobs)) replayJobHistory = jobs;
  const target = document.getElementById('replay-job-history-body');
  if (target) target.innerHTML = replayJobRows(replayJobHistory);
}

function setReplayJobBusy(mode, busy, label = '') {
  replayJobBusyMode = busy ? mode : null;
  document.querySelectorAll('[data-replay-job-btn]').forEach(btn => {
    const btnMode = btn.getAttribute('data-replay-job-btn');
    btn.disabled = !!busy;
    if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
    btn.textContent = busy && btnMode === mode ? label || 'Running...' : btn.dataset.originalText;
  });
}

async function loadReplayJobHistory() {
  try {
    const res = await fetch(SIM_REPLAY_JOB_ENDPOINT, { signal:AbortSignal.timeout(5000) });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload.ok !== false) updateReplayJobHistory(payload.jobs || []);
  } catch (_) {}
}

function renderReplayReport(day, snapshots, result, opts = {}) {
  const modal = document.getElementById('replay-modal');
  const body = document.getElementById('replay-modal-body');
  if (modal) modal.style.display = 'flex';
  const compare = compareReplayWithActual(day, result.trades || []);
  const outcome = compare.outcome || { rows:[], parityPct:0, matched:0, outcomes:0, actualOnly:0, replayOnly:0, netDiff:0, absNetDeviation:0 };
  const sweepRows = opts.sweepRows || [];
  const autoTuneRows = opts.autoTuneRows || [];
  const bestRows = autoTuneRows.length ? autoTuneRows : sweepRows;
  const quality = result.quality || SimulationEngine.summarizeTradeQuality(result.trades || [], getSimulationEngineSettings());
  const hints = buildReplayImprovementHints(compare, quality, getSimulationEngineSettings());
  lastReplayDebugResult = { day, snapshots, result, compare, sweepRows, autoTuneRows, quality };
  if (body) body.innerHTML = `
    <div class="replay-toolbar">
      <label>Replay date <input id="replay-date-input" class="text-input replay-date-input" type="date" value="${escapeHTML(normalizeReplayDay(day))}" /></label>
      <button class="paper-btn buy" data-replay-job-btn="report" onclick="runReplayForSelectedDate()">Run</button>
      <button class="paper-btn" data-replay-job-btn="sweep" onclick="runReplaySweepForCurrent()">Best Settings</button>
      <button class="paper-btn" data-replay-job-btn="autotune" onclick="runReplayAutoTune5D()">Auto Tune 5D</button>
      <button class="paper-btn" onclick="exportReplayReport('json')">Export JSON</button>
      <button class="paper-btn" onclick="exportReplayReport('csv')">Export CSV</button>
    </div>
    <div id="replay-job-status"></div>
    <div class="replay-summary">
      <div class="replay-card"><div class="label">Snapshots</div><div class="value">${result.snapshots}</div></div>
      <div class="replay-card"><div class="label">Replay Trades</div><div class="value">${result.summary.trades}</div></div>
      <div class="replay-card"><div class="label">Win rate</div><div class="value">${result.summary.winRate}%</div></div>
      <div class="replay-card"><div class="label">Replay Net</div><div class="value ${portfolioValueClass(result.summary.net)}">${moneyINR(result.summary.net)} (${result.summary.returnPct}%)</div></div>
      <div class="replay-card"><div class="label">Actual Net</div><div class="value ${portfolioValueClass(compare.actualNet)}">${moneyINR(compare.actualNet)}</div></div>
      <div class="replay-card"><div class="label">Replay vs Actual</div><div class="value ${portfolioValueClass(compare.diff)}">${moneyINR(compare.diff)}</div></div>
      <div class="replay-card"><div class="label">Outcome parity</div><div class="value ${outcome.parityPct >= 80 ? '' : 'down'}">${outcome.parityPct ?? 0}%</div></div>
      <div class="replay-card"><div class="label">Drawdown</div><div class="value ${result.summary.maxDrawdown > 0 ? 'down' : ''}">${moneyINR(result.summary.maxDrawdown)} (${result.summary.maxDrawdownPct}%)</div></div>
      <div class="replay-card"><div class="label">Loss streak</div><div class="value ${result.summary.currentLossStreak > 0 ? 'down' : ''}">${result.summary.currentLossStreak} now / ${result.summary.maxLossStreak} max</div></div>
    </div>

    <div class="replay-debug-grid">
      <div class="replay-debug-card"><div class="portfolio-section-title">Outcome-Level Parity</div>
        <div class="replay-note">Matched outcomes ${outcome.matched}/${outcome.outcomes} (${outcome.parityPct}%). Actual-only outcomes: ${outcome.actualOnly}. Replay-only outcomes: ${outcome.replayOnly}. Net deviation: ${moneyINR(outcome.netDiff)}. Absolute deviation sum: ${moneyINR(outcome.absNetDeviation)}.</div>
      </div>
      <div class="replay-debug-card"><div class="portfolio-section-title">Auto Tune Suggestion</div>
        <div class="replay-note">${autoTuneRows.length ? `Best 5D setting: ${describeReplaySettingsRow(autoTuneRows[0])}, net ${moneyINR(autoTuneRows[0].net)}. ${analyzeAutoTuneGuardrails(autoTuneRows[0], result.summary).message}` : 'Run Auto Tune 5D to compare recent retained snapshot days.'}</div>
        ${autoTuneRows.length ? '<button class="paper-btn buy" onclick="applyReplaySettingsFromRow(0, &quot;auto&quot;)">Apply Auto Tune</button>' : ''}
      </div>
    </div>

    <div class="portfolio-section-title">Outcome Deviations (Actual vs Replay)</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Status</th><th>Actual Trades</th><th>Replay Trades</th><th>Actual Net</th><th>Replay Net</th><th>Net Diff</th><th>Win% Diff</th></tr></thead>
      <tbody>${outcomeDeviationRows(outcome)}</tbody>
    </table></div>

    <div class="portfolio-section-title">Suggested Setting Improvements</div>
    ${replayHintsHTML(hints)}

    <div class="portfolio-section-title">Current vs Best Settings</div>
    ${replayComparisonHTML(result.summary, bestRows)}

    <div class="portfolio-section-title">Replay Transactions</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Setup</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Net P&L</th><th>Entry Time</th><th>Exit Time</th><th>Reason</th></tr></thead>
      <tbody>${replayTableRows(result.trades || [])}</tbody>
    </table></div>

    <div class="portfolio-section-title">Why Not Traded</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Symbol</th><th>Side</th><th>Setup</th><th>Rank</th><th>Score</th><th>Price</th><th>Reason</th></tr></thead>
      <tbody>${rejectedReplayRows(result.rejected || [])}</tbody>
    </table></div>

    <div class="portfolio-section-title">Setup Performance</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Setup</th><th>Trades</th><th>Win %</th><th>Net P&L</th><th>Costs</th></tr></thead>
      <tbody>${setupReplayRows(result.setupStats || [])}</tbody>
    </table></div>

    <div class="portfolio-section-title">Trade Quality</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Setup</th><th>Trades</th><th>Win %</th><th>Net P&L</th><th>Avg Net %</th><th>Avg Hold</th><th>Target %</th><th>Stop %</th><th>Fade Exit %</th><th>Late Entry %</th></tr></thead>
      <tbody>${tradeQualityRows(quality.bySetup || [])}</tbody>
    </table></div>

    <div class="portfolio-section-title">Exit Quality</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Exit Type</th><th>Trades</th><th>Win %</th><th>Net P&L</th><th>Avg Net %</th><th>Avg Hold</th><th>Target %</th><th>Stop %</th><th>Fade Exit %</th><th>Late Entry %</th></tr></thead>
      <tbody>${tradeQualityRows(quality.byExit || [])}</tbody>
    </table></div>

    <div class="portfolio-section-title">Best Settings Sweep</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>#</th><th>Min Score</th><th>Top N</th><th>Per Cycle</th><th>First Hr</th><th>Trail</th><th>Stop Confirm</th><th>Fade Confirm</th><th>Stop Grace</th><th>Partial Qty</th><th>Trades</th><th>Win %</th><th>Net P&L</th><th>Drawdown</th><th>Use</th></tr></thead>
      <tbody>${sweepReplayRows(sweepRows)}</tbody>
    </table></div>

    <div class="portfolio-section-title">Replay Job History</div>
    <div class="portfolio-table-wrap"><table class="replay-table">
      <thead><tr><th>Mode</th><th>Day</th><th>Status</th><th>Started</th><th>Flags</th><th>Best / Error</th></tr></thead>
      <tbody id="replay-job-history-body">${replayJobRows(replayJobHistory)}</tbody>
    </table></div>`;
  loadReplayJobHistory();
}

async function runReplayToday(dayOverride = null) {
  const modal = document.getElementById('replay-modal');
  const body = document.getElementById('replay-modal-body');
  if (modal) modal.style.display = 'flex';
  const day = normalizeReplayDay(dayOverride || getTradeDateISO());
  if (body) body.innerHTML = `<div style="color:var(--muted);padding:16px">Running replay for ${escapeHTML(day)} on proxy...</div>`;
  try {
    const res = await fetch(`${SIM_REPLAY_ENDPOINT}?day=${encodeURIComponent(day)}`, { signal:AbortSignal.timeout(REPLAY_FETCH_TIMEOUT_MS) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `replay HTTP ${res.status}`);
    renderReplayReport(day, [], payload.result || { snapshots:0, summary:{}, trades:[], rejected:[], setupStats:[] });
  } catch (e) {
    if (body) body.innerHTML = `<div style="color:var(--red);padding:16px">${escapeHTML(e.message || String(e))}</div>`;
  }
}

async function startReplayJob(day, mode) {
  const res = await fetch(SIM_REPLAY_JOB_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ day, mode }),
    signal:AbortSignal.timeout(15000),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `job HTTP ${res.status}`);
  updateReplayJobHistory(payload.jobs || []);
  return payload.job;
}

async function pollReplayJob(jobId, onUpdate = null) {
  for (let attempt = 0; attempt < 300; attempt++) {
    await new Promise(resolve => setTimeout(resolve, attempt < 2 ? 750 : 2000));
    const res = await fetch(`${SIM_REPLAY_JOB_ENDPOINT}?id=${encodeURIComponent(jobId)}`, { signal:AbortSignal.timeout(15000) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `job poll HTTP ${res.status}`);
    updateReplayJobHistory(payload.jobs || []);
    const job = payload.job;
    if (typeof onUpdate === 'function') onUpdate(job);
    if (job?.status === 'done') return job.result;
    if (job?.status === 'error') throw new Error(job.error || 'Replay job failed');
  }
  throw new Error('Replay job timed out');
}

function runReplayForSelectedDate() {
  const day = document.getElementById('replay-date-input')?.value || getTradeDateISO();
  return runReplayToday(day);
}

async function runReplaySweepForCurrent() {
  if (!lastReplayDebugResult) return;
  if (replayJobBusyMode) return;
  const body = document.getElementById('replay-modal-body');
  const statusBox = document.getElementById('replay-job-status');
  const progressId = 'replay-sweep-progress';
  if (statusBox) statusBox.innerHTML = `<div id="${progressId}" class="replay-note">Starting settings sweep job...</div>`;
  setReplayJobBusy('sweep', true, 'Sweeping...');
  try {
    const day = normalizeReplayDay(lastReplayDebugResult.day || getTradeDateISO());
    const cachedRes = await fetch(`${SIM_REPLAY_ENDPOINT}?day=${encodeURIComponent(day)}&mode=deep_sweep&cachedOnly=1`, { signal:AbortSignal.timeout(10000) });
    const cachedPayload = await cachedRes.json().catch(() => ({}));
    if (cachedRes.ok && cachedPayload.ok !== false && cachedPayload.cached && Array.isArray(cachedPayload.sweepRows) && cachedPayload.sweepRows.length) {
      const el = document.getElementById(progressId);
      if (el) el.textContent = `Loaded post-market deep sweep cache (${cachedPayload.sweepRows.length} rows).`;
      renderReplayReport(lastReplayDebugResult.day, [], lastReplayDebugResult.result, { sweepRows:cachedPayload.sweepRows || [], autoTuneRows:lastReplayDebugResult.autoTuneRows });
      return;
    }
    const el = document.getElementById(progressId);
    if (el) el.textContent = 'No cached post-market deep sweep found. Running deep sweep now...';
    const job = await startReplayJob(day, 'deep_sweep');
    const payload = await pollReplayJob(job.id, update => {
      const el = document.getElementById(progressId);
      if (el) el.textContent = `Settings sweep ${update.status}${update.cached ? ' (cached)' : update.reused ? ' (reused)' : update.workerPid ? ` (worker ${update.workerPid})` : ''}... ${update.id}`;
    });
    const sweepRows = payload.sweepRows || [];
    renderReplayReport(lastReplayDebugResult.day, [], lastReplayDebugResult.result, { sweepRows, autoTuneRows:lastReplayDebugResult.autoTuneRows });
  } catch (e) {
    const el = document.getElementById(progressId);
    if (el) el.textContent = `Sweep failed: ${e.message || String(e)}`;
  } finally {
    setReplayJobBusy('sweep', false);
  }
}

async function runReplayAutoTune5D() {
  const body = document.getElementById('replay-modal-body');
  if (!lastReplayDebugResult) return;
  if (replayJobBusyMode) return;
  const statusBox = document.getElementById('replay-job-status');
  setReplayJobBusy('autotune', true, 'Auto tuning...');
  try {
    if (statusBox) statusBox.innerHTML = '<div id="replay-autotune-progress" class="replay-note">Starting 5D auto tune job...</div>';
    const job = await startReplayJob(lastReplayDebugResult.day, 'autotune');
    const payload = await pollReplayJob(job.id, update => {
      const el = document.getElementById('replay-autotune-progress');
      if (el) el.textContent = `5D auto tune ${update.status}${update.cached ? ' (cached)' : update.reused ? ' (reused)' : update.workerPid ? ` (worker ${update.workerPid})` : ''}... ${update.id}`;
    });
    const autoTuneRows = payload.autoTuneRows || [];
    renderReplayReport(lastReplayDebugResult.day, [], lastReplayDebugResult.result, { sweepRows:lastReplayDebugResult.sweepRows, autoTuneRows });
  } catch (e) {
    if (statusBox) statusBox.innerHTML = `<div class="replay-note" style="color:var(--red)">Auto tune failed: ${escapeHTML(e.message || String(e))}</div>`;
  } finally {
    setReplayJobBusy('autotune', false);
  }
}

function downloadTextFile(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportReplayReport(format = 'json') {
  if (!lastReplayDebugResult) return;
  const day = normalizeReplayDay(lastReplayDebugResult.day || getTradeDateISO());
  if (format === 'csv') {
    const esc = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['symbol','side','setup','qty','entry','exit','net','entryTime','exitTime','reason']]
      .concat((lastReplayDebugResult.result?.trades || []).map(t => [t.symbol, t.side, replayTradeSetup(t), t.qty, replayTradeEntry(t), replayTradeExit(t), replayTradeNet(t), replayTradeOpened(t), replayTradeClosed(t), replayTradeReason(t)]));
    downloadTextFile(`replay_${day}.csv`, rows.map(row => row.map(esc).join(',')).join('\n'), 'text/csv');
    return;
  }
  downloadTextFile(`replay_${day}.json`, JSON.stringify(lastReplayDebugResult, null, 2), 'application/json');
}

async function closePaperTradeAtPrice(trade, exitPrice, reason, silent = false) {
  if (!trade?.id || !Number.isFinite(Number(exitPrice))) return false;
  try {
    const transactionTime = new Date().toISOString();
    await postPaperTrade('close', { id: trade.id, exitPrice, reason, transactionTime });
    applyClosedTradeLocally(trade.id, exitPrice, reason);
    loadPaperTrades(true, true).catch(e => console.warn('post-close reconcile failed', e.message));
    if (document.getElementById('fund-modal')?.style.display === 'flex') openFundModal(trade.symbol);
    return true;
  } catch (e) {
    if (!silent) alert(e.message || 'Could not close paper trade');
    else console.warn('auto close failed', trade.symbol, e.message);
    return false;
  }
}

async function partialClosePaperTradeAtPrice(trade, exitPrice, qty, reason, runner = false, silent = false) {
  if (!trade?.id || !Number.isFinite(Number(exitPrice)) || !Number.isFinite(Number(qty)) || Number(qty) <= 0) return false;
  try {
    const transactionTime = new Date().toISOString();
    await postPaperTrade('partial-close', { id: trade.id, exitPrice, qty:Math.floor(Number(qty)), reason, runner:!!runner, transactionTime });
    await loadPaperTrades(true, true);
    renderTable();
    if (currentView === 'etfs') renderETFSection();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
    if (document.getElementById('fund-modal')?.style.display === 'flex') openFundModal(trade.symbol);
    return true;
  } catch (e) {
    if (!silent) alert(e.message || 'Could not partially close paper trade');
    else console.warn('auto partial close failed', trade.symbol, e.message);
    return false;
  }
}

async function runSimulationCycle({ allowEntries = true } = {}) {
  if (simulationBusy) return;
  const isEodSettlement = isSimulationEodSettlementTime();
  const simSettings = getSimulationEngineSettings();
  const manualAutoExitEnabled = !!simSettings.SIMULATION_AUTO_MANUAL_EXITS;
  const allOpenTrades = paperTrades.filter(isOpenTrade);
  const simOpen = getSimulationOpenTrades();
  const manualOpenAll = allOpenTrades.filter(t => t.source !== 'simulation');
  const manualManagedOpen = manualAutoExitEnabled ? manualOpenAll : [];
  if (simulationState === 'off' && !simOpen.length && !(isEodSettlement && manualOpenAll.length)) return;
  simulationBusy = true;
  try {
    // Always square-off manual paper trades during EOD settlement, even if simulation mode is OFF.
    if (isEodSettlement && manualOpenAll.length) {
      for (const trade of [...manualOpenAll]) {
        const price = getCurrentTradePrice(trade.symbol);
        const fallbackPrice = Number(price)
          || Number(trade.entryPrice)
          || Number(trade.stop)
          || Number(trade.target);
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
          await closePaperTradeAtPrice(
            trade,
            fallbackPrice,
            Number.isFinite(Number(price)) ? 'Manual EOD square-off' : 'Manual EOD square-off (fallback price)',
            true
          );
        }
      }
    }

    // Optional: auto-manage manual exits with the same logic simulation uses (non-EOD only).
    if (!isEodSettlement && manualManagedOpen.length) {
      for (const trade of [...manualManagedOpen]) {
        const price = getCurrentTradePrice(trade.symbol);
        let exit = getSimulationExit(trade, price);
        if (exit?.action === 'partial') {
          const qty = Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100));
          if (qty > 0 && qty < Number(trade.qty || 0)) {
            await partialClosePaperTradeAtPrice(trade, exit.exitPrice, qty, String(exit.reason || 'Manual auto partial exit').replace(/^Simulation\b/i, 'Manual'), exit.runner, true);
          }
        } else if (exit) {
          await closePaperTradeAtPrice(trade, exit.exitPrice, String(exit.reason || 'Manual auto exit').replace(/^Simulation\b/i, 'Manual'), true);
        }
      }
    }

    for (const trade of [...simOpen]) {
      const price = getCurrentTradePrice(trade.symbol);
      let exit = getSimulationExit(trade, price);
      if (!exit && isEodSettlement) {
        const fallbackPrice = Number(price)
          || Number(trade.entryPrice)
          || Number(trade.stop)
          || Number(trade.target);
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
          exit = {
            reason: Number.isFinite(Number(price))
              ? 'Simulation EOD square-off'
              : 'Simulation EOD square-off (fallback price)',
            exitPrice: fallbackPrice,
          };
        }
      }
      if (exit?.action === 'partial') {
        const qty = Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100));
        if (qty > 0 && qty < Number(trade.qty || 0)) {
          await partialClosePaperTradeAtPrice(trade, exit.exitPrice, qty, exit.reason, exit.runner, true);
        }
      } else if (exit) {
        await closePaperTradeAtPrice(trade, exit.exitPrice, exit.reason, true);
      }
    }

    const openAfterExits = getSimulationOpenTrades();
    if (simulationState === 'settling') {
      if (!openAfterExits.length) setSimulationState('off');
      return;
    }
    if (simulationState !== 'running' || !allowEntries || !isSimulationEntryWindow() || isEodSettlement) {
      const blockReasons = [];
      if (simulationState !== 'running') blockReasons.push(`state=${simulationState}`);
      if (!allowEntries) blockReasons.push('allowEntries=false');
      if (!isSimulationEntryWindow()) blockReasons.push('outside entry window');
      if (isEodSettlement) blockReasons.push('EOD settlement time');
      if (DEBUG_SIM_LOGS && blockReasons.length) console.warn('[SimCycle] Entry blocked:', blockReasons.join(', '));
      return;
    }

    let summary = getPortfolioSummary();
    const totalOpen = paperTrades.filter(isOpenTrade).length;
    const simOpenCount = getSimulationOpenTrades().length;
    let slots = Math.max(0, Math.min(SIMULATION_MAX_OPEN - totalOpen, SIMULATION_MAX_ACTIVE_OPEN - simOpenCount));
    if (slots <= 0 || summary.cashAvailable <= 0) {
      if (DEBUG_SIM_LOGS && slots <= 0) console.warn(`[SimCycle] No slots available: total=${totalOpen}, simOpen=${simOpenCount}`);
      if (DEBUG_SIM_LOGS && summary.cashAvailable <= 0) console.warn('[SimCycle] No cash available');
      return;
    }

    const candidates = getSimulationCandidates();
    if (candidates.length === 0) {
      if (DEBUG_SIM_LOGS) console.warn('[SimCycle] No candidates found for simulation entry');
      simulationBusy = false;
      return;
    }
    let openedThisCycle = 0;
    for (let i = 0; i < candidates.length; i++) {
      const { row, t, score, side } = candidates[i];
      if (slots <= 0) break;
      if (openedThisCycle >= SIMULATION_MAX_NEW_PER_CYCLE) break;
      summary = getPortfolioSummary();
      if (summary.cashAvailable <= 0) break;
      const setupType = candidates[i].derivedSetupType || candidates[i].setupType || getSetupType(row, t, getRiskGuard(row, t, score));
      const blockReason = getSimulationEntryBlockReason(row.sym, setupType);
      if (blockReason) {
        if (/daily/i.test(blockReason)) {
          if (DEBUG_SIM_LOGS) console.warn(`[SimCycle] Daily limit hit on ${row.sym}: ${blockReason}`);
          break;
        }
        if (DEBUG_SIM_LOGS) console.debug(`[SimCycle] ${row.sym} ${setupType} blocked: ${blockReason}`);
        continue;
      }
      const price = getCurrentTradePrice(row.sym);
      const remainingCandidates = Math.max(1, candidates.length - i);
      const remainingSlots = Math.max(1, Math.min(slots, remainingCandidates));
      const allocation = Math.min(MAX_POSITION_EXPOSURE, summary.cashAvailable / remainingSlots);
      const tradeSide = side || (score < 0 ? 'sell' : 'buy');
      const suggestion = getSuggestedPaperQty(t, tradeSide, price, summary.cashAvailable, allocation);
      const qty = Number(suggestion.qty || 0);
      if (qty <= 0) continue;
      let plan = suggestion.plan || getPaperPlanForSide(t, tradeSide, price);
      
      // Special handling for High Profit Short: 1.5% target, 1% stop
      if (setupType === 'High Profit Short' && tradeSide === 'sell') {
        const profitTargetPct = Number(getSimulationEngineSettings().SIMULATION_HIGH_PROFIT_EXIT_PROFIT_PCT) || 1.5;
        const stopLossPct = Number(getSimulationEngineSettings().SIMULATION_HIGH_PROFIT_EXIT_STOP_PCT) || 1;
        plan = {
          ...plan,
          target: Number((price * (1 - profitTargetPct / 100)).toFixed(2)),
          stop: Number((price * (1 + stopLossPct / 100)).toFixed(2)),
        };
      }
      
      const transactionTime = new Date().toISOString();
      const openResult = await postPaperTrade('open', {
        transactionTime,
        symbol: row.sym,
        name: row.name || row.sym,
        side: tradeSide,
        qty,
        entryPrice: price,
        target: plan.target,
        stop: plan.stop,
        signal: tradeSide,
        score: Math.abs(score),
        rr: t.rr,
        source: 'simulation',
        brokerMode,
        assetType: isETFAsset(row) ? 'etf' : 'stock',
        reservedCapital:+(qty * price).toFixed(2),
        portfolioInitial:getPortfolioCapital(),
        setupType,
        setup: ['Simulation', setupType, t.entryStatus, t.entryTrigger, ...(t.reasons || []).slice(0, 3)].filter(Boolean).join(' | '),
        entryContext:{
          selectedRank:i + 1,
          score,
          setupType,
          side:tradeSide,
          reason:`selected rank ${i + 1}`,
          indicators:{
            entryStatus:t.entryStatus || '',
            entryTrigger:t.entryTrigger || '',
            vwap:t.vwap ?? null,
            vwapBandPosition:t.vwapBandPosition ?? null,
            ema9:t.ema9 ?? t.emaShort ?? null,
            ema20:t.ema20 ?? t.emaLong ?? null,
            rsi:t.rsi ?? null,
            superTrendDirection:t.superTrendDirection ?? null,
            relVolume:t.relVolumeTimeAdjusted ?? t.relVolume ?? null,
            rr:t.rr ?? null,
            reasons:Array.isArray(t.reasons) ? t.reasons.slice(0, 5) : [],
          },
          market:{
            niftyChange:indexData?.nifty50?.change ?? indexData?.nifty?.change ?? null,
            sectorAvg:sectorTrendCache[row.sector] ?? null,
          },
        },
      });
      await loadPaperTrades(true);
      const openedTrade = openResult?.trade || getOpenPaperTrade(row.sym);
      registerNewSimulationTrade(openedTrade);
      if (DEBUG_SIM_LOGS && openedTrade) console.log(`[SimCycle] Opened ${row.sym} ${setupType} ${qty}@${price}`);
      slots -= 1;
      openedThisCycle += 1;
    }
    renderTable();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  } finally {
    simulationBusy = false;
    updateSimulationButton();
  }
}

async function loadPaperTrades(forceServer = false, trackNewTrades = false) {
  if (paperTradesLoading) return paperTradesLoading;
  paperTradesLoading = (async () => {
  try {
    let payload = null;
    if (!forceServer && !paperTradesLoaded && dashboardBootstrap && Array.isArray(dashboardBootstrap.trades)) {
      payload = { trades:dashboardBootstrap.trades, portfolio:dashboardBootstrap.portfolio };
    } else {
      const res = await fetch(PAPER_TRADES_ENDPOINT, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error('paper-trades HTTP ' + res.status);
      payload = await res.json().catch(() => null);
    }
    applyPaperTradesState(payload, { trackNewTrades });
  } catch (e) {
    console.warn('loadPaperTrades failed', e.message);
    paperTrades = [];
  } finally {
    paperTradesLoading = null;
  }
  })();
  return paperTradesLoading;
}

async function postPaperTrade(action, payload) {
  let res;
  try {
    res = await fetch(PAPER_TRADES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    throw new Error(`Could not reach local proxy at ${PROXY}. Start/restart with: node ticker_proxy.js`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('paper-trades HTTP ' + res.status));
  return json;
}

function applyOpenedTradeLocally(trade) {
  if (!trade || !trade.symbol) return;
  const idx = paperTrades.findIndex(t => isOpenTrade(t) && t.symbol === trade.symbol);
  if (idx >= 0) paperTrades[idx] = trade;
  else paperTrades.unshift(trade);
  paperTradesLoaded = true;
  registerNewSimulationTrade(trade);
  renderTopActionBar();
  renderTable();
  if (currentView === 'etfs') renderETFSection();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  if (document.getElementById('open-trades-modal')?.style.display === 'flex') renderOpenTradesModal();
}

function applyClosedTradeLocally(tradeId, exitPrice, reason = 'Manual exit') {
  const idx = paperTrades.findIndex(t => isOpenTrade(t) && String(t.id || '') === String(tradeId || ''));
  if (idx < 0) return;
  const trade = paperTrades[idx];
  const closedAt = new Date().toISOString();
  const pnlObj = getPaperTradePnl(trade, exitPrice);
  const closedTrade = {
    ...trade,
    status:'closed',
    exitPrice:+Number(exitPrice).toFixed(2),
    closedAt,
    closeReason:reason || 'Manual exit',
    pnl:Number.isFinite(Number(pnlObj?.pnl)) ? Number(pnlObj.pnl) : null,
    pnlPct:Number.isFinite(Number(pnlObj?.pnlPct)) ? Number(pnlObj.pnlPct) : null,
    grossPnl:Number.isFinite(Number(pnlObj?.grossPnl)) ? Number(pnlObj.grossPnl) : null,
    charges:Number.isFinite(Number(pnlObj?.charges)) ? Number(pnlObj.charges) : null,
    chargeBreakup:pnlObj?.chargeBreakup || null,
  };
  paperTrades[idx] = closedTrade;
  // Track the closed trade as a new event
  const key = simulationTradeKey(closedTrade);
  if (key) {
    newSimulationTradeKeys.add(key);
    saveNewSimulationTradeKeys();
  }
  paperTradesLoaded = true;
  renderTopActionBar();
  renderTable();
  if (currentView === 'etfs') renderETFSection();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  if (document.getElementById('open-trades-modal')?.style.display === 'flex') renderOpenTradesModal();
}

async function openPaperTrade(sym, side) {
  const t = intradayData[sym];
  const price = getCurrentTradePrice(sym);
  if (!t || !price) { alert('Trade setup is not loaded yet. Refresh once and try again.'); return; }
  const freshness = getIntradayFreshness(t);
  if (freshness.stale) { alert(`Intraday signal is stale: ${freshness.reason}. Refresh before trading.`); return; }
  if (getOpenPaperTrade(sym)) { alert('There is already an open paper trade for this stock. Exit it before opening another.'); return; }
  const asset = MIDCAP_STOCKS.find(s => s.sym === sym) || STOCK_ASSETS.find(s => s.sym === sym) || ETF_ASSETS.find(s => s.sym === sym) || { sym, name: sym };
  const portfolio = getPortfolioSummary();
  const suggestion = getSuggestedPaperQty(t, side, price, portfolio.cashAvailable);
  const suggestedQty = Number(suggestion.qty || 0);
  const qty = getManualPaperQty(sym, suggestion);
  if (!Number.isFinite(qty) || qty <= 0) { alert('Enter a valid quantity greater than 0.'); return; }
  if (suggestedQty <= 0) { alert('Not enough available paper cash for this trade. Close another trade or reduce risk.'); return; }
  if (qty > suggestion.cashLimit) { alert(`Quantity exceeds available cash/max exposure. Max allowed: ${suggestion.cashLimit}`); return; }
  const score = adjustedTradeScore(asset);
  const sideScore = side === 'sell' ? -Math.abs(score) : Math.abs(score);
  const plan = suggestion.plan || getPaperPlanForSide(t, side, price);
  try {
    const openResult = await postPaperTrade('open', {
      symbol: sym,
      name: asset.name || sym,
      side,
      qty,
      entryPrice: price,
      target: plan.target,
      stop: plan.stop,
      signal: side,
      score: sideScore,
      rr: t.rr,
      source: 'manual',
      brokerMode,
      assetType: isETFAsset(sym) ? 'etf' : 'stock',
      reservedCapital:+(qty * price).toFixed(2),
      portfolioInitial:getPortfolioCapital(),
      setup: [t.entryStatus, t.entryTrigger, ...(t.reasons || []).slice(0, 3)].filter(Boolean).join(' | '),
    });
    applyOpenedTradeLocally(openResult?.trade);
    loadPaperTrades(true).catch(e => console.warn('post-open reconcile failed', e.message));
  } catch (e) {
    alert(e.message || 'Could not open paper trade');
  }
}

async function closePaperTrade(id, sym) {
  const open = paperTrades.find(t => isOpenTrade(t) && String(t.id || '') === String(id || '')) || null;
  const fallbackPrice = Number(open?.entryPrice || stockData[sym]?.price || 0);
  const price = getCurrentTradePrice(sym) || (Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : null);
  if (!price) { alert('Exit price is not available right now. Refresh once and try again.'); return; }
  await closePaperTradeAtPrice({ id, symbol:sym }, price, 'Manual exit', false);
}

function renderPaperTradeControls(row, t) {
  const open = getOpenPaperTrade(row.sym);
  const price = getCurrentTradePrice(row.sym);
  if (open) {
    const pnl = getPaperTradePnl(open, price);
    const cls = pnl && pnl.pnl >= 0 ? 'up' : 'down';
    const brokerBadge = open.broker?.name === 'zerodha'
      ? `<span class="broker-badge">${open.broker?.mode === 'live' ? 'Zerodha live' : 'Zerodha dry'}</span>`
      : (open.broker?.name === 'sharekhan' ? '<span class="broker-badge">Sharekhan live</span>' : '');
    return `<div class="paper-trade-box">
      <span class="paper-trade-head">${open.source === 'simulation' ? 'SIM ' : ''}${escapeHTML(open.side)} ${Number(open.qty || 0).toLocaleString('en-IN')}</span>
      ${brokerBadge}
      <span>Entry ${moneyINR(open.entryPrice)}</span>
      <span class="paper-pnl ${cls}">${pnl ? moneyINR(pnl.pnl) + ' (' + pnl.pnlPct + '% net)' : '--'}</span>
      <span>Cost ${pnl ? moneyINR(pnl.charges) : '--'}</span>
      <button class="paper-btn exit" onclick="event.stopPropagation();closePaperTrade('${escapeHTML(open.id)}','${escapeHTML(row.sym)}')">Exit</button>
    </div>`;
  }
  const disabled = !t || !price ? ' disabled' : '';
  const cash = getPortfolioSummary().cashAvailable;
  const buyQty = t && price ? getSuggestedPaperQty(t, 'buy', price, cash).qty : 0;
  const sellQty = t && price ? getSuggestedPaperQty(t, 'sell', price, cash).qty : 0;
  const defaultQty = buyQty || sellQty || '';
  const qtyId = paperQtyInputId(row.sym);
  const modeHint = brokerMode === 'zerodha_dry_run'
    ? 'Zerodha dry-run order will be saved; no live order is placed.'
    : (brokerMode === 'zerodha_live'
      ? 'Live order will be sent to Zerodha.'
      : (brokerMode === 'sharekhan_live' ? 'Live order will be sent to Sharekhan.' : 'Paper trade only.'));
  return `<div class="paper-actions">
    <input id="${escapeHTML(qtyId)}" class="paper-qty-input"${disabled} type="number" min="1" step="1" value="${defaultQty}" title="Override quantity. Suggested buy ${buyQty || 0}, sell ${sellQty || 0}. Max Rs 1L exposure." onclick="event.stopPropagation()" />
    <button class="paper-btn buy"${disabled} title="${escapeHTML(modeHint)} Uses Qty box. Suggested buy qty ${buyQty || 0}." onclick="event.stopPropagation();openPaperTrade('${escapeHTML(row.sym)}','buy')">Buy</button>
    <button class="paper-btn sell"${disabled} title="${escapeHTML(modeHint)} Uses Qty box. Suggested sell qty ${sellQty || 0}." onclick="event.stopPropagation();openPaperTrade('${escapeHTML(row.sym)}','sell')">Sell</button>
  </div>`;
}

function getRiskGuard(row, t, score = null) {
  if (!t) return { label:'Wait', level:'small', reason:'Trade setup is not loaded yet' };
  const freshness = getIntradayFreshness(t);
  if (freshness.stale) return { label:'Stale', level:'avoid', reason:freshness.reason };
  const signal = adjustedTradeSignal(score ?? adjustedTradeScore(row));
  const price = Number(t.price);
  const stop = Number(t.stop);
  const target = Number(t.target);
  const vwap = Number(t.vwap);
  const riskPct = price && stop ? (Math.abs(price - stop) / price) * 100 : null;
  const extensionPct = price && vwap ? (Math.abs(price - vwap) / price) * 100 : null;
  const bandPos = String(t.vwapBandPosition || '');
  const stDir = String(t.superTrendDirection || '');
  const liq = getLiquidityInfo(t);
  const time = getTimeWarning();
  const flag = getEventFlag(row.sym);
  const size = getPositionSize(t);
  const cost = getTradeCostContext(row, t, signal === 'sell' ? 'sell' : 'buy');

  const invalidated =
    (signal === 'buy' && Number.isFinite(stop) && price <= stop) ||
    (signal === 'sell' && Number.isFinite(stop) && price >= stop) ||
    (signal === 'buy' && Number.isFinite(target) && price >= target) ||
    (signal === 'sell' && Number.isFinite(target) && price <= target);
  if (invalidated) return { label:'Invalidated', level:'invalid', reason:'Price already crossed stop or target zone' };

  const bandChase = (signal === 'buy' && bandPos === 'above-upper') || (signal === 'sell' && bandPos === 'below-lower');
  if (bandChase || (extensionPct != null && extensionPct > 1.2 && t.entryStatus === 'Triggered')) {
    const reason = bandChase
      ? `Price is outside ${signal === 'buy' ? 'upper' : 'lower'} VWAP band`
      : `Price is ${extensionPct.toFixed(1)}% away from VWAP`;
    return { label:'Chasing', level:'chasing', reason };
  }

  const superTrendConflict = (signal === 'buy' && stDir === 'bearish') || (signal === 'sell' && stDir === 'bullish');
  if ((t.rr != null && t.rr < 1.3) || liq.level === 'thin' || (riskPct != null && riskPct > 1.6) || (cost && !cost.ok) || superTrendConflict) {
    const why = [];
    if (t.rr != null && t.rr < 1.3) why.push(`R:R ${t.rr}`);
    if (liq.level === 'thin') why.push('thin liquidity');
    if (riskPct != null && riskPct > 1.6) why.push(`SL risk ${riskPct.toFixed(1)}%`);
    if (cost && !cost.ok) why.push(`net ${cost.netPct}% < ${cost.minNetPct}% after costs`);
    if (superTrendConflict) why.push(`SuperTrend ${stDir}`);
    return { label:'Avoid', level:'avoid', reason:why.join(', ') };
  }

  if (t.volumeShock?.isShock && extensionPct != null && extensionPct <= 3.2) {
    return { label:'Shock', level:'small', reason:`Volume shock ${t.volumeShock.change3m ?? '--'}%/3m, ${t.volumeShock.volumeRatio3m ?? '--'}x volume` };
  }

  if (flag?.danger || liq.level === 'fair' || time.level === 'warn' || (size && size.qty <= 0)) {
    const why = [];
    if (flag?.danger) why.push('event risk');
    if (liq.level === 'fair') why.push('fair liquidity');
    if (time.level === 'warn') why.push(time.label);
    if (size && size.qty <= 0) why.push('qty is zero for risk settings');
    return { label:'Small qty', level:'small', reason:why.join(', ') };
  }

  return { label:'OK', level:'ok', reason:'Risk checks passed' };
}

function getRelativeStrength(t) {
  const nifty = Number(indexData.nifty50?.change);
  if (!t || t.dayChange == null || !Number.isFinite(nifty)) return null;
  return +(t.dayChange - nifty).toFixed(2);
}

function getEventFlag(sym) {
  if (typeof stockNewsCache === 'undefined') return null;
  const entry = Object.entries(stockNewsCache).find(([key]) => key.startsWith(sym + '|'))?.[1];
  const events = entry?.events || [];
  if (!events.length) return null;
  const event = events[0] || {};
  const type = event.type || 'Event';
  const dateRaw = event.eventDate || event.exDate || event.recordDate || event.filingDate || event.publishedAt || event.toDate;
  let danger = false;
  if (dateRaw) {
    const d = new Date(dateRaw);
    const now = new Date();
    if (!Number.isNaN(d.getTime())) {
      const dayMs = 24 * 60 * 60 * 1000;
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((eventDay - today) / dayMs);
      danger = diffDays >= 0 && diffDays <= 1;
    }
  }
  let label = 'Event';
  const eventText = `${type} ${event.title || ''} ${event.subject || ''} ${event.purpose || ''}`;
  if (/dividend/i.test(eventText)) label = 'Div';
  else if (/result/i.test(eventText)) label = 'Result';
  else if (/board/i.test(eventText)) label = 'Board';
  return { label, danger, title: event.title || type };
}

function getLatestResultVerdict(sym) {
  if (typeof stockNewsCache === 'undefined') return null;
  const entry = Object.entries(stockNewsCache).find(([key]) => key.startsWith(sym + '|'))?.[1];
  const result = (entry?.events || []).find(ev => ev?.type === 'Results' && ev.resultVerdict);
  return result || null;
}

function renderResultVerdictBadge(sym) {
  const result = getLatestResultVerdict(sym);
  if (!result) return '';
  const verdict = String(result.resultVerdict || '').toLowerCase();
  const label = verdict === 'positive' ? 'Result +' : verdict === 'negative' ? 'Result -' : 'Result Mix';
  const reason = result.resultVerdictReason || 'Latest result verdict';
  return `<span class="result-badge ${verdict}" title="${escapeHTML(reason)}">${label}</span>`;
}

function getHighImpactNewsForSymbol(sym) {
  const symbol = String(sym || '').toUpperCase();
  const direct = freshNewsSummary.impactBySymbol?.[symbol];
  const fallback = (freshNewsSummary.items || [])
    .filter(item => String(item.symbol || '').toUpperCase() === symbol)
    .sort((a, b) => Math.abs(Number(b.tradeImpactScore || 0)) - Math.abs(Number(a.tradeImpactScore || 0)))[0];
  const item = direct || fallback || null;
  if (!item) return null;
  const score = Number(item.tradeImpactScore || 0);
  const impactAbs = Number(item.tradeImpactAbs || Math.abs(score));
  if (impactAbs < 55) return null;
  return { ...item, tradeImpactScore:score, tradeImpactAbs:impactAbs };
}

function renderNewsImpactHealthBadge(sym) {
  const item = getHighImpactNewsForSymbol(sym);
  if (!item) return '';
  const sentiment = String(item.newsSentiment || 'Neutral').toLowerCase();
  const score = Number(item.tradeImpactScore || 0);
  const prefix = sentiment === 'positive' ? 'News +' : sentiment === 'negative' ? 'News -' : 'News';
  const title = `${item.type || 'News'}: ${item.title || ''}${item.tradeImpactReason ? ' | ' + item.tradeImpactReason : ''}`;
  return `<span class="news-impact-badge health-news-badge ${escapeHTML(sentiment)}" title="${escapeHTML(title)}">${escapeHTML(prefix)}${Math.abs(score)}</span>`;
}

function renderTradeContext(row, t) {
  const bits = [];
  const freshness = getIntradayFreshness(t);
  bits.push(`<span class="signal-freshness ${freshness.stale ? 'stale' : 'fresh'}" title="${escapeHTML(freshness.reason)}">${escapeHTML(freshness.label)}</span>`);
  if (t.entryStatus) bits.push(t.entryStatus);
  const rs = getRelativeStrength(t);
  if (rs != null) bits.push(`RS ${rs >= 0 ? '+' : ''}${rs}%`);
  const sectorAvg = sectorTrendCache[row.sector];
  if (sectorAvg != null) bits.push(`Sec ${sectorAvg >= 0 ? '+' : ''}${sectorAvg.toFixed(1)}%`);
  if (t.superTrendDirection) bits.push(`ST${t.superTrendDirection === 'bullish' ? '+' : '-'}`);
  if (t.vwapBandPosition === 'above-upper') bits.push('VWAP hi');
  else if (t.vwapBandPosition === 'below-lower') bits.push('VWAP lo');
  else if (t.vwapBandWidthPct != null) bits.push(`Band ${t.vwapBandWidthPct}%`);
  if (t.prevDayHigh != null && t.price > t.prevDayHigh) bits.push('>PDH');
  else if (t.prevDayLow != null && t.price < t.prevDayLow) bits.push('<PDL');
  else if (t.pivot != null) bits.push(t.price >= t.pivot ? '>Pivot' : '<Pivot');
  if (t.high5 != null && t.price > t.high5) bits.push('5D BO');
  else if (t.low5 != null && t.price < t.low5) bits.push('5D BD');
  if (t.high20 != null && t.price > t.high20) bits.push('20D BO');
  else if (t.low20 != null && t.price < t.low20) bits.push('20D BD');
  if (t.gapPct != null && Math.abs(t.gapPct) >= 0.35) bits.push(`Gap ${t.gapPct > 0 ? '+' : ''}${t.gapPct}%`);
  if (t.relVolume != null) bits.push(`Vol ${t.relVolume}x`);
  const liq = getLiquidityInfo(t);
  if (liq.level !== 'unknown') bits.push(`${liq.label} ${liq.tradedCr}cr`);
  const cost = getTradeCostContext(row, t);
  if (cost) bits.push(`Net ${cost.netPct}%`);
  const time = getTimeWarning();
  if (time.level !== 'ok') bits.push(time.label);
  const flag = getEventFlag(row.sym);
  if (flag) bits.push(`<span class="event-flag${flag.danger ? ' danger' : ''}" title="${escapeHTML(flag.title)}">${flag.danger ? '!' : ''}${flag.label}</span>`);
  return bits.length ? `<span class="trade-context">${bits.join(' · ')}</span>` : '';
}

function getTradeConfidence(row, t, score, guard) {
  if (!t) return { label:'Low', level:'low', reason:'No intraday signal' };
  let points = 0;
  const reasons = [];
  const absScore = Math.abs(Number(score) || 0);
  const relVol = Number(t.relVolumeTimeAdjusted ?? t.relVolume);
  const freshness = getIntradayFreshness(t);
  if (absScore >= 85) { points += 3; reasons.push('strong score'); }
  else if (absScore >= 65) { points += 2; reasons.push('good score'); }
  else if (absScore >= 50) { points += 1; reasons.push('moderate score'); }
  if (Number.isFinite(relVol) && relVol >= 1.5) { points += 2; reasons.push(`volume ${relVol.toFixed(2)}x`); }
  else if (Number.isFinite(relVol) && relVol >= 1) { points += 1; reasons.push(`volume ${relVol.toFixed(2)}x`); }
  if (String(t.entryStatus || '').toLowerCase() === 'triggered') { points += 2; reasons.push('triggered'); }
  if (guard?.level === 'ok') points += 1;
  if (freshness.stale) { points -= 2; reasons.push('stale'); }
  if (guard?.level === 'avoid' || guard?.level === 'invalid' || guard?.level === 'chasing') points -= 2;
  if (points >= 6) return { label:'High', level:'high', reason:reasons.join(', ') || 'High-confidence setup' };
  if (points >= 3) return { label:'Med', level:'medium', reason:reasons.join(', ') || 'Medium-confidence setup' };
  return { label:'Low', level:'low', reason:reasons.join(', ') || 'Low-confidence setup' };
}

function renderTradeCell(row) {
  const t = intradayData[row.sym];
  if (!t) return '<span style="color:var(--muted);font-size:12px">--</span>';
  const labels = { buy:'BUY', watch:'WATCH', hold:'HOLD', sell:'SELL' };
  const reason = (t.reasons || []).join(' | ');
  const score = adjustedTradeScore(row);
  const signal = adjustedTradeSignal(score);
  const guard = getRiskGuard(row, t, score);
  const confidence = getTradeConfidence(row, t, score, guard);
  return `<div class="trade-cell" title="${escapeHTML(reason)}">
    <span class="trade-badge-row"><span class="risk-guard ${guard.level}" title="${escapeHTML(guard.reason)}">${guard.label}</span><span class="signal-badge ${signal}">${labels[signal] || signal}</span><span class="confidence-badge ${confidence.level}" title="${escapeHTML(confidence.reason)}">${confidence.label}</span></span>
    <span class="trade-score">Score ${score}</span>
    ${renderTradeContext(row, t)}
    ${renderPaperTradeControls(row, t)}
    <span class="indicator-mini">${escapeHTML(t.entryTrigger || '')}</span>
    <span class="indicator-mini">${escapeHTML((t.reasons || []).slice(0,2).join(', ') || '5m setup')}</span>
  </div>`;
}

function renderShortTargetCell(row) {
  const t = intradayData[row.sym];
  if (!t) {
    console.debug(`[renderShortTargetCell] ${row.sym}: no intradayData, keys present:`, Object.keys(intradayData).slice(0, 5));
    return '<span style="color:var(--muted);font-size:12px">--</span>';
  }
  const open = getOpenPaperTrade(row.sym);
  if (open) {
    const price = getCurrentTradePrice(row.sym);
    const pnl = getPaperTradePnl(open, price);
    const up = pnl ? pnl.pnl >= 0 : true;
    const col = up ? 'var(--green)' : 'var(--red)';
    return `<div class="target-cell short-term" style="color:${col}">
      Locked ${moneyINR(open.target)}
      <span class="stop">SL ${moneyINR(open.stop)}</span>
      <span class="stop">Entry ${moneyINR(open.entryPrice)}</span>
      <span class="stop">Net P&L ${pnl ? moneyINR(pnl.pnl) + ' (' + pnl.pnlPct + '%)' : '--'}</span>
      <span class="stop">Cost ${pnl ? moneyINR(pnl.charges) : '--'}</span>
    </div>`;
  }
  if (t.target == null) {
    console.debug(`[renderShortTargetCell] ${row.sym}: no target, data keys:`, Object.keys(t).slice(0, 8));
    return '<span style="color:var(--muted);font-size:12px">--</span>';
  }
  const up = t.target >= (t.price || row.data?.price || 0);
  const col = up ? 'var(--green)' : 'var(--red)';
  const size = getPositionSize(t);
  const cost = getTradeCostContext(row, t);
  return `<div class="target-cell short-term" style="color:${col}">
    Rs ${Number(t.target).toLocaleString('en-IN',{maximumFractionDigits:2})}
    <span class="stop">SL Rs ${Number(t.stop).toLocaleString('en-IN',{maximumFractionDigits:2})}</span>
    <span class="stop">R:R ${t.rr ?? '--'}</span>
    <span class="stop">Cost ${cost ? cost.costPct + '%' : '--'} · Net ${cost ? cost.netPct + '%' : '--'}</span>
    <span class="stop">Qty ${size ? size.qty : '--'} @${TRADE_RISK_PCT}%</span>
  </div>`;
}

function healthHTML(data){
  if(!data) return '<span style="color:var(--muted);font-size:11px">N/A</span>';
  const chg=data.change||0,h52=data.high52||0,l52=data.low52||0,price=data.price||0;
  const rng=h52-l52||1;
  const rPct=Math.max(0,Math.min(100,((price-l52)/rng)*100));
  const mPct=Math.max(0,Math.min(100,50+chg*5));
  const rCol=rPct>70?'var(--green)':rPct>40?'var(--yellow)':'var(--red)';
  const mCol=mPct>60?'var(--green)':mPct>40?'var(--yellow)':'var(--red)';
  return `<div class="health-cell"><div class="health-bar-wrap"><span class="health-label">52W</span><div class="health-bar"><div class="health-fill" style="width:${rPct}%;background:${rCol}"></div></div></div><div class="health-bar-wrap"><span class="health-label">Mom</span><div class="health-bar"><div class="health-fill" style="width:${mPct}%;background:${mCol}"></div></div></div></div>`;
}

function getHealthScore(sym){
  const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || null;
  return computeHealthScore(asset);
}

const SETUP_FILTER_KEYS = new Set(['setup_pullback', 'setup_runner', 'setup_short']);
const SETUP_CARD_FILTERS = {
  pullbacks: ['tradeable', 'setup_pullback'],
  runners: ['triggered', 'setup_runner'],
  shorts: ['sell', 'setup_short'],
  neartrigger: ['neartrigger', 'hideavoid'],
};

function selectSetupCard(kind, ...filterModes) {
  if (activeSetupCard === kind) {
    // Second click — deselect and reset
    activeSetupCard = null;
    stockFilters.clear();
    document.querySelectorAll('#controls-bar .filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('filter-all');
    if (allBtn) allBtn.classList.add('active');
    renderTable();
    return false; // signal: don't apply filters
  }
  // Preserve non-card filters while dropping previous card's preset filters.
  const prevCard = activeSetupCard;
  const prevPreset = new Set(SETUP_CARD_FILTERS[prevCard] || []);
  const preserved = new Set([...stockFilters].filter(f => !prevPreset.has(f) && !SETUP_FILTER_KEYS.has(f) && !filterModes.includes(f)));
  activeSetupCard = kind;
  stockFilters.clear();
  for (const mode of filterModes) stockFilters.add(mode);
  for (const mode of preserved) stockFilters.add(mode);
  if (kind === 'pullbacks') stockFilters.add('tradeable');
  // Force sort by score: shorts ascending (most negative first), all others descending
  if (kind === 'shorts') {
    currentSort = { col: 'trade', dir: 1 };
  } else if (kind) {
    currentSort = { col: 'trade', dir: -1 };
  }
  renderTable();
  return true;
}

function setFilter(mode, el) {
  if (mode === 'all') {
    // "All" clears every active filter
    stockFilters.clear();
    activeSetupCard = null;
    document.querySelectorAll('#controls-bar .filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('filter-all');
    if (allBtn) allBtn.classList.add('active');
  } else {
    // Toggle: second click deselects
    if (stockFilters.has(mode)) {
      stockFilters.delete(mode);
      if (el) el.classList.remove('active');
    } else {
      stockFilters.add(mode);
      if (el) el.classList.add('active');
    }
    // Keep setup card selection active so users can layer additional filters (AND across groups).
    // Selection resets on card toggle/off or when "All" is chosen.
    // "All" button is active only when nothing else is selected
    const allBtn = document.getElementById('filter-all');
    if (allBtn) allBtn.classList.toggle('active', stockFilters.size === 0);
  }
  renderTable();
}

function setTargetFilter(mode, el){
  targetFilter = mode || 'all';
  document.querySelectorAll('.target-filter-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  renderTable();
  //renderETFSection();
}

function getTargetDeltaPct(row){
  const sym = row.sym;
  const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const target = asset?.fund?.priceTarget ?? null;
  const price = row.data?.price ?? null;
  if(target==null || !price) return null;
  return ((target - price)/price)*100;
}

let etfSectorFilter = '';

function setETFSectorFilter(sector) {
  etfSectorFilter = sector;
  renderETFSection();
}

function populateETFSectorDropdown() {
  const sel = document.getElementById('etf-sector-select');
  if (!sel) return;
  const sectors = [...new Set(ETF_ASSETS.map(e => e.sector || 'Other'))].sort();
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Sectors</option>' +
    sectors.map(s => `<option value="${s}"${s===prev?' selected':''}>${s}</option>`).join('');
}

function setETFFilter(mode, el) {
  if (mode === 'all') {
    // "All" clears every active filter
    etfFilters.clear();
    document.querySelectorAll('#etf-controls-bar .filter-btn').forEach(b => b.classList.remove('active'));
  } else {
    // Toggle: second click deselects
    if (etfFilters.has(mode)) {
      etfFilters.delete(mode);
      if (el) el.classList.remove('active');
    } else {
      etfFilters.add(mode);
      if (el) el.classList.add('active');
    }
    // Keep "All" button un-highlighted whenever any specific filter is active
    const allBtn = document.querySelector('#etf-controls-bar .filter-btn[onclick*="\'all\'"]');
    if (allBtn) allBtn.classList.remove('active');
  }
  renderETFSection();
}

function setETFSearch(value){
  etfSearch = String(value || '').trim().toLowerCase();
  renderETFSection();
}

function etfSortBy(col){
  if(etfSort.col===col) etfSort.dir *= -1;
  else { etfSort.col = col; etfSort.dir = -1; }
  renderETFSection();
}

const DASHBOARD_ROUTE = window.__DASHBOARD_ROUTE__ || {};
let currentView = DASHBOARD_ROUTE.view === 'etfs' ? 'etfs' : 'stocks';
async function setView(view, el){
  currentView = view;
  document.querySelectorAll('#main-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  const sc = document.getElementById('stock-content'); if(sc) sc.style.display = view==='stocks' ? 'block' : 'none';
  const es = document.getElementById('etf-section'); if(es) es.style.display = view==='etfs' ? 'block' : 'none';
  if(view==='etfs'){
    await loadPresetETFs(); // no-op if already loaded
    populateETFSectorDropdown();
    renderETFSection();
    syncETFScrollSizing();
    scheduleWork(async () => {
      const syms = ETF_ASSETS.map(e=>e.sym);
      await fetchAdditionalSymbols(syms, { force: true }).catch(e => console.warn('ETF price refresh failed', e.message));
      renderETFSection();
      fetchIntradaySignals(syms).catch(e=>console.warn('ETF intraday signals failed', e.message));
      fetchETFSummary(syms).catch(e=>console.warn('ETF summary failed',e));
      fetchSparklines(syms).catch(e=>console.warn('fetchSparklines failed', e.message));
    }, 100);
  } else renderTable();
}

function clearSectors(){
  activeSectors = new Set();
  const pillEl = document.getElementById('sector-pill');
  if(pillEl) pillEl.style.display='none';
  renderSectors();
  renderTable();
}

function sortBy(col){
  if(currentSort.col===col)currentSort.dir*=-1;
  else{currentSort.col=col;currentSort.dir=-1;}
  renderTable();
}

let lastAppliedStockSearch = '';
function getStockSearchValue() {
  const raw = document.getElementById('search-box')?.value || '';
  const value = raw.trim().toLowerCase();
  return value.length === 0 || value.length >= 3 ? value : lastAppliedStockSearch;
}

function handleStockSearchInput(input) {
  const value = String(input?.value || '').trim().toLowerCase();
  if (input) input.classList.toggle('search-too-short', value.length > 0 && value.length < 3);
  if (value.length > 0 && value.length < 3) return;
  if (value === lastAppliedStockSearch) return;
  lastAppliedStockSearch = value;
  renderTable();
}

function getAllStockRows() {
  return [
    ...MIDCAP_STOCKS.map((s,i)=>({...s,rank:i+1,data:stockData[s.sym]||null})),
    ...STOCK_ASSETS.map((s,i)=>({...s,rank:MIDCAP_STOCKS.length+i+1,data:stockData[s.sym]||null}))
  ];
}

function hasEventRiskForSymbol(sym) {
  const symbol = String(sym || '').toUpperCase();
  if (Array.isArray(freshNewsSummary.symbols)) return freshNewsSummary.symbols.includes(symbol);
  return (freshNewsSummary.items || []).some(item => item.symbol === symbol);
}

function getStockFilterFns() {
  const hasFreshIntraday = r => {
    const t = intradayData[r.sym];
    return !!t && !getIntradayFreshness(t).stale;
  };
  const setupType = r => {
    const t = intradayData[r.sym];
    if (!t) return '';
    const score = adjustedTradeScore(r);
    const guard = getRiskGuard(r, t, score);
    return getSetupType(r, t, guard);
  };
  return {
    favorite: r => isStockFavorite(r.sym),
    buy:      r => getSignal(r, r.data) === 'buy',
    watch:    r => getSignal(r, r.data) === 'watch',
    sell:     r => getSignal(r, r.data) === 'sell',
    strong:   r => { const s = getHealthScore(r.sym); return s != null && s >= 80; },
    fair:     r => { const s = getHealthScore(r.sym); return s != null && s >= 50 && s < 80; },
    weak:     r => { const s = getHealthScore(r.sym); return s != null && s < 50; },
    large:    r => r.cap === 'large',
    mid:      r => r.cap === 'mid',
    gainers:  r => (r.data?.change || 0) > 0,
    losers:   r => (r.data?.change || 0) < 0,
    opentrade:r => !!getOpenPaperTrade(r.sym),
    tradeable:r => { const t = intradayData[r.sym]; if(!t) return false; const g = getRiskGuard(r, t, adjustedTradeScore(r)); return ['ok','small'].includes(g.level); },
    risk:     r => { const t = intradayData[r.sym]; if(!t) return false; const g = getRiskGuard(r, t, adjustedTradeScore(r)); return ['avoid','invalid','chasing'].includes(g.level); },
    hideavoid:r => { const t = intradayData[r.sym]; if(!t) return true; const g = getRiskGuard(r, t, adjustedTradeScore(r)); return !['avoid','invalid','chasing'].includes(g.level); },
    triggered:r => intradayData[r.sym]?.entryStatus === 'Triggered' && hasFreshIntraday(r),
    neartrigger:r => intradayData[r.sym]?.entryStatus === 'Near trigger' && hasFreshIntraday(r),
    newsrisk: r => hasEventRiskForSymbol(r.sym),
    setup_pullback: r => setupType(r) === 'VWAP_PULLBACK_OR_HOLD',
    setup_runner: r => ['VOLUME_SHOCK_BREAKOUT', 'MOMENTUM_RUNNER', 'VWAP_TREND_CONTINUATION', 'FRESH_BREAKOUT'].includes(setupType(r)),
    setup_short: r => ['VWAP_REJECTION', 'BREAKDOWN', 'SHORT_MOMENTUM'].includes(setupType(r)),
  };
}

function getStockFilterGroups() {
  return [
    ['large', 'mid'],            // cap    - OR within group
    ['buy', 'sell', 'watch'],    // signal - OR within group
    ['strong', 'fair', 'weak'],  // health - OR within group
    ['gainers', 'losers'],       // movement - OR within group
    ['tradeable', 'hideavoid', 'risk'],
    ['triggered', 'neartrigger'],
    ['setup_pullback', 'setup_runner', 'setup_short'],
    ['favorite'],                // standalone
    ['opentrade'],               // standalone
    ['newsrisk'],                // standalone
  ];
}

function applyStockFilters(rows, filters = stockFilters) {
  const activeFilters = filters instanceof Set ? filters : new Set(filters || []);
  if (!activeFilters.size) return rows;
  const filterFns = getStockFilterFns();
  const stockGroups = getStockFilterGroups();
  return rows.filter(r =>
    stockGroups.every(group => {
      const active = group.filter(f => activeFilters.has(f));
      return !active.length || active.some(f => filterFns[f]?.(r) ?? true);
    })
  );
}

function countRowsForStockFilters(rows, ...modes) {
  return applyStockFilters(rows, new Set(modes.filter(Boolean))).length;
}

function freshNewsUniverse() {
  return getAllStockRows().map(row => ({
    symbol:row.sym,
    name:row.name || row.sym,
    assetType:'stock',
  }));
}

async function loadFreshNewsSummary(force = false, opts = {}) {
  if (freshNewsBusy) return freshNewsSummary;
  const now = Date.now();
  const requestedOffset = Math.max(0, Number(opts.offset ?? freshNewsOffset) || 0);
  const pageChanged = requestedOffset !== freshNewsOffset;
  if (!force && !pageChanged && freshNewsSummary.loaded && (now - freshNewsLastFetchAt) < 15 * 60 * 1000) return freshNewsSummary;
  freshNewsOffset = requestedOffset;
  freshNewsBusy = true;
  freshNewsSummary = { ...freshNewsSummary, loading:true, error:'' };
  renderSetupCards(getAllStockRows());
  renderFreshNewsModal();
  try {
    const res = await fetch(FRESH_STOCK_NEWS_ENDPOINT, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ symbols:freshNewsUniverse(), maxSymbols:260, limit:FRESH_NEWS_PAGE_SIZE, offset:freshNewsOffset }),
      signal:AbortSignal.timeout(90000),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `fresh-news HTTP ${res.status}`);
    freshNewsSummary = {
      loading:false,
      loaded:true,
      date:payload.date || null,
      count:Number(payload.count) || 0,
      symbolCount:Number(payload.symbolCount) || 0,
      scanned:Number(payload.scanned) || 0,
      limit:Number(payload.limit) || FRESH_NEWS_PAGE_SIZE,
      offset:Number(payload.offset) || 0,
      returned:Number(payload.returned) || 0,
      hasPrev:!!payload.hasPrev,
      hasNext:!!payload.hasNext,
      symbols:Array.isArray(payload.symbols) ? payload.symbols.map(s => String(s).toUpperCase()) : [],
      impactBySymbol:payload.impactBySymbol && typeof payload.impactBySymbol === 'object' ? payload.impactBySymbol : {},
      items:Array.isArray(payload.items) ? payload.items : [],
      errors:Array.isArray(payload.errors) ? payload.errors : [],
      error:'',
    };
    freshNewsLastFetchAt = Date.now();
  } catch (e) {
    freshNewsSummary = { ...freshNewsSummary, loading:false, loaded:true, error:e.message || String(e) };
  } finally {
    freshNewsBusy = false;
    renderSetupCards(getAllStockRows());
    renderTable();
    if (document.getElementById('fresh-news-modal')?.style.display === 'flex') renderFreshNewsModal();
  }
  return freshNewsSummary;
}

function renderFreshNewsModal() {
  const body = document.getElementById('fresh-news-modal-body');
  if (!body) return;
  const rows = (freshNewsSummary.items || []).map(item => {
    const verdict = item.resultVerdict ? `<span class="result-badge ${escapeHTML(String(item.resultVerdict).toLowerCase())}" title="${escapeHTML(item.resultVerdictReason || '')}">${escapeHTML(item.resultVerdict)}</span>` : '';
    const sentiment = String(item.newsSentiment || 'Neutral').toLowerCase();
    const impactLabel = item.newsSentiment || 'Neutral';
    const impactScore = Number(item.tradeImpactScore || 0);
    const impactTitle = item.tradeImpactReason || 'Trade impact label';
    const impact = `<span class="news-impact-badge ${escapeHTML(sentiment)}" title="${escapeHTML(impactTitle)}">${escapeHTML(impactLabel)} ${impactScore > 0 ? '+' : ''}${impactScore}</span>`;
    const title = item.url
      ? `<a href="${escapeHTML(item.url)}" target="_blank" rel="noopener">${escapeHTML(item.title || 'News')}</a>`
      : escapeHTML(item.title || 'News');
    return `<tr>
      <td>${escapeHTML(item.symbol || '--')}</td>
      <td>${escapeHTML(item.type || '--')}</td>
      <td>${impact}</td>
      <td class="fresh-news-title">${title}${verdict}</td>
      <td>${escapeHTML(item.source || '--')}</td>
      <td>${escapeHTML(formatNewsDate(item.publishedAt) || item.dateKey || '--')}</td>
    </tr>`;
  }).join('');
  const status = freshNewsSummary.loading
    ? 'Scanning proxy news sources...'
    : freshNewsSummary.error
      ? `Error: ${freshNewsSummary.error}`
      : `${freshNewsSummary.symbolCount || 0} stocks with fresh news, ${freshNewsSummary.count || 0} items, ${freshNewsSummary.scanned || 0} scanned`;
  const limit = Number(freshNewsSummary.limit || FRESH_NEWS_PAGE_SIZE);
  const offset = Number(freshNewsSummary.offset || freshNewsOffset || 0);
  const start = freshNewsSummary.count ? offset + 1 : 0;
  const end = Math.min(offset + (freshNewsSummary.items || []).length, freshNewsSummary.count || 0);
  const pageText = freshNewsSummary.loading ? 'Loading...' : `${start}-${end} of ${freshNewsSummary.count || 0}`;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const pager = `
    <div class="fresh-news-pager">
      <span>${escapeHTML(pageText)}</span>
      <button class="icon-btn" title="Previous news page" ${freshNewsSummary.hasPrev ? '' : 'disabled'} onclick="changeFreshNewsPage(${prevOffset})">‹</button>
      <button class="icon-btn" title="Next news page" ${freshNewsSummary.hasNext ? '' : 'disabled'} onclick="changeFreshNewsPage(${nextOffset})">›</button>
    </div>`;
  body.innerHTML = `
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Date</div><div class="value">${escapeHTML(freshNewsSummary.date || '--')}</div></div>
      <div class="portfolio-card"><div class="label">Stocks</div><div class="value">${freshNewsSummary.symbolCount || 0}</div></div>
      <div class="portfolio-card"><div class="label">Items</div><div class="value">${freshNewsSummary.count || 0}</div></div>
      <div class="portfolio-card"><div class="label">Status</div><div class="value ${freshNewsSummary.error ? 'down' : ''}">${escapeHTML(status)}</div></div>
    </div>
    <div class="portfolio-section-title fresh-news-titlebar"><span>Today / Last Business Day News</span>${pager}</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table fresh-news-table">
        <thead><tr><th>Symbol</th><th>Type</th><th>Impact</th><th>News</th><th>Source</th><th>Date</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:16px">${freshNewsSummary.loading ? 'Loading fresh news...' : 'No fresh news found for selected date'}</td></tr>`}</tbody>
      </table>
    </div>
    ${freshNewsSummary.errors?.length ? `<div class="replay-note" style="margin-top:10px;color:var(--muted)">Some symbols failed: ${escapeHTML(freshNewsSummary.errors.slice(0, 3).join(' | '))}</div>` : ''}
  `;
}

function changeFreshNewsPage(offset) {
  loadFreshNewsSummary(true, { offset:Math.max(0, Number(offset) || 0) }).catch(e => console.warn('fresh news page failed', e.message));
}

function openFreshNewsModal() {
  renderFreshNewsModal();
  const modal = document.getElementById('fresh-news-modal');
  if (modal) modal.style.display = 'flex';
  loadFreshNewsSummary(false).catch(e => console.warn('fresh news refresh failed', e.message));
}

function closeFreshNewsModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('fresh-news-modal');
  if (modal) modal.style.display = 'none';
}

function renderSetupCards(rows = getAllStockRows()) {
  const target = document.getElementById('setup-card-row');
  if (!target) return;
  // Counts run through the exact same grouped filter engine as table clicks.
  const counts = {
    pullbacks: countRowsForStockFilters(rows, 'tradeable', 'setup_pullback'),
    runners:   countRowsForStockFilters(rows, 'triggered', 'setup_runner'),
    shorts:    countRowsForStockFilters(rows, 'sell', 'setup_short'),
    neartrigger: countRowsForStockFilters(rows, 'neartrigger', 'hideavoid'),
    news:      freshNewsSummary.loading ? '...' : (freshNewsSummary.symbolCount || 0),
  };
  const cards = [
    ['pullbacks', 'Best Pullbacks',    counts.pullbacks, 'Tradable VWAP pullback/hold',   "selectSetupCard('pullbacks','tradeable','setup_pullback')"],
    ['runners',   'Momentum Runners',  counts.runners,   'Triggered breakout/momentum',    "selectSetupCard('runners','triggered','setup_runner')"],
    ['shorts',    'Short Setups',      counts.shorts,    'Sell-side breakdown/rejection',  "selectSetupCard('shorts','sell','setup_short')"],
    ['neartrigger', 'Near Trigger',    counts.neartrigger, 'Fresh near-entry on both sides', "selectSetupCard('neartrigger','neartrigger','hideavoid')"],
    ['news',      'Fresh News',        counts.news,      freshNewsSummary.date ? `Server scan ${freshNewsSummary.date}` : 'Today / last business day', "selectSetupCard(null);openFreshNewsModal()"],
  ];
  target.innerHTML = cards.map(([kind, label, value, hint, action]) => `
    <button class="setup-card ${escapeHTML(kind)}${activeSetupCard === kind ? ' active' : ''}" type="button" onclick="${action}">
      <div class="label">${escapeHTML(label)}</div>
      <div class="value">${escapeHTML(String(value))}</div>
      <div class="hint">${escapeHTML(hint)}</div>
    </button>
  `).join('');
  if (dataSource && !freshNewsBusy && (!freshNewsSummary.loaded || (Date.now() - freshNewsLastFetchAt) > 15 * 60 * 1000)) {
    setTimeout(() => loadFreshNewsSummary(false).catch(e => console.warn('fresh news refresh failed', e.message)), 200);
  }
}

function renderTable(options = {}) {
  if (options?.immediate) {
    tableRenderScheduled = false;
    tableRenderPending = false;
    return renderTableNow();
  }
  if (tableRenderScheduled) {
    tableRenderPending = true;
    return;
  }
  tableRenderScheduled = true;
  requestAnimationFrame(() => {
    tableRenderScheduled = false;
    tableRenderPending = false;
    renderTableNow();
  });
}

function renderTableNow(){
  const search=getStockSearchValue();
  let rows=getAllStockRows();
  const totalRows = rows.length;

  // ── Sector filter (from heatmap click) ──────────────────
  if(activeSectors.size) rows = rows.filter(r => activeSectors.has(r.sector));

  // ── Search ───────────────────────────────────────────────
  if(search) rows=rows.filter(r=>r.sym.toLowerCase().includes(search)||r.name.toLowerCase().includes(search)||r.sector.toLowerCase().includes(search));

  // ── Target filters (price target delta filters)
  if(targetFilter && targetFilter!=='all'){
    rows = rows.filter(r => {
      const pct = getTargetDeltaPct(r);
      if(pct == null) return false;
      if(targetFilter === 'has') return true;
      if(targetFilter === 'up5') return pct >= 5;
      if(targetFilter === 'up10') return pct >= 10;
      if(targetFilter === 'down5') return pct <= -5;
      return true;
    });
  }

  // Setup card counts reflect current sector/search/target context
  renderSetupCards(rows);

  // ── Cap / signal filters — multi-select AND logic ───────────
  if (stockFilters.size) {
    rows = applyStockFilters(rows);
  }

  // ── Sector active pill ───────────────────────────────────
  let pillEl = document.getElementById('sector-pill');
  if(activeSectors.size){
    if(!pillEl){
      pillEl=document.createElement('div');
      pillEl.id='sector-pill';
      pillEl.style.cssText='display:inline-flex;align-items:center;gap:8px;padding:5px 12px;background:rgba(0,212,170,.12);border:1px solid rgba(0,212,170,.3);border-radius:20px;font-size:12px;color:var(--accent);margin-bottom:12px;';
      document.getElementById('stats-row').before(pillEl);
    }
    const names = Array.from(activeSectors).join(', ');
    pillEl.innerHTML=`<span>Sectors: <strong>${names}</strong> (${rows.length} stocks)</span><span onclick="clearSectors()" style="cursor:pointer;font-size:14px;opacity:.7;line-height:1" title="Clear sector filters">✕</span>`;
    pillEl.style.display='inline-flex';
  } else {
    if(pillEl) pillEl.style.display='none';
  }
  // When a setup card is active, always sort by score (highest first for runners/pullbacks, lowest first for shorts)
  const sortOverride = activeSetupCard === 'pullbacks'
    ? { col: 'trade', dir: -1 }
    : activeSetupCard
      ? { col: 'trade', dir: activeSetupCard === 'shorts' ? 1 : -1 }
      : null;
  const{col,dir} = sortOverride || currentSort;
  rows.sort((a,b)=>{
    let av,bv;
    if(col==='symbol'){av=a.sym;bv=b.sym;}else if(col==='sector'){av=a.sector;bv=b.sector;}
    else if(col==='price'){av=a.data?.price||0;bv=b.data?.price||0;}
    else if(col==='target'){ av=getTargetDeltaPct(a) ?? -999; bv=getTargetDeltaPct(b) ?? -999; }
    else if(col==='trade'){av=adjustedTradeScore(a);bv=adjustedTradeScore(b);}
    else if(col==='sttarget'){av=getTradeCostContext(a, intradayData[a.sym])?.netPct ?? -999;bv=getTradeCostContext(b, intradayData[b.sym])?.netPct ?? -999;}
    else if(col==='change'){av=a.data?.change||0;bv=b.data?.change||0;}
    else if(col==='volume'){av=a.data?.volume||0;bv=b.data?.volume||0;}
    else if(col==='health'){av=getHealthScore(a.sym)??-1;bv=getHealthScore(b.sym)??-1;}
    else{av=a.rank;bv=b.rank;}
    return typeof av==='string'?dir*av.localeCompare(bv):dir*(av-bv);
  });

  const allD=[...MIDCAP_STOCKS.map(s=>stockData[s.sym]), ...STOCK_ASSETS.map(s=>stockData[s.sym])].filter(Boolean);
  document.getElementById('stat-gainers').textContent=allD.filter(d=>(d.change||0)>0).length+' gainers';
  document.getElementById('stat-losers').textContent=allD.filter(d=>(d.change||0)<0).length+' losers';
  document.getElementById('stat-signals').textContent=[...MIDCAP_STOCKS, ...STOCK_ASSETS].filter(s=>getSignal(s,stockData[s.sym])==='buy').length+' buy signals';
  const filterActive = stockFilters.size > 0 || activeSectors.size > 0 || !!search || (targetFilter && targetFilter !== 'all');
  const filteredEl = document.getElementById('stat-filtered');
  if (filteredEl) filteredEl.textContent = filterActive ? `${rows.length}/${totalRows} shown` : `${totalRows} stocks`;

  const tbody=document.getElementById('stock-tbody');
  if(!rows.length){tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--muted)">No stocks match</td></tr>';return;}
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  if (rows.length > 0 && Object.keys(intradayData).length === 0) {
    console.warn(`[renderTableNow] ${rows.length} rows to render but intradayData is EMPTY!`);
  }
  const rowsHTML = rows.map(row => {
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d);
    return `
    <tr>
      <td data-label=""><button class="fav-btn ${isStockFavorite(row.sym)?'active':''}" onclick="toggleStockFavorite('${row.sym}', event)">${isStockFavorite(row.sym)?'★':'☆'}</button></td>
      <td data-label="Stock" data-open-symbol="${escapeHTML(row.sym)}" onclick="openFundModal('${escapeHTML(row.sym)}')" style="cursor:pointer"><div class="stock-name-cell" title="Open stock details"><button class="stock-name-link" type="button" data-open-symbol="${escapeHTML(row.sym)}"><span class="stock-symbol">${escapeHTML(row.sym)}</span><span class="stock-fullname">${escapeHTML(row.name)}</span></button>${STOCK_EXTRA_SYMBOLS.includes(row.sym)?'<button class="stock-edit-btn" onclick="event.stopPropagation();openStockMetadataModal(\''+escapeHTML(row.sym)+'\')">edit</button>':''}</div></td>
      <td data-label="Sector"><div class="sector-cell"><span class="sector-badge">${escapeHTML(row.sector)}</span><span class="sector-badge cap-badge" style="background:${row.cap==='large'?'rgba(14,165,233,.15)':row.cap==='mid'?'rgba(167,139,250,.15)':row.cap==='etf'?'rgba(167,139,250,.06)':'rgba(167,139,250,.06)'};color:${row.cap==='large'?'var(--accent2)':row.cap==='mid'?'var(--accent3)':row.cap==='etf'?'var(--muted)':'var(--muted)'}">${row.cap==='large'?'L-Cap':row.cap==='mid'?'M-Cap':row.cap==='etf'?'ETF':'Custom'}</span></div></td>
      <td data-label="Price" class="price-cell"><div class="price-stack"><span>${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</span><span class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</span><span class="range-mini">${d&&d.low52&&d.high52?'52W ₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+'–₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'52W --'}</span></div></td>
      <td data-label="Volume" class="hide-mobile hide-1200" style="font-size:12px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td data-label="Trade">${renderTradeCell(row)}</td>
      <td data-label="ST Target">${renderShortTargetCell(row)}</td>
      <td data-label="Health"><div class="health-stack">${renderHealthCell(row)}${renderNewsImpactHealthBadge(row.sym)}${renderResultVerdictBadge(row.sym)}</div></td>
      <td data-label="Trend"><div class="spark">${d?sparkBars(row.sym,chg):'<span style="color:var(--muted);font-size:11px">--</span>'}</div></td>
      <td data-label="Signal"><span class="signal-badge ${sig}">${sigLabels[sig]}</span></td>
	   <td data-label="Target" class="target-cell">${renderTargetCell(row)}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rowsHTML;
  scheduleVisibleEventFlags(rows);
  renderTopActionBar();
  syncStockScrollSizing();
  applyColumnPreset();
}

// Compute an overall health score (0-100) from fundamentals
function normPercent(v){ if(v==null) return null; return (Math.abs(v) <= 1) ? v*100 : v; }
function computeHealthScore(asset){
  // Do not compute health for ETFs
  if(!asset || asset.cap === 'etf' || !asset.fund || !asset.fund.computed) return null;
  const c = asset.fund.computed;
  const eps = c.eps; const pe = c.pe; const roe = normPercent(c.roe); const de = c.de; const peg = c.peg;
  let score = 0;
  if(typeof eps === 'number' && eps > 0) score += 20;
  if(typeof pe === 'number' && pe > 0){ if(pe <= 15) score += 20; else if(pe <= 25) score += 10; }
  if(typeof roe === 'number'){ if(roe >= 20) score += 20; else if(roe >= 10) score += 10; }
  if(typeof de === 'number'){ if(de < 1) score += 20; else if(de < 2) score += 10; }
  if(typeof peg === 'number' && peg > 0){ if(peg <= 2) score += 20; else if(peg <= 4) score += 10; }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderHealthCell(row){
  const sym = row.sym;
  let asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;

  // ETFs: show the 52W / momentum bars instead
  if(asset?.cap === 'etf') return healthHTML(row.data);

  const score = computeHealthScore(asset);

  if(score == null){
    // Fundamentals not yet loaded — show a grey loading button that's still clickable
    return `<button onclick="openFundModal('${sym}')" title="Fundamentals loading…"
      style="background:var(--dim);border:none;padding:6px 10px;border-radius:8px;
             color:var(--muted);font-size:11px;cursor:pointer;white-space:nowrap;">
      ⏳ …
    </button>`;
  }

  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Fair' : 'Weak';
  return `<button onclick="openFundModal('${sym}')" title="Health score ${score}/100 — click to view fundamentals"
    style="background:${color};border:none;padding:5px 10px;border-radius:8px;
           color:var(--bg);font-weight:700;cursor:pointer;font-size:12px;
           display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">
    <span>${score}</span><span style="font-weight:400;font-size:10px;opacity:.8">${label}</span>
  </button>`;
}

function renderTargetCell(row){
  const sym = row.sym;
  let asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const f = asset?.fund || {};
  const target = f.priceTarget ?? null;
  const price = row.data?.price ?? null;
  if(target==null) return '<span style="color:var(--muted);font-size:12px">--</span>';
  const pctRaw = (price && typeof price === 'number') ? Math.round(((target - price)/price)*100) : null;
  const pct = pctRaw == null ? null : Math.abs(pctRaw);
  const arrow = pctRaw == null ? '' : (pctRaw > 0 ? '▲' : (pctRaw < 0 ? '▼' : '–'));
  const col = pctRaw != null ? (pctRaw >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)';
  const txt = '₹' + Number(target).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:0});
  const pctHtml = pct != null ? `<span class="target-pct" style="color:${col}">${arrow}${pct}%</span>` : '<span class="target-pct muted">--</span>';
  return `<div class="target-stack"><span class="target-price">${txt}</span>${pctHtml}</div>`;
}

async function fetchAdditionalSymbols(symbols, opts = {}){
  // Default: fetch only missing/failed symbols. With force=true, refresh supplied
  // symbols even when we already have a valid price.
  const force = !!opts.force;
  const progressOffset = Number(opts.progressOffset) || 0;
  const progressTotal = Number(opts.progressTotal) || 0;
  const progressEnabled = progressTotal > 0;
  const toFetch = symbols.filter(sym => sym && (force || !stockData[sym] || !(stockData[sym].price > 0)));
  if(!toFetch.length) return;
  if(dataSource==='yahoo'){
    const BATCH = 25, PARALLEL = 3;
    const batches = [];
    for(let i = 0; i < toFetch.length; i += BATCH) batches.push(toFetch.slice(i, i + BATCH));
    let processed = 0;
    for(let i = 0; i < batches.length; i += PARALLEL){
      const chunk = batches.slice(i, i + PARALLEL);
      if (progressEnabled) {
        const start = Math.min(progressTotal, progressOffset + processed + 1);
        const end = Math.min(progressTotal, progressOffset + processed + chunk.reduce((sum, b) => sum + b.length, 0));
        showBgRefreshing(`Refreshing ${start}–${end} of ${progressTotal}…`);
      }
      await Promise.allSettled(chunk.map(async batch => {
        try {
          const r = await fetch(`${PROXY}/yahoo?symbols=${encodeURIComponent(batch.join(','))}`);
          const raw = await r.json().catch(()=>({}));
          const quotes = raw?.quotes || {};
          for(const sym of batch){
            const q = quotes[sym];
            if(q) {
              const prev = stockData[sym] || {};
              stockData[sym] = {
                price    : q.price    || prev.price    || 0,
                change   : (q.change  != null) ? q.change  : (prev.change  ?? 0),
                high52   : q.high52   || prev.high52   || 0,
                low52    : q.low52    || prev.low52    || 0,
                volume   : q.volume   || prev.volume   || 0,
                open     : q.open     || prev.open     || 0,
                prevClose: q.prevClose || prev.prevClose || 0,
              };
            }
          }
        } catch(e) { console.warn('fetchAdditionalSymbols yahoo batch failed', e.message); }
      }));
      processed += chunk.reduce((sum, b) => sum + b.length, 0);
    }
  } else if(dataSource==='nse'){
    // NSE rate-limits aggressively — keep sequential with a small delay
    for(let i = 0; i < toFetch.length; i++){
      const sym = toFetch[i];
      if (progressEnabled) {
        const pos = Math.min(progressTotal, progressOffset + i + 1);
        showBgRefreshing(`Refreshing ${pos} of ${progressTotal}…`);
      }
      try{
        const q = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(sym)}`);
        const pd = q.priceInfo||{};
        stockData[sym] = { price: parseFloat(pd.lastPrice||0), change: parseFloat(pd.pChange||0), high52: parseFloat(pd.weekHighLow?.max||0), low52: parseFloat(pd.weekHighLow?.min||0), volume: 0, open: parseFloat(pd.open||0), prevClose: parseFloat(pd.previousClose||0) };
      } catch(e){ console.warn('NSE add symbol fetch failed', sym, e); }
      await new Promise(r=>setTimeout(r, 120));
    }
  } else {
    toFetch.forEach(sym => stockData[sym] = { price:0, change:0 });
  }
}

// Applies a single ETF data record into the matching ETF asset and stockData
function applyETFData(sym, e) {
  const asset = ETF_ASSETS.find(s => s.sym === sym);
  if (!asset || !e) return;
  asset.etfData = asset.etfData || {};
  if (e.nav          != null && asset.etfData.nav     == null) asset.etfData.nav          = e.nav;
  if (e.premium      != null && asset.etfData.premium == null) asset.etfData.premium      = e.premium;
  if (e.expenseRatio != null) asset.etfData.expenseRatio = e.expenseRatio;
  if (e.category     != null) asset.etfData.category     = e.category;
  if (e.fundFamily   != null) asset.etfData.fundFamily   = e.fundFamily;
  if (e.ytdReturn       != null) asset.etfData.ytdReturn       = e.ytdReturn;
  if (e.oneMonthReturn  != null) asset.etfData.oneMonthReturn  = e.oneMonthReturn;
  if (e.oneYearReturn   != null) asset.etfData.oneYearReturn   = e.oneYearReturn;
  if (e.threeYearReturn != null) asset.etfData.threeYearReturn = e.threeYearReturn;
  if (e.fiveYearReturn  != null) asset.etfData.fiveYearReturn  = e.fiveYearReturn;
  if (e.high52 && stockData[sym] && !stockData[sym].high52) stockData[sym].high52 = e.high52;
  if (e.low52  && stockData[sym] && !stockData[sym].low52)  stockData[sym].low52  = e.low52;
}

function applyETFNavData(sym, e) {
  const asset = ETF_ASSETS.find(s => s.sym === sym);
  if (!e) return;
  if (asset) {
    asset.etfData = asset.etfData || {};
    if (e.nav      != null) asset.etfData.nav          = e.nav;
    asset.etfData.premium = e.navPremium != null ? e.navPremium : null;
    if (e.expRatio != null) asset.etfData.expenseRatio = e.expRatio;
    if (e.aum      != null) asset.etfData.aum          = e.aum;
  }
  if (e.price  != null) { stockData[sym] = stockData[sym] || {}; stockData[sym].price  = e.price; }
  if (e.volume != null) { stockData[sym] = stockData[sym] || {}; stockData[sym].volume = e.volume; }
  if (e.high52)         { stockData[sym] = stockData[sym] || {}; stockData[sym].high52 = e.high52; }
  if (e.low52)          { stockData[sym] = stockData[sym] || {}; stockData[sym].low52  = e.low52; }
}

// Fetch NAV + expense ratio for ETFs via SSE streaming
// Pass 1: /stream/etf-summary — flushes cache hits immediately, streams live fetches as they resolve
// Pass 2: /stream/etf-nav    — streams NAV/price/premium per symbol as each Yahoo fetch completes
async function fetchETFSummary(symbols) {
  if (!symbols || !symbols.length) return;
  console.log('[fetchETFSummary] called with', symbols.length, 'symbols, proxy:', PROXY);

  // ── Pass 1: summary (returns, expense ratio) via SSE ──
  const sumResult = await openSSEStream(
    `${PROXY}/stream/etf-summary?symbols=${encodeURIComponent(symbols.join(','))}`,
    (msg) => {
      if (msg.sym && msg.data) {
        applyETFData(msg.sym, msg.data);
        scheduleETFRender();
      }
    }
  );
  if (!sumResult.ok) {
    // Fallback: parallel batch requests
    console.warn('etf-summary SSE failed, falling back to batch:', sumResult.error);
    const CACHE_BATCH = 50;
    try {
      const batches = [];
      for (let i = 0; i < symbols.length; i += CACHE_BATCH) batches.push(symbols.slice(i, i + CACHE_BATCH));
      await Promise.all(batches.map(async batch => {
        try {
          const res = await fetch(`${PROXY}/etf-summary?symbols=${encodeURIComponent(batch.join(','))}`);
          if (!res.ok) return;
          const payload = await res.json().catch(() => null);
          for (const [sym, e] of Object.entries(payload?.etfs || {})) applyETFData(sym, e);
        } catch(e) { console.warn('fetchETFSummary batch fallback failed', e.message); }
      }));
      renderETFSection();
    } catch(e) { console.warn('fetchETFSummary cache pass failed', e.message); }
  }

  // ── Pass 2: live NAV/price/premium via SSE ──
  const navResult = await openSSEStream(
    `${PROXY}/stream/etf-nav?symbols=${encodeURIComponent(symbols.join(','))}`,
    (msg) => {
      if (msg.sym && msg.data) {
        applyETFNavData(msg.sym, msg.data);
        scheduleETFRender();
      }
    }
  );
  if (!navResult.ok) {
    // Fallback: parallel batches
    console.warn('etf-nav SSE failed, falling back to batch:', navResult.error);
    const NAV_BATCH = 10, NAV_PARALLEL = 3;
    const navBatches = [];
    for (let i = 0; i < symbols.length; i += NAV_BATCH) navBatches.push(symbols.slice(i, i + NAV_BATCH));
    for (let i = 0; i < navBatches.length; i += NAV_PARALLEL) {
      await Promise.allSettled(navBatches.slice(i, i + NAV_PARALLEL).map(async batch => {
        try {
          const res = await fetch(`${PROXY}/etf-nav?symbols=${encodeURIComponent(batch.join(','))}`);
          if (!res.ok) return;
          const payload = await res.json().catch(() => null);
          for (const [sym, e] of Object.entries(payload?.etfs || {})) applyETFNavData(sym, e);
          scheduleETFRender();
        } catch(e) { console.warn('fetchETFSummary /etf-nav fallback failed', e.message); }
      }));
    }
  }
}


// ── ETF Holdings ─────────────────────────────────────────────────────────────
async function addCustomSymbol(){
  const input = document.getElementById('extra-symbol-input');
  if(!input) return;
  const sym = input.value.trim().toUpperCase();
  if(!sym) return;
  if (MIDCAP_STOCKS.some(s=>s.sym===sym) || ETF_ASSETS.some(s=>s.sym===sym) || EXTRA_SYMBOLS.includes(sym)) { input.value=''; alert('Symbol already present'); return; }
  EXTRA_SYMBOLS.push(sym);
  ETF_ASSETS.push({ sym: sym, name: sym, sector: 'ETF', cap: 'etf' });
  input.value='';
  await fetchAdditionalSymbols([sym]);
  await saveUserETFs();
  renderDashboard();
}

async function saveUserStocks() {
  // Build payload with metadata when available
  const payload = STOCK_EXTRA_SYMBOLS.map(sym => {
    const entry = STOCK_ASSETS.find(s => s.sym === sym) || { sym };
    return { sym: String(sym).trim().toUpperCase(), name: entry.name || sym, sector: entry.sector || null, cap: entry.cap || null };
  });
  saveSavedStocksToStorage(payload);
  try {
    await fetch(STOCK_PREFS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('Stock prefs save failed:', e.message);
  }
}

async function addCustomStockSymbol(){
  const input = document.getElementById('stock-symbol-input');
  if(!input) return;
  const sym = input.value.trim().toUpperCase();
  if(!sym) return;
  if (MIDCAP_STOCKS.some(s=>s.sym===sym) || STOCK_ASSETS.some(s=>s.sym===sym) || STOCK_EXTRA_SYMBOLS.includes(sym)) { input.value=''; alert('Symbol already present'); return; }
  STOCK_EXTRA_SYMBOLS.push(sym);
  STOCK_ASSETS.push({ sym, name: sym, sector: 'Custom', cap: 'custom' });
  input.value='';
  if (dataSource) await fetchAdditionalSymbols([sym]);
  // Try to fetch sector + marketCap metadata and merge
  try{ await fetchSymbolMetadata([sym]); }catch(e){console.warn('metadata fetch failed',e);} 
  await saveUserStocks();
  renderDashboard();
}

// Applies a single metadata record into the matching asset object
function applyFundMeta(sym, m) {
  const asset = MIDCAP_STOCKS.find(s=>s.sym===sym)
             || STOCK_ASSETS.find(s=>s.sym===sym)
             || ETF_ASSETS.find(s=>s.sym===sym);
  if (!asset || !m) return;
  if (m.sector) { asset.fund = asset.fund || {}; asset.fund.yahooSector = m.sector; }
  asset.fund = asset.fund || {};
  asset.fund.marketCap = m.marketCap ?? asset.fund.marketCap ?? null;
  asset.fund.totalDebt = m.totalDebt ?? asset.fund.totalDebt ?? null;
  asset.fund.totalEquity = m.totalEquity ?? asset.fund.totalEquity ?? null;
  asset.fund.trailingEps = m.trailingEps ?? asset.fund.trailingEps ?? null;
  asset.fund.trailingPE = m.trailingPE ?? asset.fund.trailingPE ?? null;
  asset.fund.forwardPE = m.forwardPE ?? asset.fund.forwardPE ?? null;
  asset.fund.priceToBook = m.priceToBook ?? asset.fund.priceToBook ?? null;
  asset.fund.dividendYield = m.dividendYield ?? asset.fund.dividendYield ?? null;
  asset.fund.fiftyDayAvg = m.fiftyDayAvg ?? asset.fund.fiftyDayAvg ?? null;
  asset.fund.twoHundredDayAvg = m.twoHundredDayAvg ?? asset.fund.twoHundredDayAvg ?? null;
  asset.fund.roe = m.roe ?? asset.fund.roe ?? null;
  asset.fund.sharesOutstanding = m.sharesOutstanding ?? asset.fund.sharesOutstanding ?? null;
  asset.fund.epsGrowth = m.epsGrowth ?? asset.fund.epsGrowth ?? null;
  asset.fund.pegRaw = m.peg ?? asset.fund.pegRaw ?? null;
  asset.fund.priceTarget = m.priceTarget ?? asset.fund.priceTarget ?? null;
  const price = stockData[sym]?.price ?? null;
  const eps = asset.fund.trailingEps ?? null;
  asset.fund.computed = asset.fund.computed || {};
  asset.fund.computed.eps = eps;
  asset.fund.computed.pe = (price && eps) ? (price / eps) : (asset.fund.trailingPE ?? null);
  asset.fund.computed.roe = asset.fund.roe ?? null;
  const td = asset.fund.totalDebt, te = asset.fund.totalEquity;
  asset.fund.computed.de = (td != null && te != null && te !== 0) ? (td / te) : null;
  let peg = asset.fund.pegRaw ?? null;
  const g = asset.fund.epsGrowth ?? null;
  if (peg == null && g != null && asset.fund.computed.pe) {
    const growthPercent = (typeof g === 'number' && g > 1) ? g : (typeof g === 'number' ? g * 100 : null);
    peg = (growthPercent && typeof growthPercent === 'number') ? asset.fund.computed.pe / growthPercent : null;
  }
  asset.fund.computed.peg = peg;
}

// Fetch fundamentals for any symbols — works for MIDCAP_STOCKS, STOCK_ASSETS, ETF_ASSETS
// Uses SSE streaming so health scores and price targets appear as each symbol resolves,
// falling back to parallel batch requests if SSE is unavailable.
async function fetchSymbolMetadata(symbols){
  if(!symbols || !symbols.length) return;
  // Skip pure ETFs (cap==='etf') — fundamentals not meaningful for them
  symbols = symbols.filter(sym => {
    const etf = ETF_ASSETS.find(s => s.sym === sym);
    return !etf || etf.cap !== 'etf';
  });
  if(!symbols.length) return;

  const url = `${PROXY}/stream/yahoo-summary?symbols=${encodeURIComponent(symbols.join(','))}`;
  const result = await openSSEStream(url, (msg) => {
    if (msg.sym && msg.data) {
      applyFundMeta(msg.sym, msg.data);
      scheduleTableRender(); // debounced: renders as symbols trickle in
    }
  });

  if (!result.ok) {
    // SSE failed — fall back to parallel batches
    console.warn('yahoo-summary SSE failed, falling back to batch:', result.error);
    const BATCH = 20, PARALLEL = 3;
    const batches = [];
    for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));
    for (let i = 0; i < batches.length; i += PARALLEL) {
      await Promise.allSettled(batches.slice(i, i + PARALLEL).map(async batch => {
        try {
          const res = await fetch(`${PROXY}/yahoo/summary?symbols=${encodeURIComponent(batch.join(','))}`);
          if (!res.ok) return;
          const payload = await res.json().catch(()=>null);
          for (const [sym, m] of Object.entries(payload?.metas || {})) applyFundMeta(sym, m);
          renderTable();
        } catch(e) { console.warn('fetchSymbolMetadata batch failed', e); }
      }));
    }
  }
}

let editingStockSymbol = null;

function openStockMetadataModal(sym){
  if(!sym) return;
  const idx = STOCK_ASSETS.findIndex(s=>s.sym===sym);
  if(idx===-1) return;
  const cur = STOCK_ASSETS[idx];
  editingStockSymbol = sym;
  document.getElementById('meta-symbol').value = sym;
  document.getElementById('meta-sector').value = cur.sector || 'Custom';
  document.getElementById('meta-cap').value = cur.cap || 'custom';
  document.getElementById('stock-meta-modal').style.display = 'flex';
}

function closeStockMetaModal(event){
  if(event) event.stopPropagation();
  document.getElementById('stock-meta-modal').style.display = 'none';
  editingStockSymbol = null;
}

function saveStockMetadata(){
  if(!editingStockSymbol) return;
  const sector = document.getElementById('meta-sector').value.trim() || 'Custom';
  const cap = document.getElementById('meta-cap').value;
  const idx = STOCK_ASSETS.findIndex(s=>s.sym===editingStockSymbol);
  if(idx===-1) return closeStockMetaModal();
  STOCK_ASSETS[idx].sector = sector;
  STOCK_ASSETS[idx].cap = cap;
  saveUserStocks();
  closeStockMetaModal();
  renderDashboard();
}

function closeFundModal(event){ if(event) event.stopPropagation(); const m=document.getElementById('fund-modal'); if(m) m.style.display='none'; }

const stockNewsCache = {};
const stockEventFetchQueued = new Set();
let activeNewsKind = 'stock';

function escapeHTML(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function formatNewsDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function fmtCr(v) {
  return v == null ? '--' : 'Rs ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' cr';
}

function renderStockEvents(events) {
  const box = document.getElementById('stock-event-list');
  if (!box) return;
  if (!events || !events.length) {
    const emptyText = activeNewsKind === 'etf' ? 'No ETF announcement or distribution events found.' : 'No result/dividend events found.';
    box.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:2px 0 8px">${emptyText}</div>`;
    return;
  }
  box.innerHTML = events.slice(0, 4).map(ev => {
    const dateBits = [];
    if (ev.filingDate) dateBits.push('Filed ' + formatNewsDate(ev.filingDate));
    if (ev.toDate) dateBits.push('Quarter ended ' + formatNewsDate(ev.toDate));
    if (ev.exDate) dateBits.push('Ex-date ' + formatNewsDate(ev.exDate));
    if (ev.recordDate) dateBits.push('Record ' + formatNewsDate(ev.recordDate));
    if (ev.eventDate) dateBits.push('Meeting ' + formatNewsDate(ev.eventDate));
    const hasMetrics = [ev.revenueCr, ev.profitAfterTaxCr, ev.profitBeforeTaxCr, ev.eps].some(v => v != null);
    const verdict = ev.resultVerdict
      ? `<span class="result-badge ${String(ev.resultVerdict).toLowerCase()}" title="${escapeHTML(ev.resultVerdictReason || '')}">${escapeHTML(ev.resultVerdict)}</span>`
      : '';
    const metrics = ev.type === 'Results' && hasMetrics
      ? `<div class="stock-event-metrics">
          <span>Revenue ${fmtCr(ev.revenueCr)}</span>
          <span>PAT ${fmtCr(ev.profitAfterTaxCr)}</span>
          <span>PBT ${fmtCr(ev.profitBeforeTaxCr)}</span>
          <span>EPS ${ev.eps == null ? '--' : Number(ev.eps).toFixed(2)}</span>
        </div>`
      : '';
    return `<a class="stock-event-card" href="${escapeHTML(ev.url || '#')}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:var(--text)">
      <div class="stock-event-head">
        <div class="stock-event-title">${escapeHTML(ev.title || ev.type || 'Event')}</div>
        <div style="display:flex;align-items:center;gap:6px">${verdict}<div class="stock-event-type">${escapeHTML(ev.type || 'Event')}</div></div>
      </div>
      <div class="stock-event-meta">${escapeHTML(dateBits.join(' - ') || ev.source || 'NSE')}</div>
      ${metrics}
    </a>`;
  }).join('');
}

function renderStockNews(sym, items, events, fromCache) {
  renderStockEvents(events);
  const box = document.getElementById('stock-news-list');
  if (!box) return;
  if (!items || !items.length) {
    const emptyText = activeNewsKind === 'etf' ? 'No recent ETF news found.' : 'No recent news or exchange events found.';
    box.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:4px">${emptyText}</div>`;
    return;
  }
  box.innerHTML = items.slice(0, 12).map(item => {
    const date = formatNewsDate(item.publishedAt);
    const meta = [escapeHTML(item.source || 'News'), date].filter(Boolean).join(' - ');
    return `<a class="stock-news-item" href="${escapeHTML(item.url)}" target="_blank" rel="noopener">
      <div class="stock-news-title">${escapeHTML(item.title)}</div>
      <div class="stock-news-meta">
        <span class="stock-news-type">${escapeHTML(item.type || 'News')}</span>
        <span>${meta}${fromCache ? ' - cached' : ''}</span>
      </div>
    </a>`;
  }).join('');
}

async function loadReplayWhyMissed(sym) {
  const target = document.getElementById('replay-why-box');
  if (!target) return;
  const day = document.getElementById('replay-date-input')?.value || getTradeDateISO();
  target.innerHTML = `<div class="replay-note">Checking replay for ${escapeHTML(sym)} on ${escapeHTML(day)}...</div>`;
  try {
    const res = await fetch(`${SIM_REPLAY_WHY_ENDPOINT}?day=${encodeURIComponent(day)}&symbol=${encodeURIComponent(sym)}`, { signal:AbortSignal.timeout(REPLAY_FETCH_TIMEOUT_MS) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) throw new Error(payload.error || `why HTTP ${res.status}`);
    const traded = payload.traded || [];
    const rejected = payload.rejected || [];
    const tradedRows = traded.slice(0, 4).map(t => `<div class="replay-note">Traded ${escapeHTML(String(t.side || '').toUpperCase())} ${escapeHTML(t.setup || t.setupType || '--')} | ${moneyINR(replayTradeNet(t))} | ${escapeHTML(t.reason || '--')}</div>`).join('');
    const rejectedRows = rejected.slice(0, 4).map(r => `<div class="replay-note">Rejected ${escapeHTML(String(r.side || '').toUpperCase())} ${escapeHTML(r.setupType || '--')} | Score ${escapeHTML(r.score)} | ${escapeHTML(r.reason || '--')}</div>`).join('');
    const blockers = (payload.topReasons || []).slice(0, 5).map(r => `<span class="why-chip">${escapeHTML(r.reason)} (${r.count})</span>`).join('');
    const best = payload.best ? `<div class="replay-note">Best snapshot: ${escapeHTML(formatTradeDateTime(payload.best.at))} | ${escapeHTML(payload.best.setupType || '--')} | Score ${escapeHTML(payload.best.score)} | ${moneyINR(payload.best.price)}</div>` : '';
    const eligible = payload.firstEligible ? `<div class="replay-note">First eligible: ${escapeHTML(formatTradeDateTime(payload.firstEligible.at))} | ${escapeHTML(payload.firstEligible.setupType || '--')} | ${moneyINR(payload.firstEligible.price)}</div>` : '';
    const timeline = (payload.timeline || []).slice(-8).reverse().map(row => `<tr>
      <td>${escapeHTML(formatTradeDateTime(row.at))}</td>
      <td>${moneyINR(row.price)}</td>
      <td>${escapeHTML(String(row.side || '--').toUpperCase())}</td>
      <td>${escapeHTML(row.setupType || '--')}</td>
      <td>${escapeHTML(row.score)}</td>
      <td>${row.eligible ? '<span class="job-status done">yes</span>' : '<span class="job-status error">no</span>'}</td>
      <td class="replay-reason-cell">${escapeHTML((row.reasons || []).slice(0, 3).join(' | ') || '--')}</td>
    </tr>`).join('');
    target.innerHTML = `<div class="replay-note"><strong>${escapeHTML(payload.message || 'Replay checked.')}</strong></div>
      <div class="replay-note">Snapshots considered: ${escapeHTML(payload.considered || 0)}</div>
      ${best}${eligible}
      ${blockers ? `<div class="why-chip-row">${blockers}</div>` : ''}
      ${tradedRows}${rejectedRows || ''}
      <div class="portfolio-table-wrap"><table class="replay-table">
        <thead><tr><th>Time</th><th>Price</th><th>Side</th><th>Setup</th><th>Score</th><th>Eligible</th><th>Reasons</th></tr></thead>
        <tbody>${timeline || '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:10px">No timeline rows</td></tr>'}</tbody>
      </table></div>`;
  } catch (e) {
    target.innerHTML = `<div class="replay-note" style="color:var(--red)">Replay why failed: ${escapeHTML(e.message || String(e))}</div>`;
  }
}

async function loadStockNews(sym, name, assetType = 'stock') {
  const key = `${sym}|${assetType}|${name || ''}`;
  const cached = stockNewsCache[key];
  if (cached && (Date.now() - cached.savedAt) < 10 * 60 * 1000) {
    renderStockNews(sym, cached.news, cached.events, true);
    return;
  }
  const box = document.getElementById('stock-news-list');
  if (box) box.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:4px">Loading ${assetType === 'etf' ? 'ETF' : 'stock'} news, announcements and events...</div>`;
  try {
    const url = `${PROXY}/stock-news?symbol=${encodeURIComponent(sym)}&name=${encodeURIComponent(name || '')}&assetType=${encodeURIComponent(assetType)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error('stock-news HTTP ' + res.status);
    const payload = await res.json();
    stockNewsCache[key] = { savedAt: Date.now(), news: payload.news || [], events: payload.events || [] };
    renderStockNews(sym, payload.news || [], payload.events || [], payload.fromCache);
  } catch(e) {
    renderStockEvents([]);
    if (box) box.innerHTML = `<div style="color:var(--red);font-size:12px;padding:4px">Could not load stock news: ${escapeHTML(e.message)}</div>`;
  }
}

function lazyLoadDetailMetadata(asset, isETF) {
  if (!asset?.sym || detailMetadataLoading.has(asset.sym)) return;
  const attemptKey = `${asset.sym}|${isETF ? 'etf' : 'stock'}`;
  if (detailMetadataAttempted.has(attemptKey)) return;
  const needsETFMeta = isETF && (!asset.etfData || asset.etfData.expenseRatio == null || asset.etfData.fundFamily == null);
  const needsStockMeta = !isETF && !asset.fund?.computed;
  if (!needsETFMeta && !needsStockMeta) return;
  detailMetadataLoading.add(asset.sym);
  detailMetadataAttempted.add(attemptKey);
  const task = isETF ? fetchETFSummary([asset.sym]) : fetchSymbolMetadata([asset.sym]);
  task.catch(e => console.warn('detail metadata failed', asset.sym, e.message || e))
    .finally(() => {
      detailMetadataLoading.delete(asset.sym);
      if (document.getElementById('fund-modal')?.style.display === 'flex') openFundModal(asset.sym);
    });
}

function renderTradeDecisionTimeline(asset, t, adjustedScore, guard, whyTrade) {
  try {
    const sym = asset?.sym;
    const data = stockData[sym] || {};
    const openTrade = getOpenPaperTrade(sym);
    const eventFlag = getEventFlag(sym);
    const steps = [
      ['Data', data.price ? `Price ${moneyINR(data.price)} | Chg ${data.change == null ? '--' : data.change.toFixed(2) + '%'}` : 'Price not loaded'],
      ['Signal', t ? `${String(adjustedTradeSignal(adjustedScore)).toUpperCase()} score ${adjustedScore} | ${t.entryStatus || '--'}` : 'Intraday signal not loaded'],
      ['Setup', t ? `${safeSetupType(asset, t, guard)} | ${guard?.label || '--'}` : '--'],
      ['Decision', whyTrade || '--'],
      ['Trade', openTrade ? `${String(openTrade.side || '').toUpperCase()} ${openTrade.qty} @ ${moneyINR(openTrade.entryPrice)}` : 'No open trade'],
      ['Event', eventFlag ? `${eventFlag.label}${eventFlag.danger ? ' risk' : ''} | ${eventFlag.title}` : 'No active flag loaded'],
    ];
    return `<div class="detail-timeline">${steps.map(([label, text]) => `
      <div class="timeline-step"><span>${escapeHTML(label)}</span><strong>${escapeHTML(text)}</strong></div>
    `).join('')}</div>`;
  } catch (e) {
    console.warn('decision timeline failed', asset?.sym, e);
    return `<div class="detail-timeline"><div class="timeline-step"><span>Decision</span><strong>Timeline unavailable</strong></div></div>`;
  }
}

function safeSetupType(asset, t, guard) {
  try {
    return getSetupType(asset, t, guard);
  } catch (e) {
    console.warn('setup type failed', asset?.sym, e);
    return t?.setupType || t?.entryStatus || 'SIGNAL';
  }
}

function getModalTradeExplanation(asset, t, adjustedScore, adjustedSignal, guard) {
  if (!t) return '--';
  try {
    if (!window.SimulationEngine?.explainCandidateEligibility) return 'Simulation rules are still loading';
    const side = adjustedSignal === 'sell' ? 'sell' : adjustedSignal === 'buy' ? 'buy' : adjustedSignal;
    const candidate = buildSimulationEngineCandidate(asset, t, adjustedScore, side, guard, getTradeCostContext(asset, t, side));
    candidate.derivedSetupType = getSetupType(asset, t, guard);
    const explanation = window.SimulationEngine.explainCandidateEligibility(
      candidate,
      Date.now(),
      getSimulationEngineSettings(),
      { previousCandidate: simulationPreviousSignalCandidates.get(asset.sym) || null, market:{ indices:indexData } }
    );
    return explanation.eligible
      ? `Eligible now | ${explanation.setupType || '--'} | ${String(explanation.side || '').toUpperCase()}`
      : (explanation.reasons || []).slice(0, 6).join(' | ') || 'Not eligible now';
  } catch (e) {
    console.warn('modal trade explanation failed', asset?.sym, e);
    return 'Trade explanation unavailable';
  }
}

function scheduleVisibleEventFlags(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const candidates = rows.slice(0, 12).filter(row => {
    const keyPrefix = row.sym + '|';
    const hasCache = Object.keys(stockNewsCache).some(k => k.startsWith(keyPrefix));
    return !hasCache && !stockEventFetchQueued.has(row.sym);
  });
  if (!candidates.length) return;
  candidates.forEach((row, idx) => {
    stockEventFetchQueued.add(row.sym);
    setTimeout(async () => {
      try {
        const url = `${PROXY}/stock-news?symbol=${encodeURIComponent(row.sym)}&name=${encodeURIComponent(row.name || row.sym)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) return;
        const payload = await res.json().catch(() => null);
        if (!payload) return;
        stockNewsCache[`${row.sym}|stock|${row.name || row.sym}`] = {
          savedAt: Date.now(),
          news: payload.news || [],
          events: payload.events || [],
        };
        if ((payload.events || []).length) renderTable();
      } catch(e) {
        if (DEBUG_EVENT_LOGS) console.warn('event flag fetch failed', row.sym, e.message);
      }
    }, 900 + idx * 1400);
  });
}

function openFundModal(sym){
  if(!sym) return;
  const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const body = document.getElementById('fund-modal-body');
  const modal = document.getElementById('fund-modal');
  if(!asset || !body || !modal){ closeFundModal(); return; }
  const title = document.getElementById('fund-modal-title');
  try {
  const isETF = isETFAsset(asset);
  activeNewsKind = isETF ? 'etf' : 'stock';
  if (title) title.textContent = `${asset.sym} ${isETF ? 'ETF Details' : 'Details'}`;
  const f = asset.fund || {};
  const c = f.computed || {};
  const e = asset.etfData || {};
  const data = stockData[sym] || {};
  const fmt = v => v == null ? '--' : (typeof v === 'number' ? (Math.round((v + Number.EPSILON) * 100) / 100).toString() : String(v));
  const fmtMoney = v => v != null ? 'Rs ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '--';
  const fmtNum = v => v != null ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '--';
  const fmtReturn = v => v != null && Number.isFinite(Number(v)) ? (Number(v) * 100).toFixed(2) + '%' : '--';
  const fmtExpense = v => v != null && Number.isFinite(Number(v)) ? (Number(v) * 100).toFixed(2) + '%' : '--';
  const roe = c.roe != null ? fmt(normPercent(c.roe)) : '--';
  const targetDelta = (f.priceTarget && data.price) ? Math.round(((f.priceTarget - data.price) / data.price) * 100) + '%' : '--';
  const t = intradayData[sym] || null;
  const adjustedScore = t ? adjustedTradeScore(asset) : null;
  const adjustedSignal = t ? adjustedTradeSignal(adjustedScore) : null;
  const tradeLabel = t ? String(adjustedSignal || t.signal || 'hold').toUpperCase() + ' (' + adjustedScore + ')' : '--';
  const tradeReason = t?.reasons?.length ? t.reasons.join(', ') : '--';
  const rs = getRelativeStrength(t);
  const sectorAvg = t ? sectorTrendCache[asset.sector] : null;
  const tradeContext = t
    ? `RS ${rs == null ? '--' : (rs >= 0 ? '+' : '') + rs + '%'} | Sector ${sectorAvg == null ? '--' : (sectorAvg >= 0 ? '+' : '') + sectorAvg.toFixed(1) + '%'} | SuperTrend ${t.superTrendDirection || '--'} ${fmtMoney(t.superTrend)} | VWAP band ${t.vwapBandPosition || '--'} (${t.vwapBandWidthPct ?? '--'}%) | Gap ${t.gapPct ?? '--'}% (${t.gapQuality || '--'}) | PDH ${fmtMoney(t.prevDayHigh)} | PDL ${fmtMoney(t.prevDayLow)} | Pivot ${fmtMoney(t.pivot)} | 5D ${fmtMoney(t.low5)}-${fmtMoney(t.high5)} | 20D ${fmtMoney(t.low20)}-${fmtMoney(t.high20)} | Vol ${t.relVolume ?? '--'}x | R:R ${t.rr ?? '--'}`
    : '--';
  const liq = t ? getLiquidityInfo(t) : null;
  const timeWarn = getTimeWarning();
  const size = t ? getPositionSize(t) : null;
  const guard = t ? getRiskGuard(asset, t, adjustedScore) : null;
  const tradePlan = t ? `${guard?.label || '--'} (${guard?.reason || '--'}) | ${t.entryStatus || '--'} | ${t.entryTrigger || '--'} | ${t.invalidation || '--'} | ${liq?.label || 'Liq --'} ${liq?.tradedCr ?? '--'}cr | ${timeWarn.label} | Qty ${size ? size.qty : '--'} (risk Rs ${size ? size.maxLoss : '--'})` : '--';
  const whyTrade = getModalTradeExplanation(asset, t, adjustedScore, adjustedSignal, guard);
  const openTrade = getOpenPaperTrade(sym);
  const paperPnl = openTrade ? getPaperTradePnl(openTrade, getCurrentTradePrice(sym)) : null;
  const paperTradeText = openTrade
    ? `${String(openTrade.side || '').toUpperCase()} ${openTrade.qty || '--'} @ ${moneyINR(openTrade.entryPrice)} | Target ${moneyINR(openTrade.target)} | SL ${moneyINR(openTrade.stop)} | Net P&L ${paperPnl ? moneyINR(paperPnl.pnl) + ' (' + paperPnl.pnlPct + '%), charges ' + moneyINR(paperPnl.charges) : '--'}`
    : 'No open paper trade';
  const brokerTradeText = openTrade?.broker?.name === 'zerodha'
    ? `Entry ${formatZerodhaOrder(openTrade.broker.entryOrder)} | Exit ${formatZerodhaOrder(openTrade.broker.exitOrder)}`
    : (openTrade?.broker?.name === 'sharekhan'
      ? `Sharekhan order ${openTrade.broker.orderId || '--'} | Status ${openTrade.broker.status || '--'}`
      : 'Paper only');
  const etfSafety = isETF && t ? getETFTradeSafety(asset, t) : null;
  const detailRow = (label, value, raw = false) => `<tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${escapeHTML(label)}</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${raw ? value : escapeHTML(value)}</td></tr>`;
  const nav = e.nav ?? data.nav ?? null;
  const premium = e.premium ?? data.navPremium ?? null;
  const expRatio = e.expenseRatio ?? data.expRatio ?? null;
  const etfDetailRows = [
    detailRow('Price', fmtMoney(data.price)),
    detailRow('NAV / iNAV', fmtMoney(nav)),
    detailRow('Premium / Discount', premium == null ? '--' : `${Number(premium).toFixed(2)}% ${premium > 0 ? 'Premium' : premium < 0 ? 'Discount' : 'At NAV'}`),
    detailRow('Expense Ratio', fmtExpense(expRatio)),
    detailRow('Fund Family', e.fundFamily || asset.fundFamily || '--'),
    detailRow('Category', e.category || asset.sector || '--'),
    detailRow('AUM', e.aum != null ? fmtNum(e.aum) : '--'),
    detailRow('Volume', data.volume ? Number(data.volume).toLocaleString('en-IN') : '--'),
    detailRow('52W Range', data.low52 && data.high52 ? `${fmtMoney(data.low52)} - ${fmtMoney(data.high52)}` : '--'),
    detailRow('1M / YTD Return', `${fmtReturn(e.oneMonthReturn)} / ${fmtReturn(e.ytdReturn)}`),
    detailRow('1Y / 3Y / 5Y Return', `${fmtReturn(e.oneYearReturn)} / ${fmtReturn(e.threeYearReturn)} / ${fmtReturn(e.fiveYearReturn)}`),
    detailRow('Intraday Trade', tradeLabel),
    detailRow('ST Target / SL', `${fmtMoney(t?.target)} / ${fmtMoney(t?.stop)}`),
    detailRow('VWAP Bands', `${fmtMoney(t?.vwapLower)} / ${fmtMoney(t?.vwap)} / ${fmtMoney(t?.vwapUpper)} (${t?.vwapBandPosition || '--'})`),
    detailRow('SuperTrend', `${t?.superTrendDirection || '--'} ${fmtMoney(t?.superTrend)}`),
    detailRow('ETF Guard', etfSafety ? `${etfSafety.ok ? 'Allowed' : 'Avoid'}${etfSafety.warn ? ' - Warning' : ''} | ${etfSafety.reason || guard?.reason || '--'}` : '--'),
    detailRow('Why Not Traded?', whyTrade),
    detailRow('Trade Context', tradeContext),
    detailRow('Entry Plan', tradePlan),
    detailRow('Paper Trade', paperTradeText),
    detailRow('Broker Dry Run', brokerTradeText),
  ].join('');
  const stockDetailRows = [
    detailRow('Price', fmtMoney(data.price)),
    detailRow('Target', `${fmtMoney(f.priceTarget)} (${targetDelta})`),
    detailRow('Intraday Trade', tradeLabel),
    detailRow('ST Target / SL', `${fmtMoney(t?.target)} / ${fmtMoney(t?.stop)}`),
    detailRow('Paper Trade', paperTradeText),
    detailRow('Broker Dry Run', brokerTradeText),
    detailRow('Why Not Traded?', whyTrade),
    detailRow('Trade Context', tradeContext),
    detailRow('Entry Plan', tradePlan),
    detailRow('VWAP', fmtMoney(t?.vwap)),
    detailRow('VWAP Bands', `${fmtMoney(t?.vwapLower)} / ${fmtMoney(t?.vwapUpper)} (${t?.vwapBandPosition || '--'})`),
    detailRow('SuperTrend', `${t?.superTrendDirection || '--'} ${fmtMoney(t?.superTrend)}`),
    detailRow('EMA 9 / 20', `${fmtMoney(t?.ema9)} / ${fmtMoney(t?.ema20)}`),
    detailRow('RSI / ATR', `${fmt(t?.rsi)} / ${fmtMoney(t?.atr)}`),
    detailRow('Setup', tradeReason),
    detailRow('Trailing EPS', fmt(c.eps)),
    detailRow('Trailing P/E', fmt(c.pe)),
    detailRow('Forward P/E', fmt(f.forwardPE)),
    detailRow('Price/Book', fmt(f.priceToBook)),
    detailRow('ROE (%)', roe),
    detailRow('D/E', fmt(c.de)),
    detailRow('PEG', fmt(c.peg)),
    detailRow('Market Cap', fmt(f.marketCap)),
    detailRow('Dividend Yield', f.dividendYield != null ? (f.dividendYield * 100).toFixed(2) + '%' : '--'),
    detailRow('50D Avg', fmtMoney(f.fiftyDayAvg)),
    `<tr><td style="padding:6px 8px;vertical-align:top">200D Avg</td><td style="padding:6px 8px">${escapeHTML(fmtMoney(f.twoHundredDayAvg))}</td></tr>`,
  ].join('');
  body.innerHTML = `
    <div class="stock-detail-title">${escapeHTML(asset.sym)} - ${escapeHTML(asset.name || '')}</div>
    <div class="stock-detail-grid">
      <div class="stock-detail-panel">
        <h4>${isETF ? 'ETF Facts' : 'Fundamentals'}</h4>
        <table style="width:100%;border-collapse:collapse">
          ${isETF ? etfDetailRows : stockDetailRows}
        </table>
        <div style="margin-top:10px">
          <button class="paper-btn" onclick="loadReplayWhyMissed('${escapeHTML(asset.sym)}')">Why Missed In Replay</button>
          <div id="replay-why-box" style="margin-top:8px"></div>
        </div>
      </div>
      <div class="stock-detail-side">
        <div class="stock-detail-panel">
          <h4>Decision Timeline</h4>
          ${renderTradeDecisionTimeline(asset, t, adjustedScore, guard, whyTrade)}
        </div>
        <div class="stock-detail-panel">
          <h4>${isETF ? 'ETF News & Events' : 'News & Events'}</h4>
          <div id="stock-event-list" class="stock-event-list">
            <div style="color:var(--muted);font-size:12px;padding:2px 0 8px">Loading ${isETF ? 'ETF announcements' : 'result and dividend events'}...</div>
          </div>
          <div id="stock-news-list" class="stock-news-list">
            <div style="color:var(--muted);font-size:12px;padding:4px">Loading related news...</div>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  lazyLoadDetailMetadata(asset, isETF);
  loadStockNews(asset.sym, asset.name || asset.sym, isETF ? 'etf' : 'stock');
  } catch (e) {
    console.warn('stock detail modal failed', sym, e);
    if (title) title.textContent = `${asset.sym} Details`;
    body.innerHTML = `
      <div class="stock-detail-title">${escapeHTML(asset.sym)} - ${escapeHTML(asset.name || '')}</div>
      <div class="stock-detail-panel">
        <h4>Details</h4>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Price</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${escapeHTML(moneyINR(stockData[sym]?.price))}</td></tr>
          <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Change</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${escapeHTML(stockData[sym]?.change == null ? '--' : stockData[sym].change.toFixed(2) + '%')}</td></tr>
          <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Sector</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${escapeHTML(asset.sector || '--')}</td></tr>
          <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Status</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Advanced details unavailable. Basic panel opened.</td></tr>
        </table>
      </div>
    `;
    modal.style.display = 'flex';
  }
}

window.openFundModal = openFundModal;
window.closeFundModal = closeFundModal;

function applyETFListPayload(allEtfs, sourceLabel = 'server') {
  const list = Array.isArray(allEtfs) ? allEtfs : [];
  const newSymbols = [];
  for (const etf of list) {
    if (!etf.sym) continue;
    if (MIDCAP_STOCKS.some(s=>s.sym===etf.sym) || ETF_ASSETS.some(s=>s.sym===etf.sym)) continue;
    ETF_ASSETS.push({
      sym: etf.sym,
      name: etf.name || etf.sym,
      sector: etf.sector || 'ETF',
      cap: 'etf',
      fundFamily: etf.fundFamily || null,
      etfData: etf.expRatio != null ? { expenseRatio: etf.expRatio } : undefined
    });
    if (etf.price || etf.nav) {
      stockData[etf.sym] = Object.assign(stockData[etf.sym] || {}, {
        price      : etf.price,
        change     : etf.chgPct,
        nav        : etf.nav,
        navPremium : etf.navPremium,
        high52     : etf.high52,
        low52      : etf.low52,
        volume     : etf.volume,
        aum        : etf.aum,
        expRatio   : etf.expRatio,
      });
    }
    newSymbols.push(etf.sym);
  }
  if (newSymbols.length) console.log(`[ETF] Loaded ${newSymbols.length} ETFs from ${sourceLabel}`);
  return newSymbols;
}

async function loadPresetETFs(){
  if (etfListLoaded) return; // already fetched — don't re-hit /etf-list on every tab switch
  const bootEtfs = dashboardBootstrap?.etfListCache?.etfs;
  if (Array.isArray(bootEtfs) && bootEtfs.length) {
    applyETFListPayload(bootEtfs, 'bootstrap cache');
    etfListLoaded = true;
    populateETFSectorDropdown();
    renderETFSection();
    return;
  }
  try {
    const res = await fetch(`${PROXY}/etf-list`);
    if (res.ok) {
      const json = await res.json();
      applyETFListPayload(json.etfs || [], '/etf-list');
      console.log(`[ETF] Loaded ${ETF_ASSETS.length} ETFs from /etf-list`);
      etfListLoaded = true;
      populateETFSectorDropdown();
      renderETFSection();
      return;
    }
  } catch(e) { console.warn('[ETF] /etf-list failed, falling back to preset:', e.message); }

  // Fallback: use hardcoded PRESET_ETFS
  const newSymbols = [];
  for(const etf of PRESET_ETFS){
    if(MIDCAP_STOCKS.some(s=>s.sym===etf.sym) || ETF_ASSETS.some(s=>s.sym===etf.sym)) continue;
    ETF_ASSETS.push({ ...etf });
    newSymbols.push(etf.sym);
  }
  etfListLoaded = true; // prevent re-running on every tab switch even in fallback
  populateETFSectorDropdown();
  if(!newSymbols.length) return;
  await fetchAdditionalSymbols(newSymbols);
}

function renderETFSection(){
  const section = document.getElementById('etf-section');
  const tbody = document.getElementById('etf-tbody');
  const status = document.getElementById('etf-status-bar');
  if (!section || !tbody) return; // required elements missing
  section.style.display = currentView==='etfs' ? 'block' : 'none';
  let rows = ETF_ASSETS.map((s,i)=>({ ...s, rank:i+1, data: stockData[s.sym] || null }));

  // Multi-select AND filter: each active filter must be satisfied
  if (etfFilters.size) {
    const filterFns = {
      favorite: r => isETFFavorite(r.sym),
      buy:      r => getSignal(r, r.data) === 'buy',
      watch:    r => getSignal(r, r.data) === 'watch',
      sell:     r => getSignal(r, r.data) === 'sell',
      gainers:  r => (r.data?.change || 0) > 0,
      losers:   r => (r.data?.change || 0) < 0,
      tradeable:r => {
        const t = intradayData[r.sym];
        if (!t) return false;
        const g = getRiskGuard(r, t, adjustedTradeScore(r));
        return ['ok','small'].includes(g.level) && getETFTradeSafety(r, t).ok;
      },
      hideavoid:r => {
        const t = intradayData[r.sym];
        if (!t) return true;
        const g = getRiskGuard(r, t, adjustedTradeScore(r));
        return !['avoid','invalid','chasing'].includes(g.level) && getETFTradeSafety(r, t).ok;
      },
      triggered:r => intradayData[r.sym]?.entryStatus === 'Triggered' && !getIntradayFreshness(intradayData[r.sym]).stale && getETFTradeSafety(r, intradayData[r.sym]).ok,
      neartrigger:r => intradayData[r.sym]?.entryStatus === 'Near trigger' && !getIntradayFreshness(intradayData[r.sym]).stale && getETFTradeSafety(r, intradayData[r.sym]).ok,
      custom:   r => EXTRA_SYMBOLS.includes(r.sym),
      preset:   r => !EXTRA_SYMBOLS.includes(r.sym),
    };
    const etfGroups = [
      ['buy', 'sell', 'watch'],  // signal   — OR within group
      ['gainers', 'losers'],     // movement — OR within group
      ['tradeable', 'hideavoid'],
      ['triggered', 'neartrigger'],
      ['favorite'],              // standalone
      ['custom'],                // standalone
      ['preset'],                // standalone
    ];
    rows = rows.filter(r =>
      etfGroups.every(group => {
        const active = group.filter(f => etfFilters.has(f));
        return !active.length || active.some(f => filterFns[f]?.(r) ?? true);
      })
    );
  }

  if (etfSectorFilter) rows = rows.filter(r => (r.sector || 'Other') === etfSectorFilter);

  if(etfSearch){
    rows = rows.filter(r => {
      const search = etfSearch;
      return r.sym.toLowerCase().includes(search)
        || r.name.toLowerCase().includes(search)
        || (r.sector||'').toLowerCase().includes(search);
    });
  }

  // Target filters for ETFs
  if(targetFilter && targetFilter!=='all'){
    rows = rows.filter(r => {
      const pct = getTargetDeltaPct(r);
      if(pct == null) return false;
      if(targetFilter === 'has') return true;
      if(targetFilter === 'up5') return pct >= 5;
      if(targetFilter === 'up10') return pct >= 10;
      if(targetFilter === 'down5') return pct <= -5;
      return true;
    });
  }

  const {col,dir} = etfSort;
  rows.sort((a,b)=>{
    let av,bv;
    if(col==='symbol'){av=a.sym; bv=b.sym;}
    else if(col==='price'){av=a.data?.price||0; bv=b.data?.price||0;}
    else if(col==='target'){ av=getTargetDeltaPct(a) ?? -999; bv=getTargetDeltaPct(b) ?? -999; }
    else if(col==='change'){av=a.data?.change||0; bv=b.data?.change||0;}
    else if(col==='volume'){av=a.data?.volume||0; bv=b.data?.volume||0;}
    else if(col==='nav'){av=a.etfData?.nav??-1; bv=b.etfData?.nav??-1;}
    else if(col==='premium'){av=a.etfData?.premium??-999; bv=b.etfData?.premium??-999;}
    else if(col==='1m'){av=a.etfData?.oneMonthReturn??-999; bv=b.etfData?.oneMonthReturn??-999;}
    else if(col==='1y'){av=a.etfData?.oneYearReturn??-999; bv=b.etfData?.oneYearReturn??-999;}
    else if(col==='3y'){av=a.etfData?.threeYearReturn??-999; bv=b.etfData?.threeYearReturn??-999;}
    else if(col==='trade'){av=adjustedTradeScore(a); bv=adjustedTradeScore(b);}
    else if(col==='sttarget'){av=getTradeCostContext(a, intradayData[a.sym])?.netPct ?? -999; bv=getTradeCostContext(b, intradayData[b.sym])?.netPct ?? -999;}
    else {av=a.rank; bv=b.rank;}
    return typeof av==='string' ? dir*av.localeCompare(bv) : dir*(av-bv);
  });
  rows = rows.map((row,i)=>({ ...row, rank:i+1 }));

  tbody.innerHTML='';
  if(!rows.length){
    const note = etfFilters.size === 0
      ? 'No ETFs loaded yet. Use the button above to load ETF presets or add a symbol.'
      : 'No ETFs match the selected filter combination.';
    tbody.innerHTML=`<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--muted)">${note}</td></tr>`;
    if(status) status.textContent='0 ETFs loaded';
    return;
  }
  if(status) status.textContent=`${rows.length} ETF${rows.length===1?'':'s'} loaded`;
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  // Build entire tbody as one HTML string — single DOM write instead of 326 appends
  tbody.innerHTML = rows.map(row => {
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d),fav=isETFFavorite(row.sym);
    return `<tr>
      <td><button class="fav-btn ${fav?'active':''}" onclick="toggleETFFavorite('${row.sym}', event)">${fav?'★':'☆'}</button></td>
      <td data-open-symbol="${escapeHTML(row.sym)}" onclick="openFundModal('${escapeHTML(row.sym)}')" style="cursor:pointer"><div class="stock-name-cell etf-name-cell"><button class="stock-name-link" type="button" data-open-symbol="${escapeHTML(row.sym)}" title="Open ETF details"><span class="stock-symbol">${escapeHTML(row.sym)}</span><span class="stock-fullname">${escapeHTML(row.name)}</span>${(row.fundFamily||row.etfData?.fundFamily)?`<span class="etf-family">${escapeHTML(row.fundFamily||row.etfData.fundFamily)}</span>`:''}</button></div></td>
      <td class="price-cell"><div class="price-stack"><span>${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</span><span class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</span><span class="range-mini">${d&&d.low52&&d.high52?'52W ₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+'–₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'52W --'}</span></div></td>
      <td class="hide-mobile" style="font-size:11px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td class="hide-mobile" style="font-size:11px">${renderETFReturnCell(row.etfData?.oneMonthReturn, '1M')}</td>
      <td class="hide-mobile hide-1200" style="font-size:11px">${renderETFReturnCell(row.etfData?.oneYearReturn, '1Y')}</td>
      <td class="hide-mobile hide-1200" style="font-size:11px">${renderETFReturnCell(row.etfData?.threeYearReturn, '3Y ann')}</td>
      <td><div class="spark">${d?sparkBars(row.sym,chg):'<span style="color:var(--muted);font-size:11px">--</span>'}</div></td>
      <td>${renderETFTradeCell(row)}</td>
      <td>${renderShortTargetCell(row)}</td>
      <td><span class="signal-badge ${sig}">${sigLabels[sig]}</span></td>
      <td style="font-size:12px">${renderETFNavCell(row)}</td>
      <td style="font-size:12px">${renderETFPremiumCell(row)}</td>
      <td class="hide-mobile hide-1200" style="font-size:11px;color:var(--muted)">${renderETFExpenseCell(row)}</td>
    </tr>`;
  }).join('');
  syncETFScrollSizing();
}

function renderETFNavCell(row) {
  const nav = row.etfData?.nav;
  if (nav == null) return '<span style="color:var(--muted)">--</span>';
  return '₹' + nav.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function renderETFTradeCell(row) {
  const t = intradayData[row.sym];
  if (!t) return '<span style="color:var(--muted);font-size:12px">No 5m data</span>';
  const safety = getETFTradeSafety(row, t);
  if (!safety.ok && !getOpenPaperTrade(row.sym)) {
    return `<div class="trade-cell">
      <span class="risk-guard avoid" title="${escapeHTML(safety.reason)}">Avoid</span>
      <span class="indicator-mini">${escapeHTML(safety.reason)}</span>
    </div>`;
  }
  const html = renderTradeCell(row);
  if (safety.warn && !getOpenPaperTrade(row.sym)) {
    return html.replace('</div>', `<span class="risk-guard small" title="${escapeHTML(safety.reason)}">${escapeHTML(safety.reason)}</span></div>`);
  }
  return html;
}

function renderETFPremiumCell(row) {
  const prem = row.etfData?.premium;
  if (prem == null) return '<span style="color:var(--muted)">--</span>';
  const col = Math.abs(prem) < 0.5 ? 'var(--muted)' : prem > 0 ? 'var(--red)' : 'var(--green)';
  const arrow = prem > 0 ? '▲' : prem < 0 ? '▼' : '–';
  const label = Math.abs(prem) < 0.5 ? 'At NAV' : prem > 0 ? 'Premium' : 'Discount';
  return `<span style="color:${col};font-weight:600">${arrow} ${Math.abs(prem).toFixed(2)}%</span> <span style="font-size:10px;color:var(--muted)">${label}</span>`;
}

function renderETFExpenseCell(row) {
  const exp = row.etfData?.expenseRatio ?? row.data?.expRatio ?? stockData[row.sym]?.expRatio;
  if (exp == null) return '<span style="color:var(--muted)">--</span>';
  const pct = (exp * 100).toFixed(2);
  const col = exp <= 0.002 ? 'var(--green)' : exp <= 0.005 ? 'var(--yellow)' : 'var(--red)';
  return `<span style="color:${col}">${pct}%</span>`;
}

function renderETFReturnCell(val, label) {
  if (val == null) return '<span style="color:var(--muted)">--</span>';
  const pct = (val * 100).toFixed(1);
  const col = val > 0.15 ? 'var(--green)' : val > 0 ? '#6ee7b7' : val > -0.1 ? 'var(--yellow)' : 'var(--red)';
  const arrow = val >= 0 ? '▲' : '▼';
  return `<span style="color:${col};font-weight:600">${arrow} ${Math.abs(pct)}%</span>`;
}

function syncStockScrollSizing() {
  const wrap = document.getElementById('table-wrap');
  const top = document.getElementById('stock-top-scroll');
  const inner = document.getElementById('stock-top-scroll-inner');
  if (!wrap || !top || !inner) return;
  inner.style.width = wrap.scrollWidth + 'px';
  top.scrollLeft = wrap.scrollLeft;
  updateStockScrollButtons();
}

function updateStockScrollButtons() {
  const wrap = document.getElementById('table-wrap');
  const left = document.getElementById('stock-scroll-left');
  const right = document.getElementById('stock-scroll-right');
  if (!wrap || !left || !right) return;
  const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth - 1);
  left.disabled = wrap.scrollLeft <= 1;
  right.disabled = wrap.scrollLeft >= max;
}

function scrollStockTable(dir, jumpToEnd = false) {
  const wrap = document.getElementById('table-wrap');
  if (!wrap) return;
  const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  if (jumpToEnd) {
    wrap.scrollLeft = dir > 0 ? max : 0;
  } else {
    const amount = Math.max(520, Math.round(wrap.clientWidth * 1.15));
    wrap.scrollLeft = Math.max(0, Math.min(max, wrap.scrollLeft + (dir * amount)));
  }
  const top = document.getElementById('stock-top-scroll');
  if (top) top.scrollLeft = wrap.scrollLeft;
  updateStockScrollButtons();
}

function initStockTableScroll() {
  const wrap = document.getElementById('table-wrap');
  const top = document.getElementById('stock-top-scroll');
  if (!wrap || !top || wrap.dataset.scrollReady === '1') return;
  wrap.dataset.scrollReady = '1';
  let syncing = false;
  wrap.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    top.scrollLeft = wrap.scrollLeft;
    updateStockScrollButtons();
    syncing = false;
  }, { passive: true });
  top.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    wrap.scrollLeft = top.scrollLeft;
    updateStockScrollButtons();
    syncing = false;
  }, { passive: true });
  window.addEventListener('resize', syncStockScrollSizing);
  syncStockScrollSizing();
}

function syncETFScrollSizing() {
  const wrap = document.getElementById('etf-table-wrap');
  const top = document.getElementById('etf-top-scroll');
  const inner = document.getElementById('etf-top-scroll-inner');
  if (!wrap || !top || !inner) return;
  inner.style.width = wrap.scrollWidth + 'px';
  top.scrollLeft = wrap.scrollLeft;
  updateETFScrollButtons();
}

function updateETFScrollButtons() {
  const wrap = document.getElementById('etf-table-wrap');
  const left = document.getElementById('etf-scroll-left');
  const right = document.getElementById('etf-scroll-right');
  if (!wrap || !left || !right) return;
  const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth - 1);
  left.disabled = wrap.scrollLeft <= 1;
  right.disabled = wrap.scrollLeft >= max;
}

function scrollETFTable(dir, jumpToEnd = false) {
  const wrap = document.getElementById('etf-table-wrap');
  if (!wrap) return;
  const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  if (jumpToEnd) {
    wrap.scrollLeft = dir > 0 ? max : 0;
  } else {
    const amount = Math.max(520, Math.round(wrap.clientWidth * 1.15));
    wrap.scrollLeft = Math.max(0, Math.min(max, wrap.scrollLeft + (dir * amount)));
  }
  const top = document.getElementById('etf-top-scroll');
  if (top) top.scrollLeft = wrap.scrollLeft;
  updateETFScrollButtons();
}

function initETFTableScroll() {
  const wrap = document.getElementById('etf-table-wrap');
  const top = document.getElementById('etf-top-scroll');
  if (!wrap || !top || wrap.dataset.scrollReady === '1') return;
  wrap.dataset.scrollReady = '1';
  let syncing = false;
  wrap.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    top.scrollLeft = wrap.scrollLeft;
    updateETFScrollButtons();
    syncing = false;
  }, { passive: true });
  top.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    wrap.scrollLeft = top.scrollLeft;
    updateETFScrollButtons();
    syncing = false;
  }, { passive: true });
  window.addEventListener('resize', syncETFScrollSizing);
  syncETFScrollSizing();
}

function renderDashboard(options = {}) {
  if (options?.immediate) return renderDashboardNow(true);
  if (dashboardRenderScheduled) return;
  dashboardRenderScheduled = true;
  requestAnimationFrame(() => {
    dashboardRenderScheduled = false;
    renderDashboardNow(false);
  });
}

function renderDashboardNow(immediateTable = false){
  renderIndices();
  renderSectors();
  renderTable(immediateTable ? { immediate:true } : undefined);
  renderTopActionBar();
  applyColumnPreset();
  syncStockScrollSizing();
  if (currentView === 'etfs') { renderETFSection(); syncETFScrollSizing(); }
}

function initDetailOpenHandlers() {
  ['stock-tbody', 'etf-tbody'].forEach(id => {
    const body = document.getElementById(id);
    if (!body || body.dataset.detailOpenReady === '1') return;
    body.dataset.detailOpenReady = '1';
    body.addEventListener('click', event => {
      const trigger = event.target.closest('[data-open-symbol]');
      if (!trigger || !body.contains(trigger)) return;
      event.preventDefault();
      event.stopPropagation();
      openFundModal(trigger.dataset.openSymbol);
    });
  });
}

function applyDashboardRouteHint() {
  const route = window.__DASHBOARD_ROUTE__ || {};
  if (route.view === 'etfs') {
    const tab = document.getElementById('tab-etfs');
    if (tab) {
      document.querySelectorAll('#main-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
      tab.classList.add('active');
    }
  }
  if (route.action === 'portfolio') {
    setTimeout(() => openPortfolioModal().catch(e => console.warn('portfolio route open failed', e.message)), 250);
  } else if (route.action === 'replay') {
    setTimeout(() => runReplayToday().catch(e => console.warn('replay route open failed', e.message)), 250);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initStockTableScroll();
  initETFTableScroll();
  initDetailOpenHandlers();
  applyColumnPreset();
  updateSimulationButton();
  updateBrokerModeButton();
  setupZerodhaPositionsPanelClickAway();
  document.querySelectorAll('.source-card').forEach(card => {
    const src = card.dataset.source;
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSource(src);
      }
    });
  });

  await loadDashboardBootstrap();
  await Promise.all([
    loadTradeSettingOverridesFromServer(),
    loadFavoriteETFs(),
    loadFavoriteStocks(),
  ]);
  renderTopActionBar();
  await Promise.all([
    loadSavedETFs(),
    loadSavedStocks(),
    loadPaperTrades(),
  ]);
  subscribePaperTradesStream();
  applyDashboardRouteHint();

  // Run periodic simulation exits so EOD settlement does not depend only on feed refresh callbacks.
  startSimulationCycleTimer();
  
  // Start polling broker + live portfolio status
  await pollBrokerStatus();
  await pollZerodhaPortfolioState();
  setInterval(async () => {
    await pollBrokerStatus();
    await pollZerodhaPortfolioState();
  }, 30000);
});

// ═══════════════════════════════════
//  BROKER STATUS POLLING
// ═══════════════════════════════════
async function pollBrokerStatus() {
  try {
    const res = await fetch('/broker-status');
    if (res.ok) {
      brokerConnectionStatus = await res.json();
      updateBrokerModeButton();
    }
  } catch (e) {
    console.warn('[broker] Status poll failed:', e.message);
  }
}

async function pollZerodhaPortfolioState() {
  const useSharekhan = brokerMode === 'sharekhan_live';
  const canFetch = useSharekhan ? !!brokerConnectionStatus?.sharekhan?.clientsInitialized : !!brokerConnectionStatus?.zerodha?.clientsInitialized;
  if (!canFetch) {
    zerodhaPortfolioState = { loading:false, ok:false, data:null, error: `${useSharekhan ? 'Sharekhan' : 'Zerodha'} client is not initialized` };
    updateZerodhaPortfolioPill();
    return;
  }

  zerodhaPortfolioState = { ...zerodhaPortfolioState, loading:true, error:'' };
  updateZerodhaPortfolioPill();
  try {
    const endpoint = useSharekhan ? SHAREKHAN_PORTFOLIO_ENDPOINT : ZERODHA_PORTFOLIO_ENDPOINT;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      throw new Error(payload.error || payload.hint || `HTTP ${res.status}`);
    }
    zerodhaPortfolioState = { loading:false, ok:true, data:payload, error:'' };
  } catch (e) {
    zerodhaPortfolioState = { loading:false, ok:false, data:null, error:e.message || `Could not fetch ${useSharekhan ? 'Sharekhan' : 'Zerodha'} portfolio` };
  }
  updateZerodhaPortfolioPill();
  if (zerodhaPositionsPanelOpen) {
    renderZerodhaPositionsPanel();
  }
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') {
    renderPortfolioModal();
  }
  if (document.getElementById('zerodha-portfolio-modal')?.style.display === 'flex') {
    renderZerodhaPortfolioModal();
  }
}

function updateZerodhaConfirmationsTable() {
  const tbody = document.getElementById('zerodha-confirmations-tbody');
  if (!tbody) return;
  
  // Get trades with Zerodha broker metadata
  const zerodhaTradesWithAudit = paperTrades
    .filter(t => t.broker?.name === 'zerodha' && t.broker?.audit?.length)
    .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0))
    .slice(0, 10); // Show last 10
  
  if (!zerodhaTradesWithAudit.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px">No recent confirmations</td></tr>`;
    return;
  }
  
  tbody.innerHTML = zerodhaTradesWithAudit.map(trade => {
    const orderId = trade.broker.orderId || '--';
    const status = trade.broker.status || '--';
    const attempts = trade.broker.confirmationAttempts || 0;
    const lastAudit = trade.broker.audit[trade.broker.audit.length - 1] || {};
    const lastEvent = lastAudit.event || '--';
    const elapsed = lastAudit.elapsed ? `${(lastAudit.elapsed / 1000).toFixed(1)}s` : '--';
    
    return `<tr>
      <td>${escapeHTML(trade.symbol || '--')}</td>
      <td style="font-size:11px;font-family:monospace">${escapeHTML(String(orderId).slice(0, 12))}</td>
      <td>${escapeHTML(status)}</td>
      <td>${attempts}</td>
      <td><span title="${escapeHTML(lastEvent)}">${escapeHTML(lastEvent.slice(0, 20))}</span> (${elapsed})</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════
//  FUNDAMENTALS CHAT BOT
// ═══════════════════════════════════
let chatOpen = false;
let chatBusy = false;

function toggleFundChat(){
  chatOpen = !chatOpen;
  const panel = document.getElementById('fund-chat-panel');
  panel.classList.toggle('open', chatOpen);
  if(chatOpen){
    const keyRow = document.getElementById('chat-key-row');
    if(keyRow) keyRow.style.display = 'none';
    document.getElementById('chat-input')?.focus();
  }
}

function saveChatKey(){
  document.getElementById('chat-key-row').style.display = 'none';
  addChatMsg('bot', 'Chat uses Ollama through the local proxy, with dashboard data as context. You can ask now.');
}

function sendSuggestion(el){
  const text = el.textContent;
  document.getElementById('chat-input').value = text;
  sendChatMessage();
}

function addChatMsg(role, html){
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.innerHTML = html;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function buildFundamentalsContext(){
  // Build a compact snapshot of all stocks with available fundamentals
  const rows = [];
  const allAssets = [...MIDCAP_STOCKS, ...STOCK_ASSETS];
  for(const asset of allAssets){
    const d = stockData[asset.sym];
    const f = asset.fund;
    const c = f?.computed;
    if(!d && !f) continue;
    const norm = v => (v != null && Math.abs(v) <= 1) ? +(v*100).toFixed(2) : (v != null ? +v.toFixed(2) : null);
    rows.push({
      sym: asset.sym,
      name: asset.name,
      sector: asset.sector,
      cap: asset.cap,
      price: d?.price ?? null,
      change: d?.change ?? null,
      high52: d?.high52 ?? null,
      low52:  d?.low52  ?? null,
      eps:    c?.eps    ?? null,
      pe:     c?.pe != null ? +c.pe.toFixed(2) : null,
      roe:    c?.roe != null ? norm(c.roe) : null,
      de:     c?.de  != null ? +c.de.toFixed(2) : null,
      peg:    c?.peg != null ? +c.peg.toFixed(2) : null,
      marketCap: f?.marketCap ?? null,
      priceTarget: f?.priceTarget ?? null,
      epsGrowth: f?.epsGrowth != null ? norm(f.epsGrowth) : null,
      dividendYield: f?.dividendYield != null ? norm(f.dividendYield) : null,
    });
  }
  return rows;
}

function renderChatTable(rows, columns) {
  if (!rows.length) return '<p>No matching fundamentals data loaded yet.</p>';
  const header = columns.map(c => `<th style="padding:6px 8px;border-bottom:1px solid #334155;text-align:left">${escapeHTML(c.label)}</th>`).join('');
  const body = rows.map(row => `<tr>${columns.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #1e293b">${escapeHTML(c.format ? c.format(row[c.key], row) : (row[c.key] ?? '--'))}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function localFundamentalsAnswer(question, fundamentals) {
  const q = String(question || '').toLowerCase();
  const loaded = fundamentals.filter(r => r.pe != null || r.roe != null || r.eps != null);
  const baseCols = [
    { key:'sym', label:'Stock' },
    { key:'name', label:'Name' },
    { key:'sector', label:'Sector' },
    { key:'price', label:'Price', format:v => v == null ? '--' : moneyINR(v) },
  ];
  const pct = v => v == null ? '--' : Number(v).toFixed(1) + '%';
  const num = v => v == null ? '--' : Number(v).toFixed(2);
  const compactCap = v => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '--';
    if (n >= 10000000) return 'Rs ' + (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return 'Rs ' + (n / 100000).toFixed(1) + 'L';
    return moneyINR(n);
  };
  const withHealth = loaded.map(r => {
    let health = 0;
    if (r.roe != null && r.roe >= 20) health += 30;
    if (r.pe != null && r.pe > 0 && r.pe <= 25) health += 25;
    if (r.de != null && r.de <= 1) health += 20;
    if (r.peg != null && r.peg > 0 && r.peg <= 2) health += 15;
    if (r.epsGrowth != null && r.epsGrowth > 0) health += 10;
    return { ...r, health };
  });

  const escapeRegExp = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namedStocks = fundamentals.filter(r => {
    const sym = String(r.sym || '').toLowerCase();
    const name = String(r.name || '').toLowerCase();
    return (sym && new RegExp(`\\b${escapeRegExp(sym)}\\b`, 'i').test(q)) || (name && q.includes(name));
  });
  const wantsCompare = /compare|versus| vs |better|which one/.test(q);
  if (wantsCompare && namedStocks.length >= 2) {
    const rows = namedStocks.slice(0, 6).map(r => withHealth.find(x => x.sym === r.sym) || r);
    const best = rows
      .map(r => ({ ...r, composite:(r.health || 0) + Math.min(35, Number(r.roe || 0) / 2) + (r.pe != null && r.pe > 0 ? Math.max(0, 25 - r.pe) : 0) + (r.de != null ? Math.max(0, 15 - r.de * 8) : 0) }))
      .sort((a,b) => b.composite - a.composite)[0];
    return `<p><strong>Comparison from loaded fundamentals</strong></p><p style="color:#94a3b8;font-size:12px">${escapeHTML(best ? `${best.sym} ranks best locally on health, ROE, valuation and debt among the compared stocks.` : 'Compared using available dashboard fundamentals.')}</p>${renderChatTable(rows, [...baseCols, { key:'health', label:'Health' }, { key:'roe', label:'ROE', format:pct }, { key:'pe', label:'P/E', format:num }, { key:'de', label:'D/E', format:num }, { key:'epsGrowth', label:'EPS Gr', format:pct }, { key:'dividendYield', label:'Div', format:pct }])}`;
  }

  const stock = namedStocks[0];
  if (stock && (/health|good|analysis|fundamental|roe|pe|debt|eps|how\s+is|how'?s|tell me|view|status|dividend|growth|target/.test(q) || q.split(/\s+/).length <= 5)) {
    const scored = withHealth.find(r => r.sym === stock.sym) || stock;
    const positives = [];
    const cautions = [];
    if (scored.roe != null) (scored.roe >= 20 ? positives : cautions).push(`ROE ${scored.roe.toFixed(1)}%`);
    if (scored.pe != null) (scored.pe > 0 && scored.pe <= 25 ? positives : cautions).push(`P/E ${scored.pe.toFixed(2)}`);
    if (scored.de != null) (scored.de <= 1 ? positives : cautions).push(`D/E ${scored.de.toFixed(2)}`);
    if (scored.epsGrowth != null) (scored.epsGrowth > 0 ? positives : cautions).push(`EPS growth ${scored.epsGrowth.toFixed(1)}%`);
    if (scored.dividendYield != null && scored.dividendYield > 0) positives.push(`Dividend yield ${scored.dividendYield.toFixed(1)}%`);
    const verdict = positives.length >= cautions.length
      ? `Looks constructive on loaded fundamentals. Strengths: ${positives.join(', ') || 'price/fundamental data available'}.`
      : `Needs caution on loaded fundamentals. Watch: ${cautions.join(', ') || 'some metrics are missing'}.`;
    return `<p><strong>${escapeHTML(scored.sym)} quick view</strong></p><p>${escapeHTML(verdict)}</p>${renderChatTable([scored], [
      { key:'sym', label:'Stock' },
      { key:'name', label:'Name' },
      { key:'sector', label:'Sector' },
      { key:'price', label:'Price', format:v => v == null ? '--' : moneyINR(v) },
      { key:'roe', label:'ROE', format:pct },
      { key:'pe', label:'P/E', format:num },
      { key:'de', label:'D/E', format:num },
      { key:'peg', label:'PEG', format:num },
      { key:'epsGrowth', label:'EPS Gr', format:pct },
      { key:'dividendYield', label:'Div', format:pct },
    ])}`;
  }

  const wantsHealthy = /health|healthy|quality|strong/.test(q);
  const wantsLowDebt = /low\s+debt|debt|d\/e/.test(q);
  const wantsRoe = /best\s+roe|roe|return on equity/.test(q);
  const wantsCheap = /undervalued|cheap|low\s+p\/?e|p\/e|value|valuation/.test(q);
  const wantsGrowth = /growth|eps/.test(q);
  const wantsDividend = /dividend|yield|income/.test(q);
  const wantsMarketCap = /market\s*cap|large\s*cap|mid\s*cap|small\s*cap/.test(q);
  const sectors = [...new Set(loaded.map(r => r.sector).filter(Boolean))];
  const sector = sectors.find(s => q.includes(String(s).toLowerCase()));
  const hasRankingIntent = wantsHealthy || wantsLowDebt || wantsRoe || wantsCheap || wantsGrowth || wantsDividend || wantsMarketCap || /best|top|show|find|list|which/.test(q) || !!sector;

  if (hasRankingIntent) {
    let rows = withHealth.slice();
    const titleParts = [];
    const rationale = [];
    if (sector) {
      rows = rows.filter(r => String(r.sector || '').toLowerCase() === String(sector).toLowerCase());
      titleParts.push(sector);
      rationale.push(`sector = ${sector}`);
    }
    if (wantsLowDebt) {
      rows = rows.filter(r => r.de != null && r.de <= 1);
      titleParts.push('low debt');
      rationale.push('D/E <= 1');
    }
    if (wantsRoe) {
      rows = rows.filter(r => r.roe != null);
      titleParts.push('strong ROE');
      rationale.push('ROE available, ranked higher when stronger');
    }
    if (wantsHealthy) {
      rows = rows.filter(r => r.health >= 50 || (r.roe != null && r.roe >= 20));
      titleParts.push('healthy');
      rationale.push('health score from ROE, P/E, D/E, PEG and EPS growth');
    }
    if (wantsCheap) {
      rows = rows.filter(r => r.pe != null && r.pe > 0);
      titleParts.push('value');
      rationale.push('positive P/E, lower is better');
    }
    if (wantsGrowth) {
      rows = rows.filter(r => r.epsGrowth != null);
      titleParts.push('growth');
      rationale.push('EPS growth available, higher is better');
    }
    if (wantsDividend) {
      rows = rows.filter(r => r.dividendYield != null && r.dividendYield > 0);
      titleParts.push('dividend');
      rationale.push('dividend yield available, higher is better');
    }
    if (wantsMarketCap) {
      rows = rows.filter(r => r.marketCap != null);
      titleParts.push('market cap');
      rationale.push('market cap available');
    }

    rows = rows.map(r => {
      let score = r.health || 0;
      if (wantsRoe || wantsHealthy) score += Math.min(40, Number(r.roe || 0) / 2);
      if (wantsLowDebt) score += r.de != null ? Math.max(0, 25 - r.de * 15) : 0;
      if (wantsCheap) score += r.pe != null && r.pe > 0 ? Math.max(0, 35 - r.pe) : 0;
      if (wantsGrowth) score += Math.min(25, Math.max(0, Number(r.epsGrowth || 0)) / 2);
      if (wantsDividend) score += Math.min(20, Number(r.dividendYield || 0) * 4);
      if (wantsMarketCap) score += Math.min(20, Math.log10(Number(r.marketCap || 1)));
      return { ...r, localRank:+score.toFixed(1) };
    }).sort((a,b) => b.localRank - a.localRank).slice(0, 10);

    const cols = [...baseCols, { key:'localRank', label:'Rank' }];
    if (wantsHealthy || !titleParts.length) cols.push({ key:'health', label:'Health' });
    if (wantsRoe || wantsHealthy || !titleParts.length) cols.push({ key:'roe', label:'ROE', format:pct });
    if (wantsCheap || wantsHealthy || !titleParts.length) cols.push({ key:'pe', label:'P/E', format:num });
    if (wantsLowDebt || wantsHealthy || !titleParts.length) cols.push({ key:'de', label:'D/E', format:num });
    if (wantsGrowth) cols.push({ key:'epsGrowth', label:'EPS Gr', format:pct });
    if (wantsDividend) cols.push({ key:'dividendYield', label:'Div', format:pct });
    if (wantsMarketCap) cols.push({ key:'marketCap', label:'MCap', format:compactCap });

    const title = titleParts.length ? `${titleParts.join(' + ')} stocks loaded right now` : 'Best fundamental candidates loaded right now';
    const why = rationale.length ? rationale.join('; ') : 'ranked by local health score using available fundamentals';
    return `<p><strong>${escapeHTML(title)}</strong></p><p style="color:#94a3b8;font-size:12px">${escapeHTML(why)}.</p>${renderChatTable(rows, cols)}`;
  }

  const rows = withHealth.sort((a,b) => b.health - a.health).slice(0, 5);
  return `<p><strong>I can answer locally from loaded dashboard data.</strong></p><p style="color:#94a3b8;font-size:12px">Try questions like "healthy low debt best ROE", "cheap IT stocks", "dividend yield stocks", "compare TCS INFY", or "how is Lupin".</p>${renderChatTable(rows, [...baseCols, { key:'health', label:'Health' }, { key:'roe', label:'ROE', format:pct }, { key:'pe', label:'P/E', format:num }, { key:'de', label:'D/E', format:num }])}`;
}

function chatHtmlToText(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderChatNote(text) {
  return `<p style="color:#94a3b8;font-size:11px;margin-top:8px">${escapeHTML(text)}</p>`;
}

function normalizeChatAIHtml(raw) {
  let html = String(raw || '').trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!html) return '';
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    const paragraphs = escapeHTML(html).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return paragraphs || `<p>${escapeHTML(html)}</p>`;
  }
  return html
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<html[^>]*>|<\/html>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>|<\/body>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\sjavascript:/gi, '');
}

function compactFundamentalsForChatAI(question, fundamentals) {
  const q = String(question || '').toLowerCase();
  const terms = q.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const rows = fundamentals.map(row => {
    const hay = `${row.sym} ${row.name} ${row.sector}`.toLowerCase();
    let health = 0;
    if (row.roe != null && row.roe >= 20) health += 30;
    if (row.pe != null && row.pe > 0 && row.pe <= 25) health += 25;
    if (row.de != null && row.de <= 1) health += 20;
    if (row.peg != null && row.peg > 0 && row.peg <= 2) health += 15;
    if (row.epsGrowth != null && row.epsGrowth > 0) health += 10;
    let score = health + terms.reduce((sum, term) => sum + (hay.includes(term) ? 12 : 0), 0);
    if (/roe|health|quality|strong|best/.test(q) && row.roe != null) score += Math.min(30, row.roe / 2);
    if (/debt|d\/e/.test(q) && row.de != null) score += Math.max(0, 25 - row.de * 15);
    if (/cheap|undervalued|value|p\/?e/.test(q) && row.pe != null && row.pe > 0) score += Math.max(0, 35 - row.pe);
    if (/growth|eps/.test(q) && row.epsGrowth != null) score += Math.min(25, Math.max(0, row.epsGrowth) / 2);
    if (/dividend|yield|income/.test(q) && row.dividendYield != null) score += Math.min(20, row.dividendYield * 4);
    return { row: { ...row, health }, score };
  }).sort((a,b) => b.score - a.score).slice(0, 25).map(x => x.row);

  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== '')));
}

function ollamaAnswerLooksUnsafe(html, rows) {
  const text = chatHtmlToText(html).toLowerCase();
  if (!text) return true;
  const hasField = field => rows.some(row => row[field] != null);
  const forbidden = [
    /industry\s+(avg|average|peer|benchmark)/i,
    /\busd\b|\$\s*\d/i,
    /market\s+cap|market\s+capitali[sz]ation/i,
    /price\s+target|target\s+price/i,
    /analyst\s+rating|broker\s+rating/i,
  ];
  if (forbidden.some(re => re.test(text))) {
    if (!hasField('marketCap') && /market\s+cap|market\s+capitali[sz]ation/i.test(text)) return true;
    if (!hasField('priceTarget') && /price\s+target|target\s+price/i.test(text)) return true;
    if (/industry\s+(avg|average|peer|benchmark)|\busd\b|\$\s*\d|analyst\s+rating|broker\s+rating/i.test(text)) return true;
  }
  if (rows.length <= 1 && /\brank(ed)?\s+\d+\s+(out of|of)\s+\d+/i.test(text)) return true;

  const allowedLarge = [];
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const n = Number(value);
      if (Number.isFinite(n) && Math.abs(n) >= 100) allowedLarge.push(n);
    }
  }
  const nums = [...text.matchAll(/(?:rs\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)/gi)]
    .map(m => Number(String(m[1]).replace(/,/g, '')))
    .filter(n => Number.isFinite(n) && Math.abs(n) >= 100);
  const closeToAllowed = n => allowedLarge.some(a => Math.abs(a - n) <= Math.max(1, Math.abs(a) * 0.002));
  return nums.some(n => !closeToAllowed(n));
}

async function callOllamaChat(prompt, opts = {}) {
  const r = await fetch(OLLAMA_CHAT_ENDPOINT, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    signal: AbortSignal.timeout(opts.timeout || 190000),
    body:JSON.stringify({
      prompt,
      model: opts.model || undefined,
      maxOutputTokens: opts.maxOutputTokens || 800,
      timeoutMs: opts.timeoutMs || 180000,
    })
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || `Ollama HTTP ${r.status}`);
  return data;
}

async function sendChatMessage(){
  const input = document.getElementById('chat-input');
  const question = (input?.value || '').trim();
  if(!question || chatBusy) return;

  input.value = '';
  chatBusy = true;
  document.getElementById('chat-send-btn').disabled = true;
  addChatMsg('user', question);
  const thinking = addChatMsg('bot thinking', '⏳ Asking Ollama with dashboard context…');

  try {
    const fundamentals = buildFundamentalsContext();
    const localAnswer = localFundamentalsAnswer(question, fundamentals);
    const compactRows = compactFundamentalsForChatAI(question, fundamentals);
    const loadedCount = fundamentals.filter(r => r.pe != null || r.roe != null || r.eps != null).length;
    const prompt = [
      `Original user question: ${question}`,
      '',
      `Dashboard snapshot: ${fundamentals.length} stocks loaded, ${loadedCount} with fundamentals.`,
      'Relevant dashboard data as JSON. Use these values only:',
      JSON.stringify(compactRows, null, 0),
      '',
      'Local pre-filtered/suggested answer from dashboard logic:',
      chatHtmlToText(localAnswer).slice(0, 2500),
      '',
      'Answer as concise HTML. Prefer a short explanation plus a compact table when useful. Use Rs for prices, % for ROE/EPS growth/dividend yield, and D/E as ratio. Do not invent metrics, industry averages, market cap, targets, or missing values. If data is missing, say so.',
    ].join('\n');
    const data = await callOllamaChat(prompt, { maxOutputTokens: 800, timeoutMs: 180000 });
    const text = normalizeChatAIHtml(data.output_text || data.text || data.content?.filter(b=>b.type==='text').map(b=>b.text).join(''));
    thinking.remove();
    if (!text || ollamaAnswerLooksUnsafe(text, compactRows)) {
      addChatMsg('bot', `${localAnswer}${renderChatNote('Ollama responded, but the answer appeared to include values outside the dashboard data, so this deterministic local answer is shown instead.')}`);
    } else {
      addChatMsg('bot', text);
    }
  } catch(e) {
    thinking.remove();
    try {
      const localAnswer = localFundamentalsAnswer(question, buildFundamentalsContext());
      addChatMsg('bot', `${localAnswer}${renderChatNote(`Ollama unavailable via proxy: ${String(e.message || e)}`)}`);
    } catch(_) {
      addChatMsg('bot', '⚠️ Error: ' + String(e.message || e));
    }
  } finally {
    chatBusy = false;
    document.getElementById('chat-send-btn').disabled = false;
    input.focus();
  }
}
