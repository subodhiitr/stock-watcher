# Portfolio application, persistence, and composition

## Responsibility

This layer turns domain use cases into authenticated HTTP operations, repository transactions, SQLite migrations, event ledgers, broker adapters, and runtime composition.

## Module map

- `server/portfolio/application/` contains API, strategy, rebalancing, execution, and operations services.
- `server/portfolio/adapters/` implements SQLite repositories, codecs, event ledgers, broker facades, and optimizer adapters.
- `server/portfolio/infrastructure/persistence/` owns database configuration, migrations, seeds, health, and path policy.
- `server/portfolio/composition/` wires concrete dependencies and the HTTP runtime.
- `server/portfolio/api/` defines request contracts, secure handling, and security headers.

## Boundaries

- Application services orchestrate; domain modules enforce business invariants.
- Ports are the dependency direction from application/domain toward infrastructure.
- Persistence changes require a migration and must preserve existing database ownership and transaction behavior.
- API handlers must validate request schemas, enforce origin/session/rate-limit/idempotency checks, and return generic safe errors.
- Keep broker and external-provider failures behind adapters and established failure types.

## Exploration path

For an endpoint, trace `server/portfolio/api/secure-handler.ts` to `application/api/portfolio-api-service.ts`, then to the relevant application service, port, adapter, and migration. For runtime wiring, inspect `composition/http-runtime.ts` and `composition/security-adapters.ts`.

## Validation

Use the relevant `test:portfolio:u0X` or persistence selector, then `npm run typecheck:portfolio` and contract tests. Do not use live broker credentials or mutate persisted trading data during tests.
