# Portfolio Management Unit of Work Plan

## Purpose

Decompose the approved portfolio-management modular monolith into dependency-ordered development units that can each complete Functional Design, NFR Requirements, NFR Design, selective Infrastructure Design, Code Generation, and verification before the next unit begins.

## Evidence and Constraints

- The repository is brownfield and remains one locally deployed Node and Remix application.
- The approved architecture is one strict-TypeScript `server/portfolio/` modular monolith with a dedicated React `/portfolio` workspace.
- Portfolio storage is isolated in `portfolio-management.db`; existing trading storage and intraday behavior are protected.
- Units are logical development boundaries, not independently deployed services.
- Domain contracts and persistence precede strategies, planning, execution, operations, APIs, UI, and integrated verification.
- Security, resiliency, and full property-based-testing extensions remain enabled.

## Decomposition Plan

- [x] Review approved requirements, stories, workflow planning, and application design.
- [x] Confirm the brownfield deployment and protected legacy boundaries.
- [x] Evaluate story grouping, dependencies, team alignment, technical considerations, business domains, and code organization.
- [x] Record context-appropriate decomposition questions and recommended choices.
- [x] Validate every answer for completeness, ambiguity, and contradiction.
- [x] Obtain explicit approval of this unit plan.
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work.md` with unit definitions and responsibilities.
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work-dependency.md` with the dependency matrix and implementation sequence.
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work-story-map.md` mapping every story to a primary unit and relevant integration units.
- [x] Validate unit boundaries and dependencies against the approved modular-monolith design.
- [x] Verify that all 39 stories are assigned exactly one primary owning unit.
- [x] Verify extension-rule applicability and record compliance or justified N/A status.
- [x] Present generated units for explicit approval before Construction.

## Category Assessment

| Category | Assessment |
|---|---|
| Story grouping | Applicable. The 39 stories cross portfolio foundations, strategy and data, planning, execution, operations, API, and React workflows. |
| Dependencies | Applicable. Financial contracts, exact accounting, persistence, idempotency, audit, and execution state machines impose a strict critical path. |
| Team alignment | Applicable. No multi-team organization is specified, so the decomposition must establish maintainable ownership boundaries without assuming dedicated teams. |
| Technical considerations | Applicable. All modules share one runtime, but persistence, external adapters, scheduling, API, and UI have different testing and operational needs. |
| Business domain | Applicable. Units should align with approved portfolio capabilities and preserve aggregate and transaction boundaries. |
| Code organization | Not separately questioned. This is a brownfield, single-deployment modular monolith; the approved Application Design already fixes the backend and React boundaries. |

## Question 1

How should stories be grouped into development units?

A) Use dependency-ordered business-capability modules within the single modular monolith: domain contracts; persistence; strategies and data; construction and rebalancing; execution and reconciliation; operations and recovery; API integration; React UI; integrated verification. **Recommended**

B) Use one large portfolio-management unit containing all backend, UI, and verification work.

C) Group primarily by delivery phase, even when a phase spans several domain and technical boundaries.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 2

How should dependencies and communication between units be constrained?

A) Use contracts-first, in-process typed interfaces and injected ports; only the composition root may bind concrete adapters, and no distributed service communication is introduced. **Recommended**

B) Permit direct imports between any portfolio modules when this shortens implementation.

C) Split selected units into independently communicating local services.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 3

What ownership model should guide unit size and handoffs?

A) Optimize for one maintainer or a small team: cohesive units, explicit contracts, reviewable checkpoints, and no assumption of permanently dedicated teams. **Recommended**

B) Optimize for several dedicated domain teams with broader independently owned units.

C) Optimize for maximum parallel development even if contracts and ownership overlap.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 4

What deployment and scaling assumptions should unit generation preserve?

A) Keep one local Node and Remix deployment with one isolated portfolio database; units are development boundaries and are not independently deployed or scaled. **Recommended**

B) Prepare every unit as a future independently deployable service now.

C) Introduce separate backend and scheduler processes while keeping the React application separate.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 5

How should business capability boundaries control the decomposition?

A) Follow the approved aggregate and safety boundaries: portfolio accounting; immutable strategy and decision lineage; deterministic planning; execution and reconciliation; operations; protocol adapters; and UI composition. **Recommended**

B) Group by technical layer only, with one domain unit, one infrastructure unit, and one presentation unit.

C) Group by user persona, producing separate investor, strategy editor, approver, and operator units.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Answer Validation Gate

Generation may begin only after all five answers are present, valid, mutually consistent, and explicitly approved. If recommended answer A is selected throughout, the generated artifacts will use nine logical units in the dependency order stated in Question 1.

## Answer Analysis

- **Completeness**: All five questions use valid answer A.
- **Ambiguity**: None. Each answer selects one complete option without qualification.
- **Contradictions**: None. The answers consistently preserve one local modular monolith, in-process contracts, business-capability boundaries, and a small-team ownership model.
- **Generation decision**: Produce nine dependency-ordered logical units after explicit plan approval.
