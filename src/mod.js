import MiniEventEmitter from './mini_eventemitter.js';
import Message, { EVENTS } from './message.js';

const _hostBus = new MiniEventEmitter();
const _plugins = new Map();
const _toolDefs = new Map();
const _modeDefs = new Map();
let _activeModeId = null;
let _overlayEl = null;
let _overlayStyleEl = null;
let _reloadTimer = 0;

function _nowId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function _hasPerm(manifest, perm) {
  const p = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];
  return p.includes(perm);
}

function _canTopic(manifest, pluginId, topic) {
  const t = String(topic || '').trim();
  if (!t) return false;
  if (t.startsWith(`${pluginId}/`)) return true;
  if (t.startsWith('public/')) return _hasPerm(manifest, 'bus:cross');
  const parts = t.split('/');
  if (parts.length >= 2 && parts[1] === 'public') return _hasPerm(manifest, 'bus:cross');
  return false;
}

function _insertStyleOnce() {
  if (_overlayStyleEl) return;
  const el = document.createElement('style');
  el.textContent = `
    .mod-overlay{position:fixed;inset:0;z-index:5200;display:none;align-items:center;justify-content:center}
    .mod-overlay.open{display:flex}
    .mod-overlay .mod-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.35)}
    .mod-overlay .mod-panel{position:relative;min-width:280px;max-width:min(92vw,920px);max-height:86vh;overflow:auto;border-radius:14px;background:rgba(255,255,255,0.98);border:1px solid rgba(0,0,0,0.08);box-shadow:0 14px 48px rgba(0,0,0,0.28);padding:12px}
    .theme-dark .mod-overlay .mod-panel{background:rgba(12,12,12,0.92);border:1px solid rgba(255,255,255,0.06);box-shadow:0 18px 58px rgba(0,0,0,0.6);color:#e6e6e6}
  `;
  document.head.appendChild(el);
  _overlayStyleEl = el;
}

function _ensureOverlay() {
  if (_overlayEl) return _overlayEl;
  _insertStyleOnce();
  const root = document.createElement('div');
  root.className = 'mod-overlay';
  const backdrop = document.createElement('div');
  backdrop.className = 'mod-backdrop';
  const panel = document.createElement('div');
  panel.className = 'mod-panel';
  root.appendChild(backdrop);
  root.appendChild(panel);
  backdrop.addEventListener('click', () => _closeOverlay());
  root.addEventListener('click', (e) => {
    const t = e && e.target;
    if (!t || !(t instanceof HTMLElement)) return;
    const action = t.getAttribute('data-mod-action');
    const pluginId = t.getAttribute('data-mod-plugin');
    if (!action || !pluginId) return;
    _sendToPlugin(pluginId, { type: 'ui-action', data: { action, value: t.getAttribute('data-mod-value') || '' } });
  });
  document.body.appendChild(root);
  _overlayEl = root;
  return root;
}

function _openOverlay(html) {
  const root = _ensureOverlay();
  const panel = root.querySelector('.mod-panel');
  if (panel) panel.innerHTML = String(html || '');
  root.classList.add('open');
}

function _closeOverlay() {
  if (!_overlayEl) return;
  _overlayEl.classList.remove('open');
  const panel = _overlayEl.querySelector('.mod-panel');
  if (panel) panel.innerHTML = '';
}

async function _invokeMain(channel, ...args) {
  if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') {
    return { success: false, error: 'ipc unavailable' };
  }
  return await window.electronAPI.invokeMain(channel, ...args);
}

function _onMain(channel, cb) {
  if (!window || !window.electronAPI || typeof window.electronAPI.onReplyFromMain !== 'function') return;
  window.electronAPI.onReplyFromMain(channel, (...args) => cb(...args));
}

function _toolContainer() {
  return document.querySelector('.floating-panel .panel-section.tools');
}

function _moreMenuBody() {
  const menu = document.getElementById('moreMenu');
  if (!menu) return null;
  return menu.querySelector('.submenu-body');
}

function _createToolButton(def) {
  const container = _toolContainer();
  if (!container) return null;
  const wrap = document.createElement('div');
  wrap.className = 'tool';
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.id = def.domId;
  btn.setAttribute('title', def.title || '');
  btn.innerHTML = def.iconSvg || def.label || 'Mod';
  btn.addEventListener('click', () => {
    _sendToPlugin(def.pluginId, { type: 'tool-click', data: { toolId: def.toolId } });
  });
  wrap.appendChild(btn);

  const collapseBtn = document.getElementById('collapseTool');
  if (collapseBtn && collapseBtn.parentElement && collapseBtn.parentElement.classList.contains('tool')) {
    container.insertBefore(wrap, collapseBtn.parentElement);
  } else {
    container.appendChild(wrap);
  }
  return btn;
}

function _createModeButton(def) {
  const body = _moreMenuBody();
  if (!body) return null;
  const btn = document.createElement('button');
  btn.className = 'mode-btn';
  btn.id = def.domId;
  btn.textContent = def.title || def.modeId;
  btn.addEventListener('click', async () => {
    await Mod.activateMode(def.pluginId, def.modeId);
  });
  body.appendChild(btn);
  return btn;
}

function _sendToPlugin(pluginId, msg) {
  const p = _plugins.get(pluginId);
  if (!p || !p.worker) return;
  try { p.worker.postMessage(msg); } catch (e) {}
}

function _terminateAll() {
  for (const p of _plugins.values()) {
    try {
      const off = Array.isArray(p.offFns) ? p.offFns : [];
      off.forEach((fn) => { try { fn(); } catch (e) {} });
    } catch (e) {}
    try { if (p.worker) p.worker.terminate(); } catch (e) {}
    try { if (p.moduleUrl) URL.revokeObjectURL(p.moduleUrl); } catch (e) {}
    try { if (p.bootUrl) URL.revokeObjectURL(p.bootUrl); } catch (e) {}
  }
  _plugins.clear();
  _toolDefs.clear();
  _modeDefs.clear();
  _activeModeId = null;
  _closeOverlay();
}

async function _readAssetText(pluginId, relPath) {
  const res = await _invokeMain('message', 'mod:read-asset', { id: pluginId, path: relPath, as: 'utf8' });
  if (!res || !res.success) throw new Error((res && res.error) || 'read asset failed');
  return String(res.data || '');
}

async function _spawnWorker(pluginId, manifest, entryPath) {
  const pluginSrc = await _readAssetText(pluginId, entryPath);
  const moduleBlob = new Blob([pluginSrc], { type: 'text/javascript' });
  const moduleUrl = URL.createObjectURL(moduleBlob);

  const perms = Array.isArray(manifest && manifest.permissions) ? manifest.permissions.map(String) : [];
  const boot = `
    const _evt = (()=>{ const m=new Map(); return { on:(k,f)=>{ if(!m.has(k)) m.set(k,[]); m.get(k).push(f); }, emit:(k,d)=>{ const a=m.get(k)||[]; for(const f of a){ try{ f(d); }catch(e){} } } }; })();
    const __perms = new Set(${JSON.stringify(perms)});
    if (!__perms.has('net:fetch')) {
      try { self.fetch = undefined; } catch (e) {}
      try { self.WebSocket = undefined; } catch (e) {}
    }
    const Mod = {
      on: (name, cb)=>{ _evt.on(String(name||''), cb); },
      publish: (topic, payload)=>{ self.postMessage({ type:'bus-publish', topic, payload }); },
      subscribe: (topic)=>{ self.postMessage({ type:'bus-subscribe', topic }); },
      registerTool: (def)=>{ self.postMessage({ type:'register-tool', def }); },
      registerMode: (def)=>{ self.postMessage({ type:'register-mode', def }); },
      showOverlay: (def)=>{ self.postMessage({ type:'show-overlay', def }); },
      closeOverlay: ()=>{ self.postMessage({ type:'close-overlay' }); }
    };
    self.Mod = Mod;
    self.onmessage = (ev)=>{
      const m = ev && ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'init') _evt.emit('init', m.data || {});
      if (m.type === 'bus-event') _evt.emit('bus', m.data || {});
      if (m.type === 'tool-click') _evt.emit('tool', m.data || {});
      if (m.type === 'mode-activate') _evt.emit('mode', m.data || {});
      if (m.type === 'ui-action') _evt.emit('ui', m.data || {});
    };
    (async()=>{ await import(${JSON.stringify(moduleUrl)}); self.postMessage({ type:'ready' }); })().catch((e)=>{ self.postMessage({ type:'error', error: String(e && e.message || e) }); });
  `;
  const bootBlob = new Blob([boot], { type: 'text/javascript' });
  const bootUrl = URL.createObjectURL(bootBlob);
  const worker = new Worker(bootUrl, { type: 'module' });

  const ctx = { id: pluginId, manifest, worker, moduleUrl, bootUrl, subs: new Set(), offFns: [], ready: false };
  _plugins.set(pluginId, ctx);

  worker.onmessage = async (ev) => {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      ctx.ready = true;
      _sendToPlugin(pluginId, { type: 'init', data: { apiVersion: 1, pluginId, manifest } });
      return;
    }
    if (msg.type === 'error') return;
    if (msg.type === 'bus-subscribe') {
      const topic = String(msg.topic || '').trim();
      if (!_canTopic(manifest, pluginId, topic)) return;
      if (ctx.subs.has(topic)) return;
      ctx.subs.add(topic);
      const off = _hostBus.on(topic, (payload) => {
        _sendToPlugin(pluginId, { type: 'bus-event', data: { topic, payload } });
      });
      ctx.offFns.push(off);
      return;
    }
    if (msg.type === 'bus-publish') {
      const topic = String(msg.topic || '').trim();
      if (!_canTopic(manifest, pluginId, topic)) return;
      _hostBus.emit(topic, msg.payload);
      return;
    }
    if (msg.type === 'register-tool') {
      const def = msg.def && typeof msg.def === 'object' ? msg.def : {};
      const toolId = String(def.id || '').trim();
      if (!toolId) return;
      if (!_hasPerm(manifest, 'ui:toolbar')) return;
      const domId = `mod-tool-${pluginId}-${toolId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fullId = `${pluginId}:${toolId}`;
      if (_toolDefs.has(fullId)) return;
      const rec = { pluginId, toolId, domId, title: String(def.title || def.name || fullId), iconSvg: String(def.iconSvg || ''), label: String(def.label || ''), def };
      _toolDefs.set(fullId, rec);
      _createToolButton(rec);
      return;
    }
    if (msg.type === 'register-mode') {
      const def = msg.def && typeof msg.def === 'object' ? msg.def : {};
      const modeId = String(def.id || '').trim();
      if (!modeId) return;
      if (!_hasPerm(manifest, 'ui:mode')) return;
      const domId = `mod-mode-${pluginId}-${modeId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fullId = `${pluginId}:${modeId}`;
      if (_modeDefs.has(fullId)) return;
      const rec = { pluginId, modeId, domId, title: String(def.title || def.name || fullId), ui: def.ui || null };
      _modeDefs.set(fullId, rec);
      _createModeButton(rec);
      return;
    }
    if (msg.type === 'show-overlay') {
      if (!_hasPerm(manifest, 'ui:overlay')) return;
      const def = msg.def && typeof msg.def === 'object' ? msg.def : {};
      const kind = String(def.kind || 'html');
      if (kind === 'html') {
        _openOverlay(String(def.html || ''));
        return;
      }
      if (kind === 'asset') {
        const rel = String(def.path || '');
        if (!rel) return;
        try {
          const html = await _readAssetText(pluginId, rel);
          _openOverlay(html);
        } catch (e) {}
        return;
      }
    }
    if (msg.type === 'close-overlay') {
      _closeOverlay();
      return;
    }
  };

  worker.onerror = () => {};
  return ctx;
}

async function _listEnabledPlugins() {
  const res = await _invokeMain('message', 'mod:list', {});
  if (!res || !res.success) return [];
  const installed = Array.isArray(res.installed) ? res.installed : [];
  return installed.filter((x) => x && x.enabled && x.manifest);
}

async function _loadAll() {
  _terminateAll();
  const list = await _listEnabledPlugins();
  const start = performance.now();
  const budgetMs = 480;
  let skipped = 0;
  for (const p of list) {
    if (performance.now() - start > budgetMs) { skipped += 1; continue; }
    const id = String(p.id || '');
    const manifest = p.manifest || {};
    const entry = manifest.entry && typeof manifest.entry === 'object' ? manifest.entry : {};
    const kind = String(entry.kind || '');
    const entryPath = String(entry.path || '');
    if (kind !== 'worker' || !entryPath) continue;
    try { await _spawnWorker(id, manifest, entryPath); } catch (e) {}
  }
  return { tookMs: Math.round(performance.now() - start), skipped };
}

function _scheduleReload(reason) {
  try { if (_reloadTimer) clearTimeout(_reloadTimer); } catch (e) {}
  _reloadTimer = setTimeout(async () => {
    _reloadTimer = 0;
    try { await _loadAll(); } catch (e) {}
  }, 80);
}

export const Mod = {
  list: async () => await _invokeMain('message', 'mod:list', {}),
  install: async (lanmodPath) => await _invokeMain('message', 'mod:install', { path: lanmodPath }),
  uninstall: async (id) => await _invokeMain('message', 'mod:uninstall', { id }),
  enable: async (id, enabled) => await _invokeMain('message', 'mod:enable', { id, enabled: !!enabled }),
  readAsset: async (id, relPath, as) => await _invokeMain('message', 'mod:read-asset', { id, path: relPath, as }),
  publish: (topic, payload) => { _hostBus.emit(String(topic || ''), payload); },
  on: (topic, cb) => _hostBus.on(String(topic || ''), cb),
  activateMode: async (pluginId, modeId) => {
    const fullId = `${pluginId}:${modeId}`;
    const def = _modeDefs.get(fullId);
    if (!def) return { success: false, error: 'mode not found' };
    _activeModeId = fullId;
    _sendToPlugin(pluginId, { type: 'mode-activate', data: { modeId, active: true } });
    if (def.ui && typeof def.ui === 'object') {
      const kind = String(def.ui.kind || '');
      if (kind === 'asset') {
        try {
          const html = await _readAssetText(pluginId, String(def.ui.path || ''));
          _openOverlay(html);
        } catch (e) {}
      }
      if (kind === 'html') _openOverlay(String(def.ui.html || ''));
    }
    return { success: true };
  },
  closeMode: () => {
    if (_activeModeId) {
      const [pluginId, modeId] = _activeModeId.split(':');
      _sendToPlugin(pluginId, { type: 'mode-activate', data: { modeId, active: false } });
    }
    _activeModeId = null;
    _closeOverlay();
  },
  reload: async () => await _loadAll(),
  init: async () => {
    _onMain('mod:changed', () => _scheduleReload('changed'));
    try {
      Message.on(EVENTS.APP_MODE_CHANGED, (p) => { _hostBus.emit('public/app-mode-changed', p); });
      Message.on(EVENTS.SETTINGS_CHANGED, (p) => { _hostBus.emit('public/settings-changed', p); });
      Message.on(EVENTS.HISTORY_CHANGED, (p) => { _hostBus.emit('public/history-changed', p); });
    } catch (e) {}
    return await _loadAll();
  }
};

try { window.Mod = Mod; } catch (e) {}

setTimeout(() => { Mod.init(); }, 0);

export default Mod;
