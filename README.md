# stock-watcher using NSE and Yahoo finance as source

A lightweight dashboard for Indian NSE midcap stocks, built with a local proxy for NSE and Yahoo Finance data.

## Run locally with Remix 3

1. Open a terminal in this folder.
2. Install the Remix app dependencies once:
   ```powershell
   npm --prefix my-remix-app install
   ```
3. Start the Remix 3 app. It serves both the dashboard and the proxy/API routes from the same Node process:
   ```powershell
   npm run dev
   ```
4. Open `http://localhost:44100/` in your browser.

The old standalone proxy command is still available for direct debugging:
```powershell
npm run proxy
```

## AI setup

To enable AI mode with OpenAI, create this file in your Windows user folder:
```text
C:\Users\<your-user>\openai.properties
```
File content:
```properties
OPENAI_API_KEY=sk-proj-your-key
OPENAI_MODEL=gpt-4.1-mini
```

Then start Remix normally:
```powershell
npm run dev
```

You can also override the file using environment variables:
```powershell
$env:OPENAI_API_KEY="sk-proj-your-key"
npm run dev
```

Optional:
```powershell
$env:OPENAI_MODEL="gpt-4.1-mini"
```
The Remix app currently serves the existing dashboard HTML and assets from the project root. API calls use the same origin as the Remix page, so no separate `localhost:3001` proxy is needed when using `npm run dev`.

Useful Remix routes:
```text
http://localhost:44100/           Main dashboard
http://localhost:44100/stocks     Stocks view
http://localhost:44100/etfs       ETF view
http://localhost:44100/portfolio  Portfolio modal
http://localhost:44100/replay     Replay modal
```

Startup performance endpoints:
```text
GET /dashboard-bootstrap  One-shot settings, prefs, favorites, portfolio, ETF cache
GET /dashboard-market     Yahoo indices + stock quote batch for first load
```

## How it works

- `ticker_proxy.js` serves as a local proxy for:
  - `GET /health`
  - `GET /dashboard-bootstrap` for startup prefs, settings, portfolio, and cache metadata
  - `GET /dashboard-market?symbols=A,B` for first-load indices and quotes
  - `GET /nse?path=/api/...` for NSE India data
  - `GET /yahoo?symbols=A,B` for Yahoo Finance stock quotes
  - `GET /yahoo/indices` for index summaries
  - `POST /openai` for OpenAI-backed AI mode and fundamentals chat
  - `GET /etf-prefs` to persist custom ETF symbol preferences
  - `GET /stock-prefs` to persist custom stock symbol preferences
- The dashboard fetches live prices and renders a midcap stock watch table, sector heatmap, and ETF tracker.

## Notes

- Yahoo and NSE modes run through the integrated proxy when using Remix at `http://localhost:44100`.
- AI mode requires `OPENAI_API_KEY` in `C:\Users\<your-user>\openai.properties` or on the proxy process and may be slower.
- Custom ETF symbols are saved to `saved_etfs.json` on the proxy and also cached in browser localStorage for refresh persistence.
- Custom stock symbols are saved to `saved_stocks.json` on the proxy and also cached in browser localStorage for refresh persistence.
 
