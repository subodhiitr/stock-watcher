const path = require('node:path');

async function handleSimulationRuntimeRoute(req, res, pathname, searchParams, deps) {
  if (pathname === '/simulation/start') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return true;
    }
    try {
      const payload = await deps.readJsonBody(req);
      const requestedInterval = Number(payload.tickIntervalSec);
      const tickIntervalSec = Number.isFinite(requestedInterval) && requestedInterval > 0
        ? Math.max(1, Math.floor(requestedInterval))
        : deps.defaultTickIntervalSec;
      const autoResume = typeof payload.autoResume === 'boolean' ? payload.autoResume : true;
      const nextRuntime = await deps.runWithMutationLock(async () => {
        deps.setSimulationTickIntervalSec(tickIntervalSec);
        const next = deps.transitionAndSaveSimulationRuntime({ type: 'start', autoResume });
        deps.startSimulationScheduler('api-start');
        return next;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        state: nextRuntime.state,
        autoResume: nextRuntime.autoResume,
        tickIntervalSec: deps.getSimulationTickIntervalSec(),
        updatedAt: nextRuntime.updatedAt,
      }));
    } catch (e) {
      if (e instanceof deps.RuntimeStateTransitionError) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message, code: e.code, state: e.currentState }));
        return true;
      }
      deps.saveSimulationRuntime({ lastError: e?.message || String(e) });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message || 'Invalid request' }));
    }
    return true;
  }

  if (pathname === '/simulation/stop') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return true;
    }
    try {
      const payload = await deps.readJsonBody(req);
      const mode = String(payload.mode || 'settle').toLowerCase() === 'immediate' ? 'immediate' : 'settle';
      const timeoutCandidate = Number(payload.timeoutSec);
      const timeoutSec = Number.isFinite(timeoutCandidate) && timeoutCandidate > 0
        ? Math.max(1, Math.floor(timeoutCandidate))
        : deps.defaultStopTimeoutSec;
      const nextRuntime = await deps.runWithMutationLock(async () => {
        if (mode === 'settle') {
          deps.setSimulationStopTimeoutSec(timeoutSec);
          deps.setSimulationSettlingStartedAt(Date.now());
        }
        const next = deps.transitionAndSaveSimulationRuntime({ type: 'stop', mode });
        const settings = deps.loadTradeSettingsFile().overrides || {};
        const ownershipContext = deps.getTradeOwnershipContext(next.state, settings);
        const tradeState = deps.loadPaperStateFile();
        const normalizedTrades = deps.normalizeTradeCollectionOwnership(tradeState.trades, ownershipContext);
        if (JSON.stringify(tradeState.trades) !== JSON.stringify(normalizedTrades)) {
          tradeState.trades = normalizedTrades;
          deps.savePaperStateFile(tradeState);
          deps.broadcastPaperTradeState(mode === 'immediate' ? 'simulation-stop-immediate' : 'simulation-stop-settle');
        }
        if (next.state === 'off') deps.stopSimulationScheduler('api-stop');
        else deps.startSimulationScheduler('api-settle');
        return next;
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        state: nextRuntime.state,
        timeoutSec: mode === 'settle' ? deps.getSimulationStopTimeoutSec() : timeoutSec,
        updatedAt: nextRuntime.updatedAt,
      }));
    } catch (e) {
      if (e instanceof deps.RuntimeStateTransitionError) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message, code: e.code, state: e.currentState }));
        return true;
      }
      deps.saveSimulationRuntime({ lastError: e?.message || String(e) });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message || 'Invalid request' }));
    }
    return true;
  }

  if (pathname === '/simulation/status') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(deps.getSimulationRuntimeStatus()));
    return true;
  }

  if (pathname === '/simulation/analysis') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
      return true;
    }
    try {
      const source = String(searchParams.get('source') || 'server-analysis');
      const payload = await deps.buildServerSimulationAnalysisPayload(source);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message || 'Could not build simulation analysis' }));
    }
    return true;
  }

  if (pathname === '/simulation/analysis/stream') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    let closed = false;
    let refreshRunning = false;
    const refreshMs = Math.max(5000, Number(deps.analysisStreamRefreshMs) || 15000);
    const sendAnalysis = async () => {
      if (closed || refreshRunning) return;
      refreshRunning = true;
      try {
        const payload = await deps.buildServerSimulationAnalysisPayload('server-analysis-stream');
        const streamPayload = {
          ...payload,
          candidates:Array.isArray(payload?.candidates) ? payload.candidates.slice(0, 25) : [],
        };
        if (!closed) deps.writeSseEvent(res, streamPayload);
      } catch (error) {
        if (!closed) deps.writeSseEvent(res, { ok:false, error:error.message || 'Could not build simulation analysis' });
      } finally {
        refreshRunning = false;
      }
    };
    const refreshTimer = setInterval(sendAnalysis, refreshMs);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 25000);
    req.on('close', () => {
      closed = true;
      clearInterval(refreshTimer);
      clearInterval(keepAlive);
    });
    sendAnalysis();
    return true;
  }

  if (pathname === '/simulation-snapshots') {
    if (req.method === 'GET') {
      const day = (searchParams.get('day') || searchParams.get('date') || '').trim();
      if (!day) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'day or date query parameter is required' }));
        return true;
      }
      const state = deps.loadSimulationSnapshotsFile(day);
      const snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:true, retentionDays:deps.snapshotRetentionDays, date:day, storage:state.storage || 'legacy-file', count:snapshots.length, snapshots }));
      return true;
    }
    if (req.method === 'POST') {
      try {
        const payload = await deps.readJsonBody(req);
        const { day, count, snapshot, storage } = deps.appendSimulationSnapshot(payload || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok:true, retentionDays:deps.snapshotRetentionDays, date:day, storage:storage || 'sqlite', database:path.basename(deps.snapshotDatabaseFile || 'simulation_snapshots.db'), count, snapshot }));
      } catch(e) {
        res.writeHead(deps.jsonBodyErrorStatus(e, 500), { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'Invalid snapshot payload' }));
      }
      return true;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  return false;
}

module.exports = {
  handleSimulationRuntimeRoute,
};
