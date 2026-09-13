# Module guide index

Use these guides to scope code exploration before opening implementation files. Start with the guide that owns the requested behavior, then follow its dependency links only as needed.

| Area | Guide | Primary paths |
| --- | --- | --- |
| Root runtime and HTTP proxy | [root-runtime.md](root-runtime.md) | `ticker_proxy.js`, `server/routes/`, `server/*.js` |
| Simulation and trading rules | [simulation.md](simulation.md) | `simulation_engine.js`, `trade_rules.js`, `server/simulation-domain/`, `server/simulation-runtime-store.js` |
| Portfolio domain | [portfolio-domain.md](portfolio-domain.md) | `server/portfolio/domain/`, `server/portfolio/ports/` |
| Portfolio application and persistence | [portfolio-services.md](portfolio-services.md) | `server/portfolio/application/`, `server/portfolio/adapters/`, `server/portfolio/infrastructure/` |
| Remix UI | [remix-ui.md](remix-ui.md) | `my-remix-app/server.ts`, `my-remix-app/app/` |
| Market and broker integrations | [integrations.md](integrations.md) | `zerodha-*`, `sharekhan-*`, `server/intraday-candles.js`, `server/fresh-news.js` |
| Backtests and strategy research | [backtesting.md](backtesting.md) | `backtest_simulation.js`, `backtest/`, `strategy_versions/`, `skills/strategy-advisor/` |
| Tests and validation | [testing.md](testing.md) | `tests/`, `my-remix-app/**/*.test.*`, `package.json` |

## Fast routing

- A dashboard or API route change usually starts in `root-runtime.md`.
- A portfolio behavior change starts in `portfolio-domain.md` or `portfolio-services.md`.
- A paper-trading or entry/exit decision starts in `simulation.md`.
- A visible page or portfolio workspace change starts in `remix-ui.md`.
- A broker, quote, candle, news, or credential change starts in `integrations.md`.
- A replay, frozen strategy, score, or research change starts in `backtesting.md`.

The server simulation runtime is authoritative for simulation state. New trade integrations use `/trade-execution`; `/paper-trades` is compatibility-only.
