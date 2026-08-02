'use strict';

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function buildSettingsPayload(state, deps) {
  const defaults = deps.tradeRules?.DEFAULT_SETTINGS || {};
  const effective = typeof deps.tradeRules?.withDefaults === 'function'
    ? deps.tradeRules.withDefaults(state.overrides || {})
    : { ...defaults, ...(state.overrides || {}) };
  return {
    ok:true,
    ...state,
    defaults,
    effective,
    descriptions:deps.tradeRules?.SETTING_DESCRIPTIONS || {},
    setupDefinitions:deps.tradeRules?.SIMULATION_SETUP_DEFINITIONS || [],
  };
}

async function handleTradeSettingsRoute(req, res, pathname, deps) {
  if (pathname !== '/trade-settings') return false;

  if (req.method === 'GET') {
    const state = deps.loadTradeSettingsFile();
    sendJson(res, 200, buildSettingsPayload(state, deps));
    return true;
  }

  if (req.method === 'POST') {
    try {
      const payload = await deps.readJsonBody(req);
      const overrides = deps.saveTradeSettingsFile(payload?.overrides || payload || {});
      sendJson(res, 200, buildSettingsPayload({ savedAt:Date.now(), overrides }, deps));
    } catch (e) {
      sendJson(res, deps.jsonBodyErrorStatus(e), { ok: false, error: e.message || 'Could not save trade settings' });
    }
    return true;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
  return true;
}

module.exports = {
  handleTradeSettingsRoute,
};
