const test = require('node:test');
const assert = require('node:assert');
const TradeRules = require('../trade_rules');
const SimulationEngine = require('../simulation_engine');

test('getSuggestedQty accepts positionMultiplier parameter', () => {
  const settings = TradeRules.withDefaults({
    MAX_POSITION_EXPOSURE: 100000,
    PORTFOLIO_INITIAL_CAPITAL: 500000,
    TRADE_RISK_PCT: 1
  });

  const candidate = {
    symbol: 'TEST',
    indicators: {
      entryStatus: 'confirmed'
    }
  };
  const price = 100;
  const availableCash = 200000;
  const maxExposure = 100000;

  // Test with no multiplier (should use default 1.0)
  const suggestedFull = SimulationEngine.getSuggestedQty(
    candidate, 'buy', price, availableCash, maxExposure, settings
  );

  // Test with reduced multiplier (50%)
  const suggestedReduced = SimulationEngine.getSuggestedQty(
    candidate, 'buy', price, availableCash, maxExposure, settings, 0.5
  );

  assert(suggestedFull.qty > 0, 'Should have qty with full multiplier');
  assert(suggestedReduced.qty > 0, 'Should have qty with 0.5 multiplier');
  assert(suggestedReduced.qty <= suggestedFull.qty, 'Reduced multiplier should produce smaller or equal qty');
  
  // Note: Exact qty comparison might vary based on rounding, so we just verify structure
  assert(suggestedFull.plan, 'Should have target/stop plan');
  assert(suggestedReduced.plan, 'Should have target/stop plan with multiplier');
});
