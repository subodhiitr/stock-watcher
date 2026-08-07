# U05 Execution and Reconciliation Business Rules

## Rule Numbering

U05 defines 124 rules in 12 subsystems. Rule identifiers are unique. Stable failure codes are proposed U05 domain codes for later additive inclusion in the current closed `DOMAIN_FAILURE_CODES` catalog.

| Prefix | Subsystem |
|---|---|
| BND | Scope, exact values, and transaction boundaries |
| APR | Approval and rejection |
| CNV | Plan-to-order conversion |
| GAT | Execution safety gates |
| IDM | Idempotency and intent-before-submit |
| ORD | Order lifecycle, retry, and cancellation |
| FIL | Fill and exact accounting |
| REC | Reconciliation and residual work |
| BRK | Broker ports and execution modes |
| KIL | Kill switches and recovery |
| AUD | Evidence, integrity, and safe failure |
| ABU | Misuse, abuse, and protected boundaries |

## BND: Scope, Exact Values, and Transaction Boundaries

| Rule | Requirement | Stable failure |
|---|---|---|
| BND-001 | Every U05 command references exactly one canonical `PortfolioId`; every child plan, approval, order, fill, reconciliation, and kill-switch fact has the same scope. | `EXECUTION_SCOPE_INVALID` |
| BND-002 | Cross-portfolio plan, account, instrument, order, fill, lot, or reconciliation input rejects the complete operation without mutation. | `EXECUTION_PORTFOLIO_MISMATCH` |
| BND-003 | Money, prices, quantities, charges, and cash use U01 exact values or lossless canonical decimal input; binary floating-point values are not accounting authority. | `EXECUTION_EXACT_VALUE_REQUIRED` |
| BND-004 | Equity quantity is non-negative whole-share `Quantity`; fractional, negative, NaN-like, or overflowing values are invalid. | `EXECUTION_QUANTITY_INVALID` |
| BND-005 | Portfolio financial changes, execution state, reservations, immutable evidence, and dispatch intent commit or roll back atomically through U02. | `EXECUTION_ATOMICITY_FAILED` |
| BND-006 | U05 application/domain code cannot issue SQL, hold a raw database connection, attach another database, or open `stock-watcher.db`. | `EXECUTION_PERSISTENCE_BYPASS` |
| BND-007 | U02 transaction callbacks remain synchronous; no broker call, timer, Promise, or network wait occurs inside them. | `EXECUTION_ASYNC_TRANSACTION_FORBIDDEN` |
| BND-008 | External calls occur only after the relevant intent/attempt fact commits and before the corresponding outcome transaction starts. | `EXECUTION_EXTERNAL_CALL_BOUNDARY` |
| BND-009 | U05 extensions to U02 ports and event codecs are additive and preserve existing U01 repository/event invariants. | `EXECUTION_CONTRACT_REGRESSION` |
| BND-010 | Any optimistic portfolio, holding, approval, order, or kill-switch version conflict rolls back and requires state refresh. | `EXECUTION_VERSION_CONFLICT` |

## APR: Approval and Rejection

| Rule | Requirement | Stable failure |
|---|---|---|
| APR-001 | Approval accepts only a U04 plan in `APPROVAL_READY`; `DRAFT`, `SUPERSEDED`, `INVALIDATED`, and `EXPIRED` cannot be approved. | `PLAN_NOT_APPROVAL_READY` |
| APR-002 | U05 recomputes/verifies the U04 semantic plan hash before creating approval. | `PLAN_HASH_BINDING_FAILED` |
| APR-003 | Approval binds to plan/run/portfolio/strategy/config/portfolio-version/reconciliation/quote/window/actor lineage and the exact approved logical-order-key set. | `APPROVAL_BINDING_INCOMPLETE` |
| APR-004 | Approval authority expires no later than the U04 execution-window end or a shorter configured approval deadline. Reference-quote expiry blocks placement until a fresh quote passes the immutable price/deviation bounds; it does not silently extend or shorten authority. | `APPROVAL_EXPIRY_INVALID` |
| APR-005 | Basket approval selects every proposed order and no skipped or blocked order. | `APPROVAL_SCOPE_INVALID` |
| APR-006 | Partial approval may remove discretionary orders but cannot alter identity, side, instrument, quantity, sequence, price bound, or policy. | `APPROVAL_MUTATION_FORBIDDEN` |
| APR-007 | Removing or rejecting a `MANDATORY` order blocks execution and requires a new plan; remaining orders cannot proceed as if the mandatory action succeeded. | `MANDATORY_ORDER_NOT_APPROVED` |
| APR-008 | Any material bound-state change transitions approved authority to immutable `INVALIDATED`; elapsed time transitions it to `EXPIRED`. | `APPROVAL_STALE` |
| APR-009 | An approval is consumed atomically when its one execution run is created and cannot authorize another run. | `APPROVAL_ALREADY_CONSUMED` |
| APR-010 | Approval/rejection command replay with equivalent binding is idempotent; the same token with conflicting content fails and audits. | `APPROVAL_IDEMPOTENCY_CONFLICT` |

## CNV: Plan-to-Order Conversion

| Rule | Requirement | Stable failure |
|---|---|---|
| CNV-001 | Only approved U04 `actionBuckets.proposed` entries become order intents; skipped/blocked actions never convert. | `NON_PROPOSED_ORDER_CONVERSION` |
| CNV-002 | Each converted order preserves the U04 logical key, instrument, quantity ceiling, price/cost/tax lineage, reason, and urgency. | `ORDER_LINEAGE_INCOMPLETE` |
| CNV-003 | U04 `BUY` maps to broker `BUY`; U04 `SELL` or `REDUCE` maps to broker `SELL`; no other side is accepted. | `ORDER_SIDE_UNSUPPORTED` |
| CNV-004 | Sells are sorted by canonical `InstrumentId`, followed by buys sorted the same way; sequence numbers are immutable. | `ORDER_SEQUENCE_NON_DETERMINISTIC` |
| CNV-005 | One plan cannot produce two converted orders with the same idempotency key or logical-order identity. | `DUPLICATE_ORDER_INTENT` |
| CNV-006 | An order requires one immutable broker instrument mapping snapshot; missing, stale, non-equity, or conflicting mappings block conversion. | `BROKER_INSTRUMENT_MAPPING_INVALID` |
| CNV-007 | Every order is normalized to CNC/delivery, whole shares, cash funded, long only, and within the approved quantity. | `DELIVERY_ORDER_REQUIRED` |
| CNV-008 | A sell quantity cannot exceed reconciled available delivery quantity after existing reservations. | `SELL_DELIVERY_EXCEEDED` |
| CNV-009 | A buy quantity cannot imply negative cash, margin, collateral use, leverage, or a position above approved hard limits. | `BUY_AFFORDABILITY_FAILED` |
| CNV-010 | Price-bounded delivery limit is the default; unprotected market conversion or caller-selected widening is forbidden. | `UNBOUNDED_ORDER_PRICE_FORBIDDEN` |

## GAT: Execution Safety Gates

| Rule | Requirement | Stable failure |
|---|---|---|
| GAT-001 | Archived, missing, or integrity-invalid portfolios cannot approve or execute orders. | `PORTFOLIO_NOT_EXECUTABLE` |
| GAT-002 | Environment and application live-enable gates default false and must both be explicitly true for live submission. | `LIVE_EXECUTION_DISABLED` |
| GAT-003 | Portfolio mode and strategy live-eligibility gates are independent; neither substitutes for the other. | `LIVE_POLICY_NOT_ELIGIBLE` |
| GAT-004 | Broker-account binding, broker health, credential availability, and exact CNC capability must all pass for live work. | `BROKER_NOT_EXECUTION_READY` |
| GAT-005 | Current approval and every binding field are revalidated immediately before each placement. | `APPROVAL_REVALIDATION_FAILED` |
| GAT-006 | A fresh `MATCHED` or explicitly allowable `MATCHED_WITH_ROUNDING` reconciliation with no unknown order is required before execution and each dependent phase. | `RECONCILIATION_NOT_CURRENT` |
| GAT-007 | Global and portfolio kill switches are checked before run creation, reservation, every placement, and every safe retry. | `KILL_SWITCH_ACTIVE` |
| GAT-008 | Routine execution occurs only on U04's next eligible date and inside its Asia/Kolkata window; same-session routine work is forbidden. | `EXECUTION_WINDOW_INVALID` |
| GAT-009 | Execution quotes require valid provenance, source freshness, and strategy price-deviation bounds relative to the approved estimate. | `EXECUTION_PRICE_STALE` |
| GAT-010 | Universe, symbol, product, count, daily notional, position, concentration, turnover, liquidity, drawdown, rejection, data, cash, conflict, and automation gates must all pass; one failure blocks. | `PRE_TRADE_RISK_BLOCKED` |

## IDM: Idempotency and Intent-Before-Submit

| Rule | Requirement | Stable failure |
|---|---|---|
| IDM-001 | Order idempotency key is a versioned canonical hash of portfolio, run, plan, logical order, instrument, mapped symbol, normalized side, and sequence. | `ORDER_IDEMPOTENCY_KEY_INVALID` |
| IDM-002 | Canonical order payload hash includes every broker-material and approval-bound field and is created exactly once when the order reaches `INTENT_RECORDED`; a `PLANNED` buy carries only an immutable approved quantity ceiling. | `ORDER_PAYLOAD_HASH_INVALID` |
| IDM-003 | Repeating the same key and equivalent payload returns the existing logical order and never invokes placement again. | N/A |
| IDM-004 | After intent finalization, repeating the same key with a different payload fails, preserves prior state, and appends an integrity event. Pre-finalization affordability reduction within the approved ceiling is the one permitted transition from order shell to canonical intent. | `ORDER_IDEMPOTENCY_CONFLICT` |
| IDM-005 | Exactly one execution run exists per consumed approval; repeated execute commands return that run. | `DUPLICATE_EXECUTION_RUN` |
| IDM-006 | `INTENT_RECORDED` and `SUBMISSION_IN_FLIGHT` attempt evidence commit before calling the adapter. | `ORDER_INTENT_NOT_PERSISTED` |
| IDM-007 | Submission attempt number is monotone, bounded, and attached to the same immutable order identity. | `SUBMISSION_ATTEMPT_INVALID` |
| IDM-008 | A process crash after the attempt marker and before a proved result yields `UNKNOWN`, not a fresh placement opportunity. | `SUBMISSION_OUTCOME_UNKNOWN` |
| IDM-009 | Idempotency identity and approved ceilings are immutable from `PLANNED`; canonical intent and outcome facts are immutable from `INTENT_RECORDED` and cannot be updated to represent a different semantic order. | `ORDER_INTENT_IMMUTABLE` |
| IDM-010 | Command, approval, execution, cancellation, reconciliation-adjustment, and kill-switch mutations each require independent stable idempotency. | `MUTATION_IDEMPOTENCY_REQUIRED` |

## ORD: Order Lifecycle, Retry, and Cancellation

| Rule | Requirement | Stable failure |
|---|---|---|
| ORD-001 | Order transitions follow only the documented closed state machine; unsupported or backward transitions fail. | `ORDER_STATE_TRANSITION_INVALID` |
| ORD-002 | Placement result is exactly `ACKNOWLEDGED`, `REJECTED`, `DEFINITELY_NOT_SENT`, or `UNKNOWN`; adapters cannot invent success. | `SUBMISSION_CERTAINTY_INVALID` |
| ORD-003 | Placement retry is allowed only for `DEFINITELY_NOT_SENT`, with unchanged identity, passing gates, open window, and fewer than three attempts. | `ORDER_RETRY_NOT_SAFE` |
| ORD-004 | Timeout, disconnect, malformed acknowledgement, missing broker ID, process crash, or uncertain transport maps to `UNKNOWN`. | `SUBMISSION_OUTCOME_UNKNOWN` |
| ORD-005 | `UNKNOWN` blocks duplicate placement and every dependent buy until reconciliation proves an outcome. | `UNKNOWN_ORDER_BLOCKS_EXECUTION` |
| ORD-006 | Explicit broker rejection is terminal, releases unused reservation atomically, and is never placement-retried. | `ORDER_REJECTED` |
| ORD-007 | Filled quantity is monotone and cannot exceed approved order quantity; terminal order states never reopen. | `ORDER_FILL_PROGRESS_INVALID` |
| ORD-008 | Cancellation intent persists before the external cancel call; a timeout/false response does not prove cancellation. | `CANCELLATION_OUTCOME_UNKNOWN` |
| ORD-009 | Fill/status processing continues during cancellation; a race fill is applied once before final state is decided. | `CANCELLATION_FILL_RACE_UNRESOLVED` |
| ORD-010 | `CANCELLED` requires broker reconciliation proving no remaining open quantity; sell cancellation blocks buys until reconciliation. | `CANCELLATION_NOT_RECONCILED` |

## FIL: Fill and Exact Accounting

| Rule | Requirement | Stable failure |
|---|---|---|
| FIL-001 | Every fill binds to one portfolio account, broker order, instrument mapping, side, CNC product, and canonical trade time. | `FILL_BINDING_INVALID` |
| FIL-002 | Fill identity uses broker fill/trade ID or the documented canonical fallback fingerprint when no ID exists. | `FILL_IDENTITY_INVALID` |
| FIL-003 | Equivalent duplicate fill is an idempotent no-op; same identity with changed content is an integrity failure. | `FILL_IDEMPOTENCY_CONFLICT` |
| FIL-004 | New accounting uses only incremental quantity not already applied; cumulative regressions or overfills block. | `FILL_CUMULATIVE_INVALID` |
| FIL-005 | Fill, order progress, reservation release, portfolio/holding/lot mutation, and evidence commit atomically. | `FILL_ACCOUNTING_ATOMICITY_FAILED` |
| FIL-006 | Buy fill debits exact notional plus confirmed charges/taxes and cannot produce negative cash. | `BUY_FILL_NEGATIVE_CASH` |
| FIL-007 | Buy fill creates/increases the holding and creates a fill-sourced lot with exact quantity/unit cost lineage. | `BUY_FILL_LOT_INVALID` |
| FIL-008 | Buy quantity is not treated as available delivery until confirmed settlement/broker state permits it. | `UNCONFIRMED_DELIVERY_AVAILABILITY` |
| FIL-009 | Sell fill cannot exceed approved, reserved, total, open-lot, or available-delivery quantity. | `SELL_FILL_QUANTITY_EXCEEDED` |
| FIL-010 | Sell fill applies immutable U04 lot-disposition lineage; unresolved lot differences block rather than invent a disposition. | `SELL_FILL_LOT_MISMATCH` |
| FIL-011 | Live sell proceeds become buy budget only after broker available cash is confirmed; estimates and unsettled funds are excluded. | `UNCONFIRMED_SALE_PROCEEDS` |
| FIL-012 | Holding quantity equals open-lot quantity after every accepted fill; no short, leverage, margin-funded, or cross-portfolio state is possible. | `POST_FILL_POSITION_INTEGRITY_FAILED` |

## REC: Reconciliation and Residual Work

| Rule | Requirement | Stable failure |
|---|---|---|
| REC-001 | Reconciliation runs before execution, after sells, after buys, after partial fills, after cancellation, at window/end-of-day boundaries, after restart, and on safe manual request. | `RECONCILIATION_REQUIRED` |
| REC-002 | Broker account, holdings, delivery, cash, open orders, statuses, and fills form one coherent snapshot or retain endpoint times that prove comparability. | `BROKER_SNAPSHOT_INCOHERENT` |
| REC-003 | Quantity, order identity, and fill identity have zero tolerance. | `RECONCILIATION_QUANTITY_MISMATCH` |
| REC-004 | Cash tolerance is zero except one INR minor unit backed by explicit broker rounding evidence. | `RECONCILIATION_CASH_MISMATCH` |
| REC-005 | Reconciliation results are closed to `MATCHED`, `MATCHED_WITH_ROUNDING`, `MISMATCH`, `UNKNOWN`, or `BLOCKED`. | `RECONCILIATION_STATE_INVALID` |
| REC-006 | Unknown broker status is distinct from failed, rejected, cancelled, expired, open, or filled. | `BROKER_STATUS_UNKNOWN` |
| REC-007 | Missing known fills are applied only by the fill algorithm; raw snapshot replacement cannot mutate accounting. | `RECONCILIATION_FILL_BYPASS` |
| REC-008 | External manual holdings/orders/cash changes create immutable differences and require separately authorized adjustment; history is never overwritten. | `EXTERNAL_CHANGE_REQUIRES_REVIEW` |
| REC-009 | Dependent execution requires a fresh matched result and no unresolved mapping, mismatch, unknown, or foreign broker order. | `RECONCILIATION_BLOCKS_DEPENDENCY` |
| REC-010 | Partial/rejected/expired/cancelled remaining work is explicit immutable `ResidualWork`; it never silently becomes a new order. | `RESIDUAL_WORK_NOT_RECORDED` |
| REC-011 | Re-running comparison on unchanged canonical local/external snapshots is idempotent and does not mutate accounting. | `RECONCILIATION_NON_DETERMINISTIC` |
| REC-012 | Reconciliation facts are immutable; resolution creates a new linked run rather than rewriting the prior mismatch/unknown fact. | `RECONCILIATION_HISTORY_MUTATION` |

## BRK: Broker Ports and Execution Modes

| Rule | Requirement | Stable failure |
|---|---|---|
| BRK-001 | Application services depend only on normalized `BrokerPort`; concrete SDK/client classes are adapter details. | `BROKER_PORT_BYPASS` |
| BRK-002 | Adapter selection comes from trusted composition and portfolio mode; user payloads cannot name a concrete live adapter. | `BROKER_SELECTION_UNAUTHORIZED` |
| BRK-003 | `OBSERVE` and `RECOMMENDATION` create no execution orders; `PAPER` can select only paper. | `OPERATING_MODE_NO_ORDER_AUTHORITY` |
| BRK-004 | Paper, fake, and dry-run adapters cannot receive live credentials or invoke non-test network submission. | `NON_LIVE_ADAPTER_CAPABILITY_LEAK` |
| BRK-005 | Dry-run returns `DRY_RUN_RECORDED`, never a broker acknowledgement/fill, and does not mutate financial accounting. | `DRY_RUN_SUCCESS_MISREPRESENTED` |
| BRK-006 | Live failure cannot fall back to paper/dry-run with a success response; mode changes require a new command. | `LIVE_FALLBACK_FORBIDDEN` |
| BRK-007 | Zerodha adapter must map normalized CNC to reviewed delivery semantics and map every undocumented status to unknown. | `ZERODHA_CONFORMANCE_FAILED` |
| BRK-008 | Sharekhan adapter must explicitly override/reject the current `INTRADAY` default and prove an allowlisted delivery mapping. | `SHAREKHAN_CNC_MAPPING_REQUIRED` |
| BRK-009 | Current legacy number aggregates/raw errors are not exact accounting or safe client output; adapters normalize losslessly and redact. | `BROKER_NORMALIZATION_UNSAFE` |
| BRK-010 | Live adapters remain disabled until conformance tests prove exact values, status mapping, deadlines, certainty, CNC, cancellation, fills, and redaction. | `LIVE_ADAPTER_NOT_CERTIFIED` |

## KIL: Kill Switches and Recovery

| Rule | Requirement | Stable failure |
|---|---|---|
| KIL-001 | Global and portfolio kill switches default inactive but are checked independently; either active switch blocks affected new intent/submission. | `KILL_SWITCH_ACTIVE` |
| KIL-002 | Activation requires canonical scope, actor, reason, time, correlation, and evidence and is idempotent for equivalent active state. | `KILL_SWITCH_ACTIVATION_INVALID` |
| KIL-003 | Activation blocks new placement/retry, requests cancellation of cancellable orders, permits reconciliation/status/fill work, and never liquidates. | `KILL_SWITCH_BEHAVIOR_INVALID` |
| KIL-004 | Reset requires distinct privileged role, MFA evidence, reason, healthy required dependencies, cleared trigger, and no unresolved unknown/mismatch. | `KILL_SWITCH_RESET_BLOCKED` |
| KIL-005 | Reset permits future revalidation only; it never resumes, recreates, retries, or places an earlier order automatically. | `KILL_SWITCH_AUTO_RESUME_FORBIDDEN` |
| KIL-006 | Negative cash/invariant failure, ambiguous submission, material mismatch, stale execution data, open broker circuit, or configured rejection/error limit activates containment. | `EXECUTION_CONTAINMENT_REQUIRED` |
| KIL-007 | Recovery starts with live placement capability disabled and verifies database, migration, audit, and kill-switch integrity first. | `RECOVERY_PREFLIGHT_FAILED` |
| KIL-008 | On restart, persisted `SUBMISSION_IN_FLIGHT` becomes `UNKNOWN`; broker-ID orders are queried and never placed again. | `RECOVERY_ORDER_AMBIGUOUS` |
| KIL-009 | Repeated recovery is idempotent: unique fills apply once, evidence links once, and no logical order duplicates. | `RECOVERY_NON_IDEMPOTENT` |
| KIL-010 | Expired approval/window, unresolved recovery, or stale plan creates residual/replan work; process restart is never execution authority. | `RECOVERY_REAPPROVAL_REQUIRED` |

## AUD: Evidence, Integrity, and Safe Failure

| Rule | Requirement | Stable failure |
|---|---|---|
| AUD-001 | Every approval, rejection, intent, attempt, acknowledgement, status, fill, cancellation, reconciliation, adjustment, kill-switch, and recovery transition emits immutable portfolio-scoped evidence. | `EXECUTION_EVIDENCE_MISSING` |
| AUD-002 | Evidence uses the U02 append-only hash chain with contiguous sequence, previous hash, schema version, actor, command, correlation, causation, and canonical payload. | `EXECUTION_AUDIT_CHAIN_INVALID` |
| AUD-003 | Mutable dispatch/retry bookkeeping remains separate from immutable financial/audit facts. | `EXECUTION_AUDIT_DISPATCH_COUPLED` |
| AUD-004 | Financial mutation cannot commit if its required evidence or dispatch intent fails to persist. | `EXECUTION_AUDIT_ATOMICITY_FAILED` |
| AUD-005 | Evidence payloads are bounded and allowlisted; credentials, tokens, account IDs, raw broker payloads/errors, paths, SQL, stack traces, and arbitrary text are forbidden. | `EXECUTION_SENSITIVE_CONTEXT` |
| AUD-006 | Broker account references use stable internal bindings and redacted external identifiers. | `BROKER_ACCOUNT_REDACTION_FAILED` |
| AUD-007 | Unknown enum/status/schema values fail closed and remain available only as redacted opaque evidence, never normalized to success. | `EXECUTION_UNKNOWN_VALUE` |
| AUD-008 | Expected failures return one stable code/retryability and contain no partial state or success-shaped default. | `EXECUTION_FAILURE_SHAPE_INVALID` |
| AUD-009 | Invariant corruption or verifier disagreement rolls back and activates containment; it is not converted to an expected successful outcome. | `EXECUTION_INVARIANT_FAILED` |
| AUD-010 | Post-commit publication happens only after successful U02 commit and is idempotent; publication failure does not roll back committed financial facts. | `EXECUTION_POST_COMMIT_VIOLATION` |

## ABU: Misuse, Abuse, and Protected Boundaries

| Rule | Requirement | Stable failure |
|---|---|---|
| ABU-001 | Portfolio U05 never invokes legacy `/trade-execution`, `/paper-trades`, simulation state, or intraday policy. | `LEGACY_EXECUTION_PATH_FORBIDDEN` |
| ABU-002 | AI advisory, explanation, sentiment, or generated text cannot approve, size, sequence, submit, cancel, reconcile-adjust, reset, or enable live execution. | `AI_EXECUTION_AUTHORITY_FORBIDDEN` |
| ABU-003 | Manual/operator/scheduler invocation uses identical plan, approval, kill, session, risk, idempotency, and reconciliation gates. | `MANUAL_EXECUTION_BYPASS` |
| ABU-004 | Portfolio mode, environment flag, broker credential, or one approval alone is never sufficient live authority. | `SINGLE_GATE_EXECUTION_BYPASS` |
| ABU-005 | Stale plan/price/account state cannot be accepted because a trade appears profitable or urgent. | `STALE_EXECUTION_BYPASS` |
| ABU-006 | Unknown submission/status cannot be classified as failed to permit resubmission or as success to permit dependent buys. | `UNKNOWN_OUTCOME_MISCLASSIFIED` |
| ABU-007 | Estimated sale proceeds, collateral, intraday margin, unsettled funds, or margin-funded holdings cannot satisfy cash/delivery checks. | `UNCONFIRMED_FUNDS_BYPASS` |
| ABU-008 | Caller/adapter cannot change CNC, side, quantity ceiling, instrument mapping, sequence, or price protection after approval. | `APPROVED_ORDER_TAMPERED` |
| ABU-009 | Kill switch cannot delete history, clear unknown outcomes, waive reconciliation, or create liquidation orders. | `KILL_SWITCH_MISUSE` |
| ABU-010 | A fake, paper, dry-run, benchmark, property, or automated test composition that can reach a real SDK placement method is a blocking architecture failure. | `TEST_REAL_ORDER_PATH_REACHABLE` |

## Deterministic Rule Precedence

When several rules fail, evaluate in this order:

1. BND scope, exact-value, lifecycle, and transaction eligibility.
2. APR plan and approval authority.
3. GAT live, kill, reconciliation, time, price, and risk gates.
4. CNV conversion integrity.
5. IDM identity and previously persisted intent.
6. ORD certainty, lifecycle, retry, and cancellation.
7. FIL identity and accounting.
8. REC comparison and dependent-work eligibility.
9. BRK adapter normalization/conformance.
10. KIL containment and recovery.
11. AUD evidence/commit integrity.
12. ABU architecture/misuse containment.

## Mandatory Example Scenarios

1. Approve and fully fill a paper sell-then-buy basket while preserving exact cash and lot lineage.
2. Reject live execution when each independent gate is omitted one at a time.
3. Invalidate approval after one portfolio-version, plan-hash, reconciliation, execution-window, or price-bound change.
4. Replay equivalent execute/place/fill/reconcile commands without duplicate order, fill, or accounting effect.
5. Reject conflicting payload under the same idempotency key.
6. Time out after placement attempt, mark unknown, restart, reconcile the acknowledged broker order, and never place twice.
7. Process partial fill followed by cancel race and final reconciliation.
8. Block buys until sell fills and confirmed available cash reconcile.
9. Reject sell above available delivery and every margin/intraday product.
10. Reject Sharekhan composition that relies on the current `INTRADAY` default.
11. Activate portfolio/global kill switches, cancel what is safely cancellable, reconcile, and never liquidate.
12. Detect an external manual order and preserve it as a reviewed difference rather than overwriting local history.
13. Roll back fill/accounting when audit persistence fails.
14. Recover repeatedly after restart with no duplicate placement or fill.
15. Prove automated tests compose no credential or live placement capability.

## Story Traceability

| Stories | Rule coverage |
|---|---|
| US-021 | BND, ORD, FIL, REC, BRK |
| US-022 | GAT-002 through GAT-010, BRK-002 through BRK-010, ABU-004, ABU-010 |
| US-023 | APR and AUD |
| US-024 | IDM, ORD-002 through ORD-006, REC-006 |
| US-025 | ORD, FIL, REC, KIL-007 through KIL-010 |
| US-026 | BRK, BND-003, AUD-005 through AUD-007 |
| US-027 | GAT, KIL, ABU |
| US-014, US-019 | APR-008, GAT-010, CNV-008, FIL-009/FIL-010 |
| US-028, US-035, US-038 | IDM-005, KIL recovery, AUD, ABU-002/003 |

## PBT-01 Rule Families

| Rule ranges | Property categories |
|---|---|
| BND-001 through BND-010 | Invariant, easy verification, stateful transaction model |
| APR-001 through APR-010 | Round-trip, idempotence, stateful approval model |
| CNV-001 through CNV-010 | Invariant, deterministic ordering, easy verification |
| GAT-001 through GAT-010 | Invariant, stateful gate model |
| IDM-001 through IDM-010 | Idempotence, invariant, stateful retry/crash model |
| ORD-001 through ORD-010 | Stateful order/cancellation model |
| FIL-001 through FIL-012 | Idempotence, exact-accounting invariant, model comparison |
| REC-001 through REC-012 | Idempotence, commutativity of canonical ordering, stateful model |
| BRK-001 through BRK-010 | Round-trip codecs, contract oracle |
| KIL-001 through KIL-010 | Stateful kill/recovery model, idempotence |
| AUD-001 through AUD-010 | Round-trip, chain invariant, atomicity |
| ABU-001 through ABU-010 | Negative properties and architecture invariants |

## Extension Compliance

### Security

- Applicable SECURITY-03, SECURITY-05, SECURITY-08, SECURITY-11 through SECURITY-15 are compliant through BND, GAT, BRK, AUD, and ABU.
- SECURITY-01 is shared with U02/U06; U05 forbids secret persistence/output.
- SECURITY-04 and endpoint checks are deferred to U07; SECURITY-09/10 to code/delivery stages.
- SECURITY-02, SECURITY-06, and SECURITY-07 are N/A to the approved local topology.
- Blocking findings: none.

### Resiliency

- RESILIENCY-01 and RESILIENCY-10 are directly compliant through criticality, dependency isolation, deadlines, safe retries, ambiguity blocking, recovery, and reconciliation.
- RESILIENCY-02 and RESILIENCY-05 through RESILIENCY-07 are inherited/supported by immutable evidence and health contracts for U06.
- RESILIENCY-03/04 and RESILIENCY-11 through RESILIENCY-15 remain owned by U06/U09.
- RESILIENCY-08/09 are N/A to local topology.
- Blocking findings: none.

### Property-Based Testing

- PBT-01 is compliant through complete component/rule property identification.
- PBT-02 through PBT-08 and PBT-10 are carried forward to code generation.
- PBT-09 is already satisfied as a selected-stack requirement by `fast-check` plus Node's test runner; no package change occurs in this stage.
- Blocking findings: none.

## Cross-Artifact References

- Algorithms, state machines, decisions, misuse cases: [business-logic-model.md](business-logic-model.md)
- Entities and port contracts: [domain-entities.md](domain-entities.md)
