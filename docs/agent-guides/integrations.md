# Market data and broker integrations

## Responsibility

This area handles NSE/Yahoo market data, Zerodha and Sharekhan credentials and clients, intraday streams, candles, news, result calendars, and broker reconciliation.

## Module map

- `zerodha-credentials.js`, `zerodha-kite-client.js`, and `zerodha-confirmation-poller.js` handle Zerodha access and confirmations.
- `sharekhan-credentials.js`, `sharekhan-client.js`, `sharekhan-intraday.js`, and `sharekhan-ticker.js` handle Sharekhan access and market streams.
- `server/intraday-candles.js`, `server/fresh-news.js`, and `server/result-calendar.js` provide cached market context.
- `server/portfolio/ports/market-data/` and `server/portfolio/ports/execution/` define typed provider boundaries.
- `server/portfolio/adapters/broker/` and related adapters isolate provider-specific behavior.

## Safety rules

- Never add credentials, tokens, database files, logs, or `.env` files to commits.
- Keep provider calls behind existing clients and adapters; do not call SDKs from UI code or domain code.
- Preserve rate limiting, retry/backoff, freshness timestamps, and explicit provider failure handling.
- Distinguish paper/dry-run behavior from live broker behavior. Never enable real trades as a side effect of a test or refactor.
- Normalize provider payloads at the integration boundary before they reach simulation or portfolio logic.

## Validation

Prefer fixture-backed tests and mocked provider clients. Run the focused integration test plus `node --check` for changed CommonJS files. Do not use live credentials to validate a change.
