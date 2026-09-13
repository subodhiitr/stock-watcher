const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
const functions = source.slice(source.indexOf('function parsePortfolioCsvLine('), source.indexOf('async function portfolioFundamentals('));

function harness(csvBody) {
  const calls = [];
  const context = vm.createContext({
    Date, console: { warn() {} }, YAHOO_HEADERS: {}, NSE_IDX_CACHE_TTL: 86400000,
    nseIdxCache: {}, saveNseIdxCache() {}, loadDashboardStockUniverse: () => [],
    httpsGet: async (request) => {
      calls.push(request.path);
      return { status: csvBody ? 200 : 503, body: csvBody };
    },
    nseJsonWithRetry: async () => {
      calls.push('nse');
      return { data: [{ symbol: 'BACKUP', lastPrice: 100 }] };
    },
  });
  vm.runInContext(functions, context);
  return { context, calls };
}

test('official constituents avoid the failing NSE request and are cached', async () => {
  const { context, calls } = harness('Company Name,Symbol\n"Example, Ltd",EXAMPLE\n');
  const members = await context.portfolioIndexSymbols('NIFTY500');
  assert.equal(members[0].sym, 'EXAMPLE');
  assert.equal(members[0].name, 'Example, Ltd');
  assert.equal(await context.portfolioIndexSymbols('NIFTY500'), members);
  assert.deepEqual(calls, ['/IndexConstituent/ind_nifty500list.csv']);
});

test('spaced index names use the official CSV too', async () => {
  const { context, calls } = harness('Company Name,Symbol\nExample,EXAMPLE\n');
  await context.portfolioIndexSymbols('NIFTY 50');
  assert.deepEqual(calls, ['/IndexConstituent/ind_nifty50list.csv']);
});

test('unavailable or malformed CSV retains NSE backup', async () => {
  for (const body of ['', '<html>unavailable</html>']) {
    const { context, calls } = harness(body);
    const members = await context.portfolioIndexSymbols('NIFTY500');
    assert.equal(members[0].sym, 'BACKUP');
    assert.equal(members[0].price, 100);
    assert.equal(calls.at(-1), 'nse');
  }
});
