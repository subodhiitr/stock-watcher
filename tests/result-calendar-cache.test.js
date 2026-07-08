const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');
const MODULE_PATH = path.join(__dirname, '..', 'server', 'result-calendar.js');

test('result calendar is module-owned and proxy delegates route/scheduler work', () => {
  const proxySource = fs.readFileSync(PROXY_PATH, 'utf8');
  const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
  const endpointStart = proxySource.indexOf("if (pathname === '/result-calendar')");
  assert.notEqual(endpointStart, -1);
  const endpointEnd = proxySource.indexOf("// /fresh-stock-news", endpointStart);
  assert.notEqual(endpointEnd, -1);
  const endpointSource = proxySource.slice(endpointStart, endpointEnd);

  assert.match(moduleSource, /const CACHE_VERSION = 3/);
  assert.match(moduleSource, /function classifyBoardMeetingResultType\(/);
  assert.match(moduleSource, /function dedupeResultCalendarItems\(/);
  assert.match(moduleSource, /function createResultCalendarService\(/);
  assert.match(moduleSource, /async function fetchNSEAllBoardMeetings\(/);
  assert.match(moduleSource, /for all NSE board-meeting symbols/);
  assert.match(proxySource, /createResultCalendarService\(/);
  assert.match(endpointSource, /resultCalendarService\.handleRoute/);
  assert.match(proxySource, /resultCalendarService\.startCron\(\);/);
  assert.doesNotMatch(proxySource, /function readResultCalendarCache\(/);
  assert.doesNotMatch(proxySource, /function startResultCalendarCron\(/);
  assert.doesNotMatch(endpointSource, /fetchNSEAllBoardMeetings\(/);
});
