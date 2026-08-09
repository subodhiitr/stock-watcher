# Application Design Plan

## Status

Application Design answers are complete and validated. Design artifacts are generated and awaiting explicit approval.

## Design Context

- Brownfield local Node and Remix modular monolith.
- New strict-TypeScript portfolio domain with isolated `portfolio-management.db`.
- Existing intraday simulation and canonical trade APIs must remain behaviorally unchanged.
- Full roadmap requires point-in-time data, strategy versioning, rebalancing, paper and broker execution, operations, and UI.
- Security, resiliency, and full property-based-testing extensions are enabled.

## Planning Progress

- [x] Load approved requirements, stories, reverse engineering, and execution plan.
- [x] Identify application capabilities and current integration boundaries.
- [x] Identify design decisions that materially affect component structure.
- [x] Create context-specific application-design questions.
- [x] Validate all answers for completeness, consistency, and feasibility.
- [x] Record the approved architecture choices.

## Mandatory Artifact Checklist

- [x] Generate `aidlc-docs/inception/application-design/components.md`.
- [x] Generate `aidlc-docs/inception/application-design/component-methods.md`.
- [x] Generate `aidlc-docs/inception/application-design/services.md`.
- [x] Generate `aidlc-docs/inception/application-design/component-dependency.md`.
- [x] Generate consolidated `aidlc-docs/inception/application-design/application-design.md`.
- [x] Validate component ownership, interfaces, dependencies, and protected legacy boundaries.
- [x] Validate applicable security, resiliency, and property-testing constraints.
- [x] Present the completed design for explicit approval.

## Design Questions

### Question 1
How should the new backend components be organized?

A) A focused `server/portfolio/` modular-monolith boundary with domain, application, ports, adapters, and infrastructure submodules (Recommended)

B) A new independent workspace package within this repository

C) Extend existing root and `server/` modules without a dedicated portfolio boundary

X) Other (please describe after the [Answer]: tag)

[Answer]:A

## Selected Architecture

- Focused `server/portfolio/` modular-monolith boundary.
- Command/query application services with injected ports and explicit transactions.
- One database owner with repositories and unit-of-work interfaces.
- Transactional operations followed by typed post-commit events and leased jobs.
- Focused route modules wired through a composition root; legacy trade routes remain separate.
- Strict TypeScript across all new portfolio backend and React code.
- Version-neutral, portfolio-scoped REST resources.
- Dedicated `/portfolio` URL using separate React route, state, hook, and feature components; no legacy dashboard embedding.

The seven answers are complete, mutually consistent, and feasible in the existing Node and Remix deployment. The additional UI instruction is incorporated without changing the approved persistence or legacy compatibility boundaries.
### Question 2
How should portfolio use cases be orchestrated?

A) Explicit command/query application services using injected ports and transaction boundaries (Recommended)

B) Route handlers directly coordinate repositories and domain functions

C) An event-first architecture where all use cases begin as internal events

X) Other (please describe after the [Answer]: tag)

[Answer]:A

### Question 3
How should the separate portfolio database be accessed?

A) One database owner with repository and unit-of-work interfaces; domain and routes never issue SQL directly (Recommended)

B) Each component owns a direct `better-sqlite3` connection and SQL statements

C) A separate local database process exposes persistence over HTTP

X) Other (please describe after the [Answer]: tag)

[Answer]:A

### Question 4
How should cross-component work and background activity communicate?

A) Synchronous transactional commands and queries, followed by typed post-commit internal events consumed by leased jobs (Recommended)

B) Fully synchronous calls with no internal events

C) A durable external message broker and event-driven architecture

X) Other (please describe after the [Answer]: tag)

[Answer]:A

### Question 5
How should the new backend integrate with the existing runtime?

A) Focused portfolio route modules and a composition root wired by `ticker_proxy.js`; legacy trade routes remain separate and unchanged (Recommended)

B) Add portfolio behavior directly to the existing trade-execution route

C) Let the Remix application access portfolio persistence directly

X) Other (please describe after the [Answer]: tag)

[Answer]:A

### Question 6
Where should strict TypeScript apply?

A) Use strict TypeScript for all new portfolio domain, application, adapters, routes, and Remix UI code, with a minimal JavaScript composition shim only where existing runtime wiring requires it (Recommended)

B) Keep the backend in JavaScript and use TypeScript only in Remix

C) Run the TypeScript portfolio backend as a separate process

X) Other (please describe after the [Answer]: tag)

[Answer]:A

### Question 7
What API resource style should the design use?

A) Version-neutral REST resources scoped by explicit portfolio identifiers, with stable schemas, errors, correlation IDs, and idempotency tokens (Recommended)

B) One action-oriented portfolio endpoint with an operation field

C) GraphQL for all portfolio reads and mutations

X) Other (please describe after the [Answer]: tag)

[Answer]:A

## Planned Component Areas

The approved choices will be applied to:

1. Shared domain types and policy contracts.
2. Portfolio lifecycle and accounting.
3. Strategy registry and activation.
4. Point-in-time data, eligibility, signals, and regime.
5. Construction, cost, tax, and rebalance planning.
6. Paper and broker execution, approval, and reconciliation.
7. Risk, kill switches, scheduler, health, backup, and audit.
8. Portfolio API route adapters and runtime composition.
9. Remix portfolio, strategy, approval, performance, and operations views.

## Extension Design Constraints

- Security-critical authorization, execution enablement, secrets, audit, and input validation remain isolated behind explicit interfaces.
- External dependencies use deadlines and fail-closed adapters; non-critical research may degrade without authorizing execution.
- Persistence, broker, scheduler, and recovery components expose health and operational contracts.
- Functional Design will identify properties for exact money, serialization, weights, idempotency, state machines, and portfolio isolation.

## Answer Process

1. Complete each `[Answer]:` tag with one listed letter.
2. Answers will be checked for ambiguity, contradictions, and feasibility.
3. If answers are complete, the mandatory design artifacts will be generated.
4. Generated artifacts will receive a separate explicit approval gate before Units Generation.
