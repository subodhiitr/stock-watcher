const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('mobile setup refresh does not overwrite streamed sector percentages', () => {
  assert.match(source, /sectorTrendStreamed:\s*false/);
  assert.match(source, /state\.sectorTrendStreamed\s*=\s*true/);
  assert.match(source, /if \(!state\.sectorTrendStreamed\) state\.sectorTrend = analysis\.sectorTrend \|\| \{\}/);
});
