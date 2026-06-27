import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { initDb, rememberSymbols, upsertScripCodes, saveTrade } from '../server/db.js';
import { runMigration } from '../server/db-migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'sqlite-migrate');

test('migration is idempotent: running twice produces same row counts', async () => {
  const db = initDb(':memory:');

  // Run migration first time
  await runMigration(db, fixturesDir);

  // Count rows after first migration
  const tradesCount1 = db.prepare('SELECT COUNT(*) AS count FROM trade_txns').get().count;
  const symbolsCount1 = db.prepare('SELECT COUNT(*) AS count FROM symbols').get().count;
  const scriptsCount1 = db.prepare('SELECT COUNT(*) AS count FROM scripts_master').get().count;
  const etfMasterCount1 = db.prepare('SELECT COUNT(*) AS count FROM etf_master').get().count;
  const freshNewsCount1 = db.prepare('SELECT COUNT(*) AS count FROM fresh_news').get().count;

  assert.equal(tradesCount1, 2, 'Should have 2 trades after first migration');
  assert.equal(symbolsCount1, 7, 'Should have 7 symbols (5 from simulation + 2 saved, merged correctly)');
  assert.equal(scriptsCount1, 3, 'Should have 3 script master rows');
  assert.equal(etfMasterCount1, 2, 'Should have 2 ETF master rows');
  assert.ok(freshNewsCount1 >= 3, 'Should have at least 3 fresh_news rows (RELIANCE, TCS, and aggregated)');

  // Run migration second time
  await runMigration(db, fixturesDir);

  // Count rows after second migration - should be identical
  const tradesCount2 = db.prepare('SELECT COUNT(*) AS count FROM trade_txns').get().count;
  const symbolsCount2 = db.prepare('SELECT COUNT(*) AS count FROM symbols').get().count;
  const scriptsCount2 = db.prepare('SELECT COUNT(*) AS count FROM scripts_master').get().count;
  const etfMasterCount2 = db.prepare('SELECT COUNT(*) AS count FROM etf_master').get().count;
  const freshNewsCount2 = db.prepare('SELECT COUNT(*) AS count FROM fresh_news').get().count;

  assert.equal(tradesCount2, tradesCount1, 'Trade count should match after second migration');
  assert.equal(symbolsCount2, symbolsCount1, 'Symbol count should match after second migration');
  assert.equal(scriptsCount2, scriptsCount1, 'Scripts count should match after second migration');
  assert.equal(etfMasterCount2, etfMasterCount1, 'ETF master count should match after second migration');
  assert.equal(freshNewsCount2, freshNewsCount1, 'Fresh news count should match after second migration');

  // Verify no duplicates in trades
  const tradeIds = db.prepare('SELECT id FROM trade_txns ORDER BY id').all();
  const uniqueIds = new Set(tradeIds.map(r => r.id));
  assert.equal(tradeIds.length, uniqueIds.size, 'No duplicate trade IDs');

  // Verify no duplicates in symbols
  const symbols = db.prepare('SELECT symbol FROM symbols ORDER BY symbol').all();
  const uniqueSymbols = new Set(symbols.map(r => r.symbol));
  assert.equal(symbols.length, uniqueSymbols.size, 'No duplicate symbols');

  // Verify trade data is preserved (check raw_json or data field)
  const trade = db.prepare('SELECT data FROM trade_txns WHERE id = ?').get('trade-001');
  assert.ok(trade?.data, 'Trade data should be preserved');
  const tradeData = JSON.parse(trade.data);
  assert.equal(tradeData.symbol, 'RELIANCE', 'Trade data should contain symbol');
  assert.equal(tradeData.pnl, 252.75, 'Trade data should preserve PnL');

  // Verify symbols have correct sources after merge
  const relianceRow = db.prepare('SELECT source FROM symbols WHERE symbol = ?').get('RELIANCE');
  assert.equal(relianceRow.source, 'both', 'RELIANCE should have both sources (simulation + saved)');

  const sbinRow = db.prepare('SELECT source FROM symbols WHERE symbol = ?').get('SBIN');
  assert.equal(sbinRow.source, 'saved', 'SBIN should have saved source only');

  // Verify ETF saved/favorite flags
  const etf = db.prepare('SELECT is_saved, is_favorite FROM etf_master WHERE symbol = ?').get('NIFTYBEES');
  assert.equal(etf.is_saved, 1, 'NIFTYBEES should be marked as saved');
  assert.equal(etf.is_favorite, 1, 'NIFTYBEES should be marked as favorite');

  // Verify fresh_news rows exist and have expires_at set
  const freshNewsRows = db.prepare('SELECT symbol, news_date, expires_at FROM fresh_news ORDER BY symbol').all();
  assert.ok(freshNewsRows.length > 0, 'Should have fresh_news rows');
  for (const row of freshNewsRows) {
    assert.ok(row.symbol, `Fresh news row should have symbol`);
    assert.ok(row.news_date, `Fresh news row for ${row.symbol} should have news_date`);
    assert.ok(row.expires_at > 0, `Fresh news row for ${row.symbol} should have expires_at`);
  }

  // Verify snapshots were compressed - check for .json.gz files
  const snapshotsDir = path.join(fixturesDir, 'snapshots');
  const gzipFiles = fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json.gz'));
  assert.equal(gzipFiles.length, 2, 'Should have 2 compressed snapshot files');
});
