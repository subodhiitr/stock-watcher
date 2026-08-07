# U01 Portfolio Domain Foundation Functional Design Plan

## Unit Context

- **Unit**: U01 Portfolio Domain Foundation
- **Primary stories**: US-002, US-004, US-005, US-009
- **Responsibility**: Define stable financial types, portfolio aggregate behavior, lifecycle, strategy assignment, sleeves, domain errors, reason codes, events, and port contracts.
- **Boundary**: Pure strict TypeScript with no SQL, HTTP, broker SDK, filesystem, timer, React, or legacy intraday-policy dependency.
- **Frontend applicability**: N/A. U01 exposes domain contracts and contains no UI.

## Functional Design Plan

- [x] Analyze the approved U01 definition, primary stories, requirements, and application design.
- [x] Evaluate business logic, domain model, business rules, data flow, integration points, error handling, edge scenarios, and frontend applicability.
- [x] Record context-appropriate functional-design questions and recommended choices.
- [x] Validate every answer for completeness, ambiguity, and contradiction.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/functional-design/business-logic-model.md`.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/functional-design/business-rules.md`.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/functional-design/domain-entities.md`.
- [x] Mark `frontend-components.md` N/A because U01 has no frontend scope.
- [x] Identify testable properties by component and category as required by PBT-01.
- [x] Validate story coverage, domain invariants, downstream contract sufficiency, and extension compliance.
- [x] Present the completed functional design for explicit approval.

## Category Assessment

| Category | Assessment |
|---|---|
| Business logic modeling | Applicable. Portfolio creation, lifecycle, assignment, sleeves, and mutation semantics require explicit behavior. |
| Domain model | Applicable. Aggregate ownership and exact value types are foundational contracts for every later unit. |
| Business rules | Applicable. Cash, quantity, weights, archive behavior, assignment history, and isolation require fail-closed rules. |
| Data flow | Applicable. Pure commands must produce deterministic state and event outputs without persistence concerns. |
| Integration points | Applicable. U01 declares ports and events consumed by persistence and application units. |
| Error handling | Applicable. Expected domain failures need stable typed representation and structured context. |
| Business scenarios | Applicable. Repeated archive, strategy changes, multi-sleeve allocation, and conflicting commands need defined outcomes. |
| Frontend components | N/A. The dedicated React workspace belongs to U08. |

## Question 1

How should exact financial values be represented in U01?

A) Use immutable branded values: INR money as `bigint` minor units, whole-share quantities as non-negative `bigint`, and weights/rates as bounded scaled integers with explicit scale. **Recommended**

B) Use JavaScript `number` values with rounding helpers at domain boundaries.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 2

How should portfolio aggregate mutations expose state changes?

A) Use behavior-rich aggregate methods that validate commands and return a new immutable aggregate state plus typed domain events; callers cannot mutate collections directly. **Recommended**

B) Use a mutable aggregate whose methods update internal state and expose accumulated events.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 3

How should single-strategy and multi-sleeve assignments be modeled?

A) Use one discriminated allocation policy: either one active strategy assignment at 100% or multiple immutable sleeve assignments whose distinct weights total exactly 100%; changing policy creates a new effective assignment while history remains referenced by ID. **Recommended**

B) Store one optional strategy plus an unrelated optional sleeve collection and resolve conflicts in application services.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 4

How should lifecycle and operating-mode transitions be governed?

A) Use explicit state machines. ACTIVE may become ARCHIVED idempotently; ARCHIVED cannot return to ACTIVE. Mode changes require a typed transition request and evidence token, while execution-capable transitions remain blocked unless later authorization and risk units supply valid evidence. **Recommended**

B) Treat status and mode as freely replaceable metadata and rely entirely on API validation.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 5

How should expected domain validation failures be represented?

A) Return a typed `DomainResult<T>` with stable error code, safe structured context, and no stack details; reserve thrown exceptions for programmer defects or impossible invariant corruption. **Recommended**

B) Throw typed exceptions for every expected validation or transition failure.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 6

How should U01 interact with identifiers, time, persistence, and external systems?

A) Accept already validated identifiers and effective timestamps in commands, declare narrow capability ports, and emit typed events; generation, clocks, storage, and external calls remain outside the pure domain. **Recommended**

B) Let aggregates generate identifiers, read the system clock, and call repositories or adapters directly.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Answer Validation Gate

Artifact generation begins only after all six answers are present, valid, and mutually consistent. Selecting answer A throughout yields immutable exact-value objects, pure event-producing aggregate transitions, a discriminated strategy-allocation model, explicit lifecycle state machines, typed expected failures, and dependency inversion at every integration boundary.

## Answer Analysis

- **Completeness**: All six questions use valid answer A.
- **Ambiguity**: None. Every answer selects one complete option without qualification.
- **Contradictions**: None. Exact immutable values, pure event-producing aggregates, explicit state machines, typed failures, and externalized capabilities are mutually reinforcing.
- **Design consequence**: U01 can remain deterministic and technology-agnostic while providing strict contracts to every dependent unit.
