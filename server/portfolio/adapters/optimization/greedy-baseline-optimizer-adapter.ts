import { success } from '../../domain/errors/result.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import { U04_WEIGHT_SCALE } from '../../domain/shared/rebalancing-constants.ts'
import type {
  OptimizerPort,
  OptimizerRequest,
  OptimizerResponse,
} from '../../ports/rebalancing/optimizer-port.ts'

export class GreedyBaselineOptimizerAdapter implements OptimizerPort {
  async optimize(request: OptimizerRequest): Promise<ReturnType<OptimizerPort['optimize']> extends Promise<infer T> ? T : never> {
    let invested = 0n
    const positions = request.candidates
      .map((candidate) => {
        const desiredValue = request.availableCash.minorUnits
          * candidate.idealWeight.partsPerMillion / U04_WEIGHT_SCALE
        const desiredQuantity = candidate.price.minorUnits <= 0n
          ? 0n
          : desiredValue / candidate.price.minorUnits
        const shares = desiredQuantity < candidate.maximumQuantity.shares
          ? desiredQuantity
          : candidate.maximumQuantity.shares
        invested += shares * candidate.price.minorUnits
        const targetQuantity = createQuantity(shares)
        if (!targetQuantity.ok) throw new TypeError('Invalid greedy optimizer quantity')
        return Object.freeze({
          instrumentId: candidate.instrumentId,
          targetQuantity: targetQuantity.value,
        })
      })
      .sort((left, right) =>
        left.instrumentId < right.instrumentId ? -1 : left.instrumentId > right.instrumentId ? 1 : 0)
    const residualCash = createMoney(request.availableCash.minorUnits - invested)
    if (!residualCash.ok) throw new TypeError('Invalid greedy optimizer cash')
    const response: OptimizerResponse = Object.freeze({
      status: 'CANDIDATE',
      requestHash: request.requestHash,
      positions: Object.freeze(positions),
      residualCash: residualCash.value,
      durationMs: 0,
      iterationCount: request.candidates.length,
      violatedConstraintIds: Object.freeze([]),
      objectiveValuePpm: 0n,
    })
    return success(response)
  }
}
