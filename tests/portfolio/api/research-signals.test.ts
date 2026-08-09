import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const { aggregateResearchNewsSignals } = require('../../../server/portfolio/adapters/api/research-signals.cjs') as {
  aggregateResearchNewsSignals(items: readonly Readonly<Record<string, unknown>>[], asOf: string): Readonly<Record<string, any>>
}

describe('portfolio research news signals', () => {
  it('enforces publication cutoffs and verified exchange sources', () => {
    const signals = aggregateResearchNewsSignals([
      { source:'NSE', type:'Deal', title:'Order win', publishedAt:'2026-08-08T09:00:00.000Z', tradeImpactScore:80 },
      { source:'NSE', type:'Deal', title:'Future bad news', publishedAt:'2026-08-08T11:00:00.000Z', tradeImpactScore:-100 },
      { source:'Blog', type:'Deal', title:'Unverified rumour', publishedAt:'2026-08-08T08:00:00.000Z', tradeImpactScore:100 },
    ], '2026-08-08T10:00:00.000Z')

    assert.equal(signals.verifiedItemCount, 1)
    assert.ok(signals.catalystImpact > 0)
    assert.equal(signals.eventRisk, 0)
    assert.match(signals.evidence[0], /Order win/u)
  })

  it('decays catalysts and retains reported result growth', () => {
    const item = { source:'NSE', type:'Deal', title:'Contract award', publishedAt:'2026-08-01T10:00:00.000Z', tradeImpactScore:80 }
    const fresh = aggregateResearchNewsSignals([item], '2026-08-01T10:00:00.000Z')
    const aged = aggregateResearchNewsSignals([item], '2026-08-15T10:00:00.000Z')
    assert.ok(Math.abs(aged.catalystImpact - fresh.catalystImpact / 2) < 0.000001)

    const result = aggregateResearchNewsSignals([{
      source:'NSE', type:'Results', title:'Quarterly results', publishedAt:'2026-08-01T09:00:00.000Z',
      tradeImpactScore:90, resultVerdict:'Positive', revenueGrowthPct:12, patGrowthPct:20, epsGrowthPct:18,
    }], '2026-08-01T10:00:00.000Z')
    assert.equal(result.revenueGrowth, 12)
    assert.equal(result.patGrowth, 20)
    assert.equal(result.epsGrowth, 18)
    assert.ok(result.resultImpact > 0)
  })

  it('models verified adverse disclosures as event risk', () => {
    const signals = aggregateResearchNewsSignals([{
      source:'NSE', type:'Announcement', title:'Debt default disclosure',
      publishedAt:'2026-08-08T09:00:00.000Z', tradeImpactScore:-85,
    }], '2026-08-08T10:00:00.000Z')
    assert.ok(signals.eventRisk > 0.8)
    assert.ok(signals.catalystImpact < 0)
  })
})
