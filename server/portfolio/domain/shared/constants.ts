export const INR_CURRENCY = 'INR' as const
export const WEIGHT_SCALE = 1_000_000n
export const MAX_IDENTIFIER_LENGTH = 128
export const MAX_PORTFOLIO_NAME_LENGTH = 120
export const MAX_HOLDINGS = 1_000
export const MAX_OPEN_LOTS = 10_000
export const MAX_STRATEGY_SLEEVES = 100
export const DOMAIN_EVENT_SCHEMA_VERSION = 1 as const

export type InrCurrency = typeof INR_CURRENCY
