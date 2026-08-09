# U03 Strategy, Data, and Research – Infrastructure Design Plan

## Unit Context

- **Unit**: U03 Strategy, Data, and Research
- **Stage**: Infrastructure Design (selective)
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes – Full)
- **Input artifacts**: U03 functional design, NFR requirements, NFR design patterns, logical components
- **Target artifacts**: `infrastructure-design.md` and `deployment-architecture.md`

## Autopilot Mode Notice

The user is unavailable. All infrastructure ambiguities are resolved below with documented rationale. Questions from Step 3 are answered in the Autopilot Decisions table; no interactive Q&A phase is required.

## Documented Autopilot Infrastructure Decisions

| # | Ambiguity Category | Decision | Rationale |
|---|---|---|---|
| AD-I01 | Deployment environment | Local Windows workstation only. Same single-node process as U01/U02. No cloud account, container, VM, or managed service. | Approved topology throughout the project. |
| AD-I02 | Compute infrastructure | Existing Node.js 24 process. No worker thread, child process, or separate process for U03 computation. | NFR-U03-PERF-001 budget (60 s p95) is met by single-threaded synchronous evaluation per AD-D01 from NFR Design. |
| AD-I03 | HTTP client | Node 24 built-in `fetch` (global, standard). No `axios`, `got`, `node-fetch`, or other HTTP library added. | tech-stack-decisions.md zero-new-prod-deps policy. |
| AD-I04 | TLS validation | System CA trust store via Node's built-in TLS stack. `rejectUnauthorized` is always `true`. No certificate pinning and no disable option. Self-signed provider certificates are never permitted in production. | NFR-U03-SEC-001 (credential and error safety); SEC extension baseline. |
| AD-I05 | Provider credential storage | One environment variable per provider API key (e.g. `PORTFOLIO_MARKET_DATA_API_KEY`), read once at adapter construction. Variables are documented in `.env.example` but never committed. Credentials do not appear in logs, errors, types, or database. | `.env.example` precedent; NFR-U03-SEC-002. |
| AD-I06 | Provider URL configuration | One environment variable per provider base URL (e.g. `PORTFOLIO_MARKET_DATA_BASE_URL`). Defaults suitable for local dev are coded in the adapter; production overrides via env. | Same pattern as existing proxy overrides in `.env.example`. |
| AD-I07 | Research data storage (NSE/Yahoo) | A configurable local directory (`PORTFOLIO_RESEARCH_DATA_PATH`, default `research-data/portfolio/`). NSE official data: flat newline-delimited JSON files downloaded out-of-band. Yahoo Finance data: fetched at request time via HTTPS and held in memory for the evaluation session only. Neither source writes to `portfolio-management.db`. | Structural separation between production data path (U02 SQLite) and research data path prevents cross-contamination. |
| AD-I08 | DataVersionSnapshot persistence | Through U02 `MarketDataSnapshotRepository` port (declared in LC-U03-24). Adapters never write directly to SQLite. | U03 has no direct database dependency; U02 owns all persistence. |
| AD-I09 | Circuit breaker state | In-memory only. No Redis, no file, no database. Resets on process restart. | NFR-U03-RES-003 through RES-006; NFR Design PAT-U03-006. |
| AD-I10 | Provider health registry | In-memory per-process map. Updated after every call attempt. Queryable by U06 through a port interface. No persistence. | NFR-U03-RES-008; NFR-U03-OBS-003. |
| AD-I11 | Messaging infrastructure | None introduced. Domain events are staged to U02 event ledger through the UnitOfWork. No external broker, queue, pub/sub, or outbox service is added. | U03 is not a messaging unit. |
| AD-I12 | Monitoring infrastructure | U03 emits structured log lines (JSON, to stdout) for provider errors, circuit state transitions, research-mode gate rejections, AI advisory interactions, and lifecycle events. U06 will consume these. No separate log aggregator, metrics sidecar, or tracing agent is added by U03. | NFR-U03-OBS-001 through OBS-006; U06 owns observability infrastructure. |

## Plan Steps

- [x] Step 1: Read infrastructure-design.md rules
- [x] Step 2: Read U03 functional design, NFR requirements, NFR design, and U02 infrastructure reference
- [x] Step 3: Identify and document all infrastructure ambiguities and autopilot decisions (AD-I01 through AD-I12)
- [x] Step 4: Design compute and process topology
- [x] Step 5: Design network and TLS boundaries (outbound HTTPS to 7 providers)
- [x] Step 6: Design provider adapter infrastructure (credential loading, URL injection, HTTP client)
- [x] Step 7: Design resilience infrastructure (retry, circuit breaker, deadline mapping to in-process components)
- [x] Step 8: Design provider health registry infrastructure
- [x] Step 9: Design research data storage/injection topology (local directory, NSE files, Yahoo fetch)
- [x] Step 10: Design DataVersionSnapshot and strategy/backtest persistence through U02 ports
- [x] Step 11: Design environment variable naming and secret management
- [x] Step 12: Design startup sequence
- [x] Step 13: Design shutdown sequence
- [x] Step 14: Design failure boundaries per provider and per subsystem
- [x] Step 15: Enumerate all explicitly absent cloud and infrastructure resources
- [x] Step 16: Perform Security, Resiliency, and PBT extension compliance review
- [x] Step 17: Write infrastructure-design.md
- [x] Step 18: Write deployment-architecture.md
- [x] Step 19: Update aidlc-state.md
- [x] Step 20: Append completion gate and autopilot option B to audit.md

## Artifacts

| Artifact | Path |
|---|---|
| Infrastructure Design | `aidlc-docs/construction/u03-strategy-data-research/infrastructure-design/infrastructure-design.md` |
| Deployment Architecture | `aidlc-docs/construction/u03-strategy-data-research/infrastructure-design/deployment-architecture.md` |

## Extension Compliance Summary

| Extension | Rule | Applicable | Result |
|---|---|---|---|
| Security | SECURITY-01 (access controls) | Yes | Compliant – provider credentials in env vars only; never in code, log, DB, or error payload |
| Security | SECURITY-03 (logging) | Yes | Compliant – structured JSON stdout; credential redaction before any log write |
| Security | SECURITY-05 (input validation) | Yes | Compliant – provider payload schema validation before DataVersionSnapshot use |
| Security | SECURITY-06 (IAM) | N/A | No cloud IAM; local process only |
| Security | SECURITY-07 (network) | Yes | Compliant – all outbound calls use mandatory TLS; no inbound network listener opened by U03 |
| Security | SECURITY-09 (secrets management) | Yes | Compliant – env-var-based; not in source, not in DB |
| Security | SECURITY-13 (audit logging) | Yes | Compliant – lifecycle events and AI interactions are immutable audit events |
| Resiliency | RESILIENCY-01 (criticality) | Yes | Compliant – critical evaluation path documented |
| Resiliency | RESILIENCY-02 (availability/RTO) | Yes | Compliant – inherits project SLA; fail-closed on critical provider unavailability |
| Resiliency | RESILIENCY-05 (dependency failure) | Yes | Compliant – retry + deadline per provider (PAT-U03-005) |
| Resiliency | RESILIENCY-06 (circuit breaking) | Yes | Compliant – per-provider circuit breaker (PAT-U03-006) |
| Resiliency | RESILIENCY-10 (degradation) | Yes | Compliant – non-critical path degrades to DEGRADED_ADVISORY_CONTEXT (PAT-U03-013) |
| Resiliency | RESILIENCY-14 | N/A | Assigned to U06 per prior aidlc-state.md decision |
| PBT Full | All PBT rules | N/A for infra stage | PBT coverage is in test/benchmark components; no infrastructure finding |

**Finding**: No blocking Security, Resiliency, or PBT finding for the infrastructure scope.
