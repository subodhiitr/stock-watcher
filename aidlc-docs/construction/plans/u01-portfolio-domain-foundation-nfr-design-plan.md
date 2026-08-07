# U01 Portfolio Domain Foundation NFR Design Plan

## Unit Context

U01 is a Critical, dependency-free, in-process strict-TypeScript domain boundary. NFR Design must satisfy exactness, immutability, deterministic replay, bounded performance, safe failures and events, contract stability, and full property-testability without introducing persistence or infrastructure patterns.

## NFR Design Plan

- [x] Analyze the approved U01 NFR Requirements and technology decisions.
- [x] Evaluate resilience, scalability, performance, security, and logical-component patterns.
- [x] Record context-appropriate NFR design questions and recommended choices.
- [x] Validate every answer for completeness, ambiguity, and contradiction.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/nfr-design/nfr-design-patterns.md`.
- [x] Generate `aidlc-docs/construction/u01-portfolio-domain-foundation/nfr-design/logical-components.md`.
- [x] Validate pattern traceability to all 46 U01 NFR requirements and 72 business rules.
- [x] Validate enabled extension applicability and blocking findings.
- [x] Present completed U01 NFR Design for explicit approval.

## Category Assessment

| Category | Assessment |
|---|---|
| Resilience patterns | Applicable as deterministic typed failure and invariant containment; retry, circuit breaker, and fallback patterns are N/A because U01 has no external calls. |
| Scalability patterns | Applicable through explicit capacity guards, canonical bounded collections, and predictable complexity; horizontal scaling is N/A. |
| Performance patterns | Applicable through targeted validation, canonical indexing, copy-on-write transitions, and benchmark gates. |
| Security patterns | Applicable through constrained construction, allowlisted context, evidence binding, immutable state, and fail-closed parsing. |
| Logical components | Applicable to enforce dependency direction and separate exact values, aggregate behavior, events, codecs, integrity, ports, and test support. |
| RESILIENCY-14 decision | N/A to U01. U01 has no failover or recovery mechanism; the required project decision remains assigned to U06 NFR Design. |

## Question 1

Which resilience pattern should pure U01 operations use?

A) Use a typed-result boundary for expected failures, a dedicated invariant exception for corrupted trusted state, deterministic replay, and no internal retry, fallback, circuit breaker, timeout, or swallowed exception. **Recommended**

B) Catch all failures and return the last valid aggregate so dependent units can continue.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 2

How should bounded immutable collections scale without a runtime dependency?

A) Use canonical sorted frozen arrays at public boundaries, private identifier indexes built during construction, and localized copy-on-write replacement of only affected collections; never expose mutable indexes. **Recommended**

B) Deep-clone and recursively freeze the full aggregate on every command regardless of affected data.

C) Expose mutable Map and Set instances as readonly TypeScript types for faster updates.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 3

How should integrity validation meet both correctness and latency targets?

A) Use full validation for create, rehydrate, and explicit integrity checks; use targeted affected-entity plus aggregate invariant validation for normal transitions; prove targeted and full validation equivalent with property tests. **Recommended**

B) Run full 10,000-lot validation after every command regardless of the changed area.

C) Validate only incoming fields and trust all unchanged aggregate state without equivalence testing.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 4

Which security pattern should evidence, errors, and events use?

A) Use closed discriminated schemas, allowlisted bounded context builders, opaque evidence references with portfolio/mode/time/hash binding, and upstream cryptographic verification; U01 rejects unrecognized fields and never accepts raw metadata bags. **Recommended**

B) Accept flexible string-keyed metadata objects and redact them only in API or logging adapters.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Question 5

How should logical components be separated?

A) Use explicit acyclic components for exact values, identity/time, results/failures, allocation policy, positions, Portfolio aggregate, integrity validation, domain events/codecs, capability ports, and reusable test support, with one reviewed public entry point. **Recommended**

B) Place all U01 types and behavior in one portfolio-domain file to avoid internal imports.

X) Other (please describe after the [Answer]: tag below)

[Answer]: A

## Answer Validation Gate

Artifact generation begins only after all five answers are present, valid, and mutually consistent. Selecting A throughout yields deterministic failure containment, bounded immutable collections, two-tier integrity validation with equivalence proof, closed safe context schemas, and an acyclic logical component model.

## Answer Analysis

- **Completeness**: All five questions use valid answer A.
- **Ambiguity**: None. Every answer selects one complete implementation pattern.
- **Contradictions**: None. Localized copy-on-write, targeted validation, full rehydration checks, closed schemas, and acyclic components satisfy both correctness and latency requirements.
- **Design consequence**: U01 remains dependency-free and deterministic while supporting measurable capacity, runtime immutability, safe failures, and downstream contract stability.
