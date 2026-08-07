import { domainFailure } from '../errors/failure.ts'
import { failure, success, type DomainResult } from '../errors/result.ts'
import type { CorporateActionId, InstrumentId } from '../shared/identifiers.ts'

export type CorporateActionType =
  | 'SPLIT'
  | 'BONUS'
  | 'CASH_DIVIDEND'
  | 'RIGHTS'
  | 'MERGER'
  | 'DEMERGER'
  | 'SYMBOL_CHANGE'
  | 'DELISTING'
  | 'BUYBACK_TENDER'
  | 'ETF_UNIT_CHANGE'

export type CorporateActionStatus =
  | 'PENDING'
  | 'PROCESSED'
  | 'BLOCKED'
  | 'REQUIRES_MANUAL_REVIEW'

export type CorporateActionImpact = Readonly<{
  priceAdjustmentFactor: number
  quantityAdjustmentFactor: number
  taxLotLineagePreserved: boolean
  symbolMapping?: string
  economicValueConserved: boolean
}>

export type CorporateAction = Readonly<{
  actionId: CorporateActionId
  instrumentId: InstrumentId
  actionType: CorporateActionType
  status: CorporateActionStatus
  effectiveDate: string
  announcedAt: string
  source: 'EXCHANGE_FILING' | 'LICENSED_PROVIDER'
  impact: CorporateActionImpact | null
  notes: string
  createdAt: string
  updatedAt: string
}>

const VALID_TRANSITIONS: Record<CorporateActionStatus, readonly CorporateActionStatus[]> = {
  PENDING: ['PROCESSED', 'BLOCKED', 'REQUIRES_MANUAL_REVIEW'],
  BLOCKED: ['PROCESSED', 'REQUIRES_MANUAL_REVIEW'],
  REQUIRES_MANUAL_REVIEW: ['PROCESSED', 'BLOCKED'],
  PROCESSED: [],
}

export function createCorporateAction(params: {
  actionId: CorporateActionId
  instrumentId: InstrumentId
  actionType: CorporateActionType
  effectiveDate: string
  announcedAt: string
  source: 'EXCHANGE_FILING' | 'LICENSED_PROVIDER'
  notes?: string
  createdAt: string
}): DomainResult<CorporateAction> {
  const { actionId, instrumentId, actionType, effectiveDate, announcedAt, source, notes = '', createdAt } = params
  const validTypes: CorporateActionType[] = [
    'SPLIT', 'BONUS', 'CASH_DIVIDEND', 'RIGHTS', 'MERGER', 'DEMERGER',
    'SYMBOL_CHANGE', 'DELISTING', 'BUYBACK_TENDER', 'ETF_UNIT_CHANGE',
  ]
  if (!validTypes.includes(actionType)) {
    return failure(domainFailure('INVALID_DATA_RECORD', { field: 'actionType' }))
  }
  return success(Object.freeze({
    actionId, instrumentId, actionType,
    status: 'PENDING' as CorporateActionStatus,
    effectiveDate, announcedAt, source,
    impact: null,
    notes,
    createdAt,
    updatedAt: createdAt,
  }))
}

export function applyCorporateActionTransition(
  action: CorporateAction,
  to: CorporateActionStatus,
  updatedAt: string,
  impact?: CorporateActionImpact,
): DomainResult<CorporateAction> {
  const allowed = VALID_TRANSITIONS[action.status]
  if (!(allowed as readonly string[]).includes(to)) {
    return failure(domainFailure('INVALID_STATUS_TRANSITION', {
      field: 'status',
      context: { from: action.status, to },
    }))
  }
  if (to === 'PROCESSED' && impact && !impact.economicValueConserved) {
    const conserving: CorporateActionType[] = ['SPLIT', 'BONUS', 'RIGHTS', 'ETF_UNIT_CHANGE']
    if (conserving.includes(action.actionType)) {
      return failure(domainFailure('ECONOMIC_VALUE_NOT_CONSERVED', { field: 'impact' }))
    }
  }
  return success(Object.freeze({
    ...action,
    status: to,
    impact: impact ?? action.impact,
    updatedAt,
  }))
}
