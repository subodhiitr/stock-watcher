const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const FIXTURE_ROOT = path.join(__dirname, '.simulation-runtime-endpoints-fixtures');
const PROXY_MODULE_PATH = path.join(__dirname, '..', 'ticker_proxy.js');
const loadedProxies = new Set();

function resetFixtureRoot() {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
}

function loadProxyWithFixture(fixtureName) {
  const fixtureDir = path.join(FIXTURE_ROOT, fixtureName);
  fs.mkdirSync(fixtureDir, { recursive: true });
  process.env.SIMULATION_RUNTIME_FILE = path.join(fixtureDir, 'simulation_runtime.json');
  process.env.PAPER_TRADES_FILE = path.join(fixtureDir, 'paper_trades.json');
  process.env.TRADE_SETTINGS_FILE = path.join(fixtureDir, 'trade_settings.json');
  delete require.cache[require.resolve(PROXY_MODULE_PATH)];
  const proxy = require(PROXY_MODULE_PATH);
  proxy.__test__.enableDbForTests();
  loadedProxies.add(proxy);
  return proxy;
}

async function request(proxy, { method, path: requestPath, body }) {
  const req = new PassThrough();
  req.method = method;
  req.url = requestPath;
  req.headers = body == null ? {} : { 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };

  const state = { statusCode: 200, headers: {}, chunks: [] };
  const res = {
    setHeader(name, value) {
      state.headers[String(name).toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      for (const [key, value] of Object.entries(headers)) {
        state.headers[String(key).toLowerCase()] = value;
      }
    },
    write(chunk) {
      state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      state.body = Buffer.concat(state.chunks).toString('utf8');
    }
  };

  const handling = proxy.proxyRequestHandler(req, res);
  if (body != null) req.end(JSON.stringify(body));
  else req.end();
  await handling;
  return {
    statusCode: state.statusCode,
    body: state.body || '',
    json: state.body ? JSON.parse(state.body) : null
  };
}

test.beforeEach(() => {
  resetFixtureRoot();
});

test.afterEach(() => {
  for (const proxy of loadedProxies) {
    try {
      proxy?.__test__?.stopSimulationSchedulerForTests?.();
    } catch (_) {}
  }
  loadedProxies.clear();
});

test.after(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  delete process.env.SIMULATION_RUNTIME_FILE;
  delete process.env.PAPER_TRADES_FILE;
  delete process.env.TRADE_SETTINGS_FILE;
});

test('POST /simulation/start and GET /simulation/status expose runtime defaults', async () => {
  const proxy = loadProxyWithFixture('start-defaults');

  const started = await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json.ok, true);
  assert.equal(started.json.state, 'running');
  assert.equal(started.json.autoResume, true);
  assert.equal(started.json.tickIntervalSec, 15);

  const status = await request(proxy, { method: 'GET', path: '/simulation/status' });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json.ok, true);
  assert.equal(status.json.state, 'running');
  assert.equal(status.json.tickIntervalSec, 15);
  assert.equal(typeof status.json.schedulerDiagnostics, 'object');
  assert.equal(status.json.schedulerDiagnostics.activeMinIntervalMs, 2000);
  assert.equal(status.json.schedulerDiagnostics.idleMinIntervalMs, 5000);
  assert.equal(typeof status.json.schedulerDiagnostics.queuedSymbolCount, 'number');
  assert.equal(status.json.lockActive, false);
  assert.equal(typeof status.json.dataQuality, 'object');
  assert.equal(typeof status.json.dataQuality.total, 'number');
  assert.equal(typeof status.json.dataQuality.bySource, 'object');
  assert.equal(typeof status.json.sharekhanHealth, 'object');
  assert.equal(typeof status.json.sharekhanHealth.connected, 'boolean');
  assert.equal(typeof status.json.sharekhanHealth.subscribedSymbols, 'number');
  assert.equal(typeof status.json.sharekhanHealth.lastTickAt, 'number');
});

test('GET /simulation/analysis returns server-side analyzed candidates payload', async () => {
  const proxy = loadProxyWithFixture('simulation-analysis-endpoint');
  const response = await request(proxy, { method: 'GET', path: '/simulation/analysis' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.ok, true);
  assert.ok(Array.isArray(response.json.candidates), 'candidates should be an array');
  assert.equal(typeof response.json.entryWindowOpen, 'boolean');
  assert.equal(typeof response.json.eodSettlement, 'boolean');
  assert.equal(typeof response.json.dataQuality, 'object');
  assert.equal(typeof response.json.dataQuality.total, 'number');
  assert.equal(typeof response.json.dataQuality.freshCount, 'number');
  assert.equal(typeof response.json.dataQuality.staleCount, 'number');
  assert.equal(typeof response.json.dataQuality.bySource, 'object');
});

test('POST /simulation/start returns 409 on invalid transition', async () => {
  const proxy = loadProxyWithFixture('start-transition-conflict');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  const secondStart = await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  assert.equal(secondStart.statusCode, 409);
  assert.equal(secondStart.json.ok, false);
});

test('POST /simulation/stop defaults to settle and timeoutSec=900', async () => {
  const proxy = loadProxyWithFixture('stop-defaults');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  const stop = await request(proxy, { method: 'POST', path: '/simulation/stop', body: {} });
  assert.equal(stop.statusCode, 200);
  assert.equal(stop.json.ok, true);
  assert.equal(stop.json.state, 'settling');
  assert.equal(stop.json.timeoutSec, 900);
});

test('POST /simulation/stop mode=immediate transitions running or settling to off', async () => {
  const proxy = loadProxyWithFixture('stop-immediate');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, { method: 'POST', path: '/simulation/stop', body: {} });

  const immediate = await request(proxy, { method: 'POST', path: '/simulation/stop', body: { mode: 'immediate' } });
  assert.equal(immediate.statusCode, 200);
  assert.equal(immediate.json.ok, true);
  assert.equal(immediate.json.state, 'off');
});

test('POST /simulation/stop returns 409 for invalid transitions', async () => {
  const proxy = loadProxyWithFixture('stop-transition-conflict');
  const stop = await request(proxy, { method: 'POST', path: '/simulation/stop', body: { mode: 'settle' } });
  assert.equal(stop.statusCode, 409);
  assert.equal(stop.json.ok, false);
});

test('server candidate generation applies high-profit short trigger before cutoff', async () => {
  const proxy = loadProxyWithFixture('candidate-high-profit-trigger-on');
  const candidate = proxy.__test__.buildServerCandidateFromIntradayForTests(
    'TCS',
    {
      signal: 'hold',
      price: 3900,
      target: 3841.5,
      stop: 3929.25,
      stopPct: 0.75,
      dayChange: 18.2,
      score: 0,
      reasons: [],
      entryStatus: 'Wait',
    },
    {
      SIMULATION_SHORT_MIN_SCORE: 45,
      SIMULATION_HIGH_PROFIT_EXIT_THRESHOLD_PCT: 17,
      SIMULATION_HIGH_PROFIT_EXIT_HOUR_CUTOFF: 13,
    },
    { sector: 'IT', cap: 'large' },
    '2026-06-25T06:00:00.000Z'
  );

  assert.ok(candidate, 'candidate should be generated');
  assert.equal(candidate.highProfitShortTrigger, true);
  assert.equal(candidate.side, 'sell');
  assert.equal(candidate.signal, 'sell');
  assert.equal(candidate.score, -45);
});

test('server candidate generation does not apply high-profit short trigger after cutoff', async () => {
  const proxy = loadProxyWithFixture('candidate-high-profit-trigger-off');
  const candidate = proxy.__test__.buildServerCandidateFromIntradayForTests(
    'TCS',
    {
      signal: 'hold',
      price: 3900,
      target: 3841.5,
      stop: 3929.25,
      stopPct: 0.75,
      dayChange: 18.2,
      score: 0,
      reasons: [],
      entryStatus: 'Wait',
    },
    {
      SIMULATION_SHORT_MIN_SCORE: 45,
      SIMULATION_HIGH_PROFIT_EXIT_THRESHOLD_PCT: 17,
      SIMULATION_HIGH_PROFIT_EXIT_HOUR_CUTOFF: 13,
    },
    { sector: 'IT', cap: 'large' },
    '2026-06-25T09:00:00.000Z'
  );

  assert.ok(candidate, 'candidate should be generated');
  assert.equal(candidate.highProfitShortTrigger, undefined);
  assert.equal(candidate.side, null);
  assert.equal(candidate.signal, 'hold');
});

test('scheduler settling mode blocks entries but still processes exits', async () => {
  const proxy = loadProxyWithFixture('settling-behavior');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, { method: 'POST', path: '/simulation/stop', body: { mode: 'settle' } });

  proxy.__test__.setPaperTradesForRuntime([
    { id: 't1', symbol: 'INFY', side: 'buy', qty: 1, status: 'open', entryPrice: 100, source: 'simulation' }
  ]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-24T10:30:00.000Z',
    candidates: [
      { symbol: 'TCS', side: 'buy', price: 3900 }
    ],
    exitBySymbol: {
      INFY: { symbol: 'INFY', action: 'close', reason: 'Target hit', exitPrice: 110 }
    }
  });

  await proxy.__test__.runSchedulerTick();
  const state = proxy.__test__.getPaperTradesForRuntime();

  assert.equal(state.filter(trade => trade.status === 'open' && trade.symbol === 'INFY').length, 0);
  assert.equal(state.filter(trade => trade.status === 'open' && trade.symbol === 'TCS').length, 0);
  assert.equal(state.some(trade => trade.status === 'closed' && trade.symbol === 'INFY'), true);
});

test('scheduler auto-closes simulation-managed open trades after EOD cutoff', async () => {
  const proxy = loadProxyWithFixture('eod-auto-squareoff');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'eod-open-1',
      status: 'open',
      symbol: 'INFY',
      side: 'sell',
      qty: 1,
      entryPrice: 100,
      target: 98,
      stop: 104,
      source: 'simulation',
      managedBySimulation: true,
      managementState: 'simulation_managed',
      openedAt: '2026-06-25T09:56:00.000Z',
    }
  ]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T10:00:00.000Z',
    candidates: [
      {
        symbol: 'INFY',
        side: 'sell',
        signal: 'sell',
        price: 101,
        score: -60,
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.5 },
        indicators: {
          entryStatus: 'Triggered',
          target: 98,
          stop: 104,
          stopPct: 0.5,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const closed = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.id === 'eod-open-1');
  assert.ok(closed, 'trade should remain in paper state');
  assert.equal(closed.status, 'closed');
  assert.match(String(closed.closeReason || ''), /EOD square-off/i);
});

test('scheduler auto-closes manual open trades after EOD cutoff', async () => {
  const proxy = loadProxyWithFixture('eod-auto-squareoff-manual');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'eod-manual-1',
      status: 'open',
      symbol: 'INDIGO',
      side: 'buy',
      qty: 1,
      entryPrice: 5450,
      target: 5515.4,
      stop: 5428.2,
      source: 'manual',
      entryOwner: 'manual',
      exitOwner: 'manual',
      managedBySimulation: false,
      managementState: 'manual_only',
      openedAt: '2026-06-25T09:56:00.000Z',
    }
  ]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T10:00:00.000Z',
    candidates: [
      {
        symbol: 'INDIGO',
        side: 'buy',
        signal: 'buy',
        price: 5440,
        score: 62,
        freshness: { stale: false },
        indicators: {
          entryStatus: 'Triggered',
          target: 5515.4,
          stop: 5428.2,
          stopPct: 0.4,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const closed = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.id === 'eod-manual-1');
  assert.ok(closed, 'manual trade should remain in paper state');
  assert.equal(closed.status, 'closed');
  assert.match(String(closed.closeReason || ''), /EOD square-off/i);
});

test('scheduler keeps an EOD trade open when no executable quote is available', async () => {
  const proxy = loadProxyWithFixture('eod-missing-candidate-fallback');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'eod-missing-1',
      status: 'open',
      symbol: 'MAZDOCK',
      side: 'sell',
      qty: 1,
      entryPrice: 2505,
      target: null,
      stop: null,
      source: 'simulation',
      entryOwner: 'simulation',
      exitOwner: 'simulation',
      managedBySimulation: true,
      managementState: 'simulation_managed',
      openedAt: '2026-06-25T09:56:00.000Z',
    }
  ]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T10:00:00.000Z',
    candidates: [],
  });

  await proxy.__test__.runSchedulerTick();
  const closed = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.id === 'eod-missing-1');
  assert.ok(closed, 'trade should remain in paper state');
  assert.equal(closed.status, 'open');
  assert.equal(closed.exitPrice ?? null, null);
});

test('scheduler does not open new trades outside simulation entry window', async () => {
  const proxy = loadProxyWithFixture('after-hours-entry-block');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T11:14:00.000Z',
    candidates: [
      {
        symbol: 'INDIGO',
        side: 'buy',
        signal: 'buy',
        price: 5450,
        score: 72,
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.7 },
        indicators: {
          entryStatus: 'Triggered',
          target: 5515.4,
          stop: 5428.2,
          stopPct: 0.4,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'INDIGO');
  assert.equal(opened, undefined, 'scheduler should not open entries after 14:45 IST');
});

test('scheduler blocks new entries when daily stop guard is hit and override is disabled', async () => {
  const proxy = loadProxyWithFixture('stop-guard-blocked');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, {
    method: 'POST',
    path: '/trade-settings',
    body: {
      SIMULATION_OVERRIDE_STOP_GUARD: 0,
      SIMULATION_DAILY_MAX_STOPS: 1,
      SIMULATION_DAILY_MAX_TRADES: 20,
      SIMULATION_DAILY_MAX_NET_LOSS_PCT: 99,
      SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false,
    },
  });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'stop-loss-1',
      status: 'closed',
      symbol: 'INFY',
      side: 'buy',
      qty: 1,
      entryPrice: 1500,
      exitPrice: 1480,
      pnl: -20,
      closeReason: 'Simulation confirmed stop',
      openedAt: '2026-06-25T05:00:00.000Z',
      closedAt: '2026-06-25T05:10:00.000Z',
      source: 'simulation',
    }
  ]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:00:00.000Z',
    candidates: [
      {
        symbol: 'TCS',
        side: 'buy',
        signal: 'buy',
        price: 3900,
        score: 72,
        setupType: 'VWAP_PULLBACK_OR_HOLD',
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.6 },
        indicators: {
          entryStatus: 'Triggered',
          target: 3948.75,
          stop: 3871.2,
          stopPct: 0.74,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.equal(opened, undefined, 'scheduler should block entry due to stop guard');
});

test('scheduler allows new entries when daily stop guard override is enabled', async () => {
  const proxy = loadProxyWithFixture('stop-guard-override-enabled');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, {
    method: 'POST',
    path: '/trade-settings',
    body: {
      SIMULATION_OVERRIDE_STOP_GUARD: 1,
      SIMULATION_DAILY_MAX_STOPS: 1,
      SIMULATION_DAILY_MAX_TRADES: 20,
      SIMULATION_DAILY_MAX_NET_LOSS_PCT: 99,
      SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false,
    },
  });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'stop-loss-2',
      status: 'closed',
      symbol: 'INFY',
      side: 'buy',
      qty: 1,
      entryPrice: 1500,
      exitPrice: 1480,
      pnl: -20,
      closeReason: 'Simulation confirmed stop',
      openedAt: '2026-06-25T05:00:00.000Z',
      closedAt: '2026-06-25T05:10:00.000Z',
      source: 'simulation',
    }
  ]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:00:00.000Z',
    candidates: [
      {
        symbol: 'TCS',
        side: 'buy',
        signal: 'buy',
        price: 3900,
        score: 72,
        setupType: 'VWAP_PULLBACK_OR_HOLD',
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.6 },
        indicators: {
          entryStatus: 'Triggered',
          target: 3948.75,
          stop: 3871.2,
          stopPct: 0.74,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.ok(opened, 'scheduler should allow entry when stop guard override is enabled');
});

test('scheduler-created simulation trades preserve target and stop from candidate intent', async () => {
  const proxy = loadProxyWithFixture('scheduler-entry-target-stop');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-24T05:45:00.000Z',
    candidates: [
      { symbol: 'TCS', side: 'buy', price: 3900, target: 3948.75, stop: 3871.2 }
    ],
    exitBySymbol: {}
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');

  assert.ok(opened, 'scheduler should open a simulation trade for candidate');
  assert.equal(opened.source, 'simulation');
  assert.equal(opened.target, 3948.75);
  assert.equal(opened.stop, 3871.2);
});

test('scheduler-created trades include target and stop when using SimulationEngine path', async () => {
  const proxy = loadProxyWithFixture('scheduler-entry-engine-target-stop');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, {
    method: 'POST',
    path: '/trade-settings',
    body: { SIMULATION_LONG_ENTRY_QUALITY_GUARDS_ENABLED: false },
  });
  proxy.__test__.setPaperTradesForRuntime([]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:00:00.000Z',
    candidates: [
      {
        symbol: 'TCS',
        side: 'buy',
        signal: 'buy',
        price: 3900,
        score: 72,
        setupType: 'VWAP_PULLBACK_OR_HOLD',
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.6 },
        indicators: {
          entryStatus: 'Triggered',
          target: 3948.75,
          stop: 3871.2,
          stopPct: 0.74,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.ok(opened, 'scheduler should open a simulation trade');
  assert.equal(opened.source, 'simulation');
  assert.equal(opened.qty, 25);
  assert.equal(opened.target, 3948.75);
  assert.equal(opened.stop, 3871.2);
  assert.equal(opened.setupType, 'VWAP_PULLBACK_OR_HOLD');
  assert.equal(opened.signal, 'buy');
});

test('scheduler blocks entries from stale snapshot context', async () => {
  const proxy = loadProxyWithFixture('stale-entry-snapshot-blocked');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, {
    method: 'POST',
    path: '/trade-settings',
    body: {
      SIMULATION_ENTRY_MAX_SNAPSHOT_AGE_MIN: 3,
      SIMULATION_DAILY_MAX_TRADES: 20,
      SIMULATION_DAILY_MAX_NET_LOSS_PCT: 99,
    },
  });
  proxy.__test__.setPaperTradesForRuntime([]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:10:00.000Z',
    snapshotId: 'old-snapshot',
    snapshotAt: '2026-06-25T06:00:00.000Z',
    candidates: [{
      symbol: 'TCS',
      side: 'buy',
      signal: 'buy',
      price: 3900,
      score: 72,
      setupType: 'VWAP_PULLBACK_OR_HOLD',
      freshness: { stale: false },
      guard: { level: 'ok', label: 'OK' },
      cost: { ok: true, netPct: 1.6 },
      indicators: { entryStatus: 'Triggered', target: 3948.75, stop: 3871.2, stopPct: 0.74 },
    }],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.equal(opened, undefined, 'scheduler should block stale snapshot entries');
});

test('scheduler blocks entries after clustered losing stops', async () => {
  const proxy = loadProxyWithFixture('clustered-stop-cooldown');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  await request(proxy, {
    method: 'POST',
    path: '/trade-settings',
    body: {
      SIMULATION_OVERRIDE_STOP_GUARD: 0,
      SIMULATION_DAILY_MAX_STOPS: 4,
      SIMULATION_CLUSTERED_STOP_COUNT: 2,
      SIMULATION_CLUSTERED_STOP_WINDOW_MIN: 60,
      SIMULATION_CLUSTERED_STOP_COOLDOWN_MIN: 45,
      SIMULATION_DAILY_MAX_TRADES: 20,
      SIMULATION_DAILY_MAX_NET_LOSS_PCT: 99,
    },
  });
  proxy.__test__.setPaperTradesForRuntime([
    { id: 'stop-a', status: 'closed', symbol: 'INFY', side: 'buy', qty: 1, entryPrice: 1500, exitPrice: 1485, pnl: -15, closeReason: 'Simulation confirmed stop', openedAt: '2026-06-25T05:20:00.000Z', closedAt: '2026-06-25T05:30:00.000Z', source: 'simulation' },
    { id: 'stop-b', status: 'closed', symbol: 'HDFCBANK', side: 'buy', qty: 1, entryPrice: 1600, exitPrice: 1580, pnl: -20, closeReason: 'Simulation emergency stop', openedAt: '2026-06-25T05:40:00.000Z', closedAt: '2026-06-25T05:50:00.000Z', source: 'simulation' },
  ]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:00:00.000Z',
    candidates: [{
      symbol: 'TCS',
      side: 'buy',
      signal: 'buy',
      price: 3900,
      score: 72,
      setupType: 'VWAP_PULLBACK_OR_HOLD',
      freshness: { stale: false },
      guard: { level: 'ok', label: 'OK' },
      cost: { ok: true, netPct: 1.6 },
      indicators: { entryStatus: 'Triggered', target: 3948.75, stop: 3871.2, stopPct: 0.74 },
    }],
  });

  await proxy.__test__.runSchedulerTick();
  const opened = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.equal(opened, undefined, 'scheduler should pause entries after clustered stops');
});

test('scheduler does not create dry-run ghost trade after live ECONNABORTED entry', async () => {
  const proxy = loadProxyWithFixture('live-timeout-no-ghost-trade');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  proxy.__test__.setBrokerModeForTests('zerodha_live');
  proxy.__test__.setZerodhaClientForTests({
    async placeOrder() {
      throw new Error('No response from server with error code: ECONNABORTED');
    },
  });
  proxy.__test__.setPaperTradesForRuntime([]);
  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:00:00.000Z',
    candidates: [{
      symbol: 'TCS',
      side: 'buy',
      signal: 'buy',
      price: 3900,
      score: 72,
      setupType: 'VWAP_PULLBACK_OR_HOLD',
      freshness: { stale: false },
      guard: { level: 'ok', label: 'OK' },
      cost: { ok: true, netPct: 1.6 },
      indicators: { entryStatus: 'Triggered', target: 3948.75, stop: 3871.2, stopPct: 0.74 },
    }],
  });

  await proxy.__test__.runSchedulerTick();
  assert.equal(proxy.__test__.getPaperTradesForRuntime().some(trade => trade.symbol === 'TCS'), false);
});

test('scheduler backfills target and stop for legacy open simulation trades', async () => {
  const proxy = loadProxyWithFixture('scheduler-backfill-target-stop');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setPaperTradesForRuntime([
    {
      id: 'legacy-open-1',
      status: 'open',
      symbol: 'TCS',
      side: 'buy',
      qty: 1,
      entryPrice: 3900,
      target: null,
      stop: null,
      source: 'simulation',
      managedBySimulation: true,
      openedAt: '2026-06-25T05:58:00.000Z',
    }
  ]);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T06:01:00.000Z',
    candidates: [
      {
        symbol: 'TCS',
        side: 'buy',
        signal: 'buy',
        price: 3900,
        score: 58,
        setupType: 'VWAP_PULLBACK_OR_HOLD',
        freshness: { stale: false },
        guard: { level: 'ok', label: 'OK' },
        cost: { ok: true, netPct: 1.4 },
        indicators: {
          entryStatus: 'Triggered',
          target: 3948.75,
          stop: 3871.2,
          stopPct: 0.74,
        },
      }
    ],
  });

  await proxy.__test__.runSchedulerTick();
  const legacyOpen = proxy.__test__.getPaperTradesForRuntime().find(trade => trade.status === 'open' && trade.symbol === 'TCS');
  assert.ok(legacyOpen, 'legacy trade should remain open');
  assert.equal(legacyOpen.target, 3948.75);
  assert.equal(legacyOpen.stop, 3871.2);
  assert.equal(legacyOpen.setupType, 'VWAP_PULLBACK_OR_HOLD');
  assert.equal(legacyOpen.signal, 'buy');
});

test('scheduler auto-stops running simulation after 3:30 PM IST', async () => {
  const proxy = loadProxyWithFixture('auto-stop-after-market');
  await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-25T10:01:00.000Z',
    candidates: [],
  });

  await proxy.__test__.runSchedulerTick();
  const runtime = proxy.__test__.getSimulationRuntimeSnapshot();
  // With no open trades, auto-stop should immediately transition to 'off'
  assert.equal(runtime.state, 'off');
  assert.equal(runtime.schedulerActive, false);
});

test('startup auto-resume starts scheduler when persisted state is running and autoResume=true', async () => {
  const proxy = loadProxyWithFixture('startup-auto-resume');
  const runtimePath = process.env.SIMULATION_RUNTIME_FILE;
  fs.writeFileSync(runtimePath, JSON.stringify({
    state: 'running',
    autoResume: true,
    lastTickAt: 0,
    updatedAt: Date.now(),
    lastError: '',
    version: 1
  }, null, 2), 'utf8');

  await proxy.__test__.initializeSimulationRuntime();
  const runtime = proxy.__test__.getSimulationRuntimeSnapshot();
  assert.equal(runtime.state, 'running');
  assert.equal(runtime.schedulerActive, true);
});
