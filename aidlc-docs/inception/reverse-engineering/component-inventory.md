# Component Inventory

## Application Packages

- `my-remix-app` - Remix 3 UI shell and same-origin proxy bridge
- `ticker_proxy.js` runtime - Core Node proxy, stream host, simulation scheduler, and integration coordinator
- Static dashboard/mobile assets - Legacy browser-facing dashboard and mobile experiences

## Infrastructure Packages

- None detected in this repository. No CDK, Terraform, or CloudFormation infrastructure packages were found.

## Shared Packages

- `server/` - Shared backend services and route handlers
- `server/routes/` - HTTP workflow modules
- Broker adapters - Zerodha and Sharekhan integration modules
- Shared trading domain - `trade_rules.js`, `simulation_engine.js`, `server/simulation-domain/index.js`
- Trading analytics - setup efficiency, exit quality, and strategy-advisor evidence services
- Snapshot persistence - compressed SQLite snapshot store, worker writer, and migration utility
- Concurrency utilities - bounded asynchronous mapping support
- Utilities and research helpers - `util/`, `backtest/`, `benchmark/`

## Test Packages

- Root `tests/` suite - Regression coverage for APIs, DB, UI behavior, brokers, simulation, replay, and SSE
- `my-remix-app/proxy-routes.test.ts` - Focused Remix proxy-path coverage

## Total Count

- **Total Logical Components**: 13
- **Application**: 3
- **Infrastructure**: 0
- **Shared**: 8
- **Test**: 2
