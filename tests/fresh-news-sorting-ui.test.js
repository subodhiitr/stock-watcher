const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('fresh news modal supports score and time sorting in both directions', () => {
  assert.match(source, /let freshNewsSortKey = 'time'/);
  assert.match(source, /freshNewsSortKey === 'score'/);
  assert.match(source, /Date\.parse\(a\.publishedAt/);
  assert.match(source, /function setFreshNewsSort\(key, direction = 'desc'\)/);
  assert.match(source, /option value="time"/);
  assert.match(source, /option value="score"/);
  assert.match(source, /Descending/);
  assert.match(source, /Ascending/);
});
