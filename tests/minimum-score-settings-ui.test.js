'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TradeRules = require('../trade_rules');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('long and short minimum score defaults are both 60', () => {
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_MIN_SCORE, 60);
  assert.equal(TradeRules.DEFAULT_SETTINGS.SIMULATION_SHORT_MIN_SCORE, 60);
});

test('settings modal exposes independent long and short score controls', () => {
  assert.match(dashboard, /Long minimum score/);
  assert.match(dashboard, /Short minimum score/);
  assert.match(dashboard, /Fresh-breakout minimum score/);
  assert.match(dashboard, /setMinimumScoreOverride\('fresh'/);
  assert.match(dashboard, /setMinimumScoreOverride\('long', this\.value\)/);
  assert.match(dashboard, /setMinimumScoreOverride\('short', this\.value\)/);
  assert.match(dashboard, /clearMinimumScoreOverride\('long'\)/);
  assert.match(dashboard, /clearMinimumScoreOverride\('short'\)/);
});
