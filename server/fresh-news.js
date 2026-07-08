const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 5;
const CACHE_MAX_DAYS = 30;
const CRON_TIMES_IST = ['10:30', '15:45'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
}

function istDateKeyFromValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function lastBusinessDateKey(base = new Date()) {
  const ist = new Date(base.getTime() + 5.5 * 60 * 60 * 1000);
  ist.setUTCHours(0, 0, 0, 0);
  do {
    ist.setUTCDate(ist.getUTCDate() - 1);
  } while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6);
  return ist.toISOString().slice(0, 10);
}

function freshNewsDateKey(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  return (day === 0 || day === 6) ? lastBusinessDateKey(now) : ist.toISOString().slice(0, 10);
}

function freshNewsRefreshDateKeys(now = new Date()) {
  const primary = freshNewsDateKey(now);
  const prevBusiness = lastBusinessDateKey(now);
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  const dates = [primary];
  if (!dates.includes(prevBusiness)) dates.push(prevBusiness);
  if (day !== 0 && day !== 6) return dates;
  const saturday = new Date(ist);
  saturday.setUTCHours(0, 0, 0, 0);
  saturday.setUTCDate(saturday.getUTCDate() - (day === 0 ? 1 : 0));
  for (let add = 0; add <= (day === 0 ? 1 : 0); add += 1) {
    const weekend = new Date(saturday);
    weekend.setUTCDate(saturday.getUTCDate() + add);
    const dateKey = weekend.toISOString().slice(0, 10);
    if (!dates.includes(dateKey)) dates.push(dateKey);
  }
  return dates;
}

function itemNewsDateKey(item) {
  return istDateKeyFromValue(item?.publishedAt || item?.filingDate || item?.exDate || item?.recordDate || item?.eventDate || item?.toDate);
}

function isFreshNewsImportant(item) {
  const text = `${item?.type || ''} ${item?.title || ''} ${item?.subject || ''} ${item?.purpose || ''}`;
  return /result|financial|earnings|dividend|board|bonus|split|buyback|large deal|bulk deal|block deal|acquisition|merger|mou|contract|order win|bags order|corporate action|announcement/i.test(text);
}

function normalizeFreshNewsUniverse(symbols, maxSymbols = 300) {
  return (Array.isArray(symbols) ? symbols : [])
    .map(item => typeof item === 'string' ? { symbol:item } : item)
    .map(item => ({
      symbol:String(item?.symbol || item?.sym || '').trim().toUpperCase(),
      name:String(item?.name || '').trim(),
      assetType:String(item?.assetType || item?.type || 'stock').trim().toLowerCase(),
    }))
    .filter(item => item.symbol)
    .slice(0, maxSymbols);
}

function dedupeFreshNewsItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items.sort((a, b) =>
    (Number(b.tradeImpactAbs || 0) - Number(a.tradeImpactAbs || 0)) ||
    (Number(b.tradeImpactScore || 0) - Number(a.tradeImpactScore || 0)) ||
    ((Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
  )) {
    const key = `${item.symbol}|${String(item.type || '').toLowerCase()}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function mergeFreshNewsDayEntries(entries) {
  const valid = (Array.isArray(entries) ? entries : []).filter(entry => entry && Array.isArray(entry.items));
  if (valid.length <= 1) return valid[0] || null;
  const items = dedupeFreshNewsItems(valid.flatMap(entry => entry.items || []));
  return {
    ok:true,
    date:valid.map(entry => entry.date).filter(Boolean).join('+'),
    savedAt:Math.max(...valid.map(entry => Number(entry.savedAt) || 0)),
    builtInMs:valid.reduce((sum, entry) => sum + (Number(entry.builtInMs) || 0), 0),
    source:[...new Set(valid.map(entry => entry.source).filter(Boolean))].join('+') || 'nse-market-wide',
    scanned:Math.max(...valid.map(entry => Number(entry.scanned) || 0)),
    count:items.length,
    symbolCount:new Set(items.map(item => item.symbol)).size,
    items,
    errors:valid.flatMap(entry => Array.isArray(entry.errors) ? entry.errors : []).slice(0, 10),
    fromCache:valid.every(entry => !!entry.fromCache),
  };
}

function freshNewsCronDelayMs(now = new Date(), slots = CRON_TIMES_IST) {
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + offsetMs);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  for (let add = 0; add < 8; add++) {
    for (const slot of slots) {
      const [hh, mm] = slot.split(':').map(Number);
      const candidateIstMs = Date.UTC(y, m, d + add, hh, mm, 0, 0);
      const candidateUtcMs = candidateIstMs - offsetMs;
      if (candidateUtcMs > now.getTime() + 5000) return candidateUtcMs - now.getTime();
    }
  }
  return 6 * 60 * 60 * 1000;
}

function createFreshNewsService(deps = {}) {
  const cacheFile = deps.cacheFile || path.join(process.cwd(), 'cache', 'fresh_stock_news.json');
  const cacheDir = deps.cacheDir || path.join(process.cwd(), 'cache', 'fresh_news');
  const indexFile = deps.indexFile || path.join(cacheDir, 'index.json');
  const dashboardAppPath = deps.dashboardAppPath || path.join(process.cwd(), 'dashboard-app.js');
  const loadSavedStocksFile = deps.loadSavedStocksFile || (() => []);
  const classifyNewsItem = deps.classifyNewsItem || (() => 'News');
  const classifyNewsTradeImpact = deps.classifyNewsTradeImpact || (() => ({}));
  const isDbReady = deps.isDbReady || (() => false);
  const dbSaveFreshNews = deps.dbSaveFreshNews || (() => {});
  const fetchNSEAllAnnouncements = deps.fetchNSEAllAnnouncements || (async () => []);
  const fetchNSEAllResults = deps.fetchNSEAllResults || (async () => []);
  const fetchNSEAllCorporateActions = deps.fetchNSEAllCorporateActions || (async () => []);
  const fetchNSEAllBoardMeetings = deps.fetchNSEAllBoardMeetings || (async () => []);
  const fetchNSEStockAnnouncements = deps.fetchNSEStockAnnouncements || (async () => []);
  let dayCache = null;
  const buildJobs = new Map();
  let cronTimer = null;

  function loadDashboardStockUniverse() {
    const rows = [];
    try {
      const source = fs.existsSync(dashboardAppPath) ? fs.readFileSync(dashboardAppPath, 'utf8') : '';
      const block = source.match(/const\s+MIDCAP_STOCKS\s*=\s*\[([\s\S]*?)\];/);
      const text = block ? block[1] : source;
      const re = /\{\s*sym:'([^']+)'\s*,\s*name:'([^']*)'[\s\S]*?sector:'([^']*)'[\s\S]*?cap:'([^']*)'/g;
      let m;
      while ((m = re.exec(text))) {
        rows.push({ symbol:m[1].trim().toUpperCase(), name:m[2].trim(), assetType:'stock', sector:m[3], cap:m[4] });
      }
    } catch(e) {
      console.warn('[fresh-news-cache] dashboard universe load failed:', e.message);
    }
    try {
      for (const item of loadSavedStocksFile()) {
        const symbol = String(item?.sym || item?.symbol || item || '').trim().toUpperCase();
        if (symbol) rows.push({
          symbol,
          name:String(item?.name || symbol),
          assetType:'stock',
          sector:item?.sector || 'Custom',
          cap:item?.cap || 'custom'
        });
      }
    } catch(e) {
      console.warn('[fresh-news-cache] saved stock universe load failed:', e.message);
    }
    const seen = new Set();
    return rows.filter(row => {
      if (!row.symbol || seen.has(row.symbol)) return false;
      seen.add(row.symbol);
      return true;
    });
  }

  function buildUniverse(requestedUniverse) {
    const rows = [...loadDashboardStockUniverse(), ...(Array.isArray(requestedUniverse) ? requestedUniverse : [])];
    const seen = new Set();
    return rows.filter(row => {
      const symbol = String(row?.symbol || row?.sym || '').trim().toUpperCase();
      if (!symbol || seen.has(symbol)) return false;
      seen.add(symbol);
      row.symbol = symbol;
      row.name = String(row.name || symbol);
      row.assetType = String(row.assetType || row.type || 'stock').toLowerCase();
      return true;
    }).slice(0, 320);
  }

  function dayFile(targetDate) {
    const dateKey = String(targetDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`Invalid fresh news date: ${targetDate}`);
    return path.join(cacheDir, `fresh_stock_news_${dateKey}.json`);
  }

  function dayMeta(entry) {
    return {
      date:entry.date,
      savedAt:entry.savedAt || Date.now(),
      builtInMs:entry.builtInMs || 0,
      source:entry.source || 'nse-market-wide',
      scanned:entry.scanned || 0,
      count:entry.count || 0,
      symbolCount:entry.symbolCount || 0,
    };
  }

  function emptyIndex() {
    return { version:CACHE_VERSION, savedAt:0, partitioned:true, days:{} };
  }

  function migrateCombinedCache() {
    try {
      if (!fs.existsSync(cacheFile)) return;
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8') || '{}');
      const days = raw && raw.days && typeof raw.days === 'object' ? raw.days : {};
      let moved = 0;
      for (const [day, entry] of Object.entries(days)) {
        if (!entry || !Array.isArray(entry.items)) continue;
        const dayEntry = { ...entry, version:CACHE_VERSION, date:entry.date || day };
        fs.writeFileSync(dayFile(day), JSON.stringify(dayEntry, null, 2), 'utf8');
        dayCache.days[day] = dayMeta(dayEntry);
        moved++;
      }
      if (moved) {
        dayCache.savedAt = Date.now();
        console.log(`[fresh-news-cache] Partitioned ${moved} legacy day entries`);
        saveIndex();
      }
    } catch(e) {
      console.warn('[fresh-news-cache] Legacy partition error:', e.message);
    }
  }

  function loadIndex() {
    if (dayCache) return dayCache;
    dayCache = emptyIndex();
    try {
      ensureDir(cacheDir);
      if (fs.existsSync(indexFile)) {
        const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8') || '{}');
        if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
          dayCache = { version:raw.version || 1, savedAt:raw.savedAt || 0, partitioned:true, days:raw.days };
          if (dayCache.version !== CACHE_VERSION) {
            console.log(`[fresh-news-cache] index v${dayCache.version} is old; rebuilding as v${CACHE_VERSION}`);
            dayCache = emptyIndex();
          }
        }
      } else {
        migrateCombinedCache();
      }
      const count = Object.keys(dayCache.days || {}).length;
      if (count) console.log(`[fresh-news-cache] Loaded ${count} partitioned day entries`);
    } catch(e) {
      console.warn('[fresh-news-cache] Index load error:', e.message);
      dayCache = emptyIndex();
    }
    return dayCache;
  }

  function saveIndex() {
    try {
      const index = loadIndex();
      index.version = CACHE_VERSION;
      index.partitioned = true;
      index.savedAt = Date.now();
      ensureDir(cacheDir);
      fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8');
    } catch(e) {
      console.warn('[fresh-news-cache] Index save error:', e.message);
    }
  }

  function prune(index) {
    const days = Object.keys(index.days || {}).sort().reverse();
    for (const day of days.slice(CACHE_MAX_DAYS)) {
      delete index.days[day];
      try {
        const file = dayFile(day);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch(e) {
        console.warn(`[fresh-news-cache] Prune error ${day}:`, e.message);
      }
    }
  }

  function readDay(targetDate) {
    try {
      const file = dayFile(targetDate);
      if (!fs.existsSync(file)) return null;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
      if (!entry || !Array.isArray(entry.items)) return null;
      const needsUpgrade = (entry.version || 1) !== CACHE_VERSION ||
        entry.items.some(item => !item.newsSentiment || item.tradeImpactScore == null);
      if (needsUpgrade) {
        entry.version = CACHE_VERSION;
        entry.items = dedupeFreshNewsItems(entry.items.map(item => ({ ...item, ...classifyNewsTradeImpact(item) })));
        entry.count = entry.items.length;
        entry.symbolCount = new Set(entry.items.map(item => item.symbol)).size;
        writeDay(entry);
      }
      return entry;
    } catch(e) {
      console.warn(`[fresh-news-cache] Day read error ${targetDate}:`, e.message);
      return null;
    }
  }

  function writeDay(entry) {
    try {
      ensureDir(cacheDir);
      const dayEntry = { ...entry, version:CACHE_VERSION };
      fs.writeFileSync(dayFile(dayEntry.date), JSON.stringify(dayEntry, null, 2), 'utf8');
      const index = loadIndex();
      index.days[dayEntry.date] = dayMeta(dayEntry);
      prune(index);
      saveIndex();
      if (isDbReady() && Array.isArray(dayEntry.items) && dayEntry.date) {
        try {
          const bySymbol = new Map();
          for (const item of dayEntry.items) {
            if (!item?.symbol) continue;
            if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, []);
            bySymbol.get(item.symbol).push(item);
          }
          for (const [symbol, items] of bySymbol) dbSaveFreshNews(symbol, dayEntry.date, items);
        } catch (e) {
          console.warn('[fresh-news-cache] DB dual-write error:', e.message);
        }
      }
    } catch(e) {
      console.warn(`[fresh-news-cache] Day save error ${entry?.date || ''}:`, e.message);
    }
  }

  function normalizeMarketNewsItem(item, targetDate) {
    const sym = String(item?.symbol || '').trim().toUpperCase();
    if (!sym) return null;
    const dateKey = itemNewsDateKey(item);
    if (dateKey !== targetDate) return null;
    if (!isFreshNewsImportant(item)) return null;
    const normalized = {
      symbol:sym,
      name:String(item?.name || sym),
      assetType:String(item?.assetType || 'stock').toLowerCase(),
      type:item.type || classifyNewsItem(item.title || ''),
      title:item.title || item.type || 'News',
      source:item.source || 'NSE',
      url:item.url || '',
      publishedAt:item.publishedAt || item.filingDate || item.exDate || item.eventDate || null,
      dateKey,
      resultVerdict:item.resultVerdict || null,
      resultVerdictReason:item.resultVerdictReason || null,
    };
    return { ...normalized, ...classifyNewsTradeImpact(normalized) };
  }

  async function buildDayEntry(targetDate, requestedUniverse = []) {
    if (buildJobs.has(targetDate)) return buildJobs.get(targetDate);
    const job = (async () => {
      const startedAt = Date.now();
      const items = [];
      const errors = [];
      const universe = buildUniverse(requestedUniverse);
      const marketSettled = await Promise.allSettled([
        fetchNSEAllAnnouncements(),
        fetchNSEAllResults(),
        fetchNSEAllCorporateActions(),
        fetchNSEAllBoardMeetings(),
      ]);
      for (const r of marketSettled) {
        if (r.status === 'rejected') {
          errors.push(r.reason?.message || String(r.reason || 'unknown'));
          continue;
        }
        for (const raw of (Array.isArray(r.value) ? r.value : [])) {
          const normalized = normalizeMarketNewsItem(raw, targetDate);
          if (normalized) items.push(normalized);
        }
      }
      const symbolRows = new Map(universe.map(row => [row.symbol, row]));
      const alreadySeenAnnouncement = new Set(items
        .filter(item => item.source === 'NSE')
        .map(item => `${item.symbol}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`));
      const concurrency = 8;
      for (let i = 0; i < universe.length; i += concurrency) {
        const chunk = universe.slice(i, i + concurrency);
        const settled = await Promise.allSettled(chunk.map(row =>
          fetchNSEStockAnnouncements(row.symbol).then(news => ({ row, news }))
        ));
        for (const r of settled) {
          if (r.status !== 'fulfilled') {
            errors.push(r.reason?.message || String(r.reason || 'unknown'));
            continue;
          }
          const { row, news } = r.value;
          for (const raw of (Array.isArray(news) ? news : [])) {
            const item = normalizeMarketNewsItem({ ...raw, symbol:row.symbol, name:row.name, assetType:row.assetType }, targetDate);
            if (!item) continue;
            const titleKey = `${item.symbol}|${String(item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)}`;
            if (alreadySeenAnnouncement.has(titleKey)) continue;
            alreadySeenAnnouncement.add(titleKey);
            items.push(item);
          }
        }
        if (i + concurrency < universe.length) await new Promise(r => setTimeout(r, 120));
      }
      for (const item of items) {
        const row = symbolRows.get(item.symbol);
        if (row) {
          item.name = row.name || item.name || item.symbol;
          item.assetType = row.assetType || item.assetType || 'stock';
        }
      }
      const deduped = dedupeFreshNewsItems(items);
      const symbolsWithNews = new Set(deduped.map(item => item.symbol));
      return {
        ok:true,
        date:targetDate,
        savedAt:Date.now(),
        builtInMs:Date.now() - startedAt,
        source:'nse-market-wide+symbol-announcements',
        scanned:universe.length,
        count:deduped.length,
        symbolCount:symbolsWithNews.size,
        items:deduped.slice(0, 500),
        errors:errors.slice(0, 10),
      };
    })().finally(() => buildJobs.delete(targetDate));
    buildJobs.set(targetDate, job);
    return job;
  }

  async function getDayEntry(targetDate, requestedUniverse = [], opts = {}) {
    loadIndex();
    const cached = !opts.force ? readDay(targetDate) : null;
    if (cached) return { ...cached, fromCache:true };
    const entry = await buildDayEntry(targetDate, requestedUniverse);
    writeDay(entry);
    console.log(`[fresh-news-cache] Saved ${entry.count} items for ${targetDate}`);
    return { ...entry, fromCache:false };
  }

  async function fetchFreshStockNews(symbols, opts = {}) {
    const explicitDate = !!opts.date;
    const targetDate = opts.date || freshNewsDateKey();
    const maxSymbols = Math.max(1, Math.min(Number(opts.maxSymbols) || 220, 300));
    const limit = Math.max(1, Math.min(Number(opts.limit) || 25, 100));
    const offset = Math.max(0, Number(opts.offset) || 0);
    const universe = normalizeFreshNewsUniverse(symbols, maxSymbols);
    const dateKeys = explicitDate ? [targetDate] : freshNewsRefreshDateKeys();
    const dayEntries = [];
    for (const dateKey of dateKeys) dayEntries.push(await getDayEntry(dateKey, universe, { force:!!opts.force }));
    const dayEntry = mergeFreshNewsDayEntries(dayEntries) || {
      date:targetDate,
      items:[],
      count:0,
      symbolCount:0,
      scanned:0,
      errors:[],
    };
    const symbolMap = new Map(universe.map(row => [row.symbol, row]));
    const requestedSymbols = new Set(universe.map(row => row.symbol));
    const items = [];
    for (const item of (Array.isArray(dayEntry.items) ? dayEntry.items : [])) {
      const sym = String(item.symbol || '').toUpperCase();
      if (requestedSymbols.size && !requestedSymbols.has(sym)) continue;
      const row = symbolMap.get(sym) || {};
      items.push({
        symbol:sym,
        name:row.name || item.name || sym,
        assetType:row.assetType || item.assetType || 'stock',
        type:item.type || classifyNewsItem(item.title || ''),
        title:item.title || item.type || 'News',
        source:item.source || 'NSE',
        url:item.url || '',
        publishedAt:item.publishedAt || item.filingDate || item.exDate || item.eventDate || null,
        dateKey:item.dateKey || targetDate,
        resultVerdict:item.resultVerdict || null,
        resultVerdictReason:item.resultVerdictReason || null,
        newsSentiment:item.newsSentiment || classifyNewsTradeImpact(item).newsSentiment,
        tradeImpactScore:item.tradeImpactScore ?? classifyNewsTradeImpact(item).tradeImpactScore,
        tradeImpactAbs:item.tradeImpactAbs ?? classifyNewsTradeImpact(item).tradeImpactAbs,
        tradeImpactReason:item.tradeImpactReason || classifyNewsTradeImpact(item).tradeImpactReason,
      });
    }
    const deduped = dedupeFreshNewsItems(items);
    const symbolsWithNews = new Set(deduped.map(item => item.symbol));
    const impactBySymbol = {};
    for (const item of deduped) {
      const sym = String(item.symbol || '').toUpperCase();
      if (!sym) continue;
      const current = impactBySymbol[sym];
      const impactAbs = Number(item.tradeImpactAbs || Math.abs(Number(item.tradeImpactScore || 0)));
      const currentAbs = Number(current?.tradeImpactAbs || Math.abs(Number(current?.tradeImpactScore || 0)));
      if (!current || impactAbs > currentAbs) {
        impactBySymbol[sym] = {
          symbol:sym,
          type:item.type || 'News',
          title:item.title || 'News',
          newsSentiment:item.newsSentiment || 'Neutral',
          tradeImpactScore:Number(item.tradeImpactScore || 0),
          tradeImpactAbs:impactAbs,
          tradeImpactReason:item.tradeImpactReason || '',
          publishedAt:item.publishedAt || item.dateKey || null,
        };
      }
    }
    return {
      ok:true,
      date:dayEntry.date || targetDate,
      scanned:universe.length,
      marketCount:dayEntry.count || 0,
      marketSymbolCount:dayEntry.symbolCount || 0,
      count:deduped.length,
      symbolCount:symbolsWithNews.size,
      symbols:Array.from(symbolsWithNews),
      impactBySymbol,
      limit,
      offset,
      returned:deduped.slice(offset, offset + limit).length,
      hasPrev:offset > 0,
      hasNext:offset + limit < deduped.length,
      items:deduped.slice(offset, offset + limit),
      errors:Array.isArray(dayEntry.errors) ? dayEntry.errors.slice(0, 10) : [],
      fromCache:!!dayEntry.fromCache,
      cachedAt:dayEntry.savedAt || null,
      source:dayEntry.source || 'nse-market-wide',
    };
  }

  async function refreshCache(reason = 'manual') {
    const targetDates = freshNewsRefreshDateKeys();
    const universe = buildUniverse([]);
    let primaryEntry = null;
    for (const targetDate of targetDates) {
      console.log(`[fresh-news-cron] Refreshing ${targetDate} (${reason}) for ${universe.length} symbols`);
      const entry = await getDayEntry(targetDate, universe, { force:true });
      console.log(`[fresh-news-cron] Done ${targetDate}: ${entry.count} items, ${entry.symbolCount} symbols, cache=${entry.fromCache}`);
      if (!primaryEntry) primaryEntry = entry;
    }
    return primaryEntry;
  }

  function scheduleNextRefresh() {
    if (cronTimer) clearTimeout(cronTimer);
    const delay = freshNewsCronDelayMs();
    cronTimer = setTimeout(async () => {
      try {
        await refreshCache('scheduled');
      } catch(e) {
        console.warn('[fresh-news-cron] Refresh failed:', e.message);
      } finally {
        scheduleNextRefresh();
      }
    }, delay);
    if (cronTimer.unref) cronTimer.unref();
    console.log(`[fresh-news-cron] Next refresh in ${Math.round(delay / 60000)}m`);
  }

  function startCron() {
    scheduleNextRefresh();
    loadIndex();
    const missingTarget = freshNewsRefreshDateKeys().some(dateKey => !readDay(dateKey));
    if (missingTarget) {
      const startupTimer = setTimeout(() => {
        refreshCache('startup-missing-cache').catch(e => console.warn('[fresh-news-cron] Startup refresh failed:', e.message));
      }, 5000);
      if (startupTimer.unref) startupTimer.unref();
    }
  }

  async function handleRoute(req, res, { searchParams, readJsonBody }) {
    try {
      let payload = {};
      if (req.method === 'POST') {
        payload = await readJsonBody(req);
      } else if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ error:'Method not allowed' }));
        return true;
      }
      const rawSymbols = req.method === 'GET'
        ? String(searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean)
        : (payload.symbols || payload.stocks || []);
      const data = await fetchFreshStockNews(rawSymbols, {
        date: payload.date || searchParams.get('date') || '',
        maxSymbols: payload.maxSymbols || searchParams.get('maxSymbols'),
        concurrency: payload.concurrency || searchParams.get('concurrency'),
        limit: payload.limit || searchParams.get('limit'),
        offset: payload.offset || searchParams.get('offset'),
      });
      res.writeHead(200, { 'Content-Type':'application/json' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message }));
    }
    return true;
  }

  return {
    fetchFreshStockNews,
    refreshCache,
    startCron,
    handleRoute,
  };
}

module.exports = {
  createFreshNewsService,
  lastBusinessDateKey,
  freshNewsDateKey,
  freshNewsRefreshDateKeys,
  dedupeFreshNewsItems,
  mergeFreshNewsDayEntries,
  freshNewsCronDelayMs,
};
