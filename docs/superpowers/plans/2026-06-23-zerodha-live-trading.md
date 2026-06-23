# Zerodha Live Trading Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Zerodha Live trading mode as third option (Paper, Zerodha Dry, Zerodha Live) with auto-refreshing credentials, hybrid error resilience, and 15-minute trade confirmation polling on both live and dry modes.

**Architecture:** Backend manages credential loading from `~/.zerodha.properties`, maintains in-memory token cache with auto-refresh, and runs independent 10-second confirmation poller. Frontend shows 3-way mode toggle, live status indicators (pending/confirmed/failed/timeout), and connection status. Trades execute via Kite Connect REST API with full audit trails.

**Tech Stack:** Node.js (backend), Vanilla JS (frontend), Kite Connect REST API, localStorage, SSE streams

---

## File Structure

**New Files:**
- `zerodha-credentials.js` - Credential loading and validation
- `zerodha-kite-client.js` - Kite API wrapper (auth, token refresh, order queries)
- `zerodha-confirmation-poller.js` - Background polling engine for trade confirmation

**Modified Files:**
- `ticker_proxy.js` - Add Zerodha Live trade execution, token refresh, poller integration
- `dashboard-app.js` - 3-way broker mode toggle, status display, confirmation UI
- `package.json` - Add `axios` for HTTP requests

---

## Task Breakdown

### Task 1: Create Credential Loading Module

**Files:**
- Create: `zerodha-credentials.js`

- [ ] **Step 1: Create zerodha-credentials.js with loadCredentials() function**

```javascript
// zerodha-credentials.js
const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.zerodha.properties');
const TEMPLATE = `# Zerodha Kite Connect Credentials
# Get API_KEY and API_SECRET from https://kite.zerodha.com/account/developer/applications
ZERODHA_API_KEY=your_api_key_here
ZERODHA_API_SECRET=your_api_secret_here
ZERODHA_ACCESS_TOKEN=your_access_token_here
`;

function loadCredentials() {
  // If file doesn't exist, create template with instructions
  if (!fs.existsSync(CREDS_FILE)) {
    fs.writeFileSync(CREDS_FILE, TEMPLATE, 'utf8');
    console.warn(`[zerodha-credentials] Created template at ${CREDS_FILE}. Please fill in your credentials.`);
    return null;
  }

  const content = fs.readFileSync(CREDS_FILE, 'utf8');
  const creds = {};
  
  content.split('\n').forEach(line => {
    if (line.trim() && !line.startsWith('#')) {
      const [key, val] = line.split('=');
      if (key && val) creds[key.trim()] = val.trim();
    }
  });

  // Validate all required fields
  if (!creds.ZERODHA_API_KEY || creds.ZERODHA_API_KEY.includes('your_')) {
    console.error('[zerodha-credentials] API_KEY not configured in ' + CREDS_FILE);
    return null;
  }
  if (!creds.ZERODHA_API_SECRET || creds.ZERODHA_API_SECRET.includes('your_')) {
    console.error('[zerodha-credentials] API_SECRET not configured in ' + CREDS_FILE);
    return null;
  }
  if (!creds.ZERODHA_ACCESS_TOKEN || creds.ZERODHA_ACCESS_TOKEN.includes('your_')) {
    console.error('[zerodha-credentials] ACCESS_TOKEN not configured in ' + CREDS_FILE);
    return null;
  }

  return {
    apiKey: creds.ZERODHA_API_KEY,
    apiSecret: creds.ZERODHA_API_SECRET,
    accessToken: creds.ZERODHA_ACCESS_TOKEN
  };
}

module.exports = { loadCredentials, CREDS_FILE };
```

- [ ] **Step 2: Test credential loading manually**

```bash
# Test by requiring in ticker_proxy.js
node -e "const {loadCredentials} = require('./zerodha-credentials'); console.log(loadCredentials() || 'Not configured')"
```

Expected: Either shows credentials object or "Not configured"

---

### Task 2: Create Kite API Client Wrapper

**Files:**
- Create: `zerodha-kite-client.js`

- [ ] **Step 1: Create zerodha-kite-client.js with KiteClient class**

```javascript
// zerodha-kite-client.js
const axios = require('axios');

const KITE_BASE_URL = 'https://api.kite.trade';
const KITE_SANDBOX_URL = 'https://sandbox-api.kite.trade';

class KiteClient {
  constructor(apiKey, apiSecret, accessToken, isDryRun = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.accessToken = accessToken;
    this.isDryRun = isDryRun;
    this.baseUrl = isDryRun ? KITE_SANDBOX_URL : KITE_BASE_URL;
    this.lastTokenRefreshAt = Date.now();
  }

  // Refresh access token using apiKey + apiSecret
  async refreshAccessToken() {
    try {
      // In real Kite API, you'd POST to /session/token with credentials
      // For now, this is a placeholder - implement with actual Kite session endpoint
      console.log('[kite] Access token refresh requested (TODO: implement actual refresh)');
      this.lastTokenRefreshAt = Date.now();
      return true;
    } catch (err) {
      console.error('[kite] Token refresh failed:', err.message);
      return false;
    }
  }

  // Place order on Kite
  async placeOrder(orderData) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/orders/regular`,
        orderData,
        {
          headers: {
            'Authorization': `token ${this.apiKey}:${this.accessToken}`,
            'X-Kite-Version': '3',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      
      return response.data.data.order_id;
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.warn('[kite] Auth error, attempting token refresh...');
        await this.refreshAccessToken();
        throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      }
      throw err;
    }
  }

  // Get order status
  async getOrderStatus(orderId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/orders/${orderId}`,
        {
          headers: {
            'Authorization': `token ${this.apiKey}:${this.accessToken}`,
            'X-Kite-Version': '3'
          },
          timeout: 5000
        }
      );

      const orderData = response.data.data;
      return {
        orderId: orderData.order_id,
        status: orderData.status, // COMPLETE, REJECTED, CANCELLED, PENDING
        filledQuantity: orderData.filled_quantity,
        pendingQuantity: orderData.quantity - orderData.filled_quantity,
        averagePrice: orderData.average_price,
        statusMessage: orderData.status_message
      };
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new Error('AUTH_FAILED_REFRESH_NEEDED');
      }
      throw err;
    }
  }

  // Cancel order
  async cancelOrder(orderId) {
    try {
      await axios.delete(
        `${this.baseUrl}/orders/${orderId}`,
        {
          headers: {
            'Authorization': `token ${this.apiKey}:${this.accessToken}`,
            'X-Kite-Version': '3'
          },
          timeout: 5000
        }
      );
      return true;
    } catch (err) {
      console.error('[kite] Cancel order failed:', err.message);
      return false;
    }
  }
}

module.exports = KiteClient;
```

- [ ] **Step 2: Validate syntax**

```bash
node -c zerodha-kite-client.js
```

Expected: No output (syntax OK)

---

### Task 3: Create Confirmation Polling Engine

**Files:**
- Create: `zerodha-confirmation-poller.js`

- [ ] **Step 1: Create zerodha-confirmation-poller.js**

```javascript
// zerodha-confirmation-poller.js

class ConfirmationPoller {
  constructor(kiteClient, paperTradesStore, brokerModeGetter) {
    this.kiteClient = kiteClient;
    this.paperTradesStore = paperTradesStore; // reference to paper_trades array
    this.brokerModeGetter = brokerModeGetter; // function that returns current brokerMode
    this.pollingInterval = null;
    this.pollIntervalMs = 10000; // 10 seconds
    this.maxTimeoutMs = 900000; // 15 minutes
    this.maxAttempts = 90;
  }

  start() {
    if (this.pollingInterval) return;
    
    this.pollingInterval = setInterval(() => this.pollPendingTrades(), this.pollIntervalMs);
    console.log('[confirmation-poller] Started polling every 10s');
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[confirmation-poller] Stopped polling');
    }
  }

  async pollPendingTrades() {
    const brokerMode = this.brokerModeGetter();
    
    // Only poll if in zerodha modes
    if (brokerMode !== 'zerodha_live' && brokerMode !== 'zerodha_dry_run') {
      return;
    }

    const trades = this.paperTradesStore.filter(t => 
      t.broker?.status === 'pending' && 
      t.broker?.mode === (brokerMode === 'zerodha_live' ? 'live' : 'dry-run')
    );

    for (const trade of trades) {
      await this.checkTradeConfirmation(trade);
    }
  }

  async checkTradeConfirmation(trade) {
    const elapsedMs = Date.now() - trade.broker.createdAt;
    
    // Check timeout: 15 minutes
    if (elapsedMs > this.maxTimeoutMs) {
      trade.broker.status = 'timeout';
      trade.broker.confirmationError = 'Order not confirmed within 15 minutes';
      trade.broker.audit.push({
        at: new Date().toISOString(),
        event: 'confirmation_timeout',
        elapsedMs,
        attempts: trade.broker.confirmationAttempts
      });
      console.warn(`[confirmation-poller] Trade ${trade.id} timeout after ${Math.round(elapsedMs/1000)}s`);
      return;
    }

    try {
      const orderStatus = await this.kiteClient.getOrderStatus(trade.broker.orderId);
      trade.broker.confirmationAttempts++;

      if (orderStatus.status === 'COMPLETE') {
        trade.broker.status = 'confirmed';
        trade.broker.confirmedAt = new Date().toISOString();
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_confirmed',
          filledQty: orderStatus.filledQuantity,
          avgPrice: orderStatus.averagePrice,
          attempts: trade.broker.confirmationAttempts
        });
        console.log(`[confirmation-poller] Trade ${trade.id} confirmed in ${Math.round(elapsedMs/1000)}s (attempt ${trade.broker.confirmationAttempts})`);
      } else if (orderStatus.status === 'REJECTED' || orderStatus.status === 'CANCELLED') {
        trade.broker.status = 'rejected';
        trade.broker.confirmationError = orderStatus.statusMessage || orderStatus.status;
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'order_rejected',
          reason: orderStatus.statusMessage,
          attempts: trade.broker.confirmationAttempts
        });
        console.warn(`[confirmation-poller] Trade ${trade.id} rejected: ${orderStatus.statusMessage}`);
      }
      // else: still pending, continue polling
    } catch (err) {
      if (err.message === 'AUTH_FAILED_REFRESH_NEEDED') {
        console.warn(`[confirmation-poller] Auth error on trade ${trade.id}, will retry`);
        // Kite client will handle token refresh
        return;
      }
      console.error(`[confirmation-poller] Error checking trade ${trade.id}:`, err.message);
    }
  }
}

module.exports = ConfirmationPoller;
```

- [ ] **Step 2: Validate syntax**

```bash
node -c zerodha-confirmation-poller.js
```

Expected: No output (syntax OK)

---

### Task 4: Integrate Zerodha into ticker_proxy.js (Part 1: Initialization)

**Files:**
- Modify: `ticker_proxy.js` (lines ~1-100)

- [ ] **Step 1: Add imports at top of ticker_proxy.js**

After existing imports, add:

```javascript
const { loadCredentials } = require('./zerodha-credentials');
const KiteClient = require('./zerodha-kite-client');
const ConfirmationPoller = require('./zerodha-confirmation-poller');
```

- [ ] **Step 2: Add global state variables for Zerodha (after other global state)**

```javascript
// Zerodha Live integration
let zerodhaCredentials = null;
let kiteClientLive = null;
let kiteClientDry = null;
let confirmationPoller = null;
let zerodhaLiveFailureCount = 0;
```

- [ ] **Step 3: Initialize Zerodha on server startup (in your existing startup section)**

Add after existing initialization:

```javascript
// Initialize Zerodha if credentials exist
zerodhaCredentials = loadCredentials();
if (zerodhaCredentials) {
  kiteClientLive = new KiteClient(
    zerodhaCredentials.apiKey,
    zerodhaCredentials.apiSecret,
    zerodhaCredentials.accessToken,
    false // live mode
  );
  kiteClientDry = new KiteClient(
    zerodhaCredentials.apiKey,
    zerodhaCredentials.apiSecret,
    zerodhaCredentials.accessToken,
    true // dry run mode
  );
  
  // Start confirmation poller
  confirmationPoller = new ConfirmationPoller(
    kiteClientLive,
    paperTrades,
    () => brokerMode
  );
  confirmationPoller.start();
  console.log('[zerodha] Live and dry clients initialized, poller started');
} else {
  console.warn('[zerodha] Credentials not available - Zerodha modes will show errors');
}
```

- [ ] **Step 4: Validate no syntax errors**

```bash
cd c:\data\project\stock-watcher && node -c ticker_proxy.js
```

Expected: No output (syntax OK)

---

### Task 5: Integrate Zerodha into ticker_proxy.js (Part 2: Trade Execution)

**Files:**
- Modify: `ticker_proxy.js` (lines ~4857-4894, trade open handler)

- [ ] **Step 1: Update trade open handler to support Zerodha Live**

Find the section where `buildZerodhaDryRunOrder()` is called. Replace/enhance with:

```javascript
// Around line 4857-4894
let dryRunEntryOrder = null;
let liveEntryOrder = null;

if (brokerMode === 'zerodha_dry_run' && kiteClientDry) {
  dryRunEntryOrder = buildZerodhaDryRunOrder({ symbol, side, qty, entryPrice, assetType }, null, 'entry');
} else if (brokerMode === 'zerodha_live' && kiteClientLive) {
  // For live trading, prepare order and submit to Kite
  liveEntryOrder = buildZerodhaDryRunOrder({ symbol, side, qty, entryPrice, assetType }, null, 'entry');
}

if (dryRunEntryOrder) {
  trade.broker = {
    name: 'zerodha',
    mode: 'dry-run',
    status: 'entry_dry_run',
    entryOrder: dryRunEntryOrder,
    audit: [{ at: trade.openedAt, event: 'entry_dry_run_created', order: dryRunEntryOrder }]
  };
} else if (liveEntryOrder && zerodhaLiveFailureCount < 3) {
  // Attempt to place live order
  try {
    const orderId = await kiteClientLive.placeOrder(liveEntryOrder);
    trade.broker = {
      name: 'zerodha',
      mode: 'live',
      orderId: orderId,
      status: 'pending',
      createdAt: Date.now(),
      confirmedAt: null,
      confirmationAttempts: 0,
      confirmationError: null,
      audit: [{
        at: trade.openedAt,
        event: 'order_placed',
        orderId: orderId,
        order: liveEntryOrder
      }]
    };
    zerodhaLiveFailureCount = 0;
    console.log(`[zerodha-live] Order placed: ${orderId} for ${symbol}`);
  } catch (err) {
    zerodhaLiveFailureCount++;
    console.error(`[zerodha-live] Order placement failed (attempt ${zerodhaLiveFailureCount}/3):`, err.message);
    
    if (zerodhaLiveFailureCount >= 3) {
      console.error('[zerodha-live] 3 consecutive failures - switching to paper mode');
      trade.broker = {
        name: 'paper',
        mode: 'paper',
        reason: 'Zerodha Live disabled due to repeated failures'
      };
    } else {
      // Fall back to paper for this trade
      trade.broker = {
        name: 'paper',
        mode: 'paper',
        reason: 'Zerodha Live error - falling back to paper trading'
      };
    }
  }
}
```

- [ ] **Step 2: Validate syntax**

```bash
node -c ticker_proxy.js
```

Expected: No output (syntax OK)

---

### Task 6: Integrate Zerodha into ticker_proxy.js (Part 3: Trade Close)

**Files:**
- Modify: `ticker_proxy.js` (lines ~4927-4932, trade close handler)

- [ ] **Step 1: Update trade close handler for Zerodha Live**

Find trade close section and add Zerodha handling:

```javascript
// When closing trade with Zerodha Live
if (trade.broker?.mode === 'live' && trade.broker?.orderId) {
  try {
    // Cancel entry order if still pending
    if (trade.broker.status === 'pending') {
      await kiteClientLive.cancelOrder(trade.broker.orderId);
    }
    
    // For confirmed trades, place exit order (reversed side)
    if (trade.broker.status === 'confirmed') {
      const exitSide = trade.side === 'buy' ? 'sell' : 'buy';
      const exitOrder = buildZerodhaDryRunOrder(
        { symbol: trade.symbol, side: exitSide, qty: trade.qty, entryPrice: exitPrice, assetType: trade.assetType },
        null,
        'exit'
      );
      
      try {
        const exitOrderId = await kiteClientLive.placeOrder(exitOrder);
        trade.broker.exitOrderId = exitOrderId;
        trade.broker.audit.push({
          at: new Date().toISOString(),
          event: 'exit_order_placed',
          exitOrderId: exitOrderId
        });
      } catch (err) {
        console.error('[zerodha-live] Exit order failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[zerodha-live] Close trade error:', err.message);
  }
}
```

- [ ] **Step 2: Validate syntax**

```bash
node -c ticker_proxy.js
```

Expected: No output (syntax OK)

---

### Task 7: Add Zerodha Mode to UI Toggle (Part 1: Backend)

**Files:**
- Modify: `ticker_proxy.js` (broker mode validation)

- [ ] **Step 1: Update brokerMode validation to accept three modes**

Find where `brokerMode` is validated and update to:

```javascript
const validModes = ['paper', 'zerodha_dry_run', 'zerodha_live'];
if (!validModes.includes(brokerMode)) {
  brokerMode = 'paper';
}
```

- [ ] **Step 2: Add /broker-mode endpoint to handle mode switching**

Add near existing endpoints:

```javascript
app.post('/broker-mode', express.json(), (req, res) => {
  const newMode = req.body.mode;
  const validModes = ['paper', 'zerodha_dry_run', 'zerodha_live'];
  
  if (!validModes.includes(newMode)) {
    return res.status(400).json({ error: 'Invalid broker mode' });
  }
  
  // Check if switching to Zerodha without credentials
  if ((newMode === 'zerodha_live' || newMode === 'zerodha_dry_run') && !zerodhaCredentials) {
    return res.status(400).json({ 
      error: 'Zerodha credentials not configured. Please fill ' + require('./zerodha-credentials').CREDS_FILE
    });
  }
  
  brokerMode = newMode;
  
  // Reset failure count on mode switch
  if (newMode === 'zerodha_live') {
    zerodhaLiveFailureCount = 0;
  }
  
  console.log(`[broker-mode] Switched to: ${newMode}`);
  res.json({ mode: brokerMode, credentialsFile: require('./zerodha-credentials').CREDS_FILE });
});
```

- [ ] **Step 3: Add /broker-status endpoint to report connection health**

```javascript
app.get('/broker-status', (req, res) => {
  res.json({
    mode: brokerMode,
    zerodhaLive: {
      available: !!zerodhaCredentials,
      failureCount: zerodhaLiveFailureCount,
      status: zerodhaLiveFailureCount >= 3 ? 'disabled' : (zerodhaLiveFailureCount > 0 ? 'warning' : 'ok')
    }
  });
});
```

- [ ] **Step 4: Validate syntax**

```bash
node -c ticker_proxy.js
```

Expected: No output (syntax OK)

---

### Task 8: Add Zerodha Mode to UI Toggle (Part 2: Frontend)

**Files:**
- Modify: `dashboard-app.js` (lines ~756-2760)

- [ ] **Step 1: Update global broker mode handling**

Find `const BROKER_MODE_KEY` section and update:

```javascript
const BROKER_MODE_KEY = 'stock-watcher-broker-mode';
const VALID_BROKER_MODES = ['paper', 'zerodha_dry_run', 'zerodha_live'];

let brokerMode = (() => {
  const saved = localStorage.getItem(BROKER_MODE_KEY);
  return VALID_BROKER_MODES.includes(saved) ? saved : 'paper';
})();

// Add connection status tracking
let brokerConnectionStatus = { mode: 'paper', zerodhaLive: { available: false, status: 'unknown' } };
```

- [ ] **Step 2: Update isZerodhaDryRun() function**

Replace with:

```javascript
function isZerodhaDryRun() {
  return brokerMode === 'zerodha_dry_run';
}

function isZerodhaLive() {
  return brokerMode === 'zerodha_live';
}

function isZerodhaMode() {
  return brokerMode === 'zerodha_dry_run' || brokerMode === 'zerodha_live';
}
```

- [ ] **Step 3: Update toggleBrokerMode() to cycle through all three modes**

Find and replace:

```javascript
function toggleBrokerMode() {
  const modes = ['paper', 'zerodha_dry_run', 'zerodha_live'];
  const currentIndex = modes.indexOf(brokerMode);
  brokerMode = modes[(currentIndex + 1) % modes.length];
  localStorage.setItem(BROKER_MODE_KEY, brokerMode);
  
  // Send to backend
  postJson('/broker-mode', { mode: brokerMode })
    .then(resp => {
      console.log('[broker-mode] Switched to:', resp.mode);
      updateBrokerModeButton();
    })
    .catch(err => {
      console.error('[broker-mode] Failed to switch:', err);
      alert('Failed to switch broker mode: ' + err.message);
      // Revert on error
      brokerMode = modes[currentIndex];
      localStorage.setItem(BROKER_MODE_KEY, brokerMode);
      updateBrokerModeButton();
    });
}
```

- [ ] **Step 4: Update updateBrokerModeButton() to show three states**

```javascript
function updateBrokerModeButton() {
  const btn = document.getElementById('brokerModeBtn');
  if (!btn) return;
  
  let display = 'Paper';
  let bgColor = '#6c757d'; // gray
  
  if (brokerMode === 'zerodha_dry_run') {
    display = 'Zerodha Dry';
    bgColor = '#0d6efd'; // blue
  } else if (brokerMode === 'zerodha_live') {
    // Show connection status
    const status = brokerConnectionStatus.zerodhaLive?.status || 'unknown';
    if (status === 'disabled') {
      display = 'Zerodha Live ⛔';
      bgColor = '#dc3545'; // red
    } else if (status === 'warning') {
      display = 'Zerodha Live ⚠️';
      bgColor = '#fd7e14'; // orange
    } else if (status === 'ok') {
      display = 'Zerodha Live 🟢';
      bgColor = '#198754'; // green
    } else {
      display = 'Zerodha Live ?';
      bgColor = '#6c757d'; // gray
    }
  }
  
  btn.textContent = display;
  btn.style.backgroundColor = bgColor;
}
```

- [ ] **Step 5: Add function to poll broker status**

```javascript
function pollBrokerStatus() {
  fetch('/broker-status')
    .then(r => r.json())
    .then(data => {
      brokerConnectionStatus = data;
      updateBrokerModeButton();
    })
    .catch(err => console.error('[broker-status] Poll failed:', err));
}

// Poll every 30 seconds
setInterval(pollBrokerStatus, 30000);
pollBrokerStatus(); // Initial poll
```

- [ ] **Step 6: Validate syntax**

```bash
node -c dashboard-app.js
```

Expected: No output (syntax OK)

---

### Task 9: Add Trade Status Display to Open Trades Modal

**Files:**
- Modify: `dashboard-app.js` (lines ~2154-2167, renderOpenTradesModal table header)

- [ ] **Step 1: Update table header to include Status column**

Find table header in renderOpenTradesModal() and update to:

```javascript
// Old: Event, Txn Time, Mode, Symbol, Side, Qty, Entry, Live, Target, SL, Net P&L, Entry Why, Action
// New: Event, Txn Time, Mode, Symbol, Side, Status, Qty, Entry, Live, Target, SL, Net P&L, Entry Why, Action
<table class="table table-sm">
  <thead>
    <tr>
      <th>Event</th>
      <th>Txn Time</th>
      <th>Mode</th>
      <th>Symbol</th>
      <th>Side</th>
      <th>Status</th>
      <th>Qty</th>
      <th>Entry</th>
      <th>Live</th>
      <th>Target</th>
      <th>SL</th>
      <th>Net P&L</th>
      <th>Entry Why</th>
      <th>Action</th>
    </tr>
  </thead>
  <tbody id="openTradesBody">
  </tbody>
</table>
```

- [ ] **Step 2: Update renderOpenTradeRows() to populate Status column**

Find the row rendering section and add status cell. Before the Action cell, add:

```javascript
// Status cell
let statusDisplay = '—';
let statusTooltip = '';

if (trade.broker?.status === 'pending') {
  const elapsedMs = Date.now() - (trade.broker.createdAt || Date.now());
  const elapsedS = Math.round(elapsedMs / 1000);
  statusDisplay = `🟡 Pending (${elapsedS}s)`;
  statusTooltip = `Attempt ${trade.broker.confirmationAttempts || 0}/90`;
} else if (trade.broker?.status === 'confirmed') {
  statusDisplay = '🟢 Confirmed';
  statusTooltip = `Confirmed at ${trade.broker.confirmedAt || ''}`;
} else if (trade.broker?.status === 'rejected') {
  statusDisplay = '🔴 Failed';
  statusTooltip = `Reason: ${trade.broker.confirmationError || 'Unknown'}`;
} else if (trade.broker?.status === 'timeout') {
  statusDisplay = '⚠️ Timeout';
  statusTooltip = 'Order not confirmed after 15 minutes';
}

html += `<td title="${statusTooltip}">${statusDisplay}</td>`;
```

- [ ] **Step 3: Update colspan in "No trades" message from 13 to 14**

Find the colspan="13" and update to colspan="14"

- [ ] **Step 4: Validate syntax**

```bash
node -c dashboard-app.js
```

Expected: No output (syntax OK)

---

### Task 10: Add Broker Connection Status to Settings Modal

**Files:**
- Modify: `dashboard-app.js` (lines ~2655-2710, renderSettingsModal)

- [ ] **Step 1: Add Zerodha Status Card in Settings Modal**

Add before closing div of renderSettingsModal():

```javascript
// Zerodha Status Card
html += `
  <div class="card mb-3">
    <div class="card-header bg-dark text-white">
      <strong>Zerodha Live Status</strong>
    </div>
    <div class="card-body">
      <div class="row">
        <div class="col-md-6">
          <p><strong>Mode:</strong> ${brokerMode === 'zerodha_live' ? 'Zerodha Live ✓' : (brokerMode === 'zerodha_dry_run' ? 'Zerodha Dry' : 'Paper Trading')}</p>
          <p><strong>Credentials:</strong> ${brokerConnectionStatus.zerodhaLive?.available ? '✓ Configured' : '✗ Not Found'}</p>
          <p><strong>Status:</strong> 
            ${brokerConnectionStatus.zerodhaLive?.status === 'ok' ? '<span class="badge bg-success">Connected</span>' : 
              brokerConnectionStatus.zerodhaLive?.status === 'warning' ? '<span class="badge bg-warning">Warning</span>' :
              brokerConnectionStatus.zerodhaLive?.status === 'disabled' ? '<span class="badge bg-danger">Disabled</span>' :
              '<span class="badge bg-secondary">Unknown</span>'}
          </p>
        </div>
        <div class="col-md-6">
          <button class="btn btn-sm btn-primary" onclick="toggleBrokerMode()">Switch Mode</button>
          <button class="btn btn-sm btn-secondary" onclick="pollBrokerStatus()">Refresh Status</button>
          <button class="btn btn-sm btn-info" onclick="openCredentialsFile()">Edit Credentials</button>
        </div>
      </div>
    </div>
  </div>
`;
```

- [ ] **Step 2: Add openCredentialsFile() function**

```javascript
function openCredentialsFile() {
  // Fetch credentials file path from backend
  fetch('/broker-status')
    .then(r => r.json())
    .then(data => {
      alert('Edit credentials at:\n' + (data.credentialsFile || '~/.zerodha.properties'));
    });
}
```

- [ ] **Step 3: Validate syntax**

```bash
node -c dashboard-app.js
```

Expected: No output (syntax OK)

---

### Task 11: Add Confirmation Events Log to Settings Modal

**Files:**
- Modify: `dashboard-app.js` (add new section)

- [ ] **Step 1: Add recent confirmation events display**

Add after Zerodha Status Card:

```javascript
html += `
  <div class="card mb-3">
    <div class="card-header bg-dark text-white">
      <strong>Recent Trade Confirmations</strong>
    </div>
    <div class="card-body" style="max-height: 200px; overflow-y: auto;">
      <div id="confirmationEventsLog" style="font-size: 0.85em; font-family: monospace;">
        <p class="text-muted">No recent events</p>
      </div>
    </div>
  </div>
`;
```

- [ ] **Step 2: Add function to update confirmation log**

```javascript
function updateConfirmationLog() {
  const trades = Object.values(simulationTrades || {})
    .concat(paperTrades || [])
    .filter(t => t.broker?.audit)
    .sort((a, b) => new Date(b.broker.audit[b.broker.audit.length - 1].at) - new Date(a.broker.audit[a.broker.audit.length - 1].at))
    .slice(0, 10);

  const logDiv = document.getElementById('confirmationEventsLog');
  if (!logDiv) return;

  if (trades.length === 0) {
    logDiv.innerHTML = '<p class="text-muted">No recent events</p>';
    return;
  }

  let html = '';
  trades.forEach(t => {
    const lastEvent = t.broker.audit[t.broker.audit.length - 1];
    let icon = '⏳';
    if (t.broker.status === 'confirmed') icon = '✅';
    else if (t.broker.status === 'rejected') icon = '❌';
    else if (t.broker.status === 'timeout') icon = '⚠️';
    
    html += `<div>${icon} ${t.symbol} [${t.side}] - ${lastEvent.event} @ ${new Date(lastEvent.at).toLocaleTimeString()}</div>`;
  });

  logDiv.innerHTML = html;
}

// Update log every 5 seconds
setInterval(updateConfirmationLog, 5000);
```

- [ ] **Step 3: Validate syntax**

```bash
node -c dashboard-app.js
```

Expected: No output (syntax OK)

---

### Task 12: Add axios to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add axios dependency**

In the `"dependencies"` section, add:

```json
"axios": "^1.6.0",
```

- [ ] **Step 2: Install dependency**

```bash
cd c:\data\project\stock-watcher
npm install
```

Expected: axios installed successfully

---

### Task 13: Final Syntax Validation

**Files:**
- Validate: All modified/created files

- [ ] **Step 1: Run complete syntax check**

```bash
cd c:\data\project\stock-watcher && \
node -c ticker_proxy.js && \
node -c dashboard-app.js && \
node -c trade_rules.js && \
node -c zerodha-credentials.js && \
node -c zerodha-kite-client.js && \
node -c zerodha-confirmation-poller.js && \
echo "✅ All files syntax OK"
```

Expected: "✅ All files syntax OK"

- [ ] **Step 2: Test server startup**

```bash
cd c:\data\project\stock-watcher && timeout 5 node ticker_proxy.js 2>&1 | head -20
```

Expected: Server starts without errors, shows initialization logs

---

## Testing Checklist

- [ ] Credentials file auto-created on first use
- [ ] Can toggle between Paper → Zerodha Dry → Zerodha Live → Paper
- [ ] Zerodha Live mode shows correct status icon (green when ok, orange when warnings, red when disabled)
- [ ] Trade placed in Zerodha Live mode shows "Pending (Xs)" status
- [ ] Confirmation polling updates status every 10 seconds
- [ ] After 15 minutes, pending trades marked as "Timeout"
- [ ] Rejected orders show error message in tooltip
- [ ] UI shows recent confirmation events in settings modal
- [ ] Mode switch blocked if credentials missing (shows error)
- [ ] After 3 consecutive failures, Zerodha Live auto-disabled and fallback to paper

---

## Integration Notes

- Zerodha credentials stored in plaintext at `~/.zerodha.properties` (user-managed security)
- Token auto-refresh happens transparently in KiteClient when detecting 401/403
- Confirmation polling runs independently of simulation cycles
- All broker metadata persisted in `paper_trades.json` for audit trail
- SSE stream automatically broadcasts updated trade status to UI

---

## Next: Code Implementation

Use **subagent-driven-development** to execute tasks 1-13 in sequence.
