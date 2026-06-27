import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, upsertScripCodes, getScripCode } from '../server/db.js';
import SharekhanClient from '../sharekhan-client.js';

test('sharekhan client loads script codes from sqlite on cache hit', async () => {
  // Initialize in-memory DB and insert sample script codes
  const db = initDb(':memory:');
  upsertScripCodes([
    { symbol: 'EXIDEIND', sharekhan_code: 676 },
    { symbol: 'ITC', sharekhan_code: 1660 },
  ], 'sharekhan');

  // Create mock SharekhanClient that won't fetch from API
  const client = new SharekhanClient({
    apiKey: 'mock-key',
    customerId: 'mock-customer',
  });

  // Mock getActiveScriptOfDay to track if it's called
  let apiCallCount = 0;
  client.client.getActiveScriptOfDay = async () => {
    apiCallCount++;
    throw new Error('Should not call API when cache is fresh in DB');
  };

  // Resolve script codes - should come from DB, not trigger API call
  const code1 = await client.getScripCode('EXIDEIND');
  const code2 = await client.getScripCode('ITC');

  assert.equal(code1, 676, 'EXIDEIND code should be loaded from DB');
  assert.equal(code2, 1660, 'ITC code should be loaded from DB');
  assert.equal(apiCallCount, 0, 'API should not be called when DB has fresh codes');
});

test('sharekhan client saves script codes to sqlite when fetched', async () => {
  // Initialize in-memory DB (empty)
  const db = initDb(':memory:');

  // Create mock SharekhanClient
  const client = new SharekhanClient({
    apiKey: 'mock-key',
    customerId: 'mock-customer',
  });

  // Mock getActiveScriptOfDay to return sample data
  client.client.getActiveScriptOfDay = async () => ({
    data: [
      { scripCode: 676, tradingSymbol: 'EXIDEIND', instType: 'EQ' },
      { scripCode: 1660, tradingSymbol: 'ITC', instType: 'EQ' },
    ]
  });

  // Trigger fetch by calling ensureSymbolCodeMap
  await client.ensureSymbolCodeMap('NC');

  // Verify codes were persisted in DB
  const code1 = getScripCode('EXIDEIND', 'sharekhan');
  const code2 = getScripCode('ITC', 'sharekhan');

  assert.equal(code1, 676, 'EXIDEIND code should be saved to DB');
  assert.equal(code2, 1660, 'ITC code should be saved to DB');
});
