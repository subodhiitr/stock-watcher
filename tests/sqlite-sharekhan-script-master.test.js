import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, upsertScripCodes, getScripCode } from '../server/db.js';
import SharekhanClient from '../sharekhan-client.js';

test('streaming uses current BE codes instead of obsolete SQLite EQ codes and shares the master request', async () => {
  initDb(':memory:');
  upsertScripCodes([
    { symbol: 'HFCL', sharekhan_code: 21951 },
    { symbol: 'E2E', sharekhan_code: 8937 },
    { symbol: 'SRIKPRIND', sharekhan_code: 765165 },
    { symbol: 'REMOVED', sharekhan_code: 123 },
  ], 'sharekhan');
  const client = new SharekhanClient({});
  let calls = 0;
  client.client.getActiveScriptOfDay = async () => {
    calls++;
    return { data: [
      { tradingSymbol: 'HFCL', scripCode: 21954, instType: 'BE' },
      { tradingSymbol: 'E2E', scripCode: 8940, instType: 'BE' },
      { tradingSymbol: 'SRIKPRIND', scripCode: 765168, instType: 'BE' },
    ] };
  };
  assert.deepEqual(await Promise.all(['HFCL', 'E2E', 'SRIKPRIND', 'REMOVED'].map(sym => client.resolveStreamingScripCode(sym))), [21954, 8940, 765168, 0]);
  assert.equal(calls, 1);
  assert.equal(await client.resolveStreamingScripCode('HFCL'), 21954);
  assert.equal(calls, 1);
});

test('streaming refreshes an expired master and does not fall back to unverified DB codes on failure', async () => {
  initDb(':memory:');
  upsertScripCodes([{ symbol: 'HFCL', sharekhan_code: 21951 }], 'sharekhan');
  const client = new SharekhanClient({});
  client.client.getActiveScriptOfDay = async () => { throw new Error('unavailable'); };
  assert.equal(await client.resolveStreamingScripCode('HFCL'), 0);
  client.streamingSymbolCodeCache.set('HFCL', 21951);
  client.symbolCacheUpdatedAt = Date.now() - client.symbolCacheTtlMs - 1;
  client.client.getActiveScriptOfDay = async () => ({ data: [{ tradingSymbol: 'HFCL', scripCode: 21954, instType: 'BE' }] });
  assert.equal(await client.resolveStreamingScripCode('HFCL'), 21954);
});

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

test('sharekhan client resolves non-equity indices for streaming without adding them to the equity cache', async () => {
  initDb(':memory:');
  const client = new SharekhanClient({ apiKey: 'mock-key', customerId: 'mock-customer' });
  client.client.getActiveScriptOfDay = async () => ({
    data: [
      { scripCode: 22, tradingSymbol: 'NIFTY 50', instType: 'IN' },
      { scripCode: 26060, tradingSymbol: 'NIFTY MIDCAP 150', instType: 'IN' },
    ],
  });

  assert.equal(await client.resolveStreamingScripCode('NIFTY MIDCAP 150'), 26060);
  assert.equal(client.symbolCodeCache.has('NIFTY MIDCAP 150'), false);
});
