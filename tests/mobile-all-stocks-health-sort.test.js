const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('default All Stocks profile sorts complete universe by health descending', () => {
  const start = source.indexOf('function allStockRows');
  const end = source.indexOf('async function loadAllStocks', start);
  const body = source.slice(start, end);
  assert.match(body, /rankedB - rankedA \|\| a\.symbol\.localeCompare\(b\.symbol\)/);
  assert.match(body, /if \(rows\.length\) connectHealthStream\(rows\)/);
});

test('All Stocks reapplies health ordering after progressive health load completes', () => {
  assert.match(source, /healthLoadedSymbols: new Set\(\)/);
  assert.match(source, /if \(state\.allStockFilter === 'all'\) renderAllStocks\(\)/);
});
