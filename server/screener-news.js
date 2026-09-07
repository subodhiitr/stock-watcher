const SCREENER_BASE_URL = 'https://www.screener.in';
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_REQUEST_GAP_MS = 300;
const DEFAULT_TIMEOUT_MS = 10000;

function decodeHtmlEntities(value) {
  const named = {
    amp:'&', apos:"'", gt:'>', lt:'<', nbsp:' ', quot:'"',
  };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) return String.fromCodePoint(parseInt(normalized.slice(2), 16));
    if (normalized.startsWith('#')) return String.fromCodePoint(parseInt(normalized.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(named, normalized) ? named[normalized] : match;
  });
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteScreenerUrl(value) {
  const href = decodeHtmlEntities(value).trim();
  if (!href) return '';
  try {
    return new URL(href, SCREENER_BASE_URL).toString();
  } catch (_) {
    return '';
  }
}

function parseScreenerAnnouncements(html, stock = {}, opts = {}) {
  const source = String(html || '');
  const marker = source.indexOf('company-announcements-tab');
  if (marker < 0) return [];
  const listStart = source.indexOf('<ul', marker);
  const listEnd = source.indexOf('</ul>', listStart);
  if (listStart < 0 || listEnd < 0) return [];
  const listHtml = source.slice(listStart, listEnd + 5);
  const symbol = String(stock.symbol || stock.sym || '').trim().toUpperCase();
  const name = String(stock.name || symbol).trim();
  const maxItems = Math.max(1, Math.min(Number(opts.maxItems) || 5, 10));
  const items = [];
  const itemPattern = /<li\b[^>]*class=["'][^"']*overflow-wrap-anywhere[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let itemMatch;
  while (items.length < maxItems && (itemMatch = itemPattern.exec(listHtml))) {
    const link = itemMatch[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const linkBody = link[2];
    const meta = linkBody.match(/<div\b[^>]*class=["'][^"']*ink-600[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const titleHtml = meta ? linkBody.slice(0, meta.index) : linkBody;
    const title = cleanHtmlText(titleHtml);
    if (!title) continue;
    const time = (meta?.[1] || '').match(/<time\b[^>]*datetime=["']([^"']+)["'][^>]*>[\s\S]*?<\/time>/i);
    const summary = cleanHtmlText((meta?.[1] || '').replace(/<time\b[^>]*>[\s\S]*?<\/time>/i, ''))
      .replace(/^[-–—]\s*/, '')
      .slice(0, 600);
    items.push({
      symbol,
      name,
      assetType:'stock',
      title:title.slice(0, 500),
      summary,
      source:'Screener',
      url:absoluteScreenerUrl(link[1]),
      publishedAt:time ? decodeHtmlEntities(time[1]) : null,
    });
  }
  return items;
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function createScreenerNewsProvider(deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const now = deps.now || (() => Date.now());
  const cacheTtlMs = Math.max(0, Number(deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const minRequestGapMs = Math.max(0, Number(deps.minRequestGapMs ?? DEFAULT_MIN_REQUEST_GAP_MS));
  const timeoutMs = Math.max(1000, Number(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const cache = new Map();
  let startQueue = Promise.resolve();
  let lastRequestAt = 0;

  function reserveRequestStart() {
    const reservation = startQueue.then(async () => {
      const waitMs = Math.max(0, minRequestGapMs - (now() - lastRequestAt));
      await delay(waitMs);
      lastRequestAt = now();
    });
    startQueue = reservation.then(() => undefined, () => undefined);
    return reservation;
  }

  async function fetchUncached(stock) {
    const symbol = String(stock?.symbol || stock?.sym || '').trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol)) return [];
    if (typeof fetchImpl !== 'function') throw new Error('Screener fetch is unavailable');
    await reserveRequestStart();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${SCREENER_BASE_URL}/company/${encodeURIComponent(symbol)}/`;
      const response = await fetchImpl(url, {
        signal:controller.signal,
        headers:{
          accept:'text/html,application/xhtml+xml',
          'user-agent':'Mozilla/5.0 (compatible; StockWatcher/1.0; local-personal-use)',
        },
      });
      if (!response.ok) throw new Error(`Screener HTTP ${response.status}`);
      return parseScreenerAnnouncements(await response.text(), stock);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchStockAnnouncements(stockOrSymbol) {
    const stock = typeof stockOrSymbol === 'string' ? { symbol:stockOrSymbol } : (stockOrSymbol || {});
    const symbol = String(stock.symbol || stock.sym || '').trim().toUpperCase();
    if (!symbol) return [];
    const cached = cache.get(symbol);
    if (cached && now() - cached.savedAt < cacheTtlMs) return cached.items.map(item => ({ ...item }));
    const task = () => fetchUncached({ ...stock, symbol }).then(items => {
      cache.set(symbol, { savedAt:now(), items });
      return items.map(item => ({ ...item }));
    });
    return task();
  }

  return { fetchStockAnnouncements };
}

module.exports = {
  SCREENER_BASE_URL,
  cleanHtmlText,
  parseScreenerAnnouncements,
  createScreenerNewsProvider,
};
