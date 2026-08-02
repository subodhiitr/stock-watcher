const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
const mobile = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

const setups = [
  ['opening_flush', 'OPENING_FLUSH_VWAP_RECLAIM'],
  ['top_gainer_pullback', 'TOP_GAINER_PULLBACK_RECLAIM'],
  ['top_gainer_continuation', 'TOP_GAINER_CONTINUATION'],
  ['gap_and_go', 'GAP_AND_GO'],
  ['bull_flag', 'BULL_FLAG_CONTINUATION'],
  ['vwap_continuation', 'VWAP_TREND_CONTINUATION'],
  ['breakdown', 'BREAKDOWN'],
  ['vwap_rejection', 'VWAP_REJECTION'],
  ['vwap_pullback', 'VWAP_PULLBACK_OR_HOLD'],
];

test('desktop and mobile expose dedicated filters for requested setup types', () => {
  for (const [filter, setupType] of setups) {
    assert.match(dashboard, new RegExp(`setup_${filter}: r => setupType\\(r\\) === '${setupType}'`));
    assert.match(mobile, new RegExp(`${filter}: c => setupOf\\(c\\) === '${setupType}'`));
    assert.match(controller, new RegExp(`<option value="${filter}">`));
  }
});

test('bear-flag filter includes regular and top-loser bear flags', () => {
  assert.match(dashboard, /setup_bear_flag: r => \['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'\]\.includes\(setupType\(r\)\)/);
  assert.match(mobile, /bear_flags: c => \['BEAR_FLAG_CONTINUATION', 'TOP_LOSER_BEAR_FLAG'\]\.includes\(setupOf\(c\)\)/);
  assert.match(controller, /<option value="bear_flags">Bear-Flag Shorts<\/option>/);
});

test('desktop renders a dedicated card for every requested setup group', () => {
  for (const card of [
    'opening_flush',
    'top_gainer_pullback',
    'top_gainer_continuation',
    'gap_and_go',
    'bull_flag',
    'vwap_continuation',
    'breakdown',
    'bear_flags',
    'vwap_rejection',
    'vwap_pullback',
  ]) {
    assert.match(dashboard, new RegExp(`\\['${card}',`));
  }
});

test('generic Short Setups and Near Trigger cards are removed', () => {
  assert.doesNotMatch(dashboard, /\['shorts',\s*'Short Setups'/);
  assert.doesNotMatch(dashboard, /\['neartrigger',\s*'Near Trigger'/);
  assert.doesNotMatch(controller, /<option value="shorts">/);
  assert.doesNotMatch(controller, /<option value="near_trigger">/);
});
