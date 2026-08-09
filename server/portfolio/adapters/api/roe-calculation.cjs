'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

function numberFromText(value) {
  const number = Number(String(value ?? '').replace(/<[^>]*>/gu, '').replace(/,/gu, '').trim());
  return Number.isFinite(number) ? number : null;
}

function contextsById(xml) {
  const contexts = new Map();
  const pattern = /<(?:[A-Za-z0-9_.-]+:)?context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?context>/giu;
  let match;
  while ((match = pattern.exec(xml))) {
    const body = match[2] || '';
    const instant = body.match(/<(?:[A-Za-z0-9_.-]+:)?instant>([^<]+)<\//iu)?.[1] || null;
    const startDate = body.match(/<(?:[A-Za-z0-9_.-]+:)?startDate>([^<]+)<\//iu)?.[1] || null;
    const endDate = body.match(/<(?:[A-Za-z0-9_.-]+:)?endDate>([^<]+)<\//iu)?.[1] || instant;
    contexts.set(match[1], { instant, startDate, endDate });
  }
  return contexts;
}

function factsForTags(xml, tags, contexts) {
  for (const tag of tags) {
    const facts = [];
    const pattern = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'giu');
    let match;
    while ((match = pattern.exec(xml))) {
      const contextId = match[1].match(/\bcontextRef=["']([^"']+)["']/iu)?.[1];
      const value = numberFromText(match[2]);
      const context = contextId ? contexts.get(contextId) : null;
      if (value !== null && context) facts.push({ tag, value, contextId, ...context });
    }
    if (facts.length) return facts;
  }
  return [];
}

function dateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function calculateAnnualizedRoe(input) {
  const profit = Number(input?.profitAfterTax);
  const currentEquity = Number(input?.currentEquity);
  const previousEquity = Number(input?.previousEquity);
  const periodDays = Number(input?.periodDays);
  if (!Number.isFinite(profit) || !Number.isFinite(currentEquity) || currentEquity <= 0) return null;
  if (!Number.isFinite(periodDays) || periodDays < 60 || periodDays > 370) return null;
  const hasPrevious = Number.isFinite(previousEquity) && previousEquity > 0;
  const averageEquity = hasPrevious ? (currentEquity + previousEquity) / 2 : currentEquity;
  const annualization = Math.min(4.25, 365 / periodDays);
  return Object.freeze({
    roe: profit * annualization / averageEquity,
    periodDays,
    usedAverageEquity:hasPrevious,
    averageEquity,
  });
}

function calculateRoeFromMarketData(input) {
  if (typeof input?.trailingEps !== 'number' || typeof input?.sharesOutstanding !== 'number') return null;
  const trailingEps = Number(input?.trailingEps);
  const sharesOutstanding = Number(input?.sharesOutstanding);
  if (!Number.isFinite(trailingEps) || !Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) return null;
  const reportedEquity = Number(input?.totalEquity);
  const marketCap = Number(input?.marketCap);
  const priceToBook = Number(input?.priceToBook);
  const usesReportedEquity = Number.isFinite(reportedEquity) && reportedEquity > 0;
  const bookEquity = usesReportedEquity
    ? reportedEquity
    : Number.isFinite(marketCap) && marketCap > 0 && Number.isFinite(priceToBook) && priceToBook > 0
      ? marketCap / priceToBook : null;
  if (!(bookEquity > 0)) return null;
  return Object.freeze({
    roe:trailingEps * sharesOutstanding / bookEquity,
    basis:usesReportedEquity
      ? 'TTM_EPS_SHARES_OVER_REPORTED_EQUITY'
      : 'TTM_EPS_SHARES_OVER_MARKET_CAP_DIVIDED_BY_PRICE_TO_BOOK',
  });
}

function extractNseXbrlRoe(xml) {
  const contexts = contextsById(String(xml || ''));
  const profits = factsForTags(xml, [
    'ProfitLossAttributableToOwnersOfParent',
    'ProfitOrLossAttributableToOwnersOfParent',
    'ProfitLossForPeriod',
    'ProfitAfterTax',
    'NetProfitLossForThePeriod',
    'ProfitLoss',
  ], contexts).filter(fact => fact.startDate && fact.endDate);
  const equities = factsForTags(xml, [
    'EquityAttributableToOwnersOfParent',
    'TotalEquity',
    'Equity',
    'TotalShareholdersFunds',
    'ShareholdersFunds',
  ], contexts).filter(fact => fact.instant || fact.endDate);
  if (!profits.length || !equities.length) return null;

  const latestEnd = Math.max(...profits.map(fact => dateMs(fact.endDate) || 0));
  const profit = profits
    .filter(fact => dateMs(fact.endDate) === latestEnd)
    .map(fact => ({ ...fact, durationDays:Math.round((latestEnd - (dateMs(fact.startDate) || latestEnd)) / DAY_MS) + 1 }))
    .filter(fact => fact.durationDays >= 60 && fact.durationDays <= 370)
    .sort((left, right) => right.durationDays - left.durationDays)[0];
  if (!profit) return null;

  const orderedEquities = equities
    .map(fact => ({ ...fact, at:dateMs(fact.instant || fact.endDate) }))
    .filter(fact => fact.at !== null && fact.at <= latestEnd && fact.value > 0)
    .sort((left, right) => right.at - left.at);
  const current = orderedEquities[0];
  const previous = orderedEquities.find(fact => fact.at < current?.at);
  if (!current) return null;
  const calculated = calculateAnnualizedRoe({
    profitAfterTax:profit.value,
    currentEquity:current.value,
    previousEquity:previous?.value,
    periodDays:profit.durationDays,
  });
  if (!calculated) return null;
  return Object.freeze({
    ...calculated,
    profitAfterTax:profit.value,
    currentEquity:current.value,
    previousEquity:previous?.value ?? null,
    periodStart:profit.startDate,
    periodEnd:profit.endDate,
  });
}

module.exports = { calculateAnnualizedRoe, calculateRoeFromMarketData, extractNseXbrlRoe };
