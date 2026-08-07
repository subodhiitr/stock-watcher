# U03 Strategy, Data, and Research – Technology Stack Decisions

## Decision Summary

| Area | Decision |
|---|---|
| Runtime | Node.js 24.3 or newer within the existing local application |
| Language | Strict erasable TypeScript (same configuration as U01/U02) |
| Module system | NodeNext ESM within the existing `server/portfolio/` boundary |
| Arithmetic – z-scores and rates | JavaScript Number (IEEE 754 double) with explicit NaN/Infinity guards after every step |
| Arithmetic – weight sums | Scaled integer parts-per-million via U01 exact-value contracts |
| Hash algorithm | SHA-256 via `node:crypto` – no new dependency |
| Snapshot / UUID generation | `node:crypto.randomUUID()` – no new dependency |
| Production runtime dependencies | None new; zero additions to existing dependencies |
| Example tests | Node built-in test runner and strict assertions (same as U01/U02) |
| Property tests | `fast-check` already locked as root development dependency – reused, not reinstalled |
| Benchmarks | Custom Node benchmark scripts following the U01/U02 pattern – no framework added |
| Contract review | TypeScript declaration generation following U01 pattern |

---

## Runtime

U03 uses the Node 24 baseline already required by the Remix application and established in U01. All TypeScript syntax must be natively erasable without compilation.

Required constraints (identical to U01/U02):

- minimum Node version: 24.3;
- no TypeScript enum at runtime;
- no namespace containing runtime code;
- no parameter properties;
- no legacy decorators;
- no JSX;
- no TypeScript syntax requiring JavaScript generation;
- explicit `.ts` import specifiers inside the portfolio ESM boundary;
- no path-alias reliance at runtime.

---

## TypeScript Configuration

U03 extends the strict portfolio-specific configuration established in U01 without weakening any setting.

Required compiler behavior (same as U01/U02):

- `strict: true`;
- `noEmit: true` for normal checking;
- `module: NodeNext`;
- `moduleResolution: NodeNext`;
- `target: ES2024` (or the project-approved Node 24 equivalent);
- `lib: ["ES2024"]`;
- `verbatimModuleSyntax: true`;
- `isolatedModules: true`;
- `erasableSyntaxOnly: true`;
- `allowImportingTsExtensions: true`;
- `exactOptionalPropertyTypes: true`;
- `noUncheckedIndexedAccess: true`;
- `noImplicitOverride: true`;
- Node type declarations matching the supported runtime.

`skipLibCheck` may remain enabled for third-party declarations but shall not suppress checking of U03 source files.

---

## Arithmetic Decisions

### Z-Score and Rate Arithmetic

**Decision**: Use JavaScript `Number` (IEEE 754 double-precision, 64-bit float) for z-score computation, composite scores, conviction multipliers, and rate calculations.

**Rationale**: Cross-sectional z-scores are analytical values, not accounting values. Their precision requirements are satisfied by double-precision floating point, which provides 15–17 significant decimal digits. The critical guard is explicit NaN, Infinity, and negative-infinity detection after every intermediate computation step (NFR-U03-DET-002). Silent propagation of pathological values is prohibited.

**Rejected alternative**: Arbitrary-precision decimal or BigInt for z-scores. Rejected because: (a) z-scores are not financial accounting values requiring exact minor-unit precision; (b) adding a decimal library introduces a production dependency risk; (c) JavaScript Number is sufficient for the analytical precision required by signal ranking.

### Weight Sum Arithmetic

**Decision**: Factor weight sums are validated using U01's scaled integer parts-per-million representation (integer values in [0, 1,000,000] summing to exactly 1,000,000). This is not a new implementation; it reuses U01's existing exact-value contracts.

**Rationale**: Weight sums are policy invariants that must be exact. Floating-point weight comparisons (e.g., `0.3 + 0.3 + 0.4 === 1.0`) are unreliable in binary floating point.

### Hash Computation

**Decision**: Use `node:crypto.createHash('sha256')` for all SHA-256 computations (strategy config canonical hash, evidence summary hashes, AI advisory output hashes). The canonical JSON representation uses sorted keys, UTF-8 encoding, no trailing whitespace, and no indentation.

**Rationale**: `node:crypto` is a built-in Node module. No additional dependency is required. Hash output is 64-character lowercase hex string.

---

## Module and Source Organization

U03 code lives under the `server/portfolio/` ESM boundary established in U01.

### Directory Structure

```text
server/portfolio/
  domain/
    strategy/              # StrategyVersion aggregate, StrategyConfig, lifecycle commands
    evaluation/            # EligibilityResult, SignalSnapshot, RegimeState, value objects
  application/
    evaluation/            # Evaluation orchestration services (call ports, assemble snapshots)
    backtest/              # BacktestRun orchestration
  adapters/
    market-data/           # Adapters for MarketDataPort, FundamentalsPort, IndexMembershipPort
    research/              # AI advisory adapter, news/sentiment stubs
    corporate-action/      # CorporateActionPort adapter
    calendar/              # ExchangeCalendarPort adapter
    instrument-registry/   # InstrumentRegistryPort adapter
```

**Rules**:
- Domain modules (`domain/strategy/`, `domain/evaluation/`) import only U01 contracts and each other. No import from adapters, HTTP, broker SDKs, React, simulation, or legacy dashboard modules.
- Application services (`application/evaluation/`, `application/backtest/`) orchestrate domain operations by calling ports. They do not import adapter implementations.
- Adapters implement ports defined in `server/portfolio/ports/`. Each adapter module imports only its port interface and the relevant external SDK (none for U03 – all providers use typed port fakes in tests).
- No circular imports at any level.
- `type-only` dependencies use `import type`.

---

## Provider Port Implementation Policy

U03 defines ports (interfaces) for all seven external data providers:

- `MarketDataPort`
- `FundamentalsPort`
- `IndexMembershipPort`
- `CorporateActionPort`
- `ExchangeCalendarPort`
- `InstrumentRegistryPort`
- `AiAdvisoryPort`

Port implementations (adapters) are injected at composition time. U03 domain logic and application services never import a concrete adapter; they depend only on the port interface.

**For Code Generation**: Initial implementations will be typed fakes or stub adapters that throw `ProviderUnavailableError` for routes not yet integrated with a real provider. Real provider integrations are planned for U07 (broker and market data API integration).

**Circuit breaker and retry logic** live in a shared infrastructure module under `server/portfolio/infrastructure/resilience/`. They wrap port calls at the adapter composition layer, not inside domain or application services.

---

## Dependency Decisions

### Production Runtime Dependencies

**Decision**: Zero new production runtime dependencies for U03.

All required capabilities are available through:
- `node:crypto` – SHA-256 hash computation.
- `node:crypto.randomUUID()` – DataVersionSnapshot and request ID generation.
- `node:assert/strict` – assertion utilities.
- U01 and U02 domain contracts and exact-value types – reused through `server/portfolio/` ESM imports.
- JavaScript built-in `Number` arithmetic with explicit guard functions.

**Rationale**: A zero-production-dependency policy minimizes supply-chain risk, reduces attack surface, and avoids transitive vulnerability exposure. The project's existing packages are sufficient.

**Rejected alternatives**:

| Alternative | Reason for rejection |
|---|---|
| Decimal.js or big.js for z-scores | Unnecessary for analytical scores; adds production dependency risk |
| Zod or io-ts for config validation | Transport and persistence adapters own untrusted input parsing; U03 domain validation uses narrow field checks matching U01 pattern |
| Axios or node-fetch for provider calls | Provider port implementations are adapter-injected; no HTTP library is imported into U03 domain or application layers |
| A job-queue library for backtest scheduling | Backtest orchestration is synchronous within U03; scheduling belongs to U06 |
| A statistics library | Z-scoring, winsorization, and percentile are simple well-defined algorithms implementable without a dependency |

### Development Dependencies

**Decision**: Reuse `fast-check` already locked in the repository from U01. No reinstallation or version change.

`fast-check` version is pinned in the root `package.json` lockfile. U03 extends the shared arbitraries established under U01/U02 test support.

---

## Test Stack

### Node Test Runner (same as U01/U02)

- `node:test` with native TypeScript execution for `.test.ts` files.
- `node:assert/strict` for assertions.
- Isolated deterministic tests; no persistent database, real provider, or network call.
- Provider ports are replaced with typed fakes for all tests.

### fast-check (reused from U01/U02)

fast-check is the property-testing framework. The following U03-specific arbitraries extend the U01/U02 shared arbitraries:

| Arbitrary | Purpose |
|---|---|
| `strategyConfigArb` | Generate valid and invalid StrategyConfig objects (weight sums, enum values, thresholds) |
| `eligibilityInputArb` | Generate per-instrument eligibility inputs with boundary and pathological values |
| `signalUniverseArb` | Generate full-universe signal inputs including NaN/Infinity injection |
| `regimeIndicatorSequenceArb` | Generate multi-day sequences designed to hit confirmation boundaries and crisis criteria |
| `corporateActionArb` | Generate all ten action types with boundary ratios |
| `backtestDateRangeArb` | Generate date ranges (below 5 years, exactly 5 years, above 5 years) |
| `aiAdvisoryRequestArb` | Generate all six permitted operations and all documented prohibited types |

Test file naming convention (same as U01/U02):

- Explicit scenario tests: `*.test.ts`
- Property tests: `*.property.test.ts`
- Stateful model tests: `*.model.test.ts`
- Regression from shrunk counterexamples: added to the relevant `*.test.ts`

### Benchmarks

Custom Node benchmark scripts under the existing repository benchmark convention. No benchmarking framework is added.

Each benchmark:
- warms the target operation before measurement;
- separates fixture generation from measured execution;
- uses fixed and logged seeds for reproducibility;
- measures high-resolution elapsed time via `process.hrtime.bigint()`;
- reports p50, p95, maximum, heap delta, input sizes, Node version, OS, and processor;
- returns a non-zero exit code when an approved threshold is exceeded.

Benchmark targets:

| Target | Threshold | Metric |
|---|---|---|
| Single-instrument eligibility check | 10 ms p95 | NFR-U03-PERF-002 |
| 1,000-instrument full evaluation | 60 s p95 | NFR-U03-PERF-001 |
| Cross-sectional scoring for 1,000 instruments | 20 s p95 | NFR-U03-PERF-003 |
| Regime determination | 500 ms p95 | NFR-U03-PERF-004 |
| Config validation + hash | 100 ms p95 | NFR-U03-PERF-005 |
| DataVersionSnapshot assembly (1,000 instruments) | 5 s p95 | NFR-U03-PERF-006 |
| 5-year backtest (1,000 instruments, 3 folds) | 10 min p95 | NFR-U03-PERF-010 |

---

## Contract Review

A separate declaration-only TypeScript configuration may emit `.d.ts` files into an ignored temporary directory for contract review following the U01 pattern:

- includes only public entry points from `server/portfolio/domain/strategy/`, `server/portfolio/domain/evaluation/`, and `server/portfolio/ports/`;
- excludes tests, internal modules, and adapter implementations;
- produces no JavaScript;
- deleted or ignored after review;
- supports diffing public identifiers, port contracts, evaluation result types, lifecycle commands, and reason codes.

---

## Compatibility Policy

- U03 does not alter `/trade-execution`, `/paper-trades`, legacy database schemas, simulation engine APIs, dashboard modules, or intraday policy logic.
- Event payloads include schema versions following U01/U02 conventions.
- Stable reason codes are additive within a schema version.
- Public declaration drift is reviewed before merge.
- Node 24 is the only runtime target; no browser compatibility is required for U03 modules.

---

## PBT-09 Compliance

- Framework: `fast-check` (already locked, no new installation).
- Language: TypeScript.
- Runner integration: Node's built-in test runner.
- Custom generators: required; specified in NFR-U03-PBT-010 through PBT-014.
- Automatic shrinking: supported and must remain enabled.
- Seed replay: supported and required in CI output.
- Dependency disposition: already a root development dependency; no additional installation step required for U03.

PBT-09 is satisfied at the NFR Requirements decision level.

---

## Rejected Alternatives

### Emitted JavaScript Build for U03

Rejected for the same reason as U01: Node 24 supports erasable TypeScript natively. A compiled artifact tree adds stale-build and source-map complexity without benefit.

### Floating-Point Accumulation for Weight Sums

Rejected because factor weight policy invariants require exact integer verification. The U01 parts-per-million representation already provides this without additional tooling.

### Global Mutable Score Cache

Rejected because evaluation determinism requires all inputs to be explicit arguments. A global cache would break determinism and complicate PBT.

### Per-Instrument Parallelism with Worker Threads

Rejected for the initial implementation because: (a) the 60-second p95 evaluation latency target is achievable synchronously for 1,000 instruments; (b) worker threads add substantial complexity and inter-thread coordination risk; (c) the architecture can be evolved toward parallelism once single-threaded benchmarks validate the target. This decision may be revisited if benchmark evidence shows the 60-second target cannot be met synchronously.

### AI Advisory Provider as a Production Dependency

Rejected because: (a) AI advisory is non-critical and the system must function without it; (b) the port is injected at composition time; (c) no AI SDK is imported into U03 domain or application layers. The AI advisory adapter remains a stub in initial code generation.
