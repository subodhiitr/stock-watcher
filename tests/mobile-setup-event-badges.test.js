'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

test('setup price card renders positive or negative result and news or dividend badges', () => {
  assert.match(app, /function setupEventBadges\(candidate = \{\}\)/);
  assert.match(app, /\[categorized\.result, categorized\.news\]/);
  assert.match(app, /const label = isResult \? 'Result' : isDividend \? 'Div' : 'News'/);
  assert.match(app, /\$\{label\} \$\{polarity === 'positive' \? '\+' : '-'\}/);
  assert.match(app, /class="setup-event-badges">\$\{eventBadges\}/);
  assert.match(css, /\.setup-event-badge\.positive \{/);
  assert.match(css, /\.setup-event-badge\.negative \{/);
});

test('intraday setup payload carries categorized event impacts', () => {
  assert.match(proxy, /const eventImpacts = freshNewsService\.getCachedImpactsForSymbol\(sym\)/);
  assert.match(proxy, /newsImpact,\s*eventImpacts,/);
});
