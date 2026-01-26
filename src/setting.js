/**
 * setting.js
 *
 * 应用设置存储与辅助函数。
 *
 * 存储位置：
 * - localStorage['appSettings']（渲染进程）
 *
 * 设计要点：
 * - loadSettings() 总是返回 DEFAULTS 与持久化值合并后的“完整设置对象”
 * - 颜色相关字段做统一规范化（大写、补全 #、校验 6/8 位 HEX）
 * - 画笔颜色支持模式隔离：annotationPenColor / whiteboardPenColor
 */
const DEFAULTS = {
  toolbarCollapsed: false,
  enableAutoResize: true,
  toolbarPosition: { right: 20, top: 80 },
  designLanguage: 'fluent',
  theme: 'system',
  themeCustom: {
    primary: '#005AC1',
    secondary: '#535F70',
    error: '#E5484D',
    warning: '#F59E0B',
    success: '#22C55E',
    info: '#38BDF8',
    surface: '#FDFBFF',
    background: '#FFFFFF',
    outline: '#73777F'
  },
  showTooltips: true,
  multiTouchPen: false,
  smartInkRecognition: false,
  penTail: {
    enabled: false,
    intensity: 50,
    samplePoints: 10,
    speedSensitivity: 100,
    pressureSensitivity: 100,
    shape: 'natural',
    profile: 'standard'
  },
  annotationPenColor: '#FF0000',
  whiteboardPenColor: '#000000',
  visualStyle: 'blur',
  mica: {
    intensity: 60,
    radius: 24,
    feather: 8,
    overlayOpacity: 0.30,
    saturation: 1.2
  },
  canvasColor: 'white',
  shortcuts: { undo: 'Ctrl+Z', redo: 'Ctrl+Y' },
  toolbarButtonOrder: [],
  toolbarButtonHidden: [],
  videoBoothEnabled: false,
  pluginButtonDisplay: {},
  pdfDefaultMode: 'window',
  pageSwitchDraggable: false,
  overlayShapeEnabled: true,
  separateToolbarWindow: false
};

let _lastPersistError = '';

function _safeParseJson(txt){
  try{ return JSON.parse(txt); }catch(e){ return null; }
}

function _readRaw(key){
  try{ return localStorage.getItem(key); }catch(e){ return null; }
}

function _safeGet(key){
  try{ const v = localStorage.getItem(key); return v===null?null:JSON.parse(v); }catch(e){return null}
}

function _safeSet(key, val){
  _lastPersistError = '';
  try{
    const txt = JSON.stringify(val);
    localStorage.setItem(key, txt);
    const back = localStorage.getItem(key);
    if (back !== txt) {
      _lastPersistError = 'verify_mismatch';
      return false;
    }
    return true;
  }catch(e){
    _lastPersistError = String(e && (e.name || e.message) ? (e.name || e.message) : e);
    return false;
  }
}

/**
 * 规范化 HEX 颜色字符串。
 * @param {string} input - 输入颜色（可含或不含 #）
 * @param {string} fallback - 输入非法时的回退颜色
 * @returns {string} 规范化后的颜色（大写，含 #）
 */
export function normalizeHexColor(input, fallback){
  const raw = String(input || '').trim();
  if (!raw) return String(fallback || '').toUpperCase();
  const s = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return String(fallback || '').toUpperCase();
  return s.toUpperCase();
}

/**
 * 根据应用模式获取对应的画笔颜色设置字段名。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {'annotationPenColor'|'whiteboardPenColor'} 设置字段名
 */
export function getPenColorSettingKey(appMode){
  return appMode === 'annotation' ? 'annotationPenColor' : 'whiteboardPenColor';
}

/**
 * 获取某模式下画笔默认颜色。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {string} 默认颜色（大写 HEX）
 */
export function getDefaultPenColor(appMode){
  return appMode === 'annotation' ? DEFAULTS.annotationPenColor : DEFAULTS.whiteboardPenColor;
}

/**
 * 构造“仅更新画笔颜色”的 settings patch，用于与 updateAppSettings 合并写入。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @param {string} color - 目标颜色
 * @returns {Object} 可直接传入 Settings.saveSettings / updateAppSettings 的 patch
 */
export function buildPenColorSettingsPatch(appMode, color){
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return { [key]: normalizeHexColor(color, def) };
}

/**
 * 从 settings 对象中读取某模式的画笔颜色（带回退与规范化）。
 * @param {Object} settings - loadSettings() 返回或其子集
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {string} 规范化颜色（大写 HEX）
 */
export function getPenColorFromSettings(settings, appMode){
  const s = settings && typeof settings === 'object' ? settings : {};
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return normalizeHexColor(s[key], def);
}

/**
 * 读取设置：DEFAULTS 与持久化值合并。
 * @returns {Object} 完整设置对象
 */
export function loadSettings(){
  const raw = _readRaw('appSettings');
  let s = null;
  if (raw !== null) s = _safeParseJson(raw);
  if (!s || typeof s !== 'object') {
    if (raw !== null && raw !== '') {
      try{ console.warn('[Settings] appSettings parse failed, resetting to defaults'); }catch(e){}
      _safeSet('appSettings', DEFAULTS);
    }
    s = {};
  }
  const merged = Object.assign({}, DEFAULTS, s);
  if (merged && typeof merged === 'object') {
    const dl = String(merged.designLanguage || '');
    if (dl === 'fluent' || dl === 'material3') merged.designLanguage = dl;
    else merged.designLanguage = 'fluent';

    const t = String(merged.theme || '');
    if (t === 'light' || t === 'dark') {
      merged.theme = t;
    } else if (t === 'system' || t === 'high-contrast' || t === 'custom') {
      merged.theme = t;
    } else {
      merged.theme = 'system';
    }
    if (!merged.themeCustom || typeof merged.themeCustom !== 'object') merged.themeCustom = Object.assign({}, DEFAULTS.themeCustom);
    if (merged.mica && typeof merged.mica === 'object') {
      merged.mica = Object.assign({}, DEFAULTS.mica, merged.mica);
    } else {
      merged.mica = Object.assign({}, DEFAULTS.mica);
    }

    if (!merged.penTail || typeof merged.penTail !== 'object') merged.penTail = Object.assign({}, DEFAULTS.penTail);
    else merged.penTail = Object.assign({}, DEFAULTS.penTail, merged.penTail);

    if (!merged.shortcuts || typeof merged.shortcuts !== 'object') merged.shortcuts = Object.assign({}, DEFAULTS.shortcuts);
    else merged.shortcuts = Object.assign({}, DEFAULTS.shortcuts, merged.shortcuts);

    if (!merged.toolbarPosition || typeof merged.toolbarPosition !== 'object') merged.toolbarPosition = Object.assign({}, DEFAULTS.toolbarPosition);
    else merged.toolbarPosition = Object.assign({}, DEFAULTS.toolbarPosition, merged.toolbarPosition);

    if (String(merged.pdfDefaultMode || '') !== 'fullscreen' && String(merged.pdfDefaultMode || '') !== 'window') {
      merged.pdfDefaultMode = DEFAULTS.pdfDefaultMode;
    }

    merged.annotationPenColor = normalizeHexColor(merged.annotationPenColor, DEFAULTS.annotationPenColor);
    merged.whiteboardPenColor = normalizeHexColor(merged.whiteboardPenColor, DEFAULTS.whiteboardPenColor);

    if (!Array.isArray(merged.toolbarButtonOrder)) merged.toolbarButtonOrder = [];
    if (!Array.isArray(merged.toolbarButtonHidden)) merged.toolbarButtonHidden = [];
    if (!merged.pluginButtonDisplay || typeof merged.pluginButtonDisplay !== 'object') merged.pluginButtonDisplay = {};
  }
  return merged;
}

/**
 * 保存设置：与当前设置合并后写入 localStorage。
 * @param {Object} settings - 需要合并保存的设置字段
 * @returns {Object} 合并后的完整设置对象
 */
export function saveSettings(settings){
  const base = loadSettings();
  const patch = (settings && typeof settings === 'object') ? settings : {};
  const merged = Object.assign({}, base, patch);
  if (patch.themeCustom && typeof patch.themeCustom === 'object') {
    merged.themeCustom = Object.assign({}, (base.themeCustom && typeof base.themeCustom === 'object') ? base.themeCustom : {}, patch.themeCustom);
  }
  if (patch.mica && typeof patch.mica === 'object') {
    merged.mica = Object.assign({}, (base.mica && typeof base.mica === 'object') ? base.mica : {}, patch.mica);
  }
  // Validate toolbar layout settings
  if (patch.hasOwnProperty('toolbarButtonOrder')) {
    merged.toolbarButtonOrder = Array.isArray(patch.toolbarButtonOrder) ? patch.toolbarButtonOrder.filter(id => typeof id === 'string') : [];
  }
  if (patch.hasOwnProperty('toolbarButtonHidden')) {
    merged.toolbarButtonHidden = Array.isArray(patch.toolbarButtonHidden) ? patch.toolbarButtonHidden.filter(id => typeof id === 'string') : [];
  }
  merged.annotationPenColor = normalizeHexColor(merged.annotationPenColor, DEFAULTS.annotationPenColor);
  merged.whiteboardPenColor = normalizeHexColor(merged.whiteboardPenColor, DEFAULTS.whiteboardPenColor);
  if (!merged.themeCustom || typeof merged.themeCustom !== 'object') merged.themeCustom = Object.assign({}, DEFAULTS.themeCustom);
  if (!merged.mica || typeof merged.mica !== 'object') merged.mica = Object.assign({}, DEFAULTS.mica);
  if (!merged.penTail || typeof merged.penTail !== 'object') merged.penTail = Object.assign({}, DEFAULTS.penTail);
  if (!merged.shortcuts || typeof merged.shortcuts !== 'object') merged.shortcuts = Object.assign({}, DEFAULTS.shortcuts);
  if (!merged.toolbarPosition || typeof merged.toolbarPosition !== 'object') merged.toolbarPosition = Object.assign({}, DEFAULTS.toolbarPosition);
  if (String(merged.pdfDefaultMode || '') !== 'fullscreen' && String(merged.pdfDefaultMode || '') !== 'window') merged.pdfDefaultMode = DEFAULTS.pdfDefaultMode;

  const ok = _safeSet('appSettings', merged);
  try{
    Object.defineProperty(merged, '__lsPersistOk', { value: ok, enumerable: false, configurable: true });
    Object.defineProperty(merged, '__lsPersistError', { value: ok ? '' : (_lastPersistError || 'unknown'), enumerable: false, configurable: true });
  }catch(e){}
  if (!ok) {
    try{ console.warn('[Settings] persist failed', _lastPersistError); }catch(e){}
  }
  return merged;
}

export function getPersistStatus(){
  return { ok: !_lastPersistError, error: _lastPersistError || '' };
}

/**
 * 重置设置为 DEFAULTS。
 * @returns {Object} DEFAULTS 引用
 */
export function resetSettings(){
  _safeSet('appSettings', DEFAULTS);
  return DEFAULTS;
}

export function installHyperOsButtonInteractions(root){
  const doc = (root && root.nodeType === 9) ? root : document;
  const key = '__lsHyperOsButtonInteractionsInstalled';
  try{ if (doc && doc[key]) return; }catch(e){}
  try{ if (doc) doc[key] = true; }catch(e){}

  const selector = 'button.mode-btn,button.tool-btn,button.plugin-action-btn,button.win-btn';
  const state = { el: null, pointerId: null, keyActive: false };

  const setActive = (el, on) => {
    if (!el || el.nodeType !== 1) return;
    try{
      if (on) el.setAttribute('data-force-active', 'true');
      else el.removeAttribute('data-force-active');
    }catch(e){}
  };

  const clear = () => {
    if (!state.el) return;
    setActive(state.el, false);
    state.el = null;
    state.pointerId = null;
    state.keyActive = false;
  };

  doc.addEventListener('pointerdown', (e) => {
    const target = e.target && e.target.closest ? e.target.closest(selector) : null;
    if (!target) return;
    clear();
    state.el = target;
    state.pointerId = e.pointerId;
    setActive(target, true);
    try{ if (typeof target.setPointerCapture === 'function') target.setPointerCapture(e.pointerId); }catch(err){}
  }, true);

  doc.addEventListener('pointerup', (e) => {
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    clear();
  }, true);

  doc.addEventListener('pointercancel', (e) => {
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    clear();
  }, true);

  doc.addEventListener('keydown', (e) => {
    const k = String(e.key || '');
    if (k !== ' ' && k !== 'Enter') return;
    const active = doc.activeElement;
    const target = active && active.matches && active.matches(selector) ? active : null;
    if (!target) return;
    if (state.keyActive) return;
    state.el = target;
    state.keyActive = true;
    setActive(target, true);
  }, true);

  doc.addEventListener('keyup', (e) => {
    const k = String(e.key || '');
    if (k !== ' ' && k !== 'Enter') return;
    if (!state.keyActive) return;
    clear();
  }, true);

  try{
    if (doc.defaultView && doc.defaultView.addEventListener) {
      doc.defaultView.addEventListener('blur', clear, true);
    }
  }catch(e){}
}

function _clamp01(n){
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function _clampInt(n, min, max){
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function _isPlainObject(v){
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function _safeJsonStringify(v){
  try{ return JSON.stringify(v); }catch(e){ return ''; }
}

function _deepClone(v){
  if (v === null || typeof v !== 'object') return v;
  if (typeof structuredClone === 'function') {
    try{ return structuredClone(v); }catch(e){}
  }
  const s = _safeJsonStringify(v);
  if (!s) return v;
  try{ return JSON.parse(s); }catch(e){ return v; }
}

function _valuesEqual(a, b){
  if (Object.is(a, b)) return true;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (a && b && ta === 'object') {
    const sa = _safeJsonStringify(a);
    const sb = _safeJsonStringify(b);
    if (!sa || !sb) return false;
    return sa === sb;
  }
  return false;
}

export function formatSettingValue(v){
  if (v === null || typeof v === 'undefined') return '—';
  if (typeof v === 'boolean') return v ? '开启' : '关闭';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return s.toUpperCase();
    if (!s) return '—';
    return s;
  }
  const json = _safeJsonStringify(v);
  if (!json) return '—';
  if (json.length <= 240) return json;
  return `${json.slice(0, 240)}…`;
}

function _diffObjectPaths(before, after, basePath, out, depthLeft, maxItems){
  if (out.length >= maxItems) return;
  if (depthLeft <= 0) {
    if (!_valuesEqual(before, after)) {
      out.push({
        path: basePath,
        before,
        after,
        beforeText: formatSettingValue(before),
        afterText: formatSettingValue(after)
      });
    }
    return;
  }

  if (_isPlainObject(before) && _isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (out.length >= maxItems) return;
      const p = basePath ? `${basePath}.${k}` : k;
      _diffObjectPaths(before[k], after[k], p, out, depthLeft - 1, maxItems);
    }
    return;
  }

  if (!_valuesEqual(before, after)) {
    out.push({
      path: basePath,
      before,
      after,
      beforeText: formatSettingValue(before),
      afterText: formatSettingValue(after)
    });
  }
}

export function buildSettingsHistoryRecord(beforeSettings, afterSettings, patch, meta){
  const before = (beforeSettings && typeof beforeSettings === 'object') ? beforeSettings : {};
  const after = (afterSettings && typeof afterSettings === 'object') ? afterSettings : {};
  const p = (patch && typeof patch === 'object') ? patch : {};
  const maxItems = 50;

  const rootKeys = Object.keys(p).filter(k => k && !String(k).startsWith('__'));
  const changes = [];
  for (const rootKey of rootKeys) {
    if (changes.length >= maxItems) break;
    const b = before[rootKey];
    const a = after[rootKey];
    const depth = (rootKey === 'themeCustom' || rootKey === 'mica' || rootKey === 'penTail' || rootKey === 'shortcuts') ? 3 : 2;
    _diffObjectPaths(b, a, rootKey, changes, depth, maxItems);
  }

  if (!changes.length) return null;

  const undoPatch = {};
  const touchedRootKeys = new Set(changes.map(c => String(c.path || '').split('.')[0]).filter(Boolean));
  for (const k of touchedRootKeys) {
    undoPatch[k] = _deepClone(before[k]);
  }

  const now = Date.now();
  const rnd = Math.random().toString(16).slice(2, 10);
  const src = meta && typeof meta === 'object' ? meta : {};
  const source = String(src.source || 'settings');
  return {
    id: `sh_${now}_${rnd}`,
    ts: now,
    source,
    changes,
    undoPatch,
    undone: false,
    undoneAt: 0
  };
}

export function parseHexColor(input){
  const s = String(input || '').trim();
  const hex = s.startsWith('#') ? s.slice(1) : s;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return { r, g, b, a };
}

export function rgbToHex(rgb){
  const to2 = (n)=>String(_clampInt(n, 0, 255).toString(16)).padStart(2, '0').toUpperCase();
  const r = rgb && typeof rgb === 'object' ? rgb.r : 0;
  const g = rgb && typeof rgb === 'object' ? rgb.g : 0;
  const b = rgb && typeof rgb === 'object' ? rgb.b : 0;
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function hexToRgb(hex){
  const c = parseHexColor(hex);
  if (!c) return null;
  return { r: c.r, g: c.g, b: c.b };
}

export function rgbToHsl(rgb){
  const r = _clampInt(rgb && rgb.r, 0, 255) / 255;
  const g = _clampInt(rgb && rgb.g, 0, 255) / 255;
  const b = _clampInt(rgb && rgb.b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s, l };
}

export function hslToRgb(hsl){
  const h = ((Number(hsl && hsl.h) % 360) + 360) % 360;
  const s = _clamp01(hsl && hsl.s);
  const l = _clamp01(hsl && hsl.l);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function hexToHsl(hex){
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb);
}

export function hslToHex(hsl){
  return rgbToHex(hslToRgb(hsl));
}

const _RECENT_COLORS_KEY = 'ls_recent_colors_v1';

export function loadRecentColors(limit){
  const lim = _clampInt(limit || 12, 1, 48);
  try{
    const raw = localStorage.getItem(_RECENT_COLORS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const v of arr) {
      const c = normalizeHexColor(v, '');
      if (c && c !== '#') {
        if (!out.includes(c)) out.push(c);
      }
      if (out.length >= lim) break;
    }
    return out;
  }catch(e){
    return [];
  }
}

export function pushRecentColor(color, limit){
  const lim = _clampInt(limit || 12, 1, 48);
  const c = normalizeHexColor(color, '');
  if (!c || c === '#') return loadRecentColors(lim);
  const list = loadRecentColors(lim);
  const next = [c, ...list.filter(v => v !== c)].slice(0, lim);
  try{ localStorage.setItem(_RECENT_COLORS_KEY, JSON.stringify(next)); }catch(e){}
  return next;
}

import { loadSettingsHistory } from './write_a_change.js';

export function loadSettingsHistoryWrapper(limit){
  return loadSettingsHistory(limit);
}

export default { loadSettings, saveSettings, resetSettings, loadRecentColors, pushRecentColor, buildSettingsHistoryRecord, formatSettingValue, getPersistStatus, loadSettingsHistory: loadSettingsHistoryWrapper };
