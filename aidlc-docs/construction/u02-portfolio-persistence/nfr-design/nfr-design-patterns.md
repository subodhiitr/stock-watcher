# U02 Portfolio Persistence NFR Design Patterns

## Pattern 1 - Single Database Owner

One lifecycle object constructs the SQLite connection, applies settings, owns prepared statements, supplies transactions, coordinates backup, reports health, and closes resources. No other component imports the driver.

Supports NFR-U02-020, NFR-U02-024, NFR-U02-050, and NFR-U02-054.

## Pattern 2 - Fail-Closed Path and Encryption Gate

Canonical path policy runs before open. Persistent database and backup paths require an injected positive OS-encryption attestation. Protected legacy identities and aliases are denied. Temporary test attestation uses a distinct type.

Supports NFR-U02-038 and NFR-U02-040 through NFR-U02-046.

## Pattern 3 - Immutable Checksummed Migration Registry

Migration definitions are source-ordered values with stable ID, name, normalized SQL checksum, optional reversal checksum, and assertions. Startup compares the complete applied prefix with the ledger and `user_version`.

Supports NFR-U02-010, NFR-U02-032, NFR-U02-033, NFR-U02-051, NFR-U02-060, and NFR-U02-062.

## Pattern 4 - Seed Registry Without Upsert Reset

Reserved seed keys and IDs are inserted only when absent. Existing seed identities are verified, but mutable portfolio state is never updated during initialization.

Supports NFR-U02-037 and NFR-U02-064.

## Pattern 5 - Canonical Exact Persistence Codec

A single codec layer converts U01 values to canonical database scalars and back. Repository modules cannot parse money, quantities, weights, dates, versions, identifiers, or events independently.

Supports NFR-U02-035, NFR-U02-036, NFR-U02-044, NFR-U02-045, NFR-U02-052, and NFR-U02-065.

## Pattern 6 - Normalized Snapshot Mapper

Portfolio root, allocation history, assignments, holdings, and lots are loaded in canonical identifier order, assembled once, and passed to `Portfolio.rehydrate`. No partial aggregate escapes.

Supports NFR-U02-001 through NFR-U02-003, NFR-U02-012, NFR-U02-013, NFR-U02-017, and NFR-U02-036.

## Pattern 7 - Synchronous Immediate Unit of Work

The unit of work executes one synchronous callback inside `BEGIN IMMEDIATE`. It creates transaction-scoped repositories and event staging, rejects nesting and Promise results, maps expected driver outcomes after rollback, and returns events only after commit.

Supports NFR-U02-014, NFR-U02-015, NFR-U02-021 through NFR-U02-025, NFR-U02-031, and NFR-U02-063.

## Pattern 8 - Append-Only Event Fact Plus Mutable Dispatch

Canonical events append to a hash-chained immutable table. A separate dispatch row records publication state. Both rows commit with aggregate state.

Supports NFR-U02-004, NFR-U02-005, NFR-U02-016, NFR-U02-031, NFR-U02-034, and NFR-U02-045.

## Pattern 9 - Prepared Statement Catalog

All SQL is a reviewed constant in the U02 adapter. Dynamic values are bound parameters. Dynamic identifiers and arbitrary fragments are forbidden. Statements are finalized with the owner.

Supports NFR-U02-018, NFR-U02-042, NFR-U02-050, and NFR-U02-052.

## Pattern 10 - Bounded Contention

SQLite busy timeout is configured once and never exceeds five seconds. U02 performs no hidden retry loop. Busy/locked maps to an explicit retryable failure after rollback.

Supports NFR-U02-022 and NFR-U02-023.

## Pattern 11 - Verified Owner-Mediated Backup

Backup uses the live owner through the driver backup API or reviewed `VACUUM INTO`, then opens the result read-only and verifies schema, integrity, accounting, seeds, and event heads.

Supports NFR-U02-039, RESILIENCY-02, RESILIENCY-04, and U02 portions of RESILIENCY-11 through RESILIENCY-13.

## Pattern 12 - Generated Temporary Database Harness

Each test owns a unique fixture root, fake attestation, owner, and cleanup closure. The harness records a protected legacy sentinel and permits deletion only after close beneath the exact generated root.

Supports NFR-U02-038, NFR-U02-046, NFR-U02-061 through NFR-U02-068.

## Pattern 13 - Health Without Mutation

Shallow health reports owner lifecycle and settings. Deep health performs bounded read-only quick check, foreign-key, migration, attachment, seed, and event-head verification. It never repairs state.

Supports NFR-U02-011, NFR-U02-024, NFR-U02-030, and RESILIENCY-06.

## Pattern 14 - Deterministic Capacity Harness

Fixtures generate approved representative and boundary sizes. Query plans assert index usage. Benchmarks report environment, seed, p50, p95, maximum, database size, and heap delta.

Supports NFR-U02-001 through NFR-U02-018, NFR-U02-061, and NFR-U02-068.

## Failure Containment

- Configuration and attestation fail before open.
- Migration and seed failures roll back their active transaction and keep the owner FAULTED.
- Repository DomainFailure rolls back without partial result.
- Unknown exception and invariant corruption roll back and propagate.
- Commit failure returns no post-commit events.
- Backup failure cannot modify source and removes only its exact incomplete output.

## Extension Compliance

### Security

- SECURITY-01: Patterns 2 and 11 enforce attested encrypted locations.
- SECURITY-05: Patterns 5 and 9 enforce typed values and prepared statements.
- SECURITY-10: Existing exact locked driver; no added U02 runtime dependency.
- SECURITY-11: Owner, attestation, migration, repository, and event responsibilities are separate.
- SECURITY-13: Patterns 3, 5, 7, 8, and 11 preserve integrity.
- SECURITY-15: Every pattern fails closed and has explicit containment.
- Other security controls are N/A to this in-process storage unit.

### Resiliency

- Criticality, bounded contention, lifecycle health, guarded rollback, and consistent backup satisfy applicable U02 portions.
- Recovery scheduling, retention, alerts, incidents, and RESILIENCY-14 remain U06.
- Cloud redundancy and autoscaling are N/A.

### Property-Based Testing

- Migration, seed, codec, repository, transaction, event-chain, fixture-path, and backup models are testable with constrained generators and shrinking.
- Ordinary properties run 500 cases; expensive storage properties run 50; migration commands run 250 sequences.

