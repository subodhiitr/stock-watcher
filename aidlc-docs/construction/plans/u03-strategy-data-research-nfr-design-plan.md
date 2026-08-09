# U03 Strategy, Data, and Research – NFR Design Plan

## Unit Context

- **Unit**: U03 Strategy, Data, and Research
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes – Full)
- **NFR requirements**: `aidlc-docs/construction/u03-strategy-data-research/nfr-requirements/nfr-requirements.md` (100 unique requirements)
- **NFR tech stack**: `aidlc-docs/construction/u03-strategy-data-research/nfr-requirements/tech-stack-decisions.md`
- **Target artifacts**: `nfr-design-patterns.md` (≥14 patterns) and `logical-components.md` (20–30 acyclic components)

## Autopilot Mode Notice

The user is unavailable. All design ambiguities are resolved below with documented rationale.

## Documented Autopilot Design Decisions

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| AD-D01 | Worker threads for signal scoring | Reject for initial implementation; single-threaded synchronous evaluation. Revisit if benchmark evidence shows 60 s p95 cannot be met. | NFR-U03-PERF-001; NFR tech-stack decision AD-N03 |
| AD-D02 | Per-provider vs shared circuit breaker | One independent circuit breaker instance per external provider port. Failure in one provider does not affect others. | NFR-U03-RES-006 |
| AD-D03 | Retry state persistence | In-memory only. No durable retry queue. Retry counter is local to the current call attempt. | NFR-U03-RES-001; U03 is not a durable messaging unit |
| AD-D04 | DEGRADED_ADVISORY_CONTEXT label | Once set on a SignalSnapshot or research report, the label is immutable. It cannot be removed by a later successful AI call on the same snapshot. | NFR-U03-OBS-004 |
| AD-D05 | CorporateAction as aggregate or service | CorporateAction is a domain aggregate with its own state machine (PENDING → PROCESSED/BLOCKED/REQUIRES_MANUAL_REVIEW). The processor is an application service that orchestrates aggregate transitions through the port. | FD domain-entities.md §CorporateAction |
| AD-D06 | Infrastructure component for resilience | Provider resilience (retry + deadline wrapping) lives in a shared `ProviderResilienceWrapper` infrastructure component. Each provider adapter calls this wrapper. Circuit breaker state lives in a `ProviderCircuitBreakerRegistry` that maps provider identity to circuit state. | NFR-U03-RES-001 through RES-006 |
| AD-D07 | Research-mode gate placement | ResearchModeGate is an infrastructure component called at the application service boundary. It inspects DataVersionSnapshot.isProductionQuality before any production evaluation call. Domain logic never calls the gate directly. | NFR-U03-RSC-001 through RSC-005 |

## Plan Steps

- [x] Step 1: Read U03 NFR requirements and tech-stack decisions
- [x] Step 2: Read U03 functional design artifacts (business-logic-model.md, domain-entities.md, business-rules.md)
- [x] Step 3: Read U01 and U02 NFR design patterns for pattern conventions
- [x] Step 4: Read enabled extension rules (Security, Resiliency, PBT Full)
- [x] Step 5: Document design ambiguities and autopilot decisions (AD-D01 through AD-D07)
- [x] Step 6: Design deterministic evaluation and exact arithmetic patterns
- [x] Step 7: Design point-in-time data versioning and provenance pattern
- [x] Step 8: Design provider resilience patterns (deadline, retry, circuit breaker, health)
- [x] Step 9: Design research-mode separation and production-quality gate pattern
- [x] Step 10: Design strategy activation evidence gate pattern
- [x] Step 11: Design backtest bias certification pattern
- [x] Step 12: Design AI advisory structural boundary pattern
- [x] Step 13: Design credential-redacted logging and observability pattern
- [x] Step 14: Design degraded advisory path pattern
- [x] Step 15: Design test generator architecture pattern
- [x] Step 16: Write nfr-design-patterns.md (≥14 patterns, all 100 NFRs assigned)
- [x] Step 17: Define logical components (20–30 acyclic components, dependency matrix)
- [x] Step 18: Write logical-components.md
- [x] Step 19: Perform Security, Resiliency, and PBT extension compliance review
- [x] Step 20: Verify all 100 NFR IDs are assigned to at least one pattern or component
- [x] Step 21: Update aidlc-docs/aidlc-state.md with U03 NFR Design status
- [x] Step 22: Append to aidlc-docs/audit.md (review gate, autopilot option B selected)

## Artifacts

| Artifact | Path |
|---|---|
| NFR Design Patterns | `aidlc-docs/construction/u03-strategy-data-research/nfr-design/nfr-design-patterns.md` |
| Logical Components | `aidlc-docs/construction/u03-strategy-data-research/nfr-design/logical-components.md` |

## Extension Compliance Summary

| Extension | Rule | Applicable | Result |
|---|---|---|---|
| Security | SECURITY-03 Application logging | Yes | Compliant – PAT-U03-012 (credential-redacted structured logging) |
| Security | SECURITY-05 Input validation | Yes | Compliant – PAT-U03-002, PAT-U03-003 (schema validation gate) |
| Security | SECURITY-11 Execution limits | Yes | Compliant – PAT-U03-010 (AI advisory structural boundary) |
| Security | SECURITY-13 Audit logging | Yes | Compliant – PAT-U03-008, PAT-U03-010 (lifecycle events, AI audit) |
| Security | SECURITY-15 Input sanitization | Yes | Compliant – PAT-U03-002 (safe JSON parsing before field access) |
| Resiliency | RESILIENCY-01 Workload criticality | Yes | Compliant – documented in scope section of logical-components.md |
| Resiliency | RESILIENCY-02 Availability/RTO/RPO | Yes | Compliant – inherited from project, documented in logical-components.md |
| Resiliency | RESILIENCY-05 Dependency failure | Yes | Compliant – PAT-U03-005, PAT-U03-006 |
| Resiliency | RESILIENCY-06 Circuit breaking | Yes | Compliant – PAT-U03-006 |
| Resiliency | RESILIENCY-10 Degradation | Yes | Compliant – PAT-U03-013 |
| PBT | PBT-01 through PBT-08, PBT-10 | Yes | Compliant – PAT-U03-014 and all logical component PBT assignments |

**Finding**: No blocking Security, Resiliency, or PBT finding.
