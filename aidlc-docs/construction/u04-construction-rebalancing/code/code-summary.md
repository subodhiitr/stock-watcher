# U04 Construction and Rebalancing Code Summary

## Scope Delivered

U04 implements deterministic, exact, fail-closed portfolio construction and rebalancing under `server\portfolio\`. It does not add persistence, migrations, API routes, UI, deployment resources, live network calls, trade execution, or production dependencies.

## Modified Files

1. `server\portfolio\domain\shared\identifiers.ts`
2. `server\portfolio\domain\errors\failure.ts`
3. `server\portfolio\index.ts`
4. `server\portfolio\tsconfig.json`
5. `package.json`
6. `tests\portfolio\architecture.test.ts`

## Created Runtime Files

### Shared

- `server\portfolio\domain\shared\rebalancing-constants.ts`
- `server\portfolio\domain\shared\rebalancing-reasons.ts`
- `server\portfolio\domain\shared\canonical-plan-hash.ts`
- `server\portfolio\domain\shared\safe-observability-payload-builder.ts`

### Construction Domain

- `server\portfolio\domain\construction\planning-context.ts`
- `server\portfolio\domain\construction\planning-gate.ts`
- `server\portfolio\domain\construction\candidate-projection.ts`
- `server\portfolio\domain\construction\constraint-verifier.ts`
- `server\portfolio\domain\construction\ideal-target-constructor.ts`
- `server\portfolio\domain\construction\implementation-shortfall.ts`

### Rebalancing Domain

- `server\portfolio\domain\rebalancing\whole-share-greedy-allocator.ts`
- `server\portfolio\domain\rebalancing\cost-estimator.ts`
- `server\portfolio\domain\rebalancing\tax-lot-selection.ts`
- `server\portfolio\domain\rebalancing\cadence-and-turnover-policy.ts`
- `server\portfolio\domain\rebalancing\interim-authorization.ts`
- `server\portfolio\domain\rebalancing\action-buckets.ts`
- `server\portfolio\domain\rebalancing\rebalance-plan.ts`
- `server\portfolio\domain\rebalancing\plan-equivalence.ts`
- `server\portfolio\domain\rebalancing\plan-lifecycle.ts`

### Ports, Application, and Adapters

- `server\portfolio\ports\rebalancing\planning-snapshot-port.ts`
- `server\portfolio\ports\rebalancing\policy-and-turnover-port.ts`
- `server\portfolio\ports\rebalancing\plan-history-port.ts`
- `server\portfolio\ports\rebalancing\optimizer-port.ts`
- `server\portfolio\application\rebalancing\planning-snapshot-assembler.ts`
- `server\portfolio\application\rebalancing\optimizer-orchestration-service.ts`
- `server\portfolio\application\rebalancing\rebalance-planning-service.ts`
- `server\portfolio\adapters\optimization\greedy-baseline-optimizer-adapter.ts`
- `server\portfolio\adapters\optimization\small-problem-oracle-optimizer-adapter.ts`

## Created Verification Files

### Test Support

- `tests\portfolio\rebalancing\support\fixtures.ts`
- `tests\portfolio\rebalancing\support\arbitraries.ts`
- `tests\portfolio\rebalancing\support\oracle.ts`
- `tests\portfolio\rebalancing\support\model-commands.ts`
- `tests\portfolio\rebalancing\support\u04-rule-evidence.ts`

### Test Suites

- `tests\portfolio\rebalancing\architecture.test.ts`
- `tests\portfolio\rebalancing\planning-gate.test.ts`
- `tests\portfolio\rebalancing\ideal-target.test.ts`
- `tests\portfolio\rebalancing\executable-target.test.ts`
- `tests\portfolio\rebalancing\cost-tax.test.ts`
- `tests\portfolio\rebalancing\cadence-turnover.test.ts`
- `tests\portfolio\rebalancing\interim-authorization.test.ts`
- `tests\portfolio\rebalancing\rebalance-plan.test.ts`
- `tests\portfolio\rebalancing\optimizer.test.ts`
- `tests\portfolio\rebalancing\edge-cases.test.ts`
- `tests\portfolio\rebalancing\rebalancing.property.test.ts`
- `tests\portfolio\rebalancing\rebalancing.model.test.ts`

### Benchmark

- `benchmark\portfolio-rebalancing.ts`

## Public Surface

`server\portfolio\index.ts` explicitly exports the U04 identifiers, constants, reason catalog, canonical hashing and safe payload builders, planning and rebalance domain contracts, four ports, three application services, and two in-process optimizer adapters. No wildcard export or optimizer implementation dependency was added to `OptimizerPort`.

## Story and Rule Coverage

- US-015: planning gates, ideal targets, whole-share executable targets, constraints, and shortfall.
- US-016: cadence, drift, preferred holds, turnover windows, and next-session timing.
- US-017: effective-dated cost and tax rules, FIFO/HIFO/SPECIFIC lots, and drag policy.
- US-018: action buckets, safe explanations, summaries, hashes, equivalence, and lifecycle.
- US-019: narrow verified interim authorization and AI-only prohibition.
- US-020: bounded optimizer contract, post-verification, exact oracle, and deterministic fallback.
- Functional rule evidence: 117 unique GAT/TGT/EXE/OPT/CTT/CAD/INT/PLN/ABU entries.
- NFR traceability: 100 of 100 approved U04 NFR obligations retained across runtime, tests, benchmark, and declaration review.

## Property and Model Verification

- Pure properties use fixed visible seeds and at least 1,000 generated cases.
- Optimizer fallback and exact-oracle properties use 100 generated small problems.
- The stateful model uses 250 generated sequences of length 1 through 100.
- Model commands remain bounded to 10 holdings, 50 lots, and 5 candidates.
- Eight mandatory business edge scenarios remain permanent example tests.

## Benchmark Outcome

Environment: Node `v24.18.0`, Windows `10.0.26200`, 13th Gen Intel Core i7-1365U. The fixed-seed benchmark passed all 11 gates.

| Phase | p95 | Budget |
|---|---:|---:|
| Plan input hash | 21.635 ms | 40 ms |
| Ideal target | 0.548 ms | 250 ms |
| Executable seed | 10.641 ms | 60 ms |
| Greedy allocation | 7.550 ms | 300 ms |
| Cost and tax | 3.419 ms | 200 ms |
| Constraint verifier | 0.728 ms | 75 ms |
| Plan assembly and hash | 9.623 ms | 80 ms |
| Replay equivalence | 0.014 ms | 120 ms |
| Optimizer timeout and fallback | 0.503 ms | 400 ms |
| Small-problem oracle | 0.050 ms | 250 ms |
| Full plan | 93.895 ms | 1,800 ms |

Observed full-plan heap delta was 38,464 bytes against 192 MiB; optimizer-path heap delta was 34,272 bytes against 64 MiB.

## Verification Status

- Focused U04 suite: 76 of 76 passing.
- Strict portfolio typecheck: passing.
- Declaration-only contract generation: passing; 28 U04 shared, domain, port, application, and adapter declarations were reviewed with the intended explicit public additions and no unexpected legacy drift.
- `verify:portfolio:u04`: passing, including focused tests, strict typecheck, declarations, and all 11 benchmark gates.
- Core portfolio suite: 31 of 31 passing.
- Portfolio persistence suite: 23 of 23 passing.
- U03 compatibility suite: 121 of 121 passing.
- Full repository suite: 795 of 799 passing. Relative to the established 717 of 721 baseline, both total and passing counts increased by 78 while the failure count remained four.
- Remaining failures are the same unrelated legacy snapshot and simulation cases: `dated snapshot loading does not load and filter every available day`, `scheduler keeps an EOD trade open when no executable quote is available`, `Replay reads the migrated SQLite snapshot day`, and `Strategy Advisor diagnostics consume the migrated SQLite snapshot day`. Their stacks remain confined to `tests\backtest-day-snapshot-selection.test.js`, `tests\simulation-runtime-endpoints.test.js`, and `tests\sqlite-snapshot-consumers.test.js`; no U04 path appears.
- Post-implementation review found and corrected an integration gap where drift, preferred-hold, hold-rank-buffer, and after-drag replacement policies were not applied by the top-level planner. The real planning path now freezes policy-suppressed incumbents and paired entrants, preserves hard-constraint and interim precedence, prevents optimizer bypass, and has end-to-end regression coverage for all policy branches.

## Extension Compliance

- Security Baseline: compliant for applicable input validation, safe explanations, integrity, supply-chain, misuse, and fail-closed rules; infrastructure-only rules are N/A.
- Resiliency Baseline: compliant for explicit time budgets, deterministic replay, dependency isolation, and optimizer fallback; deployment and DR topology rules are N/A.
- Property-Based Testing Full: compliant through reusable generators, shrinking, fixed seeds, invariants, replay, idempotence, oracle checks, stateful models, and complementary examples.
- Blocking findings: none.
