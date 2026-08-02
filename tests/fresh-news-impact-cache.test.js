const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFreshNewsService } = require('../server/fresh-news');

test('fresh-news service exposes the strongest cached symbol impact without refetching', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-news-impact-'));
  const date = '2026-07-16';
  let fetches = 0;
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'),
    cacheDir:root,
    indexFile:path.join(root, 'index.json'),
    dashboardAppPath:path.join(root, 'missing-dashboard.js'),
    classifyNewsItem:() => 'Deal',
    classifyNewsTradeImpact:item => ({
      newsSentiment:'Positive',
      tradeImpactScore:item.title.includes('large') ? 80 : 60,
      tradeImpactAbs:item.title.includes('large') ? 80 : 60,
      tradeImpactReason:'Order win',
    }),
    fetchNSEAllAnnouncements:async () => {
      fetches += 1;
      return [
        { symbol:'TEST', title:'large order win', publishedAt:`${date}T04:00:00.000Z` },
        { symbol:'TEST', title:'order win update', publishedAt:`${date}T03:30:00.000Z` },
      ];
    },
    fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [],
    fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async () => [],
  });
  try {
    await service.fetchFreshStockNews([{ symbol:'TEST', name:'Test' }], { date });
    const impact = service.getCachedImpactForSymbol('TEST', new Date(`${date}T06:00:00.000Z`));
    assert.equal(impact.tradeImpactScore, 80);
    assert.equal(impact.tradeImpactReason, 'Order win');
    assert.equal(fetches, 1);
    service.getCachedImpactForSymbol('TEST', new Date(`${date}T06:05:00.000Z`));
    assert.equal(fetches, 1);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('fresh-news service exposes separate result and news or dividend impacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-event-impacts-'));
  const date = '2026-07-16';
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'),
    cacheDir:root,
    indexFile:path.join(root, 'index.json'),
    dashboardAppPath:path.join(root, 'missing-dashboard.js'),
    classifyNewsItem:title => /result/i.test(title) ? 'Results' : /dividend/i.test(title) ? 'Dividend' : 'News',
    classifyNewsTradeImpact:item => {
      const result = /result/i.test(`${item.type} ${item.title}`);
      return {
        newsSentiment:result ? 'Negative' : 'Positive',
        resultVerdict:result ? 'Negative' : null,
        tradeImpactScore:result ? -90 : 55,
        tradeImpactAbs:result ? 90 : 55,
        tradeImpactReason:result ? 'Profit declined' : 'Dividend announced',
      };
    },
    fetchNSEAllAnnouncements:async () => [
      { symbol:'TEST', title:'quarterly result update', publishedAt:`${date}T04:00:00.000Z` },
      { symbol:'TEST', title:'interim dividend announced', publishedAt:`${date}T03:30:00.000Z` },
    ],
    fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [],
    fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async () => [],
  });
  try {
    await service.fetchFreshStockNews([{ symbol:'TEST', name:'Test' }], { date });
    const impacts = service.getCachedImpactsForSymbol('TEST', new Date(`${date}T06:00:00.000Z`));
    assert.equal(impacts.result.resultVerdict, 'Negative');
    assert.equal(impacts.result.tradeImpactScore, -90);
    assert.equal(impacts.news.type, 'Dividend');
    assert.equal(impacts.news.tradeImpactScore, 55);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});
