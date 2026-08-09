const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFreshNewsService, freshNewsRefreshDateKeys } = require('../server/fresh-news');

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

test('research catalyst coverage records a verified no-event scan as neutral data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-catalyst-coverage-'));
  const asOf = new Date('2026-07-16T06:00:00.000Z');
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'),
    cacheDir:root,
    indexFile:path.join(root, 'index.json'),
    dashboardAppPath:path.join(root, 'missing-dashboard.js'),
    classifyNewsItem:() => 'News',
    classifyNewsTradeImpact:() => ({ newsSentiment:'Neutral', tradeImpactScore:0, tradeImpactAbs:0, tradeImpactReason:'No event' }),
    fetchNSEAllAnnouncements:async () => [],
    fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [],
    fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async () => [],
  });
  try {
    for (const date of freshNewsRefreshDateKeys(asOf)) {
      await service.fetchFreshStockNews([{ symbol:'QUIET', name:'Quiet Company' }], { date });
    }
    const signals = service.getCachedResearchSignalsForSymbol('QUIET', asOf);
    assert.equal(signals.scanCoveragePct, 100);
    assert.equal(signals.catalystImpact, 0);
    assert.equal(signals.resultImpact, 0);
    assert.equal(signals.eventRisk, 0);
    assert.match(signals.evidence.join(' '), /No verified NSE catalyst/u);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('research catalyst coverage does not count failed NSE symbol requests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-catalyst-failure-'));
  const asOf = new Date('2026-07-16T06:00:00.000Z');
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'), cacheDir:root, indexFile:path.join(root, 'index.json'),
    dashboardAppPath:path.join(root, 'missing-dashboard.js'),
    classifyNewsItem:() => 'News', classifyNewsTradeImpact:() => ({ newsSentiment:'Neutral', tradeImpactScore:0, tradeImpactAbs:0 }),
    fetchNSEAllAnnouncements:async () => [], fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [], fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async () => Object.assign([], { coverageError:'NSE unavailable' }),
  });
  try {
    for (const date of freshNewsRefreshDateKeys(asOf)) {
      await service.fetchFreshStockNews([{ symbol:'FAILED', name:'Failed Company' }], { date });
    }
    const signals = service.getCachedResearchSignalsForSymbol('FAILED', asOf);
    assert.equal(signals.scanCoveragePct, 0);
    assert.equal(signals.catalystImpact, null);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('research catalyst scan includes verified filings from the 30-day lookback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-catalyst-lookback-'));
  const asOf = new Date('2026-07-16T06:00:00.000Z');
  const service = createFreshNewsService({
    cacheFile:path.join(root, 'legacy.json'), cacheDir:root, indexFile:path.join(root, 'index.json'),
    dashboardAppPath:path.join(root, 'missing-dashboard.js'),
    classifyNewsItem:() => 'Deal',
    classifyNewsTradeImpact:() => ({ newsSentiment:'Positive', tradeImpactScore:80, tradeImpactAbs:80, tradeImpactReason:'Order win' }),
    fetchNSEAllAnnouncements:async () => [], fetchNSEAllResults:async () => [],
    fetchNSEAllCorporateActions:async () => [], fetchNSEAllBoardMeetings:async () => [],
    fetchNSEStockAnnouncements:async () => [{
      title:'Verified order win', source:'NSE', publishedAt:'2026-07-06T04:00:00.000Z', type:'Deal',
    }],
  });
  try {
    for (const date of freshNewsRefreshDateKeys(asOf)) {
      await service.fetchFreshStockNews([{ symbol:'WINNER', name:'Winner Company' }], { date });
    }
    const signals = service.getCachedResearchSignalsForSymbol('WINNER', asOf);
    assert.equal(signals.scanCoveragePct, 100);
    assert.equal(signals.scanLookbackDays, 30);
    assert.ok(signals.catalystImpact > 0);
    assert.match(signals.evidence.join(' '), /Verified order win/u);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});
