# U01 Logical Components

## Component Model

U01 is divided into small acyclic logical components. Runtime components are dependency-free beyond Node standard language features. Test and benchmark components may depend on `fast-check` or Node test APIs but are never imported by runtime source.

## LC-U01-01 Domain Constants

### Responsibility

- Currency code and scale constants.
- Weight total of 1,000,000.
- Collection limits for holdings, lots, and sleeves.
- Name, identifier, context, and schema-version bounds.
- Named event schema versions.

### Dependencies

None.

### Visibility

Internal constants are private. Only constants required to interpret public exact values or schemas are exported.

## LC-U01-02 Results and Failures

### Responsibility

- `DomainResult<T>` success and failure branches.
- Stable `DomainFailureCode` union.
- Safe retryability classification.
- Bounded allowlisted failure-context records.
- `DomainInvariantError`.

### Dependencies

LC-U01-01 only.

### Constraints

- No arbitrary metadata dictionary.
- No broad catch helper.
- No success-shaped default.
- Exhaustive discriminated handling.

## LC-U01-03 Identity and Time

### Responsibility

- Branded identifier factories and guards.
- Canonical identifier comparison and safe rendering.
- Instant and LocalDate construction.
- CommandContext validation.

### Dependencies

LC-U01-01 and LC-U01-02.

### Constraints

- No identifier generation.
- No clock access.
- No timezone or exchange-calendar calculation.

## LC-U01-04 Exact Values

### Responsibility

- Money.
- Quantity.
- Weight.
- ScaledRate.
- PortfolioStateVersion.
- Exact arithmetic and canonical codecs.

### Dependencies

LC-U01-01 and LC-U01-02.

### Constraints

- No binary floating-point accounting.
- No implicit currency or scale conversion.
- No raw JSON serialization of BigInt values.

## LC-U01-05 Evidence and Safe Context

### Responsibility

- Closed evidence-kind union.
- ModeTransitionEvidence and strategy-evidence references.
- Portfolio, mode, issuer, time, expiry, and hash binding checks.
- Event and error safe-context builders.

### Dependencies

LC-U01-01 through LC-U01-04.

### Constraints

- No raw token, signature, credential, broker account, or free metadata.
- Cryptographic verification remains upstream.

## LC-U01-06 Strategy Allocation

### Responsibility

- SingleStrategyAllocation.
- MultiSleeveAllocation.
- SleeveAssignment.
- Exact weight-total validation.
- Canonical sleeve ordering.
- Semantic allocation equality and identity.

### Dependencies

LC-U01-01 through LC-U01-05.

### Constraints

- One single assignment or at least two sleeves.
- Unique sleeve and strategy-version references.
- No portfolio mutation behavior.

## LC-U01-07 Positions

### Responsibility

- Holding.
- HoldingLot.
- Quantity and scope invariants.
- Canonical lot and holding ordering.
- Private identifier index construction.
- Position integrity helpers.

### Dependencies

LC-U01-01 through LC-U01-04.

### Constraints

- All PortfolioId and InstrumentId values agree.
- No fill, corporate-action, tax, cost, or reconciliation algorithm.
- Mutable indexes are private and never exported.

## LC-U01-08 Domain Events and Codecs

### Responsibility

- DomainEvent envelope.
- PortfolioCreated.
- PortfolioArchived.
- PortfolioModeChanged.
- StrategyAllocationChanged.
- Event schema dispatch and canonical codecs.

### Dependencies

LC-U01-01 through LC-U01-06.

### Constraints

- Events depend on portfolio value types and allocation identities, never on the Portfolio aggregate class.
- No persistence or publication.
- Unknown schema or type fails closed.

This dependency direction avoids an Aggregate to Event to Aggregate cycle.

## LC-U01-09 Integrity Validation

### Responsibility

- Full aggregate validation.
- Targeted command-specific validators.
- Capacity guards.
- Resulting-state invariant checks.
- Test-only equivalence oracle between targeted and full validation.

### Dependencies

LC-U01-01 through LC-U01-08 except no port dependency.

### Constraints

- Production targeted validation never skips an invariant that the command can affect.
- Full validation remains the rehydration and recovery authority.

## LC-U01-10 Portfolio Aggregate

### Responsibility

- Portfolio creation.
- Archive transition.
- Operating-mode transition.
- Allocation-policy replacement.
- Copy-on-write state construction.
- State-version progression.
- Ordered event creation.
- Immutable snapshots.

### Dependencies

LC-U01-01 through LC-U01-09.

### Constraints

- No port call.
- No persistence, clock, randomness, environment, network, filesystem, or process state.
- No exposed mutable collection.

## LC-U01-11 Capability Ports

### Responsibility

Declare:

- PortfolioRepository;
- PortfolioUnitOfWork;
- ClockPort;
- IdentifierFactory;
- StrategyEvidencePort;
- InternalEventBus.

### Dependencies

LC-U01-02, LC-U01-03, LC-U01-08, and LC-U01-10 public types.

### Constraints

- Interfaces only.
- No implementation helper or infrastructure import.
- No port is callable from LC-U01-01 through LC-U01-10.

## LC-U01-12 Public Entry Point

### Responsibility

- Explicitly export approved exact values, identifiers, commands, aggregate views, results, events, failures, and ports.
- Hide internal validators, indexes, constructors, constants, and test helpers.
- Define the declaration-contract review surface.

### Dependencies

LC-U01-02 through LC-U01-11 approved exports.

### Constraints

- No wildcard re-export.
- No side effect during import.
- No environment or runtime initialization.

## LC-U01-13 Property Test Support

### Responsibility

- Shared `fast-check` arbitraries.
- Valid and intentionally invalid exact values.
- Portfolio, holding, lot, allocation, evidence, command, and event generators.
- Simplified state model and generated commands.
- Seed and path reproduction helpers.

### Dependencies

LC-U01-01 through LC-U01-10 and `fast-check`.

### Visibility

Test only. Never exported by LC-U01-12 or imported by production source.

## LC-U01-14 Benchmark Harness

### Responsibility

- Representative and boundary-size fixture generation.
- Warm-up and measurement.
- Percentile and heap reporting.
- Growth-curve checks.
- Non-zero threshold failure.

### Dependencies

LC-U01-01 through LC-U01-10 and Node standard APIs.

### Visibility

Development and CI only. Never imported by production source.

## Dependency Matrix

`D` means a direct allowed dependency. A dash means no direct dependency.

| Consumer | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 | 10 | 11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| LC-01 Constants | - | - | - | - | - | - | - | - | - | - | - |
| LC-02 Results | D | - | - | - | - | - | - | - | - | - | - |
| LC-03 Identity | D | D | - | - | - | - | - | - | - | - | - |
| LC-04 Exact Values | D | D | - | - | - | - | - | - | - | - | - |
| LC-05 Evidence | D | D | D | D | - | - | - | - | - | - | - |
| LC-06 Allocation | D | D | D | D | D | - | - | - | - | - | - |
| LC-07 Positions | D | D | D | D | - | - | - | - | - | - | - |
| LC-08 Events | D | D | D | D | D | D | - | - | - | - | - |
| LC-09 Integrity | D | D | D | D | D | D | D | D | - | - | - |
| LC-10 Aggregate | D | D | D | D | D | D | D | D | D | - | - |
| LC-11 Ports | - | D | D | - | - | - | - | D | - | D | - |

LC-U01-12 depends on approved exports from LC-U01-02 through LC-U01-11. LC-U01-13 and LC-U01-14 are test/verification leaves. No runtime component depends on LC-U01-12, LC-U01-13, or LC-U01-14.

## Proposed Source Placement

| Logical component | Proposed path |
|---|---|
| LC-U01-01 | `server/portfolio/domain/shared/constants.ts` |
| LC-U01-02 | `server/portfolio/domain/errors/result.ts`, `failure.ts`, `invariant-error.ts` |
| LC-U01-03 | `server/portfolio/domain/shared/identifiers.ts`, `time.ts`, `command-context.ts` |
| LC-U01-04 | `server/portfolio/domain/shared/money.ts`, `quantity.ts`, `weight.ts`, `scaled-rate.ts`, `state-version.ts` |
| LC-U01-05 | `server/portfolio/domain/portfolio/evidence.ts`, `server/portfolio/domain/errors/safe-context.ts` |
| LC-U01-06 | `server/portfolio/domain/portfolio/strategy-allocation.ts` |
| LC-U01-07 | `server/portfolio/domain/portfolio/holding.ts`, `holding-lot.ts`, `positions.ts` |
| LC-U01-08 | `server/portfolio/domain/events/` |
| LC-U01-09 | `server/portfolio/domain/portfolio/integrity.ts` |
| LC-U01-10 | `server/portfolio/domain/portfolio/portfolio.ts`, `commands.ts` |
| LC-U01-11 | `server/portfolio/ports/` |
| LC-U01-12 | `server/portfolio/index.ts` |
| LC-U01-13 | `tests/portfolio/support/arbitraries/`, `models/` |
| LC-U01-14 | `benchmark/portfolio-domain.ts` |

Final filenames may be refined during Code Generation planning, but component responsibilities and dependency direction cannot change without NFR Design review.

## Command Interaction

For every aggregate command:

1. LC-U01-10 receives an already typed command.
2. LC-U01-03 checks command context, identity, time, and expected version.
3. LC-U01-09 applies capacity and existing-state integrity guards.
4. LC-U01-04, LC-U01-05, LC-U01-06, or LC-U01-07 validate command-specific values.
5. LC-U01-10 applies lifecycle and transition rules.
6. LC-U01-09 validates affected entities and cross-cutting resulting invariants.
7. LC-U01-08 creates the schema-versioned event when state changed.
8. LC-U01-02 returns success, no-op, or typed failure.

No port participates in this interaction. An application service later uses LC-U01-11 before and after the pure aggregate call.

## Rehydration Interaction

1. U02 parses persistence fields into LC-U01-03 and LC-U01-04 values.
2. U02 constructs allocation and position records through LC-U01-06 and LC-U01-07 controlled constructors.
3. LC-U01-09 runs full integrity validation.
4. LC-U01-10 creates a rehydrated immutable Portfolio only after successful validation.
5. Invalid trusted state raises the dedicated invariant error and stops the operation.

U01 never silently repairs persisted state.

## Performance Design

- Capacity checks execute before copies or sorts.
- Canonical sort occurs only at construction or changed-collection replacement.
- Private indexes are built once per immutable component instance.
- Normal metadata transitions reuse unchanged frozen collections.
- Holding changes replace one holding and the outer holdings array.
- Lot changes replace one lot array, its holding, and the outer holdings array.
- Full integrity validation remains explicit rather than automatic for unaffected 10,000-lot state.
- Property tests prove targeted-success states pass full validation.

## Security Design

- Controlled constructors prevent arbitrary object fabrication through public APIs.
- Safe context builders prevent sensitive data propagation.
- Evidence values are opaque, closed, and portfolio bound.
- Public entry point omits internal constructors and indexes.
- All unexpected variants fail exhaustively.
- Zero U01 production dependencies reduce code-loading and supply-chain surface.
- No component handles credentials, sessions, SQL, HTTP, broker accounts, or raw authorization tokens.

## Test Architecture

### Example Layer

- One or more explicit tests for every mandatory business scenario.
- Stable failure-code tests grouped by rule family.
- Event shape and version tests.
- Public entry-point import and no-side-effect tests.

### Property Layer

- Exact-value round trips.
- Allocation permutation and total invariants.
- Holding/lot reconciliation.
- Failure atomicity.
- Portfolio isolation.
- Archive and no-op idempotency.
- Targeted/full validation equivalence.

### Stateful Model Layer

Generated commands:

- create model;
- archive;
- repeat archive;
- change non-execution mode;
- attempt guarded mode with valid or invalid evidence;
- replace single assignment;
- replace sleeves;
- issue stale-version or foreign-portfolio command.

After every command, compare status, mode, allocation identity, state version, event sequence, and failure code between real and model state.

## Traceability to NFR Patterns

| Logical components | Primary patterns |
|---|---|
| LC-U01-01, LC-U01-04 | PAT-U01-001, PAT-U01-010 |
| LC-U01-02 | PAT-U01-002, PAT-U01-007 |
| LC-U01-03, LC-U01-10 | PAT-U01-003 |
| LC-U01-05 | PAT-U01-006, PAT-U01-007 |
| LC-U01-06, LC-U01-07 | PAT-U01-004, PAT-U01-005 |
| LC-U01-08 | PAT-U01-007, PAT-U01-008 |
| LC-U01-09 | PAT-U01-005, PAT-U01-010 |
| LC-U01-11, LC-U01-12 | PAT-U01-009 |
| LC-U01-13 | PAT-U01-012 |
| LC-U01-14 | PAT-U01-011 |

Every pattern has at least one owning logical component, and every runtime component has an approved pattern.

## Infrastructure Components

None. U01 has no deployable or infrastructure component. The benchmark and property-test harnesses are development-time verification components only.

