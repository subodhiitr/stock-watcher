# U05 Execution and Reconciliation Deployment Architecture

## Runtime Placement

| Host boundary | Deployed content |
|---|---|
| Local Windows workstation | Existing Node.js application process and U02 portfolio database |
| Node.js process | U01-U04 portfolio modules plus U05 domain, application, ports, resilience, adapters, and composition |
| U02 database owner | One portfolio SQLite connection, migration registry, transactions, event chain, health, and backup |
| External broker boundary | Future certified Zerodha or Sharekhan adapter only; outbound TLS and disabled by default |
| Operations boundary | Future U06 scheduler, dispatch, observability, backup operations, and runbooks |
| HTTP/UI boundary | Future U07/U08 portfolio routes and UI; no U05 listener |

## Logical-to-Physical Mapping

| Logical components | Physical placement |
|---|---|
| LC-U05-01 through LC-U05-11 | Pure in-process TypeScript modules |
| LC-U05-12 through LC-U05-16 | In-process interfaces |
| LC-U05-17 through LC-U05-25 | In-process application coordinators |
| LC-U05-26 | Existing U02 connection/transaction boundary through prepared adapters |
| LC-U05-27, LC-U05-28 | In-process non-live adapters with no network |
| LC-U05-29 | Test process only |
| LC-U05-30, LC-U05-31 | Optional isolated live adapters; unavailable until certified |
| LC-U05-32 | In-memory per-dependency resilience/health state |
| LC-U05-33 | Trusted application composition |
| LC-U05-34 | Side-effect-free public module entry |
| LC-U05-35, LC-U05-36 | Test/CI process only |

## Startup Sequence

1. Resolve and validate the U02 database path and encryption attestation.
2. Open the single `PortfolioDatabaseOwner`.
3. Verify migration registry checksums and apply the next approved U05 migration when explicitly running an upgraded artifact.
4. Run foreign-key and integrity checks.
5. Construct transaction-scoped U05 persistence adapters.
6. Construct injected clock, timer, identifier, quote/calendar/mapping, and policy ports.
7. Construct paper and dry-run adapters without credential or live network capability.
8. Construct the broker resilience governor and mark all external dependency health `UNKNOWN`.
9. Keep live placement capability absent. Construct a read-only broker recovery capability only when read-contract certification, account binding, credential health, and dependency health pass.
10. Construct approval, execution, fill, cancellation, reconciliation, recovery, and kill-switch services.
11. Run recovery preflight with live placement disabled.
12. Classify persisted non-terminal work and, when the read-only recovery capability is healthy, activate required reconciliation scheduling through U06 or explicit application orchestration.
13. Mark paper execution ready when persistence and policy dependencies are healthy.
14. Construct live placement capability only when every independent runtime gate is true and recovery leaves no blocking ambiguity/mismatch; otherwise report disabled/degraded without falling back modes.

No startup step submits, cancels, fills, or adjusts an order.

## Normal Placement Sequence

1. The caller reaches U05 through a future authenticated U07 command boundary.
2. U05 loads exact portfolio, plan, approval, policy, reconciliation, quote, mapping, and kill state.
3. The gate validates portfolio/account scope and every independent authority/risk condition.
4. A short U02 transaction finalizes intent, reserves exact resources, and records the attempt.
5. After commit, the selected adapter performs one bounded operation.
6. A second short U02 transaction records the normalized certainty/outcome.
7. The injected timer causes the first status/fill check to begin within two seconds.
8. Status/fill/cancellation/reconciliation work continues from committed facts.

If step 5 is uncertain, the durable state becomes `UNKNOWN`; no sequence repeats placement.

## Reconciliation Sequence

1. Load the immutable local comparison snapshot.
2. Collect account, holdings, cash, order, status, and fill evidence through bounded port calls.
3. Require one coherent broker cursor or endpoint times within ten seconds.
4. Normalize exact values and compare canonical collections in memory.
5. Persist one immutable reconciliation result/difference set in a short transaction.
6. Route missing known fills through the fill-accounting path.
7. Block dependent placement on mismatch, unknown, excess skew, foreign order, or mapping difference.
8. Require separate authority for any adjustment; never replace accounting from a snapshot.

## Restart and Recovery Sequence

### Phase 1 - Local Classification with Placement Disabled

1. Start with live placement capability absent.
2. Verify database, migration, event-chain, and kill-switch integrity.
3. Scan non-terminal runs/orders by canonical indexed order.
4. Convert persisted in-flight attempts without proved outcomes to `UNKNOWN`.

### Recovery Read Gate

Phase 2 begins only after the adapter's read contracts are certified and account binding, credential health, and dependency health pass. This creates a read-only recovery capability for status, fills, open orders, holdings, and cash. It does not create or expose placement or cancellation authority.

### Phase 2 - Broker Evidence Convergence with Placement Still Disabled

5. Query broker references through bounded status/fill reads; placement remains structurally blocked.
6. Deduplicate and apply each newly proved fill once.
7. Persist linked reconciliation and residual facts.
8. Report progress every 500 examined fills.
9. Converge broker-provable outcomes within two cycles or five minutes after dependencies are healthy.
10. Keep externally unprovable outcomes `UNKNOWN` indefinitely and require operator review/replan.

Only after Phase 2 leaves no blocking ambiguity/mismatch may startup step 14 evaluate every independent live placement gate.

## Shutdown Sequence

1. Stop accepting new approval/execution/adjustment/reset commands.
2. Activate a local draining gate that blocks new intent and placement.
3. Permit in-flight external calls to reach their configured deadline.
4. Persist any normalized returned outcome; an unproved result becomes `UNKNOWN`.
5. Stop new polling while preserving durable follow-up facts for restart.
6. Finish or roll back any current synchronous U02 transaction.
7. Flush existing post-commit dispatch bookkeeping through its owner.
8. Signal to the application composition that all U05 in-flight work is complete; U02 manages its own checkpoint and close lifecycle after every sharing unit has drained.

Shutdown never infers cancellation, retries placement, liquidates, or changes operating mode.

## Failure Containment

| Failure | Containment |
|---|---|
| Database busy/version conflict | Roll back; typed refresh/retry result; no broker call |
| Migration/integrity failure | Startup fails closed; live absent; restore procedure required |
| Placement deadline/disconnect/crash | Persist or recover `UNKNOWN`; duplicate placement blocked |
| Broker rejection | Terminal rejection; release only broker-proved unused reservation |
| Cancellation timeout/false response | Remain cancel-pending; continue status/fill reconciliation |
| Race fill during cancel | Apply unique fill once; completing fill becomes filled |
| Circuit open/saturation | Fail live operation explicitly; no mode fallback |
| Endpoint snapshot skew over ten seconds | Reconciliation blocked unless coherent cursor proves snapshot |
| Unknown broker status | Preserve unknown; never coerce to failed/cancelled |
| External manual activity | Immutable difference; separately authorized adjustment |
| Negative cash/position/lot invariant | Roll back, contain, activate kill-switch policy |
| Event publication failure | Keep committed fact; retry dispatch idempotently |
| Process crash | Recover from U02 facts; hidden memory grants no authority |

## Deployment and Rollback

The approved deployment style is direct local replacement with database-aware controls:

1. produce a versioned artifact and complete focused/full verification;
2. stop portfolio work and verify a consistent encrypted U02 backup;
3. apply the new artifact and numbered migration;
4. run startup integrity, migration, repository, codec, event-chain, non-live, and recovery checks;
5. keep live disabled unless separately certified and explicitly enabled;
6. on failure, stop work and execute the migration's reviewed reversal or restore the verified backup with the previous artifact;
7. validate portfolio/event integrity after rollback.

No blue/green, canary, rolling node set, cloud failover, or automatic schema downgrade is used.

## Environment Isolation

| Concern | Development | Test | Local production |
|---|---|---|---|
| Database | Dedicated configured path | Unique temporary path | U02 production path |
| Broker mode | Paper/dry-run | Fake/paper/dry-run | Paper default; certified live optional |
| Credentials | Not required for default mode | Forbidden | Trusted composition only for future live |
| Network | None by default | Non-loopback prohibited | Outbound TLS only for certified live |
| Clock/timer | Real injected implementation | Fake deterministic implementation | Real injected implementation |
| Seed | Explicit for paper simulation | Fixed/logged/replayable | Policy snapshot if paper mode |

## Operational Handoff

U06 must later provide:

- durable leases and schedules for polling, reconciliation, recovery, and window boundaries;
- process and deep dependency health surfaces;
- centralized logs, metrics, dashboards, alerts, and at least 90-day security-event retention;
- backup schedule/retention, restore drill, recovery/failback runbooks;
- lightweight incident severity, containment, communication, recovery, and COE tracking.

U07 must later provide authenticated portfolio-scoped commands, privileged role/MFA evidence, endpoint validation/rate limits, and execution views. U09 must execute integrated release, scan/SBOM, rollback, capacity, and recovery evidence.

## Architecture Safety Assertions

- No U05 component opens an inbound listener.
- No non-live composition imports or constructs a live broker SDK.
- No broker call occurs inside a U02 transaction.
- No U05 component opens or attaches `stock-watcher.db`.
- No credential enters a U05 domain/application/persistence/event/test contract.
- No timeout, restart, health result, or operating mode creates execution authority.
- No test or benchmark can submit a real order.
- No infrastructure change is performed by these documents.
