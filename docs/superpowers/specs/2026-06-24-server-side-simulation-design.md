# Server-Side Simulation Execution Design (No-Duplication)

## 1. Objective

Move simulation execution authority from browser to server so simulation continues when browser is idle/closed, while preserving existing browser UX/features and avoiding duplicated trading logic.

## 2. Scope

Phase 1 scope:

- Stock simulation on server (ETF simulation deferred)
- Browser can still manually open/close/partial-close trades
- Server can auto-manage exits for manual trades when `SIMULATION_AUTO_MANUAL_EXITS=true`
- Simulation start/stop initiated from browser, persisted server-side, auto-resumed after proxy restart
- API rename from `/paper-trades` to `/trade-execution` with one-release alias

Out of scope (phase 1):

- ETF simulation parity
- Breaking UI payload schema changes

## 3. Architectural Principles

1. Single source of truth for rules: simulation decision logic exists once in shared server-owned modules.
2. Server authoritative execution: server decides and executes simulation entries/exits.
3. UI as control + view layer: browser triggers commands and renders server outputs only.
4. Backward-compatible contract: existing browser features remain operational without behavioral regressions.

## 4. Target Architecture

### 4.1 Simulation domain (new shared module)

Create `server/simulation-domain/` (or equivalent module namespace) containing reusable logic:

- `deriveCandidates(snapshot, settings)`
- `scoreAndGuard(candidates, settings)`
- `selectEntries(state, candidates, settings, now)`
- `manageExits(state, snapshot, settings, now)`
- `buildExecutionIntents(...)`

Existing logic in `dashboard-app.js` and `simulation_engine.js` is migrated/reused (extracted), not copied.

### 4.2 Server runner

`ticker_proxy.js` owns a single scheduler tick loop:

1. Load latest market snapshot + runtime state + trade settings + execution state
2. Run exits first
3. Run entries next
4. Persist updated state
5. Broadcast updates via SSE

Default cadence in phase 1: every 15 seconds (configurable via server setting/env without code changes).

### 4.3 Browser role

`dashboard-app.js`:

- sends `start/stop/status` commands
- opens manual trades as today
- renders trade state, locked targets, audit/execution metadata from server responses/SSE
- no longer acts as authoritative simulation decision engine

## 5. Runtime State & Persistence

## 5.1 Files

- `paper_trades.json` (existing state/journal)
- `broker_preferences.json` (existing broker mode preference)
- `simulation_runtime.json` (new)

### 5.2 `simulation_runtime.json` shape

```json
{
  "state": "running",
  "autoResume": true,
  "lastTickAt": 0,
  "updatedAt": 0,
  "lastError": "",
  "version": 1
}
```

State values and transitions:

- `off` -> `running` via `/simulation/start`
- `running` -> `settling` via `/simulation/stop` with settle request
- `settling` -> `off` after active positions are settled (or immediate stop policy if configured)
- `running|settling` -> `off` on explicit hard stop

Runtime state schema constraints:

- `state` enum: `off | running | settling` (default `off`)
- `autoResume`: boolean (default `true`)
- `lastTickAt`: epoch ms (default `0`)
- `updatedAt`: epoch ms (required on every write)
- `lastError`: string (default `""`)
- `version`: integer schema version (default `1`)

Invalid/missing values are coerced to defaults at load time and rewritten to file.

### 5.3 Startup behavior

On proxy startup:

1. Load runtime file
2. Restore `state`
3. If `state=running` and `autoResume=true`, start scheduler automatically

## 6. API Design

## 6.1 Canonical endpoints (new)

- `POST /trade-execution` (actions: open, close, partial-close, add-capital, delete)
- `GET /trade-execution`
- `GET /trade-execution/stream`
- `POST /simulation/start`
- `POST /simulation/stop`
- `GET /simulation/status`

### 6.1.1 Simulation endpoint contracts

`POST /simulation/start`

- Request body:

```json
{
  "autoResume": true,
  "tickIntervalSec": 15
}
```

- Response `200`:

```json
{
  "ok": true,
  "state": "running",
  "autoResume": true,
  "tickIntervalSec": 15,
  "updatedAt": 0
}
```

`POST /simulation/stop`

- Request body:

```json
{
  "mode": "settle",
  "timeoutSec": 900
}
```

- `mode` enum: `settle | immediate` (default `settle`)
- Response `200`:

```json
{
  "ok": true,
  "state": "settling",
  "timeoutSec": 900,
  "updatedAt": 0
}
```

`GET /simulation/status`

- Response `200`:

```json
{
  "ok": true,
  "state": "running",
  "autoResume": true,
  "tickIntervalSec": 15,
  "lastTickAt": 0,
  "updatedAt": 0,
  "lastError": "",
  "lockActive": false,
  "openSimulationManagedCount": 0,
  "openManualManagedCount": 0
}
```

Error/status codes:

- `400` invalid request contract
- `409` invalid transition (e.g., start while `settling` with lock active)
- `500` unexpected internal error (also mirrored into `lastError`)

### 6.1.2 SSE payload contract additions

`/trade-execution/stream` event payload remains backward-compatible and additive. Add:

```json
{
  "simulationRuntime": {
    "state": "running",
    "lastTickAt": 0,
    "lastError": ""
  }
}
```

### 6.1.3 `/trade-execution` action contracts

| Action | Required request fields | Success response fields | Validation/Error codes |
|---|---|---|---|
| `open` | `action`, `symbol`, `side`, `qty`, `entryPrice` | `ok`, `trade`, `portfolio` | `400` invalid fields, `409` already-open trade for symbol |
| `close` | `action`, `id`, `exitPrice` | `ok`, `trade`, `portfolio` | `400` invalid id/price or not-open trade |
| `partial-close` | `action`, `id`, `qty`, `exitPrice` | `ok`, `trade`, `partial`, `portfolio` | `400` qty <= 0, qty >= openQty, invalid trade |
| `add-capital` | `action`, `amount` | `ok`, `portfolio` | `400` non-positive amount |
| `delete` | `action`, `id` | `ok`, `deleted` | `400` missing id |

Additional rules:

- `side` enum: `buy | sell`
- `qty` integer > 0
- money fields are numeric > 0 and persisted rounded to 2 decimals
- Response is backward-compatible with current shape; only additive fields introduced
- For one-release migration window, `/paper-trades` mirrors identical request/response behavior

## 6.2 Compatibility alias (temporary)

Keep:

- `/paper-trades`
- `/paper-trades/stream`

as aliases to `/trade-execution` for one release, then remove.

Removal trigger: drop aliases in the next minor release after one full release cycle with migration notice.

## 7. Manual Trade + Simulation Interaction Rules

1. Manual trade initiation from browser is always allowed.
2. If `SIMULATION_AUTO_MANUAL_EXITS=true`, server runner manages exits for manual trades using standard simulation exit rules.
   - This applies only while simulation runtime state is `running` or `settling`.
3. If disabled, manual trades stay user-managed for exit.
4. Exit logic always runs before new entries in each tick.

### 7.1 Persisted trade ownership model

Persist explicit ownership fields in each trade record:

- `entryOwner`: `manual | simulation`
- `exitOwner`: `manual | simulation` (current authority)
- `managedBySimulation`: boolean
- `managementState`: `manual_only | simulation_managed | settling_managed`

Transition rules:

1. Manual open: `entryOwner=manual`, `exitOwner=manual`, `managedBySimulation=false`, `managementState=manual_only`
2. Simulation open: `entryOwner=simulation`, `exitOwner=simulation`, `managedBySimulation=true`, `managementState=simulation_managed`
3. Manual trade takeover (when `SIMULATION_AUTO_MANUAL_EXITS=true` and runtime `running|settling`):
   - set `exitOwner=simulation`, `managedBySimulation=true`, `managementState=simulation_managed` (or `settling_managed` while settling)
4. Simulation stop immediate:
   - all open manual-origin trades revert to `exitOwner=manual`, `managedBySimulation=false`, `managementState=manual_only`
5. Trade close finalization:
   - preserve `entryOwner` and final `exitOwner` in history for audit/reporting

### 7.2 Legacy trade migration/backfill

On server load of historical `paper_trades.json`, backfill missing ownership fields:

- If trade has `source=simulation`: set `entryOwner=simulation`, `exitOwner=simulation`, `managedBySimulation=true`, `managementState=simulation_managed`
- Else default to manual: `entryOwner=manual`, `exitOwner=manual`, `managedBySimulation=false`, `managementState=manual_only`
- If trade is already `status=closed`, preserve inferred ownership and mark immutable for ownership transitions

Edge-case rules:

- `partial-close`: partial leg inherits parent `entryOwner`; `exitOwner` is actor that executed that partial close.
- `delete`: allowed only for closed trades; open-trade delete is rejected (`400`) to prevent ownership/audit loss.

## 8. Reliability & Safety

1. Tick lock to prevent overlapping simulation cycles.
2. Errors do not terminate runner; record `lastError` and continue next tick.
3. Broker failure thresholds trigger fallback to persisted `paper` mode via broker preference setter.
4. EOD and settle behavior remains server-side and persisted.
5. Stop semantics:
   - `/simulation/stop` default behavior: transition to `settling`, disallow new entries, continue exit management until no open simulation-managed positions remain.
   - Settling timeout default: 15 minutes; after timeout, force transition to `off` and preserve remaining open trades as manual-managed.
   - If market is closed or feed is unavailable during settling, force `off` after one failed settle cycle and store reason in `lastError`.
6. Concurrency/order of mutations:
   - All manual API actions and runner ticks share one server-side write lock.
   - In each processing cycle: apply queued manual actions first, then `manageExits`, then `selectEntries`.
   - If manual close and runner exit target the same trade concurrently, manual close wins; runner re-reads state before write and skips closed trades.

## 9. Backward Compatibility Requirements

Must remain unchanged from user perspective:

- locked target behavior
- trade table details and visual state
- broker execution/audit metadata visibility
- existing manual trade controls

Contract policy:

- additive response/event fields only during migration
- avoid removing/renaming current fields used by UI in phase 1

## 10. Migration Plan

1. Extract/move shared decision functions into server simulation domain.
2. Introduce runtime persistence + `/simulation/start|stop|status`.
3. Switch scheduler authority to server.
4. Make UI consume server status/state and remove client-authoritative loop.
5. Introduce `/trade-execution` + alias old `/paper-trades`.
6. Complete one-release compatibility window, then remove alias.

## 11. Verification Plan

1. Unit tests:
   - entry/exit rule parity against known fixtures
   - runtime persistence load/save behavior
   - status transition correctness
2. Integration tests:
   - start simulation from browser, refresh/close tab, verify server continues
   - proxy restart with `running` state auto-resumes
   - manual open + auto-managed exit behavior with flag on/off
3. Regression checks:
   - locked target and trade table rendering unchanged
   - broker metadata/audit rows still visible

## 12. Acceptance Criteria

1. Simulation continues while browser is idle/closed as long as proxy is running.
2. Simulation state survives server restart and auto-resumes when configured.
3. No duplicated buy/sell criteria logic across browser and server.
4. Manual browser trading continues to work unchanged.
5. `/trade-execution` is canonical; `/paper-trades` works as one-release alias.
