const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('mobile portfolio transactions show their saved entry reason', () => {
  assert.match(app, /function tradeEntryReason\(trade = \{\}\)/);
  assert.match(app, /trade\.setupType \|\| context\.setupType \|\| context\.candidateSetupType/);
  assert.match(app, /indicators\.entryTrigger \|\| context\.entryTrigger/);
  assert.match(app, /<span><b>Entry why:<\/b> \$\{escapeHTML\(entryReason\)\}<\/span>/);
});
