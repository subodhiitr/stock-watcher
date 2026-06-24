const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RUNTIME_STATE = {
  state: 'off',
  autoResume: true,
  lastTickAt: 0,
  updatedAt: 0,
  lastError: '',
  version: 1
};

const VALID_STATES = new Set(['off', 'running', 'settling']);

function coerceEpochMs(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.trunc(numeric);
}

function coerceVersion(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return DEFAULT_RUNTIME_STATE.version;
  }
  return Math.trunc(numeric);
}

function coerceRuntimeState(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};

  return {
    state: VALID_STATES.has(source.state) ? source.state : DEFAULT_RUNTIME_STATE.state,
    autoResume: typeof source.autoResume === 'boolean' ? source.autoResume : DEFAULT_RUNTIME_STATE.autoResume,
    lastTickAt: coerceEpochMs(source.lastTickAt, DEFAULT_RUNTIME_STATE.lastTickAt),
    updatedAt: coerceEpochMs(source.updatedAt, DEFAULT_RUNTIME_STATE.updatedAt),
    lastError: typeof source.lastError === 'string' ? source.lastError : DEFAULT_RUNTIME_STATE.lastError,
    version: coerceVersion(source.version)
  };
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeState(filePath, state) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function loadRuntimeState(filePath) {
  const parsed = readJson(filePath);
  const normalized = coerceRuntimeState(parsed);

  if (parsed === null || JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    writeState(filePath, normalized);
  }

  return normalized;
}

function saveRuntimeState(filePath, nextState) {
  const normalized = coerceRuntimeState(nextState);
  normalized.updatedAt = Date.now();
  writeState(filePath, normalized);
  return normalized;
}

function transitionRuntimeState(current, action) {
  const currentState = coerceRuntimeState(current);
  const actionObject = typeof action === 'string' ? { type: action } : (action || {});
  const type = typeof actionObject.type === 'string' ? actionObject.type.toLowerCase() : '';
  const mode = typeof actionObject.mode === 'string' ? actionObject.mode.toLowerCase() : 'settle';

  const next = { ...currentState, lastError: '' };

  if (type === 'start') {
    next.state = 'running';
    if (typeof actionObject.autoResume === 'boolean') {
      next.autoResume = actionObject.autoResume;
    }
  } else if (type === 'stop') {
    if (mode === 'immediate') {
      next.state = 'off';
    } else if (currentState.state === 'running') {
      next.state = 'settling';
    }
  } else if (type === 'settled') {
    if (currentState.state === 'settling') {
      next.state = 'off';
    }
  } else if (type === 'hard-stop' || type === 'hard_stop' || type === 'hardstop') {
    if (currentState.state === 'running' || currentState.state === 'settling') {
      next.state = 'off';
    }
  }

  if (typeof actionObject.lastError === 'string') {
    next.lastError = actionObject.lastError;
  }

  next.updatedAt = Date.now();
  return coerceRuntimeState(next);
}

module.exports = {
  DEFAULT_RUNTIME_STATE,
  loadRuntimeState,
  saveRuntimeState,
  transitionRuntimeState
};