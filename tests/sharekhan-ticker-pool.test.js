'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SharekhanTickerPool } = require('../sharekhan-ticker');

function socketFactory(sockets) {
  return () => {
    const socket = new EventEmitter();
    socket.readyState = 1;
    socket.send = () => {};
    socket.close = () => {};
    sockets.push(socket);
    return socket;
  };
}

test('pool creates five websocket connections and distributes symbols without duplicates', () => {
  const sockets = [];
  const pool = new SharekhanTickerPool({
    poolSize: 5,
    accessToken: 'token',
    webSocketFactory: socketFactory(sockets),
    idleTimeoutMs: 0,
  });
  pool.subscribe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  pool.start();
  for (let index = 0; index < 4; index += 1) {
    sockets[index].emit('message', Buffer.from('{}'));
  }
  assert.equal(sockets.length, 5);
  assert.equal(pool.connectionCount, 5);
  assert.equal(pool._subscribedCodes.size, 10);
  assert.deepEqual(pool._tickers.map(ticker => ticker._subscribedCodes.size), [2, 2, 2, 2, 2]);
  assert.deepEqual([1, 2, 3, 4, 5].map(code => pool.getConnectionIndex(code)), [0, 1, 2, 3, 4]);
  pool.stop();
});

test('one fatal authentication rejection stops the entire pool', () => {
  const pool = new SharekhanTickerPool({ poolSize: 5, accessToken: 'token', idleTimeoutMs: 0 });
  pool._tickers.forEach(ticker => { ticker._stopped = false; });
  pool._handleFatalAuth(2, { reason: '103: Invalid Api Key' });
  assert.ok(pool._tickers.every(ticker => ticker._stopped));
  assert.equal(pool._authBlocked, true);
});

test('pool gates each additional connection on prior authentication message', () => {
  const sockets = [];
  const pool = new SharekhanTickerPool({
    poolSize: 3,
    startStaggerMs: 10,
    accessToken: 'token',
    webSocketFactory: socketFactory(sockets),
    idleTimeoutMs: 0,
  });
  pool.start();
  assert.equal(sockets.length, 1);
  sockets[0].emit('message', Buffer.from('{}'));
  assert.equal(sockets.length, 2);
  sockets[1].emit('message', Buffer.from('{}'));
  assert.equal(sockets.length, 3);
  pool.stop();
});
