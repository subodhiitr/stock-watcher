# AGENTS.md

Guidance for coding agents working in this repository.

## Code exploration

- This repository is indexed by CodeGraph (`.codegraph/` exists). Use CodeGraph before `rg`, file-by-file reading, or broad searches when locating code, tracing behavior, or estimating blast radius.
- Preferred command on this Windows machine:
  `C:\Users\subod\AppData\Roaming\npm\codegraph.cmd explore "<question or symbols>"`
- Treat CodeGraph source output as the current on-disk source. Use `rg` afterward only for exact-text checks, assets, configuration, or gaps CodeGraph did not answer.

## Headroom

- Codex is routed through the local Headroom proxy at `http://127.0.0.1:8787`.
- Keep that routing intact and let Headroom optimize Codex context automatically. Do not start, stop, reconfigure, unwrap, or bypass it unless the user asks.
- To diagnose routing, run `headroom doctor` (the installed executable is `C:\Users\subod\AppData\Local\Python\pythoncore-3.14-64\Scripts\headroom.exe`).
- A normal PowerShell subprocess may report no `OPENAI_BASE_URL`; that does not mean the Codex client is unrouted. Check the `codex` row in `headroom doctor`.

## Repository layout

- `ticker_proxy.js`: local proxy and API server.
- `dashboard-app.js`: primary dashboard client behavior.
- `simulation_engine.js`: paper-trading and simulation rules.
- `backtest_simulation.js`: replay/backtest CLI.
- `server/`: database and server-side domain modules.
- `my-remix-app/`: Remix application serving the UI and integrated routes.
- `tests/`: Node test-runner coverage.

## Development commands

- Install UI dependencies: `npm.cmd --prefix my-remix-app install`
- Run locally: `npm.cmd run dev`
- Run all tests: `npm.cmd test`
- Run type checks: `npm.cmd run typecheck`
- Check an edited JavaScript file: `node --check <file>`

The local app is normally available at `http://localhost:44100/`.

## Change discipline

- Preserve unrelated user changes; the worktree may already be dirty.
- Prefer focused edits and add or update tests for behavioral changes.
- Run the narrowest relevant test first, then the full test suite when practical.
- Keep `/trade-execution` as the canonical trade API; `/paper-trades` is a compatibility alias.
- Treat the server's simulation runtime state as authoritative for UI behavior.
- Never commit `.env`, API keys, broker credentials, logs, or snapshot database files.
- Do not alter persisted trading data or execute real trades unless the user explicitly requests it.
