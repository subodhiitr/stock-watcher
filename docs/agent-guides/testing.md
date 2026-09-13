# Tests and validation

## Test layout

- `tests/*.test.js` covers root proxy, simulation, broker, persistence, and dashboard behavior.
- `tests/portfolio/` covers typed portfolio domain, application, persistence, API, execution, operations, strategy, rebalancing, and integrated U09 behavior.
- `my-remix-app/app/**/*.test.*` covers UI controllers, state coordination, and market presentation helpers.
- `benchmark/` contains performance checks and is not a substitute for correctness tests.

## Commands

| Scope | Command |
| --- | --- |
| Root suite | `npm test` |
| UI type check | `npm run typecheck:ui` |
| Portfolio type check | `npm run typecheck:portfolio` |
| Portfolio domain | `npm run test:portfolio` |
| Portfolio persistence | `npm run test:portfolio:persistence` |
| UI portfolio tests | `npm run test:portfolio:u08` |
| Integrated acceptance | `npm run test:portfolio:u09` |
| Full portfolio verification | `npm run verify:portfolio:u09` |

## Agent workflow

Run the narrowest selector covering the changed module first. Add a regression test for behavior changes. Escalate to type checks and the full relevant suite when shared contracts, persistence, routing, or domain invariants change.

Tests must use fixtures or mocks for providers and must not alter the tracked SQLite databases, snapshot outputs, credentials, or local runtime files.
