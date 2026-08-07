import fc from 'fast-check'

import {
  FULL_WEIGHT,
  Portfolio,
  createCommandContext,
  createMoney,
  createPortfolioStateVersion,
  createSingleStrategyAllocation,
  createStrategyEligibilityEvidence,
  createWeight,
  parseActorId,
  parseAllocationId,
  parseCausationId,
  parseCommandId,
  parseCorrelationId,
  parseEventId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategySleeveId,
  parseStrategyVersionId,
  parseInstant,
  parseIntegrityHash,
  type AllocationId,
  type CommandContext,
  type DomainResult,
  type EventId,
  type PortfolioId,
  type PortfolioStateVersion,
  type StrategyAllocationPolicy,
} from '../../../server/portfolio/index.ts'

export function must<T>(result: DomainResult<T>): T {
  if (!result.ok) {
    throw new Error(`Unexpected domain failure: ${result.error.code}`)
  }
  return result.value
}

function idToken(prefix: string, token: string): string {
  return `${prefix}-${token.replace(/[^A-Za-z0-9._:-]/g, '-')}`
}

export function portfolioId(token = 'one'): PortfolioId {
  return must(parsePortfolioId(idToken('portfolio', token)))
}

export function eventId(token = 'one'): EventId {
  return must(parseEventId(idToken('event', token)))
}

export function instant(value = '2027-01-02T10:00:00.000Z') {
  return must(parseInstant(value))
}

export function stateVersion(value: number): PortfolioStateVersion {
  return must(createPortfolioStateVersion(value, value === 0))
}

export function makeContext(
  version: number,
  token = 'one',
  effectiveAt = instant(),
): CommandContext {
  return must(createCommandContext({
    commandId: must(parseCommandId(idToken('command', token))),
    actorId: must(parseActorId(idToken('actor', token))),
    correlationId: must(parseCorrelationId(idToken('correlation', token))),
    causationId: must(parseCausationId(idToken('causation', token))),
    effectiveAt,
    expectedStateVersion: stateVersion(version),
  }))
}

export function makeSingleAllocation(
  owner: PortfolioId,
  token = 'one',
  effectiveAt = instant(),
): StrategyAllocationPolicy {
  const strategyVersionId = must(parseStrategyVersionId(idToken('strategy-version', token)))
  const evidence = must(createStrategyEligibilityEvidence({
    evidenceId: must(parseEvidenceId(idToken('strategy-evidence', token))),
    portfolioId: owner,
    strategyVersionId,
    issuerId: must(parseActorId(idToken('strategy-issuer', token))),
    issuedAt: must(parseInstant('2027-01-01T09:00:00.000Z')),
    expiresAt: must(parseInstant('2030-01-01T00:00:00.000Z')),
    evidenceHash: must(parseIntegrityHash('a'.repeat(64))),
  }))
  return must(createSingleStrategyAllocation(owner, {
    assignmentId: must(parseStrategyAssignmentId(idToken('assignment', token))),
    strategyVersionId,
    weight: FULL_WEIGHT,
    effectiveAt,
    evidenceReference: evidence,
  }))
}

export function makePortfolioTransition(
  token = 'one',
  cashMinorUnits = 100_000_000n,
){
  const owner = portfolioId(token)
  const created = Portfolio.create({
    portfolioId: owner,
    displayName: `Portfolio ${token}`,
    startingCash: must(createMoney(cashMinorUnits)),
    mode: 'PAPER',
    modeEvidence: [],
    allocationPolicy: makeSingleAllocation(owner, token),
    nameUniquenessVerified: true,
    context: makeContext(0, `create-${token}`),
    eventId: eventId(`create-${token}`),
  })
  return must(created)
}

export function makePortfolio(
  token = 'one',
  cashMinorUnits = 100_000_000n,
): Portfolio {
  return makePortfolioTransition(token, cashMinorUnits).state
}

export function allocationId(token: string): AllocationId {
  return must(parseAllocationId(idToken('allocation', token)))
}

export const nonNegativeMinorUnitsArbitrary = fc.bigInt({
  min: 0n,
  max: 10_000_000_000_000n,
})

export const identifierTokenArbitrary = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/)
  .filter((value) => value.length > 0)

export const positiveWeightPartArbitrary = fc.bigInt({
  min: 1n,
  max: 999_999n,
})

export const fixtureIdentifiers = Object.freeze({
  holdingId: (token: string) => must(parseHoldingId(idToken('holding', token))),
  lotId: (token: string) => must(parseHoldingLotId(idToken('lot', token))),
  instrumentId: (token: string) => must(parseInstrumentId(idToken('instrument', token))),
  sleeveId: (token: string) => must(parseStrategySleeveId(idToken('sleeve', token))),
  assignmentId: (token: string) =>
    must(parseStrategyAssignmentId(idToken('assignment', token))),
  strategyVersionId: (token: string) =>
    must(parseStrategyVersionId(idToken('strategy-version', token))),
  weight: (parts: bigint) => must(createWeight(parts)),
})
