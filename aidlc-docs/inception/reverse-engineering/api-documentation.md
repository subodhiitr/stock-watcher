# API Documentation

## REST APIs

### Dashboard and Mobile

#### Health

- **Method**: GET
- **Path**: `/health`
- **Purpose**: Returns proxy/runtime health status.

#### Dashboard Bootstrap

- **Method**: GET
- **Path**: `/dashboard-bootstrap`
- **Purpose**: Returns initial preferences, trades, portfolio, day P&L, trade settings, and proxy metadata.

#### Dashboard Market

- **Method**: GET
- **Path**: `/dashboard-market?symbols=A,B`
- **Purpose**: Returns first-load index summaries and batched quote data.

#### Mobile Setups

- **Method**: GET
- **Path**: `/mobile-setups?filter=tradeable`
- **Purpose**: Returns ranked mobile setup candidates plus market context.

#### Mobile Stock Universe

- **Method**: GET
- **Path**: `/mobile-stock-universe`
- **Purpose**: Returns the merged tracked stock universe for mobile consumers.

### Preferences and Settings

#### Trade Settings

- **Method**: GET, POST
- **Path**: `/trade-settings`
- **Purpose**: Reads or updates trade/simulation override settings.

#### Stock and ETF Preferences

- **Method**: GET, POST
- **Paths**:
  - `/stock-prefs`
  - `/stock-favs`
  - `/etf-prefs`
  - `/etf-favs`
- **Purpose**: Persists saved watchlists and favorites for dashboard usage.

### Broker Operations

#### Broker Mode

- **Method**: GET, POST
- **Path**: `/broker-mode`
- **Purpose**: Reads or updates the active execution mode (`zerodha_dry_run`, `zerodha_live`, `sharekhan_live`).

#### Broker Status

- **Method**: GET
- **Path**: `/broker-status`
- **Purpose**: Reports credential, client, token refresh, and poller status for brokers.

#### Broker Login

- **Method**: GET
- **Paths**:
  - `/broker/login`
  - `/borker/login`
- **Purpose**: Produces redirect HTML for broker auth initiation.

#### Broker Refresh Callback

- **Method**: GET
- **Path**: `/broker/refresh/:broker`
- **Purpose**: Exchanges request tokens and completes broker login.

#### Manual Token Refresh

- **Method**: POST
- **Path**: `/broker-refresh-token`
- **Purpose**: Refreshes broker access tokens on demand.

#### Broker Portfolio

- **Method**: GET
- **Paths**:
  - `/zerodha-portfolio`
  - `/sharekhan-portfolio`
- **Purpose**: Returns normalized broker portfolio payloads.

### Trade Execution

#### Trade State Read

- **Method**: GET
- **Paths**:
  - `/trade-execution`
  - `/paper-trades`
- **Purpose**: Returns current trades and portfolio state.

#### Trade Actions

- **Method**: POST
- **Paths**:
  - `/trade-execution`
  - `/paper-trades`
- **Purpose**: Performs one of the following actions:
  - `add-capital`
  - `set-initial-capital`
  - `open`
  - `close`
  - `partial-close`
  - `delete`

#### Trade Stream

- **Method**: GET
- **Paths**:
  - `/trade-execution/stream`
  - `/paper-trades/stream`
- **Purpose**: Streams live trade-state changes over SSE.

### Simulation Runtime and Replay

#### Simulation Runtime Control

- **Method**: POST
- **Paths**:
  - `/simulation/start`
  - `/simulation/stop`
- **Purpose**: Starts, settles, or immediately stops the simulation scheduler.

#### Simulation Status

- **Method**: GET
- **Path**: `/simulation/status`
- **Purpose**: Returns runtime status, scheduler state, lock status, and health details.

#### Simulation Analysis

- **Method**: GET
- **Path**: `/simulation/analysis`
- **Purpose**: Returns server-side simulation analysis payloads.

#### Simulation Snapshots

- **Method**: GET, POST
- **Path**: `/simulation-snapshots`
- **Purpose**: Reads or appends persisted simulation snapshots.

#### Replay APIs

- **Method**: GET, POST
- **Paths**:
  - `/simulation-replay`
  - `/simulation-replay/jobs`
  - `/simulation-replay/why`
- **Purpose**: Coordinates replay reporting, jobs, and missed-opportunity analysis.

### Trading Analytics

#### Setup Efficiency

- **Method**: GET, POST
- **Paths**:
  - `GET /setup-efficiency`
  - `POST /setup-efficiency/reconcile`
  - `POST /setup-efficiency/analyze-date?date=YYYY-MM-DD`
  - `GET /setup-efficiency/stream`
- **Purpose**: Returns setup-level performance summaries, triggers incremental reconciliation, analyzes a trading date, and streams updates.

#### Exit Quality

- **Method**: GET, POST
- **Paths**:
  - `GET /exit-quality`
  - `POST /exit-quality/reconcile`
  - `POST /exit-quality/analyze-date?date=YYYY-MM-DD`
  - `GET /exit-quality/stream`
- **Purpose**: Returns exit-quality summaries, reconciles day-close benchmarks, analyzes a trading date, and streams updates.

#### Strategy Advisor

- **Method**: GET, POST
- **Paths**:
  - `GET /strategy-advisor?date=YYYY-MM-DD`
  - `POST /strategy-advisor/prepare?date=YYYY-MM-DD`
  - `GET /strategy-advisor/stream?date=YYYY-MM-DD`
- **Purpose**: Prepares and reports dated evidence packages for an external strategy-advisor task.
- **Constraint**: `/strategy-advisor/run` rejects in-process reasoning; strategy analysis is intentionally kept outside the HTTP runtime.

### Market, Event, and AI Endpoints

- **Method**: GET
- **Representative Paths**:
  - `/nse`
  - `/yahoo`
  - `/yahoo/indices`
  - `/intraday-candles`
  - `/intraday-signals`
  - `/stock-news`
  - `/fresh-stock-news`
  - `/result-calendar`
  - `/etf-list`
  - `/etf-summary`
  - `/etf-nav`
- **Purpose**: Retrieve market, intraday, event, ETF, and related read models.

- **Method**: GET, POST
- **Paths**:
  - `/openai/status`
  - `/openai`
  - `/ollama/status`
  - `/ollama/chat`
- **Purpose**: Expose optional AI-assisted status and chat workflows.

## Streaming APIs

### Server-Sent Events

- **Trade Streams**:
  - `/trade-execution/stream`
  - `/paper-trades/stream`
- **Market and Signal Streams**:
  - `/stream/intraday-signals`
  - `/stream/market-overview`
  - `/stream/mobile-stock-quotes`
  - `/stream/intraday-live`
  - `/stream/yahoo-summary`
  - `/stream/etf-summary`
  - `/stream/etf-nav`

## Internal APIs

### Runtime State Persistence

- **Module**: `server/simulation-runtime-store.js`
- **Methods**:
  - `loadRuntimeState(filePath)`
  - `saveRuntimeState(filePath, nextState)`
  - `transitionRuntimeState(current, action)`
- **Purpose**: Manages the `off`, `running`, and `settling` runtime state machine.

### Database API

- **Module**: `server/db.js`
- **Representative Methods**:
  - `initDb`
  - `saveTrade`
  - `listTrades`
  - `deleteTrade`
  - `getDayPnl`
  - `rebuildDayPnl`
  - `loadPortfolioState`
  - `savePortfolioState`
  - `kvGet`
  - `kvSet`
  - `jsonCacheGet`
  - `jsonCacheSet`
- **Purpose**: Encapsulates structured persistence and cache access.

### Service Factories

- **Modules**:
  - `server/fresh-news.js`
  - `server/result-calendar.js`
  - `server/intraday-candles.js`
- **Purpose**: Build service objects that fetch, cache, classify, and return domain read models.

### Trading Analytics Services

- **Modules**:
  - `server/setup-efficiency.js`
  - `server/exit-quality.js`
  - `server/strategy-advisor.js`
- **Purpose**: Reconcile derived trade facts, calculate analytics summaries, and prepare dated strategy evidence.

### Snapshot Database

- **Module**: `server/snapshot-db.js`
- **Representative Methods**:
  - `appendSnapshot`
  - `importSnapshots`
  - `replaceDay`
  - `loadDay`
  - `listDays`
  - `prune`
  - `version`
- **Purpose**: Stores gzip-compressed, time-bucketed simulation snapshots in a dedicated SQLite database.

## Data Models

### Trade

- **Fields**:
  - `id`, `status`, `symbol`, `name`, `side`, `qty`, `entryPrice`
  - `target`, `stop`, `signal`, `score`, `rr`
  - `reservedCapital`, `portfolioInitial`
  - `source`, `assetType`, `setupType`, `setup`, `entryContext`, `notes`
  - `openedAt`, `executionMode`
  - Optional `broker` metadata for live or dry-run order tracking
- **Relationships**:
  - Closed partial exits can reference a parent trade.
- **Validation**:
  - Requires valid symbol, side, quantity, and entry price for opens.

### Portfolio State

- **Fields**:
  - `initialCapital`
  - `capitalAdds`
  - `realizedPnl`
- **Purpose**: Aggregates capital and realized profit/loss information.

### Simulation Runtime State

- **Fields**:
  - `state`
  - `autoResume`
  - `lastTickAt`
  - `updatedAt`
  - `lastError`
  - `version`
- **Validation**:
  - State must be one of `off`, `running`, or `settling`.

### Fresh News Payload

- **Fields**:
  - `date`, `count`, `symbolCount`, `symbols`, `impactBySymbol`, `items`, `fromCache`, `cachedAt`
- **Purpose**: Represents important daily event intelligence for the tracked universe.

### Result Calendar Payload

- **Fields**:
  - `fromDate`, `toDate`, `days`, `resultCalendarBySymbol`, `items`, `source`, `cachedDays`, `missingDays`
- **Purpose**: Represents forward-looking earnings and board-meeting intelligence.

### Setup Efficiency Fact

- **Fields**:
  - `positionId`, `setupType`, `side`, `symbol`
  - `openedAt`, `closedAt`, `tradeDay`, `sourceUpdatedAt`
  - `exposure`, `pnl`, `grossPnl`, `charges`, `netPct`
  - `exitReason`, `exitBucket`, target/stop/trail and late-entry flags
- **Purpose**: Reproducible position-level input for setup-performance summaries.

### Exit Quality Fact

- **Fields**:
  - `exitId`, `positionId`, `setupType`, `symbol`, `side`, `qty`
  - `entryPrice`, `exitPrice`, `closedAt`, `tradeDay`
  - `exitCategory`, `pnl`, `charges`, `dayClosePrice`
  - `opportunityPnl`, `opportunityPct`, `perfectExit`, `beatDayClose`
- **Purpose**: Compares each closed exit with a resolved day-close benchmark.

### Strategy Advisor Evidence

- **Fields**:
  - `schemaVersion`, `date`, `generatedAt`, `instructions`
  - setup-efficiency and exit-quality summaries
  - snapshot diagnostics, transaction facts, and effective configuration
- **Validation**:
  - Requires a valid `YYYY-MM-DD` trading date.
  - Explicitly prohibits replay, backtest, sweep, or direct setting application during evidence preparation.
