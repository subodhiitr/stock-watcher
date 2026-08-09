# U01 Portfolio Domain Foundation Code Summary

## Outcome

U01 delivers a dependency-free strict-TypeScript Portfolio domain foundation for US-002, US-004, US-005, and US-009. It supports independently identified portfolios, irreversible archival, evidence-bound operating modes, future-effective strategy replacement, exact multi-sleeve allocation, immutable holdings and lots, versioned events, and capability-only downstream ports.

## Application and Configuration Changes

### Modified

- `.gitignore`
  - Tracks the root lockfile and ignores declaration-contract output.
- `package.json`
  - Preserves the existing `headroom-ai` change.
  - Adds the Node 24 engine, TypeScript, Node types, `fast-check`, and focused U01 scripts.
- `package-lock.json`
  - Locks the complete root dependency graph.

### Created

- `server/portfolio/package.json`
- `server/portfolio/tsconfig.json`
- `server/portfolio/tsconfig.contracts.json`
- `server/portfolio/index.ts`
- `server/portfolio/domain/shared/`
- `server/portfolio/domain/errors/`
- `server/portfolio/domain/events/`
- `server/portfolio/domain/portfolio/`
- `server/portfolio/ports/index.ts`
- `tests/portfolio/package.json`
- `tests/portfolio/support/`
- `tests/portfolio/exact-values.test.ts`
- `tests/portfolio/portfolio.test.ts`
- `tests/portfolio/events.test.ts`
- `tests/portfolio/exact-values.property.test.ts`
- `tests/portfolio/portfolio.property.test.ts`
- `tests/portfolio/portfolio.model.test.ts`
- `tests/portfolio/architecture.test.ts`
- `benchmark/package.json`
- `benchmark/portfolio-domain.ts`

## Story Coverage

| Story | Implementation evidence |
|---|---|
| US-002 Create Independent Portfolios | Immutable PortfolioId ownership, exact non-negative INR cash, empty initial holdings, ACTIVE version-one state, atomic failure results, isolation properties |
| US-004 Archive a Portfolio Safely | ACTIVE-to-ARCHIVED transition, irreversible lifecycle, retained cash/allocation/holdings, repeat no-op, no external capability |
| US-005 Assign and Change Strategy Versions | Immutable version references, eligibility evidence, future-effective full replacement, stale-version guard, prior/new event identities |
| US-009 Allocate Multiple Strategy Sleeves | Two through 100 canonical sleeves, unique identifiers and strategies, positive exact weights totaling 1,000,000, no leverage or short-state bypass |

## Domain Contracts

- INR Money uses exact `bigint` minor units.
- Quantity uses non-negative whole-share `bigint`.
- Weight uses exact integer parts per million.
- ScaledRate rejects non-exact conversion.
- PortfolioStateVersion is a safe integer with overflow rejection.
- Expected failures return a closed `DomainResult`.
- Trusted-state corruption throws `DomainInvariantError`.
- Portfolio transitions are immutable, deterministic, and emit zero events for no-ops or one event for accepted mutations.
- `PortfolioCreated`, `PortfolioArchived`, `PortfolioModeChanged`, and `StrategyAllocationChanged` are immutable schema-version-one facts with canonical codecs.
- PortfolioRepository, PortfolioTransaction, and PortfolioUnitOfWork are synchronous declarations so a SQLite transaction cannot cross an async boundary. Events are staged through the transaction capability and returned only after commit; ClockPort, IdentifierFactory, StrategyEvidencePort, and InternalEventBus remain capability declarations.

## Business-Rule Evidence

- `tests/portfolio/support/rule-evidence.ts` maps all 72 `BR-U01-*` rules to executable examples, properties, model checks, event checks, or architecture checks.
- `tests/portfolio/architecture.test.ts` verifies the map is exact and complete.
- Expected failure paths preserve the original aggregate and emit no event.
- Successful targeted transitions are checked against the full integrity validator.

## Property-Based Testing

- Framework: `fast-check` 4.8.0.
- Ordinary properties: at least 1,000 generated cases each.
- Stateful model: 250 command sequences with generated length from zero through 100.
- Covered categories:
  - exact codec round trips;
  - initial and transition invariants;
  - archive idempotence and irreversibility;
  - foreign-scope failure atomicity;
  - version and event consistency;
  - sleeve commutativity and canonicalization;
  - targeted/full validation equivalence.
- Shrinking and replay seed/path output remain enabled.
- No failing counterexample was discovered, so no additional permanent regression example was required.

## Capacity and Performance Evidence

Environment: Node v24.18.0, Windows x64. Benchmark seed: 20270102.

| Gate | Measured p95 or delta | Requirement | Result |
|---|---:|---:|---|
| Normal state-changing transition | 0.0467 ms p95 | Less than 25 ms | Pass |
| Full 1,000-holding/10,000-lot integrity validation | 29.9840 ms p95 | Less than 100 ms | Pass |
| 100-sleeve validation | 0.9402 ms p95 | Less than 10 ms | Pass |
| Boundary transition heap delta | 8,984 bytes | Less than 64 MiB | Pass |

The benchmark reports p50, p95, maximum, heap delta, capacity, environment, seed, and representative-to-boundary validation growth.

## Extension Compliance

### Security Baseline

- SECURITY-10: Compliant for U01. The root lockfile is tracked, versions are exact for new development dependencies, and U01 has zero runtime dependencies.
- SECURITY-11: Compliant. Evidence and failure logic are isolated and fail closed.
- SECURITY-13: Compliant. Exact values, immutable state, optimistic versions, schema-versioned events, and declaration inspection protect integrity.
- SECURITY-15: Compliant. Expected failures are atomic; unknown event values fail closed; corrupt trusted state halts.
- SECURITY-01 through SECURITY-09, SECURITY-12, and SECURITY-14: N/A because U01 has no store, transport, endpoint, authentication, deployed configuration, IAM, logging sink, or monitoring resource.
- Repository-wide npm audit still reports pre-existing findings in existing root runtime dependencies. U01 adds no runtime dependency and does not change those unrelated packages.

### Resiliency Baseline

- RESILIENCY-01: Compliant. Criticality and all U02-through-U09 dependencies remain explicit.
- RESILIENCY-02 through RESILIENCY-13 and RESILIENCY-15: N/A because U01 is pure in-process logic with no deployed or persistent workload.
- RESILIENCY-14: N/A to U01 and remains assigned to U06 NFR Design.

### Property-Based Testing Extension

- PBT-01 through PBT-10: Compliant for U01.
- Domain-specific generators, exact oracles, state models, shrinking, replay metadata, and complementary explicit examples are implemented and executed.

## Explicitly Not Applicable to U01

- HTTP or REST routes
- Repository adapters or SQL
- Database migrations
- Broker integrations
- Event publication
- React components or URLs
- Deployment or infrastructure artifacts
- Any real order submission

## Focused Validation Commands

```text
npm.cmd run typecheck:portfolio
npm.cmd run test:portfolio
npm.cmd run test:portfolio:contracts
npm.cmd run benchmark:portfolio
npm.cmd run verify:portfolio
```

Compatibility validation additionally uses:

```text
npm.cmd run typecheck
npm.cmd test
```

## Compatibility Validation Result

- Full repository type checking passed.
- The complete Node suite ran 575 tests: 571 passed and four unrelated legacy tests failed.
- Three failures reproduce independently because the expected migrated snapshot data for 2026-07-31 is absent.
- One simulation-runtime failure reproduces independently because an EOD test trade closes when the legacy test expects it to remain open.
- U01 does not import or modify snapshot loading, replay, Strategy Advisor, simulation scheduling, trade execution, or those legacy test fixtures.
