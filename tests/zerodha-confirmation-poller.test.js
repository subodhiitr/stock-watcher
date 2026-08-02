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

test('confirmed full exit closes trade using broker average fill', async () => {
  const trade = { id:'t1', symbol:'TEST', status:'open', side:'buy', qty:10, entryPrice:100, pendingExit:{ reason:'Simulation exit', requestedPrice:101 }, broker:{ name:'zerodha', mode:'live', status:'exit_placed', exitOrderId:'x1', exitPlacedAt:new Date().toISOString(), audit:[] } };
  const trades = [trade];
  const poller = new ConfirmationPoller(
    { getOrderStatus: async () => ({ status:'COMPLETE', averagePrice:101.25, filledQuantity:10 }) },
    { loadTrades:() => trades, saveTrades:() => {}, broadcast:() => {}, computePnl:(t, price) => ({ pnl:(price-t.entryPrice)*t.qty, pnlPct:1.25, grossPnl:12.5, charges:0 }) },
    () => 'paper'
  );
  await poller.pollExitPlacedTrades();
  assert.equal(trade.status, 'closed');
  assert.equal(trade.exitPrice, 101.25);
  assert.equal(trade.closeReason, 'Simulation exit');
});

test('confirmed partial exit reduces parent only by broker-filled quantity', async () => {
  const trade = { id:'t2', symbol:'TEST', status:'open', side:'buy', qty:10, entryPrice:100, reservedCapital:1000, pendingPartialExit:{ qty:5, reason:'Simulation partial target', requestedPrice:102, runner:true, newTarget:104, protectRemainder:true }, broker:{ name:'zerodha', mode:'live', status:'exit_placed', exitOrderId:'x2', exitPlacedAt:new Date().toISOString(), audit:[] } };
  const trades = [trade];
  const poller = new ConfirmationPoller(
    { getOrderStatus: async () => ({ status:'COMPLETE', averagePrice:102.1, filledQuantity:3 }) },
    { loadTrades:() => trades, saveTrades:() => {}, broadcast:() => {}, computePnl:(t, price) => ({ pnl:(price-t.entryPrice)*t.qty, pnlPct:2.1, grossPnl:6.3, charges:0 }) },
    () => 'paper'
  );
  await poller.pollExitPlacedTrades();
  assert.equal(trade.status, 'open');
  assert.equal(trade.qty, 7);
  assert.equal(trade.target, 104);
  assert.equal(trade._longProfitLockArmed, true);
  assert.equal(trades[0].parentId, 't2');
  assert.equal(trades[0].qty, 3);
});
