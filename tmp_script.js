
// ═══════════════════════════════════
//  CONFIG
// ═══════════════════════════════════
const REFRESH_INTERVAL = 300; // refresh every 300 seconds (5 minutes)
const PROXY = 'http://localhost:3001';
const ETF_PREFS_ENDPOINT = `${PROXY}/etf-prefs`;
const ETF_STORAGE_KEY = 'stock-watcher-etf-symbols';
const ETF_FAVS_ENDPOINT = `${PROXY}/etf-favs`;
const ETF_FAV_STORAGE_KEY = 'stock-watcher-etf-favorites';
const STOCK_PREFS_ENDPOINT = `${PROXY}/stock-prefs`;
const STOCK_STORAGE_KEY = 'stock-watcher-stock-symbols';
const STOCK_FAVS_ENDPOINT = `${PROXY}/stock-favs`;
const STOCK_FAV_STORAGE_KEY = 'stock-watcher-stock-favorites';

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
    if (typeof rawSym !== 'string') continue;
    const sym = rawSym.trim().toUpperCase();
    if (!sym) continue;
    if (MIDCAP_STOCKS.some(s=>s.sym===sym) || STOCK_ASSETS.some(e=>e.sym===sym) || STOCK_EXTRA_SYMBOLS.includes(sym)) continue;
    STOCK_EXTRA_SYMBOLS.push(sym);
    STOCK_ASSETS.push({ sym, name: sym, sector: 'Custom', cap: 'custom' });
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
let countdownSec  = REFRESH_INTERVAL;
let countdownTimer = null;
let currentFilter  = 'all';
let currentSort    = { col:'change', dir:-1 };
let etfFilter      = 'all';
let etfSort        = { col:'change', dir:-1 };
let etfSearch      = '';
let targetFilter   = 'all';
let activeSectors  = new Set();   // sectors clicked in heatmap, empty = show all (supports multi-select)
let EXTRA_SYMBOLS = []; // user-added ETF/custom symbols (keeps track to avoid duplicates)
let ETF_ASSETS = [];
let STOCK_EXTRA_SYMBOLS = [];
let STOCK_ASSETS = [];

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
  dataSource=null; stockData={}; indexData={};
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
  ['refresh-btn','pause-btn','change-src-btn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='flex'; });

  const si = document.getElementById('source-indicator');
  if(si) si.style.display = 'inline-block';
  if (src==='yahoo') { si.textContent='💜 Yahoo Finance'; si.className='source-indicator yahoo'; const msb=document.getElementById('mkt-status-bar'); if(msb) msb.style.display='flex'; }
  else if (src==='nse') { si.textContent='🏛️ NSE Direct'; si.className='source-indicator nse'; const msb=document.getElementById('mkt-status-bar'); if(msb) msb.style.display='flex'; }
  else { si.textContent='🤖 AI Mode'; si.className='source-indicator ai'; }

  fetchAll();
  startCountdown();
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

async function fetchYahooStocks() {
  const symbols = MIDCAP_STOCKS.map(s=>s.sym);
  // Proxy fetches concurrently via v8/chart — send all at once, proxy handles batching
  document.getElementById('loading-msg').textContent = 'Fetching Yahoo Finance data…';
  document.getElementById('loading-sub').textContent = 'Source: query1.finance.yahoo.com/v8/finance/chart (crumb-free)';
  setProgress(15);

  const batchSize = 25;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    document.getElementById('loading-msg').textContent =
      `Fetching Yahoo Finance… (${i+1}–${Math.min(i+batchSize, symbols.length)} of ${symbols.length})`;
    setProgress(15 + ((i / symbols.length) * 75));

    try {
      const url = `${PROXY}/yahoo?symbols=${encodeURIComponent(batch.join(','))}`;
      const r   = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const raw = await r.json();
      // Proxy returns { ok: true, quotes: { SYMBOL: { price, change, ... } } }
      const quotes = raw?.quotes || {};
      for (const [sym, q] of Object.entries(quotes)) {
        if (!q) continue;
        marketOpen = (q.marketState || '').toUpperCase() === 'REGULAR';
        stockData[sym] = {
          price    : q.price   || 0,
          change   : q.change  || 0,
          high52   : q.high52  || 0,
          low52    : q.low52   || 0,
          volume   : q.volume  || 0,
          open     : q.open    || 0,
          prevClose: q.prevClose || 0,
        };
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

async function fetchNSEStocks() {
  document.getElementById('loading-msg').textContent = 'Fetching Nifty Midcap 150 from NSE…';
  document.getElementById('loading-sub').textContent = 'Source: nseindia.com/api/equity-stockIndices';
  setProgress(20);
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
  setProgress(80);
  // Fill missing
  const missing = MIDCAP_STOCKS.filter(s=>!stockData[s.sym]||stockData[s.sym].price===0);
  if (missing.length && missing.length<=15) {
    for (const s of missing) {
      try {
        const q  = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(s.sym)}`);
        const pd = q.priceInfo||{};
        stockData[s.sym] = { price:parseFloat(pd.lastPrice||0), change:parseFloat(pd.pChange||0), high52:parseFloat(pd.weekHighLow?.max||0), low52:parseFloat(pd.weekHighLow?.min||0), volume:0, open:parseFloat(pd.open||0), prevClose:parseFloat(pd.previousClose||0) };
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

async function fetchAIData() {
  document.getElementById('loading-msg').textContent='Fetching indices via AI…';
  setProgress(10);
  try {
    const d=await callClaude(`Current prices of: Nifty 50, Bank Nifty, Nifty Midcap 150, Nifty Smallcap 100.
Return raw JSON only: {"nifty50":{"price":24500,"change":0.45},"banknifty":{"price":52000,"change":-0.2},"midcap":{"price":12500,"change":0.3},"smallcap":{"price":8900,"change":0.15}}`);
    const p=extractJSON(d); if(p) indexData=p;
  } catch(e){console.warn('AI indices:',e.message);}
  setProgress(20);

  const batches=[];
  for (let i=0;i<MIDCAP_STOCKS.length;i+=20) batches.push(MIDCAP_STOCKS.slice(i,i+20));
  for (let bi=0;bi<batches.length;bi++) {
    const batch=batches[bi];
    document.getElementById('loading-msg').textContent=`AI fetch batch ${bi+1}/${batches.length}…`;
    document.getElementById('loading-sub').textContent=batch.map(s=>s.sym).join(', ');
    setProgress(20 + ((bi+1)/batches.length)*70);
    const syms=batch.map(s=>s.sym).join(', ');
    try {
      const d=await callClaude(`NSE stock prices for: ${syms}. Raw JSON only: {"SYMBOL":{"price":1234.5,"change":1.23,"high52":1500,"low52":900,"volume":1250000}}`);
      const p=extractJSON(d); if(p) Object.assign(stockData,p);
    } catch(e){console.warn(`AI batch ${bi+1}:`,e);}
    if (bi<batches.length-1) await new Promise(r=>setTimeout(r,400));
  }
}

// ═══════════════════════════════════
//  UNIFIED FETCH
// ═══════════════════════════════════
async function fetchAll() {
  if (!dataSource) return;
  document.getElementById('loading-overlay').classList.add('show');
  document.getElementById('refresh-btn').disabled=true;
  setProgress(5);
  try {
    if (dataSource==='yahoo') {
      document.getElementById('loading-msg').textContent='Fetching indices from Yahoo Finance…';
      await fetchYahooIndices();
      await fetchYahooStocks();
    } else if (dataSource==='nse') {
      document.getElementById('loading-msg').textContent='Fetching NSE indices…';
      await fetchNSEMarketStatus();
      await fetchNSEIndices();
      await fetchNSEStocks();
    } else {
      await fetchAIData();
    }
    await fetchAdditionalSymbols([...ETF_ASSETS.map(e=>e.sym), ...STOCK_ASSETS.map(e=>e.sym)]);
    setProgress(100);
    renderDashboard();
    document.getElementById('last-update').textContent = 'Updated: '+new Date().toLocaleTimeString('en-IN')+' via '+
      (dataSource==='yahoo'?'Yahoo Finance':dataSource==='nse'?'NSE Direct':'AI');
    document.getElementById('status-bar').className='success';
    const loaded=MIDCAP_STOCKS.filter(s=>stockData[s.sym]&&stockData[s.sym].price>0).length;
    document.getElementById('status-bar').textContent=`✓ ${loaded}/${MIDCAP_STOCKS.length} stocks loaded`;
  } catch(e) {
    document.getElementById('status-bar').className='error';
    document.getElementById('status-bar').textContent='⚠ '+e.message;
  } finally {
    document.getElementById('loading-overlay').classList.remove('show');
    document.getElementById('refresh-btn').disabled=false;
    setProgress(0);
  }
}

// ═══════════════════════════════════
//  COUNTDOWN
// ═══════════════════════════════════
function startCountdown() {
  clearInterval(countdownTimer);
  countdownSec=REFRESH_INTERVAL;
  countdownTimer=setInterval(()=>{
    if(paused) return;
    countdownSec--;
    const pct=(countdownSec/REFRESH_INTERVAL)*100;
    document.getElementById('countdown-fill').style.width=pct+'%';
    document.getElementById('countdown-txt').textContent=countdownSec+'s';
    if(countdownSec<=0){countdownSec=REFRESH_INTERVAL;fetchAll();}
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
  const sectors={};
  for(const s of MIDCAP_STOCKS){const d=stockData[s.sym];if(!d||d===null)continue;if(!sectors[s.sector])sectors[s.sector]=[];sectors[s.sector].push(d.change||0);}
  const avgs=Object.entries(sectors).map(([n,cs])=>({name:n,avg:cs.reduce((a,b)=>a+b,0)/cs.length,count:cs.length})).sort((a,b)=>b.avg-a.avg);
  const grid=document.getElementById('sector-grid');grid.innerHTML='';
  for(const s of avgs){
    const intensity=Math.min(Math.abs(s.avg)/3,1);
    const isSelected = activeSectors.has(s.name);
    const tile=document.createElement('div');
    tile.className='sector-tile' + (isSelected ? ' sector-selected' : '');
    tile.style.background=s.avg>=0?`rgba(16,185,129,${.08+intensity*.25})`:`rgba(244,63,94,${.08+intensity*.25})`;
    tile.style.borderColor=isSelected?'var(--text)':(s.avg>=0?`rgba(16,185,129,${.15+intensity*.4})`:`rgba(244,63,94,${.15+intensity*.4})`);
    tile.style.outline = isSelected ? '2px solid var(--text)' : 'none';
    tile.style.cursor = 'pointer';
    tile.innerHTML=`<div class="sector-name">${s.name} <span style="opacity:.5;font-size:10px">${s.count}</span></div><div class="sector-chg" style="color:${s.avg>=0?'var(--green)':'var(--red)'}">${s.avg>=0?'+':''}${s.avg.toFixed(2)}%</div>`;
    tile.onclick = () => {
      if (activeSectors.has(s.name)) activeSectors.delete(s.name);
      else activeSectors.add(s.name);
      // When user selects any sector(s), ensure the 'All' filter is active
      if (activeSectors.size) {
        const allBtn = document.getElementById('filter-all');
        if (allBtn) setFilter('all', allBtn);
        else currentFilter = 'all';
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

function sparkBars(change){
  const trend=change>0?1:-1;
  const bars=[0,1,2,3,4].map(i=>Math.max(20,Math.min(100,100+trend*i*4+(Math.random()-.5)*16)));
  const mx=Math.max(...bars),mn=Math.min(...bars),rng=mx-mn||1;
  return bars.map((v,i)=>`<div class="spark-bar" style="height:${Math.round(((v-mn)/rng)*22)+6}px;background:${change>=0?'var(--green)':'var(--red)'};opacity:${.4+i*.15}"></div>`).join('');
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

function setFilter(mode,el){
  currentFilter=mode;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderTable();
}

function setTargetFilter(mode, el){
  targetFilter = mode || 'all';
  document.querySelectorAll('.target-filter-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  renderTable();
  renderETFSection();
}

function getTargetDeltaPct(row){
  const sym = row.sym;
  const asset = STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const target = asset?.fund?.priceTarget ?? null;
  const price = row.data?.price ?? null;
  if(target==null || !price) return null;
  return ((target - price)/price)*100;
}

function setETFFilter(mode,el){
  etfFilter = mode;
  document.querySelectorAll('#etf-controls-bar .filter-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
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
    await loadPresetETFs();
    await fetchAdditionalSymbols(ETF_ASSETS.map(e=>e.sym));
    renderETFSection();
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

  // ── Sector filter (from heatmap click) ──────────────────
  if(activeSectors.size) rows = rows.filter(r => activeSectors.has(r.sector));

  // ── Cap / signal filters ─────────────────────────────────
  if(currentFilter==='favorite') rows=rows.filter(r=>isStockFavorite(r.sym));
  else if(currentFilter==='buy')        rows=rows.filter(r=>getSignal(r,r.data)==='buy');
  else if(currentFilter==='watch') rows=rows.filter(r=>getSignal(r,r.data)==='watch');
  else if(currentFilter==='sell')  rows=rows.filter(r=>getSignal(r,r.data)==='sell');
  else if(currentFilter==='large') rows=rows.filter(r=>r.cap==='large');
  else if(currentFilter==='mid')   rows=rows.filter(r=>r.cap==='mid');
  else if(currentFilter==='gainers') rows=rows.filter(r=>(r.data?.change||0)>0).sort((a,b)=>(b.data?.change||0)-(a.data?.change||0)).slice(0,20);
  else if(currentFilter==='losers')  rows=rows.filter(r=>(r.data?.change||0)<0).sort((a,b)=>(a.data?.change||0)-(b.data?.change||0)).slice(0,20);

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
    else if(col==='change'){av=a.data?.change||0;bv=b.data?.change||0;}
    else{av=a.rank;bv=b.rank;}
    return typeof av==='string'?dir*av.localeCompare(bv):dir*(av-bv);
  });

  const allD=[...MIDCAP_STOCKS.map(s=>stockData[s.sym]), ...STOCK_ASSETS.map(s=>stockData[s.sym])].filter(Boolean);
  document.getElementById('stat-gainers').textContent=allD.filter(d=>(d.change||0)>0).length+' gainers';
  document.getElementById('stat-losers').textContent=allD.filter(d=>(d.change||0)<0).length+' losers';
  document.getElementById('stat-signals').textContent=[...MIDCAP_STOCKS, ...STOCK_ASSETS].filter(s=>getSignal(s,stockData[s.sym])==='buy').length+' buy signals';

  const tbody=document.getElementById('stock-tbody');
  tbody.innerHTML='';
  if(!rows.length){tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--muted)">No stocks match</td></tr>';return;}
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  for(const row of rows){
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d);
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><button class="fav-btn ${isStockFavorite(row.sym)?'active':''}" onclick="toggleStockFavorite('${row.sym}')">${isStockFavorite(row.sym)?'★':'☆'}</button></td>
      <td style="color:var(--muted);font-size:12px">${row.rank}</td>
      <td><div class="stock-name-cell"><span class="stock-symbol">${row.sym}</span><span class="stock-fullname">${row.name}</span>${STOCK_EXTRA_SYMBOLS.includes(row.sym)?'<button class="meta-btn" style="margin-left:8px;padding:4px 6px;font-size:12px;border-radius:6px" onclick="openStockMetadataModal(\''+row.sym+'\')">✎</button>':''}</div></td>
      <td><span class="sector-badge">${row.sector}</span> <span class="sector-badge" style="background:${row.cap==='large'?'rgba(14,165,233,.15)':row.cap==='mid'?'rgba(167,139,250,.15)':row.cap==='etf'?'rgba(167,139,250,.06)':'rgba(167,139,250,.06)'};color:${row.cap==='large'?'var(--accent2)':row.cap==='mid'?'var(--accent3)':row.cap==='etf'?'var(--muted)':'var(--muted)'}">${row.cap==='large'?'L-Cap':row.cap==='mid'?'M-Cap':row.cap==='etf'?'ETF':'Custom'}</span></td>
      <td class="price-cell">${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</td>
      <td class="target-cell">${renderTargetCell(row)}</td>
      <td class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</td>
      <td class="hide-mobile" style="font-size:11px;color:var(--muted)">${d&&d.low52&&d.high52?'₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+' – ₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'--'}</td>
      <td class="hide-mobile" style="font-size:12px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td>${renderHealthCell(row)}</td>
      <td><div class="spark">${d?sparkBars(chg):'<span style="color:var(--muted);font-size:11px">--</span>'}</div></td>
      <td><span class="signal-badge ${sig}">${sigLabels[sig]}</span></td>`;
    tbody.appendChild(tr);
  }
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
  let asset = STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const score = computeHealthScore(asset);
  if(score == null){
    // fallback to existing market/52w visual
    return healthHTML(row.data);
  }
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  return `<button class="health-score-btn" onclick="openFundModal('${sym}')" title="Click to view fundamentals" style="background:${color};border:none;padding:6px 8px;border-radius:8px;color:var(--bg);font-weight:600;cursor:pointer">${score}</button>`;
}

function renderTargetCell(row){
  const sym = row.sym;
  let asset = STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
  const f = asset?.fund || {};
  const target = f.priceTarget ?? null;
  const price = row.data?.price ?? null;
  if(target==null) return '<span style="color:var(--muted);font-size:12px">--</span>';
  const pctRaw = (price && typeof price === 'number') ? Math.round(((target - price)/price)*100) : null;
  const pct = pctRaw == null ? null : Math.abs(pctRaw);
  const arrow = pctRaw == null ? '' : (pctRaw > 0 ? '▲' : (pctRaw < 0 ? '▼' : '–'));
  const col = pctRaw != null ? (pctRaw >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)';
  const txt = '₹' + Number(target).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pctHtml = pct != null ? `<span style="font-size:11px;color:${col};margin-left:6px;font-weight:700">${arrow} ${pct}%</span>` : '';
  return `<div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600">${txt}</span>${pctHtml}</div>`;
}

async function fetchAdditionalSymbols(symbols){
  const toFetch = symbols.filter(sym => !stockData[sym] && sym);
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
        if(q) stockData[sym] = { price: q.price||0, change: q.change||0, high52: q.high52||0, low52: q.low52||0, volume: q.volume||0, open: q.open||0, prevClose: q.prevClose||0 };
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

// Fetch sector / marketCap metadata for symbols and merge into STOCK_ASSETS
async function fetchSymbolMetadata(symbols){
  if(!symbols || !symbols.length) return;
  // Only fetch fundamentals/summary for stock assets (skip ETFs)
  symbols = (symbols || []).filter(sym => STOCK_ASSETS.some(s => s.sym === sym));
  if(!symbols.length) return;
  try {
    const res = await fetch(`${PROXY}/yahoo/summary?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!res.ok) return;
    const payload = await res.json().catch(()=>null);
    const metas = payload?.metas || {};
    for (const sym of Object.keys(metas)) {
      const m = metas[sym]; if (!m) continue;
      let idx = STOCK_ASSETS.findIndex(s=>s.sym===sym);
      let arr = STOCK_ASSETS;
      if (idx === -1) {
        idx = ETF_ASSETS.findIndex(s=>s.sym===sym);
        arr = ETF_ASSETS;
      }
      if (idx === -1) continue;
      const asset = arr[idx];
      asset.sector = m.sector || asset.sector || (arr===STOCK_ASSETS ? 'Custom' : 'ETF');
      asset.fund = asset.fund || {};
      asset.fund.marketCap = m.marketCap ?? asset.fund.marketCap ?? null;
      asset.fund.totalDebt = m.totalDebt ?? asset.fund.totalDebt ?? null;
      asset.fund.totalEquity = m.totalEquity ?? asset.fund.totalEquity ?? null;
      asset.fund.trailingEps = m.trailingEps ?? asset.fund.trailingEps ?? null;
      asset.fund.trailingPE = m.trailingPE ?? asset.fund.trailingPE ?? null;
      asset.fund.forwardPE = m.forwardPE ?? asset.fund.forwardPE ?? null;
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
        let growthPercent = (typeof g === 'number' && g > 1) ? g : (typeof g === 'number' ? g * 100 : null);
        if (growthPercent && typeof growthPercent === 'number') {
          peg = asset.fund.computed.pe / growthPercent;
        } else {
          peg = null;
        }
      }
      asset.fund.computed.peg = peg;
    }
  } catch (e) {
    console.warn('fetchSymbolMetadata failed', e);
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
  let asset = STOCK_ASSETS.find(s=>s.sym===sym) || ETF_ASSETS.find(s=>s.sym===sym) || null;
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
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Price Target</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.priceTarget)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Target Δ</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${pctDelta}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">EPS</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.eps)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">P/E</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.pe)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">ROE (%)</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${roe}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">D/E</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.de)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">PEG</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(c.peg)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Market Cap</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.marketCap)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Total Debt</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.totalDebt)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Total Equity</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.totalEquity)}</td></tr>
      <tr><td style="padding:6px 8px;border-bottom:1px solid var(--border)">Shares</td><td style="padding:6px 8px;border-bottom:1px solid var(--border)">${fmt(f.sharesOutstanding)}</td></tr>
      <tr><td style="padding:6px 8px;vertical-align:top">EPS Growth</td><td style="padding:6px 8px">${fmt(f.epsGrowth)}</td></tr>
    </table>
  `;
  body.innerHTML = html;
  document.getElementById('fund-modal').style.display = 'flex';
}

function closeFundModal(event){ if(event) event.stopPropagation(); const m=document.getElementById('fund-modal'); if(m) m.style.display='none'; }

async function loadPresetETFs(){
  const newSymbols = [];
  for(const etf of PRESET_ETFS){
    if(MIDCAP_STOCKS.some(s=>s.sym===etf.sym) || ETF_ASSETS.some(s=>s.sym===etf.sym)) continue;
    ETF_ASSETS.push({ ...etf });
    newSymbols.push(etf.sym);
  }
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

  if(etfFilter==='favorite') rows = rows.filter(r=>isETFFavorite(r.sym));
  else if(etfFilter==='buy') rows = rows.filter(r=>getSignal(r,r.data)==='buy');
  else if(etfFilter==='watch') rows = rows.filter(r=>getSignal(r,r.data)==='watch');
  else if(etfFilter==='sell') rows = rows.filter(r=>getSignal(r,r.data)==='sell');
  else if(etfFilter==='gainers') rows = rows.filter(r=>(r.data?.change||0)>0);
  else if(etfFilter==='losers') rows = rows.filter(r=>(r.data?.change||0)<0);
  else if(etfFilter==='custom') rows = rows.filter(r=>EXTRA_SYMBOLS.includes(r.sym));
  else if(etfFilter==='preset') rows = rows.filter(r=>!EXTRA_SYMBOLS.includes(r.sym));

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
    else {av=a.rank; bv=b.rank;}
    return typeof av==='string' ? dir*av.localeCompare(bv) : dir*(av-bv);
  });
  rows = rows.map((row,i)=>({ ...row, rank:i+1 }));

  tbody.innerHTML='';
  if(!rows.length){
    const note = etfFilter==='all'
      ? 'No ETFs loaded yet. Use the button above to load ETF presets or add a symbol.'
      : 'No ETFs match the selected filter.';
    tbody.innerHTML=`<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted)">${note}</td></tr>`;
    if(status) status.textContent='0 ETFs loaded';
    return;
  }
  if(status) status.textContent=`${rows.length} ETF${rows.length===1?'':'s'} loaded`;
  const sigLabels={buy:'🟢 BUY',watch:'🟡 WATCH',hold:'⬜ HOLD',sell:'🔴 SELL'};
  for(const row of rows){
    const d=row.data,chg=d?.change||0,price=d?.price||0,sig=getSignal(row,d);
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td><button class="fav-btn ${isETFFavorite(row.sym)?'active':''}" onclick="toggleETFFavorite('${row.sym}')">${isETFFavorite(row.sym)?'★':'☆'}</button></td>
      <td style="color:var(--muted);font-size:12px">${row.rank}</td>
      <td><div class="stock-name-cell"><span class="stock-symbol">${row.sym}</span><span class="stock-fullname">${row.name}</span></div></td>
      <td class="price-cell">${price>0?'₹'+price.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'--'}</td>
      <td class="target-cell">${renderTargetCell(row)}</td>
      <td class="chg-cell ${chg>=0?'up':'down'}">${d?(chg>=0?'▲ +':'▼ ')+chg.toFixed(2)+'%':'--'}</td>
      <td class="hide-mobile" style="font-size:11px;color:var(--muted)">${d&&d.low52&&d.high52?'₹'+d.low52.toLocaleString('en-IN',{maximumFractionDigits:0})+' – ₹'+d.high52.toLocaleString('en-IN',{maximumFractionDigits:0}):'--'}</td>
      <td class="hide-mobile" style="font-size:12px;color:var(--muted)">${d?.volume?(d.volume/100000).toFixed(1)+'L':'--'}</td>
      <td>${renderHealthCell(row)}</td>
      <td><div class="spark">${d?sparkBars(chg):'<span style="color:var(--muted);font-size:11px">--</span>'}</div></td>
      <td><span class="signal-badge ${sig}">${sigLabels[sig]}</span></td>`;
    tbody.appendChild(tr);
  }
}

function renderDashboard(){ renderIndices(); renderSectors(); renderTable(); renderETFSection(); if(currentView==='etfs') setView('etfs', document.getElementById('tab-etfs')); }

document.addEventListener('DOMContentLoaded', async () => {
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
  await loadSavedETFs();
  await loadSavedStocks();
});
