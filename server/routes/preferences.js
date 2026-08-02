'use strict';

const { jsonBodyErrorStatus } = require('../http-safety');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function handlePreferenceRoute(req, res, pathname, deps) {
  if (pathname === '/etf-prefs') {
    if (req.method === 'GET') {
      const list = deps.loadSavedETFsFile();
      console.log('[proxy] /etf-prefs GET -> 200, items=', list.length);
      sendJson(res, 200, list);
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
        deps.saveSavedETFsFile(symbols);
        sendJson(res, 200, { ok: true, saved: symbols.length });
      } catch (e) {
        sendJson(res, jsonBodyErrorStatus(e), { error: e.message || 'Invalid JSON' });
      }
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  if (pathname === '/etf-favs') {
    if (req.method === 'GET') {
      const list = deps.loadSavedETFFavsFile();
      console.log('[proxy] /etf-favs GET -> 200, items=', list.length);
      sendJson(res, 200, list);
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
        deps.saveSavedETFFavsFile(symbols);
        sendJson(res, 200, { ok: true, saved: symbols.length });
      } catch (e) {
        sendJson(res, jsonBodyErrorStatus(e), { error: e.message || 'Invalid JSON' });
      }
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  if (pathname === '/stock-prefs') {
    if (req.method === 'GET') {
      sendJson(res, 200, deps.loadSavedStocksFile());
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        let toSave = [];
        if (Array.isArray(payload)) {
          if (payload.length && typeof payload[0] === 'string') {
            toSave = payload.map(s => deps.resolveNseSymbol(s)).filter(Boolean);
          } else {
            toSave = payload.map(item => {
              if (!item || typeof item === 'string') return null;
              const sym = deps.resolveNseSymbol(item.sym || item.symbol || '');
              if (!sym) return null;
              return { sym, name: item.name || sym, sector: item.sector || null, cap: item.cap || null };
            }).filter(Boolean);
          }
        }
        console.log('[proxy] saving stock prefs:', JSON.stringify(toSave));
        deps.saveSavedStocksFile(toSave);
        sendJson(res, 200, { ok: true, saved: toSave.length });
      } catch (e) {
        sendJson(res, jsonBodyErrorStatus(e), { error: e.message || 'Invalid JSON' });
      }
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  if (pathname === '/stock-favs') {
    if (req.method === 'GET') {
      const list = deps.loadSavedStockFavsFile();
      console.log('[proxy] /stock-favs GET -> 200, items=', list.length);
      sendJson(res, 200, list);
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        const symbols = Array.isArray(payload) ? payload.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
        deps.saveSavedStockFavsFile(symbols);
        sendJson(res, 200, { ok: true, saved: symbols.length });
      } catch (e) {
        sendJson(res, jsonBodyErrorStatus(e), { error: e.message || 'Invalid JSON' });
      }
      return true;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return true;
  }

  return false;
}

module.exports = {
  handlePreferenceRoute,
};
