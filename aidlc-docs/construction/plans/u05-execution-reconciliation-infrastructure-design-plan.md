# U05 Execution and Reconciliation Infrastructure Design Plan

## Applicability

Infrastructure Design executes for U05 because the unit adds a numbered SQLite migration surface, outbound broker adapter boundaries, process-lifecycle behavior, persistence recovery, dependency health, and operational signals. It does not add a new deployable process or cloud resource.

## Inherited and Autopilot Answers

### Question 1 - Deployment Environment

Where will U05 run?

A) Inside the approved existing Node.js process on the local Windows workstation

B) In a new cloud service or container

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 2 - Compute Infrastructure

What compute model should U05 use?

A) Existing single-process event loop with bounded sequential orchestration and short synchronous transactions

B) New worker threads, child processes, or execution service

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 3 - Storage Infrastructure

Where should durable U05 facts live?

A) In the existing U02-owned portfolio SQLite database through one new numbered migration and transaction-scoped adapters

B) In the legacy trading database or a new database

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 4 - Messaging Infrastructure

How should U05 schedule follow-up status, fill, and reconciliation work?

A) Persist typed facts/events through U02 and let U06 own later dispatch/scheduling; add no broker or queue

B) Add a durable external message broker now

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 5 - Networking Infrastructure

What network boundary should U05 own?

A) No inbound listener; only future certified live adapters may make allowlisted outbound TLS broker calls, while paper/dry-run/fake have no live network capability

B) Open a new inbound execution API or reuse legacy trade routes

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 6 - Monitoring Infrastructure

How should U05 integrate with observability?

A) Emit typed bounded evidence/health/metric payloads and let U06 own sinks, dashboards, alerts, retention, and incident routing

B) Add a separate logging or metrics service in U05

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

### Question 7 - Shared Infrastructure and Isolation

How should shared resources be handled?

A) Reuse the U02 owner, existing resilience primitives, Node runtime, and later U06 operations while isolating state by portfolio, broker account binding, dependency, and test database

B) Share mutable execution state globally across portfolios

X) Other (please describe after `[Answer]:` tag below)

[Answer]: A

## Infrastructure Decisions

| ID | Decision |
|---|---|
| AD-U05-I01 | U05 remains in the existing local Node.js process and opens no listener. |
| AD-U05-I02 | No cloud, container, VM, worker, queue, cache, sidecar, or new database is introduced. |
| AD-U05-I03 | Durable U05 state uses the U02-owned portfolio database through migration 002 or the next available immutable number. |
| AD-U05-I04 | The legacy `stock-watcher.db` and legacy trade routes remain isolated and untouched. |
| AD-U05-I05 | Paper, dry-run, and fake compositions contain no broker credential, live SDK, DNS, or socket capability. |
| AD-U05-I06 | Live Zerodha/Sharekhan composition remains absent or disabled until certification evidence exists and every live gate is explicitly enabled. |
| AD-U05-I07 | Broker transport uses the existing broker packages only inside isolated adapters and mandatory TLS through their supported stack. |
| AD-U05-I08 | Credentials are supplied only to future live adapter construction by the trusted composition boundary; U05 domain/application/persistence never stores or logs them. |
| AD-U05-I09 | Broker calls, waits, and snapshot collection occur outside U02 transactions. |
| AD-U05-I10 | Circuit, in-flight, deadline, and health state are in-memory and independent by dependency/account binding; durable ambiguity remains in U02 facts. |
| AD-U05-I11 | U06 owns scheduling, event dispatch, centralized observability, backup operations, runbooks, and incident/COE integration. |
| AD-U05-I12 | Tests use temporary portfolio databases, fake encryption attestations, fake clocks, and non-live adapters only. |
| AD-U05-I13 | Deployment keeps the approved direct local style with database-aware forward/reversal migration review and verified backup before change. |

## Plan Steps

- [x] Step 1: Load Infrastructure Design and content-validation rules.
- [x] Step 2: Read approved U05 Functional Design, NFR Requirements, and NFR Design.
- [x] Step 3: Read U02/U03 infrastructure conventions and inherited project decisions.
- [x] Step 4: Determine Infrastructure Design is applicable without adding a deployable resource.
- [x] Step 5: Answer all seven required infrastructure categories conservatively.
- [x] Step 6: Record infrastructure decisions AD-U05-I01 through AD-U05-I13.
- [x] Step 7: Map development, test, and local-production environments.
- [x] Step 8: Map compute, process, and transaction boundaries.
- [x] Step 9: Map U02 storage, migration, backup, and rollback boundaries.
- [x] Step 10: Map paper/dry-run/fake/live network and credential boundaries.
- [x] Step 11: Map messaging, resilience, health, monitoring, and shared-resource ownership.
- [x] Step 12: Define startup, execution, recovery, shutdown, and failure sequences.
- [x] Step 13: Enumerate explicitly absent resources and forbidden legacy paths.
- [x] Step 14: Write `infrastructure-design/infrastructure-design.md`.
- [x] Step 15: Write `infrastructure-design/deployment-architecture.md`.
- [x] Step 16: Validate Markdown, decision/step counts, ownership, and safety constraints.
- [x] Step 17: Complete Security, Resiliency, and Full PBT compliance review.
- [x] Step 18: Record Infrastructure Design completion and approval in state, audit, and the session roadmap.

## Artifact Targets

| Artifact | Path |
|---|---|
| Plan | `aidlc-docs/construction/plans/u05-execution-reconciliation-infrastructure-design-plan.md` |
| Infrastructure Design | `aidlc-docs/construction/u05-execution-reconciliation/infrastructure-design/infrastructure-design.md` |
| Deployment Architecture | `aidlc-docs/construction/u05-execution-reconciliation/infrastructure-design/deployment-architecture.md` |

## Completion Checks

- [x] All seven infrastructure question categories are answered.
- [x] All 36 logical components have a process/storage/network/operations disposition.
- [x] Persistence remains inside U02 and broker transport remains outside transactions.
- [x] Non-live compositions have no route to live network or credentials.
- [x] Security and Resiliency extension rules are classified with no blocking finding.
- [x] No infrastructure artifact authorizes a trade or changes deployed/persisted resources.
