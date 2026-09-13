'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeYahooQuarterlyFinancials, normalizeYahooQuarterlyTimeseries, mergeQuarterlyFinancials } = require('../server/quarterly-financials');

const root = path.join(__dirname, '..');

test('normalizes and sorts the latest three Yahoo quarterly income statements in crores', () => {
  const result = normalizeYahooQuarterlyFinancials({
    incomeStatementHistoryQuarterly: {
      incomeStatementHistory: [
        { endDate:{ raw:1719705600 }, totalRevenue:{ raw:1000000000 }, ebitda:{ raw:110000000 }, netIncome:{ raw:50000000 } },
        { endDate:{ raw:1751241600 }, totalRevenue:{ raw:1300000000 }, ebit:{ raw:120000000 }, netIncome:{ raw:70000000 } },
        { endDate:{ raw:1743379200 }, totalRevenue:{ raw:1200000000 }, ebitda:{ raw:140000000 }, netIncome:{ raw:65000000 } },
        { endDate:{ raw:1735603200 }, totalRevenue:{ raw:1100000000 }, ebitda:null, netIncome:{ raw:60000000 } },
      ],
    },
    cashflowStatementHistoryQuarterly: {
      cashflowStatements: [
        { endDate:{ raw:1751241600 }, depreciation:{ raw:30000000 } },
      ],
    },
  });

  assert.equal(result.length, 3);
  assert.deepEqual(result.map(row => row.period), ['Jun 2025', 'Mar 2025', 'Dec 2024']);
  assert.deepEqual(result[0], {
    period:'Jun 2025', endDate:1751241600, revenueCr:130, ebitdaCr:15, netProfitCr:7,
  });
  assert.equal(result[2].ebitdaCr, null);
});

test('mobile stock symbol detail loads and renders the last three quarterly metrics', () => {
  const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

  assert.match(app, /\/yahoo\/quarterly-financials\?symbol=/);
  assert.match(app, /Last 3 Quarters/);
  assert.match(app, /quarter\.revenueCr/);
  assert.match(app, /quarter\.ebitdaCr/);
  assert.match(app, /quarter\.netProfitCr/);
  assert.match(app, /\.slice\(0, 3\)/);
  assert.match(css, /\.quarterly-financials-row/);
  assert.match(proxy, /pathname === '\/quarterly-financials'/);
  assert.match(proxy, /createScreenerQuarterlyFinancialsProvider/);
  assert.match(proxy, /quarterlyEBITDA/);
});
test('Screener values take priority while Yahoo fills missing quarterly metrics', () => {
  const endDate = 1782777600;
  const merged = mergeQuarterlyFinancials(
    [{ period:'Jun 2026', endDate, revenueCr:946, ebitdaCr:148, netProfitCr:96 }],
    [{ period:'Jun 2026', endDate, revenueCr:945.5, ebitdaCr:null, netProfitCr:95.8 }],
  );
  assert.deepEqual(merged[0], {
    period:'Jun 2026', endDate, revenueCr:946, ebitdaCr:148, netProfitCr:96,
  });
});

test('combines Yahoo quarterly timeseries by reporting date', () => {
  const point = (asOfDate, raw) => ({ asOfDate, reportedValue:{ raw } });
  const result = normalizeYahooQuarterlyTimeseries({ timeseries:{ result:[
    { meta:{ type:['quarterlyNetIncome'] }, quarterlyNetIncome:[point('2026-03-31', 70000000), point('2026-06-30', 80000000)] },
    { meta:{ type:['quarterlyEBITDA'] }, quarterlyEBITDA:[point('2026-03-31', 150000000), point('2026-06-30', 170000000)] },
    { meta:{ type:['quarterlyTotalRevenue'] }, quarterlyTotalRevenue:[point('2026-03-31', 1300000000), point('2026-06-30', 1400000000)] },
  ] } });

  assert.deepEqual(result[0], {
    period:'Jun 2026', endDate:1782777600, revenueCr:140, ebitdaCr:17, netProfitCr:8,
  });
  assert.equal(result[1].period, 'Mar 2026');
});
