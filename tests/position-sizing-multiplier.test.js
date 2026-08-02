const test = require('node:test');
const assert = require('node:assert');
const TradeRules = require('../trade_rules');

test('computePositionSizeMultiplier reduces position after loss streaks', () => {
  // 3+ consecutive losses should reduce to 30%
  const testClosedTrades3Losses = [
    { pnl: -100 },
    { pnl: -50 },
    { pnl: -75 }
  ];
  const mult3Losses = TradeRules.computePositionSizeMultiplier(testClosedTrades3Losses);
  assert.strictEqual(mult3Losses, 0.3, 'Should be 0.3 after 3 losses');

  // 2 consecutive losses should reduce to 50%
  const testClosedTrades2Losses = [
    { pnl: 100 },
    { pnl: -50 },
    { pnl: -75 }
  ];
  const mult2Losses = TradeRules.computePositionSizeMultiplier(testClosedTrades2Losses);
  assert.strictEqual(mult2Losses, 0.5, 'Should be 0.5 after 2 consecutive losses');

  // No losses should be full size
  const testClosedTradesNoLosses = [
    { pnl: 100 },
    { pnl: 200 },
    { pnl: 150 }
  ];
  const multNoLosses = TradeRules.computePositionSizeMultiplier(testClosedTradesNoLosses);
  assert.strictEqual(multNoLosses, 1.0, 'Should be 1.0 with no losses');

  // Empty trades should be full size
  const multEmpty = TradeRules.computePositionSizeMultiplier([]);
  assert.strictEqual(multEmpty, 1.0, 'Should be 1.0 with empty trades');
});

test('computePositionSizeMultiplier considers win rate', () => {
  // Low win rate scenario: 1 win, 3 losses in recent trades
  const lowWinRateTrades = [
    { pnl: 100 },
    { pnl: -50 },
    { pnl: -75 },
    { pnl: -25 }
  ];
  const multLowWinRate = TradeRules.computePositionSizeMultiplier(lowWinRateTrades);
  assert.strictEqual(multLowWinRate, 0.3, 'Should reduce position with low win rate and current loss streak');
});
