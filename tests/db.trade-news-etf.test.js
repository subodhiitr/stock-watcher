import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, saveTrade, getTrade, updateTrade, listTrades, countTrades } from '../server/db.js';

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

test('listTrades filters by since on opened_at', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN', opened_at: 1700000000000, source: 'simulation' });
  saveTrade({ id: 'trade-2', symbol: 'INFY', opened_at: 1700000001000, source: 'simulation' });
  saveTrade({ id: 'trade-3', symbol: 'TCS', opened_at: 1700000002000, source: 'manual' });

  const filtered = listTrades({ since: 1700000001000 });
  assert.deepEqual(filtered.map((trade) => trade.id).sort(), ['trade-2', 'trade-3']);
});

test('listTrades filters by until on opened_at', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN', opened_at: 1700000000000, source: 'simulation' });
  saveTrade({ id: 'trade-2', symbol: 'INFY', opened_at: 1700000001000, source: 'manual' });
  saveTrade({ id: 'trade-3', symbol: 'TCS', opened_at: 1700000002000, source: 'simulation' });

  const filtered = listTrades({ until: 1700000001000 });
  assert.deepEqual(filtered.map((trade) => trade.id).sort(), ['trade-1', 'trade-2']);
});

test('listTrades filters by source', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN', opened_at: 1700000000000, source: 'simulation' });
  saveTrade({ id: 'trade-2', symbol: 'INFY', opened_at: 1700000001000, source: 'manual' });
  saveTrade({ id: 'trade-3', symbol: 'TCS', opened_at: 1700000002000, source: 'simulation' });

  const filtered = listTrades({ source: 'simulation' });
  assert.deepEqual(filtered.map((trade) => trade.id).sort(), ['trade-1', 'trade-3']);
});

test('updateTrade partially updates fields without dropping existing data', () => {
  initDb(':memory:');

  saveTrade({
    id: 'trade-1',
    symbol: 'SBIN',
    qty: 10,
    status: 'open',
    source: 'simulation',
    opened_at: 1700000000000
  });

  const updated = updateTrade('trade-1', { status: 'closed', exitPrice: 745.1 });
  assert.equal(updated.id, 'trade-1');
  assert.equal(updated.status, 'closed');
  assert.equal(updated.exitPrice, 745.1);
  assert.equal(updated.qty, 10);
  assert.equal(updated.symbol, 'SBIN');
  assert.equal(updated.source, 'simulation');

  const stored = getTrade('trade-1');
  assert.equal(stored.status, 'closed');
  assert.equal(stored.exitPrice, 745.1);
  assert.equal(stored.qty, 10);
  assert.equal(stored.symbol, 'SBIN');
});
