const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
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

test('dashboard percent change is derived from previous close when available', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const helperSource = extractFunctionSource(source, 'getDisplayChangePct');
  assert.ok(helperSource, 'getDisplayChangePct helper missing');

  const script = new vm.Script(`${helperSource}; getDisplayChangePct;`);
  const getDisplayChangePct = script.runInNewContext({ Number, Math });

  assert.equal(
    getDisplayChangePct({ price: 516.10, prevClose: 509.75, change: 21.14 }),
    1.25
  );
  assert.equal(
    getDisplayChangePct({ price: 1139, prevClose: 1078.1, change: 10.13 }),
    5.65
  );
  assert.equal(
    getDisplayChangePct({ price: 100, change: 2.5 }),
    2.5
  );
});

test('dashboard row and summary renderers use previous-close display helper', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const stockRowSource = extractFunctionSource(source, 'renderStockRowHTML');
  const statsBarSource = extractFunctionSource(source, 'updateStatsBar');
  const sectorSource = extractFunctionSource(source, 'renderSectors');

  assert.match(stockRowSource, /getDisplayChangePct\(d\)/);
  assert.match(statsBarSource, /getDisplayChangePct\(d\)/);
  assert.match(sectorSource, /getDisplayChangePct\(d\)/);
  assert.match(source, /getDisplayChangePct\(getBrowserStockData\(stock\.sym\)\)/);
});
