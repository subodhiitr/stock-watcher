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
const HARD_STOP_TYPES = new Set(['hard-stop', 'hard_stop', 'hardstop']);

class RuntimeStatePersistenceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RuntimeStatePersistenceError';
    this.code = 'RUNTIME_STATE_PERSISTENCE_ERROR';
    this.cause = cause;
  }
}

class RuntimeStateTransitionError extends Error {
  constructor(message, currentState, actionType, actionMode) {
    super(message);
    this.name = 'RuntimeStateTransitionError';
    this.code = 'INVALID_RUNTIME_TRANSITION';
    this.currentState = currentState;
    this.actionType = actionType;
    this.actionMode = actionMode;
  }
}

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
  const tempPath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  try {
    ensureParentDir(filePath);
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    throw new RuntimeStatePersistenceError(`Failed to persist runtime state at ${filePath}`, error);
  }
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
  const current = loadRuntimeState(filePath);
  const normalized = coerceRuntimeState({ ...current, ...(nextState || {}) });
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
    if (currentState.state !== 'off') {
      throw new RuntimeStateTransitionError('Start is only allowed from off state', currentState.state, type, mode);
    }
    next.state = 'running';
    if (typeof actionObject.autoResume === 'boolean') {
      next.autoResume = actionObject.autoResume;
    }
  } else if (type === 'stop') {
    if (mode === 'immediate') {
      if (currentState.state !== 'running' && currentState.state !== 'settling') {
        throw new RuntimeStateTransitionError('Immediate stop is only allowed from running or settling state', currentState.state, type, mode);
      }
      next.state = 'off';
    } else if (currentState.state === 'running') {
      next.state = 'settling';
    } else {
      throw new RuntimeStateTransitionError('Settle stop is only allowed from running state', currentState.state, type, mode);
    }
  } else if (type === 'settled') {
    if (currentState.state !== 'settling') {
      throw new RuntimeStateTransitionError('Settled is only allowed from settling state', currentState.state, type, mode);
    }
    next.state = 'off';
  } else if (HARD_STOP_TYPES.has(type)) {
    if (currentState.state !== 'running' && currentState.state !== 'settling') {
      throw new RuntimeStateTransitionError('Hard stop is only allowed from running or settling state', currentState.state, type, mode);
    }
    next.state = 'off';
  } else {
    throw new RuntimeStateTransitionError('Unknown transition action', currentState.state, type, mode);
  }

  if (typeof actionObject.lastError === 'string') {
    next.lastError = actionObject.lastError;
  }

  next.updatedAt = Date.now();
  return coerceRuntimeState(next);
}

module.exports = {
  DEFAULT_RUNTIME_STATE,
  RuntimeStatePersistenceError,
  RuntimeStateTransitionError,
  loadRuntimeState,
  saveRuntimeState,
  transitionRuntimeState
};