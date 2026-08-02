# Server-Owned Trade Computation Design

## Goal

Make server-side computation the single source of truth for stock trade-column data and simulation candidate scoring so simulation can open/manage trades even when no browser is active.

## Scope

In scope:
- Stock trade-column computation on server
- Server-owned simulation inputs (entries/exits) from same computed dataset
- Browser as display/control only for computed trade-column fields
- Runtime cadence: 30 seconds during market hours

Out of scope (this phase):
- ETF trade-column server migration
- Breaking UI contract changes

## Architecture

1. Add/extend a server computation pipeline in `ticker_proxy.js` (or extracted helper module) to produce canonical stock trade rows.
2. Pipeline computes fields currently derived in browser for trade columns (score/signal/status/trigger/risk-supporting values).
3. Persist/retain latest computed rows in memory cache with `computedAt` + stale metadata.
4. Server simulation scheduler reads from this computed cache as candidate input, not browser-posted runtime snapshots.
5. Browser fetches and renders these server-computed fields without local recomputation.

## Data Flow

1. Server fetches market/intraday inputs.
2. Server computes `tradeRows[]` for stocks every 30 seconds.
3. API response carries:
   - `rows[]` with trade-column fields
   - `computedAt`
   - `stale` / `error` metadata
   - `marketContext`
4. Simulation tick consumes same `rows[]` as candidate source.
5. Browser renders table directly from server payload and keeps local display logic only.

## Endpoint Contract Changes

- Extend existing market/dashboard payload path (preferred: `/dashboard-market`) with computed trade rows OR add `/trade-rows` if separation is cleaner.
- Ensure payload remains backward-compatible and additive.
- `/simulation-snapshots` remains replay/audit input, not required for runtime simulation entries.

## Browser Responsibilities

- Keep control actions (`/simulation/start`, `/simulation/stop`, `/trade-execution`).
- Stop local score/signal/trade-column computation for stocks.
- Render server-provided trade-column fields.
- Show stale/error markers from server metadata; do not locally recalculate.

## Simulation Behavior

- Entry/exit decision functions consume server-owned computed candidates.
- Simulation can continue creating new entries with browser closed/idle.
- Existing manual trade behavior and ownership transitions remain unchanged.

## Failure Handling

- If computation fails in a cycle:
  - keep last good rows
  - set `stale=true` and `error` message in API payload
  - continue next scheduled compute attempts
- Simulation should skip new entries only when candidate data is unavailable or stale policy blocks; exits continue where safe.

## Testing Strategy

1. Unit tests for server trade-row computation correctness and deterministic ranking.
2. Integration tests:
   - browser closed simulation still opens new entries from server computation
   - simulation and displayed trade columns stay aligned on score/signal
3. Regression tests:
   - browser path no longer invokes local stock trade-column scoring
   - locked target/manual trade metadata rendering unchanged
4. API tests for payload shape, stale/error metadata, and compatibility.

## Migration Plan

1. Add server computation output with additive payload.
2. Switch simulation candidate input to server cache.
3. Switch browser stock trade-column rendering to server values.
4. Remove runtime dependence on browser `/simulation-snapshots` for live entries.
5. Keep replay snapshot capability unchanged.
