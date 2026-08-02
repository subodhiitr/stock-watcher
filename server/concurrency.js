'use strict';

async function mapWithConcurrency(items, limit, mapper) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const workerCount = Math.min(source.length, Math.max(1, Math.floor(Number(limit) || 1)));
  const results = new Array(source.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(source[index], index);
    }
  }

  await Promise.all(Array.from({ length:workerCount }, () => worker()));
  return results;
}

module.exports = {
  mapWithConcurrency,
};
