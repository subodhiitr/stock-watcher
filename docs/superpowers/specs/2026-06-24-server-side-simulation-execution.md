# Server-Side Simulation Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move simulation execution authority to the server with persisted runtime state, while keeping browser manual trading UX/features intact and introducing `/trade-execution` as canonical API with `/paper-trades` compatibility alias.

**Architecture:** Extract shared simulation decision logic into server-owned modules, run a lock-protected scheduler in `ticker_proxy.js`, and make browser simulation controls call server runtime endpoints (`start/stop/status`). Keep payloads backward-compatible and additive. Persist simulation runtime and broker preference server-side.

**Tech Stack:** Node.js, existing proxy server (`ticker_proxy.js`), JSON file persistence, EventSource SSE, existing `simulation_engine.js`, browser app `dashboard-app.js`, Node test runner (`node --test`).

---

## File Structure (planned)

- **Create** `server/simulation-domain/index.js`
  - Shared entry/exit selection interface used by server runner.
- **Create** `server/simulation-runtime-store.js`
  - Load/save/validate `simulation_runtime.json`.
- **Create** `test/simulation-runtime-store.test.js`
  - Runtime state schema and transition tests.
- **Create** `test/trade-execution-api-contract.test.js`
  - `/trade-execution` and alias contract tests (where practical with existing test style).
- **Modify** `ticker_proxy.js`
  - Scheduler, runtime endpoints, API rename aliasing, ownership migration/backfill, lock ordering.
- **Modify** `dashboard-app.js`
  - Browser start/stop/status integration and removal of client-authoritative simulation loop.
- **Modify** `simulation_engine.js`
  - Export/reuse shared decision helpers (no duplication).
- **Modify** `paper_trades.json` read/write handling in proxy paths
  - Add ownership field defaults and transitions (persisted).
- **Modify** `README.md`
  - Endpoint rename and runtime behavior notes.

---

### Task 1: Add simulation runtime persistence module

**Files:**
- Create: `server/simulation-runtime-store.js`
- Test: `test/simulation-runtime-store.test.js`

- [ ] **Step 1: Write the failing test for default runtime load**

```js
test('loadRuntimeState returns defaults when file missing', () => {
  const state = loadRuntimeState(tmpMissingFile);
  assert.equal(state.state, 'off');
  assert.equal(state.autoResume, true);
});
test('loadRuntimeState coerces malformed values and rewrites file', () => {
  // write invalid state/autoResume/timestamps, load, assert defaults + rewritten content
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/simulation-runtime-store.test.js`  
Expected: FAIL (`loadRuntimeState is not defined`)

- [ ] **Step 3: Implement runtime store with schema coercion**

```js
const DEFAULT_RUNTIME_STATE = { state:'off', autoResume:true, lastTickAt:0, updatedAt:0, lastError:'', version:1 };
function loadRuntimeState(filePath) { /* read, validate enum, coerce defaults */ }
function saveRuntimeState(filePath, nextState) { /* merge, updatedAt, atomic-ish write */ }
function transitionRuntimeState(current, action) { /* start/stop/hard-stop semantics */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/simulation-runtime-store.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/simulation-runtime-store.js test/simulation-runtime-store.test.js
git commit -m "feat: add simulation runtime state persistence store"
```

---

### Task 2: Extract shared simulation-domain entry/exit interfaces

**Files:**
- Create: `server/simulation-domain/index.js`
- Modify: `simulation_engine.js`
- Test: `test/simulation-domain.test.js`

- [ ] **Step 1: Write failing tests for server domain contract**

```js
test('domain returns exit intents before entry intents ordering', () => {
  const result = runSimulationDomainCycle(inputFixture);
  assert.ok(Array.isArray(result.exitIntents));
  assert.ok(Array.isArray(result.entryIntents));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/simulation-domain.test.js`  
Expected: FAIL (`runSimulationDomainCycle` missing)

- [ ] **Step 3: Implement thin domain wrapper reusing existing engine helpers**

```js
function runSimulationDomainCycle({ snapshot, settings, openTrades, now }) {
  const exitIntents = manageExits({ snapshot, settings, openTrades, now });
  const entryIntents = selectEntries({ snapshot, settings, openTrades, now });
  return { exitIntents, entryIntents };
}
```

- [ ] **Step 4: Run tests for domain + existing tests**

Run: `node --test test/simulation-domain.test.js test/zerodha-confirmation-poller.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/simulation-domain/index.js simulation_engine.js test/simulation-domain.test.js
git commit -m "refactor: expose shared simulation domain interfaces for server runner"
```

---

### Task 3: Implement server scheduler and runtime endpoints

**Files:**
- Modify: `ticker_proxy.js`
- Test: `test/simulation-runtime-endpoints.test.js`

- [ ] **Step 1: Write failing tests for `/simulation/start|stop|status` contracts + transitions**

```js
test('POST /simulation/start returns running state contract', async () => {
  const res = await callRoute('/simulation/start', { autoResume:true, tickIntervalSec:15 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.state, 'running');
});
test('POST /simulation/start applies default tickIntervalSec=15 when omitted', async () => {});
test('POST /simulation/stop settle transitions to settling then off on timeout', async () => {
  // start -> stop(mode=settle) -> simulate timeout tick
});
test('POST /simulation/stop defaults to mode=settle and timeoutSec=900', async () => {});
test('POST /simulation/stop immediate transitions directly to off', async () => {
  // start -> stop(mode=immediate)
});
test('GET /simulation/status after proxy restart auto-resumes when state=running && autoResume=true', async () => {
  // persist runtime, restart handler/process fixture, assert running
});
test('settling blocks new entries but still executes exits', async () => {});
test('feed failure during settling forces off and writes lastError', async () => {});
test('invalid transition returns 409', async () => {});
test('manual close vs runner exit race resolves with manual close precedence', async () => {
  // simulate concurrent close + tick; assert manual close wins and runner skips closed trade
});
test('open/partial-close/delete requests are serialized with runner tick under shared write lock', async () => {
  // assert mutation order and state consistency for each action while tick active
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/simulation-runtime-endpoints.test.js`  
Expected: FAIL (route not implemented)

- [ ] **Step 3: Add lock-protected scheduler, startup auto-resume, and endpoint handlers in proxy**

```js
let simulationTickLock = false;
async function runServerSimulationTick() {
  if (simulationTickLock) return;
  simulationTickLock = true;
  try { /* apply manual queue, exits, entries, persist, SSE */ }
  finally { simulationTickLock = false; }
}
// on proxy init: load simulation_runtime.json and auto-start tick loop if state=running && autoResume=true
// during settling: entry path short-circuits with "no new entries"
// transition validation: return 409 for invalid start/stop state changes
// manual-vs-runner race policy enforced under shared lock: manual close wins
```

- [ ] **Step 4: Run endpoint and transition tests**

Run: `node --test test/simulation-runtime-endpoints.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ticker_proxy.js test/simulation-runtime-endpoints.test.js
git commit -m "feat: add server simulation runtime scheduler and control endpoints"
```

---

### Task 4: Rename API to `/trade-execution` with `/paper-trades` alias

**Files:**
- Modify: `ticker_proxy.js`
- Modify: `dashboard-app.js`
- Test: `test/trade-execution-api-contract.test.js`

- [ ] **Step 1: Write failing contract tests for canonical/alias parity and full action matrix**

```js
test('paper-trades alias mirrors trade-execution response contract', async () => {
  const a = await callRoute('/trade-execution', { action:'add-capital', amount:1000 });
  const b = await callRoute('/paper-trades', { action:'add-capital', amount:1000 });
  assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
});
test('GET /trade-execution returns same state contract as GET /paper-trades', async () => {});
test('action validation returns required 400/409 errors for open/close/partial-close/add-capital/delete', async () => {});
test('open enforces side enum, qty integer > 0, money > 0 and rounds to 2 decimals', async () => {});
test('delete rejects open trades and accepts closed trades only', async () => {});
test('each action returns required success fields', async () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trade-execution-api-contract.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement canonical route + alias wrappers + GET parity**

```js
if (pathname === '/trade-execution' || pathname === '/paper-trades') { /* same handler */ }
if (pathname === '/trade-execution/stream' || pathname === '/paper-trades/stream') { /* same SSE */ }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/trade-execution-api-contract.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ticker_proxy.js dashboard-app.js test/trade-execution-api-contract.test.js
git commit -m "feat: introduce trade-execution API with paper-trades compatibility alias"
```

---

### Task 5: Add ownership fields and legacy backfill migration

**Files:**
- Modify: `ticker_proxy.js`
- Test: `test/trade-ownership-migration.test.js`

- [ ] **Step 1: Write failing migration/backfill tests**

```js
test('legacy manual trade gets default ownership fields on load', () => {
  const migrated = migrateLegacyTrade({ source:'manual', status:'open' });
  assert.equal(migrated.entryOwner, 'manual');
  assert.equal(migrated.managementState, 'manual_only');
});
test('auto manual exits OFF keeps manual trades manual_only during running/settling', () => {});
test('auto manual exits ON transitions eligible manual trades to simulation_managed', () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/trade-ownership-migration.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement migration + ownership transitions**

```js
function normalizeTradeOwnership(trade, runtimeState, settings) { /* backfill and transition rules */ }
```

- [ ] **Step 4: Run tests**

Run: `node --test test/trade-ownership-migration.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ticker_proxy.js test/trade-ownership-migration.test.js
git commit -m "feat: persist trade ownership model and legacy backfill rules"
```

---

### Task 6: Update browser controls to server-authoritative runtime

**Files:**
- Modify: `dashboard-app.js`
- Test: `test/dashboard-simulation-controls.test.js`

- [ ] **Step 1: Write failing tests for control behavior**

```js
test('start button calls /simulation/start and updates UI from status', async () => {
  // mock fetch('/simulation/start') and fetch('/simulation/status')
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-simulation-controls.test.js`  
Expected: FAIL

- [ ] **Step 3: Replace client-authoritative loop usage with server status polling/control**

```js
async function startSimulationFromBrowser() { await fetch('/simulation/start', { method:'POST', body: ... }); await pollSimulationStatus(); }
```

- [ ] **Step 4: Run test**

Run: `node --test test/dashboard-simulation-controls.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard-app.js test/dashboard-simulation-controls.test.js
git commit -m "feat: switch browser simulation controls to server-authoritative runtime"
```

---

### Task 7: Preserve existing UI behavior and metadata rendering

**Files:**
- Modify: `dashboard-app.js`
- Test: `test/dashboard-trade-table-compat.test.js`

- [ ] **Step 1: Write failing regression tests for locked target and trade table metadata**

```js
test('trade row still shows locked target and broker audit metadata fields', () => {
  const html = renderTradeRow(fixtureTrade);
  assert.match(html, /locked/i);
  assert.match(html, /audit/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-trade-table-compat.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement additive-only mapping for new runtime fields**

```js
const runtime = payload.simulationRuntime || {};
// merge without removing existing UI field dependencies
```

- [ ] **Step 3.1: Add explicit SSE compatibility test for `simulationRuntime` additive payload**

```js
test('SSE payload includes simulationRuntime additively without removing legacy fields', () => {
  const evt = buildSsePayload();
  assert.ok(evt.simulationRuntime);
  assert.ok(evt.trades); // legacy field still present
});
test('simulationRuntime includes state,lastTickAt,lastError and stream alias parity holds', async () => {
  // verify /trade-execution/stream and /paper-trades/stream payload key parity
});
```

- [ ] **Step 4: Run test**

Run: `node --test test/dashboard-trade-table-compat.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard-app.js test/dashboard-trade-table-compat.test.js
git commit -m "fix: preserve trade table and locked-target UX during server execution migration"
```

---

### Task 8: Final integration verification and docs update

**Files:**
- Modify: `README.md`
- Modify: `TRADE_CREATION_FLOW.md` (if route/control behavior documented there)

- [ ] **Step 1: Document new canonical routes and compatibility window**

```md
- Canonical: /trade-execution
- Compatibility alias: /paper-trades (one release)
```

- [ ] **Step 2: Run full repository checks**

Run: `npm test --silent && npm run typecheck --silent`  
Expected: all pass

- [ ] **Step 3: Manual smoke checklist**

Run:
1. Start proxy
2. `POST /simulation/start`
3. Close browser tab
4. Verify `GET /simulation/status` still updates `lastTickAt`
5. Re-open browser and verify trade table still shows locked target + metadata

Expected: server simulation continues with browser closed.

- [ ] **Step 4: Commit**

```bash
git add README.md TRADE_CREATION_FLOW.md
git commit -m "docs: add server-side simulation runtime and trade-execution API migration notes"
```

---

### Task 9: Release cleanup for migration flagging

**Files:**
- Modify: `ticker_proxy.js`
- Modify: `dashboard-app.js`

- [ ] **Step 1: Add deprecation warning header for alias route**

```js
res.setHeader('X-Deprecated-Route', '/paper-trades will be removed next minor release');
```

- [ ] **Step 2: Verify alias warning appears**

Run: call `/paper-trades` once and inspect response headers.  
Expected: deprecation header present.

- [ ] **Step 3: Commit**

```bash
git add ticker_proxy.js dashboard-app.js
git commit -m "chore: add deprecation signaling for paper-trades alias"
```
