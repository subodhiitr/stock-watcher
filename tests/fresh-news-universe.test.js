const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFreshNewsService } = require('../server/fresh-news');

test('news scans every dashboard, saved and requested stock and rebuilds incomplete caches', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'news-universe-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dashboardAppPath = path.join(root, 'dashboard.js');
  fs.writeFileSync(dashboardAppPath, "let MIDCAP_STOCKS = [{sym:'BASE',name:'Base',sector:'Test',cap:'large'}];\nconst ETF_ASSETS = [{sym:'ETF',name:'ETF',sector:'ETF',cap:'etf'}];");
  const saved = Array.from({ length:530 }, (_, i) => ({ sym:`S${i}`, name:`Stock ${i}` }));
  saved.push({ sym:'BASE' });
  const nse = [], mint = [];
  const date = '2026-09-10';
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'), cacheDir:root,
    indexFile:path.join(root, 'index.json'), dashboardAppPath,
    loadSavedStocksFile:() => saved,
    fetchNSEAllAnnouncements:async () => [], fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [], fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async symbol => {
      nse.push(symbol);
      return [0, 1].map(i => ({ title:`Order win ${symbol} ${i}`, publishedAt:`${date}T04:00:00Z`, source:'NSE' }));
    },
    fetchScreenerStockAnnouncements:async () => [],
    fetchLiveMintStockAnnouncements:async row => { mint.push(row.symbol); return []; },
  });
  const requested = Array.from({ length:531 }, (_, i) => ({ symbol:`S${i}` }));
  const cachePath = path.join(root, `fresh_stock_news_${date}.json`);
  fs.writeFileSync(cachePath, JSON.stringify({ date, items:[], scanned:320, symbolScanCoverage:{ BASE:100 } }));
  await service.fetchFreshStockNews(requested, { date, maxSymbols:220 });
  let cache = JSON.parse(fs.readFileSync(cachePath));
  assert.equal(cache.scanned, 532);
  assert.equal(new Set(nse).size, 532);
  assert.equal(nse.length, 532);
  assert.equal(mint.length, 532);
  assert.ok(!nse.includes('ETF'));
  assert.equal(cache.symbolScanCoverage.S530, 100);
  assert.equal(cache.items.length, 1064);
  assert.equal(cache.researchItems.length, 1064);
  await service.fetchFreshStockNews(requested, { date });
  assert.equal(nse.length, 532, 'complete cache should be reused');
  saved.push({ sym:'NEW_SAVED' });
  await service.fetchFreshStockNews(requested, { date });
  cache = JSON.parse(fs.readFileSync(cachePath));
  assert.equal(cache.scanned, 533);
  assert.equal(cache.symbolScanCoverage.NEW_SAVED, 100);
});
