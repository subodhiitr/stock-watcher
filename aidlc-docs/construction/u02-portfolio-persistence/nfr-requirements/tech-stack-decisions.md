# U02 Portfolio Persistence Technology Decisions

## Runtime

- Node.js 24.3 or newer.
- Native erasable TypeScript under the existing `server/portfolio/` ESM boundary.
- Strict U01 compiler settings and declaration-contract generation remain mandatory.

## SQLite Driver

- Reuse root dependency `better-sqlite3` 12.11.1.
- Do not add a second SQLite implementation, ORM, query builder, migration framework, or SQLCipher fork in U02.
- Synchronous driver semantics align with `BEGIN IMMEDIATE` and prevent a Promise from escaping transaction scope.
- Driver exceptions are mapped only after rollback and never become the public error contract.

## SQL and Migrations

- Reviewed SQL migration modules live beneath `server/portfolio/infrastructure/persistence/migrations/`.
- Migration definitions use immutable IDs, names, normalized checksums, forward functions, optional guarded reverse functions, and assertions.
- Prepared statements are centralized in adapter modules.
- Schema inspection and `EXPLAIN QUERY PLAN` are test-only verification capabilities.

## Exact Values

- Money and quantity persist as canonical base-10 TEXT.
- Weights and state versions persist as bounded SQLite INTEGER.
- No accounting value uses SQLite REAL.
- Canonical JSON is encoded by a local deterministic codec with SHA-256 from `node:crypto`.

## Encryption

- Full file-at-rest protection relies on an injected OS-encryption attestation capability.
- U02 never receives a key and does not implement ad hoc cryptography over database pages.
- Production composition must fail closed without positive attestation.
- Temporary tests use a distinct typed fake attestation.

## Transactions and Events

- One owner connection and synchronous unit-of-work.
- WAL, synchronous FULL, foreign keys ON, trusted schema OFF, and busy timeout at most 5 seconds.
- Immutable event facts and mutable dispatch state use separate tables.
- Event hashes use SHA-256 over canonical UTF-8 bytes.

## Testing

- Node built-in test runner.
- `fast-check` 4.8.0 for codecs, migration models, seed idempotency, repository round trips, transactions, and event chains.
- Generated temporary directories and database files.
- No persistent database path is used by automated tests.
- Benchmarks report environment, fixture size, seed, p50, p95, maximum, file size, and heap delta.

## Dependency Decision

U02 adds no runtime dependency. The existing locked SQLite driver is sufficient. Development tooling added by U01 is reused.

