import {
  DEFAULT_REGIME_CONFIRMATION_STRENGTHENING,
  DEFAULT_REGIME_CONFIRMATION_WEAKENING,
} from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { DataVersionId } from '../shared/identifiers.ts'

export type RegimeCategory = 'RISK_ON' | 'CAUTION' | 'RISK_OFF' | 'CRISIS'
export type RegimeConfirmationStatus = 'UNCONFIRMED' | 'CONFIRMING' | 'CONFIRMED'

export type RegimeIndicators = Readonly<{
  nifty50AboveDMA200: boolean | null
  nifty500AboveDMA200: boolean | null
  breadthAbove200DMA_pct: number | null
  breadthAbove100DMA_pct: number | null
  benchmarkVolatility20D: number | null
  marketDrawdownFrom52W: number | null
  creditStressProxy: number | null
}>

export type RegimeState = Readonly<{
  category: RegimeCategory
  confirmationStatus: RegimeConfirmationStatus
  confirmationCount: number
  indicators: RegimeIndicators
  dataVersionId: DataVersionId
  asOf: string
  isCrisisImmediate: boolean
  crisisReason: string | null
  equityExposureMinPct: number
  equityExposureMaxPct: number
  evaluatedAt: string
}>

const EXPOSURE_RANGES: Record<RegimeCategory, [number, number]> = {
  RISK_ON: [90, 100],
  CAUTION: [60, 80],
  RISK_OFF: [30, 50],
  CRISIS: [0, 0],
}

function allIndicatorsPresent(ind: RegimeIndicators): boolean {
  return (
    ind.nifty50AboveDMA200 !== null
    && ind.nifty500AboveDMA200 !== null
    && ind.breadthAbove200DMA_pct !== null
    && ind.benchmarkVolatility20D !== null
    && ind.marketDrawdownFrom52W !== null
  )
}

export function createRegimeState(params: {
  indicators: RegimeIndicators
  dataVersionId: DataVersionId
  asOf: string
  evaluatedAt: string
  previousRegime?: RegimeCategory
  previousConfirmationCount?: number
  crisisDrawdownPct: number
  highVolatilityThreshold: number
  confirmationPeriodsWeakening?: number
  confirmationPeriodsStrengthening?: number
}): DomainResult<RegimeState> {
  const {
    indicators, dataVersionId, asOf, evaluatedAt,
    previousRegime, previousConfirmationCount = 0,
    crisisDrawdownPct, highVolatilityThreshold,
    confirmationPeriodsWeakening = DEFAULT_REGIME_CONFIRMATION_WEAKENING,
    confirmationPeriodsStrengthening = DEFAULT_REGIME_CONFIRMATION_STRENGTHENING,
  } = params

  // Fail closed on missing indicators (RM-008)
  if (!allIndicatorsPresent(indicators)) {
    const [minPct, maxPct] = EXPOSURE_RANGES.CRISIS
    return success(Object.freeze({
      category: 'CRISIS' as RegimeCategory,
      confirmationStatus: 'CONFIRMED' as RegimeConfirmationStatus,
      confirmationCount: 0,
      indicators: Object.freeze(indicators),
      dataVersionId,
      asOf,
      isCrisisImmediate: true,
      crisisReason: 'REGIME_DATA_UNAVAILABLE',
      equityExposureMinPct: minPct,
      equityExposureMaxPct: maxPct,
      evaluatedAt,
    }))
  }

  // Immediate crisis criteria (RM-005)
  const drawdown = indicators.marketDrawdownFrom52W ?? 0
  const isCrisisImmediate = drawdown * 100 > crisisDrawdownPct

  if (isCrisisImmediate) {
    const [minPct, maxPct] = EXPOSURE_RANGES.CRISIS
    return success(Object.freeze({
      category: 'CRISIS' as RegimeCategory,
      confirmationStatus: 'CONFIRMED' as RegimeConfirmationStatus,
      confirmationCount: 0,
      indicators: Object.freeze(indicators),
      dataVersionId,
      asOf,
      isCrisisImmediate: true,
      crisisReason: 'BENCHMARK_DRAWDOWN_EXCEEDED',
      equityExposureMinPct: minPct,
      equityExposureMaxPct: maxPct,
      evaluatedAt,
    }))
  }

  // Classify candidate regime (RM-002, RM-003, RM-004)
  const vol = indicators.benchmarkVolatility20D ?? 999
  const breadth = indicators.breadthAbove200DMA_pct ?? 0

  let candidateRegime: RegimeCategory
  if (
    indicators.nifty50AboveDMA200 === true
    && indicators.nifty500AboveDMA200 === true
    && breadth > 50
    && vol < highVolatilityThreshold
  ) {
    candidateRegime = 'RISK_ON'
  } else if (
    indicators.nifty50AboveDMA200 === false
    && indicators.nifty500AboveDMA200 === false
    && breadth < 35
  ) {
    candidateRegime = 'RISK_OFF'
  } else {
    candidateRegime = 'CAUTION'
  }

  // Apply confirmation logic (RM-006, RM-007)
  const current = previousRegime ?? candidateRegime
  const REGIME_ORDER: RegimeCategory[] = ['CRISIS', 'RISK_OFF', 'CAUTION', 'RISK_ON']
  const currentIdx = REGIME_ORDER.indexOf(current)
  const candidateIdx = REGIME_ORDER.indexOf(candidateRegime)
  const isWeakening = candidateIdx < currentIdx
  const isStrengthening = candidateIdx > currentIdx

  let confirmationCount = previousConfirmationCount
  let confirmationStatus: RegimeConfirmationStatus
  let finalRegime: RegimeCategory

  if (isWeakening) {
    confirmationCount = previousConfirmationCount + 1
    if (confirmationCount >= confirmationPeriodsWeakening) {
      finalRegime = candidateRegime
      confirmationStatus = 'CONFIRMED'
    } else {
      finalRegime = current
      confirmationStatus = 'CONFIRMING'
    }
  } else if (isStrengthening) {
    confirmationCount = previousConfirmationCount + 1
    if (confirmationCount >= confirmationPeriodsStrengthening) {
      finalRegime = candidateRegime
      confirmationStatus = 'CONFIRMED'
    } else {
      finalRegime = current
      confirmationStatus = 'CONFIRMING'
    }
  } else {
    finalRegime = current
    confirmationStatus = 'CONFIRMED'
    confirmationCount = 0
  }

  const [minPct, maxPct] = EXPOSURE_RANGES[finalRegime]
  return success(Object.freeze({
    category: finalRegime,
    confirmationStatus,
    confirmationCount,
    indicators: Object.freeze(indicators),
    dataVersionId,
    asOf,
    isCrisisImmediate: false,
    crisisReason: null,
    equityExposureMinPct: minPct,
    equityExposureMaxPct: maxPct,
    evaluatedAt,
  }))
}

export function isFailClosedTowardsCrisis(state: RegimeState): boolean {
  return state.category === 'CRISIS' && state.crisisReason === 'REGIME_DATA_UNAVAILABLE'
}
