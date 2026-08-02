const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'mobile-app.js'), 'utf8');

test('mobile closed positions display a separately labelled live price', () => {
  assert.match(app, /const livePrice = n\(quote\.price\)/);
  assert.match(app, /status === 'closed' \? `<em class="mobile-trade-live">Live \$\{livePrice \? fmt\(livePrice\) : '--'\}<\/em>`/);
});

test('mobile live stream includes both open and closed trades from today', () => {
  const streamStart = app.indexOf('function connectLiveStream()');
  const streamEnd = app.indexOf('function connectMarketOverviewStream()', streamStart);
  const streamBody = app.slice(streamStart, streamEnd);

  assert.match(streamBody, /const trackedTradeSymbols = state\.trades/);
  assert.match(streamBody, /\.toLowerCase\(\) === 'open' \|\| isToday\(trade\)/);
  assert.match(streamBody, /\.\.\.trackedTradeSymbols/);
});
