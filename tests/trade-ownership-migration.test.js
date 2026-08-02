const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const FIXTURE_ROOT = path.join(__dirname, '.trade-ownership-migration-fixtures');
const PROXY_MODULE_PATH = path.join(__dirname, '..', 'ticker_proxy.js');
const loadedProxies = new Set();

function resetFixtureRoot() {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
}

function loadProxyWithFixture(fixtureName, { autoManualExits = false } = {}) {
  const fixtureDir = path.join(FIXTURE_ROOT, fixtureName);
  fs.mkdirSync(fixtureDir, { recursive: true });
  process.env.SIMULATION_RUNTIME_FILE = path.join(fixtureDir, 'simulation_runtime.json');
  process.env.PAPER_TRADES_FILE = path.join(fixtureDir, 'paper_trades.json');
  process.env.TRADE_SETTINGS_FILE = path.join(fixtureDir, 'trade_settings.json');
  fs.writeFileSync(process.env.TRADE_SETTINGS_FILE, JSON.stringify({
    savedAt: Date.now(),
    overrides: { SIMULATION_AUTO_MANUAL_EXITS: !!autoManualExits }
  }, null, 2), 'utf8');
  delete require.cache[require.resolve(PROXY_MODULE_PATH)];
  const proxy = require(PROXY_MODULE_PATH);
  proxy.__test__.enableDbForTests();
  loadedProxies.add(proxy);
  return { proxy, fixtureDir };
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
  delete process.env.TRADE_SETTINGS_FILE;
});

test('legacy manual trades are backfilled with default ownership on load', () => {
  const { proxy } = loadProxyWithFixture('legacy-manual-backfill', { autoManualExits: false });

  // Seed a trade without ownership fields ΓÇö simulates a legacy trade
  proxy.__test__.setPaperTradesForRuntime([{
    id: 'legacy-manual-1',
    status: 'open',
    symbol: 'INFY',
    side: 'buy',
    qty: 1,
    entryPrice: 100,
    source: 'manual'
  }]);

  // First load normalizes ownership and persists back to DB
  const [trade] = proxy.__test__.getPaperTradesForRuntime();

  assert.equal(trade.entryOwner, 'manual');
  assert.equal(trade.exitOwner, 'manual');
  assert.equal(trade.managedBySimulation, false);
  assert.equal(trade.managementState, 'manual_only');

  // Second load reads the normalized trade from DB
  const [persisted] = proxy.__test__.getPaperTradesForRuntime();
  assert.equal(persisted.entryOwner, 'manual');
  assert.equal(persisted.exitOwner, 'manual');
  assert.equal(persisted.managedBySimulation, false);
  assert.equal(persisted.managementState, 'manual_only');
});

test('SIMULATION_AUTO_MANUAL_EXITS=false keeps manual trades manual_only during running and settling', async () => {
  const { proxy } = loadProxyWithFixture('manual-stays-manual', { autoManualExits: false });

  proxy.__test__.setPaperTradesForRuntime([{
    id: 'manual-trade-1',
    status: 'open',
    symbol: 'INFY',
    side: 'buy',
    qty: 1,
    entryPrice: 100,
    source: 'manual'
  }]);

  const started = await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  assert.equal(started.statusCode, 200);

  proxy.__test__.setSchedulerTickInputs({
    at: '2026-06-24T04:30:00.000Z',
    candidates: [],
    exitBySymbol: {
      INFY: { symbol: 'INFY', action: 'close', reason: 'Target hit', exitPrice: 110 }
    }
  });
  await proxy.__test__.runSchedulerTick();

  let [trade] = proxy.__test__.getPaperTradesForRuntime();
  assert.equal(trade.status, 'open');
  assert.equal(trade.entryOwner, 'manual');
  assert.equal(trade.exitOwner, 'manual');
  assert.equal(trade.managedBySimulation, false);
  assert.equal(trade.managementState, 'manual_only');

  const stopping = await request(proxy, { method: 'POST', path: '/simulation/stop', body: { mode: 'settle' } });
  assert.equal(stopping.statusCode, 200);
  assert.equal(stopping.json.state, 'settling');

  [trade] = proxy.__test__.getPaperTradesForRuntime();
  assert.equal(trade.status, 'open');
  assert.equal(trade.exitOwner, 'manual');
  assert.equal(trade.managedBySimulation, false);
  assert.equal(trade.managementState, 'manual_only');
});

test('SIMULATION_AUTO_MANUAL_EXITS=true transitions eligible manual trades to simulation managed', async () => {
  const { proxy } = loadProxyWithFixture('manual-takeover-enabled', { autoManualExits: true });

  proxy.__test__.setPaperTradesForRuntime([{
    id: 'manual-trade-2',
    status: 'open',
    symbol: 'TCS',
    side: 'buy',
    qty: 1,
    entryPrice: 100,
    source: 'manual'
  }]);

  const started = await request(proxy, { method: 'POST', path: '/simulation/start', body: {} });
  assert.equal(started.statusCode, 200);

  proxy.__test__.setSchedulerTickInputs({ at: '2026-06-24T04:35:00.000Z', candidates: [] });
  await proxy.__test__.runSchedulerTick();

  let [trade] = proxy.__test__.getPaperTradesForRuntime();
  assert.equal(trade.status, 'open');
  assert.equal(trade.entryOwner, 'manual');
  assert.equal(trade.exitOwner, 'simulation');
  assert.equal(trade.managedBySimulation, true);
  assert.equal(trade.managementState, 'simulation_managed');

  const stopping = await request(proxy, { method: 'POST', path: '/simulation/stop', body: { mode: 'settle' } });
  assert.equal(stopping.statusCode, 200);
  assert.equal(stopping.json.state, 'settling');

  proxy.__test__.setSchedulerTickInputs({ at: '2026-06-24T04:36:00.000Z', candidates: [] });
  await proxy.__test__.runSchedulerTick();

  [trade] = proxy.__test__.getPaperTradesForRuntime();
  assert.equal(trade.status, 'open');
  assert.equal(trade.exitOwner, 'simulation');
  assert.equal(trade.managedBySimulation, true);
  assert.equal(trade.managementState, 'settling_managed');
});