# 🔴 NIFTY REGIME CHECK BUG - ROOT CAUSE ANALYSIS

## Problem Statement
**Many SELL orders are being allowed even when NIFTY is above +0.25% threshold**

Current observation:
- NIFTY is up +0.25% to +0.30%
- Threshold set to `SIMULATION_MARKET_REGIME_NIFTY_PCT: 0.25`
- Logic says: Block SELLs when `nifty > 0.25%`
- **But sells are NOT blocked** ❌

---

## Root Cause Analysis

### 1. **Code Review: Market Regime Check EXISTS**

✅ **In `simulation_engine.js` (lines ~630-700):**
```javascript
function getMarketRegime(candidate, side, context = {}) {
  const nifty = Number(context.niftyChange ?? indices.nifty50?.change ?? indices.nifty?.change);
  ...
  } else if (tradeSide === 'sell') {
    if (Number.isFinite(nifty) && nifty > niftyThreshold) 
      reasons.push(`Nifty ${nifty}%`);
    // This SHOULD block the sell...
  }
  return { ok:reasons.length === 0, reason:reasons.length ? ... : 'market aligned' };
}
```

✅ **In `dashboard-app.js` (line 3923):**
```javascript
function getSimulationCandidateFailure(item) {
  ...
  const regime = getSimulationMarketRegime(item.row, item.t, item.side || item.signal);
  if (!regime.ok) return regime.reason;  // ← Should block here!
  ...
}
```

### 2. **The Code Path EXISTS - So Why Don't Sells Get Blocked?**

When a SELL candidate is evaluated:
1. `buildSimulationSnapshotCandidates()` calls `getSimulationCandidateFailure()`
2. Line 3923 calls `getSimulationMarketRegime(row, t, 'sell')`
3. This calls `SimulationEngine.getMarketRegime()` with context containing `indices:indexData`
4. Logic checks: `if (nifty > 0.25)` then add reason "Nifty X%"
5. If reasons exist, return `{ ok: false, reason: "..." }`

### 3. **THE BUG: indexData is EMPTY**

From latest snapshot analysis:
```
marketContext: {
  niftyChange: null,  ← EMPTY!
  bankNiftyChange: null,
  ...
}
```

This proves **`indexData` is empty when candidates are built**.

When `indexData.nifty50 = undefined`:
- `nifty = Number(undefined ?? undefined) = NaN`
- `Number.isFinite(NaN) = false`
- Condition `if (Number.isFinite(nifty) && nifty > 0.25)` = `if (false && ...) = false`
- No reason added, regime check passes! ❌

---

## The Complete Call Chain (Why It's Not Working)

```
saveSimulationSnapshot()
  ↓
buildSimulationSnapshotCandidates()
  ├─ Iterates through 100+ stocks
  ├─ For each: getSimulationCandidateFailure(item)
  │   ├─ Calls: getSimulationMarketRegime(row, t, 'sell')  ← Line 3923
  │   │   └─ Uses: indexData (from line 3806)
  │   │       └─ indexData = {} ← EMPTY! ❌
  │   └─ Returns empty failure reason
  ├─ Candidate passes all checks
  └─ SELL is allowed ❌

WHERE'S THE NIFTY DATA COMING FROM?
  saveSimulationSnapshot() has access to:
    - Line 4229: market: { indices: indexData }  ← But this is AFTER filtering
    - But by then, it's too late - candidates already built!
```

---

## Why indexData is Empty

### Timeline of indexData Population

1. **Initial load:** `fetchNSEStocks()` populates `indexData` from NSE API
2. **During trading:** `indexData` gets refreshed whenever NSE stocks are fetched
3. **But:** The `saveSimulationSnapshot()` function runs on its own cycle (~1-2 minutes)
4. **Problem:** If `saveSimulationSnapshot()` is called BEFORE the next NSE refresh, `indexData` might still contain old/stale data

### The Timing Issue

```
Timeline:
09:15:00 - Market opens
09:15:10 - fetchNSEStocks() runs → indexData populated ✅
09:16:00 - saveSimulationSnapshot() runs with current indexData ✅
09:17:00 - saveSimulationSnapshot() runs again → indexData still from 09:15:10
          - NSE data not refreshed since 09:15:10
          - Nifty change may have changed, but indexData is stale

OR: indexData never had data in first place
```

---

## Verification

Current snapshot shows **`indexData is empty or null`**:
- ALL candidates have `marketContext.niftyChange = null`
- This means the regime check got `indices = undefined` or `indices = {}`
- Therefore `nifty = NaN`, check passed incorrectly

---

## Solution Options

### Option A: ✅ **RECOMMENDED - Pass Real-Time Nifty Change to Regime Check**

Modify line 3806 to ensure fresh nifty data:

```javascript
function getSimulationMarketRegime(row, t, side) {
  // Get live nifty change (not from stale indexData cache)
  const liveNiftyChange = /* fetch fresh value */;
  
  const regime = SimulationEngine.getMarketRegime(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    side,
    { 
      ...getSimulationEngineSettings(), 
      niftyChange: liveNiftyChange,  ← Use live value, not indexData
      indices: indexData,
      sectorTrend: sectorTrendCache 
    }
  );
  return regime;
}
```

### Option B: **Verify indexData Before Using It**

Add defensive check:

```javascript
function getSimulationMarketRegime(row, t, side) {
  // Ensure indexData is populated
  if (!indexData?.nifty50?.change) {
    console.warn('[MARKET REGIME] indexData is empty!');
    // Try to refresh it
    // ...
  }
  
  return SimulationEngine.getMarketRegime(...);
}
```

### Option C: **Always Fetch Fresh Market Data Before Snapshots**

Ensure `saveSimulationSnapshot()` always uses fresh indices:

```javascript
async function saveSimulationSnapshot(source = 'intraday-refresh') {
  // FIRST: Ensure we have fresh market data
  await ensureFreshIndexData();
  
  // THEN: Build candidates with fresh indexData
  const candidates = buildSimulationSnapshotCandidates(30, 30);
  // ...
}
```

---

## Recommended Fix

**Check in `dashboard-app.js` line 3802-3807:**

Add logging to verify regime check is working:

```javascript
function getSimulationMarketRegime(row, t, side) {
  const regime = SimulationEngine.getMarketRegime(
    buildSimulationEngineCandidate(row, t, adjustedTradeScore(row), side),
    side,
    { ...getSimulationEngineSettings(), indices:indexData, sectorTrend:sectorTrendCache }
  );
  
  // Debug: log when sells are blocked
  if (!regime.ok && side === 'sell') {
    console.log(
      `[MARKET REGIME] SELL blocked for ${row.sym}: ${regime.reason}`,
      { nifty: regime.nifty, threshold: getSimulationEngineSettings().SIMULATION_MARKET_REGIME_NIFTY_PCT }
    );
  }
  
  return regime;
}
```

Then open browser dev console and check if sells are being blocked. If console shows no logs, then `indexData` is the culprit.

---

## Next Steps

1. ✅ **DONE:** Added debug logging (lines 3808-3811 in dashboard-app.js)
2. **TODO:** Check browser console logs during market hours
   - Do you see `[MARKET REGIME]` logs?
   - If YES: Regime check is working ✅
   - If NO: indexData is empty ❌

3. **If indexData is empty:** Implement Option A or C above

---

## Settings Reference

```javascript
// From trade_rules.js
SIMULATION_MARKET_REGIME_NIFTY_PCT: 0.25,  ← Threshold for blocking sells
SIMULATION_MARKET_BREADTH_PCT: 55,         ← Breadth threshold (not used yet)
SIMULATION_MARKET_REGIME_SECTOR_PCT: 0.15, ← Sector threshold
```

**Rule:** 
- **SELL blocked if:** `Nifty > 0.25%`
- **BUY blocked if:** `Nifty < -0.25%`
