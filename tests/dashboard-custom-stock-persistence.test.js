const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const plainStart = source.indexOf(`function ${functionName}(`);
  const asyncStart = source.indexOf(`async function ${functionName}(`);
  const start = asyncStart >= 0 && (plainStart < 0 || asyncStart < plainStart)
    ? asyncStart
    : plainStart;
  if (start < 0) return null;
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        openBrace = source.indexOf('{', i);
        break;
      }
    }
  }
  if (openBrace < 0) return null;
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

test('custom stock detection survives sector and cap edits for saved stocks', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const fnSource = extractFunctionSource(source, 'isCustomStock');
  assert.ok(fnSource, 'isCustomStock helper missing');

  const script = new vm.Script(`${fnSource}; isCustomStock;`);
  const isCustomStock = script.runInNewContext({});

  assert.equal(isCustomStock({ sym: 'ABC', sector: 'IT', cap: 'mid', source: 'saved' }), true);
  assert.equal(isCustomStock({ sym: 'XYZ', sector: 'Custom', cap: 'custom' }), true);
  assert.equal(isCustomStock({ sym: 'INFY', sector: 'IT', cap: 'large' }), false);
});

test('saveUserStocks persists saved custom stocks even after metadata edits', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const customSource = extractFunctionSource(source, 'isCustomStock');
  const saveSource = extractFunctionSource(source, 'saveUserStocks');
  assert.ok(customSource, 'isCustomStock helper missing');
  assert.ok(saveSource, 'saveUserStocks helper missing');

  const sandbox = {
    MIDCAP_STOCKS: [
      { sym: 'ABC', name: 'ABC Ltd', sector: 'IT', cap: 'mid', source: 'saved' },
      { sym: 'INFY', name: 'Infosys', sector: 'IT', cap: 'large' },
    ],
    savedPayload: null,
    fetchedBody: null,
    STOCK_PREFS_ENDPOINT: '/stock-prefs',
    saveSavedStocksToStorage(payload) { sandbox.savedPayload = payload; },
    fetch: async (url, options) => {
      sandbox.fetchedBody = JSON.parse(options.body);
      return { ok: true };
    },
    console: { warn() {} },
    JSON,
    String,
    Array,
  };

  const script = new vm.Script(`${customSource}\n${saveSource}\nsaveUserStocks;`);
  const saveUserStocks = script.runInNewContext(sandbox);

  return saveUserStocks().then(() => {
    assert.equal(JSON.stringify(sandbox.savedPayload), JSON.stringify([
      { sym: 'ABC', name: 'ABC Ltd', sector: 'IT', cap: 'mid' },
    ]));
    assert.equal(JSON.stringify(sandbox.fetchedBody), JSON.stringify(sandbox.savedPayload));
  });
});

test('saveStockMetadata marks edited legacy custom stock as saved before persisting', async () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const saveMetaSource = extractFunctionSource(source, 'saveStockMetadata');
  assert.ok(saveMetaSource, 'saveStockMetadata helper missing');

  const asset = { sym: 'ABC', name: 'ABC Ltd', sector: 'Custom', cap: 'custom' };
  let saveCalls = 0;
  let closeCalls = 0;
  let renderCalls = 0;
  const sandbox = {
    editingStockSymbol: 'ABC',
    MIDCAP_STOCKS: [asset],
    document: {
      getElementById(id) {
        if (id === 'meta-sector') return { value: 'IT' };
        if (id === 'meta-cap') return { value: 'mid' };
        return null;
      },
    },
    saveUserStocks() { saveCalls += 1; },
    closeStockMetaModal() { closeCalls += 1; },
    renderDashboard() { renderCalls += 1; },
  };

  const script = new vm.Script(`${saveMetaSource}; saveStockMetadata;`);
  const saveStockMetadata = script.runInNewContext(sandbox);
  await saveStockMetadata();

  assert.equal(asset.source, 'saved');
  assert.equal(asset.sector, 'IT');
  assert.equal(asset.cap, 'mid');
  assert.equal(saveCalls, 1);
  assert.equal(closeCalls, 1);
  assert.equal(renderCalls, 1);
});
