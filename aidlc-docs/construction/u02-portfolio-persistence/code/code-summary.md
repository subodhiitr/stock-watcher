# U02 Portfolio Persistence Code Summary

## Outcome

U02 implements US-001 with an isolated SQLite persistence boundary for portfolio management. It owns its database connection, applies checksummed migrations, creates stable strategy and paper-portfolio seeds, persists exact normalized aggregate state, commits immutable hash-chained events and dispatch intent atomically, and provides verified health and backup operations.

## Runtime Changes

- Added the `server/portfolio/infrastructure/persistence/` owner, configuration, path, attestation, migration, seed, health, failure, and public-factory modules.
- Added the `server/portfolio/adapters/persistence/` codecs, statement catalog, normalized mapper, repository, event ledger, and synchronous unit of work.
- Extended the reviewed root API with persistence factory and contract exports only. Raw SQLite connections and prepared statements remain internal.
- Added `@types/better-sqlite3` as an exact development dependency. No runtime dependency was added.
- Added focused persistence scripts and ignored database, WAL, SHM, backup, declaration, and benchmark artifacts.

Backup behavior is implemented directly by the database owner rather than a separate backup class so no secondary component can acquire or copy the live database handle.

## Persistence Guarantees

- One owner constructs the connection and revokes repository and transaction capabilities after close or transaction completion.
- `BEGIN IMMEDIATE` transaction callbacks are synchronous; nesting and Promise-shaped callbacks fail closed.
- Aggregate mutation and its matching domain event have one-to-one portfolio and state-version binding before commit.
- Current state, normalized allocation, holdings, lots, immutable event fact, and dispatch intent commit or roll back together.
- Money and quantities use canonical non-negative decimal TEXT; weights and safe versions use bounded INTEGER.
- Active normalized names are unique and optimistic saves distinguish missing aggregates from version conflicts.
- Rehydration validates the complete U01 aggregate, including allocation, lot, scope, delivery, reservation, no-short, and no-leverage invariants.
- Event streams use contiguous per-portfolio sequence numbers and SHA-256 links. Event facts reject UPDATE and DELETE.

## Initialization and Seeds

- The initial strict schema includes metadata, migration and seed ledgers, strategy definitions and versions, portfolios, allocations, assignments, holdings, lots, immutable events, and dispatch state.
- Fresh initialization creates exactly one INR 1,000,000 `Paper Portfolio` in PAPER mode.
- Stable version 1.0.0 short-, medium-, and long-horizon strategy records are registered.
- The paper portfolio starts with Adaptive Momentum Quality.
- Reopening never resets archived or otherwise changed seed state.
- Any partial, changed, or conflicting reserved seed identity fails closed.

## Safety and Recovery

- The canonical portfolio path cannot alias a protected legacy path.
- Persistent database and backup paths require injected BITLOCKER or EFS attestation; `TEMPORARY_TEST` attestation is accepted only by typed test owners.
- Foreign keys, trusted-schema disablement, WAL or memory journal mode, synchronous FULL, and bounded busy timeout are applied and verified.
- Health checks verify schema parity, quick check, attachments, and all audit chains.
- Owner-mediated backup uses SQLite backup, reopens read-only, verifies health, and compares a complete ordered SHA-256 state fingerprint. Failed backup verification removes only the exact incomplete destination.
- U02 has no broker, network, HTTP, scheduler, or real-trade capability.

## Verification

- Focused examples cover initialization, reopen behavior, changed seed preservation, migration and seed tampering, protected paths, encryption fail-closed behavior, independent multi-strategy portfolios, active-name uniqueness, multi-sleeve and holding/lot round trips, optimistic conflicts, nested transactions, capability revocation, state-event matching, rollback, immutable events, and verified backup.
- Exact codec properties run 1,000 cases.
- Generated temporary-database isolation and rollback properties run 500 cases.
- Migration idempotence and checksum-divergence properties run 500 cases.
- Repeated file initialization runs 50 generated cases.
- Shrinking and replay metadata remain enabled. One test-authoring failure caused by a missing fixture import was corrected; it was not a product counterexample.
- Strict TypeScript and declaration-only contract generation pass.

## Performance Evidence

Environment: Node v24.18.0 on Windows x64.

| Gate | Measured p95 | Requirement | Result |
|---|---:|---:|---|
| Fresh migration and seed | 77.3256 ms | Less than 2,000 ms | Pass |
| Open and verify current small database | 14.4425 ms | Less than 1,000 ms | Pass |
| Representative portfolio load | 0.6739 ms | Less than 25 ms | Pass |
| 1,000-holding and 10,000-lot load | 83.6035 ms | Less than 150 ms | Pass |
| Mutation, event, and dispatch commit | 5.4178 ms | Less than 50 ms | Pass |
| Failed transaction rollback | 0.0843 ms | Less than 50 ms | Pass |
| Append against a 1,000,000-event stream | 0.4810 ms | Less than 20 ms | Pass |
| Retained boundary-load heap delta | 4,719,704 bytes | Less than 128 MiB | Pass |

The generated one-million-event benchmark database occupied 666,898,432 bytes and was removed after measurement.

## Compatibility

- Full repository type checking passes.
- The complete Node suite ran 598 tests: 594 passed. The same four unrelated legacy failures previously established for U01 remained: three missing migrated snapshot-day fixtures and one simulation scheduler expectation. U02 does not import or modify those paths.
- Protected legacy database and trading state are never opened, attached, migrated, or intentionally changed by U02.

## Extension Compliance

### Security Baseline

- Compliant: exact dependency metadata, isolated ownership, fail-closed attestation, canonical paths, strict constraints, parameterized statements, integrity checks, immutable audit facts, safe error contexts, and verified backups.
- N/A: HTTP authentication, authorization middleware, transport encryption, browser controls, IAM, and cloud secret stores because U02 exposes no endpoint or deployed cloud resource.

### Resiliency Baseline

- Compliant: bounded locking, atomic rollback, startup parity checks, stable seeds, health checks, WAL/FULL durability, one-hour-RPO-compatible verified backups, and explicit close behavior.
- N/A: load balancing, autoscaling, multi-region failover, queue redrive infrastructure, and cloud service quotas because U02 is one local in-process database boundary.

### Property-Based Testing

- PBT-01 through PBT-10 are compliant for U02.
- Generators cover exact values, temporary databases, portfolio isolation, rollback, repeated initialization, and migration state.
- Explicit integration tests complement generated properties for backup, immutability, attestation, and corruption containment.

## Focused Commands

```text
npm.cmd run typecheck:portfolio
npm.cmd run test:portfolio:persistence
npm.cmd run test:portfolio:contracts
npm.cmd run benchmark:portfolio:persistence
npm.cmd run verify:portfolio:persistence
npm.cmd run typecheck
npm.cmd test
```
