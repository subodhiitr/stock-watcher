const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const FIXTURE_ROOT = path.join(__dirname, '.sharekhan-portfolio-ltp-fixtures');
const PROXY_MODULE_PATH = path.join(__dirname, '..', 'ticker_proxy.js');
const BROKER_ROUTE_PATH = path.join(__dirname, '..', 'server', 'routes', 'broker.js');

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
  proxy.__test__.enableDbForTests();
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
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      for (const [key, value] of Object.entries(headers)) state.headers[String(key).toLowerCase()] = value;
    },
    write(chunk) { state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
    end(chunk) {
      if (chunk != null) state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      state.body = Buffer.concat(state.chunks).toString('utf8');
    },
  };
  const handling = proxy.proxyRequestHandler(req, res);
  if (body != null) req.end(JSON.stringify(body));
  else req.end();
  await handling;
  const bodyText = state.body || Buffer.concat(state.chunks).toString('utf8');
  return { statusCode: state.statusCode, body: bodyText, json: bodyText ? JSON.parse(bodyText) : null };
}

test.beforeEach(resetFixtureRoot);

test.after(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  delete process.env.SIMULATION_RUNTIME_FILE;
  delete process.env.PAPER_TRADES_FILE;
});

test('Sharekhan portfolio enriches missing LTP from app-stored snapshot prices', async () => {
  const proxy = loadProxyWithFixture('snapshot-price-fallback');
  proxy.__test__.setSharekhanClientForTests({
    async getPortfolioState() {
      return {
        asOf: Date.now(),
        funds: { availableCash: 0, utilizedMargin: 0, netEquity: 0 },
        positions: { openCount: 0, dayCount: 0, dayPnl: 0, totalPnl: 0, list: [] },
        holdings: {
          count: 1,
          marketValue: 1000,
          list: [{
            symbol: 'INFY',
            qty: 2,
            avgPrice: 500,
            ltp: 0,
            closePrice: 990,
            investedValue: 1000,
            marketValue: 1000,
            pnl: 0,
          }],
        },
      };
    },
  });
  proxy.__test__.setSimulationSnapshotsForTests([
    {
      at: new Date().toISOString(),
      candidates: [{
        symbol: 'INFY',
        price: 1012.35,
        quote: { prevClose: 1000 },
      }],
    },
  ]);

  const response = await request(proxy, { method: 'GET', path: '/sharekhan-portfolio' });

  assert.equal(response.statusCode, 200);
  const holding = response.json.portfolio.holdings.list[0];
  assert.equal(holding.ltp, 1012.35);
  assert.equal(holding.closePrice, 1000);
  assert.equal(holding.marketValue, 2024.7);
  assert.equal(holding.pnl, 1024.7);
  assert.equal(response.json.portfolio.holdings.marketValue, 2024.7);
  assert.equal(response.json.portfolio.positions.totalPnl, 1024.7);
});

test('Sharekhan portfolio builds app price fallback once per request', () => {
  const source = fs.readFileSync(PROXY_MODULE_PATH, 'utf8');
  const brokerRouteSource = fs.readFileSync(BROKER_ROUTE_PATH, 'utf8');
  assert.match(source, /function buildStoredAppPriceMap\(/);
  assert.match(source, /function loadLatestSimulationSnapshots\(/);
  assert.match(brokerRouteSource, /const storedPrices = deps\.buildStoredAppPriceMap\(/);
  assert.doesNotMatch(brokerRouteSource, /readStoredAppPrice\(h\.symbol\)/);
  const buildPriceMapSource = source.slice(
    source.indexOf('function buildStoredAppPriceMap('),
    source.indexOf('function broadcastIntradayLive(')
  );
  assert.match(buildPriceMapSource, /loadLatestSimulationSnapshots\(\)/);
  assert.doesNotMatch(buildPriceMapSource, /loadAllSimulationSnapshots\(\)/);
});
