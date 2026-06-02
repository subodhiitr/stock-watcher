# stock-watcher using NSE and Yahoo finance as source

A lightweight dashboard for Indian NSE midcap stocks, built with a local proxy for NSE and Yahoo Finance data.

## Run locally

1. Open a terminal in this folder.
2. Start the proxy server:
   ```bash
   node ticker_proxy.js
   ```
3. Open `nse_midcap_dashboard.html` in your browser.

## How it works

- `ticker_proxy.js` serves as a local proxy for:
  - `GET /health`
  - `GET /nse?path=/api/...` for NSE India data
  - `GET /yahoo?symbols=A,B` for Yahoo Finance stock quotes
  - `GET /yahoo/indices` for index summaries
  - `GET /etf-prefs` to persist custom ETF symbol preferences
  - `GET /stock-prefs` to persist custom stock symbol preferences
- The dashboard fetches live prices and renders a midcap stock watch table, sector heatmap, and ETF tracker.

## Notes

- Yahoo and NSE modes require the proxy to be running on `http://localhost:3001`.
- AI mode requires an Anthropic API key and may be slower.
- Custom ETF symbols are saved to `saved_etfs.json` on the proxy and also cached in browser localStorage for refresh persistence.
- Custom stock symbols are saved to `saved_stocks.json` on the proxy and also cached in browser localStorage for refresh persistence.
 