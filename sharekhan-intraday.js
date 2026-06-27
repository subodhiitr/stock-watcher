'use strict';
const fs   = require('fs');
const path = require('path');

const SCRIP_CACHE_FILE = path.join(__dirname, 'cache', 'sharekhan_scrip_codes.json');
const SCRIP_CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 hours

// Build symbol → scripCode map from Sharekhan master response array.
// Keeps only EQ (equity) scripts with valid symbol and non-zero code.
function buildScripCodeMap(masterData = []) {
  const map = new Map();
  for (const item of masterData) {
    if (item.instType !== 'EQ') continue;
    const sym  = String(item.tradingSymbol || '').trim().toUpperCase();
    const code = Number(item.scripCode || 0);
    if (sym && Number.isFinite(code) && code > 0) map.set(sym, code);
  }
  return map;
}

function loadScripCache() {
  try {
    if (!fs.existsSync(SCRIP_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(SCRIP_CACHE_FILE, 'utf8'));
    if (!raw || Date.now() - Number(raw.savedAt || 0) > SCRIP_CACHE_TTL) return null;
    return new Map(Object.entries(raw.symbols || {}));
  } catch (_) { return null; }
}

function saveScripCache(map) {
  try {
    const dir = path.dirname(SCRIP_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const symbols = Object.fromEntries([...map.entries()].map(([k, v]) => [k, v]));
    fs.writeFileSync(SCRIP_CACHE_FILE, JSON.stringify({ savedAt: Date.now(), symbols }, null, 2), 'utf8');
  } catch (_) {}
}

module.exports = { buildScripCodeMap, loadScripCache, saveScripCache };
