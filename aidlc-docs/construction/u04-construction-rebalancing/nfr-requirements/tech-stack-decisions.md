# U04 Construction and Rebalancing Technology Stack Decisions

## Decision Summary

| Area | Decision |
|---|---|
| Runtime | Node.js >=24.3 inside the existing local application |
| Language | Strict erasable TypeScript |
| Module system | NodeNext ESM within `server/portfolio/` |
| Exact arithmetic | Reuse U01 `Money`, `Quantity`, `Weight`, and `ScaledRate` |
| Hashing | Canonical UTF-8 JSON plus SHA-256 via `node:crypto` |
| Ambient nondeterminism | Forbidden inside pure plan construction |
| Optimizer architecture | Optional `OptimizerPort`; initial deterministic in-process adapters only |
| Example tests | Node built-in test runner |
| Property tests | Existing root `fast-check` dependency |
| Benchmarks | Custom Node benchmark harness aligned to `benchmark/*.ts` |
| Production dependencies | No new production runtime dependency in U04 MVP |
| Observability | Typed immutable payloads only; no logging infrastructure in pure domain |

## Runtime and Language Baseline

U04 stays inside the existing local Node application and the `server/portfolio/` ESM boundary. The approved runtime floor is **Node.js 24.3 or newer**, matching the repository `package.json` engines field and the prior U01-U03 decisions.

Required runtime constraints remain unchanged:

- native erasable TypeScript only;
- no emitted JavaScript build required for normal execution;
- no runtime `enum`, legacy decorators, parameter properties, namespaces with runtime code, or JSX;
- explicit `.ts` import specifiers inside the portfolio boundary;
- no path-alias reliance at runtime.

## TypeScript Configuration

U04 shall compile under the existing `server/portfolio/tsconfig.json` without weakening any strictness setting.

Required compiler behavior:

- `strict: true`;
- `module: "NodeNext"` and `moduleResolution: "NodeNext"`;
- `target: "ES2024"` and `lib: ["ES2024"]`;
- `verbatimModuleSyntax: true`;
- `isolatedModules: true`;
- `erasableSyntaxOnly: true`;
- `allowImportingTsExtensions: true`;
- `exactOptionalPropertyTypes: true`;
- `noUncheckedIndexedAccess: true`;
- `noImplicitOverride: true`;
- `noEmit: true` for normal type-checking.

## Exact Arithmetic and Canonicalization

### Exact Values

U04 reuses U01 exact-value contracts rather than introducing a new money or decimal abstraction:

- `Money` for INR notional values and estimated cost and tax totals;
- `Quantity` for whole-share holdings, available delivery, and order quantities;
- `Weight` for parts-per-million target and realized weights;
- `ScaledRate` for exact turnover, hurdle, and charge expressions where exact scaled arithmetic is required.

Analytical scores, conviction multipliers, and regime exposure ranges remain **immutable U03 inputs**. U04 may compare or consume those numeric inputs, but it does not recompute them using a second math model.

### Hashing and Canonical JSON

Use `node:crypto.createHash('sha256')` for `planInputHash`, `planHash`, optimizer-request hashes, and any integrity summaries. Canonical JSON follows the established U02 pattern:

- recursively sort object keys;
- omit `undefined` values;
- encode every `bigint` as a base-10 string;
- serialize as UTF-8 with no indentation and no trailing whitespace.

### No Ambient Randomness or Clock Reads

The pure planning path shall not call `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, or any equivalent ambient source while deriving a plan. If an outer layer needs a transport-level request ID or persisted identifier, it must inject that value as validated input before or after pure planning, not during deterministic plan construction.

## Module and Source Organization

U04 source shall remain inside the `server/portfolio/` boundary and be decomposed by responsibility:

```text
server/portfolio/
  domain/
    construction/          # candidate classification, ideal targets, executable targets, constraints
    rebalancing/           # cadence, turnover, costs, taxes, plan lifecycle, reason bundles
  application/
    rebalancing/           # orchestration of validated inputs and port calls
  adapters/
    optimization/          # OptimizerPort implementations only
```

Rules:

- shared exact values and identifiers continue to come from U01 public exports;
- application orchestration depends on domain modules and ports, never on concrete UI or route handlers;
- optimization adapters implement `OptimizerPort` and do not leak solver-specific types into the domain;
- no circular imports;
- use `import type` for type-only dependencies;
- no imports from `ticker_proxy.js`, `dashboard-app.js`, `simulation_engine.js`, `backtest_simulation.js`, `/trade-execution`, `/paper-trades`, Remix routes, or legacy intraday-policy modules.

## Optimizer Architecture

### MVP Decision

U04 MVP does **not** require a solver library. `OptimizerPort` remains optional and is initially satisfiable with in-process deterministic adapters:

- a greedy baseline adapter that simply returns the deterministic whole-share greedy result;
- a small-problem oracle adapter used only for verification and benchmark or test scenarios.

These adapters are sufficient to satisfy initial U04 code generation because the functional requirement is safe bounded optimization **behind a port**, not the immediate introduction of an external solver.

### Bounded Future Solver Path

A future external integer or risk-parity solver may be added only if all of the following remain true:

1. it stays behind `OptimizerPort`;
2. it cannot bypass the U04 verifier;
3. it preserves deterministic fallback to the greedy baseline;
4. it is exact-version locked, vulnerability-scanned, and SBOM-listed;
5. it is optional for deployment and can be disabled without breaking plan generation.

### Explicit Rejected Solver Behavior

- No solver output is trusted without post-verification.
- No oversized problem is sent to the optimizer; large inputs go directly to deterministic greedy planning.
- No solver-specific explanation text, stack trace, or raw metadata becomes part of public plan output.

## Test Stack and Benchmarking

### Example Tests

Use Node's built-in `node:test` runner and the repository's existing `tests/portfolio/` structure. U04 test files shall follow the established naming pattern:

- `*.test.ts` for explicit examples and regression cases;
- `*.property.test.ts` for pure properties;
- `*.model.test.ts` for stateful command-sequence models.

### Property Tests

Reuse the already installed root `fast-check` development dependency (`4.8.0`). Do not add a second PBT framework.

Required U04 generator families include:

- exact-value generators for `Money`, `Quantity`, `Weight`, and `ScaledRate`;
- portfolio and holding graphs with isolated portfolio scope;
- candidate universes with eligibility, signal, liquidity, and classification lineage;
- cost and tax schedule versions and lot-selection instructions;
- turnover snapshots and lifecycle command sequences;
- bounded optimizer requests and accepted or rejected optimizer outcomes.

### Benchmarks

Use a custom Node benchmark script following the existing `benchmark/*.ts` convention already used by `portfolio-domain.ts`, `portfolio-persistence.ts`, and `portfolio-strategy.ts`.

Benchmark requirements:

- warm the operation before measurement;
- separate fixture generation from measured execution;
- use fixed and logged seeds;
- measure high-resolution elapsed time;
- report p50, p95, maximum, heap delta, environment, and input sizes;
- exit non-zero when an approved threshold is exceeded.

A future script such as `benchmark/portfolio-rebalancing.ts` is aligned with this convention, but no package or script change is required during this documentation-only stage.

## Dependency Decision

### Production Runtime Dependencies

**Decision**: add **zero** new production runtime dependencies for U04 MVP.

Existing capabilities are sufficient:

- `node:crypto` for SHA-256 hashing;
- built-in Node timing and assertion utilities for tests and benchmarks;
- U01 and U03 public contracts for exact values, identifiers, holdings, lots, eligibility, signals, and regime state.

### Development Dependencies

Reuse existing repository tooling only:

- TypeScript already pinned in the root `package.json`;
- `@types/node` already pinned;
- `fast-check` already pinned as a root development dependency.

No new benchmark framework, solver library, ORM, validation library, or logging SDK is justified for this stage.

## Observability Emission Policy

U04 emits **typed immutable observability payloads**, not infrastructure integrations. That means U04 may define summary records for:

- phase durations;
- optimizer outcome metadata;
- plan lineage hashes;
- turnover budgets and reason-code counts;
- current versus target summary values.

Routing those payloads to logs, dashboards, tracing systems, or alert pipelines is explicitly deferred to outer application and operational layers.

## Compatibility and Migration Constraints

- U04 must preserve U01 exact-value semantics and U03 lineage semantics without weakening them.
- Public reason codes and plan schema versions are additive within a version; breaking changes require explicit downstream review.
- U04 does not alter `/trade-execution`, `/paper-trades`, legacy simulation flows, or dashboard modules.
- Same-session routine output remains forbidden even if outer layers later change transport or UI behavior.
- External solver support, if ever added, remains optional and additive behind `OptimizerPort`.
- Initial code generation is satisfied by deterministic greedy and oracle adapters; no external solver is required to meet the approved U04 scope.

## PBT-09 Compliance

- **Framework**: `fast-check`
- **Language**: TypeScript
- **Runner integration**: Node's built-in test runner
- **Custom generators**: required and explicitly planned for U04 domain types
- **Automatic shrinking**: supported and must remain enabled
- **Seed replay**: supported and required in CI output
- **Dependency disposition**: already installed as a root development dependency; reused without reinstallation

PBT-09 is satisfied at the NFR decision level.

## Rejected Alternatives

| Alternative | Reason for rejection |
|---|---|
| External solver library in U04 MVP | Not required to satisfy initial code generation; adds supply-chain and determinism risk before the port and verifier are proven. |
| Decimal or money library | U01 exact-value contracts already provide audited exact arithmetic without adding a production dependency. |
| Floating-point accounting or weight invariants | Would violate the exactness requirements for money, quantities, turnover, and target reconciliation. |
| Random tie-breaking or runtime UUID generation inside planning | Would break equivalent-input determinism and semantic duplicate detection. |
| Embedded logger, metrics client, or tracing SDK in U04 | Pure-domain planning should emit typed data only; infrastructure ownership belongs to outer layers. |
| Worker-thread or queue-based optimizer orchestration in MVP | Adds operational complexity before single-process benchmark evidence shows it is necessary. |
| Direct dependency on dashboard, simulation, or trade-route modules | Violates maintainability boundaries and would couple U04 to legacy workflows. |
