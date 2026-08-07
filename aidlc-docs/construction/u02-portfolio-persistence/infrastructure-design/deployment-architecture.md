# U02 Portfolio Persistence Deployment Architecture

## Runtime View

```text
Windows workstation
|
+-- Existing Node.js application process
    |
    +-- Portfolio composition boundary (U07 later)
        |
        +-- PortfolioDatabaseOwner (U02)
            |
            +-- better-sqlite3 connection
            +-- migrations and seed
            +-- repositories and unit of work
            +-- event ledger and local outbox
            +-- health and backup coordinator
            |
            +-- encrypted NTFS storage
                |
                +-- portfolio-management.db
                +-- portfolio-management.db-wal
                +-- portfolio-management.db-shm
                +-- backups/portfolio/<verified backup>

Protected and never opened by U02:
stock-watcher.db
```

## Text Alternative

One existing Node process contains the future portfolio composition boundary. That boundary constructs one U02 database owner. The owner exclusively controls one `better-sqlite3` connection, migrations, seeds, repositories, transactions, event ledger, local outbox, health, and backups. Active files and backups reside on attested encrypted NTFS storage. The legacy `stock-watcher.db` remains separate and unopened.

## Startup Sequence

1. Resolve configuration and protected paths.
2. Verify OS-encryption attestation.
3. Open the owner connection.
4. Verify defensive pragmas and attachment isolation.
5. Apply forward migrations.
6. Apply idempotent seeds.
7. Verify integrity and health.
8. Mark owner OPEN.
9. Permit dependent portfolio components to start.

## Shutdown Sequence

1. Stop accepting new portfolio work.
2. Complete or roll back the active synchronous transaction.
3. Allow post-commit publication ownership to drain at the application boundary.
4. Checkpoint WAL when safe.
5. Finalize statements.
6. Close the connection once.

## Failure Boundaries

| Failure | Containment |
|---|---|
| Missing encryption attestation | No database open |
| Protected path match | No database open |
| Invalid pragma or attachment | Close and FAULTED |
| Migration checksum mismatch | Roll back active migration and FAULTED |
| Seed conflict | Roll back seed and FAULTED |
| Busy timeout | Roll back operation; owner remains OPEN if healthy |
| Integrity or chain failure | Fail operation and deep health; no repair |
| Backup verification failure | Source unchanged; exact incomplete output removed |
| Close during new request | Reject request with stable lifecycle failure |

## Explicitly Absent

- Cloud account, VPC, subnet, firewall, load balancer, managed database, object store, queue, cache, container, VM, or autoscaling group.
- TCP or HTTP listener owned by U02.
- Shared transaction or attached schema with legacy trading data.
- Direct file-copy backup while the owner is active.

