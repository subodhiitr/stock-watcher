'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const proxy = fs.readFileSync(path.join(__dirname, '..', 'ticker_proxy.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('intraday source settings default to both and prevent an all-disabled runtime', () => {
  assert.match(proxy, /INTRADAY_SOURCE_YAHOO !== false/);
  assert.match(proxy, /INTRADAY_SOURCE_SHAREKHAN !== false/);
  assert.match(proxy, /yahoo \|\| sharekhan \? \{ yahoo, sharekhan \} : \{ yahoo: true, sharekhan: false \}/);
});

test('Yahoo polling and Sharekhan websocket ingestion honor source settings', () => {
  assert.match(proxy, /sources,/);
  assert.match(proxy, /if \(!getIntradayDataSourceSettings\(\)\.sharekhan\) return/);
});

test('settings UI supports either or both intraday sources', () => {
  assert.match(dashboard, /function setIntradayDataSource\(source, enabled\)/);
  assert.match(dashboard, /Sharekhan live → Yahoo/);
  assert.match(dashboard, /Select at least one intraday data source/);
});

test('price chart uses Sharekhan historical candles while live signal polling stays websocket-first', () => {
  assert.match(proxy, /fetchSharekhanCandles:async symbol/);
  assert.match(proxy, /return fetchSharekhanIntraday\(symbol, sharekhanClientLive\)/);
  assert.match(proxy, /Sharekhan WebSocket cache is primary for live signals when enabled/);
  assert.match(dashboard, /t\.dataSource === 'sharekhan-ws'/);
});

test('server preserves checkbox values as booleans instead of converting them to zero or one', () => {
  assert.match(proxy, /if \(typeof value === 'boolean'\) clean\[key\] = value;/);
  assert.match(proxy, /SIMULATION_COST_PROFILE/);
});
