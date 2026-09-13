# Stock Watcher

A local Indian-equity dashboard for stock and ETF watchlists, market data, company news, broker integration, trading simulation, historical replay, and portfolio research and execution workflows. The application combines a Remix 3 interface with a Node.js data/API server and SQLite persistence.

## Contents

- [Install and run](#install-and-run)
- [Architecture and modules](#architecture-and-modules)
- [Configuration](#configuration)
- [Stocks, ETFs, and news](#stocks-etfs-and-news)
- [Simulation and replay](#simulation-and-replay)
- [Portfolio subsystem](#portfolio-subsystem)
- [API reference](#api-reference)
- [Persistence](#persistence)
- [Development and verification](#development-and-verification)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

## Install and run

### Requirements

- Node.js **24.3.0 or later**, matching both package manifests.
- npm and a terminal; the examples below use Windows PowerShell.
- Network access for external market-data providers. Broker and AI features require their own configuration.
- The SQLite driver is `better-sqlite3`; installation needs a compatible native binary or a working native build toolchain.

From the repository root:

```powershell
npm.cmd install
npm.cmd --prefix my-remix-app install
npm.cmd run dev
```

Open **http://localhost:44100/**.

The root `dev` command runs **two processes**:

| Process | Default port | Responsibility |
| --- | --- | --- |
| Remix interface | 44100 | Pages, assets, and forwarding API requests |
| `ticker_proxy.js` | 3001 | Market data, persistence, news, brokers, simulation, and API services |

The browser uses the interface's origin for API requests. `my-remix-app/proxy-routes.ts` determines which requests are forwarded to the API process. The interface watches its source during development; the standalone API command does **not** watch for changes. Restart the API after changing its modules.

### Other startup commands

| Command | Behavior |
| --- | --- |
| `npm.cmd run dev:ui` | Interface only, expecting an external API server |
| `npm.cmd run dev:proxy` | API server only |
| `npm.cmd run dev:split` | Explicit alias for the split development arrangement |
| `npm.cmd run proxy` | Standalone API server |
| `npm.cmd --prefix my-remix-app run dev` | Watched interface with integrated API when `PROXY_URL` is unset |
| `npm.cmd start` | Unwatched Remix server with integrated API when `PROXY_URL` is unset |

Do not start another API process on the same port. Use Ctrl+C in the terminal that started the application to stop it. If processes were launched separately, stop both terminals, including the interface watcher. Closing the browser does not stop server-side work.

### Main pages

| Path | Purpose |
| --- | --- |
| `/` and `/stocks` | Stock dashboard, quotes, filters, sector views, and research |
| `/etfs` | ETF view |
| `/portfolio` | Portfolio entry point |
| `/replay` | Historical simulation replay |
| `/mobile` | Mobile dashboard, with manifest and service-worker assets |

## Architecture and modules

```text
Browser: desktop / mobile / portfolio interface
                |
Remix server :44100 -- page routing and assets
                |
API proxy :3001 (or integrated API in single-process mode)
                |
     domain services and provider adapters
          /                         \
SQLite / dated caches       NSE / Yahoo / brokers / news / AI
```

### Application and market-data modules

| Module | Responsibility |
| --- | --- |
| `my-remix-app/server.ts` | HTTP entry point, environment loading, API forwarding, and SSE reconnection |
| `my-remix-app/app/router.ts`, `app/routes.ts` | Application routing |
| `my-remix-app/app/actions/` | Page controllers and portfolio actions |
| `my-remix-app/app/ui/`, `app/assets/` | Interface rendering and assets |
| `my-remix-app/app/portfolio/` | Portfolio interface state and market valuation helpers |
| `ticker_proxy.js` | Main API composition, provider integration, caches, scheduler startup, and legacy routes |
| `dashboard-app.js` | Desktop watchlist, rendering, charts, news, setup cards, and server-state integration |
| `nse_midcap_dashboard.html`, `dashboard.css` | Desktop shell and styling |
| `mobile-app.js`, `mobile.css` | Mobile dashboard behavior and presentation |
| `mobile-sw.js`, `mobile-manifest.webmanifest` | Mobile service worker and installation metadata |
| `server/intraday-candles.js` | Intraday candle retrieval and aggregation |
| `server/stock-history.js` | Historical stock data service |
| `server/quarterly-financials.js`, `server/screener-quarterly-financials.js` | Quarterly financial information and Screener adapter |
| `server/ipo-calendar.js` | IPO and recent-listing data |
| `server/http-safety.js`, `server/concurrency.js` | Shared HTTP and concurrency utilities |

### News and calendar modules

| Module | Responsibility |
| --- | --- |
| `server/fresh-news.js` | Full-universe scans, dated caches, pagination, impact classification integration, and research signals |
| `server/screener-news.js` | Company-page announcements from Screener |
| `server/livemint-news.js` | LiveMint RSS matching to stocks |
| `server/result-calendar.js` | NSE board-meeting/result-calendar collection and dated cache |

### Trading, simulation, and review modules

| Module | Responsibility |
| --- | --- |
| `simulation_engine.js` | Simulation rules, candidate evaluation, and execution calculations |
| `trade_rules.js` | Shared trading rules and settings defaults |
| `server/simulation-domain/index.js` | Domain-cycle entry and exit intent generation |
| `server/simulation-runtime-store.js` | Runtime state persistence and validated transitions |
| `backtest_simulation.js` | Historical replay command-line interface |
| `replay_worker.js` | Replay work outside the main request flow |
| `run_backtest_experiments.js` | Backtest experiment orchestration |
| `server/setup-efficiency.js` | Setup effectiveness analysis |
| `server/exit-quality.js` | Exit quality analysis |
| `server/strategy-advisor.js` | Strategy review and evidence services |
| `server/snapshot-store.js`, `server/snapshot-db.js` | Captured simulation snapshot storage and retrieval |
| `server/snapshot-writer-worker.js` | Snapshot writer worker |
| `server/migrate-snapshot-files.js` | Legacy snapshot migration utility |

### Broker modules

| Module | Responsibility |
| --- | --- |
| `zerodha-credentials.js` | User-level Zerodha credentials and token persistence |
| `zerodha-kite-client.js` | Kite client integration |
| `zerodha-confirmation-poller.js` | Broker order confirmation polling |
| `sharekhan-credentials.js` | User-level Sharekhan credentials |
| `sharekhan-client.js` | Sharekhan API integration and instrument mapping |
| `sharekhan-ticker.js` | Sharekhan streaming feed |
| `sharekhan-intraday.js` | Intraday data derived from the Sharekhan feed |

### Route modules

`server/routes/registry.js` composes extracted route handlers. The directory includes `dashboard.js`, `preferences.js`, `broker.js`, `trade-settings.js`, `trade-execution.js`, `simulation-runtime.js`, `replay.js`, `setup-efficiency.js`, `exit-quality.js`, and `strategy-advisor.js`. Additional routes remain in `ticker_proxy.js` and the portfolio HTTP composition.

## Configuration

The root `.env` is optional. Use `.env.example` as a template; do not overwrite an existing configuration. Credentials belong in local configuration, never in committed source or logs.

| Variable | Purpose / default |
| --- | --- |
| `PORT` | Interface port; default `44100` |
| `PROXY_PORT` | Standalone API port; default `3001` |
| `PROXY_URL` | Interface's upstream API URL; split mode defaults to `http://localhost:3001` |
| `OPENAI_API_KEY` | Enables OpenAI-backed application features |
| `OPENAI_MODEL` | Application model override; code default is `gpt-4.1-mini` |
| `OLLAMA_BASE_URL` | Local Ollama endpoint; default `http://localhost:11434` |
| `OLLAMA_MODEL` | Selected local model |
| `OLLAMA_TIMEOUT_MS` | Ollama request timeout; default `180000` |
| `SIMULATION_RUNTIME_FILE` | Runtime-state file override |
| `SIM_SNAPSHOT_DB_FILE` | Simulation snapshot database override |
| `YAHOO_QUOTE_CONCURRENCY` | Quote-fetch concurrency; default `24`, bounded to 1–32 |
| `SHAREKHAN_NIFTY_SCRIP_CODE`, `SHAREKHAN_MIDCAP150_SCRIP_CODE`, `SHAREKHAN_SMALLCAP100_SCRIP_CODE`, `SHAREKHAN_BANKNIFTY_SCRIP_CODE` | Optional index code overrides when instrument resolution is unavailable |

When changing the standalone API port, update `PROXY_URL` to match. The example environment file also contains compatibility/testing file overrides; these do not mean current saved preferences are primarily stored in JSON.

### AI configuration

The application reads `openai.properties` from the operating-system user home, for example `C:\Users\<user>\openai.properties`:

```properties
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Environment variables override the corresponding OpenAI properties. The model name above is the repository's configured default, not a claim about the latest available model. Ollama settings can also be supplied through environment variables or the properties file.

### Broker configuration

The credential loaders use the user home (`HOME` or `USERPROFILE`):

- `.zerodha.properties`: `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`, and an access token or supported refresh token. See `zerodha-credentials.js` for the template.
- `.sharekhan.properties`: `SHAREKHAN_API_KEY`, `SHAREKHAN_CUSTOMER_ID`, and `SHAREKHAN_ACCESS_TOKEN`; optional session-generation fields are documented in `sharekhan-credentials.js`.

The dashboard broker modes are `zerodha_dry_run`, `zerodha_live`, and `sharekhan_live`. The fallback mode is `zerodha_dry_run`, but a saved mode can override it. Check the selected mode before submitting orders. Live modes can place real broker orders. Expired sessions require broker login or token renewal; a running HTTP server does not guarantee a valid broker session.

## Stocks, ETFs, and news

The desktop stock universe starts with `MIDCAP_STOCKS` in `dashboard-app.js` and incorporates saved/custom stocks. Preferences and favorites are persisted by the server; browser localStorage also supports interface persistence. The universe is dynamic: a fixed number such as 522 should not be used as a scan limit.

### Fresh-news collection

`server/fresh-news.js` combines the dashboard stock list, the server's saved stock list, and symbols supplied with a request, normalizes symbols, and deduplicates them. There is **no fixed 220/300/320-symbol cap**. The stock-list reader supports `const`, `let`, and `var` declarations and does not scan unrelated ETF arrays as part of the dashboard list.

Collection uses:

1. Market-wide NSE announcements, results, corporate actions, and board meetings.
2. Individual NSE announcement requests for every symbol in the scan universe.
3. Screener pages for stock symbols with news activity in that scan.
4. LiveMint matching for stock symbols in the universe.

The normal schedule is **10:30 and 15:45 IST** while the server is running. Startup checks for missing/incomplete current caches. Weekday default responses combine today and the previous business day; weekend handling includes the previous business day and relevant weekend dates. The business-date helper skips weekends; it is not a complete exchange-holiday calendar.

Dated files are stored under `cache/fresh_news/`. Each scan records `scanned`, `scannedSymbols`, `symbolScanCoverage`, `items`, `researchItems`, `savedAt`, and `errors`. Caches missing stocks from the current requested/saved universe are rebuilt. All deduplicated collected items are retained; response pagination controls display size. Research scans use a 30-day lookback.

**Coverage and news count are different:** a stock can be scanned successfully and have no relevant news. `symbolScanCoverage` records individual NSE scan coverage, not successful retrieval from every supplementary provider. Review `errors` for Screener or other source failures. A request filtered to a symbol subset is not an authoritative audit of the complete universe; use the dated cache's scan metadata for that audit.

`GET /fresh-stock-news` normally serves a reusable cache. Restarting the API loads code changes; an incomplete universe triggers rebuilding. Do not assume a browser refresh forces a new provider scan. The separate `/stock-news` route provides stock-specific news and events. Result-calendar collection is a separate service with its own limits and scheduling; the news scanner's unlimited universe does not automatically change it.

## Simulation and replay

Simulation runtime is **server-authoritative**. Closing or refreshing the browser does not stop its scheduler.

| State | Meaning |
| --- | --- |
| `off` | Simulation stopped |
| `running` | Entry and exit processing enabled subject to rules |
| `settling` | New entries blocked while exit handling continues |

`POST /simulation/start` starts the runtime. `POST /simulation/stop` normally enters settling; immediate stop uses the route's `mode=immediate` option. Consult `/simulation/status` for `state`, scheduler activity, locks, timestamps, and diagnostics. Persisted state and auto-resume settings matter when restarting the server.

Use `/trade-execution` for new trade integrations. `/paper-trades` and its stream remain compatibility aliases. Simulation and manual trade records should not be edited directly in the database.

Replay uses recorded snapshots and shared simulation logic. It needs captured data for the requested IST date; it cannot reconstruct missing captures merely from the current quote cache.

```powershell
node backtest_simulation.js --help
node backtest_simulation.js --day 2026-09-09 --recorded-decisions --skip-opportunities
```

Options include capital and entry-limit overrides, long/short selection, score recomputation, JSON output, and parameter sweeps. `--recorded-decisions` uses persisted selection/ranking where available. Consult `--help` for current flags and `docs/SIMULATION_ENGINE_CONSISTENCY.md` for consistency expectations.

## Portfolio subsystem

`server/portfolio/` is a separate TypeScript subsystem for portfolio accounting, strategy configuration, research, rebalancing, controlled execution, and operations. It has its own persistence boundaries and should not be treated as interchangeable with the legacy simulation ledger.

| Layer | Modules and responsibilities |
| --- | --- |
| `domain/` | `portfolio`, `construction`, `market-data`, `strategy`, `rebalancing`, `execution`, `operations`, `events`, `shared`, and `errors`; values, invariants, accounting, and business rules |
| `application/` | Strategy scoring and eligibility, planning, approvals, order placement, fills, reconciliation, recovery, jobs, incidents, and API services |
| `ports/` | Contracts for repositories, brokers, strategies, and other dependencies |
| `adapters/` | Persistence, broker, optimization, and API/research adapters |
| `infrastructure/` | Database ownership, initialization, and supporting infrastructure |
| `composition/` | HTTP runtime and security dependency wiring |
| `api/` | Request contracts, secure handling, and security headers |

The interface lives in `my-remix-app/app/portfolio/` and portfolio action controllers. HTTP APIs are grouped under `/api/portfolio`. Approval, execution gates, idempotency, reconciliation, and recovery are implemented in dedicated modules; do not bypass them with direct database updates. The implementation specification in `docs/` describes the wider design; source and tests establish current behavior.

## API reference

These paths are available through the interface origin when the server is running. The table is a route-family guide; inspect the owning handler for exact methods, payloads, authentication, and response schemas.

| Routes | Purpose |
| --- | --- |
| `GET /health` | API availability |
| `GET /dashboard-bootstrap` | Startup settings, preferences, favorites, portfolio, and cache data |
| `GET /dashboard-market?symbols=A,B` | Initial indices and quote batch |
| `/nse`, `/yahoo`, `/yahoo/indices` | Market-provider access |
| `/intraday-candles`, `/intraday-signals`, `/sparklines` | Intraday and compact chart data |
| `/stock-history`, `/stock-chart-events` | Historical prices and event annotations |
| `/stock-prefs`, `/stock-favs` | Saved stocks and favorites |
| `/etf-prefs`, `/etf-favs`, `/etf-list`, `/etf-nav`, `/etf-summary` | ETF preferences and data |
| `/stock-news`, `/fresh-stock-news`, `/result-calendar`, `/ipo-calendar` | Company news and calendars |
| `/trade-settings` | Trading configuration |
| `/trade-execution`, `/trade-execution/stream` | Canonical trade API and SSE updates |
| `/simulation/start`, `/simulation/stop`, `/simulation/status` | Runtime control and status |
| `/simulation/analysis`, `/simulation/analysis/stream` | Server candidate analysis and updates |
| `/simulation-snapshots`, `/simulation-replay` | Captures and replay workflows |
| `/setup-efficiency`, `/exit-quality`, `/strategy-advisor` | Trading review services |
| `/broker-mode`, `/broker-status`, `/broker-refresh-token`, `/broker/...` | Broker selection and sessions |
| `/zerodha-portfolio`, `/sharekhan-portfolio`, `/portfolio/day-pnl` | Broker portfolio and P/L data |
| `/openai`, `/ollama` | AI integration routes |
| `/stream/intraday-live`, `/stream/market-overview` | Live server-sent events |
| `/mobile-setups`, `/mobile-stock-universe` | Mobile data services |
| `/api/portfolio/...` | Portfolio subsystem API |

## Persistence

See **[Database schema reference](docs/DATABASE_SCHEMA.md)** for every application table: purpose, complete column definitions, primary/foreign keys, defaults, checks, indexes, and triggers across all three databases. The reference contains schema only, never stored records.

| Location / module | Contents |
| --- | --- |
| `stock-watcher.db`, `server/db.js` | Main SQLite database: symbols, preferences, trades, caches, news, and other application state |
| `server/db-migrate.js` | Legacy-data migration helpers |
| `data/portfolio-management.db` | Separate portfolio subsystem database |
| `snapshots/simulation_snapshots.db` | Simulation captures; path can be overridden |
| `simulation_runtime.json` | Persisted simulation runtime state |
| `cache/fresh_news/` | Dated news entries and index |
| `cache/result_calendar/` | Dated result-calendar entries and index |
| `cache/simulation_decisions/` | Decision-journal captures |
| `reports/` | Generated review and experiment evidence |

Legacy files such as `saved_stocks.json` and `saved_etfs.json` appear in migration/history code; current server preference APIs use SQLite. SQLite `-wal` and `-shm` files may exist while databases are open. Back up using a consistent SQLite backup or with writers stopped, rather than copying only the main file during active writes.

Do not commit credentials, `.env`, runtime logs, or snapshot databases. Preserve existing trading data and user changes when performing maintenance. Do not run migration or cleanup utilities against live data without reviewing their inputs and effects.

## Development and verification

```powershell
# Root test suite
npm.cmd test

# UI and portfolio type checks
npm.cmd run typecheck

# Syntax check for an edited JavaScript module
node --check server/fresh-news.js

# Focused news regression tests
node --test tests/fresh-news-universe.test.js tests/fresh-news-impact-cache.test.js tests/fresh-news-weekend-scheduler.test.js

# Remix tests and diagnostics
npm.cmd --prefix my-remix-app test
npm.cmd --prefix my-remix-app run doctor
```

Portfolio scripts include `test:portfolio`, `test:portfolio:persistence`, `test:portfolio:contracts`, `test:portfolio:all`, and the `test:portfolio:u03` through `u09` groups. Matching `verify:portfolio:*` scripts combine relevant checks; `benchmark/` and `bench:portfolio:*` contain performance runs. `package.json` is the complete command reference. A test command being documented does not imply the current worktree passes it.

Tests live under `tests/` and alongside selected interface modules. Add focused regression coverage for behavior changes before running broader suites. Keep `/trade-execution` canonical and server simulation state authoritative.

This repository is indexed by CodeGraph. Follow `AGENTS.md`: use `codegraph explore "<module or question>"` before broad code searches. The local Headroom proxy is developer tooling, separate from the stock-watcher API; preserve its routing and configuration unless explicitly changing it.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Port already in use | Identify the listener on 44100/3001; stop the owning application or configure matching `PORT`, `PROXY_PORT`, and `PROXY_URL` values |
| Interface loads but API returns 502 | Confirm the standalone API is running and the upstream URL is correct |
| Server change has no effect | Restart the standalone API; its development command has no watcher |
| News misses saved stocks | Check persisted preferences and dated `scannedSymbols`; ensure the updated scanner is loaded and let incomplete caches rebuild |
| Fewer news-bearing stocks than scanned stocks | Normal when companies have no matching news; compare scan coverage and source errors separately |
| Broker token/session error | Reconnect or renew through the broker flow; inspect broker status |
| Stale quotes or missing candles | Check provider connectivity, broker session, instrument mapping, and data-quality timestamps |
| Old mobile interface | Check service-worker/asset versions and reload the mobile client |
| Replay empty for a date | Verify snapshots exist for that IST date |
| Simulation continues after closing browser | Read `/simulation/status`; stop or settle through the runtime controls |
| AI unavailable | Verify application configuration and provider/model availability |

For port inspection without stopping unrelated services:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 44100,3001 }
```

## Further documentation

- `AGENTS.md` — repository maintenance and agent instructions.
- `docs/SIMULATION_ENGINE_CONSISTENCY.md` — shared simulation/replay behavior.
- `docs/PERFORMANCE_BENCHMARK.md` — performance documentation.
- `docs/portfolio-strategic-rebalancing-implementation-spec.md` — portfolio design and implementation specification.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — historical design and implementation records; verify older details against current source.
