const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadRuntimeState, DEFAULT_RUNTIME_STATE } = require('../server/simulation-runtime-store');

const FIXTURE_ROOT = path.join(__dirname, '.simulation-runtime-store-fixtures');

function ensureFixtureRoot() {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
}

test.beforeEach(() => {
  ensureFixtureRoot();
});

test.after(() => {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

test('loadRuntimeState returns defaults and writes file when state file is missing', () => {
  const filePath = path.join(FIXTURE_ROOT, 'missing.json');

  const state = loadRuntimeState(filePath);

  assert.deepEqual(state, DEFAULT_RUNTIME_STATE);
  assert.ok(fs.existsSync(filePath));
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(persisted, DEFAULT_RUNTIME_STATE);
});

test('loadRuntimeState coerces malformed values and rewrites normalized file', () => {
  const filePath = path.join(FIXTURE_ROOT, 'malformed.json');

  fs.writeFileSync(
    filePath,
    JSON.stringify({
      state: 'BROKEN',
      autoResume: 'yes',
      lastTickAt: 'nan',
      updatedAt: -20,
      lastError: null,
      version: '2.7'
    }),
    'utf8'
  );

  const state = loadRuntimeState(filePath);

  const expected = {
    state: 'off',
    autoResume: true,
    lastTickAt: 0,
    updatedAt: 0,
    lastError: '',
    version: 2
  };

  assert.deepEqual(state, expected);
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(persisted, expected);
});