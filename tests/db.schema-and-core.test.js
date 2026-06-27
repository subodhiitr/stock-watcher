import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initDb,
  getSchemaVersion,
  rememberSymbols,
  upsertSymbol,
  upsertScripCodes,
  getScripCode,
  scripCodesUpdatedAt
} from '../server/db.js';

test('initDb creates schema and schema_version row', () => {
  const db = initDb(':memory:');
  assert.equal(getSchemaVersion(db) >= 1, true);
});

test('rememberSymbols merges source to both when same symbol is simulation and saved', () => {
  const db = initDb(':memory:');
  rememberSymbols([
    { symbol: 'SBIN', source: 'simulation' },
    { symbol: 'SBIN', source: 'saved' }
  ]);
  const row = db.prepare('SELECT source FROM symbols WHERE symbol = ?').get('SBIN');
  assert.equal(row.source, 'both');
});

test('upsertSymbol inserts and updates a single symbol row', () => {
  const db = initDb(':memory:');
  upsertSymbol('RELIANCE', 'Reliance Industries', 'Energy', 'large', 'simulation');
  upsertSymbol('RELIANCE', 'Reliance Industries Ltd', 'Energy', 'large', 'simulation');
  const row = db.prepare('SELECT name, source FROM symbols WHERE symbol = ?').get('RELIANCE');
  assert.equal(row.name, 'Reliance Industries Ltd');
  assert.equal(row.source, 'simulation');
});

test('getScripCode returns broker-mapped values (sharekhan numeric, nse text)', () => {
  initDb(':memory:');
  upsertScripCodes([{ symbol: 'SBIN', sharekhan_code: 3045, nse_code: 'SBIN' }], 'sharekhan');
  upsertScripCodes([{ symbol: 'SBIN', nse_code: 'SBIN' }], 'nse');
  assert.equal(getScripCode('SBIN', 'sharekhan'), 3045);
  assert.equal(getScripCode('SBIN', 'nse'), 'SBIN');
});

test('scripCodesUpdatedAt advances after upsert', () => {
  initDb(':memory:');
  const before = scripCodesUpdatedAt('sharekhan');
  upsertScripCodes([{ symbol: 'HDFCBANK', sharekhan_code: 1333 }], 'sharekhan');
  const after = scripCodesUpdatedAt('sharekhan');
  assert.equal(after >= before, true);
  assert.equal(after > 0, true);
});