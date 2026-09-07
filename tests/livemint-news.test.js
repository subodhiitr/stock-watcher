const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFreshNewsService } = require('../server/fresh-news');
const {
  parseLiveMintRss,
  liveMintItemMatchesStock,
  createLiveMintNewsProvider,
} = require('../server/livemint-news');

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[BLS International warns investors after fraud investigation]]></title>
    <description><![CDATA[Authorities are investigating alleged irregularities involving BLS International Services.]]></description>
    <link>https://www.livemint.com/companies/news/bls-international-fraud-11700000000000.html</link>
    <pubDate>Wed, 26 Aug 2026 05:15:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Visa Steel wins a new supply contract]]></title>
    <description><![CDATA[The steelmaker disclosed the order on Wednesday.]]></description>
    <link>https://www.livemint.com/companies/news/visa-steel-contract-11700000000001.html</link>
    <pubDate>Wed, 26 Aug 2026 06:30:00 GMT</pubDate>
  </item>
</channel></rss>`;

test('LiveMint RSS parser extracts articles and publication time', () => {
  const items = parseLiveMintRss(SAMPLE_RSS);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title:'BLS International warns investors after fraud investigation',
    summary:'Authorities are investigating alleged irregularities involving BLS International Services.',
    source:'LiveMint',
    url:'https://www.livemint.com/companies/news/bls-international-fraud-11700000000000.html',
    publishedAt:'2026-08-26T05:15:00.000Z',
  });
});

test('LiveMint stock matching uses company names and avoids unrelated symbols', () => {
  const [blsArticle] = parseLiveMintRss(SAMPLE_RSS);
  assert.equal(liveMintItemMatchesStock(blsArticle, { symbol:'BLS', name:'BLS International Services Ltd' }), true);
  assert.equal(liveMintItemMatchesStock(blsArticle, { symbol:'VISASTEEL', name:'Visa Steel Ltd' }), false);
});

test('LiveMint provider downloads shared feeds once and returns symbol-specific articles', async () => {
  let calls = 0;
  const provider = createLiveMintNewsProvider({
    feedUrls:['https://www.livemint.com/rss/companies'],
    cacheTtlMs:60000,
    fetchImpl:async url => {
      calls++;
      assert.equal(url, 'https://www.livemint.com/rss/companies');
      return { ok:true, text:async () => SAMPLE_RSS };
    },
  });
  const first = await provider.fetchStockAnnouncements({ symbol:'BLS', name:'BLS International Services Ltd' });
  const second = await provider.fetchStockAnnouncements({ symbol:'VISASTEEL', name:'Visa Steel Ltd' });
  assert.equal(first.length, 1);
  assert.equal(first[0].source, 'LiveMint');
  assert.equal(second.length, 1);
  assert.equal(calls, 1);
});

test('fresh news includes independent LiveMint fraud reports without an NSE item', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-news-livemint-'));
  try {
    const service = createFreshNewsService({
      cacheDir:tempDir,
      indexFile:path.join(tempDir, 'index.json'),
      cacheFile:path.join(tempDir, 'legacy.json'),
      dashboardAppPath:path.join(tempDir, 'missing-dashboard.js'),
      classifyNewsItem:text => /fraud|investigat/i.test(text) ? 'Investigation' : 'News',
      classifyNewsTradeImpact:() => ({
        newsSentiment:'Negative', tradeImpactScore:-90, tradeImpactAbs:90,
        tradeImpactReason:'Fraud investigation',
      }),
      fetchNSEAllAnnouncements:async () => [],
      fetchNSEAllResults:async () => [],
      fetchNSEAllCorporateActions:async () => [],
      fetchNSEAllBoardMeetings:async () => [],
      fetchNSEStockAnnouncements:async () => [],
      fetchScreenerStockAnnouncements:async () => [],
      fetchLiveMintStockAnnouncements:async stock => stock.symbol === 'BLS'
        ? [{ ...parseLiveMintRss(SAMPLE_RSS)[0], symbol:'BLS', name:stock.name }]
        : [],
    });
    const result = await service.fetchFreshStockNews([{ symbol:'BLS', name:'BLS International Services Ltd' }], {
      date:'2026-08-26', force:true, limit:10,
    });
    assert.equal(result.count, 1);
    assert.equal(result.items[0].source, 'LiveMint');
    assert.equal(result.items[0].type, 'Investigation');
    assert.equal(result.items[0].newsSentiment, 'Negative');
    assert.match(result.source, /livemint-rss/);
  } finally {
    fs.rmSync(tempDir, { recursive:true, force:true });
  }
});
