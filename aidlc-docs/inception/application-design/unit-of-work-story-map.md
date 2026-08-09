# Portfolio Management Unit Story Map

## Mapping Rules

- Every approved story has exactly one primary owning unit.
- Supporting units supply contracts, persistence, adapters, protocol surfaces, UI, or integrated verification without duplicating business ownership.
- U09 verifies all stories but is primary only for the integrated capacity, CI, and supply-chain story.
- Story titles and acceptance criteria remain authoritative in `aidlc-docs/inception/user-stories/stories.md`.

## Complete Story Ownership

| Story | Title | Primary unit | Supporting integration units |
|---|---|---|---|
| US-001 | Initialize the Portfolio Domain | U02 | U01, U06, U09 |
| US-002 | Create Independent Portfolios | U01 | U02, U07, U08, U09 |
| US-003 | Select a Portfolio Without State Leakage | U08 | U07, U09 |
| US-004 | Archive a Portfolio Safely | U01 | U02, U07, U08, U09 |
| US-005 | Assign and Change Strategy Versions | U01 | U02, U03, U07, U08, U09 |
| US-006 | Register Horizon Presets | U03 | U02, U08, U09 |
| US-007 | Create a Validated Strategy Version | U03 | U02, U07, U09 |
| US-008 | Activate Only Evidence-Backed Strategies | U03 | U02, U06, U07, U09 |
| US-009 | Allocate Multiple Strategy Sleeves | U01 | U02, U03, U04, U09 |
| US-010 | Ingest Provenanced Point-in-Time Data | U03 | U02, U06, U09 |
| US-011 | Build the Eligible Universe | U03 | U02, U04, U09 |
| US-012 | Calculate Deterministic Signals and Regimes | U03 | U02, U04, U09 |
| US-013 | Fail Closed on Data or Dependency Failure | U03 | U06, U07, U09 |
| US-014 | Process Corporate Actions | U03 | U02, U05, U06, U09 |
| US-015 | Construct Ideal and Executable Targets | U04 | U02, U03, U09 |
| US-016 | Enforce Horizon Rebalance Cadence | U04 | U02, U03, U06, U09 |
| US-017 | Plan Costs and Taxes | U04 | U02, U03, U09 |
| US-018 | Review an Explainable Rebalance Preview | U04 | U02, U07, U08, U09 |
| US-019 | Handle Interim Risk Rebalances | U04 | U03, U05, U06, U09 |
| US-020 | Use Advanced Optimization Safely | U04 | U03, U09 |
| US-021 | Execute Paper Orders Through the Real State Machine | U05 | U02, U04, U06, U07, U08, U09 |
| US-022 | Keep Live Execution Disabled by Default | U05 | U02, U06, U07, U08, U09 |
| US-023 | Approve a Current Order Basket | U05 | U02, U04, U07, U08, U09 |
| US-024 | Submit Orders Idempotently | U05 | U02, U07, U09 |
| US-025 | Reconcile Partial and Unknown Outcomes | U05 | U02, U06, U07, U08, U09 |
| US-026 | Use Interchangeable Broker Adapters | U05 | U01, U06, U07, U09 |
| US-027 | Enforce Restricted Automation and Kill Switches | U05 | U02, U06, U07, U08, U09 |
| US-028 | Run Portfolio Jobs Exactly Once | U06 | U02, U03, U04, U05, U07, U08, U09 |
| US-029 | Monitor Health and Alerts | U06 | U02, U03, U05, U07, U08, U09 |
| US-030 | Back Up, Restore, and Roll Back Safely | U06 | U02, U07, U08, U09 |
| US-031 | Manage Incidents and Corrections | U06 | U02, U07, U08, U09 |
| US-032 | Use the Portfolio Workspace | U08 | U01, U02, U03, U04, U06, U07, U09 |
| US-033 | Operate an Accessible Safety Interface | U08 | U05, U06, U07, U09 |
| US-034 | Protect Portfolio APIs and Sessions | U07 | U01, U02, U06, U09 |
| US-035 | Audit and Explain Critical Decisions | U06 | U01, U02, U03, U04, U05, U07, U08, U09 |
| US-036 | Backtest Without Look-Ahead or Survivorship Bias | U03 | U02, U04, U05, U09 |
| US-037 | Compare and Validate Horizon Strategies | U03 | U04, U06, U08, U09 |
| US-038 | Keep AI Advisory and Deterministic | U03 | U04, U05, U07, U08, U09 |
| US-039 | Verify Capacity, CI, and Supply Chain | U09 | U01, U02, U03, U04, U05, U06, U07, U08 |

## Primary Ownership Summary

| Unit | Primary stories | Count |
|---|---|---:|
| U01 Portfolio Domain Foundation | US-002, US-004, US-005, US-009 | 4 |
| U02 Portfolio Persistence | US-001 | 1 |
| U03 Strategy, Data, and Research | US-006 through US-008, US-010 through US-014, US-036 through US-038 | 11 |
| U04 Construction and Rebalancing | US-015 through US-020 | 6 |
| U05 Execution and Reconciliation | US-021 through US-027 | 7 |
| U06 Operations, Security, and Recovery | US-028 through US-031, US-035 | 5 |
| U07 API and Runtime Integration | US-034 | 1 |
| U08 React Portfolio Workspace | US-003, US-032, US-033 | 3 |
| U09 Integrated Quality and Delivery | US-039 | 1 |
| **Total** | **US-001 through US-039** | **39** |

## Epic to Unit Coverage

| Epic | Primary units | Integration emphasis |
|---|---|---|
| Epic 1 Portfolio Foundation | U01, U02, U08 | Exact state, isolated persistence, API and UI selection |
| Epic 2 Strategy Lifecycle | U01, U03 | Immutable versions, activation evidence, optional sleeves |
| Epic 3 Data, Eligibility, and Signals | U03 | Point-in-time lineage, deterministic evaluation, corporate actions |
| Epic 4 Construction and Rebalancing | U04 | Targets, costs, taxes, cadence, turnover, risk exceptions |
| Epic 5 Paper and Broker Execution | U05 | Shared state machine, approval, idempotency, reconciliation, automation |
| Epic 6 Scheduling, Operations, and Recovery | U06 | Leases, health, alerts, backup, restore, incident evidence |
| Epic 7 APIs, User Experience, Security, and Audit | U06, U07, U08 | Audit, protected APIs, dedicated accessible React experience |
| Epic 8 Research, AI Policy, and Delivery Quality | U03, U09 | Backtesting, strategy evidence, advisory limits, integrated gates |

## Acceptance-Criteria Ownership

| Acceptance area | Primary evidence owner | Supporting owners |
|---|---|---|
| AC-1 seeded paper portfolio | U02 | U01, U03, U09 |
| AC-2 three immutable presets | U03 | U02, U09 |
| AC-3 multiple isolated portfolios | U01 | U02, U07, U08, U09 |
| AC-4 and AC-5 horizon cadence and EOD-only behavior | U04 | U03, U05, U06, U09 |
| AC-6 broker reconciliation | U05 | U02, U06, U09 |
| AC-7 reproducible scores | U03 | U02, U09 |
| AC-8 constraint-valid targets | U04 | U03, U09 |
| AC-9 explainable plans | U04 | U07, U08, U09 |
| AC-10 paper state machine | U05 | U02, U09 |
| AC-11 and AC-12 disabled live brokers and shared safety contracts | U05 | U06, U07, U09 |
| AC-13 duplicate prevention | U05 | U02, U06, U07, U09 |
| AC-14 kill switches | U05 | U06, U07, U08, U09 |
| AC-15 point-in-time research | U03 | U09 |
| AC-16 selected-portfolio workspace | U08 | U07, U09 |
| AC-17 portfolio-scoped audit | U06 | U01 through U05, U07 through U09 |
| AC-18 recovery target | U06 | U02, U09 |
| AC-19 delivery gates | U09 | U01 through U08 |

## Extension Story Coverage

### Security

- Storage encryption and integrity begin with US-001 in U02 and US-030 in U06.
- Access control, API validation, sessions, and headers are primary in US-034 in U07.
- Execution defense in depth is primary in US-022 through US-027 in U05.
- Logging, audit, alerts, and supply-chain evidence are primary in U06 and U09.
- Cloud intermediary, cloud IAM, and cloud network stories are not created because SECURITY-02, SECURITY-06, and SECURITY-07 are N/A for the approved local topology.

### Resiliency

- Workload and dependency failure behavior appears in U03, U05, and U06.
- Jobs, health, recovery, and incidents are primary in US-028 through US-031 in U06.
- Capacity and delivery verification is primary in US-039 in U09.
- RESILIENCY-14 remains a required U06 NFR Design decision.
- Multi-zone, multi-region, and cloud auto-scaling are N/A; local capacity and restore remain mandatory.

### Property-Based Testing

- U01 owns foundational generators and pure invariant definitions.
- U02 owns migration, seed, serialization, transaction, and isolation properties.
- U03 owns deterministic score, normalization, lineage, and backtest properties.
- U04 owns allocation, weight, cadence, turnover, and optimizer-oracle properties.
- U05 owns approval, order, fill, kill-switch, idempotency, and reconciliation state models.
- U06 owns job-lease, audit-chain, backup metadata, and recovery properties.
- U07 owns schema, authorization, stable-error, and HTTP idempotency properties.
- U08 owns selected-portfolio state and stale-response properties where suitable.
- U09 verifies framework configuration, shrinking, seed reproducibility, CI execution, and complementary examples.

