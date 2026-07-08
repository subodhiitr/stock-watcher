'use strict';

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

async function handleDashboardRoute(req, res, pathname, searchParams, deps) {
  if (pathname === '/health') {
    sendJson(res, 200, deps.buildHealthPayload());
    return true;
  }

  if (pathname === '/dashboard-bootstrap') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      sendJson(res, 200, deps.buildDashboardBootstrap(), { 'Cache-Control': 'no-cache' });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message || 'Bootstrap failed' });
    }
    return true;
  }

  if (pathname === '/dashboard-market') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const symbols = String(searchParams.get('symbols') || '')
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 300);
      deps.rememberSimulationUniverse(symbols);
      const [indices, quotes] = await Promise.all([
        deps.yahooIndices().catch(e => ({ ok: false, error: e.message })),
        symbols.length
          ? deps.yahooQuote(symbols).catch(e => ({ ok: false, error: e.message, quotes: {} }))
          : Promise.resolve({ ok: true, quotes: {} }),
      ]);
      sendJson(res, 200, {
        ok: true,
        savedAt: Date.now(),
        indices,
        quotes: quotes.quotes || {},
        quoteError: quotes.error || null,
      }, { 'Cache-Control': 'no-cache' });
    } catch (e) {
      sendJson(res, 502, { ok: false, error: e.message || 'Market payload failed' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleDashboardRoute,
};
