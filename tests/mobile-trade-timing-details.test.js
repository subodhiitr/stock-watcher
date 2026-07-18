const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('mobile positions show entry time plus closed exit time and reason', () => {
  assert.match(source, /function tradeEntryTimestamp/);
  assert.match(source, /function tradeExitTimestamp/);
  assert.match(source, /<em>\$\{entryTime\}<\/em>/);
  assert.match(source, /status === 'closed' \? exitTime/);
  assert.match(source, /Closed\$\{exitReason/);
  assert.match(source, /pnlPct >= 0 \? 'Gain' : 'Loss'/);
  assert.match(source, /cls\(pnlPct\)/);
});

test('mobile portfolio and P&L show entry and exit prices and times', () => {
  assert.match(source, /Entry time \$\{entryTime\}/);
  assert.match(source, /Exit time \$\{status === 'closed' \? exitTime/);
  assert.match(source, /entryPrice: row\.qty \? row\.entryValue \/ row\.qty/);
  assert.match(source, /Exit \$\{row\.exitPrice \? fmt\(row\.exitPrice\) : '--'\}/);
  assert.match(source, /row\.exitReason \? `<span>\$\{escapeHTML\(row\.exitReason\)\}<\/span>`/);
});
