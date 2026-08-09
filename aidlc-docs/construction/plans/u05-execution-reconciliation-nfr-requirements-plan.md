# U05 Execution and Reconciliation NFR Requirements Plan

## Unit Context

- **Unit**: U05 Execution and Reconciliation
- **Stage**: NFR Requirements
- **Scope**: Documentation and design only
- **Primary stories**: US-021 through US-027
- **Supporting stories**: US-014, US-019, US-028, US-035, and US-038
- **Functional baseline**: 124 approved rules across 12 U05 subsystems, including the final post-review corrections
- **Dependencies**: U01 exact domain values, U02 transactional persistence and ownership boundary, U03 market-data lineage, U04 approved plan and lifecycle contracts, and the current legacy broker adapters
- **Extensions enabled**: Security Baseline, Resiliency Baseline, and Property-Based Testing - Full
- **Safety boundaries**: Live execution remains disabled by default; this stage performs no broker call, network call, trade, credential access, persisted-data operation, runtime code change, test change, or package change

## Ambiguity Policy

The request explicitly directs autonomous conservative resolution. Material NFR ambiguities will therefore be recorded as numbered decisions with source and safety rationale rather than deferred as questions. Every decision must fail closed, preserve exact accounting and portfolio isolation, avoid speculative dependencies, and remain compatible with the approved brownfield baseline.

## Conservative NFR Decisions

| Decision | Resolution | Rationale |
|---|---|---|
| AD-U05-NFR-01 | Classify execution, reconciliation, fill accounting, authority, and audit as a **Critical** in-process workload with no independent deployment SLA. | Matches approved project criticality while preserving the modular-monolith topology. |
| AD-U05-NFR-02 | Support one portfolio execution run with up to 250 approved orders, 1,000 holdings, 10,000 open lots, and 10,000 normalized fills; reject larger collections before external or database work. | Inherits U01/U02/U04 capacity ceilings and makes the fill/reconciliation ceiling explicit. |
| AD-U05-NFR-03 | Keep the U04 Asia/Kolkata configured window authoritative, normally 09:45 through 11:30; a broker call may start only when its full deadline fits before window end. | Prevents calls from outliving approved authority without inventing a new trading schedule. |
| AD-U05-NFR-04 | Use an 8-second default and 15-second hard cap for placement; a 10-second default and 20-second hard cap for status, fill, cancellation, account, cash, and holdings calls; use a 60-second default and 120-second hard cap for one coherent reconciliation collection. | Bounded deadlines are conservative for a local broker integration and expose slow dependencies without unbounded waits. |
| AD-U05-NFR-05 | Poll an acknowledged/open/cancel-pending order every 5 seconds by default, configurable only from 2 through 15 seconds; perform the first status/fill check within 2 seconds after acknowledgement, cancellation response, or ambiguous return. | Improves on the legacy 10-second/15-minute poller while remaining bounded and broker-conscious. |
| AD-U05-NFR-06 | Treat the legacy 15-minute confirmation timeout as a containment threshold, never proof of failure or cancellation; unresolved work becomes `UNKNOWN` or recovery-required and remains blocked. | Corrects the legacy success/failure inference hazard without claiming broker certainty. |
| AD-U05-NFR-07 | Permit at most three placement attempts total and only after `DEFINITELY_NOT_SENT`; use bounded injected backoff, revalidate every gate, and never retry a rejection, timeout, disconnect, malformed response, absent broker ID, or process crash. | Preserves the approved certainty model and idempotency contract. |
| AD-U05-NFR-08 | Require a reconciliation completed no more than 30 seconds before each dependent placement phase; exact snapshot endpoint times may differ by at most 10 seconds unless a broker cursor proves one coherent snapshot. | Creates a measurable freshness/coherence requirement while retaining broker-specific cursor support. |
| AD-U05-NFR-09 | Require pure state transition decisions below 10 ms p95, one U02 intent/outcome transition below 75 ms p95, one representative fill posting below 100 ms p95, and one worst-case 800-lot fill posting below 250 ms p95. | Aligns with U02 transaction budgets and U04's maximum participating sell-lot bound. |
| AD-U05-NFR-10 | Require a full in-memory comparison of 1,000 holdings, 250 orders, and 10,000 fills below 1.5 seconds p95, excluding broker I/O; require 10,000-fill recovery replay below 120 seconds p95. | Makes boundary reconciliation and recovery performance testable on the approved local workstation. |
| AD-U05-NFR-11 | On restart, classify all non-terminal local work within 30 seconds, start the first required reconciliation within 60 seconds after dependencies become healthy, and converge every broker-provable order within two reconciliation cycles or 5 minutes; unresolved external ambiguity remains safely blocked rather than falsely converged. | Separates local recovery performance from unknowable broker outcomes. |
| AD-U05-NFR-12 | Retain the project target of successful service in at least 99% of configured windows when host, exchange, broker, and required data are available, with hours-level RTO and one-hour RPO inherited from U02/U06. | Uses approved project recovery decisions and avoids a contradictory unit SLA. |
| AD-U05-NFR-13 | Use U01 `Money`, `Quantity`, `Weight`, `ScaledRate`, branded identifiers, U04 canonical plan hashes, and U02 synchronous transactions without a second accounting or transaction model. | Preserves exactness and the current brownfield owner boundary. |
| AD-U05-NFR-14 | Keep live execution false at environment, application, portfolio, strategy, broker-certification, and composition gates; missing means false, and no NFR fallback may weaken those gates. | Implements default deny across independent authority layers. |
| AD-U05-NFR-15 | Require paper mode to traverse the same validation, order, fill, cancellation, reconciliation, and accounting contracts; require dry-run to traverse request construction and validation but create no acknowledgement, fill, reservation, or financial mutation. | Defines measurable parity without misrepresenting dry-run as an execution. |
| AD-U05-NFR-16 | Permit no credential, live SDK, DNS, socket, non-loopback HTTP capability, or real broker call in any unit, property, model, integration, benchmark, or acceptance test; prove live placement is structurally unreachable. | Meets the explicit no-real-order constraint rather than relying on convention. |
| AD-U05-NFR-17 | Keep credentials outside U05 domain/application types and evidence. Legacy home-directory property loaders are not imported by U05; a later composition adapter supplies opaque capability and health only. | Prevents the current plaintext-file and raw-error legacy baseline from leaking into the new boundary. |
| AD-U05-NFR-18 | Use safe allowlisted codes, redacted stable bindings, hashes, counts, and timings for observability; never include raw broker payloads/errors, tokens, account IDs, paths, SQL, or stack traces. | Satisfies Security Baseline logging, integrity, and credential protections. |
| AD-U05-NFR-19 | Process one financial fill application per bounded U02 transaction; compare large snapshots in bounded memory outside transactions; allow no network wait, timer, Promise, or unbounded batch inside a transaction. | Fits the actual synchronous `BEGIN IMMEDIATE` unit-of-work contract and limits lock duration. |
| AD-U05-NFR-20 | Use Node 24 strict erasable TypeScript, NodeNext ESM, built-in timers/Abort APIs, `node:crypto`, and built-in `fetch` only for a future reviewed REST adapter; reuse `better-sqlite3` only through U02 and existing `fast-check`; add no dependency speculatively. | Uses the minimal approved brownfield stack and avoids supply-chain expansion. |
| AD-U05-NFR-21 | Require 1,000 cases for pure properties, 250 stateful command sequences of length 1 through 100, at least 500 generated adapter-contract cases, and at least 100 generated database/recovery scenarios unless a benchmark-justified exception is approved. | Applies Full PBT at financially critical depth while bounding expensive I/O models. |
| AD-U05-NFR-22 | Treat cancellation acknowledgement, false return, timeout, and race fills as non-terminal until status/fill reconciliation proves the final state; process each race fill exactly once before releasing reservations. | Makes the approved post-review cancellation correction measurable. |

## Plan Steps

- [x] Step 1: Load the AI-DLC NFR Requirements, common process, session continuity, content validation, and question-format rules.
- [x] Step 2: Read `aidlc-state.md`, confirm U05 Functional Design approval and post-review corrections, and confirm all three extensions are enabled.
- [x] Step 3: Load and classify every enabled Security, Resiliency, and Full PBT extension obligation applicable to this stage.
- [x] Step 4: Read the approved U05 Functional Design plan and all three artifacts, including all 24 decisions, 124 functional rules, algorithms, state machines, properties, and post-review corrections.
- [x] Step 5: Read project requirements, strategy presets, all U05 primary and supporting stories, personas, application design, component methods, services, unit map, dependency map, and story map.
- [x] Step 6: Read U01 through U04 NFR requirements and technology decisions to preserve established identifiers, thresholds, extension classifications, and brownfield conventions.
- [x] Step 7: Inspect the actual current `server/portfolio` exact-value, transaction, repository, event, planning, and package/TypeScript contracts; attempt the repository-prescribed CodeGraph command first, then use targeted source reads because that command is unavailable in this environment.
- [x] Step 8: Inspect the actual current legacy Sharekhan, Zerodha, route, polling, credential, and simulation execution baseline; attempt the repository-prescribed CodeGraph command first, then use targeted source reads because that command is unavailable in this environment.
- [x] Step 9: Record conservative numbered decisions for workload class, capacity, timing, polling, deadlines, reconciliation, restart, ambiguity, cancellation races, modes, security, observability, resources, and testing.
- [x] Step 10: Define uniquely identified measurable capacity and configured-window latency NFRs, including 250 approved orders and 10,000 lots/fills where applicable.
- [x] Step 11: Define uniquely identified measurable determinism, exactness, availability, reliability, idempotency, retry, ambiguity, recovery, and restart-convergence NFRs.
- [x] Step 12: Define uniquely identified measurable execution, fill-accounting, cancellation, reconciliation, paper/dry/live mode, and financial-safety NFRs.
- [x] Step 13: Define uniquely identified measurable security, credential, redaction, authority, observability, audit, resource-use, maintainability, and contract NFRs.
- [x] Step 14: Define Full PBT and complementary example/integration/contract/benchmark test obligations, including deterministic seeds, shrinking, state-machine models, and zero real broker calls.
- [x] Step 15: Select and document the minimal brownfield-compatible technology stack without adding speculative dependencies.
- [x] Step 16: Map every U05 primary and supporting story, all 124 functional rules, project requirement groups, and applicable extension obligations to the NFR set.
- [x] Step 17: Create `nfr-requirements.md` and `tech-stack-decisions.md` under the U05 `nfr-requirements` directory.
- [x] Step 18: Validate unique NFR IDs and counts, 124-rule coverage, story and requirement traceability, decision references, thresholds, Markdown structure, and internal links.
- [x] Step 19: Verify Security, Resiliency, and Full PBT compliance with explicit compliant or N/A rationale and resolve every blocking finding.
- [x] Step 20: Verify scope from the worktree diff and confirm no runtime code, tests, package files, persisted data, credentials, network calls, or trades were touched by this stage.
- [x] Step 21: Append the completion and approval record to `audit.md`, update `aidlc-state.md` to mark U05 NFR Requirements complete, and leave U05 NFR Design next but unstarted.
- [x] Step 22: Re-run final document validation after state and audit updates and record the final counts and blocker status.

## Artifact Targets

| Artifact | Path |
|---|---|
| Plan | `aidlc-docs/construction/plans/u05-execution-reconciliation-nfr-requirements-plan.md` |
| NFR Requirements | `aidlc-docs/construction/u05-execution-reconciliation/nfr-requirements/nfr-requirements.md` |
| Technology Stack Decisions | `aidlc-docs/construction/u05-execution-reconciliation/nfr-requirements/tech-stack-decisions.md` |
| Workflow state | `aidlc-docs/aidlc-state.md` |
| Audit trail | `aidlc-docs/audit.md` |

## Completion Gates

- [x] Every `NFR-U05-*` identifier is unique and every requirement is measurable.
- [x] All 12 U05 stories and all 124 approved functional rules are covered without changing functional behavior.
- [x] Capacity, configured-window latency, determinism, recovery, execution safety, security, observability, resources, contracts, and Full PBT/testing are complete.
- [x] Technology choices reuse Node 24, strict erasable TypeScript, exact U01 values, U02 transactions, built-in Node facilities, the `better-sqlite3` owner boundary, and existing `fast-check`.
- [x] Security, Resiliency, and Full PBT extension checks have no blocking finding.
- [x] U05 NFR Design remains unstarted.
