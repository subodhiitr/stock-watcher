# U02 Portfolio Persistence Functional Design Plan

## Unit Context

- **Unit**: U02 Portfolio Persistence
- **Primary story**: US-001 Initialize the Portfolio Domain
- **Dependency**: Approved U01 exact values, Portfolio aggregate, events, and synchronous repository/unit-of-work ports
- **Responsibility**: Own `portfolio-management.db` and its only transaction boundary
- **Criticality**: Critical
- **Functional Design depth**: Comprehensive
- **Frontend applicability**: N/A

## Plan

- [x] Analyze U02 scope, US-001, data requirements, U01 contracts, and extension obligations.
- [x] Resolve database ownership, encryption, migration, transaction, seed, audit, and backup semantics.
- [x] Define initialization, migration, repository, transaction, rollback, and post-commit event flows.
- [x] Define persistence business rules, deterministic failure precedence, and isolation constraints.
- [x] Define schema entities, relationships, keys, constraints, indexes, codecs, and ownership.
- [x] Perform PBT-01 analysis for migrations, serialization, seeds, isolation, idempotency, and transactions.
- [x] Validate Security, Resiliency, and Property-Based Testing extension compliance.
- [x] Validate artifacts and present the standardized Functional Design review gate.

## Functional Design Decisions

### Question 1 - Transaction Model

Which transaction model shall U02 use?

A) Synchronous `BEGIN IMMEDIATE` unit-of-work closures with no Promise crossing the transaction boundary; return committed results and post-commit events separately (recommended)

B) Deferred SQLite transactions with asynchronous callbacks

C) Repository-managed independent transactions

X) Other

[Answer]: A

### Question 2 - Migration Ledger

How shall numbered forward and reversal migrations be controlled?

A) Immutable migration IDs and checksums in a ledger, `user_version` parity, one atomic migration at a time, explicit guarded reversal only after backup (recommended)

B) Use only SQLite `user_version` without checksums

C) Rebuild the database from the current schema on mismatch

X) Other

[Answer]: A

### Question 3 - Seed Ownership

How shall the paper portfolio and strategy presets remain idempotent?

A) Reserved stable seed identities plus immutable seed keys; insert only when absent and never update or reset user-modified state on later initialization (recommended)

B) Match seeds by display name and update them on every start

C) Recreate seed rows whenever a schema migration runs

X) Other

[Answer]: A

### Question 4 - Database-at-Rest Encryption

How shall the local SQLite database satisfy OS-protected at-rest encryption without an unapproved native SQLite fork?

A) Require the production database and backups to reside on an OS-encrypted volume or directory, verify through an injected encryption-attestation capability, and allow bypass only for explicit temporary test databases (recommended)

B) Store an encryption key in `.env` and apply ad hoc field encryption

C) Treat local filesystem permissions as encryption

X) Other

[Answer]: A

### Question 5 - Aggregate Persistence Shape

How shall U01 Portfolio state be stored?

A) Normalized portfolios, allocation policies, sleeves, holdings, and lots with strict constraints plus canonical codecs; no opaque aggregate JSON as the source of truth (recommended)

B) One JSON blob per portfolio

C) Event sourcing only with replay on every read

X) Other

[Answer]: A

### Question 6 - Audit and Post-Commit Events

How shall financial state and audit facts commit?

A) Persist aggregate changes and immutable domain events atomically in an append-only event ledger; extract events from the committed transaction and publish only afterward (recommended)

B) Commit portfolio state first and append events asynchronously

C) Publish events before the database commit

X) Other

[Answer]: A

### Question 7 - Legacy Database Isolation

How shall U02 prove that `stock-watcher.db` cannot be affected?

A) Canonical-path deny checks, no ATTACH capability, `PRAGMA database_list` assertions, owner-only connection construction, and before/after sentinel tests (recommended)

B) Rely only on code review

C) Open the legacy database read-only in every transaction

X) Other

[Answer]: A

### Question 8 - Backup Coordination

What consistency contract shall U02 expose to U06?

A) Owner-mediated SQLite online backup or `VACUUM INTO` coordination with integrity metadata; callers never copy an open database file directly (recommended)

B) Let U06 copy the file at any time

C) Close the application for every backup

X) Other

[Answer]: A

## Expected Artifacts

- `aidlc-docs/construction/u02-portfolio-persistence/functional-design/business-logic-model.md`
- `aidlc-docs/construction/u02-portfolio-persistence/functional-design/business-rules.md`
- `aidlc-docs/construction/u02-portfolio-persistence/functional-design/domain-entities.md`
- `aidlc-docs/construction/u02-portfolio-persistence/functional-design/functional-design-approval-questions.md`
