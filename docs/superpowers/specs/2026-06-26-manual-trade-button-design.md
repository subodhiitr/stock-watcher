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

- Location: top action bar, immediately after the Portfolio button
- Label: **Trade**
- Style: same as existing action bar buttons (`tab-btn` class or equivalent)
- On click: opens the Manual Trade modal

---

## UI — Modal

**Title:** Manual Trade

**Fields:**

| Field | Type | Behaviour |
|---|---|---|
| Symbol | Searchable `<select>` or `<datalist>` | Options = all MIDCAP_STOCKS + STOCK_ASSETS + ETF_ASSETS symbols. Defaults to empty. |
| Side | BUY / SELL toggle buttons | Defaults to BUY |
| Broker | `<select>` | Options: Paper, Zerodha Dry, Zerodha Live, Sharekhan Live. Defaults to current global broker mode from server. |
| Quantity | `<input type="number">` | Positive integer, no default |
| Price | `<input type="number">` | Auto-filled from `stockData[sym].price` when symbol changes; user-editable |
| Target | `<input type="number">` | Auto-filled from `intradayData[sym]?.target` if available; editable; optional |
| Stop | `<input type="number">` | Auto-filled from `intradayData[sym]?.stop` if available; editable; optional |

**Actions:**
- **Place Trade** (primary) — submits the trade
- **Cancel** — closes modal without action

**Status area:** inline text below buttons showing success or error from the server response.

---

## Data Flow

1. User clicks "Trade" → modal opens
2. User picks symbol → `stockData[sym].price` auto-fills Price; `intradayData[sym]` auto-fills Target/Stop if available
3. User sets Qty, Side, Broker, adjusts Price/Target/Stop
4. User clicks "Place Trade"
5. Client calls existing `postPaperTrade('open', { symbol, side, qty, entryPrice, target, stop, brokerMode, source:'manual' })`
6. On success: `applyOpenedTradeLocally(trade)` updates trade list; modal shows "Trade placed ✓"; closes after 1.5s
7. On error: modal shows error message inline; stays open

---

## Reused Infrastructure

No new server endpoints. All of the following already exist and are reused as-is:

- `postPaperTrade(action, payload)` — POST to `/trade-execution`
- `applyOpenedTradeLocally(trade)` — updates local `paperTrades` and re-renders
- `getManualTradeBrokerMode(sym)` / `normalizeManualTradeBrokerMode(mode)` — broker mode helpers
- Broker mode list: `paper`, `zerodha_dry_run`, `zerodha_live`, `sharekhan_live`
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
