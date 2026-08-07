# U03 Strategy, Data, and Research — Code Summary

**Unit**: U03 Strategy, Data, and Research
**Stage**: Code Generation (Part 2 — Execution)
**Status**: Complete
**Generated**: 2026-08-02

---

## 1. Overview

U03 delivers the pure-domain model for strategy configuration, market-data integrity, eligibility filtering, factor scoring, regime detection, corporate-action tracking, backtesting, strategy versioning, AI advisory isolation, provider resilience, and cross-cutting constants. All 140 functional rules (SR 1-15, MD 1-15, EL 1-12, SS 1-10, RM 1-10, CA 1-10, BT 1-10, SV 1-13, AI 1-10, PR 1-10, AS 1-10, SEC 1-5, RES 1-10) and all 100 NFRs are addressed. Required strategy sections are structurally validated before hashing or freezing. No execution authority exists in this unit.

---

## 2. Runtime Source Files

### 2.1 Domain — Strategy

| File | Purpose | Key Rules |
|------|---------|-----------|
| `server/portfolio/domain/strategy/constants.ts` | Shared constants: PPM scale, preset names, allowed modes, AI permitted operations, conviction bounds | SR-1, SR-2, AS-4, AI-1 |
| `server/portfolio/domain/strategy/strategy-config.ts` | StrategyConfig value object, SHA-256 config hash, PPM weight arithmetic, `strategyConfigsEqual` | SR-1–SR-15 |
| `server/portfolio/domain/strategy/strategy-presets.ts` | SHORT/MEDIUM/LONG preset singletons, lazy hash computation | SR-8, SR-9 |
| `server/portfolio/domain/strategy/eligibility-result.ts` | EligibilityResult aggregate, 12 rule IDs, EligibilityStatus, RiskFlag | EL-1–EL-12 |
| `server/portfolio/domain/strategy/signal-snapshot.ts` | SignalSnapshot value object, MomentumComponents/QualityComponents/RiskComponents, convictionMultiplier bounds | SS-1–SS-10 |
| `server/portfolio/domain/strategy/regime-state.ts` | RegimeState aggregate, RegimeCategory (RISK_ON/CAUTION/RISK_OFF/CRISIS), 6 condition rules | RM-1–RM-10 |
| `server/portfolio/domain/strategy/corporate-action.ts` | CorporateActionRecord, corporate action types, PENDING/CONFIRMED/PROCESSED status | CA-1–CA-10 |
| `server/portfolio/domain/strategy/backtest.ts` | BacktestRun, BacktestResult, WalkForwardFold, PENDING→RUNNING→COMPLETED/FAILED transitions | BT-1–BT-10 |
| `server/portfolio/domain/strategy/strategy-version.ts` | StrategyVersion aggregate, DRAFT→ACTIVATION_PENDING→ACTIVE→SUPERSEDED lifecycle, domain events | SV-1–SV-13 |
| `server/portfolio/domain/strategy/ai-advisory.ts` | AIAdvisoryRecord, AI isolation boundary, no-execution guard, research-mode flag | AI-1–AI-10 |

### 2.2 Domain — Market Data

| File | Purpose | Key Rules |
|------|---------|-----------|
| `server/portfolio/domain/market-data/market-data-record.ts` | MarketDataRecord, DataProvider enum (5 values), OHLCV fields, corporate-action-adjusted flag | MD-1–MD-8 |
| `server/portfolio/domain/market-data/data-version-snapshot.ts` | DataVersionSnapshot, completeness calculation per dataType, point-in-time seal, `isComplete` | MD-9–MD-15 |

### 2.3 Domain — Shared

| File | Purpose |
|------|---------|
| `server/portfolio/domain/shared/identifiers.ts` | Branded types: InstrumentId, StrategyVersionId, DataVersionId, BacktestRunId, AIAdvisoryId, CorporateActionId |
| `server/portfolio/domain/errors/safe-context.ts` | SafeContext builder — integers only, rejects floats; used in domainFailure calls |

### 2.4 Ports

| File | Purpose | Key Rules |
|------|---------|-----------|
| `server/portfolio/ports/market-data-provider.port.ts` | MarketDataProviderPort: `fetchOHLCV`, `fetchFundamentals`, deadline/timeout contract | PR-1–PR-5 |
| `server/portfolio/ports/instrument-registry.port.ts` | InstrumentRegistryPort: `fetchInstrumentRecord`, `validateBrokerMapping`, static data contract | MD-3, EL-10 |
| `server/portfolio/ports/exchange-calendar.port.ts` | ExchangeCalendarPort: `isTradingDay`, `nextTradingDay`, trading day boundaries | EL-6, CA-8 |
| `server/portfolio/ports/research-data.port.ts` | ResearchDataPort: `injectResearchSignal`, research-mode read/write, no-execution boundary | AI-6, AI-7, AS-7 |
| `server/portfolio/ports/strategy-repository.port.ts` | StrategyRepositoryPort: CRUD for StrategyVersion, optimistic concurrency, read-model queries | SV-4, SV-11 |
| `server/portfolio/ports/backtest-repository.port.ts` | BacktestRepositoryPort: store/load BacktestRun and BacktestResult, point-in-time integrity | BT-3, BT-7 |
| `server/portfolio/ports/corporate-action.port.ts` | CorporateActionPort: fetch/store CorporateActionRecord, date-range queries | CA-5, CA-6 |

### 2.5 Application Services

| File | Purpose | Key Rules |
|------|---------|-----------|
| `server/portfolio/application/strategy-evaluation.service.ts` | Orchestrates eligibility, signal scoring, regime detection; enforces data version consistency | MD-14, SS-9, RM-8 |
| `server/portfolio/application/backtest-orchestration.service.ts` | Walk-forward backtest, fold sequencing, result aggregation, no live execution | BT-1, BT-6, BT-9 |
| `server/portfolio/application/strategy-version-lifecycle.service.ts` | Version lifecycle transitions, activation events, supersession | SV-2, SV-7, SV-12 |
| `server/portfolio/application/research-ingestion.service.ts` | Research signal ingestion, AI isolation enforcement, audit trail | AI-5, AI-8, AS-9 |

### 2.6 Infrastructure

| File | Purpose | Key Rules |
|------|---------|-----------|
| `server/portfolio/infrastructure/provider-adapter.ts` | Deadline enforcement, retry with exponential backoff, circuit breaker, credential redaction | PR-1–PR-10, RES-1–RES-10 |
| `server/portfolio/infrastructure/provider-health.ts` | Provider health tracker, consecutive failure counting, circuit open/close thresholds | PR-6–PR-10, RES-5 |

---

## 3. Test Files

| File | Coverage | Stories |
|------|---------|---------|
| `tests/portfolio/strategy/strategy-config.test.ts` | 20+ cases: schema validation, PPM arithmetic, hash stability, presets | US-U03-01 |
| `tests/portfolio/strategy/strategy-config.property.test.ts` | PBT: weight normalization, hash determinism, preset equality | US-U03-01 |
| `tests/portfolio/strategy/market-data.test.ts` | MarketDataRecord, DataVersionSnapshot, completeness, provider quality | US-U03-02 |
| `tests/portfolio/strategy/eligibility.test.ts` | 12 rule IDs, EligibilityStatus transitions, RiskFlag, BFSI exclusion | US-U03-03 |
| `tests/portfolio/strategy/signal-scoring.test.ts` | Component scoring, convictionMultiplier bounds, rank, composite calc | US-U03-04 |
| `tests/portfolio/strategy/regime.test.ts` | All 4 RegimeCategory paths, confirmation period logic | US-U03-05 |
| `tests/portfolio/strategy/corporate-action.test.ts` | CA types, status transitions, source field | US-U03-06 |
| `tests/portfolio/strategy/backtest.test.ts` | PENDING→RUNNING→COMPLETED/FAILED, WalkForwardFold structure | US-U03-07 |
| `tests/portfolio/strategy/strategy-version.test.ts` | DRAFT→ACTIVATION_PENDING→ACTIVE→SUPERSEDED, domain events | US-U03-08 |
| `tests/portfolio/strategy/ai-advisory.test.ts` | AI isolation, no-execution guard, research-only flag, permitted ops | US-U03-09 |
| `tests/portfolio/strategy/resilience.test.ts` | CredentialRedactor, provider error categories, safe context | US-U03-10, US-U03-11 |
| `tests/portfolio/strategy/presets.property.test.ts` | PBT: preset immutability, config equality properties | US-U03-01 |
| `tests/portfolio/strategy/strategy.model.test.ts` | State-machine model for strategy version lifecycle | US-U03-08 |

---

## 4. Support Files (Tests)

| File | Purpose |
|------|---------|
| `tests/portfolio/strategy/support/arbitraries.ts` | fast-check arbitraries for all U03 domain types |
| `tests/portfolio/strategy/support/u03-rule-evidence.ts` | 140 rule evidence entries (one per functional rule), used by architecture test |
| `tests/portfolio/strategy/support/provider-fakes.ts` | In-memory fake implementations of all 7 U03 ports |

---

## 5. Architecture Test Updates

`tests/portfolio/architecture.test.ts` — Added:
1. **U03 domain/ports architecture scan**: Verifies U03 domain and ports directories contain no forbidden imports (no infrastructure, no node builtins outside allowed list).
2. **U03 rule evidence count**: Asserts exactly 140 unique rule IDs in `u03-rule-evidence.ts`.

---

## 6. Benchmark

`benchmark/portfolio-strategy.ts` — Benchmarks:
- `createStrategyConfig` (full validation + SHA-256): ~6,875 ops/sec
- `strategyConfigsEqual` (hash comparison): ~7,704 ops/sec
- `createSignalSnapshot`: ~71,929 ops/sec
- `createRegimeState`: ~267,472 ops/sec
- `createEligibilityResult` (12 rules): ~117,357 ops/sec

Run with: `npm run bench:portfolio:u03`

---

## 7. Public API Exports (`server/portfolio/index.ts`)

New U03 exports appended:

**Types**: `StrategyConfig`, `StrategyConfigHash`, `SignalSnapshot`, `MomentumComponents`, `QualityComponents`, `RiskComponents`, `RegimeState`, `RegimeCategory`, `EligibilityResult`, `EligibilityStatus`, `EligibilityRuleId`, `EligibilityRuleResult`, `RiskFlag`, `MarketDataRecord`, `DataVersionSnapshot`, `DataProvider`, `CorporateActionRecord`, `CorporateActionType`, `CorporateActionStatus`, `BacktestRun`, `BacktestResult`, `WalkForwardFold`, `BacktestStatus`, `StrategyVersion`, `StrategyVersionStatus`, `StrategyDomainEvent`, `AIAdvisoryRecord`, `AIAdvisoryStatus`

**Factories/Functions**: `createStrategyConfig`, `strategyConfigsEqual`, `createSignalSnapshot`, `createRegimeState`, `createEligibilityResult`, `createRiskFlag`, `createMarketDataRecord`, `createDataVersionSnapshot`, `createCorporateActionRecord`, `createBacktestRun`, `startBacktestRun`, `completeBacktestRun`, `failBacktestRun`, `createBacktestResult`, `createVersion`, `submitForActivation`, `activateVersion`, `createAIAdvisoryRecord`

**Constants**: `CONVICTION_MIN`, `CONVICTION_MAX`, `COMPOSITE_SCORE_MIN`, `COMPOSITE_SCORE_MAX`, `WEIGHT_PPM_TOTAL`, `SHORT_HORIZON_PRESET`, `MEDIUM_HORIZON_PRESET`, `LONG_HORIZON_PRESET`, `AI_PERMITTED_OPERATIONS`

---

## 8. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| PPM (parts-per-million) for all factor weights | Avoids floating-point drift in weight normalization; integer arithmetic throughout SR domain |
| SHA-256 configHash computed at config creation | Enables O(1) equality comparison without deep object traversal; deterministic across runs |
| `strategyConfigsEqual` takes `StrategyConfig`, not `{ config, hash }` | Hash is embedded in the config object; callers unwrap from factory result |
| `createSafeContext` rejects floats | All domainFailure context values must be `Number.isSafeInteger()`; conviction bounds (0.80, 1.20) must not be passed as context |
| `RegimeCategory` is `RISK_ON/CAUTION/RISK_OFF/CRISIS` | Maps to NFR regime state machine; CRISIS triggers fail-closed circuit behavior |
| `DataProvider` has exactly 5 values | `NSE_OFFICIAL` and `YAHOO_RESEARCH` are research-only (not production quality); tests must not treat them as production sources |
| BacktestRun starts as `PENDING` | Explicit `startBacktestRun` transition required before fold execution; prevents accidental double-start |
| `createVersion` returns `{ version, event }` (singular) | Only one event emitted per creation; `activate` returns `{ activated, superseded, events[] }` for multi-version supersession |
| AI advisory has `advisoryText` not `outputText` | Domain-specific naming; `AI_PERMITTED_OPERATIONS` lives in `constants.ts`, not `ai-advisory.ts` |
| `CredentialRedactor.redactProviderContext` | Method name is full `redactProviderContext`; wraps provider error details to strip PII |
| `WalkForwardFold` not `BacktestFold` | Correct domain term for walk-forward validation fold structure |
| `completenessPercent` uses `typeRecords.length` as denominator | Bug fix: original `||` condition caused denominator to always equal total records; correct is count of records with matching dataType |
| Validate every required strategy policy section | Prevents missing or malformed universe, regime, rebalance, and automation policies from entering the canonical hash or immutable configuration |

---

## 9. Pre-existing Bugs Fixed

| File | Bug | Fix |
|------|-----|-----|
| `server/portfolio/domain/market-data/data-version-snapshot.ts` | Completeness total always equalled `records.length` due to `r.dataType === dataType \|\| r.instrumentId !== ''` — the second clause is always true | Changed to `typeRecords.length` so only records of the matched dataType count toward completeness |
| `server/portfolio/domain/strategy/signal-snapshot.ts` | `domainFailure` passed `CONVICTION_MIN = 0.80` and `CONVICTION_MAX = 1.20` as context values; `createSafeContext` throws for non-integer numbers | Removed float values from context; failure message is self-describing without them |
| `server/portfolio/domain/strategy/strategy-config.ts` | Required nested policy sections were cast and frozen without structural validation | Added explicit validation for universe, regime, rebalance, automation, and execution-window bounds; property coverage now removes each of the 12 required top-level fields |

---

## 10. Final Verification

- U03 focused suite: 121 of 121 tests pass.
- Corrected signal-boundary property: five consecutive targeted runs pass.
- Portfolio type checking and declaration generation pass.
- U03 benchmark completes successfully.
- Repository compatibility suite: 717 of 721 tests pass. The four failures are the established unrelated legacy snapshot-data and simulation-scheduler failures; no U03 test fails.

---

## 11. Compliance Summary

| Extension | Status | Notes |
|-----------|--------|-------|
| Security Baseline | ✅ Compliant | SEC-1–5: credential redaction, no secrets in code, AI isolation boundary, no execution authority, safe context prevents leaking floats |
| Resiliency Baseline | ✅ Compliant | RES-1–10: circuit breaker, retry/backoff, deadline enforcement, fail-closed on CRISIS regime, provider health tracking |
| PBT (Property-Based Testing) | ✅ Compliant | PBT rules: `strategy-config.property.test.ts`, `presets.property.test.ts` cover weight normalization, hash determinism, preset equality invariants |
