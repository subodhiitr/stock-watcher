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
  delete require.cache[require.resolve(PROXY_MODULE_PATH)];
  const proxy = require(PROXY_MODULE_PATH);
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
  assert.equal(status.json.lockActive, false);
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
