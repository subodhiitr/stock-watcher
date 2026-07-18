const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mobile candle chart offers 5m and 15m interval controls', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, '..', 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');

  assert.match(controller, /id="candle-interval-5m"/);
  assert.match(controller, /id="candle-interval-15m"/);
  assert.match(app, /function setCandleInterval\(/);
  assert.match(app, /interval=\$\{safeInterval\}/);
  assert.match(app, /renderCandleSvg\(state\.candleChart\.candles, safeInterval\)/);
});
