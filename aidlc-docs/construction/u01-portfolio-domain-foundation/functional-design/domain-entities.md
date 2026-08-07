# U01 Domain Entities

## Aggregate Boundary

`Portfolio` is the U01 aggregate root. All contained values, holdings, lots, status, mode, and allocation-policy references share one immutable `PortfolioId` and one optimistic state version. No contained object is loaded, saved, or mutated independently through the U01 public model.

## Aggregate Relationship Model

- One Portfolio has exactly one CashBalance.
- One Portfolio has exactly one PortfolioStatus and one OperatingMode.
- One Portfolio has exactly one StrategyAllocationPolicy.
- One Portfolio has zero or more Holdings.
- One Holding has zero or more open HoldingLots.
- One StrategyAllocationPolicy is either one SingleStrategyAssignment or one MultiSleeveAssignment.
- One MultiSleeveAssignment has two or more SleeveAssignments.
- One accepted portfolio transition has zero or more ordered DomainEvents.
- All child entities and events carry the same PortfolioId as the aggregate.

## Portfolio Aggregate

### Identity and State

| Field | Type | Rule |
|---|---|---|
| `portfolioId` | PortfolioId | Immutable and globally unique |
| `displayName` | PortfolioName | Immutable value replacement; active-name uniqueness enforced by U02 |
| `baseCurrency` | CurrencyCode | INR in the initial release |
| `status` | PortfolioStatus | ACTIVE or ARCHIVED |
| `operatingMode` | OperatingMode | Explicit supported mode |
| `cash` | Money | Non-negative and same as base currency |
| `allocationPolicy` | StrategyAllocationPolicy | Exactly one valid policy |
| `holdings` | Canonical immutable map by InstrumentId | Every value belongs to this portfolio |
| `createdAt` | Instant | Immutable |
| `archivedAt` | Instant or absent | Present only when ARCHIVED |
| `stateVersion` | PortfolioStateVersion | Starts at 1 and advances exactly once per accepted change |

### Public Behaviors

- `create`: construct a valid new aggregate and `PortfolioCreated`.
- `archive`: transition ACTIVE to ARCHIVED or return an idempotent no-op.
- `changeMode`: apply an evidence-bound operating-mode transition.
- `replaceAllocationPolicy`: replace the complete strategy allocation for future decisions.
- `validateIntegrity`: verify all aggregate and child invariants.
- `snapshot`: produce an immutable domain snapshot suitable for persistence mapping.

No public behavior exposes a mutable map or array.

## Exact Value Objects

### Money

- Fields: currency and `bigint` minor units.
- Equality includes both currency and amount.
- Addition and subtraction require equal currency.
- Portfolio cash constructors reject negative amounts.
- Canonical serialization uses the currency code and base-10 integer string.

### Quantity

- Non-negative whole-share `bigint`.
- Supports exact add, subtract with underflow rejection, and comparison.
- Canonical serialization is a base-10 integer string.

### Weight

- Integer parts per million from 0 to 1,000,000.
- Provides exact sum and complement operations.
- Does not parse or format through binary floating point.

### ScaledRate

- Contains an integer numerator and a declared positive scale.
- Equality requires equivalent normalized value and scale policy.
- Cross-scale conversion is explicit and reports non-exact rounding requirements.

### PortfolioStateVersion

- Non-negative safe integer.
- Existing persisted aggregate versions are at least 1.
- `next` rejects overflow.

### Instant and LocalDate

- `Instant` is a canonical UTC timestamp.
- `LocalDate` is a valid canonical Gregorian date.
- Market-session and timezone calculations are outside U01; U01 preserves the validated value.

## Branded Identifiers

U01 defines non-interchangeable identifiers:

- PortfolioId
- HoldingId
- HoldingLotId
- InstrumentId
- StrategyId
- StrategyVersionId
- StrategyAssignmentId
- StrategySleeveId
- RebalanceRunId
- OrderId
- ActorId
- CommandId
- EventId
- CorrelationId
- CausationId
- IdempotencyKey
- EvidenceId

Each identifier has canonical parsing, bounded length, structural validation, equality, ordering where needed for canonicalization, and safe redacted rendering. A PortfolioId cannot be passed where another branded identifier is required.

## PortfolioName

- Trimmed Unicode text from 1 through 120 characters.
- Rejects control characters and unpaired surrogate data.
- Preserves display capitalization.
- Exposes a normalized uniqueness key for U02 using the approved case-folding and whitespace policy.
- Never embeds HTML interpretation; UI escaping remains the adapter's responsibility.

## PortfolioStatus

| Current | Command | Result |
|---|---|---|
| ACTIVE | Archive | ARCHIVED |
| ARCHIVED | Archive | ARCHIVED no-op |
| ARCHIVED | Reactivate | Rejected; transition does not exist |

The status model is closed to unknown values.

## OperatingMode

| Mode | Intended posture | Domain authority |
|---|---|---|
| OBSERVE | Read-only observation | No order authority |
| PAPER | Paper decisions and execution | Paper only |
| RECOMMENDATION | Plans and recommendations | No broker submission |
| APPROVAL_REQUIRED | Human-approved eligible live orders | Requires evidence; still subject to all later gates |
| RESTRICTED_AUTO | Bounded eligible automation | Requires stronger evidence; exceptions still require approval |
| LIVE | Explicit live-capable posture | Requires live evidence; not equivalent to full-auto |

OperatingMode is an intent classification. U05 remains authoritative for actual order submission.

## ModeTransitionEvidence

An opaque immutable value supplied by a later authorization/risk service:

| Field | Rule |
|---|---|
| evidenceId | Valid EvidenceId |
| portfolioId | Must match the aggregate |
| targetMode | Must match the requested mode |
| evidenceKind | Execution authorization, restricted automation, or live activation |
| issuerId | Approved issuer identity represented as ActorId |
| issuedAt | Cannot be after effective command time |
| expiresAt | Must be after command effective time |
| evidenceHash | Valid canonical integrity hash |

U01 verifies binding and timing only. It does not authenticate the issuer or decide whether external evidence is sufficient.

## StrategyAllocationPolicy

The allocation policy is a discriminated union.

### SingleStrategyAllocation

| Field | Rule |
|---|---|
| assignmentId | Unique immutable assignment identity |
| strategyVersionId | Immutable referenced strategy version |
| weight | Exactly 1,000,000 |
| effectiveAt | Valid instant |
| evidenceReference | Eligibility and activation evidence reference |

### MultiSleeveAllocation

| Field | Rule |
|---|---|
| allocationId | Unique immutable policy identity |
| sleeves | Canonical immutable collection with at least two entries |
| effectiveAt | Valid instant |

### SleeveAssignment

| Field | Rule |
|---|---|
| sleeveId | Unique within the policy |
| assignmentId | Unique immutable assignment identity |
| strategyVersionId | Unique within the policy |
| weight | Greater than zero |
| effectiveAt | Not later than policy effective time |
| evidenceReference | Binds strategy eligibility and activation evidence |

All sleeve weights total exactly 1,000,000. Semantic equality ignores input ordering because canonical ordering uses SleeveId.

## Holding

| Field | Rule |
|---|---|
| holdingId | Immutable and unique |
| portfolioId | Equals aggregate PortfolioId |
| instrumentId | Unique within portfolio holdings |
| totalQuantity | Non-negative and equals sum of open lots |
| availableDeliveryQuantity | Non-negative and no greater than total |
| reservedQuantity | Non-negative and no greater than total |
| lots | Canonical immutable map by HoldingLotId |
| stateVersion | Advances when holding state changes in later units |

U01 defines integrity, equality, and snapshot behavior. Fill, reconciliation, and corporate-action transitions are added by their owning units without weakening these rules.

## HoldingLot

| Field | Rule |
|---|---|
| lotId | Immutable and unique within portfolio |
| portfolioId | Equals aggregate and holding PortfolioId |
| instrumentId | Equals holding InstrumentId |
| acquiredOn | Valid LocalDate |
| originalQuantity | Positive whole-share Quantity |
| openQuantity | From zero through original quantity |
| unitCost | Non-negative INR Money per share represented exactly |
| sourceReference | Typed reference to an import, fill, or corporate action |

Closed lots remain historical records in persistence but may be omitted from the aggregate's open-lot collection depending on the approved U02 mapping.

## Command Context

| Field | Purpose |
|---|---|
| commandId | Stable command identity |
| actorId | Attribution |
| correlationId | End-to-end request trace |
| causationId | Prior command or event identity |
| effectiveAt | Business-effective instant |
| expectedStateVersion | Optimistic conflict guard |

Command context is validated before command-specific payloads to ensure deterministic failure precedence.

## Transition

`Transition<T>` contains:

- prior state version;
- resulting state;
- resulting state version;
- immutable ordered events;
- `changed` indicator.

For no-ops, prior and resulting state are equivalent, versions match, events are empty, and `changed` is false.

## Domain Events

### Common Envelope

- EventId
- event type
- event schema version
- PortfolioId
- resulting PortfolioStateVersion
- occurred-at Instant
- ActorId
- CommandId
- CorrelationId
- CausationId

### PortfolioCreated

Payload includes display name, base currency, exact starting cash, status, operating mode, and allocation-policy identity.

### PortfolioArchived

Payload includes prior status, ARCHIVED status, and archive effective instant.

### PortfolioModeChanged

Payload includes prior mode, target mode, and evidence identity where required.

### StrategyAllocationChanged

Payload includes prior and resulting allocation-policy identities and effective instant. Full historical strategy content is referenced, not duplicated or mutated.

## Domain Results and Failures

### DomainResult

A closed success-or-failure type:

- Success contains a value.
- Failure contains one DomainFailure.
- Success and failure cannot coexist.

### DomainFailure

| Field | Rule |
|---|---|
| code | Stable closed code from the owning domain area |
| field | Optional safe logical field name |
| context | Bounded allowlisted scalar values only |
| retryability | NEVER, AFTER_STATE_REFRESH, or AFTER_CORRECTION |

Failures exclude stack traces, paths, SQL, raw payloads, credentials, account identifiers, and arbitrary exception messages.

### DomainInvariantError

A dedicated exceptional type for programmer defects or invalid trusted-state rehydration. It is not returned for expected user or business-rule failures.

## Port Contracts Declared by U01

These contracts are consumed by application units; the aggregate does not call them.

### PortfolioRepository

- Insert a new aggregate.
- Get an aggregate by PortfolioId.
- Save an aggregate using expected state version.
- Query active-name uniqueness through a normalized name key.

### PortfolioUnitOfWork

- Execute a synchronous domain transaction over repository capabilities.
- Return committed results and post-commit events separately.

### ClockPort

- Supply the current Instant and business LocalDate to application commands.

### IdentifierFactory

- Supply typed identifiers without exposing generation mechanics.

### StrategyEvidencePort

- Resolve immutable strategy-version eligibility and activation evidence before aggregate commands are invoked.

### InternalEventBus

- Publish already committed domain events.
- Subscribe typed idempotent handlers.

Concrete implementations belong to later units.

## Equality and Canonicalization

- Value-object equality is structural and scale-aware.
- Aggregate equality for tests compares all domain fields and versions, excluding no runtime-only identity.
- Maps and sleeve lists use canonical identifier ordering.
- Canonical serialization has explicit schema versions and represents all integer values as base-10 strings.
- Unknown fields may be retained only by version-aware persistence mapping; domain parsing rejects unsupported semantic versions.

## Testable Properties by Component

| Component | Applicable categories | Properties |
|---|---|---|
| Money, Quantity, Weight, ScaledRate | Round-trip, invariant, easy verification | Parse/format identity; bounds and exact arithmetic always hold |
| Branded identifiers | Round-trip, invariant | Valid identifiers round-trip and never cross accepted brands at typed boundaries |
| PortfolioName | Idempotence, round-trip | Normalization is idempotent and canonical representation round-trips |
| Portfolio aggregate | Invariant, stateful model | Cash and positions remain non-negative; random commands match a reference model |
| PortfolioStatus | Idempotence, stateful model | Archive is irreversible and repeating archive is a no-op |
| OperatingMode | Stateful model | Evidence requirements hold after every generated transition sequence |
| StrategyAllocationPolicy | Invariant, commutativity, idempotence | Weights total 100%; input ordering is irrelevant; canonicalization is idempotent |
| Holding and HoldingLot | Invariant, easy verification | Lot sums reconcile to holdings and all identifiers remain portfolio-scoped |
| Domain events | Round-trip, invariant | Versioned event codecs preserve payload and match resulting aggregate version |
| DomainResult | Invariant | Exactly one success or failure branch exists; failures never include state or events |

PBT uses domain-specific generators constrained to valid and intentionally invalid boundary cases. Every critical transition also receives explicit example tests.

