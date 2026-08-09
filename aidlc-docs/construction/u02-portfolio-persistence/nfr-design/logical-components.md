# U02 Portfolio Persistence Logical Components

## Dependency Rule

Dependencies flow from owner and adapters toward U01 contracts and local U02 utilities. U01 never imports U02. No U02 runtime component imports routes, React, brokers, schedulers, or legacy policy.

## Components

| # | Component | Responsibility | Depends on |
|---:|---|---|---|
| 1 | PersistenceFailureMapper | Stable safe failures from reviewed driver conditions | U01 failures |
| 2 | CanonicalPersistenceCodec | Exact scalars, canonical JSON, event bytes, hashes | U01 values/events, Node crypto |
| 3 | ProtectedPathPolicy | Canonical source/destination/test path decisions | Node path/fs identity |
| 4 | EncryptionAttestationPort | Positive OS-protection evidence contract | U01 result |
| 5 | ConnectionConfigurator | Defensive SQLite pragmas and attachment assertions | Driver |
| 6 | MigrationRegistry | Immutable migration definitions and checksums | Codec |
| 7 | MigrationRunner | Forward and guarded reverse execution | Registry, configurator, failure mapper |
| 8 | SeedRegistry | Stable strategy and paper seed initialization | Codec, migration schema |
| 9 | StatementCatalog | Prepared SQL and query-plan identities | Migration schema |
| 10 | PortfolioSnapshotMapper | Normalized rows to/from U01 Portfolio | Codec, U01 aggregate |
| 11 | SqlitePortfolioRepository | Transaction-scoped repository implementation | Statements, mapper, failure mapper |
| 12 | EventLedger | Canonical hash-chain append and verification | Codec, statements |
| 13 | SqlitePortfolioTransaction | Repository capability and ordered event staging | Repository, ledger |
| 14 | SqlitePortfolioUnitOfWork | BEGIN IMMEDIATE, rollback, commit, post-commit result | Transaction, failure mapper |
| 15 | DatabaseHealthProbe | Bounded shallow/deep read-only health | Configurator, registry, seed, ledger |
| 16 | ConsistentBackupCoordinator | Attested online backup and verification metadata | Path policy, attestation, health |
| 17 | PortfolioDatabaseOwner | Lifecycle, initialization, capabilities, close | Components 3 through 16 |
| 18 | TemporaryDatabaseHarness | Generated fixture owner and constrained cleanup | Owner, fake attestation |
| 19 | PersistenceBenchmarkHarness | Capacity, query plans, latency, heap, file size | Owner, test generators |
| 20 | PublicPersistenceExports | Reviewed factories and public contracts only | Owner types, attestation types |

## Proposed Source Placement

```text
server/portfolio/infrastructure/persistence/
  configuration.ts
  database-owner.ts
  encryption-attestation.ts
  failures.ts
  health.ts
  path-policy.ts
  backup.ts
  migrations/
  sqlite/
server/portfolio/adapters/persistence/
  codecs.ts
  event-ledger.ts
  portfolio-repository.ts
  snapshot-mapper.ts
  statement-catalog.ts
  unit-of-work.ts
tests/portfolio/persistence/
benchmark/portfolio-persistence.ts
```

## Acyclic Layers

1. U01 contracts and Node standard modules.
2. Failures, codecs, path policy, and attestation contracts.
3. Configuration, migration registry, and statement catalog.
4. Mapper, repository, event ledger, health, and backup.
5. Transaction and unit of work.
6. Database owner and public exports.
7. Test and benchmark harnesses.

## Contract Boundaries

- `better-sqlite3` types remain internal to infrastructure and adapters.
- Public factories accept validated configuration and attestation capabilities.
- Repositories remain transaction-scoped and cannot commit.
- Unit of work is the only commit/rollback API.
- Backup exposes metadata, not the active connection.
- Health exposes bounded status and stable codes, not SQL or filesystem paths.

## Verification Architecture

| Concern | Verification |
|---|---|
| Import and dependency direction | Static architecture graph |
| Driver isolation | Only approved infrastructure/adapters import `better-sqlite3` |
| SQL parameterization | Statement catalog inspection and hostile values |
| Schema and query plans | Temporary database introspection |
| Migration behavior | Examples plus 250-sequence model |
| Seed preservation | Repeated initialization properties |
| Portfolio round trip | U01 aggregate equality properties |
| Atomicity | Failure injection before event, before dispatch, and before commit |
| Event immutability and hashes | Trigger tests and chain model |
| Legacy isolation | Sentinel plus database-list assertions |
| Backup | Reopen and compare state and stream heads |
| Performance | Deterministic representative/boundary benchmark |

## NFR Traceability

All NFR-U02-001 through NFR-U02-068 are assigned to at least one of Patterns 1 through 14 and Components 1 through 20. No requirement relies on an unowned downstream implementation; U06 consumes, rather than supplies, U02 backup and health primitives.

