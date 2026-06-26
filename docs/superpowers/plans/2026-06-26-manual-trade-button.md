# Manual Trade Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Trade" button to the `#main-tabs` row that opens a modal for placing a manual trade against any symbol and broker without needing to find the stock in the table.

**Architecture:** All logic lives in `dashboard-app.js` (browser-only JS) and `nse_midcap_dashboard.html` (static markup). No new server endpoints — reuses `postPaperTrade`, `applyOpenedTradeLocally`, `loadPaperTrades`, and all existing broker/validation helpers.

**Tech Stack:** Vanilla JS, HTML modal pattern matching existing portfolio/open-trades modals, existing CSS classes (`tab-btn`, `modal-overlay`, `modal-card`, `btn`).

---

## File Map

| File | Change |
|---|---|
| `nse_midcap_dashboard.html` | Add Trade button in `#main-tabs`; add manual-trade-modal markup |
| `dashboard-app.js` | Add `openManualTradeModal()`, `closeManualTradeModal()`, `_populateManualTradeModal(sym)`, `submitManualTrade()` |
| `test/manual-trade-modal.test.js` | New test file — modal open/close, symbol autofill, validation, submit payload |

---

## Task 1: Add the Trade button to `#main-tabs`

**Files:**
- Modify: `nse_midcap_dashboard.html` (line ~149, inside `#main-tabs`)

- [ ] **Step 1: Add button HTML**

In `nse_midcap_dashboard.html`, find the existing Portfolio button (line ~149):
```html
<button class="tab-btn portfolio-tab" type="button" onclick="openPortfolioModal()">Portfolio</button>
```
Insert the Trade button immediately after it (before the Broker Portfolio button):
```html
<button class="tab-btn trade-tab" type="button" id="tab-trade" onclick="openManualTradeModal()">Trade</button>
```

- [ ] **Step 2: Verify in browser**

Open the dashboard. The "Trade" button should appear between "Portfolio" and "Broker Portfolio" tabs with matching style. No JS errors on load (function not yet defined is OK for now — clicking will error until Task 3).

---

## Task 2: Add the modal markup to HTML

**Files:**
- Modify: `nse_midcap_dashboard.html` (after the broker-portfolio-modal div, ~line 362)

- [ ] **Step 1: Add modal HTML**

Insert after the closing `</div>` of `#broker-portfolio-modal`:

```html
<div id="manual-trade-modal" class="modal-overlay" style="display:none;"
     onclick="if(event.target===this) closeManualTradeModal()">
  <div class="modal-card" style="max-width:420px;width:100%;" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Manual Trade</h3>
      <button class="btn" style="padding:6px 10px;font-size:12px;" onclick="closeManualTradeModal()">✕</button>
    </div>
    <div id="manual-trade-modal-body" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px;">
      <!-- populated dynamically by openManualTradeModal() -->
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="manual-trade-submit-btn" onclick="submitManualTrade()">Place Trade</button>
      <button class="btn" onclick="closeManualTradeModal()">Cancel</button>
    </div>
    <div id="manual-trade-status" style="padding:8px 20px 12px;font-size:13px;min-height:20px;"></div>
  </div>
</div>
```

- [ ] **Step 2: Verify markup**

Open the dashboard HTML source and confirm the modal div is present. No visual change since it starts hidden.

---

## Task 3: Write the failing tests

**Files:**
- Create: `test/manual-trade-modal.test.js`

The test file runs in Node (same pattern as `test/manual-trade-broker-selection.test.js` and `test/intraday-sse-migration.test.js`). It reads `dashboard-app.js` as text and regex-tests for the new functions and their key behaviours.

- [ ] **Step 1: Create test file**

```js
// test/manual-trade-modal.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const source = fs.readFileSync(require('path').join(__dirname, '..', 'dashboard-app.js'), 'utf8');

test('openManualTradeModal function is defined', () => {
  assert.match(source, /function openManualTradeModal\s*\(/);
});

test('closeManualTradeModal function is defined', () => {
  assert.match(source, /function closeManualTradeModal\s*\(/);
});

test('submitManualTrade function is defined', () => {
  assert.match(source, /function submitManualTrade\s*\(/);
});

test('openManualTradeModal populates manual-trade-modal-body', () => {
  assert.match(source, /manual-trade-modal-body/);
});

test('submitManualTrade uses postPaperTrade with source manual', () => {
  assert.match(source, /postPaperTrade\s*\(\s*['"]open['"]/);
  assert.match(source, /source\s*:\s*['"]manual['"]/);
});

test('submitManualTrade derives assetType from getAssetBySymbol', () => {
  assert.match(source, /getAssetBySymbol\s*\(/);
  assert.match(source, /cap\s*===\s*['"]etf['"]/);
});

test('submitManualTrade calls applyOpenedTradeLocally on success', () => {
  assert.match(source, /applyOpenedTradeLocally/);
});

test('submitManualTrade calls loadPaperTrades after opening', () => {
  // same reconcile pattern as openPaperTrade
  const submitFnMatch = source.match(/function submitManualTrade[\s\S]{0,2000}?loadPaperTrades/);
  assert.ok(submitFnMatch, 'submitManualTrade should call loadPaperTrades for reconciliation');
});

test('modal shows inline status message on error without closing', () => {
  assert.match(source, /manual-trade-status/);
});

test('symbol change triggers price autofill via getCurrentTradePrice', () => {
  assert.match(source, /getCurrentTradePrice/);
});

test('target and stop autofill use getPaperPlanForSide', () => {
  assert.match(source, /getPaperPlanForSide/);
});

test('submitManualTrade uses getSuggestedPaperQty for cash/exposure validation', () => {
  assert.match(source, /getSuggestedPaperQty/);
  assert.match(source, /suggestion\.cashLimit/);
});

test('_autofillManualTradeFields clears fields before filling (stale-value safety)', () => {
  assert.match(source, /function _autofillManualTradeFields/);
  // Must clear price/target/stop unconditionally at top of function
  const fnMatch = source.match(/function _autofillManualTradeFields[\s\S]{0,600}?getCurrentTradePrice/);
  assert.ok(fnMatch, '_autofillManualTradeFields should clear and then refill');
  // Clearing pattern: value = '' before any conditional fill
  assert.match(source, /priceInput\)[\s\S]{0,40}value\s*=\s*['"]{2}/);
});

test('_onManualTradeSymChange uses getManualTradeBrokerMode for broker reload', () => {
  assert.match(source, /getManualTradeBrokerMode\s*\(sym\)/);
});

test('symbol input uses datalist for searchable autocomplete', () => {
  assert.match(source, /mt-sym-list/);
  assert.match(source, /list="mt-sym-list"/);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
node --test test/manual-trade-modal.test.js
```

Expected: 9 of 12 tests fail (functions not yet defined). `postPaperTrade`, `applyOpenedTradeLocally`, `loadPaperTrades`, `getCurrentTradePrice`, `getPaperPlanForSide`, `setManualTradeBrokerMode`, `getAssetBySymbol` tests pass since those already exist. The 3 new-function tests fail.

---

## Task 4: Implement `openManualTradeModal` and `closeManualTradeModal`

**Files:**
- Modify: `dashboard-app.js` (add after `openPortfolioModal` function, ~line 2950)

- [ ] **Step 1: Add the functions**

Find `async function openPortfolioModal()` (~line 2950) and insert after its closing `}`:

```js
function openManualTradeModal(initialSym = '') {
  const modal = document.getElementById('manual-trade-modal');
  if (!modal) return;
  _populateManualTradeModal(initialSym);
  modal.style.display = 'flex';
}

function closeManualTradeModal() {
  const modal = document.getElementById('manual-trade-modal');
  if (modal) modal.style.display = 'none';
  const status = document.getElementById('manual-trade-status');
  if (status) status.textContent = '';
}

function _populateManualTradeModal(initialSym = '') {
  const body = document.getElementById('manual-trade-modal-body');
  if (!body) return;
  const allSyms = [
    ...MIDCAP_STOCKS.map(s => s.sym),
    ...STOCK_ASSETS.map(s => s.sym),
    ...ETF_ASSETS.map(s => s.sym),
  ].sort();
  const initBroker = escapeHTML(normalizeManualTradeBrokerMode(brokerMode));
  // Use <datalist> for searchable symbol input — native browser autocomplete
  const datalistOpts = allSyms.map(s => `<option value="${escapeHTML(s)}">`).join('');
  body.innerHTML = `
    <datalist id="mt-sym-list">${datalistOpts}</datalist>
    <div style="display:flex;flex-direction:column;gap:6px">
      <label style="font-size:12px;color:var(--muted)">Symbol</label>
      <input id="mt-sym" list="mt-sym-list" placeholder="Search symbol…" autocomplete="off"
             style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px;width:100%;box-sizing:border-box"
             oninput="_onManualTradeSymChange(this.value.trim().toUpperCase())"/>
    </div>
    <div style="display:flex;gap:8px">
      <button id="mt-side-buy" class="btn btn-primary" style="flex:1" onclick="_setManualTradeSide('buy')">BUY</button>
      <button id="mt-side-sell" class="btn" style="flex:1;opacity:.6" onclick="_setManualTradeSide('sell')">SELL</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <label style="font-size:12px;color:var(--muted)">Broker</label>
      <select id="mt-broker" style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px"
              onchange="_onManualTradeBrokerChange(this.value)">
        <option value="paper"${initBroker==='paper'?' selected':''}>Paper</option>
        <option value="zerodha_dry_run"${initBroker==='zerodha_dry_run'?' selected':''}>Zerodha Dry</option>
        <option value="zerodha_live"${initBroker==='zerodha_live'?' selected':''}>Zerodha Live</option>
        <option value="sharekhan_live"${initBroker==='sharekhan_live'?' selected':''}>Sharekhan Live</option>
      </select>
    </div>
    <div style="display:flex;gap:12px">
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <label style="font-size:12px;color:var(--muted)">Quantity</label>
        <input id="mt-qty" type="number" min="1" step="1" placeholder="Qty"
               style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px;width:100%;box-sizing:border-box"/>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <label style="font-size:12px;color:var(--muted)">Price ₹</label>
        <input id="mt-price" type="number" min="0.01" step="0.01" placeholder="Price"
               style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px;width:100%;box-sizing:border-box"/>
      </div>
    </div>
    <div style="display:flex;gap:12px">
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <label style="font-size:12px;color:var(--muted)">Target ₹ <span style="opacity:.5">(optional)</span></label>
        <input id="mt-target" type="number" min="0" step="0.01" placeholder="Target"
               style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px;width:100%;box-sizing:border-box"/>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <label style="font-size:12px;color:var(--muted)">Stop ₹ <span style="opacity:.5">(optional)</span></label>
        <input id="mt-stop" type="number" min="0" step="0.01" placeholder="Stop"
               style="padding:8px;border-radius:6px;background:var(--dim);border:1px solid var(--border);color:var(--text);font-size:14px;width:100%;box-sizing:border-box"/>
      </div>
    </div>
  `;
  if (initialSym) _onManualTradeSymChange(initialSym);
  document.getElementById('manual-trade-status').textContent = '';
}

function _onManualTradeSymChange(sym) {
  // Update symbol input value to uppercase
  const symInput = document.getElementById('mt-sym');
  if (symInput && sym) symInput.value = sym;
  // Reload remembered broker for this symbol using existing helper
  const brokerSel = document.getElementById('mt-broker');
  if (brokerSel && sym) {
    brokerSel.value = getManualTradeBrokerMode(sym);
  }
  _autofillManualTradeFields(sym);
}

function _onManualTradeBrokerChange(mode) {
  const sym = (document.getElementById('mt-sym')?.value || '').toUpperCase();
  if (sym) setManualTradeBrokerMode(sym, mode);
}

function _setManualTradeSide(side) {
  const buyBtn = document.getElementById('mt-side-buy');
  const sellBtn = document.getElementById('mt-side-sell');
  if (buyBtn) { buyBtn.style.opacity = side === 'buy' ? '1' : '.6'; buyBtn.className = side === 'buy' ? 'btn btn-primary' : 'btn'; }
  if (sellBtn) { sellBtn.style.opacity = side === 'sell' ? '1' : '.6'; sellBtn.className = side === 'sell' ? 'btn btn-primary' : 'btn'; }
  // Recalculate target/stop for new side
  const sym = (document.getElementById('mt-sym')?.value || '').toUpperCase();
  if (sym) _autofillManualTradeFields(sym, side);
}

function _getManualTradeSide() {
  const sellBtn = document.getElementById('mt-side-sell');
  return sellBtn?.classList.contains('btn-primary') ? 'sell' : 'buy';
}

function _autofillManualTradeFields(sym, side = null) {
  const priceInput = document.getElementById('mt-price');
  const targetInput = document.getElementById('mt-target');
  const stopInput = document.getElementById('mt-stop');
  // Always clear first so stale values from a previous symbol don't persist
  if (priceInput) priceInput.value = '';
  if (targetInput) targetInput.value = '';
  if (stopInput) stopInput.value = '';
  if (!sym) return;
  const resolvedSide = side || _getManualTradeSide();
  const price = getCurrentTradePrice(sym);
  if (price > 0 && priceInput) priceInput.value = price.toFixed(2);
  const t = intradayData[sym];
  const entryPrice = price || 0;
  if (t && entryPrice > 0) {
    const plan = getPaperPlanForSide(t, resolvedSide, entryPrice);
    if (targetInput && plan?.target > 0) targetInput.value = Number(plan.target).toFixed(2);
    if (stopInput && plan?.stop > 0) stopInput.value = Number(plan.stop).toFixed(2);
  }
}
```

- [ ] **Step 2: Run tests**

```
node --test test/manual-trade-modal.test.js
```

Expected: tests for `openManualTradeModal`, `closeManualTradeModal`, modal body population, `getCurrentTradePrice`, `getPaperPlanForSide`, `setManualTradeBrokerMode`, `getAssetBySymbol`, `getManualTradeBrokerMode` now pass. `submitManualTrade` tests still fail.

- [ ] **Step 3: Commit**

```
git add nse_midcap_dashboard.html dashboard-app.js
git commit -m "feat: add manual trade modal UI and open/close/autofill logic"
```

---

## Task 5: Implement `submitManualTrade`

**Files:**
- Modify: `dashboard-app.js` (add after `_autofillManualTradeFields`, within the same block)

- [ ] **Step 1: Add function**

```js
async function submitManualTrade() {
  const statusEl = document.getElementById('manual-trade-status');
  const setStatus = (msg, color = 'var(--muted)') => { if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; } };
  const submitBtn = document.getElementById('manual-trade-submit-btn');

  const sym = (document.getElementById('mt-sym')?.value || '').toUpperCase();
  const side = _getManualTradeSide();
  const brokerModeVal = normalizeManualTradeBrokerMode(document.getElementById('mt-broker')?.value);
  const qty = Math.floor(Number(document.getElementById('mt-qty')?.value));
  const entryPrice = Number(document.getElementById('mt-price')?.value);
  const target = Number(document.getElementById('mt-target')?.value) || undefined;
  const stop = Number(document.getElementById('mt-stop')?.value) || undefined;

  // Validation — block cases
  if (!sym) { setStatus('Select a symbol.', 'var(--red)'); return; }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) { setStatus('Enter a valid positive price.', 'var(--red)'); return; }
  if (!Number.isFinite(qty) || qty <= 0) { setStatus('Enter a valid quantity (positive integer).', 'var(--red)'); return; }
  if (getOpenPaperTrade(sym)) { setStatus('Already have an open trade for this symbol. Exit it first.', 'var(--red)'); return; }
  const portfolio = getPortfolioSummary();
  if (portfolio.cashAvailable <= 0) { setStatus('No cash available. Close an existing trade first.', 'var(--red)'); return; }
  // Use getSuggestedPaperQty to derive cashLimit — same source of truth as openPaperTrade()
  const t = intradayData[sym];
  const suggestion = getSuggestedPaperQty(t || {}, side, entryPrice, portfolio.cashAvailable);
  if (suggestion.qty <= 0) { setStatus('Not enough available cash for this trade.', 'var(--red)'); return; }
  if (qty > suggestion.cashLimit) { setStatus(`Quantity exceeds available cash/max exposure. Max allowed: ${suggestion.cashLimit}`, 'var(--red)'); return; }
  // Warn-only: stale or missing intraday (non-blocking)
  if (!t || getIntradayFreshness(t).stale) {
    setStatus('⚠️ Intraday data is stale — placing trade anyway.', 'var(--yellow, orange)');
  }

  const asset = getAssetBySymbol(sym);
  const assetType = asset?.cap === 'etf' ? 'etf' : 'stock';
  const name = asset?.name || sym;

  if (submitBtn) submitBtn.disabled = true;
  setStatus('Placing trade…', 'var(--muted)');

  try {
    const openResult = await postPaperTrade('open', {
      symbol: sym,
      name,
      assetType,
      side,
      qty,
      entryPrice,
      target,
      stop,
      source: 'manual',
      brokerMode: brokerModeVal,
      reservedCapital: +(qty * entryPrice).toFixed(2),
      portfolioInitial: getPortfolioCapital(),
    });
    applyOpenedTradeLocally(openResult?.trade);
    loadPaperTrades(true).catch(e => console.warn('manual trade reconcile failed', e.message));
    setStatus('Trade placed ✓', 'var(--green)');
    setTimeout(() => closeManualTradeModal(), 1500);
  } catch (e) {
    setStatus(e.message || 'Could not place trade.', 'var(--red)');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
```

- [ ] **Step 2: Run all tests**

```
node --test test/manual-trade-modal.test.js
```

Expected: all 12 tests pass.

- [ ] **Step 3: Run full regression suite**

```
node --test test/simulation-runtime-endpoints.test.js test/intraday-sse-migration.test.js test/manual-trade-modal.test.js
```

Expected: all 37 tests pass.

- [ ] **Step 4: Commit**

```
git add dashboard-app.js
git commit -m "feat: implement submitManualTrade with validation and broker selection"
```

---

## Task 6: Manual smoke test in browser

- [ ] **Step 1: Start the server and open the dashboard**

```
node ticker_proxy.js
```

Then open `http://localhost:3000` in the browser.

- [ ] **Step 2: Test happy path**

1. Click "Trade" tab button → modal opens
2. Select a symbol (e.g. RELIANCE) → price auto-fills, target/stop auto-fill if intraday data available
3. Enter qty (e.g. 1)
4. Leave broker as Paper
5. Click "Place Trade"
6. Modal shows "Trade placed ✓" and closes after 1.5s
7. Open trades count in the top bar increments by 1

- [ ] **Step 3: Test validation**

1. Click Trade → do not select symbol → click Place Trade → shows "Select a symbol."
2. Select symbol → clear Price field → click Place Trade → shows "Enter a valid positive price."
3. With an open trade for RELIANCE → try opening another RELIANCE trade → shows "Already have an open trade…"

- [ ] **Step 4: Test SELL side**

1. Click SELL button → BUY goes dim, SELL highlights
2. Target/Stop recalculate for short-side plan

- [ ] **Step 5: Commit**

```
git add .
git commit -m "feat: manual trade button complete — button, modal, validation, submit"
```
