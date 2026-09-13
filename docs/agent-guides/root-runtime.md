# Root runtime and HTTP proxy

## Responsibility

The root runtime hosts the local Node HTTP server and coordinates the legacy dashboard APIs, market data, paper-trade execution, simulation scheduling, and the typed portfolio HTTP runtime.

## Entry points

- `ticker_proxy.js` is the main proxy/API process and owns route dispatch, service initialization, database wiring, SSE streams, and shutdown.
- `my-remix-app/server.ts` can embed the proxy in the Remix process or forward proxy routes to `PROXY_URL`.
- `server/routes/registry.js` maps request paths to route handlers.
- `server/routes/*.js` contain focused route adapters. Keep request parsing and response formatting at the route boundary.

## Important dependencies

`ticker_proxy.js` composes `server/db.js`, `simulation_engine.js`, `server/simulation-domain/`, broker clients, snapshot services, and route handlers. Avoid putting new domain rules in this composition file. Add a focused service or route module and wire it in.

## Request and safety conventions

- Use `server/http-safety.js` for JSON body limits, local-origin checks, CORS, and unsafe non-local request rejection.
- Preserve no-store behavior for state-changing or private responses.
- Preserve SSE lifecycle and backpressure behavior when changing stream routes.
- `/trade-execution` is canonical; `/paper-trades` must remain an alias unless a migration explicitly removes it.
- Simulation state comes from `server/simulation-runtime-store.js`, not from UI-local flags.

## Change checklist

1. Identify whether the endpoint is registered in `server/routes/registry.js`.
2. Keep route handlers thin and delegate calculations to a service or domain module.
3. Add or update a route contract test and a focused regression test.
4. Run `node --check` for changed CommonJS files and the relevant npm test selector.
