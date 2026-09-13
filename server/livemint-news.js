const LIVEMINT_FEED_URLS = [
  'https://www.livemint.com/rss/companies',
  'https://www.livemint.com/rss/industry',
  'https://www.livemint.com/rss/markets',
  'https://www.livemint.com/rss/news',
  'https://www.livemint.com/rss/money',
  'https://www.livemint.com/rss/insurance',
  'https://www.livemint.com/rss/technology',
];
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10000;

function decodeXmlEntities(value) {
  const named = { amp:'&', apos:"'", gt:'>', lt:'<', nbsp:' ', quot:'"' };
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) return String.fromCodePoint(parseInt(normalized.slice(2), 16));
    if (normalized.startsWith('#')) return String.fromCodePoint(parseInt(normalized.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(named, normalized) ? named[normalized] : match;
  });
}

function cleanXmlText(value) {
  return decodeXmlEntities(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? cleanXmlText(match[1]) : '';
}

function parseLiveMintRss(xml, opts = {}) {
  const maxItems = Math.max(1, Math.min(Number(opts.maxItems) || 100, 300));
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while (items.length < maxItems && (match = itemPattern.exec(String(xml || '')))) {
    const title = tagValue(match[1], 'title');
    const url = tagValue(match[1], 'link') || tagValue(match[1], 'guid');
    if (!title || !url) continue;
    const published = tagValue(match[1], 'pubDate');
    const publishedMs = Date.parse(published);
    items.push({
      title:title.slice(0, 500),
      summary:tagValue(match[1], 'description').slice(0, 1000),
      source:'LiveMint',
      url,
      publishedAt:Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
    });
  }
  return items;
}

function normalizedWords(value) {
  return cleanXmlText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function companyAliases(stock = {}) {
  const symbol = String(stock.symbol || stock.sym || '').trim().toLowerCase();
  const rawName = String(stock.name || '').replace(/\([^)]*\)/g, ' ');
  const name = normalizedWords(rawName)
    .replace(/\b(?:limited|ltd|incorporated|inc|corporation|corp|company|co|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliases = [];
  if (name.length >= 4 && name !== symbol) aliases.push(name);
  const tokens = name.split(' ').filter(token => token.length >= 3 && !['india', 'indian', 'industries', 'services'].includes(token));
  if (tokens.length >= 2) aliases.push(tokens.slice(0, 2).join(' '));
  if (symbol.length >= 4) aliases.push(symbol);
  return [...new Set(aliases)].sort((a, b) => b.length - a.length);
}

function liveMintItemMatchesStock(item, stock = {}) {
  const haystack = ` ${normalizedWords(`${item?.title || ''} ${item?.summary || ''}`)} `;
  return companyAliases(stock).some(alias => haystack.includes(` ${alias} `));
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = String(item.url || item.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createLiveMintNewsProvider(deps = {}) {
  const fetchImpl = deps.fetchImpl || global.fetch;
  const now = deps.now || (() => Date.now());
  const feedUrls = Array.isArray(deps.feedUrls) && deps.feedUrls.length ? deps.feedUrls : LIVEMINT_FEED_URLS;
  const cacheTtlMs = Math.max(0, Number(deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const timeoutMs = Math.max(1000, Number(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  let feedCache = null;
  let feedTask = null;

  async function fetchFeed(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal:controller.signal,
        headers:{
          accept:'application/rss+xml,application/xml,text/xml',
          'user-agent':'Mozilla/5.0 (compatible; StockWatcher/1.0; local-personal-use)',
        },
      });
      if (!response.ok) throw new Error(`LiveMint HTTP ${response.status}`);
      return parseLiveMintRss(await response.text());
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadFeedItems() {
    if (feedCache && now() - feedCache.savedAt < cacheTtlMs) return feedCache.items;
    if (feedTask) return feedTask;
    if (typeof fetchImpl !== 'function') throw new Error('LiveMint fetch is unavailable');
    feedTask = Promise.allSettled(feedUrls.map(fetchFeed)).then(results => {
      const items = dedupeItems(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
      if (!items.length && results.every(result => result.status === 'rejected')) {
        throw results[0].reason || new Error('LiveMint feeds unavailable');
      }
      feedCache = { savedAt:now(), items };
      return items;
    }).finally(() => { feedTask = null; });
    return feedTask;
  }

  async function fetchStockAnnouncements(stockOrSymbol) {
    const stock = typeof stockOrSymbol === 'string' ? { symbol:stockOrSymbol } : (stockOrSymbol || {});
    const symbol = String(stock.symbol || stock.sym || '').trim().toUpperCase();
    if (!symbol) return [];
    const items = await loadFeedItems();
    return items
      .filter(item => liveMintItemMatchesStock(item, { ...stock, symbol }))
      .map(item => ({ ...item, symbol, name:String(stock.name || symbol), assetType:'stock' }));
  }

  return { fetchStockAnnouncements };
}

module.exports = {
  LIVEMINT_FEED_URLS,
  parseLiveMintRss,
  companyAliases,
  liveMintItemMatchesStock,
  createLiveMintNewsProvider,
};
