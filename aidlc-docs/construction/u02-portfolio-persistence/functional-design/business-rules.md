# U02 Portfolio Persistence Business Rules

## Database Ownership

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-001 | Exactly one PortfolioDatabaseOwner constructs and owns each connection. | `PERSISTENCE_OWNER_REQUIRED` |
| BR-U02-002 | Repository, migration, transaction, health, and backup work require an OPEN owner. | `PERSISTENCE_NOT_OPEN` |
| BR-U02-003 | Initialization and close are idempotent. | N/A |
| BR-U02-004 | Nested unit-of-work transactions are forbidden. | `NESTED_TRANSACTION_FORBIDDEN` |
| BR-U02-005 | An asynchronous value cannot cross the synchronous SQLite transaction callback. | `ASYNC_TRANSACTION_FORBIDDEN` |
| BR-U02-006 | Raw database handles and prepared statements never leave U02. | `PERSISTENCE_CAPABILITY_LEAK` |

## Path, Encryption, and Isolation

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-010 | Persistent data uses the canonical configured `portfolio-management.db` path. | `INVALID_DATABASE_PATH` |
| BR-U02-011 | The portfolio path and every backup destination must differ from the protected legacy database under canonical and filesystem identity checks. | `PROTECTED_DATABASE_PATH` |
| BR-U02-012 | Production open requires positive OS-encryption attestation for database and backup locations. | `ENCRYPTION_AT_REST_REQUIRED` |
| BR-U02-013 | Only a typed temporary-test owner may use test encryption attestation. | `INVALID_ENCRYPTION_ATTESTATION` |
| BR-U02-014 | U02 never issues ATTACH and rejects `database_list` entries other than main and temp. | `DATABASE_ATTACHMENT_FORBIDDEN` |
| BR-U02-015 | Tests and migrations never open the protected legacy database. | `PROTECTED_DATABASE_ACCESS` |
| BR-U02-016 | Error context excludes database paths, keys, SQL text, and raw SQLite messages. | `SENSITIVE_PERSISTENCE_CONTEXT` |

## Connection Configuration

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-020 | Foreign-key enforcement is enabled and verified. | `FOREIGN_KEYS_DISABLED` |
| BR-U02-021 | Persistent connections use WAL, synchronous FULL, and a bounded busy timeout. | `INVALID_SQLITE_CONFIGURATION` |
| BR-U02-022 | Trusted schema is disabled. | `INVALID_SQLITE_CONFIGURATION` |
| BR-U02-023 | Startup verifies quick check, foreign keys, migration parity, and event-chain heads before OPEN. | `DATABASE_INTEGRITY_FAILED` |
| BR-U02-024 | Busy and locked outcomes fail with bounded retryability and never spin indefinitely. | `DATABASE_BUSY` |
| BR-U02-025 | Safe close prevents new transactions and closes once. | `DATABASE_CLOSING` |

## Migration Rules

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-030 | Migration IDs are positive, unique, immutable integers applied in ascending order. | `INVALID_MIGRATION_REGISTRY` |
| BR-U02-031 | Each migration has immutable name, forward checksum, reversal checksum or explicit irreversible marker, and assertions. | `INVALID_MIGRATION_DEFINITION` |
| BR-U02-032 | Applied migration checksums must match the compiled registry. | `MIGRATION_CHECKSUM_MISMATCH` |
| BR-U02-033 | Ledger maximum version and SQLite `user_version` must match. | `SCHEMA_VERSION_MISMATCH` |
| BR-U02-034 | One forward migration commits atomically with its ledger row and `user_version`. | `MIGRATION_FAILED` |
| BR-U02-035 | Re-running at the current version changes no schema or data. | N/A |
| BR-U02-036 | Missing or reordered applied migration definitions fail closed. | `MIGRATION_HISTORY_DIVERGED` |
| BR-U02-037 | Automatic startup never runs a reversal. | `AUTOMATIC_REVERSAL_FORBIDDEN` |
| BR-U02-038 | Reversal requires maintenance mode and a verified current backup checkpoint. | `MIGRATION_BACKUP_REQUIRED` |
| BR-U02-039 | Irreversible migrations use forward repair or restore, never inferred SQL. | `MIGRATION_IRREVERSIBLE` |

## Seed Rules

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-040 | Seed rows use reserved immutable seed keys and deterministic identifiers. | `INVALID_SEED_IDENTITY` |
| BR-U02-041 | A fresh target schema contains exactly one reserved Paper Portfolio. | `PAPER_PORTFOLIO_SEED_FAILED` |
| BR-U02-042 | The first paper seed uses ACTIVE, PAPER, INR, no broker account, and the configured non-negative starting cash. | `INVALID_PAPER_PORTFOLIO_SEED` |
| BR-U02-043 | Default starting cash is INR 1,000,000, represented as 100,000,000 minor units. | `INVALID_PAPER_CASH_SEED` |
| BR-U02-044 | Initialization registers short, medium, and long adaptive-momentum-quality preset records at version 1.0.0 exactly once. | `STRATEGY_PRESET_SEED_FAILED` |
| BR-U02-045 | The paper portfolio starts with the approved adaptive-momentum-quality 1.0.0 assignment. | `STRATEGY_ASSIGNMENT_SEED_FAILED` |
| BR-U02-046 | Repeated initialization never resets renamed, archived, reconfigured, or traded seed state. | `SEED_STATE_RESET_FORBIDDEN` |
| BR-U02-047 | A conflicting reserved seed identity is an integrity failure, not an upsert instruction. | `SEED_IDENTITY_CONFLICT` |
| BR-U02-048 | Seed state and its creation event commit in one transaction. | `SEED_AUDIT_ATOMICITY_FAILED` |

## Exact Persistence and Schema Integrity

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-050 | Money and quantities persist as canonical base-10 TEXT integers; weights and safe versions persist as bounded INTEGER. | `INVALID_PERSISTED_EXACT_VALUE` |
| BR-U02-051 | Floating-point columns are forbidden for accounting values. | `FLOAT_ACCOUNTING_FORBIDDEN` |
| BR-U02-052 | All identifiers, statuses, modes, timestamps, dates, event types, and schema versions have database and codec validation. | `INVALID_PERSISTED_VALUE` |
| BR-U02-053 | Every portfolio-owned row carries PortfolioId and a foreign key to portfolios. | `PORTFOLIO_SCOPE_REQUIRED` |
| BR-U02-054 | Holding, lot, assignment, event, and dispatch uniqueness is enforced by schema. | `PERSISTENCE_DUPLICATE` |
| BR-U02-055 | Active normalized portfolio names are unique; archived names may be reused. | `ACTIVE_PORTFOLIO_NAME_CONFLICT` |
| BR-U02-056 | Exactly one current allocation policy exists per active or archived portfolio snapshot. | `CURRENT_ALLOCATION_INTEGRITY_FAILED` |
| BR-U02-057 | Sleeve weights are positive and aggregate validation proves an exact 1,000,000 total before persistence. | `INVALID_PERSISTED_ALLOCATION` |
| BR-U02-058 | Lot and holding scope, quantity reconciliation, delivery, reservation, no-short, and no-leverage invariants are revalidated on load. | `PERSISTED_POSITION_INTEGRITY_FAILED` |

## Repository Rules

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-060 | Repositories execute only prepared parameterized statements. | `UNPARAMETERIZED_STATEMENT_FORBIDDEN` |
| BR-U02-061 | Aggregate insert requires state version 1 and a staged PortfolioCreated event. | `INVALID_PORTFOLIO_INSERT` |
| BR-U02-062 | Aggregate save uses PortfolioId plus expected version and advances to the exact supplied resulting version. | `PERSISTENCE_VERSION_CONFLICT` |
| BR-U02-063 | A zero-row save distinguishes not-found from version conflict without exposing state to an unauthorized caller. | `PORTFOLIO_NOT_FOUND` |
| BR-U02-064 | Repository reads return either one fully rehydrated Portfolio, absence, or failure; never partial state. | `PORTFOLIO_REHYDRATION_FAILED` |
| BR-U02-065 | Child rows cannot cross portfolio or instrument scope. | `CROSS_PORTFOLIO_PERSISTENCE` |
| BR-U02-066 | Historical allocation rows and event facts are never rewritten by current-state replacement. | `PERSISTED_LINEAGE_MUTATION` |
| BR-U02-067 | Repository failures contain no partial aggregate or events. | `PERSISTENCE_ATOMICITY_FAILED` |

## Transaction and Event Rules

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-070 | State, allocation, positions, immutable events, and dispatch intent commit or roll back together. | `TRANSACTION_ATOMICITY_FAILED` |
| BR-U02-071 | Callback DomainFailure causes rollback and is returned unchanged when safe. | N/A |
| BR-U02-072 | Constraint, busy, and version outcomes map to stable failures after rollback. | `PERSISTENCE_OPERATION_FAILED` |
| BR-U02-073 | Unknown exceptions and invariant errors roll back and propagate to a safe containment boundary. | `PERSISTENCE_INVARIANT_FAILED` |
| BR-U02-074 | A successful transaction returns events only after commit completes. | `POST_COMMIT_EVENT_VIOLATION` |
| BR-U02-075 | Event ID, portfolio, aggregate version, order, and schema version must match staged state. | `PERSISTED_EVENT_MISMATCH` |
| BR-U02-076 | Event facts are immutable; UPDATE and DELETE abort at the database boundary. | `AUDIT_EVENT_IMMUTABLE` |
| BR-U02-077 | Event stream sequence is contiguous and previous hash matches the prior event. | `AUDIT_CHAIN_BROKEN` |
| BR-U02-078 | Event hash is canonical SHA-256 over the complete allowlisted fact envelope. | `AUDIT_HASH_MISMATCH` |
| BR-U02-079 | Mutable dispatch state is separate from the immutable event fact. | `AUDIT_DISPATCH_COUPLING` |

## Test and Backup Rules

| Rule | Requirement | Stable failure |
|---|---|---|
| BR-U02-080 | Every integration test owns one unique temporary database path. | `TEST_DATABASE_ISOLATION_FAILED` |
| BR-U02-081 | Test cleanup targets only the exact fixture directory after owner close. | `UNSAFE_TEST_CLEANUP` |
| BR-U02-082 | Protected legacy sentinel content is identical before and after U02 tests. | `LEGACY_DATABASE_MUTATED` |
| BR-U02-083 | Backup runs only through the database owner using a consistent SQLite mechanism. | `UNSAFE_DATABASE_BACKUP` |
| BR-U02-084 | Backup destination requires encryption attestation and must not alias source or legacy paths. | `INVALID_BACKUP_DESTINATION` |
| BR-U02-085 | A completed backup verifies schema, quick check, foreign keys, accounting, seed cardinality, and event-chain heads. | `BACKUP_VERIFICATION_FAILED` |
| BR-U02-086 | Failed backup cleanup deletes only its exact incomplete destination. | `UNSAFE_BACKUP_CLEANUP` |

## Deterministic Failure Precedence

1. Owner lifecycle.
2. Configuration, path, and encryption.
3. Database attachment and identity.
4. Migration/schema compatibility.
5. Transaction eligibility.
6. Input codecs.
7. Portfolio existence and state version.
8. Constraints and aggregate integrity.
9. Event chain and dispatch.
10. Commit or backup outcome.

## Property Coverage

| Rules | Property |
|---|---|
| BR-U02-030 through BR-U02-039 | Migration state model, idempotence, checksum immutability, guarded reversal |
| BR-U02-040 through BR-U02-048 | Seed idempotence and user-state preservation |
| BR-U02-050 through BR-U02-058 | Exact codec and aggregate round trips |
| BR-U02-060 through BR-U02-067 | Repository isolation and optimistic concurrency |
| BR-U02-070 through BR-U02-079 | Commit/rollback atomicity and event-chain model |
| BR-U02-080 through BR-U02-086 | Generated temporary database isolation and backup equivalence |

## Extension Compliance

### Security

- SECURITY-01: Applicable. Production paths require OS-encryption attestation; backup paths are attested and verified.
- SECURITY-05: Applicable at persistence input boundaries through strict codecs and prepared statements.
- SECURITY-10: Applicable during code generation for locked SQLite dependencies and vulnerability evidence.
- SECURITY-11: Applicable. Owner, migration, event, and encryption components remain isolated.
- SECURITY-13: Applicable. Constraints, checksums, optimistic versions, canonical event hashes, and verified backups protect integrity.
- SECURITY-15: Applicable. Unknown schema, malformed state, missing encryption, and broken audit chains fail closed.
- Other endpoint, authentication, IAM, network, browser, and monitoring rules are N/A to U02.

### Resiliency

- RESILIENCY-01: Applicable because portfolio persistence is Critical.
- RESILIENCY-02: Applicable to recovery metadata and the one-hour RPO/hours-level RTO contract.
- RESILIENCY-04: Applicable to guarded migration reversal and backup prerequisite.
- RESILIENCY-06: Applicable to database owner health.
- RESILIENCY-07: Applicable to capacity and backup verification.
- RESILIENCY-10: Applicable to bounded busy handling and SQLite backup deadlines.
- RESILIENCY-11 through RESILIENCY-13: Shared with U06; U02 supplies consistent backup and restore-verification primitives.
- RESILIENCY-14 remains assigned to U06.
- Cloud availability and autoscaling rules are N/A.

### Property-Based Testing

- PBT-01: Complete through the component analysis.
- PBT-02 through PBT-07: Applicable to codecs, migrations, seeds, repositories, transactions, chains, and backups.
- PBT-08 through PBT-10: Mandatory during U02 Code Generation and coordinated by U09.

