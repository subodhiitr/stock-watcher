# Broker Portfolio Tabs + Combined Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Zerodha/Sharekhan tabs in Broker Portfolio modal, show combined broker summary in the top pill, and label each position row with broker name.

**Architecture:** Keep broker portfolio rendering frontend-owned in `dashboard-app.js`, but split state into per-broker slices (`zerodha`, `sharekhan`) plus an active tab key. Derive combined metrics from successful broker payloads only for the top pill. Render tab-local modal content while preserving existing broker fetch endpoints and error handling.

**Tech Stack:** Vanilla JS (`dashboard-app.js`), HTML template (`nse_midcap_dashboard.html`), CSS (`dashboard.css`), Node test runner (`node --test`).

---

## File Structure and Responsibilities

- **Modify:** `dashboard-app.js`
  - Own per-broker modal state shape and active-tab behavior
  - Aggregate combined pill metrics (open count + day P&L)
  - Render broker tabs, broker-specific tables, and broker column per row
  - Keep partial failure behavior explicit
- **Modify:** `nse_midcap_dashboard.html`
  - Keep existing modal shell; add stable tab host markup only if needed by JS rendering approach
- **Modify:** `dashboard.css`
  - Add tab styles for broker modal tabs and active state
- **Modify:** `test/broker-portfolio-ui.test.js`
  - Add/extend static-contract tests for tab UI hooks and pill rendering contracts
- **Create:** `test/broker-portfolio-aggregate.test.js`
  - Add focused behavior tests for aggregation and partial-failure logic using extracted function source patterns

---

### Task 1: Lock failing tests for combined broker pill

**Files:**
- Modify: `test/broker-portfolio-ui.test.js`
- Create: `test/broker-portfolio-aggregate.test.js`
- Test target: `dashboard-app.js` (`updateBrokerPortfolioPill`, aggregate helpers)

- [ ] **Step 1: Write failing test for combined pill content**

```js
test('broker pill shows combined open positions and day pnl across brokers', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /combinedOpenCount/);
  assert.match(source, /combinedDayPnl/);
  assert.match(source, /Brokers Open/);
});
```

- [ ] **Step 2: Write failing test for partial-failure aggregation behavior**

```js
test('broker pill aggregate uses available broker payload when one broker fails', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /partial availability/i);
  assert.match(source, /successful broker payloads/i);
});
```

- [ ] **Step 3: Write failing tests for pill tooltip breakdown and aggregated class behavior**

```js
test('broker pill tooltip includes zerodha and sharekhan breakdown', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /Zerodha:/);
  assert.match(source, /Sharekhan:/);
});

test('broker pill applies class from aggregated pnl and availability', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /pill\.classList\.add\(/);
  assert.match(source, /combinedDayPnl/);
});
```

- [ ] **Step 4: Run tests to verify failures**

Run: `node --test test/broker-portfolio-ui.test.js test/broker-portfolio-aggregate.test.js`  
Expected: FAIL due to missing aggregate implementation contracts.

- [ ] **Step 5: Commit red tests**

```bash
git add test/broker-portfolio-ui.test.js test/broker-portfolio-aggregate.test.js
git commit -m "test: add failing broker portfolio aggregate pill coverage"
```

---

### Task 2: Implement per-broker state + combined pill aggregation

**Files:**
- Modify: `dashboard-app.js` (broker portfolio state declarations, poll/refresh path, `updateBrokerPortfolioPill`)
- Test: `test/broker-portfolio-ui.test.js`, `test/broker-portfolio-aggregate.test.js`

- [ ] **Step 1: Implement minimal per-broker state shape**

```js
let brokerPortfolioState = {
  activeTab: 'zerodha',
  zerodha: { loading: false, ok: false, data: null, error: '' },
  sharekhan: { loading: false, ok: false, data: null, error: '' },
};
```

- [ ] **Step 2: Add aggregate helper for combined metrics**

```js
function getCombinedBrokerPortfolioMetrics(state) {
  const okStates = [state?.zerodha, state?.sharekhan].filter(s => s?.ok && s?.data?.portfolio);
  const combinedOpenCount = okStates.reduce((sum, s) => sum + Number(s.data.portfolio?.positions?.openCount || 0), 0);
  const combinedDayPnl = okStates.reduce((sum, s) => sum + Number(s.data.portfolio?.positions?.dayPnl || 0), 0);
  return { combinedOpenCount, combinedDayPnl, hasPartial: okStates.length === 1 };
}
```

- [ ] **Step 3: Update `updateBrokerPortfolioPill()` to use aggregate helper**

```js
pill.textContent = `Brokers Open ${combinedOpenCount} | Day ${formatBrokerPillMoney(combinedDayPnl)}`;
```

- [ ] **Step 4: Add tooltip breakdown and partial-availability note**

```js
pill.title = [
  `Zerodha: Open ${zOpen} | Day ${moneyINR(zDay)}`,
  `Sharekhan: Open ${sOpen} | Day ${moneyINR(sDay)}`,
  hasPartial ? 'Partial availability: one broker is currently unavailable' : 'Both brokers available',
  'Click to view positions',
].join(' | ');
```

- [ ] **Step 5: Add deterministic class logic for aggregate state**

```js
if (hasNoData) pill.classList.add('down');
else if (hasPartial || combinedDayPnl < 0) pill.classList.add('warn');
else pill.classList.add('live');
```

- [ ] **Step 6: Update broker polling flow to populate both broker states**

Run fetch calls for Zerodha and Sharekhan in same refresh cycle; update each sub-state independently.

- [ ] **Step 7: Run tests to verify green**

Run: `node --test test/broker-portfolio-ui.test.js test/broker-portfolio-aggregate.test.js`  
Expected: PASS.

- [ ] **Step 8: Commit implementation**

```bash
git add dashboard-app.js test/broker-portfolio-ui.test.js test/broker-portfolio-aggregate.test.js
git commit -m "feat: aggregate broker portfolio pill across brokers"
```

---

### Task 3: Lock failing tests for modal tabs and broker-labeled rows

**Files:**
- Modify: `test/broker-portfolio-ui.test.js`
- Test target: `dashboard-app.js`, `nse_midcap_dashboard.html`, `dashboard.css`

- [ ] **Step 1: Add failing tab contract test**

```js
test('broker portfolio modal renders zerodha and sharekhan tabs', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /broker-portfolio-tab/);
  assert.match(source, /Zerodha/);
  assert.match(source, /Sharekhan/);
});
```

- [ ] **Step 2: Add failing broker-column test**

```js
test('broker position rows include explicit broker column', () => {
  const source = fs.readFileSync(DASHBOARD_APP_PATH, 'utf8');
  assert.match(source, /<th>Broker<\/th>/);
  assert.match(source, /<td>\$\{escapeHTML\(brokerLabel\)\}<\/td>/);
});
```

- [ ] **Step 3: Run tests to verify failures**

Run: `node --test test/broker-portfolio-ui.test.js`  
Expected: FAIL on missing tab and broker-column patterns.

- [ ] **Step 4: Commit red tests**

```bash
git add test/broker-portfolio-ui.test.js
git commit -m "test: add failing broker portfolio tab and broker-column coverage"
```

---

### Task 4: Implement modal tabs + broker column rendering

**Files:**
- Modify: `dashboard-app.js` (`renderBrokerPortfolioModal`, tab switch handlers)
- Modify: `dashboard.css` (tab styles for modal tab strip)
- Modify: `nse_midcap_dashboard.html` (only if persistent tab host wrapper is needed)
- Test: `test/broker-portfolio-ui.test.js`

- [ ] **Step 1: Add active-tab helpers**

```js
function setBrokerPortfolioTab(tab) {
  brokerPortfolioState.activeTab = tab === 'sharekhan' ? 'sharekhan' : 'zerodha';
  renderBrokerPortfolioModal();
}
```

- [ ] **Step 2: Render tab strip in modal output**

Include two tab buttons with active class, then render selected broker’s cards/tables.

- [ ] **Step 3: Add broker column to positions table**

```html
<thead><tr><th>Broker</th><th>Symbol</th>...</tr></thead>
```

Use stable label mapping (`zerodha` -> `Zerodha`, `sharekhan` -> `Sharekhan`).

- [ ] **Step 4: Add CSS styles for modal tabs**

Create focused classes (for example `.broker-modal-tabs`, `.broker-modal-tab`, `.broker-modal-tab.active`) consistent with existing theme.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/broker-portfolio-ui.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit implementation**

```bash
git add dashboard-app.js dashboard.css nse_midcap_dashboard.html test/broker-portfolio-ui.test.js
git commit -m "feat: add broker portfolio modal tabs and broker-labeled rows"
```

---

### Task 5: Regression verification and polish

**Files:**
- Verify only (no new files unless regression fixes needed)

- [ ] **Step 1: Run broker-related regression suite**

Run:
`node --test test/broker-portfolio-ui.test.js test/manual-trade-broker-selection.test.js test/trade-execution-api-contract.test.js`

Expected: PASS.

- [ ] **Step 2: Run dashboard/runtime regression suite touched by portfolio UI state**

Run:
`node --test test/dashboard-simulation-controls.test.js test/simulation-runtime-endpoints.test.js test/simulation-snapshot-server-owned.test.js`

Expected: PASS.

- [ ] **Step 3: If failures occur, apply minimal fixes and re-run only affected suites**

- [ ] **Step 4: Commit final stabilization**

```bash
git add dashboard-app.js dashboard.css nse_midcap_dashboard.html test/*.test.js
git commit -m "test: stabilize broker portfolio tabs and combined pill regressions"
```

---

## Notes for Implementer

- Keep YAGNI: do not add new broker abstractions beyond two-tab requirement.
- Preserve existing modal shell, top action bar wiring, and toggle behavior.
- Follow strict TDD cycle per task: fail -> minimal pass -> refactor.
- Prefer small commits exactly as listed; each commit should keep tests green for the scope it introduces.
