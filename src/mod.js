import MiniEventEmitter from './mini_eventemitter.js';
import Message, { EVENTS } from './message.js';
import ButtonBox from './button_box.js';
import Settings from './setting.js';

const _hostBus = new MiniEventEmitter();
const _plugins = new Map();
const _toolDefs = new Map();
const _modeDefs = new Map();
const _menuButtonDefs = new Map();
const _injectDefs = new Map();
let _activeModeId = null;
let _overlayEl = null;
let _overlayStyleEl = null;
let _reloadTimer = 0;
let _injectSeq = 0;
let _injectObserver = null;
const _injectContainers = new WeakMap();

function _toolLogicalId(pluginId, toolId) {
  return `${pluginId}:tool:${toolId}`;
}

function _menuLogicalId(pluginId, buttonId) {
  return `${pluginId}:menu:${buttonId}`;
}

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

function _audit(type, data) {
  try {
    _invokeMain('message', 'audit:log', Object.assign({ type: String(type || ''), ts: Date.now() }, (data && typeof data === 'object') ? data : {}));
  } catch (e) {}
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

function _moreMenuQuickGrid() {
  const menu = document.getElementById('moreMenu');
  if (!menu) return null;
  const byId = document.getElementById('moreMenuQuickGrid');
  if (byId) return byId;
  return menu.querySelector('.submenu-quick-grid');
}

function _buildIconButton(def) {
  const logicalId = def.buttonBoxId || _toolLogicalId(def.pluginId, def.toolId || def.buttonId || def.domId || '');
  const base = {
    id: logicalId,
    title: def.title || '',
    iconSvg: def.iconSvg || '',
    iconUrl: def.iconUrl || '',
    iconClass: def.iconClass || '',
    label: def.label || '',
    kind: 'toolbar',
    source: 'plugin',
    pluginId: def.pluginId,
    toolId: def.toolId || def.buttonId || ''
  };
  const reg = ButtonBox.registerButton(base) || base;
  const btn = ButtonBox.createButtonElement(reg, {
    domId: def.domId,
    variant: 'toolbar'
  });
  if (!btn) return null;
  ButtonBox.registerInstance(reg.id, btn, 'toolbar');
  return btn;
}

function _createToolButton(def) {
  try{
    const s = Settings.loadSettings();
    const map = s && s.pluginButtonDisplay && typeof s.pluginButtonDisplay === 'object' && !Array.isArray(s.pluginButtonDisplay)
      ? s.pluginButtonDisplay
      : {};
    const key = def.pluginId;
    const mode = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
    if (mode === 'library') return null;
    if (mode === 'more') {
      const rec = {
        pluginId: def.pluginId,
        buttonId: def.toolId,
        domId: def.domId,
        title: def.title,
        iconSvg: def.iconSvg,
        iconUrl: def.iconUrl,
        iconClass: def.iconClass,
        label: def.label
      };
      _createMenuButton(rec);
      return null;
    }
  }catch(e){}
  const container = _toolContainer();
  if (!container) return null;
  const wrap = document.createElement('div');
  wrap.className = 'tool';
  const btn = _buildIconButton(def);
  if (!btn) return null;
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

function _createMenuButton(def) {
  const grid = _moreMenuQuickGrid();
  if (!grid) return null;
  const logicalId = def.buttonBoxId || _menuLogicalId(def.pluginId, def.buttonId || '');
  const base = {
    id: logicalId,
    title: def.title || '',
    iconSvg: def.iconSvg || '',
    iconUrl: def.iconUrl || '',
    iconClass: def.iconClass || '',
    label: def.label || '',
    kind: 'menu',
    source: 'plugin',
    pluginId: def.pluginId,
    buttonId: def.buttonId || ''
  };
  const reg = ButtonBox.registerButton(base) || base;
  const btn = ButtonBox.createButtonElement(reg, {
    domId: def.domId,
    variant: 'menu'
  });
  if (!btn) return null;
  btn.addEventListener('click', () => {
    _sendToPlugin(def.pluginId, { type: 'menu-click', data: { buttonId: def.buttonId } });
  });
  ButtonBox.registerInstance(reg.id, btn, 'plugin-menu');
  grid.appendChild(btn);
  return btn;
}

function _sendToPlugin(pluginId, msg) {
  const p = _plugins.get(pluginId);
  if (!p || !p.worker) return;
  try { p.worker.postMessage(msg); } catch (e) {}
}

function _escapeAttrValue(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function _normalizeInjectDef(pluginId, raw) {
  const def = raw && typeof raw === 'object' ? raw : {};
  const selector = String(def.selector || '').trim();
  if (!selector) return null;
  const posRaw = String(def.position || def.pos || 'append').trim().toLowerCase();
  const position = (posRaw === 'prepend' || posRaw === 'before' || posRaw === 'after' || posRaw === 'replace') ? posRaw : 'append';
  const modeRaw = String(def.mode || 'async').trim().toLowerCase();
  const mode = (modeRaw === 'sync' || modeRaw === 'async') ? modeRaw : 'async';
  const priorityNum = Number(def.priority);
  const priority = Number.isFinite(priorityNum) ? priorityNum : 0;
  const repeat = !!def.repeat;
  const key = String(def.key || def.id || '').trim();
  const html = String(def.html || '');
  const idPart = String(def.id || '').trim() || _nowId();
  const id = `${pluginId}:${idPart}`;
  const seq = ++_injectSeq;
  const conflictRaw = String(def.conflict || 'replace').trim().toLowerCase();
  const conflict = (conflictRaw === 'skip' || conflictRaw === 'replace' || conflictRaw === 'stack') ? conflictRaw : 'replace';
  return { id, pluginId, selector, position, mode, priority, repeat, key, html, conflict, seq, appliedEls: new WeakSet(), pending: false };
}

function _getInjectContainer(targetEl, position) {
  if (!(targetEl instanceof HTMLElement)) return null;
  let perEl = _injectContainers.get(targetEl);
  if (!perEl) {
    perEl = new Map();
    _injectContainers.set(targetEl, perEl);
  }
  const existing = perEl.get(position);
  if (existing && existing.isConnected) return existing;
  const container = document.createElement('div');
  container.setAttribute('data-mod-inject-root', '1');
  container.setAttribute('data-mod-inject-pos', position);
  container.style.display = 'contents';
  if (position === 'before') {
    targetEl.insertAdjacentElement('beforebegin', container);
  } else if (position === 'after') {
    targetEl.insertAdjacentElement('afterend', container);
  } else if (position === 'prepend') {
    targetEl.insertAdjacentElement('afterbegin', container);
  } else if (position === 'replace') {
    targetEl.innerHTML = '';
    targetEl.insertAdjacentElement('afterbegin', container);
  } else {
    targetEl.insertAdjacentElement('beforeend', container);
  }
  perEl.set(position, container);
  return container;
}

function _reorderInjectContainer(container) {
  if (!(container instanceof HTMLElement)) return;
  const items = Array.from(container.children).filter((n) => n instanceof HTMLElement);
  items.sort((a, b) => {
    const ap = Number(a.getAttribute('data-mod-inject-priority') || '0');
    const bp = Number(b.getAttribute('data-mod-inject-priority') || '0');
    if (bp !== ap) return bp - ap;
    const as = Number(a.getAttribute('data-mod-inject-seq') || '0');
    const bs = Number(b.getAttribute('data-mod-inject-seq') || '0');
    return as - bs;
  });
  for (const el of items) container.appendChild(el);
}

function _applyInjectToTarget(rec, targetEl) {
  const container = _getInjectContainer(targetEl, rec.position);
  if (!container) return false;
  const key = rec.key ? `${rec.pluginId}:${rec.key}` : rec.id;
  const selector = `[data-mod-inject-key="${_escapeAttrValue(key)}"]`;
  const existing = container.querySelector(selector);
  if (existing instanceof HTMLElement) {
    if (rec.conflict === 'skip') return false;
    if (rec.conflict === 'replace') {
      existing.innerHTML = rec.html;
      existing.setAttribute('data-mod-inject-priority', String(rec.priority));
      existing.setAttribute('data-mod-inject-seq', String(rec.seq));
      _reorderInjectContainer(container);
      return true;
    }
  }
  const host = document.createElement('div');
  host.setAttribute('data-mod-inject-key', key);
  host.setAttribute('data-mod-inject-plugin', rec.pluginId);
  host.setAttribute('data-mod-inject-priority', String(rec.priority));
  host.setAttribute('data-mod-inject-seq', String(rec.seq));
  host.innerHTML = rec.html;
  container.appendChild(host);
  _reorderInjectContainer(container);
  return true;
}

function _tryApplyInjection(rec) {
  let matched = 0;
  let applied = 0;
  let els = [];
  try { els = Array.from(document.querySelectorAll(rec.selector)); } catch (e) { els = []; }
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    matched += 1;
    if (rec.appliedEls.has(el)) continue;
    const did = _applyInjectToTarget(rec, el);
    if (did) {
      rec.appliedEls.add(el);
      applied += 1;
    }
  }
  if (!matched && rec.mode === 'async') rec.pending = true;
  if (applied && !rec.repeat) rec.pending = false;
  return { matched, applied };
}

function _ensureInjectObserver() {
  if (_injectObserver) return;
  _injectObserver = new MutationObserver(() => {
    for (const rec of _injectDefs.values()) {
      if (!rec || typeof rec !== 'object') continue;
      if (rec.mode !== 'async') continue;
      if (!rec.pending && !rec.repeat) continue;
      const res = _tryApplyInjection(rec);
      if (res.applied) {
        _sendToPlugin(rec.pluginId, { type: 'ui-inject-applied', data: { id: rec.id, selector: rec.selector, position: rec.position, appliedCount: res.applied } });
      }
    }
  });
  try { _injectObserver.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
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
  try {
    document.querySelectorAll('[id^="mod-tool-"]').forEach((el) => {
      const wrap = el && el.closest ? el.closest('.tool') : null;
      if (wrap && wrap.remove) wrap.remove();
      else if (el && el.remove) el.remove();
    });
    document.querySelectorAll('[id^="mod-mode-"]').forEach((el) => { try { el.remove(); } catch (e) {} });
    document.querySelectorAll('[id^="mod-menu-"]').forEach((el) => { try { el.remove(); } catch (e) {} });
  } catch (e) {}
  _plugins.clear();
  _toolDefs.clear();
  _modeDefs.clear();
  _menuButtonDefs.clear();
  _injectDefs.clear();
  _activeModeId = null;
  _closeOverlay();
  try { if (_injectObserver) _injectObserver.disconnect(); } catch (e) {}
  _injectObserver = null;
  try { document.querySelectorAll('[data-mod-inject-root="1"]').forEach((el) => { try { el.remove(); } catch (e) {} }); } catch (e) {}
}

async function _readAssetText(pluginId, relPath) {
  const res = await _invokeMain('message', 'mod:read-asset', { id: pluginId, path: relPath, as: 'utf8' });
  if (!res || !res.success) throw new Error((res && res.error) || 'read asset failed');
  return String(res.data || '');
}

async function _spawnWorker(pluginId, manifest, entryPath, meta) {
  const pluginSrc = await _readAssetText(pluginId, entryPath);
  const hasModDecl = /(^|\n)\s*(?:const|let|var|function|class)\s+Mod\b/.test(pluginSrc);
  const injected = hasModDecl ? pluginSrc : `const Mod = globalThis.Mod;\n${pluginSrc}`;
  const moduleBlob = new Blob([injected], { type: 'text/javascript' });
  const moduleUrl = URL.createObjectURL(moduleBlob);

  const perms = Array.isArray(manifest && manifest.permissions) ? manifest.permissions.map(String) : [];
  const boot = `
    const _evt = (()=>{ const m=new Map(); return { on:(k,f)=>{ if(!m.has(k)) m.set(k,[]); m.get(k).push(f); }, emit:(k,d)=>{ const a=m.get(k)||[]; for(const f of a){ try{ f(d); }catch(e){} } } }; })();
    const _req = new Map();
    const _rid = ()=> Math.random().toString(36).slice(2) + Date.now().toString(36);
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
      registerMenuButton: (def)=>{ self.postMessage({ type:'register-menu-button', def }); },
      showOverlay: (def)=>{ self.postMessage({ type:'show-overlay', def }); },
      closeOverlay: ()=>{ self.postMessage({ type:'close-overlay' }); },
      inject: (def)=> new Promise((resolve)=>{ const reqId=_rid(); _req.set(reqId, resolve); self.postMessage({ type:'ui-inject', reqId, def }); })
    };
    self.Mod = Mod;
    self.onmessage = (ev)=>{
      const m = ev && ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'init') _evt.emit('init', m.data || {});
      if (m.type === 'bus-event') _evt.emit('bus', m.data || {});
      if (m.type === 'tool-click') _evt.emit('tool', m.data || {});
      if (m.type === 'menu-click') _evt.emit('menu', m.data || {});
      if (m.type === 'mode-activate') _evt.emit('mode', m.data || {});
      if (m.type === 'ui-action') _evt.emit('ui', m.data || {});
      if (m.type === 'ui-inject-applied') _evt.emit('inject', m.data || {});
      if (m.type === 'ui-inject-res') { const fn=_req.get(String(m.reqId||'')); if(fn){ _req.delete(String(m.reqId||'')); try{ fn(m.data||{}); }catch(e){} } }
    };
    (async()=>{ await import(${JSON.stringify(moduleUrl)}); self.postMessage({ type:'ready' }); })().catch((e)=>{ self.postMessage({ type:'error', error: String(e && e.message || e) }); });
  `;
  const bootBlob = new Blob([boot], { type: 'text/javascript' });
  const bootUrl = URL.createObjectURL(bootBlob);
  const sig = meta && typeof meta === 'object' ? (meta.signature && typeof meta.signature === 'object' ? meta.signature : null) : null;
  const unsigned = !!(sig && !sig.verified);
  const sigReason = sig && sig.reason ? String(sig.reason) : '';

  let worker = null;
  const _pending = [];
  try {
    worker = new Worker(bootUrl);
    worker.onmessage = (ev) => { _pending.push(ev); };
  } catch (e) {
    if (unsigned) _audit('plugin:load_failed', { pluginId, reason: sigReason, error: String(e && e.message || e) });
    try { await _invokeMain('message', 'mod:enable', { id: pluginId, enabled: false }); } catch (err) {}
    try { URL.revokeObjectURL(moduleUrl); } catch (err) {}
    try { URL.revokeObjectURL(bootUrl); } catch (err) {}
    throw e;
  }

  const ctx = { id: pluginId, manifest, meta: meta || null, worker, moduleUrl, bootUrl, subs: new Set(), offFns: [], ready: false };
  _plugins.set(pluginId, ctx);
  if (unsigned) _audit('plugin:load:unsigned', { pluginId, reason: sigReason });

  const _onWorkerMessage = async (ev) => {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      ctx.ready = true;
      _sendToPlugin(pluginId, { type: 'init', data: { apiVersion: 1, pluginId, manifest } });
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'ready' });
      return;
    }
    if (msg.type === 'error') {
      if (unsigned) _audit('plugin:load_failed', { pluginId, reason: sigReason, error: String(msg.error || '') });
      try { await _invokeMain('message', 'mod:enable', { id: pluginId, enabled: false }); } catch (e) {}
      try { worker.terminate(); } catch (e) {}
      try { if (ctx.moduleUrl) URL.revokeObjectURL(ctx.moduleUrl); } catch (e) {}
      try { if (ctx.bootUrl) URL.revokeObjectURL(ctx.bootUrl); } catch (e) {}
      try {
        const off = Array.isArray(ctx.offFns) ? ctx.offFns : [];
        off.forEach((fn) => { try { fn(); } catch (e) {} });
      } catch (e) {}
      _plugins.delete(pluginId);
      return;
    }
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
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'bus-publish', topic });
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
      const rec = {
        pluginId,
        toolId,
        domId,
        title: String(def.title || def.name || fullId),
        iconSvg: String(def.iconSvg || ''),
        iconUrl: String(def.iconUrl || ''),
        iconClass: String(def.iconClass || ''),
        label: String(def.label || ''),
        def
      };
      _toolDefs.set(fullId, rec);
      _createToolButton(rec);
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'register-tool', toolId });
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
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'register-mode', modeId });
      return;
    }
    if (msg.type === 'register-menu-button') {
      const def = msg.def && typeof msg.def === 'object' ? msg.def : {};
      const buttonId = String(def.id || '').trim();
      if (!buttonId) return;
      if (!_hasPerm(manifest, 'ui:menu')) return;
      const domId = `mod-menu-${pluginId}-${buttonId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fullId = `${pluginId}:${buttonId}`;
      if (_menuButtonDefs.has(fullId)) return;
      const rec = {
        pluginId,
        buttonId,
        domId,
        title: String(def.title || def.name || fullId),
        iconSvg: String(def.iconSvg || ''),
        iconUrl: String(def.iconUrl || ''),
        iconClass: String(def.iconClass || ''),
        label: String(def.label || ''),
        def
      };
      _menuButtonDefs.set(fullId, rec);
      _createMenuButton(rec);
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'register-menu-button', buttonId });
      return;
    }
    if (msg.type === 'show-overlay') {
      if (!_hasPerm(manifest, 'ui:overlay')) return;
      const def = msg.def && typeof msg.def === 'object' ? msg.def : {};
      const kind = String(def.kind || 'html');
      if (kind === 'html') {
        _openOverlay(String(def.html || ''));
        if (unsigned) _audit('plugin:activity', { pluginId, action: 'show-overlay', kind: 'html' });
        return;
      }
      if (kind === 'asset') {
        const rel = String(def.path || '');
        if (!rel) return;
        try {
          const html = await _readAssetText(pluginId, rel);
          _openOverlay(html);
          if (unsigned) _audit('plugin:activity', { pluginId, action: 'show-overlay', kind: 'asset', path: rel });
        } catch (e) {}
        return;
      }
    }
    if (msg.type === 'close-overlay') {
      _closeOverlay();
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'close-overlay' });
      return;
    }
    if (msg.type === 'ui-inject') {
      const reqId = String(msg.reqId || '');
      if (!_hasPerm(manifest, 'ui:inject')) {
        if (reqId) _sendToPlugin(pluginId, { type: 'ui-inject-res', reqId, data: { success: false, error: 'permission denied' } });
        return;
      }
      const rec = _normalizeInjectDef(pluginId, msg.def);
      if (!rec) {
        if (reqId) _sendToPlugin(pluginId, { type: 'ui-inject-res', reqId, data: { success: false, error: 'invalid def' } });
        return;
      }
      const existing = _injectDefs.get(rec.id);
      if (existing) {
        existing.selector = rec.selector;
        existing.position = rec.position;
        existing.mode = rec.mode;
        existing.priority = rec.priority;
        existing.repeat = rec.repeat;
        existing.key = rec.key;
        existing.html = rec.html;
        existing.conflict = rec.conflict;
        existing.seq = rec.seq;
        const res = _tryApplyInjection(existing);
        if (existing.mode === 'async' && (existing.pending || existing.repeat)) _ensureInjectObserver();
        if (reqId) _sendToPlugin(pluginId, { type: 'ui-inject-res', reqId, data: { success: true, id: existing.id, appliedCount: res.applied, pending: !!existing.pending } });
        if (unsigned) _audit('plugin:activity', { pluginId, action: 'ui-inject', selector: existing.selector });
        return;
      }
      _injectDefs.set(rec.id, rec);
      const res = _tryApplyInjection(rec);
      if (rec.mode === 'sync' && !res.matched) {
        _injectDefs.delete(rec.id);
        if (reqId) _sendToPlugin(pluginId, { type: 'ui-inject-res', reqId, data: { success: false, error: 'target not found' } });
        return;
      }
      if (rec.mode === 'async' && (rec.pending || rec.repeat)) _ensureInjectObserver();
      if (reqId) _sendToPlugin(pluginId, { type: 'ui-inject-res', reqId, data: { success: true, id: rec.id, appliedCount: res.applied, pending: !!rec.pending } });
      if (unsigned) _audit('plugin:activity', { pluginId, action: 'ui-inject', selector: rec.selector });
      return;
    }
  };

  worker.onmessage = _onWorkerMessage;
  for (const ev of _pending) {
    try { await _onWorkerMessage(ev); } catch (e) {}
  }

  worker.onerror = async () => {
    if (unsigned) _audit('plugin:load_failed', { pluginId, reason: sigReason, error: 'worker.onerror' });
    try { await _invokeMain('message', 'mod:enable', { id: pluginId, enabled: false }); } catch (e) {}
  };
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
    try { await _spawnWorker(id, manifest, entryPath, p.meta || null); } catch (e) {}
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
