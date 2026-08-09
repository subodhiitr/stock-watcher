# U02 Portfolio Persistence NFR Requirements Plan

## Context

- Critical local SQLite persistence unit
- Consumes U01 strict-TypeScript contracts
- Uses the repository's existing `better-sqlite3` runtime dependency
- No network, broker, HTTP, React, or cloud resource

## Plan

- [x] Analyze approved U02 Functional Design and inherited project NFRs.
- [x] Select measurable capacity, latency, concurrency, durability, encryption, and recovery targets.
- [x] Define reliability, data-integrity, and lifecycle requirements.
- [x] Define security, privacy, dependency, and safe-failure requirements.
- [x] Define testability, PBT, migration, benchmark, and contract gates.
- [x] Record technology decisions and explicit N/A categories.
- [x] Validate extension compliance and present the NFR Requirements review gate.

## Selected Decisions

1. Reuse exact `better-sqlite3` 12.11.1; add no second SQLite engine.
2. Support at least 100 portfolios, 1,000 holdings and 10,000 open lots per portfolio, 100 sleeves, and 1,000,000 immutable event facts.
3. Fresh initialization below 2 seconds p95; open current database below 1 second p95; boundary portfolio load below 150 ms p95; ordinary commit below 50 ms p95.
4. Use one process owner, synchronous immediate writes, 5-second maximum busy timeout, and no unbounded retries.
5. Use WAL plus synchronous FULL and verified checkpoint/close behavior.
6. Require injected positive OS-encryption attestation for persistent data and backups.
7. Require temporary-database integration tests, failure injection, PBT, declaration checks, and deterministic capacity benchmarks.
