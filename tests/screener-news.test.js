const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFreshNewsService } = require('../server/fresh-news');
const { parseScreenerAnnouncements, createScreenerNewsProvider } = require('../server/screener-news');
const mobileApp = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const dashboardApp = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

const SAMPLE_HTML = `
  <section id="documents">
    <div id="company-announcements-tab">
      <ul class="list-links">
        <li class="overflow-wrap-anywhere">
          <a href="https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc.pdf">
            Order Win &amp; New Contract
            <div class="ink-600 smaller"><time datetime="2026-08-23T10:30:00+05:30">23 Aug</time> - Company won a large railway contract.</div>
          </a>
        </li>
        <li class="overflow-wrap-anywhere">
          <a href="/company/id/123/">
            Board Meeting Intimation
            <div class="ink-600 smaller"><time datetime="2026-08-22T17:10:00+05:30">22 Aug</time></div>
          </a>
        </li>
      </ul>
    </div>
  </section>`;

test('Screener parser extracts public company announcements and BSE links', () => {
  const items = parseScreenerAnnouncements(SAMPLE_HTML, { symbol:'ABC', name:'ABC Ltd' });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    symbol:'ABC',
    name:'ABC Ltd',
    assetType:'stock',
    title:'Order Win & New Contract',
    summary:'Company won a large railway contract.',
    source:'Screener',
    url:'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc.pdf',
    publishedAt:'2026-08-23T10:30:00+05:30',
  });
  assert.equal(items[1].url, 'https://www.screener.in/company/id/123/');
});

test('Screener provider rate cache prevents repeat page downloads', async () => {
  let calls = 0;
  const provider = createScreenerNewsProvider({
    minRequestGapMs:0,
    cacheTtlMs:60000,
    fetchImpl:async url => {
      calls++;
      assert.equal(url, 'https://www.screener.in/company/ABC/');
      return { ok:true, text:async () => SAMPLE_HTML };
    },
  });
  const first = await provider.fetchStockAnnouncements({ symbol:'ABC', name:'ABC Ltd' });
  const second = await provider.fetchStockAnnouncements({ symbol:'ABC', name:'ABC Ltd' });
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(calls, 1);
});

test('fresh news merges Screener duplicates into the existing NSE feed', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-news-screener-'));
  try {
    const classifyNewsItem = text => /order|contract/i.test(text) ? 'Deal' : 'Announcement';
    const classifyNewsTradeImpact = item => ({
      newsSentiment:/order|contract/i.test(`${item.title} ${item.subject || ''}`) ? 'Positive' : 'Neutral',
      tradeImpactScore:80,
      tradeImpactAbs:80,
      tradeImpactReason:'Business announcement',
    });
    const common = {
      symbol:'ABC',
      name:'ABC Ltd',
      title:'Order Win & New Contract',
      publishedAt:'2026-08-23T10:30:00+05:30',
      url:'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc.pdf',
    };
    const service = createFreshNewsService({
      cacheDir:tempDir,
      indexFile:path.join(tempDir, 'index.json'),
      cacheFile:path.join(tempDir, 'legacy.json'),
      dashboardAppPath:path.join(tempDir, 'missing-dashboard.js'),
      classifyNewsItem,
      classifyNewsTradeImpact,
      fetchNSEAllAnnouncements:async () => [{ ...common, source:'NSE', type:'Deal' }],
      fetchScreenerStockAnnouncements:async () => [{ ...common, source:'Screener', summary:'Company won a large railway contract.' }],
    });
    const result = await service.fetchFreshStockNews([{ symbol:'ABC', name:'ABC Ltd' }], {
      date:'2026-08-23',
      force:true,
      limit:10,
    });
    assert.equal(result.count, 1);
    assert.equal(result.items[0].source, 'NSE+Screener');
    assert.equal(result.items[0].summary, 'Company won a large railway contract.');
    assert.match(result.source, /screener-company-pages/);
  } finally {
    fs.rmSync(tempDir, { recursive:true, force:true });
  }
});

test('Screener summaries render in the existing mobile and desktop news feeds', () => {
  assert.match(mobileApp, /class="news-row-summary">\$\{summary\}/);
  assert.match(dashboardApp, /class="fresh-news-summary">\$\{escapeHTML\(item\.summary\)\}/);
});

test('legacy news cache returns immediately while Screener enrichment rebuilds in background', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-news-stale-'));
  const dayFile = path.join(tempDir, 'fresh_stock_news_2026-08-23.json');
  const common = {
    symbol:'ABC',
    name:'ABC Ltd',
    type:'Deal',
    title:'Order Win & New Contract',
    publishedAt:'2026-08-23T10:30:00+05:30',
    dateKey:'2026-08-23',
    source:'NSE',
    url:'https://www.bseindia.com/stockinfo/AnnPdfOpen.aspx?Pname=abc.pdf',
    newsSentiment:'Positive',
    tradeImpactScore:80,
    tradeImpactAbs:80,
    tradeImpactReason:'Business announcement',
  };
  fs.writeFileSync(dayFile, JSON.stringify({
    version:5,
    date:'2026-08-23',
    source:'nse-market-wide+symbol-announcements',
    savedAt:Date.now(),
    items:[common],
    count:1,
    symbolCount:1,
  }));
  try {
    const service = createFreshNewsService({
      cacheDir:tempDir,
      indexFile:path.join(tempDir, 'index.json'),
      cacheFile:path.join(tempDir, 'legacy.json'),
      dashboardAppPath:path.join(tempDir, 'missing-dashboard.js'),
      classifyNewsItem:() => 'Deal',
      classifyNewsTradeImpact:item => ({
        newsSentiment:'Positive', tradeImpactScore:80, tradeImpactAbs:80,
        tradeImpactReason:item.summary || 'Business announcement',
      }),
      fetchNSEAllAnnouncements:async () => [common],
      fetchScreenerStockAnnouncements:async () => [{
        ...common, source:'Screener', summary:'Company won a large railway contract.',
      }],
    });
    const response = await service.fetchFreshStockNews([{ symbol:'ABC', name:'ABC Ltd' }], {
      date:'2026-08-23', limit:10,
    });
    assert.equal(response.fromCache, true);
    assert.equal(response.count, 1);
    for (let attempt = 0; attempt < 20; attempt++) {
      const rebuilt = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
      if (String(rebuilt.source || '').includes('screener-company-pages')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const rebuilt = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
    assert.match(rebuilt.source, /screener-company-pages/);
    assert.equal(rebuilt.items[0].source, 'NSE+Screener');
  } finally {
    fs.rmSync(tempDir, { recursive:true, force:true });
  }
});
