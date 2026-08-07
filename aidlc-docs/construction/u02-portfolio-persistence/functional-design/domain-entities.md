# U02 Portfolio Persistence Domain Entities

## Ownership Boundary

U02 owns schema representation and persistence records. U01 remains the owner of financial behavior and aggregate invariants. Persistence records are never exposed as API or UI models.

## Database Identity

### DatabaseMetadata

| Field | Constraint |
|---|---|
| databaseId | Stable canonical identifier created once |
| databaseKind | `PORTFOLIO_MANAGEMENT` |
| createdAt | Canonical UTC instant |
| minimumReaderVersion | Non-negative application schema compatibility value |
| encryptionAttestationKind | OS-protected volume, OS-protected directory, or explicit temporary test |

Exactly one metadata row exists.

## Migration Entities

### MigrationDefinition

| Field | Constraint |
|---|---|
| id | Positive immutable integer |
| name | Stable bounded identifier |
| forwardChecksum | SHA-256 of normalized forward migration source |
| reversalChecksum | SHA-256 or explicit irreversible marker |
| apply | Synchronous migration function |
| reverse | Optional synchronous guarded reversal |
| assertForward | Schema/data assertions |
| assertReverse | Reversal assertions when applicable |

### AppliedMigration

| Field | Constraint |
|---|---|
| id | Primary key matching MigrationDefinition |
| name | Exact registered name |
| forwardChecksum | Exact registered checksum |
| reversalChecksum | Exact registered value |
| appliedAt | Caller-supplied canonical instant |
| applicationVersion | Bounded release identifier |

The maximum applied ID equals SQLite `user_version`.

## Seed Entities

### SeedRegistryEntry

| Field | Constraint |
|---|---|
| seedKey | Primary stable key |
| entityType | Closed seed entity category |
| entityId | Canonical referenced ID |
| seedVersion | Immutable seed schema version |
| createdAt | Canonical instant |

Seed registry rows identify original system seeds but do not grant permission to overwrite the referenced state.

### InitializationSeed

Contains:

- default non-negative INR starting cash;
- deterministic Paper Portfolio identity;
- deterministic initial assignment identity;
- deterministic short, medium, and long strategy definition and version identities;
- canonical preset payload and hash for each strategy version;
- caller-supplied initialization instant and event identity.

## Portfolio Persistence Schema

### portfolios

| Column | Representation and constraint |
|---|---|
| portfolio_id | TEXT primary key |
| display_name | TEXT, 1 through 120 validated characters |
| normalized_name_key | TEXT non-empty |
| base_currency | TEXT check `INR` |
| created_at | canonical UTC TEXT |
| status | TEXT check ACTIVE or ARCHIVED |
| operating_mode | closed U01 mode TEXT |
| cash_minor_units | canonical non-negative base-10 TEXT |
| state_version | INTEGER from 1 through safe-integer bound |
| seed_key | nullable unique reference to seed registry |
| updated_at | canonical UTC TEXT |

Indexes:

- unique active normalized name where status is ACTIVE;
- status plus portfolio ID;
- updated time plus portfolio ID.

### strategy_definitions

| Column | Constraint |
|---|---|
| strategy_id | TEXT primary key |
| strategy_key | unique canonical key |
| display_name | bounded TEXT |
| horizon | SHORT, MEDIUM, or LONG |
| seed_key | nullable unique seed reference |

U03 adds lifecycle behavior; U02 stores bootstrap identity and ownership.

### strategy_versions

| Column | Constraint |
|---|---|
| strategy_version_id | TEXT primary key |
| strategy_id | foreign key |
| semantic_version | canonical semantic version |
| canonical_payload | canonical JSON TEXT |
| payload_sha256 | lowercase 64-character hash |
| status | SEEDED, DRAFT, ACTIVE, or RETIRED |
| created_at | canonical instant |
| seed_key | nullable unique seed reference |

Unique key: strategy ID plus semantic version.

### portfolio_allocations

| Column | Constraint |
|---|---|
| allocation_record_id | TEXT primary key |
| portfolio_id | foreign key |
| policy_identity | U01 assignment or allocation identity |
| policy_kind | SINGLE or SLEEVES |
| effective_at | canonical instant |
| valid_from_version | aggregate version |
| valid_to_version | nullable aggregate version |
| is_current | INTEGER check 0 or 1 |

Unique partial key: one current allocation per portfolio.

### strategy_assignments

| Column | Constraint |
|---|---|
| assignment_id | TEXT primary key |
| allocation_record_id | foreign key |
| portfolio_id | foreign key |
| sleeve_id | nullable TEXT |
| strategy_version_id | foreign key |
| weight_ppm | INTEGER greater than 0 and at most 1,000,000 |
| effective_at | canonical instant |
| evidence_id | canonical EvidenceId |
| evidence_hash | lowercase SHA-256 |

Constraints and aggregate validation enforce one full-weight SINGLE assignment or at least two unique SLEEVES totaling exactly 1,000,000.

### holdings

| Column | Constraint |
|---|---|
| holding_id | TEXT primary key |
| portfolio_id | foreign key |
| instrument_id | TEXT |
| total_quantity | canonical non-negative base-10 TEXT |
| available_delivery_quantity | canonical non-negative base-10 TEXT |
| reserved_quantity | canonical non-negative base-10 TEXT |
| state_version | positive safe INTEGER |
| margin_funded | INTEGER fixed to 0 |

Unique key: portfolio ID plus instrument ID.

### holding_lots

| Column | Constraint |
|---|---|
| lot_id | TEXT primary key |
| holding_id | foreign key |
| portfolio_id | foreign key |
| instrument_id | TEXT |
| acquired_on | canonical LocalDate TEXT |
| original_quantity | canonical positive base-10 TEXT |
| open_quantity | canonical non-negative base-10 TEXT |
| unit_cost_minor_units | canonical non-negative base-10 TEXT |
| source_kind | IMPORT, FILL, or CORPORATE_ACTION |
| source_reference_id | bounded TEXT |

Composite foreign keys or transaction assertions keep lot portfolio and instrument equal to its holding.

## Audit and Dispatch Schema

### domain_events

| Column | Constraint |
|---|---|
| event_id | TEXT primary key |
| stream_key | canonical `portfolio:<id>` |
| stream_sequence | positive INTEGER |
| previous_hash | lowercase SHA-256 or genesis hash |
| event_hash | lowercase SHA-256 |
| event_type | closed version-aware TEXT |
| event_schema_version | positive INTEGER |
| portfolio_id | foreign key |
| aggregate_state_version | positive INTEGER |
| occurred_at | canonical instant |
| actor_id | canonical ActorId |
| command_id | canonical CommandId |
| correlation_id | canonical CorrelationId |
| causation_id | canonical CausationId |
| canonical_payload | canonical JSON TEXT |
| inserted_at | canonical commit instant |

Unique keys:

- stream key plus sequence;
- stream key plus event hash;
- portfolio ID plus aggregate version plus event ID.

Database triggers reject UPDATE and DELETE.

### event_dispatch

| Column | Constraint |
|---|---|
| event_id | primary key and foreign key to domain_events |
| status | PENDING, CLAIMED, PUBLISHED, or DEAD_LETTER |
| attempt_count | non-negative INTEGER |
| available_at | canonical instant |
| lease_owner | nullable bounded identifier |
| lease_expires_at | nullable instant |
| published_at | nullable instant |
| last_failure_code | nullable safe code |

U02 inserts PENDING atomically. U06 later owns leasing, retry, and operational policy.

## Runtime Contracts

### PortfolioDatabaseOwner

```text
initialize(config, seed, migrationContext) -> DomainResult<InitializationResult>
health() -> DatabaseHealth
withUnitOfWork(work) -> DomainResult<CommittedDomainResult<T>>
createConsistentBackup(request) -> DomainResult<BackupMetadata>
close() -> DomainResult<void>
```

### PortfolioTransaction

- exposes transaction-scoped PortfolioRepository;
- stages immutable ordered domain events;
- exposes no raw SQL, connection, commit, rollback, publish, timer, or network capability.

### PortfolioRepository

- insert Portfolio;
- get by PortfolioId;
- save with expected state version;
- query active normalized-name existence.

All operations are synchronous and valid only during the owning transaction callback.

### MigrationRegistry

- immutable ordered definitions;
- current target version;
- definition and checksum lookup;
- startup parity validation;
- guarded one-step reversal lookup.

### EncryptionAttestationPort

```text
attestDatabasePath(canonicalPath) -> DomainResult<EncryptionAttestation>
attestBackupPath(canonicalPath) -> DomainResult<EncryptionAttestation>
```

The port reports OS protection but never returns an encryption key.

### ProtectedPathPolicy

- canonical portfolio path;
- protected legacy database identities;
- allowed temporary root;
- path equality, alias, and destination safety checks.

### BackupMetadata

- backup ID;
- source database ID;
- schema version;
- canonical destination identity safe for internal use;
- started and completed instants;
- byte size;
- file SHA-256;
- immutable audit stream heads;
- verification result.

Paths are not placed in DomainFailure context, audit details, or API output.

## Persistence Failure Type

U02 extends stable failure codes without exposing SQLite details:

- lifecycle and configuration;
- protected path and encryption;
- migration and schema;
- busy and conflict;
- not found and duplicate;
- codec and rehydration;
- atomicity and event chain;
- backup and cleanup.

Adapters may retain the original exception only for a redacted internal cause chain outside client or audit payloads.

## Canonical Codec Rules

- Base-10 integer TEXT uses `0` or a non-zero digit followed by digits; no sign for non-negative values, spaces, exponent, decimal point, or leading zero.
- Event and strategy JSON uses UTF-8, explicit schema version, deterministic key ordering, no insignificant whitespace, and base-10 strings for integer values.
- All decoded domain values pass U01 factories.
- Unknown event schema versions remain stored but cannot be rehydrated as known U01 events; an operation requiring semantic use fails closed.
- Timestamps and dates use U01 canonical codecs.

## Relationships

```text
DatabaseMetadata 1
AppliedMigration *
SeedRegistryEntry * -> seeded entity 1
Portfolio 1 -> PortfolioAllocation *
PortfolioAllocation 1 -> StrategyAssignment 1..*
Portfolio 1 -> Holding *
Holding 1 -> HoldingLot *
Portfolio 1 -> DomainEvent *
DomainEvent 1 -> EventDispatch 1
StrategyDefinition 1 -> StrategyVersion *
StrategyVersion 1 -> StrategyAssignment *
```

The text relationship model is authoritative; no cross-database foreign key exists.

## PBT Generators

- valid and invalid canonical integer TEXT;
- ordered migration registries with optional checksum divergence;
- forward/reversal migration command sequences;
- valid U01 Portfolio snapshots at capacity boundaries;
- duplicate and cross-portfolio child rows;
- transaction programs containing success, DomainFailure, constraint error, and invariant throw;
- event sequences with hash, gap, order, and mutation corruption;
- repeated initialization with random user changes after first seed;
- protected path aliases and temporary fixture paths;
- backup states with valid and corrupted metadata.

