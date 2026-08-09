import test from 'node:test';
import assert from 'node:assert/strict';
import prescreen from '../../../server/portfolio/application/api/research-prescreen.cjs';

const { rankResearchUniverse, selectDetailedResearchPool } = prescreen;

function fixture(count) {
  const symbols = Array.from({ length: count }, (_, index) => `STOCK${String(index).padStart(3, '0')}`);
  const quotes = {};
  const histories = {};
  const sectors = {};
  symbols.forEach((symbol, index) => {
    quotes[symbol] = { price: 100 + index, high52: 200, low52: 50, volume: 1000 + index * 10 };
    histories[symbol] = {
      price: 100 + index,
      m3m1: index / count,
      m6m1: index / count,
      trend: index / count,
      median20dTradedValueLakh: 100 + index,
      volatility60d: 0.5 - index / count / 4,
      maxDrawdown: 0.4 - index / count / 5,
    };
    sectors[symbol] = index === 0 ? 'Rare Sector' : `Sector ${index % 5}`;
  });
  return { symbols, quotes, histories, sectors };
}

test('pre-screen percentile-normalizes every component before weighting', () => {
  const input = fixture(20);
  input.histories.STOCK000.median20dTradedValueLakh = 1e15;
  const ranked = rankResearchUniverse(input);
  assert.equal(ranked.length, 20);
  for (const candidate of ranked) {
    assert.ok(candidate.momentumScore >= 0 && candidate.momentumScore <= 1);
    assert.ok(candidate.liquidityScore >= 0 && candidate.liquidityScore <= 1);
    assert.ok(candidate.lowRiskScore >= 0 && candidate.lowRiskScore <= 1);
    assert.ok(candidate.score >= 0 && candidate.score <= 1);
  }
  assert.notEqual(ranked[0].symbol, 'STOCK000');
});

test('detailed pool expands to eight times target within 160 to 200 bounds', () => {
  const input = fixture(500);
  const selected = selectDetailedResearchPool({
    ...input,
    includeSymbols:[],
    targetHoldings:20,
    minimumPool:160,
    maxPool:200,
  });
  assert.equal(selected.target, 160);
  assert.equal(selected.symbols.length, 160);
});

test('sector leaders and existing holdings cannot be omitted', () => {
  const input = fixture(100);
  const selected = selectDetailedResearchPool({
    ...input,
    includeSymbols:['EXISTING'],
    targetHoldings:5,
    minimumPool:40,
    maxPool:40,
  });
  assert.ok(selected.symbols.includes('STOCK000'));
  assert.ok(selected.symbols.includes('EXISTING'));
  assert.equal(selected.symbols.length, 41);
});
