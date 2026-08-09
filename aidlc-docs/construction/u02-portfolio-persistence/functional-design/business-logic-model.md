# U02 Portfolio Persistence Business Logic Model

## Scope and Dependency

U02 implements the only connection, migration, transaction, and backup-consistency boundary for `portfolio-management.db`. It consumes U01 exact values, Portfolio snapshots, domain events, stable failures, repository ports, and synchronous transaction contracts. It never opens, attaches, migrates, writes, deletes, or replaces `stock-watcher.db`.

## Primary Outcomes

1. Initialize a fresh encrypted-at-rest portfolio database deterministically.
2. Apply immutable numbered migrations and verify their checksums.
3. Register strategy seed rows and exactly one stable paper portfolio without resetting later user state.
4. Rehydrate and save isolated Portfolio aggregates using canonical exact-value codecs.
5. Commit aggregate state, immutable audit facts, and dispatch intent atomically.
6. Return post-commit events only after a successful commit.
7. Supply consistent owner-mediated backup snapshots and temporary test databases.

## Database Owner Lifecycle

| State | Allowed operations | Transition |
|---|---|---|
| NEW | initialize, close | initialize -> OPEN or FAULTED |
| OPEN | repositories, unit of work, health, backup, close | close -> CLOSED; fatal integrity failure -> FAULTED |
| FAULTED | health, close | close -> CLOSED |
| CLOSED | health | terminal |

- Initialization is single-flight within the process.
- Repeated initialization of an OPEN owner is an idempotent no-op.
- Repository or transaction access outside OPEN fails closed.
- Close rejects new work, waits for active synchronous work to leave the owner boundary, checkpoints WAL when safe, then closes exactly once.

## Initialization Flow

1. Validate database-owner configuration.
2. Canonicalize the requested portfolio database path.
3. Reject the configured path when it equals, aliases, or resolves beneath a protected legacy database file.
4. Require encryption attestation for a persistent database and backup destination. Only an explicit temporary-test configuration may bypass production attestation.
5. Open one owner-controlled SQLite connection.
6. Apply defensive connection settings:
   - foreign keys enabled;
   - WAL journal mode;
   - synchronous FULL for critical writes;
   - bounded busy timeout;
   - trusted schema disabled;
   - recursive triggers disabled unless a reviewed migration requires them.
7. Inspect `PRAGMA database_list`; accept only `main` and transient `temp`. Reject every attached database.
8. Start `BEGIN IMMEDIATE`.
9. Create or validate the migration ledger bootstrap.
10. Verify every applied migration ID, name, checksum, direction, and resulting schema version.
11. Apply each pending forward migration in ascending order, one migration transaction at a time.
12. Start a seed transaction after the target schema is current.
13. Insert immutable seed definitions by reserved seed key when absent:
    - adaptive-momentum-quality short version 1.0.0;
    - adaptive-momentum-quality medium version 1.0.0;
    - adaptive-momentum-quality long version 1.0.0.
14. Insert the reserved `Paper Portfolio` only if its stable seed key is absent.
15. Seed INR 1,000,000 by default, or the validated configured amount, only on first insertion.
16. Persist its PAPER mode and initial adaptive-momentum-quality assignment.
17. Append creation audit fact and dispatch intent in the same seed transaction.
18. Commit.
19. Run quick integrity, foreign-key, migration-ledger, seed-cardinality, and event-chain checks.
20. Enter OPEN only after all checks succeed.

## Seed Idempotency

- Stable seed keys, not display names, identify system seeds.
- Seed IDs are reserved deterministic constants with the same canonical values across fresh databases.
- `INSERT ... ON CONFLICT DO NOTHING` semantics are allowed only on the reserved seed key.
- Existing seed rows are validated for immutable identity and schema compatibility.
- Initialization never updates current cash, mode, status, active allocation, holdings, or user-visible name after first creation.
- A missing dependent seed row with a present paper portfolio is an integrity failure, not an instruction to reset the portfolio.
- An archived or renamed seeded portfolio remains archived or renamed; initialization does not recreate it.

## Forward Migration Flow

1. Validate requested target version and migration registry.
2. Compare migration registry with the persisted ledger.
3. Reject removed, reordered, duplicated, or checksum-changed applied migrations.
4. Acquire the immediate write transaction.
5. Recheck current version after lock acquisition.
6. Execute one parameter-free reviewed migration body.
7. Run migration-local schema and data assertions.
8. Record migration ID, name, forward checksum, reversal checksum, applied time, and application version.
9. Set `user_version` to the same target.
10. Commit.
11. Repeat until current.

Migration failure rolls back the active migration completely. Previously committed migrations remain applied and valid.

## Guarded Reversal Flow

Reversal never runs automatically during normal startup.

1. Require the database owner to be in maintenance mode with no active work.
2. Require a verified backup checkpoint created after the last successful write.
3. Require the current migration to be explicitly reversible.
4. Verify persisted and registered reversal checksums.
5. Execute exactly one reversal inside `BEGIN IMMEDIATE`.
6. Run the reversal assertions.
7. remove only that migration-ledger row and decrement `user_version`.
8. Commit and run full integrity checks.

An irreversible migration requires forward repair or backup restore; the system never guesses a reversal.

## Repository Read Flow

1. Parse and validate PortfolioId before SQL.
2. Use prepared parameterized statements only.
3. Load the portfolio root.
4. Load the one current allocation policy and canonical sleeve rows.
5. Load holdings and lots ordered by canonical identifiers.
6. Parse every exact TEXT integer, state version, timestamp, date, status, mode, and identifier through U01 codecs.
7. Build a PortfolioSnapshot.
8. Call `Portfolio.rehydrate`.
9. Convert expected absence to success with no value.
10. Treat malformed persisted values, missing required children, duplicate children, or invariant exceptions as persistence-integrity failure.

No partially rehydrated Portfolio is returned.

## Repository Insert Flow

1. Require an active U02 transaction.
2. Validate the complete Portfolio through its trusted snapshot.
3. Check active normalized-name uniqueness.
4. Insert the portfolio root at state version 1.
5. Insert its allocation policy and assignments.
6. Insert holdings and lots if present.
7. Require the transaction to stage the exact PortfolioCreated event.
8. Defer success until event-ledger and dispatch rows are written by the unit of work.

Database uniqueness and foreign-key failures map to stable persistence codes without SQL text or paths.

## Repository Save Flow

1. Require an active U02 transaction.
2. Validate the supplied Portfolio snapshot.
3. Update the portfolio root using both PortfolioId and expected state version.
4. Require exactly one changed root row for a state-changing save.
5. On zero rows, distinguish not-found from optimistic version conflict with a bounded follow-up query.
6. Replace current child state only inside the same transaction:
   - close the prior allocation validity interval and insert the new immutable allocation version;
   - upsert current holdings by identity;
   - insert or update open-lot state without crossing portfolio scope;
   - remove no historical audit or closed allocation row.
7. Require staged events to match portfolio ID and resulting state version.
8. Return success to the transaction callback.

## Synchronous Unit-of-Work Flow

1. Reject a Promise-returning or nested transaction callback.
2. Begin IMMEDIATE.
3. Construct transaction-scoped repositories and an empty ordered event staging list.
4. Execute the callback synchronously.
5. If it returns DomainFailure, roll back and return that failure with no state or event.
6. If it throws an expected SQLite constraint or busy error, roll back and map it to a stable failure.
7. If it throws an invariant or unknown error, roll back and rethrow to the safe application boundary.
8. Validate staged event order, uniqueness, aggregate binding, and state version.
9. Serialize each event canonically.
10. Append each immutable event-ledger row with stream sequence, previous hash, and SHA-256 hash.
11. Insert one pending dispatch row per event.
12. Commit.
13. Return the callback value and immutable post-commit events.

Event publication is not part of U02's transaction and never occurs before commit.

## Audit Hashing

- Stream key is `portfolio:<PortfolioId>` for U01 portfolio facts.
- Stream sequence starts at 1 and increments without gaps.
- Previous hash is a fixed genesis value for sequence 1 and the prior event hash afterward.
- Hash input is a canonical UTF-8 envelope containing stream key, sequence, previous hash, event ID, event type, schema version, portfolio ID, aggregate version, occurred-at instant, actor/command/correlation/causation IDs, and canonical payload.
- SHA-256 output is lowercase hexadecimal.
- Event ID, stream key plus sequence, and stream key plus event hash are unique.
- Update and delete triggers abort for event-ledger rows.
- Dispatch status is stored separately so delivery bookkeeping cannot mutate the audit fact.

## Temporary Test Database Flow

- Tests request an explicit temporary-test owner.
- The owner creates a unique directory and database path beneath the test runner's temporary root.
- Production path defaults and seed database paths are never inherited.
- Encryption attestation may be replaced only by a typed test attestation.
- Each owner initializes, migrates, and seeds independently.
- Close removes handles; the test fixture deletes only its exact temporary directory.
- Tests record a sentinel hash for `stock-watcher.db` before and after migration and initialization scenarios.

## Backup Coordination Contract

U02 exposes a consistency capability; retention and scheduling belong to U06.

1. Validate and attest the destination path.
2. Reject destinations equal to either the active portfolio database or protected legacy database.
3. Use SQLite online backup or reviewed `VACUUM INTO` through the owner connection.
4. Complete the database copy without exposing a raw connection.
5. Open the destination read-only.
6. Verify schema version, quick check, foreign keys, seed cardinality, exact accounting, and audit-chain heads.
7. Return immutable metadata: source database ID, schema version, started/completed instants, byte size, SHA-256 checksum, and audit stream heads.
8. On failure, delete only the incomplete destination selected for this backup attempt.

## Failure Precedence

1. Owner lifecycle and configuration.
2. Canonical path and encryption attestation.
3. Database identity and attachment isolation.
4. Migration ledger and schema compatibility.
5. Transaction availability.
6. Input identifier and exact-value parsing.
7. Portfolio existence and optimistic state version.
8. Database constraints and aggregate invariants.
9. Event binding, sequence, and hash integrity.
10. Commit outcome.

## PBT-01 Property Analysis

| Component | Categories | Required properties |
|---|---|---|
| Exact persistence codecs | Round trip | Every valid U01 exact value persists and rehydrates equivalently |
| Migration registry | Idempotence, state model | Repeated migrate is a no-op; valid forward/reversal sequences match a schema-version model |
| Seed registry | Idempotence, invariant | Repeated initialization preserves one seed and never resets changed portfolio state |
| Portfolio repository | Round trip, invariant | Insert/load and save/load preserve aggregate equality and portfolio scope |
| Unit of work | Invariant, easy oracle | Failure or throw rolls back all rows; success commits state, event, and dispatch together |
| Optimistic save | State model | Exactly one writer advances a given expected version |
| Event ledger | Invariant, state model | Sequence has no gaps, hashes verify, facts cannot be changed or deleted |
| Temporary database | Invariant | Generated operations never change the protected legacy sentinel |
| Backup snapshot | Round trip, invariant | Verified backup reopens with equivalent schema, state, and event-chain heads |

## Story Traceability

| US-001 criterion | Design coverage |
|---|---|
| Fresh isolated database | Owner lifecycle, canonical path denial, attachment assertion, migration flow |
| Exactly one paper portfolio | Stable seed registry and cardinality checks |
| INR 1,000,000 configurable cash | Exact TEXT minor-unit seed with first-insert-only configuration |
| Adaptive strategy 1.0.0 | Immutable strategy and assignment seed identities |
| Repeated initialization | Migration and seed idempotency |
| Legacy database unchanged | Protected path rules, no ATTACH, database-list and sentinel tests |
| Encryption and audit integrity | Encryption attestation, atomic event ledger, hash chain, verified backup |

