const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('cold Yahoo startup paints the server live cache before external quote refresh completes', () => {
  const start = source.indexOf('async function fetchAll()');
  const end = source.indexOf('async function refreshDashboardUiOnly()', start);
  const body = source.slice(start, end);
  const liveCacheStart = body.indexOf('fetchIntradaySignals(MIDCAP_STOCKS.map(stock => stock.sym), { includePrioritySymbols:false })');
  const yahooRefresh = body.indexOf('await fetchYahooStocks(firstLoad)');

  assert.ok(liveCacheStart >= 0, 'first load should subscribe to the server live cache');
  assert.ok(yahooRefresh > liveCacheStart, 'live-cache subscription should start before Yahoo refresh');
});

test('initial stock paint does not subscribe to the full ETF and portfolio universe', () => {
  const streamStart = source.indexOf('async function fetchIntradaySignals(symbols, options = {})');
  const streamEnd = source.indexOf('function startIntradayLiveStream', streamStart);
  const streamBody = source.slice(streamStart, streamEnd);

  assert.match(streamBody, /options\.includePrioritySymbols === false \? \[\] : getBrowserLiveQuoteSymbols\(\)/);
});

test('cold-start seed preserves full snapshots and immediate changed-row updates', () => {
  const streamStart = source.indexOf('async function fetchIntradaySignals(symbols, options = {})');
  const streamEnd = source.indexOf('function startIntradayLiveStream', streamStart);
  const streamBody = source.slice(streamStart, streamEnd);

  assert.match(streamBody, /applyIntradayLiveQuote\(sym, value/);
  assert.match(streamBody, /applyPartialRowUpdates\(changedSymbols\)/);
  assert.doesNotMatch(streamBody, /schedulePartialRowUpdates/);
});

test('bulk live snapshots avoid per-symbol DOM scans before rows exist', () => {
  const streamStart = source.indexOf('async function fetchIntradaySignals(symbols, options = {})');
  const streamEnd = source.indexOf('function startIntradayLiveStream', streamStart);
  const streamBody = source.slice(streamStart, streamEnd);
  const applyStart = source.indexOf('function applyIntradayLiveQuote(');
  const applyEnd = source.indexOf('async function setIntradayDataSource', applyStart);
  const applyBody = source.slice(applyStart, applyEnd);

  assert.match(streamBody, /const changedSymbolSet = changedSymbols \? new Set\(changedSymbols\) : null/);
  assert.match(streamBody, /const hasLiveQuoteDom = !!document\.querySelector/);
  assert.match(streamBody, /updateDom: hasLiveQuoteDom && \(!changedSymbolSet \|\| changedSymbolSet\.has\(sym\)\)/);
  assert.match(applyBody, /if \(options\.updateDom !== false\)/);
});
