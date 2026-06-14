# stock-watcher using NSE and Yahoo finance as source

A lightweight dashboard for Indian NSE midcap stocks, built with a local proxy for NSE and Yahoo Finance data.

## Run locally

1. Open a terminal in this folder.
2. Start the proxy server:
   ```bash
   node ticker_proxy.js
   ```
   To enable AI mode with OpenAI, create this file in your Windows user folder:
   ```text
   C:\Users\<your-user>\openai.properties
   ```
   File content:
   ```properties
   OPENAI_API_KEY=sk-proj-your-key
   OPENAI_MODEL=gpt-4.1-mini
   ```
   Then start the proxy normally:
   ```powershell
   node ticker_proxy.js
   ```
   You can also override the file using environment variables:
   ```powershell
   $env:OPENAI_API_KEY="sk-proj-your-key"
   node ticker_proxy.js
   ```
   Optional:
   ```powershell
   $env:OPENAI_MODEL="gpt-4.1-mini"
   ```
3. Open `nse_midcap_dashboard.html` in your browser.

## How it works

- `ticker_proxy.js` serves as a local proxy for:
  - `GET /health`
  - `GET /nse?path=/api/...` for NSE India data
  - `GET /yahoo?symbols=A,B` for Yahoo Finance stock quotes
  - `GET /yahoo/indices` for index summaries
  - `POST /openai` for OpenAI-backed AI mode and fundamentals chat
  - `GET /etf-prefs` to persist custom ETF symbol preferences
  - `GET /stock-prefs` to persist custom stock symbol preferences
- The dashboard fetches live prices and renders a midcap stock watch table, sector heatmap, and ETF tracker.

## Notes

- Yahoo and NSE modes require the proxy to be running on `http://localhost:3001`.
- AI mode requires `OPENAI_API_KEY` in `C:\Users\<your-user>\openai.properties` or on the proxy process and may be slower.
- Custom ETF symbols are saved to `saved_etfs.json` on the proxy and also cached in browser localStorage for refresh persistence.
- Custom stock symbols are saved to `saved_stocks.json` on the proxy and also cached in browser localStorage for refresh persistence.
 
