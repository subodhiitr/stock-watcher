import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getSchemaVersion } from '../server/db.js';

test('initDb creates schema and schema_version row', () => {
  const db = initDb(':memory:');
  assert.equal(getSchemaVersion(db) >= 1, true);
});