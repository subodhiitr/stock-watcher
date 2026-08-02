'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleBrokerRoute } = require('../server/routes/broker');

test('portfolio day P&L defaults to the latest ten trading days', async () => {
  let receivedLimit = null;
  let responseBody = null;
  const response = {
    writeHead() {},
    end(value) { responseBody = JSON.parse(value); },
  };

  const handled = await handleBrokerRoute(
    { method:'GET' },
    response,
    '/portfolio/day-pnl',
    new URLSearchParams(),
    {
      isDbReady:() => true,
      getDayPnl:limit => {
        receivedLimit = limit;
        return { '2026-08-01':125 };
      },
    }
  );

  assert.equal(handled, true);
  assert.equal(receivedLimit, 10);
  assert.equal(responseBody.limit, 10);
  assert.deepEqual(responseBody.dayPnl, { '2026-08-01':125 });
});
