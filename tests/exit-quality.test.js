import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import exitQuality from '../server/exit-quality.js';

const NOW = Date.parse('2026-07-30T11:00:00.000Z');

function trade(overrides = {}) {
  return {
    id:'exit-1',
    source:'simulation',
    status:'closed',
    setupType:'FRESH_BREAKOUT',
    symbol:'LONG',
    side:'buy',
    qty:10,
    entryPrice:100,
    exitPrice:105,
    openedAt:'2026-07-30T04:30:00.000Z',
    closedAt:'2026-07-30T08:00:00.000Z',
    closeReason:'Simulation target',
    grossPnl:55,
    charges:5,
    pnl:50,
    ...overrides,
  };
}

test('exit reconciliation captures day close and keeps opportunity separate from net profit', async () => {
  const sqlite = db.initDb(':memory:');
  db.saveTrade(trade());
  db.saveTrade(trade({
    id:'exit-2',
    symbol:'SHORT',
    side:'sell',
    entryPrice:100,
    exitPrice:90,
    closeReason:'Simulation trailing stop',
    grossPnl:105,
    charges:5,
    pnl:100,
  }));
  const closes = new Map([['LONG:2026-07-30', 110], ['SHORT:2026-07-30', 85]]);
  const service = exitQuality.createExitQualityService({
    db,
    now:() => NOW,
    resolveDayClose:async (symbol, day) => ({ price:closes.get(`${symbol}:${day}`), source:'test-close' }),
    logger:{ warn() {} },
  });

  const result = await service.reconcile('test');
  assert.equal(result.ok, true);
  assert.equal(result.closePricesResolved, 2);
  const facts = db.listExitQualityFacts();
  assert.equal(facts.length, 2);
  assert.equal(facts.find(fact => fact.exitId === 'exit-1').exitCategory, 'Target');
  assert.equal(facts.find(fact => fact.exitId === 'exit-1').opportunityPnl, 50);
  assert.equal(facts.find(fact => fact.exitId === 'exit-2').exitCategory, 'Trailing');
  assert.equal(facts.find(fact => fact.exitId === 'exit-2').opportunityPnl, 50);
  assert.equal(db.getTrade('exit-1').exitState.dayClosePrice, 110);
  assert.equal(db.getTrade('exit-1').exitState.benchmarkStatus, 'resolved');
  const storedTxn = sqlite.prepare('SELECT day_close_price, day_close_source, exit_category FROM trade_txns WHERE id = ?').get('exit-1');
  assert.equal(storedTxn.day_close_price, 110);
  assert.equal(storedTxn.day_close_source, 'test-close');
  assert.equal(storedTxn.exit_category, 'Target');

  const payload = service.getPayload('all', '2026-07-30');
  assert.equal(payload.date, '2026-07-30');
  assert.equal(payload.summary.exits, 2);
  assert.equal(payload.summary.opportunityLoss, 100);
  assert.equal(payload.overall.netPnl, 150);
  service.stop();
});

test('exit categories cover common simulation and manual reasons', () => {
  assert.equal(exitQuality.categorizeExit('Simulation target'), 'Target');
  assert.equal(exitQuality.categorizeExit('Simulation stop loss'), 'Stop');
  assert.equal(exitQuality.categorizeExit('Simulation EOD square-off'), 'EOD');
  assert.equal(exitQuality.categorizeExit('Manual exit', 'manual'), 'Manual');
  assert.equal(exitQuality.categorizeExit('Simulation signal deterioration'), 'Momentum / Signal');
});
