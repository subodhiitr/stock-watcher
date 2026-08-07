# U01 NFR Design Patterns

## Pattern Overview

U01 applies in-process software patterns only. It introduces no queue, cache, worker, circuit breaker, retry controller, database, network service, health endpoint, load balancer, or failover component.

## PAT-U01-001 Exact Value Object

### Intent

Make invalid or inexact financial values difficult to represent.

### Design

- Controlled constructors validate currency, scale, bounds, and canonical form.
- INR money and whole-share quantities use `bigint`.
- Weights use named parts-per-million scale constants.
- Arithmetic requires compatible currency and scale.
- Subtraction rejects underflow where the result type is non-negative.
- Canonical codecs encode BigInt values as base-10 strings with explicit schema versions.

### NFR Coverage

NFR-U01-REL-001, NFR-U01-REL-004, NFR-U01-SEC-001, NFR-U01-PBT-007, NFR-U01-PBT-008, NFR-U01-MAINT-008.

## PAT-U01-002 Typed Result and Invariant Boundary

### Intent

Handle expected failures completely while preventing corrupted trusted state from being mistaken for a business rejection.

### Design

- Expected validation and transition failures return a closed `DomainResult<T>`.
- Success and failure branches are mutually exclusive.
- Failures contain stable codes and allowlisted bounded scalar context.
- Rejected transitions return no next state and no events.
- `DomainInvariantError` is reserved for impossible trusted-state corruption or programmer defects.
- U01 never catches and downgrades invariant errors.

### Explicitly Excluded

- retry;
- fallback aggregate;
- catch-all success default;
- broad exception swallowing;
- partial transition result.

### NFR Coverage

NFR-U01-REL-003, NFR-U01-REL-004, NFR-U01-REL-008, NFR-U01-SEC-003, NFR-U01-SEC-006, NFR-U01-SEC-010.

## PAT-U01-003 Deterministic Transition

### Intent

Ensure the same explicit state and command always produce the same result.

### Design

- Commands include identifiers, expected version, actor, correlation, causation, and effective time.
- U01 reads no clock, randomness, environment, process state, or global mutable state.
- Validation follows a fixed precedence.
- Canonical collection order determines comparison and event order.
- Accepted changes increment state version exactly once.
- Idempotent no-ops preserve state and emit no event.

### NFR Coverage

NFR-U01-REL-001, NFR-U01-REL-002, NFR-U01-REL-005, NFR-U01-REL-006, NFR-U01-PBT-008, NFR-U01-PBT-009.

## PAT-U01-004 Canonical Bounded Immutable Collection

### Intent

Provide runtime-safe collections with predictable scale and ordering without a production dependency.

### Design

- Public boundaries expose canonical frozen arrays or frozen plain records.
- Constructors defensively copy input.
- Identifier-keyed collections are sorted canonically.
- Private indexes are built from canonical arrays for lookup and are never returned.
- Normal transitions replace only the affected holding, lot collection, or sleeve collection and then freeze the new path.
- Aggregate collection limits are checked before copying or indexing.
- Mutable Map and Set instances are never exposed, even as TypeScript readonly views.

### Complexity

- Canonical construction: O(n log n).
- Indexed lookup after construction: expected O(1).
- Replacement: O(n) for the affected canonical array.
- Integrity scan: O(n) over holdings, lots, or sleeves.

### NFR Coverage

NFR-U01-CAP-001 through NFR-U01-CAP-005, NFR-U01-PERF-001 through NFR-U01-PERF-004, NFR-U01-SEC-009.

## PAT-U01-005 Two-Tier Integrity Validation

### Intent

Preserve full correctness while avoiding a 10,000-lot scan after an unrelated metadata change.

### Full Validation

Runs for:

- aggregate creation;
- persistence rehydration;
- explicit integrity checks;
- test oracle comparisons;
- recovery verification by later units.

Full validation checks every child identity, lot total, quantity bound, policy weight, status/mode rule, version, and canonical ordering rule.

### Targeted Validation

Runs for normal commands:

1. validate command envelope and expected version;
2. validate the currently affected entity or policy;
3. validate cross-cutting aggregate invariants that could change;
4. construct the next immutable state;
5. validate resulting event and version consistency.

### Equivalence Proof

Property tests generate valid aggregate and command sequences, apply targeted validation, and then run full validation on every successful next state. A targeted acceptance that fails full validation is always a defect.

### NFR Coverage

NFR-U01-PERF-001 through NFR-U01-PERF-003, NFR-U01-REL-003 through NFR-U01-REL-005, NFR-U01-PBT-004, NFR-U01-PBT-008.

## PAT-U01-006 Closed Evidence Token

### Intent

Prevent operating mode from becoming order authority and reject flexible untrusted metadata.

### Design

- Evidence is a closed discriminated value.
- Common fields bind evidence ID, portfolio, target mode, issuer, issued time, expiry, and canonical integrity hash.
- Evidence kind determines whether it can support approval-required, restricted-auto, or live posture.
- U01 validates binding, supported kind, and time claims.
- U03, U05, and U07 later authenticate issuers and cryptographically verify evidence.
- Raw tokens, signatures, credentials, and metadata bags never enter the aggregate.

### NFR Coverage

NFR-U01-SEC-001 through NFR-U01-SEC-007, NFR-U01-SEC-010.

## PAT-U01-007 Safe Context Builder

### Intent

Keep errors and events useful without allowing secret or arbitrary data propagation.

### Design

- Each error and event type has a dedicated context builder.
- Field names and scalar types are closed at compile time.
- Text values are length bounded.
- Identifier renderers are safe and type specific.
- Context rejects nested unknown objects, arrays without explicit schemas, raw errors, and arbitrary request metadata.
- API adapters later map codes to user-facing language.

### NFR Coverage

NFR-U01-SEC-001 through NFR-U01-SEC-003, NFR-U01-MAINT-004, NFR-U01-MAINT-005.

## PAT-U01-008 Versioned Event Fact

### Intent

Preserve deterministic audit and recovery contracts across downstream units.

### Design

- Every event uses a closed event-type union and positive schema version.
- Event payload is immutable and type specific.
- Envelope binds aggregate ID, resulting version, command, actor, time, correlation, and causation.
- Event constructors verify aggregate and resulting-version consistency.
- Codec rejects unsupported schema versions and unknown event types.
- Persistence and publication remain outside U01.

### NFR Coverage

NFR-U01-REL-005, NFR-U01-REL-006, NFR-U01-SEC-003, NFR-U01-SEC-006, NFR-U01-PBT-007, NFR-U01-MAINT-005, NFR-U01-MAINT-006.

## PAT-U01-009 Dependency Inversion and Public Contract Gate

### Intent

Keep the domain isolated while giving later units stable capabilities.

### Design

- Ports depend only on approved public domain types.
- Aggregate code never invokes a port.
- A single explicit public entry point exports approved contracts.
- Internal implementation paths are not public.
- Wildcard export chains and circular imports are forbidden.
- Declaration-only output is compared during review.
- Breaking contract changes require deprecation and dependent-unit review.

### NFR Coverage

NFR-U01-MAINT-001 through NFR-U01-MAINT-007, NFR-U01-SEC-008.

## PAT-U01-010 Capacity Guard

### Intent

Reject adversarial or unsupported collection sizes before costly allocation.

### Design

- Named limits define 1,000 holdings, 10,000 open lots, and 100 sleeves.
- Constructors inspect collection length before copy, sort, index, or detailed validation.
- Nested totals use overflow-safe counting.
- Failure context reports the logical collection and approved limit, not raw content.
- Limits are engineering bounds and cannot be raised through untrusted commands.

### NFR Coverage

NFR-U01-CAP-001 through NFR-U01-CAP-004, NFR-U01-SEC-003, NFR-U01-SEC-006.

## PAT-U01-011 Benchmark Gate

### Intent

Make latency, complexity, and memory requirements verifiable without adding a runtime framework.

### Design

- Use a focused Node benchmark harness.
- Generate fixtures before measurement.
- Warm each operation.
- Use high-resolution monotonic timing.
- Record environment, seed, size, iterations, p50, p95, maximum, and heap delta.
- Exercise representative and maximum sizes.
- Fail with non-zero process status when approved thresholds are exceeded.
- Compare growth at increasing sizes to detect accidental quadratic behavior.

### NFR Coverage

NFR-U01-PERF-001 through NFR-U01-PERF-005, NFR-U01-CAP-005.

## PAT-U01-012 Layered Example and Property Verification

### Intent

Combine executable business examples with broad generated invariant search.

### Design

- Named example tests pin critical workflows and all stable failure codes.
- Reusable `fast-check` arbitraries generate constrained valid and intentionally invalid values.
- Round-trip properties verify canonical codecs.
- Invariant properties cover exactness, portfolio scope, quantities, weights, versions, and events.
- Idempotency covers archive, mode no-op, assignment no-op, and canonicalization.
- Permutation properties cover sleeve ordering.
- Stateful command models compare aggregate behavior with a simplified reference after every command.
- Shrinking remains enabled; seed and path are logged; relevant counterexamples become examples.

### Execution Minimums

- 1,000 runs for ordinary pure properties.
- 250 stateful sequences.
- Sequence length from 0 through 100.

### NFR Coverage

NFR-U01-PBT-001 through NFR-U01-PBT-010 and all 72 `BR-U01-*` rules.

## Pattern Interaction Order

For a portfolio command:

1. Capacity Guard rejects unsupported payload size.
2. Exact Value Object and Safe Context Builder validate closed command values.
3. Deterministic Transition checks identity, version, lifecycle, and command rules.
4. Closed Evidence Token validates guarded transition claims when required.
5. Two-Tier Integrity Validation checks affected and aggregate invariants.
6. Canonical Bounded Immutable Collection constructs the changed path.
7. Versioned Event Fact constructs events for accepted changes.
8. Typed Result and Invariant Boundary returns success, no-op, expected failure, or raises invariant corruption.
9. Layered Example and Property Verification proves the patterns against examples and generated inputs.
10. Benchmark Gate verifies capacity, latency, memory, and growth.

## Resilience and Infrastructure Exclusions

- No retry: there is no transient external failure in U01.
- No timeout: U01 has no blocking external operation; benchmark and capacity guards bound execution.
- No circuit breaker: U01 calls no dependency.
- No fallback state: returning stale or last-known state could authorize unsafe downstream work.
- No cache: immutable aggregate state and private indexes are sufficient.
- No queue or event broker: U02 and U06 later own commit and post-commit delivery.
- No health endpoint: U01 is not a process or service.
- No failover or DR component: U01 is recovered through persisted state validation by later units.

RESILIENCY-14 is N/A to U01 because there is no failover or recovery mechanism to test. The mandatory project resiliency-testing decision remains assigned to U06 NFR Design.

## Requirement Traceability Summary

| Requirement group | Pattern coverage |
|---|---|
| NFR-U01-CAP-001 through CAP-005 | PAT-U01-004, PAT-U01-010, PAT-U01-011 |
| NFR-U01-PERF-001 through PERF-005 | PAT-U01-004, PAT-U01-005, PAT-U01-011 |
| NFR-U01-REL-001 through REL-008 | PAT-U01-001 through PAT-U01-003, PAT-U01-005, PAT-U01-008 |
| NFR-U01-SEC-001 through SEC-010 | PAT-U01-002, PAT-U01-004, PAT-U01-006 through PAT-U01-010 |
| NFR-U01-PBT-001 through PBT-010 | PAT-U01-005, PAT-U01-012 |
| NFR-U01-MAINT-001 through MAINT-008 | PAT-U01-001, PAT-U01-007 through PAT-U01-009 |

All 46 U01 NFR requirements have at least one design pattern.

## Extension Compliance

### Security

| Rule | Status | Design disposition |
|---|---|---|
| SECURITY-01 | N/A | No U01 persistence or transport |
| SECURITY-02 | N/A | No network intermediary |
| SECURITY-03 | N/A | No deployed entry point or logger |
| SECURITY-04 | N/A | No HTML |
| SECURITY-05 | N/A at API layer | Controlled constructors provide defense in depth; U07 owns API validation |
| SECURITY-06 | N/A | No IAM policy |
| SECURITY-07 | N/A | No network configuration |
| SECURITY-08 | N/A at endpoint layer | Deterministic portfolio scope and evidence binding support U07 authorization |
| SECURITY-09 | N/A | No deployed runtime configuration |
| SECURITY-10 | Compliant | Zero production dependency and explicit contract gate |
| SECURITY-11 | Compliant | Closed security components, defense in depth, and abuse-sequence testing |
| SECURITY-12 | N/A | No credentials, authentication, or sessions |
| SECURITY-13 | Compliant | Versioned immutable events, evidence hashes, and exact state |
| SECURITY-14 | N/A | No logging, monitoring, or alerting owner |
| SECURITY-15 | Compliant | Typed failures, invariant containment, no fallback, and no swallowed exception |

No blocking U01 NFR Design security finding remains.

### Resiliency

| Rule | Status | Design disposition |
|---|---|---|
| RESILIENCY-01 | Compliant | Critical classification, impact, and dependencies are explicit |
| RESILIENCY-02 | N/A to U01 | Containing workload owns approved availability, RTO, and RPO |
| RESILIENCY-03 | N/A | No U01 change process |
| RESILIENCY-04 | N/A | No U01 deployment or rollback |
| RESILIENCY-05 | N/A | No deployed metrics, logs, traces, or dashboard |
| RESILIENCY-06 | N/A | No service health endpoint |
| RESILIENCY-07 | N/A | No deployed resiliency resource |
| RESILIENCY-08 | N/A | Local topology and no independent compute |
| RESILIENCY-09 | N/A | No independent auto-scaling or quota |
| RESILIENCY-10 | N/A | No external call; retries and circuit breakers are explicitly excluded |
| RESILIENCY-11 | N/A | No persistent production workload |
| RESILIENCY-12 | N/A | No persistent data or backup |
| RESILIENCY-13 | N/A | No failover or recovery runbook |
| RESILIENCY-14 | N/A to U01 | Assigned to U06 NFR Design |
| RESILIENCY-15 | N/A | No incident-response owner |

No blocking U01 NFR Design resiliency finding remains.

### Property-Based Testing

| Rule | Status | Design disposition |
|---|---|---|
| PBT-01 | Compliant | Functional components and categories are identified |
| PBT-02 | Compliant at design level | Exact-value, event, failure, allocation, and snapshot round trips |
| PBT-03 | Compliant at design level | Exactness, scope, lifecycle, quantity, weight, and event invariants |
| PBT-04 | Compliant at design level | Archive, no-op transitions, and canonicalization idempotency |
| PBT-05 | Compliant at design level | Full validator and simplified state model serve as oracles |
| PBT-06 | Compliant at design level | Command model checks real and model state after every step |
| PBT-07 | Compliant at design level | Reusable constrained arbitraries have a dedicated component |
| PBT-08 | Compliant at design level | Shrinking, seed, path, and replay are mandatory |
| PBT-09 | Compliant | `fast-check` with Node's test runner |
| PBT-10 | Compliant at design level | Explicit examples complement properties and capture counterexamples |

No blocking U01 NFR Design PBT finding remains.
