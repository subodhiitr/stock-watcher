import fs from 'node:fs';
import path from 'node:path';

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
 * Run complete migration
 */
export function runMigration(db, fixturesDir) {
  migrateTrades(db, fixturesDir);
  migrateSymbols(db, fixturesDir);
  migrateScriptCodes(db, fixturesDir);
  migrateEtfs(db, fixturesDir);
}
