const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createResultCalendarService } = require('../server/result-calendar');

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
  assert.match(moduleSource, /async function fetchNSEBoardMeetingsForSymbols\(/);
  assert.match(moduleSource, /tracked NSE board-meeting symbols/);
  assert.match(proxySource, /createResultCalendarService\(/);
  assert.match(endpointSource, /resultCalendarService\.handleRoute/);
  assert.match(proxySource, /resultCalendarService\.startCron\(\);/);
  assert.doesNotMatch(proxySource, /function readResultCalendarCache\(/);
  assert.doesNotMatch(proxySource, /function startResultCalendarCron\(/);
  assert.doesNotMatch(endpointSource, /fetchNSEAllBoardMeetings\(/);
});

test('result calendar refresh fetches tracked symbols individually so TCS July result is captured', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-calendar-'));
  const calls = [];
  const service = createResultCalendarService({
    cacheDir,
    indexFile: path.join(cacheDir, 'index.json'),
    getResultCalendarSymbols: () => ['TCS', 'INFY'],
    nseJsonWithRetry: async requestPath => {
      calls.push(requestPath);
      if (requestPath.endsWith('symbol=TCS')) {
        return [{
          bm_symbol: 'TCS',
          bm_date: '09-Jul-2099',
          bm_purpose: 'Board Meeting Intimation',
          bm_desc: 'TATA CONSULTANCY SERVICES LIMITED has informed the Exchange about Board Meeting to be held on 09-Jul-2099 to consider and approve the Quarterly Audited Financial results of the Company for the period ended June 2099 and Dividend.',
          sm_name: 'Tata Consultancy Services Limited',
        }];
      }
      return [];
    },
  });

  await service.refreshCache('test', { fromDate: '2099-07-08', days: 3 });
  const cached = service.readCache(['TCS'], { fromDate: '2099-07-08', days: 3 });

  assert.ok(calls.some(requestPath => requestPath === '/api/corporate-board-meetings?index=equities&symbol=TCS'));
  assert.equal(cached.resultCalendarBySymbol.TCS?.[0]?.dateKey, '2099-07-09');
  assert.equal(cached.resultCalendarBySymbol.TCS?.[0]?.type, 'Financial Results');
});

test('result calendar proxy source includes dashboard stock universe plus saved stocks', () => {
  const proxySource = fs.readFileSync(PROXY_PATH, 'utf8');
  const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

  assert.match(dashboardSource, /let MIDCAP_STOCKS = \[/);
  assert.match(proxySource, /loadResultCalendarSymbols/);
  assert.match(proxySource, /dashboard-app\.js/);
  assert.match(proxySource, /MIDCAP_STOCKS/);
  assert.match(proxySource, /getResultCalendarSymbols:loadResultCalendarSymbols/);
});

test('result calendar route can force refresh stale cache before reading', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'result-calendar-'));
  let refreshed = false;
  const service = createResultCalendarService({
    cacheDir,
    indexFile: path.join(cacheDir, 'index.json'),
    getResultCalendarSymbols: () => ['TCS'],
    nseJsonWithRetry: async requestPath => {
      if (requestPath.endsWith('symbol=TCS')) {
        refreshed = true;
        return [{
          bm_symbol: 'TCS',
          bm_date: '09-Jul-2099',
          bm_desc: 'Board Meeting to consider and approve audited financial results',
          sm_name: 'Tata Consultancy Services Limited',
        }];
      }
      return [];
    },
  });
  const chunks = [];
  const req = { method:'POST' };
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(chunk) { chunks.push(chunk); },
  };

  await service.handleRoute(req, res, {
    searchParams:new URLSearchParams(),
    readJsonBody:async () => ({ force:true, fromDate:'2099-07-08', days:3 }),
  });
  const payload = JSON.parse(chunks.join(''));

  assert.equal(res.status, 200);
  assert.equal(refreshed, true);
  assert.equal(payload.resultCalendarBySymbol.TCS?.[0]?.dateKey, '2099-07-09');
});
