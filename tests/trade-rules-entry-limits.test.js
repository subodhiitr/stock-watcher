const test = require('node:test');
const assert = require('node:assert/strict');

const TradeRules = require('../trade_rules');

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
