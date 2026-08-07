// Universe and evaluation limits
export const MAX_UNIVERSE_SIZE = 1_000
export const MAX_FACTOR_COMPONENTS_MOMENTUM = 7
export const MAX_FACTOR_COMPONENTS_QUALITY = 6
export const MAX_FACTOR_COMPONENTS_RISK = 5

// Weight: one unit = 1 PPM of 1,000,000. Tolerance: ±10 PPM.
export const WEIGHT_SCALE_PPM = 1_000_000
export const WEIGHT_SUM_TOLERANCE_PPM = 10

// Signal scoring
export const WINSORIZATION_SIGMA = 3.0
export const CONVICTION_MIN = 0.80
export const CONVICTION_MAX = 1.20

// Regime confirmation defaults
export const DEFAULT_REGIME_CONFIRMATION_WEAKENING = 2
export const DEFAULT_REGIME_CONFIRMATION_STRENGTHENING = 5

// Backtest constraints
export const MIN_BACKTEST_YEARS = 5
export const MIN_TRADING_DAYS_PER_YEAR = 252
export const MIN_WALKFORWARD_FOLDS = 3
export const DATA_COMPLETENESS_THRESHOLD_PCT = 98

// AI advisory
export const AI_PERMITTED_OPERATIONS = Object.freeze([
  'SUMMARIZE',
  'CLASSIFY',
  'EXTRACT',
  'COMPARE',
  'EXPLAIN',
  'PRIORITIZE_REVIEW',
] as const)

export const AI_ADVISORY_CONSTANTS = Object.freeze({
  canInfluenceState: false as const,
  canDetermineOrderQuantity: false as const,
  canAlterParameters: false as const,
})

// Identifier constraints
export const MAX_VERSION_STRING_LENGTH = 20
export const MAX_BENCHMARK_SYMBOL_LENGTH = 50

// Circuit breaker / provider defaults
export const DEFAULT_CB_FAILURE_THRESHOLD = 5
export const DEFAULT_CB_COOLDOWN_MS = 60_000
export const DEFAULT_PROVIDER_DEADLINE_MS = 30_000
export const DEFAULT_MAX_RETRIES = 3
