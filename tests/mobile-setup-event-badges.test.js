'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'mobile-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'mobile.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'my-remix-app', 'app', 'actions', 'controller.tsx'), 'utf8');
const proxy = fs.readFileSync(path.join(root, 'ticker_proxy.js'), 'utf8');

test('mobile cards consolidate News and Result into one tappable event line', () => {
  assert.match(app, /function setupEventItems\(candidate = \{\}\)/);
  assert.match(app, /function setupEventBadges\(candidate = \{\}\)/);
  assert.match(app, /\{ kind:'news', item:items\.news \}/);
  assert.match(app, /\{ kind:'results', item:items\.results \}/);
  assert.match(app, /data-event-line="\$\{symbol\}"/);
  assert.match(app, /data-card-event-kind="\$\{kind\}"/);
  assert.match(app, /data-card-event-symbol="\$\{symbol\}"/);
  assert.equal((app.match(/setupEventBadges\(candidate\)/g) || []).length, 1);
  assert.doesNotMatch(app, /class="setup-event-badges">\$\{eventBadges\}/);
  assert.match(css, /\.decision-events \{ flex-wrap: nowrap;/);
  assert.match(css, /\.setup-event-badge\.positive \{/);
  assert.match(css, /\.setup-event-badge\.negative \{/);
  assert.match(css, /\.setup-event-badge\.neutral \{/);
});

test('each consolidated event tag opens its own detail sheet', () => {
  assert.match(controller, /id="setup-event-overlay"/);
  assert.match(controller, /id="setup-event-body"/);
  assert.match(app, /function openSetupEventOverlay\(symbol, kind\)/);
  assert.match(app, /\/yahoo\/quarterly-financials\?symbol=/);
  assert.match(app, /class="setup-event-quarterly-row setup-event-quarterly-head"/);
  assert.match(app, /quarter\.ebitdaCr/);
  assert.match(app, /event\.target\.closest\('\[data-card-event-kind\]'\)/);
  assert.match(app, /openSetupEventOverlay\(eventButton\.dataset\.cardEventSymbol, eventButton\.dataset\.cardEventKind\)/);
  assert.match(app, /setup-event-close.*closeSetupEventOverlay/s);
});

test('intraday setup payload carries categorized event impacts', () => {
  assert.match(proxy, /const eventImpacts = freshNewsService\.getCachedImpactsForSymbol\(sym\)/);
  assert.match(proxy, /newsImpact,\s*eventImpacts,/);
});
