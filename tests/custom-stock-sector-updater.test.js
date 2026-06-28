const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  extractNseSector,
  parseNseIndexCapCsv,
  parseNseIndexSectorCsv,
  updateCustomStockSectors,
} = require('../util/populate-custom-stock-sectors');

function createDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-sector-'));
  const dbPath = path.join(dir, 'stock-watcher.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE symbols (
      symbol TEXT PRIMARY KEY,
      name TEXT,
      sector TEXT,
      cap TEXT,
      source TEXT NOT NULL DEFAULT 'saved',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  return { db, dbPath };
}

test('extractNseSector prefers NSE industryInfo sector', () => {
  assert.equal(extractNseSector({
    industryInfo: {
      macro: 'Consumer Discretionary',
      sector: 'Automobile and Auto Components',
      industry: 'Automobiles',
    },
    info: {
      industry: 'Passenger Cars & Utility Vehicles',
    },
  }), 'Automobile and Auto Components');
});

test('parseNseIndexSectorCsv reads industry by symbol from NSE index constituent files', () => {
  const rows = parseNseIndexSectorCsv([
    'Company Name,Industry,Symbol,Series,ISIN Code',
    'Apollo Tyres Ltd.,Automobile and Auto Components,APOLLOTYRE,EQ,INE438A01022',
    '"Example, Limited",Financial Services,EXAMPLE,EQ,INE000000000',
  ].join('\n'));

  assert.deepEqual(rows, [
    { symbol: 'APOLLOTYRE', name: 'Apollo Tyres Ltd.', sector: 'Automobile and Auto Components' },
    { symbol: 'EXAMPLE', name: 'Example, Limited', sector: 'Financial Services' },
  ]);
});

test('parseNseIndexCapCsv assigns cap bucket to each index constituent', () => {
  const rows = parseNseIndexCapCsv([
    'Company Name,Industry,Symbol,Series,ISIN Code',
    'Apollo Tyres Ltd.,Automobile and Auto Components,APOLLOTYRE,EQ,INE438A01022',
  ].join('\n'), 'mid');

  assert.deepEqual(rows, [{ symbol: 'APOLLOTYRE', cap: 'mid' }]);
});

test('updateCustomStockSectors updates custom sectors and custom caps from NSE index data before quote data', async () => {
  const { db, dbPath } = createDb();
  db.prepare('INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'APOLLOTYRE', null, 'Custom', 'custom', 'both', 1
  );
  db.prepare('INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'HINDALCO', null, 'Custom', 'custom', 'both', 1
  );
  db.prepare('INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'BANKINDIA', 'Bank of India', 'Financial Services', 'custom', 'both', 1
  );
  db.prepare('INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'BLANKSECTOR', null, '', 'custom', 'both', 1
  );
  db.prepare('INSERT INTO symbols (symbol, name, sector, cap, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'INFY', 'Infosys', 'IT', 'large', 'saved', 1
  );
  db.close();

  const fetched = [];
  const result = await updateCustomStockSectors({
    dbPath,
    delayMs: 0,
    fetchIndexCsvs: async () => [
      {
        cap: 'mid',
        csv: [
          'Company Name,Industry,Symbol,Series,ISIN Code',
          'Apollo Tyres Ltd.,Automobile and Auto Components,APOLLOTYRE,EQ,INE438A01022',
        ].join('\n'),
      },
      {
        cap: 'small',
        csv: [
        'Company Name,Industry,Symbol,Series,ISIN Code',
        'Bank of India,Financial Services,BANKINDIA,EQ,INE084A01016',
        ].join('\n'),
      },
    ],
    fetchQuote: async (symbol) => {
      fetched.push(symbol);
      if (symbol === 'BLANKSECTOR') return {};
      return symbol === 'APOLLOTYRE'
        ? { industryInfo: { sector: 'Automobile and Auto Components' }, info: { companyName: 'Apollo Tyres Limited' } }
        : { industryInfo: { sector: 'Metals & Mining' }, info: { companyName: 'Hindalco Industries Limited' } };
    },
  });

  const verifyDb = new Database(dbPath, { readonly: true });
  const rows = verifyDb.prepare('SELECT symbol, name, sector, cap, source FROM symbols ORDER BY symbol').all();
  verifyDb.close();

  assert.deepEqual(fetched, ['BLANKSECTOR', 'HINDALCO']);
  assert.deepEqual(result.updated.map(row => row.symbol), ['APOLLOTYRE', 'HINDALCO']);
  assert.deepEqual(result.capUpdated.map(row => row.symbol), ['APOLLOTYRE', 'BANKINDIA']);
  assert.deepEqual(rows, [
    { symbol: 'APOLLOTYRE', name: 'Apollo Tyres Ltd.', sector: 'Automobile and Auto Components', cap: 'mid', source: 'both' },
    { symbol: 'BANKINDIA', name: 'Bank of India', sector: 'Financial Services', cap: 'small', source: 'both' },
    { symbol: 'BLANKSECTOR', name: null, sector: '', cap: 'custom', source: 'both' },
    { symbol: 'HINDALCO', name: 'Hindalco Industries Limited', sector: 'Metals & Mining', cap: 'custom', source: 'both' },
    { symbol: 'INFY', name: 'Infosys', sector: 'IT', cap: 'large', source: 'saved' },
  ]);
});
