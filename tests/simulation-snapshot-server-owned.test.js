const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  const openBrace = source.indexOf('{', start);
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

test('dashboard intraday SSE handler no longer posts simulation snapshots', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.doesNotMatch(source, /saveSimulationSnapshot\('intraday-refresh'\)/);
});

test('proxy persists simulation snapshots from server intraday refresh loop', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function persistServerSimulationSnapshot\(/);
  assert.match(source, /persistServerSimulationSnapshot\(/);
});

test('server snapshot selection includes top 50 positive-score ETF buy candidates', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const select = vm.runInNewContext(`(${extractFunctionSource(source, 'selectServerSnapshotCandidates')})`);
  assert.equal(typeof select, 'function');
  const stocks = Array.from({ length: 120 }, (_, index) => ({
    symbol: `STOCK${index}`,
    assetType: 'stock',
    side: 'buy',
    score: 1000 - index,
  }));
  const etfs = Array.from({ length: 60 }, (_, index) => ({
    symbol: `ETF${index}`,
    assetType: 'etf',
    side: 'buy',
    score: index + 1,
  }));
  const negativeEtfs = Array.from({ length: 5 }, (_, index) => ({
    symbol: `ETF_NEG${index}`,
    assetType: 'etf',
    side: 'sell',
    score: -100 - index,
  }));

  const selected = select([...stocks, ...etfs, ...negativeEtfs], 100, 50);
  const selectedEtfs = selected.filter(candidate => candidate.assetType === 'etf');

  assert.equal(selectedEtfs.length, 50);
  assert.equal(selectedEtfs[0].symbol, 'ETF59');
  assert.equal(selectedEtfs.at(-1).symbol, 'ETF10');
  assert.equal(selectedEtfs.some(candidate => Number(candidate.score) < 0), false);
  assert.equal(selectedEtfs.some(candidate => String(candidate.side) === 'sell'), false);
});
