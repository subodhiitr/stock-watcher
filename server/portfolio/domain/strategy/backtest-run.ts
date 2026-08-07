import { DATA_COMPLETENESS_THRESHOLD_PCT, MIN_BACKTEST_YEARS, MIN_TRADING_DAYS_PER_YEAR, MIN_WALKFORWARD_FOLDS } from './constants.ts'
import { DomainInvariantError } from '../errors/invariant-error.ts'
import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { BacktestRunId, DataVersionId, StrategyVersionId } from '../shared/identifiers.ts'

export type BacktestStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export type WalkForwardFold = Readonly<{
  foldIndex: number
  inSampleStart: string
  inSampleEnd: string
  outOfSampleStart: string
  outOfSampleEnd: string
  dataVersionId: DataVersionId
  keyMetrics: Readonly<Record<string, number>>
}>

export type BacktestResult = Readonly<{
  dataVersionId: DataVersionId
  folds: readonly WalkForwardFold[]
  calendarVersion: string
  timezone: string
  randomSeed: number
  estimatedCostDragBps: number
  estimatedTaxDragBps: number
  noReturnGuaranteeStatement: string
  lookAheadViolations: number
  survivorshipViolations: number
  lookAheadChecksPerformed: boolean
  survivorshipBiasChecksPerformed: boolean
}>

export type BacktestRun = Readonly<{
  backtestRunId: BacktestRunId
  strategyVersionId: StrategyVersionId
  startDate: string
  endDate: string
  status: BacktestStatus
  lookAheadViolations: number
  survivorshipViolations: number
  lookAheadChecksPerformed: boolean
  survivorshipBiasChecksPerformed: boolean
  result: BacktestResult | null
  randomSeed: number
  createdAt: string
  updatedAt: string
}>

function calendarYearsBetween(start: string, end: string): number {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return (endMs - startMs) / (365.25 * 24 * 3600 * 1000)
}

export function createBacktestRun(params: {
  backtestRunId: BacktestRunId
  strategyVersionId: StrategyVersionId
  startDate: string
  endDate: string
  randomSeed: number
  createdAt: string
}): DomainResult<BacktestRun> {
  const { backtestRunId, strategyVersionId, startDate, endDate, randomSeed, createdAt } = params

  const years = calendarYearsBetween(startDate, endDate)
  if (years < MIN_BACKTEST_YEARS) {
    return failure(domainFailure('INSUFFICIENT_HISTORY', {
      field: 'startDate',
      context: { years: Math.round(years * 10) / 10, required: MIN_BACKTEST_YEARS },
    }))
  }

  return success(Object.freeze({
    backtestRunId, strategyVersionId, startDate, endDate,
    status: 'PENDING' as BacktestStatus,
    lookAheadViolations: 0,
    survivorshipViolations: 0,
    lookAheadChecksPerformed: false,
    survivorshipBiasChecksPerformed: false,
    result: null,
    randomSeed,
    createdAt,
    updatedAt: createdAt,
  }))
}

export function startBacktestRun(run: BacktestRun, updatedAt: string): DomainResult<BacktestRun> {
  if (run.status !== 'PENDING') {
    return failure(domainFailure('INVALID_STATUS_TRANSITION', { field: 'status', context: { from: run.status, to: 'RUNNING' } }))
  }
  return success(Object.freeze({ ...run, status: 'RUNNING' as BacktestStatus, updatedAt }))
}

export function recordBiasCheck(
  run: BacktestRun,
  check: 'LOOK_AHEAD' | 'SURVIVORSHIP',
  violations: number,
  updatedAt: string,
): DomainResult<BacktestRun> {
  if (run.status !== 'RUNNING') {
    return failure(domainFailure('INVALID_STATUS_TRANSITION', { field: 'status' }))
  }
  if (violations < 0 || !Number.isInteger(violations)) {
    throw new DomainInvariantError()
  }
  if (check === 'LOOK_AHEAD') {
    return success(Object.freeze({
      ...run,
      lookAheadChecksPerformed: true,
      lookAheadViolations: run.lookAheadViolations + violations,
      updatedAt,
    }))
  }
  return success(Object.freeze({
    ...run,
    survivorshipBiasChecksPerformed: true,
    survivorshipViolations: run.survivorshipViolations + violations,
    updatedAt,
  }))
}

export function completeBacktestRun(
  run: BacktestRun,
  result: BacktestResult,
  updatedAt: string,
): DomainResult<BacktestRun> {
  if (run.status !== 'RUNNING') {
    return failure(domainFailure('INVALID_STATUS_TRANSITION', { field: 'status', context: { from: run.status, to: 'COMPLETED' } }))
  }
  if (!run.lookAheadChecksPerformed) {
    return failure(domainFailure('LOOK_AHEAD_VIOLATION', { field: 'lookAheadChecksPerformed' }))
  }
  if (!run.survivorshipBiasChecksPerformed) {
    return failure(domainFailure('SURVIVORSHIP_BIAS_VIOLATION', { field: 'survivorshipBiasChecksPerformed' }))
  }
  if (run.lookAheadViolations > 0) {
    return failure(domainFailure('LOOK_AHEAD_VIOLATION', { field: 'lookAheadViolations', context: { count: run.lookAheadViolations } }))
  }
  if (run.survivorshipViolations > 0) {
    return failure(domainFailure('SURVIVORSHIP_BIAS_VIOLATION', { field: 'survivorshipViolations', context: { count: run.survivorshipViolations } }))
  }
  if (result.folds.length < MIN_WALKFORWARD_FOLDS) {
    return failure(domainFailure('INSUFFICIENT_HISTORY', { field: 'folds', context: { folds: result.folds.length, required: MIN_WALKFORWARD_FOLDS } }))
  }
  // Validate no fold overlap
  for (let i = 0; i < result.folds.length; i++) {
    const fold = result.folds[i]
    if (!fold) continue
    if (fold.outOfSampleStart <= fold.inSampleEnd) {
      return failure(domainFailure('LOOK_AHEAD_VIOLATION', { field: 'folds' }))
    }
  }
  // Bind result data version to run
  return success(Object.freeze({ ...run, status: 'COMPLETED' as BacktestStatus, result: Object.freeze(result), updatedAt }))
}

export function failBacktestRun(run: BacktestRun, reason: string, updatedAt: string): DomainResult<BacktestRun> {
  if (run.status !== 'RUNNING' && run.status !== 'PENDING') {
    return failure(domainFailure('INVALID_STATUS_TRANSITION', { field: 'status', context: { from: run.status, to: 'FAILED' } }))
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'reason' }))
  }
  return success(Object.freeze({ ...run, status: 'FAILED' as BacktestStatus, updatedAt }))
}

// Exported for transparency
export const BACKTEST_CONSTANTS = Object.freeze({
  MIN_BACKTEST_YEARS,
  MIN_TRADING_DAYS_PER_YEAR,
  MIN_WALKFORWARD_FOLDS,
  DATA_COMPLETENESS_THRESHOLD_PCT,
})
