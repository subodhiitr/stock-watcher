'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobile = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('mobile setup presets retain browser-equivalent setup constraints', () => {
  assert.match(mobile, /runners:\s*c\s*=>\s*statusOf\(c\) === 'triggered'\s*&&\s*runnerTypes\.has\(setupOf\(c\)\)/);
  assert.match(mobile, /vwap_rejection:\s*c\s*=>\s*setupOf\(c\) === 'VWAP_REJECTION'/);
  assert.match(mobile, /best_pullbacks:\s*c\s*=>\s*isTradeable\(c\)\s*&&\s*setupOf\(c\) === 'VWAP_PULLBACK_OR_HOLD'/);
  assert.doesNotMatch(mobile, /^\s*shorts:\s*c\s*=>/m);
  assert.doesNotMatch(mobile, /^\s*near_trigger:\s*c\s*=>/m);
  assert.match(mobile, /const setupOf = c => resolvedSetupType\(c\)\.toUpperCase\(\)/);
});
