'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERIFIED_SOURCES = new Set(['NSE', 'BSE', 'NSE INDIA', 'BSE INDIA']);

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function aggregateResearchNewsSignals(items, asOf, options = {}) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('A valid research as-of timestamp is required');
  const halfLifeDays = Math.max(1, Number(options.halfLifeDays) || 14);
  const eligible = (Array.isArray(items) ? items : [])
    .map(item => ({ item, publishedAtMs: Date.parse(item?.publishedAt || '') }))
    .filter(({ item, publishedAtMs }) => (
      Number.isFinite(publishedAtMs)
      && publishedAtMs <= cutoff
      && VERIFIED_SOURCES.has(String(item?.source || '').trim().toUpperCase())
    ))
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs);

  let catalystImpact = null;
  let eventRisk = null;
  let latestResult = null;
  let catalystEvidence = null;
  let catalystPublishedAt = null;
  for (const { item, publishedAtMs } of eligible) {
    const ageDays = Math.max(0, (cutoff - publishedAtMs) / DAY_MS);
    const decay = Math.exp(-Math.log(2) * ageDays / halfLifeDays);
    const impact = clamp(finiteOrNull(item.tradeImpactScore) || 0, -100, 100) / 100 * decay;
    const isResult = /result|earnings|financial/i.test(`${item.type || ''} ${item.title || ''}`);
    const adverseRisk = Math.max(0, -impact);
    if (eventRisk === null || adverseRisk > eventRisk) eventRisk = adverseRisk;
    if (isResult) {
      const hasGrowth = [item.revenueGrowthPct, item.patGrowthPct, item.epsGrowthPct].some(value => finiteOrNull(value) !== null);
      if (latestResult === null && (hasGrowth || item.resultVerdict)) latestResult = { item, impact };
    } else if (catalystImpact === null || Math.abs(impact) > Math.abs(catalystImpact)) {
      catalystImpact = impact;
      catalystEvidence = `${item.type || 'News'}: ${item.title || 'Verified exchange disclosure'}`;
      catalystPublishedAt = item.publishedAt || null;
    }
  }

  return Object.freeze({
    catalystImpact,
    eventRisk,
    resultImpact: latestResult?.impact ?? null,
    revenueGrowth: finiteOrNull(latestResult?.item?.revenueGrowthPct),
    patGrowth: finiteOrNull(latestResult?.item?.patGrowthPct),
    epsGrowth: finiteOrNull(latestResult?.item?.epsGrowthPct),
    latestResultPublishedAt: latestResult?.item?.publishedAt ?? null,
    catalystPublishedAt,
    evidence: Object.freeze([
      ...(latestResult ? [`Latest reported result: ${latestResult.item.resultVerdict || 'filed'}${latestResult.item.resultVerdictReason ? ` (${latestResult.item.resultVerdictReason})` : ''}`] : []),
      ...(catalystEvidence ? [catalystEvidence] : []),
    ]),
    verifiedItemCount: eligible.length,
  });
}

module.exports = { aggregateResearchNewsSignals };
