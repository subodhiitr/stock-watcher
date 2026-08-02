'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapWithConcurrency } = require('../server/concurrency');

test('mapWithConcurrency keeps a bounded worker pool without serial chunk barriers', async () => {
  let active = 0;
  let maxActive = 0;
  const completed = [];
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async value => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, value === 1 ? 20 : 2));
    completed.push(value);
    active -= 1;
    return value * 2;
  });

  assert.equal(maxActive, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.ok(completed.indexOf(4) < completed.indexOf(1), 'workers should continue instead of waiting for a slow chunk peer');
});
