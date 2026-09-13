'use strict';

const INR_PER_CRORE = 10_000_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rawNumber(value) {
  const candidate = value && typeof value === 'object' ? value.raw : value;
  if (candidate == null || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function toCrore(value) {
  const number = rawNumber(value);
  return number == null ? null : +(number / INR_PER_CRORE).toFixed(2);
}

function periodLabel(statement) {
  const timestamp = rawNumber(statement?.endDate);
  if (timestamp != null) {
    const date = new Date(timestamp * 1000);
    if (!Number.isNaN(date.getTime())) return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }
  return String(statement?.endDate?.fmt || 'Quarter');
}

function normalizeYahooQuarterlyFinancials(quoteSummaryResult) {
  const statements = quoteSummaryResult?.incomeStatementHistoryQuarterly?.incomeStatementHistory;
  if (!Array.isArray(statements)) return [];
  const cashflows = quoteSummaryResult?.cashflowStatementHistoryQuarterly?.cashflowStatements || [];
  const cashflowByEndDate = new Map(cashflows.map(statement => [rawNumber(statement?.endDate), statement]));

  return statements
    .map(statement => {
      const endDate = rawNumber(statement?.endDate);
      const cashflow = cashflowByEndDate.get(endDate) || {};
      const directEbitda = rawNumber(statement?.ebitda) ?? rawNumber(statement?.normalizedEBITDA);
      const ebit = rawNumber(statement?.ebit) ?? rawNumber(statement?.operatingIncome);
      const depreciation = rawNumber(statement?.reconciledDepreciation)
        ?? rawNumber(statement?.depreciationAndAmortization)
        ?? rawNumber(cashflow?.depreciation)
        ?? rawNumber(cashflow?.depreciationAndAmortization)
        ?? rawNumber(cashflow?.reconciledDepreciation);
      const ebitda = directEbitda ?? (ebit != null && depreciation != null ? ebit + depreciation : null);
      return {
        period: periodLabel(statement),
        endDate,
        revenueCr: toCrore(statement?.totalRevenue),
        ebitdaCr: toCrore(ebitda),
        netProfitCr: toCrore(statement?.netIncome),
      };
    })
    .filter(row => row.endDate != null || row.revenueCr != null || row.ebitdaCr != null || row.netProfitCr != null)
    .sort((a, b) => (b.endDate || 0) - (a.endDate || 0))
    .slice(0, 3);
}

function normalizeYahooQuarterlyTimeseries(payload) {
  const results = payload?.timeseries?.result;
  if (!Array.isArray(results)) return [];
  const byDate = new Map();
  const fields = {
    quarterlyTotalRevenue:'revenueCr',
    quarterlyEBITDA:'ebitdaCr',
    quarterlyNetIncome:'netProfitCr',
  };

  for (const result of results) {
    const type = result?.meta?.type?.[0];
    const target = fields[type];
    if (!target || !Array.isArray(result[type])) continue;
    for (const point of result[type]) {
      const dateText = String(point?.asOfDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;
      const endDate = Math.floor(Date.parse(`${dateText}T00:00:00Z`) / 1000);
      const row = byDate.get(dateText) || {
        period:periodLabel({ endDate:{ raw:endDate } }), endDate,
        revenueCr:null, ebitdaCr:null, netProfitCr:null,
      };
      row[target] = toCrore(point?.reportedValue);
      byDate.set(dateText, row);
    }
  }

  return [...byDate.values()]
    .filter(row => row.revenueCr != null || row.ebitdaCr != null || row.netProfitCr != null)
    .sort((a, b) => b.endDate - a.endDate)
    .slice(0, 3);
}

function mergeQuarterlyFinancials(primaryRows = [], fallbackRows = []) {
  const merged = new Map();
  const remember = (row, prefer) => {
    const endDate = rawNumber(row?.endDate);
    const period = String(row?.period || '').trim();
    const key = endDate != null ? `date:${endDate}` : `period:${period.toLowerCase()}`;
    if (!period && endDate == null) return;
    const previous = merged.get(key) || {};
    const pick = field => prefer
      ? (row?.[field] != null ? row[field] : previous[field] ?? null)
      : (previous[field] != null ? previous[field] : row?.[field] ?? null);
    merged.set(key, {
      period:prefer ? (period || previous.period || 'Quarter') : (previous.period || period || 'Quarter'),
      endDate:endDate ?? previous.endDate ?? null,
      revenueCr:pick('revenueCr'),
      ebitdaCr:pick('ebitdaCr'),
      netProfitCr:pick('netProfitCr'),
    });
  };
  for (const row of fallbackRows) remember(row, false);
  for (const row of primaryRows) remember(row, true);
  return [...merged.values()]
    .filter(row => row.revenueCr != null || row.ebitdaCr != null || row.netProfitCr != null)
    .sort((a, b) => (b.endDate || 0) - (a.endDate || 0))
    .slice(0, 3);
}

module.exports = {
  normalizeYahooQuarterlyFinancials,
  normalizeYahooQuarterlyTimeseries,
  mergeQuarterlyFinancials,
  toCrore,
};
