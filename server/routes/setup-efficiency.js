'use strict';

const { isTradingDate } = require('../setup-efficiency');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(payload));
}

function writeEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleSetupEfficiencyRoute(req, res, pathname, searchParams, deps) {
  if (!pathname.startsWith('/setup-efficiency')) return false;
  const service = deps.setupEfficiencyService;
  if (!service) {
    sendJson(res, 503, { ok:false, error:'Setup efficiency service unavailable' });
    return true;
  }
  const period = String(searchParams?.get('period') || 'all').toLowerCase();
  const requestedDate = String(searchParams?.get('date') || '');

  if (pathname === '/setup-efficiency' && req.method === 'GET') {
    if (requestedDate && !isTradingDate(requestedDate)) {
      sendJson(res, 400, { ok:false, error:'Date must use YYYY-MM-DD format' });
      return true;
    }
    sendJson(res, 200, service.getPayload(period, requestedDate));
    return true;
  }

  if (pathname === '/setup-efficiency/reconcile' && req.method === 'POST') {
    const result = await service.reconcile('manual');
    sendJson(res, result.ok ? 200 : 500, { ...result, payload:service.getPayload(period, requestedDate) });
    return true;
  }

  if (pathname === '/setup-efficiency/analyze-date' && req.method === 'POST') {
    if (!isTradingDate(requestedDate)) {
      sendJson(res, 400, { ok:false, error:'A valid date in YYYY-MM-DD format is required' });
      return true;
    }
    const result = await service.reconcile('on-demand-date');
    sendJson(res, result.ok ? 200 : 500, {
      ...result,
      payload:service.getPayload('all', requestedDate),
    });
    return true;
  }

  if (pathname === '/setup-efficiency/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type':'text/event-stream',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive',
      'X-Accel-Buffering':'no',
    });
    writeEvent(res, 'setup-efficiency', service.getPayload(period));
    const unsubscribe = service.subscribe(() => {
      if (!res.writableEnded) writeEvent(res, 'setup-efficiency', service.getPayload(period));
    });
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': keep-alive\n\n');
    }, 25000);
    keepAlive.unref?.();
    const cleanup = () => {
      clearInterval(keepAlive);
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
  handleSetupEfficiencyRoute,
};
