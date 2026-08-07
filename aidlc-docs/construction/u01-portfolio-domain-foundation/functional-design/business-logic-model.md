# U01 Business Logic Model

## Design Objective

U01 defines deterministic portfolio behavior without persistence, transport, clocks, identifier generation, or external calls. Every accepted command produces a new immutable aggregate state and zero or more typed events. Every rejected command returns a typed safe error and leaves the prior state unchanged.

## Functional Boundary

### Inputs

- Validated branded identifiers supplied by the application layer.
- Validated effective timestamps supplied by a clock-owning caller.
- Actor, correlation, causation, and command identifiers.
- Exact financial values and explicit portfolio commands.
- Evidence tokens issued by later authorization and risk units for guarded mode transitions.

### Outputs

- `DomainResult<Transition<Portfolio>>`.
- A new immutable `Portfolio` only when state changes.
- Ordered typed domain events containing safe, non-secret context.
- Stable error codes for expected validation and transition failures.

### Excluded Behavior

- Active-name uniqueness checks, SQL constraints, transaction management, and idempotency storage.
- Strategy schema validation, strategy activation evidence evaluation, market data, scoring, construction, planning, execution, or reconciliation.
- Authentication, object authorization, HTTP errors, UI state, or broker credentials.
- Legacy intraday entry, exit, runner, VWAP, time-stop, or same-day policy.

## Exact-Value Model

| Concept | Representation | Valid range and rule |
|---|---|---|
| Money | Currency plus signed `bigint` minor units | Currency is INR in the initial release; portfolio cash and market value cannot be negative |
| Quantity | Non-negative `bigint` whole-share units | Fractional, negative, NaN, and infinite values are unrepresentable |
| Weight | Integer parts per million | 0 through 1,000,000 inclusive; 1,000,000 equals 100% |
| Rate | Signed or unsigned scaled integer with declared scale | Scale is part of the type; values with different scales cannot be combined implicitly |
| State version | Non-negative safe integer | Increments exactly once for each accepted state-changing command |
| Local date | Canonical `YYYY-MM-DD` value | Calendar validity is checked at construction |
| Instant | Canonical UTC instant | Parsing and canonicalization occur before domain use |

Arithmetic never converts accounting values to binary floating point. Operations either return an exact result or an explicit overflow, scale, currency, or range error.

## Command Envelope

Every state-changing command carries:

- command identifier;
- portfolio identifier when operating on an existing portfolio;
- expected portfolio state version;
- actor identifier;
- correlation and causation identifiers;
- effective instant;
- command-specific payload.

The aggregate verifies identifier consistency and expected version before applying business rules. The persistence unit later provides transaction-level duplicate-command protection.

## Portfolio Creation Flow

1. Accept a generated portfolio identifier, validated display name, INR starting cash, operating mode, and allocation policy.
2. Reject blank or over-length names, negative cash, unsupported currency, invalid mode, or invalid allocation.
3. Do not evaluate name uniqueness; U02 owns the authoritative uniqueness constraint.
4. Create an ACTIVE portfolio at state version 1 with empty holdings and lots.
5. Preserve the selected operating mode without implicitly enabling broker or live execution.
6. Return the new aggregate and one `PortfolioCreated` event.

The creation event contains identifiers, mode, exact starting cash, allocation-policy identity, actor, effective time, and correlation metadata. It contains no broker credentials, account identifiers, or free-form secrets.

## Portfolio Archive Flow

1. Verify the command portfolio identifier and expected state version.
2. If the portfolio is already ARCHIVED, return the same aggregate with no events.
3. If ACTIVE, set status to ARCHIVED and record the archive effective instant.
4. Increment state version exactly once.
5. Return one `PortfolioArchived` event with the prior and new status.

Archive is irreversible in U01. Historical holdings, lots, assignment references, and event lineage remain part of the state. Later application services reject new evaluations, plans, and orders for archived portfolios.

## Operating-Mode Transition Flow

### Modes

- OBSERVE
- PAPER
- RECOMMENDATION
- APPROVAL_REQUIRED
- RESTRICTED_AUTO
- LIVE

Mode describes the intended operating posture; it does not by itself authorize an order.

### Transition Rules

1. The portfolio must be ACTIVE.
2. Repeating the current mode is idempotent and emits no event.
3. A transition into OBSERVE, PAPER, or RECOMMENDATION requires an explicit request but no execution evidence.
4. A transition into APPROVAL_REQUIRED requires a valid execution-authorization evidence token.
5. A transition into RESTRICTED_AUTO requires execution authorization plus restricted-automation evidence.
6. A transition into LIVE requires explicit live-activation evidence. Full-auto authority is separate and remains denied unless later units prove every required gate.
7. Evidence tokens are opaque domain values carrying portfolio, target mode, issuer, issued time, expiry, and evidence hash. U01 validates their binding and temporal claims but does not create them.
8. A transition does not alter strategy allocation, historical events, holdings, cash, or execution gates.

An accepted change increments state version and emits `PortfolioModeChanged`. Invalid, expired, mismatched, or insufficient evidence fails closed.

## Strategy Allocation Model

The portfolio owns exactly one allocation policy:

### Single Strategy

- References one immutable strategy version.
- Has an effective instant and assignment identifier.
- Represents exactly 1,000,000 weight units.

### Multi-Sleeve Strategy

- Contains two or more sleeve assignments.
- Each sleeve has a unique sleeve identifier, immutable strategy-version reference, positive weight, and effective instant.
- Sleeve identifiers and strategy-version references cannot be duplicated within one policy.
- Sleeve weights sum exactly to 1,000,000.
- Ordering is canonical by sleeve identifier so equivalent policies compare and hash deterministically.

Allocation-policy replacement:

1. Requires an ACTIVE portfolio.
2. Validates the complete proposed policy before changing state.
3. Rejects an equivalent current policy as an idempotent no-op.
4. Preserves old assignment identifiers and strategy-version references in historical decisions; it does not rewrite prior snapshots.
5. Increments state version and emits `StrategyAllocationChanged` with prior and new policy identities.

Strategy eligibility and activation are supplied as opaque evidence by U03. U01 validates evidence binding but does not decide research sufficiency.

## Holdings and Lots Foundation

U01 defines immutable state shapes and invariants used by later accounting and execution units:

- A holding is uniquely keyed by portfolio and instrument.
- Holding quantity is the exact sum of open lot quantities.
- A lot belongs to exactly one portfolio and instrument.
- Quantity, available delivery quantity, and reserved quantity are non-negative.
- Reserved quantity cannot exceed total quantity.
- Cash and positions cannot become negative through an accepted transition.
- Cross-portfolio identifiers in a holding, lot, or mutation command are rejected.

U01 does not yet define fill application, cost-basis allocation, corporate actions, or reconciliation algorithms; those behaviors belong to later units and must preserve these invariants.

## Typed Result and Transition Model

### Success

A successful state-changing command returns:

- the resulting immutable aggregate;
- ordered domain events;
- prior and resulting state versions;
- whether the operation changed state.

### Expected Failure

Expected business failures return `DomainFailure` with:

- stable code;
- safe human-independent context fields;
- portfolio and command identifiers when safe;
- no stack, SQL, filesystem path, token, credential, or internal implementation detail.

Expected failures do not throw and do not return a partially changed aggregate.

### Invariant Corruption

Construction from trusted persisted state validates all invariants. An impossible corrupted-state condition is treated as a programmer or data-integrity defect and may raise a dedicated invariant exception for the application boundary to halt, log safely, and fail closed.

## Event Model

Every domain event contains:

- event identifier supplied by the caller;
- event type and schema version;
- portfolio identifier;
- aggregate state version;
- occurred-at instant;
- actor, correlation, causation, and command identifiers;
- typed event payload.

Initial U01 events:

- `PortfolioCreated`;
- `PortfolioArchived`;
- `PortfolioModeChanged`;
- `StrategyAllocationChanged`.

Events are facts and are immutable after creation. U02 persists them atomically with state. Publication occurs only after commit.

## Downstream Data Flow

| Consumer | U01 contract supplied |
|---|---|
| U02 Persistence | Aggregate snapshots, repository ports, exact-value codecs, events, state versions |
| U03 Strategy and Data | Strategy-version references, assignment evidence contracts, effective-time values |
| U04 Construction | Portfolio cash, holdings, lots, allocation policy, exact weights |
| U05 Execution | Portfolio status and mode, quantities, state versions, identifiers, failure codes |
| U06 Operations | Event envelopes, safe reason codes, aggregate health and integrity outcomes |
| U07 API | Command and result types safe for application translation |
| U08 React | No direct dependency; receives API view types later |
| U09 Verification | Generators, state models, invariants, and deterministic transition contracts |

## Primary Story Coverage

| Story | Functional-design coverage |
|---|---|
| US-002 | Exact creation, isolated PortfolioId ownership, non-negative cash, immutable state, and unique-name port contract |
| US-004 | Irreversible ACTIVE-to-ARCHIVED transition, idempotent repeated archive, retained history, and no liquidation side effect |
| US-005 | Complete future-effective allocation-policy replacement with immutable strategy-version and historical references |
| US-009 | Canonical multi-sleeve policy with distinct assignments, exact 100% weights, and aggregate-level safety invariants |

## Testable Properties

| Component | Property category | Property |
|---|---|---|
| Exact values | Round-trip | Canonical serialize then parse returns an equivalent value |
| Exact values | Invariant | Valid arithmetic preserves currency and declared scale |
| Portfolio creation | Invariant | Accepted creation has non-negative cash, empty holdings, ACTIVE status, and version 1 |
| Portfolio archive | Idempotence | Archiving an archived portfolio returns equivalent state and no additional event |
| Aggregate transition | Invariant | Rejected commands preserve the original aggregate exactly |
| Aggregate transition | Invariant | Every accepted state change increments version by exactly one |
| Allocation policy | Invariant | Single or sleeve weights total exactly 1,000,000 |
| Sleeve canonicalization | Idempotence | Canonicalizing an already canonical sleeve policy does not change it |
| Sleeve canonicalization | Commutativity | Input sleeve ordering does not change the canonical policy |
| Portfolio aggregate | Stateful model | Random valid and invalid command sequences match a simplified reference model after every command |
| Event codec | Round-trip | Event serialization and parsing preserve schema version and typed payload |
| Portfolio isolation | Invariant | A command containing a foreign portfolio identifier never changes state |

These properties complement explicit examples for creation, archive, mode evidence, assignment replacement, invalid weights, stale versions, and corrupted state.
