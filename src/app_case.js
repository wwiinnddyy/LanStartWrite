import Settings from './setting.js';
import { updateAppSettings } from './write_a_change.js';
import Message, { EVENTS } from './message.js';

const IDS = {
  grid: 'moreMenuQuickGrid',
  resourceModal: 'resourceModal',
  resourceList: 'resourceList',
  resourcePreviewGrid: 'resourcePreviewGrid',
  resourceSaveBtn: 'resourceSaveBtn',
  resourceResetBtn: 'resourceResetBtn',
  closeResourceModal: 'closeResourceModal',
  btnResource: 'appCaseResourceBtn',
  btnTheme: 'appCaseThemeBtn'
};

const DB = {
  name: 'lanstartwrite',
  version: 1,
  store: 'kv',
  keyOrder: 'app_case.moreMenuOrder.v1'
};

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
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.id = id;
  btn.setAttribute('title', title);
  btn.setAttribute('aria-label', title);
  btn.innerHTML = iconSvg;
  return btn;
}

const ICONS = {
  library: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M5.75 4A2.75 2.75 0 0 0 3 6.75v10.5A2.75 2.75 0 0 0 5.75 20h12.5A2.75 2.75 0 0 0 21 17.25V6.75A2.75 2.75 0 0 0 18.25 4zM4.5 6.75c0-.69.56-1.25 1.25-1.25h12.5c.69 0 1.25.56 1.25 1.25v10.5c0 .69-.56 1.25-1.25 1.25H5.75c-.69 0-1.25-.56-1.25-1.25z"/><path d="M8 8.25c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 8.25m0 3c0-.41.34-.75.75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 8 11.25m0 3c0-.41.34-.75.75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 8 14.25"/></g></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M12 18.5a6.5 6.5 0 1 0 0-13a6.5 6.5 0 0 0 0 13m0-11.5a5 5 0 1 1 0 10a5 5 0 0 1 0-10"/><path d="M12 2.75c.41 0 .75.34.75.75v1.25a.75.75 0 0 1-1.5 0V3.5c0-.41.34-.75.75-.75m0 16.5c.41 0 .75.34.75.75v1.25a.75.75 0 0 1-1.5 0V20c0-.41.34-.75.75-.75M3.5 11.25h1.25a.75.75 0 0 1 0 1.5H3.5a.75.75 0 0 1 0-1.5m15.75 0h1.25a.75.75 0 0 1 0 1.5h-1.25a.75.75 0 0 1 0-1.5M5.22 5.22c.3-.3.77-.3 1.06 0l.88.88a.75.75 0 0 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06m11.62 11.62c.3-.3.77-.3 1.06 0l.88.88a.75.75 0 1 1-1.06 1.06l-.88-.88a.75.75 0 0 1 0-1.06M18.78 5.22c.3.3.3.77 0 1.06l-.88.88a.75.75 0 1 1-1.06-1.06l.88-.88c.3-.3.77-.3 1.06 0M7.16 16.84c.3.3.3.77 0 1.06l-.88.88a.75.75 0 1 1-1.06-1.06l.88-.88c.3-.3.77-.3 1.06 0"/></g></svg>`,
  moon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.93 2.5a.75.75 0 0 1 .69.98a8.75 8.75 0 0 0 10.9 11.1a.75.75 0 0 1 .96.88A10.25 10.25 0 1 1 13.93 2.5m-.98 2.38A8.75 8.75 0 1 0 24.1 16.97A10.26 10.26 0 0 1 12.95 4.88"/></svg>`
};

function _ensureAppButtons(){
  const g = _grid();
  if (!g) return null;

  let resourceBtn = document.getElementById(IDS.btnResource);
  if (!resourceBtn) {
    resourceBtn = _buildToolBtn(IDS.btnResource, '编辑资源库', ICONS.library);
    resourceBtn.dataset.appCaseSeq = '0';
    g.insertBefore(resourceBtn, g.firstChild);
  }

  let themeBtn = document.getElementById(IDS.btnTheme);
  if (!themeBtn) {
    themeBtn = _buildToolBtn(IDS.btnTheme, '日夜模式', ICONS.moon);
    themeBtn.dataset.appCaseSeq = '1';
    g.insertBefore(themeBtn, resourceBtn.nextSibling);
  }

  _ensureSeq(resourceBtn);
  _ensureSeq(themeBtn);

  return { g, resourceBtn, themeBtn };
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

function _clonePreviewButton(src){
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.disabled = true;
  btn.setAttribute('tabindex', '-1');
  btn.innerHTML = src.innerHTML || '';
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
    const order = await _kvGet(DB.keyOrder);
    if (Array.isArray(order)) _applyOrderToGrid(order);
    else _applyOrderToGrid(null);
  }catch(e){
    _applyOrderToGrid(null);
  }
}

function _wireAppCase(){
  const created = _ensureAppButtons();
  if (!created) return;

  const { resourceBtn, themeBtn } = created;

  if (!resourceBtn.dataset.wired) {
    resourceBtn.dataset.wired = '1';
    resourceBtn.addEventListener('click', _openResourceEditor);
  }

  if (!themeBtn.dataset.wired) {
    themeBtn.dataset.wired = '1';
    themeBtn.addEventListener('click', _toggleTheme);
  }

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
      const saved = await _kvGet(DB.keyOrder).catch(()=>null);
      if (Array.isArray(saved)) _applyOrderToGrid(saved);
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
