const STORAGE_KEY = 'appStatus';
const MACHINES = {
  lifecycle: {
    initial: 'initializing',
    states: {
      initializing: { on: { READY: 'ready', ERROR: 'error' } },
      ready: { on: { BUSY: 'busy', ERROR: 'error', SHUTTING_DOWN: 'shutting-down' } },
      busy: { on: { IDLE: 'ready', ERROR: 'error', SHUTTING_DOWN: 'shutting-down' } },
      error: { on: { RESET: 'initializing' } },
      'shutting-down': { on: {} }
    }
  },
  mode: {
    initial: 'whiteboard',
    states: {
      whiteboard: { on: { SWITCH_TO_ANNOTATION: 'annotation' } },
      annotation: { on: { SWITCH_TO_WHITEBOARD: 'whiteboard' } }
    }
  }
};

let _state = null;
let _lastPersistError = '';
let _seq = 0;
let _snapshotSeq = 0;
const _listeners = new Set();
const _logListeners = new Set();
const _log = [];
const _snapshots = new Map();
let _debug = false;

function _safeParse(txt) {
  try {
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

function _readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function _writeRaw(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (e) {
    return false;
  }
}

function _clone(obj) {
  if (obj == null) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

function _normalizeState(raw) {
  const base = {
    version: 1,
    machines: {},
    context: {}
  };
  const src = raw && typeof raw === 'object' ? raw : {};
  const srcMachines = src.machines && typeof src.machines === 'object' ? src.machines : {};
  const srcContext = src.context && typeof src.context === 'object' ? src.context : {};
  for (const name of Object.keys(MACHINES)) {
    const def = MACHINES[name];
    const initial = String(def.initial);
    const machineRaw = srcMachines[name] && typeof srcMachines[name] === 'object' ? srcMachines[name] : {};
    const valueRaw = machineRaw.value;
    const value = typeof valueRaw === 'string' && def.states && def.states[valueRaw] ? valueRaw : initial;
    const ctxRaw = machineRaw.context && typeof machineRaw.context === 'object' ? machineRaw.context : {};
    base.machines[name] = { value, context: _clone(ctxRaw) };
  }
  base.context = _clone(srcContext);
  return base;
}

function _loadPersistedState() {
  const txt = _readRaw(STORAGE_KEY);
  if (!txt) {
    return _normalizeState(null);
  }
  const parsed = _safeParse(txt);
  if (!parsed || typeof parsed !== 'object') {
    return _normalizeState(null);
  }
  return _normalizeState(parsed);
}

function _persistState() {
  _lastPersistError = '';
  const s = _state && typeof _state === 'object' ? _state : null;
  if (!s) return;
  let ok = false;
  try {
    const txt = JSON.stringify(s);
    ok = _writeRaw(STORAGE_KEY, txt);
  } catch (e) {
    _lastPersistError = String(e && e.message ? e.message : e || '') || 'persist_failed';
    return;
  }
  if (!ok) {
    if (!_lastPersistError) _lastPersistError = 'persist_failed';
  }
}

function _debugLog() {
  if (!_debug) return;
  try {
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[Status]');
    console.debug.apply(console, args);
  } catch (e) {}
}

function _pushLog(entry) {
  _log.push(entry);
  if (_log.length > 500) _log.shift();
  for (const l of _logListeners) {
    try {
      l(entry);
    } catch (e) {}
  }
}

function _emitChange(meta) {
  const snapshot = getState();
  for (const l of _listeners) {
    try {
      l(snapshot, meta);
    } catch (e) {}
  }
}

function _ensureState() {
  if (_state && typeof _state === 'object') return;
  _state = _loadPersistedState();
}

function getState() {
  _ensureState();
  return _clone(_state);
}

function getMachineState(name) {
  _ensureState();
  const n = String(name || '');
  if (!n) return null;
  const m = _state.machines && _state.machines[n] ? _state.machines[n] : null;
  if (!m) return null;
  return { value: m.value, context: _clone(m.context || {}) };
}

function getMachines() {
  return Object.keys(MACHINES);
}

function getMachineConfig(name) {
  const n = String(name || '');
  if (!n) return null;
  const cfg = MACHINES[n];
  if (!cfg) return null;
  return _clone(cfg);
}

function _applyTransition(machineName, event, payload) {
  _ensureState();
  const name = String(machineName || '');
  const ev = String(event || '');
  if (!name || !ev) {
    return { ok: false, reason: 'invalid_args', state: getState() };
  }
  const cfg = MACHINES[name];
  if (!cfg) {
    return { ok: false, reason: 'unknown_machine', state: getState() };
  }
  const machines = _state.machines && typeof _state.machines === 'object' ? _state.machines : {};
  const curRaw = machines[name] && typeof machines[name] === 'object' ? machines[name] : {};
  const curValue = typeof curRaw.value === 'string' ? curRaw.value : String(cfg.initial);
  const curCtx = curRaw.context && typeof curRaw.context === 'object' ? curRaw.context : {};
  const stateCfg = cfg.states && cfg.states[curValue] ? cfg.states[curValue] : null;
  if (!stateCfg || !stateCfg.on || !stateCfg.on[ev]) {
    return { ok: false, reason: 'invalid_transition', state: getState() };
  }
  const nextValue = String(stateCfg.on[ev]);
  const patch = payload && typeof payload === 'object' && payload.context && typeof payload.context === 'object' ? payload.context : null;
  const nextCtx = patch ? Object.assign({}, curCtx, patch) : Object.assign({}, curCtx);
  const nextMachines = Object.assign({}, machines, { [name]: { value: nextValue, context: nextCtx } });
  const prevState = getState();
  const ts = Date.now();
  _state = {
    version: 1,
    machines: nextMachines,
    context: _state.context && typeof _state.context === 'object' ? Object.assign({}, _state.context) : {}
  };
  _persistState();
  const meta = {
    id: ++_seq,
    machine: name,
    event: ev,
    from: curValue,
    to: nextValue,
    ts,
    payload: payload && typeof payload === 'object' ? _clone(payload) : payload || null
  };
  _pushLog(meta);
  _debugLog('transition', name, ev, curValue, '->', nextValue, payload || null);
  return { ok: true, state: getState(), transition: meta, prev: prevState };
}

function transition(machineName, event, payload) {
  return _applyTransition(machineName, event, payload);
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function subscribeLog(listener) {
  if (typeof listener !== 'function') return () => {};
  _logListeners.add(listener);
  return () => {
    _logListeners.delete(listener);
  };
}

function getLog(limit) {
  const n = typeof limit === 'number' && limit > 0 ? limit : _log.length;
  if (!n) return [];
  return _clone(_log.slice(-n));
}

function createSnapshot(label) {
  _ensureState();
  const id = ++_snapshotSeq;
  const meta = {
    id,
    ts: Date.now(),
    label: label != null ? String(label) : ''
  };
  const snap = {
    id: meta.id,
    ts: meta.ts,
    label: meta.label,
    state: _clone(_state)
  };
  _snapshots.set(id, snap);
  if (_snapshots.size > 50) {
    const it = _snapshots.keys();
    const first = it.next();
    if (!first.done) {
      _snapshots.delete(first.value);
    }
  }
  return meta;
}

function listSnapshots() {
  const res = [];
  for (const s of _snapshots.values()) {
    res.push({ id: s.id, ts: s.ts, label: s.label });
  }
  return res.sort((a, b) => a.id - b.id);
}

function rollbackToSnapshot(id) {
  _ensureState();
  const snap = _snapshots.get(id);
  if (!snap) {
    return { ok: false, reason: 'snapshot_not_found', state: getState() };
  }
  const prev = getState();
  _state = _clone(snap.state);
  _persistState();
  const meta = {
    id: ++_seq,
    machine: '*',
    event: 'ROLLBACK',
    from: null,
    to: null,
    ts: Date.now(),
    payload: { snapshotId: id }
  };
  _pushLog(meta);
  _debugLog('rollback', id);
  _emitChange(meta);
  return { ok: true, state: getState(), transition: meta, prev };
}

function enableDebug(on) {
  _debug = !!on;
}

function getPersistStatus() {
  return { ok: !_lastPersistError, error: _lastPersistError || '' };
}

function resetState() {
  _state = _normalizeState(null);
  _persistState();
  const meta = {
    id: ++_seq,
    machine: '*',
    event: 'RESET',
    from: null,
    to: null,
    ts: Date.now(),
    payload: null
  };
  _pushLog(meta);
  _emitChange(meta);
  return getState();
}

_ensureState();
_persistState();

const Status = {
  getState,
  getMachineState,
  getMachines,
  getMachineConfig,
  transition,
  subscribe,
  subscribeLog,
  getLog,
  createSnapshot,
  listSnapshots,
  rollbackToSnapshot,
  enableDebug,
  getPersistStatus,
  resetState
};

export default Status;

