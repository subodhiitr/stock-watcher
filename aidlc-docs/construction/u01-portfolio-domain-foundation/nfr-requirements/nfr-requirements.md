# U01 Portfolio Domain Foundation NFR Requirements

## Scope and Criticality

U01 is a Critical in-process domain library. It defines exact financial values, portfolio state, strategy allocation, typed transitions, failures, events, and downstream ports. It has no independent process, database, network listener, filesystem access, scheduler, user interface, or broker connection.

U01 correctness is financially critical because every later unit trusts its invariants. U01 availability is inherited from the containing Node application; it has no independent SLA, failover, retry, or degraded mode.

## Capacity Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U01-CAP-001 | One Portfolio aggregate shall support up to 1,000 holdings. | Construct and validate boundary-sized generated aggregates. |
| NFR-U01-CAP-002 | One Portfolio aggregate shall support up to 10,000 open lots across its holdings. | Generate varied lot distributions, including all lots under one holding. |
| NFR-U01-CAP-003 | One multi-sleeve policy shall support up to 100 sleeves while enforcing positive distinct weights totaling exactly 100%. | Boundary examples and generated valid/invalid policies. |
| NFR-U01-CAP-004 | Collections above supported limits shall fail with stable bounded errors before expensive copying or validation. | Adversarial oversized-input examples. |
| NFR-U01-CAP-005 | Aggregate algorithms over holdings, lots, or sleeves shall be linear or O(n log n); no unbounded quadratic scan is allowed at supported limits. | Complexity review and benchmark growth curve. |

These limits are safety and engineering bounds, not investment-policy targets. Strategy-specific holdings remain far below the aggregate maximum.

## Performance Requirements

| ID | Requirement | Verification |
|---|---|---|
| NFR-U01-PERF-001 | A normal accepted or rejected portfolio transition shall complete below 25 ms p95 on the supported local Node runtime at a representative aggregate size of 100 holdings and 1,000 lots. | Warm in-process benchmark excluding startup and test generation. |
| NFR-U01-PERF-002 | Full integrity validation shall complete below 100 ms p95 for 1,000 holdings and 10,000 lots. | Boundary-size warm benchmark. |
| NFR-U01-PERF-003 | Canonicalization and validation of 100 sleeves shall complete below 10 ms p95. | Fixed-seed sleeve benchmark. |
| NFR-U01-PERF-004 | One boundary-size aggregate plus one transition shall add no more than 64 MiB peak heap above the benchmark baseline. | Node heap measurement with garbage collection policy documented. |
| NFR-U01-PERF-005 | Benchmarks shall record Node version, OS, processor, input size, warm-up, iterations, seed, p50, p95, and maximum. | Machine-readable benchmark report. |

Performance failures block U01 completion but never permit weakened validation or mutable shortcuts.

## Determinism and Reliability Requirements

| ID | Requirement |
|---|---|
| NFR-U01-REL-001 | Equivalent commands and equivalent aggregate state shall produce structurally equivalent results, events, failures, and ordering. |
| NFR-U01-REL-002 | U01 shall not read ambient time, randomness, environment variables, process state, filesystem, database, network, or global mutable state. |
| NFR-U01-REL-003 | Every expected invalid input or transition shall return one typed failure without mutation, partial result, event, retry, or success-shaped fallback. |
| NFR-U01-REL-004 | Unknown enum members, schema versions, evidence types, and trusted-state corruption shall fail closed. |
| NFR-U01-REL-005 | State-changing success shall increment the aggregate version exactly once; no-op and failure shall not increment it. |
| NFR-U01-REL-006 | Event ordering and canonical collection ordering shall be stable across Node processes and operating systems. |
| NFR-U01-REL-007 | U01 shall contain no retry, timeout, circuit-breaker, fallback, health-check, or alert logic because it performs no external operation. |
| NFR-U01-REL-008 | A dedicated top-level application boundary in a later unit shall handle invariant exceptions; U01 shall not catch and downgrade them. |

## Availability and Recovery Requirements

- U01 has no independent uptime target because it is not deployable.
- The containing portfolio workload retains the approved availability, hours-level RTO, and one-hour RPO.
- U01 state is recoverable by deterministic validation and replay from U02 persistence.
- U01 defines versioned event and snapshot contracts required for recovery but does not back up or restore data.
- Multi-zone, multi-region, auto-scaling, failover, and disaster-recovery infrastructure are N/A to U01.

## Security Requirements

| ID | Requirement |
|---|---|
| NFR-U01-SEC-001 | U01 data types shall contain only portfolio-domain identifiers, exact financial state, bounded names, state metadata, evidence references, and typed event payloads. |
| NFR-U01-SEC-002 | Passwords, session tokens, broker credentials, account identifiers, raw authorization tokens, and arbitrary request metadata shall be unrepresentable in U01 public entities. |
| NFR-U01-SEC-003 | Domain failure and event context shall use field-specific allowlists, bounded scalar counts and lengths, and safe redacted identifier rendering. |
| NFR-U01-SEC-004 | Evidence shall bind to portfolio, requested mode, evidence kind, issuer, issued time, expiry, and canonical integrity hash. Missing or mismatched claims fail closed. |
| NFR-U01-SEC-005 | Every command shall verify PortfolioId scope and expected state version before deeper state or transition evaluation. |
| NFR-U01-SEC-006 | Unknown or malformed persisted state shall never be normalized into a valid success state. |
| NFR-U01-SEC-007 | U01 shall not deserialize unknown input directly. U07 validates transport input and U02 validates persistence mappings before calling U01 constructors. |
| NFR-U01-SEC-008 | U01 shall introduce no production runtime dependency, reducing supply-chain and arbitrary-code surface. |
| NFR-U01-SEC-009 | Runtime immutability shall use private construction, defensive copying, canonical frozen arrays or records, and no exposed mutable Map or Set. |
| NFR-U01-SEC-010 | Security-sensitive transition tests shall include foreign portfolio identifiers, stale versions, forged evidence bindings, expired evidence, unsupported modes, and attempt sequences after archive. |

## Testing Requirements

### Example-Based Tests

- Every mandatory example scenario in `business-rules.md` shall have at least one explicit test.
- Every one of the 72 defined `BR-U01-*` rules shall map to one or more named test cases or properties.
- Critical regression tests shall pin exact values, event counts, event ordering, versions, and stable failure codes.
- Test fixtures shall use generated fake identifiers and contain no real broker, account, credential, or user data.

### Property-Based Tests

| ID | Requirement |
|---|---|
| NFR-U01-PBT-001 | Use `fast-check` integrated with Node's test runner. |
| NFR-U01-PBT-002 | Central reusable arbitraries shall cover exact values, identifiers, names, portfolios, holdings, lots, allocations, evidence, commands, events, and failures. |
| NFR-U01-PBT-003 | Pure properties shall run at least 1,000 generated cases in CI unless a documented higher-cost property has an approved lower bound. |
| NFR-U01-PBT-004 | Stateful Portfolio model tests shall run at least 250 generated command sequences with lengths from 0 through 100. |
| NFR-U01-PBT-005 | Shrinking shall remain enabled and failure output shall include seed, path, and minimal counterexample. |
| NFR-U01-PBT-006 | CI shall log the seed or use an explicitly recorded fixed seed; a retry shall not hide a failure. |
| NFR-U01-PBT-007 | Round-trip tests shall cover exact-value, event, failure, allocation-policy, and aggregate snapshot codecs. |
| NFR-U01-PBT-008 | Invariant tests shall cover cash, quantity, scope, version, event, allocation-total, lifecycle, and failure atomicity rules. |
| NFR-U01-PBT-009 | Canonical sleeve ordering shall be tested for permutation equivalence and idempotent canonicalization. |
| NFR-U01-PBT-010 | Every shrunk production-relevant counterexample shall become a permanent explicit regression test. |

## Maintainability Requirements

| ID | Requirement |
|---|---|
| NFR-U01-MAINT-001 | U01 shall consist of small cohesive strict-TypeScript modules under `server/portfolio/domain/` and capability interfaces under `server/portfolio/ports/`. |
| NFR-U01-MAINT-002 | Dependency direction shall be acyclic: domain values have no inward dependency; entities depend on values; aggregate behavior depends on entities and rules; ports depend only on public domain types. |
| NFR-U01-MAINT-003 | Public exports shall be explicit; wildcard barrel cycles and deep imports into another module's internals are prohibited. |
| NFR-U01-MAINT-004 | Every public type, state machine, event schema, failure code, scale, capacity bound, and business rule shall be documented. |
| NFR-U01-MAINT-005 | Event schemas and stable failure codes shall be versioned. Breaking changes require deprecation, dependent-unit review, and migration planning. |
| NFR-U01-MAINT-006 | Generated TypeScript declarations shall be reviewable as a contract artifact; unexpected declaration drift blocks merging. |
| NFR-U01-MAINT-007 | U01 shall not import persistence, HTTP, Remix, broker SDKs, legacy simulation, dashboard, or intraday-policy modules. |
| NFR-U01-MAINT-008 | Source shall use named constants for scales and limits; no unexplained financial or capacity literals. |

## Usability and Accessibility

U01 has no UI, so direct usability and WCAG requirements are N/A. U01 supports later accessible interfaces by providing:

- stable reason and failure codes;
- safe bounded context for blocking explanations;
- exact explicit units, currency, scales, and timestamps;
- no color, layout, language, or presentation assumptions.

## Acceptance Gates

U01 NFR compliance requires:

1. strict type checking passes;
2. all 72 business rules have test evidence;
3. explicit examples and required property suites pass;
4. p95 and memory budgets pass at documented capacities;
5. deterministic replay and canonical ordering pass across repeated processes;
6. declaration-contract review shows no unapproved breaking change;
7. dependency scans show no U01 production runtime dependency;
8. architecture checks show no forbidden import or cycle;
9. no blocking security, resiliency, or PBT finding remains.

## Extension Compliance

### Security

| Rule | Status | Requirement disposition |
|---|---|---|
| SECURITY-01 | N/A | U01 owns no persistence or transport |
| SECURITY-02 | N/A | No network intermediary |
| SECURITY-03 | N/A | No deployed entry point or logger |
| SECURITY-04 | N/A | No HTML response |
| SECURITY-05 | N/A at API layer | Domain validation is defense in depth; U07 owns API validation |
| SECURITY-06 | N/A | No IAM policy |
| SECURITY-07 | N/A | No network configuration |
| SECURITY-08 | N/A at endpoint layer | U01 enforces scope/evidence binding; U07 owns endpoint authorization |
| SECURITY-09 | N/A | No deployed runtime configuration |
| SECURITY-10 | Compliant | No U01 production runtime dependency; lock, scan, and SBOM remain project gates |
| SECURITY-11 | Compliant | Security-sensitive behavior is isolated and misuse cases are required tests |
| SECURITY-12 | N/A | No authentication, session, password, or credential handling |
| SECURITY-13 | Compliant | Immutable exact state, versioned events, and evidence hashes preserve integrity |
| SECURITY-14 | N/A | No logging or alerting owner |
| SECURITY-15 | Compliant | Total typed expected failures and fail-closed invariant handling are mandatory |

### Resiliency

| Rule | Status | Requirement disposition |
|---|---|---|
| RESILIENCY-01 | Compliant | U01 is Critical and its downstream dependencies and impact are documented |
| RESILIENCY-02 | N/A to U01 | Project availability, RTO, and RPO are inherited by containing workloads |
| RESILIENCY-03 | N/A | No unit-specific production change process |
| RESILIENCY-04 | N/A | No independent deployment or rollback |
| RESILIENCY-05 | N/A | No deployed metrics, logs, traces, or dashboard |
| RESILIENCY-06 | N/A | No service health endpoint |
| RESILIENCY-07 | N/A | No deployed resiliency resource |
| RESILIENCY-08 | N/A | Local workstation topology and no independent compute |
| RESILIENCY-09 | N/A | No independent capacity scaling |
| RESILIENCY-10 | N/A | No external dependency call |
| RESILIENCY-11 | N/A | No persistent workload |
| RESILIENCY-12 | N/A | No persistent data or backup |
| RESILIENCY-13 | N/A | No failover or recovery procedure |
| RESILIENCY-14 | N/A to U01 | Assigned to U06 NFR Design |
| RESILIENCY-15 | N/A | No incident response owner |

### Property-Based Testing

| Rule | Status | Requirement disposition |
|---|---|---|
| PBT-01 | Compliant | Functional Design identifies properties per component |
| PBT-02 | Compliant as requirement | Round-trip targets and minimum execution are specified |
| PBT-03 | Compliant as requirement | Business invariants and generated boundaries are specified |
| PBT-04 | Compliant as requirement | Archive, canonicalization, and no-op idempotency are specified |
| PBT-05 | Compliant as requirement | Stateful reference model and easy-verification checks are specified |
| PBT-06 | Compliant as requirement | Command-sequence model scope and run counts are specified |
| PBT-07 | Compliant as requirement | Reusable constrained domain arbitraries are mandatory |
| PBT-08 | Compliant as requirement | Shrinking, seed, path, and CI reproducibility are mandatory |
| PBT-09 | Compliant | `fast-check` with Node's test runner is selected |
| PBT-10 | Compliant as requirement | Explicit critical examples and counterexample regressions are mandatory |

No blocking U01 NFR Requirements extension finding remains.

