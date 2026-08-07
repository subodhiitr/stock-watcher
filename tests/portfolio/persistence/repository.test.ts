import assert from 'node:assert/strict'
import test from 'node:test'

import {
  Portfolio,
  createHolding,
  createHoldingLot,
  createMoney,
  createMultiSleeveAllocation,
  createPortfolioStateVersion,
  createQuantity,
  createStrategyEligibilityEvidence,
  createWeight,
  parseActorId,
  parseAllocationId,
  parseEvidenceId,
  parseHoldingId,
  parseHoldingLotId,
  parseInstrumentId,
  parseIntegrityHash,
  parseInstant,
  parseLocalDate,
  parsePortfolioId,
  parseStrategyAssignmentId,
  parseStrategySleeveId,
  parseStrategyVersionId,
} from '../../../server/portfolio/index.ts'
import { makePortfolio, must, openTestOwner, TEST_INSTANT } from './support.ts'

function persistTransition(
  owner: ReturnType<typeof openTestOwner>,
  transition: ReturnType<typeof makePortfolio>,
) {
  return owner.unitOfWork.execute((transaction) => {
    const inserted = transaction.portfolios.insert(transition.state)
    if (!inserted.ok) return inserted
    const appended = transaction.appendDomainEvents(transition.events)
    return appended.ok ? { ok: true, value: transition.state.portfolioId } : appended
  })
}

test('persists and rehydrates multiple strategy-isolated paper portfolios', () => {
  const owner = openTestOwner()
  try {
    const short = makePortfolio(
      'short',
      'Short Portfolio',
      'strategy-version:short-horizon-momentum:v1',
    )
    const long = makePortfolio(
      'long',
      'Long Portfolio',
      'strategy-version:long-horizon-quality:v1',
    )
    assert.equal(persistTransition(owner, short).ok, true)
    assert.equal(persistTransition(owner, long).ok, true)

    const loadedShort = must(owner.portfolios.getById(
      must(parsePortfolioId('portfolio:test:short')),
    ))
    const loadedLong = must(owner.portfolios.getById(
      must(parsePortfolioId('portfolio:test:long')),
    ))
    assert.ok(loadedShort)
    assert.ok(loadedLong)
    assert.equal(loadedShort.snapshot().name.display, 'Short Portfolio')
    assert.equal(loadedLong.snapshot().name.display, 'Long Portfolio')
    assert.equal(
      loadedShort.allocationPolicy.kind === 'SINGLE'
        ? loadedShort.allocationPolicy.strategyVersionId
        : undefined,
      'strategy-version:short-horizon-momentum:v1',
    )
    assert.equal(
      loadedLong.allocationPolicy.kind === 'SINGLE'
        ? loadedLong.allocationPolicy.strategyVersionId
        : undefined,
      'strategy-version:long-horizon-quality:v1',
    )
    assert.equal(must(owner.portfolios.activeNameExists('short portfolio')), true)
    assert.equal(must(owner.portfolios.activeNameExists('missing portfolio')), false)
  } finally {
    must(owner.close())
  }
})

test('active portfolio names remain unique and inserts are transaction-bound', () => {
  const owner = openTestOwner()
  try {
    const first = makePortfolio('unique-a', 'Unique Name')
    const duplicate = makePortfolio('unique-b', 'Unique Name')
    assert.equal(persistTransition(owner, first).ok, true)
    const result = persistTransition(owner, duplicate)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'PERSISTENCE_DUPLICATE')
  } finally {
    must(owner.close())
  }
})

test('round-trips normalized multi-sleeve allocations, holdings, and lots', () => {
  const owner = openTestOwner()
  try {
    const transition = makePortfolio('normalized', 'Normalized Portfolio')
    const base = transition.state.snapshot()
    const issuedAt = must(parseInstant(
      '2020-01-01T00:00:00.000Z',
    ))
    const expiresAt = must(parseInstant(
      '9999-12-31T23:59:59.999Z',
    ))
    const versions = [
      'strategy-version:short-horizon-momentum:v1',
      'strategy-version:long-horizon-quality:v1',
    ] as const
    const allocation = must(createMultiSleeveAllocation(base.portfolioId, {
      allocationId: must(parseAllocationId('allocation:test:normalized')),
      effectiveAt: TEST_INSTANT,
      sleeves: versions.map((raw, index) => {
        const strategyVersionId = must(parseStrategyVersionId(raw))
        return {
          sleeveId: must(parseStrategySleeveId(`sleeve:test:${index}`)),
          assignmentId: must(parseStrategyAssignmentId(`assignment:test:normalized:${index}`)),
          strategyVersionId,
          weight: must(createWeight(500_000n)),
          effectiveAt: TEST_INSTANT,
          evidenceReference: must(createStrategyEligibilityEvidence({
            evidenceId: must(parseEvidenceId(`evidence:test:normalized:${index}`)),
            portfolioId: base.portfolioId,
            strategyVersionId,
            issuerId: must(parseActorId('actor:test-suite')),
            issuedAt,
            expiresAt,
            evidenceHash: must(parseIntegrityHash('b'.repeat(64))),
          })),
        }
      }),
    }))
    const created = must(Portfolio.create({
      portfolioId: base.portfolioId,
      displayName: base.name.display,
      startingCash: base.cash,
      mode: base.mode,
      modeEvidence: [],
      allocationPolicy: allocation,
      nameUniquenessVerified: true,
      context: {
        commandId: transition.events[0]!.commandId,
        actorId: transition.events[0]!.actorId,
        correlationId: transition.events[0]!.correlationId,
        causationId: transition.events[0]!.causationId,
        effectiveAt: TEST_INSTANT,
        expectedStateVersion: must(createPortfolioStateVersion(0, true)),
      },
      eventId: transition.events[0]!.eventId,
    }))
    const instrumentId = must(parseInstrumentId('instrument:test:normalized'))
    const holding = must(createHolding({
      holdingId: must(parseHoldingId('holding:test:normalized')),
      portfolioId: base.portfolioId,
      instrumentId,
      totalQuantity: must(createQuantity(3n)),
      availableDeliveryQuantity: must(createQuantity(2n)),
      reservedQuantity: must(createQuantity(1n)),
      lots: [
        must(createHoldingLot({
          lotId: must(parseHoldingLotId('lot:test:normalized')),
          portfolioId: base.portfolioId,
          instrumentId,
          acquiredOn: must(parseLocalDate('2025-01-01')),
          originalQuantity: must(createQuantity(3n)),
          openQuantity: must(createQuantity(3n)),
          unitCost: must(createMoney(12_345n)),
          sourceReference: { kind: 'IMPORT', referenceId: 'normalized-fixture' },
        })),
      ],
      stateVersion: base.stateVersion,
      marginFunded: false,
    }))
    const normalized = Portfolio.rehydrate({
      ...created.state.snapshot(),
      holdings: [holding],
    })
    const persisted = owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(normalized)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(created.events)
    })
    assert.equal(persisted.ok, true)

    const loaded = must(owner.portfolios.getById(base.portfolioId))
    assert.ok(loaded)
    assert.equal(loaded.allocationPolicy.kind, 'SLEEVES')
    assert.equal(
      loaded.allocationPolicy.kind === 'SLEEVES'
        ? loaded.allocationPolicy.sleeves.length
        : 0,
      2,
    )
    assert.equal(loaded.holdings.length, 1)
    assert.equal(loaded.holdings[0]?.lots[0]?.unitCost.minorUnits, 12_345n)
    assert.equal(loaded.holdings[0]?.reservedQuantity.shares, 1n)
  } finally {
    must(owner.close())
  }
})
