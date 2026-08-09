# U01 Portfolio Domain Foundation Code Generation Plan

## Single Source of Truth

This document is the only approved execution plan for U01 Code Generation. Application code and build configuration are written under the workspace root. Only implementation summaries are written under `aidlc-docs/`.

## Unit Context

- **Unit**: U01 Portfolio Domain Foundation
- **Primary stories**: US-002, US-004, US-005, US-009
- **Dependencies**: No prior code unit; consumes only approved requirements and design contracts.
- **Downstream consumers**: U02 through U09.
- **Runtime boundary**: Pure strict TypeScript under `server/portfolio/`.
- **Infrastructure Design**: N/A.
- **Database entities**: None owned by U01.
- **API layer**: N/A.
- **Repository implementation**: N/A; U01 declares ports only.
- **Frontend**: N/A.
- **Deployment artifacts**: N/A.
- **Protected behavior**: Existing intraday, simulation, dashboard, mobile, replay, `/trade-execution`, and `/paper-trades` behavior must remain unchanged.

## Brownfield Findings

- The root runtime and tests are CommonJS, while the Remix application already uses NodeNext strict TypeScript.
- Node 24.18.0 and npm 11.16.0 satisfy the selected runtime baseline.
- The root manifest has an existing user change adding `headroom-ai`; all edits must preserve it.
- The root lockfile exists but is ignored by `.gitignore`; adding U01 development dependencies requires tracking the updated lockfile for SECURITY-10 compliance.
- Existing root tests use Node's built-in test runner. Remix TypeScript tests use native ESM imports.
- CodeGraph was requested first but its configured executable and PATH command were unavailable; direct repository inspection supplied the missing implementation context.

## Exact Application and Configuration Paths

### Modify

- `.gitignore`
- `package.json`
- `package-lock.json`

### Create Configuration

- `server/portfolio/package.json`
- `server/portfolio/tsconfig.json`
- `server/portfolio/tsconfig.contracts.json`
- `tests/portfolio/package.json`
- `benchmark/package.json`

### Create Runtime Source

- `server/portfolio/domain/shared/constants.ts`
- `server/portfolio/domain/errors/result.ts`
- `server/portfolio/domain/errors/failure.ts`
- `server/portfolio/domain/errors/invariant-error.ts`
- `server/portfolio/domain/errors/safe-context.ts`
- `server/portfolio/domain/shared/identifiers.ts`
- `server/portfolio/domain/shared/time.ts`
- `server/portfolio/domain/shared/command-context.ts`
- `server/portfolio/domain/shared/money.ts`
- `server/portfolio/domain/shared/quantity.ts`
- `server/portfolio/domain/shared/weight.ts`
- `server/portfolio/domain/shared/scaled-rate.ts`
- `server/portfolio/domain/shared/state-version.ts`
- `server/portfolio/domain/portfolio/evidence.ts`
- `server/portfolio/domain/portfolio/portfolio-name.ts`
- `server/portfolio/domain/portfolio/strategy-allocation.ts`
- `server/portfolio/domain/portfolio/holding-lot.ts`
- `server/portfolio/domain/portfolio/holding.ts`
- `server/portfolio/domain/portfolio/integrity.ts`
- `server/portfolio/domain/events/domain-events.ts`
- `server/portfolio/domain/events/codecs.ts`
- `server/portfolio/domain/portfolio/commands.ts`
- `server/portfolio/domain/portfolio/portfolio.ts`
- `server/portfolio/ports/index.ts`
- `server/portfolio/index.ts`

### Create Test and Benchmark Source

- `tests/portfolio/support/arbitraries.ts`
- `tests/portfolio/support/portfolio-model.ts`
- `tests/portfolio/support/rule-evidence.ts`
- `tests/portfolio/exact-values.test.ts`
- `tests/portfolio/portfolio.test.ts`
- `tests/portfolio/events.test.ts`
- `tests/portfolio/exact-values.property.test.ts`
- `tests/portfolio/portfolio.property.test.ts`
- `tests/portfolio/portfolio.model.test.ts`
- `tests/portfolio/architecture.test.ts`
- `benchmark/portfolio-domain.ts`

### Create Documentation Summary

- `aidlc-docs/construction/u01-portfolio-domain-foundation/code/code-summary.md`

## Generation Steps

### Step 1 - Configure the U01 TypeScript and Test Toolchain

- [x] Modify the root manifest in place while preserving `headroom-ai` and all existing scripts and dependencies.
- [x] Add root Node engine, portfolio typecheck, focused test, declaration-contract, and benchmark scripts.
- [x] Add TypeScript, matching Node types, and `fast-check` as development dependencies using npm.
- [x] Update and track the root lockfile; remove only the root `package-lock.json` ignore rule and add temporary contract-output ignores.
- [x] Create the nested ESM package boundary and strict normal/declaration TypeScript configurations.
- [x] Verify Node can import a minimal erasable `.ts` module and `tsc` recognizes all selected options.

### Step 2 - Implement Shared Exact-Value, Identity, Time, Result, and Error Components

- [x] Implement named scales and capacity bounds.
- [x] Implement closed typed results, stable failures, safe context, and invariant errors.
- [x] Implement branded identifier factories, canonical time values, and command context.
- [x] Implement Money, Quantity, Weight, ScaledRate, and PortfolioStateVersion with exact arithmetic and codecs.
- [x] Preserve dependency direction and expose no mutable object.

### Step 3 - Implement Evidence, Strategy Allocation, Holdings, Lots, and Integrity Validation

- [x] Implement closed evidence values and portfolio/mode/time/hash binding checks.
- [x] Implement single and multi-sleeve allocation with canonical ordering and exact 100% totals.
- [x] Implement immutable holdings and lots with quantity, delivery, reservation, and scope invariants.
- [x] Implement capacity guards, full validation, and targeted validation helpers.
- [x] Ensure targeted-success states can be checked by the full validator.

### Step 4 - Implement Versioned Events, Commands, and the Portfolio Aggregate

- [x] Implement four schema-versioned event types and canonical event codecs.
- [x] Implement typed creation, archive, mode-change, and allocation-replacement commands.
- [x] Implement immutable copy-on-write Portfolio creation and transitions.
- [x] Enforce version, lifecycle, evidence, event-cardinality, and no-op rules.
- [x] Keep clocks, identifiers, persistence, publication, and all external calls outside the aggregate.

### Step 5 - Implement Capability Ports and the Reviewed Public Entry Point

- [x] Declare repository, unit-of-work, clock, identifier, strategy-evidence, and event-bus ports.
- [x] Export only approved U01 contracts through `server/portfolio/index.ts`.
- [x] Prevent wildcard barrels, side-effect imports, cycles, deep internal exports, and forbidden legacy imports.
- [x] Generate declaration-only output and inspect the public contract surface.

### Step 6 - Implement Explicit Examples and Business-Rule Traceability

- [x] Implement focused tests for exact values, events, creation, archive, mode evidence, allocation replacement, sleeves, stale versions, and portfolio isolation.
- [x] Create an explicit evidence map covering all 72 `BR-U01-*` rules.
- [x] Verify every mapped rule names at least one executable example or property.
- [x] Use fake identifiers and data only; include no persistent database, credential, account, broker, or network.

### Step 7 - Implement Property and Stateful Model Tests

- [x] Add reusable constrained `fast-check` arbitraries.
- [x] Implement exact-value and codec round trips.
- [x] Implement cash, quantity, scope, version, event, allocation, canonicalization, failure-atomicity, and validation-equivalence properties.
- [x] Implement a simplified Portfolio reference model and generated command sequences.
- [x] Keep shrinking enabled and ensure failure output provides seed, path, and minimal counterexample.
- [x] Convert any relevant discovered counterexample into an explicit regression test.

### Step 8 - Implement Architecture, Contract, Capacity, and Performance Verification

- [x] Add architecture tests for forbidden imports, cycles, hidden internals, zero runtime dependencies, and import side effects.
- [x] Add a declaration-contract generation check.
- [x] Add benchmark fixtures for representative and maximum holdings, lots, and sleeves.
- [x] Report environment, seed, p50, p95, maximum, heap delta, and growth.
- [x] Enforce the approved 25 ms, 100 ms, 10 ms, and 64 MiB thresholds without weakening validation.

### Step 9 - Generate the U01 Code Summary

- [x] Create the markdown code summary with created and modified files, story coverage, business-rule evidence, NFR results, extension compliance, and explicit N/A layers.
- [x] Record the focused commands needed to validate U01.
- [x] Do not create implementation notes or source code under `aidlc-docs/`.

### Step 10 - Run Focused and Compatibility Verification

- [x] Run portfolio strict type checking.
- [x] Run all U01 example, property, model, architecture, and contract tests.
- [x] Run the U01 benchmark gate.
- [x] Run syntax or import checks selected by the implementation.
- [x] Run the existing full typecheck and Node test suite when practical.
- [x] Resolve failures caused by U01; do not fix unrelated pre-existing failures.

### Step 11 - Review and Complete U01

- [x] Inspect the final diff and confirm unrelated user changes remain intact.
- [x] Verify no duplicate `_new`, `_modified`, generated-JavaScript, temporary contract, log, database, or benchmark-output files remain.
- [x] Scan changed source and configuration for secrets.
- [x] Mark all U01 story statuses complete only after their code and tests pass.
- [x] Update AI-DLC state, audit, plan, and the Code Generation review gate.

## Story Traceability

| Story | Primary implementation steps | Required evidence |
|---|---|---|
| US-002 Create Independent Portfolios | Steps 2 through 7 | Valid creation, immutable ID, non-negative cash, isolation, invalid input, state-model properties |
| US-004 Archive a Portfolio Safely | Steps 4, 6, and 7 | ACTIVE-to-ARCHIVED, retained state, idempotent repeat, no version/event change |
| US-005 Assign and Change Strategy Versions | Steps 3, 4, 6, and 7 | Future-effective replacement, immutable historical references, evidence binding, stale-version rejection |
| US-009 Allocate Multiple Strategy Sleeves | Steps 3, 6, 7, and 8 | Exact 100% weights, unique sleeves, canonical ordering, no leverage/short constraint bypass |

## Story Completion

- [x] US-002
- [x] US-004
- [x] US-005
- [x] US-009

## Extension Execution

### Security

- SECURITY-10: track the lockfile, keep zero U01 runtime dependencies, and include dependency verification.
- SECURITY-11: isolate security-sensitive evidence and failure logic.
- SECURITY-13: implement versioned immutable events, exact values, and declaration review.
- SECURITY-15: implement fail-closed typed errors, invariant containment, and no fallback.
- Other security rules remain N/A to U01 and keep their downstream owners.

### Resiliency

- RESILIENCY-01: preserve Critical classification and dependency boundaries.
- RESILIENCY-02 through RESILIENCY-15: N/A to pure U01 runtime behavior.
- RESILIENCY-14 remains assigned to U06 NFR Design.

### Property-Based Testing

- Implement PBT-02 through PBT-08 and PBT-10 using the PBT-01 design and PBT-09 framework selection.
- Use reusable constrained generators, model commands, shrinking, seed replay, and explicit examples.
- Do not mark any PBT rule compliant until the generated tests execute successfully.

## Approval Gate

No application code, test, dependency, lockfile, or build configuration change may be made until this entire plan and sequence are explicitly approved.
