const test = require('node:test');
const assert = require('node:assert/strict');
const proxy = require('../ticker_proxy');

test('stock events pin the result filing and retain distinct result records', () => {
  const events = proxy.__test__.eventHighlightsForTests([
    { type:'Results', title:'Third Quarter result (Consolidated)', filingDate:'2026-01-09T10:00:00.000Z' },
    { type:'Dividend', title:'Interim Dividend', exDate:'2026-07-15T00:00:00.000Z' },
    { type:'Result Filing', title:'Financial results for period ended Jun 30, 2026', publishedAt:'2026-07-09T10:22:21.000Z' },
  ]);

  assert.deepEqual(events.map(item => item.type), ['Result Filing', 'Dividend', 'Results']);
  assert.equal(events.some(item => item.title === 'Third Quarter result (Consolidated)'), true);
});

test('stock events pin result filing then order remaining disclosures newest first', () => {
  const events = proxy.__test__.sortEventsForTests([
    { type:'Results', title:'Older result', filingDate:'2026-01-09T10:00:00.000Z' },
    { type:'Announcement', title:'New contract', publishedAt:'2026-07-13T05:51:36.000Z' },
    { type:'Result Filing', title:'Latest result', publishedAt:'2026-07-09T10:22:21.000Z' },
  ]);

  assert.deepEqual(events.map(item => item.title), ['Latest result', 'New contract', 'Older result']);
});

test('stock event modal shows the complete ordered event list with timestamps', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
  assert.match(dashboard, /events\.slice\(0,\s*10\)/);
  assert.match(dashboard, /Published ' \+ formatStockEventDateTime\(ev\.publishedAt\)/);
});

test('stock event modal refetches instead of trusting an empty background cache', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
  assert.match(dashboard, /const cachedHasContent = \(cached\?\.news\?\.length \|\| 0\) > 0 \|\| \(cached\?\.events\?\.length \|\| 0\) > 0/);
  assert.match(dashboard, /if \(refreshAttempt === 0 && cached && cachedHasContent && \(Date\.now\(\) - cached\.savedAt\) < 10 \* 60 \* 1000\)/);
  assert.match(dashboard, /if \(\(payload\.news \|\| \[\]\)\.length \|\| \(payload\.events \|\| \[\]\)\.length\) \{\s+stockNewsCache\[/);
  assert.match(dashboard, /if \(payload\.refreshing[\s\S]+loadStockNews\(sym, name, assetType, refreshAttempt \+ 1\)/);
});

test('stock events promote a result report near the filing when detailed NSE results are unavailable', () => {
  const filing = {
    type:'Result Filing',
    title:'Financial results for period ended Jun 30, 2026',
    publishedAt:'2026-07-09T10:22:21.000Z',
  };
  const fallback = proxy.__test__.selectResultNewsFallbackForTests([
    { type:'Results', title:'TCS declares dividend for Q1 FY27', publishedAt:'2026-07-09T10:35:58.000Z' },
    { type:'Results', title:'TCS announces interim dividend and financial results for June quarter 2026', publishedAt:'2026-07-09T11:24:39.000Z' },
    { type:'Results', title:'Analysts discuss TCS earnings', publishedAt:'2026-07-13T01:16:24.000Z' },
  ], [
    filing,
    { type:'Results', title:'Older detailed result', filingDate:'2026-04-09T10:00:00.000Z' },
  ]);

  assert.equal(fallback?.title, 'TCS announces interim dividend and financial results for June quarter 2026');
});

test('result-news fallback extracts headline metrics and assigns a directional verdict', () => {
  const filing = {
    type:'Result Filing',
    title:'Financial results for period ended March 31, 2026',
    publishedAt:'2026-05-08T09:18:42.000Z',
  };
  const primary = {
    type:'Results',
    title:'Kalyan Jewellers Q4 Results: PAT soars 118% YoY to Rs 409 crore; revenue jumps 66%',
    publishedAt:'2026-05-08T10:00:00.000Z',
  };
  const enriched = proxy.__test__.enrichResultNewsFallbackForTests(primary, [
    primary,
    {
      type:'Results',
      title:'Kalyan Jewellers revenue Rs 10,275 crore, net profit Rs 409.5 crore',
      publishedAt:'2026-05-08T11:00:00.000Z',
    },
  ], [filing]);

  assert.equal(enriched.revenueCr, 10275);
  assert.equal(enriched.profitAfterTaxCr, 409);
  assert.equal(enriched.revenueGrowthPct, 66);
  assert.equal(enriched.patGrowthPct, 118);
  assert.equal(enriched.resultVerdict, 'Positive');
  assert.match(enriched.resultVerdictReason, /Revenue \+66%/);
  assert.match(enriched.resultVerdictReason, /PAT \+118%/);
});

test('result headline extraction preserves negative growth signs', () => {
  const metrics = proxy.__test__.parseResultHeadlineMetricsForTests(
    'Company revenue drops 12%, net profit falls 25%'
  );
  assert.equal(metrics.revenueGrowthPct, -12);
  assert.equal(metrics.patGrowthPct, -25);
});

test('extracted result metrics are attached to the matching top filing card', () => {
  const filings = [
    {
      type:'Result Filing',
      title:'Results for period ended March 31, 2026',
      publishedAt:'2026-05-08T09:18:42.000Z',
    },
    {
      type:'Result Filing',
      title:'Results for period ended December 31, 2025',
      publishedAt:'2026-02-06T10:29:10.000Z',
    },
  ];
  const attached = proxy.__test__.attachMetricsToMatchingResultFilingForTests(filings, {
    type:'Results',
    title:'Q4 result headline',
    publishedAt:'2026-05-08T10:00:00.000Z',
    profitAfterTaxCr:410,
    revenueGrowthPct:66,
    resultVerdict:'Positive',
    resultVerdictReason:'Revenue +66%',
  });

  assert.equal(attached, filings[0]);
  assert.equal(filings[0].profitAfterTaxCr, 410);
  assert.equal(filings[0].revenueGrowthPct, 66);
  assert.equal(filings[0].resultVerdict, 'Positive');
  assert.equal(filings[0].resultMetrics, true);
  assert.equal(filings[1].resultVerdict, undefined);
});

test('headline parser does not mistake share-price movement for PAT growth', () => {
  const metrics = proxy.__test__.parseResultHeadlineMetricsForTests(
    'Tech Mahindra shares rise 2.3% after quarterly profit climbs'
  );
  assert.equal(metrics.profitAfterTaxCr, null);
  assert.equal(metrics.patGrowthPct, null);
});

test('stock news refresh runs behind the cached response without PDF parsing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
  const start = source.indexOf('async function fetchStockNews(');
  const end = source.indexOf('function scheduleStockNewsRefresh(', start);
  const fetchStockNewsSource = source.slice(start, end);
  const routeStart = source.indexOf("if (pathname === '/stock-news')");
  const routeEnd = source.indexOf("if (pathname === '/result-calendar')", routeStart);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.doesNotMatch(source, /pdf-parse|pdfParse|fetchResultMetricsFromPdf|scheduleResultPdfEnrichment/);
  assert.doesNotMatch(routeSource, /await fetchStockNews/);
  assert.match(routeSource, /cached\?\.data \|\| \{/);
  assert.match(routeSource, /refreshing: shouldRefresh \|\| stockNewsRefreshInFlight\.has\(cacheKey\)/);
  assert.match(routeSource, /res\.end\(JSON\.stringify\([\s\S]+if \(shouldRefresh\) scheduleStockNewsRefresh/);
});
