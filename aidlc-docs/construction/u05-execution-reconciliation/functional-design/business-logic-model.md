# U05 Execution and Reconciliation Business Logic Model

## Design Objective

U05 converts one immutable U04 `APPROVAL_READY` rebalance plan into safely approved, idempotent, observable paper or broker order outcomes and reconciled portfolio accounting. The design is fail closed: an absent gate, stale binding, ambiguous external outcome, unresolved mismatch, active kill switch, or unsupported broker mapping produces no new order submission.

Live execution remains disabled by default. This Functional Design performs no broker call, creates no credential-bearing object, changes no persisted state, and sends no real order.

## Functional Boundary

### Inputs

- Current U04 `RebalancePlan`, including `planHash`, `planInputHash`, `RebalanceRunId`, `PlanningContextSnapshot`, `actionBuckets.proposed`, warnings, and `PlanTiming`.
- Current U01 `PortfolioSnapshot`, `OperatingMode`, exact `Money`, `Quantity`, `PortfolioStateVersion`, holdings, lots, branded identifiers, and safe `DomainResult` behavior.
- Current U02 synchronous `PortfolioUnitOfWork` and transaction-scoped repository capability.
- Current broker or paper account, holdings, available delivery quantity, cash, open-order, order-status, and fill snapshots.
- Current strategy execution policy, application/environment safety configuration, broker-account binding, risk-limit snapshot, kill-switch state, exchange session, and fresh execution quote snapshot.
- Authenticated actor and authorization evidence supplied by U07 later; U05 validates opaque role/MFA evidence and never authenticates directly.

### Outputs

- Immutable approval decisions bound to exact plan and current-state lineage.
- Immutable `ExecutionRun`, `ExecutionOrder`, `SubmissionAttempt`, `Fill`, `Cancellation`, `ReconciliationSnapshot`, `ReconciliationDifference`, `ResidualWork`, and `KillSwitch` facts.
- Exact position, lot, reservation, and cash changes committed only through the U02 transaction boundary.
- Stable failure codes and safe redacted evidence.
- Post-commit events for U06 operations and U07 views.

### Excluded Behavior

- HTTP authentication, object authorization, request parsing, or UI confirmation.
- Scheduler leases, alerts, dashboards, backups, restore orchestration, or incident process.
- Strategy selection, target calculation, plan generation, or modification of U04 plan content.
- Any legacy intraday entry, exit, time-stop, VWAP, first-hour, simulation, or dashboard policy.
- Credential loading inside domain/application services.
- Full-auto activation or a success-shaped fallback from live to dry-run.

## Brownfield Compatibility Contract

| Existing contract | U05 treatment |
|---|---|
| U01 exact `Money`, `Quantity`, `PortfolioStateVersion`, `Holding`, `HoldingLot` | Reuse unchanged; all new exact values use canonical decimal or `bigint`, never binary floating-point accounting. |
| U01 `OperatingMode` | Treat as intent only. It never grants broker authority by itself. |
| U02 synchronous `PortfolioUnitOfWork.execute` | Remains the only financial write boundary. U05 adds transaction-scoped execution repositories/capabilities without exposing SQL or making the callback asynchronous. |
| U02 event hash chain and dispatch separation | Extend the version-aware event union and codecs; immutable execution facts use the same append-only chain, while mutable delivery bookkeeping remains separate. |
| Current U02 schema | It has no plan, approval, order, fill, reconciliation, or kill-switch tables. A later U05 code stage must use a numbered U02 migration; this design does not alter the database. |
| Current U04 `RebalancePlan` | Consume actual fields and only `actionBuckets.proposed`; never infer orders from target deltas when an action bucket is absent. |
| U04 plan lifecycle | U05 never rewrites `SUPERSEDED`, `INVALIDATED`, or `EXPIRED` to ready. Approval/execution overlays are separate immutable aggregates. |
| U04 `ProposedOrder` | Preserve logical key, instrument, side, quantity, estimated price/notional, cost/tax lineage, reason, and urgency. Normalize `REDUCE` to broker side `SELL`; never increase quantity. |
| Current `sharekhan-client.js` | Wrap behind a new adapter. Its default `productType: INTRADAY`, number-based accounting, raw error text, and implicit auth retry are unsafe for portfolio execution and may not be used as defaults. |
| Current `zerodha-kite-client.js` | Wrap behind a new adapter. Its placement/status/cancel methods are not the U05 port and its number-based values/raw errors require normalization and redaction. |
| Legacy `/trade-execution` and `/paper-trades` | Remain untouched and separate. Portfolio U05 never calls these routes; U07 later adds portfolio-specific APIs. |

## Conservative Autonomous Decisions

The user required autonomous resolution. The following 24 decisions select the least-authority option.

| Decision | Conservative resolution |
|---|---|
| AD-U05-01 | Live submission is structurally disabled unless every independent environment, application, portfolio, strategy, broker-account, approval, health, reconciliation, session, and risk gate is true at the same pre-submit check. Defaults are false. |
| AD-U05-02 | `OBSERVE` and `RECOMMENDATION` cannot create execution orders. `PAPER` selects only the paper adapter. Test-only fake and dry-run adapters require explicit non-live composition. No caller may choose a concrete adapter by name. |
| AD-U05-03 | `APPROVAL_REQUIRED`, `RESTRICTED_AUTO`, and `LIVE` remain non-authoritative labels. `LIVE` does not mean full-auto; human approval remains required unless separately approved restricted-auto evidence permits that exact order. |
| AD-U05-04 | Approval binds to `planHash`, `planInputHash`, run, portfolio, strategy version/config hash, portfolio version, reconciliation snapshot, approved logical-order keys, reference quote snapshot, price bounds, execution window, actor, and authority expiry. Authority may remain valid until the execution-window end or a shorter configured approval deadline; reference-quote staleness never authorizes placement and is handled by mandatory fresh-quote revalidation. |
| AD-U05-05 | Basket approval is the default. Partial approval may only remove discretionary orders; it cannot edit side, instrument, quantity, price bound, sequence, or identity. Removing a mandatory order blocks the execution and requires a new plan. |
| AD-U05-06 | Any material plan, strategy, portfolio, holdings, cash, lot, reconciliation, execution-window, corporate-action, kill-switch, or broker-account change invalidates approval. A new execution quote does not mutate the bound reference quote; it is acceptable only while fresh and inside the immutable approved price/deviation bounds, otherwise execution blocks and reapproval is required. |
| AD-U05-07 | Execution prices use fresh pre-submit quotes. A quote is acceptable only inside both its source stale-after bound and the strategy price-deviation bound relative to the U04 estimate; otherwise replan/reapprove is required. |
| AD-U05-08 | Routine orders execute only on U04's `eligibleExecutionDate` and within its Asia/Kolkata window. Before the window they wait; after the window they expire. Same-session routine execution is always forbidden. |
| AD-U05-09 | Plan conversion is canonical: normalized sells first by `instrumentId`, then buys by `instrumentId`. Sequence is immutable and included in identity. |
| AD-U05-10 | One idempotency key is the canonical hash of portfolio, run, plan, logical order, instrument, mapped symbol, normalized side, and sequence. Equivalent repeats return the existing order; conflicting payloads fail and audit. |
| AD-U05-11 | Intent and a submission-attempt marker commit before an external placement call. The external call occurs outside the transaction. A crash after the marker is an ambiguous outcome, never permission to place again. |
| AD-U05-12 | Placement is retried only when the adapter proves `DEFINITELY_NOT_SENT`. Timeout, disconnect, malformed acknowledgement, process crash, or absent broker ID is `UNKNOWN`; reconciliation must resolve it. |
| AD-U05-13 | A default maximum of three placement attempts applies only to `DEFINITELY_NOT_SENT` outcomes, using the same order and idempotency identity. Broker rejection is terminal and is not retried. |
| AD-U05-14 | Unknown status blocks the order, all dependent buys, execution completion, approval reuse, and new placement for the same logical intent until reconciliation proves an outcome. |
| AD-U05-15 | Sell orders precede buys. Buy affordability is recalculated only from confirmed post-sell available cash; estimated sale proceeds, unsettled funds, collateral, and margin are excluded. |
| AD-U05-16 | All orders are normalized CNC/delivery, whole-share, cash-funded, long-only orders. An adapter without an allowlisted, contract-proven delivery mapping remains disabled. |
| AD-U05-17 | Paper execution uses the same state machines and accounting contracts, but a deterministic paper fill policy is injected. It never loads credentials, initializes a live SDK, or opens a live network path. |
| AD-U05-18 | Fill application is incremental and deduplicated. Broker cumulative quantity may stay equal or increase; decrease, overfill, identity conflict, or duplicate fill with different content blocks accounting. |
| AD-U05-19 | Broker quantities and order identities reconcile with zero tolerance. Cash may differ by at most one INR minor unit only when explicit broker rounding evidence exists; all other differences are mismatches. |
| AD-U05-20 | Broker external changes create immutable difference/adjustment evidence. They are never silently written over local history. A separately authorized reconciliation adjustment is required. |
| AD-U05-21 | A global or portfolio kill switch blocks new intents and safe placement retries, requests cancellation of cancellable open orders, permits status/fill/reconciliation work, and never liquidates automatically. |
| AD-U05-22 | Kill-switch reset requires a distinct privileged authorization, MFA evidence, reason, healthy required dependencies, no unresolved unknown order, and no unresolved material mismatch. Activation never requires reset authority. |
| AD-U05-23 | Recovery scans persisted intent and attempt state before doing work. `SUBMISSION_IN_FLIGHT` or missing outcomes become `UNKNOWN`; acknowledged orders are polled; unapplied fills are deduplicated and posted once; no recovery path places an ambiguous order. |
| AD-U05-24 | Live Zerodha and Sharekhan adapters are design targets only. Until exact-value normalization, CNC mapping, deadline/certainty semantics, conformance tests, and all live gates exist, composition returns `LIVE_EXECUTION_DISABLED`. |

## Deterministic Failure Precedence

Return only the first applicable safe failure:

1. Command envelope, identifier, actor-evidence, and portfolio scope.
2. Portfolio existence, ACTIVE status, and optimistic state version.
3. Plan existence, U04 lifecycle, hash integrity, and portfolio/strategy binding.
4. Approval existence, scope, state, expiry, and exact binding.
5. Execution mode and independent live-enablement gates.
6. Global and portfolio kill switches.
7. Required reconciliation freshness and unresolved differences.
8. Exchange date/window and clock validity.
9. Quote provenance, freshness, price deviation, and instrument mapping.
10. CNC, whole-share, no-short, no-leverage, delivery quantity, limits, and cash.
11. Idempotency identity and payload equivalence.
12. Persisted intent and prior submission-attempt certainty.
13. External dependency health/deadline.
14. Broker acknowledgement, status, fill, or cancellation outcome.
15. Transaction commit and audit-chain outcome.

Deeper state is not disclosed after an earlier authorization or scope failure.

## Approval Algorithm

1. Load the plan and current portfolio through U02-scoped read ports.
2. Require plan state `APPROVAL_READY`, no executable-blocking warning, and at least one proposed order unless approving a no-trade completion.
3. Recompute and compare the semantic plan hash using the U04 canonical contract.
4. Load current strategy assignment/config hash, portfolio version, reconciliation snapshot, execution session, broker-account binding, quote snapshot, and kill-switch state.
5. Run the same static plan/order risk checks later repeated at submission.
6. Resolve the requested scope:
   - `BASKET`: every proposed logical-order key.
   - `ORDER_SUBSET`: an exact subset of proposed keys.
   - A changed quantity or unknown key is invalid.
   - Excluding any `MANDATORY` order rejects the execution scope.
7. Bind an immutable `ApprovalBinding` to all fields listed in AD-U05-04.
8. Canonicalize and hash the approval payload before persisting.
9. Through one U02 transaction, insert the decision, append its audit event, and commit.
10. A repeat with the same approval command/idempotency key and equivalent binding returns the existing decision.
11. A conflicting repeat fails `APPROVAL_IDEMPOTENCY_CONFLICT`.
12. Rejection is immutable, carries a bounded allowlisted reason, and grants no execution authority.

### Approval State Machine

| Current | Input | Next | Effect |
|---|---|---|---|
| `PENDING` | Approve complete valid basket | `APPROVED` | Exact approved-key set becomes immutable. |
| `PENDING` | Approve valid discretionary subset | `PARTIALLY_APPROVED` | Exact subset becomes immutable; excluded keys are not executable. |
| `PENDING` | Reject | `REJECTED` | No execution authority. |
| `APPROVED` or `PARTIALLY_APPROVED` | Bound input changes or expiry occurs | `INVALIDATED` or `EXPIRED` | Authority removed permanently. |
| `APPROVED` or `PARTIALLY_APPROVED` | Execution run is atomically created | `CONSUMED` | Approval cannot authorize a second run; idempotent command returns the existing run. |
| `REJECTED`, `INVALIDATED`, `EXPIRED`, or `CONSUMED` | Any new decision | No transition | A new current plan and approval are required. |

## Plan-to-Order Conversion Algorithm

1. Accept only the approval's exact plan.
2. Select only approved entries from `actionBuckets.proposed`; never convert skipped or blocked actions.
3. Normalize U04 side:
   - `BUY` remains `BUY`.
   - `SELL` and `REDUCE` become broker side `SELL`.
4. Preserve `logicalOrderKey`, instrument, quantity, reference price, cost/tax lineage, reason, and urgency.
5. Reject zero/fractional quantity, absent instrument mapping, unsupported side, or a quantity above U04's proposed quantity.
6. Partition sells and buys.
7. Sort each partition by canonical `instrumentId`; preserve no caller-provided ordering.
8. Assign immutable sequence numbers from 1 across sells then buys.
9. Resolve an immutable broker instrument mapping snapshot. Portfolio symbol and broker token/code are data, not identity substitutes.
10. Create an immutable `PLANNED` order shell containing plan/approval lineage, normalized CNC product, approved quantity ceiling, selected order policy, price guard, mapping, and sequence. A buy shell does not yet contain a canonical submission quantity or `intentHash`.
11. Derive `IdempotencyKey` using AD-U05-10 from fields that cannot change during affordability finalization.
12. Finalize and hash `OrderIntentPayload` only when that order reaches `INTENT_RECORDED`: sells use the approved quantity ceiling; buys use the lower of the approved ceiling and the post-sell confirmed affordable quantity. Once finalized, every broker-material field including quantity is immutable.
13. Reject duplicate keys inside the basket.
14. Run a final basket invariant: every sell precedes every buy and total quantities cannot imply a short or leverage state.

Order type defaults to a price-bounded delivery limit order derived from the fresh quote and strategy policy. A market order is forbidden unless a future approved strategy explicitly defines a bounded protected-market policy; no such policy is assumed here.

## Execution Preflight and Run Creation

1. Validate the execute command and load the approval, plan, portfolio, strategy execution policy, broker account, kill switches, and latest reconciliation.
2. Repeat every approval-binding comparison; approval is not a bypass.
3. Resolve `ExecutionMode` from trusted composition and portfolio mode:
   - `PAPER` for portfolio mode `PAPER`.
   - `DRY_RUN` only from explicit non-live application composition.
   - `FAKE_TEST` only from test composition.
   - `LIVE` only after all AD-U05-01 gates pass.
   - otherwise fail.
4. Require the current date/window and a trusted Asia/Kolkata clock.
5. Require a fresh `MATCHED` pre-execution reconciliation snapshot with no unknown order.
6. Convert approved actions deterministically.
7. Re-evaluate per-order and aggregate limits: universe, CNC, quantity, delivery, cash, position, concentration, liquidity, turnover, count, daily notional, drawdown, data, broker health, rejection, mismatch, and restricted-auto authority.
8. Through one U02 transaction:
   - recheck portfolio version and approval state;
   - create one `ExecutionRun`;
   - create all `PLANNED` orders with unique keys;
   - transition approval to `CONSUMED`;
   - append immutable events;
   - commit.
9. A repeated execute command returns the existing run. It cannot create a second run for the approval.
10. If no orders exist, perform reconciliation and complete as a no-trade run without contacting a broker.

## Execution Run State Machine

| Current | Guarded transition | Next |
|---|---|---|
| `CREATED` | Preflight begins | `VALIDATING` |
| `VALIDATING` | Every gate passes and orders exist | `READY` |
| `VALIDATING` | Any gate fails | `BLOCKED` |
| `VALIDATING` | Valid no-trade plan reconciles | `COMPLETED` |
| `READY` | First sell intent is recorded | `SELLING` |
| `READY` | No sell orders exist and at least one planned buy exists | `BUYING` |
| `SELLING` | All sells terminal or blocked pending external certainty | `RECONCILING_SELLS` |
| `RECONCILING_SELLS` | Matched, no unknown, and affordable buys remain | `BUYING` |
| `RECONCILING_SELLS` | Matched and no buys remain | `COMPLETED` or `COMPLETED_WITH_RESIDUAL` |
| `RECONCILING_SELLS` | Unknown/mismatch | `RECOVERY_REQUIRED` |
| `BUYING` | All buys terminal | `RECONCILING_BUYS` |
| `RECONCILING_BUYS` | Matched and no residual | `COMPLETED` |
| `RECONCILING_BUYS` | Matched with unfilled/rejected/expired residual | `COMPLETED_WITH_RESIDUAL` |
| Any non-terminal execution state | Cancel is authorized or kill switch activates | `CANCELLING` |
| `CANCELLING` | Every cancellable order is terminal and state reconciles | `CANCELLED` or `COMPLETED_WITH_RESIDUAL` |
| Any active state | Ambiguous submission/status, material mismatch, or restart uncertainty | `RECOVERY_REQUIRED` |
| `RECOVERY_REQUIRED` | Reconciliation proves a safe state | Resume only the derived non-placement state or finish; never repeat an ambiguous placement |

`BLOCKED`, `COMPLETED`, `COMPLETED_WITH_RESIDUAL`, and `CANCELLED` are terminal for new placement. Recovery may add evidence but never rewrite terminal history.

## Intent-Before-Submit Algorithm

For each order in sequence:

1. Stop before work if any kill switch is active, the window closed, or a prior dependent order is unresolved.
2. Reload the order shell by idempotency key.
3. If an immutable intent is already recorded, an equivalent replay returns its state and a differing payload hash fails. A `PLANNED` buy shell has no payload hash yet and may only be finalized once within its approved ceiling.
4. Recheck plan/approval/current-state/quote/risk gates immediately before placement.
5. Through U02 transaction A:
   - for a `PLANNED` sell, finalize the canonical intent at the approved quantity ceiling;
   - for a `PLANNED` buy, compute the canonical whole-share quantity from confirmed post-sell cash, reservations, charges, minimum-order, target-risk, and approved-ceiling rules;
   - if the safe buy quantity is zero, create residual work, transition `PLANNED -> RESIDUAL`, append evidence, and commit without creating `OrderIntentPayload`, `intentHash`, reservation, or submission attempt;
   - otherwise persist the immutable `OrderIntentPayload` and `intentHash`;
   - reserve sell delivery quantity or reserve buy cash;
   - transition `PLANNED -> INTENT_RECORDED -> SUBMISSION_IN_FLIGHT`;
   - append a `SubmissionAttemptStarted` fact with attempt number and deadline;
   - commit.
6. Call `BrokerPort.placeOrder` outside the transaction with the immutable request and deadline.
7. Normalize the result into exactly one certainty class:
   - `ACKNOWLEDGED`: broker order ID and accepted status are present.
   - `REJECTED`: broker explicitly rejected and proves no open order.
   - `DEFINITELY_NOT_SENT`: adapter proves no bytes/SDK placement call reached the broker.
   - `UNKNOWN`: every other timeout, disconnect, malformed, crash-equivalent, or uncertain outcome.
8. Through transaction B, persist the normalized outcome and audit event.
9. Retry only `DEFINITELY_NOT_SENT`, with the same identity, while attempt count is below three, all gates still pass, and the window remains open.
10. For `UNKNOWN`, create immediate reconciliation work and stop dependent execution.
11. For `ACKNOWLEDGED`, poll/status-reconcile by broker order ID; placement is never called again.
12. For `REJECTED`, release unused reservation, update rejection limits, and continue only if policy explicitly permits independent later orders. A rejected sell blocks dependent buys.

## Order State Machine

| Current | Event | Next |
|---|---|---|
| `PLANNED` | Intent commits | `INTENT_RECORDED` |
| `PLANNED` | Safe buy quantity is zero after affordability recomputation | `RESIDUAL` |
| `INTENT_RECORDED` | Attempt marker commits | `SUBMISSION_IN_FLIGHT` |
| `SUBMISSION_IN_FLIGHT` | Broker acknowledgement | `ACKNOWLEDGED` |
| `SUBMISSION_IN_FLIGHT` | Explicit broker rejection | `REJECTED` |
| `SUBMISSION_IN_FLIGHT` | Definitely not sent and retry eligible | `INTENT_RECORDED` |
| `SUBMISSION_IN_FLIGHT` | Any ambiguity or restart | `UNKNOWN` |
| `ACKNOWLEDGED` | Broker says pending/open | `OPEN` |
| `ACKNOWLEDGED` or `OPEN` | Positive fill below quantity | `PARTIALLY_FILLED` |
| `ACKNOWLEDGED`, `OPEN`, or `PARTIALLY_FILLED` | Filled quantity equals order quantity | `FILLED` |
| `ACKNOWLEDGED`, `OPEN`, or `PARTIALLY_FILLED` | Cancel request is accepted | `CANCEL_PENDING` |
| `CANCEL_PENDING` | Positive race fill below quantity | `CANCEL_PENDING` |
| `CANCEL_PENDING` | Race fill completes order quantity | `FILLED` |
| `CANCEL_PENDING` | Broker proves cancellation and remaining quantity is zero-open | `CANCELLED` |
| `ACKNOWLEDGED`, `OPEN`, `PARTIALLY_FILLED`, or `CANCEL_PENDING` | Broker proves rejection | `REJECTED` |
| `ACKNOWLEDGED`, `OPEN`, `PARTIALLY_FILLED`, or `CANCEL_PENDING` | Broker proves expiry | `EXPIRED` |
| Any non-terminal submitted state | Status cannot be proven | `UNKNOWN` |
| `UNKNOWN` | Reconciliation proves normalized broker state | Corresponding `ACKNOWLEDGED`, `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, `REJECTED`, or `EXPIRED` |

Filled quantity is monotone. `RESIDUAL`, `FILLED`, `REJECTED`, `CANCELLED`, and `EXPIRED` are terminal. `RESIDUAL` proves no broker intent was created. Terminal states cannot return to open.

## Fill Processing Algorithm

1. Fetch broker order and fills outside a transaction with a bounded deadline.
2. Normalize identifiers, exact decimal price/charges, side, quantity, trade time, and settlement/delivery classification.
3. Reject fills that do not bind to the portfolio account, broker order, instrument mapping, side, or CNC product.
4. Derive a stable fill key:
   - use broker trade/fill ID when supplied;
   - otherwise hash broker account, broker order ID, instrument, side, exact quantity, exact price, and broker trade timestamp.
5. Compare with stored fills:
   - same key and equivalent payload is an idempotent no-op;
   - same key and conflicting payload is an integrity failure.
6. Compute only the new incremental filled quantity.
7. Reject cumulative decreases, negative values, or cumulative quantity above order quantity.
8. Through one U02 transaction:
   - insert the immutable fill;
   - update order cumulative quantity and exact average;
   - apply the accounting delta once;
   - release the corresponding reservation;
   - append event/evidence;
   - advance portfolio and holding state versions under optimistic checks;
   - commit or roll back everything.
9. Trigger immediate reconciliation after any partial or final fill.
10. A partial terminal outcome creates immutable `ResidualWork`; it never silently creates a replacement order. Replanning and approval are required unless the original approved order explicitly permits a smaller residual retry and broker certainty is complete.

## Exact Accounting Rules

### Buy Fill

- Debit exact fill notional plus confirmed charges/taxes from portfolio cash.
- Never debit below zero.
- Create or increase the holding.
- Create a `HoldingLot` with `sourceReference.kind = FILL` and the fill identity.
- `totalQuantity` increases by filled quantity.
- `availableDeliveryQuantity` changes only from confirmed broker delivery/settlement state; it is not assumed available on trade acknowledgement.
- `reservedQuantity` is unaffected for a buy holding; reserved buy cash is tracked on the execution order and released proportionally.

### Sell Fill

- Quantity cannot exceed both the order's approved quantity and current reserved/available delivery quantity.
- Reduce selected open lots according to immutable U04 disposition lineage; where broker/accounting differences prevent exact disposition, stop and reconcile rather than invent a lot.
- Decrease holding total and available delivery quantities exactly.
- Credit only confirmed net proceeds/available cash. Estimated proceeds do not fund buys.
- Close zero-open lots historically without deleting lineage; remove a zero holding only from the current aggregate view after historical persistence remains intact.

### Transaction Port Fit

U05 must not issue SQL or use a second transaction manager. A later implementation extends the current transaction capability additively:

```text
PortfolioTransaction
  portfolios: PortfolioRepository
  executions: ExecutionRepository
  accounting: ExecutionAccountingPort
  appendDomainEvents(events)
```

The callback remains synchronous. External calls and async waits occur before or after it. Existing U01 mutation/event matching remains valid; U05 execution writes gain their own explicit write-to-event binding so the current U02 one-portfolio-mutation/one-U01-event assertion is not weakened or bypassed.

## Reconciliation Algorithm

Reconciliation runs before execution, after sells, after buys, after every partial fill, at window end, at end of day, after restart, after cancellation, and on operator request.

1. Create a reconciliation request with one portfolio, account binding, reason, and comparison cutoff.
2. Fetch account, holdings, available delivery, cash, open orders, statuses, and fills outside U02 transactions.
3. Require one consistent broker snapshot time/cursor or record each endpoint time and reject an incoherent cross-time view.
4. Normalize exact values and redact account identifiers.
5. Load local portfolio, orders, fills, and prior reconciliation inside a U02 read capability.
6. Compare:
   - holdings and available delivery by mapped `InstrumentId`;
   - exact cash;
   - every non-terminal local order against broker state;
   - every broker open order against known local intent;
   - cumulative and individual fills;
   - reservations and lot/accounting totals.
7. Classify each difference as `MATCH`, `EXTERNAL_CHANGE`, `LOCAL_MISSING_FILL`, `BROKER_MISSING_ORDER`, `VALUE_MISMATCH`, `UNKNOWN_ORDER`, or `MAPPING_BLOCKED`.
8. Determine result:
   - `MATCHED`: no unresolved difference.
   - `MATCHED_WITH_ROUNDING`: only explicit one-minor-unit cash rounding differences.
   - `MISMATCH`: known material differences.
   - `UNKNOWN`: external outcome cannot be classified.
   - `BLOCKED`: mapping, integrity, or dependency failure prevents comparison.
9. Through one U02 transaction, persist the immutable snapshot/differences and append evidence.
10. Apply a missing known fill only through the fill algorithm.
11. Do not overwrite a broker external change. Create an adjustment proposal requiring separate authorization.
12. Permit dependent execution only for a fresh `MATCHED` or allowable `MATCHED_WITH_ROUNDING` result with no unknown order.

### Reconciliation State Machine

| Current | Input | Next |
|---|---|---|
| `REQUESTED` | Snapshot collection starts | `COLLECTING` |
| `COLLECTING` | Complete coherent normalized snapshot | `COMPARING` |
| `COLLECTING` | Deadline/mapping/integrity failure | `BLOCKED` |
| `COMPARING` | No differences | `MATCHED` |
| `COMPARING` | Only proved rounding difference | `MATCHED_WITH_ROUNDING` |
| `COMPARING` | Known material differences | `MISMATCH` |
| `COMPARING` | An external order outcome is ambiguous | `UNKNOWN` |
| `MISMATCH` | Authorized known fills/adjustments are applied and rechecked | New reconciliation run; prior fact remains immutable |
| `UNKNOWN` or `BLOCKED` | Dependency/state becomes available | New reconciliation run; prior fact remains immutable |

## Sell-Before-Buy and Affordability Algorithm

1. Process sell orders serially in canonical sequence unless a future approved policy proves independent parallel safety; this design assumes serial execution.
2. After sells are terminal, run `AFTER_SELLS` reconciliation.
3. Require no unknown, no missing fill, and no delivery/cash mismatch.
4. Set buy budget to confirmed broker/paper available cash minus:
   - strategy cash-buffer floor;
   - existing buy reservations;
   - confirmed charges;
   - a non-negative configured charge buffer.
5. For each approved buy in sequence, recompute the maximum whole quantity affordable within the original approved quantity and price bound.
6. A lower quantity is permitted only if the approval explicitly allows affordability reduction and the resulting value still meets minimum-order and target-risk rules.
7. Quantity may never increase. Finalize the canonical buy `OrderIntentPayload` and `intentHash` exactly once at `INTENT_RECORDED`; this is not an idempotency conflict because the `PLANNED` shell carried only an approved ceiling. If the safe quantity is zero, create residual work and do not submit or finalize an intent.
8. Reserve exact maximum spend before placement.
9. Reconcile after all buys or after each partial fill that materially changes affordability.

## Paper and Dry-Run Behavior

### Paper Adapter

- Implements the same `BrokerPort`.
- Uses a configured deterministic fill policy and injected clock.
- Supports acknowledgement, open, partial fill, fill, rejection, cancellation, expiry, and unknown scenarios.
- Maintains a complete shadow account, cash, holdings, lots, orders, and fills in the portfolio database through U02.
- Marks every record `PAPER`; it cannot accept a live broker account or credential.
- Uses the same execution quote and cost/slippage policy as the plan's approved strategy snapshot.

### Dry-Run Adapter

- Validates and renders the exact would-be normalized broker request.
- Never initializes or invokes a live SDK.
- Returns `DRY_RUN_RECORDED`, not a broker acknowledgement or fill.
- Does not mutate financial cash/holdings.
- Completes with an evidence record that is unambiguously non-live.

### Fake Test Adapter

- Is available only from test composition.
- Exposes scripted deterministic outcomes and call counters.
- Fails if any credential or non-loopback network capability is supplied.

There is no fallback from a live failure to paper/dry-run that reports success. A caller must issue a new explicitly non-live command.

## Broker Port and Adapter Semantics

`BrokerPort` normalizes:

- account identity and capability;
- instrument mapping and CNC/delivery support;
- exact holdings and available delivery;
- exact available cash excluding collateral/margin;
- place, status, cancel, open-order, and fill operations;
- response certainty, cursor/as-of time, deadlines, retry classification, and redacted health.

### Zerodha Adapter

- Maps normalized CNC to the reviewed Zerodha delivery product.
- Uses stable broker tags/client references when supported but never assumes they provide broker-side idempotency.
- Converts SDK values to canonical exact decimals before domain use.
- Maps all undocumented/unknown statuses to `UNKNOWN`.
- Does not expose raw SDK errors, tokens, account IDs, or request payloads.

### Sharekhan Adapter

- Requires an allowlisted Sharekhan delivery product mapping and a confirmed equity instrument/scrip-code mapping.
- Explicitly rejects the current client's default `INTRADAY`; it cannot rely on `buildOrderPayload` defaults.
- Treats empty/unrecognized status from `normalizeOrderStatus` as `UNKNOWN`.
- Uses exact raw decimal fields or a reviewed lossless canonicalization path; current JS `Number` aggregates are not accounting authority.
- Wraps current place/status/cancel/account methods only after conformance evidence proves deadlines, certainty, redaction, and CNC behavior.

Both live adapters remain disabled under AD-U05-24.

## Cancellation Algorithm

1. Validate actor authority, order scope, current non-terminal state, and idempotency key.
2. Cancellation is always permitted for risk reduction or kill-switch containment when the broker says the order is cancellable.
3. Persist `CancellationRequested` before the external call.
4. Call cancel outside the transaction with a deadline.
5. Persist explicit broker acknowledgement, rejection, or `UNKNOWN`.
6. A false/timeout response never proves cancellation.
7. Continue status/fill polling because fills may race cancellation.
8. Mark `CANCELLED` only after broker reconciliation proves no remaining open quantity.
9. Apply any race fill exactly once.
10. Cancellation of a sell blocks dependent buys until post-cancel reconciliation.

## Kill-Switch Algorithms

### Activation

1. Accept global or one portfolio scope, actor, reason code, correlation, and evidence.
2. Validate scope; activation is fail-safe and may be performed by the permitted operator role without reset authority.
3. Through U02 transaction, transition inactive to active, persist reason/evidence, and append an event. Repeated equivalent activation is an idempotent no-op.
4. Block new intents and safe placement retries immediately at application checks.
5. Enumerate cancellable submitted orders, persist cancellation requests, and call cancellation outside the transaction.
6. Continue fill/status/reconciliation processing.
7. Never create liquidation orders.

### Reset

1. Require reset role, MFA evidence, reason, and an idempotency token.
2. For a global reset, require every portfolio to have no unknown order or material mismatch.
3. Require data, broker, clock, database, and audit-chain health.
4. Require the triggering condition to be explicitly cleared.
5. Persist reset atomically and audit it.
6. Reset permits future revalidation; it does not resume or place prior orders automatically.

Automatic triggers include negative cash/invariant failure, unknown outcome, unresolved material reconciliation, stale execution data, broker circuit open, and configured rejection/error limit. Automatic activation uses the narrowest safe scope unless integrity is cross-portfolio or database-wide, which activates global scope.

## Restart and Recovery Algorithm

1. Start with live placement capability disabled.
2. Verify database integrity, migrations, audit chain, and configured kill-switch state.
3. Load all non-terminal execution runs and orders.
4. Classify:
   - `PLANNED`: no external attempt; may be revalidated later.
   - `INTENT_RECORDED` without attempt marker: safe to continue only after full revalidation.
   - `SUBMISSION_IN_FLIGHT`: force `UNKNOWN`.
   - broker-ID states: query/reconcile; never place.
   - terminal states with unapplied fill: deduplicate and apply.
5. Run `RESTART` reconciliation for every affected portfolio.
6. Keep new placement blocked until each affected portfolio is matched and no unknown remains.
7. Expire approvals/windows that elapsed during downtime.
8. Create residual work for safe unfinished intent.
9. Resumption always requires a current plan/approval/window. It never interprets process restart as retry permission.

## Failure and Misuse Scenarios

| Scenario | Unsafe attempt | Fail-closed behavior |
|---|---|---|
| Stale consent | Execute after holdings or portfolio version changes | Invalidate approval and require reconcile/replan/reapprove. |
| Price chase | Submit after quote exceeds approved deviation | Block; do not widen the price or convert to market. |
| Duplicate click/job | Repeat execute or place command | Return existing run/order by idempotency key. |
| Conflicting idempotency | Same key carries different quantity/payload | Reject and audit integrity conflict. |
| Timeout retry | Placement times out without acknowledgement | Mark unknown; query/reconcile; never place again. |
| Sharekhan default misuse | Adapter omits product and inherits `INTRADAY` | Reject adapter request and keep live disabled. |
| Cash leverage | Buy uses estimated sell proceeds or collateral | Recalculate from confirmed available cash only; reduce/skip. |
| Short sale | Sell exceeds available delivery or reserved quantity | Reject before intent; never submit. |
| Fill replay | Same fill arrives repeatedly | Equivalent replay is no-op; conflicting replay blocks. |
| Overfill/cumulative regression | Broker quantity decreases or exceeds order | Mark mismatch/unknown and activate containment. |
| Cancel race | Fill occurs while cancel is pending | Apply fill once and reconcile before declaring cancelled. |
| External manual order | Broker reports an unknown open order | Record external change, block execution, require operator resolution. |
| Kill-switch bypass | Manual or scheduler trigger while active | Block new intent; allow only cancellation/status/reconciliation. |
| Reset-and-resume | Reset switch is treated as approval to continue | Require fresh full revalidation; no automatic resume. |
| Adapter fallback | Live failure reports dry-run success | Forbidden; fail live command explicitly. |
| Cross-portfolio mix | Order/fill/account belongs to another portfolio | Reject entire operation and preserve both portfolios unchanged. |
| Audit write failure | Financial state would commit without evidence | Roll back transaction and stop execution. |
| Legacy route reuse | Portfolio execution calls `/trade-execution` | Architecture violation; portfolio flow remains separate. |

## Story and Requirement Traceability

| Story | Design evidence | Requirements/acceptance |
|---|---|---|
| US-021 | Shared state machines, paper adapter, fill/accounting, reconciliation | FR-090; AC-10 |
| US-022 | AD-U05-01 through AD-U05-03 and AD-U05-24; mode selection and live gate | FR-100.1, FR-100.9; AC-11 |
| US-023 | Approval algorithm/state machine and exact binding | FR-100.2 through FR-100.4; AC-11, AC-17 |
| US-024 | Canonical conversion, idempotency key, intent-before-submit, ambiguity rules | FR-100.6, FR-160.4; AC-13 |
| US-025 | Reconciliation/fill/recovery algorithms and sell-before-buy | FR-080.3 through FR-080.6, FR-100.5; AC-6, AC-10, AC-13 |
| US-026 | Normalized port plus paper/fake/dry/Zerodha/Sharekhan semantics | FR-080.1, FR-080.2; AC-12 |
| US-027 | Risk preflight, restricted-auto authority, kill-switch algorithms | FR-100.7 through FR-100.9, FR-110; AC-12, AC-14, AC-17 |
| US-014 supporting | Corporate-action binding invalidates stale plans/approvals and blocks unresolved mappings | FR-140 |
| US-019 supporting | Mandatory interim exits remain constrained by delivery and execution safety | FR-060.9, FR-100.8 |
| US-028 supporting | Restart recovery and stable command identity prevent duplicate job effects | FR-120.3 through FR-120.6 |
| US-035 supporting | Immutable evidence accompanies every critical transition | FR-180.2, FR-180.5; AC-17 |
| US-038 supporting | AI output has no approval, risk, quantity, or execution authority | FR-150 |

## PBT-01 Testable Property Families

| Component | Category | Property |
|---|---|---|
| Approval canonicalization | Round-trip, invariant | Codec round-trip preserves every binding; approval never authorizes a non-bound key. |
| Approval lifecycle | Stateful model | Random approve/reject/invalidate/expire/consume sequences never restore authority or consume twice. |
| Plan conversion | Invariant, easy verification | Output is canonical, sells precede buys, buy-only baskets transition directly from `READY` to `BUYING`, quantities do not increase, and every order maps to one approved proposed action. |
| Idempotency derivation | Idempotence, invariant | Equivalent semantic input yields one key/result; a `PLANNED` shell finalizes exactly one within-ceiling intent, and any changed field after finalization conflicts safely. |
| Submission workflow | Stateful model | Random retry/crash/timeout/ack sequences invoke placement at most once per ambiguous attempt and never after unknown. |
| Order lifecycle | Stateful model | Cumulative fill is monotone, never exceeds quantity, cancellation-pending race fills apply once while cancellation remains pending unless fully filled, and terminal states never reopen. |
| Fill application | Idempotence, invariant | Applying equivalent fill events repeatedly equals applying each unique fill once; cash/quantity/lot invariants hold. |
| Paper broker | Oracle, stateful model | Paper state matches a simple exact account/order reference model after each command. |
| Reconciliation | Idempotence, invariant | Comparing unchanged snapshots repeatedly is equivalent and does not mutate accounting. |
| Reconciliation comparator | Commutativity where applicable | Canonical input ordering does not change difference classification. |
| Sell-before-buy budget | Invariant, easy verification | Buys never exceed confirmed available cash after required buffer and reservations; affordability reduction finalizes one canonical buy intent without changing its idempotency identity. |
| Kill switch | Stateful model | While active, generated sequences contain no new placement but may reconcile/cancel; reset never resumes automatically. |
| Recovery | Idempotence, stateful model | Repeated recovery converges to equivalent evidence/state and does not duplicate orders or fills. |
| Broker codecs | Round-trip | Valid normalized requests/responses round-trip without exact-value or status loss; unknown broker values stay unknown. |

### Generator Needs

1. U01-compatible exact money, quantity, price, and state-version generators.
2. Current U04 plan generators preserving hashes, proposed/skipped/blocked exclusivity, timing, and logical keys.
3. Approval generators with exact and one-field-stale bindings.
4. Order baskets with sell/buy partitions, repeated/conflicting keys, limits, and price bounds.
5. Broker response generators for acknowledged, rejected, definitely-not-sent, timeout, malformed, disconnect, and unknown.
6. Status/fill stream generators with duplicates, partials, cancellation races, cumulative regressions, and overfills.
7. Portfolio/account snapshots with matched, external-change, missing-fill, unknown-order, cash-rounding, and cross-portfolio cases.
8. Stateful command generators for execution, order, approval, kill switch, reconciliation, and recovery.
9. Paper fill-policy generators with deterministic seeds and controlled slippage/charges.
10. Adapter mapping generators for valid/missing/unsafe Zerodha and Sharekhan CNC mappings.

Shrinking must preserve branded scope, plan/hash consistency, order-to-fill linkage, and valid exact values while minimizing holdings, orders, fills, and transition length. Later tests must log seed/path and retain explicit examples for buy-only execution, timeout ambiguity, partial fill, cancel race, post-sell affordability reduction without idempotency conflict, stale approval, fresh-quote revalidation, live-gate denial, Sharekhan intraday-default rejection, and recovery without duplicate placement.

## Extension Compliance

### Security Baseline

| Rule | Status | U05 Functional Design evidence or N/A rationale |
|---|---|---|
| SECURITY-01 | Compliant, shared | U05 facts remain in U02's encrypted-at-rest boundary; broker transport requires TLS; credentials are absent from domain entities and evidence. U02/U06 own concrete storage/backup controls. |
| SECURITY-02 | N/A | The approved local topology has no load balancer, API gateway, or CDN. |
| SECURITY-03 | Compliant | Safe event/evidence contracts require timestamp, correlation, stable event, severity-ready code, and redacted bounded context. U06 owns the logging sink. |
| SECURITY-04 | N/A to U05 | U05 serves no HTML; U07 owns browser headers. |
| SECURITY-05 | Compliant at U05 boundary | Every command, exact value, enum, mapping, broker result, and payload is allowlisted, bounded, and validated before use. U07 owns HTTP-body/schema limits. |
| SECURITY-06 | N/A | No cloud IAM policy or deployed role is designed in U05. |
| SECURITY-07 | N/A | No cloud network resource is designed in U05. |
| SECURITY-08 | Compliant at U05 authority boundary | Approval, live activation, adjustment, cancellation, and reset require portfolio-bound opaque authorization evidence; missing evidence denies. U07 authenticates and authorizes endpoints. |
| SECURITY-09 | N/A at Functional Design | U05 defines generic safe errors and no default live credentials; concrete runtime hardening belongs to U07/U09. |
| SECURITY-10 | N/A at Functional Design | No package or pipeline change occurs; U09 owns scanning/SBOM and later code generation must retain lockfile controls. |
| SECURITY-11 | Compliant | Approval, risk, adapter, accounting, audit, and kill-switch concerns are isolated; multiple independent gates and misuse cases provide defense in depth. |
| SECURITY-12 | Compliant, shared | U05 stores no password/token and requires opaque MFA evidence for privileged reset/live authority. Authentication/session mechanics belong to U07. |
| SECURITY-13 | Compliant | Canonical hashes, optimistic versions, immutable intents/fills/snapshots, exact-value checks, and append-only evidence protect critical data integrity. |
| SECURITY-14 | Compliant, shared | U05 emits immutable security/financial evidence and containment signals; U06 owns alert routing, retention, dashboards, and tamper-evident operational storage. |
| SECURITY-15 | Compliant | All external calls have explicit outcome certainty and deadlines, unknown fails closed, transactions roll back atomically, and no error becomes success-shaped fallback. |

Security blocking findings: none.

### Resiliency Baseline

| Rule | Status | U05 Functional Design evidence or N/A rationale |
|---|---|---|
| RESILIENCY-01 | Compliant | Execution, reconciliation, accounting, persistence, and audit are Critical; U01/U02/U04, broker/quote, and U06/U07 dependencies are explicit. |
| RESILIENCY-02 | Compliant, inherited | U05 persistent facts inherit the approved hours-level RTO, one-hour RPO, and local 99% configured-window service target. |
| RESILIENCY-03 | N/A to U05 | The approved lightweight change process is project-wide and owned by U06/U09; this stage changes documentation only. |
| RESILIENCY-04 | N/A to U05 | U05 Functional Design defines no deployment or rollback resource; approved direct/database-aware deployment belongs to U06/U09. |
| RESILIENCY-05 | Compliant, shared | Every critical transition exposes latency/error/state/rejection/fill/reconciliation evidence for U06 metrics, logs, alerts, and dashboards. |
| RESILIENCY-06 | N/A to U05 | U05 is an in-process unit and exposes broker/reconciliation health inputs; U06/U07 own service health endpoints. |
| RESILIENCY-07 | Compliant, shared | Unknown orders, mismatches, circuit state, rejection limits, and recovery-required state are explicit alarm inputs; U06 owns monitoring configuration. |
| RESILIENCY-08 | N/A | Multi-zone/multi-region deployment is excluded by the approved local workstation topology. |
| RESILIENCY-09 | N/A | Cloud auto-scaling is excluded; U09 retains local capacity verification. |
| RESILIENCY-10 | Compliant | Broker/quote calls require deadlines, certainty-aware retries, circuit-ready health, dependency isolation, and no unsafe degradation. |
| RESILIENCY-11 | N/A to U05 | Backup-and-restore DR strategy is owned by U06; U05 supplies restart/reconciliation semantics and immutable recovery facts. |
| RESILIENCY-12 | N/A to U05 | U06 owns automated encrypted backup/retention; U05 data remains inside U02's consistent backup boundary. |
| RESILIENCY-13 | N/A to U05 | U06 owns recovery runbooks/failback; U05 defines deterministic execution recovery behavior consumed by those runbooks. |
| RESILIENCY-14 | N/A at this stage | By approved allocation, the resiliency-testing approach is decided during U06 NFR Design, not U05 Functional Design. |
| RESILIENCY-15 | N/A to U05 | U06 owns incident/COE process; U05 emits the evidence and containment state it consumes. |

Resiliency blocking findings: none.

### Property-Based Testing

| Rule | Status | U05 Functional Design evidence or N/A rationale |
|---|---|---|
| PBT-01 | Compliant | Property families, state models, domain generators, shrinking constraints, reproducibility, and permanent examples are identified above. |
| PBT-02 | N/A at Functional Design | Approval, broker codec, and snapshot round-trip targets are identified for Code Generation. |
| PBT-03 | N/A at Functional Design | Cash, quantity, sequencing, gate, fill, and reconciliation invariant targets are identified for Code Generation. |
| PBT-04 | N/A at Functional Design | Command, fill, reconciliation, and recovery idempotency targets are identified for Code Generation. |
| PBT-05 | N/A at Functional Design | Paper/accounting/comparator reference-model targets are identified for Code Generation. |
| PBT-06 | N/A at Functional Design | Approval, order, execution, reconciliation, kill-switch, and recovery state models are identified for Code Generation. |
| PBT-07 | N/A at Functional Design | Domain-specific structured generator requirements are identified above. |
| PBT-08 | N/A at Functional Design | Shrinking preservation, seed/path reporting, and regression capture are specified for later tests. |
| PBT-09 | N/A at Functional Design | The approved NFR already selects `fast-check` with Node's test runner; U05 NFR Requirements will carry the unit-specific decision without being started here. |
| PBT-10 | N/A at Functional Design | Mandatory critical examples are listed in `business-rules.md` alongside property targets. |

PBT blocking findings: none.

## Cross-Artifact References

- Exact rule catalog: [business-rules.md](business-rules.md)
- Entity, relationship, and port definitions: [domain-entities.md](domain-entities.md)
- Source plan: [../../plans/u05-execution-reconciliation-functional-design-plan.md](../../plans/u05-execution-reconciliation-functional-design-plan.md)
