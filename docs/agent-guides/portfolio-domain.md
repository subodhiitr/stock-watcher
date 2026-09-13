# Portfolio domain

## Responsibility

The typed portfolio bounded context models portfolios, holdings, strategy allocations, rebalancing plans, executions, market-data evidence, operations, and domain events without depending on HTTP, SQLite, Remix, or broker SDKs.

## Layer map

- `server/portfolio/domain/` contains entities, value objects, commands, policies, invariants, events, and pure calculations.
- `server/portfolio/ports/` contains dependency interfaces for persistence, market data, execution, strategy, rebalancing, and operations.
- `server/portfolio/index.ts` is the public export surface for domain and port types.
- `server/portfolio/application/` coordinates use cases but should depend on domain types and ports rather than concrete adapters.

## Design rules

- Keep money, quantity, weight, identifiers, dates, and state versions in their existing value-object helpers.
- Return `DomainResult` or the established domain failure types for expected invalid operations.
- Preserve immutable snapshots, canonical serialization, event aggregate binding, and state-version checks.
- Do not import Node HTTP, SQLite, broker SDKs, or UI modules into `domain/`.
- Add new public types to `server/portfolio/index.ts` only when they are intentionally part of the context API.

## Exploration path

Start with the relevant domain folder (`portfolio`, `strategy`, `rebalancing`, `execution`, `market-data`, or `operations`), then inspect its ports and application service callers. Read neighboring tests before changing invariants.

## Validation

Run `npm run typecheck:portfolio` and the narrow portfolio test selector. Domain changes often need exact-value, property-based, model, and architecture coverage.
