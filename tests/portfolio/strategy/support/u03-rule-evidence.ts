/**
 * U03 Rule Evidence: maps all 140 U03 functional rule IDs to test file coverage locations.
 */

export type RuleEvidence = Readonly<{
  ruleId: string
  description: string
  coveredIn: string
}>

export const U03_RULE_EVIDENCE: readonly RuleEvidence[] = Object.freeze([
  // SR: Strategy Config Rules (SR-001..SR-015) = 15
  { ruleId: "SR-001", description: "Config must have all required sections", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-002", description: "Factor weights must sum to 1.0 (PPM tolerance)", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-003", description: "Sub-factor weights must sum to 1.0 (PPM tolerance)", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-004", description: "Execution product must be CNC", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-005", description: "Execution timezone must be Asia/Kolkata", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-006", description: "Execution startTime must be before endTime", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-007", description: "Drawdown thresholds must be strictly ordered", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-008", description: "Benchmark must be non-empty string", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-009", description: "Universe indexUniverse must be non-empty", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-010", description: "Tax rates must be in [0, 100]", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-011", description: "Automation mode must be valid StrategyMode", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-012", description: "Routine frequency must map to valid horizon", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-013", description: "Config must be immutable (frozen)", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-014", description: "configHash is deterministic SHA-256", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SR-015", description: "Preset descriptors are valid and frozen", coveredIn: "strategy-config.test.ts" },

  // MD: Market Data Rules (MD-001..MD-015) = 15
  { ruleId: "MD-001", description: "DataProvider has exactly 5 values", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-002", description: "createDataProvenance rejects unknown source", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-003", description: "createDataProvenance requires all fields", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-004", description: "MarketDataType has 7 values", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-005", description: "createMarketDataRecord rejects invalid dataType", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-006", description: "createMarketDataRecord rejects empty recordId", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-007", description: "createMarketDataRecord rejects null payload", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-008", description: "validationStatus defaults to VALID", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-009", description: "MarketDataRecord is immutable (frozen)", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-010", description: "DataVersionSnapshot has completeness checks", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-011", description: "createDataVersionSnapshot derives completeness from records", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-012", description: "NSE_OFFICIAL and YAHOO_RESEARCH are research-only", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-013", description: "PRODUCTION_QUALITY_SOURCES has exactly 3 members", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-014", description: "DataVersionSnapshot.isProductionQuality reflects source quality", coveredIn: "market-data.test.ts" },
  { ruleId: "MD-015", description: "DataVersionSnapshot created when all required types present", coveredIn: "market-data.test.ts" },

  // EL: Eligibility Rules (EL-001..EL-012) = 12
  { ruleId: "EL-001", description: "All rules pass → ELIGIBLE", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-002", description: "SURVEILLANCE_STATUS HARD_RISK_FLAG → INELIGIBLE", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-003", description: "TRADING_STATUS HARD_RISK_FLAG → INELIGIBLE", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-004", description: "Only HOLD_ELIGIBLE failures → HOLD_ELIGIBLE", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-005", description: "Only FORCED_REVIEW failures → FORCED_REVIEW", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-006", description: "FUNDAMENTAL_HEALTH_EXCLUDE sets fundamentalHealthExclude", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-007", description: "EligibilityResult is immutable (frozen)", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-008", description: "createRiskFlag positional args HARD_RISK_FLAG", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-009", description: "createRiskFlag positional args FUNDAMENTAL_HEALTH_EXCLUDE", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-010", description: "EligibilityRuleId has 12 defined rules", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-011", description: "EligibilityStatus has 4 values", coveredIn: "eligibility.test.ts" },
  { ruleId: "EL-012", description: "createRiskFlag rejects non-production sources", coveredIn: "eligibility.test.ts" },

  // SS: Signal Scoring Rules (SS-001..SS-010) = 10
  { ruleId: "SS-001", description: "createSignalSnapshot creates valid snapshot", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-002", description: "NaN in components → failure", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-003", description: "Infinity in components → failure", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-004", description: "MomentumComponents has 7 fields", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-005", description: "QualityComponents has 6 fields", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-006", description: "rank must be positive integer", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-007", description: "convictionMultiplier in [0.80, 1.20]", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-008", description: "degradedAdvisoryContext defaults to false", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-009", description: "riskFlags defaults to empty array", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "SS-010", description: "SignalSnapshot is immutable (frozen)", coveredIn: "signal-scoring.test.ts" },

  // RM: Regime Rules (RM-001..RM-010) = 10
  { ruleId: "RM-001", description: "RegimeState is immutable (frozen)", coveredIn: "regime.test.ts" },
  { ruleId: "RM-002", description: "All positive indicators → RISK_ON", coveredIn: "regime.test.ts" },
  { ruleId: "RM-003", description: "Mixed indicators → CAUTION fallback", coveredIn: "regime.test.ts" },
  { ruleId: "RM-004", description: "All negative indicators → RISK_OFF", coveredIn: "regime.test.ts" },
  { ruleId: "RM-005", description: "Drawdown > threshold → immediate CRISIS", coveredIn: "regime.test.ts" },
  { ruleId: "RM-006", description: "Weakening requires confirmation periods", coveredIn: "regime.test.ts" },
  { ruleId: "RM-007", description: "Strengthening requires confirmation periods", coveredIn: "regime.test.ts" },
  { ruleId: "RM-008", description: "Null indicators → fail-closed CRISIS", coveredIn: "regime.test.ts" },
  { ruleId: "RM-009", description: "ResearchModeGate rejects research data for production", coveredIn: "resilience.test.ts" },
  { ruleId: "RM-010", description: "ResearchModeGate allows production data snapshot", coveredIn: "resilience.test.ts" },

  // CA: Corporate Action Rules (CA-001..CA-010) = 10
  { ruleId: "CA-001", description: "CorporateAction status starts as PENDING", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-002", description: "10 action types are valid", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-003", description: "PROCESSED is terminal state", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-004", description: "PENDING → BLOCKED valid transition", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-005", description: "BLOCKED → REQUIRES_MANUAL_REVIEW valid", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-006", description: "CorporateAction requires source field", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-007", description: "Conserving actions reject economicValueConserved=false", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-008", description: "CANCELLED status does not exist", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-009", description: "REQUIRES_MANUAL_REVIEW → PROCESSED valid", coveredIn: "corporate-action.test.ts" },
  { ruleId: "CA-010", description: "CorporateAction is immutable (frozen)", coveredIn: "corporate-action.test.ts" },

  // BT: Backtest Rules (BT-001..BT-010) = 10
  { ruleId: "BT-001", description: "BacktestRun starts as PENDING", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-002", description: "PENDING → RUNNING → COMPLETED lifecycle", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-003", description: "Cannot start already-running run", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-004", description: "PENDING → FAILED valid transition", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-005", description: "COMPLETED → FAILED rejected", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-006", description: "Minimum 5 years of backtest data required", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-007", description: "Bias checks must be performed before completion", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-008", description: "Look-ahead violations block completion", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-009", description: "MIN_WALKFORWARD_FOLDS is 3", coveredIn: "backtest.test.ts" },
  { ruleId: "BT-010", description: "BacktestResult has noReturnGuaranteeStatement", coveredIn: "backtest.test.ts" },

  // SV: Strategy Version Rules (SV-001..SV-013) = 13
  { ruleId: "SV-001", description: "createVersion produces DRAFT with StrategyVersionCreated event", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-002", description: "submitForActivation → ACTIVATION_PENDING", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-003", description: "activate requires all 4 evidence types", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-004", description: "activate requires all evidence to pass", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-005", description: "activate supersedes previous active version", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-006", description: "submitForActivation rejects empty evidenceRefs", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-007", description: "createVersion rejects empty versionLabel", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-008", description: "StrategyVersion is immutable (frozen)", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-009", description: "EvidenceType has 4 values", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-010", description: "StrategyVersionStatus has 5 values", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-011", description: "AI evidence reference is forbidden", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-012", description: "withdrawVersion transitions to WITHDRAWN", coveredIn: "strategy-version.test.ts" },
  { ruleId: "SV-013", description: "Cannot withdraw already WITHDRAWN version", coveredIn: "strategy-version.test.ts" },

  // AI: AI Advisory Rules (AI-001..AI-010) = 10
  { ruleId: "AI-001", description: "Only permitted operations allowed", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-002", description: "AiAdvisoryResult has canInfluenceState = false", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-003", description: "AiAdvisoryResult has canDetermineOrderQuantity = false", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-004", description: "AiAdvisoryResult has canAlterParameters = false", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-005", description: "AiAdvisoryResult has advisoryText string field", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-006", description: "requestHash is deterministic SHA-256", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-007", description: "Input with portfolio or credentials rejected", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-008", description: "6 permitted operations in AI_PERMITTED_OPERATIONS", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-009", description: "AiAdvisoryResult is immutable (frozen)", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AI-010", description: "AiAdvisoryRequest is immutable (frozen)", coveredIn: "ai-advisory.test.ts" },

  // PR: Provider Resilience Rules (PR-001..PR-010) = 10
  { ruleId: "PR-001", description: "ProviderResilienceWrapper calls underlying function", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-002", description: "CircuitBreakerRegistry starts CLOSED", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-003", description: "Provider deadline triggers abort", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-004", description: "CircuitBreakerRegistry opens after threshold failures", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-005", description: "recordSuccess resets circuit breaker to CLOSED", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-006", description: "allProviderHealth returns known providers", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-007", description: "OPEN circuit returns failure without calling provider", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-008", description: "CredentialRedactor masks sensitive fields", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-009", description: "ProviderResilienceWrapper uses exponential backoff between retries", coveredIn: "resilience.test.ts" },
  { ruleId: "PR-010", description: "ProviderResilienceWrapper records success to circuit breaker", coveredIn: "resilience.test.ts" },

  // AS: Application Service Rules (AS-001..AS-010) = 10
  { ruleId: "AS-001", description: "EligibilityService delegates to port interfaces", coveredIn: "strategy-version.test.ts" },
  { ruleId: "AS-002", description: "SignalScoringService computes composite score", coveredIn: "signal-scoring.test.ts" },
  { ruleId: "AS-003", description: "RegimeDeterminationService uses fail-closed logic", coveredIn: "regime.test.ts" },
  { ruleId: "AS-004", description: "CorporateActionProcessor blocks MERGER/DEMERGER", coveredIn: "corporate-action.test.ts" },
  { ruleId: "AS-005", description: "BacktestOrchestrationService enforces T+1 model", coveredIn: "backtest.test.ts" },
  { ruleId: "AS-006", description: "StrategyVersionService uses UnitOfWork for activation", coveredIn: "strategy-version.test.ts" },
  { ruleId: "AS-007", description: "AiAdvisoryService records audit event", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AS-008", description: "AiAdvisoryService has degraded fallback path", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "AS-009", description: "No execution authority in any U03 service", coveredIn: "strategy-version.test.ts" },
  { ruleId: "AS-010", description: "No live order placement in U03 services", coveredIn: "strategy-version.test.ts" },

  // SEC: Security Rules (SEC-001..SEC-005) = 5
  { ruleId: "SEC-001", description: "CredentialRedactor masks credential fields", coveredIn: "resilience.test.ts" },
  { ruleId: "SEC-002", description: "AI input rejects portfolio and credentials fields", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "SEC-003", description: "No live network calls in domain logic", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SEC-004", description: "Prohibited JSON keys rejected in config", coveredIn: "strategy-config.test.ts" },
  { ruleId: "SEC-005", description: "Executable patterns rejected in config JSON", coveredIn: "strategy-config.test.ts" },

  // RES: Resiliency Rules (RES-001..RES-010) = 10
  { ruleId: "RES-001", description: "Circuit breaker opens after threshold failures", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-002", description: "Provider deadline enforced with AbortController", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-003", description: "Exponential backoff between retries", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-004", description: "Circuit OPEN returns failure without calling provider", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-005", description: "Regime fail-closed on missing data", coveredIn: "regime.test.ts" },
  { ruleId: "RES-006", description: "Research mode gate prevents production eval of stale data", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-007", description: "AI advisory has degraded fallback path", coveredIn: "ai-advisory.test.ts" },
  { ruleId: "RES-008", description: "CircuitBreakerRegistry tracks per-provider state", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-009", description: "Provider health observable via allProviderHealth()", coveredIn: "resilience.test.ts" },
  { ruleId: "RES-010", description: "HALF_OPEN state allows single probe call", coveredIn: "resilience.test.ts" },
])
