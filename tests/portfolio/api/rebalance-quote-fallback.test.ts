import assert from 'node:assert/strict'
import test from 'node:test'

import { PortfolioApiApplicationService } from '../../../server/portfolio/application/api/portfolio-api-service.ts'
import { makePortfolio, must, openTestOwner, TEST_INSTANT } from '../persistence/support.ts'

test('quote-only rebalance produces a minimal reduction preview when holdings exceed the preset maximum', async () => {
  const owner = openTestOwner()
  try {
    const created = makePortfolio(
      'quote-fallback-over-limit',
      'Quote Fallback Over Limit',
      'strategy-version:short-horizon-momentum:v1',
    )
    must(owner.unitOfWork.execute((transaction) => {
      const inserted = transaction.portfolios.insert(created.state)
      if (!inserted.ok) return inserted
      return transaction.appendDomainEvents(created.events)
    }))

    const prices = new Map<string, number>()
    const service = new PortfolioApiApplicationService(
      owner,
      () => Date.parse(String(TEST_INSTANT)),
      async (symbols) => Object.freeze({
        quotes: Object.freeze(Object.fromEntries(symbols.map((symbol) => [symbol, Object.freeze({
          symbol,
          price: prices.get(symbol) ?? 100,
        })]))),
      }),
    )

    for (let index = 1; index <= 27; index += 1) {
      const symbol = `LIMIT${String(index).padStart(2, '0')}`
      prices.set(symbol, index)
      const imported = service.importHolding('actor:test-suite', String(created.state.portfolioId), {
        instrumentId: `NSE:${symbol}`,
        quantity: '1',
        unitCostMinorUnits: '100',
        acquiredOn: '2026-01-01',
      })
      assert.equal(imported.ok, true)
    }

    const generated = await service.generateResearchRebalance('actor:test-suite', String(created.state.portfolioId))
    assert.equal(generated.ok, true)
    if (!generated.ok) return
    const payload = generated.value as {
      state: string
      scope: string
      actions: readonly Readonly<{
        instrumentId: string
        action: string
        currentQuantity: string
        targetQuantity: string
        reasonCode: string
      }>[]
      warnings: readonly string[]
    }
    assert.equal(payload.state, 'PREVIEW_READY')
    assert.equal(payload.scope, 'CURRENT_HOLDINGS_QUOTE_FALLBACK')
    assert.deepEqual(payload.actions
      .filter((action) => action.reasonCode === 'MAX_HOLDINGS_REDUCTION')
      .map((action) => action.instrumentId)
      .sort(), ['NSE:LIMIT01', 'NSE:LIMIT02'])
    assert.equal(payload.actions.filter((action) => action.action === 'SELL').length, 2)
    assert.equal(payload.actions.filter((action) => action.action === 'HOLD').length, 25)
    assert.ok(payload.actions
      .filter((action) => action.action === 'HOLD')
      .every((action) => action.currentQuantity === action.targetQuantity))
    assert.ok(payload.warnings.some((warning) => warning.includes('exceeds the preset maximum by 2 holdings')))
  } finally {
    must(owner.close())
  }
})
