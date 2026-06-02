#!/usr/bin/env node
/**
 * NSE + Yahoo Finance Local Proxy Server
 * ─────────────────────────────────────────────────────────────────
 * Run:  node ticker_proxy.js          (self-applies --max-http-header-size)
 * Port: 3001
 *
 * Routes:
 *   GET /health                 → status check
 *   GET /nse?path=/api/...      → NSE India API (handles session)
 *   GET /yahoo?symbols=A,B,C    → Yahoo Finance v7 quotes
 *   GET /yahoo/indices          → Nifty index quotes
 * ─────────────────────────────────────────────────────────────────
 */

// ── SELF-RESPAWN ──────────────────────────────────────────────────
// Yahoo Finance responses contain huge Set-Cookie headers that exceed
// Node's default 8 KB HTTP parser limit.  The ONLY reliable fix is the
// --max-http-header-size CLI flag (agent-level options don't work).
// If we weren't started with it, re-exec ourselves with it right now.
const HEADER_FLAG = '--max-http-header-size=65536';
if (!process.execArgv.includes(HEADER_FLAG)) {
  const { spawnSync } = require('child_process');
  console.log('[proxy] Re-starting with', HEADER_FLAG, '…');
  const result = spawnSync(
    process.execPath,
    [HEADER_FLAG, ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(result.status ?? 0);
}
// ─────────────────────────────────────────────────────────────────

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');
const PORT  = 3001;
const SAVED_ETF_FILE = path.join(__dirname, 'saved_etfs.json');
const SAVED_STOCK_FILE = path.join(__dirname, 'saved_stocks.json');
const SAVED_ETF_FAV_FILE = path.join(__dirname, 'saved_etf_favs.json');
const SAVED_STOCK_FAV_FILE = path.join(__dirname, 'saved_stock_favs.json');

function loadSavedETFsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FILE)) fs.writeFileSync(SAVED_ETF_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF prefs:', e.message);
  }
}

function loadSavedStocksFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FILE)) fs.writeFileSync(SAVED_STOCK_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStocksFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock prefs:', e.message);
  }
}

function loadSavedETFFavsFile() {
  try {
    if (!fs.existsSync(SAVED_ETF_FAV_FILE)) fs.writeFileSync(SAVED_ETF_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_ETF_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedETFFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_ETF_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save ETF favorites:', e.message);
  }
}

function loadSavedStockFavsFile() {
  try {
    if (!fs.existsSync(SAVED_STOCK_FAV_FILE)) fs.writeFileSync(SAVED_STOCK_FAV_FILE, '[]', 'utf8');
    const content = fs.readFileSync(SAVED_STOCK_FAV_FILE, 'utf8');
    return JSON.parse(content || '[]');
  } catch (e) {
    return [];
  }
}
function saveSavedStockFavsFile(symbols) {
  try {
    fs.writeFileSync(SAVED_STOCK_FAV_FILE, JSON.stringify(Array.isArray(symbols) ? symbols : [], null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy] Could not save stock favorites:', e.message);
  }
}

// ══════════════════════════════════════════════════════════
//  SHARED HELPER — HTTPS GET with auto-decompression
// ══════════════════════════════════════════════════
function httpsGet(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      const enc    = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip'    ? res.pipe(zlib.createGunzip()) :
        enc === 'br'      ? res.pipe(zlib.createBrotliDecompress()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
      stream.on('data',  c  => chunks.push(c));
      stream.on('end',   () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error',   reject);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════
//  NSE SESSION
// ══════════════════════════════════════════════════════════
const nse = { cookies: '', lastRefresh: 0, refreshing: false, TTL: 5 * 60 * 1000 };

const NSE_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer'        : 'https://www.nseindia.com/',
  'Sec-Fetch-Dest' : 'empty',
  'Sec-Fetch-Mode' : 'cors',
  'Sec-Fetch-Site' : 'same-origin',
  'Connection'     : 'keep-alive',
};

function harvestCookies(store, res) {
  const raw = res.headers['set-cookie'];
  if (!raw || !raw.length) return store;
  const map = Object.fromEntries(
    store.split('; ').filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i > -1 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
    })
  );
  for (const c of raw) {
    const pair = c.split(';')[0];
    const i    = pair.indexOf('=');
    if (i > -1) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function nseGet(path) {
  const res = await httpsGet({
    hostname: 'www.nseindia.com', path, method: 'GET', timeout: 15000,
    headers : { ...NSE_HEADERS, ...(nse.cookies ? { Cookie: nse.cookies } : {}) },
  });
  nse.cookies = harvestCookies(nse.cookies, res);
  return res;
}

async function warmNSESession() {
  if (nse.refreshing) return;
  nse.refreshing = true;
  console.log('[NSE] Warming session…');
  try {
    await nseGet('/');
    await nseGet('/market-data/live-equity-market-data');
    nse.lastRefresh = Date.now();
    console.log('[NSE] Session ready (' + nse.cookies.length + ' chars)');
  } catch(e) {
    console.warn('[NSE] Warm failed:', e.message);
  } finally {
    nse.refreshing = false;
  }
}

const NSE_ALLOWED = new Set(['/api/allIndices', '/api/marketStatus']);
const NSE_PREFIXES = ['/api/equity-stockIndices', '/api/quote-equity', '/api/chart-databyindex'];
const isNSEAllowed = p => NSE_ALLOWED.has(p) || NSE_PREFIXES.some(pre => p.startsWith(pre));

// ══════════════════════════════════════════════════════════
//  YAHOO FINANCE  —  crumb-free via v8/finance/chart
// ══════════════════════════════════════════════════════════
// Yahoo locked down v7/quote behind a consent-cookie crumb in 2024.
// v8/finance/chart is the replacement: it needs NO crumb, NO session,
// and returns price + 52-week range + volume for any symbol.
// We fetch symbols in parallel (Promise.allSettled) for speed.
// ──────────────────────────────────────────────────────────

const YAHOO_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept'         : 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Referer'        : 'https://finance.yahoo.com/',
};

// Fetch a single symbol via v8/finance/chart (1-day range, 1-day interval).
// Returns the parsed JSON or null on error.
async function yahooChart(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}` +
               `?interval=1d&range=1d&includePrePost=false`;
  try {
    const res = await httpsGet({
      hostname: 'query1.finance.yahoo.com',
      path, method: 'GET', timeout: 10000,
      headers: YAHOO_HEADERS,
    });
    if (res.status !== 200) {
      // Fallback to query2 on any non-200
      const res2 = await httpsGet({
        hostname: 'query2.finance.yahoo.com',
        path, method: 'GET', timeout: 10000,
        headers: YAHOO_HEADERS,
      });
      if (res2.status !== 200) return null;
      return JSON.parse(res2.body);
    }
    return JSON.parse(res.body);
  } catch(e) {
    return null;
  }
}

// Extract a clean quote object from a v8/chart response
function chartToQuote(sym, data) {
  try {
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta || {};
    const prev   = meta.chartPreviousClose || meta.previousClose || 0;
    const price  = meta.regularMarketPrice || 0;
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol     : sym,
      price      : price,
      change     : parseFloat(change.toFixed(2)),
      high52     : meta.fiftyTwoWeekHigh  || 0,
      low52      : meta.fiftyTwoWeekLow   || 0,
      volume     : meta.regularMarketVolume || 0,
      open       : meta.regularMarketDayHigh ? (result.indicators?.quote?.[0]?.open?.[0] || 0) : 0,
      prevClose  : prev,
      marketState: meta.marketState || 'CLOSED',
    };
  } catch(e) {
    return null;
  }
}

// Fetch a batch of NSE symbols concurrently (max CONCURRENCY at a time)
const CONCURRENCY = 8;
async function yahooQuote(nseSymbols) {
  const results = {};
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => yahooChart(sym + '.NS').then(data => ({ sym, data })))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) {
        const q = chartToQuote(r.value.sym, r.value.data);
        if (q) results[r.value.sym] = q;
      }
    }
  }
  // Return in the shape the dashboard expects: { SYMBOL: { price, change, ... } }
  return { ok: true, quotes: results };
}

// Fetch summary/metadata (assetProfile, price.marketCap) via quoteSummary
async function yahooSummary(nseSymbols) {
  const results = {};
  // request additional modules for fundamentals: financialData, defaultKeyStatistics, balanceSheetHistory, earnings
  const MODULES = 'assetProfile,price,summaryDetail,financialData,defaultKeyStatistics,balanceSheetHistory,earnings';
  for (let i = 0; i < nseSymbols.length; i += CONCURRENCY) {
    const chunk = nseSymbols.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(sym => (async () => {
        const path = `/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=${MODULES}`;
        try {
          const res = await httpsGet({ hostname: 'query2.finance.yahoo.com', path, method: 'GET', timeout: 10000, headers: YAHOO_HEADERS });
          if (res.status !== 200) return { sym, data: null };
          const json = JSON.parse(res.body);
          const r = json?.quoteSummary?.result?.[0] || null;
          if (!r) return { sym, data: null };
          const sector = r.assetProfile?.sector || null;
          const industry = r.assetProfile?.industry || null;
          const marketCap = r.price?.marketCap?.raw || (r.summaryDetail?.marketCap?.raw || null);
          const financial = r.financialData || {};
          const keyStats = r.defaultKeyStatistics || {};
          const balance = r.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
          const earnings = r.earnings || {};
          const totalDebt = financial?.totalDebt?.raw ?? null;
          // price target: prefer targetMeanPrice or targetMedianPrice from financialData
          const targetMean = financial?.targetMeanPrice?.raw ?? financial?.targetMedianPrice?.raw ?? null;
          // try multiple possible equity fields
          const totalEquity = (balance?.totalStockholderEquity?.raw ?? balance?.totalStockholdersEquity?.raw) ?? null;
          const trailingEps = (financial?.trailingEps?.raw ?? keyStats?.trailingEps?.raw) ?? null;
          const trailingPE = (financial?.trailingPE?.raw ?? keyStats?.trailingPE?.raw ?? r.summaryDetail?.trailingPE?.raw) ?? null;
          const forwardPE = (financial?.forwardPE?.raw ?? r.summaryDetail?.forwardPE?.raw) ?? null;
          const roe = financial?.returnOnEquity?.raw ?? null;
          const sharesOutstanding = keyStats?.sharesOutstanding?.raw ?? null;
          const epsGrowth = financial?.earningsGrowth?.raw ?? earnings?.earningsChart?.yearly?.[0]?.growth ?? null;
          const peg = financial?.pegRatio?.raw ?? null;

          return { sym, data: { sector, industry, marketCap, totalDebt, totalEquity, trailingEps, trailingPE, forwardPE, roe, sharesOutstanding, epsGrowth, peg, priceTarget: targetMean } };
        } catch (e) {
          return { sym, data: null };
        }
      })())
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value?.data) results[r.value.sym] = r.value.data;
    }
  }
  return { ok: true, metas: results };
}

// Indices via v8/chart
const INDEX_MAP = {
  '^NSEI'   : 'nifty50',
  '^NSMIDCP': 'midcap',
  '^NSEBANK': 'banknifty',
  '^CNXSC'  : 'smallcap',
};
async function yahooIndices() {
  const settled = await Promise.allSettled(
    Object.keys(INDEX_MAP).map(sym =>
      yahooChart(sym).then(data => ({ sym, data }))
    )
  );
  const out = {};
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value?.data) {
      const q   = chartToQuote(r.value.sym, r.value.data);
      const key = INDEX_MAP[r.value.sym];
      if (q && key) out[key] = { price: q.price, change: q.change };
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname, searchParams } = new URL(req.url, `http://localhost:${PORT}`);
  // Log incoming requests for debugging client 404s
  try { console.log('[proxy] >>', req.method, pathname, req.socket && req.socket.remoteAddress); } catch (e) {}

  // /health
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true,
      nse  : { cookies: nse.cookies.length, lastRefresh: nse.lastRefresh },
      yahoo: { mode: 'v8/chart (crumb-free)', ok: true },
    }));
    return;
  }

  // /nse?path=...
  if (pathname === '/nse') {
    const nsePath = searchParams.get('path') || '';
    if (!isNSEAllowed(nsePath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path not allowed' })); return;
    }
    if (Date.now() - nse.lastRefresh > nse.TTL) await warmNSESession();
    try {
      let r = await nseGet(nsePath);
      if (r.status === 401 || r.status === 403) { await warmNSESession(); r = await nseGet(nsePath); }
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body);
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo?symbols=...
  if (pathname === '/yahoo') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await yahooQuote(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/indices
  if (pathname === '/yahoo/indices') {
    try {
      const data = await yahooIndices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /yahoo/summary?symbols=A,B  -- fetch assetProfile + marketCap metadata
  if (pathname === '/yahoo/summary') {
    const symbols = (searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No symbols' })); return; }
    try {
      const data = await yahooSummary(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /etf-prefs  -- persist custom ETF symbols in workspace
  if (pathname === '/etf-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedETFsFile();
      console.log('[proxy] /etf-prefs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /etf-favs  -- persist ETF favorites in workspace
  if (pathname === '/etf-favs') {
    if (req.method === 'GET') {
      const list = loadSavedETFFavsFile();
      console.log('[proxy] /etf-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedETFFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-prefs  -- persist custom stock symbols in workspace
  if (pathname === '/stock-prefs') {
    if (req.method === 'GET') {
      const list = loadSavedStocksFile();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          let toSave = [];
          if (Array.isArray(payload)) {
            // Support array of strings or array of objects { sym, sector, cap }
            if (payload.length && typeof payload[0] === 'string') {
              toSave = payload.map(s => String(s).trim().toUpperCase()).filter(Boolean);
            } else {
              toSave = payload.map(item => {
                if (!item || typeof item === 'string') return null;
                const sym = String(item.sym||item.symbol||'').trim().toUpperCase();
                if (!sym) return null;
                return { sym, sector: item.sector||null, cap: item.cap||null };
              }).filter(Boolean);
            }
          }
          console.log('[proxy] saving stock prefs:', JSON.stringify(toSave));
          saveSavedStocksFile(toSave);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: toSave.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // /stock-favs  -- persist Stock favorites in workspace
  if (pathname === '/stock-favs') {
    if (req.method === 'GET') {
      const list = loadSavedStockFavsFile();
      console.log('[proxy] /stock-favs GET -> 200, items=', list.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(body);
          const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
          saveSavedStockFavsFile(symbols);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, saved: symbols.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── Static file serving (serve dashboard and assets from repo) ──
  try {
    // Map '/' -> dashboard HTML
    const safePath = pathname === '/' ? '/nse_midcap_dashboard.html' : pathname;
    // Prevent path traversal
    const resolved = path.normalize(path.join(__dirname, safePath));
    if (!resolved.startsWith(path.join(__dirname, path.sep))) throw new Error('Invalid path');
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.ico' ? 'image/x-icon' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      const stream = fs.createReadStream(resolved);
      stream.pipe(res);
      return;
    }
  } catch (e) {
    // fallthrough to 404
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║  NSE + Yahoo Finance Proxy → http://localhost:${PORT}  ║
║  Yahoo: v8/finance/chart (crumb-free) ✓          ║
╠══════════════════════════════════════════════════╣
║  GET /health                                     ║
║  GET /nse?path=/api/...     NSE India            ║
║  GET /yahoo?symbols=A,B     Yahoo Finance        ║
║  GET /yahoo/indices         Nifty indices        ║
║  GET /etf-prefs             ETF prefs storage    ║
║  GET /etf-favs              ETF favorites storage ║
║  GET /stock-prefs           Stock prefs storage  ║
║  GET /stock-favs            Stock favorites storage║
║                                                  ║
║  Press Ctrl+C to stop.                           ║
╚══════════════════════════════════════════════════╝
`);
  // Only NSE needs session warming; Yahoo v8/chart is stateless
  await warmNSESession();
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⚠  Port ${PORT} already in use. Stop the other process or change PORT.\n`);
    process.exit(1);
  }
});
