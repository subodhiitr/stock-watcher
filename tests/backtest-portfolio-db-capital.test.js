import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);

test('loadSettings reads replay capital and available cash from SQLite portfolio state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-watcher-db-'));
  const dbPath = path.join(dir, 'stock-watcher.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE portfolio_state (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE trade_txns (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(`
    INSERT INTO portfolio_state (key, data, updated_at)
    VALUES ('default', ?, ?)
  `).run(JSON.stringify({
    initialCapital: 1000000,
    capitalAdds: [{ amount: 250000 }],
  }), Date.now());
  db.prepare(`
    INSERT INTO trade_txns (id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run('closed-1', JSON.stringify({
    status: 'closed',
    pnl: 5000,
  }), Date.now(), Date.now());
  db.prepare(`
    INSERT INTO trade_txns (id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run('open-1', JSON.stringify({
    status: 'open',
    entryPrice: 100,
    qty: 20,
  }), Date.now(), Date.now());
  db.close();

  const previousDbPath = process.env.STOCK_WATCHER_DB_PATH;
  process.env.STOCK_WATCHER_DB_PATH = dbPath;
  delete require.cache[require.resolve('../backtest_simulation.js')];
  const Backtest = require('../backtest_simulation.js');
  const settings = Backtest.loadSettings({});

  assert.equal(settings.PORTFOLIO_INITIAL_CAPITAL, 1250000);
  assert.equal(settings.PORTFOLIO_AVAILABLE_CASH, 1253000);
  assert.equal(settings.PORTFOLIO_CAPITAL_SOURCE, 'SQLite portfolio state');
  assert.deepEqual(settings.PORTFOLIO_CAPITAL_DETAIL, {
    initial: 1000000,
    addedCapital: 250000,
    capital: 1250000,
    realized: 5000,
    openExposure: 2000,
    cashAvailable: 1253000,
    tradeCount: 2,
  });

  test('loadSettings enables ETF simulation from replay override', () => {
    delete require.cache[require.resolve('../backtest_simulation.js')];
    const Backtest = require('../backtest_simulation.js');

    assert.equal(Backtest.loadSettings({}).SIMULATION_ENABLE_ETF, false);
    assert.equal(Backtest.loadSettings({ enableEtf: true }).SIMULATION_ENABLE_ETF, true);
  });

  if (previousDbPath === undefined) {
    delete process.env.STOCK_WATCHER_DB_PATH;
  } else {
    process.env.STOCK_WATCHER_DB_PATH = previousDbPath;
  }
});
