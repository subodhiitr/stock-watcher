import { success, type DomainResult } from '../../domain/errors/result.ts'
import { createMoney } from '../../domain/shared/money.ts'
import { createQuantity } from '../../domain/shared/quantity.ts'
import {
  U04_MAX_ORACLE_INSTRUMENTS,
  U04_MAX_ORACLE_QUANTITY_PER_INSTRUMENT,
  U04_WEIGHT_SCALE,
} from '../../domain/shared/rebalancing-constants.ts'
import type {
  OptimizerPort,
  OptimizerRequest,
  OptimizerResponse,
} from '../../ports/rebalancing/optimizer-port.ts'

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

export class SmallProblemOracleOptimizerAdapter implements OptimizerPort {
  async optimize(request: OptimizerRequest): Promise<DomainResult<OptimizerResponse>> {
    if (
      request.candidates.length === 0
      || request.candidates.length > U04_MAX_ORACLE_INSTRUMENTS
      || request.candidates.some((candidate) =>
        candidate.maximumQuantity.shares > U04_MAX_ORACLE_QUANTITY_PER_INSTRUMENT)
    ) {
      return success(Object.freeze({
        status: 'INFEASIBLE',
        requestHash: request.requestHash,
        positions: Object.freeze([]),
        residualCash: request.availableCash,
        durationMs: 0,
        iterationCount: 0,
        violatedConstraintIds: Object.freeze([]),
      }))
    }

    let bestObjective: bigint | undefined
    let bestQuantities: readonly bigint[] = Object.freeze([])
    let iterationCount = 0
    const current = Array<bigint>(request.candidates.length).fill(0n)
    const search = (index: number, invested: bigint): void => {
      if (index === request.candidates.length) {
        iterationCount += 1
        let objective = 0n
        for (let candidateIndex = 0; candidateIndex < request.candidates.length; candidateIndex += 1) {
          const candidate = request.candidates[candidateIndex]
          const shares = current[candidateIndex]
          if (candidate === undefined || shares === undefined) continue
          const actualWeight = request.availableCash.minorUnits === 0n
            ? 0n
            : shares * candidate.price.minorUnits * U04_WEIGHT_SCALE
              / request.availableCash.minorUnits
          objective += absolute(
            actualWeight - candidate.idealWeight.partsPerMillion,
          )
        }
        if (
          bestObjective === undefined
          || objective < bestObjective
          || (objective === bestObjective
            && current.join(',') < bestQuantities.join(','))
        ) {
          bestObjective = objective
          bestQuantities = Object.freeze([...current])
        }
        return
      }
      const candidate = request.candidates[index]
      if (candidate === undefined) return
      for (let shares = 0n; shares <= candidate.maximumQuantity.shares; shares += 1n) {
        const nextInvested = invested + shares * candidate.price.minorUnits
        if (nextInvested > request.availableCash.minorUnits) break
        current[index] = shares
        search(index + 1, nextInvested)
      }
    }
    search(0, 0n)

    let invested = 0n
    const positions = request.candidates.map((candidate, index) => {
      const shares = bestQuantities[index] ?? 0n
      invested += shares * candidate.price.minorUnits
      const targetQuantity = createQuantity(shares)
      if (!targetQuantity.ok) throw new TypeError('Invalid oracle quantity')
      return Object.freeze({
        instrumentId: candidate.instrumentId,
        targetQuantity: targetQuantity.value,
      })
    })
    const residualCash = createMoney(request.availableCash.minorUnits - invested)
    if (!residualCash.ok) throw new TypeError('Invalid oracle residual cash')
    return success(Object.freeze({
      status: 'CANDIDATE',
      requestHash: request.requestHash,
      positions: Object.freeze(positions),
      residualCash: residualCash.value,
      durationMs: 0,
      iterationCount,
      violatedConstraintIds: Object.freeze([]),
      objectiveValuePpm: bestObjective ?? 0n,
    }))
  }
}
