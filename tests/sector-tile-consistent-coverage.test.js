const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('sector tile percentage and coverage use the same local constituent set', () => {
  const start = source.indexOf('function updateSectorTilesPartial(');
  const end = source.indexOf('\nfunction renderTableNow', start);
  const body = source.slice(start, end);
  assert.match(body, /const members = MIDCAP_STOCKS\.filter/);
  assert.match(body, /getDisplayChangePct\(getBrowserStockData\(stock\.sym\)\)/);
  assert.match(body, /const count = localChanges\.length/);
  assert.match(body, /const total = members\.length/);
  assert.match(body, /localChanges\.reduce/);
});

test('initial sector render does not overwrite local averages with incomplete server averages', () => {
  const start = source.indexOf('function renderSectors()');
  const end = source.indexOf('\nfunction renderIndexBar', start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /Object\.assign\(sectorTrendCache, serverSectorTrend\)/);
});
