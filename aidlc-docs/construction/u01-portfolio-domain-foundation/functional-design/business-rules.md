# U01 Business Rules

## Rule Evaluation Principles

1. Validate command shape and exact values before evaluating transitions.
2. Verify aggregate identity and expected state version before business mutation.
3. Evaluate lifecycle eligibility before mode or allocation-policy rules.
4. Validate the complete proposed state before emitting any event.
5. Reject expected failures through `DomainResult`; do not partially apply a command.
6. Treat every unrecognized enum, event version, evidence type, or state as invalid and fail closed.

## Exact Value Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-001 | Money carries an explicit currency and exact `bigint` minor-unit amount. | `INVALID_MONEY` |
| BR-U01-002 | Portfolio accounting currency is INR for the initial release. | `UNSUPPORTED_CURRENCY` |
| BR-U01-003 | Starting cash, current cash, market values, and available cash cannot be negative. | `NEGATIVE_CASH` |
| BR-U01-004 | Equity quantity is a non-negative whole-share `bigint`. | `INVALID_QUANTITY` |
| BR-U01-005 | Reserved quantity cannot exceed total quantity. | `RESERVED_QUANTITY_EXCEEDED` |
| BR-U01-006 | Weight is an integer from 0 through 1,000,000 parts per million. | `INVALID_WEIGHT` |
| BR-U01-007 | Values with different currency or scale cannot be combined without an explicit conversion. | `VALUE_SCALE_MISMATCH` |
| BR-U01-008 | Arithmetic overflow or division with a non-exact unsupported result returns an explicit failure. | `EXACT_ARITHMETIC_FAILURE` |

## Identifier and Time Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-010 | Every identifier must be non-empty, canonical, length-bounded, and of the expected branded type. | `INVALID_IDENTIFIER` |
| BR-U01-011 | A command portfolio identifier must equal the aggregate portfolio identifier. | `PORTFOLIO_SCOPE_MISMATCH` |
| BR-U01-012 | Actor, command, correlation, and causation identifiers are mandatory for state-changing commands. | `MISSING_COMMAND_CONTEXT` |
| BR-U01-013 | Effective instants must be canonical UTC values and cannot precede aggregate creation. | `INVALID_EFFECTIVE_TIME` |
| BR-U01-014 | Local dates must be real Gregorian dates in canonical `YYYY-MM-DD` form. | `INVALID_LOCAL_DATE` |
| BR-U01-015 | U01 never reads a system clock or generates an identifier; callers supply both. | `CAPABILITY_BOUNDARY_VIOLATION` |

## Portfolio Creation Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-020 | A portfolio starts with status ACTIVE and state version 1. | `INVALID_INITIAL_STATE` |
| BR-U01-021 | Display name is trimmed, non-empty, contains no control characters, and is at most 120 characters. | `INVALID_PORTFOLIO_NAME` |
| BR-U01-022 | Name uniqueness is not guessed in U01; the persistence/application boundary must enforce it atomically. | `NAME_UNIQUENESS_NOT_VERIFIED` |
| BR-U01-023 | Starting cash must be valid non-negative INR money. | `INVALID_STARTING_CASH` |
| BR-U01-024 | A new portfolio has empty holdings and lots. | `INVALID_INITIAL_HOLDINGS` |
| BR-U01-025 | A new portfolio must have one valid operating mode and one valid allocation policy. | `INVALID_INITIAL_CONFIGURATION` |
| BR-U01-026 | Creation emits exactly one `PortfolioCreated` event at aggregate version 1. | `INVALID_CREATION_EVENT` |

U02 enforces active-name uniqueness and creation atomicity. A failed uniqueness check results in no persisted aggregate or event.

## Portfolio Lifecycle Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-030 | Supported statuses are ACTIVE and ARCHIVED. | `INVALID_PORTFOLIO_STATUS` |
| BR-U01-031 | ACTIVE may transition to ARCHIVED. | `INVALID_STATUS_TRANSITION` |
| BR-U01-032 | ARCHIVED cannot transition back to ACTIVE. | `ARCHIVE_IS_IRREVERSIBLE` |
| BR-U01-033 | Archiving an ARCHIVED portfolio is an idempotent no-op with no new event. | N/A |
| BR-U01-034 | Archiving preserves cash, holdings, lots, allocations, and historical references. | `ARCHIVE_HISTORY_MUTATION` |
| BR-U01-035 | ARCHIVED portfolios reject mode and allocation-policy changes. | `PORTFOLIO_ARCHIVED` |
| BR-U01-036 | Archive never causes liquidation, cancellation, deletion, or broker interaction. | `ARCHIVE_SIDE_EFFECT_FORBIDDEN` |

## State Version Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-040 | A command expected version must equal the aggregate version. | `PORTFOLIO_VERSION_CONFLICT` |
| BR-U01-041 | Each accepted state-changing command increments version exactly once. | `INVALID_VERSION_INCREMENT` |
| BR-U01-042 | Rejected commands and idempotent no-ops do not increment version. | `UNEXPECTED_VERSION_CHANGE` |
| BR-U01-043 | Every emitted event carries the resulting aggregate version. | `EVENT_VERSION_MISMATCH` |

## Operating Mode Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-050 | Supported modes are OBSERVE, PAPER, RECOMMENDATION, APPROVAL_REQUIRED, RESTRICTED_AUTO, and LIVE. | `INVALID_OPERATING_MODE` |
| BR-U01-051 | Mode changes require an ACTIVE portfolio and explicit typed command. | `MODE_CHANGE_NOT_ALLOWED` |
| BR-U01-052 | Repeating the current mode is an idempotent no-op. | N/A |
| BR-U01-053 | OBSERVE, PAPER, and RECOMMENDATION require no execution evidence but grant no order authority. | `MODE_AUTHORITY_MISMATCH` |
| BR-U01-054 | APPROVAL_REQUIRED requires execution-authorization evidence bound to this portfolio and target mode. | `EXECUTION_EVIDENCE_REQUIRED` |
| BR-U01-055 | RESTRICTED_AUTO requires execution authorization and restricted-automation evidence. | `AUTOMATION_EVIDENCE_REQUIRED` |
| BR-U01-056 | LIVE requires explicit unexpired live-activation evidence. | `LIVE_EVIDENCE_REQUIRED` |
| BR-U01-057 | Evidence issuer, portfolio, target mode, issue time, expiry, and hash must validate. | `INVALID_MODE_EVIDENCE` |
| BR-U01-058 | Mode alone never bypasses environment, application, strategy, approval, risk, session, freshness, or reconciliation gates. | `EXECUTION_GATE_BYPASS` |
| BR-U01-059 | Full-auto authority remains false unless later units supply separate explicit evidence satisfying approved activation criteria. | `FULL_AUTO_NOT_AUTHORIZED` |

## Strategy Allocation Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-060 | A portfolio has exactly one allocation policy: SINGLE or SLEEVES. | `INVALID_ALLOCATION_POLICY` |
| BR-U01-061 | SINGLE references one immutable strategy version at exactly 1,000,000 weight units. | `INVALID_SINGLE_ASSIGNMENT` |
| BR-U01-062 | SLEEVES contains at least two assignments. | `INSUFFICIENT_SLEEVES` |
| BR-U01-063 | Every sleeve weight is greater than zero and total sleeve weight equals exactly 1,000,000. | `INVALID_SLEEVE_WEIGHT_TOTAL` |
| BR-U01-064 | Sleeve identifiers are unique within a policy. | `DUPLICATE_SLEEVE_ID` |
| BR-U01-065 | Strategy-version references are unique within a sleeve policy unless a later approved design introduces explicit sub-sleeve semantics. | `DUPLICATE_STRATEGY_SLEEVE` |
| BR-U01-066 | Sleeve ordering is canonical by sleeve identifier and cannot alter semantic equality. | `NON_CANONICAL_SLEEVE_ORDER` |
| BR-U01-067 | Assignment replacement requires valid eligibility evidence for every referenced strategy version. | `STRATEGY_EVIDENCE_REQUIRED` |
| BR-U01-068 | Equivalent assignment replacement is an idempotent no-op. | N/A |
| BR-U01-069 | Replacement affects future decisions only and never rewrites historical strategy references. | `STRATEGY_LINEAGE_MUTATION` |
| BR-U01-070 | An accepted replacement emits one event containing prior and new allocation-policy identities. | `INVALID_ALLOCATION_EVENT` |

## Holdings and Lot Foundation Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-080 | A holding belongs to exactly one portfolio and one instrument. | `INVALID_HOLDING_SCOPE` |
| BR-U01-081 | A lot belongs to the same portfolio and instrument as its holding. | `INVALID_LOT_SCOPE` |
| BR-U01-082 | Holding quantity equals the exact sum of open lot quantities. | `HOLDING_LOT_MISMATCH` |
| BR-U01-083 | Duplicate holding or lot identifiers are invalid. | `DUPLICATE_POSITION_ID` |
| BR-U01-084 | No accepted state may contain a short position or negative lot quantity. | `SHORT_POSITION_FORBIDDEN` |
| BR-U01-085 | No accepted state may represent leverage or margin-funded quantity. | `LEVERAGE_FORBIDDEN` |
| BR-U01-086 | Commands cannot move a holding, lot, cash balance, or assignment between portfolio identifiers. | `CROSS_PORTFOLIO_MUTATION` |

## Domain Event Rules

| Rule | Requirement | Failure code |
|---|---|---|
| BR-U01-090 | Events are typed, schema-versioned, immutable facts. | `INVALID_DOMAIN_EVENT` |
| BR-U01-091 | Every state-changing command emits the documented event count and order. | `EVENT_CARDINALITY_MISMATCH` |
| BR-U01-092 | Idempotent no-ops emit no new event. | `UNEXPECTED_NOOP_EVENT` |
| BR-U01-093 | Event portfolio and version equal resulting aggregate portfolio and version. | `EVENT_AGGREGATE_MISMATCH` |
| BR-U01-094 | Event context excludes credentials, tokens, broker account identifiers, arbitrary payloads, and unsafe free text. | `SENSITIVE_EVENT_CONTEXT` |
| BR-U01-095 | U01 never publishes or persists events; U02 commits them and a later application boundary publishes only after commit. | `EVENT_BOUNDARY_VIOLATION` |

## Error Rules

| Rule | Requirement |
|---|---|
| BR-U01-100 | Expected validation, conflict, evidence, and transition failures return `DomainResult.failure`. |
| BR-U01-101 | A failure has one stable code, safe field-level context, and no partial next state or events. |
| BR-U01-102 | Failure messages are not the API contract; adapters map stable codes to localized or user-facing text. |
| BR-U01-103 | Unknown values and unsupported schema versions fail closed. |
| BR-U01-104 | Programmer defects or trusted-state invariant corruption use a dedicated invariant exception and halt the operation. |
| BR-U01-105 | Catching boundaries must not turn failures into success-shaped defaults. |

## Rule Precedence

When more than one rule could fail, return the first applicable category in this order:

1. Command envelope and identifier validity.
2. Aggregate identity and expected version.
3. Existing aggregate invariant integrity.
4. Portfolio lifecycle eligibility.
5. Exact-value validity.
6. Evidence and authorization claims represented in domain inputs.
7. Command-specific transition rules.
8. Resulting-state invariants.
9. Event consistency.

The precedence makes failures deterministic without exposing deeper state to unauthorized or malformed requests.

## Mandatory Example Scenarios

- Create an INR PAPER portfolio with positive cash and a single strategy.
- Reject creation with negative cash, blank name, unsupported currency, or invalid assignment.
- Archive an ACTIVE portfolio and repeat archive without version or event changes.
- Reject mode or strategy changes on an archived portfolio.
- Reject stale expected versions.
- Permit non-execution mode changes without evidence while preserving all independent live gates.
- Reject execution-capable modes with missing, expired, foreign, or insufficient evidence.
- Replace a single strategy for future decisions without mutating historical references.
- Accept canonical sleeves totaling 100% and reject zero, duplicate, or non-total weights.
- Reject cross-portfolio holdings, lots, assignments, and commands.
- Rehydrate trusted state only when all invariants hold.

## Testable Property Coverage

| Rules | Property category | Required property |
|---|---|---|
| BR-U01-001 through BR-U01-008 | Round-trip and invariant | Exact values round-trip and valid arithmetic preserves currency, scale, and bounds |
| BR-U01-030 through BR-U01-036 | Idempotence and stateful model | Archive is idempotent and irreversible across generated command sequences |
| BR-U01-040 through BR-U01-043 | Invariant | Version changes exactly once on accepted mutation and never otherwise |
| BR-U01-050 through BR-U01-059 | Stateful model | Mode transitions never gain authority without required evidence |
| BR-U01-060 through BR-U01-070 | Invariant, commutativity, idempotence | Allocation total, canonical ordering, and equivalent replacement properties hold |
| BR-U01-080 through BR-U01-086 | Invariant | Quantities reconcile and portfolio scope never crosses identifiers |
| BR-U01-090 through BR-U01-095 | Round-trip and invariant | Event codecs preserve typed facts and event state matches aggregate state |
| BR-U01-100 through BR-U01-105 | Invariant | Every expected failure leaves state unchanged and returns no event |

## Extension Compliance

### Security Baseline

| Rule | Status | U01 rationale |
|---|---|---|
| SECURITY-01 | N/A | U01 has no data store or transport; encryption is owned by U02 and U06 |
| SECURITY-02 | N/A | No network intermediary exists in U01 or the approved local topology |
| SECURITY-03 | N/A | U01 is a pure library with no deployed entry point or logging sink |
| SECURITY-04 | N/A | U01 serves no HTML |
| SECURITY-05 | N/A at API layer | U01 still validates every domain value; HTTP schema and payload validation belong to U07 |
| SECURITY-06 | N/A | U01 declares no IAM policy |
| SECURITY-07 | N/A | U01 declares no network configuration |
| SECURITY-08 | N/A at endpoint layer | U01 enforces portfolio identity and evidence binding; endpoint authorization belongs to U07 |
| SECURITY-09 | N/A | U01 has no deployed runtime configuration |
| SECURITY-10 | N/A | U01 introduces no external dependency or pipeline change during Functional Design |
| SECURITY-11 | Compliant | Security-sensitive evidence and state rules are isolated, fail closed, and consider mode-abuse scenarios |
| SECURITY-12 | N/A | U01 handles no authentication, sessions, passwords, or credentials |
| SECURITY-13 | Compliant | Exact values, immutable allocation references, state versions, and typed audit events preserve data integrity |
| SECURITY-14 | N/A | U01 emits typed facts but owns no monitoring, alerting, or log retention |
| SECURITY-15 | Compliant | Typed expected failures preserve prior state; unknown values and invariant corruption halt safely |

No blocking U01 Functional Design security findings remain.

### Resiliency Baseline

| Rules | Status | U01 rationale |
|---|---|---|
| RESILIENCY-01 | Compliant | U01 is Critical, and all upstream requirements plus downstream U02 through U09 dependencies are documented |
| RESILIENCY-02 | N/A to U01 | U01 is stateless pure logic; approved project RTO and RPO apply to persistence and operations |
| RESILIENCY-03 | N/A | U01 does not own the approved project change-management process |
| RESILIENCY-04 | N/A | U01 has no deployment or rollback mechanism |
| RESILIENCY-05 | N/A | U01 is not a deployed workload and owns no monitoring sink |
| RESILIENCY-06 | N/A | U01 is not a service and exposes no health endpoint |
| RESILIENCY-07 | N/A | U01 has no deployed resiliency or capacity resource |
| RESILIENCY-08 | N/A | The approved topology is a local workstation and U01 has no compute resource |
| RESILIENCY-09 | N/A | The approved topology has no cloud auto-scaling and U01 has no runtime capacity |
| RESILIENCY-10 | N/A | U01 performs no database, network, cache, filesystem, or external call |
| RESILIENCY-11 | N/A | U01 owns no persistent production workload or DR strategy |
| RESILIENCY-12 | N/A | U01 owns no persistent data or backup |
| RESILIENCY-13 | N/A | U01 owns no failover or recovery procedure |
| RESILIENCY-14 | N/A to U01 | The required resiliency-testing decision is assigned to U06 NFR Design |
| RESILIENCY-15 | N/A | U01 has no operational incident process; typed events provide later evidence |

No blocking U01 Functional Design resiliency findings remain.

### Property-Based Testing

| Rule | Status | U01 rationale |
|---|---|---|
| PBT-01 | Compliant | Every U01 component is evaluated for round-trip, invariant, idempotence, commutativity, easy-verification, or state-model properties |
| PBT-02 | N/A at Functional Design | Round-trip targets are identified for Code Generation |
| PBT-03 | N/A at Functional Design | Invariant targets are identified for Code Generation |
| PBT-04 | N/A at Functional Design | Idempotency targets are identified for Code Generation |
| PBT-05 | N/A at Functional Design | Model and oracle targets are identified for Code Generation |
| PBT-06 | N/A at Functional Design | Stateful portfolio command testing is identified for Code Generation |
| PBT-07 | N/A at Functional Design | Domain-generator requirements are identified for Code Generation |
| PBT-08 | N/A at Functional Design | Shrinking and reproducibility are enforced during Code Generation and Build and Test |
| PBT-09 | N/A at Functional Design | `fast-check` is already selected and is enforced during NFR Requirements |
| PBT-10 | N/A at Functional Design | Complementary example scenarios are identified for Code Generation |

PBT-01 has no blocking finding. Downstream PBT rules are allocated rather than treated as prematurely satisfied.
