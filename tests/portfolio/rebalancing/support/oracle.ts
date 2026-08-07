import {
  SmallProblemOracleOptimizerAdapter,
  type OptimizerRequest,
  type OptimizerResponse,
} from '../../../../server/portfolio/index.ts'

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function optimizerTrackingError(
  request: OptimizerRequest,
  response: OptimizerResponse,
): bigint {
  const quantities = new Map(
    response.positions.map((position) =>
      [position.instrumentId, position.targetQuantity.shares] as const),
  )
  return request.candidates.reduce((total, candidate) => {
    const shares = quantities.get(candidate.instrumentId) ?? 0n
    const realizedWeight = request.availableCash.minorUnits === 0n
      ? 0n
      : shares * candidate.price.minorUnits * 1_000_000n
        / request.availableCash.minorUnits
    return total + absolute(
      realizedWeight - candidate.idealWeight.partsPerMillion,
    )
  }, 0n)
}

export async function solveSmallProblemOracle(
  request: OptimizerRequest,
): Promise<OptimizerResponse> {
  const result = await new SmallProblemOracleOptimizerAdapter().optimize(request)
  if (!result.ok) throw new TypeError('Oracle returned a domain failure')
  return result.value
}

export function isEquivalentOrBetterThanReference(input: Readonly<{
  request: OptimizerRequest
  candidate: OptimizerResponse
  reference: OptimizerResponse
  tolerancePpm?: bigint
}>): boolean {
  const tolerance = input.tolerancePpm ?? 0n
  return optimizerTrackingError(input.request, input.candidate)
    <= optimizerTrackingError(input.request, input.reference) + tolerance
}
