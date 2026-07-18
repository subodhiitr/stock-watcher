const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, '..', 'my-remix-app', 'server.ts');

test('external proxy never writes fallback headers after a response has started', () => {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  const start = source.indexOf('function forwardToProxy(');
  const end = source.indexOf('\nconst server = ', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);

  assert.match(body, /response\.writableEnded \|\| response\.destroyed/);
  assert.match(body, /if \(!response\.headersSent\)/);
  assert.match(body, /response\.destroy\(\)/);
  assert.match(body, /proxyRes\.on\('error', failProxyResponse\)/);
  assert.match(body, /proxy\.on\('error', failProxyResponse\)/);
});

test('external proxy reconnects event streams for up to five minutes', () => {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.match(source, /proxyReconnectWindowMs = 5 \* 60 \* 1000/);
  assert.match(source, /proxyReconnectMaxDelayMs = 10 \* 1000/);

  const start = source.indexOf('function forwardToProxy(');
  const end = source.indexOf('\nconst server = ', start);
  const body = source.slice(start, end);
  assert.match(body, /isReconnectableEventStream/);
  assert.match(body, /'\/stream\/intraday-live'/);
  assert.match(body, /'\/stream\/market-overview'/);
  assert.match(body, /'\/trade-execution\/stream'/);
  assert.match(body, /const connectEventStream = \(\) =>/);
  assert.match(body, /setTimeout\(connectEventStream, delay\)/);
  assert.match(body, /proxyRes\.pipe\(response, \{ end: false \}\)/);
  assert.match(body, /request\.on\('aborted', stopReconnect\)/);
  assert.match(body, /response\.on\('close', stopReconnect\)/);
  assert.match(body, /30 \* 1000/);
});
