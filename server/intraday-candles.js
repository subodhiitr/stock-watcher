'use strict';

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRange(value) {
  const range = String(value || '1d').trim().toLowerCase();
  return ['1d', '2d', '5d'].includes(range) ? range : '1d';
}

function normalizeYahooCandles(symbol, range, data) {
  const result = data?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rawCandles = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = finiteNumber(quote.open?.[i]);
    const high = finiteNumber(quote.high?.[i]);
    const low = finiteNumber(quote.low?.[i]);
    const close = finiteNumber(quote.close?.[i]);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    if (![open, high, low, close].every(v => v > 0)) continue;
    if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    rawCandles.push({
      time: new Date(Number(timestamps[i]) * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.max(0, Math.round(finiteNumber(quote.volume?.[i]) || 0)),
    });
  }
  const typicalPrices = rawCandles.map(c => c.close).sort((a, b) => a - b);
  const median = typicalPrices.length ? typicalPrices[Math.floor(typicalPrices.length / 2)] : null;
  const candles = Number.isFinite(median) && median > 0
    ? rawCandles.filter(c => c.high >= median * 0.2 && c.low <= median * 5 && c.low >= median * 0.2 && c.high <= median * 5)
    : rawCandles;
  return {
    ok: true,
    symbol: String(symbol || '').trim().toUpperCase(),
    interval: '5m',
    range: normalizeRange(range),
    candles,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(payload));
}

function createIntradayCandlesService(deps = {}) {
  const httpsGet = deps.httpsGet;
  const yahooHeaders = deps.yahooHeaders || {};
  const resolveNseSymbol = deps.resolveNseSymbol || (symbol => symbol);

  async function fetchCandles(symbol, range = '1d') {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) throw new Error('No symbol');
    const safeRange = normalizeRange(range);
    const yahooSym = `${resolveNseSymbol(sym)}.NS`;
    const requestPath = `/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=5m&range=${safeRange}&includePrePost=false`;
    let response = await httpsGet({
      hostname: 'query1.finance.yahoo.com',
      path: requestPath,
      method: 'GET',
      timeout: 15000,
      headers: yahooHeaders,
    });
    if (response.status !== 200) {
      response = await httpsGet({
        hostname: 'query2.finance.yahoo.com',
        path: requestPath,
        method: 'GET',
        timeout: 15000,
        headers: yahooHeaders,
      });
    }
    if (response.status !== 200) throw new Error(`Yahoo chart HTTP ${response.status}`);
    return normalizeYahooCandles(sym, safeRange, JSON.parse(response.body || '{}'));
  }

  async function handleRoute(req, res, pathname, searchParams) {
    if (pathname !== '/intraday-candles') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return true;
    }
    try {
      const symbol = searchParams.get('symbol');
      if (!symbol) {
        sendJson(res, 400, { ok: false, error: 'No symbol' });
        return true;
      }
      sendJson(res, 200, await fetchCandles(symbol, searchParams.get('range') || '1d'));
    } catch (e) {
      sendJson(res, 502, { ok: false, error: e.message || 'Intraday candles failed' });
    }
    return true;
  }

  return {
    fetchCandles,
    handleRoute,
  };
}

module.exports = {
  normalizeYahooCandles,
  createIntradayCandlesService,
};
