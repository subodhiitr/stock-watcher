const test = require('node:test');
const assert = require('node:assert/strict');

const { handleTradeSettingsRoute } = require('../server/routes/trade-settings');
const TradeRules = require('../trade_rules');

function responseCapture() {
  return {
    statusCode:null,
    payload:null,
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body) { this.payload = JSON.parse(body); },
  };
}

test('trade settings GET returns effective setup catalog including new strategy controls', async () => {
  const response = responseCapture();
  const handled = await handleTradeSettingsRoute({ method:'GET' }, response, '/trade-settings', {
    loadTradeSettingsFile:() => ({ savedAt:1, overrides:{ SIMULATION_GAP_AND_GO_MIN_GAP_PCT:1 } }),
    tradeRules:TradeRules,
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.effective.SIMULATION_GAP_AND_GO_MIN_GAP_PCT, 1);
  assert.equal(response.payload.defaults.SIMULATION_BULL_FLAG_MIN_POLE_VOLUME_MULTIPLE, 1.2);
  assert.equal(response.payload.defaults.SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT, 5);
  assert.equal(response.payload.defaults.SIMULATION_RANGEBOUND_MAX_SPREAD_PCT, 0.15);
  assert.ok(response.payload.setupDefinitions.some(definition => definition.type === 'GAP_AND_GO'));
});
