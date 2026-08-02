const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 3;
const CACHE_MAX_DAYS = 75;
const CRON_TIME_IST = '08:45';

function defaultStripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function defaultToISODateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
}

function nseRowSymbol(item) {
  return String(item?.symbol || item?.Symbol || item?.sm_symbol || item?.bm_symbol || item?.compSymbol || item?.companySymbol || item?.securitySymbol || '').trim().toUpperCase();
}

function nseRowCompanyName(item, symbol = '') {
  return String(
    item?.companyName ||
    item?.company ||
    item?.sm_name ||
    item?.bm_company ||
    item?.compName ||
    item?.name ||
    symbol ||
    ''
  ).trim();
}

function boardMeetingText(item, stripHtml = defaultStripHtml) {
  return stripHtml([
    item?.bm_purpose,
    item?.bm_desc,
    item?.purpose,
    item?.description,
    item?.title,
    item?.type,
  ].filter(Boolean).join(' ')).toLowerCase().replace(/\s+/g, ' ').trim();
}

function isEarningsResultBoardMeeting(item, stripHtml = defaultStripHtml) {
  const text = boardMeetingText(item, stripHtml);
  if (!text) return false;
  const hasResultSignal =
    /\bfinancial results?\b/.test(text) ||
    /\bunaudited results?\b/.test(text) ||
    /\baudited results?\b/.test(text) ||
    /\bstandalone results?\b/.test(text) ||
    /\bconsolidated results?\b/.test(text) ||
    /\bquarterly results?\b/.test(text) ||
    /\bannual results?\b/.test(text) ||
    /\bresults?\s+(?:for|of)\s+(?:the\s+)?(?:quarter|half year|year|period)\b/.test(text) ||
    /\b(?:quarter|half year|year|period)\s+ended\b.*\bresults?\b/.test(text) ||
    /\bconsider(?:ing)?\s+and\s+approv(?:e|ing)\b.*\bresults?\b/.test(text) ||
    /\bearnings?\b/.test(text);
  if (hasResultSignal) return true;
  if (/\bresults?\b/.test(text)) {
    const nonEarningsOnly = /\b(dividend|fund\s*rais|rights?\s*issue|bonus|split|sub[- ]?division|buyback|agm|egm|postal ballot|allotment|preferential issue|merger|amalgamation|acquisition|appointment|resignation)\b/.test(text);
    return !nonEarningsOnly;
  }
  return false;
}

function classifyBoardMeetingResultType(item, stripHtml = defaultStripHtml) {
  const text = boardMeetingText(item, stripHtml);
  if (!text) return null;
  if (isEarningsResultBoardMeeting(item, stripHtml)) return 'Financial Results';
  if (/\binterim dividend\b/.test(text)) return 'Interim Dividend';
  if (/\bfinal dividend\b/.test(text)) return 'Final Dividend';
  if (/\bdividend\b/.test(text)) return 'Dividend';
  if (/\bfund\s*rais|\brais(?:e|ing)\s+(?:of\s+)?funds?\b|\bpreferential issue\b|\bqip\b|\bright(?:s)? issue\b|\bissue of securities\b/.test(text)) return 'Fund Raising';
  if (/\bbonus\b/.test(text)) return 'Bonus Issue';
  if (/\bsplit\b|\bsub[- ]?division\b|\bstock split\b/.test(text)) return 'Stock Split';
  if (/\bbuy\s*back\b|\bbuyback\b/.test(text)) return 'Buyback';
  if (/\bacquisition\b|\bmerger\b|\bamalgamation\b|\bscheme of arrangement\b/.test(text)) return 'M&A / Scheme';
  if (/\bagm\b|\bannual general meeting\b/.test(text)) return 'AGM';
  if (/\begm\b|\bextra(?:-| )?ordinary general meeting\b/.test(text)) return 'EGM';
  if (/\bappointment\b|\bresignation\b|\bdirector\b|\bauditor\b|\bkmp\b/.test(text)) return 'Management Change';
  return null;
}

function resultCalendarEventDate(item) {
  return item?.eventDate || item?.publishedAt || item?.filingDate || item?.toDate || null;
}

function dateKeyPlusDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function todayDateKey(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function dateKeyRange(fromDate, toDate) {
  const out = [];
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function istDateKeyFromValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function normalizeUniverse(symbols, maxSymbols = 400) {
  return (Array.isArray(symbols) ? symbols : [])
    .map(item => typeof item === 'string' ? { symbol:item } : item)
    .map(item => ({
      symbol:String(item?.symbol || item?.sym || '').trim().toUpperCase(),
    }))
    .filter(item => item.symbol)
    .slice(0, maxSymbols);
}

function createResultCalendarService(deps = {}) {
  const cacheDir = deps.cacheDir || path.join(process.cwd(), 'cache', 'result_calendar');
  const indexFile = deps.indexFile || path.join(cacheDir, 'index.json');
  const nseJsonWithRetry = deps.nseJsonWithRetry;
  const stripHtml = deps.stripHtml || defaultStripHtml;
  const toISODateOrNull = deps.toISODateOrNull || defaultToISODateOrNull;
  const getResultCalendarSymbols = deps.getResultCalendarSymbols || (() => []);
  let indexCache = null;
  let cronTimer = null;
  let refreshInFlight = null;

  function mapNSEBoardMeetingRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(item => {
      const symbol = nseRowSymbol(item);
      const resultType = classifyBoardMeetingResultType(item, stripHtml);
      return {
        symbol,
        name:nseRowCompanyName(item, symbol),
        type:resultType || 'Board Meeting',
        title:stripHtml(item.bm_desc || item.bm_purpose || 'Board meeting'),
        isResultCalendarEvent:!!resultType,
        source:'NSE',
        eventDate:toISODateOrNull(item.bm_date),
        publishedAt:toISODateOrNull(item.bm_date || item.bm_timestamp),
        url:symbol ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}` : '',
      };
    }).filter(x => x.symbol && x.title);
  }

  async function fetchNSEAllBoardMeetings() {
    try {
      const rows = await nseJsonWithRetry('/api/corporate-board-meetings?index=equities', 'all board meetings');
      return mapNSEBoardMeetingRows(Array.isArray(rows) ? rows.slice(0, 1200) : []);
    } catch(e) {
      console.warn('[result-calendar] NSE all board meetings failed:', e.message);
      return [];
    }
  }

  async function fetchNSEBoardMeetingsForSymbols(symbols = []) {
    const universe = normalizeUniverse(symbols, 400);
    if (!universe.length) return fetchNSEAllBoardMeetings();
    const events = [];
    for (const { symbol } of universe) {
      try {
        const rows = await nseJsonWithRetry(
          `/api/corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`,
          `board meetings ${symbol}`
        );
        events.push(...mapNSEBoardMeetingRows(rows));
      } catch(e) {
        console.warn(`[result-calendar] NSE board meetings failed for ${symbol}:`, e.message);
      }
    }
    return dedupeResultCalendarItems(events);
  }

  function buildBySymbol(items, targetUniverse = [], opts = {}) {
    const allowed = new Set((Array.isArray(targetUniverse) ? targetUniverse : [])
      .map(row => String(row?.symbol || row?.sym || '').trim().toUpperCase())
      .filter(Boolean));
    const todayKey = opts.fromDate || todayDateKey();
    const toDate = opts.toDate || dateKeyPlusDays(todayKey, Number(opts.days || 30));
    const bySymbol = {};
    for (const raw of Array.isArray(items) ? items : []) {
      const symbol = String(raw?.symbol || '').trim().toUpperCase();
      if (!symbol || (allowed.size && !allowed.has(symbol))) continue;
      const type = String(raw?.type || '');
      const text = `${type} ${raw?.title || ''}`;
      const isResultEvent = raw?.isResultCalendarEvent === true ||
        ['Results', 'Result Filing'].includes(type) ||
        (type === 'Result Date' && isEarningsResultBoardMeeting(raw, stripHtml)) ||
        (type === 'Board Meeting' && !!classifyBoardMeetingResultType(raw, stripHtml)) ||
        (/earnings|financial results?|unaudited results?|audited results?|quarterly results?|annual results?/i.test(text));
      if (!isResultEvent) continue;
      const eventDate = resultCalendarEventDate(raw);
      const dateKey = istDateKeyFromValue(eventDate);
      if (!dateKey || dateKey < todayKey || dateKey > toDate) continue;
      const event = {
        symbol,
        name: raw.name || symbol,
        type: type || 'Result Date',
        title: raw.title || 'Result date',
        source: raw.source || 'NSE',
        url: raw.url || '',
        eventDate,
        dateKey,
        status: dateKey === todayKey ? 'today' : 'upcoming',
        period: raw.period || null,
      };
      if (!bySymbol[symbol]) bySymbol[symbol] = [];
      bySymbol[symbol].push(event);
    }
    for (const [symbol, rows] of Object.entries(bySymbol)) {
      bySymbol[symbol] = dedupeResultCalendarItems(rows)
        .sort((a, b) => (Date.parse(a.eventDate || 0) || 0) - (Date.parse(b.eventDate || 0) || 0))
        .slice(0, 3);
    }
    return bySymbol;
  }

  function dayFile(targetDate) {
    const dateKey = String(targetDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`Invalid result calendar date: ${targetDate}`);
    return path.join(cacheDir, `result_calendar_${dateKey}.json`);
  }

  function emptyIndex() {
    return { version:CACHE_VERSION, savedAt:0, partitioned:true, days:{} };
  }

  function loadIndex() {
    if (indexCache) return indexCache;
    indexCache = emptyIndex();
    try {
      ensureDir(cacheDir);
      if (fs.existsSync(indexFile)) {
        const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8') || '{}');
        if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
          indexCache = { version:raw.version || 1, savedAt:raw.savedAt || 0, partitioned:true, days:raw.days };
          if (indexCache.version !== CACHE_VERSION) {
            console.log(`[result-calendar-cache] index v${indexCache.version} is old; rebuilding as v${CACHE_VERSION}`);
            indexCache = emptyIndex();
          }
        }
      }
      const count = Object.keys(indexCache.days || {}).length;
      if (count) console.log(`[result-calendar-cache] Loaded ${count} partitioned day entries`);
    } catch(e) {
      console.warn('[result-calendar-cache] Index load error:', e.message);
      indexCache = emptyIndex();
    }
    return indexCache;
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
      console.warn('[result-calendar-cache] Index save error:', e.message);
    }
  }

  function prune(index) {
    const today = todayDateKey();
    const removeDay = (day, label) => {
      delete index.days[day];
      try {
        const file = dayFile(day);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch(e) {
        console.warn(`[result-calendar-cache] Prune ${label} error ${day}:`, e.message);
      }
    };
    for (const day of Object.keys(index.days || {}).sort()) {
      if (day < today) removeDay(day, 'old');
    }
    for (const day of Object.keys(index.days || {}).sort().slice(CACHE_MAX_DAYS)) {
      removeDay(day, 'overflow');
    }
  }

  function readDay(targetDate) {
    try {
      const file = dayFile(targetDate);
      if (!fs.existsSync(file)) return null;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
      if (!entry || !Array.isArray(entry.items)) return null;
      if ((entry.version || 1) !== CACHE_VERSION) return null;
      return entry;
    } catch(e) {
      console.warn(`[result-calendar-cache] Day read error ${targetDate}:`, e.message);
      return null;
    }
  }

  function writeDay(entry) {
    try {
      ensureDir(cacheDir);
      const dayEntry = { ...entry, version:CACHE_VERSION };
      fs.writeFileSync(dayFile(dayEntry.date), JSON.stringify(dayEntry, null, 2), 'utf8');
      const index = loadIndex();
      index.days[dayEntry.date] = {
        date:dayEntry.date,
        savedAt:dayEntry.savedAt || Date.now(),
        builtInMs:dayEntry.builtInMs || 0,
        source:dayEntry.source || 'nse-board-meetings',
        scanned:dayEntry.scanned || 0,
        count:dayEntry.count || 0,
        symbolCount:dayEntry.symbolCount || 0,
      };
      prune(index);
      saveIndex();
    } catch(e) {
      console.warn(`[result-calendar-cache] Day save error ${entry?.date || ''}:`, e.message);
    }
  }

  function buildDayEntries(events, universe, opts = {}) {
    const fromDate = opts.fromDate || todayDateKey();
    const days = Math.max(1, Math.min(Number(opts.days) || 30, 60));
    const toDate = opts.toDate || dateKeyPlusDays(fromDate, days);
    const bySymbol = buildBySymbol(events, universe, { fromDate, toDate, days });
    const byDate = new Map();
    for (const [symbol, rows] of Object.entries(bySymbol)) {
      for (const item of Array.isArray(rows) ? rows : []) {
        const dateKey = item.dateKey || istDateKeyFromValue(item.eventDate);
        if (!dateKey) continue;
        if (!byDate.has(dateKey)) byDate.set(dateKey, []);
        byDate.get(dateKey).push({ symbol, ...item });
      }
    }
    const now = Date.now();
    return dateKeyRange(fromDate, toDate).map(date => {
      const items = (byDate.get(date) || []).sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
      return {
        ok:true,
        date,
        savedAt:now,
        builtInMs:0,
        source:'nse-board-meetings',
        scanned:Array.isArray(events) ? events.length : 0,
        count:items.length,
        symbolCount:new Set(items.map(item => item.symbol)).size,
        items,
      };
    });
  }

  async function refreshCache(reason = 'manual', opts = {}) {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const startedAt = Date.now();
      const fromDate = opts.fromDate || todayDateKey();
      const days = Math.max(1, Math.min(Number(opts.days) || 30, 60));
      const toDate = opts.toDate || dateKeyPlusDays(fromDate, days);
      const symbols = normalizeUniverse(getResultCalendarSymbols(), 400);
      const sourceLabel = symbols.length ? `${symbols.length} tracked NSE board-meeting symbols` : 'all NSE board-meeting symbols';
      console.log(`[result-calendar-cron] Refreshing ${fromDate}..${toDate} (${reason}) for ${sourceLabel}`);
      const events = await fetchNSEBoardMeetingsForSymbols(symbols);
      const entries = buildDayEntries(events, [], { fromDate, toDate, days });
      for (const entry of entries) {
        entry.builtInMs = Date.now() - startedAt;
        writeDay(entry);
      }
      const count = entries.reduce((sum, entry) => sum + (Number(entry.count) || 0), 0);
      const symbolCount = new Set(entries.flatMap(entry => entry.items.map(item => item.symbol))).size;
      console.log(`[result-calendar-cron] Done ${fromDate}..${toDate}: ${count} entries, ${symbolCount} symbols`);
      return { ok:true, fromDate, toDate, days, count, symbolCount, entries:entries.length, cachedAt:Date.now() };
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function readCache(symbols, opts = {}) {
    const days = Math.max(1, Math.min(Number(opts.days) || 30, 60));
    const fromDate = opts.fromDate || todayDateKey();
    const toDate = opts.toDate || dateKeyPlusDays(fromDate, days);
    const universe = normalizeUniverse(symbols, Math.max(1, Math.min(Number(opts.maxSymbols) || 320, 400)));
    const allowed = new Set(universe.map(row => row.symbol));
    loadIndex();
    const dateKeys = dateKeyRange(fromDate, toDate);
    const entries = dateKeys.map(readDay).filter(Boolean);
    const filtered = dedupeResultCalendarItems(entries
      .flatMap(entry => Array.isArray(entry.items) ? entry.items : [])
      .filter(item => {
        const symbol = String(item?.symbol || '').toUpperCase();
        return symbol && (!allowed.size || allowed.has(symbol));
      }));
    const resultCalendarBySymbol = {};
    for (const item of filtered) {
      const symbol = String(item.symbol || '').toUpperCase();
      if (!resultCalendarBySymbol[symbol]) resultCalendarBySymbol[symbol] = [];
      resultCalendarBySymbol[symbol].push(item);
    }
    for (const [symbol, rows] of Object.entries(resultCalendarBySymbol)) {
      resultCalendarBySymbol[symbol] = rows
        .sort((a, b) => (Date.parse(a.eventDate || a.dateKey || 0) || 0) - (Date.parse(b.eventDate || b.dateKey || 0) || 0))
        .slice(0, 3);
    }
    const rows = Object.entries(resultCalendarBySymbol).flatMap(([symbol, list]) =>
      (Array.isArray(list) ? list : []).map(item => ({ symbol, ...item }))
    ).sort((a, b) => (Date.parse(a.eventDate || 0) || 0) - (Date.parse(b.eventDate || 0) || 0));
    return {
      ok:true,
      fromDate,
      toDate,
      days,
      scanned:universe.length,
      count:rows.length,
      symbolCount:Object.keys(resultCalendarBySymbol).length,
      resultCalendarBySymbol,
      items:rows,
      source:'nse-board-meetings',
      cachedDays:entries.length,
      missingDays:dateKeys.length - entries.length,
      cachedAt:Math.max(0, ...entries.map(entry => Number(entry.savedAt) || 0)) || null,
      fromCache:true,
    };
  }

  function missingWindowDays(fromDate = todayDateKey(), days = 30) {
    const toDate = dateKeyPlusDays(fromDate, days);
    loadIndex();
    return dateKeyRange(fromDate, toDate).filter(dateKey => !readDay(dateKey));
  }

  function cronDelayMs(now = new Date()) {
    const offsetMs = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + offsetMs);
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    const d = ist.getUTCDate();
    const [slotH, slotM] = CRON_TIME_IST.split(':').map(Number);
    for (let add = 0; add < 8; add++) {
      const candidateIstMs = Date.UTC(y, m, d + add, slotH, slotM, 0, 0);
      const candidateUtcMs = candidateIstMs - offsetMs;
      if (candidateUtcMs > now.getTime() + 5000) return candidateUtcMs - now.getTime();
    }
    return 24 * 60 * 60 * 1000;
  }

  function scheduleNextRefresh() {
    if (cronTimer) clearTimeout(cronTimer);
    const delay = cronDelayMs();
    cronTimer = setTimeout(async () => {
      try {
        await refreshCache('scheduled');
      } catch(e) {
        console.warn('[result-calendar-cron] Refresh failed:', e.message);
      } finally {
        scheduleNextRefresh();
      }
    }, delay);
    if (cronTimer.unref) cronTimer.unref();
    console.log(`[result-calendar-cron] Next refresh in ${Math.round(delay / 60000)}m`);
  }

  function startCron() {
    scheduleNextRefresh();
    loadIndex();
    const missingDays = missingWindowDays(todayDateKey(), 30);
    if (missingDays.length) {
      const startupTimer = setTimeout(() => {
        refreshCache('startup-missing-cache').catch(e => console.warn('[result-calendar-cron] Startup refresh failed:', e.message));
      }, 6500);
      if (startupTimer.unref) startupTimer.unref();
    }
  }

  async function handleRoute(req, res, { searchParams, readJsonBody }) {
    try {
      let payload = {};
      if (req.method === 'POST') {
        payload = await readJsonBody(req);
      } else if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error:'Method not allowed' }));
        return true;
      }
      const rawSymbols = req.method === 'GET'
        ? String(searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean)
        : (payload.symbols || payload.stocks || []);
      const days = payload.days || searchParams.get('days') || 30;
      const fromDate = payload.fromDate || searchParams.get('fromDate') || todayDateKey();
      const force = payload.force === true || ['1', 'true', 'yes'].includes(String(searchParams.get('force') || '').toLowerCase());
      if (force) await refreshCache('manual-force', { fromDate, days });
      const data = readCache(rawSymbols, {
        days,
        maxSymbols: payload.maxSymbols || searchParams.get('maxSymbols'),
        fromDate,
      });
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-cache' });
      res.end(JSON.stringify(data));
    } catch(e) {
      res.writeHead(502, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Result calendar failed' }));
    }
    return true;
  }

  return {
    fetchNSEAllBoardMeetings,
    readCache,
    refreshCache,
    startCron,
    handleRoute,
  };
}

function dedupeResultCalendarItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = String(item?.symbol || '').trim().toUpperCase();
    const date = String(item?.dateKey || istDateKeyFromValue(item?.eventDate) || '').slice(0, 10);
    const period = String(item?.period || item?.type || item?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${symbol}|${date}|${period}`;
    if (!symbol || !date || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

module.exports = {
  createResultCalendarService,
  boardMeetingText,
  isEarningsResultBoardMeeting,
  classifyBoardMeetingResultType,
  dedupeResultCalendarItems,
  todayDateKey,
};
