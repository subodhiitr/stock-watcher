const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');
const DASHBOARD_HTML_PATH = path.join(__dirname, '..', 'nse_midcap_dashboard.html');

test('ETF tab renders its own setup cards without enabling browser snapshots', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');

  assert.match(source, /function renderETFSetupCards\(/);
  assert.match(html, /id="etf-setup-card-row"/);
  assert.match(source, /selectETFSetupCard\('entries','etf_tradeable'\)/);
  assert.match(source, /selectETFSetupCard\('momentum','etf_triggered'\)/);
  assert.match(source, /selectETFSetupCard\('neartrigger','etf_neartrigger'\)/);
  assert.match(source, /selectETFSetupCard\('risk','etf_risk'\)/);
  assert.match(source, /renderETFSetupCards\(rows\)/);
  assert.doesNotMatch(source, /saveSimulationSnapshot\('intraday-refresh'\)/);
});

test('setup cards include short-term picks for stocks and ETFs', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');

  assert.match(source, /function isShortTermPick\(/);
  assert.match(source, /function hasConsistentShortTermTrend\(/);
  assert.match(source, /shortterm: countRowsForStockFilters\(rows, 'setup_shortterm'\)/);
  assert.match(source, /'Short-term Picks'/);
  assert.match(source, /setup_shortterm/);
  assert.match(source, /shortterm: countRowsForETFFilters\(rows, 'shortterm'\)/);
  assert.match(source, /selectETFSetupCard\('shortterm','etf_shortterm'\)/);
  const start = source.indexOf('function isShortTermPick(');
  const end = source.indexOf('function getHealthScore(', start);
  const fnSource = source.slice(start, end);
  assert.doesNotMatch(fnSource, /if \(!t \|\| getIntradayFreshness\(t\)\.stale\) return false/);
  assert.match(fnSource, /oneMonthReturn/);
  assert.match(fnSource, /oneYearReturn/);
  assert.match(fnSource, /threeYearReturn/);
  assert.match(fnSource, /oneMonth > 2 && oneYear > 15 && threeYear > 0/);
});

test('ETF short-term setup card can be cleared and ETF status shows filtered total', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const selectStart = source.indexOf('function selectETFSetupCard(');
  const selectEnd = source.indexOf('function renderETFSetupCards(', selectStart);
  const selectSource = source.slice(selectStart, selectEnd);
  const renderStart = source.indexOf('function renderETFSection(');
  const renderEnd = source.indexOf('function renderETFNavCell(', renderStart);
  const renderSource = source.slice(renderStart, renderEnd);

  assert.match(selectSource, /'shortterm'/);
  assert.match(selectSource, /etfPageReset\(\)/);
  assert.match(renderSource, /const totalETFCount = rows\.length/);
  assert.match(renderSource, /status\.textContent=`\$\{rows\.length\}\/\$\{totalETFCount\}/);
});

test('fresh news opens from action bar icon and is removed from setup cards', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');
  const setupStart = source.indexOf('function renderSetupCards(');
  const setupEnd = source.indexOf('function renderTable(', setupStart);
  const setupSource = source.slice(setupStart, setupEnd);
  const modalStart = source.indexOf('function renderFreshNewsModal()');
  const modalEnd = source.indexOf('function openFreshNewsModal()', modalStart);
  const modalSource = source.slice(modalStart, modalEnd);

  assert.match(html, /id="fresh-news-btn"/);
  assert.match(html, /onclick="openFreshNewsModal\(\)"/);
  assert.match(html, />📰<\/button>/);
  assert.doesNotMatch(setupSource, /Fresh News/);
  assert.doesNotMatch(setupSource, /openFreshNewsModal/);
  assert.match(source, /function formatFreshNewsPublishedTime\(/);
  assert.match(modalSource, /<th>Time<\/th>/);
  assert.match(modalSource, /formatFreshNewsPublishedTime\(item\.publishedAt\)/);
  assert.match(modalSource, /colspan="7"/);
});

test('result calendar opens beside fresh news and renders row badges', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf8');

  assert.match(html, /id="result-calendar-btn"/);
  assert.match(html, /onclick="openResultCalendarModal\(\)"/);
  assert.match(html, />📅<\/button>/);
  assert.doesNotMatch(html, />Cal<\/button>/);
  assert.match(html, /id="result-calendar-modal"/);
  assert.match(source, /resultCalendarBySymbol/);
  assert.match(source, /const RESULT_CALENDAR_ENDPOINT/);
  assert.match(source, /function loadResultCalendarSummary\(/);
  assert.match(source, /function renderResultCalendarBadge\(/);
  assert.match(source, /function renderHealthEventBadges\(/);
  assert.match(source, /renderHealthEventBadges\(row\.sym\)/);
  assert.match(source, /function renderResultCalendarModal\(/);
  assert.match(source, /function setResultCalendarDate\(/);
  assert.match(source, /function setResultCalendarSearch\(/);
  assert.match(source, /function setResultCalendarSort\(/);
  assert.match(source, /result-calendar-date-strip/);
  assert.match(source, /Search calendar by symbol or company/);
  assert.match(source, /Company Name/);
  assert.match(source, /Result Type/);
  assert.match(source, /Market cap/);
  assert.match(source, /loadResultCalendarSummary\(false\)/);
  assert.match(source, /force:\s*!!force/);
  assert.match(source, /AbortSignal\.timeout\(force \? 240000 : 60000\)/);
  assert.match(source, /calendarBtn\.textContent = '📅'/);
  assert.doesNotMatch(source, /calendarBtn\.textContent = 'Cal'/);
  assert.match(html, /loadResultCalendarSummary\(true\)\.then\(renderResultCalendarModal\)/);
});
