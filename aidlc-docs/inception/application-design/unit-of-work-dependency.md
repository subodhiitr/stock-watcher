# Portfolio Management Unit Dependencies

## Dependency Policy

1. Units are implemented in numeric order unless every direct dependency is complete and its public contracts are stable.
2. A dependency grants access only through documented types, application contracts, or ports; it does not permit imports of another unit's infrastructure internals.
3. The portfolio composition root in U07 is the only place that binds concrete repositories, providers, brokers, clocks, schedulers, security adapters, and route modules.
4. U09 may depend on every unit for integrated verification but must not become a runtime dependency.
5. No unit depends on legacy intraday policy. Explicit additive runtime, broker, calendar, or market-data reuse occurs only through adapters.

## Direct Dependency Matrix

`D` means a direct build dependency. `V` means verification-only dependency. A dash means no dependency.

| Consumer | U01 | U02 | U03 | U04 | U05 | U06 | U07 | U08 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| U01 Domain Foundation | - | - | - | - | - | - | - | - |
| U02 Persistence | D | - | - | - | - | - | - | - |
| U03 Strategy, Data, Research | D | D | - | - | - | - | - | - |
| U04 Construction, Rebalancing | D | D | D | - | - | - | - | - |
| U05 Execution, Reconciliation | D | D | - | D | - | - | - | - |
| U06 Operations, Security, Recovery | D | D | D | D | D | - | - | - |
| U07 API, Runtime Integration | D | D | D | D | D | D | - | - |
| U08 React Workspace | - | - | - | - | - | - | D | - |
| U09 Integrated Quality, Delivery | V | V | V | V | V | V | V | V |

## Dependency List

| Unit | Direct prerequisites | Contracts consumed | Contracts produced |
|---|---|---|---|
| U01 | None | Approved requirements and application design | Domain types, aggregate contracts, errors, reasons, events, ports, safety invariants |
| U02 | U01 | Exact values, aggregates, repository ports, audit-event envelope | Database owner, migrations, repository implementations, unit of work, seeded state |
| U03 | U01, U02 | Strategy and data types, repository ports, transaction boundary | Strategy application, evaluation snapshots, provider adapters, evidence and research views |
| U04 | U01, U02, U03 | Portfolio snapshots, strategy policy, evaluation lineage, holdings and lots | Target allocations, costs, taxes, rebalance plans, approval-ready plan views |
| U05 | U01, U02, U04 | Plan hashes, orders, risk and approval contracts, transaction boundary | Execution and reconciliation applications, broker adapters, kill-switch state |
| U06 | U01 through U05 | Domain events, repositories, provider and broker health, job use cases | Scheduler, audit/reporting, operations health, alert, backup, restore, and incident views |
| U07 | U01 through U06 | All application contracts and concrete adapter factories | Authenticated HTTP resources, composition root, lifecycle, proxy registrations |
| U08 | U07 | Stable API schemas, errors, correlation IDs, permissions, operations views | Dedicated React routes, state, hooks, feature components, accessible interaction tests |
| U09 | U01 through U08 | All public contracts and deployed composition | Integrated evidence, CI gates, capacity results, restore results, release decision |

## Implementation Sequence

### Step 1: Contracts and Pure State

Complete U01 first. Every later unit depends on exact value types, identifiers, errors, reasons, port shapes, and state-machine primitives. Breaking changes after U02 begins require explicit migration and dependent-contract review.

### Step 2: Transactional Storage

Complete U02 against U01 before implementing stateful application services. This establishes isolated persistence, transactions, audit atomicity, test databases, and idempotent initialization.

### Step 3: Immutable Decisions

Complete U03 after U02 so strategy versions, data lineage, evaluation snapshots, and research evidence have stable persistence and reproducible identifiers.

### Step 4: Deterministic Plans

Complete U04 after U03. Construction and rebalancing consume immutable decisions and persisted portfolio state but remain independent of broker submission.

### Step 5: Financial Execution

Complete U05 after U04. Approval and execution are defined against stable plan hashes and order contracts. Paper and fake adapters precede disabled live adapters.

### Step 6: Operational Control

Complete U06 around stable jobs and services from U03 through U05. Audit, health, backup, recovery, and incident behavior must observe actual persistence and execution boundaries rather than placeholders.

### Step 7: Protocol and Runtime Composition

Complete U07 after all backend application services exist. HTTP schemas and runtime wiring expose approved use cases without adding domain logic to routes or `ticker_proxy.js`.

### Step 8: Dedicated React Experience

Complete U08 against stable U07 schemas. Typed fakes may be prepared earlier, but final state, errors, permissions, and safety interactions are verified against the composed API.

### Step 9: Integrated Gate

Complete U09 last. It exercises every critical path, compatibility boundary, extension control, capacity target, recovery target, and no-real-order guarantee.

## Critical Path

U01 -> U02 -> U03 -> U04 -> U05 -> U06 -> U07 -> U08 -> U09

The sequence is intentionally conservative because the workflow completes each unit's design, code, and focused tests before moving to the next. Within a unit, independent adapters or test generators may be developed in parallel after their contracts are approved.

## Allowed Parallel Work Within Units

| Stable prerequisite | Parallel work allowed |
|---|---|
| U01 contracts approved | U02 migration design and reusable domain generators |
| U02 repository contracts approved | U03 provider fakes and strategy schema fixtures |
| U03 evaluation contracts approved | U04 allocator oracle and cost/tax fixtures |
| U04 plan contract approved | U05 paper broker, fake broker, and broker contract tests |
| U05 execution contract approved | U06 health adapters, backup adapters, and scheduler test clocks |
| U07 API schemas approved | U08 components, hooks, route tests, and accessibility fixtures |
| U01 through U08 complete | U09 integrated suites may run concurrently by test category |

Parallel work must not merge against provisional interfaces or bypass the approval gates for the owning unit.

## Transaction and Failure Boundaries

| Boundary | Owning units | Required behavior |
|---|---|---|
| Portfolio mutation | U01, U02 | Domain state and audit event commit atomically with optimistic version checks |
| Evaluation snapshot | U03, U02 | Strategy, input versions, outputs, reasons, and lineage persist immutably |
| Rebalance plan | U04, U02 | Equivalent inputs create an equivalent plan without duplicate logical orders |
| Approval | U04, U05, U02 | Approval binds to exact plan, strategy, portfolio version, actor, and price window |
| Broker submission | U05, U02 | Intent commits before external call; external call has deadline; result is persisted and reconciled |
| Background job | U06, U02 | Lease commits before work; retries are eligibility-controlled and idempotent |
| HTTP request | U07 | Validation, authentication, and object authorization precede application access |
| React query | U08, U07 | Selected portfolio and cancellation token prevent stale cross-portfolio replacement |
| Integrated test | U09 | Temporary data and fake boundaries prevent persistent mutation or real orders |

## Infrastructure Design Applicability

| Unit | Infrastructure Design | Rationale |
|---|---|---|
| U01 | N/A | Pure TypeScript domain and port contracts; no deployed resource or external integration |
| U02 | Execute | Local SQLite ownership, migration, encryption, backup consistency, and test databases |
| U03 | Execute selectively | External data adapters, deadlines, provider health, and research data storage |
| U04 | N/A | Pure construction and planning logic; optimizer process isolation is addressed in NFR Design unless a separate worker is selected |
| U05 | Execute | Broker connectivity, credentials, deadlines, circuit behavior, and disabled live gates |
| U06 | Execute | Scheduler, health, logs, alerts, backups, restore, and local deployment recovery |
| U07 | Execute selectively | Runtime composition, HTTP security, proxy routing, lifecycle, and graceful shutdown |
| U08 | N/A | React application code within the existing Remix deployment |
| U09 | Execute selectively | GitHub Actions, security scanning, SBOM, capacity harness, and recovery verification |

## Protected Legacy Dependencies

- U07 may add focused route registration and Remix forwarding without changing `/trade-execution` or `/paper-trades`.
- U03 and U05 may wrap approved shared market-data, calendar, or broker capabilities behind new portfolio ports.
- No portfolio unit may import legacy entry timing, VWAP, first-hour, runner, time-stop, or other intraday policy.
- U09 owns regression evidence that dashboard, mobile, replay, simulation, and canonical trade behavior remain compatible.

## Extension Dependency Allocation

### Security

- SECURITY-01 is shared by U02 and U06.
- SECURITY-03, SECURITY-13, and SECURITY-14 are owned by U06 and verified by U09.
- SECURITY-04, SECURITY-05, SECURITY-08, SECURITY-09, SECURITY-11, SECURITY-12, and SECURITY-15 are enforced through U07, with U05 owning financially critical fail-safe behavior.
- SECURITY-10 is owned by U09.
- SECURITY-02, SECURITY-06, and SECURITY-07 are N/A for the approved local topology.

### Resiliency

- RESILIENCY-01 through RESILIENCY-07 are coordinated by U06 using criticality and health signals from all backend units.
- RESILIENCY-10 applies to U03, U05, U06, and U07 external or persistence boundaries.
- RESILIENCY-11 through RESILIENCY-13 and RESILIENCY-15 are owned by U06.
- RESILIENCY-14 is decided during U06 NFR Design and verified by U09.
- RESILIENCY-08 and RESILIENCY-09 are N/A for the approved local workstation topology; U09 still verifies local capacity.

### Property-Based Testing

- PBT-01 is evaluated during Functional Design for every unit.
- PBT-02 through PBT-07 apply to domain serialization, invariants, idempotency, allocators, and state machines in U01 through U07.
- PBT-08 through PBT-10 are coordinated by U09 while remaining mandatory in each applicable code-generation plan.

