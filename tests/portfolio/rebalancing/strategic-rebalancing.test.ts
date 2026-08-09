import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

import {
  calculateStrategicRebalanceSnapshot,
  type StrategicBenchmarkHistory,
} from '../../../server/portfolio/application/rebalancing/relative-trend-signal.ts'
import { applyStrategicTradeTiming } from '../../../server/portfolio/application/rebalancing/strategic-trade-timing.ts'
import type { StrategicRebalancePolicy } from '../../../server/portfolio/domain/strategy/strategy-config.ts'

const { extendStrategicHistoryWithProxy } = createRequire(import.meta.url)(
  '../../../server/portfolio/application/api/strategic-history-proxy.cjs',
) as { extendStrategicHistoryWithProxy(primary: readonly unknown[], proxy: readonly unknown[]): Readonly<{ history: StrategicBenchmarkHistory['defensive']; extendedCount: number }> }

const POLICY: StrategicRebalancePolicy = Object.freeze({
  enabled: true,
  mode: 'PAPER',
  riskBenchmark: 'NIFTY500TR',
  defensiveBenchmark: 'GILT5YBEES',
  primaryHorizonMonths: 12,
  confirmationHorizonMonths: 3,
  baselineLookbackMonths: 120,
  minimumBaselineObservations: 60,
  permittedRebalanceFraction: 0.5,
  negativeTrendBuyFraction: 0,
  maximumDelayCalendarDays: 93,
  staleAfterHours: 36,
})

function history(kind: 'NEGATIVE' | 'NORMAL' | 'UNCONFIRMED', includeFuture = false): StrategicBenchmarkHistory {
  const risk = []
  const defensive = []
  let riskLevel = 100
  let defensiveLevel = 100
  const count = includeFuture ? 2_621 : 2_600
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.UTC(2019, 6, 27 + index)).toISOString().slice(0, 10)
    defensiveLevel *= 1.0001
    let riskGrowth = 1.0003
    if (kind === 'NEGATIVE' && index >= 2_280 && index < 2_600) riskGrowth = 0.999
    if (kind === 'NORMAL' && index >= 2_280 && index < 2_600) riskGrowth = 1.0007
    if (kind === 'UNCONFIRMED' && index >= 2_280 && index < 2_537) riskGrowth = 0.9988
    if (kind === 'UNCONFIRMED' && index >= 2_537 && index < 2_600) riskGrowth = 1.002
    if (includeFuture && index >= 2_600) riskGrowth = 1.2
    riskLevel *= riskGrowth
    risk.push(Object.freeze({ sessionDate: date, adjustedLevel: riskLevel }))
    defensive.push(Object.freeze({ sessionDate: date, adjustedLevel: defensiveLevel }))
  }
  return Object.freeze({
    source: 'YAHOO_RESEARCH', adjustment: 'ADJUSTED_CLOSE',
    retrievedAt: '2026-09-07T10:00:00.000Z', riskBenchmark: 'NIFTY500TR', defensiveBenchmark: 'GILT5YBEES',
    risk: Object.freeze(risk), defensive: Object.freeze(defensive),
  })
}

describe('strategic rebalancing', () => {
  it('confirms a negative 12-month and 3-month relative trend', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('NEGATIVE'), now: '2026-09-07T10:00:00.000Z',
    })
    assert.equal(snapshot.state, 'NEGATIVE_CONFIRMED')
    assert.equal(snapshot.approvalBlocked, false)
    assert.equal(snapshot.appliedBuyFraction, 0)
    assert.equal(snapshot.horizons.every((item) => item.negative), true)
  })

  it('uses a normal half rebalance when relative trend is positive', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('NORMAL'), now: '2026-09-07T10:00:00.000Z',
    })
    assert.equal(snapshot.state, 'NORMAL')
    const timing = applyStrategicTradeTiming({
      currentQuantity: 10n, preTimingTargetQuantity: 30n, mandatoryExit: false, policy: POLICY, snapshot,
    })
    assert.equal(timing.timedTargetQuantity, 20n)
    assert.equal(timing.delayedQuantity, 10n)
    assert.equal(timing.reasonCode, 'STRATEGIC_HALF_REBALANCE')
  })

  it('uses a disclosed government-securities proxy to complete a pre-inception baseline', () => {
    const complete = history('NORMAL')
    const primary = complete.defensive.slice(-1_323)
    const extended = extendStrategicHistoryWithProxy(primary, complete.defensive)
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY,
      history: Object.freeze({
        ...complete,
        defensive: extended.history,
        defensiveProxy: Object.freeze({
          symbol: 'LICNETFGSC', yahooSymbol: 'LICNETFGSC.NS',
          purpose: 'PRE_INCEPTION_HISTORY_EXTENSION',
          primaryHistoryStartsOn: primary[0]?.sessionDate ?? null,
          extendedObservations: extended.extendedCount,
        }),
      }),
      now: '2026-09-07T10:00:00.000Z',
    })
    assert.equal(snapshot.state, 'NORMAL')
    assert.equal(snapshot.blockerCodes.includes('STRATEGIC_BASELINE_INCOMPLETE'), false)
    assert.equal(snapshot.horizons.length, 2)
    assert.equal(snapshot.defensiveProxy?.symbol, 'LICNETFGSC')
  })

  it('suppresses routine buys but never delays a mandatory exit', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('NEGATIVE'), now: '2026-09-07T10:00:00.000Z',
    })
    const buy = applyStrategicTradeTiming({
      currentQuantity: 10n, preTimingTargetQuantity: 30n, mandatoryExit: false, policy: POLICY, snapshot,
    })
    const exit = applyStrategicTradeTiming({
      currentQuantity: 30n, preTimingTargetQuantity: 0n, mandatoryExit: true, policy: POLICY, snapshot,
    })
    assert.equal(buy.timedTargetQuantity, 10n)
    assert.equal(buy.delayedQuantity, 20n)
    assert.equal(buy.reasonCode, 'STRATEGIC_NEGATIVE_TREND_DELAY')
    assert.equal(exit.timedTargetQuantity, 0n)
    assert.equal(exit.appliedFraction, 1)
    assert.equal(exit.reasonCode, 'STRATEGIC_MANDATORY_EXIT_OVERRIDE')
  })

  it('blocks approval when the primary negative trend is not confirmed', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('UNCONFIRMED'), now: '2026-09-07T10:00:00.000Z',
    })
    assert.equal(snapshot.state, 'NEGATIVE_UNCONFIRMED')
    assert.equal(snapshot.approvalBlocked, true)
  })

  it('fails closed when strategic benchmark history is unavailable', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({ policy: POLICY, now: '2026-09-07T10:00:00.000Z' })
    assert.equal(snapshot.state, 'DATA_BLOCKED')
    assert.equal(snapshot.approvalBlocked, true)
    assert.ok(snapshot.blockerCodes.includes('STRATEGIC_BENCHMARK_HISTORY_MISSING'))
  })

  it('ignores observations after the decision cutoff', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('NEGATIVE', true), now: '2026-09-07T10:00:00.000Z',
    })
    assert.equal(snapshot.state, 'NEGATIVE_CONFIRMED')
    assert.equal(snapshot.decisionSessionDate, '2026-09-07')
  })

  it('requires forced review after the maximum delay', () => {
    const snapshot = calculateStrategicRebalanceSnapshot({
      policy: POLICY, history: history('NEGATIVE'), now: '2026-09-07T10:00:00.000Z',
      priorDelay: Object.freeze({ state: 'NEGATIVE_CONFIRMED', delayStartedOn: '2026-05-01' }),
    })
    assert.equal(snapshot.state, 'FORCED_REVIEW')
    assert.equal(snapshot.approvalBlocked, true)
  })
})
