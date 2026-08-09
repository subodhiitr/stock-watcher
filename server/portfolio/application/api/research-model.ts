export const SIX_FACTOR_RESEARCH_MODEL = Object.freeze({
  version: 'SIX_FACTOR_RESEARCH_V2',
  displayName: 'Six-factor market analysis',
  factorWeights: Object.freeze({
    momentum: 0.35,
    quality: 0.20,
    earnings: 0.15,
    sector: 0.10,
    catalyst: 0.10,
    lowRisk: 0.10,
  }),
  componentWeights: Object.freeze({
    momentum: Object.freeze({
      m3m1: 0.20,
      m6m1: 0.25,
      relativeStrength: 0.20,
      trend: 0.15,
      liquidity: 0.05,
      volatilityAdjusted: 0.15,
    }),
    quality: Object.freeze({
      returnOnEquity: 0.17,
      returnOnAssets: 0.13,
      operatingMargin: 0.13,
      profitMargin: 0.08,
      debtCoverage: 0.17,
      cashFlowQuality: 0.17,
      sectorRelativeValuation: 0.15,
    }),
    earnings: Object.freeze({
      revenueGrowth: 0.25,
      patGrowth: 0.35,
      epsGrowth: 0.25,
      resultImpact: 0.15,
    }),
    sector: Object.freeze({
      sectorRelativeStrength: 0.70,
      sectorBreadth: 0.30,
    }),
    catalyst: Object.freeze({
      catalystImpact: 1,
    }),
    lowRisk: Object.freeze({
      volatility60d: 0.25,
      maxDrawdown: 0.25,
      downsideDeviation: 0.15,
      beta: 0.10,
      liquidityRisk: 0.10,
      leverageRisk: 0.10,
      eventRisk: 0.05,
    }),
  }),
})

export type ResearchFactorName = keyof typeof SIX_FACTOR_RESEARCH_MODEL.factorWeights
