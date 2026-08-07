# U03 Strategy, Data, and Research – NFR Requirements Plan

## Unit Context

- **Unit**: U03 Strategy, Data, and Research
- **Primary stories**: US-006 through US-008, US-010 through US-014, US-036 through US-038 (eleven stories)
- **Criticality**: High — evaluation pipeline drives every downstream construction, execution, and risk decision
- **Depends on**: U01 domain contracts, U02 persistence
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes – Full)
- **Functional design artifacts**: `aidlc-docs/construction/u03-strategy-data-research/functional-design/`

## Autopilot Mode Notice

The user is unavailable. All NFR ambiguities are resolved below using the recommended autopilot choice. Each decision references the supporting spec, story, or established project convention.

## Documented Autopilot NFR Decisions

| # | Ambiguity | Recommended Decision | Source |
|---|---|---|---|
| AD-N01 | Arithmetic model for z-score computation | Use JavaScript Number (IEEE 754 double) with explicit NaN, Infinity, and negative-infinity guards after every step; weight sum validation uses scaled integer parts-per-million from U01 exact-value contracts; NaN/Infinity detection is a hard gate before any downstream use | US-012, FD SC-010, FD P-13 |
| AD-N02 | Per-provider call deadline | 30 seconds default per call, configurable per provider; exhausted retries plus deadline produce a terminal ProviderErrorEvent | FD DF-006, spec §17 |
| AD-N03 | Full single-date evaluation latency target | 60 seconds p95 wall clock for 1,000 eligible instruments (eligibility + signal scoring + regime determination), measured from data-ready to evaluation-result, excluding provider I/O latency | US-039, spec §capacity |
| AD-N04 | Backtest run time target | 10 minutes p95 for a 5-year 1,000-instrument backtest with walk-forward enabled; excessive runs fail with a timeout error rather than producing partial results | US-036, spec §15 |
| AD-N05 | CI property test counts | Pure properties: 1,000 cases minimum; stateful model sequences: 250 sequences of length 1–100; expensive backtest properties: 50 cases; all use logged or fixed seeds | US-039, U01/U02 NFR patterns |
| AD-N06 | Production runtime dependencies | No new production runtime dependency; reuse Node built-in node:crypto for SHA-256, the existing fast-check development dependency, and Node built-in test runner; optionally introduce a lightweight argument-parsing helper for the backtest CLI only if the project already has one | U01/U02 NFR patterns, spec supply-chain policy |
| AD-N07 | Live-quote freshness window | 5 minutes maximum age before a live quote is treated as stale and blocks pre-trade price checks; configurable per deployment | FD MD-012 |
| AD-N08 | Calendar data freshness window | 24 hours maximum age before exchange calendar data is treated as stale; configurable | FD MD-010 |
| AD-N09 | DataVersionSnapshot ID scheme | Use node:crypto randomUUID for snapshot IDs; no monotonic counter to avoid coordination requirements | U01 identifier patterns |
| AD-N10 | Regime indicator data freshness | If any regime indicator is older than 1 trading session, fail closed to CRISIS; no grace period | FD AD-08, RM-008 |

## Plan Steps

- [x] Step 1: Read U03 functional design artifacts (business-logic-model.md, business-rules.md, domain-entities.md)
- [x] Step 2: Read all eleven U03 stories (US-006 through US-008, US-010 through US-014, US-036 through US-038)
- [x] Step 3: Read U01 and U02 NFR requirements and tech-stack decisions for pattern consistency
- [x] Step 4: Read enabled extension rules (Security Baseline, Resiliency Baseline, PBT Full)
- [x] Step 5: Document all NFR ambiguities and autopilot decisions (AD-N01 through AD-N10 above)
- [x] Step 6: Design capacity requirements (universe, history, backtest, portfolios)
- [x] Step 7: Design performance and latency requirements (evaluation, backtest, config, provider)
- [x] Step 8: Design determinism and reliability requirements (exact arithmetic, fail-closed, idempotency)
- [x] Step 9: Design availability and recovery requirements (SLA inheritance, RTO/RPO, degraded mode)
- [x] Step 10: Design security requirements (input validation, credential redaction, AI boundary, audit)
- [x] Step 11: Design observability requirements (provider health, data provenance, evaluation lineage)
- [x] Step 12: Design research-mode separation requirements (production-quality flag, non-execution data)
- [x] Step 13: Design provider resilience requirements (retry, circuit breaker, deadline, health)
- [x] Step 14: Design testing and PBT requirements (generators, counts, shrinking, story coverage)
- [x] Step 15: Design maintainability requirements (module boundaries, dependency direction)
- [x] Step 16: Write nfr-requirements.md
- [x] Step 17: Write tech-stack-decisions.md
- [x] Step 18: Perform Security, Resiliency, and PBT extension compliance review
- [x] Step 19: Update aidlc-docs/aidlc-state.md with U03 NFR Requirements status
- [x] Step 20: Append to aidlc-docs/audit.md (review gate, autopilot option B selected)

## Artifacts

| Artifact | Path |
|---|---|
| NFR Requirements | `aidlc-docs/construction/u03-strategy-data-research/nfr-requirements/nfr-requirements.md` |
| Technology Stack Decisions | `aidlc-docs/construction/u03-strategy-data-research/nfr-requirements/tech-stack-decisions.md` |

## Extension Compliance Summary

| Extension | Rule | Applicable | Result |
|---|---|---|---|
| Security | SECURITY-01 Encryption at rest | N/A – U03 defines no persistence layer | N/A |
| Security | SECURITY-02 Network logging | N/A – U03 is not a network-facing intermediary | N/A |
| Security | SECURITY-03 Application logging | Yes – provider errors, credential redaction, evaluation correlation IDs | Compliant – NFR-U03-SEC-001 through SEC-004 |
| Security | SECURITY-04 HTTP security headers | N/A – U03 serves no HTTP | N/A |
| Security | SECURITY-05 Input validation | Yes – strategy config JSON and provider payloads | Compliant – NFR-U03-SEC-005, SEC-006 |
| Security | SECURITY-08 Least privilege | N/A – U03 defines no authorization layer | N/A |
| Security | SECURITY-11 Execution limits | Yes – AI advisory structural boundary enforced | Compliant – NFR-U03-SEC-007 through SEC-009 |
| Security | SECURITY-13 Audit logging | Yes – strategy lifecycle, AI interactions, evaluation provenance | Compliant – NFR-U03-SEC-010, SEC-011 |
| Security | SECURITY-15 Input sanitization | Yes – safe JSON parsing before field access | Compliant – NFR-U03-SEC-005, SEC-006 |
| Resiliency | RESILIENCY-01 Workload criticality | Yes – classification documented | Compliant – Scope and Criticality section |
| Resiliency | RESILIENCY-02 Availability/RTO/RPO | Yes – inherited from project-wide approved targets | Compliant – Availability section |
| Resiliency | RESILIENCY-05 Dependency failure | Yes – provider retry, circuit breaker, fail-closed | Compliant – NFR-U03-RES-001 through RES-008 |
| Resiliency | RESILIENCY-06 Circuit breaking | Yes – per-provider circuit breaker | Compliant – NFR-U03-RES-004 through RES-006 |
| Resiliency | RESILIENCY-10 Degradation | Yes – non-critical AI/news path degrades gracefully | Compliant – NFR-U03-RES-007, RES-008 |
| PBT | PBT-01 Property identification | Complete in Functional Design (32 properties P-01 through P-32) | Compliant |
| PBT | PBT-02 through PBT-08, PBT-10 | Measurable Code Generation obligations | Compliant – NFR-U03-PBT-001 through PBT-014 |
| PBT | PBT-09 Framework selection | fast-check already locked | Compliant – tech-stack-decisions.md |

**Finding**: No blocking Security, Resiliency, or PBT finding detected.
