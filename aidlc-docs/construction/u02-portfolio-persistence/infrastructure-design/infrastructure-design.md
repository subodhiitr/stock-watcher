# U02 Portfolio Persistence Infrastructure Design

## Topology

U02 runs inside the existing local Node.js application on Windows. It owns one SQLite file and opens no network listener. No cloud resource, container, external database service, cache, queue, or sidecar is added.

## Deployment Environment

| Environment | Database | Encryption attestation | Seed policy |
|---|---|---|---|
| Local development | Configured `portfolio-management.db` path | Required unless explicit temporary test | Idempotent production seed |
| Automated test | Unique generated temporary directory | Typed test attestation | Independent seed per fixture |
| Local production | Configured `portfolio-management.db` on protected NTFS volume/directory | Positive BitLocker or EFS attestation required | Idempotent production seed |

The application fails closed when a persistent environment lacks positive attestation.

## Compute Mapping

- Existing Node 24 process.
- One in-process PortfolioDatabaseOwner.
- Synchronous `better-sqlite3` connection and transactions.
- No worker thread or child process for ordinary persistence.
- Capacity and backup operations remain bounded; U06 may schedule them but cannot access the raw connection.

## Storage Mapping

### Active Database

- Logical name: `portfolio-management.db`.
- Physical path: environment-configurable canonical absolute path.
- Default local location: repository workspace root for compatibility with the current single-workstation layout.
- The file, `-wal`, and `-shm` companions are excluded from version control.
- The containing volume or directory must be attested as OS encrypted.
- File access is restricted to the local application identity and administrators.

### Protected Legacy Data

- `stock-watcher.db` and resolved aliases are protected path identities.
- U02 never opens or attaches them.
- SQLite `database_list` must show only `main` and optional `temp`.
- Integration tests use a sentinel file or hash and prove no change.

### Backup Namespace

- Configurable encrypted directory, default logical namespace `backups/portfolio/`.
- Backup filenames contain a generated backup ID and canonical UTC timestamp, not portfolio names or secrets.
- Incomplete output uses an attempt-specific suffix and is renamed only after verification.
- `.db`, WAL, SHM, incomplete, and backup artifacts are excluded from source control.
- U06 owns schedule and retention; U02 owns consistency and verification.

## SQLite Configuration

- WAL journal mode.
- synchronous FULL.
- foreign keys ON.
- trusted schema OFF.
- bounded busy timeout no greater than 5,000 ms.
- no ATTACH.
- explicit checkpoint during controlled close or backup coordination when safe.

Configuration is read back and verified rather than assumed.

## Messaging Mapping

- `domain_events` is the immutable event/audit fact store.
- `event_dispatch` is the durable local outbox.
- No external broker or queue is introduced.
- U02 returns committed in-memory events to the caller and leaves durable pending dispatch for U06 recovery.

## Monitoring Mapping

U02 exposes in-process health:

- owner lifecycle;
- database reachable;
- expected pragma state;
- schema and migration parity;
- no attached database;
- quick-check status;
- foreign-key status;
- seed cardinality;
- event-chain head status;
- backup capability readiness.

U06 later converts these signals into logs, alerts, operations views, and incident evidence.

## Backup and Restore Boundary

- U02 creates a consistent verified backup through the live owner.
- Backup destination requires encryption attestation before writing.
- Verification reopens the backup read-only and checks schema, foreign keys, accounting, seeds, and chain heads.
- U02 returns checksum and verification metadata.
- U06 owns retention, restore workflow, RPO/RTO measurement, and rollback orchestration.
- Restore never overwrites the active file in place; U06 stages, verifies, closes the owner, and atomically switches according to its later design.

## Permissions and Secrets

- U02 accepts no database encryption key.
- OS protection is verified by an injected adapter at composition time.
- Paths are internal configuration and are redacted from domain failures and audit payloads.
- Database contents, SQL, and raw driver errors are not logged by U02.

## Deployment and Rollback

- Forward migrations run before the owner enters OPEN.
- Startup failure leaves the workload unavailable and does not start dependent portfolio services.
- Explicit reversal requires maintenance mode and a verified backup.
- Irreversible migrations require forward repair or verified restore.
- Previous application code cannot open a schema above its declared reader version.

## Infrastructure Extension Compliance

### Security

- SECURITY-01: database and backup locations require OS-encryption attestation.
- SECURITY-06 and SECURITY-07: N/A because no cloud IAM or network resource exists.
- SECURITY-09: configuration is environment-based and secrets are absent.
- SECURITY-13 and SECURITY-15: verified schema, backup, and fail-closed startup.

### Resiliency

- Critical workload status is retained.
- Owner health, guarded migration rollback, consistent backup, and restore metadata support applicable controls.
- Multi-zone, multi-region, and autoscaling remain N/A for the local topology.

No blocking infrastructure finding remains.

