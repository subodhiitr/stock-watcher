# U05 Execution and Reconciliation NFR Design Patterns

## Design Objective

U05 uses 21 in-process patterns to make execution deterministic, exact, idempotent, fail-closed, recoverable, and structurally unable to reach a real broker unless every separately controlled live capability is present. The patterns incorporate all 134 approved U05 NFRs without adding a service, queue, cache, worker, dependency, credential store, or cloud resource.

Live execution remains disabled by default. This design performs no broker call, database mutation, credential access, or trade.

## Pattern Summary

| Pattern | Name | Primary concern |
|---|---|---|
| PAT-U05-001 | Exact Canonical Execution Values | Exact arithmetic and canonical integrity |
| PAT-U05-002 | Pure Closed Transition Decisions | Determinism and fail-closed states |
| PAT-U05-003 | Portfolio-Scoped Capability Gate | Scope, authority, and live safety |
| PAT-U05-004 | Immutable Approval Binding with Fresh Quote Gate | Consent lineage and price safety |
| PAT-U05-005 | Stable Order Shell and One-Time Intent Finalization | Idempotency and affordability |
| PAT-U05-006 | Intent-Before-Submit Transaction Split | Durable intent and external-call isolation |
| PAT-U05-007 | Four-Way Placement Certainty | Retry safety and ambiguity containment |
| PAT-U05-008 | Deadline-Fit Polling and First-Check Scheduling | Bounded latency and execution windows |
| PAT-U05-009 | Cancellation-Pending Race Resolution | Fill/cancel race correctness |
| PAT-U05-010 | Reservation and Sell-Before-Buy Phasing | Cash/delivery safety |
| PAT-U05-011 | Atomic Incremental Fill Accounting | Exact ledger integrity |
| PAT-U05-012 | Coherent Snapshot Reconciliation | External/local comparison safety |
| PAT-U05-013 | Immutable Difference, Adjustment, and Residual Facts | Audit-preserving correction |
| PAT-U05-014 | Layered Kill-Switch Containment | Safe halt and reset |
| PAT-U05-015 | Persisted-Fact Recovery Classification | Restart convergence |
| PAT-U05-016 | Normalized Broker Port and Certification | SDK isolation and conformance |
| PAT-U05-017 | Structurally Non-Live Adapters | Paper, dry-run, and fake isolation |
| PAT-U05-018 | Dependency Bulkhead and Safe-Read Resilience | Cascading-failure prevention |
| PAT-U05-019 | Short Synchronous Unit of Work | Atomicity and database resource safety |
| PAT-U05-020 | Typed Redacted Evidence and Health Signals | Observability and security |
| PAT-U05-021 | Layered Verification Architecture | Examples, PBT, models, faults, and benchmarks |

## PAT-U05-001: Exact Canonical Execution Values

### Intent

Ensure that every financially material value and identity has one exact, deterministic representation across approval, submission, persistence, recovery, and reconciliation.

### Mechanism

- Reuse U01 `Money`, `Quantity`, `Weight`, `ScaledRate`, branded identifiers, `Instant`, and `LocalDate`.
- Parse broker decimals losslessly before domain use; reject non-finite, fractional-share, negative, overflowing, or malformed values.
- Canonical JSON sorts keys, omits `undefined`, encodes `bigint` as base-10 strings, orders collections by documented identity/sequence, and rejects unsupported values.
- SHA-256 uses a distinct domain separator for approval, order identity, intent, fill, reconciliation snapshot, difference, adjustment, and event.
- Canonical codecs are versioned and round-trip tested; U04 hashes are verified through their existing contract rather than redefined.

### NFR Coverage

`DET-001` through `DET-008`, `CAP-009`, `SAFE-004` through `SAFE-008`, `SEC-009`, `MAINT-003`, `PBT-001` through `PBT-003`, `PBT-007`.

## PAT-U05-002: Pure Closed Transition Decisions

### Intent

Make approval, execution, order, cancellation, reconciliation, and kill-switch behavior exhaustive and replayable.

### Mechanism

- Transition functions accept immutable current state, command, policy, and injected time and return `DomainResult<Transition>`.
- Closed discriminated unions represent every state and result; exhaustive switches prevent success-shaped unknown states.
- Rejection returns one stable failure code, retry classification, bounded safe context, no next state, and no event.
- Terminal states never reopen for placement. Impossible trusted-state corruption raises the established invariant error rather than being downgraded.
- Failure precedence follows the approved Functional Design to avoid information disclosure and inconsistent outcomes.

### NFR Coverage

`PERF-004`, `DET-004`, `DET-006`, `REL-001`, `REL-008` through `REL-010`, `SAFE-012`, `SEC-008`, `MAINT-001` through `MAINT-005`, `PBT-004`, `PBT-006`, `PBT-008`.

## PAT-U05-003: Portfolio-Scoped Capability Gate

### Intent

Prevent cross-portfolio effects and ensure that no user-controlled value can grant live broker authority.

### Mechanism

- Every command and child fact carries exactly one `PortfolioId`; scope mismatch rejects before mutation or external I/O.
- Trusted composition supplies an opaque `LiveBrokerCapability`; domain commands cannot construct it or select a concrete adapter.
- Environment, application, portfolio, strategy, account binding, certification, approval, reconciliation, session, risk, and composition gates are independent.
- Missing gates default false. All gates are recomputed immediately before each live placement and safe retry.
- `OBSERVE` and `RECOMMENDATION` have no order authority; `PAPER` selects only the paper capability.

### NFR Coverage

`CAP-001`, `CAP-007`, `AVAIL-004` through `AVAIL-007`, `SAFE-001`, `SAFE-009` through `SAFE-011`, `SEC-001` through `SEC-003`, `SEC-006` through `SEC-008`, `TEST-006`, `TEST-007`.

## PAT-U05-004: Immutable Approval Binding with Fresh Quote Gate

### Intent

Bind human or restricted-auto authority to one exact plan and state while requiring current market evidence at placement time.

### Mechanism

- Approval binds plan/input hashes, run, portfolio, strategy version/config, portfolio version, reconciliation, approved keys, reference quote, price bounds, execution window, actor, authority evidence, and expiry.
- Authority expiry and quote freshness are separate. A fresh quote may satisfy the immutable bound but cannot extend authority or mutate approval.
- Basket approval is canonical; subsets may only remove discretionary orders and cannot change order material.
- Approval is consumed atomically by exactly one execution run.
- Any bound-state change invalidates authority; expiration and invalidation are immutable terminal facts.

### NFR Coverage

`PERF-001`, `DET-002` through `DET-006`, `REL-002`, `REL-007`, `REL-012`, `SAFE-002`, `SEC-002`, `PBT-004`, `PBT-007`.

## PAT-U05-005: Stable Order Shell and One-Time Intent Finalization

### Intent

Preserve semantic order identity while allowing a buy quantity to decrease once after confirmed sell reconciliation.

### Mechanism

- Plan conversion creates immutable `PLANNED` shells in canonical sell-before-buy order.
- Shell identity binds only fields that cannot change: portfolio, run, plan, logical key, instrument, mapping, side, and sequence.
- The approved quantity ceiling is immutable. A sell intent finalizes at that ceiling.
- A buy intent finalizes exactly once at the lower of its ceiling and confirmed affordable quantity.
- Zero affordability transitions directly to terminal `RESIDUAL` with no intent, reservation, attempt, or broker call.
- After `INTENT_RECORDED`, every broker-material field and hash is immutable.

### NFR Coverage

`CAP-002`, `PERF-002`, `PERF-003`, `DET-005`, `REL-003`, `REL-007`, `SAFE-006`, `PBT-003`, `PBT-008`, `PBT-009`.

## PAT-U05-006: Intent-Before-Submit Transaction Split

### Intent

Ensure every possible external submission is preceded by durable local intent without holding a database transaction across network work.

### Mechanism

1. Validate current state and gates.
2. In transaction A, finalize intent, reserve resources, and persist a monotone `SUBMISSION_IN_FLIGHT` attempt.
3. Commit and expose post-commit evidence.
4. Call one broker adapter outside every transaction.
5. Normalize the result and commit outcome in transaction B.
6. Schedule status/fill/reconciliation work from committed facts.

A crash after transaction A is ambiguous and enters recovery; it is never permission for a new placement.

### NFR Coverage

`PERF-005`, `REL-002` through `REL-005`, `REL-011`, `REL-012`, `RSC-003` through `RSC-007`, `SEC-008`, `TEST-003`, `TEST-005`.

## PAT-U05-007: Four-Way Placement Certainty

### Intent

Prevent duplicate live orders when transport outcomes cannot be proven.

### Mechanism

- Placement returns exactly `ACKNOWLEDGED`, `REJECTED`, `DEFINITELY_NOT_SENT`, or `UNKNOWN`.
- Only `DEFINITELY_NOT_SENT` may retry, at most three total attempts, with unchanged identity and full gate revalidation.
- Timeout, disconnect, process crash, malformed acknowledgement, missing broker ID, SDK uncertainty, or possibly continuing transport becomes `UNKNOWN`.
- `UNKNOWN` blocks placement, approval reuse, dependent buys, completion, and automatic retry for any duration.
- Reconciliation, not elapsed time, is the only route from ambiguity to a broker-provable state.

### NFR Coverage

`PERF-011`, `AVAIL-005`, `AVAIL-006`, `REL-004` through `REL-007`, `REL-013`, `REL-014`, `SAFE-011`, `SEC-008`, `TEST-006`, `PBT-005`, `PBT-009`.

## PAT-U05-008: Deadline-Fit Polling and First-Check Scheduling

### Intent

Bound all external waits and guarantee prompt uncertainty detection without violating the immutable execution window.

### Mechanism

- Placement uses 8-second default and 15-second hard-cap deadlines.
- Status, fills, cancel, account, holdings, and cash use 10-second default and 20-second hard-cap deadlines.
- Coherent reconciliation collection uses a 60-second default and 120-second hard cap.
- A call starts only when its complete deadline fits before the execution-window end.
- The first status/fill check starts within two seconds after acknowledgement, cancellation response, or ambiguity.
- Later polling uses an injected 2-to-15-second interval; fake clock/timer tests prove every boundary.

### NFR Coverage

`PERF-011` through `PERF-015`, `DET-004`, `DET-009`, `RSC-004`, `TEST-005`.

## PAT-U05-009: Cancellation-Pending Race Resolution

### Intent

Handle cancellation and fill races without losing fills or falsely claiming cancellation.

### Mechanism

- Cancellation intent commits before the external cancel request.
- A cancellation acknowledgement, false return, or timeout leaves the order `CANCEL_PENDING`; none proves terminal cancellation.
- Status and fill ingestion continue while cancellation is pending.
- A race fill is deduplicated and applied once; a completing fill transitions to `FILLED`.
- `CANCELLED` requires reconciled proof of zero open quantity.
- Sell cancellation blocks dependent buys until reconciliation proves the available state.

### NFR Coverage

`PERF-012`, `REL-007` through `REL-010`, `SAFE-003`, `SAFE-008`, `PBT-004`, `PBT-006`, `PBT-010`.

## PAT-U05-010: Reservation and Sell-Before-Buy Phasing

### Intent

Prevent short selling, leverage, margin use, double spending, and use of unconfirmed proceeds.

### Mechanism

- Reserve delivery quantity or exact buy cash before placement.
- Reservations are non-negative, portfolio-scoped, monotone, and released only for applied fills or broker-proved terminal unfilled quantity.
- Every sell phase precedes the buy phase.
- Buy affordability excludes estimated proceeds, unsettled funds, collateral, margin, and the configured cash buffer.
- A fresh post-sell matched reconciliation and confirmed broker cash are required before buy finalization.
- Hard quantity, notional, concentration, turnover, liquidity, and daily limits are projected before each placement.

### NFR Coverage

`CAP-002`, `SAFE-003` through `SAFE-008`, `REL-009`, `REL-010`, `PBT-006`, `PBT-008`, `PBT-010`.

## PAT-U05-011: Atomic Incremental Fill Accounting

### Intent

Apply each unique fill exactly once while preserving cash, holdings, lots, reservations, order progress, and evidence as one invariant.

### Mechanism

- Prefer broker trade/fill ID; otherwise derive a canonical account/order/instrument/side/quantity/price/time fingerprint.
- Equivalent duplicates are no-ops; conflicting duplicates are integrity failures.
- Cumulative filled quantity is monotone and bounded by the immutable intent quantity.
- One transaction applies only the new incremental quantity.
- Buy fills debit exact notional plus confirmed charges and create fill-sourced lots.
- Sell fills use immutable U04 lot-disposition lineage; mismatches block rather than inventing lots.
- Holding quantity must equal open-lot quantity after commit.

### NFR Coverage

`CAP-004`, `CAP-006`, `PERF-006`, `PERF-007`, `DET-008`, `REL-002`, `REL-007`, `REL-009`, `SAFE-005` through `SAFE-008`, `PBT-006`, `PBT-008` through `PBT-010`.

## PAT-U05-012: Coherent Snapshot Reconciliation

### Intent

Compare local and broker/paper state only when the external evidence is coherent enough to support a financial decision.

### Mechanism

- Collect account, holdings, delivery, cash, orders, statuses, and fills under one total deadline.
- Accept a broker cursor that proves one coherent snapshot; otherwise require endpoint timestamps within ten seconds.
- Excess unproved skew returns `BLOCKED` and prevents comparison and placement.
- Normalize and canonically order all external values before pure comparison.
- Quantity, order, and fill identities have zero tolerance; cash permits one minor unit only with explicit rounding evidence.
- Result is closed to `MATCHED`, `MATCHED_WITH_ROUNDING`, `MISMATCH`, `UNKNOWN`, or `BLOCKED`.

### NFR Coverage

`CAP-003` through `CAP-005`, `PERF-008`, `PERF-009`, `PERF-013`, `DET-007`, `REL-013`, `SAFE-003`, `SAFE-013` through `SAFE-015`, `PBT-003`, `PBT-005`, `PBT-009`.

## PAT-U05-013: Immutable Difference, Adjustment, and Residual Facts

### Intent

Preserve accounting history when external state differs or approved work remains unfinished.

### Mechanism

- Reconciliation never replaces local holdings, cash, orders, fills, or lots from a snapshot.
- Every mismatch has a canonical immutable difference identity and classification.
- External manual changes require a separately authorized adjustment proposal and transaction.
- Resolution creates a linked reconciliation run rather than rewriting prior evidence.
- Rejected, partial, expired, cancelled, or unaffordable quantity becomes immutable residual work.
- Residual work never silently becomes a new order; replan/reapproval is required.

### NFR Coverage

`DET-007`, `REL-007`, `SAFE-013` through `SAFE-015`, `SEC-009`, `OBS-002`, `OBS-006`, `MAINT-004`, `PBT-004`, `PBT-009`.

## PAT-U05-014: Layered Kill-Switch Containment

### Intent

Stop new financial risk without losing the ability to discover and account for external outcomes.

### Mechanism

- Global and portfolio switches are checked independently before run creation, reservation, placement, and retry.
- Activation is idempotent, fail-closed, and requires bounded actor/reason/evidence context.
- Active containment blocks new intent and placement, requests safe cancellation, and permits status, fills, and reconciliation.
- Activation never liquidates.
- Reset requires distinct privileged authority, MFA evidence, healthy dependencies, cleared trigger, and no unresolved unknown or material mismatch.
- Reset permits only future revalidation; it never auto-resumes prior work.

### NFR Coverage

`REL-007`, `REL-013`, `SAFE-001`, `SAFE-012`, `SEC-002`, `SEC-007`, `SEC-010`, `OBS-007` through `OBS-009`, `PBT-004`, `PBT-006`, `PBT-010`.

## PAT-U05-015: Persisted-Fact Recovery Classification

### Intent

Recover deterministically after restart without relying on hidden process state or duplicating placement/accounting effects.

### Mechanism

- Recovery starts with live placement disabled and verifies database, migration, event-chain, and kill-switch integrity.
- Scan persisted non-terminal runs/orders in bounded canonical order.
- `SUBMISSION_IN_FLIGHT` without a proved outcome becomes `UNKNOWN`; orders with broker references are queried and never placed again.
- Unapplied fills are normalized, deduplicated, and posted once.
- Classify all local non-terminal orders within 30 seconds and start reconciliation within 60 seconds after dependencies are healthy.
- Broker-provable outcomes converge within two cycles or five minutes; externally unprovable state remains `UNKNOWN`.

### NFR Coverage

`CAP-004`, `PERF-010`, `AVAIL-008`, `REL-006`, `REL-007`, `REL-013`, `REL-014`, `RSC-007`, `OBS-009`, `TEST-008`, `PBT-004`, `PBT-006`, `PBT-010`.

## PAT-U05-016: Normalized Broker Port and Certification

### Intent

Prevent unsafe legacy SDK semantics from entering application or domain code.

### Mechanism

- One `BrokerPort` exposes bounded capabilities, health, account state, holdings, delivery, cash, placement, status, fills, cancellation, and snapshot metadata.
- Results contain normalized status/certainty, exact values, `asOf`, optional cursor, deadline, duration, retry classification, and redacted failure code.
- Raw SDK objects, exceptions, messages, credentials, and success-shaped empty values cannot cross the adapter.
- Zerodha and Sharekhan adapters explicitly map CNC/delivery and every undocumented status to `UNKNOWN`.
- Live certification is false until the shared conformance suite proves all exactness, certainty, deadline, cancellation, fill, mapping, and redaction contracts.

### NFR Coverage

`AVAIL-004` through `AVAIL-006`, `PERF-011` through `PERF-013`, `SEC-001`, `SEC-003` through `SEC-006`, `MAINT-005` through `MAINT-010`, `TEST-006`, `TEST-010`, `PBT-005`.

## PAT-U05-017: Structurally Non-Live Adapters

### Intent

Provide paper, dry-run, and fake behavior that exercises U05 contracts without any route to a live SDK or credential.

### Mechanism

- Paper implements the normalized broker port with injected deterministic fill policy, clock, and seed.
- Dry-run validates and renders the exact normalized request and returns only `DRY_RUN_RECORDED`; it creates no reservation or accounting effect.
- Test fake scripts certainty, status, fill, cancellation, deadline, and fault outcomes and exposes call counters.
- Non-live constructors reject live account and credential capabilities.
- Architecture tests prohibit live SDK imports, non-loopback I/O, credential files, and legacy trade paths.
- Cross-mode contract tests prove the shared approval, state, accounting, reconciliation, failure, and evidence behavior.

### NFR Coverage

`DET-010`, `AVAIL-007`, `SAFE-009` through `SAFE-011`, `SEC-003`, `SEC-012`, `TEST-006`, `TEST-010`, `PBT-005`, `PBT-010`.

## PAT-U05-018: Dependency Bulkhead and Safe-Read Resilience

### Intent

Prevent one broker or quote failure from exhausting the process while keeping placement certainty stricter than read resilience.

### Mechanism

- Broker and quote dependencies have independent circuit state, deadline policy, in-flight limit, and bounded read retry policy.
- Safe reads may retry transient failures with injected bounded backoff/jitter.
- Placement is never wrapped in a generic provider retry; PAT-U05-007 controls it.
- Circuit-open, deadline, saturation, or unavailable results are explicit and fail live work closed.
- No mode fallback occurs after live failure.
- Paper work remains available only through a new explicit paper command and isolated composition.

### NFR Coverage

`AVAIL-004` through `AVAIL-007`, `REL-001`, `REL-004` through `REL-006`, `RSC-001` through `RSC-006`, `SEC-008`, `OBS-003`, `OBS-007`, `TEST-005`, `TEST-006`.

## PAT-U05-019: Short Synchronous Unit of Work

### Intent

Extend U02 persistence without weakening its connection, transaction, event, or migration invariants.

### Mechanism

- Add one numbered immutable migration with checksum, assertions, exact TEXT values, uniqueness constraints, and recovery indexes.
- Add transaction-scoped U05 repositories/capabilities to the existing U02 owner; no second connection or SQL-bearing public contract.
- Use `BEGIN IMMEDIATE` through the existing synchronous unit of work.
- Reject Promise-returning callbacks and keep broker calls, timers, waits, and large comparisons outside transactions.
- Every state mutation has matching immutable event evidence or the transaction rolls back.
- Statement and codec catalogs are versioned, bounded, and parameterized.

### NFR Coverage

`PERF-005` through `PERF-007`, `REL-002`, `REL-003`, `REL-011`, `REL-012`, `RSC-003` through `RSC-008`, `SEC-001`, `SEC-009`, `SEC-011`, `MAINT-006` through `MAINT-010`, `TEST-003`, `TEST-008`.

## PAT-U05-020: Typed Redacted Evidence and Health Signals

### Intent

Make financial and security behavior diagnosable without exposing credentials, raw broker content, account identity, or mutable audit state.

### Mechanism

- Every accepted/rejected transition emits a typed bounded evidence payload after commit.
- Evidence carries portfolio-safe lineage, actor, command, correlation, causation, state, certainty, durations, counts, and allowlisted reason codes.
- U02's append-only hash chain supplies contiguous sequence and tamper evidence.
- Credential-like keys, raw errors, stack traces, paths, SDK payloads, and broker account IDs are rejected or redacted before evidence construction.
- Health/metric payloads expose latency, errors, throughput, saturation, ambiguity, circuit state, recovery lag, reconciliation outcomes, and containment.
- U06 owns routing, retention, dashboard, alerting, and incident integration.

### NFR Coverage

`AVAIL-001`, `AVAIL-002`, `OBS-001` through `OBS-010`, `SEC-003` through `SEC-005`, `SEC-009`, `SEC-012`, `MAINT-004`, `MAINT-007`, `PBT-007`.

## PAT-U05-021: Layered Verification Architecture

### Intent

Prove critical behavior at examples, properties, state-machine models, adapter contracts, persistence faults, restart drills, and approved capacity limits.

### Mechanism

- Named examples pin approval, buy-only, sell-only, mixed, zero-affordability, ambiguity, cancellation race, partial fill, mismatch, kill, and recovery behavior.
- Reusable `fast-check` generators preserve linked portfolio/run/order/fill/reconciliation relationships and boundary values.
- Stateful models cover approval, execution, order, cancellation, reservation, fill, reconciliation, kill-switch, paper, and recovery commands.
- Oracles verify exact cash/holding/lot accounting, canonical comparison, paper fills, and retry certainty.
- Fault injection targets every transaction step and adapter return boundary with an injected clock/timer.
- Benchmarks measure p50/p95/max, heap, event-loop delay, and growth at 250 orders, 1,000 holdings, 10,000 lots/fills, and 100 sequential portfolios.
- Shrinking and seed/path replay remain enabled; shrunk critical failures become named regressions.

### NFR Coverage

`CAP-002` through `CAP-010`, `PERF-001` through `PERF-010`, `TEST-001` through `TEST-010`, `PBT-001` through `PBT-012`.

## Complete NFR Traceability

| NFR category | Count | Pattern coverage |
|---|---:|---|
| `NFR-U05-CAP-001` through `CAP-010` | 10 | PAT-U05-003, PAT-U05-005, PAT-U05-010 through PAT-U05-012, PAT-U05-015, PAT-U05-021 |
| `NFR-U05-PERF-001` through `PERF-015` | 15 | PAT-U05-002, PAT-U05-004 through PAT-U05-008, PAT-U05-011, PAT-U05-012, PAT-U05-015, PAT-U05-016, PAT-U05-019, PAT-U05-021 |
| `NFR-U05-DET-001` through `DET-010` | 10 | PAT-U05-001 through PAT-U05-005, PAT-U05-008, PAT-U05-012, PAT-U05-017 |
| `NFR-U05-AVAIL-001` through `AVAIL-008` | 8 | PAT-U05-003, PAT-U05-007, PAT-U05-015 through PAT-U05-018, PAT-U05-020 |
| `NFR-U05-REL-001` through `REL-014` | 14 | PAT-U05-002, PAT-U05-004 through PAT-U05-007, PAT-U05-009 through PAT-U05-015, PAT-U05-018, PAT-U05-019 |
| `NFR-U05-SAFE-001` through `SAFE-015` | 15 | PAT-U05-001 through PAT-U05-005, PAT-U05-007, PAT-U05-009 through PAT-U05-014, PAT-U05-017 |
| `NFR-U05-SEC-001` through `SEC-012` | 12 | PAT-U05-001 through PAT-U05-004, PAT-U05-006, PAT-U05-007, PAT-U05-014, PAT-U05-016 through PAT-U05-020 |
| `NFR-U05-OBS-001` through `OBS-010` | 10 | PAT-U05-013 through PAT-U05-015, PAT-U05-018, PAT-U05-020 |
| `NFR-U05-RSC-001` through `RSC-008` | 8 | PAT-U05-006, PAT-U05-008, PAT-U05-015, PAT-U05-018, PAT-U05-019 |
| `NFR-U05-MAINT-001` through `MAINT-010` | 10 | PAT-U05-001, PAT-U05-002, PAT-U05-013, PAT-U05-016, PAT-U05-019, PAT-U05-020 |
| `NFR-U05-TEST-001` through `TEST-010` | 10 | PAT-U05-003, PAT-U05-006 through PAT-U05-008, PAT-U05-015 through PAT-U05-019, PAT-U05-021 |
| `NFR-U05-PBT-001` through `PBT-012` | 12 | PAT-U05-001 through PAT-U05-005, PAT-U05-007, PAT-U05-009 through PAT-U05-017, PAT-U05-020, PAT-U05-021 |
| **Total** | **134** | **Every approved U05 NFR is assigned** |

## Security Baseline Compliance

| Rule | Status | U05 design disposition |
|---|---|---|
| SECURITY-01 | Compliant, shared | U05 persists only through U02's attested encrypted boundary and requires TLS 1.2+ for future live transport. PAT-U05-016, PAT-U05-019. |
| SECURITY-02 | N/A | No load balancer, API gateway, or CDN exists in this unit. |
| SECURITY-03 | Compliant, shared | PAT-U05-020 emits structured redacted evidence; U06 owns the centralized sink. |
| SECURITY-04 | N/A | U05 serves no HTML. |
| SECURITY-05 | Compliant at unit boundary | Every command, collection, adapter result, and persistence value is bounded and validated before use. PAT-U05-001, PAT-U05-003. |
| SECURITY-06 | N/A | U05 defines no cloud IAM policy. |
| SECURITY-07 | N/A | U05 defines no cloud network resource. |
| SECURITY-08 | Compliant, shared | Portfolio scope and opaque authority are mandatory; U07 supplies authenticated authorization evidence. PAT-U05-003, PAT-U05-004. |
| SECURITY-09 | Compliant | Live defaults disabled, errors are typed/redacted, and unsafe legacy defaults are not reused. PAT-U05-003, PAT-U05-016. |
| SECURITY-10 | Compliant, shared | No dependency is added; lockfile-resolved dependencies are retained and U09 owns scan/SBOM evidence. |
| SECURITY-11 | Compliant | Authority, risk, broker, accounting, reconciliation, audit, and containment are isolated with layered gates and misuse tests. |
| SECURITY-12 | Compliant, shared | U05 stores no credential and accepts only opaque authority/MFA evidence; U07 owns authentication/session behavior. |
| SECURITY-13 | Compliant | Canonical hashes, immutable facts, versioned codecs, and append-only evidence protect integrity. PAT-U05-001, PAT-U05-020. |
| SECURITY-14 | Compliant, shared | U05 emits alertable security/financial events; U06 owns routing, retention, and dashboards. PAT-U05-020. |
| SECURITY-15 | Compliant | External and persistence failures fail closed, transactions roll back, resources remain bounded, and no success fallback is produced. |

Security blocking findings: none.

## Resiliency Baseline Compliance

| Rule | Status | U05 design disposition |
|---|---|---|
| RESILIENCY-01 | Compliant | U05 is Critical; upstream U01/U02/U04 and external broker/quote plus downstream U06/U07 dependencies are explicit. |
| RESILIENCY-02 | Compliant by inheritance | Approved 99%-window availability, hours-level RTO, and one-hour RPO remain unchanged. |
| RESILIENCY-03 | Compliant by inheritance | The approved lightweight change record, approval, test evidence, and rollback note process applies. |
| RESILIENCY-04 | Compliant, shared | Approved GitHub Actions, direct local deployment, and database-aware rollback are preserved; U09 owns deployment artifacts. |
| RESILIENCY-05 | Compliant, shared | PAT-U05-020 defines metric/log/event contracts; U06 owns sinks and dashboards. Distributed tracing is N/A to one local process. |
| RESILIENCY-06 | Compliant, shared | Adapter/capability health is explicit; U06/U07 own process and endpoint health surfaces. |
| RESILIENCY-07 | Compliant, shared | Ambiguity, circuit, recovery, capacity, and containment degradation signals are defined for U06 monitoring. |
| RESILIENCY-08 | N/A | The approved local workstation topology has no cloud availability-zone or regional resource. |
| RESILIENCY-09 | N/A | Cloud auto-scaling is excluded; PAT-U05-021 verifies bounded local capacity. |
| RESILIENCY-10 | Compliant | Explicit deadlines, circuits, in-flight limits, certainty-aware retry, and no mode fallback prevent cascading failure. |
| RESILIENCY-11 | Compliant by inheritance | Encrypted backup/restore matches hours-level recovery; U06 owns operational DR artifacts. |
| RESILIENCY-12 | Compliant, shared | U05 remains inside U02's consistent backup boundary; U06 owns schedule, retention, encryption evidence, and restore drills. |
| RESILIENCY-13 | Compliant, shared | PAT-U05-015 defines deterministic restart classification and convergence; U06 owns operator runbooks. |
| RESILIENCY-14 | Compliant | The approved lightweight deterministic fault-injection and restart matrix is defined in PAT-U05-021 and will execute during Code Generation/Build and Test. |
| RESILIENCY-15 | Compliant by inheritance | The approved lightweight severity, containment, recovery, audit, and COE process receives U05 signals through U06. |

Resiliency blocking findings: none.

## Property-Based Testing Compliance

| Rule | Status | U05 design disposition |
|---|---|---|
| PBT-01 | Compliant | Functional Design properties are carried into PAT-U05-021 and component verification responsibilities. |
| PBT-02 | Compliant as design | Canonical codecs, exact broker parsers/formatters, persistence codecs, and dry-run rendering have round-trip properties. |
| PBT-03 | Compliant as design | Scope, quantity, cash, reservation, fill, sequence, state, and reconciliation invariants have generated checks. |
| PBT-04 | Compliant as design | Approval, execute, placement result, fill, cancel, reconciliation, adjustment, kill, and recovery replay are modeled. |
| PBT-05 | Compliant as design | Exact ledger, comparator, paper-fill, and certainty models act as oracles. |
| PBT-06 | Compliant as design | Ten stateful model families check invariants after each generated command, including empty and long sequences. |
| PBT-07 | Compliant as design | Linked domain generators preserve portfolio, run, order, fill, snapshot, and authority constraints. |
| PBT-08 | Compliant as design | Shrinking, seed/path logging, replay, and regression capture are mandatory. |
| PBT-09 | Compliant | Existing `fast-check` 4.8.0 with Node's test runner remains selected. |
| PBT-10 | Compliant as design | Named critical examples accompany every generated critical-path property. |

PBT blocking findings: none.

## Explicit Exclusions

- No real broker call, credential access, DNS/socket access, or persistent-data mutation is authorized by this design.
- No import from `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`, `/trade-execution`, or `/paper-trades` is allowed.
- No generic retry may wrap placement.
- No snapshot may overwrite accounting history.
- No process restart, elapsed timeout, portfolio mode, or requested adapter name grants execution authority.
- No cloud topology, queue, cache, worker, logging SDK, ORM, decimal library, or additional package is introduced.
