# U05 Execution and Reconciliation Domain Entities

## Aggregate Boundaries

U05 owns four immutable-history aggregates:

1. `ApprovalDecision` owns exact consent for one U04 plan.
2. `ExecutionRun` owns one consumed approval and its canonical orders.
3. `ReconciliationRun` owns one immutable comparison of local and broker/paper state.
4. `KillSwitch` owns one global or portfolio containment state and immutable transition history.

Financial cash, holdings, and lots remain in the U01 `Portfolio` aggregate and are persisted only through U02's synchronous transaction boundary. U05 does not create a second portfolio balance.

## Relationship Model

- One U04 `RebalancePlan` has zero or more historical approval decisions, but at most one current approved/partially-approved decision.
- One approval decision binds one exact plan hash and an immutable set of proposed logical-order keys.
- One consumed approval creates exactly one execution run.
- One execution run has zero or more execution orders in canonical sell-before-buy sequence.
- One execution order has one immutable intent, one or more bounded submission attempts, zero or one broker order reference, zero or more fills, zero or more cancellation attempts, and zero or one residual-work fact.
- One unique fill changes portfolio accounting at most once.
- One reconciliation run compares one local snapshot and one external/paper snapshot and has zero or more differences.
- One execution run links pre-execution, after-sell, after-buy, partial-fill, cancellation, end-window, or restart reconciliation runs.
- One active global kill switch affects every portfolio; one active portfolio switch affects only its portfolio.
- Every state-changing fact carries actor/command/correlation/causation attribution and joins the U02 append-only event stream.

## Exact Type Reuse and Additive Identifiers

### Reused U01/U04 Types

| Concept | Type | Constraint |
|---|---|---|
| Portfolio scope | `PortfolioId` | Equal across every child value |
| Plan identity | `RebalanceRunId`, `IntegrityHash` | Existing U04 identities/hashes |
| Strategy lineage | `StrategyVersionId`, `StrategyConfigHash` | Exact plan-bound values |
| Order identity | `OrderId`, `IdempotencyKey` | Existing U01 brands |
| Instrument | `InstrumentId` | Mapped to broker symbol/token by immutable snapshot |
| Cash, price, cost | `Money` | INR exact minor-unit `bigint` |
| Shares | `Quantity` | Non-negative whole-share `bigint` |
| Portfolio version | `PortfolioStateVersion` | Optimistic safe integer |
| Time | `Instant`, `LocalDate` | Canonical UTC and Gregorian date |
| Actor/evidence | `ActorId`, `EvidenceId`, `CommandId`, `CorrelationId`, `CausationId`, `EventId` | Existing bounded brands |

### Additive U05 Identifier Brands

| Identifier | Purpose |
|---|---|
| `ApprovalId` | Immutable approval/rejection decision identity |
| `ExecutionRunId` | One execution aggregate identity |
| `SubmissionAttemptId` | One persisted placement attempt |
| `BrokerAccountBindingId` | Redacted internal account binding |
| `BrokerOrderReferenceId` | Internal identity for one external broker order reference |
| `FillId` | Stable normalized fill identity |
| `CancellationId` | Stable cancellation attempt identity |
| `ReconciliationRunId` | Immutable reconciliation comparison identity |
| `ReconciliationSnapshotId` | Canonical local/external snapshot identity |
| `ResidualWorkId` | Explicit unfinished approved work identity |
| `KillSwitchId` | Global or portfolio kill-switch aggregate identity |
| `AdjustmentProposalId` | Reviewed external-change proposal identity |
| `QuoteSnapshotId` | Immutable execution quote bundle identity |
| `ExecutionPolicySnapshotId` | Immutable risk/automation policy identity |

All use the existing identifier parser policy: bounded canonical strings, no whitespace or unsafe characters, branded non-interchangeability, and redacted rendering.

## Approval Entities

### ApprovalDecision

| Field | Type | Rule |
|---|---|---|
| `approvalId` | `ApprovalId` | Immutable |
| `portfolioId` | `PortfolioId` | Exact plan/actor scope |
| `rebalanceRunId` | `RebalanceRunId` | One U04 plan |
| `state` | `ApprovalState` | Closed state machine |
| `decisionKind` | `APPROVE_BASKET`, `APPROVE_SUBSET`, or `REJECT` | Immutable original action |
| `binding` | `ApprovalBinding` | Required for approval/subset |
| `reasonCode` | allowlisted code | Required for rejection and material exclusions |
| `decidedBy` | `ActorId` | Immutable attribution |
| `authorizationEvidenceId` | `EvidenceId` | Opaque U07 role evidence |
| `mfaEvidenceId` | `EvidenceId` or absent | Required by policy for privileged live actions |
| `idempotencyKey` | `IdempotencyKey` | Unique command identity |
| `decisionHash` | `IntegrityHash` | Canonical payload hash |
| `decidedAt` | `Instant` | Not after expiry |
| `stateVersion` | non-negative safe integer | Advances once per accepted lifecycle transition |

`ApprovalState` is closed to:

- `PENDING`
- `APPROVED`
- `PARTIALLY_APPROVED`
- `REJECTED`
- `INVALIDATED`
- `EXPIRED`
- `CONSUMED`

### ApprovalBinding

| Field | Type | Rule |
|---|---|---|
| `planHash` | `IntegrityHash` | Exact U04 semantic plan hash |
| `planInputHash` | `IntegrityHash` | Exact U04 input hash |
| `strategyVersionId` | `StrategyVersionId` | Current plan lineage |
| `strategyConfigHash` | `IntegrityHash` | Current plan lineage |
| `portfolioStateVersion` | `PortfolioStateVersion` | Exact state consented to |
| `reconciliationSnapshotId` | `ReconciliationSnapshotId` | Fresh matched baseline |
| `quoteSnapshotId` | `QuoteSnapshotId` | Exact quote consented to |
| `approvedLogicalOrderKeys` | canonical non-empty `IntegrityHash[]` | Exact subset; empty only for no-trade plan |
| `priceBoundsByOrder` | canonical `ApprovalPriceBound[]` | One for each approved order |
| `executionDate` | `LocalDate` | Equals U04 eligible date |
| `windowStart` | local time | Equals U04 start |
| `windowEnd` | local time | Equals U04 end |
| `timeZone` | `Asia/Kolkata` | Fixed |
| `expiresAt` | `Instant` | At/before execution-window end or a shorter configured approval deadline; quote freshness is revalidated separately |

### ApprovalPriceBound

| Field | Type | Rule |
|---|---|---|
| `logicalOrderKey` | `IntegrityHash` | In approved set |
| `referencePrice` | `Money` | U04 estimate |
| `approvedLimitPrice` | `Money` | Exact protected limit |
| `maximumDeviation` | exact `ScaledRate` | Immutable strategy bound |
| `quoteStaleAfter` | `Instant` | Reference-quote provenance bound; stale reference cannot be used for placement, but a fresh quote inside the immutable deviation/price limits may be validated without mutating approval |

## Execution Policy and Gate Entities

### ExecutionPolicySnapshot

| Field | Type | Rule |
|---|---|---|
| `policySnapshotId` | `ExecutionPolicySnapshotId` | Immutable |
| `strategyVersionId` | `StrategyVersionId` | Exact assigned strategy |
| `allowedUniverseHash` | `IntegrityHash` | Exact allowed instrument set |
| `product` | `CNC` | Only supported product |
| `maximumOrderCount` | positive integer | Hard basket cap |
| `maximumDailyNotional` | `Money` | Portfolio/application hard cap |
| `maximumPositionValue` | `Money` | Hard cap |
| `maximumTurnover` | exact `ScaledRate` | Plan and accumulated cap |
| `minimumCashBuffer` | `Money` | Cannot be spent |
| `maximumQuoteAgeMs` | positive bounded integer | Freshness cap |
| `maximumPriceDeviation` | `ScaledRate` | Price guard |
| `maximumRejections` | non-negative integer | Containment trigger |
| `restrictedAutoRules` | `RestrictedAutoPolicy` | Exact auto limits |
| `effectiveAt` | `Instant` | Not after execution |
| `hash` | `IntegrityHash` | Canonical policy hash |

### LiveEnablementSnapshot

| Field | Type | Rule |
|---|---|---|
| `environmentEnabled` | boolean | Defaults false |
| `applicationEnabled` | boolean | Defaults false |
| `portfolioEligible` | boolean | Derived from mode/evidence, not mode alone |
| `strategyEligible` | boolean | Requires activation evidence |
| `brokerAccountBound` | boolean | Exact portfolio binding |
| `brokerCertified` | boolean | Requires U05 conformance evidence |
| `approvalCurrent` | boolean | Exact current binding |
| `reconciliationMatched` | boolean | Fresh matched baseline |
| `sessionEligible` | boolean | Exact date/window |
| `riskPassed` | boolean | All checks pass |
| `fullAutoEnabled` | false | Fixed false in this design |

All booleans except `fullAutoEnabled` must be true for one live placement. Missing is false.

### ExecutionQuoteSnapshot

| Field | Type | Rule |
|---|---|---|
| `quoteSnapshotId` | `QuoteSnapshotId` | Immutable |
| `instrumentId` | `InstrumentId` | Exact mapped instrument |
| `bid`, `ask`, `last` | `Money` or absent | Exact provider values |
| `source` | allowlisted source | Licensed/execution-capable for live |
| `marketTime` | `Instant` | Exchange time |
| `fetchedAt` | `Instant` | Local receipt time |
| `staleAfter` | `Instant` | Hard expiry |
| `validationStatus` | `VALID` | Other status blocks |
| `mappingSnapshotHash` | `IntegrityHash` | Exact broker mapping lineage |

## ExecutionRun Aggregate

### ExecutionRun

| Field | Type | Rule |
|---|---|---|
| `executionRunId` | `ExecutionRunId` | Immutable and unique |
| `portfolioId` | `PortfolioId` | Aggregate scope |
| `approvalId` | `ApprovalId` | One consumed approval |
| `rebalanceRunId` | `RebalanceRunId` | One U04 plan |
| `planHash` | `IntegrityHash` | Exact approval binding |
| `mode` | `ExecutionMode` | Trusted composition result |
| `state` | `ExecutionRunState` | Closed transition model |
| `orders` | canonical `ExecutionOrder[]` | Sells then buys |
| `preExecutionReconciliationId` | `ReconciliationRunId` | Fresh matched baseline |
| `phaseReconciliationIds` | canonical `ReconciliationRunId[]` | Immutable links |
| `policySnapshotId` | `ExecutionPolicySnapshotId` | Exact gate policy |
| `createdAt`, `updatedAt` | `Instant` | Canonical |
| `stateVersion` | non-negative safe integer | Optimistic |
| `failureCode` | safe code or absent | Never raw broker text |

`ExecutionMode` is closed to:

- `PAPER`
- `DRY_RUN`
- `FAKE_TEST`
- `LIVE_ZERODHA`
- `LIVE_SHAREKHAN`

Live values cannot be instantiated by domain input alone; the composition gate creates the capability.

`ExecutionRunState` is closed to:

- `CREATED`
- `VALIDATING`
- `READY`
- `SELLING`
- `RECONCILING_SELLS`
- `BUYING`
- `RECONCILING_BUYS`
- `CANCELLING`
- `RECOVERY_REQUIRED`
- `BLOCKED`
- `COMPLETED`
- `COMPLETED_WITH_RESIDUAL`
- `CANCELLED`

## ExecutionOrder Entities

### ExecutionOrder

| Field | Type | Rule |
|---|---|---|
| `orderId` | `OrderId` | Immutable internal identity |
| `executionRunId` | `ExecutionRunId` | Owning run |
| `portfolioId` | `PortfolioId` | Same scope |
| `logicalOrderKey` | `IntegrityHash` | Exact U04 action identity |
| `idempotencyKey` | `IdempotencyKey` | Unique semantic identity |
| `sequence` | positive integer | Sells before buys |
| `approvedQuantityCeiling` | positive `Quantity` | Immutable U04/approval maximum |
| `intent` | `OrderIntentPayload` or absent | Absent only in `PLANNED`; immutable once `INTENT_RECORDED` |
| `intentHash` | `IntegrityHash` or absent | Created with `intent`; canonical and immutable |
| `state` | `OrderState` | Closed state machine |
| `submissionAttempts` | canonical `SubmissionAttempt[]` | Monotone attempt number |
| `brokerReference` | `BrokerOrderReference` or absent | Present only after proof |
| `fills` | canonical `Fill[]` | Unique identities |
| `filledQuantity` | `Quantity` | Monotone and at most order quantity |
| `reservedCash` | `Money` | Buy only; exact |
| `reservedDeliveryQuantity` | `Quantity` | Sell only; exact |
| `cancellations` | canonical `CancellationAttempt[]` | Immutable facts |
| `residualWorkId` | `ResidualWorkId` or absent | Unfinished terminal quantity |
| `stateVersion` | non-negative safe integer | Optimistic |

`PLANNED` requires `intent` and `intentHash` to be absent. `INTENT_RECORDED` and every submitted state require both to be present and immutable. Finalization may reduce a buy quantity within `approvedQuantityCeiling` exactly once after sell reconciliation; it never changes `idempotencyKey`, instrument, side, mapping, sequence, price bound, or approval lineage. When safe buy quantity is zero, `PLANNED` transitions directly to terminal `RESIDUAL` with `residualWorkId`; `intent`, `intentHash`, reservations, and submission attempts remain absent.

`OrderState` is closed to:

- `PLANNED`
- `RESIDUAL`
- `INTENT_RECORDED`
- `SUBMISSION_IN_FLIGHT`
- `ACKNOWLEDGED`
- `OPEN`
- `PARTIALLY_FILLED`
- `CANCEL_PENDING`
- `FILLED`
- `REJECTED`
- `CANCELLED`
- `EXPIRED`
- `UNKNOWN`

### OrderIntentPayload

| Field | Type | Rule |
|---|---|---|
| `portfolioId` | `PortfolioId` | Exact scope |
| `rebalanceRunId` | `RebalanceRunId` | Plan identity |
| `planHash` | `IntegrityHash` | Plan binding |
| `approvalId` | `ApprovalId` | Consent binding |
| `logicalOrderKey` | `IntegrityHash` | U04 identity |
| `instrumentId` | `InstrumentId` | Canonical |
| `brokerInstrument` | `BrokerInstrumentMapping` | Immutable mapping snapshot |
| `side` | `BUY` or `SELL` | Closed |
| `product` | `CNC` | Fixed |
| `orderType` | `LIMIT` | Default protected order |
| `quantity` | positive `Quantity` | Final submission quantity, at most `approvedQuantityCeiling`; buy value is fixed once after sell reconciliation and affordability recomputation |
| `limitPrice` | positive `Money` | Inside approval bound |
| `validity` | `DAY` | Cannot outlive window/session |
| `sequence` | positive integer | Canonical |
| `executionWindow` | `ExecutionWindow` | Exact U04 timing |
| `policySnapshotId` | `ExecutionPolicySnapshotId` | Exact risk lineage |

### BrokerInstrumentMapping

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Internal identity |
| `broker` | `ZERODHA` or `SHAREKHAN` | Closed live broker set |
| `exchange` | allowlisted cash-equity venue | NSE cash initially |
| `tradingSymbol` | bounded canonical symbol | Not used as sole identity |
| `brokerTokenOrCode` | redacted bounded value | Required and positive/canonical |
| `isin` | bounded string or absent | Validation aid |
| `normalizedProduct` | `CNC` | Fixed |
| `brokerProductCode` | allowlisted delivery code | Never inherited from client default |
| `verifiedAt`, `staleAfter` | `Instant` | Freshness |
| `mappingHash` | `IntegrityHash` | Canonical |

### ExecutionWindow

| Field | Type | Rule |
|---|---|---|
| `executionDate` | `LocalDate` | U04 eligible date |
| `start`, `end` | local time | Exact U04 bounds |
| `timeZone` | `Asia/Kolkata` | Fixed |
| `sameSessionAllowed` | false | Fixed for routine plans |
| `calendarSessionId` | `CalendarSessionId` | Confirmed session |

## Submission and Broker Result Entities

### SubmissionAttempt

| Field | Type | Rule |
|---|---|---|
| `attemptId` | `SubmissionAttemptId` | Immutable |
| `orderId` | `OrderId` | Exact order |
| `attemptNumber` | 1, 2, or 3 | Monotone bounded |
| `intentHash` | `IntegrityHash` | Unchanged |
| `startedAt` | `Instant` | Persisted before call |
| `deadlineAt` | `Instant` | Bounded |
| `result` | `SubmissionResult` or absent | Absent after crash means unknown |

### SubmissionResult

Discriminated union:

- `ACKNOWLEDGED`: broker reference, normalized status, received time.
- `REJECTED`: safe rejection code, proof no accepted order, received time.
- `DEFINITELY_NOT_SENT`: reviewed certainty evidence, received time.
- `UNKNOWN`: safe ambiguity code, received time.

Raw broker exceptions, payloads, account IDs, or credentials are not fields.

### BrokerOrderReference

| Field | Type | Rule |
|---|---|---|
| `referenceId` | `BrokerOrderReferenceId` | Internal identity |
| `broker` | `ZERODHA` or `SHAREKHAN` | Closed |
| `accountBindingId` | `BrokerAccountBindingId` | Redacted internal reference |
| `brokerOrderId` | bounded opaque string | Encrypted/redacted outside adapter/persistence |
| `brokerTag` | bounded opaque string or absent | Secondary correlation only |
| `acknowledgedAt` | `Instant` | Canonical |

### BrokerOrderSnapshot

| Field | Type | Rule |
|---|---|---|
| `brokerReference` | `BrokerOrderReference` | Exact |
| `status` | `BrokerOrderStatus` | Closed normalized status |
| `orderedQuantity` | `Quantity` | Equals local intent |
| `filledQuantity` | `Quantity` | Monotone |
| `openQuantity` | `Quantity` | Exact remainder |
| `averageFillPrice` | `Money` or absent | Exact when filled |
| `asOf` | `Instant` | Snapshot time |
| `cursor` | opaque bounded value or absent | Coherence aid |

`BrokerOrderStatus` is closed to `ACKNOWLEDGED`, `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCEL_PENDING`, `CANCELLED`, `REJECTED`, `EXPIRED`, and `UNKNOWN`.

## Fill and Accounting Entities

### Fill

| Field | Type | Rule |
|---|---|---|
| `fillId` | `FillId` | Stable unique normalized identity |
| `portfolioId` | `PortfolioId` | Same order scope |
| `orderId` | `OrderId` | One local order |
| `brokerReferenceId` | `BrokerOrderReferenceId` | One external order |
| `brokerFillId` | bounded opaque string or absent | Preferred identity |
| `identityKind` | `BROKER_ID` or `CANONICAL_FINGERPRINT` | Explicit |
| `instrumentId` | `InstrumentId` | Exact mapping |
| `side` | `BUY` or `SELL` | Equals intent |
| `product` | `CNC` | Fixed |
| `quantity` | positive `Quantity` | Incremental fill |
| `price` | positive `Money` | Exact |
| `grossNotional` | `Money` | Exact multiplication |
| `charges` | canonical `FillCharge[]` | Confirmed exact components |
| `netCashEffect` | signed exact money value | Debit for buy, credit for sell |
| `tradeTime` | `Instant` | Broker trade time |
| `settlementDate` | `LocalDate` or absent | Does not imply availability until confirmed |
| `contentHash` | `IntegrityHash` | Duplicate conflict check |
| `appliedPortfolioVersion` | `PortfolioStateVersion` or absent | Present once applied |

### FillCharge

| Field | Type | Rule |
|---|---|---|
| `chargeCode` | allowlisted cost/tax component | Stable |
| `amount` | `Money` | Non-negative exact |
| `confirmed` | true | Estimates are not fill charges |

### Reservation

Discriminated by side:

- `BUY_CASH`: `orderId`, exact maximum `Money`, remaining reserved money.
- `SELL_DELIVERY`: `orderId`, `instrumentId`, exact `Quantity`, remaining reserved quantity.

Reservations are created before placement, reduced by fills, released on proved terminal unfilled quantity, and never become negative.

### AccountingDelta

| Field | Type | Rule |
|---|---|---|
| `fillId` | `FillId` | One-to-one application key |
| `cashDelta` | signed exact money | Exact net effect |
| `holdingDelta` | signed whole shares | No resulting short |
| `lotMutations` | canonical `LotMutation[]` | Preserve lineage |
| `deliveryDelta` | signed whole shares | Confirmed availability only |
| `reservationDelta` | signed exact reservation value | Releases only applied/terminal amount |
| `resultingPortfolioVersion` | `PortfolioStateVersion` | Advances exactly once |

### LotMutation

- `OPEN_FILL_LOT`: new buy fill lot with source `FILL`.
- `INCREASE_FILL_LOT`: allowed only if broker emits one fill identity that is incrementally corrected without identity conflict; otherwise use a new lot.
- `REDUCE_EXISTING_LOT`: exact U04 disposition and quantity.
- `CLOSE_EXISTING_LOT`: open quantity becomes zero; history retained.

## Cancellation Entities

### CancellationAttempt

| Field | Type | Rule |
|---|---|---|
| `cancellationId` | `CancellationId` | Immutable |
| `orderId` | `OrderId` | Exact |
| `idempotencyKey` | `IdempotencyKey` | Unique semantic cancel |
| `requestedBy` | `ActorId` or system identity | Attributed |
| `reasonCode` | allowlisted code | Required |
| `requestedAt` | `Instant` | Persisted before call |
| `deadlineAt` | `Instant` | Bounded |
| `outcome` | `ACKNOWLEDGED`, `REJECTED`, or `UNKNOWN` | False/timeout is unknown |
| `brokerAsOf` | `Instant` or absent | Evidence |

Cancellation acknowledgement does not itself transition an order to `CANCELLED`; reconciliation must prove it.

## Reconciliation Entities

### ReconciliationRun

| Field | Type | Rule |
|---|---|---|
| `reconciliationRunId` | `ReconciliationRunId` | Immutable |
| `portfolioId` | `PortfolioId` | One scope |
| `reason` | `ReconciliationReason` | Closed |
| `state` | `ReconciliationState` | Closed state machine |
| `localSnapshotId` | `ReconciliationSnapshotId` | Exact local baseline |
| `externalSnapshotId` | `ReconciliationSnapshotId` or absent | Absent only if blocked |
| `differences` | canonical `ReconciliationDifference[]` | Immutable |
| `startedAt`, `completedAt` | `Instant` | Completed absent while active |
| `priorRunId` | `ReconciliationRunId` or absent | Resolution lineage |
| `snapshotHash` | `IntegrityHash` | Canonical comparison identity |

`ReconciliationReason` is closed to:

- `BEFORE_EXECUTION`
- `AFTER_SELLS`
- `AFTER_BUYS`
- `AFTER_PARTIAL_FILL`
- `AFTER_CANCELLATION`
- `END_OF_WINDOW`
- `END_OF_DAY`
- `RESTART`
- `MANUAL_SAFE`

`ReconciliationState` is closed to:

- `REQUESTED`
- `COLLECTING`
- `COMPARING`
- `MATCHED`
- `MATCHED_WITH_ROUNDING`
- `MISMATCH`
- `UNKNOWN`
- `BLOCKED`

### ReconciliationSnapshot

| Field | Type | Rule |
|---|---|---|
| `snapshotId` | `ReconciliationSnapshotId` | Immutable |
| `source` | `LOCAL`, `PAPER`, `ZERODHA`, or `SHAREKHAN` | Closed |
| `portfolioId` | `PortfolioId` | Exact |
| `accountBindingId` | `BrokerAccountBindingId` or absent | Required for live |
| `cash` | `Money` | Available non-margin cash |
| `holdings` | canonical `ReconciledHolding[]` | By instrument |
| `openOrders` | canonical `BrokerOrderSnapshot[]` | By reference |
| `fills` | canonical `Fill[]` | By fill identity |
| `endpointTimes` | canonical endpoint/time map | Coherence evidence |
| `cursor` | bounded opaque cursor or absent | Provider snapshot cursor |
| `capturedAt` | `Instant` | Canonical |
| `contentHash` | `IntegrityHash` | Canonical |

### ReconciledHolding

| Field | Type | Rule |
|---|---|---|
| `instrumentId` | `InstrumentId` | Mapped |
| `totalQuantity` | `Quantity` | Zero tolerance |
| `availableDeliveryQuantity` | `Quantity` | Excludes T1/unsettled/margin |
| `reservedQuantity` | `Quantity` | Local reservation comparison |
| `averageCost` | `Money` or absent | Evidence, not lot replacement |
| `mappingHash` | `IntegrityHash` | Exact mapping |

### ReconciliationDifference

| Field | Type | Rule |
|---|---|---|
| `differenceId` | `IntegrityHash` | Canonical identity |
| `kind` | `DifferenceKind` | Closed |
| `severity` | `INFO`, `BLOCKING`, or `CRITICAL` | Deterministic |
| `instrumentId` | `InstrumentId` or absent | Affected instrument |
| `orderId` | `OrderId` or absent | Affected order |
| `expected` | bounded exact safe value | No secret |
| `actual` | bounded exact safe value | No secret |
| `resolution` | `NONE`, `APPLY_KNOWN_FILL`, or `REQUIRES_ADJUSTMENT_APPROVAL` | Closed |

`DifferenceKind` is closed to:

- `EXTERNAL_CHANGE`
- `LOCAL_MISSING_FILL`
- `BROKER_MISSING_ORDER`
- `VALUE_MISMATCH`
- `UNKNOWN_ORDER`
- `MAPPING_BLOCKED`
- `CASH_ROUNDING`

### AdjustmentProposal

| Field | Type | Rule |
|---|---|---|
| `adjustmentProposalId` | `AdjustmentProposalId` | Immutable |
| `reconciliationRunId` | `ReconciliationRunId` | One mismatch |
| `differences` | non-empty canonical IDs | Exact proposed resolution |
| `proposedAccountingDelta` | exact delta | Never applied implicitly |
| `authorizationEvidenceId` | `EvidenceId` or absent | Required before apply |
| `state` | `PROPOSED`, `APPROVED`, `REJECTED`, or `APPLIED` | Closed |
| `contentHash` | `IntegrityHash` | Tamper evidence |

### ResidualWork

| Field | Type | Rule |
|---|---|---|
| `residualWorkId` | `ResidualWorkId` | Immutable |
| `executionRunId` | `ExecutionRunId` | Owning run |
| `orderId` | `OrderId` | Source order |
| `remainingQuantity` | positive `Quantity` | Exact |
| `reason` | `PARTIAL_FILL`, `REJECTED`, `CANCELLED`, `EXPIRED`, `PRICE_STALE`, `CASH_REDUCED`, or `RECOVERY_REQUIRED` | Closed |
| `requiresReplan` | true | Fixed conservative choice |
| `createdAt` | `Instant` | Canonical |

## Kill-Switch Entities

### KillSwitch

| Field | Type | Rule |
|---|---|---|
| `killSwitchId` | `KillSwitchId` | Stable global/portfolio identity |
| `scope` | `KillSwitchScope` | Global or one portfolio |
| `state` | `INACTIVE` or `ACTIVE` | Closed |
| `stateVersion` | non-negative safe integer | Optimistic |
| `activeActivation` | `KillSwitchActivation` or absent | Present only when active |
| `history` | canonical `KillSwitchTransition[]` | Immutable |

`KillSwitchScope` is either:

- `{ kind: GLOBAL }`
- `{ kind: PORTFOLIO, portfolioId }`

### KillSwitchActivation

| Field | Type | Rule |
|---|---|---|
| `reasonCode` | allowlisted trigger | Required |
| `actorId` | `ActorId` or system identity | Attribution |
| `evidenceId` | `EvidenceId` | Required |
| `activatedAt` | `Instant` | Canonical |
| `correlationId` | `CorrelationId` | Trace |

### KillSwitchReset

| Field | Type | Rule |
|---|---|---|
| `actorId` | `ActorId` | Privileged |
| `authorizationEvidenceId` | `EvidenceId` | Reset role |
| `mfaEvidenceId` | `EvidenceId` | Mandatory |
| `reasonCode` | allowlisted resolution | Required |
| `healthSnapshotHash` | `IntegrityHash` | Required dependencies healthy |
| `reconciliationSnapshotIds` | canonical non-empty list | No unresolved affected portfolio |
| `resetAt` | `Instant` | Canonical |
| `idempotencyKey` | `IdempotencyKey` | Required |

## Evidence and Event Entities

### ExecutionEventEnvelope

U05 extends the existing event model with the same common fields:

- `EventId`
- event type and schema version
- `PortfolioId`
- related aggregate identity and state version
- occurred-at `Instant`
- `ActorId`
- `CommandId`
- `CorrelationId`
- `CausationId`
- canonical bounded payload

### Event Families

- `ApprovalDecided`, `ApprovalInvalidated`, `ApprovalConsumed`
- `ExecutionRunCreated`, `ExecutionRunStateChanged`
- `OrderIntentRecorded`, `SubmissionAttemptStarted`, `SubmissionOutcomeRecorded`
- `OrderStateChanged`, `FillRecorded`, `FillApplied`
- `CancellationRequested`, `CancellationOutcomeRecorded`
- `ReconciliationCompleted`, `ReconciliationDifferenceRecorded`
- `AdjustmentProposed`, `AdjustmentApplied`
- `ResidualWorkCreated`
- `KillSwitchActivated`, `KillSwitchReset`
- `RecoveryClassified`

Events store hashes and safe IDs, not credentials, raw request/response bodies, full account identifiers, or unbounded broker messages.

## Port Contracts

### PlanReadPort

```text
getPlan(portfolioId, rebalanceRunId) -> DomainResult<RebalancePlan | undefined>
verifyPlanHash(plan) -> DomainResult<IntegrityHash>
```

Implementation may wrap U04 plan storage/history; it does not recalculate the plan.

### ExecutionQuotePort

```text
getExecutionQuote(instrumentId, deadline) -> Promise<DomainResult<ExecutionQuoteSnapshot>>
```

Must provide exact values, provenance, and stale-after time.

### BrokerPort

```text
getCapabilities(accountBinding, deadline) -> Promise<BrokerCapabilitiesResult>
getAccount(accountBinding, deadline) -> Promise<BrokerAccountSnapshotResult>
getHoldings(accountBinding, deadline) -> Promise<BrokerHoldingsSnapshotResult>
getCash(accountBinding, deadline) -> Promise<BrokerCashSnapshotResult>
getOpenOrders(accountBinding, deadline) -> Promise<BrokerOrdersSnapshotResult>
placeOrder(orderRequest, deadline) -> Promise<SubmissionResult>
getOrder(orderReference, deadline) -> Promise<BrokerOrderSnapshotResult>
getFills(orderReference, cursor, deadline) -> Promise<BrokerFillSnapshotResult>
cancelOrder(cancelRequest, deadline) -> Promise<CancellationResult>
```

Every result includes normalized certainty, `asOf`, safe retry classification, and redacted failure. No method returns a success-shaped empty value for an external error.

### PaperBrokerPort

Implements `BrokerPort` and additionally accepts a deterministic fill-policy snapshot at composition. It has no credential or network capability.

### Transaction-Scoped U05 Ports

Additive future shape inside `PortfolioTransaction`:

```text
ApprovalRepository
  insert/get/saveByExpectedVersion/findByIdempotencyKey

ExecutionRepository
  insertRun/getRun/saveRunByExpectedVersion
  insertOrder/getOrder/saveOrderByExpectedVersion/findOrderByIdempotencyKey
  insertFill/findFillByIdentity
  insertCancellation/insertResidualWork

ReconciliationRepository
  insertRun/getRun/findLatestMatched
  insertSnapshot/insertDifferences/insertAdjustmentProposal

KillSwitchRepository
  getGlobal/getPortfolio/saveByExpectedVersion

ExecutionAccountingPort
  reserveOrder/applyUniqueFill/releaseTerminalReservation/applyAuthorizedAdjustment
```

Each method is synchronous and available only during U02's active transaction callback. It returns `DomainResult` and exposes no raw SQL.

### ExecutionPolicyPort

```text
loadPolicySnapshot(portfolioId, strategyVersionId, asOf) -> DomainResult<ExecutionPolicySnapshot>
evaluatePlan(plan, portfolio, reconciliation, policy) -> DomainResult<RiskDecision>
evaluateOrder(order, portfolio, quote, reconciliation, policy) -> DomainResult<RiskDecision>
```

Risk decisions contain a complete deterministic check list; one failed hard check blocks.

### AuthorizationEvidencePort

Resolves opaque evidence for approval, restricted automation, live eligibility, cancellation, adjustment, and kill-switch reset. U05 validates binding/expiry/hash but does not authenticate users itself.

## Persistence Compatibility

Current U02 migration 001 stores portfolios, allocations, holdings/lots, U01 domain events, and dispatch state only. Later code generation must add numbered, checksummed, reversible-or-explicitly-irreversible U05 schema through the existing U02 `MigrationRegistry`; it must not edit migration 001.

Required logical storage groups:

- plans/read history if not already persisted by U04;
- approvals and approved-order bindings;
- execution runs and orders;
- submission attempts and broker references;
- reservations, fills, cancellation attempts, and residual work;
- reconciliation runs, snapshots, differences, and adjustment proposals;
- kill switches and transition history;
- version-aware U05 event codecs and immutable event facts.

Unique constraints must enforce approval-command, approval-to-run, order idempotency, broker order reference per account, fill identity, accounting application per fill, and kill-switch scope.

## Canonicalization and Equality

- Object keys sort lexicographically.
- Canonical collections sort by their documented identifier/sequence.
- `bigint` values serialize as base-10 strings.
- Undefined fields are absent, not null substitutes.
- Enum values are closed and case-sensitive internally.
- Hash domain separators distinguish approval, intent, fill, snapshot, difference, adjustment, and event values.
- Structural equality excludes runtime-only SDK objects, stack traces, timing duration, and credentials.
- Broker opaque IDs are encrypted or redacted outside the narrow adapter/persistence boundary but remain stable for comparison.

## Story Traceability

| Story | Entity evidence |
|---|---|
| US-021 | `ExecutionRun`, `ExecutionOrder`, `Fill`, `PaperBrokerPort`, accounting values |
| US-022 | `LiveEnablementSnapshot`, closed `ExecutionMode`, certified broker capabilities |
| US-023 | `ApprovalDecision`, `ApprovalBinding`, `ApprovalPriceBound` |
| US-024 | `IdempotencyKey`, `OrderIntentPayload`, `SubmissionAttempt`, repository uniqueness |
| US-025 | `ReconciliationRun`, snapshots/differences, `ResidualWork`, recovery states |
| US-026 | `BrokerPort`, mapping/capability/snapshot normalized values |
| US-027 | `ExecutionPolicySnapshot`, `KillSwitch`, activation/reset evidence |
| US-014, US-019 | Plan/strategy/corporate-action lineage and mandatory delivery constraints |
| US-028, US-035 | Stable run/evidence identities and recovery/event families |
| US-038 | No entity grants AI authority; authorization ports accept only verified non-AI execution evidence |

## PBT-01 Entity Properties

| Entity/component | Category | Required property |
|---|---|---|
| Approval binding/decision codecs | Round-trip | Canonical serialize/parse preserves all authority fields and hash. |
| Approval aggregate | Stateful model | Authority is monotone toward consumed/invalid/expired and never restores. |
| Execution order intent | Idempotence, invariant | Equivalent intent yields one key/hash; canonical order is input-order independent. |
| Execution/order aggregates | Stateful model | All generated transitions follow allowed graphs and terminal states stay terminal. |
| Submission attempts | Stateful model | Attempt number is bounded/monotone; unknown never permits place. |
| Fill identity/application | Idempotence | Unique fills apply exactly once and conflicting duplicates fail. |
| Accounting delta | Invariant, oracle | Exact reference ledger matches cash/holding/lot result; cash and quantities remain valid. |
| Reconciliation snapshots | Round-trip | Exact normalized snapshot persists and rehydrates without value loss. |
| Reconciliation comparator | Invariant, commutativity | Canonical ordering does not affect differences; unchanged repeat has no mutation. |
| Paper broker | Oracle, stateful model | Observable account/order state matches a simple model after every generated command. |
| Kill switch | Stateful model | Active state forbids placement across all generated sequences; reset never resumes. |
| Event chain | Invariant | Facts remain immutable, ordered, hash-linked, and bound to resulting state. |
| Broker adapters | Contract oracle | Each adapter maps fixture responses to the same normalized contract or unknown. |

## Extension Compliance

### Security

- SECURITY-03/05/08/11/12/13/14/15: compliant through typed validation, separate authorization evidence, least authority, redaction, immutable event integrity, safe errors, and containment.
- SECURITY-01: shared with U02/U06 for encrypted persistence/credential stores; entities contain no secret fields.
- SECURITY-04 and endpoint controls: U07.
- SECURITY-09/10: later runtime/delivery stages.
- SECURITY-02/06/07: N/A to local topology.
- Blocking findings: none.

### Resiliency

- RESILIENCY-01: execution, reconciliation, accounting, and audit are Critical and dependencies are explicit.
- RESILIENCY-02: persistent U05 facts inherit hours-level RTO and one-hour RPO.
- RESILIENCY-05/06/07: port results expose redacted health/evidence for U06.
- RESILIENCY-10: broker/quote ports require deadlines, certainty-aware retry, isolation, and fail-closed degradation.
- RESILIENCY-03/04/11 through 15: shared with U06/U09.
- RESILIENCY-08/09: N/A.
- Blocking findings: none.

### Property-Based Testing

- PBT-01: complete through the entity/property table and generator needs in `business-logic-model.md`.
- PBT-02 through PBT-08/PBT-10: explicit code-generation obligations.
- PBT-09: approved `fast-check` and Node test-runner selection remains unchanged.
- Blocking findings: none.

## Frontend Applicability

No `frontend-components.md` is produced. U05 is backend/domain design. U08 later renders approval, execution, reconciliation, broker, and kill-switch views through U07 contracts without receiving credentials or embedding policy.

## Cross-Artifact References

- Algorithms, state machines, autonomous decisions: [business-logic-model.md](business-logic-model.md)
- Exact 124-rule catalog: [business-rules.md](business-rules.md)
