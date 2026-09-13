'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

test('Sharekhan depth ticks publish changed books into the live SSE cache', () => {
  assert.match(proxy, /intradayLiveCache\.set\(symbol, \{ \.\.\.cachedSignal, marketDepth \}\)/);
  assert.match(proxy, /broadcastIntradayLive\('sharekhan-ws-depth', \[symbol\]\)/);
  assert.match(proxy, /triggerSimulationTickAfterScoreUpdate\('sharekhan-ws-depth', \[symbol\]\)/);
});

test('mobile live updates merge depth into server-ranked setup cards', () => {
  assert.match(mobile, /function mergeLiveCandidateRecord\(current = \{\}, value = \{\}, symbol = ''\)/);
  assert.match(mobile, /candidates:mergeServerRows\(state\.serverSimulationCandidates\.candidates\)/);
  assert.match(mobile, /combinedCandidates:mergeServerRows\(state\.serverSimulationCandidates\.combinedCandidates\)/);
  assert.match(mobile, /indicators: \{ \.\.\.\(current\.indicators \|\| \{\}\), \.\.\.value, price \}/);
});
