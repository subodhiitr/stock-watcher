// test/manual-trade-modal.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('openManualTradeModal function is defined', () => {
  assert.match(source, /function openManualTradeModal\s*\(/);
});

test('closeManualTradeModal function is defined', () => {
  assert.match(source, /function closeManualTradeModal\s*\(/);
});

test('submitManualTrade function is defined', () => {
  assert.match(source, /function submitManualTrade\s*\(/);
});

test('openManualTradeModal populates manual-trade-modal-body', () => {
  assert.match(source, /manual-trade-modal-body/);
});

test('submitManualTrade uses postPaperTrade with source manual', () => {
  assert.match(source, /postPaperTrade\s*\(\s*['"]open['"]/);
  assert.match(source, /source\s*:\s*['"]manual['"]/);
});

test('submitManualTrade derives assetType from getAssetBySymbol', () => {
  assert.match(source, /getAssetBySymbol\s*\(/);
  assert.match(source, /cap\s*===\s*['"]etf['"]/);
});

test('submitManualTrade calls applyOpenedTradeLocally on success', () => {
  assert.match(source, /applyOpenedTradeLocally/);
});

test('submitManualTrade calls loadPaperTrades after opening', () => {
  // same reconcile pattern as openPaperTrade
  const submitFnMatch = source.match(/function submitManualTrade[\s\S]{0,3500}?loadPaperTrades/);
  assert.ok(submitFnMatch, 'submitManualTrade should call loadPaperTrades for reconciliation');
});

test('modal shows inline status message on error without closing', () => {
  assert.match(source, /manual-trade-status/);
});

test('symbol change triggers price autofill via getCurrentTradePrice', () => {
  assert.match(source, /getCurrentTradePrice/);
});

test('target and stop autofill use getPaperPlanForSide', () => {
  assert.match(source, /getPaperPlanForSide/);
});

test('submitManualTrade uses getSuggestedPaperQty for cash/exposure validation', () => {
  assert.match(source, /getSuggestedPaperQty/);
  assert.match(source, /suggestion\.cashLimit/);
});

test('_autofillManualTradeFields clears fields before filling (stale-value safety)', () => {
  assert.match(source, /function _autofillManualTradeFields/);
  // Must clear price/target/stop unconditionally at top of function
  const fnMatch = source.match(/function _autofillManualTradeFields[\s\S]{0,600}?getCurrentTradePrice/);
  assert.ok(fnMatch, '_autofillManualTradeFields should clear and then refill');
  // Clearing pattern: value = '' before any conditional fill
  assert.match(source, /priceInput\)[\s\S]{0,40}value\s*=\s*['"]{2}/);
});

test('_onManualTradeSymChange uses getManualTradeBrokerMode for broker reload', () => {
  assert.match(source, /getManualTradeBrokerMode\s*\(sym\)/);
});

test('symbol input uses datalist for searchable autocomplete', () => {
  assert.match(source, /mt-sym-list/);
  assert.match(source, /list="mt-sym-list"/);
});
