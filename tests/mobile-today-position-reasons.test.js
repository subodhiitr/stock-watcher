'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');

test("today's positions show entry reasons for open and closed trades", () => {
  assert.match(app, /const entryReason = tradeEntryReason\(trade\);/);
  assert.match(app, /<div class="trade-reasons"><span><b>Entry reason:<\/b> \$\{escapeHTML\(entryReason\)\}<\/span>/);
  assert.match(app, /status === 'closed' \? `<span><b>Exit reason:<\/b> \$\{escapeHTML\(exitReason \|\| '--'\)\}<\/span>` : ''/);
  assert.match(css, /\.trade-reasons \{[^}]*grid-column: 1 \/ -1/);
});
