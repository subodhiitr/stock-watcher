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

## Module guides

Read the relevant focused guide in `docs/agent-guides/` before exploring a module:

- `root-runtime.md` for `ticker_proxy.js`, HTTP routes, SSE, and server composition.
- `simulation.md` for paper-trading rules and simulation runtime state.
- `portfolio-domain.md` for typed domain entities, invariants, events, and ports.
- `portfolio-services.md` for portfolio application services, SQLite persistence, API security, and composition.
- `remix-ui.md` for the Remix server, routes, controllers, state, and portfolio components.
- `integrations.md` for market data, credentials, broker clients, candles, news, and provider adapters.
- `backtesting.md` for replay, strategy versions, research, and generated evidence.
- `testing.md` for test ownership and validation commands.

Use `docs/agent-guides/README.md` to route a request to the smallest relevant guide. These documents are navigation aids; source code and tests remain authoritative.

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
