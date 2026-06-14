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
const PROXY = (['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '3001')
  ? location.origin
  : 'http://localhost:3001';
const ETF_PREFS_ENDPOINT = `${PROXY}/etf-prefs`;
const ETF_STORAGE_KEY = 'stock-watcher-etf-symbols';
const ETF_FAVS_ENDPOINT = `${PROXY}/etf-favs`;
const ETF_FAV_STORAGE_KEY = 'stock-watcher-etf-favorites';
const STOCK_PREFS_ENDPOINT = `${PROXY}/stock-prefs`;
const STOCK_STORAGE_KEY = 'stock-watcher-stock-symbols';
const STOCK_FAVS_ENDPOINT = `${PROXY}/stock-favs`;
const STOCK_FAV_STORAGE_KEY = 'stock-watcher-stock-favorites';
const PAPER_TRADES_ENDPOINT = `${PROXY}/paper-trades`;

let STOCK_FAVORITES = new Set();
let ETF_FAVORITES = new Set();

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
  if (!Array.isArray(saved)) return;
  ETF_FAVORITES = new Set(saved.filter(s => typeof s === 'string').map(s => s.trim().toUpperCase()).filter(Boolean));
}

async function loadFavoriteStocks() {
  let saved = [];
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
  if (!Array.isArray(saved)) return;
  STOCK_FAVORITES = new Set(saved.filter(s => typeof s === 'string').map(s => s.trim().toUpperCase()).filter(Boolean));
}

async function loadSavedETFs() {
  let saved = [];
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
    try{ await fetchSymbolMetadata(newSymbols); }catch(e){console.warn('saved stocks metadata failed',e);}
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
  if (!Array.isArray(saved)) return;
  const newSymbols = [];
  for (const rawSym of saved) {
    // Support both plain strings and objects { sym, sector, cap }
    const sym = typeof rawSym === 'string'
      ? rawSym.trim().toUpperCase()
      : String(rawSym?.sym || '').trim().toUpperCase();
    if (!sym) continue;
    const sector = rawSym?.sector || 'Custom';
    const cap    = rawSym?.cap    || 'custom';
    if (MIDCAP_STOCKS.some(s=>s.sym===sym) || STOCK_ASSETS.some(e=>e.sym===sym) || STOCK_EXTRA_SYMBOLS.includes(sym)) continue;
    STOCK_EXTRA_SYMBOLS.push(sym);
    STOCK_ASSETS.push({ sym, name: sym, sector, cap });
    newSymbols.push(sym);
  }
  if (newSymbols.length && dataSource) {
    await fetchAdditionalSymbols(STOCK_ASSETS.map(e=>e.sym));
    try{ await fetchSymbolMetadata(newSymbols); }catch(e){console.warn('saved stocks metadata failed',e);}    
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

async function toggleStockFavorite(sym) {
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return;
  if (STOCK_FAVORITES.has(s)) STOCK_FAVORITES.delete(s);
  else STOCK_FAVORITES.add(s);
  await saveFavoriteStocks();
  renderTable();
}

async function toggleETFFavorite(sym) {
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return;
  if (ETF_FAVORITES.has(s)) ETF_FAVORITES.delete(s);
  else ETF_FAVORITES.add(s);
  await saveFavoriteETFs();
  renderETFSection();
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
  {sym:'TATAMOTORS', name:'Tata Motors',              sector:'Auto',         cap:'large'},
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
  {sym:'ZOMATO',     name:'Zomato',                   sector:'Food',         cap:'large'},
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
  {sym:'VARUNBEV',   name:'Varun Beverages',          sector:'FMCG',         cap:'large'},
  {sym:'GODREJCP',   name:'Godrej Consumer Products', sector:'FMCG',         cap:'large'},
  {sym:'DABUR',      name:'Dabur India',              sector:'FMCG',         cap:'large'},
  {sym:'MARICO',     name:'Marico',                   sector:'FMCG',         cap:'large'},
  {sym:'BERGEPAINT', name:'Berger Paints',            sector:'Chemicals',    cap:'large'},
  {sym:'TORNTPHARM', name:'Torrent Pharmaceuticals',  sector:'Pharma',       cap:'large'},
  {sym:'HAVELLS',    name:'Havells India',            sector:'Consumer',     cap:'large'},
  {sym:'LTIM',       name:'LTIMindtree',              sector:'IT',           cap:'large'},
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
  {sym:'MAZAGON',    name:'Mazagon Dock Shipbuilders', sector:'Defence',     cap:'large'},
  {sym:'NHPC',       name:'NHPC',                     sector:'Energy',       cap:'large'},
  {sym:'TATATECH',   name:'Tata Technologies',        sector:'IT',           cap:'large'},
  {sym:'PERSISTENT', name:'Persistent Systems',       sector:'IT',           cap:'large'},
  {sym:'BANKBARODA', name:'Bank of Baroda',           sector:'Banking',      cap:'large'},
  {sym:'ICICIGI',    name:'ICICI Lombard General Ins',sector:'Insurance',    cap:'large'},

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
  {sym:'GNFC',       name:'Gujarat Narmada Fert.',    sector:'Chemicals',    cap:'mid'},
  {sym:'GODREJIND',  name:'Godrej Industries',        sector:'Conglomerate', cap:'mid'},
  {sym:'GUJGASLTD',  name:'Gujarat Gas',              sector:'Energy',       cap:'mid'},
  {sym:'HDFCAMC',    name:'HDFC AMC',                 sector:'Finance',      cap:'mid'},
  {sym:'HONAUT',     name:'Honeywell Automation',     sector:'Engineering',  cap:'mid'},
  {sym:'IDFCFIRSTB', name:'IDFC First Bank',          sector:'Banking',      cap:'mid'},
  {sym:'IGL',        name:'Indraprastha Gas',         sector:'Energy',       cap:'mid'},
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
  {sym:'OBEROIRLTY', name:'Oberoi Realty',            sector:'Realty',       cap:'mid'},
  {sym:'OFSS',       name:'Oracle Financial Services',sector:'IT',           cap:'mid'},
  {sym:'PAGEIND',    name:'Page Industries',          sector:'Textile',      cap:'mid'},
  {sym:'PRICOLLTD',  name:'Pricol Ltd',               sector:'Auto',         cap:'mid'},
  {sym:'PETRONET',   name:'Petronet LNG',             sector:'Energy',       cap:'mid'},
  {sym:'PEL',        name:'Piramal Enterprises',      sector:'Finance',      cap:'mid'},
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
  {sym:'SUVENPHAR',  name:'Suven Pharmaceuticals',    sector:'Pharma',       cap:'mid'},
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
let apiKey     = '';
let stockData  = {};
let indexData  = {};
let marketUp   = null;
let marketOpen = null;
let paused     = false;
let countdownSec  = 60; // initialised before getRefreshInterval() is first called in startCountdown()
let countdownTimer = null;
let stockFilters   = new Set(); // empty = show all; multi-select AND logic
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
const sparklineData = {};  // sym -> normalised % array from /sparklines
const intradayData = {};   // sym -> short-term VWAP/EMA/RSI/ATR setup
let paperTrades = [];      // local paper trades loaded from proxy JSON file
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
const PORTFOLIO_INITIAL_CAPITAL = 500000;
const MAX_POSITION_EXPOSURE = 100000;
const TRADE_CAPITAL = Number(localStorage.getItem('trade-capital') || PORTFOLIO_INITIAL_CAPITAL);
const TRADE_RISK_PCT = Number(localStorage.getItem('trade-risk-pct') || 1);
const MIN_NET_PROFIT_PCT = 0.5;
const SIMULATION_STATE_KEY = 'stock-watcher-simulation-state';
const SIMULATION_MAX_OPEN = 20;
const SIMULATION_TOP_N = 10;
const BROKER_MODE_KEY = 'stock-watcher-broker-mode';
let simulationState = localStorage.getItem(SIMULATION_STATE_KEY) || 'off'; // off | running | settling
let simulationBusy = false;
let brokerMode = localStorage.getItem(BROKER_MODE_KEY) === 'zerodha_dry_run' ? 'zerodha_dry_run' : 'paper';

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
  ['index-bar','sector-section','main-section','mkt-status-bar',
   'refresh-btn','pause-btn','change-src-btn','source-indicator']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
}

function activateDashboard(src) {
  const sp = document.getElementById('source-panel'); if(sp) sp.style.display = 'none';
  const ib = document.getElementById('index-bar'); if(ib) ib.style.display = 'grid';
  ['sector-section','main-section'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='block'; });
  ['refresh-btn','pause-btn','change-src-btn','simulation-btn','broker-mode-btn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });
  updateSimulationButton();

  const si = document.getElementById('source-indicator');
  if(si) si.style.display = 'inline-block';
  if (src==='yahoo') { si.textContent='💜 Yahoo Finance'; si.className='source-indicator yahoo'; const msb=document.getElementById('mkt-status-bar'); if(msb) msb.style.display='flex'; }
  else if (src==='nse') { si.textContent='🏛️ NSE Direct'; si.className='source-indicator nse'; const msb=document.getElementById('mkt-status-bar'); if(msb) msb.style.display='flex'; }
  else { si.textContent='🤖 AI Mode'; si.className='source-indicator ai'; }

  fetchAll();
  startCountdown();
  // Background: check NSE index membership for quarterly rebalancing (cached 24h on proxy)
  refreshIndexMembership().catch(e => console.warn('[index-membership]', e.message));
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
    ce.textContent='✗ Cannot reach proxy. Run: node ticker_proxy.js';
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

async function fetchYahooStocks(firstLoad = false) {
  const symbols = MIDCAP_STOCKS.map(s=>s.sym);
  if (firstLoad) {
    document.getElementById('loading-msg').textContent = 'Fetching Yahoo Finance data…';
    document.getElementById('loading-sub').textContent = 'Source: query1.finance.yahoo.com/v8/finance/chart (crumb-free)';
    setProgress(15);
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
      showBgRefreshing(`Refreshing ${i+1}–${Math.min(i+batchSize, symbols.length)} of ${symbols.length}…`);
      setBgProgress(20 + (i / symbols.length) * 75);
    }

    try {
      const url = `${PROXY}/yahoo?symbols=${encodeURIComponent(batch.join(','))}`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const raw = await r.json();
      const quotes = raw?.quotes || {};
      let changed = false;
      for (const [sym, q] of Object.entries(quotes)) {
        if (!q) continue;
        marketOpen = (q.marketState || '').toUpperCase() === 'REGULAR';
        // Preserve previous valid values so a transient null/zero price from Yahoo
        // doesn't erase good data and cause sectors to disappear on refresh.
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
      // Render incrementally after each batch so UI stays live
      if (changed && !firstLoad) {
        renderMarketStatus();
        renderSectors();
        renderTable();
        if (currentView === 'etfs') renderETFSection();
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
    ce.textContent='✗ Cannot reach proxy. Run: node ticker_proxy.js';
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
    const seg  = (data.marketState||[]).find(s=>s.market==='Capital Market'||s.marketStatus);
    marketOpen = seg ? (seg.marketStatus||'').toLowerCase().includes('open') : null;
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
  if (!firstLoad) { renderTable(); renderSectors(); }
  if (firstLoad) setProgress(80);
  else setBgProgress(75);

  // Fill missing symbols
  const missing = MIDCAP_STOCKS.filter(s=>!stockData[s.sym]||stockData[s.sym].price===0);
  if (missing.length && missing.length<=15) {
    for (const s of missing) {
      try {
        const q  = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(s.sym)}`);
        const pd = q.priceInfo||{};
        stockData[s.sym] = { price:parseFloat(pd.lastPrice||0), change:parseFloat(pd.pChange||0), high52:parseFloat(pd.weekHighLow?.max||0), low52:parseFloat(pd.weekHighLow?.min||0), volume:0, open:parseFloat(pd.open||0), prevClose:parseFloat(pd.previousClose||0) };
        if (!firstLoad) renderTable();
      } catch(e) {}
      await new Promise(r=>setTimeout(r,120));
    }
  }
}

// ═══════════════════════════════════
//  AI MODE
// ═══════════════════════════════════
function connectAI() {
  const k=document.getElementById('api-key-input').value.trim();
  const ce=document.getElementById('connect-err-ai');
  if (!k.startsWith('sk-ant-')) { ce.textContent='Key should start with sk-ant-…'; return; }
  apiKey=k; dataSource='ai'; ce.textContent='';
  activateDashboard('ai');
}

async function callClaude(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:2000,
      tools:[{type:'web_search_20250305',name:'web_search'}],
      messages:[{role:'user',content:prompt}],
      system:'Return ONLY raw JSON with no markdown, no preamble, no backticks.' })
  });
  if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.error?.message||`HTTP ${r.status}`); }
  return r.json();
}

function extractJSON(data) {
  const txt=data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
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
    const d=await callClaude(`Current prices of: Nifty 50, Bank Nifty, Nifty Midcap 150, Nifty Smallcap 100.
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
      const d=await callClaude(`NSE stock prices for: ${syms}. Raw JSON only: {"SYMBOL":{"price":1234.5,"change":1.23,"high52":1500,"low52":900,"volume":1250000}}`);
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

  document.getElementById('refresh-btn').disabled = true;

  if (firstLoad) {
    // First load: show full blocking overlay
    document.getElementById('loading-overlay').classList.add('show');
    setProgress(5);
  } else {
    // Subsequent: show subtle top bar + pill only
    setBgProgress(3);
    showBgRefreshing('Refreshing data…');
  }

  try {
    if (dataSource === 'yahoo') {
      if (firstLoad) document.getElementById('loading-msg').textContent = 'Fetching indices from Yahoo Finance…';
      await fetchYahooIndices();
      renderIndices();
      renderSectors();
      if (firstLoad) setProgress(15);
      else setBgProgress(20);
      await fetchYahooStocks(firstLoad);
    } else if (dataSource === 'nse') {
      if (firstLoad) document.getElementById('loading-msg').textContent = 'Fetching NSE indices…';
      await fetchNSEMarketStatus();
      await fetchNSEIndices();
      renderIndices();
      renderSectors();
      if (firstLoad) setProgress(20);
      else setBgProgress(20);
      await fetchNSEStocks(firstLoad);
    } else {
      await fetchAIData(firstLoad);
    }

    // Only fetch ETF prices/NAV/sparklines when the ETF tab is active — avoids
    // flooding the proxy on every 60-second refresh after the tab has been visited.
    const etfSymsToFetch = currentView === 'etfs' ? ETF_ASSETS.map(e=>e.sym) : [];
    await fetchAdditionalSymbols(STOCK_ASSETS.map(e=>e.sym));
    if (etfSymsToFetch.length) {
      await fetchAdditionalSymbols(etfSymsToFetch, { force: true });
    }

    // Fetch ETF NAV/premium data (non-blocking — updates ETF table progressively)
    if (etfSymsToFetch.length) {
      fetchETFSummary(etfSymsToFetch).catch(e=>console.warn('ETF summary failed',e));
    }

    // Fetch sparklines: always include stocks; include ETFs only when on ETF tab
    const allSyms = [...etfSymsToFetch, ...STOCK_ASSETS.map(e=>e.sym), ...MIDCAP_STOCKS.map(s=>s.sym)];
    const uniqueSyms = [...new Set(allSyms)];
    fetchSparklines(uniqueSyms).catch(e => console.warn('fetchSparklines failed', e.message));
    const intradaySyms = [...new Set([
      ...MIDCAP_STOCKS.map(s=>s.sym),
      ...STOCK_ASSETS.map(s=>s.sym),
      ...ETF_ASSETS.map(e=>e.sym),
    ])];
    fetchIntradaySignals(intradaySyms).catch(e => console.warn('fetchIntradaySignals failed', e.message));

    if (firstLoad) setProgress(100);
    else setBgProgress(100);

    renderDashboard();

    // Kick off fundamentals fetch in the background — non-blocking so UI stays interactive.
    // On first load fetch all stocks; on refresh only re-fetch stocks whose fundamentals are missing.
    const allStockSyms = [...MIDCAP_STOCKS.map(s=>s.sym), ...STOCK_ASSETS.map(s=>s.sym)];
    const needsMeta = firstLoad
      ? allStockSyms
      : allStockSyms.filter(sym => {
          const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym);
          return !asset?.fund?.computed?.pe; // only refresh if we never got data
        });
    if (needsMeta.length) {
      fetchSymbolMetadata(needsMeta).catch(e => console.warn('bg metadata failed', e));
    }

    document.getElementById('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString('en-IN') + ' via ' +
      (dataSource === 'yahoo' ? 'Yahoo Finance' : dataSource === 'nse' ? 'NSE Direct' : 'AI');
    document.getElementById('status-bar').className = 'success';
    const loaded = MIDCAP_STOCKS.filter(s => stockData[s.sym] && stockData[s.sym].price > 0).length;
    document.getElementById('status-bar').textContent = `✓ ${loaded}/${MIDCAP_STOCKS.length} stocks loaded`;
  } catch(e) {
    document.getElementById('status-bar').className = 'error';
    document.getElementById('status-bar').textContent = '⚠ ' + e.message;
  } finally {
    document.getElementById('loading-overlay').classList.remove('show');
    hideBgRefreshing();
    document.getElementById('refresh-btn').disabled = false;
    bgRefreshActive = false;
    setProgress(0);
  }
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
  const bar=document.getElementById('mkt-status-bar');
  const txt=document.getElementById('mkt-status-text');
  if(marketOpen===null)return;
  if(marketOpen){bar.className='open';txt.textContent='● Market Open — Live prices';}
  else{bar.className='closed';txt.textContent='● Market Closed — Last traded prices';}
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
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const res = await fetch(`${PROXY}/sparklines?symbols=${encodeURIComponent(batch.join(','))}`);
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      if (!payload?.data) continue;
      let updated = false;
      for (const [sym, pts] of Object.entries(payload.data)) {
        if (pts && pts.length >= 2) { sparklineData[sym] = pts; updated = true; }
      }
      if (updated) renderDashboard();
    } catch(e) { console.warn('fetchSparklines batch failed', e.message); }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 200));
  }
}

async function fetchIntradaySignals(symbols) {
  if (!symbols || !symbols.length) return;
  const BATCH = 25;
  let anyUpdated = false;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const res = await fetch(`${PROXY}/intraday-signals?symbols=${encodeURIComponent(batch.join(','))}`);
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null);
      const data = payload?.data || {};
      let updated = false;
      for (const [sym, setup] of Object.entries(data)) {
        if (setup && setup.signal) { intradayData[sym] = setup; updated = true; }
      }
      if (updated) {
        anyUpdated = true;
        renderTable();
        if (currentView === 'etfs') renderETFSection();
        if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
      }
    } catch(e) { console.warn('fetchIntradaySignals batch failed', e.message); }
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, 200));
  }
  if (anyUpdated) runSimulationCycle({ allowEntries:true }).catch(e => console.warn('simulation cycle failed', e.message));
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
    if (bullish && sectorAvg > 0.25) score += 5;
    else if (bullish && sectorAvg < -0.25) score -= 5;
    else if (!bullish && sectorAvg < -0.25) score -= 5;
    else if (!bullish && sectorAvg > 0.25) score += 5;
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
  const maxLoss = TRADE_CAPITAL * (TRADE_RISK_PCT / 100);
  const byRisk = Math.floor(maxLoss / riskPerShare);
  const byCapital = Math.floor(TRADE_CAPITAL / Number(t.price));
  const qty = Math.max(0, Math.min(byRisk, byCapital));
  return { qty, riskPerShare:+riskPerShare.toFixed(2), maxLoss:+maxLoss.toFixed(0), capital:TRADE_CAPITAL, riskPct:TRADE_RISK_PCT };
}

function moneyINR(v) {
  return v != null && Number.isFinite(Number(v)) ? 'Rs ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '--';
}

function getCurrentTradePrice(sym) {
  const price = Number(intradayData[sym]?.price ?? stockData[sym]?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function getOpenPaperTrade(sym) {
  return paperTrades.find(t => t.status === 'open' && t.symbol === sym) || null;
}

function estimateZerodhaIntradayCharges(entryPrice, exitPrice, qty, side = 'buy') {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const quantity = Number(qty);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !Number.isFinite(quantity) || entry <= 0 || exit <= 0 || quantity <= 0) {
    return { total:0, totalPct:0, brokerage:0, stt:0, transaction:0, gst:0, sebi:0, stamp:0, turnover:0 };
  }
  const isShort = String(side || '').toLowerCase() === 'sell';
  const buyValue = (isShort ? exit : entry) * quantity;
  const sellValue = (isShort ? entry : exit) * quantity;
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
  const stt = sellValue * 0.00025;
  const transaction = turnover * 0.0000307;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = (brokerage + transaction + sebi) * 0.18;
  const total = brokerage + stt + transaction + sebi + stamp + gst;
  return {
    total:+total.toFixed(2),
    totalPct: buyValue > 0 ? +((total / buyValue) * 100).toFixed(3) : 0,
    brokerage:+brokerage.toFixed(2),
    stt:+stt.toFixed(2),
    transaction:+transaction.toFixed(2),
    gst:+gst.toFixed(2),
    sebi:+sebi.toFixed(2),
    stamp:+stamp.toFixed(2),
    turnover:+turnover.toFixed(2),
  };
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
  const slippagePct = isETFAsset(row) ? 0.04 : 0.08;
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
  const entry = Number(trade?.entryPrice);
  const price = Number(currentPrice);
  const qty = Number(trade?.qty);
  if (!Number.isFinite(entry) || !Number.isFinite(price) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return null;
  const side = String(trade.side || 'buy').toLowerCase();
  const grossPnl = side === 'sell' ? (entry - price) * qty : (price - entry) * qty;
  const charges = estimateZerodhaIntradayCharges(entry, price, qty, side);
  const pnl = grossPnl - charges.total;
  const pnlPct = (pnl / (entry * qty)) * 100;
  return { pnl:+pnl.toFixed(2), pnlPct:+pnlPct.toFixed(2), grossPnl:+grossPnl.toFixed(2), charges:charges.total, chargeBreakup:charges };
}

function getPaperPlanForSide(t, side, price) {
  const entry = Number(price);
  const rawTarget = Number(t?.target);
  const rawStop = Number(t?.stop);
  const atr = Number(t?.atr);
  const targetDistance = Number.isFinite(rawTarget) ? Math.abs(rawTarget - entry) : (Number.isFinite(atr) ? atr * 1.25 : entry * 0.008);
  const stopDistance = Number.isFinite(rawStop) ? Math.abs(entry - rawStop) : (Number.isFinite(atr) ? atr * 0.8 : entry * 0.005);
  if (side === 'sell') {
    return { target:+(entry - targetDistance).toFixed(2), stop:+(entry + stopDistance).toFixed(2) };
  }
  return { target:+(entry + targetDistance).toFixed(2), stop:+(entry - stopDistance).toFixed(2) };
}

function paperTradeExposure(trade) {
  const entry = Number(trade?.entryPrice);
  const qty = Number(trade?.qty);
  return Number.isFinite(entry) && Number.isFinite(qty) ? entry * qty : 0;
}

function getSuggestedPaperQty(t, side, price, availableCash = null, maxExposure = MAX_POSITION_EXPOSURE) {
  const entry = Number(price);
  if (!t || !Number.isFinite(entry) || entry <= 0) return { qty:0, riskPerShare:null, maxLoss:0, cashLimit:0, exposureCap:maxExposure };
  const plan = getPaperPlanForSide(t, side, entry);
  const riskPerShare = Math.abs(entry - Number(plan.stop));
  const maxLoss = TRADE_CAPITAL * (TRADE_RISK_PCT / 100);
  const cash = availableCash == null ? getPortfolioSummary().cashAvailable : availableCash;
  const exposureCap = Math.max(0, Math.min(Number(maxExposure) || MAX_POSITION_EXPOSURE, Math.max(0, cash)));
  const byRisk = riskPerShare > 0 ? Math.floor(maxLoss / riskPerShare) : 0;
  const byCash = Math.floor(exposureCap / entry);
  const qty = Math.max(0, Math.min(byRisk || byCash, byCash));
  return { qty, riskPerShare:+riskPerShare.toFixed(2), maxLoss:+maxLoss.toFixed(0), cashLimit:byCash, exposureCap:+exposureCap.toFixed(2), plan };
}

function getTradeDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'2-digit' });
}

function getPortfolioSummary() {
  let realized = 0;
  let unrealized = 0;
  let openExposure = 0;
  const dayPnl = {};
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
    initial: PORTFOLIO_INITIAL_CAPITAL,
    realized:+realized.toFixed(2),
    unrealized:+unrealized.toFixed(2),
    totalPnl:+totalPnl.toFixed(2),
    openExposure:+openExposure.toFixed(2),
    cashAvailable:+(PORTFOLIO_INITIAL_CAPITAL + realized - openExposure).toFixed(2),
    portfolioValue:+(PORTFOLIO_INITIAL_CAPITAL + totalPnl).toFixed(2),
    dayPnl,
  };
}

function computeClosedPaperPnl(trade) {
  const exit = Number(trade?.exitPrice);
  return getPaperTradePnl(trade, exit)?.pnl ?? null;
}

function portfolioValueClass(v) {
  const n = Number(v);
  return n >= 0 ? 'up' : 'down';
}

function renderPortfolioModal() {
  const body = document.getElementById('portfolio-modal-body');
  if (!body) return;
  const summary = getPortfolioSummary();
  const openCount = paperTrades.filter(t => t.status === 'open').length;
  const closedCount = paperTrades.filter(t => t.status === 'closed').length;
  const transactionRows = paperTrades.length ? paperTrades.map(trade => {
    const isOpen = trade.status === 'open';
    const current = isOpen ? getCurrentTradePrice(trade.symbol) : Number(trade.exitPrice);
    const livePnl = getPaperTradePnl(trade, current);
    const pnlObj = isOpen ? livePnl : { pnl:Number(trade.pnl), pnlPct:Number(trade.pnlPct), grossPnl:Number(trade.grossPnl), charges:Number(trade.charges), chargeBreakup:trade.chargeBreakup };
    const pnl = Number.isFinite(pnlObj?.pnl) ? pnlObj.pnl : computeClosedPaperPnl(trade);
    const cls = portfolioValueClass(pnl || 0);
    const brokerLabel = getBrokerLabel(trade);
    const brokerOrder = trade.broker?.entryOrder ? formatZerodhaOrder(trade.broker.entryOrder) : brokerLabel;
    const breakdown = pnlObj?.chargeBreakup || livePnl?.chargeBreakup || {};
    const entryCost = Number(breakdown.brokerage || 0) / 2 + Number(breakdown.stamp || 0);
    const exitCost = Number(pnlObj?.charges || 0) - entryCost;
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
      <td title="${escapeHTML(costTitle)}">${moneyINR(entryCost)}</td>
      <td title="${escapeHTML(costTitle)}">${moneyINR(exitCost)}</td>
      <td title="${escapeHTML(costTitle)}">${moneyINR(pnlObj?.charges)}</td>
      <td class="portfolio-pnl ${portfolioValueClass(grossPnl || 0)}">${moneyINR(grossPnl)}</td>
      <td class="portfolio-pnl ${cls}">${moneyINR(pnl)}</td>
      <td>${escapeHTML(isOpen ? getTradeDateKey(trade.openedAt) : getTradeDateKey(trade.closedAt))}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="15" style="color:var(--muted);text-align:center;padding:16px">No paper trades yet</td></tr>`;
  const dayRows = Object.entries(summary.dayPnl).length ? Object.entries(summary.dayPnl)
    .map(([day, pnl]) => `<tr><td>${escapeHTML(day)}</td><td class="portfolio-pnl ${portfolioValueClass(pnl)}">${moneyINR(pnl)}</td></tr>`)
    .join('') : `<tr><td colspan="2" style="color:var(--muted);text-align:center;padding:16px">No closed trades yet</td></tr>`;

  body.innerHTML = `
    <div class="portfolio-grid">
      <div class="portfolio-card"><div class="label">Initial capital</div><div class="value">${moneyINR(summary.initial)}</div></div>
      <div class="portfolio-card"><div class="label">Portfolio value</div><div class="value ${portfolioValueClass(summary.totalPnl)}">${moneyINR(summary.portfolioValue)}</div></div>
      <div class="portfolio-card"><div class="label">Total P&L</div><div class="value ${portfolioValueClass(summary.totalPnl)}">${moneyINR(summary.totalPnl)}</div></div>
      <div class="portfolio-card"><div class="label">Available cash</div><div class="value ${summary.cashAvailable >= 0 ? '' : 'down'}">${moneyINR(summary.cashAvailable)}</div></div>
      <div class="portfolio-card"><div class="label">Realized P&L</div><div class="value ${portfolioValueClass(summary.realized)}">${moneyINR(summary.realized)}</div></div>
      <div class="portfolio-card"><div class="label">Open P&L</div><div class="value ${portfolioValueClass(summary.unrealized)}">${moneyINR(summary.unrealized)}</div></div>
      <div class="portfolio-card"><div class="label">Open exposure</div><div class="value">${moneyINR(summary.openExposure)}</div></div>
      <div class="portfolio-card"><div class="label">Trades</div><div class="value">${openCount} open / ${closedCount} closed</div></div>
    </div>
    <div class="portfolio-section-title">Transactions</div>
    <div class="portfolio-table-wrap">
      <table class="portfolio-table">
        <thead><tr><th>Status</th><th>Mode</th><th>Broker</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit/Live</th><th>Capital</th><th>Entry Cost</th><th>Exit Cost</th><th>Total Cost</th><th>Gross P&L</th><th>Net P&L</th><th>Date</th></tr></thead>
        <tbody>${transactionRows}</tbody>
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

function openPortfolioModal() {
  renderPortfolioModal();
  const modal = document.getElementById('portfolio-modal');
  if (modal) modal.style.display = 'flex';
}

function closePortfolioModal(e) {
  if (e) e.stopPropagation();
  const modal = document.getElementById('portfolio-modal');
  if (modal) modal.style.display = 'none';
}

function isZerodhaDryRun() {
  return brokerMode === 'zerodha_dry_run';
}

function getBrokerLabel(trade) {
  const broker = trade?.broker;
  if (broker?.name === 'zerodha' && broker?.mode === 'dry-run') return 'Zerodha Dry';
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

function updateBrokerModeButton() {
  const btn = document.getElementById('broker-mode-btn');
  if (!btn) return;
  btn.classList.remove('broker-dry', 'primary');
  if (isZerodhaDryRun()) {
    btn.classList.add('broker-dry');
    btn.textContent = 'Zerodha Dry';
    btn.title = 'Dry-run mode: trades remain virtual and Zerodha order payloads are saved for validation.';
  } else {
    btn.textContent = 'Paper';
    btn.title = 'Paper mode: trades are virtual only.';
  }
}

function toggleBrokerMode() {
  brokerMode = isZerodhaDryRun() ? 'paper' : 'zerodha_dry_run';
  localStorage.setItem(BROKER_MODE_KEY, brokerMode);
  updateBrokerModeButton();
  renderTable();
  if (currentView === 'etfs') renderETFSection();
  if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
}

function setSimulationState(state) {
  simulationState = ['running', 'settling'].includes(state) ? state : 'off';
  localStorage.setItem(SIMULATION_STATE_KEY, simulationState);
  updateSimulationButton();
}

function updateSimulationButton() {
  const btn = document.getElementById('simulation-btn');
  if (!btn) return;
  const openSim = paperTrades.filter(t => t.status === 'open' && t.source === 'simulation').length;
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

function toggleSimulation() {
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

function isSimulationEntryWindow() {
  const { day, mins } = getIstClockParts();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 14 * 60 + 45;
}

function isSimulationEodSettlementTime() {
  const { day, mins } = getIstClockParts();
  return day === 0 || day === 6 || mins >= 15 * 60 + 20;
}

function getSimulationOpenTrades() {
  return paperTrades.filter(t => t.status === 'open' && t.source === 'simulation');
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

function getSimulationExitReason(trade, price) {
  if (!trade || !Number.isFinite(Number(price))) return null;
  const side = String(trade.side || 'buy').toLowerCase();
  const target = Number(trade.target);
  const stop = Number(trade.stop);
  if (side === 'sell') {
    if (Number.isFinite(target) && price <= target) return 'Simulation target';
    if (Number.isFinite(stop) && price >= stop) return 'Simulation stop';
  } else {
    if (Number.isFinite(target) && price >= target) return 'Simulation target';
    if (Number.isFinite(stop) && price <= stop) return 'Simulation stop';
  }
  if (isSimulationEodSettlementTime()) return 'Simulation EOD square-off';
  return null;
}

function getSimulationCandidates() {
  const universe = [
    ...MIDCAP_STOCKS.map((s, i) => ({ ...s, rank:i + 1, data:stockData[s.sym] || null })),
    ...STOCK_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + i + 1, data:stockData[s.sym] || null })),
    ...ETF_ASSETS.map((s, i) => ({ ...s, rank:MIDCAP_STOCKS.length + STOCK_ASSETS.length + i + 1, data:stockData[s.sym] || null, cap:'etf' })),
  ];
  return universe
    .map(row => {
      const t = intradayData[row.sym];
      const score = t ? adjustedTradeScore(row) : -999;
      const signal = adjustedTradeSignal(score);
      const guard = t ? getRiskGuard(row, t, score) : null;
      return { row, t, score, signal, guard };
    })
    .filter(item => {
      if (!item.t || item.signal !== 'buy') return false;
      if (!['ok', 'small'].includes(item.guard?.level)) return false;
      if (item.t.entryStatus === 'Wait') return false;
      if (getOpenPaperTrade(item.row.sym)) return false;
      if (!getCurrentTradePrice(item.row.sym)) return false;
      const etfSafety = getETFTradeSafety(item.row, item.t);
      if (!etfSafety.ok || etfSafety.warn) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SIMULATION_TOP_N);
}

async function closePaperTradeAtPrice(trade, exitPrice, reason, silent = false) {
  if (!trade?.id || !Number.isFinite(Number(exitPrice))) return false;
  try {
    await postPaperTrade('close', { id: trade.id, exitPrice, reason });
    await loadPaperTrades();
    renderTable();
    if (currentView === 'etfs') renderETFSection();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
    if (document.getElementById('fund-modal')?.style.display === 'flex') openFundModal(trade.symbol);
    return true;
  } catch (e) {
    if (!silent) alert(e.message || 'Could not close paper trade');
    else console.warn('auto close failed', trade.symbol, e.message);
    return false;
  }
}

async function runSimulationCycle({ allowEntries = true } = {}) {
  if (simulationBusy) return;
  const simOpen = getSimulationOpenTrades();
  if (simulationState === 'off' && !simOpen.length) return;
  simulationBusy = true;
  try {
    for (const trade of [...simOpen]) {
      const price = getCurrentTradePrice(trade.symbol);
      const reason = getSimulationExitReason(trade, price);
      if (reason) await closePaperTradeAtPrice(trade, price, reason, true);
    }

    const openAfterExits = getSimulationOpenTrades();
    if (simulationState === 'settling') {
      if (!openAfterExits.length) setSimulationState('off');
      return;
    }
    if (simulationState !== 'running' || !allowEntries || !isSimulationEntryWindow() || isSimulationEodSettlementTime()) return;

    let summary = getPortfolioSummary();
    const totalOpen = paperTrades.filter(t => t.status === 'open').length;
    let slots = Math.max(0, SIMULATION_MAX_OPEN - totalOpen);
    if (slots <= 0 || summary.cashAvailable <= 0) return;

    const candidates = getSimulationCandidates();
    for (let i = 0; i < candidates.length; i++) {
      const { row, t, score } = candidates[i];
      if (slots <= 0) break;
      summary = getPortfolioSummary();
      if (summary.cashAvailable <= 0) break;
      const price = getCurrentTradePrice(row.sym);
      const remainingCandidates = Math.max(1, candidates.length - i);
      const remainingSlots = Math.max(1, Math.min(slots, remainingCandidates));
      const allocation = Math.min(MAX_POSITION_EXPOSURE, summary.cashAvailable / remainingSlots);
      const suggestion = getSuggestedPaperQty(t, 'buy', price, summary.cashAvailable, allocation);
      const qty = Number(suggestion.qty || 0);
      if (qty <= 0) continue;
      const plan = suggestion.plan || getPaperPlanForSide(t, 'buy', price);
      await postPaperTrade('open', {
        symbol: row.sym,
        name: row.name || row.sym,
        side: 'buy',
        qty,
        entryPrice: price,
        target: plan.target,
        stop: plan.stop,
        signal: 'buy',
        score: Math.abs(score),
        rr: t.rr,
        source: 'simulation',
        brokerMode,
        assetType: isETFAsset(row) ? 'etf' : 'stock',
        reservedCapital:+(qty * price).toFixed(2),
        portfolioInitial:PORTFOLIO_INITIAL_CAPITAL,
        setup: ['Simulation', t.entryStatus, t.entryTrigger, ...(t.reasons || []).slice(0, 3)].filter(Boolean).join(' | '),
      });
      await loadPaperTrades();
      slots -= 1;
    }
    renderTable();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  } finally {
    simulationBusy = false;
    updateSimulationButton();
  }
}

async function loadPaperTrades() {
  try {
    const res = await fetch(PAPER_TRADES_ENDPOINT, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('paper-trades HTTP ' + res.status);
    const payload = await res.json().catch(() => null);
    paperTrades = Array.isArray(payload?.trades) ? payload.trades : [];
    if (simulationState === 'settling' && !getSimulationOpenTrades().length) {
      simulationState = 'off';
      localStorage.setItem(SIMULATION_STATE_KEY, simulationState);
    }
    updateSimulationButton();
    updateBrokerModeButton();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  } catch (e) {
    console.warn('loadPaperTrades failed', e.message);
    paperTrades = [];
  }
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

async function openPaperTrade(sym, side) {
  const t = intradayData[sym];
  const price = getCurrentTradePrice(sym);
  if (!t || !price) { alert('Trade setup is not loaded yet. Refresh once and try again.'); return; }
  if (getOpenPaperTrade(sym)) { alert('There is already an open paper trade for this stock. Exit it before opening another.'); return; }
  const asset = MIDCAP_STOCKS.find(s => s.sym === sym) || STOCK_ASSETS.find(s => s.sym === sym) || ETF_ASSETS.find(s => s.sym === sym) || { sym, name: sym };
  const portfolio = getPortfolioSummary();
  const suggestion = getSuggestedPaperQty(t, side, price, portfolio.cashAvailable);
  const qty = Number(suggestion.qty || 0);
  if (qty <= 0) { alert('Not enough available paper cash for this trade. Close another trade or reduce risk.'); return; }
  const score = adjustedTradeScore(asset);
  const sideScore = side === 'sell' ? -Math.abs(score) : Math.abs(score);
  const plan = suggestion.plan || getPaperPlanForSide(t, side, price);
  try {
    await postPaperTrade('open', {
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
      portfolioInitial:PORTFOLIO_INITIAL_CAPITAL,
      setup: [t.entryStatus, t.entryTrigger, ...(t.reasons || []).slice(0, 3)].filter(Boolean).join(' | '),
    });
    await loadPaperTrades();
    renderTable();
    if (currentView === 'etfs') renderETFSection();
    if (document.getElementById('portfolio-modal')?.style.display === 'flex') renderPortfolioModal();
  } catch (e) {
    alert(e.message || 'Could not open paper trade');
  }
}

async function closePaperTrade(id, sym) {
  const price = getCurrentTradePrice(sym);
  if (!price) { alert('Current price is not available. Refresh once and try again.'); return; }
  await closePaperTradeAtPrice({ id, symbol:sym }, price, 'Manual exit', false);
}

function renderPaperTradeControls(row, t) {
  const open = getOpenPaperTrade(row.sym);
  const price = getCurrentTradePrice(row.sym);
  if (open) {
    const pnl = getPaperTradePnl(open, price);
    const cls = pnl && pnl.pnl >= 0 ? 'up' : 'down';
    const brokerBadge = open.broker?.name === 'zerodha' ? '<span class="broker-badge">Zerodha dry</span>' : '';
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
  const modeHint = isZerodhaDryRun() ? 'Zerodha dry-run order will be saved; no live order is placed.' : 'Paper trade only.';
  return `<div class="paper-actions">
    <button class="paper-btn buy"${disabled} title="${escapeHTML(modeHint)} Auto qty from portfolio cash, ${TRADE_RISK_PCT}% risk, max Rs 1L per stock/ETF" onclick="event.stopPropagation();openPaperTrade('${escapeHTML(row.sym)}','buy')">Buy ${buyQty || ''}</button>
    <button class="paper-btn sell"${disabled} title="${escapeHTML(modeHint)} Auto qty from portfolio cash, ${TRADE_RISK_PCT}% risk, max Rs 1L per stock/ETF" onclick="event.stopPropagation();openPaperTrade('${escapeHTML(row.sym)}','sell')">Sell ${sellQty || ''}</button>
  </div>`;
}

function getRiskGuard(row, t, score = null) {
  if (!t) return { label:'Wait', level:'small', reason:'Trade setup is not loaded yet' };
  const signal = adjustedTradeSignal(score ?? adjustedTradeScore(row));
  const price = Number(t.price);
  const stop = Number(t.stop);
  const target = Number(t.target);
  const vwap = Number(t.vwap);
  const riskPct = price && stop ? (Math.abs(price - stop) / price) * 100 : null;
  const extensionPct = price && vwap ? (Math.abs(price - vwap) / price) * 100 : null;
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

  if ((t.rr != null && t.rr < 1.3) || liq.level === 'thin' || (riskPct != null && riskPct > 1.6) || (cost && !cost.ok)) {
    const why = [];
    if (t.rr != null && t.rr < 1.3) why.push(`R:R ${t.rr}`);
    if (liq.level === 'thin') why.push('thin liquidity');
    if (riskPct != null && riskPct > 1.6) why.push(`SL risk ${riskPct.toFixed(1)}%`);
    if (cost && !cost.ok) why.push(`net ${cost.netPct}% < ${cost.minNetPct}% after costs`);
    return { label:'Avoid', level:'avoid', reason:why.join(', ') };
  }

  if (extensionPct != null && extensionPct > 1.2 && t.entryStatus === 'Triggered') {
    return { label:'Chasing', level:'chasing', reason:`Price is ${extensionPct.toFixed(1)}% away from VWAP` };
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

function renderTradeContext(row, t) {
  const bits = [];
  if (t.entryStatus) bits.push(t.entryStatus);
  const rs = getRelativeStrength(t);
  if (rs != null) bits.push(`RS ${rs >= 0 ? '+' : ''}${rs}%`);
  const sectorAvg = sectorTrendCache[row.sector];
  if (sectorAvg != null) bits.push(`Sec ${sectorAvg >= 0 ? '+' : ''}${sectorAvg.toFixed(1)}%`);
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

function renderTradeCell(row) {
  const t = intradayData[row.sym];
  if (!t) return '<span style="color:var(--muted);font-size:12px">--</span>';
  const labels = { buy:'BUY', watch:'WATCH', hold:'HOLD', sell:'SELL' };
  const reason = (t.reasons || []).join(' | ');
  const score = adjustedTradeScore(row);
  const signal = adjustedTradeSignal(score);
  const guard = getRiskGuard(row, t, score);
  return `<div class="trade-cell" title="${escapeHTML(reason)}">
    <span class="risk-guard ${guard.level}" title="${escapeHTML(guard.reason)}">${guard.label}</span>
    <span class="signal-badge ${signal}">${labels[signal] || signal}</span>
    <span class="trade-score">Score ${score}</span>
    ${renderTradeContext(row, t)}
    ${renderPaperTradeControls(row, t)}
    <span class="indicator-mini">${escapeHTML(t.entryTrigger || '')}</span>
    <span class="indicator-mini">${escapeHTML((t.reasons || []).slice(0,2).join(', ') || '5m setup')}</span>
  </div>`;
}

function renderShortTargetCell(row) {
  const t = intradayData[row.sym];
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
  if (!t || t.target == null) return '<span style="color:var(--muted);font-size:12px">--</span>';
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

function setFilter(mode, el) {
  if (mode === 'all') {
    // "All" clears every active filter
    stockFilters.clear();
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

let currentView = 'stocks';
async function setView(view, el){
  currentView = view;
  document.querySelectorAll('#main-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  const sc = document.getElementById('stock-content'); if(sc) sc.style.display = view==='stocks' ? 'block' : 'none';
  const es = document.getElementById('etf-section'); if(es) es.style.display = view==='etfs' ? 'block' : 'none';
  if(view==='etfs'){
    await loadPresetETFs(); // no-op if already loaded
    populateETFSectorDropdown();
    await fetchAdditionalSymbols(ETF_ASSETS.map(e=>e.sym), { force: true });
    renderETFSection();
    fetchIntradaySignals(ETF_ASSETS.map(e=>e.sym)).catch(e=>console.warn('ETF intraday signals failed', e.message));
    // Pass 1: always fetch summary (returns, TER, family) — proxy serves from cache instantly
    fetchETFSummary(ETF_ASSETS.map(e=>e.sym)).catch(e=>console.warn('ETF summary failed',e));
    fetchSparklines(ETF_ASSETS.map(e=>e.sym)).catch(e=>console.warn('fetchSparklines failed', e.message));
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

function renderTable(){
  const search=document.getElementById('search-box').value.toLowerCase();
  let rows=[
    ...MIDCAP_STOCKS.map((s,i)=>({...s,rank:i+1,data:stockData[s.sym]||null})),
    ...STOCK_ASSETS.map((s,i)=>({...s,rank:MIDCAP_STOCKS.length+i+1,data:stockData[s.sym]||null}))
  ];
  const totalRows = rows.length;

  // ── Sector filter (from heatmap click) ──────────────────
  if(activeSectors.size) rows = rows.filter(r => activeSectors.has(r.sector));

  // ── Cap / signal filters — multi-select AND logic ───────────
  if (stockFilters.size) {
    const filterFns = {
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
      tradeable:r => { const t = intradayData[r.sym]; if(!t) return false; const g = getRiskGuard(r, t, adjustedTradeScore(r)); return ['ok','small'].includes(g.level); },
      hideavoid:r => { const t = intradayData[r.sym]; if(!t) return true; const g = getRiskGuard(r, t, adjustedTradeScore(r)); return !['avoid','invalid','chasing'].includes(g.level); },
      triggered:r => intradayData[r.sym]?.entryStatus === 'Triggered',
      neartrigger:r => intradayData[r.sym]?.entryStatus === 'Near trigger',
    };
    const stockGroups = [
      ['large', 'mid'],            // cap    — OR within group
      ['buy', 'sell', 'watch'],    // signal — OR within group
      ['strong', 'fair', 'weak'],  // health — OR within group
      ['gainers', 'losers'],       // movement — OR within group
      ['tradeable', 'hideavoid'],
      ['triggered', 'neartrigger'],
      ['favorite'],                // standalone
    ];
    rows = rows.filter(r =>
      stockGroups.every(group => {
        const active = group.filter(f => stockFilters.has(f));
        return !active.length || active.some(f => filterFns[f]?.(r) ?? true);
      })
    );
  }

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
  const{col,dir}=currentSort;
  rows.sort((a,b)=>{
    let av,bv;
    if(col==='symbol'){av=a.sym;bv=b.sym;}else if(col==='sector'){av=a.sector;bv=b.sector;}
    else if(col==='price'){av=a.data?.price||0;bv=b.data?.price||0;}
    else if(col==='target'){ av=a.fund?.priceTarget ?? (a.fund && a.fund.computed?.pe ? a.fund.computed.pe : 0); bv=b.fund?.priceTarget ?? (b.fund && b.fund.computed?.pe ? b.fund.computed.pe : 0); }
    else if(col==='trade'){av=adjustedTradeScore(a);bv=adjustedTradeScore(b);}
    else if(col==='sttarget'){av=intradayData[a.sym]?.target||0;bv=intradayData[b.sym]?.target||0;}
    else if(col==='change'){av=a.data?.change||0;bv=b.data?.change||0;}
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
  tbody.innerHTML='';
  if(!rows.length){tbody.innerHTML='<tr><td colspan="13" style="text-align:center;padding:32px;color:var(--muted)">No stocks match</td></tr>';return;}
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  for(const row of rows){
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d);
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><button class="fav-btn ${isStockFavorite(row.sym)?'active':''}" onclick="toggleStockFavorite('${row.sym}')">${isStockFavorite(row.sym)?'★':'☆'}</button></td>
      <td><div class="stock-name-cell" onclick="openFundModal('${row.sym}')" title="Open stock details" style="cursor:pointer"><span class="stock-symbol">${row.sym}</span><span class="stock-fullname">${row.name}</span>${STOCK_EXTRA_SYMBOLS.includes(row.sym)?'<button onclick="event.stopPropagation();openStockMetadataModal(\''+row.sym+'\')" style="display:inline;width:auto;margin-left:5px;padding:1px 5px;font-size:10px;border-radius:3px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);cursor:pointer;vertical-align:middle;line-height:1.4">edit</button>':''}</div></td>
      <td><span class="sector-badge">${row.sector}</span> <span class="sector-badge" style="background:${row.cap==='large'?'rgba(14,165,233,.15)':row.cap==='mid'?'rgba(167,139,250,.15)':row.cap==='etf'?'rgba(167,139,250,.06)':'rgba(167,139,250,.06)'};color:${row.cap==='large'?'var(--accent2)':row.cap==='mid'?'var(--accent3)':row.cap==='etf'?'var(--muted)':'var(--muted)'}">${row.cap==='large'?'L-Cap':row.cap==='mid'?'M-Cap':row.cap==='etf'?'ETF':'Custom'}</span></td>
      <td class="price-cell">${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</td>
     
      <td class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</td>
      <td class="hide-mobile" style="font-size:11px;color:var(--muted)">${d&&d.low52&&d.high52?'₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+' – ₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'--'}</td>
      <td class="hide-mobile hide-1200" style="font-size:12px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td>${renderTradeCell(row)}</td>
      <td>${renderShortTargetCell(row)}</td>
      <td><div class="health-stack">${renderHealthCell(row)}${renderResultVerdictBadge(row.sym)}</div></td>
      <td><div class="spark">${d?sparkBars(row.sym,chg):'<span style="color:var(--muted);font-size:11px">--</span>'}</div></td>
      <td><span class="signal-badge ${sig}">${sigLabels[sig]}</span></td>
	   <td class="target-cell">${renderTargetCell(row)}</td>`;
    tbody.appendChild(tr);
  }
  scheduleVisibleEventFlags(rows);
  syncStockScrollSizing();
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
  const pctHtml = pct != null ? `<span style="font-size:10px;color:${col};margin-left:4px;font-weight:700">${arrow}${pct}%</span>` : '';
  return `<div style="display:flex;align-items:center;gap:4px"><span style="font-weight:600;font-size:12px">${txt}</span>${pctHtml}</div>`;
}

async function fetchAdditionalSymbols(symbols, opts = {}){
  // Default: fetch only missing/failed symbols. With force=true, refresh supplied
  // symbols even when we already have a valid price.
  const force = !!opts.force;
  const toFetch = symbols.filter(sym => sym && (force || !stockData[sym] || !(stockData[sym].price > 0)));
  if(!toFetch.length) return;
  if(dataSource==='yahoo'){
    const batches=[];
    for(let i=0;i<toFetch.length;i+=25) batches.push(toFetch.slice(i,i+25));
    for(const batch of batches){
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
    }
  } else if(dataSource==='nse'){
    for(const sym of toFetch){
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

// Fetch NAV + expense ratio for ETFs
// Pass 1: /etf-summary  — proxy 30-day memory cache; all symbols in parallel, renders immediately
// Pass 2: /etf-nav      — NSE iNAV + Yahoo live price; batched/throttled, overlays nav/price/premium
async function fetchETFSummary(symbols) {
  if (!symbols || !symbols.length) return;
  console.log('[fetchETFSummary] called with', symbols.length, 'symbols, proxy:', PROXY);

  // ── Pass 1: cached summary (returns, expense ratio) — fire all batches in parallel ──
  // Proxy serves these from in-memory cache instantly; no need to throttle.
  const CACHE_BATCH = 50;
  try {
    const batches = [];
    for (let i = 0; i < symbols.length; i += CACHE_BATCH) batches.push(symbols.slice(i, i + CACHE_BATCH));
    await Promise.all(batches.map(async batch => {
      try {
        const res = await fetch(`${PROXY}/etf-summary?symbols=${encodeURIComponent(batch.join(','))}`);
        if (!res.ok) { console.warn('etf-summary HTTP', res.status); return; }
        const payload = await res.json().catch((err) => { console.warn('etf-summary JSON parse failed', err); return null; });
        const etfs = payload?.etfs || {};
        console.log('[etf-summary] response keys:', Object.keys(etfs).length, 'sample:', JSON.stringify(Object.values(etfs)[0]));
        for (const sym of Object.keys(etfs)) {
          const e = etfs[sym]; if (!e) continue;
          const asset = ETF_ASSETS.find(s => s.sym === sym);
          if (!asset) continue;
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
      } catch(e) { console.warn('fetchETFSummary /etf-summary batch failed', e.message); }
    }));
    renderETFSection();
  } catch(e) { console.warn('fetchETFSummary cache pass failed', e.message); }

  // ── Pass 2: NSE iNAV + Yahoo live price (overlays nav/price/premium, throttled) ──
  const NAV_BATCH = 8;
  for (let i = 0; i < symbols.length; i += NAV_BATCH) {
    const batch = symbols.slice(i, i + NAV_BATCH);
    try {
      const res = await fetch(`${PROXY}/etf-nav?symbols=${encodeURIComponent(batch.join(','))}`);
      if (!res.ok) throw new Error('etf-nav HTTP ' + res.status);
      const payload = await res.json().catch(() => null);
      const etfs = payload?.etfs || {};
      for (const sym of Object.keys(etfs)) {
        const e = etfs[sym]; if (!e) continue;
        const asset = ETF_ASSETS.find(s => s.sym === sym);
        if (!asset) continue;
        asset.etfData = asset.etfData || {};
        if (e.price    != null) { stockData[sym] = stockData[sym] || {}; stockData[sym].price = e.price; }
        if (e.nav      != null) asset.etfData.nav          = e.nav;
        asset.etfData.premium = e.navPremium != null ? e.navPremium : null;
        if (e.expRatio != null) asset.etfData.expenseRatio = e.expRatio;
        if (e.aum      != null) asset.etfData.aum          = e.aum;
        if (e.volume   != null) { stockData[sym] = stockData[sym] || {}; stockData[sym].volume = e.volume; }
        if (e.high52) { stockData[sym] = stockData[sym] || {}; stockData[sym].high52 = e.high52; }
        if (e.low52)  { stockData[sym] = stockData[sym] || {}; stockData[sym].low52  = e.low52;  }
      }
      scheduleETFRender(); // throttled: coalesces rapid NAV batch updates, doesn't block user interactions
    } catch(e) { console.warn('fetchETFSummary /etf-nav failed', e.message); }
    if (i + NAV_BATCH < symbols.length) await new Promise(r => setTimeout(r, 300));
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
    return { sym: String(sym).trim().toUpperCase(), sector: entry.sector || null, cap: entry.cap || null };
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

// Fetch fundamentals for any symbols — works for MIDCAP_STOCKS, STOCK_ASSETS, ETF_ASSETS
async function fetchSymbolMetadata(symbols){
  if(!symbols || !symbols.length) return;
  // Skip pure ETFs (cap==='etf') — fundamentals not meaningful for them
  symbols = symbols.filter(sym => {
    const etf = ETF_ASSETS.find(s => s.sym === sym);
    return !etf || etf.cap !== 'etf';
  });
  if(!symbols.length) return;
  // Fetch in batches of 10 to keep requests manageable
  const BATCH = 10;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    try {
      const res = await fetch(`${PROXY}/yahoo/summary?symbols=${encodeURIComponent(batch.join(','))}`);
      if (!res.ok) continue;
      const payload = await res.json().catch(()=>null);
      const metas = payload?.metas || {};
      for (const sym of Object.keys(metas)) {
        const m = metas[sym]; if (!m) continue;
        // Look up in all asset lists
        const asset = MIDCAP_STOCKS.find(s=>s.sym===sym)
                   || STOCK_ASSETS.find(s=>s.sym===sym)
                   || ETF_ASSETS.find(s=>s.sym===sym);
        if (!asset) continue;
        // Do NOT overwrite asset.sector — it holds hand-curated NSE sector names used
        // for the sector heatmap.  Store Yahoo's sector taxonomy separately if needed.
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
      // Re-render table after each batch so health scores appear incrementally
      renderTable();
    } catch (e) {
      console.warn('fetchSymbolMetadata batch failed', e);
    }
    // Small delay between batches to avoid hammering the proxy
    if (i + BATCH < symbols.length) await new Promise(r=>setTimeout(r, 300));
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

function openFundModal(sym){
  if(!sym) return;
  let asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const body = document.getElementById('fund-modal-body');
  if(!asset || !body){ closeFundModal(); return; }
  const f = asset.fund || {};
  const c = f.computed || {};
  function fmt(v){ if(v==null) return '--'; if(typeof v === 'number') return (Math.round((v + Number.EPSILON) * 100)/100).toString(); return String(v); }
  const roe = (c.roe!=null) ? (normPercent(c.roe).toFixed ? normPercent(c.roe).toFixed(2) : normPercent(c.roe)) : '--';
  const curPrice = stockData[sym]?.price ?? null;
  const pctDelta = (f.priceTarget && curPrice) ? (Math.round(((f.priceTarget - curPrice)/curPrice)*100) + '%') : '--';
  const html = `
    <div style="font-weight:700;margin-bottom:8px">${asset.sym} — ${asset.name || ''}</div>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Trailing EPS</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.eps)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Trailing P/E</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.pe)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Forward P/E</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.forwardPE)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Price/Book</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.priceToBook)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">ROE (%)</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${roe}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">D/E</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.de)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">PEG</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.peg)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Market Cap</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.marketCap)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Dividend Yield</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${f.dividendYield != null ? (f.dividendYield*100).toFixed(2)+'%' : '--'}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">50D Avg</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${f.fiftyDayAvg != null ? '₹'+f.fiftyDayAvg.toLocaleString('en-IN',{maximumFractionDigits:2}) : '--'}</td></tr>
      <tr><td style="padding:6px 8px;vertical-align:top">200D Avg</td><td style="padding:6px 8px">${f.twoHundredDayAvg != null ? '₹'+f.twoHundredDayAvg.toLocaleString('en-IN',{maximumFractionDigits:2}) : '--'}</td></tr>
    </table>
  `;
  body.innerHTML = html;
  document.getElementById('fund-modal').style.display = 'flex';
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
        console.warn('event flag fetch failed', row.sym, e.message);
      }
    }, 900 + idx * 1400);
  });
}

function openFundModal(sym){
  if(!sym) return;
  const asset = MIDCAP_STOCKS.find(s=>s.sym===sym) || STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const body = document.getElementById('fund-modal-body');
  if(!asset || !body){ closeFundModal(); return; }
  const title = document.getElementById('fund-modal-title');
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
    ? `RS ${rs == null ? '--' : (rs >= 0 ? '+' : '') + rs + '%'} | Sector ${sectorAvg == null ? '--' : (sectorAvg >= 0 ? '+' : '') + sectorAvg.toFixed(1) + '%'} | Gap ${t.gapPct ?? '--'}% (${t.gapQuality || '--'}) | PDH ${fmtMoney(t.prevDayHigh)} | PDL ${fmtMoney(t.prevDayLow)} | Pivot ${fmtMoney(t.pivot)} | 5D ${fmtMoney(t.low5)}-${fmtMoney(t.high5)} | 20D ${fmtMoney(t.low20)}-${fmtMoney(t.high20)} | Vol ${t.relVolume ?? '--'}x | R:R ${t.rr ?? '--'}`
    : '--';
  const liq = t ? getLiquidityInfo(t) : null;
  const timeWarn = getTimeWarning();
  const size = t ? getPositionSize(t) : null;
  const guard = t ? getRiskGuard(asset, t, adjustedScore) : null;
  const tradePlan = t ? `${guard?.label || '--'} (${guard?.reason || '--'}) | ${t.entryStatus || '--'} | ${t.entryTrigger || '--'} | ${t.invalidation || '--'} | ${liq?.label || 'Liq --'} ${liq?.tradedCr ?? '--'}cr | ${timeWarn.label} | Qty ${size ? size.qty : '--'} (risk Rs ${size ? size.maxLoss : '--'})` : '--';
  const openTrade = getOpenPaperTrade(sym);
  const paperPnl = openTrade ? getPaperTradePnl(openTrade, getCurrentTradePrice(sym)) : null;
  const paperTradeText = openTrade
    ? `${String(openTrade.side || '').toUpperCase()} ${openTrade.qty || '--'} @ ${moneyINR(openTrade.entryPrice)} | Target ${moneyINR(openTrade.target)} | SL ${moneyINR(openTrade.stop)} | Net P&L ${paperPnl ? moneyINR(paperPnl.pnl) + ' (' + paperPnl.pnlPct + '%), charges ' + moneyINR(paperPnl.charges) : '--'}`
    : 'No open paper trade';
  const brokerTradeText = openTrade?.broker?.name === 'zerodha'
    ? `Entry ${formatZerodhaOrder(openTrade.broker.entryOrder)} | Exit ${formatZerodhaOrder(openTrade.broker.exitOrder)}`
    : 'Paper only';
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
    detailRow('ETF Guard', etfSafety ? `${etfSafety.ok ? 'Allowed' : 'Avoid'}${etfSafety.warn ? ' - Warning' : ''} | ${etfSafety.reason || guard?.reason || '--'}` : '--'),
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
    detailRow('Trade Context', tradeContext),
    detailRow('Entry Plan', tradePlan),
    detailRow('VWAP', fmtMoney(t?.vwap)),
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
  `;
  document.getElementById('fund-modal').style.display = 'flex';
  loadStockNews(asset.sym, asset.name || asset.sym, isETF ? 'etf' : 'stock');
}

async function loadPresetETFs(){
  if (etfListLoaded) return; // already fetched — don't re-hit /etf-list on every tab switch
  try {
    const res = await fetch(`${PROXY}/etf-list`);
    if (res.ok) {
      const json = await res.json();
      const allEtfs = json.etfs || [];
      const newSymbols = [];
      for (const etf of allEtfs) {
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
        // Seed stockData directly from NSE batch (price, nav, navPremium, 52W)
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
      triggered:r => intradayData[r.sym]?.entryStatus === 'Triggered' && getETFTradeSafety(r, intradayData[r.sym]).ok,
      neartrigger:r => intradayData[r.sym]?.entryStatus === 'Near trigger' && getETFTradeSafety(r, intradayData[r.sym]).ok,
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
    else if(col==='target'){ av=a.fund?.priceTarget ?? 0; bv=b.fund?.priceTarget ?? 0; }
    else if(col==='change'){av=a.data?.change||0; bv=b.data?.change||0;}
    else if(col==='volume'){av=a.data?.volume||0; bv=b.data?.volume||0;}
    else if(col==='nav'){av=a.etfData?.nav??-1; bv=b.etfData?.nav??-1;}
    else if(col==='premium'){av=a.etfData?.premium??-999; bv=b.etfData?.premium??-999;}
    else if(col==='1m'){av=a.etfData?.oneMonthReturn??-999; bv=b.etfData?.oneMonthReturn??-999;}
    else if(col==='1y'){av=a.etfData?.oneYearReturn??-999; bv=b.etfData?.oneYearReturn??-999;}
    else if(col==='3y'){av=a.etfData?.threeYearReturn??-999; bv=b.etfData?.threeYearReturn??-999;}
    else if(col==='trade'){av=adjustedTradeScore(a); bv=adjustedTradeScore(b);}
    else if(col==='sttarget'){av=intradayData[a.sym]?.target||0; bv=intradayData[b.sym]?.target||0;}
    else {av=a.rank; bv=b.rank;}
    return typeof av==='string' ? dir*av.localeCompare(bv) : dir*(av-bv);
  });
  rows = rows.map((row,i)=>({ ...row, rank:i+1 }));

  tbody.innerHTML='';
  if(!rows.length){
    const note = etfFilters.size === 0
      ? 'No ETFs loaded yet. Use the button above to load ETF presets or add a symbol.'
      : 'No ETFs match the selected filter combination.';
    tbody.innerHTML=`<tr><td colspan="16" style="text-align:center;padding:24px;color:var(--muted)">${note}</td></tr>`;
    if(status) status.textContent='0 ETFs loaded';
    return;
  }
  if(status) status.textContent=`${rows.length} ETF${rows.length===1?'':'s'} loaded`;
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  // Build entire tbody as one HTML string — single DOM write instead of 326 appends
  tbody.innerHTML = rows.map(row => {
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d),fav=isETFFavorite(row.sym);
    return `<tr>
      <td><button class="fav-btn ${fav?'active':''}" onclick="toggleETFFavorite('${row.sym}')">${fav?'★':'☆'}</button></td>
      <td><div class="stock-name-cell etf-name-cell"><button class="stock-name-link" type="button" onclick="event.stopPropagation();openFundModal('${escapeHTML(row.sym)}')" title="Open ETF details"><span class="stock-symbol">${escapeHTML(row.sym)}</span><span class="stock-fullname">${escapeHTML(row.name)}</span>${(row.fundFamily||row.etfData?.fundFamily)?`<span class="etf-family">${escapeHTML(row.fundFamily||row.etfData.fundFamily)}</span>`:''}</button></div></td>
      <td class="price-cell">${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</td>
      <td class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</td>
      <td class="hide-mobile" style="font-size:11px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td class="hide-mobile hide-1200" style="font-size:11px;color:var(--muted)">${d&&d.low52&&d.high52?'₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+' – ₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'--'}</td>
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

function renderDashboard(){ renderIndices(); renderSectors(); renderTable(); syncStockScrollSizing(); if (currentView === 'etfs') { renderETFSection(); syncETFScrollSizing(); } }

document.addEventListener('DOMContentLoaded', async () => {
  initStockTableScroll();
  initETFTableScroll();
  updateSimulationButton();
  updateBrokerModeButton();
  document.querySelectorAll('.source-card').forEach(card => {
    const src = card.dataset.source;
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSource(src);
      }
    });
  });

  await loadFavoriteETFs();
  await loadFavoriteStocks();
  await loadPaperTrades();
  await loadSavedETFs();
  await loadSavedStocks();
});

// ═══════════════════════════════════
//  FUNDAMENTALS CHAT BOT
// ═══════════════════════════════════
let chatApiKey = localStorage.getItem('fund-chat-key') || apiKey || '';
let chatOpen = false;
let chatBusy = false;

function toggleFundChat(){
  chatOpen = !chatOpen;
  const panel = document.getElementById('fund-chat-panel');
  panel.classList.toggle('open', chatOpen);
  if(chatOpen){
    // Sync key from AI mode if available
    if(!chatApiKey && apiKey) { chatApiKey = apiKey; localStorage.setItem('fund-chat-key', chatApiKey); }
    const keyRow = document.getElementById('chat-key-row');
    if(keyRow) keyRow.style.display = chatApiKey ? 'none' : 'flex';
    document.getElementById('chat-input')?.focus();
  }
}

function saveChatKey(){
  const val = document.getElementById('chat-api-key')?.value.trim();
  if(!val || !val.startsWith('sk-ant-')){ alert('Key must start with sk-ant-…'); return; }
  chatApiKey = val;
  localStorage.setItem('fund-chat-key', chatApiKey);
  document.getElementById('chat-key-row').style.display = 'none';
  addChatMsg('bot', '✓ API key saved. Now ask me anything about stock fundamentals!');
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
    });
  }
  return rows;
}

async function sendChatMessage(){
  const input = document.getElementById('chat-input');
  const question = (input?.value || '').trim();
  if(!question || chatBusy) return;

  if(!chatApiKey){
    document.getElementById('chat-key-row').style.display = 'flex';
    addChatMsg('bot', '⚠️ Please enter your Anthropic API key above first.');
    return;
  }

  input.value = '';
  chatBusy = true;
  document.getElementById('chat-send-btn').disabled = true;
  addChatMsg('user', question);
  const thinking = addChatMsg('bot thinking', '⏳ Analysing fundamentals…');

  try {
    const fundamentals = buildFundamentalsContext();
    const loadedCount = fundamentals.filter(r=>r.pe||r.roe||r.eps).length;

    const systemPrompt = `You are a sharp Indian equity analyst assistant embedded in an NSE stock dashboard.
You have access to live fundamentals data for ${fundamentals.length} stocks (${loadedCount} with full data).
Answer questions concisely using the provided data. 
- For rankings/comparisons, show a compact HTML table with relevant columns.
- For single stock analysis, give a brief paragraph + key metrics table.
- Use ₹ for prices. ROE and EPS growth are in %. D/E is ratio.
- Health scoring: ROE>20 = strong, P/E<20 = value, D/E<1 = low debt, PEG<2 = growth at value.
- If fundamentals data is missing (null) for a stock, say so.
- Keep responses concise — max 300 words or 10 table rows.
- Return plain HTML only (no markdown, no backticks). Tables should use basic inline styles.`;

    const userPrompt = `Fundamentals data (JSON array):
${JSON.stringify(fundamentals, null, 0)}

User question: ${question}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': chatApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if(!resp.ok){
      const err = await resp.json().catch(()=>({}));
      throw new Error(err.error?.message || 'API error ' + resp.status);
    }

    const data = await resp.json();
    const text = data.content?.filter(b=>b.type==='text').map(b=>b.text).join('') || 'No response.';
    thinking.remove();
    addChatMsg('bot', text);
  } catch(e) {
    thinking.remove();
    addChatMsg('bot', '⚠️ Error: ' + e.message);
  } finally {
    chatBusy = false;
    document.getElementById('chat-send-btn').disabled = false;
    input.focus();
  }
}
