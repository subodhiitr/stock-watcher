'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'nse_midcap_dashboard.html'), 'utf8');

test('home source panel only shows the proxy connect action', () => {
  const panelStart = html.indexOf('<div id="source-panel">');
  const panelEnd = html.indexOf('<!-- INDEX BAR -->', panelStart);
  const panel = html.slice(panelStart, panelEnd);

  assert.ok(panelStart >= 0);
  assert.match(panel, />Check Proxy &amp; Connect<\/button>/);
  assert.doesNotMatch(panel, /id="card-yahoo"/);
  assert.doesNotMatch(panel, /id="card-ai"/);
  assert.doesNotMatch(panel, /Yahoo Finance &amp; NSE/);
  assert.doesNotMatch(panel, /AI \(OpenAI\)/);
});
