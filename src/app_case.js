import Settings from './setting.js';
import { updateAppSettings } from './write_a_change.js';
import Message, { EVENTS } from './message.js';
import ButtonBox from './button_box.js';
import { openPdfFile } from './pdf_viewer.js';

/**
 * 功能库统一功能管理模块（Feature Hub）
 *
 * 目标：
 * - 统一功能注册/注销/查询/调用
 * - 标准化调用签名：invoke(featureId, params, callback)
 * - 支持“手动排序 / 智能排序（权重 + 最近使用频率）”并持久化
 * - 提供类型定义（JSDoc）与可观测的性能指标（排序耗时）
 *
 * 功能 ID 命名规则：
 * - 形如：namespace:name
 * - namespace/name：小写字母开头，可含 a-z0-9-._
 * - 例：core:theme-toggle、mod.ink:smart-erase、plugin.demo:hello
 *
 * 版本规则：
 * - 可选 semver 字符串：x.y.z（不参与路由，仅用于对外暴露与调试）
 */

/**
 * @typedef {'manual'|'smart'} SortMode
 */

/**
 * @typedef {{ base:number, freq:number, recency:number }} SortWeights
 */

/**
 * @typedef {{
 *   mode: SortMode,
 *   weights: SortWeights,
 *   halfLifeMs: number
 * }} SortConfig
 */

/**
 * @typedef {{
 *   count: number,
 *   lastUsedAt: number
 * }} FeatureUsage
 */

/**
 * @typedef {{
 *   featureId: string,
 *   title?: string,
 *   version?: string,
 *   weight?: number,
 *   domButton?: HTMLElement,
 *   invoke?: (params?: any)=>any|Promise<any>
 * }} FeatureDefinition
 */

/**
 * @typedef {{
 *   lastSortMs: number,
 *   lastSortAt: number,
 *   lastSortN: number
 * }} SortPerf
 */

const IDS = {
  grid: 'moreMenuQuickGrid',
  resourceModal: 'resourceModal',
  resourceList: 'resourceList',
  resourcePreviewGrid: 'resourcePreviewGrid',
  resourceSaveBtn: 'resourceSaveBtn',
  resourceResetBtn: 'resourceResetBtn',
  closeResourceModal: 'closeResourceModal',
  btnResource: 'appCaseResourceBtn',
  btnTheme: 'appCaseThemeBtn',
  btnPdf: 'appCasePdfBtn'
};

const DB = {
  name: 'lanstartwrite',
  version: 1,
  store: 'kv',
  keyOrder: 'app_case.moreMenuOrder.v1',
  keySortConfig: 'app_case.sortConfig.v1',
  keyUsage: 'app_case.featureUsage.v1'
};

const _FEATURE_ID_RE = /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/;
const _SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** @type {SortConfig} */
const DEFAULT_SORT_CONFIG = {
  mode: 'smart',
  weights: { base: 1, freq: 0.6, recency: 0.8 },
  halfLifeMs: 3 * 24 * 60 * 60 * 1000
};

class FeatureError extends Error {
  constructor(code, message, meta){
    super(message);
    this.name = 'FeatureError';
    this.code = String(code || 'feature_error');
    this.meta = meta || null;
  }
}

class FeatureNotFoundError extends FeatureError {
  constructor(featureId){
    super('feature_not_found', `Feature not found: ${String(featureId || '')}`, { featureId: String(featureId || '') });
    this.name = 'FeatureNotFoundError';
  }
}

class FeatureValidationError extends FeatureError {
  constructor(message, meta){
    super('feature_validation', String(message || 'Invalid feature input'), meta || null);
    this.name = 'FeatureValidationError';
  }
}

class FeatureInvokeError extends FeatureError {
  constructor(featureId, original){
    super('feature_invoke_failed', `Feature invoke failed: ${String(featureId || '')}`, { featureId: String(featureId || ''), original: String(original && original.message || original || '') });
    this.name = 'FeatureInvokeError';
  }
}

function _resolveRequestedThemeToMode(requested){
  const v = String(requested || 'system');
  if (v === 'dark') return 'dark';
  if (v === 'light') return 'light';
  const root = document.documentElement;
  const isDark = !!(root && root.classList && root.classList.contains('theme-dark'));
  return isDark ? 'dark' : 'light';
}

function _openDb(){
  return new Promise((resolve, reject)=>{
    try{
      const req = indexedDB.open(DB.name, DB.version);
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if (!db.objectStoreNames.contains(DB.store)) db.createObjectStore(DB.store, { keyPath: 'key' });
      };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || new Error('indexeddb open failed'));
    }catch(e){ reject(e); }
  });
}

async function _kvGet(key){
  const db = await _openDb();
  try{
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(DB.store, 'readonly');
      const st = tx.objectStore(DB.store);
      const req = st.get(String(key || ''));
      req.onsuccess = ()=>resolve(req.result ? req.result.value : null);
      req.onerror = ()=>reject(req.error || new Error('indexeddb get failed'));
    });
  }finally{
    try{ db.close(); }catch(e){}
  }
}

async function _kvSet(key, value){
  const db = await _openDb();
  try{
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(DB.store, 'readwrite');
      const st = tx.objectStore(DB.store);
      const req = st.put({ key: String(key || ''), value });
      req.onsuccess = ()=>resolve(true);
      req.onerror = ()=>reject(req.error || new Error('indexeddb put failed'));
    });
  }finally{
    try{ db.close(); }catch(e){}
  }
}

async function _kvDel(key){
  const db = await _openDb();
  try{
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(DB.store, 'readwrite');
      const st = tx.objectStore(DB.store);
      const req = st.delete(String(key || ''));
      req.onsuccess = ()=>resolve(true);
      req.onerror = ()=>reject(req.error || new Error('indexeddb delete failed'));
    });
  }finally{
    try{ db.close(); }catch(e){}
  }
}

function _grid(){
  const byId = document.getElementById(IDS.grid);
  if (byId) return byId;
  const menu = document.getElementById('moreMenu');
  if (!menu) return null;
  return menu.querySelector('.submenu-quick-grid');
}

function _now(){
  return Date.now();
}

function _isPlainObject(v){
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function _normalizeSortConfig(raw){
  const def = DEFAULT_SORT_CONFIG;
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const mode = (obj.mode === 'manual' || obj.mode === 'smart') ? obj.mode : def.mode;
  const w = (obj.weights && typeof obj.weights === 'object') ? obj.weights : {};
  const weights = {
    base: Number.isFinite(Number(w.base)) ? Number(w.base) : def.weights.base,
    freq: Number.isFinite(Number(w.freq)) ? Number(w.freq) : def.weights.freq,
    recency: Number.isFinite(Number(w.recency)) ? Number(w.recency) : def.weights.recency
  };
  const halfLifeMs = Number.isFinite(Number(obj.halfLifeMs)) && Number(obj.halfLifeMs) > 10 ? Number(obj.halfLifeMs) : def.halfLifeMs;
  return { mode, weights, halfLifeMs };
}

function _featureIdFromDomButton(btn){
  if (!btn || !(btn instanceof HTMLElement)) return '';
  const explicit = String(btn.dataset && btn.dataset.featureId || '').trim();
  if (explicit) return explicit;
  const a11y = String(btn.getAttribute('aria-label') || '').trim();
  if (_FEATURE_ID_RE.test(a11y)) return a11y;
  const title = String(btn.getAttribute('title') || '').trim();
  if (_FEATURE_ID_RE.test(title)) return title;
  const id = String(btn.id || '').trim();
  if (id) return `dom:${id}`;
  return '';
}

function _ensureFeatureIdOnDom(btn, featureId){
  if (!btn || !(btn instanceof HTMLElement)) return;
  if (btn.dataset.featureId) return;
  if (featureId && _FEATURE_ID_RE.test(featureId)) btn.dataset.featureId = featureId;
}

class FeatureHub {
  constructor(){
    /** @type {Map<string, FeatureDefinition & { weight:number, domButton?:HTMLElement }>} */
    this._features = new Map();
    /** @type {Record<string, FeatureUsage>} */
    this._usage = {};
    /** @type {SortConfig} */
    this._sortConfig = DEFAULT_SORT_CONFIG;
    /** @type {SortPerf} */
    this._perf = { lastSortMs: 0, lastSortAt: 0, lastSortN: 0 };
    this._usageFlushTimer = 0;
    this._wiredDomButtons = new WeakSet();
  }

  /**
   * 获取当前排序性能指标。
   * @returns {SortPerf}
   */
  getSortPerf(){
    return { ...this._perf };
  }

  /**
   * 获取排序配置（已归一化）。
   * @returns {SortConfig}
   */
  getSortConfig(){
    return { ...this._sortConfig, weights: { ...this._sortConfig.weights } };
  }

  /**
   * 设置排序配置（并持久化）。
   * @param {Partial<SortConfig>} next
   * @returns {Promise<SortConfig>}
   */
  async setSortConfig(next){
    const merged = _normalizeSortConfig({ ...this._sortConfig, ...(next || {}), weights: { ...(this._sortConfig.weights || {}), ...((next && next.weights) || {}) } });
    this._sortConfig = merged;
    try{ await _kvSet(DB.keySortConfig, merged); }catch(e){}
    return this.getSortConfig();
  }

  /**
   * 注册功能。
   * @param {FeatureDefinition} def
   * @returns {string} featureId
   */
  register(def){
    const d = def && typeof def === 'object' ? def : {};
    const featureId = String(d.featureId || '').trim();
    if (!featureId) throw new FeatureValidationError('featureId required');
    if (!_FEATURE_ID_RE.test(featureId) && !String(featureId).startsWith('dom:')) {
      throw new FeatureValidationError('featureId format invalid', { featureId });
    }
    const version = String(d.version || '').trim();
    if (version && !_SEMVER_RE.test(version)) throw new FeatureValidationError('version must be semver', { featureId, version });
    const weight = Number.isFinite(Number(d.weight)) ? Number(d.weight) : 0;
    const rec = {
      featureId,
      title: String(d.title || ''),
      version: version || undefined,
      weight,
      domButton: (d.domButton instanceof HTMLElement) ? d.domButton : undefined,
      invoke: (typeof d.invoke === 'function') ? d.invoke : undefined
    };
    this._features.set(featureId, rec);
    if (rec.domButton) {
      _ensureFeatureIdOnDom(rec.domButton, featureId);
      this._wireDomUsage(rec.domButton, featureId);
    }
    return featureId;
  }

  /**
   * 注销功能。
   * @param {string} featureId
   * @returns {boolean}
   */
  unregister(featureId){
    return this._features.delete(String(featureId || '').trim());
  }

  /**
   * 列出所有已注册功能。
   * @returns {FeatureDefinition[]}
   */
  list(){
    return Array.from(this._features.values()).map((v)=>({ ...v }));
  }

  /**
   * 统一调用入口：
   * - callback 方式：invoke(id, params, cb)
   * - Promise 方式：await invoke(id, params)
   * @param {string} featureId
   * @param {any} [params]
   * @param {(err:Error|null, result?:any)=>void} [callback]
   * @returns {Promise<any>}
   */
  invoke(featureId, params, callback){
    const id = String(featureId || '').trim();
    const cb = (typeof callback === 'function') ? callback : null;
    const p = this._invokeInternal(id, params);
    if (cb) {
      p.then((r)=>cb(null, r)).catch((e)=>cb(e));
    }
    return p;
  }

  async _invokeInternal(featureId, params){
    const rec = this._features.get(featureId);
    if (!rec) throw new FeatureNotFoundError(featureId);
    if (params !== undefined && params !== null && !_isPlainObject(params) && typeof params !== 'string' && typeof params !== 'number' && typeof params !== 'boolean') {
      throw new FeatureValidationError('params must be object/string/number/boolean/null', { featureId });
    }
    try{
      this._markUsed(featureId);
      if (typeof rec.invoke === 'function') return await rec.invoke(params);
      if (rec.domButton && typeof rec.domButton.click === 'function') {
        rec.domButton.click();
        return true;
      }
      return true;
    }catch(e){
      throw new FeatureInvokeError(featureId, e);
    }
  }

  _wireDomUsage(btn, featureId){
    if (!btn || !(btn instanceof HTMLElement)) return;
    if (this._wiredDomButtons.has(btn)) return;
    this._wiredDomButtons.add(btn);
    btn.addEventListener('click', ()=>{ this._markUsed(featureId); }, { passive: true });
  }

  _markUsed(featureId){
    const id = String(featureId || '').trim();
    if (!id) return;
    const u = this._usage[id] || { count: 0, lastUsedAt: 0 };
    u.count = Math.max(0, Number(u.count || 0)) + 1;
    u.lastUsedAt = _now();
    this._usage[id] = u;
    this._scheduleUsageFlush();
    try{ Message.emit(EVENTS.SETTINGS_CHANGED, { kind: 'feature_usage', featureId: id }); }catch(e){}
  }

  _scheduleUsageFlush(){
    if (this._usageFlushTimer) return;
    this._usageFlushTimer = window.setTimeout(async ()=>{
      this._usageFlushTimer = 0;
      try{ await _kvSet(DB.keyUsage, this._usage); }catch(e){}
    }, 240);
  }

  async loadPersisted(){
    const cfg = await _kvGet(DB.keySortConfig).catch(()=>null);
    this._sortConfig = _normalizeSortConfig(cfg);
    const usage = await _kvGet(DB.keyUsage).catch(()=>null);
    if (usage && typeof usage === 'object') this._usage = usage;
  }

  /**
   * 智能排序（O(n log n)）：score = weight*base + log(1+count)*freq + recencyBoost*recency
   * @param {Array<{ featureId:string, weight:number }>} items
   * @returns {string[]} featureId order
   */
  sortFeatureIds(items){
    const start = (performance && typeof performance.now === 'function') ? performance.now() : 0;
    const now = _now();
    const cfg = this._sortConfig || DEFAULT_SORT_CONFIG;
    const halfLife = Math.max(10, Number(cfg.halfLifeMs || DEFAULT_SORT_CONFIG.halfLifeMs));
    const ln2 = Math.log(2);
    const decay = (dt)=>Math.exp(-ln2 * (dt / halfLife));
    const w = cfg.weights || DEFAULT_SORT_CONFIG.weights;
    const scored = items.map((it)=>{
      const id = String(it.featureId || '');
      const usage = this._usage[id] || { count: 0, lastUsedAt: 0 };
      const count = Math.max(0, Number(usage.count || 0));
      const last = Math.max(0, Number(usage.lastUsedAt || 0));
      const recency = last ? decay(Math.max(0, now - last)) : 0;
      const baseWeight = Number.isFinite(Number(it.weight)) ? Number(it.weight) : 0;
      const score = baseWeight * Number(w.base || 0) + Math.log1p(count) * Number(w.freq || 0) + recency * Number(w.recency || 0);
      return { id, score };
    });
    scored.sort((a, b)=>b.score - a.score);
    const end = (performance && typeof performance.now === 'function') ? performance.now() : 0;
    if (start && end) {
      this._perf = { lastSortMs: Math.max(0, end - start), lastSortAt: _now(), lastSortN: scored.length };
    }
    return scored.map((x)=>x.id);
  }
}

export const featureHub = new FeatureHub();

/**
 * 标准化功能调用接口：function invoke(featureId, params, callback)
 * @param {string} featureId
 * @param {any} [params]
 * @param {(err:Error|null, result?:any)=>void} [callback]
 * @returns {Promise<any>}
 */
export function invoke(featureId, params, callback){
  return featureHub.invoke(featureId, params, callback);
}

export function addFeatureButtonToToolbar(featureId, defLike, options) {
  const fid = String(featureId || '');
  if (!fid) return null;
  const base = defLike && typeof defLike === 'object' ? defLike : {};
  const title = base.title || '';
  const iconSvg = base.iconSvg || '';
  return ButtonBox.createToolbarButtonForFeature(fid, { title, iconSvg }, options);
}

function _ensureSeq(btn){
  if (!btn || !(btn instanceof HTMLElement)) return;
  if (btn.dataset.appCaseSeq) return;
  const next = (_ensureSeq._seq = (_ensureSeq._seq || 0) + 1);
  btn.dataset.appCaseSeq = String(next);
}

function _sortedDefaultButtons(btns){
  return btns.slice().sort((a, b)=>{
    const sa = Number(a.dataset.appCaseSeq || 0);
    const sb = Number(b.dataset.appCaseSeq || 0);
    return sa - sb;
  });
}

function _applyOrderToGrid(orderIds){
  const g = _grid();
  if (!g) return;
  const children = Array.from(g.children).filter((n)=>n instanceof HTMLElement);
  const byId = new Map();
  for (const el of children) {
    const id = String(el.id || '');
    if (id) byId.set(id, el);
    _ensureSeq(el);
  }

  const frag = document.createDocumentFragment();
  const used = new Set();

  if (Array.isArray(orderIds) && orderIds.length) {
    for (const id of orderIds) {
      const el = byId.get(String(id || ''));
      if (!el) continue;
      used.add(el);
      frag.appendChild(el);
    }
    for (const el of children) if (!used.has(el)) frag.appendChild(el);
  } else {
    for (const el of _sortedDefaultButtons(children)) frag.appendChild(el);
  }

  g.appendChild(frag);
}

function _buildToolBtn(id, title, iconSvg){
  const logicalId = id ? String(id) : '';
  const base = {
    id: logicalId,
    title: title || '',
    iconSvg: iconSvg || '',
    kind: 'feature',
    source: 'feature'
  };
  const reg = ButtonBox.registerButton(base) || base;
  const btn = ButtonBox.createButtonElement(reg, {
    domId: id,
    variant: 'toolbar'
  });
  if (!btn) return null;
  ButtonBox.registerInstance(reg.id, btn, 'feature-grid');
  return btn;
}

const ICONS = {
  library: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M5.75 4A2.75 2.75 0 0 0 3 6.75v10.5A2.75 2.75 0 0 0 5.75 20h12.5A2.75 2.75 0 0 0 21 17.25V6.75A2.75 2.75 0 0 0 18.25 4zM4.5 6.75c0-.69.56-1.25 1.25-1.25h12.5c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25z"/><path d="M8 8.25c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 8.25m0 3c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 11.25m0 3c0-.41.34-.75.75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 14.25"/></g></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M12 18.5a6.5 6.5 0 1 0 0-13a6.5 6.5 0 0 0 0 13m0-11.5a5 5 0 1 1 0 10a5 5 0 0 1 0-10"/><path d="M12 2.75c.41 0 .75.34.75.75v1.25a.75.75 0 0 1-1.5 0V3.5c0-.41.34-.75.75-.75m0 16.5c.41 0 .75.34.75.75v1.25a.75.75 0 0 1-1.5 0V20c0-.41.34-.75.75-.75M3.5 11.25h1.25a.75.75 0 0 1 0 1.5H3.5a.75.75 0 0 1 0-1.5m15.75 0h1.25a.75.75 0 0 1 0 1.5h-1.25a.75.75 0 0 1 0-1.5M5.22 5.22c.3-.3.77-.3 1.06 0l.88.88a.75.75 0 0 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06m11.62 11.62c.3-.3.77-.3 1.06 0l.88.88a.75.75 0 1 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06M18.78 5.22c.3.3.3.77 0 1.06l-.88.88a.75.75 0 1 1-1.06-1.06l.88-.88c.3-.3.77-.3 1.06 0M7.16 16.84c.3.3.3.77 0 1.06l-.88.88a.75.75 0 1 1-1.06-1.06l.88-.88c.3-.3.77-.3 1.06 0"/></g></svg>`,
  moon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.93 2.5a.75.75 0 0 1 .69.98a8.75 8.75 0 0 0 10.9 11.1a.75.75 0 0 1 .96.88A10.25 10.25 0 1 1 13.93 2.5m-.98 2.38A8.75 8.75 0 1 0 24.1 16.97A10.26 10.26 0 0 1 12.95 4.88"/></svg>`,
  pdf: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M6.75 3A2.75 2.75 0 0 0 4 5.75v12.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25V9.414a2.75 2.75 0 0 0-.805-1.945l-3.664-3.664A2.75 2.75 0 0 0 13.586 3zM5.5 5.75C5.5 4.784 6.284 4 7.25 4h6.086c.464 0 .909.184 1.237.513l3.664 3.664c.329.328.513.773.513 1.237v8.836c0 .966-.784 1.75-1.75 1.75H6.75A1.75 1.75 0 0 1 5.5 18.25z"/><path d="M8.25 11h1.25a1.75 1.75 0 0 1 0 3.5H9v1.25a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75m.75 2a.25.25 0 0 0 0-.5H9v.5zM12 11a.75.75 0 0 1 .75.75v1.25h.75a1.75 1.75 0 0 1 0 3.5H12a.75.75 0 0 1-.75-.75v-4.5A.75.75 0 0 1 12 11m.75 4h.75a.25.25 0 0 0 0-.5h-.75zM16.25 11a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V15h-.25a.75.75 0 0 1 0-1.5h.25v-.75a.75.75 0 0 1 .75-.75"/></g></svg>`
};

function _ensureAppButtons(){
  const g = _grid();
  if (!g) return null;

  let resourceBtn = document.getElementById(IDS.btnResource);
  if (!resourceBtn) {
    resourceBtn = _buildToolBtn(IDS.btnResource, '编辑资源库', ICONS.library);
    resourceBtn.dataset.appCaseSeq = '0';
    resourceBtn.dataset.featureId = 'core:resource-library';
    g.insertBefore(resourceBtn, g.firstChild);
  }

  let themeBtn = document.getElementById(IDS.btnTheme);
  if (!themeBtn) {
    themeBtn = _buildToolBtn(IDS.btnTheme, '日夜模式', ICONS.moon);
    themeBtn.dataset.appCaseSeq = '1';
    themeBtn.dataset.featureId = 'core:theme-toggle';
    g.insertBefore(themeBtn, resourceBtn.nextSibling);
  }

  let pdfBtn = document.getElementById(IDS.btnPdf);
  if (!pdfBtn) {
    pdfBtn = _buildToolBtn(IDS.btnPdf, '打开PDF文件', ICONS.pdf);
    pdfBtn.dataset.appCaseSeq = '2';
    pdfBtn.dataset.featureId = 'core:open-pdf';
    g.insertBefore(pdfBtn, themeBtn.nextSibling);
  }

  _ensureSeq(resourceBtn);
  _ensureSeq(themeBtn);
  _ensureSeq(pdfBtn);

  return { g, resourceBtn, themeBtn, pdfBtn };
}

function _modalEls(){
  return {
    modal: document.getElementById(IDS.resourceModal),
    close: document.getElementById(IDS.closeResourceModal),
    list: document.getElementById(IDS.resourceList),
    preview: document.getElementById(IDS.resourcePreviewGrid),
    save: document.getElementById(IDS.resourceSaveBtn),
    reset: document.getElementById(IDS.resourceResetBtn)
  };
}

function _setModalOpen(open){
  const { modal } = _modalEls();
  if (!modal) return;
  try{ modal.classList.toggle('open', !!open); }catch(e){}
  try{ modal.setAttribute('aria-hidden', open ? 'false' : 'true'); }catch(e){}
  try{
    if (open) Message.emit(EVENTS.SUBMENU_OPEN, { id: 'resourceModal', pinned: true });
    else Message.emit(EVENTS.SUBMENU_CLOSE, { id: 'resourceModal', pinned: true });
  }catch(e){}
}

function _getGridButtonsForEdit(){
  const g = _grid();
  if (!g) return [];
  return Array.from(g.querySelectorAll('button.tool-btn')).filter((b)=>b instanceof HTMLElement);
}

function _syncFeatureRegistryFromGrid(){
  const btns = _getGridButtonsForEdit();
  for (const b of btns) {
    const rawId = _featureIdFromDomButton(b);
    const featureId = (_FEATURE_ID_RE.test(rawId) || String(rawId || '').startsWith('dom:')) ? rawId : `dom:${String(b.id || '')}`;
    const title = String(b.getAttribute('aria-label') || b.getAttribute('title') || featureId);
    const weight = Number.isFinite(Number(b.dataset.featureWeight))
      ? Number(b.dataset.featureWeight)
      : (featureId === 'core:resource-library' ? 1000 : (featureId === 'core:theme-toggle' ? 900 : 0));
    try{
      featureHub.register({ featureId, title, weight, domButton: b });
    }catch(e){}
  }
}

function _clonePreviewButton(src){
  if (!src || !(src instanceof HTMLElement)) return null;
  const meta = ButtonBox.getInstance(src);
  const buttonId = meta && meta.id ? meta.id : (src.dataset && src.dataset.buttonId ? String(src.dataset.buttonId || '') : String(src.id || ''));
  const title = String(src.getAttribute('aria-label') || src.getAttribute('title') || '');
  const def = buttonId
    ? ButtonBox.getButton(buttonId) || ButtonBox.registerButton({ id: buttonId, title, iconSvg: src.innerHTML || '', kind: 'feature', source: 'feature' })
    : ButtonBox.registerButton({ id: String(src.id || ''), title, iconSvg: src.innerHTML || '', kind: 'feature', source: 'feature' });
  if (!def) return null;
  const btn = ButtonBox.createButtonElement(def, {
    variant: 'toolbar',
    disabled: true,
    preview: true
  });
  if (!btn) return null;
  btn.className = 'tool-btn';
  return btn;
}

function _renderPreviewFromOrder(orderIds){
  const { preview } = _modalEls();
  if (!preview) return;
  const btns = _getGridButtonsForEdit();
  const byId = new Map(btns.map(b => [String(b.id || ''), b]));
  preview.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const id of orderIds) {
    const src = byId.get(String(id || ''));
    if (!src) continue;
    frag.appendChild(_clonePreviewButton(src));
  }
  preview.appendChild(frag);
}

function _listOrderFromDom(){
  const { list } = _modalEls();
  if (!list) return [];
  return Array.from(list.querySelectorAll('.resource-item')).map((el)=>String(el.getAttribute('data-id') || '')).filter(Boolean);
}

function _reorderListDom(nextOrder){
  const { list } = _modalEls();
  if (!list) return;
  const byId = new Map();
  for (const el of Array.from(list.children)) {
    if (!(el instanceof HTMLElement)) continue;
    const id = String(el.getAttribute('data-id') || '');
    if (id) byId.set(id, el);
  }
  const frag = document.createDocumentFragment();
  for (const id of nextOrder) {
    const el = byId.get(String(id || ''));
    if (el) frag.appendChild(el);
  }
  list.appendChild(frag);
}

function _defaultOrderFromSeq(){
  const btns = _getGridButtonsForEdit();
  btns.forEach(_ensureSeq);
  return _sortedDefaultButtons(btns).map((b)=>String(b.id || '')).filter(Boolean);
}

function _renderResourceEditor(){
  const { list, preview } = _modalEls();
  if (!list || !preview) return;
  const btns = _getGridButtonsForEdit();
  for (const b of btns) _ensureSeq(b);
  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  const order = btns.map((b)=>String(b.id || '')).filter(Boolean);

  for (const id of order) {
    const src = btns.find((b)=>String(b.id || '') === id);
    if (!src) continue;
    const item = document.createElement('div');
    item.className = 'resource-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('draggable', 'true');
    item.setAttribute('data-id', id);
    item.setAttribute('aria-grabbed', 'false');

    const drag = document.createElement('button');
    drag.className = 'resource-drag';
    drag.type = 'button';
    drag.textContent = '⋮';
    drag.setAttribute('aria-label', '拖动排序');

    const label = document.createElement('div');
    label.className = 'resource-label';
    label.textContent = String(src.getAttribute('aria-label') || src.getAttribute('title') || id);

    const icon = _clonePreviewButton(src);
    icon.disabled = true;

    item.appendChild(drag);
    item.appendChild(label);
    item.appendChild(icon);

    frag.appendChild(item);
  }

  list.appendChild(frag);
  _renderPreviewFromOrder(order);
  _wireResourceDnD();
}

let _resourceDragId = '';
let _resourcePointer = null;

function _wireResourceDnD(){
  const { list } = _modalEls();
  if (!list || list.dataset.wired === '1') return;
  list.dataset.wired = '1';

  const cssEscape = (v)=>{
    try{ if (window && window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(v || '')); }catch(e){}
    return String(v || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };

  list.addEventListener('dragstart', (e)=>{
    const item = e.target && e.target.closest ? e.target.closest('.resource-item') : null;
    if (!item) return;
    const id = String(item.getAttribute('data-id') || '');
    if (!id) return;
    _resourceDragId = id;
    try{ item.setAttribute('aria-grabbed','true'); }catch(err){}
    try{
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }
    }catch(err){}
  });

  list.addEventListener('dragover', (e)=>{
    if (!_resourceDragId) return;
    e.preventDefault();
    const over = e.target && e.target.closest ? e.target.closest('.resource-item') : null;
    if (!over) return;
    const overId = String(over.getAttribute('data-id') || '');
    if (!overId || overId === _resourceDragId) return;
    const cur = _listOrderFromDom();
    const next = cur.filter((x)=>x !== _resourceDragId);
    const idx = next.indexOf(overId);
    if (idx < 0) return;
    next.splice(idx, 0, _resourceDragId);
    _reorderListDom(next);
    _renderPreviewFromOrder(next);
  });

  list.addEventListener('dragend', ()=>{
    const item = list.querySelector(`.resource-item[data-id="${cssEscape(_resourceDragId)}"]`);
    if (item) { try{ item.setAttribute('aria-grabbed','false'); }catch(e){} }
    _resourceDragId = '';
  });

  const onPointerDown = (e)=>{
    const handle = e.target && e.target.closest ? e.target.closest('.resource-drag') : null;
    if (!handle) return;
    const item = handle.closest('.resource-item');
    if (!item) return;
    const id = String(item.getAttribute('data-id') || '');
    if (!id) return;
    _resourcePointer = { id, pointerId: e.pointerId };
    _resourceDragId = id;
    try{ item.setAttribute('aria-grabbed','true'); }catch(err){}
    try{ handle.setPointerCapture(e.pointerId); }catch(err){}
  };

  const onPointerMove = (e)=>{
    if (!_resourcePointer || e.pointerId !== _resourcePointer.pointerId) return;
    const x = e.clientX;
    const y = e.clientY;
    const el = document.elementFromPoint(x, y);
    const over = el && el.closest ? el.closest('.resource-item') : null;
    if (!over) return;
    const overId = String(over.getAttribute('data-id') || '');
    if (!overId || overId === _resourceDragId) return;
    const cur = _listOrderFromDom();
    const next = cur.filter((v)=>v !== _resourceDragId);
    const idx = next.indexOf(overId);
    if (idx < 0) return;
    next.splice(idx, 0, _resourceDragId);
    _reorderListDom(next);
    _renderPreviewFromOrder(next);
  };

  const onPointerUp = (e)=>{
    if (!_resourcePointer || e.pointerId !== _resourcePointer.pointerId) return;
    const item = list.querySelector(`.resource-item[data-id="${cssEscape(_resourceDragId)}"]`);
    if (item) { try{ item.setAttribute('aria-grabbed','false'); }catch(err){} }
    _resourcePointer = null;
    _resourceDragId = '';
  };

  list.addEventListener('pointerdown', onPointerDown);
  list.addEventListener('pointermove', onPointerMove);
  list.addEventListener('pointerup', onPointerUp);
  list.addEventListener('pointercancel', onPointerUp);
}

function _openResourceEditor(){
  _renderResourceEditor();
  _setModalOpen(true);
  try{
    const { close } = _modalEls();
    if (close) close.focus();
  }catch(e){}
}

function _closeResourceEditor(){
  _setModalOpen(false);
}

function _toggleTheme(){
  const s = Settings.loadSettings();
  const curMode = _resolveRequestedThemeToMode(s && s.theme);
  const next = curMode === 'dark' ? 'light' : 'dark';
  updateAppSettings({ theme: next });
}

function _syncThemeBtnUI(){
  const btn = document.getElementById(IDS.btnTheme);
  if (!btn) return;
  const s = Settings.loadSettings();
  const curMode = _resolveRequestedThemeToMode(s && s.theme);
  if (curMode === 'dark') {
    btn.innerHTML = ICONS.sun;
    btn.setAttribute('title', '切换到日间模式');
    btn.setAttribute('aria-label', '切换到日间模式');
  } else {
    btn.innerHTML = ICONS.moon;
    btn.setAttribute('title', '切换到夜间模式');
    btn.setAttribute('aria-label', '切换到夜间模式');
  }
}

async function _loadAndApplySavedOrder(){
  try{
    await featureHub.loadPersisted();
    const cfg = featureHub.getSortConfig();
    const manual = await _kvGet(DB.keyOrder).catch(()=>null);
    if (cfg.mode === 'manual' && Array.isArray(manual) && manual.length) {
      _applyOrderToGrid(manual);
      return;
    }
    const btns = _getGridButtonsForEdit();
    btns.forEach(_ensureSeq);
    const items = btns
      .map((b)=>{
        const fid = _featureIdFromDomButton(b);
        const seq = Number(b.dataset.appCaseSeq || 0);
        const weight = Number.isFinite(Number(b.dataset.featureWeight)) ? Number(b.dataset.featureWeight) : (seq ? 0 : 10);
        const featureId = (fid && _FEATURE_ID_RE.test(fid)) ? fid : (String(fid || '').startsWith('dom:') ? fid : `dom:${String(b.id || '')}`);
        _ensureFeatureIdOnDom(b, featureId);
        return { featureId, weight, btn: b };
      })
      .filter((x)=>!!x.featureId);
    const nextOrderFeatureIds = featureHub.sortFeatureIds(items.map((x)=>({ featureId: x.featureId, weight: x.weight })));
    const byFeatureId = new Map(items.map((x)=>[x.featureId, x.btn]));
    const orderDomIds = nextOrderFeatureIds.map((fid)=>{ const b = byFeatureId.get(fid); return b ? String(b.id || '') : ''; }).filter(Boolean);
    if (orderDomIds.length) _applyOrderToGrid(orderDomIds);
    else _applyOrderToGrid(null);
  }catch(e){
    _applyOrderToGrid(null);
  }
}

function _wireAppCase(){
  const created = _ensureAppButtons();
  if (!created) return;

  const { resourceBtn, themeBtn, pdfBtn } = created;

  if (!resourceBtn.dataset.wired) {
    resourceBtn.dataset.wired = '1';
    resourceBtn.addEventListener('click', _openResourceEditor);
  }

  if (!themeBtn.dataset.wired) {
    themeBtn.dataset.wired = '1';
    themeBtn.addEventListener('click', _toggleTheme);
  }

  if (pdfBtn && !pdfBtn.dataset.wired) {
    pdfBtn.dataset.wired = '1';
    pdfBtn.addEventListener('click', ()=>{
      openPdfFile();
    });
  }

  try{
    featureHub.register({ featureId: 'core:resource-library', title: '编辑资源库', version: '1.0.0', weight: 1000, domButton: resourceBtn, invoke: ()=>_openResourceEditor() });
    featureHub.register({ featureId: 'core:theme-toggle', title: '日夜模式', version: '1.0.0', weight: 900, domButton: themeBtn, invoke: ()=>_toggleTheme() });
    if (pdfBtn) featureHub.register({ featureId: 'core:open-pdf', title: '打开PDF文件', version: '1.0.0', weight: 800, domButton: pdfBtn, invoke: (params)=>openPdfFile(params) });
  }catch(e){}
  _syncFeatureRegistryFromGrid();

  const els = _modalEls();
  if (els.close && !els.close.dataset.wired) {
    els.close.dataset.wired = '1';
    els.close.addEventListener('click', _closeResourceEditor);
  }
  if (els.modal && !els.modal.dataset.wired) {
    els.modal.dataset.wired = '1';
    els.modal.addEventListener('click', (e)=>{
      const t = e && e.target;
      if (!t || !(t instanceof HTMLElement)) return;
      if (t.classList.contains('settings-backdrop')) _closeResourceEditor();
    });
    els.modal.addEventListener('keydown', (e)=>{
      if (e.key !== 'Escape') return;
      if (!els.modal.classList.contains('open')) return;
      e.preventDefault();
      _closeResourceEditor();
    });
  }

  if (els.reset && !els.reset.dataset.wired) {
    els.reset.dataset.wired = '1';
    els.reset.addEventListener('click', async ()=>{
      try{ await _kvDel(DB.keyOrder); }catch(e){}
      try{ await featureHub.setSortConfig({ mode: 'smart' }); }catch(e){}
      const def = _defaultOrderFromSeq();
      _reorderListDom(def);
      _renderPreviewFromOrder(def);
    });
  }

  if (els.save && !els.save.dataset.wired) {
    els.save.dataset.wired = '1';
    els.save.addEventListener('click', async ()=>{
      const order = _listOrderFromDom();
      if (!order.length) return;
      try{ await _kvSet(DB.keyOrder, order); }catch(e){}
      try{ await featureHub.setSortConfig({ mode: 'manual' }); }catch(e){}
      _applyOrderToGrid(order);
      _closeResourceEditor();
    });
  }

  _syncThemeBtnUI();
}

let _obs = null;

export async function initAppCase(){
  _wireAppCase();
  await _loadAndApplySavedOrder();
  _wireAppCase();

  const g = _grid();
  if (g && !_obs) {
    _obs = new MutationObserver(async ()=>{
      const btns = _getGridButtonsForEdit();
      btns.forEach(_ensureSeq);
      const cfg = featureHub.getSortConfig();
      const saved = await _kvGet(DB.keyOrder).catch(()=>null);
      if (cfg.mode === 'manual' && Array.isArray(saved)) _applyOrderToGrid(saved);
      if (cfg.mode === 'smart') await _loadAndApplySavedOrder();
      _wireAppCase();
    });
    try{ _obs.observe(g, { childList: true }); }catch(e){}
  }

  try{
    Message.on(EVENTS.SETTINGS_CHANGED, ()=>{
      _syncThemeBtnUI();
    });
  }catch(e){}
}

export default { initAppCase };
