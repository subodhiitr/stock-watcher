'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TradeRules = require('../trade_rules');
const SimulationEngine = require('../simulation_engine');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'dashboard-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'nse_midcap_dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');

test('desktop settings uses an accessible full-height side panel', () => {
  assert.match(html, /settings-panel-overlay/);
  assert.match(html, /settings-side-panel/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(css, /#settings-modal\.settings-panel-overlay\{[^}]*justify-content:flex-end/);
  assert.match(css, /#settings-modal \.modal-card\.settings-side-panel\{[^}]*height:100dvh/);
});

test('settings panel renders and persists a switch for every simulation setup', () => {
  assert.equal(TradeRules.SIMULATION_SETUP_DEFINITIONS.length, 17);
  assert.ok(TradeRules.SIMULATION_SETUP_DEFINITIONS.every(definition => (
    definition.type
    && definition.key
    && definition.label
    && definition.description
    && typeof TradeRules.DEFAULT_SETTINGS[definition.key] === 'boolean'
  )));
  assert.match(dashboard, /Simulation setups/);
  assert.match(dashboard, /role="switch"/);
  assert.match(dashboard, /setSimulationSetupEnabled\('\$\{escapeHTML\(definition\.key\)\}', this\.checked\)/);
  assert.match(dashboard, /async function setAllSimulationSetupsEnabled\(enabled\)/);
  assert.match(dashboard, /async function resetSimulationSetupOverrides\(\)/);
});

test('each setup row opens a setup-specific configuration dialog', () => {
  assert.match(html, /Simulation Settings/);
  assert.match(html, /id="setup-settings-modal"/);
  assert.match(html, /class="modal-card setup-settings-dialog"/);
  assert.match(html, /aria-labelledby="setup-settings-title"/);
  assert.match(dashboard, /onclick="openSetupSettingsModal\('\$\{escapeHTML\(definition\.type\)\}'\)"/);
  assert.match(dashboard, /function renderSetupSettingsModal\(\)/);
  assert.match(dashboard, /function getSimulationSetupConfigurationKeys\(/);
  assert.match(dashboard, /setSetupNumberSettingOverride/);
  assert.match(dashboard, /setSetupBooleanSettingOverride/);
  assert.match(dashboard, /setSetupTimeSettingOverride/);
  assert.match(dashboard, /resetActiveSetupSettings/);
  assert.match(css, /\.setup-settings-overlay\{[^}]*z-index:1100/);
});

test('setup definitions identify their specialist configuration keys', () => {
  const defaults = TradeRules.DEFAULT_SETTINGS;
  const byType = Object.fromEntries(TradeRules.SIMULATION_SETUP_DEFINITIONS.map(definition => [definition.type, definition]));
  const keysFor = type => Object.keys(defaults).filter(key => (
    key !== byType[type].key
    && byType[type].settingPrefixes.some(prefix => key.startsWith(prefix))
    && !(byType[type].excludePrefixes || []).some(prefix => key.startsWith(prefix))
  ));

  assert.ok(keysFor('RANGEBOUND').includes('SIMULATION_RANGEBOUND_MIN_RANGE_PCT'));
  assert.ok(keysFor('RANGEBOUND').includes('SIMULATION_RANGEBOUND_MAX_SPREAD_PCT'));
  assert.ok(keysFor('MOMENTUM_RUNNER').includes('SIMULATION_RUNNER_MIN_SCORE'));
  assert.ok(keysFor('BULL_FLAG_CONTINUATION').includes('SIMULATION_BULL_FLAG_MIN_DAY_GAIN_PCT'));
  assert.ok(keysFor('GAP_AND_GO').includes('SIMULATION_GAP_AND_GO_MIN_GAP_PCT'));
  assert.ok(keysFor('MOMENTUM_RUNNER').includes('SIMULATION_MOMENTUM_CATALYST_MAX_SCORE_ADJUSTMENT'));
  assert.ok(keysFor('VWAP_TREND_CONTINUATION').includes('SIMULATION_VWAP_CONT_MIN_REL_VOL'));
  assert.ok(!keysFor('TOP_GAINER_CONTINUATION').includes('SIMULATION_TOP_GAINER_PULLBACK_MIN_DAY_GAIN_PCT'));
});

test('simulation eligibility honors each setup enable flag', () => {
  for (const definition of TradeRules.SIMULATION_SETUP_DEFINITIONS) {
    assert.equal(
      SimulationEngine.isSimulationSetupAllowed(definition.type, { [definition.key]: false }),
      false,
      `${definition.label} should be blocked when disabled`
    );
    assert.equal(
      SimulationEngine.isSimulationSetupAllowed(definition.type, { [definition.key]: true }),
      true,
      `${definition.label} should be allowed when enabled`
    );
  }
  assert.equal(SimulationEngine.isSimulationSetupAllowed('UNKNOWN_SETUP', {}), false);
});
