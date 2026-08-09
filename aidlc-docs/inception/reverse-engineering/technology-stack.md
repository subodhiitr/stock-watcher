# Technology Stack

## Programming Languages

- **JavaScript** - Primary runtime language for proxy, services, route handlers, dashboard assets, and tests
- **TypeScript / TSX** - Used in the Remix UI shell and server bridge
- **Python** - Used in local utilities for broker-auth/token support

## Frameworks

- **Node.js HTTP server** - Core backend/proxy runtime
- **Remix 3 beta** - UI shell, route rendering, and server bridge
- **better-sqlite3** - SQLite integration for structured local persistence
- **Node worker threads** - Off-main-thread simulation snapshot compression and persistence

## Infrastructure

- **Local HTTP runtime** - Hosts UI, APIs, and SSE flows on the workstation
- **SQLite databases** - Store durable trading state, analytics facts, and compressed simulation snapshots
- **JSON and gzip file stores** - Retain generated reports, legacy snapshots, and partitioned caches
- **Broker APIs** - Zerodha and Sharekhan live execution/portfolio integrations
- **Market data APIs** - Yahoo Finance and NSE

## Build Tools

- **npm** - Package management and script orchestration at root and nested app levels
- **npm-run-all** - Runs UI and proxy development processes in parallel
- **Node `--import remix/node-tsx`** - Executes the Remix TypeScript app without a separate build step

## Testing Tools

- **Node built-in test runner** - Primary test framework for root and Remix-side tests
- **TypeScript compiler (`tsc --noEmit`)** - Typecheck for the Remix app

## Quality and Runtime Notes

- Remix app requires **Node >= 24.3.0**.
- The TypeScript app uses strict compiler settings.
- No dedicated linting tool or CI workflow was found in the repository.
- SQLite uses WAL mode and busy timeouts to support concurrent runtime, backtest, analytics, and snapshot workloads.
