# U02 Portfolio Persistence Code Generation Plan

## Scope

- **Primary story**: US-001
- **Dependency**: Approved and verified U01
- **Runtime**: Existing Node 24 ESM TypeScript boundary
- **SQLite**: Existing `better-sqlite3` 12.11.1
- **Frontend, HTTP, broker, scheduler, cloud deployment**: N/A

## Exact Paths

### Modify

- `.gitignore`
- `package.json`
- `package-lock.json`
- `server/portfolio/domain/errors/failure.ts`
- `server/portfolio/domain/errors/result.ts`
- `server/portfolio/ports/index.ts`
- `server/portfolio/index.ts`

### Create Runtime

- `server/portfolio/infrastructure/persistence/configuration.ts`
- `server/portfolio/infrastructure/persistence/encryption-attestation.ts`
- `server/portfolio/infrastructure/persistence/failures.ts`
- `server/portfolio/infrastructure/persistence/path-policy.ts`
- `server/portfolio/infrastructure/persistence/health.ts`
- `server/portfolio/infrastructure/persistence/backup.ts`
- `server/portfolio/infrastructure/persistence/database-owner.ts`
- `server/portfolio/infrastructure/persistence/migrations/types.ts`
- `server/portfolio/infrastructure/persistence/migrations/001-initial-schema.ts`
- `server/portfolio/infrastructure/persistence/migrations/index.ts`
- `server/portfolio/adapters/persistence/codecs.ts`
- `server/portfolio/adapters/persistence/statement-catalog.ts`
- `server/portfolio/adapters/persistence/snapshot-mapper.ts`
- `server/portfolio/adapters/persistence/event-ledger.ts`
- `server/portfolio/adapters/persistence/portfolio-repository.ts`
- `server/portfolio/adapters/persistence/unit-of-work.ts`
- `server/portfolio/persistence.ts`

### Create Verification

- `tests/portfolio/persistence/support.ts`
- `tests/portfolio/persistence/initialization.test.ts`
- `tests/portfolio/persistence/repository.test.ts`
- `tests/portfolio/persistence/transactions.test.ts`
- `tests/portfolio/persistence/persistence.property.test.ts`
- `tests/portfolio/persistence/architecture.test.ts`
- `benchmark/portfolio-persistence.ts`
- `aidlc-docs/construction/u02-portfolio-persistence/code/code-summary.md`

## Generation Steps

### Step 1 - Extensible Failures and Tooling

- [x] Generalize U01 results for typed downstream failure unions without weakening U01 closed codes.
- [x] Add exact development types for the existing SQLite driver.
- [x] Add focused U02 typecheck, test, contract, and benchmark scripts.
- [x] Ignore active, WAL, SHM, backup, and temporary portfolio database artifacts.

### Step 2 - Configuration, Paths, Attestation, and Failures

- [x] Implement owner configuration and lifecycle types.
- [x] Implement canonical protected path policy and explicit temporary-test paths.
- [x] Implement encryption-attestation contract and test attestation.
- [x] Implement stable safe U02 failures.

### Step 3 - Migrations and Schema

- [x] Implement immutable migration definitions and checksums.
- [x] Implement initial normalized schema, constraints, indexes, triggers, and migration ledger.
- [x] Implement forward application, idempotence, parity checks, and guarded reversal contract.

### Step 4 - Codecs, Mapper, Repository, and Events

- [x] Implement exact persistence codecs and canonical JSON/hash helpers.
- [x] Implement normalized Portfolio snapshot write and full rehydration.
- [x] Implement prepared statement repository with active-name and optimistic-version rules.
- [x] Implement immutable event-chain append and dispatch intent.

### Step 5 - Unit of Work and Database Owner

- [x] Implement synchronous immediate transaction scope, rollback, event staging, and post-commit extraction.
- [x] Implement owner initialize, pragma verification, migration, stable seeds, health, and close.
- [x] Implement owner-mediated verified backup metadata and source-safety rules.
- [x] Export only reviewed persistence factories and types.

### Step 6 - Examples and Integration Tests

- [x] Verify fresh and repeated initialization, exact seed cardinality, and changed-state preservation.
- [x] Verify protected legacy data remains unchanged and no database is attached.
- [x] Verify insert/load, archive/save/load, allocation, holdings/lots, and optimistic conflicts.
- [x] Verify state-event-dispatch atomicity, rollback, event immutability, and hash sequence.

### Step 7 - Property and State-Model Tests

- [x] Implement canonical scalar and aggregate round trips.
- [x] Implement repeated seed, transaction rollback, portfolio isolation, and migration-model properties.
- [x] Keep shrinking and replay metadata enabled and convert relevant counterexamples.

### Step 8 - Architecture, Capacity, and Contract Gates

- [x] Verify driver import isolation, parameterized SQL, forbidden ATTACH/legacy imports, and acyclic boundaries.
- [x] Verify schema types, constraints, triggers, and critical query plans.
- [x] Generate and inspect declarations.
- [x] Benchmark initialization, representative/boundary loads, commits, rollback, event append, heap, and database size.

### Step 9 - Documentation and Focused Verification

- [x] Generate the U02 code summary with story, rule, NFR, extension, and N/A evidence.
- [x] Run focused typecheck, examples, properties, contracts, and benchmarks.
- [x] Run full typecheck and practical compatibility tests.

### Step 10 - Review and Completion

- [x] Inspect diff, preserve unrelated changes, scan secrets, and remove generated artifacts.
- [x] Mark US-001 complete only after verification.
- [x] Update state, audit, session plan, and generated-code review gate.

## Approval Gate

No U02 runtime, dependency, schema, test, or benchmark change may be made until this plan is selected.
