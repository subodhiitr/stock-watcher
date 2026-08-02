const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('mobile P/L card labels selected broker and reads live broker day P/L', () => {
  const controller = fs.readFileSync(path.join(ROOT, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
  const mobileApp = fs.readFileSync(path.join(ROOT, 'mobile-app.js'), 'utf8');

  assert.match(controller, /id="today-pnl-label"/);
  assert.match(controller, /id="broker-mode-label"/);
  assert.match(mobileApp, /setText\('today-pnl-label', `Today P\/L \(\$\{brokerLabel\}\)`\)/);
  assert.match(mobileApp, /brokerPortfolio\?\.data\?\.portfolio\?\.positions\?\.dayPnl/);
  assert.match(mobileApp, /activeBrokerPortfolioEndpoint/);
  assert.match(mobileApp, /\/zerodha-portfolio/);
  assert.match(mobileApp, /\/sharekhan-portfolio/);
  assert.match(mobileApp, /Today P\/L \(\$\{brokerLabel\}\)/);
});

test('mobile P/L card opens broker login when live broker is unauthenticated', () => {
  const mobileApp = fs.readFileSync(path.join(ROOT, 'mobile-app.js'), 'utf8');

  assert.match(mobileApp, /function openBrokerLogin\(broker\)/);
  assert.match(mobileApp, /\/broker\/login\?name=/);
  assert.match(mobileApp, /activeBroker\(\) !== 'paper' && !activeBrokerAuthenticated\(\)/);
  assert.match(mobileApp, /openBrokerLogin\(activeBroker\(\)\)/);
});
