'use strict';

function validRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(row => row
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.sessionDate || ''))
    && Number.isFinite(Number(row.adjustedLevel))
    && Number(row.adjustedLevel) > 0)
    .map(row => Object.freeze({
      sessionDate:String(row.sessionDate),
      adjustedLevel:Number(row.adjustedLevel),
    }))
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
}

function extendStrategicHistoryWithProxy(primaryValue, proxyValue) {
  const primary = validRows(primaryValue);
  const proxy = validRows(proxyValue);
  const firstPrimary = primary[0];
  if (!firstPrimary || proxy.length === 0) {
    return Object.freeze({ history:Object.freeze(primary), extendedCount:0 });
  }
  const priorProxy = proxy.filter(row => row.sessionDate < firstPrimary.sessionDate);
  const proxyAnchor = priorProxy.at(-1);
  if (!proxyAnchor) return Object.freeze({ history:Object.freeze(primary), extendedCount:0 });
  const scale = firstPrimary.adjustedLevel / proxyAnchor.adjustedLevel;
  const extended = priorProxy.map(row => Object.freeze({
    sessionDate:row.sessionDate,
    adjustedLevel:row.adjustedLevel * scale,
  }));
  return Object.freeze({
    history:Object.freeze([...extended, ...primary]),
    extendedCount:extended.length,
  });
}

module.exports = { extendStrategicHistoryWithProxy };
