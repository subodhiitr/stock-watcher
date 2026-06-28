const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const FIXTURE_ROOT = path.join(__dirname, '.trade-execution-api-contract-fixtures');
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
  req.emit('close');
  const bodyText = state.body != null ? state.body : Buffer.concat(state.chunks).toString('utf8');
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch (_) {
    json = null;
  }
  return {
    statusCode: state.statusCode,
    headers: state.headers,
    body: bodyText || '',
    json
  };
}

function removeVolatileTradeFields(trade) {
  if (!trade || typeof trade !== 'object') return trade;
  const clone = { ...trade };
  delete clone.id;
  delete clone.openedAt;
  delete clone.closedAt;
  delete clone.savedAt;
  return clone;
}

function normalizeTradeResponse(json) {
  if (!json || typeof json !== 'object') return json;
  const copy = { ...json };
  if (copy.trade) copy.trade = removeVolatileTradeFields(copy.trade);
  if (copy.partial) copy.partial = removeVolatileTradeFields(copy.partial);
  if (Array.isArray(copy.trades)) copy.trades = copy.trades.map(removeVolatileTradeFields);
  return copy;
}

function parseSsePayloads(bodyText) {
  return String(bodyText || '')
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice(6).trim())
    .filter(Boolean)
    .map(raw => JSON.parse(raw));
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

test('GET /trade-execution aliases /paper-trades and stream routes keep parity', async () => {
  const proxy = loadProxyWithFixture('get-stream-parity');

  const opened = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'open', symbol: 'INFY', side: 'buy', qty: 2, entryPrice: 1500.123 }
  });
  assert.equal(opened.statusCode, 200);

  const canonicalGet = await request(proxy, { method: 'GET', path: '/trade-execution' });
  const aliasGet = await request(proxy, { method: 'GET', path: '/paper-trades' });
  assert.equal(canonicalGet.statusCode, 200);
  assert.equal(aliasGet.statusCode, 200);
  assert.equal(canonicalGet.headers['x-deprecated-route'], undefined);
  assert.equal(aliasGet.headers['x-deprecated-route'], '/paper-trades will be removed next minor release');
  assert.deepEqual(normalizeTradeResponse(canonicalGet.json), normalizeTradeResponse(aliasGet.json));

  const canonicalStream = await request(proxy, { method: 'GET', path: '/trade-execution/stream' });
  const aliasStream = await request(proxy, { method: 'GET', path: '/paper-trades/stream' });
  assert.equal(canonicalStream.statusCode, 200);
  assert.equal(aliasStream.statusCode, 200);
  assert.equal(canonicalStream.headers['content-type'], 'text/event-stream');
  assert.equal(aliasStream.headers['content-type'], 'text/event-stream');
  assert.equal(canonicalStream.headers['x-deprecated-route'], undefined);
  assert.equal(aliasStream.headers['x-deprecated-route'], '/paper-trades will be removed next minor release');
  assert.match(canonicalStream.body, /"reason":"init"/);
  assert.match(aliasStream.body, /"reason":"init"/);
});

test('stream init payload includes additive simulationRuntime and keeps legacy keys with alias parity', async () => {
  const proxy = loadProxyWithFixture('stream-simulation-runtime-additive');

  const opened = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'open', symbol: 'INFY', side: 'buy', qty: 1, entryPrice: 1500 }
  });
  assert.equal(opened.statusCode, 200);

  const canonicalStream = await request(proxy, { method: 'GET', path: '/trade-execution/stream' });
  const aliasStream = await request(proxy, { method: 'GET', path: '/paper-trades/stream' });
  assert.equal(canonicalStream.statusCode, 200);
  assert.equal(aliasStream.statusCode, 200);

  const canonicalPayloads = parseSsePayloads(canonicalStream.body);
  const aliasPayloads = parseSsePayloads(aliasStream.body);
  assert.ok(canonicalPayloads.length >= 1);
  assert.ok(aliasPayloads.length >= 1);
  const canonicalInit = canonicalPayloads[0];
  const aliasInit = aliasPayloads[0];

  assert.equal(canonicalInit.reason, 'init');
  assert.equal(aliasInit.reason, 'init');
  assert.ok(Array.isArray(canonicalInit.trades));
  assert.ok(Array.isArray(aliasInit.trades));
  assert.equal(typeof canonicalInit.portfolio, 'object');
  assert.equal(typeof aliasInit.portfolio, 'object');
  assert.ok('savedAt' in canonicalInit);
  assert.ok('savedAt' in aliasInit);
  assert.equal(typeof canonicalInit.simulationRuntime, 'object');
  assert.equal(typeof aliasInit.simulationRuntime, 'object');
  assert.ok(canonicalInit.simulationRuntime && canonicalInit.simulationRuntime.ok === true);
  assert.ok(aliasInit.simulationRuntime && aliasInit.simulationRuntime.ok === true);
  assert.deepEqual(Object.keys(canonicalInit).sort(), Object.keys(aliasInit).sort());
  assert.deepEqual(
    Object.keys(canonicalInit.simulationRuntime || {}).sort(),
    Object.keys(aliasInit.simulationRuntime || {}).sort()
  );
});

test('POST action parity across /trade-execution and /paper-trades', async () => {
  const proxy = loadProxyWithFixture('post-action-parity');

  const openCanonical = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'open', symbol: 'TCS', side: 'buy', qty: 3, entryPrice: 3900.129 }
  });
  assert.equal(openCanonical.statusCode, 200);
  assert.equal(openCanonical.json?.trade?.entryPrice, 3900.13);

  const openAlias = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'open', symbol: 'HDFCBANK', side: 'sell', qty: 4, entryPrice: 1610.019 }
  });
  assert.equal(openAlias.statusCode, 200);
  assert.equal(openAlias.json?.trade?.entryPrice, 1610.02);

  const closeAlias = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'close', id: openCanonical.json.trade.id, exitPrice: 3920.567 }
  });
  assert.equal(closeAlias.statusCode, 200);
  assert.equal(closeAlias.json?.trade?.exitPrice, 3920.57);

  const partialCanonical = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'partial-close', id: openAlias.json.trade.id, qty: 2, exitPrice: 1599.994 }
  });
  assert.equal(partialCanonical.statusCode, 200);
  assert.equal(partialCanonical.json?.partial?.exitPrice, 1599.99);
  assert.equal(partialCanonical.json?.trade?.qty, 2);

  const addCanonical = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'add-capital', amount: 123.456, note: 'Top up' }
  });
  assert.equal(addCanonical.statusCode, 200);
  assert.equal(addCanonical.json?.portfolio?.capitalAdds?.at(-1)?.amount, 123.46);

  const closedPartialId = partialCanonical.json?.partial?.id;
  const deleteAlias = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'delete', id: closedPartialId }
  });
  assert.equal(deleteAlias.statusCode, 200);
  assert.equal(deleteAlias.json?.ok, true);
});

test('action validation matrix enforces 400/409 requirements', async () => {
  const proxy = loadProxyWithFixture('validation-matrix');

  const invalidSide = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'open', symbol: 'INFY', side: 'hold', qty: 1, entryPrice: 1 }
  });
  assert.equal(invalidSide.statusCode, 400);

  const invalidQty = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'open', symbol: 'INFY', side: 'buy', qty: 1.5, entryPrice: 10 }
  });
  assert.equal(invalidQty.statusCode, 400);

  const invalidMoney = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'add-capital', amount: 0 }
  });
  assert.equal(invalidMoney.statusCode, 400);

  const opened = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'open', symbol: 'SBIN', side: 'buy', qty: 2, entryPrice: 800 }
  });
  assert.equal(opened.statusCode, 200);

  const duplicateOpen = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'open', symbol: 'SBIN', side: 'buy', qty: 2, entryPrice: 800 }
  });
  assert.equal(duplicateOpen.statusCode, 409);

  const invalidPartialQty = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'partial-close', id: opened.json.trade.id, qty: 2.2, exitPrice: 810 }
  });
  assert.equal(invalidPartialQty.statusCode, 400);

  const invalidCloseTrade = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'close', id: 'missing-trade', exitPrice: 810 }
  });
  assert.equal(invalidCloseTrade.statusCode, 400);

  const invalidPartialTrade = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'partial-close', id: 'missing-trade', qty: 1, exitPrice: 810 }
  });
  assert.equal(invalidPartialTrade.statusCode, 400);

  const deleteOpenTrade = await request(proxy, {
    method: 'POST',
    path: '/paper-trades',
    body: { action: 'delete', id: opened.json.trade.id }
  });
  assert.equal(deleteOpenTrade.statusCode, 400);

  const closeOpenTrade = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'close', id: opened.json.trade.id, exitPrice: 810 }
  });
  assert.equal(closeOpenTrade.statusCode, 200);

  const deleteClosedTrade = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'delete', id: opened.json.trade.id }
  });
  assert.equal(deleteClosedTrade.statusCode, 200);
});

test('open action captures requested broker mode and close uses per-trade broker details', async () => {
  const proxy = loadProxyWithFixture('per-trade-broker-mode');
  const opened = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'open', symbol: 'INFY', side: 'buy', qty: 1, entryPrice: 1000, brokerMode: 'zerodha_dry_run', source: 'manual' }
  });
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.json?.trade?.executionMode, 'zerodha_dry_run');
  assert.equal(opened.json?.trade?.broker?.name, 'zerodha');
  assert.equal(opened.json?.trade?.broker?.mode, 'dry-run');
  assert.equal(opened.json?.trade?.broker?.status, 'entry_dry_run');

  const closed = await request(proxy, {
    method: 'POST',
    path: '/trade-execution',
    body: { action: 'close', id: opened.json.trade.id, exitPrice: 1010, brokerMode: 'paper' }
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json?.trade?.executionMode, 'zerodha_dry_run');
  assert.equal(closed.json?.trade?.broker?.status, 'exit_dry_run');
  assert.equal(typeof closed.json?.trade?.broker?.exitOrder, 'object');
});