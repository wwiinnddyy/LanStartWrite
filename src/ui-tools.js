/**
 * ui-tools.js
 *
 * 工具栏与设置面板的 UI 编排层（渲染进程）。
 *
 * 职责边界：
 * - UI 事件绑定：按钮点击/触控点击、菜单打开/关闭、快捷键
 * - 与渲染内核交互：调用 renderer.js 的工具状态/绘制能力
 * - 与主进程协作：批注模式下的“鼠标穿透”与“可交互区域”同步
 * - 与插件系统协作：打开插件管理、触发安装、刷新列表（插件实现位于 mod.js/main.js）
 *
 * 关键链路（批注模式交互控制）：
 * 1. UI 打开/关闭子菜单、弹窗 → 计算可交互矩形 → 发送给主进程
 * 2. 主进程根据矩形决定窗口哪些区域接收鼠标，其他区域穿透到下层应用
 */
import { clearAll, undo, redo, setBrushColor, setErasing, canUndo, canRedo, replaceStrokeColors, getToolState, setInputEnabled, setMultiTouchPenEnabled, setInkRecognitionEnabled, setViewTransform, setCanvasMode, getCubenoteState, applyCubenoteState } from './renderer.js';
import Curous from './curous.js';
import Settings, { getPenColorFromSettings } from './setting.js';
import { showSubmenu, cleanupMenuStyles, initPinHandlers, closeAllSubmenus } from './more_decide_windows.js';
import Message, { EVENTS } from './message.js';
import { updateAppSettings } from './write_a_change.js';
import { initPenUI, updatePenModeLabel } from './pen.js';
import { initEraserUI, updateEraserModeLabel } from './erese.js';
import { applyModeCanvasBackground } from './mode_background.js';

const colorTool = document.getElementById('colorTool');
const pointerTool = document.getElementById('pointerTool');
const colorMenu = document.getElementById('colorMenu');
const eraserTool = document.getElementById('eraserTool');
const eraserMenu = document.getElementById('eraserMenu');
const moreTool = document.getElementById('moreTool');
const moreMenu = document.getElementById('moreMenu');
const clearBtn = document.getElementById('clear');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const collapseTool = document.getElementById('collapseTool');
const exitTool = document.getElementById('exitTool');

// initialize pen and eraser UI modules
initPenUI();
initEraserUI();

function storeDefaultIcon(el){
  if (!el) return;
  if (!el.dataset.defaultIcon) el.dataset.defaultIcon = el.innerHTML || '';
}

function restoreDefaultIcon(el){
  if (!el) return;
  if (typeof el.dataset.defaultIcon === 'string') el.innerHTML = el.dataset.defaultIcon;
}

function escapeAttr(v){
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getColorSwatchIconSvg(color){
  const fill = escapeAttr(color || '#000000');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="${fill}" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/></svg>`;
}

function getEraserModeIconSvg(mode){
  const m = mode || 'pixel';
  const btn = document.querySelector(`.erase-mode-btn[data-mode="${m}"]`);
  const svg = btn ? btn.querySelector('svg') : null;
  return svg ? svg.outerHTML : '';
}

function syncToolbarIcons(){
  const s = getToolState();
  const pointerActive = !!(pointerTool && pointerTool.classList.contains('active'));

  if (eraserTool) {
    if (s && s.erasing) {
      const svg = getEraserModeIconSvg(s.eraserMode || 'pixel');
      if (svg) eraserTool.innerHTML = svg;
      else restoreDefaultIcon(eraserTool);
    } else {
      restoreDefaultIcon(eraserTool);
    }
  }

  if (colorTool) {
    if (!pointerActive && !(s && s.erasing)) colorTool.innerHTML = getColorSwatchIconSvg((s && s.brushColor) || '#000000');
    else restoreDefaultIcon(colorTool);
  }
}

storeDefaultIcon(colorTool);
storeDefaultIcon(eraserTool);
storeDefaultIcon(exitTool);

const APP_MODES = { WHITEBOARD: 'whiteboard', ANNOTATION: 'annotation' };
const ENTER_WHITEBOARD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><path d="M2 6.75A2.75 2.75 0 0 1 4.75 4h14.5A2.75 2.75 0 0 1 22 6.75v5.786l-.8-.801a2.5 2.5 0 0 0-.7-.493V6.75c0-.69-.56-1.25-1.25-1.25H4.75c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h7.265a2.5 2.5 0 0 0 .561 1.5H4.75A2.75 2.75 0 0 1 2 17.25z"/><path d="M20.492 12.442a1.5 1.5 0 0 0-2.121 0l-3.111 3.11l4.207 4.208l3.11-3.111a1.5 1.5 0 0 0 0-2.122zm-7.039 4.918l1.1-1.1l4.207 4.207l-1.1 1.1a1.5 1.5 0 0 1-2.121 0l-2.086-2.086a1.5 1.5 0 0 1 0-2.122"/></g></svg>`;

let _appMode = APP_MODES.WHITEBOARD;
let _interactiveRectsRaf = 0;
let _lastTouchActionAt = 0;
let _lastMouseMoveAt = 0;
let applyCollapsed = ()=>{};
let _lastIgnoreMouse = { ignore: false, forward: false, at: 0 };
let _rectWatchdogTimer = 0;

/**
 * 读取持久化的应用模式（白板/批注）。
 * @returns {'whiteboard'|'annotation'}
 */
function readPersistedAppMode(){
  try{
    const v = localStorage.getItem('appMode');
    if (v === APP_MODES.ANNOTATION) return APP_MODES.ANNOTATION;
  }catch(e){}
  return APP_MODES.WHITEBOARD;
}

/**
 * 持久化应用模式（白板/批注）。
 * @param {'whiteboard'|'annotation'} mode - 目标模式
 * @returns {void}
 */
function persistAppMode(mode){
  try{ localStorage.setItem('appMode', mode); }catch(e){}
}

/**
 * 绑定“触控点击（tap）”的统一适配层。
 * @param {HTMLElement} el - 目标元素
 * @param {(ev:PointerEvent|MouseEvent)=>void} onTap - 点击回调
 * @param {{delayMs?:number, moveThreshold?:number}} [opts] - 行为参数
 * @returns {void}
 *
 * 设计目标：
 * - 触控上避免 click 的 300ms 延迟与误触
 * - 通过位移阈值区分“点击”和“拖动”
 * - 在 pointerup 触发后，短时间内屏蔽由浏览器合成的 click 事件，避免重复触发
 *
 * 流程图（touch tap）：
 * 1. pointerdown(touch)：记录起点与时间，capture 指针
 * 2. pointermove：累计位移，超过阈值则标记 moved=true
 * 3. pointerup：若 moved=false → 计算补齐 delayMs → setTimeout 执行 onTap
 * 4. click 捕获阶段：若最近触发过 tap → 阻止默认与冒泡，避免二次触发
 */
function bindTouchTap(el, onTap, opts){
  if (!el || typeof onTap !== 'function') return;
  const delayMs = (opts && typeof opts.delayMs === 'number') ? Math.max(0, opts.delayMs) : 20;
  const moveThreshold = (opts && typeof opts.moveThreshold === 'number') ? Math.max(0, opts.moveThreshold) : 8;
  let down = null;
  let moved = false;

  function clear(){
    down = null;
    moved = false;
  }

  el.addEventListener('pointerdown', (e)=>{
    if (!e || e.pointerType !== 'touch') return;
    _lastTouchActionAt = Date.now();
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
    moved = false;
    try{ if (el.setPointerCapture) el.setPointerCapture(e.pointerId); }catch(err){}
  }, { passive: true });

  el.addEventListener('pointermove', (e)=>{
    if (!down || !e || e.pointerId !== down.id) return;
    const dx = (e.clientX - down.x);
    const dy = (e.clientY - down.y);
    if ((dx*dx + dy*dy) > (moveThreshold*moveThreshold)) moved = true;
  }, { passive: true });

  el.addEventListener('pointerup', (e)=>{
    if (!down || !e || e.pointerId !== down.id) return;
    const tUp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const elapsed = tUp - down.t;
    const shouldFire = !moved;
    const delay = Math.max(0, delayMs - elapsed);
    const ev = e;
    clear();
    try{ if (el.releasePointerCapture) el.releasePointerCapture(ev.pointerId); }catch(err){}
    if (!shouldFire) return;
    _lastTouchActionAt = Date.now();
    try{ ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); }catch(err){}
    setTimeout(()=>{ try{ onTap(ev); }catch(err){} }, delay);
  });

  el.addEventListener('pointercancel', (e)=>{
    if (!down || !e || e.pointerId !== down.id) return;
    clear();
    try{ if (el.releasePointerCapture) el.releasePointerCapture(e.pointerId); }catch(err){}
  });

  el.addEventListener('click', (e)=>{
    if (Date.now() - _lastTouchActionAt < 400) {
      try{ e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); }catch(err){}
    }
  }, true);
}

function _isTouchEnvironment(){
  try{
    const n = navigator;
    if (n && typeof n.maxTouchPoints === 'number' && n.maxTouchPoints > 0) return true;
  }catch(e){}
  try{
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  }catch(e){}
  return false;
}

function _menuDebug(){
  try{
    if (!localStorage || localStorage.getItem('debugMenus') !== '1') return;
  }catch(e){ return; }
  try{ console.debug('[menu]', ...arguments); }catch(e){}
}

/**
 * 通知主进程切换批注窗口的“鼠标穿透/转发”策略。
 * @param {boolean} ignore - 是否忽略鼠标（穿透到下层窗口）
 * @param {boolean} forward - 是否转发（由主进程实现的转发策略）
 * @returns {void}
 */
function sendIgnoreMouse(ignore, forward){
  try{
    if (!window.electronAPI || typeof window.electronAPI.sendToMain !== 'function') return;
    _lastIgnoreMouse = { ignore: !!ignore, forward: !!forward, at: Date.now() };
    _menuDebug('overlay', 'ignore-mouse', { ignore: !!ignore, forward: !!forward, mode: _appMode });
    window.electronAPI.sendToMain('overlay:set-ignore-mouse', { ignore: !!ignore, forward: !!forward });
  }catch(e){}
}

/**
 * 向主进程同步“可交互区域矩形列表”，用于批注窗口的点击命中与穿透裁剪。
 * @param {Array<{left:number,top:number,width:number,height:number}>} rects - 可交互矩形
 * @returns {void}
 */
function sendInteractiveRects(rects){
  try{
    if (!window.electronAPI || typeof window.electronAPI.sendToMain !== 'function') return;
    _menuDebug('overlay', 'interactive-rects', { count: Array.isArray(rects) ? rects.length : 0 });
    window.electronAPI.sendToMain('overlay:set-interactive-rects', { rects: Array.isArray(rects) ? rects : [] });
  }catch(e){}
}

/**
 * 收集当前界面中需要“接收鼠标事件”的元素矩形。
 * @returns {Array<{left:number,top:number,width:number,height:number}>}
 *
 * 业务含义：
 * - 批注模式下，画布区域默认允许穿透以便操作底层应用
 * - 工具栏/子菜单/弹窗等 UI 区域应当接收鼠标，否则无法交互
 *
 * 流程图（收集交互矩形）：
 * 1. pushEl：对单个元素做 getBoundingClientRect，并过滤 0 尺寸
 * 2. 将浮动工具栏、已打开子菜单、识别 UI、设置弹窗、页工具栏加入列表
 * 3. 返回矩形数组给主进程
 */
function collectInteractiveRects(){
  const rects = [];
  const pushEl = (el)=>{
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, r.width || 0);
    const h = Math.max(0, r.height || 0);
    if (w <= 0 || h <= 0) return;
    rects.push({ left: r.left, top: r.top, width: w, height: h });
  };

  pushEl(document.querySelector('.floating-panel'));
  document.querySelectorAll('.submenu.open').forEach(pushEl);
  document.querySelectorAll('.recognition-ui.open').forEach(pushEl);
  document.querySelectorAll('.settings-modal.open').forEach(pushEl);
  pushEl(document.getElementById('pageToolbar'));
  return rects;
}

/**
 * 在批注模式下，按帧合并一次“交互矩形同步”，避免频繁 reflow 与 IPC 泛洪。
 * @returns {void}
 */
function scheduleInteractiveRectsUpdate(){
  if (_appMode !== APP_MODES.ANNOTATION) return;
  if (_interactiveRectsRaf) return;
  _interactiveRectsRaf = requestAnimationFrame(()=>{
    _interactiveRectsRaf = 0;
    sendInteractiveRects(collectInteractiveRects());
  });
}

function flushInteractiveRects(){
  if (_appMode !== APP_MODES.ANNOTATION) return;
  try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
}

function _setRectWatchdog(on){
  const next = !!on;
  if (next) {
    if (_rectWatchdogTimer) return;
    _rectWatchdogTimer = setInterval(() => {
      try{
        if (_appMode !== APP_MODES.ANNOTATION) return;
        const pointerActive = !!(pointerTool && pointerTool.classList.contains('active'));
        if (!pointerActive) return;
        sendInteractiveRects(collectInteractiveRects());
      }catch(e){}
    }, 200);
    return;
  }
  if (_rectWatchdogTimer) {
    try{ clearInterval(_rectWatchdogTimer); }catch(e){}
    _rectWatchdogTimer = 0;
  }
}

function updateExitToolUI(){
  if (!exitTool) return;
  if (_appMode === APP_MODES.ANNOTATION) {
    exitTool.title = '进入白板模式';
    exitTool.innerHTML = ENTER_WHITEBOARD_ICON_SVG;
  } else {
    exitTool.title = '进入智能批注模式';
    restoreDefaultIcon(exitTool);
  }
}

function applyWindowInteractivity(){
  const hasOpenUi = !!document.querySelector('.settings-modal.open, .recognition-ui.open, .submenu.open, .mod-overlay.open');
  if (hasOpenUi) {
    _menuDebug('interactivity', 'open-ui');
    sendIgnoreMouse(false, false);
    try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
    _setRectWatchdog(false);
    return;
  }
  if (_appMode === APP_MODES.WHITEBOARD) {
    _menuDebug('interactivity', 'whiteboard');
    sendIgnoreMouse(false, false);
    _setRectWatchdog(false);
    return;
  }
  const pointerActive = !!(pointerTool && pointerTool.classList.contains('active'));
  if (!pointerActive) {
    _menuDebug('interactivity', 'no-pointer');
    sendIgnoreMouse(false, false);
    _setRectWatchdog(false);
    return;
  }
  const recentTouch = (Date.now() - _lastTouchActionAt) < 1500;
  if (recentTouch){
    _menuDebug('interactivity', 'recent-touch-force-interactive');
    sendIgnoreMouse(false, false);
    try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
    _setRectWatchdog(false);
    scheduleInteractiveRectsUpdate();
    return;
  }
  const touchCapable = _isTouchEnvironment();
  const recentMouse = (Date.now() - _lastMouseMoveAt) < 1200;
  if (touchCapable && !recentMouse) {
    _menuDebug('interactivity', 'touch-capable-no-mouse-force-interactive');
    sendIgnoreMouse(false, false);
    try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
    _setRectWatchdog(false);
    scheduleInteractiveRectsUpdate();
    return;
  }
  try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
  _menuDebug('interactivity', 'pointer-ignore');
  sendIgnoreMouse(true, true);
  _setRectWatchdog(true);
  scheduleInteractiveRectsUpdate();
}

function setAppMode(nextMode, opts){
  const m = nextMode === APP_MODES.ANNOTATION ? APP_MODES.ANNOTATION : APP_MODES.WHITEBOARD;
  _appMode = m;
  if (!opts || opts.persist !== false) persistAppMode(_appMode);
  try{ document.body.dataset.appMode = _appMode; }catch(e){}
  try{
    const s = Settings.loadSettings();
    applyModeCanvasBackground(_appMode, s && s.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) });
  }catch(e){}
  updateExitToolUI();
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  try{ Message.emit(EVENTS.APP_MODE_CHANGED, { mode: _appMode }); }catch(e){}
}

class SmartAnnotationController {
  activate(){
    closeAllSubmenus();
    try{ setCanvasMode('annotation'); }catch(e){}
    setErasing(false);
    if (eraserTool) eraserTool.classList.remove('active');
    if (colorTool) colorTool.classList.remove('active');
    if (pointerTool) pointerTool.classList.add('active');
    try{ setViewTransform(1, 0, 0); }catch(e){}
    try{ setInputEnabled(false); }catch(e){}
    try{ Curous.setTransformEnabled(false); }catch(e){}
    try{ Curous.enableSelectionMode(true); }catch(e){}
    try{
      const s = Settings.loadSettings();
      setBrushColor(getPenColorFromSettings(s, 'annotation'));
    }catch(e){}
    updateEraserModeLabel();
    updatePenModeLabel();
    syncToolbarIcons();
    applyWindowInteractivity();
    try{ sendInteractiveRects(collectInteractiveRects()); }catch(e){}
    scheduleInteractiveRectsUpdate();
    try{ setTimeout(()=>{ try{ flushInteractiveRects(); }catch(e){} }, 0); }catch(e){}
  }

  deactivate(){
    closeAllSubmenus();
    setErasing(false);
    if (eraserTool) eraserTool.classList.remove('active');
    if (colorTool) colorTool.classList.remove('active');
  }
}

class WhiteboardController {
  activate(){
    closeAllSubmenus();
    try{ setCanvasMode('whiteboard'); }catch(e){}
    if (pointerTool) pointerTool.classList.remove('active');
    try{ Curous.setTransformEnabled(true); }catch(e){}
    try{ Curous.enableSelectionMode(false); setInputEnabled(true); }catch(e){}
    try{
      const s = Settings.loadSettings();
      setBrushColor(getPenColorFromSettings(s, 'whiteboard'));
    }catch(e){}
    updateEraserModeLabel();
    updatePenModeLabel();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  }

  deactivate(){
    closeAllSubmenus();
  }
}

const _whiteboardController = new WhiteboardController();
const _annotationController = new SmartAnnotationController();
let _activeController = _whiteboardController;

function switchAppMode(nextMode, opts){
  const m = nextMode === APP_MODES.ANNOTATION ? APP_MODES.ANNOTATION : APP_MODES.WHITEBOARD;
  try{ if (_activeController && _activeController.deactivate) _activeController.deactivate(); }catch(e){}
  setAppMode(m, opts);
  _activeController = (m === APP_MODES.ANNOTATION) ? _annotationController : _whiteboardController;
  try{ if (_activeController && _activeController.activate) _activeController.activate(); }catch(e){}
}

function enterAnnotationMode(opts){
  switchAppMode(APP_MODES.ANNOTATION, opts);
}

function enterWhiteboardMode(opts){
  switchAppMode(APP_MODES.WHITEBOARD, opts);
}
try{
  const mo = new MutationObserver(()=>{ scheduleInteractiveRectsUpdate(); });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
}catch(e){}
try{ window.addEventListener('resize', ()=>{ scheduleInteractiveRectsUpdate(); }, { passive: true }); }catch(e){}
try{ window.addEventListener('mousemove', ()=>{ _lastMouseMoveAt = Date.now(); }, { passive: true }); }catch(e){}

try{ window.addEventListener('toolbar:sync', syncToolbarIcons); }catch(e){}

try{
  Message.on(EVENTS.SUBMENU_OPEN, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_CLOSE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_PIN, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_MOVE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.TOOLBAR_MOVE, ()=>{ scheduleInteractiveRectsUpdate(); });
}catch(e){}

if (colorTool) {
  let _lastOpenPenAt = 0;
  const openPen = (ev)=>{
    if (!colorMenu) return;
    const now = Date.now();
    if (now - _lastOpenPenAt < 120) return;
    _lastOpenPenAt = now;
    const wasOpen = !!colorMenu.classList.contains('open');
    const pinned = String(colorMenu.dataset && colorMenu.dataset.pinned) === 'true';
    const pointerWasActive = !!(pointerTool && pointerTool.classList.contains('active'));
    try{
      const s = getToolState();
      setBrushColor((s && s.brushColor) || '#000000');
    }catch(e){
      setBrushColor('#000000');
    }
    setErasing(false);
    // when using pen, disable selection mode and enable canvas input
    try{ Curous.enableSelectionMode(false); setInputEnabled(true); }catch(e){}
    if (pointerTool) pointerTool.classList.remove('active');
    if (eraserTool) eraserTool.classList.remove('active');
    applyWindowInteractivity();
    flushInteractiveRects();
    showSubmenu(colorMenu, colorTool);
    const wantOpen = !wasOpen;
    if (wantOpen && !colorMenu.classList.contains('open')) {
      try{
        if (localStorage && localStorage.getItem('debugMenus') === '1') {
          const rects = collectInteractiveRects();
          console.debug('[menu]', 'pen-menu-open-failed', {
            appMode: _appMode,
            pinned,
            pointerWasActive,
            ignoreMouse: _lastIgnoreMouse,
            rectCount: Array.isArray(rects) ? rects.length : 0,
            ariaHidden: colorMenu.getAttribute('aria-hidden'),
            evType: ev && ev.type ? String(ev.type) : ''
          });
        }
      }catch(e){}
    }
    updatePenModeLabel();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  };
  colorTool.addEventListener('click', openPen);
  colorTool.addEventListener('pointerdown', (e)=>{
    try{
      if (!e || e.pointerType === 'touch') return;
      openPen(e);
    }catch(err){}
  });
  bindTouchTap(colorTool, openPen, { delayMs: 20 });
}

if (eraserTool) {
  const openEraser = ()=>{
    if (!eraserMenu) return;
    const closing = eraserMenu.classList.contains('open');
    if (closing) {
      showSubmenu(eraserMenu, eraserTool);
      setErasing(false);
      updateEraserModeLabel();
      syncToolbarIcons();
      applyWindowInteractivity();
      scheduleInteractiveRectsUpdate();
      return;
    }
    setErasing(true);
    try{ Curous.enableSelectionMode(false); setInputEnabled(true); }catch(e){}
    if (pointerTool) pointerTool.classList.remove('active');
    if (colorTool) colorTool.classList.remove('active');
    showSubmenu(eraserMenu, eraserTool);
    updateEraserModeLabel();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  };
  eraserTool.addEventListener('click', openEraser);
  bindTouchTap(eraserTool, openEraser, { delayMs: 20 });
}

if (pointerTool) {
  const togglePointer = ()=>{
    const next = !pointerTool.classList.contains('active');
    if (next) {
      // enable selection mode
      pointerTool.classList.add('active');
      // disable drawing/erasing
      setErasing(false);
      try{ setInputEnabled(false); }catch(e){}
      Curous.enableSelectionMode(true);
    } else {
      pointerTool.classList.remove('active');
      Curous.enableSelectionMode(false);
      try{ setInputEnabled(true); }catch(e){}
    }
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  };
  pointerTool.addEventListener('click', togglePointer);
  bindTouchTap(pointerTool, togglePointer, { delayMs: 20 });
}

if (moreTool) {
  const openMore = ()=>{
    if (!moreMenu) return;
    // 更多菜单不改变画笔/橡皮状态，仅切换子菜单显示
    if (colorTool) colorTool.classList.remove('active');
    if (eraserTool) eraserTool.classList.remove('active');
    showSubmenu(moreMenu, moreTool);
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  };
  moreTool.addEventListener('click', openMore);
  bindTouchTap(moreTool, openMore, { delayMs: 20 });
  // simple action hooks
  const noteExportBtn = document.getElementById('noteExportBtn');
  const noteImportBtn = document.getElementById('noteImportBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const pluginManagerBtn = document.getElementById('pluginManagerBtn');
  const aboutBtn = document.getElementById('aboutBtn');
  const closeWhiteboardBtn = document.getElementById('closeWhiteboardBtn');
  const onNoteExport = async ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{ await startNoteExportFlow(); }catch(e){ try{ showToast('导出失败', 'error'); }catch(err){} }
  };
  const onNoteImport = async ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{ await startNoteImportFlow(); }catch(e){ try{ showToast('导入失败', 'error'); }catch(err){} }
  };
  const onSettings = ()=>{ closeAllSubmenus(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); Message.emit(EVENTS.OPEN_SETTINGS, {}); };
  const onPluginManager = ()=>{ closeAllSubmenus(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); try{ openPluginModal(); }catch(e){} };
  const onAbout = ()=>{ closeAllSubmenus(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); Message.emit(EVENTS.OPEN_ABOUT, {}); };
  const onCloseWhiteboard = ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{
      if (window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
        window.electronAPI.sendToMain('app:close', {});
        return;
      }
    }catch(e){}
    try{ window.close(); }catch(e){}
  };
  if (noteExportBtn) { noteExportBtn.addEventListener('click', onNoteExport); bindTouchTap(noteExportBtn, onNoteExport, { delayMs: 20 }); }
  if (noteImportBtn) { noteImportBtn.addEventListener('click', onNoteImport); bindTouchTap(noteImportBtn, onNoteImport, { delayMs: 20 }); }
  if (settingsBtn) { settingsBtn.addEventListener('click', onSettings); bindTouchTap(settingsBtn, onSettings, { delayMs: 20 }); }
  if (pluginManagerBtn) { pluginManagerBtn.addEventListener('click', onPluginManager); bindTouchTap(pluginManagerBtn, onPluginManager, { delayMs: 20 }); }
  if (aboutBtn) { aboutBtn.addEventListener('click', onAbout); bindTouchTap(aboutBtn, onAbout, { delayMs: 20 }); }
  if (closeWhiteboardBtn) { closeWhiteboardBtn.addEventListener('click', onCloseWhiteboard); bindTouchTap(closeWhiteboardBtn, onCloseWhiteboard, { delayMs: 20 }); }
}

if (exitTool) {
  const toggleMode = ()=>{
    if (_appMode === APP_MODES.WHITEBOARD) enterAnnotationMode();
    else enterWhiteboardMode();
  };
  exitTool.addEventListener('click', toggleMode);
  bindTouchTap(exitTool, toggleMode, { delayMs: 20 });
}

// submenu logic moved to more_decide_windows.js

document.addEventListener('click', (e)=>{ if (e.target.closest && (e.target.closest('.tool') || e.target.closest('.drag-handle'))) return; closeAllSubmenus(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') { closeAllSubmenus(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); } });

// pin button handlers: toggle data-pinned on submenu
// initialize pin handlers from more_decide_windows
initPinHandlers();

// Drag handle: allow floating panel to be moved with shared helper (mouse vs touch/pen)
import { attachDragHelper } from './drag_helper.js';
const panel = document.querySelector('.floating-panel');
const dragHandle = document.getElementById('dragHandle');
if (dragHandle && panel) {
  dragHandle.style.touchAction = 'none';
  const detachPanelDrag = attachDragHelper(dragHandle, panel, {
    threshold: 2,
    clampRect: ()=>({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
    onMove: ({ left, top }) => { try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left, top }); }catch(e){} scheduleInteractiveRectsUpdate(); },
    onEnd: (ev, rect) => { try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left: rect.left, top: rect.top }); }catch(e){} scheduleInteractiveRectsUpdate(); }
  });
}

if (clearBtn) {
  const onClear = ()=>{ clearAll(); setErasing(false); if (eraserTool) eraserTool.classList.remove('active'); updatePenModeLabel(); updateEraserModeLabel(); syncToolbarIcons(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); };
  clearBtn.addEventListener('click', onClear);
  bindTouchTap(clearBtn, onClear, { delayMs: 20 });
}

if (undoBtn) {
  const onUndo = ()=>{ undo(); };
  undoBtn.addEventListener('click', onUndo);
  bindTouchTap(undoBtn, onUndo, { delayMs: 20 });
}
if (redoBtn) {
  const onRedo = ()=>{ redo(); };
  redoBtn.addEventListener('click', onRedo);
  bindTouchTap(redoBtn, onRedo, { delayMs: 20 });
}
document.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))) { e.preventDefault(); redo(); }
});

/**
 * 初始化阶段：同步一次图标与文案，确保 UI 与当前工具状态一致。
 */
updateEraserModeLabel();
updatePenModeLabel();
syncToolbarIcons();
try{
  const bootMode = readPersistedAppMode();
  if (bootMode === APP_MODES.ANNOTATION) enterAnnotationMode({ persist: false });
  else enterWhiteboardMode({ persist: false });
}catch(e){
  enterWhiteboardMode({ persist: false });
}

/**
 * 工具栏折叠/展开逻辑（用于横向收起）。
 *
 * 流程图（折叠状态应用）：
 * 1. 切换 panel 的 collapsed class
 * 2. 将状态写入 localStorage（与 Settings 的持久化并存，用于启动兜底）
 * 3. 触发 resize 以驱动依赖尺寸的布局/观察者逻辑
 * 4. 批注模式下同步交互矩形，避免折叠后命中区域不一致
 */
const settings = Settings.loadSettings();

if (collapseTool && panel) {
  applyCollapsed = function(collapsed){
    try{ if (collapsed) panel.classList.add('collapsed'); else panel.classList.remove('collapsed'); }catch(e){}
    try{ localStorage.setItem('toolbarCollapsed', collapsed ? '1' : '0'); }catch(e){}
    // trigger layout recalculation used by ResizeObserver logic
    window.dispatchEvent(new Event('resize'));
    scheduleInteractiveRectsUpdate();
  };

  const toggleCollapse = ()=>{
    const next = !panel.classList.contains('collapsed');
    applyCollapsed(next);
  };
  collapseTool.addEventListener('click', toggleCollapse);
  bindTouchTap(collapseTool, toggleCollapse, { delayMs: 20 });

  // restore persisted state
  try{
    if (settings && settings.toolbarCollapsed) applyCollapsed(true);
  }catch(e){}
}

// Settings modal wiring
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');
const resetSettingsBtn = document.getElementById('resetSettings');
const optAutoResize = document.getElementById('optAutoResize');
const optCollapsed = document.getElementById('optCollapsed');
const optTheme = document.getElementById('optTheme');
const optTooltips = document.getElementById('optTooltips');
const optMultiTouchPen = document.getElementById('optMultiTouchPen');
const optAnnotationPenColor = document.getElementById('optAnnotationPenColor');
const optSmartInk = document.getElementById('optSmartInk');
const optVisualStyle = document.getElementById('optVisualStyle');
const optCanvasColor = document.getElementById('optCanvasColor');
const keyUndo = document.getElementById('keyUndo');
const keyRedo = document.getElementById('keyRedo');
const previewSettingsBtn = document.getElementById('previewSettings');
const revertPreviewBtn = document.getElementById('revertPreview');
const historyStateDisplay = document.getElementById('historyStateDisplay');

const aboutModal = document.getElementById('aboutModal');
const closeAbout = document.getElementById('closeAbout');

const pluginModal = document.getElementById('pluginModal');
const closePluginModal = document.getElementById('closePluginModal');
const pluginInstallBtn = document.getElementById('pluginInstallBtn');
const pluginRefreshBtn = document.getElementById('pluginRefreshBtn');
const pluginInstallStatus = document.getElementById('pluginInstallStatus');
const pluginInstallProgress = document.getElementById('pluginInstallProgress');
const pluginDropZone = document.getElementById('pluginDropZone');
const pluginList = document.getElementById('pluginList');

let _previewBackup = null;
let _pluginDragId = '';
let _pluginInstallRequestId = '';

function openSettings(){
  if (!settingsModal) return;
  // populate from store
  const s = Settings.loadSettings();
  if (optAutoResize) optAutoResize.checked = !!s.enableAutoResize;
  if (optCollapsed) optCollapsed.checked = !!s.toolbarCollapsed;
  if (optTheme) optTheme.value = s.theme || 'light';
  if (optVisualStyle) optVisualStyle.value = s.visualStyle || 'blur';
  if (optCanvasColor) optCanvasColor.value = s.canvasColor || 'white';
  if (optTooltips) optTooltips.checked = !!s.showTooltips;
  if (optMultiTouchPen) optMultiTouchPen.checked = !!s.multiTouchPen;
  if (optAnnotationPenColor) optAnnotationPenColor.value = String(s.annotationPenColor || '#FF0000');
  if (optSmartInk) optSmartInk.checked = !!s.smartInkRecognition;
  if (keyUndo) keyUndo.value = (s.shortcuts && s.shortcuts.undo) || '';
  if (keyRedo) keyRedo.value = (s.shortcuts && s.shortcuts.redo) || '';
  settingsModal.classList.add('open');
  _menuDebug('modal', 'open', 'settings');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
}

function closeSettingsModal(){
  if (settingsModal) settingsModal.classList.remove('open');
  _menuDebug('modal', 'close', 'settings');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
}

function openAbout(){
  if (!aboutModal) return;
  aboutModal.classList.add('open');
  _menuDebug('modal', 'open', 'about');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
}

function closeAboutModal(){
  if (aboutModal) aboutModal.classList.remove('open');
  _menuDebug('modal', 'close', 'about');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
}

function _invokeMainMessage(channel, data){
  try{
    if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') return Promise.resolve({ success: false, error: 'ipc_unavailable' });
    return window.electronAPI.invokeMain('message', String(channel || ''), data);
  }catch(e){
    return Promise.resolve({ success: false, error: String(e && e.message || e) });
  }
}

function _setPluginStatus(text){
  try{ if (pluginInstallStatus) pluginInstallStatus.textContent = String(text || ''); }catch(e){}
}

function _setPluginProgress(v){
  const n = Number(v || 0);
  try{ if (pluginInstallProgress) pluginInstallProgress.value = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }catch(e){}
}

function _sigBadge(meta){
  const sig = meta && meta.signature ? meta.signature : null;
  if (!sig) return { text: '签名: 未知', cls: 'plugin-sig-warn', warn: '' };
  if (sig.verified) return { text: '签名: 已验证', cls: 'plugin-sig-ok', warn: '' };
  const reason = String(sig.reason || '');
  if (reason === 'unsigned') return { text: '签名: 未签名', cls: 'plugin-sig-warn', warn: '未签名插件存在更高安全风险，请谨慎启用。' };
  if (reason === 'signature_ignored') return { text: '签名: 已忽略', cls: 'plugin-sig-warn', warn: '当前已禁用签名强制校验，插件签名将被忽略，请仅在受控环境中使用。' };
  return { text: '签名: 未通过', cls: 'plugin-sig-bad', warn: '签名验证失败，请勿启用来源不明的插件。' };
}

function _renderPluginItem(pl){
  const id = String(pl && pl.id || '');
  const m = pl && pl.manifest ? pl.manifest : {};
  const name = String(m.name || id);
  const ver = String(m.version || '');
  const author = String(m.author || '');
  const enabled = !!(pl && pl.enabled);
  const perms = Array.isArray(m.permissions) ? m.permissions.map(String).filter(Boolean) : [];
  const meta = pl && pl.meta ? pl.meta : null;
  const sig = _sigBadge(meta);

  const item = document.createElement('div');
  item.className = 'plugin-item';
  item.setAttribute('role', 'listitem');
  item.setAttribute('draggable', 'true');
  item.dataset.id = id;
  item.setAttribute('aria-disabled', enabled ? 'false' : 'true');

  const drag = document.createElement('div');
  drag.className = 'plugin-drag';
  drag.textContent = '⋮';
  drag.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'plugin-title';
  const nameEl = document.createElement('div');
  nameEl.className = 'plugin-name';
  nameEl.textContent = name;
  const verEl = document.createElement('div');
  verEl.className = 'plugin-ver';
  verEl.textContent = ver ? `v${ver}` : '';
  const authorEl = document.createElement('div');
  authorEl.className = 'plugin-author';
  authorEl.textContent = author ? `by ${author}` : '';
  title.appendChild(nameEl);
  if (verEl.textContent) title.appendChild(verEl);
  if (authorEl.textContent) title.appendChild(authorEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'plugin-meta';

  const badges = document.createElement('div');
  badges.className = 'plugin-badges';
  const sigEl = document.createElement('span');
  sigEl.className = `plugin-badge ${sig.cls}`;
  sigEl.textContent = sig.text;
  badges.appendChild(sigEl);
  for (const p of perms) {
    const b = document.createElement('span');
    b.className = 'plugin-badge';
    b.textContent = p;
    badges.appendChild(b);
  }
  metaEl.appendChild(badges);

  const permsLine = document.createElement('div');
  permsLine.textContent = `权限需求：${perms.length ? perms.join(', ') : '无'}`;
  metaEl.appendChild(permsLine);

  if (sig.warn) {
    const warn = document.createElement('div');
    warn.className = 'plugin-warning';
    warn.textContent = sig.warn;
    metaEl.appendChild(warn);
  }

  main.appendChild(title);
  main.appendChild(metaEl);

  const actions = document.createElement('div');
  actions.className = 'plugin-actions';
  const toggle = document.createElement('input');
  toggle.className = 'plugin-toggle';
  toggle.type = 'checkbox';
  toggle.checked = enabled;
  toggle.setAttribute('aria-label', enabled ? '禁用插件' : '启用插件');
  toggle.addEventListener('change', async ()=>{
    toggle.disabled = true;
    try{
      const res = await _invokeMainMessage('mod:enable', { id, enabled: !!toggle.checked });
      if (!res || !res.success) toggle.checked = !toggle.checked;
    }catch(e){
      toggle.checked = !toggle.checked;
    }finally{
      toggle.disabled = false;
      try{ await refreshPluginList({ preserveStatus: true }); }catch(e){}
    }
  });
  actions.appendChild(toggle);

  item.appendChild(drag);
  item.appendChild(main);
  item.appendChild(actions);
  return item;
}

async function refreshPluginList(opts){
  const preserveStatus = !!(opts && opts.preserveStatus);
  if (!preserveStatus) _setPluginStatus('');
  try{
    if (pluginList) pluginList.innerHTML = '';
    const res = await _invokeMainMessage('mod:list', {});
    const items = res && res.success && Array.isArray(res.installed) ? res.installed : [];
    if (!items.length) {
      if (pluginList) {
        const empty = document.createElement('div');
        empty.className = 'plugin-list-hint';
        empty.textContent = '暂无已安装插件';
        pluginList.appendChild(empty);
      }
      return;
    }
    for (const pl of items) {
      const node = _renderPluginItem(pl);
      if (pluginList) pluginList.appendChild(node);
    }
  }catch(e){
    _setPluginStatus('加载插件列表失败');
  }
}

function _persistPluginOrderFromDom(){
  try{
    if (!pluginList) return;
    const order = Array.from(pluginList.querySelectorAll('.plugin-item')).map((n)=>String(n && n.dataset && n.dataset.id || '')).filter(Boolean);
    if (!order.length) return;
    _invokeMainMessage('mod:set-order', { order }).then(()=>{}).catch(()=>{});
  }catch(e){}
}

function _wirePluginDnD(){
  if (!pluginList) return;
  pluginList.addEventListener('dragstart', (e)=>{
    const item = e.target && e.target.closest ? e.target.closest('.plugin-item') : null;
    if (!item) return;
    _pluginDragId = String(item.dataset.id || '');
    try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', _pluginDragId); }catch(err){}
  });
  pluginList.addEventListener('dragover', (e)=>{
    if (!_pluginDragId) return;
    e.preventDefault();
    const over = e.target && e.target.closest ? e.target.closest('.plugin-item') : null;
    const dragging = pluginList.querySelector(`.plugin-item[data-id="${_pluginDragId}"]`);
    if (!dragging) return;
    if (!over || over === dragging) return;
    const rect = over.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    if (before) pluginList.insertBefore(dragging, over);
    else pluginList.insertBefore(dragging, over.nextSibling);
  });
  pluginList.addEventListener('drop', (e)=>{
    if (!_pluginDragId) return;
    e.preventDefault();
    _pluginDragId = '';
    _persistPluginOrderFromDom();
  });
  pluginList.addEventListener('dragend', ()=>{
    if (!_pluginDragId) return;
    _pluginDragId = '';
    _persistPluginOrderFromDom();
  });
}

async function _installPluginFromPath(p){
  const path = String(p || '');
  if (!path) return;
  _pluginInstallRequestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  _setPluginProgress(0);
  _setPluginStatus('开始安装…');
  try{
    const r = await _invokeMainMessage('mod:install', { path, requestId: _pluginInstallRequestId });
    if (!r || !r.success) {
      _setPluginStatus(`安装失败：${r && r.error ? r.error : '未知错误'}`);
      _setPluginProgress(0);
      return;
    }
    _setPluginStatus('安装完成');
    _setPluginProgress(100);
    await refreshPluginList({ preserveStatus: true });
  }catch(e){
    _setPluginStatus('安装失败');
    _setPluginProgress(0);
  }
}

function openPluginModal(){
  if (!pluginModal) return;
  pluginModal.classList.add('open');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  refreshPluginList({ preserveStatus: false });
}

function closePluginModalFn(){ if (pluginModal) pluginModal.classList.remove('open'); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); }

// open when message requested
Message.on(EVENTS.OPEN_SETTINGS, ()=>{ openSettings(); });
Message.on(EVENTS.OPEN_ABOUT, ()=>{ openAbout(); });

if (closeSettings) closeSettings.addEventListener('click', closeSettingsModal);
if (settingsModal) settingsModal.addEventListener('click', (e)=>{ if (e.target.classList && e.target.classList.contains('settings-backdrop')) closeSettingsModal(); });
if (closeAbout) closeAbout.addEventListener('click', closeAboutModal);
if (aboutModal) aboutModal.addEventListener('click', (e)=>{ if (e.target.classList && e.target.classList.contains('settings-backdrop')) closeAboutModal(); });
if (closePluginModal) closePluginModal.addEventListener('click', closePluginModalFn);
if (pluginModal) pluginModal.addEventListener('click', (e)=>{ if (e.target.classList && e.target.classList.contains('settings-backdrop')) closePluginModalFn(); });

if (pluginRefreshBtn) pluginRefreshBtn.addEventListener('click', ()=>{ refreshPluginList({ preserveStatus: false }); });

if (pluginInstallBtn) pluginInstallBtn.addEventListener('click', async ()=>{
  _setPluginStatus('');
  const r = await _invokeMainMessage('mod:open-install-dialog', {});
  if (!r || !r.success) return;
  await _installPluginFromPath(r.path);
});

if (pluginDropZone) {
  pluginDropZone.addEventListener('click', async ()=>{
    _setPluginStatus('');
    const r = await _invokeMainMessage('mod:open-install-dialog', {});
    if (!r || !r.success) return;
    await _installPluginFromPath(r.path);
  });
  pluginDropZone.addEventListener('dragenter', (e)=>{ e.preventDefault(); try{ pluginDropZone.classList.add('dragover'); }catch(err){} });
  pluginDropZone.addEventListener('dragover', (e)=>{ e.preventDefault(); try{ pluginDropZone.classList.add('dragover'); }catch(err){} });
  pluginDropZone.addEventListener('dragleave', ()=>{ try{ pluginDropZone.classList.remove('dragover'); }catch(err){} });
  pluginDropZone.addEventListener('drop', async (e)=>{
    e.preventDefault();
    try{ pluginDropZone.classList.remove('dragover'); }catch(err){}
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
    const fp = f && (f.path || '');
    if (!fp) { _setPluginStatus('无法读取拖放文件路径'); return; }
    await _installPluginFromPath(fp);
  });
}

try{
  if (window && window.electronAPI && typeof window.electronAPI.onReplyFromMain === 'function') {
    window.electronAPI.onReplyFromMain('mod:install-progress', (payload)=>{
      try{
        const p = payload && typeof payload === 'object' ? payload : {};
        const rid = String(p.requestId || '');
        if (!_pluginInstallRequestId || rid !== _pluginInstallRequestId) return;
        const percent = Number(p.percent || 0);
        _setPluginProgress(percent);
        const stage = String(p.stage || '');
        if (stage === 'error') {
          _setPluginStatus(`安装失败：${p.error ? String(p.error) : '未知错误'}`);
        } else if (stage === 'done') {
          _setPluginStatus('安装完成');
        } else if (stage) {
          _setPluginStatus(`安装中：${stage}`);
        }
      }catch(e){}
    });
  }
}catch(e){}

_wirePluginDnD();

if (saveSettings) saveSettings.addEventListener('click', ()=>{
  const newS = {
    enableAutoResize: !!(optAutoResize && optAutoResize.checked),
    toolbarCollapsed: !!(optCollapsed && optCollapsed.checked),
    theme: (optTheme && optTheme.value) || 'light',
    visualStyle: (optVisualStyle && optVisualStyle.value) || 'blur',
    canvasColor: (optCanvasColor && optCanvasColor.value) || 'white',
    showTooltips: !!(optTooltips && optTooltips.checked),
    multiTouchPen: !!(optMultiTouchPen && optMultiTouchPen.checked),
    annotationPenColor: String((optAnnotationPenColor && optAnnotationPenColor.value) || '#FF0000').toUpperCase(),
    smartInkRecognition: !!(optSmartInk && optSmartInk.checked),
    shortcuts: { undo: (keyUndo && keyUndo.value) || '', redo: (keyRedo && keyRedo.value) || '' }
  };
  // persist via cross-module helper which emits SETTINGS_CHANGED
  const merged = updateAppSettings(newS);
  // apply immediate effects
  if (!newS.enableAutoResize) {
    try{ const p = document.querySelector('.floating-panel'); if (p) p.style.width = ''; }catch(e){}
  } else { window.dispatchEvent(new Event('resize')); }
  applyCollapsed(newS.toolbarCollapsed);
  // apply theme and tooltips immediately
  applyTheme(newS.theme);
  try{ applyVisualStyle(newS.visualStyle); }catch(e){}
  try{ applyModeCanvasBackground(_appMode, newS.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(merged, mode) }); }catch(e){}
  applyTooltips(newS.showTooltips);
  try{ setMultiTouchPenEnabled(!!newS.multiTouchPen); }catch(e){}
  try{ setInkRecognitionEnabled(!!newS.smartInkRecognition); }catch(e){}
  try{
    if (_appMode === APP_MODES.ANNOTATION) {
      setBrushColor(newS.annotationPenColor);
      updatePenModeLabel();
      syncToolbarIcons();
    }
  }catch(e){}
  closeSettingsModal();
});

if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', ()=>{ Settings.resetSettings(); const s = Settings.loadSettings(); if (optAutoResize) optAutoResize.checked = !!s.enableAutoResize; if (optCollapsed) optCollapsed.checked = !!s.toolbarCollapsed; if (optTheme) optTheme.value = s.theme || 'light'; if (optVisualStyle) optVisualStyle.value = s.visualStyle || 'blur'; if (optCanvasColor) optCanvasColor.value = s.canvasColor || 'white'; if (optTooltips) optTooltips.checked = !!s.showTooltips; if (optMultiTouchPen) optMultiTouchPen.checked = !!s.multiTouchPen; if (optAnnotationPenColor) optAnnotationPenColor.value = String(s.annotationPenColor || '#FF0000'); if (optSmartInk) optSmartInk.checked = !!s.smartInkRecognition; if (keyUndo) keyUndo.value = (s.shortcuts && s.shortcuts.undo) || ''; if (keyRedo) keyRedo.value = (s.shortcuts && s.shortcuts.redo) || ''; try{ setMultiTouchPenEnabled(!!s.multiTouchPen); }catch(e){} try{ setInkRecognitionEnabled(!!s.smartInkRecognition); }catch(e){} try{ if (_appMode === APP_MODES.ANNOTATION) { setBrushColor(String(s.annotationPenColor || '#FF0000').toUpperCase()); updatePenModeLabel(); syncToolbarIcons(); } }catch(e){} });

// apply theme to document body
function applyTheme(name){ try{ document.body.dataset.theme = name; if (name==='dark') document.documentElement.classList.add('theme-dark'); else document.documentElement.classList.remove('theme-dark'); }catch(e){} }

// apply tooltips: preserve original title in data-orig-title
function applyTooltips(show){ try{
  document.querySelectorAll('.tool-btn, .mode-btn, .submenu-drag-handle, .submenu-pin, button').forEach(el=>{
    if (!el.dataset.origTitle) el.dataset.origTitle = el.getAttribute('title') || '';
    if (show) el.setAttribute('title', el.dataset.origTitle || ''); else el.setAttribute('title','');
  });
}catch(e){} }

// apply visual style variants: 'solid' | 'blur' | 'transparent'
function applyVisualStyle(style){
  try{
    const root = document.documentElement;
    ['visual-solid','visual-blur','visual-transparent'].forEach(c=>root.classList.remove(c));
    if (!style || style === 'blur') root.classList.add('visual-blur');
    else if (style === 'solid') root.classList.add('visual-solid');
    else if (style === 'transparent') root.classList.add('visual-transparent');
  }catch(e){}
}

// preview settings (temporary)
if (previewSettingsBtn) previewSettingsBtn.addEventListener('click', ()=>{
  if (!settingsModal) return;
  const s = Settings.loadSettings();
  // backup only once
  if (!_previewBackup) _previewBackup = Object.assign({}, s);
  const preview = {
    theme: (optTheme && optTheme.value) || s.theme,
    showTooltips: !!(optTooltips && optTooltips.checked),
    visualStyle: (optVisualStyle && optVisualStyle.value) || s.visualStyle,
    canvasColor: (optCanvasColor && optCanvasColor.value) || s.canvasColor
  };
  applyTheme(preview.theme);
  applyTooltips(preview.showTooltips);
  // preview visual style
  try{ if (preview.visualStyle) applyVisualStyle(preview.visualStyle); }catch(e){}
  // preview canvas color
  try{ if (preview.canvasColor) applyModeCanvasBackground(_appMode, preview.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) }); }catch(e){}
});

if (revertPreviewBtn) revertPreviewBtn.addEventListener('click', ()=>{
  if (_previewBackup) {
    applyTheme(_previewBackup.theme);
    applyTooltips(_previewBackup.showTooltips);
    try{ applyVisualStyle(_previewBackup.visualStyle || 'blur'); }catch(e){}
    try{ applyModeCanvasBackground(_appMode, _previewBackup.canvasColor || 'white', { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(_previewBackup, mode) }); }catch(e){}
    _previewBackup = null;
  }
});

// listen for history changes to update UI
Message.on(EVENTS.HISTORY_CHANGED, (st)=>{
  try{
    const canU = st && st.canUndo; const canR = st && st.canRedo;
    if (undoBtn) undoBtn.disabled = !canU;
    if (redoBtn) redoBtn.disabled = !canR;
    if (historyStateDisplay) historyStateDisplay.textContent = `撤销: ${canU? '可' : '—'}  重做: ${canR? '可' : '—'}`;
  }catch(e){}
});

// toast notification helper
function _ensureToast(){
  let t = document.querySelector('.app-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'app-toast';
    document.body.appendChild(t);
  }
  return t;
}

function showToast(msg, type='success', ms=2500){
  const t = _ensureToast();
  t.textContent = msg;
  t.classList.remove('success','error');
  t.classList.add(type);
  // force reflow then show
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(t._hideT);
  t._hideT = setTimeout(()=>{ t.classList.remove('show'); }, ms);
}

let _noteIOModal = null;
let _noteIOTitleEl = null;
let _noteIOStatusEl = null;
let _noteIOProgressEl = null;
let _noteIOFooterEl = null;
let _noteIOResolve = null;
let _noteIORequestId = '';

function _ensureNoteIOModal(){
  if (_noteIOModal) return _noteIOModal;
  const modal = document.createElement('div');
  modal.className = 'settings-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');

  const backdrop = document.createElement('div');
  backdrop.className = 'settings-backdrop';

  const panel = document.createElement('div');
  panel.className = 'settings-panel';

  const header = document.createElement('div');
  header.className = 'settings-header';
  _noteIOTitleEl = document.createElement('h3');
  _noteIOTitleEl.textContent = '笔记管理';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tool-btn';
  closeBtn.textContent = '✕';

  header.appendChild(_noteIOTitleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'settings-body';
  _noteIOStatusEl = document.createElement('div');
  _noteIOStatusEl.style.whiteSpace = 'pre-wrap';
  _noteIOStatusEl.style.color = '#444';

  _noteIOProgressEl = document.createElement('progress');
  _noteIOProgressEl.max = 100;
  _noteIOProgressEl.value = 0;
  _noteIOProgressEl.className = 'plugin-progress';
  _noteIOProgressEl.style.width = '100%';

  body.appendChild(_noteIOStatusEl);
  body.appendChild(_noteIOProgressEl);

  _noteIOFooterEl = document.createElement('div');
  _noteIOFooterEl.className = 'settings-footer';

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(_noteIOFooterEl);

  modal.appendChild(backdrop);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  const close = ()=>{
    try{ modal.classList.remove('open'); }catch(e){}
    try{ modal.setAttribute('aria-hidden', 'true'); }catch(e){}
    const r = _noteIOResolve;
    _noteIOResolve = null;
    if (typeof r === 'function') r(null);
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  };

  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  _noteIOModal = modal;
  return modal;
}

function _noteIOModalSet(title, status, percent){
  const modal = _ensureNoteIOModal();
  if (_noteIOTitleEl) _noteIOTitleEl.textContent = String(title || '笔记管理');
  if (_noteIOStatusEl) _noteIOStatusEl.textContent = String(status || '');
  const p = Number(percent || 0);
  if (_noteIOProgressEl) _noteIOProgressEl.value = Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
  try{ modal.classList.add('open'); }catch(e){}
  try{ modal.setAttribute('aria-hidden', 'false'); }catch(e){}
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
}

function _noteIOModalSetActions(actions){
  _ensureNoteIOModal();
  if (!_noteIOFooterEl) return;
  _noteIOFooterEl.innerHTML = '';
  const list = Array.isArray(actions) ? actions : [];
  for (const a of list) {
    const id = a && a.id ? String(a.id) : '';
    const text = a && a.text ? String(a.text) : '';
    if (!id || !text) continue;
    const btn = document.createElement('button');
    btn.className = 'mode-btn';
    btn.textContent = text;
    btn.addEventListener('click', ()=>{
      const r = _noteIOResolve;
      _noteIOResolve = null;
      if (typeof r === 'function') r(id);
    });
    _noteIOFooterEl.appendChild(btn);
  }
}

function showNoteConfirm(opts){
  const o = (opts && typeof opts === 'object') ? opts : {};
  _noteIOModalSet(o.title || '确认', o.message || '', 0);
  if (_noteIOProgressEl) _noteIOProgressEl.style.display = 'none';
  _noteIOModalSetActions(o.actions || [{ id: 'ok', text: '确定' }, { id: 'cancel', text: '取消' }]);
  return new Promise((resolve)=>{
    _noteIOResolve = (v)=>{
      try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
      applyWindowInteractivity();
      scheduleInteractiveRectsUpdate();
      resolve(v);
    };
  });
}

function showNoteProgress(title, status, percent){
  _noteIOModalSet(title || '处理中', status || '', percent || 0);
  if (_noteIOProgressEl) _noteIOProgressEl.style.display = '';
  if (_noteIOFooterEl) _noteIOFooterEl.innerHTML = '';
}

async function startNoteExportFlow(){
  const pick = await showNoteConfirm({
    title: '导出笔记',
    message: '将当前笔记与历史记录导出为 .cubenote 文件。',
    actions: [{ id: 'export', text: '导出' }, { id: 'cancel', text: '取消' }]
  });
  if (pick !== 'export') return;

  showNoteProgress('导出笔记', '选择保存位置…', 0);
  const r = await _invokeMainMessage('note:open-export-dialog', {});
  if (!r || !r.success || !r.path) {
    try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    showToast('已取消导出', 'success');
    return;
  }

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  _noteIORequestId = requestId;
  showNoteProgress('导出笔记', '准备导出…', 10);
  const state = getCubenoteState();
  const res = await _invokeMainMessage('note:export-cubenote', { path: String(r.path), state, requestId });
  _noteIORequestId = '';
  try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  if (res && res.success) showToast('导出完成', 'success');
  else showToast(`导出失败：${res && (res.error || res.reason) ? String(res.error || res.reason) : '未知错误'}`, 'error', 3200);
}

async function startNoteImportFlow(){
  showNoteProgress('导入笔记', '选择要导入的 .cubenote…', 0);
  const r = await _invokeMainMessage('note:open-import-dialog', {});
  if (!r || !r.success || !r.path) {
    try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    showToast('已取消导入', 'success');
    return;
  }

  const choice = await showNoteConfirm({
    title: '导入方式',
    message: '选择冲突处理方式：覆盖将替换当前笔记与历史记录；合并将把导入内容追加到当前页面。',
    actions: [{ id: 'overwrite', text: '覆盖' }, { id: 'merge', text: '合并' }, { id: 'cancel', text: '取消' }]
  });
  if (choice !== 'overwrite' && choice !== 'merge') {
    try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    return;
  }
  if (choice === 'overwrite') {
    const c2 = await showNoteConfirm({
      title: '二次确认',
      message: '覆盖导入会丢失当前笔记的撤销/重做历史，是否继续？',
      actions: [{ id: 'continue', text: '继续' }, { id: 'cancel', text: '取消' }]
    });
    if (c2 !== 'continue') return;
  }

  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  _noteIORequestId = requestId;
  showNoteProgress('导入笔记', '读取文件…', 10);
  const res = await _invokeMainMessage('note:import-cubenote', { path: String(r.path), requestId });
  _noteIORequestId = '';
  if (!res || !res.success || !res.state) {
    try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    showToast(`导入失败：${res && (res.error || res.reason) ? String(res.error || res.reason) : '未知错误'}`, 'error', 3200);
    return;
  }
  try{
    applyCubenoteState(res.state, { conflict: choice });
  }catch(e){
    try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(err){}
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    showToast('导入失败：数据应用失败', 'error', 3200);
    return;
  }
  try{ if (_noteIOModal) { _noteIOModal.classList.remove('open'); _noteIOModal.setAttribute('aria-hidden','true'); } }catch(e){}
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  showToast('导入完成', 'success');
}

try{
  if (window && window.electronAPI && typeof window.electronAPI.onReplyFromMain === 'function') {
    window.electronAPI.onReplyFromMain('note:io-progress', (payload)=>{
      try{
        const p = payload && typeof payload === 'object' ? payload : {};
        const rid = String(p.requestId || '');
        if (!_noteIORequestId || rid !== _noteIORequestId) return;
        const title = p.type === 'import' ? '导入笔记' : '导出笔记';
        const stage = p.stage ? String(p.stage) : '';
        const percent = Number(p.percent || 0);
        showNoteProgress(title, stage, percent);
      }catch(e){}
    });
  }
}catch(e){}

// Show file write results forwarded from main via ipc_bridge
Message.on('io:request-file-write:result', (res)=>{
  try{
    if (!res) { showToast('写入失败 (未知错误)', 'error'); return; }
    if (res.success) showToast(`写入成功： ${res.path || ''}`, 'success');
    else showToast(`写入失败： ${res.error || res.message || '未知'}`, 'error');
  }catch(e){ showToast('写入结果处理错误', 'error'); }
});

// Shortcut binding: parse simple shortcut like 'Ctrl+Z' or 'Ctrl+Shift+Z'
let _shortcutHandler = null;
function parseShortcut(str){
  if (!str || typeof str !== 'string') return null;
  // support multiple alternatives with '|' e.g. 'Ctrl+Z|Cmd+Z'
  const altStrs = str.split('|').map(s=>s.trim()).filter(Boolean);
  const parseOne = (s)=>{
    const parts = s.split('+').map(s=>s.trim().toLowerCase());
    const obj = { ctrl:false, shift:false, alt:false, meta:false, key: null };
    parts.forEach(p=>{
      if (p==='ctrl' || p==='control') obj.ctrl = true;
      else if (p==='cmd' || p==='meta') obj.meta = true;
      else if (p==='shift') obj.shift = true;
      else if (p==='alt' || p==='option') obj.alt = true;
      else obj.key = p;
    });
    return obj.key ? obj : null;
  };
  const specs = altStrs.map(parseOne).filter(Boolean);
  if (specs.length === 0) return null;
  return specs.length === 1 ? specs[0] : specs;
}

function matchShortcut(ev, spec){
  if (!spec) return false;
  const key = (ev.key || '').toLowerCase();
  const checkSpec = (s)=>{
    if (!s) return false;
    if (s.key) {
      // normalize common names
      const k = s.key.toLowerCase();
      if (k.length === 1) { if (key !== k) return false; }
      else {
        // named key like enter, escape, arrowup
        if (key !== k) return false;
      }
    }
    if (!!ev.ctrlKey !== !!s.ctrl) return false;
    if (!!ev.metaKey !== !!s.meta) return false;
    if (!!ev.shiftKey !== !!s.shift) return false;
    if (!!ev.altKey !== !!s.alt) return false;
    return true;
  };
  if (Array.isArray(spec)) {
    return spec.some(s => checkSpec(s));
  }
  return checkSpec(spec);
}

function bindShortcutsFromSettings(){
  try{
    const s = Settings.loadSettings();
    const specUndo = parseShortcut((s.shortcuts && s.shortcuts.undo) || 'ctrl+z');
    const specRedo = parseShortcut((s.shortcuts && s.shortcuts.redo) || 'ctrl+y');
    if (_shortcutHandler) document.removeEventListener('keydown', _shortcutHandler);
    _shortcutHandler = (e)=>{
      if (matchShortcut(e, specUndo)) { e.preventDefault(); undo(); }
      else if (matchShortcut(e, specRedo)) { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', _shortcutHandler);
  }catch(e){ console.warn('bindShortcuts failed', e); }
}

// initial bind
bindShortcutsFromSettings();
// rebind on settings change and apply visual style
Message.on(EVENTS.SETTINGS_CHANGED, (s)=>{ try{ bindShortcutsFromSettings(); if (s && s.visualStyle) applyVisualStyle(s.visualStyle); if (s && s.canvasColor) applyModeCanvasBackground(_appMode, s.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) }); if (s && typeof s.multiTouchPen !== 'undefined') setMultiTouchPenEnabled(!!s.multiTouchPen); if (s && typeof s.smartInkRecognition !== 'undefined') setInkRecognitionEnabled(!!s.smartInkRecognition); }catch(e){} });

// initialize undo/redo button states now (renderer may have emitted before listener attached)
try{ if (undoBtn) undoBtn.disabled = !canUndo(); if (redoBtn) redoBtn.disabled = !canRedo(); if (historyStateDisplay) historyStateDisplay.textContent = `撤销: ${canUndo()? '可' : '—'}  重做: ${canRedo()? '可' : '—'}`; }catch(e){}

// apply persisted theme/tooltips on startup
try{
  if (settings) { if (settings.theme) applyTheme(settings.theme); if (typeof settings.showTooltips !== 'undefined') applyTooltips(!!settings.showTooltips); }
}catch(e){}
try{ if (settings) { if (settings.visualStyle) applyVisualStyle(settings.visualStyle); else applyVisualStyle('blur'); } }catch(e){}
try{ if (settings) { applyModeCanvasBackground(_appMode, settings.canvasColor || 'white', { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(settings, mode) }); } }catch(e){}
try{ if (settings && typeof settings.multiTouchPen !== 'undefined') setMultiTouchPenEnabled(!!settings.multiTouchPen); }catch(e){}
try{ if (settings && typeof settings.smartInkRecognition !== 'undefined') setInkRecognitionEnabled(!!settings.smartInkRecognition); }catch(e){}

// Auto-adjust floating panel width based on tools content
(() => {
  const panel = document.querySelector('.floating-panel');
  if (!panel) return;
  const toolsSection = panel.querySelector('.panel-section.tools');
  const H_PADDING = 24; // panel horizontal padding (12px left + 12px right)
  const MIN_W = 64;
  const MAX_W = Math.max(220, window.innerWidth - 40);

  function applyWidth(w){
    const width = Math.max(MIN_W, Math.min(MAX_W, Math.round(w + H_PADDING)));
    panel.style.width = width + 'px';
  }

  function recalc(){
    try{
      if (!toolsSection) { applyWidth(MIN_W); return; }
      // measure natural content width
      const rect = toolsSection.getBoundingClientRect();
      applyWidth(rect.width);
    }catch(e){}
  }

  // Observe size changes of the tools container
  try{
    const ro = new ResizeObserver(recalc);
    if (toolsSection) ro.observe(toolsSection);
    // also observe panel (in case of style changes)
    ro.observe(panel);
    // respond to DOM mutations (buttons added/removed)
    const mo = new MutationObserver(recalc);
    if (toolsSection) mo.observe(toolsSection, { childList: true, subtree: true, attributes: true });
    window.addEventListener('resize', recalc);
    // initial calculation
    setTimeout(recalc, 16);
  }catch(e){/* fail silently if ResizeObserver not available */}
})();
