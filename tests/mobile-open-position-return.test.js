const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('mobile open positions show trade P/L percentage beside the live price', () => {
  const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');

  assert.match(app, /status === 'open' \? `<em class="mobile-trade-return \$\{cls\(pnlPct\)\}">P\/L \$\{pct\(pnlPct\)\}<\/em>`/);
  assert.match(css, /\.mobile-trade-return \{ display: none !important; \}/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*\.trade-cell \.mobile-trade-return \{ display: block !important; \}/);
});

test('mobile closed positions show realized P/L amount beside the exit price', () => {
  const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');

  assert.match(app, /`<em class="mobile-trade-return \$\{cls\(pnl\)\}">P\/L \$\{inr\(pnl\)\}<\/em>`/);
});
