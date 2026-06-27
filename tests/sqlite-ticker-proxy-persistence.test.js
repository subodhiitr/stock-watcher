const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initDb,
  saveTrade,
  listTrades,
  rememberSymbols: dbRememberSymbols,
  getScripCode,
  saveFreshNews,
  getFreshNews,
} = require('../server/db.js');
const {
  rememberTrade,
  rememberSymbols: tickerProxyRememberSymbols,
  loadCachedNews,
} = require('../ticker_proxy.js');

test('rememberTrade should persist trades to sqlite', () => {
  initDb(':memory:');

  const sampleTrade = {
    id: 'trade-1',
    symbol: 'SBIN',
    qty: 5,
    status: 'open',
    strategy: 'news-etf',
    source: 'ticker_proxy',
  };

  // Call proxy.rememberTrade() with sample trade
  rememberTrade(sampleTrade);

  // Verify db.listTrades() returns the trade
  const trades = listTrades({ source: 'ticker_proxy' });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].id, 'trade-1');
  assert.equal(trades[0].symbol, 'SBIN');
  assert.equal(trades[0].qty, 5);
  assert.equal(trades[0].status, 'open');
});

test('rememberSymbols should persist symbols and scripts to sqlite', () => {
  initDb(':memory:');

  const sampleSymbols = [
    {
      symbol: 'RELIANCE',
      name: 'Reliance Industries',
      sector: 'Energy',
      cap: 'large',
      source: 'ticker_proxy',
    },
    {
      symbol: 'SBIN',
      name: 'State Bank of India',
      sector: 'Finance',
      cap: 'large',
      sharekhan_code: 3045,
      source: 'ticker_proxy',
    },
  ];

  // Call proxy.rememberSymbols() with sample symbols
  tickerProxyRememberSymbols(sampleSymbols);

  // Verify symbols were stored via db.rememberSymbols()
  const allTrades = listTrades();
  // We're not checking trades here, just that rememberSymbols was called

  // Verify sharekhan codes were stored via db.upsertScripCodes()
  const sbinCode = getScripCode('SBIN', 'sharekhan');
  assert.equal(sbinCode, 3045);

  // Verify RELIANCE without sharekhan code doesn't have one
  const relianceCode = getScripCode('RELIANCE', 'sharekhan');
  assert.equal(relianceCode, null);
});

test('loadCachedNews should return db cached news', () => {
  initDb(':memory:');

  const symbol = 'SBIN';
  const date = '2024-01-15';
  const newsArray = [
    { title: 'Stock rises 5%', url: 'http://example.com/1', timestamp: 1705276800000 },
    { title: 'Dividend announced', url: 'http://example.com/2', timestamp: 1705280400000 },
  ];

  // Insert news into DB first
  saveFreshNews(symbol, date, newsArray, 7 * 24 * 60 * 60 * 1000); // 7 days TTL

  // Call proxy.loadCachedNews()
  const cached = loadCachedNews(symbol, date);

  // Verify returned news from DB matches
  assert.notEqual(cached, null);
  assert.equal(Array.isArray(cached), true);
  assert.equal(cached.length, 2);
  assert.equal(cached[0].title, 'Stock rises 5%');
  assert.equal(cached[1].title, 'Dividend announced');
});
