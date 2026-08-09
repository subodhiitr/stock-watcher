import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { extendStrategicHistoryWithProxy } = createRequire(import.meta.url)('../../../server/portfolio/application/api/strategic-history-proxy.cjs');

test('strategic history proxy extends only pre-inception observations and rebases the splice', () => {
  const primary = [
    { sessionDate:'2021-04-07', adjustedLevel:100 },
    { sessionDate:'2021-04-08', adjustedLevel:101 },
  ];
  const proxy = [
    { sessionDate:'2021-04-05', adjustedLevel:50 },
    { sessionDate:'2021-04-06', adjustedLevel:52 },
    { sessionDate:'2021-04-07', adjustedLevel:53 },
  ];
  const result = extendStrategicHistoryWithProxy(primary, proxy);
  assert.equal(result.extendedCount, 2);
  assert.deepEqual(result.history.map(row => row.sessionDate), [
    '2021-04-05', '2021-04-06', '2021-04-07', '2021-04-08',
  ]);
  assert.equal(result.history[1].adjustedLevel, 100);
  assert.equal(result.history[2].adjustedLevel, 100);
  assert.equal(result.history[3].adjustedLevel, 101);
});

test('strategic history proxy never replaces configured benchmark observations', () => {
  const primary = [{ sessionDate:'2020-01-01', adjustedLevel:200 }];
  const proxy = [{ sessionDate:'2021-01-01', adjustedLevel:50 }];
  const result = extendStrategicHistoryWithProxy(primary, proxy);
  assert.equal(result.extendedCount, 0);
  assert.deepEqual(result.history, primary);
});
