import type { AnyDomainFailure } from "../../domain/errors/result.ts"
import { success, type DomainResult } from "../../domain/errors/result.ts"
import type { InstrumentId } from "../../domain/shared/identifiers.ts"
import {
  applyCorporateActionTransition,
  type CorporateAction,
  type CorporateActionImpact,
} from "../../domain/strategy/corporate-action.ts"
import type { CorporateActionPort } from "../../ports/market-data/corporate-action-port.ts"
import type { ClockPort } from "../../ports/index.ts"

export type CorporateActionProcessingResult = Readonly<{
  action: CorporateAction
  impact: CorporateActionImpact | null
  requiresManualReview: boolean
}>

const BLOCKING_TYPES = new Set([
  "MERGER", "DEMERGER", "SYMBOL_CHANGE", "DELISTING", "BUYBACK_TENDER", "ETF_UNIT_CHANGE",
])

export class CorporateActionProcessor {
  private readonly corporateActionPort: CorporateActionPort
  private readonly clock: ClockPort

  constructor(corporateActionPort: CorporateActionPort, clock: ClockPort) {
    this.corporateActionPort = corporateActionPort
    this.clock = clock
  }

  async processActionsForDate(params: {
    instruments: readonly InstrumentId[]
    effectiveDate: string
  }): Promise<DomainResult<readonly CorporateActionProcessingResult[], AnyDomainFailure>> {
    const { instruments, effectiveDate } = params
    const correlationId = `ca-${effectiveDate}`
    const now = this.clock.now()

    const fetchResult = await this.corporateActionPort.fetchActionsForDate({
      instrumentIds: instruments,
      effectiveDate,
      correlationId,
    })
    if (!fetchResult.ok) return fetchResult

    const results: CorporateActionProcessingResult[] = []

    for (const action of fetchResult.value) {
      if (BLOCKING_TYPES.has(action.actionType)) {
        const transitioned = applyCorporateActionTransition(action, "REQUIRES_MANUAL_REVIEW", now)
        results.push(Object.freeze({
          action: transitioned.ok ? transitioned.value : action,
          impact: null,
          requiresManualReview: true,
        }))
        continue
      }

      if (action.actionType === "CASH_DIVIDEND") {
        const transitioned = applyCorporateActionTransition(action, "PROCESSED", now, {
          priceAdjustmentFactor: 1.0,
          quantityAdjustmentFactor: 1.0,
          taxLotLineagePreserved: true,
          economicValueConserved: true,
        })
        results.push(Object.freeze({
          action: transitioned.ok ? transitioned.value : action,
          impact: transitioned.ok ? transitioned.value.impact : null,
          requiresManualReview: false,
        }))
        continue
      }

      results.push(Object.freeze({ action, impact: null, requiresManualReview: false }))
    }

    return success(Object.freeze(results))
  }
}
