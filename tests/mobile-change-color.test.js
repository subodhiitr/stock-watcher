const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'mobile.css'), 'utf8');

test('All Stocks change values use positive and negative colors', () => {
  assert.match(app, /<span class="\$\{cls\(row\.change\)\}"><small>Change<\/small><b class="\$\{cls\(row\.change\)\}">\$\{pct\(row\.change\)\}<\/b><\/span>/);
  assert.match(css, /\.all-stock-row \.positive b\s*\{\s*color:\s*var\(--green\);\s*\}/);
  assert.match(css, /\.all-stock-row \.negative b\s*\{\s*color:\s*var\(--red\);\s*\}/);
});

test('mobile shell advances asset and service-worker cache versions', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(__dirname, '..', 'mobile-sw.js'), 'utf8');

  assert.match(controller, /mobile\.css\?v=20260715-12/);
  assert.match(controller, /mobile-app\.js\?v=20260715-42/);
  assert.match(serviceWorker, /intradayx-mobile-v49/);
  assert.match(serviceWorker, /mobile\.css\?v=20260715-12/);
  assert.match(serviceWorker, /mobile-app\.js\?v=20260715-42/);
});
