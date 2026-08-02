const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

test('mobile top bar replaces refresh with an earnings results action', () => {
  assert.doesNotMatch(controller, /id="refresh-btn"/);
  assert.match(controller, /id="earnings-results-btn"/);
  assert.match(controller, /aria-label="Open earnings results"/);
  assert.match(controller, /&#128202;/);
});

test('earnings results action opens a 30-day result calendar sheet', () => {
  assert.match(controller, /id="earnings-results-overlay"/);
  assert.match(controller, /id="earnings-results-date-strip"/);
  assert.match(controller, /id="earnings-results-list"/);
  assert.match(app, /api\('\/result-calendar\?days=30'\)/);
  assert.match(app, /function earningsResultDateRange\(results\)/);
  assert.match(app, /data-earnings-date=/);
  assert.match(app, /selectEarningsResultDate\(button\.dataset\.earningsDate\)/);
  assert.match(app, /earningsResultDateKey\(item\) === results\.selectedDate/);
  assert.match(app, /\$\('earnings-results-btn'\)\.addEventListener\('click', openEarningsResultsOverlay\)/);
});
