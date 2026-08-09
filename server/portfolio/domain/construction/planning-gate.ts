import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import { parseIntegrityHash } from '../portfolio/evidence.ts'
import {
  compareIdentifiers,
  parseCalendarSessionId,
  parseCostScheduleVersionId,
  parseDataVersionId,
  parseInstrumentId,
  parsePortfolioId,
  parseRebalanceRunId,
  parseStrategyVersionId,
  parseTaxRuleVersionId,
  parseTurnoverSnapshotId,
} from '../shared/identifiers.ts'
import { createPlanInputHash } from '../shared/canonical-plan-hash.ts'
import {
  U04_MAX_CANDIDATES,
  U04_MAX_HOLDINGS,
  U04_MAX_OPEN_LOTS,
  U04_MAX_SELECTED_POSITIONS,
  U04_MAX_TURNOVER_WINDOWS,
  U04_MIN_TURNOVER_WINDOWS,
  U04_PLANNING_TIME_ZONE,
} from '../shared/rebalancing-constants.ts'
import type {
  NormalizedPlanningContext,
  PlanningTurnoverWindow,
} from './planning-context.ts'

const TURNOVER_WINDOW_KINDS = Object.freeze([
  'ROLLING_30_DAY',
  'CALENDAR_MONTH',
  'CALENDAR_QUARTER',
  'CALENDAR_YEAR',
] as const)

function validateWindow(window: PlanningTurnoverWindow): boolean {
  return (
    TURNOVER_WINDOW_KINDS.includes(window.windowKind)
    && window.budgetLimit.scale > 0n
    && window.budgetLimit.numerator >= 0n
    && window.consumedBeforePlan.scale > 0n
    && window.consumedBeforePlan.numerator >= 0n
  )
}

export function validatePlanningContext(
  context: NormalizedPlanningContext,
): DomainResult<NormalizedPlanningContext> {
  if (
    !parsePortfolioId(context.portfolioId).ok
    || !parseRebalanceRunId(context.rebalanceRunId).ok
  ) {
    return failure(domainFailure('INVALID_PLANNING_SCOPE', { field: 'planningScope' }))
  }
  if (
    !parseStrategyVersionId(context.strategyVersionId).ok
    || !parseDataVersionId(context.dataVersionId).ok
    || !parseCostScheduleVersionId(context.costScheduleVersionId).ok
    || !parseTaxRuleVersionId(context.taxRuleVersionId).ok
    || !parseTurnoverSnapshotId(context.turnoverSnapshotId).ok
    || !parseCalendarSessionId(context.timing.calendarSessionId).ok
    || !parseIntegrityHash(context.strategyConfigHash).ok
    || context.reconciliationSnapshotId.length === 0
  ) {
    return failure(domainFailure('MISSING_PLANNING_LINEAGE', { field: 'lineage' }))
  }
  if (context.portfolioStatus === 'ARCHIVED') {
    return failure(domainFailure('PORTFOLIO_ARCHIVED', { field: 'portfolioStatus' }))
  }
  if (
    context.asOf < context.evaluationAsOf
    || context.asOf < context.timing.decisionSessionDate
  ) {
    return failure(domainFailure('INVALID_PLANNING_DATE', { field: 'asOf' }))
  }
  if (
    context.timing.finalized !== true
    || context.timing.sameSessionExecutionAllowed !== false
    || context.timing.timeZone !== U04_PLANNING_TIME_ZONE
    || context.timing.eligibleExecutionDate <= context.timing.decisionSessionDate
  ) {
    return failure(domainFailure('INVALID_SESSION_CONTEXT', { field: 'timing' }))
  }
  if (
    context.planningIntent !== 'ROUTINE'
    && context.planningIntent !== 'INTERIM_EXCEPTION'
  ) {
    return failure(domainFailure('UNKNOWN_VALUE_REJECTED', { field: 'planningIntent' }))
  }
  if (
    context.holdings.length > U04_MAX_HOLDINGS
    || context.candidates.length > U04_MAX_CANDIDATES
    || context.holdings.reduce((count, holding) => count + holding.lots.length, 0)
      > U04_MAX_OPEN_LOTS
    || context.constraints.targetHoldings < 1
    || context.constraints.targetHoldings > U04_MAX_SELECTED_POSITIONS
    || context.constraints.maxHoldings < context.constraints.targetHoldings
    || context.constraints.maxHoldings > U04_MAX_SELECTED_POSITIONS
  ) {
    return failure(domainFailure('CAPACITY_EXCEEDED', { field: 'planningCollections' }))
  }
  if (
    context.turnoverWindows.length < U04_MIN_TURNOVER_WINDOWS
    || context.turnoverWindows.length > U04_MAX_TURNOVER_WINDOWS
    || context.turnoverWindows.some((window) => !validateWindow(window))
    || new Set(context.turnoverWindows.map((window) => window.windowKind)).size
      !== context.turnoverWindows.length
  ) {
    return failure(domainFailure('TURNOVER_WINDOW_UNSUPPORTED', { field: 'turnoverWindows' }))
  }
  if (
    context.holdings.some((holding) =>
      holding.portfolioId !== context.portfolioId
      || holding.lots.some((lot) => lot.portfolioId !== context.portfolioId))
  ) {
    return failure(domainFailure('PORTFOLIO_SCOPE_MISMATCH', { field: 'holdings' }))
  }
  if (
    context.candidates.some((candidate) =>
      !parseInstrumentId(candidate.instrumentId).ok
      || (candidate.currentHolding !== undefined
        && candidate.currentHolding.portfolioId !== context.portfolioId)
      || candidate.price.minorUnits <= 0n
      || candidate.liquidityCapacity.minorUnits < 0n)
  ) {
    return failure(domainFailure('PLANNING_PREREQUISITE_UNSAFE', { field: 'candidates' }))
  }

  const holdings = Object.freeze([...context.holdings].sort((left, right) =>
    compareIdentifiers(left.instrumentId, right.instrumentId)))
  const candidates = Object.freeze([...context.candidates].sort((left, right) =>
    compareIdentifiers(left.instrumentId, right.instrumentId)))
  const turnoverWindows = Object.freeze([...context.turnoverWindows].sort((left, right) =>
    compareIdentifiers(left.windowKind, right.windowKind)))
  const canonicalContext = {
    ...context,
    holdings,
    candidates,
    turnoverWindows,
  }
  const {
    rebalanceRunId: _rebalanceRunId,
    createdAt: _createdAt,
    planInputHash: _suppliedPlanInputHash,
    ...semanticContext
  } = canonicalContext
  const planInputHash = createPlanInputHash(semanticContext)
  if (
    context.planInputHash !== undefined
    && context.planInputHash !== planInputHash
  ) {
    return failure(domainFailure('NON_DETERMINISTIC_INPUT_MODEL', { field: 'planInputHash' }))
  }
  return success(Object.freeze({ ...canonicalContext, planInputHash }))
}
