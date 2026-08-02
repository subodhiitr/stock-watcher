'use strict'
const fs = require('node:fs');
const path = require('node:path');
const { saveSnapshotDay } = require('./snapshot-store.js');

/**
 * Load JSON file safely, returns empty object/array if not found
 */
function loadJson(filePath, defaultValue = null) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`Failed to load ${filePath}:`, error.message);
  }
  return defaultValue;
}

/**
 * Migrate trade transactions from paper_trades.json
 */
function migrateTrades(db, fixturesDir) {
  const tradesPath = path.join(fixturesDir, 'paper_trades.json');
  const tradesData = loadJson(tradesPath, {});
  
  // Handle both array and object formats
  let trades = [];
  if (Array.isArray(tradesData)) {
    trades = tradesData;
  } else if (Array.isArray(tradesData?.trades)) {
    // Top-level trades array: { savedAt, portfolio: {...}, trades: [...] }
    trades = tradesData.trades;
  } else if (tradesData?.portfolio?.trades && Array.isArray(tradesData.portfolio.trades)) {
    trades = tradesData.portfolio.trades;
  }

  const upsertTrade = db.prepare(`
    INSERT INTO trade_txns (id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  for (const trade of trades) {
    if (trade?.id) {
      upsertTrade.run(trade.id, JSON.stringify(trade), now, now);
    }
  }
}

/**
 * Migrate symbols from simulation_universe.json and saved_stocks.json
 * Merges sources when same symbol appears in both
 */
function migrateSymbols(db, fixturesDir) {
  const simulationPath = path.join(fixturesDir, 'simulation_universe.json');
  const savedPath = path.join(fixturesDir, 'saved_stocks.json');
  const etfListPath = path.join(fixturesDir, 'etf_list_cache.json');

  const simulationData = loadJson(simulationPath, { symbols: [] });
  const savedStocks = loadJson(savedPath, []);

  // Build a set of known ETF symbols so we can exclude them from the stocks table.
  // ETFs have their own etf_master table and must not pollute the symbols table.
  const etfListData = loadJson(etfListPath, {});
  const etfList = Array.isArray(etfListData) ? etfListData :
                  (etfListData?.etfs && Array.isArray(etfListData.etfs)) ? etfListData.etfs :
                  (etfListData?.stocks && Array.isArray(etfListData.stocks)) ? etfListData.stocks : [];
  const etfSymbols = new Set(etfList.map(e => e?.symbol || e?.sym).filter(Boolean));

  // Also check the DB's etf_master for any ETFs already migrated
  const etfMasterRows = db.prepare('SELECT symbol FROM etf_master').all();
  for (const row of etfMasterRows) etfSymbols.add(row.symbol);

  // Collect all stock symbols (excluding ETFs) with their sources
  const symbolsMap = new Map();

  // Process simulation universe symbols — skip ETFs
  if (Array.isArray(simulationData.symbols)) {
    for (const symbol of simulationData.symbols) {
      if (symbol && !etfSymbols.has(symbol)) {
        symbolsMap.set(symbol, { symbol, source: 'simulation' });
      }
    }
  }

  // Process saved stocks — skip ETFs
  if (Array.isArray(savedStocks)) {
    for (const stock of savedStocks) {
      if (stock?.sym && !etfSymbols.has(stock.sym)) {
        const existing = symbolsMap.get(stock.sym);
        if (existing && existing.source === 'simulation') {
          Object.assign(existing, {
            name: stock.name || existing.name,
            sector: stock.sector || existing.sector,
            cap: stock.cap || existing.cap,
            source: 'both'
          });
        } else {
          symbolsMap.set(stock.sym, {
            symbol: stock.sym,
            name: stock.name || null,
            sector: stock.sector || null,
            cap: stock.cap || null,
            source: 'saved'
          });
        }
      }
    }
  }

  const upsertSymbol = db.prepare(`
    INSERT INTO symbols (symbol, name, sector, cap, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      name = excluded.name,
      sector = excluded.sector,
      cap = excluded.cap,
      source = CASE
        WHEN symbols.source = 'both' OR excluded.source = 'both' THEN 'both'
        WHEN symbols.source = excluded.source THEN symbols.source
        ELSE 'both'
      END,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  for (const symbol of symbolsMap.values()) {
    upsertSymbol.run(
      symbol.symbol,
      symbol.name || null,
      symbol.sector || null,
      symbol.cap || null,
      symbol.source,
      now
    );
  }
}

/**
 * Migrate script codes from cache/sharekhan_scrip_codes.json
 */
function migrateScriptCodes(db, fixturesDir) {
  const codesPath = path.join(fixturesDir, 'cache', 'sharekhan_scrip_codes.json');
  const codesData = loadJson(codesPath, {});
  
  // Handle object with symbols key
  let codes = [];
  if (codesData?.symbols && typeof codesData.symbols === 'object') {
    codes = Object.entries(codesData.symbols).map(([symbol, code]) => ({ symbol, code }));
  } else if (Array.isArray(codesData)) {
    codes = codesData;
  }

  const upsertCode = db.prepare(`
    INSERT INTO scripts_master (symbol, sharekhan_code, sharekhan_updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      sharekhan_code = excluded.sharekhan_code,
      sharekhan_updated_at = excluded.sharekhan_updated_at
  `);

  const now = Date.now();
  for (const entry of codes) {
    // Support both {symbol, code} (from object map) and {symbol, sharekhan_code} (array format)
    const code = entry?.sharekhan_code ?? entry?.code;
    if (entry?.symbol && code !== undefined && code !== null) {
      upsertCode.run(entry.symbol, Number(code), now);
    }
  }
}

/**
 * Migrate ETF master from various ETF cache and saved files
 */
function migrateEtfs(db, fixturesDir) {
  // Resolve each path: prefer fixtures/ dir, fall back to project root (parent)
  const resolve = (filename) => {
    const inFixtures = path.join(fixturesDir, filename);
    return fs.existsSync(inFixtures) ? inFixtures : path.join(fixturesDir, '..', filename);
  };
  const etfListPath = resolve('etf_list_cache.json');
  const etfSummaryPath = resolve('etf_summary_cache.json');
  const etfHoldingsPath = resolve('etf_holdings_cache.json');
  const savedEtfsPath = resolve('saved_etfs.json');
  const savedEtfFavsPath = resolve('saved_etf_favs.json');

  // Load all ETF data
  let etfListData = loadJson(etfListPath, {});
  let etfList = Array.isArray(etfListData) ? etfListData : 
                (etfListData?.etfs && Array.isArray(etfListData.etfs)) ? etfListData.etfs :
                (etfListData?.stocks && Array.isArray(etfListData.stocks)) ? etfListData.stocks :
                Object.values(etfListData).filter(v => v && typeof v === 'object' && (v.symbol || v.sym));

  // etf_list_cache.meta = {SYMBOL: {oneYearReturn, threeYearReturn, expenseRatio, ...}}
  const etfMetaMap = typeof etfListData?.meta === 'object' ? etfListData.meta : {};

  // etf_summary_cache.json is {SYMBOL: {oneMonthReturn, savedAt, version}} keyed by symbol
  let etfSummaryRaw = loadJson(etfSummaryPath, {});
  let etfSummary = Array.isArray(etfSummaryRaw)
    ? etfSummaryRaw
    : Object.entries(etfSummaryRaw).map(([sym, v]) => ({ ...v, symbol: sym })).filter(v => v?.symbol);

  let etfHoldings = loadJson(etfHoldingsPath, []);
  if (!Array.isArray(etfHoldings)) etfHoldings = Object.values(etfHoldings).filter(v => v && typeof v === 'object');

  let savedEtfs = loadJson(savedEtfsPath, []);
  if (!Array.isArray(savedEtfs)) savedEtfs = Object.values(savedEtfs).filter(v => v && typeof v === 'object');

  let savedEtfFavs = loadJson(savedEtfFavsPath, []);
  if (!Array.isArray(savedEtfFavs)) savedEtfFavs = Object.values(savedEtfFavs).filter(v => v && typeof v === 'object');

  // Build map of all ETFs
  const etfsMap = new Map();

  // Collect from etf_list_cache (etfs array) + etf_list_cache.meta (1Y/3Y/expense ratio)
  for (const etf of etfList) {
    const sym = etf?.symbol || etf?.sym;
    if (sym) {
      const meta = etfMetaMap[sym] || {};
      etfsMap.set(sym, {
        symbol: sym,
        name: etf.name || null,
        data: JSON.stringify({
          ...etf,
          symbol: sym,
          // Merge meta fields (1Y/3Y returns, expense ratio) into the ETF data blob
          oneYearReturn:   meta.oneYearReturn   ?? null,
          threeYearReturn: meta.threeYearReturn  ?? null,
          fiveYearReturn:  meta.fiveYearReturn   ?? null,
          ytdReturn:       meta.ytdReturn        ?? null,
          category:        meta.category         ?? null,
          fundFamily:      meta.fundFamily || etf.fundFamily || null,
          expenseRatio:    meta.expenseRatio ?? etf.expRatio ?? null,
        }),
        is_saved: 0,
        is_favorite: 0
      });
    }
  }

  // Merge with summary cache
  for (const etf of etfSummary) {
    if (etf?.symbol) {
      const existing = etfsMap.get(etf.symbol) || { symbol: etf.symbol, data: '{}', is_saved: 0, is_favorite: 0 };
      const existingData = JSON.parse(existing.data);
      const merged = { ...existingData, ...etf };
      existing.data = JSON.stringify(merged);
      etfsMap.set(etf.symbol, existing);
    }
  }

  // Merge with holdings cache
  for (const etf of etfHoldings) {
    if (etf?.symbol) {
      const existing = etfsMap.get(etf.symbol) || { symbol: etf.symbol, data: '{}', is_saved: 0, is_favorite: 0 };
      const existingData = JSON.parse(existing.data);
      const merged = { ...existingData, ...etf };
      existing.data = JSON.stringify(merged);
      etfsMap.set(etf.symbol, existing);
    }
  }

  // Mark saved ETFs
  for (const etf of savedEtfs) {
    if (etf?.symbol) {
      const existing = etfsMap.get(etf.symbol) || {
        symbol: etf.symbol,
        name: etf.name || null,
        data: '{}',
        is_saved: 0,
        is_favorite: 0
      };
      existing.is_saved = 1;
      existing.name = etf.name || existing.name;
      etfsMap.set(etf.symbol, existing);
    }
  }

  // Mark favorite ETFs
  for (const etf of savedEtfFavs) {
    if (etf?.symbol) {
      const existing = etfsMap.get(etf.symbol) || {
        symbol: etf.symbol,
        data: '{}',
        is_saved: 0,
        is_favorite: 0
      };
      existing.is_favorite = 1;
      etfsMap.set(etf.symbol, existing);
    }
  }

  const upsertEtf = db.prepare(`
    INSERT INTO etf_master (symbol, data, is_saved, is_favorite, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      data = excluded.data,
      is_saved = excluded.is_saved,
      is_favorite = excluded.is_favorite,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  for (const etf of etfsMap.values()) {
    upsertEtf.run(
      etf.symbol,
      etf.data,
      etf.is_saved,
      etf.is_favorite,
      now
    );
  }
}

/**
 * Migrate fresh news from cache files into fresh_news table
 * Reads from cache/fresh_news/*.json and cache/fresh_stock_news.json
 * Sets expires_at based on file mtime + 15 days TTL
 */
function migrateFreshNews(db, fixturesDir) {
  const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
  const freshNewsDir = path.join(fixturesDir, 'cache', 'fresh_news');
  const stockNewsPath = path.join(fixturesDir, 'cache', 'fresh_stock_news.json');

  const upsertFreshNews = db.prepare(`
    INSERT INTO fresh_news (symbol, news_date, news_json, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(symbol, news_date) DO UPDATE SET
      news_json = excluded.news_json,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();

  // Process individual symbol files from cache/fresh_news/*.json
  if (fs.existsSync(freshNewsDir)) {
    try {
      const files = fs.readdirSync(freshNewsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(freshNewsDir, file);
        const stats = fs.statSync(filePath);
        const fileTime = stats.mtimeMs;
        const expiresAt = fileTime + FIFTEEN_DAYS_MS;

        // Skip already-expired entries during migration
        if (expiresAt <= now) continue;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          if (data?.symbol) {
            const newsDate = data.news?.[0]?.date || new Date().toISOString().split('T')[0];
            upsertFreshNews.run(
              data.symbol,
              newsDate,
              JSON.stringify(data),
              expiresAt,
              now
            );
          }
        } catch (err) {
          console.warn(`Failed to process fresh_news file ${file}:`, err.message);
        }
      }
    } catch (err) {
      console.warn(`Failed to read fresh_news directory:`, err.message);
    }
  }

  // Process aggregated stock news file
  if (fs.existsSync(stockNewsPath)) {
    try {
      const stats = fs.statSync(stockNewsPath);
      const fileTime = stats.mtimeMs;
      const expiresAt = fileTime + FIFTEEN_DAYS_MS;

      const content = fs.readFileSync(stockNewsPath, 'utf-8');
      const data = JSON.parse(content);

      for (const [symbol, symbolData] of Object.entries(data || {})) {
        const newsDate = symbolData?.news?.[0]?.date || new Date().toISOString().split('T')[0];
        const entryExpiresAt = expiresAt;
        // Skip already-expired entries during migration
        if (entryExpiresAt <= now) continue;
        upsertFreshNews.run(
          symbol,
          newsDate,
          JSON.stringify(symbolData),
          entryExpiresAt,
          now
        );
      }
    } catch (err) {
      console.warn(`Failed to process fresh_stock_news.json:`, err.message);
    }
  }
}

/**
 * Migrate portfolio metadata (initialCapital, capitalAdds) from paper_trades.json
 * Stores as JSON in a portfolio_state key-value table row
 */
function migratePortfolio(db, fixturesDir) {
  const tradesPath = path.join(fixturesDir, 'paper_trades.json');
  const tradesData = loadJson(tradesPath, {});

  // Portfolio lives at top-level .portfolio (not inside trades array)
  let portfolio = null;
  if (!Array.isArray(tradesData) && tradesData?.portfolio && typeof tradesData.portfolio === 'object') {
    portfolio = tradesData.portfolio;
  }

  if (!portfolio) return;

  db.prepare(`
    INSERT INTO portfolio_state (key, data, updated_at)
    VALUES ('default', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(JSON.stringify(portfolio), Date.now());
}

/**
 * Migrate ETF holdings from etf_holdings_cache.json into etf_holdings_cache table
 * Uses a 30-day TTL since holdings data is relatively stable
 */
function migrateEtfHoldings(db, fixturesDir) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const holdingsPath = path.join(fixturesDir, 'etf_holdings_cache.json');
  let holdings = loadJson(holdingsPath, []);
  if (!Array.isArray(holdings)) {
    holdings = Object.values(holdings).filter(v => v && typeof v === 'object');
  }

  const upsert = db.prepare(`
    INSERT INTO etf_holdings_cache (symbol, payload, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      payload = excluded.payload,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();
  const expiresAt = now + THIRTY_DAYS_MS;
  for (const entry of holdings) {
    const sym = entry?.symbol || entry?.sym;
    if (sym) {
      upsert.run(sym, JSON.stringify(entry), expiresAt, now);
    }
  }
}

/**
 * Migrate snapshots from snapshots/*.json to snapshots/*.json.gz
 * Supports both naming conventions:
 *   - snapshot-YYYY-MM-DD.json  (snapshot-store standard)
 *   - simulation_snapshots_YYYY-MM-DD.json  (legacy production naming)
 */
async function migrateSnapshots(fixturesDir) {
  const snapshotsDir = path.join(fixturesDir, 'snapshots');
  
  if (!fs.existsSync(snapshotsDir)) {
    return;
  }

  try {
    const files = fs.readdirSync(snapshotsDir);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      if (file.endsWith('.json.gz')) continue;

      const filePath = path.join(snapshotsDir, file);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);

        // Support both snapshot-YYYY-MM-DD.json and simulation_snapshots_YYYY-MM-DD.json
        const dateMatch =
          file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/) ||
          file.match(/^simulation_snapshots_(\d{4}-\d{2}-\d{2})\.json$/);
        if (dateMatch) {
          const date = dateMatch[1];
          await saveSnapshotDay(date, data, snapshotsDir);
        }
      } catch (err) {
        console.warn(`Failed to compress snapshot ${file}:`, err.message);
      }
    }
  } catch (err) {
    console.warn(`Failed to read snapshots directory:`, err.message);
  }
}

/**
 * Run complete migration
 */
async function runMigration(db, fixturesDir) {
  console.log('🔄 Starting migration...');
  try {
    console.log('  → Migrating trades...');
    migrateTrades(db, fixturesDir);
    const tradeCount = db.prepare('SELECT COUNT(*) as cnt FROM trade_txns').get();
    console.log(`    ✅ Trades: ${tradeCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ Trade migration failed:', e.message);
  }
  
  try {
    console.log('  → Migrating symbols...');
    migrateSymbols(db, fixturesDir);
    const symbolCount = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get();
    console.log(`    ✅ Symbols: ${symbolCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ Symbol migration failed:', e.message);
  }
  
  try {
    console.log('  → Migrating scripts...');
    migrateScriptCodes(db, fixturesDir);
    const scriptCount = db.prepare('SELECT COUNT(*) as cnt FROM scripts_master').get();
    console.log(`    ✅ Scripts: ${scriptCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ Script migration failed:', e.message);
  }
  
  try {
    console.log('  → Migrating ETFs...');
    migrateEtfs(db, fixturesDir);
    const etfCount = db.prepare('SELECT COUNT(*) as cnt FROM etf_master').get();
    console.log(`    ✅ ETFs: ${etfCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ ETF migration failed:', e.message);
  }
  
  try {
    console.log('  → Migrating news...');
    migrateFreshNews(db, fixturesDir);
    const newsCount = db.prepare('SELECT COUNT(*) as cnt FROM fresh_news').get();
    console.log(`    ✅ News: ${newsCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ News migration failed:', e.message);
  }
  
  try {
    console.log('  → Migrating portfolio state...');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS portfolio_state (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      )
    `).run();
    migratePortfolio(db, fixturesDir);
    const portfolioRow = db.prepare("SELECT data FROM portfolio_state WHERE key = 'default'").get();
    console.log(`    ✅ Portfolio: ${portfolioRow ? 'migrated' : 'not found (array-format source skipped)'}`);
  } catch (e) {
    console.error('  ❌ Portfolio migration failed:', e.message);
  }

  try {
    console.log('  → Migrating ETF holdings...');
    migrateEtfHoldings(db, fixturesDir);
    const holdingsCount = db.prepare('SELECT COUNT(*) as cnt FROM etf_holdings_cache').get();
    console.log(`    ✅ ETF holdings: ${holdingsCount.cnt} rows`);
  } catch (e) {
    console.error('  ❌ ETF holdings migration failed:', e.message);
  }

  try {
    console.log('  → Migrating snapshots...');
    await migrateSnapshots(fixturesDir);
    console.log('    ✅ Snapshots migrated');
  } catch (e) {
    console.error('  ❌ Snapshot migration failed:', e.message);
  }
  
  console.log('✅ Migration phase complete!');
}

// Execute migration when run as script
if (require.main === module) {
  console.log('🚀 Starting migration script...');
  (async () => {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database('stock-watcher.db');
    console.log('✅ Database opened');
    
    // Initialize schema first
    const initSql = `
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER);
      CREATE TABLE IF NOT EXISTS trade_txns (id TEXT PRIMARY KEY, data TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS symbols (symbol TEXT PRIMARY KEY, name TEXT, sector TEXT, cap TEXT, source TEXT, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS scripts_master (symbol TEXT PRIMARY KEY, sharekhan_code INTEGER, zerodha_token INTEGER, nse_code TEXT, yahoo_symbol TEXT, sharekhan_updated_at INTEGER NOT NULL DEFAULT 0, zerodha_updated_at INTEGER NOT NULL DEFAULT 0, nse_updated_at INTEGER NOT NULL DEFAULT 0, yahoo_updated_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS etf_master (symbol TEXT PRIMARY KEY, data TEXT, is_saved INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS fresh_news (symbol TEXT, news_date TEXT, news_json TEXT, expires_at INTEGER, updated_at INTEGER, PRIMARY KEY (symbol, news_date));
      CREATE TABLE IF NOT EXISTS etf_holdings_cache (symbol TEXT PRIMARY KEY, payload TEXT, expires_at INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS etf_nav_daily (symbol TEXT, nav_date TEXT, nav REAL, data TEXT, updated_at INTEGER, PRIMARY KEY (symbol, nav_date));
      CREATE TABLE IF NOT EXISTS etf_quote_cache (symbol TEXT PRIMARY KEY, payload TEXT, expires_at INTEGER, updated_at INTEGER);
      CREATE TABLE IF NOT EXISTS portfolio_state (key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
    `;
    
    for (const stmt of initSql.split(';')) {
      if (stmt.trim()) {
        try {
          db.exec(stmt);
        } catch (e) {
          // Table might already exist
        }
      }
    }
    console.log('✅ Schema initialized');
    
    // Insert schema version if not exists
    const schemaCheck = db.prepare('SELECT COUNT(*) as cnt FROM schema_version').get();
    if (schemaCheck.cnt === 0) {
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(Date.now());
    }
    
    // Run migration
    const fixturesDir = 'fixtures';
    console.log('');
    try {
      await runMigration(db, fixturesDir);
      console.log('');
      console.log('✅ Migration completed successfully');
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    } finally {
      db.close();
    }
  })();
}

module.exports = { runMigration };
