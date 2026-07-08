async function handleReplayWhyRoute(req, res, searchParams, deps) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  try {
    const day = String(searchParams.get('day') || deps.getIstDateKey()).trim();
    const symbol = String(searchParams.get('symbol') || '').trim();
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:'symbol is required' }));
      return true;
    }
    const payload = deps.buildWhyMissedResponse(day, symbol);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok:false, error:e.message || 'Why missed failed' }));
  }
  return true;
}

async function handleReplayJobsRoute(req, res, searchParams, deps) {
  if (req.method === 'POST') {
    try {
      let day = searchParams.get('day') || '';
      let mode = searchParams.get('mode') || '';
      if (!day || !mode) {
        let payload = {};
        try { payload = await deps.readJsonBody(req, 3000); } catch (_) { payload = {}; }
        day = day || String(payload.day || '').trim();
        mode = mode || String(payload.mode || '').trim();
      }
      day = day || deps.getIstDateKey();
      const jobMode = deps.replayModeFromParams({ mode });
      const job = deps.createReplayJob(day, jobMode);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, job:deps.compactReplayJob(job), jobs:deps.compactReplayJobHistory() }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:e.message || 'Could not create replay job' }));
    }
    return true;
  }

  if (req.method === 'GET') {
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, jobs:deps.compactReplayJobHistory() }));
      return true;
    }
    const job = deps.replayJobs.get(id);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, error:'Replay job not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok:true, job:deps.compactReplayJob(job), jobs:deps.compactReplayJobHistory() }));
    return true;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
  return true;
}

async function handleReplayReportRoute(req, res, searchParams, deps) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  try {
    const day = (searchParams.get('day') || searchParams.get('date') || deps.getIstDateKey()).trim();
    const mode = String(searchParams.get('mode') || 'report').toLowerCase();
    const cachedOnly = searchParams.get('cachedOnly') === '1';
    let payload;
    if (mode === 'autotune') {
      payload = deps.buildReplayAutoTuneResponse(day);
    } else if (mode === 'deep_sweep') {
      payload = deps.buildReplayDeepSweepResponse(day, { cachedOnly });
    } else {
      payload = deps.buildReplayResponse(day, { sweep: mode === 'sweep' || searchParams.get('sweep') === '1' });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok:false, error:e.message || 'Replay failed' }));
  }
  return true;
}

async function handleReplayRoute(req, res, pathname, searchParams, deps) {
  if (pathname === '/simulation-replay/why') {
    return handleReplayWhyRoute(req, res, searchParams, deps);
  }
  if (pathname === '/simulation-replay/jobs') {
    return handleReplayJobsRoute(req, res, searchParams, deps);
  }
  if (pathname === '/simulation-replay') {
    return handleReplayReportRoute(req, res, searchParams, deps);
  }
  return false;
}

module.exports = {
  handleReplayRoute,
};
