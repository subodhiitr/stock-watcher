import { CONVICTION_MAX, CONVICTION_MIN } from './constants.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { DataVersionId, InstrumentId, StrategyVersionId } from '../shared/identifiers.ts'
import type { RiskFlag } from './eligibility-result.ts'

export type MomentumComponents = Readonly<{
  m3m1: number; m6m1: number; relativeStrength: number; trend: number
  earningsMomentum: number; liquidity: number; volatilityAdjusted: number
}>

export type QualityComponents = Readonly<{
  returnOnEquity: number; returnOnAssets: number; earningsStability: number
  debtCoverage: number; cashFlowQuality: number; promoterPledge: number
}>

export type BfsiQualityComponents = Readonly<{
  npaRatio: number; capitalAdequacy: number; netInterestMargin: number
  returnOnAssets: number; lcrRatio: number; promoterPledge: number
}>

export type RiskComponents = Readonly<{
  volatility60d: number; maxDrawdown: number; downsideDeviation: number
  beta: number; liquidityRisk: number
}>

export type SignalSnapshot = Readonly<{
  instrumentId: InstrumentId
  strategyVersionId: StrategyVersionId
  dataVersionId: DataVersionId
  asOf: string
  isBfsi: boolean
  momentumComponents: MomentumComponents
  qualityComponents: QualityComponents | BfsiQualityComponents
  riskComponents: RiskComponents
  momentumScore: number
  qualityScore: number
  riskScore: number
  compositeScore: number
  convictionMultiplier: number
  rank: number
  riskFlags: readonly RiskFlag[]
  degradedAdvisoryContext: boolean
  missingComponentsNeutralized: boolean
  computedAt: string
}>

function guardFinite(value: number, field: string): DomainResult<void> {
  if (!Number.isFinite(value)) {
    return failure(domainFailure('COMPUTATION_ERROR', { field }))
  }
  return success(undefined)
}

function guardComponents(components: Record<string, number>, prefix: string): DomainResult<void> {
  for (const [k, v] of Object.entries(components)) {
    const guard = guardFinite(v, `${prefix}.${k}`)
    if (!guard.ok) return guard
  }
  return success(undefined)
}

export function createSignalSnapshot(params: {
  instrumentId: InstrumentId
  strategyVersionId: StrategyVersionId
  dataVersionId: DataVersionId
  asOf: string
  isBfsi: boolean
  momentumComponents: MomentumComponents
  qualityComponents: QualityComponents | BfsiQualityComponents
  riskComponents: RiskComponents
  momentumScore: number
  qualityScore: number
  riskScore: number
  compositeScore: number
  convictionMultiplier: number
  rank: number
  riskFlags?: readonly RiskFlag[]
  degradedAdvisoryContext?: boolean
  missingComponentsNeutralized?: boolean
  computedAt: string
}): DomainResult<SignalSnapshot> {
  const {
    instrumentId, strategyVersionId, dataVersionId, asOf, isBfsi,
    momentumComponents, qualityComponents, riskComponents,
    momentumScore, qualityScore, riskScore, compositeScore,
    convictionMultiplier, rank, riskFlags = [], computedAt,
    degradedAdvisoryContext = false, missingComponentsNeutralized = false,
  } = params

  const mGuard = guardComponents(momentumComponents as unknown as Record<string, number>, 'momentum')
  if (!mGuard.ok) return mGuard
  const qGuard = guardComponents(qualityComponents as unknown as Record<string, number>, 'quality')
  if (!qGuard.ok) return qGuard
  const rGuard = guardComponents(riskComponents as unknown as Record<string, number>, 'risk')
  if (!rGuard.ok) return rGuard

  for (const [field, val] of Object.entries({ momentumScore, qualityScore, riskScore, compositeScore })) {
    const g = guardFinite(val, field)
    if (!g.ok) return g
  }

  if (convictionMultiplier < CONVICTION_MIN || convictionMultiplier > CONVICTION_MAX) {
    return failure(domainFailure('COMPUTATION_ERROR', { field: 'convictionMultiplier' }))
  }
  if (!Number.isInteger(rank) || rank < 1) {
    return failure(domainFailure('COMPUTATION_ERROR', { field: 'rank' }))
  }

  return success(Object.freeze({
    instrumentId, strategyVersionId, dataVersionId, asOf, isBfsi,
    momentumComponents: Object.freeze(momentumComponents),
    qualityComponents: Object.freeze(qualityComponents),
    riskComponents: Object.freeze(riskComponents),
    momentumScore, qualityScore, riskScore, compositeScore,
    convictionMultiplier, rank,
    riskFlags: Object.freeze(riskFlags),
    degradedAdvisoryContext, missingComponentsNeutralized, computedAt,
  }))
}
