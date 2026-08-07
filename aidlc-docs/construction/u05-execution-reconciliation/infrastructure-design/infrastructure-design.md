# U05 Execution and Reconciliation Infrastructure Design

## Topology

U05 runs inside the existing Node.js 24 application process on the approved local Windows workstation. It adds in-process execution/reconciliation components, U02 persistence adapters, and non-live broker adapters. It opens no inbound listener and adds no cloud, container, VM, worker, queue, cache, database service, sidecar, or package.

Live Zerodha and Sharekhan adapters are design targets but remain uncertified and unavailable to normal composition until their conformance evidence and all independent enablement gates exist.

## Deployment Environments

| Environment | Broker composition | Persistence | Network | Credentials |
|---|---|---|---|---|
| Local development | Paper or dry-run by default; scripted fake only in tests | Configured U02 development database | None for paper/dry-run; live disabled | None in U05 |
| Automated test | Scripted fake, paper, or dry-run | Fresh temporary U02 database and fake encryption attestation | Non-loopback prohibited; live SDK prohibited | Generated fake values only |
| Local production | Paper by default; future certified live capability only after explicit composition gates | U02 production portfolio database | Allowlisted outbound broker TLS only for certified live adapter | Supplied transiently by trusted composition, never persisted |

There is no staging cloud environment or multi-tenant shared service. Multiple portfolios are isolated logically inside the same U02 owner by canonical `PortfolioId` and exact broker-account binding.

## Compute and Process Mapping

- **Process**: Existing Node.js process.
- **Concurrency**: Bounded async orchestration over one event loop; one external call per order path and bounded in-flight work per dependency.
- **Domain work**: Pure synchronous functions.
- **Database work**: Short synchronous U02 `BEGIN IMMEDIATE` transactions.
- **External work**: Broker calls, waits, polling, and snapshot collection outside transactions.
- **Large local work**: Reconciliation comparison and recovery scans outside write transactions; persistence is chunked by approved atomic fact.
- **Threads/processes**: No worker thread, child process, daemon, or separate execution service.

The supported local capacity remains 250 orders per run, 1,000 holdings, 10,000 lots/fills, and 100 sequential portfolios. Benchmark evidence, not speculation, is required before changing this topology.

## Storage Mapping

### U02-Owned Portfolio Database

U05 durable facts use the database already owned by `PortfolioDatabaseOwner`. Code Generation will add migration 002 or the next available immutable migration number after inspecting the registry.

| Data | Storage rule |
|---|---|
| Approval decisions/bindings | Immutable identity/binding plus closed lifecycle state and optimistic version |
| Execution runs/orders | Exact TEXT quantities/money, canonical hashes, unique approval/run/order keys |
| Submission attempts/outcomes | Monotone attempt number, immutable certainty, optional broker reference |
| Reservations | Exact scoped cash/delivery values updated only in atomic transitions |
| Fills/accounting links | Unique fill identity and unique application fact |
| Reconciliation snapshots/differences | Immutable canonical hashes, endpoint times/cursor, linked resolution runs |
| Residual/adjustment facts | Immutable reason, lineage, authority, and idempotency |
| Kill switches | Global/portfolio scope, optimistic state, actor/evidence lineage |
| Events/dispatch | Existing U02 append-only event chain and separate delivery bookkeeping |

Required migration properties:

- immutable ID, name, checksum, forward SQL, assertions, and guarded reversal or irreversible rationale;
- foreign keys and portfolio/account scope on every child table;
- exact `Money`/`Quantity` as canonical TEXT;
- unique approval-to-run, idempotency, broker-reference, fill-identity/application, and kill-scope constraints;
- indexes for non-terminal scans, reconciliation freshness, broker references, and unapplied fills;
- no edit to migration 001;
- no direct connection, SQL, or `stock-watcher.db` access from U05 domain/application code.

### Backup and Rollback

U05 facts remain inside U02's verified consistent backup boundary. Before a local production migration:

1. stop new portfolio work;
2. verify no transaction is active;
3. create and verify an encrypted U02 backup;
4. apply the numbered migration and assertions;
5. run integrity, codec, repository, event-chain, and recovery checks;
6. restore the previous artifact and database-aware backup/reversal only through the approved rollback procedure.

U06/U09 own operational backup scheduling, retention, restore drills, and release execution.

## Network Mapping

| Adapter | Inbound | Outbound | Live capability |
|---|---|---|---|
| Paper | None | None | Structurally absent |
| Dry-run | None | None | Structurally absent |
| Scripted fake | None | Non-loopback prohibited | Structurally absent |
| Zerodha | None | Future allowlisted broker TLS through isolated SDK adapter | Disabled until certified |
| Sharekhan | None | Future allowlisted broker TLS through isolated SDK adapter | Disabled until certified |

Network rules:

- U05 opens no TCP, HTTP, WebSocket, or IPC listener.
- Future live transport requires TLS 1.2 or newer and normal certificate validation; no insecure override is permitted.
- Base endpoints and concrete adapter selection come only from trusted composition.
- A user command cannot provide a URL, SDK object, account ID, credential, or adapter name.
- Broker response bodies and errors are bounded, normalized, and redacted before leaving the adapter.
- No live failure changes mode to paper/dry-run.

Portfolio APIs remain a later U07 concern. Legacy `/trade-execution` and `/paper-trades` remain separate and are never invoked.

## Credential and Capability Boundary

- U05 domain, application, port, persistence, events, logs, tests, and benchmarks contain no credential field.
- Paper, dry-run, and fake constructors reject live credential/account capability.
- Future live credentials are resolved by trusted composition through the approved local secret mechanism and passed only into the concrete adapter instance.
- A read-only broker recovery capability is distinct from live placement authority. It may expose status, fills, open orders, holdings, and cash after read-contract certification, account binding, credential health, and dependency health pass; it cannot expose placement or cancellation commands.
- Legacy `.zerodha.properties` and `.sharekhan.properties` loaders are prohibited.
- Missing credentials, certification, account binding, or enablement keeps live capability unavailable; startup may still support paper mode.
- Live enablement requires separate environment, application, portfolio, strategy, account, certification, approval, reconciliation, session, risk, and composition gates.

## Messaging and Scheduling

No external broker, queue, pub/sub service, workflow engine, or U05-owned scheduler is introduced.

- Financial and lifecycle facts commit to U02 atomically.
- Post-commit events enter existing dispatch bookkeeping.
- U06 later owns leases and scheduling for status, fills, reconciliation, window boundaries, recovery, and alert delivery.
- Before U06 exists, explicit application calls and tests may drive these coordinators; no hidden interval starts at module import.

## Resilience and Health Mapping

| Concern | Infrastructure disposition |
|---|---|
| Placement retry | U05 four-way certainty only; retry only broker-proved `DEFINITELY_NOT_SENT` |
| Safe reads | Bounded deadline/retry/backoff through injected policy |
| Circuit breaker | Independent in-memory state per broker/quote dependency and account binding |
| Bulkhead | Named bounded in-flight limit per dependency |
| First check | Injected timer starts status/fill check within two seconds |
| Polling | Injected 2-to-15-second interval, bounded by execution/reconciliation deadlines |
| Durable ambiguity | Persisted as `UNKNOWN` in U02; never only in memory |
| Restart | Recovery scans persisted non-terminal facts while placement is disabled; a separately gated read-only recovery capability may then collect broker evidence |
| Degradation | Live fails explicitly; paper remains available only through a separate explicit command |

Health output distinguishes healthy, degraded, circuit-open, unavailable, and unknown. A health query never triggers placement, reconciliation adjustment, credential refresh, or mode change.

## Monitoring Mapping

U05 emits typed immutable evidence and metric payloads containing safe lineage, state, certainty, duration, count, circuit status, saturation, reconciliation classification, recovery lag, and containment code.

U05 does not add a logger, metrics SDK, trace SDK, file sink, socket sink, dashboard, or alert channel. U06 owns:

- structured log/metric routing;
- append-only operational retention;
- dashboards and alerts;
- scheduler and recovery health;
- incident severity, containment, recovery communication, and COE tracking.

Distributed tracing is N/A because U05 is one in-process unit; correlation/causation IDs provide cross-component lineage.

## Shared Infrastructure and Isolation

| Shared resource | Sharing rule |
|---|---|
| Node process | Shared with U01-U04/U06-U08; no mutable U05 singleton financial state |
| U02 database owner | One owner per path; portfolio/account scope enforced in every U05 repository operation |
| Circuit registry | Shared process component, but independent key per dependency/account binding |
| Clock/timer policy | Injected immutable capability; test suites receive isolated fakes |
| Broker adapter | Instance bound to one reviewed account binding; never selected from user input |
| Event chain | Shared U02 append-only ledger with portfolio scope and contiguous hash chain |
| Test database | Unique temporary path per test or isolated suite |

## Configuration Defaults

| Setting | Default or bound |
|---|---|
| Live execution | Disabled |
| Live adapter certification | False |
| Placement deadline | 8 seconds default, 15 seconds hard cap |
| Read/cancel deadline | 10 seconds default, 20 seconds hard cap |
| Reconciliation total deadline | 60 seconds default, 120 seconds hard cap |
| First status/fill check | At most 2 seconds after acknowledgement/cancel response/ambiguity |
| Poll interval | 5 seconds default, configurable 2 through 15 seconds |
| Placement attempts | At most 3, only for `DEFINITELY_NOT_SENT` |
| Snapshot endpoint skew | At most 10 seconds without coherent broker cursor |
| SQLite busy timeout | Existing U02 5 seconds |

## Explicitly Absent

- Cloud account, region, availability zone, VPC, subnet, firewall, load balancer, API gateway, DNS, or managed service.
- Container, Kubernetes, VM, serverless function, worker, child process, or daemon.
- Redis, cache, new database, ORM, message queue, workflow engine, or distributed transaction.
- Inbound listener, new route, or direct legacy trade-route integration.
- New credential store or plaintext property-file loader.
- U05-owned logging backend, dashboard, alerting service, backup scheduler, or incident system.
- Real broker access from tests, benchmarks, paper, dry-run, or fake composition.

## Extension Compliance

### Security Baseline

| Rule | Status | Disposition |
|---|---|---|
| SECURITY-01 | Compliant, shared | U02 encrypted storage boundary and TLS 1.2+ future live transport |
| SECURITY-02 | N/A | No network intermediary |
| SECURITY-03 | Compliant, shared | Typed redacted evidence; centralized sink owned by U06 |
| SECURITY-04 | N/A | No HTML |
| SECURITY-05 | Compliant at boundary | Bounded commands/results and parameterized persistence |
| SECURITY-06 | N/A | No IAM |
| SECURITY-07 | N/A | No cloud network; no inbound listener |
| SECURITY-08 | Compliant, shared | Composition capability and portfolio/account scope; U07 owns endpoint auth |
| SECURITY-09 | Compliant | Default-disabled live and generic failures |
| SECURITY-10 | Compliant, shared | Zero new dependency; lockfile retained; U09 scan/SBOM |
| SECURITY-11 | Compliant | Broker, authority, accounting, persistence, and operations separated |
| SECURITY-12 | Compliant, shared | No U05 credential storage; privileged evidence opaque |
| SECURITY-13 | Compliant | Canonical hashes, immutable facts, migration checksums, event chain |
| SECURITY-14 | Compliant, shared | U05 signals; U06 alerts/retention |
| SECURITY-15 | Compliant | Deadlines, rollback, bounded resources, and fail-closed outcomes |

### Resiliency Baseline

| Rule | Status | Disposition |
|---|---|---|
| RESILIENCY-01 | Compliant | Critical workload/dependencies mapped |
| RESILIENCY-02 | Compliant by inheritance | 99% windows, hours-level RTO, one-hour RPO |
| RESILIENCY-03 | Compliant by inheritance | Lightweight change process |
| RESILIENCY-04 | Compliant, shared | GitHub Actions/direct local/database-aware rollback owned by U09 |
| RESILIENCY-05 | Compliant, shared | U05 signal contracts; U06 sinks/dashboard |
| RESILIENCY-06 | Compliant, shared | Dependency health contracts; U06/U07 health surfaces |
| RESILIENCY-07 | Compliant, shared | Circuit, saturation, ambiguity, recovery signals |
| RESILIENCY-08 | N/A | Local workstation, no region topology |
| RESILIENCY-09 | N/A | No cloud auto-scaling; bounded capacity benchmarks |
| RESILIENCY-10 | Compliant | Deadlines, bulkheads, circuits, certainty-aware retry |
| RESILIENCY-11 | Compliant by inheritance | Encrypted backup/restore strategy |
| RESILIENCY-12 | Compliant, shared | U02 backup boundary; U06 schedule/retention |
| RESILIENCY-13 | Compliant, shared | Restart/reconciliation sequence; U06 runbooks |
| RESILIENCY-14 | Compliant | Deterministic fault/restart matrix executes in Code Generation/Build and Test |
| RESILIENCY-15 | Compliant by inheritance | Lightweight incident/COE process through U06 |

Property-Based Testing rules are N/A to infrastructure resources themselves; the enabled Full PBT verification architecture remains mandatory for U05 code and adapters. No blocking extension finding remains.
