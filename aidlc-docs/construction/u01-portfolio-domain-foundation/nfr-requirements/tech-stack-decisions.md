# U01 Technology Stack Decisions

## Decision Summary

| Area | Decision |
|---|---|
| Runtime | Node.js 24.3 or newer within the existing local application |
| Language | Strict erasable TypeScript |
| Module system | NodeNext ESM scoped to `server/portfolio/` |
| Runtime execution | Node 24 native TypeScript type stripping |
| Type checking | TypeScript `tsc --noEmit` |
| Production dependencies | None for U01 |
| Example tests | Node built-in test runner and strict assertions |
| Property tests | `fast-check` integrated with Node's test runner |
| Contract review | Generated TypeScript declarations reviewed for unexpected drift |

## Node Runtime

U01 uses the Node 24 baseline already required by the Remix application. Native TypeScript execution is acceptable only for syntax that Node can erase without transformation.

Required runtime constraints:

- minimum Node version 24.3;
- no TypeScript enum;
- no namespace containing runtime code;
- no parameter properties;
- no legacy decorators;
- no JSX;
- no TypeScript syntax requiring JavaScript generation;
- explicit `.ts` import specifiers inside the portfolio ESM boundary;
- no reliance on path aliases at runtime.

The root application remains CommonJS where it is already CommonJS. U07 later owns a minimal dynamic-import composition shim into the portfolio ESM boundary; U01 itself does not modify `ticker_proxy.js`.

## TypeScript Configuration

U01 shall use a portfolio-specific strict configuration extending project conventions without weakening the Remix application's configuration.

Required compiler behavior:

- `strict: true`;
- `noEmit: true` for normal checking;
- `module: NodeNext`;
- `moduleResolution: NodeNext`;
- `target: ES2024` or the project-approved Node 24 equivalent;
- `lib: ["ES2024"]`;
- `verbatimModuleSyntax: true`;
- `isolatedModules: true`;
- `erasableSyntaxOnly: true`;
- `allowImportingTsExtensions: true`;
- `exactOptionalPropertyTypes: true`;
- `noUncheckedIndexedAccess: true`;
- `noImplicitOverride: true`;
- Node type declarations matching the supported runtime.

`skipLibCheck` may remain enabled for third-party declarations, but it cannot suppress checking of U01 source.

## ESM Boundary

`server/portfolio/` shall have an explicit ESM package boundary or equivalent unambiguous NodeNext configuration.

Rules:

- source files import exact public module paths;
- domain modules do not use CommonJS `require`;
- the public index exports only approved contracts;
- internal modules are not exported through wildcard barrels;
- no circular import is permitted;
- type-only dependencies use `import type`;
- runtime and type import behavior must agree under Node and `tsc`.

## Source Organization

The implementation plan should refine this boundary without merging unrelated responsibilities:

- `server/portfolio/domain/shared/` for branded identifiers, exact values, time values, results, and invariant errors;
- `server/portfolio/domain/portfolio/` for aggregate, entities, commands, state transitions, and allocation policy;
- `server/portfolio/domain/events/` for typed schema-versioned events;
- `server/portfolio/domain/errors/` for stable codes and safe failures;
- `server/portfolio/ports/` for repository, unit-of-work, clock, identifier, evidence, and event-bus contracts;
- `server/portfolio/index.ts` for explicit public exports.

No file in U01 imports `better-sqlite3`, Remix, broker packages, HTTP helpers, dashboard modules, simulation modules, or intraday policy.

## Exact Values

Use native `bigint` for:

- INR minor units;
- whole-share quantities;
- scaled integer numerators when values may exceed safe integer range.

Use bounded safe integers for:

- parts-per-million weights;
- state versions until overflow guard;
- fixed small schema versions and collection counts.

Canonical JSON-facing codecs encode every `bigint` as a base-10 string because JSON has no native BigInt representation. Codecs are explicit and versioned; raw `JSON.stringify` of domain objects is prohibited.

No decimal, money, immutable-collection, UUID, date, validation, or result library is introduced in U01. Small domain-specific implementations are easier to audit and avoid production dependency risk.

## Runtime Immutability

TypeScript `readonly` alone is not considered runtime immutability.

U01 shall use:

- private or controlled constructors;
- defensive copying at every collection boundary;
- canonical frozen arrays and frozen plain records;
- no publicly exposed mutable Map, Set, Array, or object reference;
- copy-on-write aggregate transitions;
- structural equality helpers that ignore object identity.

The implementation shall avoid generic recursive deep-freeze behavior on untrusted cyclic data. Constructors build known acyclic domain structures and freeze them explicitly.

## Result and Error Types

U01 implements a dependency-free discriminated `DomainResult<T>`:

- success contains a value and no failure;
- failure contains a stable `DomainFailure` and no value;
- exhaustive switches are required;
- expected failures are returned;
- `DomainInvariantError` is reserved for impossible trusted-state corruption or programmer defects.

No broad catch or silent default is permitted inside pure domain operations.

## Test Stack

### Node Test Runner

Use:

- `node:test`;
- `node:assert/strict`;
- native Node 24 TypeScript execution for `.test.ts`;
- isolated deterministic tests with no persistent database or network.

### fast-check

`fast-check` is the selected JavaScript and TypeScript property-testing framework because it provides:

- reusable arbitraries;
- automatic shrinking;
- seed and path replay;
- model-based command testing;
- direct integration with Node's test runner.

It shall be added as an exact or lockfile-pinned root development dependency during U01 Code Generation. The implementation shall not add it to production dependencies.

Shared arbitraries shall live under a portfolio test-support boundary and remain reusable by U02 through U09.

### Test Separation

- Explicit scenario tests use descriptive `.test.ts` files.
- Property tests use descriptive `.property.test.ts` files.
- Stateful model tests use descriptive `.model.test.ts` files.
- Shrunk production-relevant cases become explicit regression tests.

## Performance Verification

Use a focused Node benchmark script under the existing repository benchmark or test conventions. Do not add a benchmarking framework.

The harness shall:

- warm the tested operation;
- separate fixture generation from measured execution;
- use fixed and logged seeds;
- measure high-resolution elapsed time;
- report p50, p95, maximum, heap delta, input sizes, and environment;
- test representative and maximum capacities;
- return a non-zero exit when an approved threshold is exceeded.

Benchmark results are evidence, not a runtime dependency.

## Contract Review

A separate declaration-only TypeScript configuration may emit `.d.ts` files into an ignored temporary directory for contract review. It shall:

- include only U01 public entry points;
- exclude tests and internal modules;
- produce no JavaScript;
- be deleted or ignored after review;
- support diffing public identifiers, events, errors, ports, and aggregate command signatures.

No API Extractor dependency is required. TypeScript declarations provide the review surface.

## Dependency and Supply-Chain Policy

- U01 production runtime dependencies: zero.
- Development dependencies: TypeScript, matching Node types, and `fast-check`.
- Dependency versions are resolved through the repository lockfile and trusted npm registry.
- Vulnerability scan and SBOM include development tools according to project CI policy.
- No Git dependency, CDN script, downloaded binary, or generated executable is introduced for U01.

The existing root Git dependency is outside U01 scope and is reviewed by U09 supply-chain verification.

## Compatibility Policy

- Event payloads include schema versions.
- Stable failure codes are additive within a schema version.
- Removing or changing public fields requires deprecation and dependent-unit review.
- Public declaration drift is reviewed before merge.
- U01 does not alter `/trade-execution`, `/paper-trades`, legacy database schemas, simulation APIs, or UI routes.
- Node 24 is the only runtime target; browser compatibility is not required for U01 domain modules.

## Rejected Alternatives

### Emitted JavaScript Build for U01

Rejected for U01 because Node 24 already supports erasable TypeScript, and a second emitted artifact tree adds stale-build and source-map complexity. This decision can be revisited only if a required TypeScript feature cannot run under native stripping or deployment tooling cannot consume `.ts`.

### JavaScript with JSDoc

Rejected because the approved architecture requires strict TypeScript and branded discriminated contracts across financially critical units.

### Runtime Validation Library in U01

Rejected because transport and persistence adapters own untrusted parsing. U01 constructors perform narrow domain validation without adding a production dependency.

### General-Purpose Immutable Collection Library

Rejected because bounded frozen records and arrays meet U01 needs with lower complexity and supply-chain surface.

## PBT-09 Compliance

- Framework selected: `fast-check`.
- Primary language: TypeScript.
- Existing runner integration: Node's test runner.
- Custom generators: supported and required.
- Automatic shrinking: supported and must remain enabled.
- Seed replay: supported and required in CI output.
- Dependency disposition: root development dependency added during approved Code Generation and locked in the repository lockfile.

PBT-09 is satisfied at the NFR Requirements decision level. Dependency installation remains a mandatory Code Generation step rather than an unapproved design-stage source change.

