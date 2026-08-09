# U01 Portfolio Domain Foundation NFR Requirements Plan

## Unit Context

U01 is a Critical pure-domain TypeScript unit. It owns exact values, the Portfolio aggregate, deterministic state transitions, typed failures and events, and port contracts. It performs no persistence, network, filesystem, broker, UI, authentication, or background processing.

## NFR Requirements Plan

- [x] Analyze the approved U01 Functional Design and project-level NFRs.
- [x] Evaluate scalability, performance, availability, security, technology, reliability, maintainability, testing, and usability applicability.
- [x] Record context-appropriate NFR and technology questions with recommended choices.
- [x] Validate every answer for completeness, ambiguity, and contradiction.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/nfr-requirements/nfr-requirements.md`.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/nfr-requirements/tech-stack-decisions.md`.
- [x] Validate all enabled security and resiliency rules for U01 applicability.
- [x] Validate PBT-09 framework selection and downstream PBT obligations.
- [x] Validate measurable thresholds, traceability, and downstream design inputs.
- [x] Present completed U01 NFR Requirements for explicit approval.

## Category Assessment

| Category | Assessment |
|---|---|
| Scalability | Applicable as bounded aggregate size and deterministic algorithm growth; U01 is not independently scaled. |
| Performance | Applicable to pure transition and integrity-validation budgets at supported portfolio sizes. |
| Availability | No independent SLA; U01 inherits application availability and must be deterministic and side-effect free. |
| Security | Applicable to safe values, evidence binding, data integrity, fail-closed behavior, and secret-free errors/events. |
| Tech stack | Applicable because strict backend TypeScript runtime and test execution must fit the existing Node application. |
| Reliability | Applicable to total expected-failure handling, invariant enforcement, and deterministic replay. |
| Maintainability | Applicable to public contract stability, documentation, module boundaries, and rule traceability. |
| Usability | N/A. U01 has no user interface; safe error codes support later accessible UI explanations. |

## Question 1

What capacity and performance target should U01 use?

A) Support aggregates up to 1,000 holdings, 10,000 open lots, and 100 strategy sleeves; target p95 below 25 ms for a normal state transition and below 100 ms for full integrity validation on the supported local Node runtime. **Recommended**

B) Define correctness only and defer all aggregate size and latency thresholds until integrated capacity testing.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 2

What availability and reliability model should apply to this pure domain unit?

A) Give U01 no independent SLA or retry logic; require deterministic side-effect-free operations, total typed handling for expected failures, fail-closed invariant corruption, and exact replay from the same inputs. **Recommended**

B) Add internal retries and fallback defaults so domain transitions usually return a usable result.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 3

What security and data-handling constraints should U01 enforce?

A) Permit only portfolio-domain identifiers and financial state; prohibit credentials and sensitive free text; allowlist error/event context; bind evidence to portfolio, mode, time, and hash; and reject unknown or malformed state. **Recommended**

B) Allow arbitrary metadata in domain errors and events so downstream units can decide what to redact.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 4

Which backend TypeScript runtime approach should U01 use?

A) Use Node 24 native erasable TypeScript at runtime with strict `tsc --noEmit` checks, NodeNext ESM within `server/portfolio/`, `erasableSyntaxOnly`, explicit `.ts` imports, and no U01 production runtime dependency. **Recommended**

B) Compile U01 to emitted JavaScript in a separate build directory before every runtime and test invocation.

C) Implement U01 in JavaScript with JSDoc types to avoid backend TypeScript runtime changes.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 5

What testing stack and quality gate should apply?

A) Use Node's test runner for explicit examples and `fast-check` for full property testing; require every one of the 72 business rules to map to test evidence, reusable constrained generators, shrinking, reproducible seeds, state-model tests, and regression examples for discovered counterexamples. **Recommended**

B) Use example-based Node tests only for U01 and defer property testing to U09.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 6

How should maintainability and compatibility be governed?

A) Use small dependency-free modules, explicit exports, documented public contracts, stable versioned event and error codes, no circular imports, API Extractor-style manual contract review through TypeScript declarations, and deprecation before breaking downstream changes. **Recommended**

B) Optimize for fewer files and permit internal contracts to change without compatibility review until all nine units are complete.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Answer Validation Gate

Artifact generation begins only after all six answers are present, valid, and mutually consistent. Selecting A throughout gives U01 bounded measurable performance, deterministic reliability, strict safe data handling, dependency-free Node 24 TypeScript, mandatory `fast-check`, and stable downstream contracts.

## Answer Analysis

- **Completeness**: All six questions use valid answer A.
- **Ambiguity**: None. Every answer selects one measurable, complete option.
- **Contradictions**: None. Native strict TypeScript, dependency-free runtime logic, bounded performance, deterministic reliability, and full property testing are compatible.
- **NFR consequence**: U01 receives explicit capacity and latency targets, no independent availability or retry behavior, allowlisted data surfaces, Node 24 erasable TypeScript, `node:test` plus `fast-check`, and declaration-based contract review.
