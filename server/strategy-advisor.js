'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TradeRules = require('../trade_rules');
const { isTradingDate } = require('./setup-efficiency');

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function labelForSetup(type) {
  return (TradeRules.SIMULATION_SETUP_DEFINITIONS || []).find(row => row.type === type)?.label
    || String(type || 'Unknown').replace(/_/g, ' ');
}

function snapshotDiagnostics(snapshots, settings = {}) {
  const bySetup = new Map();
  const blockedReasons = new Map();
  const evidenceReasons = new Map();
  const noSignalPatterns = new Map();
  const settingsFingerprints = new Map();
  let usableSnapshots = 0;
  let candidateRows = 0;
  let actionableRows = 0;

  for (const snapshot of safeArray(snapshots)) {
    const fingerprint = String(snapshot?.settingsFingerprint || '').trim();
    if (fingerprint) settingsFingerprints.set(fingerprint, (settingsFingerprints.get(fingerprint) || 0) + 1);
    const candidates = safeArray(snapshot?.candidates);
    if (candidates.some(row => Number(row?.priceAtSnapshot ?? row?.price) > 0)) usableSnapshots += 1;
    for (const candidate of candidates) {
      const price = Number(candidate?.priceAtSnapshot ?? candidate?.price);
      if (!(price > 0)) continue;
      candidateRows += 1;
      const setupType = String(candidate?.derivedSetupType || candidate?.setupType || candidate?.indicators?.setupType || 'NO_SIGNAL').toUpperCase();
      const score = Number(candidate?.sectorPriority?.adjustedScore ?? candidate?.score ?? candidate?.indicators?.score) || 0;
      const signal = String(candidate?.signal || candidate?.indicators?.signal || 'hold').toLowerCase();
      const status = String(candidate?.indicators?.entryStatus || '');
      const actionable = ['buy', 'sell'].includes(signal) || /trigger|near/i.test(status);
      if (actionable) actionableRows += 1;
      const bucket = bySetup.get(setupType) || {
        setupType,
        label:labelForSetup(setupType),
        appearances:0,
        actionable:0,
        scoreTotal:0,
        maxScore:0,
        symbols:new Set(),
      };
      bucket.appearances += 1;
      bucket.actionable += actionable ? 1 : 0;
      bucket.scoreTotal += score;
      bucket.maxScore = Math.max(bucket.maxScore, score);
      bucket.symbols.add(String(candidate?.symbol || '').toUpperCase());
      bySetup.set(setupType, bucket);

      for (const reason of safeArray(candidate?.indicators?.reasons).slice(0, 8)) {
        const normalized = String(reason || '').trim();
        if (normalized) evidenceReasons.set(normalized, (evidenceReasons.get(normalized) || 0) + 1);
      }
      const block = String(candidate?.blockReason || candidate?.indicators?.blockReason || '').trim();
      if (block) blockedReasons.set(block, (blockedReasons.get(block) || 0) + 1);

      if (setupType === 'NO_SIGNAL' || setupType === 'LONG_MOMENTUM') {
        const indicators = candidate?.indicators || {};
        const patterns = [
          indicators.vwap > 0 && price > indicators.vwap ? 'Above VWAP' : '',
          indicators.ema9 > indicators.ema20 ? 'EMA trend aligned' : '',
          Number(indicators.relVolumeTimeAdjusted ?? indicators.relVolume) >= 1.5 ? 'High relative volume' : '',
          indicators.superTrendDirection === 'bullish' ? 'Bullish SuperTrend' : '',
          Number(indicators.dayChange) <= -2 ? 'Large intraday decline' : '',
        ].filter(Boolean);
        if (patterns.length >= 3 && score >= Number(settings.SIMULATION_MIN_SCORE || 65) - 5) {
          const key = patterns.sort().join(' + ');
          noSignalPatterns.set(key, (noSignalPatterns.get(key) || 0) + 1);
        }
      }
    }
  }

  const setups = [...bySetup.values()].map(row => ({
    ...row,
    avgScore:round(row.scoreTotal / Math.max(1, row.appearances), 1),
    uniqueSymbols:row.symbols.size,
    symbols:undefined,
  })).sort((a, b) => b.actionable - a.actionable || b.maxScore - a.maxScore);
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  return {
    snapshots:safeArray(snapshots).length,
    usableSnapshots,
    candidateRows,
    actionableRows,
    setups:setups.slice(0, 20),
    blockedReasons:top(blockedReasons),
    evidenceReasons:top(evidenceReasons),
    emergingPatterns:top(noSignalPatterns).filter(row => row.count >= 3),
    settingsFingerprints:top(settingsFingerprints).map(row => ({ fingerprint:row.reason, snapshots:row.count })),
  };
}

function compactSetup(row) {
  if (!row) return null;
  return {
    setupType:row.setupType,
    label:row.label,
    trades:row.trades,
    wins:row.wins,
    losses:row.losses,
    winRate:row.winRate,
    netPnl:row.netPnl,
    avgNetPct:row.avgNetPct,
    profitFactor:row.profitFactor,
    maxDrawdown:row.maxDrawdown,
    efficiencyScore:row.efficiencyScore,
    grade:row.grade,
  };
}

function compactExit(row) {
  if (!row) return null;
  return {
    exitCategory:row.exitCategory,
    exits:row.exits,
    wins:row.wins,
    losses:row.losses,
    winRate:row.winRate,
    netPnl:row.netPnl,
    opportunityLoss:row.opportunityLoss,
    valueProtected:row.valueProtected,
    perfectExits:row.perfectExits,
    perfectExitRate:row.perfectExitRate,
    benchmarkCoveragePct:row.benchmarkCoveragePct,
    qualityScore:row.qualityScore,
  };
}

function settingEvidence(key, settings, overrides = {}) {
  const current = settings[key];
  const defaultValue = TradeRules.DEFAULT_SETTINGS[key];
  const overridden = Object.prototype.hasOwnProperty.call(overrides, key);
  const differsFromDefault = String(current) !== String(defaultValue);
  return {
    key,
    value:current,
    defaultValue,
    overridden,
    differsFromDefault,
    source:overridden ? 'current-override' : differsFromDefault ? 'historical-or-derived' : 'default',
    description:TradeRules.SETTING_DESCRIPTIONS?.[key] || '',
    valueType:Array.isArray(current) ? 'array' : current === null ? 'null' : typeof current,
  };
}

function buildConfigurationEvidence(settings = {}, overrides = {}, diagnostics = {}, setupPayload = {}) {
  const definitions = TradeRules.SIMULATION_SETUP_DEFINITIONS || [];
  const claimed = new Set();
  const performanceByType = new Map(safeArray(setupPayload?.setups).map(row => [row.setupType, compactSetup(row)]));
  const snapshotByType = new Map(safeArray(diagnostics?.setups).map(row => [row.setupType, row]));
  const setups = definitions.map(definition => {
    const prefixes = safeArray(definition.settingPrefixes);
    const excludes = safeArray(definition.excludePrefixes);
    const keys = Object.keys(settings).filter(key =>
      key === definition.key
      || (
        prefixes.some(prefix => key.startsWith(prefix))
        && !excludes.some(prefix => key.startsWith(prefix))
      )
    ).sort();
    keys.forEach(key => claimed.add(key));
    const enabled = settings[definition.key] !== false;
    return {
      setupType:definition.type,
      label:definition.label,
      side:definition.side,
      description:definition.description,
      enableSetting:definition.key,
      enabled,
      enabledByDefault:TradeRules.DEFAULT_SETTINGS[definition.key] !== false,
      enableOverridden:Object.prototype.hasOwnProperty.call(overrides, definition.key),
      settingPrefixes:prefixes,
      excludedPrefixes:excludes,
      usedOnDate:Boolean(performanceByType.get(definition.type)?.trades || snapshotByType.get(definition.type)?.appearances),
      transactionPerformance:performanceByType.get(definition.type) || null,
      snapshotActivity:snapshotByType.get(definition.type) || null,
      configuration:keys.map(key => settingEvidence(key, settings, overrides)),
    };
  });
  const sharedConfiguration = Object.keys(settings)
    .filter(key => !claimed.has(key))
    .sort()
    .map(key => settingEvidence(key, settings, overrides));
  return {
    setups,
    sharedConfiguration,
    overrideCount:Object.keys(overrides || {}).length,
    effectiveSettingCount:Object.keys(settings || {}).length,
  };
}

function createStrategyAdvisorFileService({
  db,
  setupEfficiencyService,
  exitQualityService,
  loadSnapshots,
  loadSettings,
  loadSettingOverrides = () => ({}),
  outputDir = path.join(__dirname, '..', 'reports', 'strategy-advisor'),
  now = () => Date.now(),
  logger = console,
} = {}) {
  const states = new Map();
  const subscribers = new Map();

  function pathsFor(date) {
    return {
      evidence:path.join(outputDir, `strategy_advisor_evidence_${date}.json`),
      result:path.join(outputDir, `strategy_advisor_result_${date}.json`),
    };
  }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  function fileUpdatedAt(file) {
    try { return Math.floor(fs.statSync(file).mtimeMs); } catch (_) { return 0; }
  }

  function writeJsonAtomic(file, payload) {
    fs.mkdirSync(path.dirname(file), { recursive:true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }

  function publish(date) {
    const payload = getPayload(date);
    for (const listener of subscribers.get(date) || []) {
      try { listener(payload); } catch (_) {}
    }
  }

  function subscribe(date, listener) {
    if (!subscribers.has(date)) subscribers.set(date, new Set());
    subscribers.get(date).add(listener);
    return () => {
      subscribers.get(date)?.delete(listener);
      if (!subscribers.get(date)?.size) subscribers.delete(date);
    };
  }

  function getPayload(date) {
    const files = pathsFor(date);
    const evidence = readJson(files.evidence);
    const result = readJson(files.result);
    const state = states.get(date) || null;
    return {
      ok:true,
      date,
      state,
      evidence:evidence ? {
        date:evidence.date,
        generatedAt:evidence.generatedAt,
        path:files.evidence,
        updatedAt:fileUpdatedAt(files.evidence),
        summary:evidence.summary,
      } : null,
      result:result ? {
        ...result,
        updatedAt:fileUpdatedAt(files.result) || Number(result.updatedAt) || 0,
        resultPath:files.result,
      } : null,
    };
  }

  async function prepare(date) {
    if (!isTradingDate(date)) throw new Error('Date must use YYYY-MM-DD format');
    const active = states.get(date);
    if (active && ['queued', 'running'].includes(active.status)) return active;
    const state = {
      id:`evidence-${date}-${now().toString(36)}`,
      date,
      status:'queued',
      phase:'queued',
      progress:0,
      createdAt:now(),
      updatedAt:now(),
    };
    states.set(date, state);
    publish(date);
    setImmediate(async () => {
      try {
        Object.assign(state, { status:'running', phase:'reconciling analytics', progress:15, updatedAt:now() });
        publish(date);
        await Promise.all([
          setupEfficiencyService.reconcile('strategy-advisor-evidence'),
          exitQualityService.reconcile('strategy-advisor-evidence'),
        ]);
        Object.assign(state, { phase:'summarizing snapshots', progress:55, updatedAt:now() });
        publish(date);
        const settings = { ...TradeRules.DEFAULT_SETTINGS, ...(await loadSettings(date) || {}) };
        const overrides = { ...(await loadSettingOverrides(date) || {}) };
        const diagnostics = snapshotDiagnostics(safeArray(await loadSnapshots(date)), settings);
        const setupPayload = setupEfficiencyService.getPayload('all', date);
        const exitPayload = exitQualityService.getPayload('all', date);
        const configuration = buildConfigurationEvidence(settings, overrides, diagnostics, setupPayload);
        const positionFacts = db?.listSetupEfficiencyFacts
          ? db.listSetupEfficiencyFacts().filter(row => row.tradeDay === date)
          : [];
        const exitFacts = db?.listExitQualityFacts
          ? db.listExitQualityFacts().filter(row => row.tradeDay === date)
          : [];
        const evidence = {
          schemaVersion:1,
          date,
          generatedAt:now(),
          instructions:{
            replayAllowed:false,
            backtestAllowed:false,
            sweepAllowed:false,
            applySettingsAllowed:false,
          },
          summary:{
            setupTrades:Number(setupPayload?.summary?.closedPositions) || 0,
            exits:Number(exitPayload?.summary?.exits) || 0,
            snapshots:diagnostics.snapshots,
            usableSnapshots:diagnostics.usableSnapshots,
          },
          setupEfficiency:{
            summary:setupPayload?.summary || {},
            setups:safeArray(setupPayload?.setups).filter(row => Number(row?.trades) > 0).map(compactSetup),
          },
          exitQuality:{
            summary:exitPayload?.summary || {},
            categories:safeArray(exitPayload?.categories).filter(row => Number(row?.exits) > 0).map(compactExit),
          },
          snapshots:diagnostics,
          transactions:{
            positions:positionFacts,
            exits:exitFacts,
          },
          configuration,
        };
        writeJsonAtomic(pathsFor(date).evidence, evidence);
        Object.assign(state, {
          status:'prepared',
          phase:'evidence ready for Codex',
          progress:100,
          completedAt:now(),
          updatedAt:now(),
          evidencePath:pathsFor(date).evidence,
          summary:evidence.summary,
        });
        publish(date);
      } catch (error) {
        Object.assign(state, {
          status:'error',
          phase:'failed',
          progress:100,
          error:error?.message || String(error),
          completedAt:now(),
          updatedAt:now(),
        });
        publish(date);
        logger.warn?.('[strategy-advisor] Evidence preparation failed:', state.error);
      }
    });
    return state;
  }

  return {
    prepare,
    getPayload,
    subscribe,
    pathsFor,
  };
}

module.exports = {
  snapshotDiagnostics,
  buildConfigurationEvidence,
  createStrategyAdvisorFileService,
};
