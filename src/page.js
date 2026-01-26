// page.js — 分页管理与底部左侧翻页工具栏
import { getSnapshot, loadSnapshot, getCanvasImage } from './renderer.js';
import Message, { EVENTS } from './message.js';
import Settings, { loadSettings } from './setting.js';

let _pageToolbarInitialized = false;
let _pageToolbarPending = false;

function _readAppMode(){
  try{
    return String(document.body && document.body.dataset ? (document.body.dataset.appMode || '') : '');
  }catch(e){
    return '';
  }
}

function _deferPageToolbarInit(){
  if (_pageToolbarPending) return;
  _pageToolbarPending = true;
  try{
    Message.on(EVENTS.APP_MODE_CHANGED, (st)=>{
      if (_pageToolbarInitialized) return;
      const mode = st && st.mode ? String(st.mode) : _readAppMode();
      if (mode && mode === 'annotation') return;
      initPageToolbar({ force: true });
    });
  }catch(e){}
}

function initPageToolbar(opts){
  if (_pageToolbarInitialized) return;
  const bootMode = _readAppMode();
  if (!opts || opts.force !== true) {
    if (bootMode === 'annotation') {
      _deferPageToolbarInit();
      return;
    }
  }
  _pageToolbarInitialized = true;
  let pages = [];
  let current = 0;
  let enabled = true;
  const POSITION_KEY = 'whiteboard_page_toolbar_position';
  let allowDrag = false;

  // 尝试恢复上一次 Session（用于重启等场景）
  try {
    const savedSession = localStorage.getItem('whiteboard_pages_session');
    if (savedSession) {
      const { pages: savedPages, current: savedCurrentIdx, timestamp } = JSON.parse(savedSession);
      // Session 有效期 10 分钟
      if (Date.now() - timestamp < 10 * 60 * 1000 && Array.isArray(savedPages) && savedPages.length > 0) {
        pages = savedPages;
        current = Math.min(savedCurrentIdx, pages.length - 1);
        loadSnapshot(pages[current].ops || []);
        localStorage.removeItem('whiteboard_pages_session');
      }
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }

  // 如果没有恢复成功，则初始化第一页
  if (pages.length === 0) {
    try { 
      pages.push({ 
        ops: getSnapshot(), 
        thumbnail: getCanvasImage(240) 
      }); 
    } catch (e) { 
      pages.push({ ops: [], thumbnail: '' }); 
    }
  }

  let toolbar = document.getElementById('pageToolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'pageToolbar';
    toolbar.setAttribute('role', 'toolbar');
    document.body.appendChild(toolbar);
  }

  let sidebar = document.getElementById('pagePreviewSidebar');
  if (!sidebar) {
    sidebar = document.createElement('div');
    sidebar.id = 'pagePreviewSidebar';
    sidebar.innerHTML = `
      <div class="page-preview-header">页面预览</div>
      <div class="page-preview-list"></div>
    `;
    document.body.appendChild(sidebar);
  }

  let previewList = sidebar.querySelector('.page-preview-list');
  if (!previewList) {
    previewList = document.createElement('div');
    previewList.className = 'page-preview-list';
    sidebar.appendChild(previewList);
  }

  function makeBtn(text, title, id){
    const b = document.createElement('button');
    b.className = 'page-btn';
    b.textContent = text;
    b.title = title || '';
    if (id) b.id = id;
    return b;
  }

  let prevBtn = document.getElementById('pagePrevBtn');
  if (!prevBtn) {
    prevBtn = makeBtn('‹', '上一页', 'pagePrevBtn');
    toolbar.appendChild(prevBtn);
  }

  let label = document.getElementById('pageLabel');
  if (!label) {
    label = document.createElement('div');
    label.id = 'pageLabel';
    label.className = 'page-label';
    label.title = '点击查看页面预览';
    toolbar.appendChild(label);
  }

  let nextBtn = document.getElementById('pageNextBtn');
  if (!nextBtn) {
    nextBtn = makeBtn('›', '下一页', 'pageNextBtn');
    toolbar.appendChild(nextBtn);
  }

  let newBtn = document.getElementById('pageNewBtn');
  if (!newBtn) {
    const newContainer = document.createElement('div');
    newContainer.className = 'page-new';
    newBtn = document.createElement('button');
    newBtn.id = 'pageNewBtn';
    newBtn.className = 'page-new-btn';
    newBtn.textContent = '+ 新建';
    newBtn.title = '新建页面';
    newContainer.appendChild(newBtn);
    toolbar.appendChild(newContainer);
  }

  function applyEnabled(nextEnabled){
    enabled = !!nextEnabled;
    try{ toolbar.style.display = enabled ? 'flex' : 'none'; }catch(e){}
    try{ toolbar.setAttribute('aria-hidden', enabled ? 'false' : 'true'); }catch(e){}
    if (!enabled) hideSidebar();
  }

  function updateUI(){
    label.textContent = `${current+1} / ${pages.length}`;
    prevBtn.disabled = current <= 0;
    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
    nextBtn.style.opacity = '1';
  }

  function saveCurrent(){
    try { 
      pages[current] = { 
        ops: getSnapshot(), 
        thumbnail: getCanvasImage(240) 
      }; 
    } catch(e){ 
      pages[current] = { ops: [], thumbnail: '' }; 
    }
  }

  function renderThumbnails() {
    previewList.innerHTML = '';
    pages.forEach((page, index) => {
      const item = document.createElement('div');
      item.className = `page-preview-item${index === current ? ' active' : ''}`;
      item.innerHTML = `
        <img src="${page.thumbnail || ''}" alt="Page ${index + 1}" loading="lazy">
        <div class="page-preview-num">${index + 1}</div>
      `;
      item.addEventListener('click', () => {
        if (index === current) return;
        saveCurrent();
        current = index;
        loadSnapshot(pages[current].ops || []);
        updateUI();
        renderThumbnails();
        // 如果是点击切换，可以考虑是否关闭侧边栏，根据需求通常保持开启以便连续操作
      });
      previewList.appendChild(item);
      
      // 确保当前激活项可见
      if (index === current) {
        setTimeout(() => {
          item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    });
  }

  function toggleSidebar(e) {
    if (e) e.stopPropagation();
    const isOpen = sidebar.classList.contains('open');
    if (isOpen) {
      hideSidebar();
    } else {
      saveCurrent(); // 弹出前先保存当前页缩略图
      renderThumbnails();
      sidebar.classList.add('open');
    }
  }

  function hideSidebar() {
    sidebar.classList.remove('open');
  }

  function loadSavedPosition(){
    try{
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      const left = Number(obj.left);
      const top = Number(obj.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top };
    }catch(e){
      return null;
    }
  }

  function savePosition(pos){
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    try{
      localStorage.setItem(POSITION_KEY, JSON.stringify({ left: Math.round(pos.left), top: Math.round(pos.top) }));
    }catch(e){}
  }

  function clampPosition(left, top, rect){
    const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || rect.width;
    const vh = window.innerHeight || (document.documentElement ? document.documentElement.clientHeight : 0) || rect.height;
    const maxLeft = Math.max(0, vw - rect.width);
    const maxTop = Math.max(0, vh - rect.height);
    let l = left;
    let t = top;
    if (!Number.isFinite(l)) l = rect.left;
    if (!Number.isFinite(t)) t = rect.top;
    l = Math.min(Math.max(0, l), maxLeft);
    t = Math.min(Math.max(0, t), maxTop);
    return { left: l, top: t };
  }

  function applyFixedBottomLeft(){
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || rect.width;
    const left = 20;
    const bottom = 20;
    const clamped = clampPosition(left, (window.innerHeight || rect.height) - bottom - rect.height, rect);
    toolbar.style.position = 'fixed';
    toolbar.style.left = Math.round(clamped.left) + 'px';
    toolbar.style.bottom = bottom + 'px';
    toolbar.style.top = 'auto';
  }

  function applyInitialPosition(){
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    try{
      const s = loadSettings();
      allowDrag = !!(s && s.pageSwitchDraggable);
    }catch(e){}

    if (!allowDrag) {
      applyFixedBottomLeft();
      return;
    }

    const saved = loadSavedPosition();
    if (saved) {
      const clamped = clampPosition(saved.left, saved.top, rect);
      toolbar.style.position = 'fixed';
      toolbar.style.left = Math.round(clamped.left) + 'px';
      toolbar.style.top = Math.round(clamped.top) + 'px';
      toolbar.style.bottom = 'auto';
      return;
    }
    const vw = window.innerWidth || (document.documentElement ? document.documentElement.clientWidth : 0) || rect.width;
    const left = Math.round((vw - rect.width) / 2);
    const top = 24;
    const clamped = clampPosition(left, top, rect);
    toolbar.style.position = 'fixed';
    toolbar.style.left = Math.round(clamped.left) + 'px';
    toolbar.style.top = Math.round(clamped.top) + 'px';
    toolbar.style.bottom = 'auto';
    savePosition(clamped);
  }

  let dragState = null;

  function onDragStart(e){
    if (!allowDrag) return;
    if (!toolbar) return;
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    const target = e.target;
    if (!target || target.closest('#pagePrevBtn') || target.closest('#pageNextBtn') || target.closest('#pageNewBtn') || target.closest('#pageLabel') || target.closest('#pagePreviewSidebar')) return;
    const rect = toolbar.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top
    };
    try{ toolbar.setPointerCapture(e.pointerId); }catch(err){}
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    e.preventDefault();
  }

  function onDragMove(e){
    if (!dragState || !toolbar || !allowDrag) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const rect = toolbar.getBoundingClientRect();
    const next = clampPosition(dragState.originLeft + dx, dragState.originTop + dy, rect);
    toolbar.style.position = 'fixed';
    toolbar.style.left = Math.round(next.left) + 'px';
    toolbar.style.top = Math.round(next.top) + 'px';
    toolbar.style.bottom = 'auto';
  }

  function onDragEnd(e){
    if (!dragState || !toolbar) return;
    window.removeEventListener('pointermove', onDragMove);
    try{ toolbar.releasePointerCapture(e.pointerId); }catch(err){}
    const rect = toolbar.getBoundingClientRect();
    savePosition({ left: rect.left, top: rect.top });
    dragState = null;
  }

  // 同步缩略图机制
  let syncTimer = null;
  function scheduleSyncThumbnail() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (sidebar.classList.contains('open')) {
        saveCurrent();
        const activeItem = previewList.querySelector('.page-preview-item.active img');
        if (activeItem && pages[current].thumbnail) {
          activeItem.src = pages[current].thumbnail;
        }
      }
    }, 1000); // 1秒停顿后同步，避免性能抖动
  }

  Message.on(EVENTS.HISTORY_CHANGED, () => {
    if (sidebar.classList.contains('open')) {
      scheduleSyncThumbnail();
    }
  });

  label.addEventListener('click', toggleSidebar);

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && !label.contains(e.target)) {
      hideSidebar();
    }
  });

  prevBtn.addEventListener('click', ()=>{
    if (!enabled) return;
    if (current <= 0) return;
    saveCurrent();
    current -= 1;
    loadSnapshot(pages[current].ops || []);
    updateUI();
    if (sidebar.classList.contains('open')) renderThumbnails();
  });

  nextBtn.addEventListener('click', ()=>{
    if (!enabled) return;
    saveCurrent();
    if (current >= pages.length - 1) {
      // 在末页时，下一页操作等同于新建页面
      pages.push({ ops: [], thumbnail: '' });
      current = pages.length - 1;
      loadSnapshot([]);
    } else {
      current += 1;
      loadSnapshot(pages[current].ops || []);
    }
    updateUI();
    if (sidebar.classList.contains('open')) renderThumbnails();
  });

  newBtn.addEventListener('click', ()=>{
    if (!enabled) return;
    saveCurrent();
    pages.push({ ops: [], thumbnail: '' });
    current = pages.length - 1;
    loadSnapshot([]);
    updateUI();
    if (sidebar.classList.contains('open')) renderThumbnails();
  });

  updateUI();

  applyInitialPosition();

  try{
    toolbar.addEventListener('pointerdown', onDragStart);
  }catch(e){}

  try{
    window.addEventListener('resize', ()=>{
      if (!toolbar) return;
      if (!allowDrag) {
        applyFixedBottomLeft();
        return;
      }
      const rect = toolbar.getBoundingClientRect();
      const clamped = clampPosition(rect.left, rect.top, rect);
      toolbar.style.position = 'fixed';
      toolbar.style.left = Math.round(clamped.left) + 'px';
      toolbar.style.top = Math.round(clamped.top) + 'px';
      toolbar.style.bottom = 'auto';
      savePosition(clamped);
    });
  }catch(e){}

  try{
    Message.on(EVENTS.SETTINGS_UPDATED, (payload)=>{
      const s = payload && typeof payload === 'object' ? payload : {};
      if (typeof s.pageSwitchDraggable === 'undefined') return;
      allowDrag = !!s.pageSwitchDraggable;
      if (!allowDrag) {
        applyFixedBottomLeft();
      }
    });
  }catch(e){}

  try{
    const bootMode = document && document.body && document.body.dataset ? document.body.dataset.appMode : '';
    applyEnabled(bootMode !== 'annotation');
  }catch(e){}

  try{
    Message.on(EVENTS.APP_MODE_CHANGED, (st)=>{
      const m = st && st.mode;
      applyEnabled(m !== 'annotation');
    });
  }catch(e){}

  // 监听应用准备退出信号，持久化当前 Session
  Message.on(EVENTS.APP_PREPARE_EXIT, () => {
    try {
      saveCurrent();
      localStorage.setItem('whiteboard_pages_session', JSON.stringify({
        pages,
        current,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.error('Failed to save pages session on exit:', e);
    }
  });
}

// initialize immediately if DOM is ready, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPageToolbar);
} else {
  initPageToolbar();
}

export { initPageToolbar };
