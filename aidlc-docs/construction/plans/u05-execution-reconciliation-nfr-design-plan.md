# U05 Execution and Reconciliation NFR Design Plan

## Unit Context

- **Unit**: U05 Execution and Reconciliation
- **Criticality**: Critical financial execution, reconciliation, exact accounting, containment, and recovery logic
- **Approved inputs**: 24 Functional Design decisions, 124 functional rules, 134 measurable NFRs, and 18 technology-stack decisions
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes - Full)
- **Target artifacts**: `nfr-design-patterns.md` and `logical-components.md`
- **Runtime boundary**: Existing local Node.js strict-TypeScript modular monolith under `server/portfolio/`
- **Safety boundary**: Live execution remains disabled by default; this stage performs no broker call, database mutation, credential access, or trade

## Inherited and Autopilot Answers

The user already approved the project-level resiliency choices in `aidlc-docs/inception/requirements/resiliency-clarification-questions.md`. Those answers are propagated unchanged. Remaining unit-level ambiguities are resolved conservatively under active autopilot and are explicit below.

### Question 1 - Resilience Pattern

How should U05 distinguish retryable broker operations?

A) Permit bounded retry only for safe reads and broker-proved `DEFINITELY_NOT_SENT` placement outcomes; treat all transport uncertainty as `UNKNOWN`

B) Apply one generic retry policy to reads and writes

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 2 - Scalability Pattern

How should U05 meet its approved local capacity targets?

A) Use bounded sequential in-process orchestration, canonical `O(n)` or `O(n log n)` algorithms, and short synchronous transactions; add concurrency only after benchmark evidence

B) Add worker threads, queues, or a separate execution service now

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 3 - Performance Pattern

Where should broker waits and large reconciliation comparisons run?

A) Outside U02 transactions, with only bounded intent/outcome/fill facts committed in short synchronous transactions

B) Inside one transaction spanning the complete broker workflow

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 4 - Security Pattern

How should live adapter authority be represented?

A) As a trusted composition capability separate from user input, with every independent live gate defaulting false and revalidated immediately before placement

B) Derive authority from portfolio mode or a requested adapter name

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 5 - Logical Component Shape

How should U05 integrate with the brownfield codebase?

A) Add domain, application, port, persistence-adapter, broker-adapter, infrastructure, test, and benchmark components under existing portfolio boundaries with acyclic dependencies

B) Reuse the legacy trade routes and direct broker clients as the application contract

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 6 - Resiliency Testing Approach

How will U05 resilience mechanisms be validated?

A) Use an existing organizational game-day or chaos practice

B) Define a lightweight deterministic fault-injection and restart-recovery matrix for U05, execute applicable cases during Code Generation and final Build and Test, and retain operational drills for U06/U09

C) Defer all resilience validation to Operations

X) Other (please describe after `[Answer]:` tag below)

[Answer]: B

### Question 7 - Inherited Recovery and Deployment Decisions

Which approved project decisions apply to U05?

A) Hours-level encrypted backup/restore, lightweight change control, GitHub Actions, database-aware rollback, direct local deployment, no cloud-region topology, and lightweight incident/COE process

B) Replace the approved project decisions with unit-specific cloud infrastructure

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

## Documented Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| AD-U05-D01 | Keep U05 in the existing local Node process; no queue, worker, cache, or new service. | Meets current capacity without adding recovery surfaces. |
| AD-U05-D02 | Use pure closed state-transition functions plus immutable aggregate facts. | Enables exhaustive review, deterministic replay, and stateful PBT. |
| AD-U05-D03 | Separate order identity from one-time mutable-to-immutable buy intent finalization. | Preserves idempotency while allowing only downward post-sell affordability adjustment. |
| AD-U05-D04 | Commit intent/attempt before external placement and outcome afterward in a second short transaction. | Prevents unrecorded submissions and async work inside U02 transactions. |
| AD-U05-D05 | Permit placement retry only after adapter proof of `DEFINITELY_NOT_SENT`; otherwise persist `UNKNOWN`. | Duplicate live placement is the dominant safety hazard. |
| AD-U05-D06 | Use one normalized `BrokerPort` with separate paper, dry-run, fake, Zerodha, and Sharekhan adapters. | Keeps application behavior mode-consistent without leaking SDK contracts. |
| AD-U05-D07 | Represent live authority as a composition capability plus an all-gates-true snapshot. | User input and portfolio mode cannot grant broker authority. |
| AD-U05-D08 | Treat reconciliation as immutable coherent snapshot collection followed by pure canonical comparison. | Separates external evidence from accounting mutation and supports replay. |
| AD-U05-D09 | Apply each unique fill in one atomic transaction with order, reservation, cash, holding, lot, and event invariants. | Prevents partial accounting and duplicate effects. |
| AD-U05-D10 | Use injected clock, timer, ID source, retry schedule, and deterministic paper fill policy. | Removes ambient nondeterminism and makes every timing boundary testable. |
| AD-U05-D11 | Reuse existing circuit/redaction primitives only where contracts fit; create certainty-aware execution resilience components rather than wrapping placement generically. | Existing read resilience must not weaken placement semantics. |
| AD-U05-D12 | Emit typed immutable evidence and metric payloads; U06 owns sinks, dashboards, alerts, incident routing, and scheduled operations. | Preserves unit ownership and avoids adding an observability SDK. |
| AD-U05-D13 | Add numbered U02 migration and transaction capabilities only during Code Generation; never alter migration 001 or expose raw SQL. | Preserves the persistence ownership and rollback model. |
| AD-U05-D14 | Keep both live adapters uncertified and uncomposable until their common conformance suite passes. | Current legacy clients are unsafe execution authorities. |
| AD-U05-D15 | Verify every critical path with paired named examples and generated properties/models; deterministic fault injection covers ambiguity, races, rollback, restart, and skew. | Satisfies Full PBT and resiliency requirements without real broker access. |

## Plan Steps

- [x] Step 1: Load the NFR Design, content-validation, and question-format rules.
- [x] Step 2: Confirm Security, Resiliency, and Property-Based Testing (Full) are enabled.
- [x] Step 3: Load the full enabled extension rule files and classify U05 applicability.
- [x] Step 4: Read the approved U05 Functional Design, NFR Requirements, and technology decisions.
- [x] Step 5: Read prior portfolio NFR design conventions and the current U01-U04 module boundaries.
- [x] Step 6: Attempt the required CodeGraph exploration; record that the configured executable is unavailable and use focused repository discovery instead.
- [x] Step 7: Propagate approved project-level resiliency answers and resolve remaining U05 ambiguities through the seven answered questions above.
- [x] Step 8: Record conservative design decisions AD-U05-D01 through AD-U05-D15.
- [x] Step 9: Design deterministic state, canonical integrity, idempotency, and exact-value patterns.
- [x] Step 10: Design intent-before-submit, certainty-aware retry, cancellation-race, and unknown-outcome containment patterns.
- [x] Step 11: Design fill accounting, reservations, reconciliation coherence, kill-switch, and restart recovery patterns.
- [x] Step 12: Design capability security, adapter conformance, redaction, observability, capacity, and resource patterns.
- [x] Step 13: Design property, model, contract, fault-injection, and benchmark verification patterns.
- [x] Step 14: Write `nfr-design/nfr-design-patterns.md` with complete 134-NFR coverage.
- [x] Step 15: Write `nfr-design/logical-components.md` with acyclic source placement and dependency rules.
- [x] Step 16: Validate all NFR IDs, pattern/component counts, traceability, tables, code fences, and checkboxes mechanically.
- [x] Step 17: Complete Security, Resiliency, and Full PBT compliance review with no blocking finding.
- [x] Step 18: Record NFR Design completion and approval in state, audit, and the session roadmap.

## Artifact Targets

| Artifact | Path |
|---|---|
| Plan | `aidlc-docs/construction/plans/u05-execution-reconciliation-nfr-design-plan.md` |
| NFR Design Patterns | `aidlc-docs/construction/u05-execution-reconciliation/nfr-design/nfr-design-patterns.md` |
| Logical Components | `aidlc-docs/construction/u05-execution-reconciliation/nfr-design/logical-components.md` |

## Completion Checks

- [x] At least 18 focused U05 NFR design patterns are defined.
- [x] Between 28 and 36 acyclic logical components are defined.
- [x] All 134 unique `NFR-U05-*` identifiers are mapped to patterns and components.
- [x] Every applicable Security and Resiliency rule is compliant and every N/A has a unit-specific rationale.
- [x] Full PBT design covers round trips, invariants, idempotency, models, oracles, generators, shrinking, replay, and complementary examples.
- [x] No design path authorizes a real broker call, reads a credential, alters persisted data, or reuses legacy trade execution.
