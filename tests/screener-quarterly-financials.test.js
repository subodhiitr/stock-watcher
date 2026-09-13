'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseScreenerQuarterlyFinancials,
  createScreenerQuarterlyFinancialsProvider,
} = require('../server/screener-quarterly-financials');

const SAMPLE_HTML = `
<section id="quarters" class="card card-large">
  <h2>Quarterly Results</h2>
  <div data-result-table><table><thead><tr>
    <th></th><th data-date-key="2025-12-31">Dec 2025</th><th data-date-key="2026-03-31">Mar 2026</th><th data-date-key="2026-06-30">Jun 2026</th>
  </tr></thead><tbody>
    <tr><td class="text"><button>Sales <span>+</span></button></td><td>804</td><td>1,243</td><td>946</td></tr>
    <tr class="strong"><td class="text">Operating Profit</td><td>119</td><td>194</td><td>148</td></tr>
    <tr><td class="text">Net Profit</td><td>75</td><td>116</td><td>96</td></tr>
  </tbody></table></div>
</section>`;

test('parses Screener quarterly Sales, Operating Profit and Net Profit in crores', () => {
  const rows = parseScreenerQuarterlyFinancials(SAMPLE_HTML);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    period:'Jun 2026',
    endDate:1782777600,
    revenueCr:946,
    ebitdaCr:148,
    netProfitCr:96,
  });
});

test('Screener quarterly provider prefers consolidated and caches the company page', async () => {
  let calls = 0;
  const provider = createScreenerQuarterlyFinancialsProvider({
    minRequestGapMs:0,
    cacheTtlMs:60000,
    fetchImpl:async url => {
      calls++;
      assert.equal(url, 'https://www.screener.in/company/KAYNES/consolidated/');
      return { ok:true, text:async () => SAMPLE_HTML };
    },
  });
  const first = await provider.fetchStockQuarterlyFinancials('KAYNES');
  const second = await provider.fetchStockQuarterlyFinancials('KAYNES');
  assert.equal(first.quarters.length, 3);
  assert.equal(first.source, 'Screener.in');
  assert.equal(second.quarters[0].ebitdaCr, 148);
  assert.equal(calls, 1);
});

test('Screener quarterly provider falls back to standalone company pages', async () => {
  const urls = [];
  const provider = createScreenerQuarterlyFinancialsProvider({
    minRequestGapMs:0,
    fetchImpl:async url => {
      urls.push(url);
      if (url.endsWith('/consolidated/')) return { ok:false, status:404, text:async () => '' };
      return { ok:true, text:async () => SAMPLE_HTML };
    },
  });
  const result = await provider.fetchStockQuarterlyFinancials('KAYNES');
  assert.equal(result.quarters.length, 3);
  assert.deepEqual(urls, [
    'https://www.screener.in/company/KAYNES/consolidated/',
    'https://www.screener.in/company/KAYNES/',
  ]);
});
