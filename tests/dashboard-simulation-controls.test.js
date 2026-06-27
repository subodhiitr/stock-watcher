const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD_APP_PATH = path.join(__dirname, '..', 'dashboard-app.js');

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) throw new Error(`Function ${functionName} not found`);
  let openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        openBrace = source.indexOf('{', i);
        break;
      }
    }
  }
  if (openBrace < 0) throw new Error(`Function ${functionName} body not found`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${functionName} block not closed`);
}

function loadCreateSimulationControlRuntime() {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  const fnSource = extractFunctionSource(source, 'createSimulationControlRuntime');
  return vm.runInNewContext(`(${fnSource})`, {});
}

test('start button behavior posts to /simulation/start and applies returned status', async () => {
  const createSimulationControlRuntime = loadCreateSimulationControlRuntime();
  const fetchCalls = [];
  const busyStates = [];
  const appliedStatuses = [];

  const runtime = createSimulationControlRuntime({
    startEndpoint: '/simulation/start',
    stopEndpoint: '/simulation/stop',
    statusEndpoint: '/simulation/status',
    getState: () => 'off',
    setBusy: (value) => busyStates.push(value),
    applyStatus: (payload) => appliedStatuses.push(payload),
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, state: 'running', tickIntervalSec: 15 }),
      };
    },
  });

  const status = await runtime.toggle();
  assert.equal(status.state, 'running');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/simulation/start');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.body, '{}');
  assert.deepEqual(busyStates, [true, false]);
  assert.deepEqual(appliedStatuses, [{ ok: true, state: 'running', tickIntervalSec: 15 }]);
});

test('status refresh applies server runtime state to UI model', async () => {
  const createSimulationControlRuntime = loadCreateSimulationControlRuntime();
  const appliedStatuses = [];
  const fetchCalls = [];

  const runtime = createSimulationControlRuntime({
    startEndpoint: '/simulation/start',
    stopEndpoint: '/simulation/stop',
    statusEndpoint: '/simulation/status',
    getState: () => 'running',
    setBusy: () => {},
    applyStatus: (payload) => appliedStatuses.push(payload),
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true, state: 'settling', lastTickAt: 123 }),
      };
    },
  });

  const status = await runtime.refreshStatus();
  assert.equal(status.state, 'settling');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/simulation/status');
  assert.equal(fetchCalls[0].options.method, 'GET');
  assert.deepEqual(appliedStatuses, [{ ok: true, state: 'settling', lastTickAt: 123 }]);
});
