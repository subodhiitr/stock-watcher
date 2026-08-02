'use strict';

const { isTradingDate } = require('../setup-efficiency');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(payload));
}

function writeEvent(res, payload) {
  res.write('event: strategy-advisor\n');
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleStrategyAdvisorRoute(req, res, pathname, searchParams, deps) {
  if (!pathname.startsWith('/strategy-advisor')) return false;
  const service = deps.strategyAdvisorService;
  if (!service) {
    sendJson(res, 503, { ok:false, error:'Strategy Advisor service unavailable' });
    return true;
  }
  const date = String(searchParams?.get('date') || '').trim();

  if (pathname === '/strategy-advisor' && req.method === 'GET') {
    if (!isTradingDate(date)) {
      sendJson(res, 400, { ok:false, error:'A valid date in YYYY-MM-DD format is required' });
      return true;
    }
    sendJson(res, 200, service.getPayload(date));
    return true;
  }

  if (pathname === '/strategy-advisor/prepare' && req.method === 'POST') {
    if (!isTradingDate(date)) {
      sendJson(res, 400, { ok:false, error:'A valid date in YYYY-MM-DD format is required' });
      return true;
    }
    try {
      const state = await service.prepare(date);
      sendJson(res, 202, { ok:true, state });
    } catch (error) {
      sendJson(res, error?.status || 500, { ok:false, error:error?.message || String(error) });
    }
    return true;
  }

  if (pathname === '/strategy-advisor/run') {
    sendJson(res, 409, {
      ok:false,
      error:'Strategy Advisor reasoning runs in a Codex task. Prepare evidence here, then invoke $strategy-advisor in Codex.',
    });
    return true;
  }

  if (pathname === '/strategy-advisor/stream' && req.method === 'GET') {
    if (!isTradingDate(date)) {
      sendJson(res, 400, { ok:false, error:'A valid date in YYYY-MM-DD format is required' });
      return true;
    }
    res.writeHead(200, {
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive',
      'X-Accel-Buffering':'no',
    });
    let lastVersion = '';
    const sendLatest = () => {
      if (res.writableEnded) return;
      const payload = service.getPayload(date);
      const version = [
        payload.state?.updatedAt || 0,
        payload.evidence?.updatedAt || 0,
        payload.result?.updatedAt || 0,
      ].join('|');
      if (version === lastVersion) return;
      lastVersion = version;
      writeEvent(res, payload);
    };
    sendLatest();
    const unsubscribe = service.subscribe(date, () => {
      sendLatest();
    });
    const resultWatcher = setInterval(sendLatest, 2000);
    resultWatcher.unref?.();
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 25000);
    keepAlive.unref?.();
    const cleanup = () => {
      clearInterval(keepAlive);
      clearInterval(resultWatcher);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    return true;
  }

  sendJson(res, 405, { ok:false, error:'Method not allowed' });
  return true;
}

module.exports = {
  handleStrategyAdvisorRoute,
};
