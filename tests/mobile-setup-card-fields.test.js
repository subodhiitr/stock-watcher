'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '..', 'mobile.css'), 'utf8');

test('mobile setup details avoid repeating summary values and show setup category', () => {
  assert.match(app, /function setupCategoryLabel\(candidate = \{\}\)/);
  assert.match(app, /<span>Category <b>\$\{escapeHTML\(setupCategory\)\}<\/b><\/span>/);
  assert.doesNotMatch(app, /<span>Score <b>\$\{Math\.abs\(n\(c\.score\)\)\}<\/b><\/span>/);
  assert.doesNotMatch(app, /<span>Target <b>\$\{target \? fmt\(target\) : '--'\}<\/b><\/span>/);
  assert.doesNotMatch(app, /<span>Price <b>\$\{fmt\(price\)\}<\/b><\/span>/);
  assert.doesNotMatch(app, />Chg <b>\$\{pct\(change\)\}<\/b><\/span>/);
  assert.match(app, /<small>Volume<\/small><b>\$\{compactVolume\(volume\)\}<\/b>/);
  assert.doesNotMatch(app, /<span>Volume <b>\$\{volume \? volume\.toLocaleString/);
  assert.match(css, /grid-template-columns: minmax\(0, 2fr\) repeat\(3, minmax\(0, 1fr\)\)/);
});

test('setup category groups article strategies and existing bearish setups', () => {
  assert.match(app, /return 'Momentum'/);
  assert.match(app, /return 'Gap and Go'/);
  assert.match(app, /return 'Bull Flag'/);
  assert.match(app, /return 'Rangebound Scalping'/);
  assert.match(app, /return 'Breakdown Short'/);
});

test('setup reason line retains its reason and adds setup-specific context', () => {
  assert.match(app, /function setupSpecificIndicator\(candidate = \{\}\)/);
  assert.match(app, /return `Range \$\{fmt\(range\.lower\)\}-\$\{fmt\(range\.upper\)\}/);
  assert.match(app, /return `Opening gap \$\{pct\(indicators\.gapPct/);
  assert.match(app, /return `Break level \$\{label\} \$\{fmt\(value\)\}`/);
  assert.match(app, /class="setup-specific-indicator"/);
  assert.match(app, /escapeHTML\(reason \|\| ''\)/);
});

test('setup stock symbol opens the same details overlay as All Stocks', () => {
  assert.match(app, /class="stock-detail-link setup-symbol-link" data-detail-symbol="\$\{sym\}"/);
  assert.match(app, /const detailButton = event\.target\.closest\('\[data-detail-symbol\]'\)/);
  assert.match(app, /await openStockDetailOverlay\(detailButton\.dataset\.detailSymbol\)/);
  assert.match(css, /\.setup-head \.setup-symbol-link \{ min-width: 0; \}/);
});
