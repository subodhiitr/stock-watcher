import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkBuyAffordabilityGate,
  checkExecutionWindowGate,
  checkSellDeliveryGate,
  evaluateExecutionGates,
} from '../../../server/portfolio/domain/execution/execution-gate.ts'
import {
  FIXTURE_IDS,
  TEST_NOW,
  makeAllGatesContext,
  makeApprovedApproval,
  makePreTradeRiskContext,
  money,
  quantity,
} from './support/fixtures.ts'

test('gate evaluation preserves deterministic precedence from portfolio to risk checks', () => {
  const portfolioBlocked = evaluateExecutionGates(makeAllGatesContext({}))
  assert.equal(portfolioBlocked.ok, true)

  const liveDisabled = evaluateExecutionGates(makeAllGatesContext({
    requestedMode: 'LIVE_ZERODHA',
    liveEnablement: Object.freeze({
      environmentEnabled: false,
      applicationEnabled: false,
      portfolioEligible: true,
      strategyEligible: true,
      brokerAccountBound: true,
      brokerCertified: true,
      approvalCurrent: true,
      reconciliationMatched: true,
      sessionEligible: true,
      riskPassed: true,
      fullAutoEnabled: false,
    }),
  }))
  assert.equal(liveDisabled.ok, false)
  if (!liveDisabled.ok) assert.equal(liveDisabled.error.code, 'LIVE_EXECUTION_DISABLED')

  const approvalExpired = evaluateExecutionGates(makeAllGatesContext({
    requestedMode: 'PAPER',
    approval: makeApprovedApproval({
      state: 'APPROVED',
      binding: {
        ...makeApprovedApproval().binding!,
        expiresAt: TEST_NOW,
      },
    }),
  }))
  assert.equal(approvalExpired.ok, false)
  if (!approvalExpired.ok) assert.equal(approvalExpired.error.code, 'APPROVAL_STALE')
})

test('window, delivery, and affordability gates fail closed at the boundary', () => {
  assert.equal(checkExecutionWindowGate({
    executionDate: makeAllGatesContext().executionWindow.executionDate,
    windowStart: '09:20',
    windowEnd: '15:15',
    timeZone: 'Asia/Kolkata',
    nowLocalDate: makeAllGatesContext().executionWindow.executionDate,
    nowLocalTime: '10:15',
    sameSessionAllowed: false,
  }).ok, true)
  assert.equal(checkExecutionWindowGate({
    executionDate: makeAllGatesContext().executionWindow.executionDate,
    windowStart: '09:20',
    windowEnd: '15:15',
    timeZone: 'Asia/Kolkata',
    nowLocalDate: makeAllGatesContext().executionWindow.executionDate,
    nowLocalTime: '15:15',
    sameSessionAllowed: false,
  }).ok, false)

  assert.equal(checkSellDeliveryGate(quantity(5n), quantity(10n), quantity(4n)).ok, true)
  assert.equal(checkSellDeliveryGate(quantity(7n), quantity(10n), quantity(4n)).ok, false)

  assert.equal(checkBuyAffordabilityGate(money(20_000n), money(50_000n), money(10_000n)).ok, true)
  assert.equal(checkBuyAffordabilityGate(money(41_000n), money(50_000n), money(10_000n)).ok, false)
})

test('quote gate rejects a proposed limit outside the exact approved deviation bound', () => {
  const context = makeAllGatesContext()
  const outsideBound = evaluateExecutionGates(Object.freeze({
    ...context,
    quote: Object.freeze({
      ...context.quote,
      proposedLimitPrice: money(14_000n),
    }),
  }))
  assert.equal(outsideBound.ok, false)
  if (!outsideBound.ok) {
    assert.equal(outsideBound.error.code, 'APPROVAL_REVALIDATION_FAILED')
    assert.equal(outsideBound.error.field, 'approvedLimitPrice')
  }
})

test('quote gate accepts a fresh replacement quote after reference expiry but preserves immutable bounds', () => {
  const baseline = makeApprovedApproval()
  const approval = makeApprovedApproval({
    binding: Object.freeze({
      ...baseline.binding!,
      priceBoundsByOrder: Object.freeze(baseline.binding!.priceBoundsByOrder.map(
        (bound) => Object.freeze({ ...bound, quoteStaleAfter: TEST_NOW }),
      )),
    }),
  })

  const freshReplacement = evaluateExecutionGates(makeAllGatesContext({ approval }))
  assert.equal(freshReplacement.ok, true)

  const relaxedLimit = makeApprovedApproval({
    binding: Object.freeze({
      ...baseline.binding!,
      priceBoundsByOrder: Object.freeze(baseline.binding!.priceBoundsByOrder.map(
        (bound) => Object.freeze({ ...bound, approvedLimitPrice: money(20_000n) }),
      )),
    }),
  })

  const deviationExceeded = evaluateExecutionGates(Object.freeze({
    ...makeAllGatesContext({ approval: relaxedLimit }),
    quote: Object.freeze({
      ...makeAllGatesContext().quote,
      proposedLimitPrice: money(14_000n),
    }),
  }))
  assert.equal(deviationExceeded.ok, false)
  if (!deviationExceeded.ok) {
    assert.equal(deviationExceeded.error.field, 'maximumDeviation')
  }
})

test('quote gate rejects future quote provenance instead of treating it as negative age', () => {
  const context = makeAllGatesContext()
  const futureQuote = evaluateExecutionGates(Object.freeze({
    ...context,
    quote: Object.freeze({
      ...context.quote,
      fetchedAt: context.quote.staleAfter,
    }),
  }))
  assert.equal(futureQuote.ok, false)
  if (!futureQuote.ok) {
    assert.equal(futureQuote.error.code, 'EXECUTION_PRICE_STALE')
    assert.equal(futureQuote.error.field, 'fetchedAt')
  }
})

test('pre trade risk and live gates block before any downstream placement state changes', () => {
  const riskBlocked = evaluateExecutionGates(makeAllGatesContext({
    preTradeRisk: makePreTradeRiskContext({ cashAdequate: false }),
  }))
  assert.equal(riskBlocked.ok, false)
  if (!riskBlocked.ok) assert.equal(riskBlocked.error.code, 'BUY_AFFORDABILITY_FAILED')

  const killBlocked = evaluateExecutionGates({
    ...makeAllGatesContext({}),
    portfolioKillSwitch: Object.freeze({
      killSwitchId: FIXTURE_IDS.killSwitchId,
      scope: Object.freeze({ kind: 'PORTFOLIO', portfolioId: FIXTURE_IDS.portfolioId }),
      state: 'ACTIVE',
      stateVersion: 2,
      history: Object.freeze([]),
    }),
  })
  assert.equal(killBlocked.ok, false)
  if (!killBlocked.ok) assert.equal(killBlocked.error.code, 'KILL_SWITCH_ACTIVE')
})
