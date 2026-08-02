const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROXY_PATH = path.join(__dirname, '..', 'ticker_proxy.js');

test('scheduler candidate builder uses intraday cache instead of direct fetches', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function buildSchedulerCandidatesFromIntradayCache\(settings,\s*symbolMetaBySymbol\s*=\s*null/);
  const start = source.indexOf('function buildSchedulerCandidatesFromIntradayCache(settings, symbolMetaBySymbol = null');
  const body = source.slice(start, start + 1200);
  assert.doesNotMatch(body, /fetchIntradaySignal\(/);
  assert.match(body, /assetType[\s\S]*SIMULATION_ENABLE_ETF !== true/);
});

test('server snapshot candidates persist a compact latest candle for replay audit', () => {
  const proxy = require('../ticker_proxy');
  const candidate = proxy.__test__.buildServerCandidateFromIntradayForTests('TEST', {
    price: 101.5,
    signal: 'buy',
    score: 70,
    target: 103,
    stop: 100,
    ohlc: {
      latestBar: {
        time: '2026-07-10T04:45:00.000Z',
        open: 100,
        high: 102,
        low: 99.5,
        close: 101.5,
        volume: 12345,
      },
    },
  }, {}, null, '2026-07-10T04:45:22.000Z');

  assert.deepEqual(candidate.candles, [{
    time: '2026-07-10T04:45:00.000Z',
    open: 100,
    high: 102,
    low: 99.5,
    close: 101.5,
    volume: 12345,
  }]);
  assert.deepEqual(candidate.candleCapture, {
    interval: '5m',
    mode: 'latest-bar-delta',
    available: true,
    reason: '',
  });
});

test('server snapshot candidates explain when a candle is unavailable', () => {
  const proxy = require('../ticker_proxy');
  const candidate = proxy.__test__.buildServerCandidateFromIntradayForTests('TEST', {
    price: 101.5,
    signal: 'hold',
    score: 0,
    staleReason: 'Insufficient intraday data (0 candles, need 1+)',
  });

  assert.deepEqual(candidate.candles, []);
  assert.equal(candidate.candleCapture.available, false);
  assert.equal(candidate.candleCapture.reason, 'Insufficient intraday data (0 candles, need 1+)');
});

test('starting simulation scheduler triggers shared intraday cache refresh', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf("function startSimulationScheduler(reason = 'manual-start')");
  assert.ok(start > -1);
  const body = source.slice(start, start + 1000);
  assert.match(body, /startIntradayLiveRefresh\('scheduler-start'\)/);
  assert.match(body, /refreshIntradayLiveCache\('scheduler-start'\)/);
  assert.match(body, /triggerSimulationTickAfterScoreUpdate\('scheduler-start', \[\]\)/);
});

test('score refresh triggers simulation rules immediately after cache update', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function triggerSimulationTickAfterScoreUpdate\(reason = 'score-update'/);
  assert.match(source, /runSimulationSchedulerTick\(\)/);
  const refreshStart = source.indexOf("async function refreshIntradayLiveCache(reason = 'interval')");
  assert.ok(refreshStart > -1);
  const refreshBody = source.slice(refreshStart, refreshStart + 1800);
  assert.match(refreshBody, /intradayLiveCache\.set\(sym, nextValue\)/);
  assert.match(refreshBody, /triggerSimulationTickAfterScoreUpdate\(reason, chunkChanged\)/);
  const sharekhanStart = source.indexOf('async function pushSharekhanTickerCandles(sym, candles)');
  assert.ok(sharekhanStart > -1);
  const sharekhanBody = source.slice(sharekhanStart, sharekhanStart + 5200);
  assert.match(sharekhanBody, /intradayLiveCache\.set\(sym, nextValue\)/);
  assert.match(sharekhanBody, /triggerSimulationTickAfterScoreUpdate\('sharekhan-ws-tick', \[sym\]\)/);
});

test('Sharekhan updates preserve broadcast cadence and coalesce simulation ticks', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const sharekhanStart = source.indexOf('async function pushSharekhanTickerCandles(sym, candles)');
  assert.ok(sharekhanStart > -1);
  const sharekhanBody = source.slice(sharekhanStart, sharekhanStart + 5200);
  assert.match(sharekhanBody, /const lastBroadcastAt = Number\(prev\?\._lastBroadcastAt\) \|\| 0;/);
  assert.match(sharekhanBody, /nextValue\._lastBroadcastAt = lastBroadcastAt;/);
  assert.doesNotMatch(sharekhanBody, /const lastBroadcastAt = nextValue\._lastBroadcastAt \|\| 0;/);

  assert.match(source, /const SIMULATION_ACTIVE_TICK_MIN_INTERVAL_MS = 2000;/);
  assert.match(source, /const SIMULATION_IDLE_TICK_MIN_INTERVAL_MS = 5000;/);
  assert.match(source, /function schedulePendingSimulationTick\(\)/);
  assert.match(source, /const minimumIntervalMs = simulationOpenManagedTradeCount > 0/);
  assert.match(source, /const delayMs = Math\.max\(0, minimumIntervalMs - elapsedMs\);/);
  assert.match(source, /const simulationImmediateTickChangedSymbols = new Set\(\);/);
  assert.doesNotMatch(source, /triggerSimulationTickAfterScoreUpdate\(`\$\{reason\}:in-flight`/);
});

test('simulation decision journal is asynchronous and cycle records are heartbeat limited', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const journalStart = source.indexOf('function appendSimulationDecisionJournal(');
  assert.ok(journalStart > -1);
  const journalBody = source.slice(journalStart, journalStart + 900);
  assert.match(journalBody, /simulationDecisionJournalQueue = simulationDecisionJournalQueue/);
  assert.match(journalBody, /fs\.promises\.appendFile/);
  assert.doesNotMatch(journalBody, /appendFileSync/);
  assert.match(source, /const SIMULATION_DECISION_HEARTBEAT_MS = 15 \* 1000;/);
  assert.match(source, /const decisionChanged = decisionSignature !== simulationLastCycleDecisionSignature;/);
  assert.match(source, /const shouldJournalCycle = decisionChanged/);
  assert.match(source, /\? \(hasDecisionIntent \? 'decision-change' : 'decision-cleared'\)/);
});

test('scheduler tick input includes market indices and sector trend for regime checks', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf('async function readSchedulerTickInputAsync(settings)');
  assert.ok(start > -1);
  const body = source.slice(start, start + 2200);
  assert.match(body, /const market = await getSimulationMarketContext\(\)/);
  assert.match(body, /sectorTrend:\s*buildSectorTrendFromCandidates\(serverCandidates\)/);
  assert.match(source, /function buildSectorTrendFromCache\(\)/);
  assert.match(source, /const enriched = \[\.\.\.intradayLiveCache\.entries\(\)\]\.map/);
  assert.match(source, /buildSectorTrendFromCandidates\(enriched\)/);
  assert.match(source, /intradayLiveCache\.set\(sym, nextValue\)/);
});

test('simulation market cache does not treat empty indices as valid for regime checks', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /function hasUsableMarketIndices\(indices\)/);
  const start = source.indexOf('async function getSimulationMarketContext()');
  assert.ok(start > -1);
  const body = source.slice(start, start + 1200);
  assert.match(body, /hasUsableMarketIndices\(simulationMarketCache\.indices\)/);
  assert.match(body, /hasUsableMarketIndices\(indices\)/);
  assert.doesNotMatch(body, /if \(simulationMarketCache\.indices && now - simulationMarketCache\.fetchedAt/);
});

test('server simulation snapshots fetch market context instead of persisting raw empty cache', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf('async function persistServerSimulationSnapshot');
  assert.ok(start > -1);
  const body = source.slice(start, source.indexOf('\nfunction computePaperTradePnl', start));
  assert.match(body, /const market = await getSimulationMarketContext\(\)/);
  assert.doesNotMatch(body, /const market = \{ indices: simulationMarketCache\.indices \|\| \{\} \}/);
});

test('Sharekhan ticker subscribes Nifty 50 and Midcap 150 ticks into the live market cache', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /let sharekhanIndexCodeMap = new Map\(\)/);
  assert.match(source, /function getSharekhanConfiguredNiftyCode\(\)/);
  assert.match(source, /SHAREKHAN_NIFTY_SCRIP_CODE/);
  assert.match(source, /sharekhanCredentials\?\.niftyScripCode/);
  assert.match(source, /function getSharekhanConfiguredMidcap150Code\(\)/);
  assert.match(source, /SHAREKHAN_MIDCAP150_SCRIP_CODE/);
  assert.match(source, /sharekhanCredentials\?\.midcap150ScripCode/);
  assert.match(source, /key:'midcap'/);
  assert.match(source, /'NIFTY MIDCAP 150'/);
  assert.match(source, /function getSharekhanConfiguredSmallcap100Code\(\)/);
  assert.match(source, /function getSharekhanConfiguredBankNiftyCode\(\)/);
  assert.match(source, /key:'smallcap'/);
  assert.match(source, /'NIFTY SMALLCAP 100'/);
  assert.match(source, /key:'banknifty'/);
  assert.match(source, /'NIFTY BANK'/);
  assert.match(source, /function updateSimulationIndexFromSharekhanTick\(indexKey, tick\)/);
  assert.match(source, /source:'sharekhan-ws'/);
  assert.match(source, /function handleSharekhanTickerTick\(tick\)/);
  assert.match(source, /broadcastIntradayLive\(`sharekhan-\$\{indexKey\}-tick`, \[\]\)/);
  const initStart = source.indexOf('sharekhanTicker = new SharekhanTickerPool({');
  assert.ok(initStart > -1);
  const initBody = source.slice(initStart, initStart + 700);
  assert.match(initBody, /poolSize:\s*1/);
  assert.match(initBody, /onTick:\s*handleSharekhanTickerTick/);
  assert.match(initBody, /sharekhanTicker\.subscribe\(\[\.\.\.symToCode\.values\(\), \.\.\.sharekhanIndexCodeMap\.keys\(\)\]\)/);
});

test('scheduler passes sector trend context into simulation domain cycle', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  const start = source.indexOf('const { exitIntents, scaleInIntents, entryIntents } = runSimulationDomainCycle(');
  assert.ok(start > -1);
  const body = source.slice(start, start + 700);
  assert.match(body, /sectorTrend:\s*tickInput\?\.sectorTrend \|\| \{\}/);
  assert.match(body, /indices:\s*tickInput\?\.market\?\.indices \|\| \{\}/);
});

test('scheduler computes cashAvailable and positionMultiplier for simulation domain context', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /TradeRules\.computePortfolioEquity\(state\.portfolio, trades, 500000\)/);
  assert.match(source, /const serverCashAvailable = portfolioMetrics\.cashAvailable;/);
  assert.match(source, /TradeRules\.computePortfolioHeat\(trades, portfolioMetrics\.equity\)/);
  assert.match(source, /let remainingCash = serverCashAvailable;/);
  assert.match(source, /if \(!qty\) return null;/);
  assert.match(source, /const closedTrades = trades\.filter\(t => t\.status === 'closed'\);/);
  assert.match(source, /const serverPositionMultiplier = TradeRules\.computePositionSizeMultiplier\(closedTrades\);/);
  const start = source.indexOf('const { exitIntents, scaleInIntents, entryIntents } = runSimulationDomainCycle(');
  assert.ok(start > -1);
  const body = source.slice(start, start + 1200);
  assert.match(body, /cashAvailable:\s*serverCashAvailable/);
  assert.match(body, /positionMultiplier:\s*serverPositionMultiplier/);
});

test('ETF tab uses server-owned intraday stream instead of direct intraday batch fetch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard-app.js'), 'utf8');
  const start = source.indexOf("async function setView(view, el)");
  assert.ok(start > -1);
  const body = source.slice(start, start + 1200);
  assert.match(body, /startIntradayLiveStream\(syms\)/);
  assert.doesNotMatch(body, /fetchIntradaySignals\(syms\)/);
});

test('scheduler persists per-stock milestone changes even when no exit is emitted', () => {
  const source = fs.readFileSync(PROXY_PATH, 'utf8');
  assert.match(source, /const milestoneStateBefore = new Map\(openTrades\.map/);
  assert.match(source, /floorPct:trade\?\.gainMilestoneFloorPct/);
  assert.match(source, /history:\s*Array\.isArray\(trade\?\.gainMilestones\)/);
  assert.match(source, /const milestoneChanged = openTrades\.some\(trade => milestoneStateBefore\.get/);
  assert.match(source, /if \(milestoneChanged\) changed = true;/);
  assert.match(source, /if \(changed\) \{\s*savePaperStateFile\(state\)/);
});
