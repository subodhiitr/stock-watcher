# U02 Portfolio Persistence NFR Requirements

## Capacity

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-001 | Support at least 100 portfolios in one database. | Seed/load benchmark |
| NFR-U02-002 | Support 1,000 holdings and 10,000 open lots for one portfolio. | Boundary fixture |
| NFR-U02-003 | Support 100 strategy sleeves for one current allocation. | Repository round trip |
| NFR-U02-004 | Support at least 1,000,000 immutable domain-event rows while preserving indexed stream lookup. | Generated database benchmark |
| NFR-U02-005 | Support at least 100,000 dispatch rows with bounded pending lookup. | Query-plan and latency test |
| NFR-U02-006 | Reject configured or generated values above approved domain limits before unbounded allocation or SQL work. | Boundary examples and properties |

## Latency and Resource Use

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-010 | Fresh migration and seed initialization completes below 2 seconds p95 on the approved workstation baseline. | 30-run temporary database benchmark |
| NFR-U02-011 | Opening and verifying a current small database completes below 1 second p95. | 100-run benchmark |
| NFR-U02-012 | Loading a representative portfolio completes below 25 ms p95. | 500-run benchmark |
| NFR-U02-013 | Loading a 1,000-holding/10,000-lot portfolio completes below 150 ms p95. | 30-run benchmark |
| NFR-U02-014 | An ordinary portfolio mutation plus one event and dispatch row commits below 50 ms p95. | 500-run benchmark |
| NFR-U02-015 | A failed transaction rolls back below 50 ms p95 after the failure is detected. | Failure benchmark |
| NFR-U02-016 | Stream-head lookup and append remain below 20 ms p95 at 1,000,000 events. | Indexed database benchmark |
| NFR-U02-017 | Boundary portfolio rehydration uses less than 128 MiB incremental heap. | Exposed-GC benchmark |
| NFR-U02-018 | Repository statements have verified indexes and no unbounded full-table scan on critical paths. | `EXPLAIN QUERY PLAN` assertions |

## Concurrency and Availability

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-020 | Exactly one owner connection factory exists per database path in a process. | Lifecycle integration test |
| NFR-U02-021 | Write transactions use synchronous `BEGIN IMMEDIATE`; Promise-returning and nested callbacks fail before commit. | Examples |
| NFR-U02-022 | SQLite busy timeout is at most 5 seconds and retry count is bounded by the application caller, not hidden inside U02. | Configuration and lock test |
| NFR-U02-023 | A lock timeout returns a retryable stable failure and leaves no partial state. | Two-connection contention test |
| NFR-U02-024 | Close rejects new work and deterministically releases connection and statement resources. | Lifecycle state model |
| NFR-U02-025 | Process restart after any committed transaction reopens equivalent state and event-chain heads. | Restart integration property |

## Durability and Integrity

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-030 | Persistent connections verify WAL, synchronous FULL, foreign keys ON, trusted schema OFF, and bounded busy timeout. | Startup assertions |
| NFR-U02-031 | Aggregate state, event fact, and dispatch intent commit or roll back atomically. | Failure injection |
| NFR-U02-032 | Migration ledger checksum and `user_version` parity are checked on every initialize. | Corruption tests |
| NFR-U02-033 | Applied migration source cannot change without a visible startup failure. | Checksum property |
| NFR-U02-034 | Event rows reject UPDATE and DELETE and verify contiguous stream hashes. | Trigger and chain tests |
| NFR-U02-035 | Exact-value persistence never uses REAL for money, quantity, weight, or state version. | Schema inspection |
| NFR-U02-036 | Repository load invokes all U01 codecs and full aggregate validation. | Corruption matrix |
| NFR-U02-037 | Repeated initialization is data-idempotent and never resets changed seed state. | PBT repeated initialize model |
| NFR-U02-038 | Protected legacy database bytes or sentinel hash remain unchanged across all U02 integration suites. | Before/after verification |
| NFR-U02-039 | Owner-mediated backup reopens with matching schema, state, checksum metadata, and audit heads. | Backup integration test |

## Security and Privacy

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-040 | Persistent database and backup operations require positive OS-encryption attestation; only typed temporary tests may bypass production attestation. | Attestation matrix |
| NFR-U02-041 | U02 never accepts or logs encryption keys. | API and source scan |
| NFR-U02-042 | All repository values use prepared bound parameters; identifiers cannot select SQL fragments. | Architecture/source test |
| NFR-U02-043 | No ATTACH statement or legacy database open path exists in U02. | Source and runtime database-list tests |
| NFR-U02-044 | Failures expose no SQL, path, database contents, encryption state detail, stack, or raw SQLite message. | Error property |
| NFR-U02-045 | Event canonical payloads contain only approved U01 fields and no credentials or broker account identifiers. | Codec test |
| NFR-U02-046 | Temporary database cleanup can delete only its exact generated fixture root after close. | Path-policy test |
| NFR-U02-047 | New dependencies are exact-version locked and have no unresolved critical advisory attributable to U02. | Lockfile and audit evidence |

## Maintainability and Contract Stability

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-050 | Persistence code remains under the U02 infrastructure/adapters boundary and imports no route, React, broker, or legacy policy module. | Architecture graph |
| NFR-U02-051 | Migration files are immutable, numbered, independently asserted, and contain no runtime business branching. | Migration registry test |
| NFR-U02-052 | SQL names and codecs are centralized; repositories do not duplicate exact-value parsing. | Source inspection |
| NFR-U02-053 | Public adapter factories and health/backup contracts emit declaration-only output without internal connection types. | Declaration contract |
| NFR-U02-054 | Runtime persistence dependencies remain limited to Node standard modules and the existing locked SQLite driver. | Manifest and import test |
| NFR-U02-055 | No generated JavaScript, database, WAL, SHM, backup, benchmark output, or migration scratch file is committed. | Artifact scan |

## Testing and Property-Based Verification

| ID | Requirement | Verification |
|---|---|---|
| NFR-U02-060 | Every migration has fresh, repeated, failed, and guarded-reversal examples. | Node tests |
| NFR-U02-061 | Every ordinary property executes at least 500 generated temporary-database cases; expensive backup/capacity properties execute at least 50. | Test configuration |
| NFR-U02-062 | Migration state models execute at least 250 command sequences of length 0 through 50. | `fast-check` commands |
| NFR-U02-063 | Transaction properties generate success, DomainFailure, constraint, busy, and thrown-invariant outcomes. | Property suite |
| NFR-U02-064 | Seed properties modify generated portfolio state before repeated initialization and prove no reset. | Property suite |
| NFR-U02-065 | Repository round trips cover representative and domain-boundary snapshots. | Example and property tests |
| NFR-U02-066 | Shrinking, seed/path reporting, replay, and permanent regression examples remain enabled. | Framework configuration |
| NFR-U02-067 | Integration tests use only generated temporary databases and fake attestations; they never mutate persistent trading or portfolio data. | Harness architecture test |
| NFR-U02-068 | Focused typecheck, tests, contract generation, query-plan checks, and benchmarks run before U02 completion. | Verification script |

## Explicit N/A Categories

- Network TLS, cloud IAM, load balancing, autoscaling, multi-zone deployment, browser security, API authentication, broker deadlines, and React accessibility are N/A to U02.
- Backup scheduling, retention, restore orchestration, alerting, and incident response remain owned by U06; U02 supplies consistent primitives and integrity metadata.
- HTTP input schemas and authorization remain owned by U07.

## Extension Compliance

### Security

- Applicable: SECURITY-01, SECURITY-05 at repository boundaries, SECURITY-10, SECURITY-11, SECURITY-13, and SECURITY-15.
- N/A: browser, API session, cloud network/IAM, endpoint authorization, and monitoring controls.
- No blocking U02 NFR finding remains.

### Resiliency

- Applicable: RESILIENCY-01, RESILIENCY-02, RESILIENCY-04, RESILIENCY-06, RESILIENCY-07, RESILIENCY-10, and U02 portions of RESILIENCY-11 through RESILIENCY-13.
- Deferred owner: RESILIENCY-14 remains U06.
- N/A: multi-zone, multi-region, and cloud autoscaling.
- No blocking U02 NFR finding remains.

### Property-Based Testing

- PBT-01 is complete in Functional Design.
- PBT-02 through PBT-08 and PBT-10 are measurable Code Generation obligations.
- PBT-09 continues to use locked `fast-check`.

