import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DomainInvariantError,
  Portfolio,
  createHolding,
  createHoldingLot,
  createMoney,
  createModeTransitionEvidence,
  createMultiSleeveAllocation,
  createQuantity,
  createStrategyEligibilityEvidence,
  parseActorId,
  parseEvidenceId,
  parseIntegrityHash,
  parseLocalDate,
  type ModeEvidenceKind,
  type OperatingMode,
} from '../../server/portfolio/index.ts'
import {
  allocationId,
  eventId,
  fixtureIdentifiers,
  instant,
  makeContext,
  makePortfolio,
  makeSingleAllocation,
  must,
  portfolioId,
} from './support/arbitraries.ts'

test('creates an isolated ACTIVE paper portfolio at version one', () => {
  const portfolio = makePortfolio('create')
  const snapshot = portfolio.snapshot()

  assert.equal(snapshot.status, 'ACTIVE')
  assert.equal(snapshot.mode, 'PAPER')
  assert.equal(snapshot.stateVersion, 1)
  assert.equal(snapshot.holdings.length, 0)
  assert.equal(snapshot.cash.minorUnits, 100_000_000n)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.holdings))
})

test('creation rejects invalid names, negative cash, and missing uniqueness proof', () => {
  const owner = portfolioId('invalid-create')
  const base = {
    portfolioId: owner,
    startingCash: must(createMoney(1n)),
    mode: 'PAPER' as const,
    modeEvidence: [],
    allocationPolicy: makeSingleAllocation(owner, 'invalid-create'),
    nameUniquenessVerified: true as const,
    context: makeContext(0, 'invalid-create'),
    eventId: eventId('invalid-create'),
  }

  assert.equal(Portfolio.create({ ...base, displayName: ' ' }).ok, false)
  assert.equal(
    Portfolio.create({ ...base, displayName: 'Valid', startingCash: must(createMoney(-1n)) }).ok,
    false,
  )
  assert.equal(
    Portfolio.create({
      ...base,
      displayName: 'Valid',
      nameUniquenessVerified: false,
    }).ok,
    false,
  )
})

test('archive is irreversible, history-preserving, and idempotent', () => {
  const portfolio = makePortfolio('archive')
  const archived = must(portfolio.archive({
    portfolioId: portfolio.portfolioId,
    context: makeContext(1, 'archive'),
    eventId: eventId('archive'),
  }))

  assert.equal(archived.changed, true)
  assert.equal(archived.state.status, 'ARCHIVED')
  assert.equal(archived.stateVersion, 2)
  assert.equal(archived.events.length, 1)
  assert.equal(archived.state.cash.minorUnits, portfolio.cash.minorUnits)
  assert.equal(archived.state.allocationPolicy, portfolio.allocationPolicy)

  const repeated = must(archived.state.archive({
    portfolioId: portfolio.portfolioId,
    context: makeContext(2, 'archive-repeat'),
    eventId: eventId('archive-repeat'),
  }))
  assert.equal(repeated.changed, false)
  assert.equal(repeated.state, archived.state)
  assert.equal(repeated.events.length, 0)
  assert.equal(repeated.stateVersion, 2)

  const modeChange = archived.state.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'OBSERVE',
    evidence: [],
    context: makeContext(2, 'archived-mode'),
    eventId: eventId('archived-mode'),
  })
  assert.equal(modeChange.ok, false)
  if (!modeChange.ok) assert.equal(modeChange.error.code, 'PORTFOLIO_ARCHIVED')
})

test('scope and optimistic state version are checked before mutation', () => {
  const portfolio = makePortfolio('scope')
  const foreign = portfolio.archive({
    portfolioId: portfolioId('foreign'),
    context: makeContext(1, 'foreign'),
    eventId: eventId('foreign'),
  })
  assert.equal(foreign.ok, false)
  if (!foreign.ok) assert.equal(foreign.error.code, 'PORTFOLIO_SCOPE_MISMATCH')

  const stale = portfolio.archive({
    portfolioId: portfolio.portfolioId,
    context: makeContext(0, 'stale'),
    eventId: eventId('stale'),
  })
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.error.code, 'PORTFOLIO_VERSION_CONFLICT')
  assert.equal(portfolio.stateVersion, 1)
})

function makeModeEvidence(
  owner: ReturnType<typeof portfolioId>,
  mode: OperatingMode,
  kind: ModeEvidenceKind,
  token: string,
) {
  return must(createModeTransitionEvidence({
    evidenceId: must(parseEvidenceId(`evidence-${token}`)),
    portfolioId: owner,
    targetMode: mode,
    evidenceKind: kind,
    issuerId: must(parseActorId(`issuer-${token}`)),
    issuedAt: instant('2027-01-01T09:00:00.000Z'),
    expiresAt: instant('2028-01-01T00:00:00.000Z'),
    evidenceHash: must(parseIntegrityHash('b'.repeat(64))),
  }))
}

test('mode changes require evidence only for execution-capable postures', () => {
  const portfolio = makePortfolio('mode')
  const recommendation = must(portfolio.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'RECOMMENDATION',
    evidence: [],
    context: makeContext(1, 'recommendation'),
    eventId: eventId('recommendation'),
  }))
  assert.equal(recommendation.state.mode, 'RECOMMENDATION')

  const missingApproval = recommendation.state.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'APPROVAL_REQUIRED',
    evidence: [],
    context: makeContext(2, 'missing-approval'),
    eventId: eventId('missing-approval'),
  })
  assert.equal(missingApproval.ok, false)
  if (!missingApproval.ok) assert.equal(missingApproval.error.code, 'EXECUTION_EVIDENCE_REQUIRED')

  const approval = makeModeEvidence(
    portfolio.portfolioId,
    'APPROVAL_REQUIRED',
    'EXECUTION_AUTHORIZATION',
    'approval',
  )
  const approved = must(recommendation.state.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'APPROVAL_REQUIRED',
    evidence: [approval],
    context: makeContext(2, 'approval'),
    eventId: eventId('approval'),
  }))
  assert.equal(approved.state.mode, 'APPROVAL_REQUIRED')

  const restrictedMissing = approved.state.changeMode({
    portfolioId: portfolio.portfolioId,
    mode: 'RESTRICTED_AUTO',
    evidence: [
      makeModeEvidence(
        portfolio.portfolioId,
        'RESTRICTED_AUTO',
        'EXECUTION_AUTHORIZATION',
        'restricted-execution',
      ),
    ],
    context: makeContext(3, 'restricted-missing'),
    eventId: eventId('restricted-missing'),
  })
  assert.equal(restrictedMissing.ok, false)
  if (!restrictedMissing.ok) assert.equal(restrictedMissing.error.code, 'AUTOMATION_EVIDENCE_REQUIRED')
})

test('allocation replacement is future-effective, canonical, and idempotent', () => {
  const portfolio = makePortfolio('allocation')
  const owner = portfolio.portfolioId
  const effectiveAt = instant('2027-01-03T10:00:00.000Z')

  function sleeve(token: string, parts: bigint) {
    const strategyVersionId = fixtureIdentifiers.strategyVersionId(token)
    const evidence = must(createStrategyEligibilityEvidence({
      evidenceId: must(parseEvidenceId(`strategy-evidence-${token}`)),
      portfolioId: owner,
      strategyVersionId,
      issuerId: must(parseActorId(`strategy-issuer-${token}`)),
      issuedAt: instant('2027-01-01T09:00:00.000Z'),
      expiresAt: instant('2030-01-01T00:00:00.000Z'),
      evidenceHash: must(parseIntegrityHash('c'.repeat(64))),
    }))
    return {
      sleeveId: fixtureIdentifiers.sleeveId(token),
      assignmentId: fixtureIdentifiers.assignmentId(token),
      strategyVersionId,
      weight: fixtureIdentifiers.weight(parts),
      effectiveAt,
      evidenceReference: evidence,
    }
  }

  const allocation = must(createMultiSleeveAllocation(owner, {
    allocationId: allocationId('mixed'),
    sleeves: [sleeve('z', 400_000n), sleeve('a', 600_000n)],
    effectiveAt,
  }))
  assert.deepEqual(allocation.sleeves.map((item) => item.sleeveId), ['sleeve-a', 'sleeve-z'])

  const changed = must(portfolio.replaceStrategyAllocation({
    portfolioId: owner,
    allocationPolicy: allocation,
    context: makeContext(1, 'allocation-change'),
    eventId: eventId('allocation-change'),
  }))
  assert.equal(changed.changed, true)
  assert.equal(changed.events[0]?.type, 'StrategyAllocationChanged')

  const repeated = must(changed.state.replaceStrategyAllocation({
    portfolioId: owner,
    allocationPolicy: allocation,
    context: makeContext(2, 'allocation-repeat'),
    eventId: eventId('allocation-repeat'),
  }))
  assert.equal(repeated.changed, false)
  assert.equal(repeated.events.length, 0)
})

test('holdings and lots enforce scope, delivery, reservation, and no leverage', () => {
  const owner = portfolioId('holding')
  const instrumentId = fixtureIdentifiers.instrumentId('holding')
  const lot = must(createHoldingLot({
    lotId: fixtureIdentifiers.lotId('holding'),
    portfolioId: owner,
    instrumentId,
    acquiredOn: must(parseLocalDate('2027-01-02')),
    originalQuantity: must(createQuantity(10n)),
    openQuantity: must(createQuantity(8n)),
    unitCost: must(createMoney(12_345n)),
    sourceReference: { kind: 'FILL', referenceId: 'fill-1' },
  }))
  const holding = createHolding({
    holdingId: fixtureIdentifiers.holdingId('holding'),
    portfolioId: owner,
    instrumentId,
    totalQuantity: must(createQuantity(8n)),
    availableDeliveryQuantity: must(createQuantity(6n)),
    reservedQuantity: must(createQuantity(2n)),
    lots: [lot],
    stateVersion: makeContext(1).expectedStateVersion,
    marginFunded: false,
  })
  assert.equal(holding.ok, true)

  assert.equal(createHolding({
    holdingId: fixtureIdentifiers.holdingId('leveraged'),
    portfolioId: owner,
    instrumentId,
    totalQuantity: must(createQuantity(8n)),
    availableDeliveryQuantity: must(createQuantity(8n)),
    reservedQuantity: must(createQuantity(0n)),
    lots: [lot],
    stateVersion: makeContext(1).expectedStateVersion,
    marginFunded: true,
  }).ok, false)
})

test('trusted-state corruption throws a dedicated invariant error', () => {
  const snapshot = makePortfolio('corrupt').snapshot()
  assert.throws(
    () => Portfolio.rehydrate({
      ...snapshot,
      cash: { currency: 'INR', minorUnits: -1n },
    }),
    DomainInvariantError,
  )
})
