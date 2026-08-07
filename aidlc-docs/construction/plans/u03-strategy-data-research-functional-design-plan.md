# U03 Strategy, Data, and Research – Functional Design Plan

## Unit Context

- **Unit**: U03 Strategy, Data, and Research
- **Primary stories**: US-006 through US-008, US-010 through US-014, US-036 through US-038 (eleven stories)
- **Criticality**: High
- **Depends on**: U01 (domain contracts), U02 (persistence)
- **Expected code areas**: `server/portfolio/domain/strategy/`, `server/portfolio/domain/evaluation/`, `server/portfolio/application/evaluation/`, `server/portfolio/adapters/market-data/`, `server/portfolio/adapters/research/`
- **Extensions enabled**: Security Baseline (Yes), Resiliency Baseline (Yes), Property-Based Testing (Yes – Full)
- **Spec inputs**: `C:\data\project\spec\automatic_portfolio_management_spec.md` (sections 6-12, 17-20), `C:\data\project\spec\adaptive_momentum_quality_strategy.json`, `aidlc-docs/inception/requirements/strategy-presets.md`

## Autopilot Mode Notice

The user is unavailable. All ambiguous design decisions are resolved below using the recommended autopilot choice. Each decision references the supporting spec or requirement source.

## Documented Autopilot Decisions

| # | Ambiguity | Recommended Decision | Source |
|---|---|---|---|
| AD-01 | Score normalization method: percentile rank vs robust z-score vs both | Cross-sectional z-score with ±3σ winsorization as primary; optional percentile rank available as alternate visualization. Rationale: z-score supports arithmetic downstream; spec §8.1 says "percentile or robust z-score". | spec §8.1 |
| AD-02 | Regime confirmation count: spec says "two or three" for weakening, "five" for strengthening | Weakening default = 2 consecutive closes; strengthening default = 5 consecutive closes. Both configurable per preset. | spec §9.3 |
| AD-03 | Regime confirmation for crisis | Crisis triggers immediately on single-session data-independent hard criteria. No confirmation period. | spec §9.2 |
| AD-04 | Corporate action: mergers and demergers spanning symbol changes | Block all rebalancing activity for affected instruments until operator confirms new symbol mapping. Status = REQUIRES_MANUAL_REVIEW. | spec §19 |
| AD-05 | Backtest completeness threshold | Same 98% data completeness required as live eligibility filter. Any missing EOD period beyond that rejects the backtest as production-quality. | spec §7.2, §8.1 |
| AD-06 | Hash algorithm for strategy config | SHA-256 of canonical JSON (keys sorted, no trailing whitespace). Stored as 64-char hex string. | spec §22, US-007 |
| AD-07 | Strategy evidence storage format | EvidenceReport JSON payload persisted in `portfolio-management.db`. Human-readable markdown summary available for export/audit. | US-008, US-037 |
| AD-08 | Missing regime data treatment | Treat as Crisis regime (fail closed). Log stable reason code REGIME-DATA-UNAVAILABLE. | US-013, spec §17.3 |
| AD-09 | NSE vs Yahoo priority in research mode | NSE primary (when available), Yahoo fallback. Both labelled non-execution research data. Neither enables production planning. | spec §20.1, US-010 |
| AD-10 | Quality model for financial sector | Financial-sector companies (BFSI) use interest coverage, NIM, GNPA, CAR metrics in place of industrial debt ratios. Non-BFSI uses standard industrial quality metrics. Flag is driven by NIC/GICS sector classification. | spec §8.3 |
| AD-11 | Regime data source (Nifty index history) | Read from the same licensed EOD provider as stock prices. When provider is unavailable, regime fails closed (Crisis). Yahoo Nifty50/500 data used only in research mode. | spec §9.1, AD-08 |
| AD-12 | Conviction multiplier range | Default formula: `0.80 + 0.40 × Percentile(CompositeScore_i)`, range [0.80, 1.20] inclusive. Configurable per strategy. | spec §10.2 |
| AD-13 | Backtest T+1 execution model | Decision on day T uses data available at EOD T. Execution simulated as opening of day T+1 within the 09:45–11:30 window at a price with configurable slippage. | spec §15.1, US-036 |
| AD-14 | AI advisory: where structured event flags originate | Only verified exchange filings, company filings, or reliable structured provider data can set trade-impacting deterministic flags. AI classification of a news article is advisory only. | spec §18.3, US-038 |
| AD-15 | Walk-forward evidence window | Walk-forward uses rolling 12-month folds. Evidence report must include at least 3 folds. Minimum backtest history: 5 years. | US-037, spec §16.6 |

## Plan Steps

- [x] Step 1: Read and internalize unit-of-work.md, unit-of-work-story-map.md, approved stories US-006 through US-008, US-010 through US-014, US-036 through US-038
- [x] Step 2: Read spec sections 6–12, 17–20 and adaptive_momentum_quality_strategy.json
- [x] Step 3: Read strategy-presets.md and application-design components and services
- [x] Step 4: Read U01 functional design artifacts to understand pattern and value-object conventions
- [x] Step 5: Read enabled extension rules (Security Baseline, Resiliency Baseline, PBT Full)
- [x] Step 6: Document all ambiguities and autopilot decisions (AD-01 through AD-15 above)
- [x] Step 7: Design strategy schema and version lifecycle (covers US-006, US-007, US-008)
- [x] Step 8: Design market data ports and provenance model (covers US-010, US-013)
- [x] Step 9: Design universe eligibility engine (covers US-011)
- [x] Step 10: Design signal and regime engine (covers US-012)
- [x] Step 11: Design corporate action processing (covers US-014)
- [x] Step 12: Design backtesting and evidence engine (covers US-036, US-037)
- [x] Step 13: Design AI advisory boundary policy (covers US-038)
- [x] Step 14: Write domain-entities.md
- [x] Step 15: Write business-rules.md (target ≥70 unique numbered rules)
- [x] Step 16: Write business-logic-model.md (flows, algorithms, state machines, PBT analysis)
- [x] Step 17: Perform PBT analysis for all U03 components (PBT-01 compliance)
- [x] Step 18: Perform Security, Resiliency, and PBT extension compliance review
- [x] Step 19: Update aidlc-docs/aidlc-state.md with U03 Functional Design status
- [x] Step 20: Append to aidlc-docs/audit.md (review gate, autopilot option B selected)

## Artifacts

| Artifact | Path |
|---|---|
| Domain Entities | `aidlc-docs/construction/u03-strategy-data-research/functional-design/domain-entities.md` |
| Business Logic Model | `aidlc-docs/construction/u03-strategy-data-research/functional-design/business-logic-model.md` |
| Business Rules | `aidlc-docs/construction/u03-strategy-data-research/functional-design/business-rules.md` |
| Frontend Components | Not required – U03 has no frontend scope |

## Extension Compliance Summary

| Extension | Rule | Applicable | Result |
|---|---|---|---|
| Security | SECURITY-01 Encryption at rest/transit | N/A – U03 defines no persistence; data ports are contracts only | N/A |
| Security | SECURITY-02 Network logging | N/A – no network intermediary in U03 | N/A |
| Security | SECURITY-03 Application logging | Applicable – all provider port errors must log correlation IDs and redact secrets | Compliant – addressed in BR DF-004, DF-005 |
| Security | SECURITY-04 HTTP security headers | N/A – U03 serves no HTTP | N/A |
| Security | SECURITY-05 Input validation | Applicable – strategy config and data payloads must be schema-validated | Compliant – addressed in SR-001 through SR-010 |
| Security | SECURITY-08 Least privilege | N/A – U03 defines no authorization layer; AI advisory boundary is enforcement boundary | N/A per design |
| Security | SECURITY-11 Execution limits | Applicable – AI advisory cannot alter state | Compliant – addressed in AI-001 through AI-010 |
| Security | SECURITY-13 Audit logging | Applicable – strategy activation evidence and AI interactions must be audited | Compliant – addressed in SV-010, SV-011, AI-005 |
| Security | SECURITY-15 Input sanitization | Applicable – strategy config JSON must be safely parsed | Compliant – SR-003, SR-004 |
| Resiliency | RESILIENCY-01 Workload criticality | Applicable | Compliant – criticality documented in business-logic-model.md |
| Resiliency | RESILIENCY-05 Dependency failure | Applicable – data providers may fail | Compliant – addressed in DF-001 through DF-010 |
| Resiliency | RESILIENCY-06 Circuit breaking | Applicable – provider retries with circuit break | Compliant – addressed in DF-006, DF-007 |
| Resiliency | RESILIENCY-10 Degradation | Applicable – non-critical AI/news path degrades without blocking deterministic engine | Compliant – addressed in DF-008, DF-009 |
| PBT | PBT-01 Property identification | Applicable | Compliant – Testable Properties section in each artifact |
| PBT | PBT-02 Round-trip | Applicable – strategy config serialization | Compliant – identified in business-logic-model.md PBT analysis |
| PBT | PBT-03 Invariant | Applicable – weights totalling 100%, scores in range, eligibility determinism | Compliant – identified per component |
| PBT | PBT-04 Idempotency | Applicable – evaluation runs, backtest replays | Compliant – identified |
| PBT | PBT-05 Oracle/model-based | Applicable – signal scoring oracle vs brute force; eligibility cross-check | Compliant – identified |
| PBT | PBT-06 Stateful | Applicable – strategy version lifecycle state machine; regime confirmation state | Compliant – identified |
| PBT | PBT-07 Generator quality | Applicable | Compliant – generators specified in business-logic-model.md |
| PBT | PBT-08 Shrinking/reproducibility | Applicable | Compliant – noted in PBT analysis |

**Finding**: No blocking Security, Resiliency, or PBT finding detected.
