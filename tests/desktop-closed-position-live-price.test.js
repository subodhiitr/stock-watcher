const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('desktop Portfolio keeps exit and live prices in separate columns', () => {
  assert.match(source, /const exitPrice = isOpen \? null : Number\(trade\.exitPrice\)/);
  assert.match(source, /<th>Entry<\/th><th>Exit<\/th><th>Live<\/th><th>Capital<\/th>/);
  assert.match(source, /data-browser-live-price="\$\{escapeHTML\(String\(trade\.symbol \|\| ''\)\.toUpperCase\(\)\)\}">\$\{moneyINR\(livePrice\)\}/);
});

test('desktop New Events keeps exit and live prices in separate columns', () => {
  const start = source.indexOf('function renderOpenTradeRows(');
  const end = source.indexOf('function getTradeEventType(', start);
  const renderer = source.slice(start, end);

  assert.match(renderer, /const livePrice = getCurrentTradePrice\(trade\.symbol\)/);
  assert.match(renderer, /<td>\$\{moneyINR\(exitPrice\)\}<\/td>/);
  assert.match(source, /<th>Entry<\/th><th>Exit<\/th><th>Live<\/th><th>Status<\/th>/);
});

test('desktop live quote subscription includes visible closed trades and new events', () => {
  const start = source.indexOf('function getBrowserLiveQuoteSymbols()');
  const end = source.indexOf('function applyIntradayLiveQuote(', start);
  const helper = source.slice(start, end);

  assert.match(helper, /isTradeOnPortfolioDate\(trade, portfolioTransactionDate\)/);
  assert.match(helper, /newSimulationTradeKeys\.has\(simulationTradeKey\(trade\)\)/);
});
