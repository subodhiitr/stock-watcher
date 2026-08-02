const test = require('node:test');
const assert = require('node:assert/strict');

const TradeRules = require('../trade_rules');

test('shared simulation session boundaries use the same configurable settlement cutoff', () => {
  const settings = TradeRules.withDefaults({ SIMULATION_EOD_SETTLEMENT_MIN: 15 * 60 + 15 });
  assert.equal(TradeRules.isSimulationEntryWindow('2026-07-10T04:00:00.000Z', settings), true); // 09:30 IST
  assert.equal(TradeRules.isSimulationEodSettlement('2026-07-10T09:44:59.000Z', settings), false);
  assert.equal(TradeRules.isSimulationEodSettlement('2026-07-10T09:45:00.000Z', settings), true);
});

test('portfolio equity includes realized pnl and heat uses open stop risk', () => {
  const trades = [
    { status:'closed', pnl:500 },
    { status:'open', entryPrice:100, stop:98, qty:10, reservedCapital:1000, sector:'IT' },
  ];
  const equity = TradeRules.computePortfolioEquity({ initialCapital:10000, capitalAdds:[{ amount:1000 }] }, trades);
  assert.equal(equity.equity, 11500);
  assert.equal(equity.cashAvailable, 10500);
  const heat = TradeRules.computePortfolioHeat(trades, equity.equity);
  assert.equal(heat.risk, 20);
  assert.equal(heat.bySector.IT, 20);
});

test('entry guard blocks third same-day entry for a symbol', () => {
  const settings = TradeRules.withDefaults({});
  const at = '2026-07-07T09:30:00.000Z';
  const trades = [
    { symbol: 'JKPAPER', side: 'buy', status: 'closed', openedAt: '2026-07-07T04:22:37.593Z', closedAt: '2026-07-07T04:50:00.000Z', pnl: 10 },
    { symbol: 'JKPAPER', side: 'buy', status: 'closed', openedAt: '2026-07-07T05:55:50.403Z', closedAt: '2026-07-07T06:20:00.000Z', pnl: 12 },
    { symbol: 'INFY', side: 'buy', status: 'closed', openedAt: '2026-07-07T06:30:00.000Z', closedAt: '2026-07-07T07:00:00.000Z', pnl: 5 },
  ];
  const sameIstDay = (left, right) => {
    const toDay = value => new Date(new Date(value).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return left && right && toDay(left) === toDay(right);
  };
  const stats = TradeRules.buildDayStats(trades, at, settings, { sameDay: sameIstDay });

  assert.match(
    TradeRules.getEntryBlockReason('JKPAPER', 'MOMENTUM_RUNNER', at, stats, settings),
    /daily symbol entry limit 2/
  );
  assert.equal(
    TradeRules.getEntryBlockReason('INFY', 'MOMENTUM_RUNNER', at, stats, settings),
    ''
  );
});

test('entry guard allows at most two new positions in a rolling five-minute window', () => {
  const settings = TradeRules.withDefaults({
    SIMULATION_ROLLING_ENTRY_WINDOW_MIN: 5,
    SIMULATION_ROLLING_ENTRY_MAX: 2,
  });
  const at = '2026-07-13T05:25:00.000Z';
  const trades = [
    { symbol:'VBL', status:'open', openedAt:'2026-07-13T05:21:00.000Z' },
    { symbol:'BDL', status:'open', openedAt:'2026-07-13T05:24:59.000Z' },
    { symbol:'OLD', status:'open', openedAt:'2026-07-13T05:20:00.000Z' },
  ];
  const stats = TradeRules.buildDayStats(trades, at, settings);

  assert.equal(stats.rollingEntries, 2);
  assert.equal(
    TradeRules.getEntryBlockReason('HCLTECH', 'MOMENTUM_RUNNER', at, stats, settings),
    'rolling entry limit 2/5m'
  );
});
