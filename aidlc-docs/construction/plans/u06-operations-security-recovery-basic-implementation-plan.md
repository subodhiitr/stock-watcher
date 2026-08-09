# U06 Operations, Security, and Recovery - Basic Implementation Plan

## Scope

This is a deliberately small U06 application-contract slice requested by the user. It does not claim full U06 completion.

Included: bounded job definitions, durable-lease orchestration contracts, dependency gates, idempotent task identity, restart classification, health aggregation, audit-gated backup orchestration, restore preflight, incident evidence, explicit exports, and focused tests.

Deferred: persistence migration and repositories, exchange-calendar scheduler loop, timer process, concrete health probes, encrypted backup destination policy, destructive restore execution, alert delivery, performance/attribution reports, API/UI routes, deployment wiring, and integrated restore drills.

## Steps

- [x] Step 1: Confirm U06 ownership, dependencies, five primary stories, local topology, and the user's basic-scope constraint.
- [x] Step 2: Define small closed operations contracts and safe failure codes.
- [x] Step 3: Define lease, task, clock, health, audit, backup, and incident ports without concrete infrastructure.
- [x] Step 4: Implement dependency-gated, lease-protected job coordination with durable idempotency identity and restart classification.
- [x] Step 5: Implement fail-closed health aggregation with criticality-aware overall state.
- [x] Step 6: Implement health/audit-gated verified backup orchestration and non-destructive restore preflight.
- [x] Step 7: Implement append-only incident lifecycle orchestration with required correction-action evidence.
- [x] Step 8: Add explicit public exports and focused npm verification scripts.
- [x] Step 9: Add example and architecture tests, run U06 verification, rerun core/U05 compatibility, and document limitations.

## Safety Boundaries

- No background process or timer is started.
- No SQL, migration, database, backup file, restore, network call, alert, API, UI, credential, broker call, or trade is performed.
- Concrete adapters remain trusted-composition responsibilities for later work.
- Operations may block execution but cannot grant execution authority or mutate strategy policy.
