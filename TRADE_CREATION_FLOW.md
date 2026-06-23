# Trade Creation Flow - Detailed Analysis

## Summary
Simulation trades are created in **three contexts**: live dashboard simulation, backtest replay, and server-side paper trading. All three paths assign `openedAt` timestamp at creation time, but `closedAt` is only assigned when trades are closed.

---

## 1. Live Dashboard Simulation (Real-time)

### Entry Point: Client-Side Simulation Cycle
**File**: [dashboard-app.js](dashboard-app.js#L4284)
**Function**: `runSimulationCycle({ allowEntries = true })`

This is the main loop that runs every 2 minutes during market hours. It:
1. Processes exits for open trades
2. Selects new entry candidates
3. Posts new trades to the server

**Lines 4284-4350** (simplified):
```javascript
async function runSimulationCycle({ allowEntries = true } = {}) {
  if (simulationBusy) return;
  const simOpen = getSimulationOpenTrades();
  if (simulationState === 'off' && !simOpen.length) return;
  simulationBusy = true;
  try {
    // Process exits for open trades
    for (const trade of [...simOpen]) {
      const price = getCurrentTradePrice(trade.symbol);
      const exit = getSimulationExit(trade, price);
      if (exit?.action === 'partial') {
        await partialClosePaperTradeAtPrice(trade, exit.exitPrice, qty, exit.reason, exit.runner, true);
      } else if (exit) {
        await closePaperTradeAtPrice(trade, exit.exitPrice, exit.reason, true);
      }
    }
    
    // Check if entries are allowed
    if (simulationState !== 'running' || !allowEntries || !isSimulationEntryWindow() || isSimulationEodSettlementTime()) {
      return;
    }
    
    // Select and enter new trades
    const candidates = getSimulationCandidates();
    let openedThisCycle = 0;
    for (let i = 0; i < candidates.length; i++) {
      if (slots <= 0 || openedThisCycle >= SIMULATION_MAX_NEW_PER_CYCLE) break;
      const { row, t, score, side } = candidates[i];
      
      const setupType = candidates[i].derivedSetupType || candidates[i].setupType || getSetupType(row, t, getRiskGuard(row, t, score));
      const blockReason = getSimulationEntryBlockReason(row.sym, setupType);
      if (blockReason) continue;
      
      const price = getCurrentTradePrice(row.sym);
      const suggestion = getSuggestedPaperQty(t, tradeSide, price, summary.cashAvailable, allocation);
      const qty = Number(suggestion.qty || 0);
      if (qty <= 0) continue;
      
      // POST new trade to server
      const openResult = await postPaperTrade('open', {
        symbol: row.sym,
        name: row.name || row.sym,
        side: tradeSide,
        qty,
        entryPrice: price,
        target: plan.target,
        stop: plan.stop,
        signal: tradeSide,
        score: Math.abs(score),
        rr: t.rr,
        source: 'simulation',
        assetType: isETFAsset(row) ? 'etf' : 'stock',
        setupType,
        setup: ['Simulation', setupType, t.entryStatus, t.entryTrigger].filter(Boolean).join(' | '),
        entryContext: { selectedRank: i + 1, score, ... },
      });
      
      applyOpenedTradeLocally(openResult?.trade);
      openedThisCycle += 1;
    }
  }
}
```

### Candidate Selection
**File**: [dashboard-app.js](dashboard-app.js#L3100)
**Function**: `getSimulationCandidates()`

This function filters and ranks candidates from the intraday stock data:

```javascript
function getSimulationCandidates() {
  const universe = [
    ...MIDCAP_STOCKS.map((s, i) => ({ ...s, rank: i + 1, data: stockData[s.sym] || null })),
    ...STOCK_ASSETS.map((s, i) => ({ ...s, rank: MIDCAP_STOCKS.length + i + 1, data: stockData[s.sym] || null })),
    ...ETF_ASSETS.map((s, i) => ({ ...s, rank: MIDCAP_STOCKS.length + STOCK_ASSETS.length + i + 1, data: stockData[s.sym] || null, cap: 'etf' })),
  ];
  
  const candidates = universe
    .map(row => {
      const t = intradayData[row.sym];
      const score = t ? adjustedTradeScore(row) : -999;
      const signal = adjustedTradeSignal(score);
      const guard = t ? getRiskGuard(row, t, score) : null;
      const side = signal === 'sell' ? 'sell' : signal === 'buy' ? 'buy' : null;
      const candidate = buildSimulationEngineCandidate(row, t, score, side, guard, cost);
      candidate.row = row;
      candidate.t = t;
      candidate.signal = signal;
      candidate.side = side;
      candidate.guard = guard;
      candidate.previousCandidate = simulationPreviousSignalCandidates.get(row.sym) || null;
      candidate.derivedSetupType = t ? getSetupType(row, t, guard) : 'NO_SIGNAL';
      return candidate;
    })
    .filter(candidate => candidate.t);
  
  return SimulationEngine.selectSimulationEntryCandidates(
    candidates,
    Date.now(),
    getSimulationEngineSettings(),
    {
      openSymbols: new Set(paperTrades.filter(isOpenTrade).map(t => t.symbol)),
      entryBlockReason: (sym, setupType) => getSimulationEntryBlockReason(sym, setupType),
      market: { indices: indexData },
    }
  );
}
```

---

## 2. Server-Side Trade Creation (Primary)

### Trade Creation Entry Point
**File**: [ticker_proxy.js](ticker_proxy.js#L4805)
**Endpoint**: `POST /paper-trades` with action `'open'`

When a client sends a POST request to create a new trade, this is where the trade object is constructed:

**Lines 4805-4900** (key section):
```javascript
if (req.method === 'POST') {
  try {
    const payload = await readJsonBody(req);
    const action = String(payload.action || '').toLowerCase();
    const state = loadPaperStateFile();
    const trades = state.trades;

    if (action === 'open') {
      const symbol = String(payload.symbol || '').trim().toUpperCase();
      const side = String(payload.side || 'buy').toLowerCase();
      const qty = Number(payload.qty);
      const entryPrice = Number(payload.entryPrice);
      
      if (!symbol || !['buy', 'sell'].includes(side) || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'symbol, side, qty and entryPrice are required' }));
        return;
      }
      
      // Check for duplicate open trade on same symbol
      const existing = trades.find(t => t.symbol === symbol && t.status === 'open');
      if (existing) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Open paper trade already exists for this symbol', trade: existing }));
        return;
      }
      
      // Build broker dry-run order if applicable
      const brokerMode = String(payload.brokerMode || payload.executionMode || '').toLowerCase();
      const dryRunEntryOrder = brokerMode === 'zerodha_dry_run'
        ? buildZerodhaDryRunOrder({ ...payload, symbol, side, qty, entryPrice, assetType: payload.assetType === 'etf' ? 'etf' : 'stock' }, null, 'entry')
        : null;
      
      // ═════════════════════════════════════════════════════════════════
      // TRADE OBJECT CREATION - THIS IS WHERE TRADES ARE CREATED
      // ═════════════════════════════════════════════════════════════════
      const trade = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'open',
        symbol,
        name: String(payload.name || symbol),
        side,
        qty: Math.floor(qty),
        entryPrice: +entryPrice.toFixed(2),
        target: Number.isFinite(Number(payload.target)) ? +Number(payload.target).toFixed(2) : null,
        stop: Number.isFinite(Number(payload.stop)) ? +Number(payload.stop).toFixed(2) : null,
        signal: payload.signal || null,
        score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
        rr: Number.isFinite(Number(payload.rr)) ? Number(payload.rr) : null,
        reservedCapital: Number.isFinite(Number(payload.reservedCapital)) ? +Number(payload.reservedCapital).toFixed(2) : +(entryPrice * Math.floor(qty)).toFixed(2),
        portfolioInitial: Number.isFinite(Number(payload.portfolioInitial)) ? +Number(payload.portfolioInitial).toFixed(2) : null,
        source: payload.source === 'simulation' ? 'simulation' : 'manual',
        assetType: payload.assetType === 'etf' ? 'etf' : 'stock',
        setupType: payload.setupType || null,
        setup: payload.setup || null,
        entryContext: payload.entryContext && typeof payload.entryContext === 'object' ? payload.entryContext : null,
        notes: payload.notes || '',
        openedAt: new Date().toISOString(),  // ✓ TIMESTAMP ASSIGNED HERE
      };
      
      // Add broker audit trail if using Zerodha dry-run
      if (dryRunEntryOrder) {
        trade.broker = {
          name: 'zerodha',
          mode: 'dry-run',
          status: 'entry_dry_run',
          entryOrder: dryRunEntryOrder,
          exitPlan: {
            target: trade.target,
            stop: trade.stop,
            squareOff: 'intraday dashboard managed exit',
          },
          audit: [{ at: trade.openedAt, event: 'entry_dry_run_created', order: dryRunEntryOrder }],
        };
      }
      
      // Add trade to beginning of trades array
      trades.unshift(trade);
      savePaperTradesFile(trades);
      broadcastPaperTradeState('open');
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trade }));
      return;
    }
```

### Key Points on Server-Side Creation:
- **ID Generation**: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` - timestamp + random string
- **Status**: Always `'open'` on creation (never created as closed)
- **openedAt**: **ALWAYS assigned** using `new Date().toISOString()` at creation
- **closedAt**: **NEVER assigned** at creation time - only added when the trade is closed (see Trade Closing section below)
- **Source**: Either `'simulation'` or `'manual'` depending on payload
- **All numeric fields**: Rounded/coerced to specific precision (typically 2 decimal places)

---

## 3. Trade Closing (Where closedAt is Assigned)

### Server-Side Close
**File**: [ticker_proxy.js](ticker_proxy.js#L4900-4950)
**When**: Trade status changes from `'open'` to `'closed'`

```javascript
if (action === 'close') {
  const id = String(payload.id || '');
  const exitPrice = Number(payload.exitPrice);
  const trade = trades.find(t => t.id === id && t.status === 'open');
  
  if (!trade || !Number.isFinite(exitPrice) || exitPrice <= 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Open trade id and exitPrice are required' }));
    return;
  }
  
  const pnl = computePaperTradePnl(trade, exitPrice);
  const closedAt = new Date().toISOString();  // ✓ TIMESTAMP ASSIGNED HERE
  
  Object.assign(trade, {
    status: 'closed',
    exitPrice: +exitPrice.toFixed(2),
    closedAt,  // ✓ NOW closedAt IS ASSIGNED
    closeReason: payload.reason || 'Manual exit',
    pnl: pnl.pnl,
    pnlPct: pnl.pnlPct,
    grossPnl: pnl.grossPnl,
    charges: pnl.charges,
    chargeBreakup: pnl.chargeBreakup,
  });
  
  if (trade.broker?.name === 'zerodha' && trade.broker?.mode === 'dry-run') {
    const exitOrder = buildZerodhaDryRunOrder({ ...trade, exitPrice }, trade, 'exit');
    trade.broker.status = 'exit_dry_run';
    trade.broker.exitOrder = exitOrder;
    trade.broker.audit = Array.isArray(trade.broker.audit) ? trade.broker.audit : [];
    trade.broker.audit.push({ at: closedAt, event: 'exit_dry_run_created', reason: trade.closeReason, order: exitOrder });
  }
  
  savePaperTradesFile(trades);
  broadcastPaperTradeState('close');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, trade }));
  return;
}
```

---

## 4. Backtest Simulation (Replay)

### Backtest Trade Creation
**File**: [backtest_simulation.js](backtest_simulation.js#L400-450)
**Function**: `runBacktest(snapshots, settings)`

In backtest mode, trades are created from simulation snapshots. The flow is similar to live simulation but uses historical data:

**Lines 430-450** (trade creation in loop):
```javascript
// For each snapshot in historical data
for (const snapshot of snapshots) {
  // Update candidates from snapshot
  currentBySymbol = new Map();
  for (const candidate of snapshot.candidates || []) {
    candidate.previousCandidate = previousCandidateBySymbol.get(candidate.symbol) || null;
    candidate.derivedSetupType = SimulationEngine.deriveSetupType(candidate, settings);
    currentBySymbol.set(candidate.symbol, candidate);
    lastKnownBySymbol.set(candidate.symbol, candidate);
    previousCandidateBySymbol.set(candidate.symbol, SimulationEngine.toConfirmationCandidate(candidate));
  }
  
  // Process exits for open trades at this snapshot's price
  for (const trade of simOpenTrades().slice()) {
    const candidate = currentBySymbol.get(trade.symbol) || lastKnownBySymbol.get(trade.symbol);
    const price = Number(candidate?.price ?? candidate?.priceAtSnapshot ?? candidate?.quote?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    
    const exit = SimulationEngine.getSimulationExit(trade, price, candidate, snapshot.at, settings, { isEodSettlement: isEodSettlement(snapshot.at) });
    if (exit?.action === 'partial') {
      const qty = Math.max(1, Math.floor(Number(trade.qty || 0) * Number(exit.qtyPct || 50) / 100));
      partialCloseTrade(trade, exit.exitPrice, exit.reason, snapshot.at, qty, exit.runner);
    } else if (exit) {
      closeTrade(trade, exit.exitPrice, exit.reason, snapshot.at);
    }
  }
  
  // Skip if outside entry window
  if (!isEntryWindow(snapshot.at) || isEodSettlement(snapshot.at)) continue;
  
  // Calculate available slots
  let slots = Math.max(0, Math.min(
    settings.SIMULATION_MAX_OPEN - openTrades().length,
    settings.SIMULATION_MAX_ACTIVE_OPEN - simOpenTrades().length,
  ));
  if (slots <= 0 || cashAvailable() <= 0) continue;
  
  // Select entry candidates
  const candidates = SimulationEngine.selectSimulationEntryCandidates(
    snapshot.candidates || [],
    snapshot.at,
    settings,
    {
      openSymbols: new Set(openTrades().map(t => t.symbol)),
      entryBlockReason: (symbol, setupType) => entryBlockReason(symbol, setupType, snapshot.at),
      market: snapshot.market,
    }
  );
  
  let openedThisCycle = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (slots <= 0 || openedThisCycle >= settings.SIMULATION_MAX_NEW_PER_CYCLE) break;
    const candidate = candidates[i];
    const setupType = candidate.derivedSetupType || candidate.setupType || '';
    const block = entryBlockReason(candidate.symbol, setupType, snapshot.at);
    if (block) {
      if (/daily/i.test(block)) break;
      continue;
    }
    
    const price = Number(candidate.price ?? candidate.priceAtSnapshot ?? candidate.quote?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    
    const remainingCandidates = Math.max(1, candidates.length - i);
    const remainingSlots = Math.max(1, Math.min(slots, remainingCandidates));
    const allocation = Math.min(settings.MAX_POSITION_EXPOSURE, cashAvailable() / remainingSlots);
    const side = candidate.side || candidate.signal || 'buy';
    const suggestion = SimulationEngine.getSuggestedQty(candidate, side, price, cashAvailable(), allocation, settings);
    if (suggestion.qty <= 0) continue;
    
    // ═════════════════════════════════════════════════════════════════
    // BACKTEST TRADE CREATION
    // ═════════════════════════════════════════════════════════════════
    trades.push({
      id: nextId++,
      symbol: candidate.symbol,
      name: candidate.name || candidate.symbol,
      side,
      qty: suggestion.qty,
      entryPrice: round2(price),
      target: suggestion.plan.target,
      stop: suggestion.plan.stop,
      signal: side,
      score: Math.abs(Number(candidate.score) || 0),
      rr: candidate.indicators?.rr,
      source: 'simulation',
      assetType: 'stock',
      reservedCapital: round2(suggestion.qty * price),
      setupType,
      setup: ['Simulation', setupType, candidate.indicators?.entryStatus, candidate.indicators?.entryTrigger]
        .filter(Boolean).join(' | '),
      entryContext: {
        selectedRank: i + 1,
        score: Number(candidate.score) || 0,
        side,
        setupType,
        reason: `selected rank ${i + 1}`,
        blockReason: candidate.blockReason || '',
        decision: candidate.decision || null,
        indicators: {
          entryStatus: candidate.indicators?.entryStatus || '',
          entryTrigger: candidate.indicators?.entryTrigger || '',
          vwap: candidate.indicators?.vwap ?? null,
          vwapBandPosition: candidate.indicators?.vwapBandPosition ?? null,
          ema9: candidate.indicators?.ema9 ?? candidate.indicators?.emaShort ?? null,
          ema20: candidate.indicators?.ema20 ?? candidate.indicators?.emaLong ?? null,
          rsi: candidate.indicators?.rsi ?? null,
          superTrendDirection: candidate.indicators?.superTrendDirection ?? null,
          relVolume: candidate.indicators?.relVolumeTimeAdjusted ?? candidate.indicators?.relVolume ?? null,
        },
      },
      openedAt: snapshot.at,  // ✓ TIMESTAMP FROM SNAPSHOT
      status: 'open',
    });
    
    slots -= 1;
    openedThisCycle += 1;
  }
}
```

### Backtest Trade Closing
**File**: [backtest_simulation.js](backtest_simulation.js#L330-350)
**Function**: `closeTrade(trade, exitPrice, reason, at, mark = false)`

```javascript
function closeTrade(trade, exitPrice, reason, at, mark = false) {
  const pnl = SimulationEngine.getPaperTradePnl(trade, exitPrice);
  Object.assign(trade, {
    status: 'closed',
    exitPrice: round2(exitPrice),
    closedAt: at,  // ✓ TIMESTAMP FROM SNAPSHOT
    closeReason: reason,
    pnl: pnl.pnl,
    grossPnl: pnl.grossPnl,
    charges: pnl.charges,
    pnlPct: pnl.pnlPct,
    mark,
  });
}
```

---

## 5. Dashboard-side Replay Simulation

**File**: [dashboard-app.js](dashboard-app.js#L3650-3850)

Similar to backtest but executed on the client side with live data. Trade creation follows the same pattern:

```javascript
// In replay simulation function
trades.push({
  id: nextId++,
  symbol: candidate.symbol,
  name: candidate.name || candidate.symbol,
  side,
  qty: suggestion.qty,
  entryPrice: +price.toFixed(2),
  target: suggestion.plan.target,
  stop: suggestion.plan.stop,
  signal: side,
  score: Math.abs(Number(candidate.score) || 0),
  source: 'simulation',
  assetType: 'stock',
  reservedCapital: +(suggestion.qty * price).toFixed(2),
  setupType,
  setup: ['Replay', setupType, candidate.indicators?.entryStatus, candidate.indicators?.entryTrigger].filter(Boolean).join(' | '),
  entryContext: { reason: `selected rank ${i + 1}`, selectedRank: i + 1 },
  openedAt: snapshot.at,  // ✓ TIMESTAMP FROM SNAPSHOT
  status: 'open',
});
```

---

## Trade Properties Summary

### Properties Assigned at Creation:
- ✓ `id` - unique identifier
- ✓ `symbol` - stock/etf symbol
- ✓ `name` - display name
- ✓ `side` - 'buy' or 'sell'
- ✓ `qty` - quantity
- ✓ `entryPrice` - entry price
- ✓ `target` - target price (optional)
- ✓ `stop` - stop loss price (optional)
- ✓ `signal` - the signal that triggered entry
- ✓ `score` - trade score/strength
- ✓ `rr` - risk/reward ratio (optional)
- ✓ `source` - 'simulation' or 'manual'
- ✓ `assetType` - 'stock' or 'etf'
- ✓ `reservedCapital` - capital allocated
- ✓ `setupType` - entry setup type
- ✓ `setup` - entry setup description
- ✓ `entryContext` - entry context details
- ✓ `status` - always `'open'` at creation
- ✓ `openedAt` - **ALWAYS ASSIGNED** at creation

### Properties NOT Assigned at Creation:
- ✗ `closedAt` - only assigned when trade closes
- ✗ `exitPrice` - only assigned when trade closes
- ✗ `closeReason` - only assigned when trade closes
- ✗ `pnl` - only assigned when trade closes
- ✗ `pnlPct` - only assigned when trade closes
- ✗ `grossPnl` - only assigned when trade closes
- ✗ `charges` - only assigned when trade closes

---

## Critical Finding

**There are NO cases where trades are created without timestamps on the server side.**

Every trade creation path (live simulation, backtest, replay, manual) assigns `openedAt` at the time of creation using:
1. `new Date().toISOString()` on the server (for live trades)
2. `snapshot.at` from the snapshot timestamp (for backtests/replays)

The `closedAt` timestamp is deliberately omitted at creation and only assigned when the trade is closed via the `/paper-trades` endpoint with action `'close'`.

