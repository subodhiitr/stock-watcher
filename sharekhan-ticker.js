'use strict';

const BAR_MINUTES = 5;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19800000 ms

// Parse Sharekhan tick lastUpdatedTime "MM/DD/YYYY HH:MM:SS" (IST wall-clock) →
// UTC unix seconds of the 5-min bar start.
// Returns null for invalid/zero input.
function parseTickTime(str) {
  if (!str || str === '0') return null;
  const m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min] = m;
  // Interpret fields as IST, convert to UTC
  const istMs = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0);
  if (!Number.isFinite(istMs)) return null;
  const utcMs = istMs - IST_OFFSET_MS; // convert IST wall-clock → true UTC
  // Floor to 5-min bar boundary in UTC
  return Math.floor(utcMs / (BAR_MINUTES * 60 * 1000)) * (BAR_MINUTES * 60);
}

module.exports = { parseTickTime };
