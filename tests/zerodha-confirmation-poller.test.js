const test = require('node:test');
const assert = require('node:assert/strict');
const ConfirmationPoller = require('../zerodha-confirmation-poller');

function createPoller() {
  return new ConfirmationPoller(
    {},
    { loadTrades: () => [], saveTrades: () => {}, broadcast: () => {} },
    () => 'paper'
  );
}

test('classifyOrderStatus maps terminal states correctly', () => {
  const poller = createPoller();
  assert.equal(poller.classifyOrderStatus('COMPLETE'), 'confirmed');
  assert.equal(poller.classifyOrderStatus('REJECTED'), 'rejected');
  assert.equal(poller.classifyOrderStatus('CANCELLED'), 'cancelled');
});

test('classifyOrderStatus maps intermediate states to pending', () => {
  const poller = createPoller();
  assert.equal(poller.classifyOrderStatus('OPEN'), 'pending');
  assert.equal(poller.classifyOrderStatus('trigger pending'), 'pending');
  assert.equal(poller.classifyOrderStatus('validation pending'), 'pending');
  assert.equal(poller.classifyOrderStatus('AMO_REQ_RECEIVED'), 'pending');
});

test('classifyOrderStatus returns unknown for unexpected values', () => {
  const poller = createPoller();
  assert.equal(poller.classifyOrderStatus('SOMETHING_NEW'), 'unknown');
  assert.equal(poller.classifyOrderStatus(''), 'unknown');
  assert.equal(poller.classifyOrderStatus(null), 'unknown');
});
