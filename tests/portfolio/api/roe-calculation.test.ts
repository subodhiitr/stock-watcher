import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

const require = createRequire(import.meta.url)
const { calculateAnnualizedRoe, calculateRoeFromMarketData, extractNseXbrlRoe } = require('../../../server/portfolio/adapters/api/roe-calculation.cjs')

describe('NSE XBRL ROE fallback', () => {
  it('annualizes period profit over average equity', () => {
    const result = calculateAnnualizedRoe({ profitAfterTax:25, currentEquity:220, previousEquity:180, periodDays:91 })
    assert.ok(result)
    assert.ok(Math.abs(result.roe - 0.5013736264) < 0.000001)
    assert.equal(result.usedAverageEquity, true)
  })

  it('extracts the longest current period and comparative equity from XBRL', () => {
    const xml = `
      <xbrli:context id="Q"><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
      <xbrli:context id="YTD"><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>
      <xbrli:context id="EQ"><xbrli:period><xbrli:instant>2026-06-30</xbrli:instant></xbrli:period></xbrli:context>
      <xbrli:context id="EQ0"><xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
      <in-gaap:ProfitLossAttributableToOwnersOfParent contextRef="Q">30</in-gaap:ProfitLossAttributableToOwnersOfParent>
      <in-gaap:ProfitLossAttributableToOwnersOfParent contextRef="YTD">55</in-gaap:ProfitLossAttributableToOwnersOfParent>
      <in-gaap:EquityAttributableToOwnersOfParent contextRef="EQ">500</in-gaap:EquityAttributableToOwnersOfParent>
      <in-gaap:EquityAttributableToOwnersOfParent contextRef="EQ0">450</in-gaap:EquityAttributableToOwnersOfParent>`
    const result = extractNseXbrlRoe(xml)
    assert.ok(result)
    assert.equal(result.periodStart, '2026-01-01')
    assert.equal(result.periodEnd, '2026-06-30')
    assert.equal(result.usedAverageEquity, true)
    assert.ok(result.roe > 0.23 && result.roe < 0.24)
  })

  it('fails closed without positive equity', () => {
    assert.equal(calculateAnnualizedRoe({ profitAfterTax:25, currentEquity:0, periodDays:91 }), null)
  })

  it('derives TTM ROE from earnings, shares, market cap, and price-to-book', () => {
    const result = calculateRoeFromMarketData({ trailingEps:20, sharesOutstanding:10, marketCap:1_000, priceToBook:2 })
    assert.deepEqual(result, {
      roe:0.4,
      basis:'TTM_EPS_SHARES_OVER_MARKET_CAP_DIVIDED_BY_PRICE_TO_BOOK',
    })
    assert.equal(calculateRoeFromMarketData({ trailingEps:null, sharesOutstanding:10, marketCap:1_000, priceToBook:2 }), null)
  })
})
