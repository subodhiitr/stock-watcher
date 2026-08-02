# Manual Trade Button — Design Spec

**Date:** 2026-06-26  
**Status:** Approved by user

---

## Problem

Placing a manual trade currently requires finding the stock row in the table, selecting a broker from the per-row selector, and clicking Buy/Sell. There is no way to quickly initiate a trade from a central location — especially useful when the user knows the symbol and wants to trade immediately without scrolling.

---

## Solution

Add a **"Trade" button** to the top action bar (beside the existing Portfolio button) that opens a modal for placing a manual trade against any symbol, any broker mode, with auto-filled live price.

---

## UI — Button

- Location: `#main-tabs` tab row, immediately after the **Portfolio** button and before the **Broker Portfolio** button
- Label: **Trade**
- Style: same `tab-btn` class as sibling buttons in `#main-tabs`
- On click: opens the Manual Trade modal

---

## UI — Modal

**Title:** Manual Trade

**Fields:**

| Field | Type | Behaviour |
|---|---|---|
| Symbol | Searchable `<select>` or `<datalist>` | Options = all MIDCAP_STOCKS + STOCK_ASSETS + ETF_ASSETS symbols. Defaults to empty. |
| Side | BUY / SELL toggle buttons | Defaults to BUY |
| Broker | `<select>` | Options: Paper, Zerodha Dry, Zerodha Live, Sharekhan Live. While symbol is empty, defaults to global client `brokerMode`. When symbol is selected/changed, reloads remembered choice via `getManualTradeBrokerMode(sym)`. Changing the broker persists immediately via `setManualTradeBrokerMode(sym, mode)`. |
| Quantity | `<input type="number">` | Positive integer, no default |
| Price | `<input type="number">` | Auto-filled via `getCurrentTradePrice(sym)` (`intradayData[sym]?.price ?? stockData[sym]?.price`) when symbol changes; user-editable. **Place Trade is blocked until a valid positive number is entered** (server rejects `entryPrice ≤ 0`). |
| Target | `<input type="number">` | Auto-filled from `getPaperPlanForSide(intradayData[sym], side, price).target` when symbol or side changes; editable; optional. Recalculates when side toggles. |
| Stop | `<input type="number">` | Auto-filled from `getPaperPlanForSide(intradayData[sym], side, price).stop` when symbol or side changes; editable; optional. Recalculates when side toggles. |

**Actions:**
- **Place Trade** (primary) — submits the trade
- **Cancel** — closes modal without action

**Status area:** inline text below buttons showing success or error from the server response.

---

## Data Flow

1. User clicks "Trade" → modal opens
2. User picks symbol → Price auto-fills via `getCurrentTradePrice(sym)` = `intradayData[sym]?.price ?? stockData[sym]?.price`; Target auto-fills from `intradayData[sym]?.target`; Stop auto-fills from `intradayData[sym]?.stop`; all editable
3. User sets Qty, Side, Broker, adjusts Price/Target/Stop
4. User clicks "Place Trade"
5. Client derives: `const asset = getAssetBySymbol(sym)` → `name = asset?.name ?? sym`, `assetType = asset?.cap === 'etf' ? 'etf' : 'stock'`
6. Client-side validation before POSTing:
   - **Block** if `entryPrice` is not a valid positive number — show inline error, keep modal open
   - **Block** if duplicate open trade exists for symbol — show inline error, keep modal open
   - **Block** if insufficient cash or max exposure exceeded — show inline error, keep modal open
   - **Warn only** (non-blocking) if intraday data is stale or missing
7. Client calls existing `postPaperTrade('open', { symbol, name, assetType, side, qty, entryPrice, target, stop, brokerMode, source:'manual' })`
8. On success: `applyOpenedTradeLocally(trade)` updates trade list; `loadPaperTrades(true)` reconciles with server; modal shows "Trade placed ✓"; closes after 1.5s
9. On error: modal shows error message inline; stays open

---

## Reused Infrastructure

No new server endpoints. All of the following already exist and are reused as-is:

- `postPaperTrade(action, payload)` — POST to `/trade-execution`
- `applyOpenedTradeLocally(trade)` — updates local `paperTrades` and re-renders
- `getManualTradeBrokerMode(sym)` / `normalizeManualTradeBrokerMode(mode)` — broker mode helpers
- `getAssetBySymbol(sym)` — derives `name` and `assetType` for payload (required for ETF symbols)
- `getCurrentTradePrice(sym)` — consistent price source (`intradayData[sym]?.price ?? stockData[sym]?.price`)
- `stockData`, `intradayData` — live price and intraday signal data

---

## Error Handling

- If symbol has no live price, Price field is blank and user must fill manually
- If target/stop not available from intraday data, those fields are blank (optional)
- Server errors surfaced as inline text in modal (do not close on error)
- Already-open trade for same symbol: server returns error; displayed inline

---

## Out of Scope

- Exit/close trade from this modal (use the existing per-row exit flow)
- Fractional quantities or multiple legs
- Order type selection (LIMIT vs MARKET) — always follows existing `postPaperTrade` defaults
