import fs from 'node:fs';
import path from 'node:path';
import { saveSnapshotDay } from './snapshot-store.js';

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
  const trades = loadJson(tradesPath, []);

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

  const simulationData = loadJson(simulationPath, { symbols: [] });
  const savedStocks = loadJson(savedPath, []);

  // Collect all symbols with their sources
  const symbolsMap = new Map();

  // Process simulation universe symbols
  if (Array.isArray(simulationData.symbols)) {
    for (const symbol of simulationData.symbols) {
      if (symbol) {
        symbolsMap.set(symbol, { symbol, source: 'simulation' });
      }
    }
  }

  // Process saved stocks (may override or merge with simulation)
  if (Array.isArray(savedStocks)) {
    for (const stock of savedStocks) {
      if (stock?.sym) {
        const existing = symbolsMap.get(stock.sym);
        if (existing && existing.source === 'simulation') {
          // Merge: already in simulation, add saved info and set source to both
          Object.assign(existing, {
            name: stock.name || existing.name,
            sector: stock.sector || existing.sector,
            cap: stock.cap || existing.cap,
            source: 'both'
          });
        } else {
          // New symbol or saved-only
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
  const codes = loadJson(codesPath, []);

  const upsertCode = db.prepare(`
    INSERT INTO scripts_master (symbol, sharekhan_code, sharekhan_updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      sharekhan_code = excluded.sharekhan_code,
      sharekhan_updated_at = excluded.sharekhan_updated_at
  `);

  const now = Date.now();
  for (const code of codes) {
    if (code?.symbol && code.sharekhan_code !== undefined) {
      upsertCode.run(code.symbol, code.sharekhan_code, now);
    }
  }
}

/**
 * Migrate ETF master from various ETF cache and saved files
 */
function migrateEtfs(db, fixturesDir) {
  const etfListPath = path.join(fixturesDir, 'etf_list_cache.json');
  const etfSummaryPath = path.join(fixturesDir, 'etf_summary_cache.json');
  const etfHoldingsPath = path.join(fixturesDir, 'etf_holdings_cache.json');
  const savedEtfsPath = path.join(fixturesDir, 'saved_etfs.json');
  const savedEtfFavsPath = path.join(fixturesDir, 'saved_etf_favs.json');

  // Load all ETF data
  const etfList = loadJson(etfListPath, []);
  const etfSummary = loadJson(etfSummaryPath, []);
  const etfHoldings = loadJson(etfHoldingsPath, []);
  const savedEtfs = loadJson(savedEtfsPath, []);
  const savedEtfFavs = loadJson(savedEtfFavsPath, []);

  // Build map of all ETFs
  const etfsMap = new Map();

  // Collect from etf_list_cache
  for (const etf of etfList) {
    if (etf?.symbol) {
      etfsMap.set(etf.symbol, {
        symbol: etf.symbol,
        name: etf.name || null,
        data: JSON.stringify(etf.data || {}),
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
        upsertFreshNews.run(
          symbol,
          newsDate,
          JSON.stringify(symbolData),
          expiresAt,
          now
        );
      }
    } catch (err) {
      console.warn(`Failed to process fresh_stock_news.json:`, err.message);
    }
  }
}

/**
 * Migrate snapshots from cache/snapshots/*.json to snapshots/*.json.gz
 * Compresses each snapshot using saveSnapshotDay from snapshot-store
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

        // Extract date from filename (snapshot-YYYY-MM-DD.json)
        const dateMatch = file.match(/^snapshot-(\d{4}-\d{2}-\d{2})\.json$/);
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
export async function runMigration(db, fixturesDir) {
  migrateTrades(db, fixturesDir);
  migrateSymbols(db, fixturesDir);
  migrateScriptCodes(db, fixturesDir);
  migrateEtfs(db, fixturesDir);
  migrateFreshNews(db, fixturesDir);
  await migrateSnapshots(fixturesDir);
}
