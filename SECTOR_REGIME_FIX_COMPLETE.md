# Sector-Level Regime Check Fix - Complete

## Problem Identified

**Root Cause:** Sector-level market regime checks were not working because `sectorTrendCache` was empty/null during snapshot building.

**Symptom:** 
- All candidates had `sectorAvg: null` in snapshots
- Zero sector-based blocks despite rules requiring blocks when sector < +0.15%
- SELL orders generated even when sector momentum was bearish

## Why It Happened

The data flow problem:

1. **sectorTrendCache** is only updated when `renderSectors()` is called
2. `renderSectors()` is driven by **UI update cycles** (user views dashboard, switches tabs, etc.)
3. `saveSimulationSnapshot()` runs on a separate **tick/intraday refresh cycle**
4. **No guarantee** sectorTrendCache has been populated before snapshot building
5. Result: `sectorTrendCache` is often empty when `getSimulationMarketRegime()` checks it

**Parallel to Nifty bug:** Same root cause; Nifty was fixed with `ensureIndexDataFresh()`, but sectors were missed.

## Solution Implemented

### Function: `ensureSectorTrendFresh()`

Added at dashboard-app.js lines 4207-4227:

```javascript
function ensureSectorTrendFresh() {
  // Rebuild sectorTrendCache from current stockData to ensure fresh sector values for regime checks
  // This mirrors ensureIndexDataFresh() for Nifty; fixes bug where sector regime is null during snapshots
  if (!stockData) return;
  
  const sectorChanges = {};
  for (const s of MIDCAP_STOCKS) {
    if (!sectorChanges[s.sector]) sectorChanges[s.sector] = [];
    const d = stockData[s.sym];
    if (d && d.price > 0) sectorChanges[s.sector].push(d.change || 0);
  }
  
  // Clear and rebuild sectorTrendCache
  Object.keys(sectorTrendCache).forEach(k => delete sectorTrendCache[k]);
  Object.keys(sectorChanges).forEach(sectorName => {
    const changes = sectorChanges[sectorName];
    sectorTrendCache[sectorName] = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
  });
  
  if (DEBUG_SIM_LOGS) console.log('[SECTOR_TREND] Refreshed sector cache:', Object.keys(sectorTrendCache).length, 'sectors populated');
}
```

**How it works:**
- Loops through all MIDCAP_STOCKS
- Collects % change values for each sector from current `stockData`
- Computes sector average (same as `renderSectors()` does)
- Stores in `sectorTrendCache` with fresh values
- Runs **before** snapshot candidates are built

### Integration: Call in `saveSimulationSnapshot()`

Modified lines 4229-4233:

```javascript
async function saveSimulationSnapshot(source = 'intraday-refresh') {
  // CRITICAL: Ensure fresh market data before building candidates
  // This fixes the bug where sells are allowed despite high Nifty
  ensureIndexDataFresh();
  ensureSectorTrendFresh();  // ← NEW: Ensure sectors fresh too
  
  const candidates = buildSimulationSnapshotCandidates(30, 30);
```

**Execution order:**
1. `ensureIndexDataFresh()` → Ensures `indexData.nifty50.change` is populated
2. `ensureSectorTrendFresh()` → Ensures `sectorTrendCache[*]` is populated
3. `buildSimulationSnapshotCandidates()` → Creates candidates
4. Regime checks use fresh data for both Nifty and sector

### Cache Version Bump

Updated in `nse_midcap_dashboard.html`:
- Line 7: `v20260625-44` → `v20260625-45`
- Line 29: `v20260625-44` → `v20260625-45`

**Purpose:** Forces browser to reload JavaScript with the fix

## Expected Improvements

### Before Fix
```
Snapshot candidates:
  RELIANCE (Banking)  → sectorAvg: null, blockReason: none
  TCS (IT)           → sectorAvg: null, blockReason: none
  HDFCBANK (Banking) → sectorAvg: null, blockReason: none
Result: No sector-based blocks; sells allowed even during bearish sector moves
```

### After Fix
```
Snapshot candidates:
  RELIANCE (Banking)  → sectorAvg: -0.42%, blockReason: "sector < +0.15% (-0.42%)"
  TCS (IT)           → sectorAvg: +1.23%, blockReason: none
  HDFCBANK (Banking) → sectorAvg: -0.42%, blockReason: "sector < +0.15% (-0.42%)"
Result: Sells blocked when sector momentum is negative; respects sector regime rule
```

## Verification

### Quick Check (Browser Console)

1. Open browser DevTools → Console
2. Enable debug logs: `DEBUG_SIM_LOGS = true`
3. Wait for next snapshot (30s during market hours)
4. Look for: `[SECTOR_TREND] Refreshed sector cache: X sectors populated`
5. Check snapshot candidates have `marketContext.sectorAvg` values

### Programmatic Check

Run the verification script:
```bash
node verify_sector_regime.js
```

Expected output:
```
Candidates WITH sector data: 60
Candidates WITHOUT sector data: 0
Sector-based blocks: N (where N > 0 indicates working regime check)
STATUS: ✅ SECTOR-LEVEL REGIME CHECK IS WORKING
```

### Manual Validation

In browser, inspect snapshot data:
```javascript
// Fetch latest snapshot
fetch('http://localhost:3001/simulation-snapshots')
  .then(r => r.json())
  .then(d => {
    const snap = d.snapshots[d.snapshots.length - 1];
    snap.candidates.slice(0, 5).forEach(c => {
      console.log(`${c.symbol}: sectorAvg=${c.marketContext?.sectorAvg}, blocked=${!!c.blockReason}`);
    });
  });
```

## Related Settings

All in trade_rules.js:
- **SIMULATION_MARKET_REGIME_SECTOR_PCT**: 0.15 (blocks SELL if sector < +0.15%)
- **SIMULATION_MARKET_REGIME_NIFTY_PCT**: 0.25 (blocks SELL if Nifty < +0.25%)
- **SIMULATION_MARKET_REGIME_RS_PCT**: 0.10 (sector relative strength threshold)

## Implementation Details

### Data Source Chain

```
stockData[symbol].change
    ↓ (collected by sector)
sectorChanges[sector][] = [change1, change2, ...]
    ↓ (averaged)
sectorTrendCache[sector] = avg(changes)
    ↓ (passed to regime check)
getSimulationMarketRegime({sectorTrend: sectorTrendCache})
    ↓ (checks against threshold)
blockReason: "sector < +0.15% (-0.42%)"
```

### Consistency with Nifty Fix

| Component | Nifty Fix | Sector Fix | Status |
|-----------|-----------|-----------|--------|
| Data source | `stockData[NIFTY].change` | `stockData[*].change` by sector | ✅ Consistent |
| Cache holder | `indexData.nifty50` | `sectorTrendCache[*]` | ✅ Consistent |
| Ensure function | `ensureIndexDataFresh()` | `ensureSectorTrendFresh()` | ✅ Consistent |
| Called from | `saveSimulationSnapshot()` | `saveSimulationSnapshot()` | ✅ Consistent |
| Timing | Before candidates build | Before candidates build | ✅ Consistent |
| Logging | `[INDEXDATA]` | `[SECTOR_TREND]` | ✅ Consistent |

## Testing Scenarios

### Scenario 1: Bearish Sector, Bullish Nifty
- **Setup:** NIFTY +0.5%, IT sector -0.3%
- **Expected:** IT sells blocked (sector rule), others allowed (Nifty rule permits)
- **Verification:** Search blockReason for "sector < +0.15%"

### Scenario 2: Bullish Sector, Bearish Nifty
- **Setup:** NIFTY -0.5%, Banking sector +0.4%
- **Expected:** All sells blocked (Nifty rule), sector rule irrelevant
- **Verification:** All blockReasons mention "nifty < -0.25%"

### Scenario 3: Mixed Sectors
- **Setup:** NIFTY +0.1%, Infra +0.8%, IT -0.5%, Mid-cap -0.2%
- **Expected:** 
  - Infra sells allowed
  - IT/Mid-cap sells blocked
  - Nifty rule NOT blocking (Nifty barely positive)
- **Verification:** blockReasons show sector-specific blocks

## File Changes Summary

| File | Line(s) | Change | Type |
|------|---------|--------|------|
| dashboard-app.js | 4207-4227 | Added `ensureSectorTrendFresh()` | Code addition |
| dashboard-app.js | 4233 | Added call to `ensureSectorTrendFresh()` | Code addition |
| nse_midcap_dashboard.html | 7 | Updated cache version | Cache buster |
| nse_midcap_dashboard.html | 29 | Updated cache version | Cache buster |

## Deployment

1. **Changes committed** to dashboard-app.js (ensureSectorTrendFresh function + call)
2. **Cache version bumped** in HTML to force browser reload
3. **Node backend** needs NO restart (changes are client-side logic)
4. **Browser** will auto-reload with new code on next page visit
5. **First snapshot after reload** will have sector data populated

## Known Limitations

- ✅ Sector averages computed from **loaded** MIDCAP stocks only (not all NSE sectors)
- ✅ If a sector has NO loaded stocks, average is 0% (no block)
- ✅ Regime check still only applies to **entry filtering**, not exit decisions
- ✅ Sector data refreshed every snapshot cycle (every 30s during market hours)

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Still seeing `sectorAvg: null` | Browser cache not cleared | Ctrl+F5 or clear cache |
| No sector blocks in blockReason | All sectors positive | Normal when market optimistic |
| `[SECTOR_TREND]` not in console | DEBUG_SIM_LOGS not enabled | Set `DEBUG_SIM_LOGS = true` |
| sector blocks appearing wrong | MIDCAP_STOCKS list outdated | Verify sector mappings |
| Inconsistent between snapshots | stockData changing between cycles | Check NSE fetch frequency |

## Next Steps

1. ✅ Verify sector data is now captured in snapshots
2. ⏳ Monitor sector-based blocks during live trading
3. ⏳ Compare P&L: sector regime on vs off
4. ⏳ Consider adding sector stats to UI (like Nifty regime indicator)
5. ⏳ Extend sector regime logging to match Nifty detail level
