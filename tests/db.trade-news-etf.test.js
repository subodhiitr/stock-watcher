import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, saveTrade, getTrade, countTrades } from '../server/db.js';

test('saveTrade preserves existing fields when absent in later payload', () => {
  initDb(':memory:');

  saveTrade({
    id: 'trade-1',
    symbol: 'SBIN',
    qty: 5,
    status: 'open',
    strategy: 'news-etf'
  });

  saveTrade({
    id: 'trade-1',
    status: 'closed'
  });

  const stored = getTrade('trade-1');
  assert.equal(stored.status, 'closed');
  assert.equal(stored.symbol, 'SBIN');
  assert.equal(stored.qty, 5);
  assert.equal(stored.strategy, 'news-etf');
});

test('countTrades returns row count', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN' });
  saveTrade({ id: 'trade-2', symbol: 'RELIANCE' });

  assert.equal(countTrades(), 2);
});
