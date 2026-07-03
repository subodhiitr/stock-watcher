const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  let openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        openBrace = source.indexOf('{', i);
        break;
      }
    }
  }
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

function loadGapHelper() {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(`
    ${extractFunctionSource(source, 'computeGapExhaustionScoreAdjustment')}
    module.exports = { computeGapExhaustionScoreAdjustment };
  `, { module });
  return module.exports;
}

test('penalizes stretched bullish gap-up entries without volume shock confirmation', () => {
  const { computeGapExhaustionScoreAdjustment } = loadGapHelper();
  const result = computeGapExhaustionScoreAdjustment({
    gapPct: 1.4,
    dayChangePct: 2.2,
    relVolumeTimeAdjusted: 1.8,
    volumeShock: { isShock: false },
    signal: 'buy',
  });
  assert.ok(result.penalty > 0);
  assert.match(result.reason, /gap-up/i);
});

test('does not penalize volume-shock gap-up breakouts', () => {
  const { computeGapExhaustionScoreAdjustment } = loadGapHelper();
  const result = computeGapExhaustionScoreAdjustment({
    gapPct: 1.9,
    dayChangePct: 3.8,
    relVolumeTimeAdjusted: 5.2,
    volumeShock: { isShock: true },
    signal: 'buy',
  });
  assert.equal(result.penalty, 0);
});
