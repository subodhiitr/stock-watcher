const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nse_midcap_dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');

function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  const brace = app.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test('portfolio opens as an accessible right-side panel', () => {
  assert.match(html, /id="portfolio-modal"[^>]*portfolio-panel-overlay/);
  assert.match(html, /portfolio-side-panel" role="dialog" aria-modal="true"/);
  assert.match(html, /aria-labelledby="portfolio-modal-title"/);
  assert.match(html, /aria-label="Close portfolio"/);
  assert.match(css, /#portfolio-modal\.portfolio-panel-overlay\{[^}]*justify-content:flex-end/);
  assert.match(css, /#portfolio-modal \.modal-card\.portfolio-side-panel\{[^}]*width:min\(1540px,100vw\)[^}]*height:100dvh/);
});

test('portfolio panel preserves access to every transaction table column', () => {
  assert.match(css, /#portfolio-modal \.portfolio-side-panel>#portfolio-modal-body\{[^}]*min-width:0[^}]*overflow:auto/);
  assert.match(css, /#portfolio-modal \.portfolio-table-wrap\{[^}]*width:100%[^}]*overflow:auto/);
  assert.match(css, /\.portfolio-table\{min-width:1320px/);
  assert.match(css, /#portfolio-modal \.portfolio-table th\{position:sticky/);
  assert.match(css, /@media\(max-width:820px\)[\s\S]*?#portfolio-modal \.modal-card\.portfolio-side-panel\{width:100vw/);
});

test('five-day panel skips weekends and starts from the current IST session', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${functionSource('getTradeDateISO')}\n${functionSource('getRecentPortfolioTradingDays')}`,
    context
  );
  const days = context.getRecentPortfolioTradingDays(5, Date.parse('2026-07-28T04:30:00.000Z'));
  assert.deepEqual(Array.from(days), [
    '2026-07-28',
    '2026-07-27',
    '2026-07-24',
    '2026-07-23',
    '2026-07-22',
  ]);
});
