import assert from 'node:assert/strict'
import test from 'node:test'
import fc from 'fast-check'

import {
  Portfolio,
  createMultiSleeveAllocation,
  createStrategyEligibilityEvidence,
  parseActorId,
  parseEvidenceId,
  parseIntegrityHash,
  serializeDomainEvent,
  parseDomainEvent,
  validatePortfolioIntegrity,
} from '../../server/portfolio/index.ts'
import {
  allocationId,
  eventId,
  fixtureIdentifiers,
  identifierTokenArbitrary,
  instant,
  makeContext,
  makePortfolio,
  makePortfolioTransition,
  must,
  nonNegativeMinorUnitsArbitrary,
  portfolioId,
  positiveWeightPartArbitrary,
} from './support/arbitraries.ts'

test('PBT accepted creation always establishes the initial invariants', () => {
  fc.assert(
    fc.property(
      identifierTokenArbitrary,
      nonNegativeMinorUnitsArbitrary,
      (token, cash) => {
        const transition = makePortfolioTransition(token, cash)
        assert.equal(transition.state.status, 'ACTIVE')
        assert.equal(transition.state.mode, 'PAPER')
        assert.equal(transition.state.stateVersion, 1)
        assert.equal(transition.state.holdings.length, 0)
        assert.equal(transition.events.length, 1)
        assert.equal(transition.events[0]?.stateVersion, 1)
        assert.equal(validatePortfolioIntegrity(transition.state.snapshot()).ok, true)
      },
    ),
    { numRuns: 1_000 },
  )
})

test('PBT archive is irreversible and idempotent', () => {
  fc.assert(
    fc.property(identifierTokenArbitrary, (token) => {
      const portfolio = makePortfolio(token)
      const archived = must(portfolio.archive({
        portfolioId: portfolio.portfolioId,
        context: makeContext(1, `archive-${token}`),
        eventId: eventId(`archive-${token}`),
      }))
      const repeated = must(archived.state.archive({
        portfolioId: portfolio.portfolioId,
        context: makeContext(2, `repeat-${token}`),
        eventId: eventId(`repeat-${token}`),
      }))
      assert.equal(archived.state.status, 'ARCHIVED')
      assert.equal(repeated.state, archived.state)
      assert.equal(repeated.changed, false)
      assert.equal(repeated.stateVersion, 2)
      assert.equal(repeated.events.length, 0)
    }),
    { numRuns: 1_000 },
  )
})

test('PBT failed foreign-scope commands are atomic', () => {
  fc.assert(
    fc.property(identifierTokenArbitrary, identifierTokenArbitrary, (ownerToken, foreignToken) => {
      fc.pre(ownerToken !== foreignToken)
      const portfolio = makePortfolio(ownerToken)
      const before = portfolio.snapshot()
      const result = portfolio.archive({
        portfolioId: portfolioId(`foreign-${foreignToken}`),
        context: makeContext(1, `foreign-${ownerToken}-${foreignToken}`),
        eventId: eventId(`foreign-${ownerToken}-${foreignToken}`),
      })
      assert.equal(result.ok, false)
      assert.equal(portfolio.snapshot(), before)
      assert.equal(portfolio.stateVersion, 1)
    }),
    { numRuns: 1_000 },
  )
})

test('PBT two-sleeve allocation canonicalization ignores input order', () => {
  fc.assert(
    fc.property(
      identifierTokenArbitrary,
      positiveWeightPartArbitrary,
      (token, firstWeight) => {
        const owner = portfolioId(`sleeves-${token}`)
        const effectiveAt = instant('2027-01-03T10:00:00.000Z')
        const secondWeight = 1_000_000n - firstWeight

        function sleeve(suffix: string, parts: bigint) {
          const strategyVersionId = fixtureIdentifiers.strategyVersionId(`${token}-${suffix}`)
          return {
            sleeveId: fixtureIdentifiers.sleeveId(`${token}-${suffix}`),
            assignmentId: fixtureIdentifiers.assignmentId(`${token}-${suffix}`),
            strategyVersionId,
            weight: fixtureIdentifiers.weight(parts),
            effectiveAt,
            evidenceReference: must(createStrategyEligibilityEvidence({
              evidenceId: must(parseEvidenceId(`evidence-${token}-${suffix}`)),
              portfolioId: owner,
              strategyVersionId,
              issuerId: must(parseActorId(`issuer-${token}-${suffix}`)),
              issuedAt: instant('2027-01-01T09:00:00.000Z'),
              expiresAt: instant('2030-01-01T00:00:00.000Z'),
              evidenceHash: must(parseIntegrityHash('d'.repeat(64))),
            })),
          }
        }

        const first = sleeve('a', firstWeight)
        const second = sleeve('b', secondWeight)
        const forward = must(createMultiSleeveAllocation(owner, {
          allocationId: allocationId(`${token}-allocation`),
          sleeves: [first, second],
          effectiveAt,
        }))
        const reverse = must(createMultiSleeveAllocation(owner, {
          allocationId: allocationId(`${token}-allocation`),
          sleeves: [second, first],
          effectiveAt,
        }))
        assert.deepEqual(forward, reverse)
        assert.equal(
          forward.sleeves.reduce(
            (total, item) => total + item.weight.partsPerMillion,
            0n,
          ),
          1_000_000n,
        )
      },
    ),
    { numRuns: 1_000 },
  )
})

test('PBT successful targeted transitions also satisfy full integrity validation', () => {
  fc.assert(
    fc.property(
      identifierTokenArbitrary,
      fc.constantFrom('OBSERVE', 'PAPER', 'RECOMMENDATION'),
      (token, mode) => {
        const portfolio = makePortfolio(token)
        const transition = must(portfolio.changeMode({
          portfolioId: portfolio.portfolioId,
          mode,
          evidence: [],
          context: makeContext(1, `mode-${token}`),
          eventId: eventId(`mode-${token}`),
        }))
        assert.equal(validatePortfolioIntegrity(transition.state.snapshot()).ok, true)
        for (const event of transition.events) {
          assert.deepEqual(must(parseDomainEvent(serializeDomainEvent(event))), event)
        }
      },
    ),
    { numRuns: 1_000 },
  )
})
