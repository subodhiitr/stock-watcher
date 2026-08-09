import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import efficiency from '../server/setup-efficiency.js';

const NOW = Date.parse('2026-07-30T10:00:00.000Z');

function closedTrade(overrides = {}) {
  return {
    id:'position-1',
    source:'simulation',
    status:'closed',
    setupType:'LONG_MOMENTUM',
    side:'buy',
    symbol:'TEST',
    qty:5,
    entryPrice:100,
    openedAt:'2026-07-30T04:30:00.000Z',
    closedAt:'2026-07-30T05:00:00.000Z',
    grossPnl:55,
    charges:5,
    pnl:50,
    closeReason:'Target reached',
    ...overrides,
  };
}

test('reconciliation aggregates partial exits once per closed position and advances incrementally', async () => {
  const sqlite = db.initDb(':memory:');
  db.saveTrade(closedTrade());
  db.saveTrade(closedTrade({
    id:'position-1-exit-2',
    parentId:'position-1',
    qty:5,
    grossPnl:33,
    charges:3,
    pnl:30,
    closedAt:'2026-07-30T05:10:00.000Z',
    closeReason:'Trailing stop',
  }));

  const service = efficiency.createSetupEfficiencyService({
    db,
    now:() => NOW,
    logger:{ warn() {} },
  });
  const first = await service.reconcile('test');

  assert.equal(first.ok, true);
  assert.equal(first.rowsScanned, 2);
  assert.equal(first.positionsUpdated, 1);
  const facts = db.listSetupEfficiencyFacts();
  assert.equal(facts.length, 1);
  assert.equal(facts[0].positionId, 'position-1');
  assert.equal(facts[0].legs, 2);
  assert.equal(facts[0].pnl, 80);
  assert.equal(facts[0].exposure, 1000);
  assert.equal(facts[0].trailHit, true);

  const payload = service.getPayload('30d');
  assert.equal(payload.summary.closedPositions, 1);
  assert.equal(payload.setups.find(row => row.setupType === 'LONG_MOMENTUM').trades, 1);
  assert.equal(payload.reconciliation.status, 'idle');
  assert.equal(service.getPayload('10d').period, '10d');
  const dated = service.getPayload('all', '2026-07-30');
  assert.equal(dated.period, 'date');
  assert.equal(dated.date, '2026-07-30');
  assert.equal(dated.summary.closedPositions, 1);
  assert.equal(service.getPayload('all', '2026-07-29').summary.closedPositions, 0);

  const unchanged = await service.reconcile('test-no-change');
  assert.equal(unchanged.rowsScanned, 0);
  assert.equal(unchanged.positionsUpdated, 0);

  db.saveTrade(closedTrade({
    id:'position-2',
    symbol:'NEXT',
    pnl:-20,
    grossPnl:-17,
    charges:3,
    closeReason:'Stop loss',
  }));
  const cursor = db.loadSetupEfficiencyReconciliation();
  sqlite.prepare('UPDATE trade_txns SET updated_at = ? WHERE id = ?')
    .run(cursor.cursorUpdatedAt + 1, 'position-2');

  const incremental = await service.reconcile('test-incremental');
  assert.equal(incremental.rowsScanned, 1);
  assert.equal(incremental.positionsUpdated, 1);
  assert.equal(service.getPayload('all').summary.closedPositions, 2);
  service.stop();
});

test('reconciliation exposes persisted Rangebound admission metrics', async () => {
  const sqlite = db.initDb(':memory:');
  const rangeboundAdmission = {
    schemaVersion:1,
    lowerBoundDistancePct:0.05,
    stopDistancePct:0.3,
    decisionScore:44.5,
    modeledNetProfitPct:0.79,
    modeledGrossProfitPct:0.95,
    modeledCostPct:0.16,
    grossToCostMultiple:5.938,
    liveDepthAvailable:true,
    liveDepthFresh:true,
    liquidityGateApplied:true,
  };
  db.saveTrade(closedTrade({
    id:'rangebound-position',
    setupType:'RANGEBOUND',
    decisionScore:44.5,
    entryContext:{ decisionScore:44.5, rangeboundAdmission },
  }));
  const service = efficiency.createSetupEfficiencyService({
    db,
    now:() => NOW,
    logger:{ warn() {} },
  });

  const result = await service.reconcile('rangebound-admission-test');
  assert.equal(result.ok, true);
  const fact = db.listSetupEfficiencyFacts()[0];
  assert.equal(fact.decisionScore, 44.5);
  assert.deepEqual(fact.rangeboundAdmission, rangeboundAdmission);
  service.stop();
  sqlite.close();
});

test('service uses a non-blocking startup task and enforces an hourly minimum interval', () => {
  const source = efficiency.createSetupEfficiencyService.toString();
  assert.match(source, /setImmediate\(\(\) =>/);
  assert.match(source, /Math\.max\(HOUR_MS,/);
  assert.equal(efficiency.HOUR_MS, 60 * 60 * 1000);
});

test('date validation accepts only real ISO calendar dates', () => {
  assert.equal(efficiency.isTradingDate('2026-07-30'), true);
  assert.equal(efficiency.isTradingDate('2026-02-30'), false);
  assert.equal(efficiency.isTradingDate('30-07-2026'), false);
});
