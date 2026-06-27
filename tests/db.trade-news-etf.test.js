import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initDb,
  saveTrade,
  getTrade,
  updateTrade,
  listTrades,
  countTrades,
  saveFreshNews,
  getFreshNews,
  pruneFreshNews,
  upsertEtfMaster,
  getEtfMaster,
  saveEtfNavDaily,
  getEtfNavHistory,
  saveEtfQuoteCache,
  getEtfQuoteCache,
  pruneEtfQuoteCache,
  saveEtfHoldingsCache,
  getEtfHoldingsCache,
  pruneEtfHoldingsCache,
  setEtfSaved,
  setEtfFavorite,
  listSavedEtfs,
  listEtfFavorites
} from '../server/db.js';

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

test('listTrades filters by status', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN', status: 'open', source: 'simulation' });
  saveTrade({ id: 'trade-2', symbol: 'INFY', status: 'closed', source: 'simulation' });
  saveTrade({ id: 'trade-3', symbol: 'TCS', status: 'open', source: 'manual' });

  const filtered = listTrades({ status: 'open' });
  assert.deepEqual(filtered.map((trade) => trade.id).sort(), ['trade-1', 'trade-3']);
});

test('listTrades filters by symbol', () => {
  initDb(':memory:');

  saveTrade({ id: 'trade-1', symbol: 'SBIN', status: 'open' });
  saveTrade({ id: 'trade-2', symbol: 'INFY', status: 'closed' });
  saveTrade({ id: 'trade-3', symbol: 'SBIN', status: 'closed' });

  const filtered = listTrades({ symbol: 'SBIN' });
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

test('getFreshNews returns null when expired', () => {
  const db = initDb(':memory:');
  saveFreshNews('SBIN', '2026-06-20', [{ headline: 'SBI rally' }], -1);
  assert.equal(getFreshNews('SBIN', '2026-06-20'), null);

  saveFreshNews('SBIN', '2026-06-20', [{ headline: 'SBI rally' }], -1);
  pruneFreshNews();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM fresh_news').get().count, 0);
});

test('ETF caches return null when expired and prune removes rows', () => {
  const db = initDb(':memory:');
  saveEtfQuoteCache('NIFTYBEES', { price: 248.1 }, -1);
  saveEtfHoldingsCache('NIFTYBEES', { holdings: [{ symbol: 'RELIANCE', weight: 10.2 }] }, -1);

  assert.equal(getEtfQuoteCache('NIFTYBEES'), null);
  assert.equal(getEtfHoldingsCache('NIFTYBEES'), null);

  saveEtfQuoteCache('MON100', { price: 154.4 }, -1);
  saveEtfHoldingsCache('MON100', { holdings: [{ symbol: 'AAPL', weight: 8.5 }] }, -1);
  pruneEtfQuoteCache();
  pruneEtfHoldingsCache();

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM etf_quote_cache').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM etf_holdings_cache').get().count, 0);
});

test('ETF master/list/history APIs return expected rows', () => {
  initDb(':memory:');
  upsertEtfMaster([
    { symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50', exchange: 'NSE' },
    { symbol: 'GOLDBEES', name: 'Nippon India ETF Gold BeES', exchange: 'NSE' }
  ]);

  setEtfSaved('NIFTYBEES', true);
  setEtfFavorite('GOLDBEES', true);

  const master = getEtfMaster('NIFTYBEES');
  assert.equal(master.symbol, 'NIFTYBEES');
  assert.equal(master.name, 'Nippon India ETF Nifty 50');
  assert.equal(master.isSaved, true);

  const saved = listSavedEtfs().map((row) => row.symbol);
  const favorites = listEtfFavorites().map((row) => row.symbol);
  assert.deepEqual(saved, ['NIFTYBEES']);
  assert.deepEqual(favorites, ['GOLDBEES']);

  saveEtfNavDaily([
    { symbol: 'NIFTYBEES', date: '2026-06-20', nav: 251.1 },
    { symbol: 'NIFTYBEES', date: '2026-06-21', nav: 252.3 },
    { symbol: 'GOLDBEES', date: '2026-06-21', nav: 65.8 }
  ]);

  const history = getEtfNavHistory('NIFTYBEES', '2026-06-20', '2026-06-21');
  assert.deepEqual(
    history.map((row) => ({ symbol: row.symbol, date: row.date, nav: row.nav })),
    [
      { symbol: 'NIFTYBEES', date: '2026-06-20', nav: 251.1 },
      { symbol: 'NIFTYBEES', date: '2026-06-21', nav: 252.3 }
    ]
  );
});
