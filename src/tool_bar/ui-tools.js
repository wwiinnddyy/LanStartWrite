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
import { clearAll, undo, redo, setBrushColor, setErasing, canUndo, canRedo, replaceStrokeColors, getToolState, setInputEnabled, setMultiTouchPenEnabled, setInkRecognitionEnabled, setViewTransform, setCanvasMode, getCubenoteState, applyCubenoteState, setViewRotation } from '../renderer.js';
import Curous from '../whiteboard/curous.js';
import Settings, { getPenColorFromSettings, normalizeHexColor } from '../setting.js';
import { showSubmenu, cleanupMenuStyles, initPinHandlers, closeAllSubmenus } from './more_decide_windows.js';
import Message, { EVENTS } from '../message.js';
import { updateAppSettings, installHyperOs3Controls, loadSettingsHistory, clearSettingsHistory, undoSettingsHistoryEntry, undoSettingsHistoryBatch } from '../write_a_change.js';
import { initPenUI, updatePenModeLabel } from './pen.js';
import { initEraserUI, updateEraserModeLabel } from './erese.js';
import VideoBoothUI from '../video_booth/video_booth_ui.js';
import ButtonBox from './button_box.js';
import { initAppCase } from '../app_case.js';
import { applyModeCanvasBackground } from '../mode_background.js';
import { buildPenTailSegment, normalizePenTailSettings } from '../pen_tail.js';
import { applyThemeMode, initThemeAutoSync, buildContrastReport, measureApplyCost, serializeLanTheme, parseLanTheme } from '../colors_features.js';
import OperarPenetration from '../smart_screenik/Operar_Penetration.js';

let _isToolbarWindow = false;
let _submenuWindowKind = '';
try{
  const params = new URLSearchParams(location.search || '');
  _isToolbarWindow = params.get('toolbarWindow') === '1';
  _submenuWindowKind = params.get('submenuWindow') || '';
}catch(e){}

try{ installHyperOs3Controls(document); }catch(e){}

const colorTool = document.getElementById('colorTool');
const pointerTool = document.getElementById('pointerTool');
const colorMenu = document.getElementById('colorMenu');
const eraserTool = document.getElementById('eraserTool');
const eraserMenu = document.getElementById('eraserMenu');
const featureLibraryTool = document.getElementById('featureLibraryTool');
const moreTool = document.getElementById('moreTool');
const moreMenu = document.getElementById('moreMenu');
const videoBoothTool = document.getElementById('videoBoothTool');
const clearBtn = document.getElementById('clear');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const collapseTool = document.getElementById('collapseTool');
const exitTool = document.getElementById('exitTool');

let _pointerSelectedInUse = false;
let _penetrationMonitorTimer = 0;
let _penetrationPrevStateJson = '';

function setPointerSelectedInUse(on){
  _pointerSelectedInUse = !!on;
  try{
    if (pointerTool) {
      if (_pointerSelectedInUse) {
        pointerTool.dataset.selectedInUse = '1';
        if (!pointerTool.classList.contains('active')) pointerTool.classList.add('active');
      } else {
        if (pointerTool.dataset) delete pointerTool.dataset.selectedInUse;
        pointerTool.classList.remove('active');
      }
    }
  }catch(e){}
}

let _videoBoothInstance = null;

function _getPointerBtn(){
  try{
    if (pointerTool && pointerTool instanceof HTMLElement) return pointerTool;
    const el = document.getElementById('pointerTool');
    return el || null;
  }catch(e){
    return null;
  }
}

function _readPenetrationButtonState(){
  const btn = _getPointerBtn();
  const exists = !!btn;
  const active = !!(btn && btn.classList && btn.classList.contains('active'));
  const selectedInUse = active;
  let disabled = false;
  let ariaDisabled = false;
  let hover = false;
  try{ disabled = !!(btn && (btn.disabled === true || btn.getAttribute('disabled') === 'true')); }catch(e){}
  try{ ariaDisabled = !!(btn && String(btn.getAttribute('aria-disabled') || '') === 'true'); }catch(e){}
  try{ hover = !!(btn && btn.matches && btn.matches(':hover')); }catch(e){}
  return { exists, active, selectedInUse, disabled, ariaDisabled, hover, ts: Date.now() };
}

function _emitPenetrationStateChanged(state){
  try{ Message.emit(EVENTS.PENETRATION_BUTTON_STATE_CHANGED, state); }catch(e){}
}

function _logPenetrationState(state){
  try{
    const payload = { ts: Number(state && state.ts) || Date.now(), state };
    if (window && window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
      window.electronAPI.sendToMain('monitor:penetration-button-state', payload);
      return;
    }
  }catch(e){}
  try{ console.debug('[penetration-monitor]', state); }catch(e){}
}

function startPenetrationButtonMonitor(){
  if (_penetrationMonitorTimer) return;
  const tick = ()=>{
    let state = null;
    try{
      state = _readPenetrationButtonState();
      const json = JSON.stringify(state);
      if (json !== _penetrationPrevStateJson) {
        _penetrationPrevStateJson = json;
        _emitPenetrationStateChanged(state);
        _logPenetrationState(state);
      }
    }catch(e){}
  };
  try{ tick(); }catch(e){}
  _penetrationMonitorTimer = setInterval(()=>{ try{ tick(); }catch(e){} }, 1000);
  try{ window.addEventListener('beforeunload', ()=>{ try{ if (_penetrationMonitorTimer) clearInterval(_penetrationMonitorTimer); }catch(e){} _penetrationMonitorTimer = 0; }); }catch(e){}
}

// initialize pen and eraser UI modules
initPenUI();
initEraserUI();

function registerCoreToolbarButtons(){
  const items = [
    { id: 'core:pointer', el: pointerTool },
    { id: 'core:pen', el: colorTool },
    { id: 'core:eraser', el: eraserTool },
    { id: 'core:video-booth', el: videoBoothTool },
    { id: 'core:mode-toggle', el: exitTool },
    { id: 'core:feature-library', el: featureLibraryTool },
    { id: 'core:more', el: moreTool },
    { id: 'core:collapse', el: collapseTool },
    { id: 'core:undo', el: undoBtn },
    { id: 'core:redo', el: redoBtn }
  ];
  for (const item of items) {
    const el = item.el;
    if (!el) continue;
    const title = String(el.getAttribute('aria-label') || el.getAttribute('title') || '');
    const iconSvg = String(el.innerHTML || '');
    const def = ButtonBox.registerButton({
      id: item.id,
      title,
      iconSvg,
      kind: 'toolbar',
      source: 'core'
    });
    if (!def) continue;
    ButtonBox.registerInstance(def.id, el, 'toolbar');
  }

  // Register default layout template
  ButtonBox.registerLayoutTemplate('default', {
    order: [
      'core:pointer',
      'core:pen',
      'core:eraser',
      'core:video-booth',
      'core:mode-toggle',
      'core:feature-library',
      'core:more',
      'core:collapse',
      'core:undo',
      'core:redo'
    ],
    hidden: []
  });
}

registerCoreToolbarButtons();

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

  if (videoBoothTool) {
    if (_videoBoothInstance && _videoBoothInstance.isVisible()) {
      videoBoothTool.classList.add('active');
    } else {
      videoBoothTool.classList.remove('active');
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
let applyCollapsed = ()=>{};
let _pdfMode = false;

let _penetration = null;
if (_isToolbarWindow) {
  const stub = {
    _lastTouchActionAt: 0,
    recordPointerInput(){},
    markTouchAction(){
      this._lastTouchActionAt = Date.now();
    },
    shouldSuppressClick(){
      return Date.now() - (this._lastTouchActionAt || 0) < 400;
    },
    forceReleaseTouchUiBlock(){},
    sendIgnoreMouse(){},
    sendInteractiveRects(){},
    collectInteractiveRects(){
      return [];
    },
    scheduleInteractiveRectsUpdate(){},
    flushInteractiveRects(){},
    applyWindowInteractivity(){},
    applyWindowInteractivityNow(){},
    getLastIgnoreMouse(){
      return { ignore: false, forward: false, at: Date.now() };
    }
  };
  _penetration = stub;
} else {
  _penetration = new OperarPenetration({
    appModes: APP_MODES,
    getAppMode: () => _appMode,
    isPointerActive: () => !!(pointerTool && pointerTool.classList.contains('active')),
    debug: (...args) => { try { _menuDebug(...args); } catch (e) {} },
    sendToMain: (channel, payload) => {
      try {
        if (window && window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
          window.electronAPI.sendToMain(channel, payload);
        }
      } catch (e) {}
    }
  });
  try{ _penetration.bindGlobalListeners(); }catch(e){}
}

function setPdfMode(on){
  _pdfMode = !!on;
  try{
    const b = document.body;
    if (!b) return;
    if (_pdfMode) b.dataset.pdfMode = '1';
    else if (b.dataset) delete b.dataset.pdfMode;
  }catch(e){}
  updateExitToolUI();
}

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
  const delayMs = (opts && typeof opts.delayMs === 'number') ? Math.max(0, opts.delayMs) : 0;
  const moveThreshold = (opts && typeof opts.moveThreshold === 'number') ? Math.max(0, opts.moveThreshold) : 8;
  let down = null;
  let moved = false;
  const usePointerEvents = typeof window !== 'undefined' && !!window.PointerEvent;

  function clear(){
    down = null;
    moved = false;
  }

  const getTouchPoint = (e)=>{
    const list = (e && e.changedTouches) ? e.changedTouches : null;
    if (!list || typeof list.length !== 'number') return null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      if (!down || t.identifier === down.id) return t;
    }
    return null;
  };

  if (usePointerEvents) {
    el.addEventListener('pointerdown', (e)=>{
      if (!e || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
      _penetration.recordPointerInput(e.pointerType);
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
      _penetration.markTouchAction();
      try{ ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); }catch(err){}
      if (delay <= 0) {
        try{ onTap(ev); }catch(err){}
      } else {
        setTimeout(()=>{ try{ onTap(ev); }catch(err){} }, delay);
      }
    });

    el.addEventListener('pointercancel', (e)=>{
      if (!down || !e || e.pointerId !== down.id) return;
      clear();
      try{ if (el.releasePointerCapture) el.releasePointerCapture(e.pointerId); }catch(err){}
    });
  } else {
    el.addEventListener('touchstart', (e)=>{
      const t = (e && e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
      if (!t) return;
      _penetration.recordPointerInput('touch');
      down = { id: t.identifier, x: t.clientX, y: t.clientY, t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
      moved = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e)=>{
      if (!down) return;
      const t = getTouchPoint(e);
      if (!t) return;
      const dx = (t.clientX - down.x);
      const dy = (t.clientY - down.y);
      if ((dx*dx + dy*dy) > (moveThreshold*moveThreshold)) moved = true;
    }, { passive: true });

    el.addEventListener('touchend', (e)=>{
      if (!down) return;
      const t = getTouchPoint(e);
      if (!t) return;
      const tUp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const elapsed = tUp - down.t;
      const shouldFire = !moved;
      const delay = Math.max(0, delayMs - elapsed);
      const ev = e;
      clear();
      if (!shouldFire) return;
      _penetration.markTouchAction();
      try{ ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); }catch(err){}
      if (delay <= 0) {
        try{ onTap(ev); }catch(err){}
      } else {
        setTimeout(()=>{ try{ onTap(ev); }catch(err){} }, delay);
      }
    }, { passive: false });

    el.addEventListener('touchcancel', (e)=>{
      if (!down) return;
      const t = getTouchPoint(e);
      if (!t) return;
      clear();
    });
  }

  el.addEventListener('click', (e)=>{
    if (_penetration.shouldSuppressClick()) {
      try{ e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); }catch(err){}
    }
  }, true);
}

function _forceReleaseTouchUiBlock(){
  try{ _penetration.forceReleaseTouchUiBlock(); }catch(e){}
}

function sendIgnoreMouse(ignore, forward){
  try{ _penetration.sendIgnoreMouse(ignore, forward); }catch(e){}
}

function sendInteractiveRects(rects){
  try{ _penetration.sendInteractiveRects(rects); }catch(e){}
}

function collectInteractiveRects(force = false){
  try{ return _penetration.collectInteractiveRects(force); }catch(e){}
  return [];
}

function scheduleInteractiveRectsUpdate(){
  try{ _penetration.scheduleInteractiveRectsUpdate(); }catch(e){}
}

function flushInteractiveRects(){
  try{ _penetration.flushInteractiveRects(); }catch(e){}
}

function applyWindowInteractivity(forceIgnore){
  try{ _penetration.applyWindowInteractivity(forceIgnore); }catch(e){}
}

function applyWindowInteractivityNow(forceIgnore){
  try{ _penetration.applyWindowInteractivityNow(forceIgnore); }catch(e){}
}

function _menuDebug(){
  try{
    if (!localStorage || localStorage.getItem('debugMenus') !== '1') return;
  }catch(e){ return; }
  try{ console.debug('[menu]', ...arguments); }catch(e){}
}

let _IS_RUN_TESTS = false;
try{
  const p = new URLSearchParams(location.search || '');
  _IS_RUN_TESTS = p.get('runTests') === '1';
}catch(e){}

function openSettingsWindow(){
  if (_IS_RUN_TESTS) return false;
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
      window.electronAPI.invokeMain('message', 'ui:open-settings-window', {});
      return true;
    }
  }catch(e){}
  return false;
}

function openAboutWindow(){
  if (_IS_RUN_TESTS) return false;
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
      window.electronAPI.invokeMain('message', 'ui:open-about-window', {});
      return true;
    }
  }catch(e){}
  return false;
}

function openNoteManagerWindow(){
  if (_IS_RUN_TESTS) return false;
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
      window.electronAPI.invokeMain('message', 'ui:open-note-manager-window', {});
      return true;
    }
  }catch(e){}
  return false;
}


function updateExitToolUI(){
  if (!exitTool) return;
  if (_appMode === APP_MODES.ANNOTATION) {
    exitTool.title = _pdfMode ? '返回白板（退出 PDF 批注）' : '进入白板模式';
    exitTool.innerHTML = ENTER_WHITEBOARD_ICON_SVG;
  } else {
    exitTool.title = '进入智能批注模式';
    restoreDefaultIcon(exitTool);
  }
}


function setAppMode(nextMode, opts){
  const m = nextMode === APP_MODES.ANNOTATION ? APP_MODES.ANNOTATION : APP_MODES.WHITEBOARD;
  const domMode = (()=>{ try{ return String(document.body && document.body.dataset ? (document.body.dataset.appMode || '') : ''); }catch(e){ return ''; } })();
  if (_appMode === m && domMode === m) return;
  
  try {
    document.body.classList.add('mode-switching');
  } catch (e) {}

  const changed = _appMode !== m;
  _appMode = m;
  if (changed && (!opts || opts.persist !== false)) persistAppMode(_appMode);
  try{ document.body.dataset.appMode = _appMode; }catch(e){}
  try{
    const s = Settings.loadSettings();
    applyModeCanvasBackground(_appMode, s && s.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) });
  }catch(e){}
  updateExitToolUI();
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  if (changed) {
    try{ Message.emit(EVENTS.APP_MODE_CHANGED, { mode: _appMode }); }catch(e){}
  }

  setTimeout(() => {
    try {
      document.body.classList.remove('mode-switching');
      // For automated performance testing: notify when switch is complete
      if (window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
        window.electronAPI.sendToMain('tests:mode-switch-done', { mode: _appMode, ts: Date.now() });
      }
    } catch (e) {}
  }, 160);
}

class SmartAnnotationController {
  activate(){
    closeAllSubmenus();
    try{ setCanvasMode('annotation'); }catch(e){}
    setErasing(false);
    if (eraserTool) eraserTool.classList.remove('active');
    if (colorTool) colorTool.classList.remove('active');
    if (pointerTool) pointerTool.classList.add('active');
    setPointerSelectedInUse(true);
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
    applyWindowInteractivityNow();
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
    setPointerSelectedInUse(false);
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
    
    // Ensure no scrollbars
    try {
      const board = document.getElementById('board');
      if (board) {
        board.scrollLeft = 0;
        board.scrollTop = 0;
        board.style.overflow = 'hidden';
      }
      document.body.style.overflow = 'hidden';
    } catch(e) {}
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
  setPdfMode(false);
  switchAppMode(APP_MODES.WHITEBOARD, opts);
}
try{
  const mo = new MutationObserver(()=>{ scheduleInteractiveRectsUpdate(); });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
}catch(e){}
try{ window.addEventListener('resize', ()=>{ scheduleInteractiveRectsUpdate(); }, { passive: true }); }catch(e){}

try{ window.addEventListener('toolbar:sync', syncToolbarIcons); }catch(e){}

try{
  Message.on(EVENTS.SUBMENU_OPEN, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_CLOSE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_PIN, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_MOVE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.TOOLBAR_MOVE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
}catch(e){}

if (colorTool) {
  let _lastOpenPenAt = 0;
  const openPen = (ev)=>{
    const now = Date.now();
    if (now - _lastOpenPenAt < 120) return;
    _lastOpenPenAt = now;
    try{
      const s = getToolState();
      setBrushColor((s && s.brushColor) || '#000000');
    }catch(e){
      setBrushColor('#000000');
    }
    setErasing(false);
    try{ Curous.enableSelectionMode(false); setInputEnabled(true); }catch(e){}
    if (pointerTool) pointerTool.classList.remove('active');
    setPointerSelectedInUse(false);
    if (eraserTool) eraserTool.classList.remove('active');
    _forceReleaseTouchUiBlock();
    applyWindowInteractivityNow(true);
    try{ flushInteractiveRects(); }catch(e){}
    if (_isToolbarWindow) {
      try{
        const rect = colorTool && colorTool.getBoundingClientRect ? colorTool.getBoundingClientRect() : null;
        const anchor = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
        _invokeMainMessage('ui:open-submenu-window', { kind: 'color', anchor }).then(()=>{}).catch(()=>{});
      }catch(e){}
    } else {
      if (!colorMenu) return;
      const wasOpen = !!colorMenu.classList.contains('open');
      const pinned = String(colorMenu.dataset && colorMenu.dataset.pinned) === 'true';
      const pointerWasActive = !!(pointerTool && pointerTool.classList.contains('active'));
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
              ignoreMouse: _penetration.getLastIgnoreMouse(),
              rectCount: Array.isArray(rects) ? rects.length : 0,
              ariaHidden: colorMenu.getAttribute('aria-hidden'),
              evType: ev && ev.type ? String(ev.type) : ''
            });
          }
        }catch(e){}
      }
    }
    updatePenModeLabel();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivityNow(true);
    scheduleInteractiveRectsUpdate();
  };
  colorTool.addEventListener('click', openPen);
  colorTool.addEventListener('mousedown', (e)=>{ try{ openPen(e); }catch(err){} });
  bindTouchTap(colorTool, openPen, { delayMs: 0 });
}

if (eraserTool) {
  const openEraser = ()=>{
    if (!_isToolbarWindow && !eraserMenu) return;
    const closing = !_isToolbarWindow && eraserMenu && eraserMenu.classList.contains('open');
    if (closing) {
      if (_isToolbarWindow) {
        try{ _invokeMainMessage('ui:close-submenu-window', { kind: 'eraser' }).then(()=>{}).catch(()=>{}); }catch(e){}
      } else {
        showSubmenu(eraserMenu, eraserTool);
      }
      setErasing(false);
      updateEraserModeLabel();
      syncToolbarIcons();
      _forceReleaseTouchUiBlock();
      applyWindowInteractivityNow(true);
      scheduleInteractiveRectsUpdate();
      return;
    }
    setErasing(true);
    try{ Curous.enableSelectionMode(false); setInputEnabled(true); }catch(e){}
    if (pointerTool) pointerTool.classList.remove('active');
    setPointerSelectedInUse(false);
    if (colorTool) colorTool.classList.remove('active');
    if (_isToolbarWindow) {
      try{
        const rect = eraserTool && eraserTool.getBoundingClientRect ? eraserTool.getBoundingClientRect() : null;
        const anchor = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
        _invokeMainMessage('ui:open-submenu-window', { kind: 'eraser', anchor }).then(()=>{}).catch(()=>{});
      }catch(e){}
    } else {
      showSubmenu(eraserMenu, eraserTool);
    }
    updateEraserModeLabel();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivityNow(true);
    scheduleInteractiveRectsUpdate();
  };
  eraserTool.addEventListener('click', openEraser);
  bindTouchTap(eraserTool, openEraser, { delayMs: 0 });
}

if (featureLibraryTool) {
  const openFeatureLibrary = ()=>{
    const btn = document.getElementById('appCaseResourceBtn');
    if (btn) {
      btn.click();
      return;
    }
    const menu = document.getElementById('moreMenu');
    const opener = document.getElementById('moreTool');
    if (!menu || !opener) return;
    showSubmenu(menu, opener);
  };
  featureLibraryTool.addEventListener('click', openFeatureLibrary);
  bindTouchTap(featureLibraryTool, openFeatureLibrary, { delayMs: 0 });
}

const toggleVideoBooth = async () => {
  if (!_videoBoothInstance) {
    _videoBoothInstance = new VideoBoothUI();
  }
  const isVisible = _videoBoothInstance.isVisible();
  if (isVisible) {
    _videoBoothInstance.hide();
  } else {
    await _videoBoothInstance.show();
  }
  syncToolbarIcons();
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
};

// Listen for global toggle event
Message.on(EVENTS.TOGGLE_VIDEO_BOOTH, toggleVideoBooth);

if (videoBoothTool) {
  videoBoothTool.addEventListener('click', toggleVideoBooth);
  bindTouchTap(videoBoothTool, toggleVideoBooth, { delayMs: 0 });
}

if (pointerTool) {
  const togglePointer = ()=>{
    const next = !pointerTool.classList.contains('active');
    if (next) {
      // enable selection mode
      pointerTool.classList.add('active');
      setPointerSelectedInUse(true);
      // disable drawing/erasing
      setErasing(false);
      try{ setInputEnabled(false); }catch(e){}
      Curous.enableSelectionMode(true);
    } else {
      pointerTool.classList.remove('active');
      setPointerSelectedInUse(false);
      Curous.enableSelectionMode(false);
      try{ setInputEnabled(true); }catch(e){}
    }
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivityNow(true);
    try{ flushInteractiveRects(); }catch(e){}
    scheduleInteractiveRectsUpdate();
  };
  pointerTool.addEventListener('click', togglePointer);
  bindTouchTap(pointerTool, togglePointer, { delayMs: 0 });
}

if (moreTool) {
  const openMore = ()=>{
    if (!_isToolbarWindow && !moreMenu) return;
    if (colorTool) colorTool.classList.remove('active');
    if (eraserTool) eraserTool.classList.remove('active');
    if (_isToolbarWindow) {
      try{
        const rect = moreTool && moreTool.getBoundingClientRect ? moreTool.getBoundingClientRect() : null;
        const anchor = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
        _invokeMainMessage('ui:open-submenu-window', { kind: 'more', anchor }).then(()=>{}).catch(()=>{});
      }catch(e){}
    } else {
      if (!moreMenu) return;
      showSubmenu(moreMenu, moreTool);
    }
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivityNow(true);
    scheduleInteractiveRectsUpdate();
  };
  moreTool.addEventListener('click', openMore);
  bindTouchTap(moreTool, openMore, { delayMs: 0 });
  // simple action hooks
  const noteManagerBtn = document.getElementById('noteManagerBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const pluginManagerBtn = document.getElementById('pluginManagerBtn');
  const aboutBtn = document.getElementById('aboutBtn');
  const restartWhiteboardBtn = document.getElementById('restartWhiteboardBtn');
  const closeWhiteboardBtnSettings = document.getElementById('closeWhiteboardBtnSettings');
  const onNoteExport = async ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{ await startNoteExportFlow(); }catch(e){ try{ showToast('导出失败', 'error'); }catch(err){} }
  };
  const onNoteImport = async ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{ await startNoteImportFlow(); }catch(e){ try{ showToast('导入失败', 'error'); }catch(err){} }
  };
  const onOpenNoteManager = ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivity(true);
    scheduleInteractiveRectsUpdate();
    openNoteManagerWindow();
  };
  const onSettings = ()=>{ closeAllSubmenus(); syncToolbarIcons(); _forceReleaseTouchUiBlock(); applyWindowInteractivity(true); scheduleInteractiveRectsUpdate(); if (!openSettingsWindow()) Message.emit(EVENTS.OPEN_SETTINGS, {}); };
  const onPluginManager = ()=>{ closeAllSubmenus(); syncToolbarIcons(); _forceReleaseTouchUiBlock(); applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); try{ openPluginModal(); }catch(e){} };
  const onAbout = ()=>{ closeAllSubmenus(); syncToolbarIcons(); _forceReleaseTouchUiBlock(); applyWindowInteractivity(true); scheduleInteractiveRectsUpdate(); if (!openAboutWindow()) Message.emit(EVENTS.OPEN_ABOUT, {}); };
  const onRestartWhiteboard = ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
    try{
      // Restart usually means reloading the app to a clean state
      location.reload();
    }catch(e){
      console.error('Failed to restart whiteboard:', e);
    }
  };
  const onCloseWhiteboard = ()=>{
    closeAllSubmenus();
    syncToolbarIcons();
    _forceReleaseTouchUiBlock();
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
  if (noteManagerBtn) { noteManagerBtn.addEventListener('click', onOpenNoteManager); bindTouchTap(noteManagerBtn, onOpenNoteManager, { delayMs: 0 }); }
  if (settingsBtn) { settingsBtn.addEventListener('click', onSettings); bindTouchTap(settingsBtn, onSettings, { delayMs: 0 }); }
  if (pluginManagerBtn) { pluginManagerBtn.addEventListener('click', onPluginManager); bindTouchTap(pluginManagerBtn, onPluginManager, { delayMs: 0 }); }
  if (aboutBtn) { aboutBtn.addEventListener('click', onAbout); bindTouchTap(aboutBtn, onAbout, { delayMs: 0 }); }
  if (restartWhiteboardBtn) { restartWhiteboardBtn.addEventListener('click', onRestartWhiteboard); bindTouchTap(restartWhiteboardBtn, onRestartWhiteboard, { delayMs: 0 }); }
  if (closeWhiteboardBtnSettings) { closeWhiteboardBtnSettings.addEventListener('click', onCloseWhiteboard); bindTouchTap(closeWhiteboardBtnSettings, onCloseWhiteboard, { delayMs: 0 }); }
}

(async () => {
  try {
    await initAppCase();
    // Add scroll prevention watchdog
    const preventScroll = () => {
      try {
        const board = document.getElementById('board');
        if (board && (board.scrollLeft !== 0 || board.scrollTop !== 0)) {
          board.scrollLeft = 0;
          board.scrollTop = 0;
        }
        if (document.body.scrollLeft !== 0 || document.body.scrollTop !== 0) {
          document.body.scrollLeft = 0;
          document.body.scrollTop = 0;
        }
      } catch (e) {}
    };
    window.addEventListener('scroll', preventScroll, { passive: false, capture: true });
    setInterval(preventScroll, 1000);
  } catch (e) {
    console.error('Failed to initialize AppCase:', e);
  }
})();

if (exitTool) {
  const toggleMode = ()=>{
    if (_appMode === APP_MODES.WHITEBOARD) enterAnnotationMode();
    else enterWhiteboardMode();
  };
  exitTool.addEventListener('click', toggleMode);
  bindTouchTap(exitTool, toggleMode, { delayMs: 0 });
}

startPenetrationButtonMonitor();

// submenu logic moved to more_decide_windows.js

document.addEventListener('click', (e)=>{
  if (e.target.closest && (e.target.closest('.tool') || e.target.closest('.drag-handle'))) return;
  if (_isToolbarWindow) {
    try{ _invokeMainMessage('ui:close-submenu-window', {}).then(()=>{}).catch(()=>{}); }catch(err){}
  } else {
    closeAllSubmenus();
  }
  syncToolbarIcons();
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
});
document.addEventListener('keydown', (e)=>{
  if (e.key==='Escape') {
    if (_isToolbarWindow) {
      try{ _invokeMainMessage('ui:close-submenu-window', {}).then(()=>{}).catch(()=>{}); }catch(err){}
    } else {
      closeAllSubmenus();
    }
    syncToolbarIcons();
    applyWindowInteractivity();
    scheduleInteractiveRectsUpdate();
  }
});
try{
  Message.on(EVENTS.SUBMENU_OPEN, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.SUBMENU_CLOSE, ()=>{ applyWindowInteractivity(); scheduleInteractiveRectsUpdate(); });
  Message.on(EVENTS.APP_PREPARE_EXIT, ()=>{
    try {
      document.body.classList.add('hyperos-exit');
    } catch(e) {}
  });
}catch(e){}

// pin button handlers: toggle data-pinned on submenu
// initialize pin handlers from more_decide_windows
initPinHandlers();

// Drag handle: allow floating panel to be moved with shared helper (mouse vs touch/pen)
import { attachDragHelper } from './drag_helper.js';
const panel = document.querySelector('.floating-panel');
const dragHandle = document.getElementById('dragHandle');
const _PIN_TOOLBAR_TO_TASKBAR = true;
const _TOOLBAR_BOOT_DELAY_MS = 120;
const _TOOLBAR_ANIM_DUR_MS = 350;
const _TOOLBAR_GAP_DP = 10;
let _toolbarAnchorTimer = null;
let _toolbarUserMoved = false;
let _toolbarDragPrevTransition = null;

function _getViewportClampRect(){
  try{
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.width) && Number.isFinite(vv.height)) {
      const left = Number(vv.offsetLeft || 0);
      const top = Number(vv.offsetTop || 0);
      return { left, top, right: left + Number(vv.width), bottom: top + Number(vv.height) };
    }
  }catch(e){}
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

function _clampNumber(n, min, max){
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

async function _readTaskbarMetrics(){
  try{
    const res = await _invokeMainMessage('system:get-taskbar-metrics', {});
    if (res && res.success) return res;
  }catch(e){}
  return null;
}

function _calcToolbarAnchoredPosition(panelRect, metrics){
  const gap = _TOOLBAR_GAP_DP;
  const insets = metrics && metrics.insets && typeof metrics.insets === 'object'
    ? metrics.insets
    : { left: 0, top: 0, right: 0, bottom: 0 };
  const taskbar = metrics && metrics.taskbar && typeof metrics.taskbar === 'object'
    ? metrics.taskbar
    : { position: 'bottom', thickness: Number(insets.bottom) || 0 };

  let left = Math.round((window.innerWidth - panelRect.width) / 2);
  let top = Math.round(window.innerHeight - (Number(insets.bottom) || 0) - gap - panelRect.height);

  if (taskbar.position === 'top') top = Math.round((Number(insets.top) || 0) + gap);
  if (taskbar.position === 'left') left = Math.round((Number(insets.left) || 0) + gap);
  if (taskbar.position === 'right') left = Math.round(window.innerWidth - (Number(insets.right) || 0) - gap - panelRect.width);

  left = _clampNumber(left, 0, Math.max(0, window.innerWidth - panelRect.width));
  top = _clampNumber(top, 0, Math.max(0, window.innerHeight - panelRect.height));
  return { left, top };
}

function _applyToolbarFixedPosition(targetPanel, pos){
  if (!targetPanel) return;
  targetPanel.style.position = 'fixed';
  targetPanel.style.left = Math.round(pos.left) + 'px';
  targetPanel.style.top = Math.round(pos.top) + 'px';
  targetPanel.style.right = 'auto';
  targetPanel.style.bottom = 'auto';
}

function _measureElSize(el){
  try{
    if (!el) return { width: 0, height: 0 };
    const w = Number(el.offsetWidth || 0);
    const h = Number(el.offsetHeight || 0);
    if (w > 0 && h > 0) return { width: w, height: h };
    const r = el.getBoundingClientRect();
    return { width: Number(r && r.width || 0), height: Number(r && r.height || 0) };
  }catch(e){
    return { width: 0, height: 0 };
  }
}

function _nudgeToolbarIconsPaint(panel){
  try{
    const svgs = panel ? panel.querySelectorAll('.tool-btn svg') : [];
    for (const svg of svgs) {
      const prev = svg && svg.style ? String(svg.style.transform || '') : '';
      try{ svg.style.transform = prev ? `${prev} translateZ(0)` : 'translateZ(0)'; }catch(e){}
      try{ svg.getBoundingClientRect(); }catch(e){}
      try{ svg.style.transform = prev; }catch(e){}
    }
  }catch(e){}
}

async function _repositionToolbarToTaskbar(targetPanel, opts){
  if (!targetPanel) return;
  if (_toolbarUserMoved) return;
  const rect = _measureElSize(targetPanel);
  const metrics = await _readTaskbarMetrics();
  const pos = _calcToolbarAnchoredPosition(rect, metrics || {});
  if (opts && opts.animate) {
    targetPanel.classList.add('ls-toolbar-enter');
    requestAnimationFrame(() => _applyToolbarFixedPosition(targetPanel, pos));
    setTimeout(() => { try{ targetPanel.classList.remove('ls-toolbar-enter'); }catch(e){} }, _TOOLBAR_ANIM_DUR_MS + 20);
  } else {
    _applyToolbarFixedPosition(targetPanel, pos);
  }
}

function _scheduleToolbarReposition(targetPanel){
  if (_toolbarAnchorTimer) clearTimeout(_toolbarAnchorTimer);
  if (_toolbarUserMoved) return;
  _toolbarAnchorTimer = setTimeout(() => {
    _repositionToolbarToTaskbar(targetPanel, { animate: false });
  }, 60);
}

async function _runToolbarBootAnimation(targetPanel){
  if (!targetPanel) return;
  targetPanel.classList.add('ls-toolbar-ready');
  targetPanel.style.visibility = 'hidden';
  targetPanel.classList.add('ls-toolbar-boot');

  const rect = _measureElSize(targetPanel);
  const startLeft = Math.round((window.innerWidth - rect.width) / 2);
  const startTop = Math.round(window.innerHeight + 24);
  _applyToolbarFixedPosition(targetPanel, { left: startLeft, top: startTop });

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, _TOOLBAR_BOOT_DELAY_MS));
  targetPanel.style.visibility = '';
  await new Promise((r) => requestAnimationFrame(r));
  await _repositionToolbarToTaskbar(targetPanel, { animate: true });
  setTimeout(() => {
    try{ targetPanel.classList.remove('ls-toolbar-boot'); }catch(e){}
    _nudgeToolbarIconsPaint(targetPanel);
  }, _TOOLBAR_ANIM_DUR_MS + 20);
}

if (_PIN_TOOLBAR_TO_TASKBAR && panel) {
  _runToolbarBootAnimation(panel);
  window.addEventListener('resize', () => _scheduleToolbarReposition(panel));
  try{
    if (window.electronAPI && typeof window.electronAPI.onReplyFromMain === 'function') {
      window.electronAPI.onReplyFromMain('system:display-metrics-changed', () => _scheduleToolbarReposition(panel));
    }
  }catch(e){}
}

if (dragHandle && panel) {
  dragHandle.style.touchAction = 'none';
  attachDragHelper(dragHandle, panel, {
    threshold: 2,
    touchThreshold: 5,
    clampRect: _getViewportClampRect,
    onStart: () => {
      _toolbarUserMoved = true;
      if (_toolbarAnchorTimer) {
        try{ clearTimeout(_toolbarAnchorTimer); }catch(e){}
        _toolbarAnchorTimer = null;
      }
      try{ panel.classList.remove('ls-toolbar-enter'); }catch(e){}
      try{ panel.classList.remove('hyperos-entrance'); }catch(e){}
      try{
        const r = panel.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.left = Math.round(r.left) + 'px';
        panel.style.top = Math.round(r.top) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      }catch(e){}
      try{
        _toolbarDragPrevTransition = panel.style.transition;
        panel.style.transition = 'none';
      }catch(e){}
    },
    onMove: ({ left, top }) => { try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left, top }); }catch(e){} scheduleInteractiveRectsUpdate(); },
    onEnd: (ev, rect) => {
      try{
        if (_toolbarDragPrevTransition !== null) panel.style.transition = _toolbarDragPrevTransition;
        else panel.style.transition = '';
      }catch(e){}
      _toolbarDragPrevTransition = null;
      try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left: rect.left, top: rect.top }); }catch(e){}
      applyWindowInteractivity();
      scheduleInteractiveRectsUpdate();
    }
  });
}

if (clearBtn) {
  const onClear = ()=>{ clearAll(); setErasing(false); if (eraserTool) eraserTool.classList.remove('active'); updatePenModeLabel(); updateEraserModeLabel(); syncToolbarIcons(); _forceReleaseTouchUiBlock(); applyWindowInteractivityNow(true); scheduleInteractiveRectsUpdate(); };
  clearBtn.addEventListener('click', onClear);
  bindTouchTap(clearBtn, onClear, { delayMs: 0 });
}

if (undoBtn) {
  const onUndo = ()=>{ undo(); _forceReleaseTouchUiBlock(); applyWindowInteractivityNow(true); scheduleInteractiveRectsUpdate(); };
  undoBtn.addEventListener('click', onUndo);
  bindTouchTap(undoBtn, onUndo, { delayMs: 0 });
}
if (redoBtn) {
  const onRedo = ()=>{ redo(); _forceReleaseTouchUiBlock(); applyWindowInteractivityNow(true); scheduleInteractiveRectsUpdate(); };
  redoBtn.addEventListener('click', onRedo);
  bindTouchTap(redoBtn, onRedo, { delayMs: 0 });
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
  bindTouchTap(collapseTool, toggleCollapse, { delayMs: 0 });

  // restore persisted state
  try{
    if (settings && settings.toolbarCollapsed) applyCollapsed(true);
  }catch(e){}
}

function _getToolbarButtonsForLayout(){
  const p = document.querySelector('.floating-panel');
  if (!p) return [];
  const toolsSection = p.querySelector('.panel-section.tools');
  if (!toolsSection) return [];
  const tools = Array.from(toolsSection.querySelectorAll('.tool'));
  const out = [];
  for (const wrap of tools) {
    if (!(wrap instanceof HTMLElement)) continue;
    const btn = wrap.querySelector('button');
    if (!btn) continue;
    const meta = ButtonBox.getInstance(btn);
    const id = meta && meta.id ? meta.id : (btn.dataset && btn.dataset.buttonId ? String(btn.dataset.buttonId || '') : String(btn.id || ''));
    if (!id) continue;
    out.push({ id: String(id), wrap, btn });
  }
  return out;
}

function applyToolbarLayout(settingsLike){
  try{
    const p = document.querySelector('.floating-panel');
    if (!p) return;
    const toolsSection = p.querySelector('.panel-section.tools');
    if (!toolsSection) return;
    const items = _getToolbarButtonsForLayout();
    if (!items.length) return;
    const byId = new Map();
    for (const it of items) byId.set(it.id, it);
    const s = settingsLike && typeof settingsLike === 'object' ? settingsLike : {};
    const layout = ButtonBox.applyLayoutTemplate('default', items, s);
    const order = Array.isArray(layout && layout.order) ? layout.order : items.map((it)=>it.id);
    const hiddenSet = layout && layout.hiddenSet instanceof Set ? layout.hiddenSet : new Set();
    
    // Core video booth visibility logic
    if (s.hasOwnProperty('videoBoothEnabled')) {
      if (!s.videoBoothEnabled) {
        hiddenSet.add('core:video-booth');
      } else {
        hiddenSet.delete('core:video-booth');
      }
    }

    const frag = document.createDocumentFragment();
    for (const id of order) {
      const it = byId.get(id);
      if (!it) continue;
      const wrap = it.wrap;
      if (!wrap) continue;
      if (hiddenSet.has(id)) {
        try{ wrap.style.display = 'none'; }catch(e){}
      } else {
        try{ wrap.style.display = ''; }catch(e){}
        frag.appendChild(wrap);
      }
    }
    toolsSection.appendChild(frag);
  }catch(e){
    console.error('Failed to apply toolbar layout:', e);
  }
}

// Settings modal wiring
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const saveSettings = document.getElementById('saveSettings');
const resetSettingsBtn = document.getElementById('resetSettings');
const optAutoResize = document.getElementById('optAutoResize');
const optCollapsed = document.getElementById('optCollapsed');
const optTheme = document.getElementById('optTheme');
const optDesignLanguage = document.getElementById('optDesignLanguage');
const optTooltips = document.getElementById('optTooltips');
const optSeparateToolbarWindow = document.getElementById('optSeparateToolbarWindow');
const optVideoBoothEnabled = document.getElementById('optVideoBoothEnabled');
const optPdfDefaultMode = document.getElementById('optPdfDefaultMode');
const optMultiTouchPen = document.getElementById('optMultiTouchPen');
const optPageSwitchDraggable = document.getElementById('optPageSwitchDraggable');
const optOverlayShape = document.getElementById('optOverlayShape');
const optAnnotationPenColor = document.getElementById('optAnnotationPenColor');
const optPenTailEnabled = document.getElementById('optPenTailEnabled');
const optPenTailProfile = document.getElementById('optPenTailProfile');
const optPenTailIntensity = document.getElementById('optPenTailIntensity');
const optPenTailSamplePoints = document.getElementById('optPenTailSamplePoints');
const optPenTailSpeedSensitivity = document.getElementById('optPenTailSpeedSensitivity');
const optPenTailPressureSensitivity = document.getElementById('optPenTailPressureSensitivity');
const optPenTailShape = document.getElementById('optPenTailShape');
const penTailIntensityText = document.getElementById('penTailIntensityText');
const penTailSamplePointsText = document.getElementById('penTailSamplePointsText');
const penTailSpeedText = document.getElementById('penTailSpeedText');
const penTailPressureText = document.getElementById('penTailPressureText');
const penTailPreview = document.getElementById('penTailPreview');
const optSmartInk = document.getElementById('optSmartInk');
const optVisualStyle = document.getElementById('optVisualStyle');
const optMicaIntensity = document.getElementById('optMicaIntensity');
const micaIntensityText = document.getElementById('micaIntensityText');
const optThemePrimary = document.getElementById('optThemePrimary');
const optThemeSecondary = document.getElementById('optThemeSecondary');
const optThemeBackground = document.getElementById('optThemeBackground');
const exportThemeBtn = document.getElementById('exportThemeBtn');
const importThemeBtn = document.getElementById('importThemeBtn');
const resetThemeBtn = document.getElementById('resetThemeBtn');
const themeFileInput = document.getElementById('themeFileInput');
const contrastReportBtn = document.getElementById('contrastReportBtn');
const perfCheckBtn = document.getElementById('perfCheckBtn');
const themeReportOut = document.getElementById('themeReportOut');
const optCanvasColor = document.getElementById('optCanvasColor');
const keyUndo = document.getElementById('keyUndo');
const keyRedo = document.getElementById('keyRedo');
const previewSettingsBtn = document.getElementById('previewSettings');
const revertPreviewBtn = document.getElementById('revertPreview');
const historyStateDisplay = document.getElementById('historyStateDisplay');
const toolbarLayoutList = document.getElementById('toolbarLayoutList');
const toolbarLayoutPreview = document.getElementById('toolbarLayoutPreview');
const toolbarLayoutResetBtn = document.getElementById('toolbarLayoutReset');
const settingsHistoryTimeline = document.getElementById('settingsHistoryTimeline');
const settingsHistoryMeta = document.getElementById('settingsHistoryMeta');
const historyLoadMoreBtn = document.getElementById('historyLoadMoreBtn');
const historySelectAllBtn = document.getElementById('historySelectAllBtn');
const historyUndoSelectedBtn = document.getElementById('historyUndoSelectedBtn');
const historyClearBtn = document.getElementById('historyClearBtn');

const settingsContent = settingsModal ? settingsModal.querySelector('.settings-content') : null;
const settingsLoading = settingsModal ? settingsModal.querySelector('.settings-loading') : null;
const settingsSidebar = settingsModal ? settingsModal.querySelector('.settings-sidebar') : null;
const settingsTabButtons = settingsModal ? Array.from(settingsModal.querySelectorAll('.settings-tab')) : [];
const settingsPages = settingsModal ? Array.from(settingsModal.querySelectorAll('.settings-page')) : [];

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

function _createStore(reducer, initialState){
  let state = initialState;
  const listeners = new Set();
  return {
    getState(){ return state; },
    dispatch(action){
      state = reducer(state, action);
      for (const l of listeners) { try{ l(); }catch(e){} }
      return action;
    },
    subscribe(listener){
      listeners.add(listener);
      return ()=>{ listeners.delete(listener); };
    }
  };
}

const _SETTINGS_TAB_STORAGE_KEY = 'settingsSelectedTab';
function _readPersistedSettingsTab(){
  try{
    const v = localStorage.getItem(_SETTINGS_TAB_STORAGE_KEY);
    return v ? String(v) : '';
  }catch(e){ return ''; }
}

function _writePersistedSettingsTab(tab){
  try{ localStorage.setItem(_SETTINGS_TAB_STORAGE_KEY, String(tab || '')); }catch(e){}
}

function _makeSettingsDraftFromSettings(s){
  const src = (s && typeof s === 'object') ? s : {};
  const undoKey = src.shortcuts && src.shortcuts.undo ? String(src.shortcuts.undo) : '';
  const redoKey = src.shortcuts && src.shortcuts.redo ? String(src.shortcuts.redo) : '';
  const pluginDisplay = src.pluginButtonDisplay && typeof src.pluginButtonDisplay === 'object' && !Array.isArray(src.pluginButtonDisplay)
    ? Object.assign({}, src.pluginButtonDisplay)
    : {};
  return {
    enableAutoResize: !!src.enableAutoResize,
    toolbarCollapsed: !!src.toolbarCollapsed,
    designLanguage: String(src.designLanguage || 'fluent'),
    theme: String(src.theme || 'system'),
    themeCustom: Object.assign({}, (src.themeCustom && typeof src.themeCustom === 'object') ? src.themeCustom : {}),
    visualStyle: String(src.visualStyle || 'blur'),
    mica: Object.assign({}, (src.mica && typeof src.mica === 'object') ? src.mica : {}),
    canvasColor: String(src.canvasColor || 'white'),
    pdfDefaultMode: String(src.pdfDefaultMode || 'window'),
    showTooltips: !!src.showTooltips,
    multiTouchPen: !!src.multiTouchPen,
    overlayShapeEnabled: !!src.overlayShapeEnabled,
    annotationPenColor: normalizeHexColor(src.annotationPenColor, '#FF0000'),
    smartInkRecognition: !!src.smartInkRecognition,
    separateToolbarWindow: !!src.separateToolbarWindow,
    videoBoothEnabled: !!src.videoBoothEnabled,
    penTail: normalizePenTailSettings(src.penTail),
    shortcuts: { undo: undoKey, redo: redoKey },
    toolbarButtonOrder: Array.isArray(src.toolbarButtonOrder) ? src.toolbarButtonOrder.slice() : [],
    toolbarButtonHidden: Array.isArray(src.toolbarButtonHidden) ? src.toolbarButtonHidden.slice() : [],
    pluginButtonDisplay: pluginDisplay
  };
}

function _getFirstSettingsTab(){
  const t = settingsTabButtons && settingsTabButtons[0] ? String(settingsTabButtons[0].dataset.tab || '') : '';
  return t || 'general';
}

function _normalizeSettingsTab(tab){
  const t = String(tab || '');
  if (!t) return _getFirstSettingsTab();
  if (!settingsTabButtons || !settingsTabButtons.length) return t;
  const ok = settingsTabButtons.some(b => String(b.dataset.tab || '') === t);
  return ok ? t : _getFirstSettingsTab();
}

const _settingsLoadedTabs = new Set();
if (settingsPages && settingsPages.length) {
  for (const p of settingsPages) {
    const tab = String(p.dataset.tab || '');
    if (!tab) continue;
    _settingsLoadedTabs.add(tab);
  }
}

const _settingsPageHideTimers = new WeakMap();
function _activateSettingsPage(page){
  if (!page) return;
  const t = _settingsPageHideTimers.get(page);
  if (t) { clearTimeout(t); _settingsPageHideTimers.delete(page); }
  try{ page.hidden = false; }catch(e){}
  try{ page.setAttribute('aria-hidden', 'false'); }catch(e){}
  requestAnimationFrame(()=>{ try{ page.classList.add('active'); }catch(e){} });
}

function _deactivateSettingsPage(page){
  if (!page) return;
  try{ page.classList.remove('active'); }catch(e){}
  try{ page.setAttribute('aria-hidden', 'true'); }catch(e){}
  const timer = setTimeout(()=>{ try{ page.hidden = true; }catch(e){} }, 320);
  _settingsPageHideTimers.set(page, timer);
}

function _setSettingsLoading(loading){
  const on = !!loading;
  try{ if (settingsContent) settingsContent.setAttribute('aria-busy', on ? 'true' : 'false'); }catch(e){}
  try{
    if (settingsLoading) {
      if (on) { settingsLoading.hidden = false; settingsLoading.setAttribute('aria-hidden', 'false'); }
      else { settingsLoading.hidden = true; settingsLoading.setAttribute('aria-hidden', 'true'); }
    }
  }catch(e){}
}

function _loadSettingsTabAsync(tab){
  const t = String(tab || '');
  if (!t) return Promise.resolve();
  if (_settingsLoadedTabs.has(t)) return Promise.resolve();
  _setSettingsLoading(true);
  return new Promise((resolve)=>{
    setTimeout(()=>{
      _settingsLoadedTabs.add(t);
      _setSettingsLoading(false);
      resolve();
    }, 80);
  });
}

function _validateSettingsDraft(d){
  const draft = d && typeof d === 'object' ? d : {};
  const theme = String(draft.theme || '');
  const designLanguage = String(draft.designLanguage || '');
  const visualStyle = String(draft.visualStyle || '');
  const canvasColor = String(draft.canvasColor || '');
  const pdfDefaultMode = String(draft.pdfDefaultMode || '');
  const undoKey = draft.shortcuts && typeof draft.shortcuts.undo === 'string' ? draft.shortcuts.undo.trim() : '';
  const redoKey = draft.shortcuts && typeof draft.shortcuts.redo === 'string' ? draft.shortcuts.redo.trim() : '';

  if (!['system','light','dark','high-contrast','custom'].includes(theme)) return { ok: false, message: '主题值无效', focusId: 'optTheme' };
  if (!['fluent','material3'].includes(designLanguage)) return { ok: false, message: '界面风格值无效', focusId: 'optDesignLanguage' };
  if (!['solid','blur','transparent'].includes(visualStyle)) return { ok: false, message: '视觉效果值无效', focusId: 'optVisualStyle' };
  if (!['white','black','chalkboard'].includes(canvasColor)) return { ok: false, message: '画布颜色值无效', focusId: 'optCanvasColor' };
  if (!['window','fullscreen'].includes(pdfDefaultMode)) return { ok: false, message: 'PDF默认打开模式值无效', focusId: 'optPdfDefaultMode' };

  const mica = (draft.mica && typeof draft.mica === 'object') ? draft.mica : {};
  const intensity = Number(mica.intensity);
  if (Number.isFinite(intensity) && (intensity < 0 || intensity > 100)) return { ok: false, message: '云母强度无效', focusId: 'optMicaIntensity' };

  const tc = (draft.themeCustom && typeof draft.themeCustom === 'object') ? draft.themeCustom : {};
  const p1 = normalizeHexColor(tc.primary, '#2B7CFF');
  if (tc.primary && p1 !== String(tc.primary || '').toUpperCase()) return { ok: false, message: 'Primary 颜色无效', focusId: 'optThemePrimary' };
  const p2 = normalizeHexColor(tc.secondary, '#535F70');
  if (tc.secondary && p2 !== String(tc.secondary || '').toUpperCase()) return { ok: false, message: 'Secondary 颜色无效', focusId: 'optThemeSecondary' };
  const p3 = normalizeHexColor(tc.background, '#FFFFFF');
  if (tc.background && p3 !== String(tc.background || '').toUpperCase()) return { ok: false, message: '背景颜色无效', focusId: 'optThemeBackground' };

  const pen = normalizeHexColor(draft.annotationPenColor, '#FF0000');
  if (pen !== String(draft.annotationPenColor || '').toUpperCase()) return { ok: false, message: '批注默认笔颜色无效', focusId: 'optAnnotationPenColor' };

  if (undoKey && undoKey.length > 20) return { ok: false, message: '撤销快捷键过长', focusId: 'keyUndo' };
  if (redoKey && redoKey.length > 20) return { ok: false, message: '重做快捷键过长', focusId: 'keyRedo' };
  if (undoKey && redoKey && undoKey.toLowerCase() === redoKey.toLowerCase()) return { ok: false, message: '撤销与重做快捷键不能相同', focusId: 'keyRedo' };

  const pt = normalizePenTailSettings(draft.penTail);
  if (!['standard','calligraphy','speed'].includes(String(pt.profile || 'standard'))) return { ok: false, message: '笔锋预设值无效', focusId: 'optPenTailProfile' };
  if (!(pt.intensity >= 0 && pt.intensity <= 100)) return { ok: false, message: '笔锋强度无效', focusId: 'optPenTailIntensity' };
  if (!(pt.samplePoints >= 5 && pt.samplePoints <= 20)) return { ok: false, message: '采样点数量无效', focusId: 'optPenTailSamplePoints' };
  if (!(pt.speedSensitivity >= 0 && pt.speedSensitivity <= 200)) return { ok: false, message: '速度敏感度无效', focusId: 'optPenTailSpeedSensitivity' };
  if (!(pt.pressureSensitivity >= 0 && pt.pressureSensitivity <= 200)) return { ok: false, message: '压力敏感度无效', focusId: 'optPenTailPressureSensitivity' };
  if (!['sharp','round','natural','custom'].includes(String(pt.shape || 'natural'))) return { ok: false, message: '笔锋形状无效', focusId: 'optPenTailShape' };

  return { ok: true };
}

function _settingsUiReducer(state, action){
  const s = state && typeof state === 'object' ? state : {};
  const a = action && typeof action === 'object' ? action : {};
  if (a.type === 'OPEN') {
    const settings = a.settings || Settings.loadSettings();
    const preferredTab = _normalizeSettingsTab(_readPersistedSettingsTab() || _getFirstSettingsTab());
    return Object.assign({}, s, { isOpen: true, selectedTab: preferredTab, draft: _makeSettingsDraftFromSettings(settings) });
  }
  if (a.type === 'CLOSE') return Object.assign({}, s, { isOpen: false });
  if (a.type === 'SET_TAB') {
    const tab = _normalizeSettingsTab(a.tab);
    _writePersistedSettingsTab(tab);
    return Object.assign({}, s, { selectedTab: tab });
  }
  if (a.type === 'SET_DRAFT') {
    return Object.assign({}, s, { draft: _makeSettingsDraftFromSettings(a.settings || Settings.loadSettings()) });
  }
  if (a.type === 'UPDATE_FIELD') {
    const key = String(a.key || '');
    const next = Object.assign({}, s.draft || {});
    if (key === 'shortcuts.undo' || key === 'shortcuts.redo') {
      const k = key.endsWith('undo') ? 'undo' : 'redo';
      next.shortcuts = Object.assign({}, next.shortcuts || {}, { [k]: String(a.value || '') });
    } else if (key.startsWith('penTail.')) {
      const sub = key.slice('penTail.'.length);
      const cur = normalizePenTailSettings(next.penTail);
      if (sub === 'profile') {
        const prof = String(a.value || 'standard');
        next.penTail = normalizePenTailSettings({ enabled: cur.enabled, profile: prof });
      } else {
        const patch = Object.assign({}, cur);
        if (sub === 'enabled') patch.enabled = !!a.value;
        else if (sub === 'intensity') patch.intensity = Number(a.value);
        else if (sub === 'samplePoints') patch.samplePoints = Number(a.value);
        else if (sub === 'speedSensitivity') patch.speedSensitivity = Number(a.value);
        else if (sub === 'pressureSensitivity') patch.pressureSensitivity = Number(a.value);
        else if (sub === 'shape') patch.shape = String(a.value || '');
        next.penTail = normalizePenTailSettings(patch);
      }
    } else if (key === 'pluginButtonDisplay') {
      const obj = a.value && typeof a.value === 'object' && !Array.isArray(a.value) ? a.value : {};
      next.pluginButtonDisplay = Object.assign({}, obj);
    } else if (key.startsWith('themeCustom.')) {
      const sub = key.slice('themeCustom.'.length);
      const cur = (next.themeCustom && typeof next.themeCustom === 'object') ? next.themeCustom : {};
      next.themeCustom = Object.assign({}, cur, { [sub]: normalizeHexColor(a.value, cur[sub]) });
    } else if (key.startsWith('mica.')) {
      const sub = key.slice('mica.'.length);
      const cur = (next.mica && typeof next.mica === 'object') ? next.mica : {};
      if (sub === 'intensity') next.mica = Object.assign({}, cur, { intensity: Number(a.value) });
      else next.mica = Object.assign({}, cur, { [sub]: a.value });
    } else if (key) {
      next[key] = a.value;
    }
    return Object.assign({}, s, { draft: next });
  }
  return s;
}

const _settingsUiStore = _createStore(_settingsUiReducer, {
  isOpen: false,
  selectedTab: _normalizeSettingsTab(_readPersistedSettingsTab() || _getFirstSettingsTab()),
  draft: _makeSettingsDraftFromSettings(Settings.loadSettings())
});

let _settingsUiSyncing = false;
function _renderSettingsUi(){
  const st = _settingsUiStore.getState();
  const sel = st && st.selectedTab ? String(st.selectedTab) : _getFirstSettingsTab();

  if (settingsTabButtons && settingsTabButtons.length) {
    for (const btn of settingsTabButtons) {
      const t = String(btn.dataset.tab || '');
      const active = t === sel;
      try{ btn.setAttribute('aria-selected', active ? 'true' : 'false'); }catch(e){}
      try{ btn.tabIndex = active ? 0 : -1; }catch(e){}
    }
  }

  if (settingsPages && settingsPages.length) {
    for (const p of settingsPages) {
      const t = String(p.dataset.tab || '');
      if (!t) continue;
      if (t === sel) _activateSettingsPage(p);
      else _deactivateSettingsPage(p);
    }
  }

  const d = st && st.draft ? st.draft : {};
  _settingsUiSyncing = true;
  try{
    if (optAutoResize) optAutoResize.checked = !!d.enableAutoResize;
    if (optCollapsed) optCollapsed.checked = !!d.toolbarCollapsed;
    if (optTheme) optTheme.value = d.theme || 'system';
    if (optDesignLanguage) optDesignLanguage.value = d.designLanguage || 'fluent';
    if (optVisualStyle) optVisualStyle.value = d.visualStyle || 'blur';
    const mica = (d.mica && typeof d.mica === 'object') ? d.mica : {};
    const intensity = Number.isFinite(Number(mica.intensity)) ? Math.max(0, Math.min(100, Number(mica.intensity))) : 60;
    if (optMicaIntensity) optMicaIntensity.value = String(intensity);
    try{ if (micaIntensityText) micaIntensityText.textContent = `${intensity}%`; }catch(e){}
    const tc = (d.themeCustom && typeof d.themeCustom === 'object') ? d.themeCustom : {};
    if (optThemePrimary) optThemePrimary.value = normalizeHexColor(tc.primary, '#2B7CFF');
    if (optThemeSecondary) optThemeSecondary.value = normalizeHexColor(tc.secondary, '#535F70');
    if (optThemeBackground) optThemeBackground.value = normalizeHexColor(tc.background, '#FFFFFF');
    if (optCanvasColor) optCanvasColor.value = d.canvasColor || 'white';
    if (optTooltips) optTooltips.checked = !!d.showTooltips;
    if (optSeparateToolbarWindow) optSeparateToolbarWindow.checked = !!d.separateToolbarWindow;
    if (optVideoBoothEnabled) optVideoBoothEnabled.checked = !!d.videoBoothEnabled;
    if (optMultiTouchPen) optMultiTouchPen.checked = !!d.multiTouchPen;
    if (optAnnotationPenColor) optAnnotationPenColor.value = normalizeHexColor(d.annotationPenColor, '#FF0000');
    if (optSmartInk) optSmartInk.checked = !!d.smartInkRecognition;
    if (optPdfDefaultMode) optPdfDefaultMode.value = d.pdfDefaultMode || 'window';
    const pt = normalizePenTailSettings(d.penTail);
    if (optPenTailEnabled) optPenTailEnabled.checked = !!pt.enabled;
    if (optPenTailProfile) optPenTailProfile.value = String(pt.profile || 'standard');
    if (optPenTailIntensity) optPenTailIntensity.value = String(pt.intensity);
    if (optPenTailSamplePoints) optPenTailSamplePoints.value = String(pt.samplePoints);
    if (optPenTailSpeedSensitivity) optPenTailSpeedSensitivity.value = String(pt.speedSensitivity);
    if (optPenTailPressureSensitivity) optPenTailPressureSensitivity.value = String(pt.pressureSensitivity);
    if (optPenTailShape) optPenTailShape.value = String(pt.shape || 'natural');
    try{ if (penTailIntensityText) penTailIntensityText.textContent = `${pt.intensity}%`; }catch(e){}
    try{ if (penTailSamplePointsText) penTailSamplePointsText.textContent = `${pt.samplePoints}`; }catch(e){}
    try{ if (penTailSpeedText) penTailSpeedText.textContent = `${pt.speedSensitivity}%`; }catch(e){}
    try{ if (penTailPressureText) penTailPressureText.textContent = `${pt.pressureSensitivity}%`; }catch(e){}
    if (keyUndo) keyUndo.value = d.shortcuts && typeof d.shortcuts.undo === 'string' ? d.shortcuts.undo : '';
    if (keyRedo) keyRedo.value = d.shortcuts && typeof d.shortcuts.redo === 'string' ? d.shortcuts.redo : '';
  }catch(e){}
  _settingsUiSyncing = false;
  try{ _schedulePenTailPreviewRender(normalizePenTailSettings(d.penTail)); }catch(e){}
}

let _penTailPreviewRaf = 0;
let _penTailPreviewLastCfg = null;
function _schedulePenTailPreviewRender(cfg){
  _penTailPreviewLastCfg = cfg;
  if (_penTailPreviewRaf) return;
  _penTailPreviewRaf = requestAnimationFrame(()=>{
    _penTailPreviewRaf = 0;
    _renderPenTailPreview(_penTailPreviewLastCfg);
  });
}

function _renderPenTailPreview(cfg){
  if (!penTailPreview) return;
  const c = normalizePenTailSettings(cfg);
  const ctx = penTailPreview.getContext('2d');
  if (!ctx) return;

  const w = penTailPreview.width || 520;
  const h = penTailPreview.height || 150;
  ctx.clearRect(0, 0, w, h);

  const baseSize = 6;
  const pts = [];
  const t0 = 0;
  for (let i = 0; i < 26; i++) {
    const u = i / 25;
    const x = 18 + u * (w - 36);
    const y = h * 0.58 + Math.sin(u * Math.PI * 1.3) * (h * 0.18);
    const dt = (i < 12) ? 18 : 8;
    const t = (i === 0) ? t0 : (pts[pts.length - 1].t + dt);
    const p = (i < 14) ? 0.25 + u * 0.55 : 0.65 - (u - 0.5) * 0.5;
    pts.push({ x, y, t, p: Math.max(0.05, Math.min(1, p)) });
  }

  const segRes = buildPenTailSegment(pts, baseSize, c);
  const outPts = segRes && Array.isArray(segRes.segment) ? segRes.segment : pts;

  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < outPts.length; i++) {
    const a = outPts[i - 1];
    const b = outPts[i];
    const lw = Math.max(0.2, Number((a && a.w) || (b && b.w) || baseSize) || baseSize);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function _cloneToolbarPreviewButton(id, src){
  const buttonId = String(id || '');
  if (!buttonId) return null;
  const srcEl = src && src instanceof HTMLElement ? src : null;
  const title = srcEl ? String(srcEl.getAttribute('aria-label') || srcEl.getAttribute('title') || '') : '';
  const meta = srcEl ? ButtonBox.getInstance(srcEl) : null;
  const existing = ButtonBox.getButton(buttonId);
  const def = existing || ButtonBox.registerButton({
    id: buttonId,
    title,
    iconSvg: srcEl ? srcEl.innerHTML || '' : '',
    kind: 'toolbar',
    source: meta && meta.source ? meta.source : 'core'
  });
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

function _renderToolbarLayoutPreview(orderIds, hiddenSet){
  if (!toolbarLayoutPreview) return;
  const items = _getToolbarButtonsForLayout();
  const byId = new Map();
  for (const it of items) byId.set(String(it.id || ''), it.btn);
  toolbarLayoutPreview.innerHTML = '';
  const frag = document.createDocumentFragment();
  const ids = Array.isArray(orderIds) ? orderIds : [];
  for (const rawId of ids) {
    const id = String(rawId || '');
    if (!id) continue;
    const src = byId.get(id);
    if (!src) continue;
    const icon = _cloneToolbarPreviewButton(id, src);
    if (!icon) continue;
    if (hiddenSet && hiddenSet.has(id)) {
      try{ icon.style.opacity = '0.35'; }catch(e){}
    }
    frag.appendChild(icon);
  }
  toolbarLayoutPreview.appendChild(frag);
}

function _renderToolbarLayoutEditor(){
  if (!toolbarLayoutList || !toolbarLayoutPreview) return;
  const items = _getToolbarButtonsForLayout();
  if (!items.length) {
    toolbarLayoutList.innerHTML = '';
    toolbarLayoutPreview.innerHTML = '';
    return;
  }
  const byId = new Map();
  for (const it of items) byId.set(String(it.id || ''), it);
  const st = _settingsUiStore.getState();
  const d = st && st.draft ? st.draft : {};
  const allIds = items.map((it)=>String(it.id || '')).filter(Boolean);
  const layout = ButtonBox.applyLayoutTemplate('default', items, d);
  const order = Array.isArray(layout && layout.order) ? layout.order.filter((id)=>allIds.includes(id)) : allIds;
  const hiddenSet = layout && layout.hiddenSet instanceof Set
    ? new Set(Array.from(layout.hiddenSet).filter((id)=>allIds.includes(id)))
    : new Set();
  toolbarLayoutList.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const id of order) {
    const entry = byId.get(id);
    if (!entry || !entry.btn) continue;
    const src = entry.btn;
    const item = document.createElement('div');
    item.className = 'resource-item';
    item.setAttribute('role', 'listitem');
    item.setAttribute('draggable', 'true');
    item.setAttribute('data-id', id);
    item.setAttribute('aria-grabbed', 'false');
    if (hiddenSet.has(id)) item.classList.add('is-hidden');

    const drag = document.createElement('button');
    drag.className = 'resource-drag';
    drag.type = 'button';
    drag.textContent = '⋮';
    drag.setAttribute('aria-label', '拖动排序');

    const labelEl = document.createElement('div');
    labelEl.className = 'resource-label';
    const def = ButtonBox.getButton(id);
    const title = def && (def.title || def.label)
      ? String(def.title || def.label || '')
      : String(src.getAttribute('aria-label') || src.getAttribute('title') || id);
    labelEl.textContent = title;

    const icon = _cloneToolbarPreviewButton(id, src);
    if (icon) icon.disabled = true;

    item.appendChild(drag);
    item.appendChild(labelEl);
    if (icon) item.appendChild(icon);

    item.addEventListener('click', (e)=>{
      const t = e && e.target && e.target.closest ? e.target.closest('.resource-drag') : null;
      if (t) return;
      const st2 = _settingsUiStore.getState();
      const d2 = st2 && st2.draft ? st2.draft : {};
      const rawHidden2 = Array.isArray(d2.toolbarButtonHidden) ? d2.toolbarButtonHidden.map((v)=>String(v || '')) : [];
      const nextHiddenSet = new Set(rawHidden2.filter((x)=>allIds.includes(x)));
      if (nextHiddenSet.has(id)) nextHiddenSet.delete(id);
      else nextHiddenSet.add(id);
      const nextHidden = Array.from(nextHiddenSet);
      _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'toolbarButtonHidden', value: nextHidden });
      _renderToolbarLayoutEditor();
      try{
        const patch = {
          toolbarButtonOrder: order.slice(),
          toolbarButtonHidden: nextHidden.slice()
        };
        const merged = updateAppSettings(patch, { history: { source: 'settings_toolbar_toggle' } });
        if (merged && merged.__lsPersistOk === false) showToast('工具栏设置保存失败', 'error', 2600);
        else showToast('已更新工具栏显示', 'success', 1400);
      }catch(e){
        console.error('Failed to persist toolbar hidden state:', e);
        try{ showToast('工具栏设置保存失败', 'error', 2600); }catch(err){}
      }
    });

    frag.appendChild(item);
  }
  toolbarLayoutList.appendChild(frag);
  _wireToolbarLayoutDnD();
  _renderToolbarLayoutPreview(order, hiddenSet);
}

function _persistToolbarLayoutOrderFromDom(){
  try{
    if (!toolbarLayoutList) return;
    const domIds = Array.from(toolbarLayoutList.querySelectorAll('.resource-item')).map((el)=>String(el.getAttribute('data-id') || '')).filter(Boolean);
    if (!domIds.length) return;
    const items = _getToolbarButtonsForLayout();
    const allIds = items.map((it)=>String(it.id || '')).filter(Boolean);
    const nextOrder = [];
    for (const id of domIds) {
      if (!allIds.includes(id)) continue;
      if (!nextOrder.includes(id)) nextOrder.push(id);
    }
    const st = _settingsUiStore.getState();
    const d = st && st.draft ? st.draft : {};
    const rawHidden = Array.isArray(d.toolbarButtonHidden) ? d.toolbarButtonHidden.map((v)=>String(v || '')) : [];
    const hiddenSet = new Set(rawHidden.filter((id)=>allIds.includes(id)));
    _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'toolbarButtonOrder', value: nextOrder });
    _renderToolbarLayoutPreview(nextOrder, hiddenSet);
    try{
      const patch = {
        toolbarButtonOrder: nextOrder.slice(),
        toolbarButtonHidden: Array.from(hiddenSet)
      };
      const merged = updateAppSettings(patch, { history: { source: 'settings_toolbar_sort' } });
      if (merged && merged.__lsPersistOk === false) showToast('工具栏排序保存失败', 'error', 2600);
      else showToast('已更新工具栏排序', 'success', 1400);
    }catch(e){
      console.error('Failed to update app settings from toolbar custom:', e);
    }
  }catch(e){
    console.error('Failed to persist toolbar layout order from DOM:', e);
  }
}

function _wireToolbarLayoutDnD(){
  if (!toolbarLayoutList) return;
  if (toolbarLayoutList.dataset.toolbarWired === '1') return;
  toolbarLayoutList.dataset.toolbarWired = '1';
  toolbarLayoutList.addEventListener('dragstart', (e)=>{
    const item = e.target && e.target.closest ? e.target.closest('.resource-item') : null;
    if (!item) return;
    _toolbarDragId = String(item.getAttribute('data-id') || '');
    if (!_toolbarDragId) return;
    try{
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', _toolbarDragId);
      }
    }catch(err){}
  });
  toolbarLayoutList.addEventListener('dragover', (e)=>{
    if (!_toolbarDragId) return;
    e.preventDefault();
    const over = e.target && e.target.closest ? e.target.closest('.resource-item') : null;
    const dragging = toolbarLayoutList.querySelector(`.resource-item[data-id="${_toolbarDragId}"]`);
    if (!dragging) return;
    if (!over || over === dragging) return;
    const rect = over.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    if (before) toolbarLayoutList.insertBefore(dragging, over);
    else toolbarLayoutList.insertBefore(dragging, over.nextSibling);
  });
  toolbarLayoutList.addEventListener('drop', (e)=>{
    if (!_toolbarDragId) return;
    e.preventDefault();
    _toolbarDragId = '';
    _persistToolbarLayoutOrderFromDom();
  });
  toolbarLayoutList.addEventListener('dragend', ()=>{
    if (!_toolbarDragId) return;
    _toolbarDragId = '';
    _persistToolbarLayoutOrderFromDom();
  });
}

_settingsUiStore.subscribe(_renderSettingsUi);
_renderSettingsUi();

function _settingsUiSelectTab(tab, opts){
  const t = _normalizeSettingsTab(tab);
  _settingsUiStore.dispatch({ type: 'SET_TAB', tab: t });
  _loadSettingsTabAsync(t).then(()=>{
    if (t === 'toolbar') _renderToolbarLayoutEditor();
  }).catch(()=>{});
  try{ scheduleInteractiveRectsUpdate(); }catch(e){}
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.focus) {
    try{
      const btn = settingsModal ? settingsModal.querySelector(`.settings-tab[data-tab="${t}"]`) : null;
      if (btn) btn.focus();
    }catch(e){}
  }
}

function _wireSettingsUi(){
  if (settingsTabButtons && settingsTabButtons.length) {
    for (const btn of settingsTabButtons) {
      btn.addEventListener('click', ()=>{
        const t = String(btn.dataset.tab || '');
        if (!t) return;
        _settingsUiSelectTab(t, { focus: false });
      });
      bindTouchTap(btn, ()=>{
        const t = String(btn.dataset.tab || '');
        if (!t) return;
        _settingsUiSelectTab(t, { focus: true });
      }, { delayMs: 0 });
    }
  }

  if (settingsSidebar) {
    settingsSidebar.addEventListener('keydown', (e)=>{
      const key = e.key;
      if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(key)) return;
      if (!settingsTabButtons || !settingsTabButtons.length) return;
      e.preventDefault();
      const active = _settingsUiStore.getState().selectedTab;
      const idx = settingsTabButtons.findIndex(b => String(b.dataset.tab || '') === String(active || ''));
      let nextIdx = idx < 0 ? 0 : idx;
      if (key === 'Home') nextIdx = 0;
      else if (key === 'End') nextIdx = settingsTabButtons.length - 1;
      else if (key === 'ArrowDown' || key === 'ArrowRight') nextIdx = Math.min(settingsTabButtons.length - 1, nextIdx + 1);
      else if (key === 'ArrowUp' || key === 'ArrowLeft') nextIdx = Math.max(0, nextIdx - 1);
      const nextTab = String(settingsTabButtons[nextIdx].dataset.tab || '');
      if (nextTab) _settingsUiSelectTab(nextTab, { focus: true });
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener('keydown', (e)=>{
      if (e.key !== 'Escape') return;
      if (!settingsModal.classList.contains('open')) return;
      e.preventDefault();
      closeSettingsModal();
    });
  }

  const bindField = (el, key, mode)=>{
    if (!el) return;
    const evt = mode === 'input' ? 'input' : 'change';
    el.addEventListener(evt, ()=>{
      if (_settingsUiSyncing) return;
      const value = (el.type === 'checkbox') ? !!el.checked : ((el.type === 'range' || el.type === 'number') ? Number(el.value) : String(el.value || ''));
      _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key, value });
    });
  };

  bindField(optAutoResize, 'enableAutoResize');
  bindField(optCollapsed, 'toolbarCollapsed');
  bindField(optTheme, 'theme');
  bindField(optDesignLanguage, 'designLanguage');
  bindField(optVisualStyle, 'visualStyle');
  bindField(optMicaIntensity, 'mica.intensity', 'input');
  bindField(optThemePrimary, 'themeCustom.primary', 'input');
  bindField(optThemeSecondary, 'themeCustom.secondary', 'input');
  bindField(optThemeBackground, 'themeCustom.background', 'input');
  bindField(optCanvasColor, 'canvasColor');
  bindField(optPdfDefaultMode, 'pdfDefaultMode');
  bindField(optTooltips, 'showTooltips');
  bindField(optSeparateToolbarWindow, 'separateToolbarWindow');
  bindField(optVideoBoothEnabled, 'videoBoothEnabled');
  bindField(optMultiTouchPen, 'multiTouchPen');
  bindField(optPageSwitchDraggable, 'pageSwitchDraggable');
   bindField(optOverlayShape, 'overlayShapeEnabled');
  bindField(optAnnotationPenColor, 'annotationPenColor', 'input');
  bindField(optPenTailEnabled, 'penTail.enabled');
  bindField(optPenTailProfile, 'penTail.profile');
  bindField(optPenTailIntensity, 'penTail.intensity', 'input');
  bindField(optPenTailSamplePoints, 'penTail.samplePoints', 'input');
  bindField(optPenTailSpeedSensitivity, 'penTail.speedSensitivity', 'input');
  bindField(optPenTailPressureSensitivity, 'penTail.pressureSensitivity', 'input');
  bindField(optPenTailShape, 'penTail.shape');
  bindField(optSmartInk, 'smartInkRecognition');
  bindField(keyUndo, 'shortcuts.undo', 'input');
  bindField(keyRedo, 'shortcuts.redo', 'input');

  if (toolbarLayoutResetBtn) toolbarLayoutResetBtn.addEventListener('click', ()=>{
    const items = _getToolbarButtonsForLayout();
    const order = items.map((it)=>String(it.id || '')).filter(Boolean);
    _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'toolbarButtonOrder', value: order });
    _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'toolbarButtonHidden', value: [] });
    _renderToolbarLayoutEditor();
    try{
      const patch = { toolbarButtonOrder: order.slice(), toolbarButtonHidden: [] };
      const merged = updateAppSettings(patch, { history: { source: 'settings_toolbar_reset' } });
      if (merged && merged.__lsPersistOk === false) showToast('工具栏布局保存失败', 'error', 2600);
      else showToast('已恢复默认布局', 'success', 1600);
    }catch(e){
      console.error('Failed to reset toolbar layout:', e);
      try{ showToast('工具栏布局保存失败', 'error', 2600); }catch(err){}
    }
  });

  if (optDesignLanguage) optDesignLanguage.addEventListener('change', ()=>{
    try{
      if (_settingsUiSyncing) return;
      const raw = String(optDesignLanguage.value || 'fluent');
      if (applyDesignLanguage(raw)) showToast(`已切换：${raw === 'material3' ? 'Material 3 Expressive' : 'Fluent'}`, 'success', 1600);
    }catch(e){}
  });

  const getDraftSettings = ()=>{
    const st = _settingsUiStore.getState();
    const d = (st && st.draft && typeof st.draft === 'object') ? st.draft : {};
    const base = Settings.loadSettings();
    const tc = (d.themeCustom && typeof d.themeCustom === 'object') ? d.themeCustom : {};
    const mica = (d.mica && typeof d.mica === 'object') ? d.mica : {};
    return Object.assign({}, base, d, {
      themeCustom: Object.assign({}, (base.themeCustom && typeof base.themeCustom === 'object') ? base.themeCustom : {}, tc),
      mica: Object.assign({}, (base.mica && typeof base.mica === 'object') ? base.mica : {}, mica)
    });
  };

  if (exportThemeBtn) exportThemeBtn.addEventListener('click', ()=>{
    try{
      const s = getDraftSettings();
      const txt = serializeLanTheme(s);
      const blob = new Blob([txt], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LanStartWrite.lantheme';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 0);
      try{ showToast('已导出主题', 'success', 1800); }catch(e){}
    }catch(e){
      try{ showToast('导出失败', 'error', 2200); }catch(err){}
    }
  });

  if (importThemeBtn) importThemeBtn.addEventListener('click', ()=>{
    try{ if (themeFileInput) themeFileInput.click(); }catch(e){}
  });

  if (themeFileInput) themeFileInput.addEventListener('change', ()=>{
    const f = themeFileInput.files && themeFileInput.files[0] ? themeFileInput.files[0] : null;
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const parsed = parseLanTheme(String(reader.result || ''));
        if (!parsed.ok) {
          try{ showToast('主题文件无效', 'error', 2200); }catch(e){}
          return;
        }
        _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'theme', value: parsed.theme || 'system' });
        _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'visualStyle', value: parsed.visualStyle || 'blur' });
        _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'themeCustom', value: parsed.themeCustom || {} });
        _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'mica', value: parsed.mica || {} });
        try{ showToast('已导入主题（未保存）', 'success', 2200); }catch(e){}
      }catch(e){
        try{ showToast('导入失败', 'error', 2200); }catch(err){}
      }finally{
        try{ themeFileInput.value = ''; }catch(e){}
      }
    };
    reader.readAsText(f);
  });

  if (resetThemeBtn) resetThemeBtn.addEventListener('click', ()=>{
    const defThemeCustom = {
      primary: '#2B7CFF',
      secondary: '#535F70',
      error: '#E5484D',
      warning: '#F59E0B',
      success: '#22C55E',
      info: '#38BDF8',
      surface: '#FDFBFF',
      background: '#FFFFFF',
      outline: '#73777F'
    };
    const defMica = { intensity: 60, radius: 24, feather: 8, overlayOpacity: 0.30, saturation: 1.2 };
    _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'themeCustom', value: defThemeCustom });
    _settingsUiStore.dispatch({ type: 'UPDATE_FIELD', key: 'mica', value: defMica });
    try{ showToast('已重置主题（未保存）', 'success', 2000); }catch(e){}
  });

  if (contrastReportBtn) contrastReportBtn.addEventListener('click', ()=>{
    try{
      const rep = buildContrastReport();
      const lines = rep.map(r=>{
        const ok = r && r.okAA;
        const ratio = (r && typeof r.ratio === 'number') ? String(r.ratio.toFixed(2)) : '—';
        return `${ok ? 'OK' : 'FAIL'} ${String(r.name || '')}: ${ratio}`;
      });
      if (themeReportOut) themeReportOut.textContent = lines.join('\n');
    }catch(e){
      if (themeReportOut) themeReportOut.textContent = '对比度检查失败';
    }
  });

  if (perfCheckBtn) perfCheckBtn.addEventListener('click', ()=>{
    try{
      const s = getDraftSettings();
      const cost = measureApplyCost(()=>{ applyThemeMode(String(s.theme || 'system'), s, document.documentElement); });
      if (themeReportOut) themeReportOut.textContent = `applyTheme: ${cost.toFixed(2)}ms`;
    }catch(e){
      if (themeReportOut) themeReportOut.textContent = '性能自检失败';
    }
  });
}

const _settingsHistoryUi = {
  all: [],
  rendered: 0,
  pageSize: 60,
  selected: new Set(),
  lastTab: ''
};

function _formatHistoryTs(ts){
  const d = new Date(Number(ts || 0));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n)=>String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function _historyPathToJumpTarget(path){
  const p = String(path || '');
  const root = p.split('.')[0] || '';
  if (!root) return { tab: 'general', id: '' };
  if (root === 'enableAutoResize') return { tab: 'general', id: 'optAutoResize' };
  if (root === 'toolbarCollapsed') return { tab: 'general', id: 'optCollapsed' };
  if (root === 'showTooltips') return { tab: 'general', id: 'optTooltips' };

  if (root === 'theme') return { tab: 'appearance', id: 'optTheme' };
  if (root === 'designLanguage') return { tab: 'appearance', id: 'optDesignLanguage' };
  if (root === 'visualStyle') return { tab: 'appearance', id: 'optVisualStyle' };
  if (root === 'canvasColor') return { tab: 'appearance', id: 'optCanvasColor' };
  if (root === 'pdfDefaultMode') return { tab: 'appearance', id: 'optPdfDefaultMode' };

  if (root === 'themeCustom') {
    const sub = p.slice('themeCustom.'.length);
    if (sub) return { tab: 'appearance', id: `optTheme${sub.charAt(0).toUpperCase()}${sub.slice(1)}` };
    return { tab: 'appearance', id: '' };
  }
  if (root === 'mica') {
    const sub = p.slice('mica.'.length);
    if (sub === 'intensity') return { tab: 'appearance', id: 'optMicaIntensity' };
    return { tab: 'appearance', id: '' };
  }

  if (root === 'multiTouchPen') return { tab: 'input', id: 'optMultiTouchPen' };
  if (root === 'overlayShapeEnabled') return { tab: 'input', id: 'optOverlayShape' };
  if (root === 'annotationPenColor') return { tab: 'input', id: 'optAnnotationPenColor' };
  if (root === 'smartInkRecognition') return { tab: 'input', id: 'optSmartInk' };
  if (root === 'penTail') {
    const sub = p.slice('penTail.'.length);
    if (sub === 'enabled') return { tab: 'input', id: 'optPenTailEnabled' };
    if (sub === 'profile') return { tab: 'input', id: 'optPenTailProfile' };
    if (sub === 'intensity') return { tab: 'input', id: 'optPenTailIntensity' };
    if (sub === 'samplePoints') return { tab: 'input', id: 'optPenTailSamplePoints' };
    if (sub === 'speedSensitivity') return { tab: 'input', id: 'optPenTailSpeedSensitivity' };
    if (sub === 'pressureSensitivity') return { tab: 'input', id: 'optPenTailPressureSensitivity' };
    if (sub === 'shape') return { tab: 'input', id: 'optPenTailShape' };
    return { tab: 'input', id: '' };
  }

  if (root === 'shortcuts') {
    const sub = p.slice('shortcuts.'.length);
    if (sub === 'undo') return { tab: 'shortcuts', id: 'keyUndo' };
    if (sub === 'redo') return { tab: 'shortcuts', id: 'keyRedo' };
    return { tab: 'shortcuts', id: '' };
  }

  if (root === 'videoBoothEnabled') return { tab: 'toolbar', id: 'optVideoBoothEnabled' };
  if (root === 'toolbarButtonOrder' || root === 'toolbarButtonHidden') return { tab: 'toolbar', id: 'toolbarLayoutList' };
  if (root === 'pluginButtonDisplay') return { tab: 'plugins', id: 'pluginList' };
  return { tab: 'general', id: '' };
}

function _historyJumpToPath(path){
  const target = _historyPathToJumpTarget(path);
  _settingsUiSelectTab(target.tab, { focus: false });
  if (!target.id) return;
  const el = document.getElementById(target.id);
  if (!el) return;
  try{ el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }catch(e){}
  try{
    el.classList.add('ls-jump-highlight');
    setTimeout(()=>{ try{ el.classList.remove('ls-jump-highlight'); }catch(e){} }, 1200);
  }catch(e){}
}

function _historyRenderMeta(){
  if (!settingsHistoryMeta) return;
  const total = _settingsHistoryUi.all.length;
  const undone = _settingsHistoryUi.all.filter(r => r && r.undone).length;
  settingsHistoryMeta.textContent = `记录: ${total}  已撤回: ${undone}  已选择: ${_settingsHistoryUi.selected.size}`;
}

// Optimized History Renderer with Virtualization (Chunking) for Modal
const _HISTORY_CHUNK_SIZE = 20;

class HistoryChunkManager {
    constructor(container) {
        this.container = container;
        this.observer = new IntersectionObserver(this.onIntersect.bind(this), { rootMargin: '400px 0px' });
        this.chunks = new Map(); // index -> { el, height, isRendered }
        this.data = [];
    }

    setData(data) {
        this.data = data || [];
        this.renderPlaceholders();
    }

    renderPlaceholders() {
        this.observer.disconnect();
        this.container.innerHTML = '';
        this.chunks.clear();

        const count = Math.ceil(this.data.length / _HISTORY_CHUNK_SIZE);
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'ls-history-chunk';
            el.dataset.index = i;
            el.style.minHeight = '1px'; 
            this.container.appendChild(el);
            this.observer.observe(el);
            this.chunks.set(i, { el, height: 0, isRendered: false });
        }
        
        const footer = document.createElement('div');
        footer.style.height = '20px';
        this.container.appendChild(footer);
    }

    onIntersect(entries) {
        for (const entry of entries) {
            const idx = Number(entry.target.dataset.index);
            const chunk = this.chunks.get(idx);
            if (!chunk) continue;

            if (entry.isIntersecting) {
                if (!chunk.isRendered) {
                    this.renderChunk(idx);
                }
            } else {
                if (chunk.isRendered && chunk.height > 0) {
                    this.unloadChunk(idx);
                }
            }
        }
    }

    renderChunk(index) {
        const chunk = this.chunks.get(index);
        if (!chunk) return;

        const start = index * _HISTORY_CHUNK_SIZE;
        const end = Math.min(start + _HISTORY_CHUNK_SIZE, this.data.length);
        const frag = document.createDocumentFragment();

        for (let i = start; i < end; i++) {
            frag.appendChild(_historyBuildItem(this.data[i]));
        }
        
        chunk.el.innerHTML = '';
        chunk.el.appendChild(frag);
        chunk.el.style.height = 'auto'; 
        chunk.isRendered = true;
    }

    unloadChunk(index) {
        const chunk = this.chunks.get(index);
        if (!chunk) return;

        const rect = chunk.el.getBoundingClientRect();
        if (rect.height > 0) chunk.height = rect.height;

        chunk.el.innerHTML = '';
        chunk.el.style.height = `${chunk.height}px`;
        chunk.isRendered = false;
    }
}

let _historyChunkManager = null;

function _historyRender(reset) {
    if (!settingsHistoryTimeline) return;
    
    if (!_historyChunkManager || reset) {
        _historyChunkManager = new HistoryChunkManager(settingsHistoryTimeline);
    }
    
    if (reset) {
        _historyChunkManager.setData(_settingsHistoryUi.all);
    }
    
    _historyRenderMeta();
}

function _historyBuildItem(rec){
  const item = document.createElement('div');
  item.className = 'ls-history-item';
  item.setAttribute('role', 'listitem');

  const card = document.createElement('div');
  card.className = `ls-history-card${rec && rec.undone ? ' is-undone' : ''}`;
  const recId = String(rec && rec.id || '');
  card.dataset.id = recId;
  item.appendChild(card);

  const header = document.createElement('div');
  header.className = 'ls-history-card-header';
  card.appendChild(header);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'ls-history-card-title';
  header.appendChild(titleWrap);

  const timeEl = document.createElement('div');
  timeEl.className = 'ls-history-time';
  timeEl.textContent = _formatHistoryTs(rec && rec.ts);
  titleWrap.appendChild(timeEl);

  const mainEl = document.createElement('div');
  mainEl.className = 'ls-history-main';
  const changes = Array.isArray(rec && rec.changes) ? rec.changes : [];
  mainEl.textContent = changes.length === 1 ? String(changes[0].path || '设置变更') : `${changes.length || 0} 项设置变更`;
  titleWrap.appendChild(mainEl);

  const badges = document.createElement('div');
  badges.className = 'ls-history-badges';
  header.appendChild(badges);

  const sourceBadge = document.createElement('div');
  sourceBadge.className = 'ls-history-badge';
  sourceBadge.textContent = String(rec && rec.source || 'settings');
  badges.appendChild(sourceBadge);

  if (rec && rec.undone) {
    const undoneBadge = document.createElement('div');
    undoneBadge.className = 'ls-history-badge ls-history-badge-undone';
    undoneBadge.textContent = '已撤回';
    badges.appendChild(undoneBadge);
  }

  const body = document.createElement('div');
  body.className = 'ls-history-card-body';
  card.appendChild(body);

  const diffs = document.createElement('div');
  diffs.className = 'ls-history-diff';
  body.appendChild(diffs);

  for (const c of changes) {
    const row = document.createElement('div');
    row.className = 'ls-history-diff-row';
    diffs.appendChild(row);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = 'jump';
    btn.dataset.path = String(c && c.path || '');
    row.appendChild(btn);

    const p = document.createElement('div');
    p.className = 'ls-history-diff-path';
    p.textContent = String(c && c.path || '');
    btn.appendChild(p);

    const v = document.createElement('div');
    v.className = 'ls-history-diff-values';
    v.textContent = `${String(c && c.beforeText || '')} → ${String(c && c.afterText || '')}`;
    row.appendChild(v);
  }

  const actions = document.createElement('div');
  actions.className = 'ls-history-actions';
  body.appendChild(actions);

  const select = document.createElement('input');
  select.type = 'checkbox';
  select.className = 'ls-history-select';
  select.dataset.id = recId;
  select.checked = _settingsHistoryUi.selected.has(recId);
  if (rec && rec.undone) select.disabled = true;
  actions.appendChild(select);

  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'mode-btn';
  jumpBtn.textContent = '跳转';
  jumpBtn.dataset.action = 'jump';
  jumpBtn.dataset.path = changes[0] ? String(changes[0].path || '') : '';
  actions.appendChild(jumpBtn);

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'mode-btn';
  undoBtn.textContent = '撤回';
  undoBtn.dataset.action = 'undo';
  undoBtn.dataset.id = recId;
  if (rec && rec.undone) undoBtn.disabled = true;
  actions.appendChild(undoBtn);

  return item;
}

let _historyRefreshTimer = 0;
function _historyRefresh(opts){
  const o = (opts && typeof opts === 'object') ? opts : {};
  if (_historyRefreshTimer) clearTimeout(_historyRefreshTimer);
  _historyRefreshTimer = setTimeout(()=>{
    const run = () => {
        _settingsHistoryUi.all = loadSettingsHistory(2000);
        if (o.reset) _settingsHistoryUi.selected.clear();
        _historyRenderMeta();
        const st = _settingsUiStore.getState();
        const tab = st && st.selectedTab ? String(st.selectedTab) : '';
        if (tab === 'history') _historyRender(true);
        if (o.reload) {
          const s = Settings.loadSettings();
          _settingsUiStore.dispatch({ type: 'OPEN', settings: s });
          _renderSettingsUi();
        }
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run);
    else setTimeout(run, 10);
  }, 50);
}

function _initSettingsHistoryUi(){
  if (!settingsHistoryTimeline) return;
  if (settingsHistoryTimeline.dataset.historyWired === '1') return;
  settingsHistoryTimeline.dataset.historyWired = '1';

  if (historyLoadMoreBtn) historyLoadMoreBtn.style.display = 'none';
  
  // Event Delegation
  settingsHistoryTimeline.addEventListener('click', (e) => {
      const target = e.target;
      
      if (target.matches('.ls-history-select')) {
          const id = target.dataset.id;
          if (!id) return;
          if (target.checked) _settingsHistoryUi.selected.add(id);
          else _settingsHistoryUi.selected.delete(id);
          _historyRenderMeta();
          e.stopPropagation();
          return;
      }

      const btn = target.closest('button');
      if (btn) {
          const action = btn.dataset.action;
          if (action === 'jump') {
              e.stopPropagation();
              const path = btn.dataset.path || '';
              const target = _historyPathToJumpTarget(path);
              _settingsUiSelectTab(target.tab, { focus: false });
              if (target.id) {
                setTimeout(()=>{
                    const el = document.getElementById(target.id);
                    if (el) {
                        try{ el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }catch(e){}
                        el.classList.add('ls-jump-highlight');
                        setTimeout(()=>{ el.classList.remove('ls-jump-highlight'); }, 1200);
                    }
                }, 100);
              }
              return;
          }
          if (action === 'undo') {
              e.stopPropagation();
              const id = btn.dataset.id;
              if (!id) return;
              if (!confirm('确定要撤回该次修改吗？')) return;
              try{ undoSettingsHistoryEntry(id, { source: 'settings_modal_history' }); }catch(err){}
              _historyRefresh({ reset: true, reload: true });
              return;
          }
      }
      
      const header = target.closest('.ls-history-card-header');
      if (header) {
          const card = header.closest('.ls-history-card');
          if (card) card.classList.toggle('expanded');
      }
  });

  if (historySelectAllBtn) historySelectAllBtn.addEventListener('click', ()=>{
    const selectable = _settingsHistoryUi.all.filter(r => r && !r.undone).map(r => String(r.id || '')).filter(Boolean);
    const allSelected = selectable.length && selectable.every(id => _settingsHistoryUi.selected.has(id));
    if (allSelected) _settingsHistoryUi.selected.clear();
    else for (const id of selectable) _settingsHistoryUi.selected.add(id);
    try{
      settingsHistoryTimeline.querySelectorAll('input.ls-history-select').forEach(cb=>{
        if (cb.disabled) return;
        cb.checked = _settingsHistoryUi.selected.has(cb.dataset.id);
      });
    }catch(e){}
    _historyRenderMeta();
  });
  if (historyUndoSelectedBtn) historyUndoSelectedBtn.addEventListener('click', ()=>{
    const ids = Array.from(_settingsHistoryUi.selected);
    if (!ids.length) return;
    if (!confirm(`确定要撤回选中的 ${ids.length} 条记录吗？`)) return;
    try{ undoSettingsHistoryBatch(ids, { source: 'settings_modal_history_batch' }); }catch(e){}
    _historyRefresh({ reset: true, reload: true });
  });
  if (historyClearBtn) historyClearBtn.addEventListener('click', ()=>{
    if (!confirm('确定要清空全部历史记录吗？')) return;
    try{ clearSettingsHistory(); }catch(e){}
    _historyRefresh({ reset: true });
  });

  try{ Message.on(EVENTS.SETTINGS_HISTORY_CHANGED, ()=>_historyRefresh({ reset: true })); }catch(e){}
  try{
    _settingsUiStore.subscribe(()=>{
      const st = _settingsUiStore.getState();
      const tab = st && st.selectedTab ? String(st.selectedTab) : '';
      if (tab === _settingsHistoryUi.lastTab) return;
      _settingsHistoryUi.lastTab = tab;
      if (tab === 'history') _historyRender(true);
    });
  }catch(e){}
  _historyRefresh({ reset: true });
}

try{ _initSettingsHistoryUi(); }catch(e){}

_wireSettingsUi();

let _previewBackup = null;
let _toolbarDragId = '';
let _pluginDragId = '';
let _pluginInstallRequestId = '';

function openSettings(){
  if (!settingsModal) return;
  try{ _setSettingsLoading(false); }catch(e){}
  const s = Settings.loadSettings();
  _settingsUiStore.dispatch({ type: 'OPEN', settings: s });
  const tab = _settingsUiStore.getState().selectedTab || _getFirstSettingsTab();
  _settingsUiSelectTab(tab, { focus: false });
  settingsModal.classList.add('open');
  try{ settingsModal.setAttribute('aria-hidden', 'false'); }catch(e){}
  _menuDebug('modal', 'open', 'settings');
  applyWindowInteractivity();
  scheduleInteractiveRectsUpdate();
  try{
    const btn = settingsModal.querySelector(`.settings-tab[data-tab="${String(tab)}"]`);
    if (btn) btn.focus();
  }catch(e){}
}

function closeSettingsModal(){
  if (settingsModal) settingsModal.classList.remove('open');
  try{ if (settingsModal) settingsModal.setAttribute('aria-hidden', 'true'); }catch(e){}
  try{ _setSettingsLoading(false); }catch(e){}
  _settingsUiStore.dispatch({ type: 'CLOSE' });
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
  const settingsLike = Settings.loadSettings();
  const displayMap = settingsLike && settingsLike.pluginButtonDisplay && typeof settingsLike.pluginButtonDisplay === 'object' && !Array.isArray(settingsLike.pluginButtonDisplay)
    ? settingsLike.pluginButtonDisplay
    : {};
  const displayRaw = Object.prototype.hasOwnProperty.call(displayMap, id) ? displayMap[id] : '';
  const display = displayRaw === 'toolbar' || displayRaw === 'more' || displayRaw === 'library' ? displayRaw : 'toolbar';

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

  const displayWrap = document.createElement('div');
  displayWrap.className = 'plugin-display';
  const optToolbar = document.createElement('label');
  const optMore = document.createElement('label');
  const optLibrary = document.createElement('label');
  const rToolbar = document.createElement('input');
  const rMore = document.createElement('input');
  const rLibrary = document.createElement('input');
  rToolbar.type = 'radio';
  rMore.type = 'radio';
  rLibrary.type = 'radio';
  rToolbar.name = `plugin-display-${id}`;
  rMore.name = `plugin-display-${id}`;
  rLibrary.name = `plugin-display-${id}`;
  rToolbar.value = 'toolbar';
  rMore.value = 'more';
  rLibrary.value = 'library';
  rToolbar.checked = display === 'toolbar';
  rMore.checked = display === 'more';
  rLibrary.checked = display === 'library';
  optToolbar.appendChild(rToolbar);
  optMore.appendChild(rMore);
  optLibrary.appendChild(rLibrary);
  optToolbar.appendChild(document.createTextNode('挂到浮动工具栏'));
  optMore.appendChild(document.createTextNode('仅出现在更多菜单'));
  optLibrary.appendChild(document.createTextNode('仅在功能库中'));
  displayWrap.appendChild(optToolbar);
  displayWrap.appendChild(optMore);
  displayWrap.appendChild(optLibrary);

  const onDisplayChange = (val)=>{
    const prevMap = settingsLike && settingsLike.pluginButtonDisplay && typeof settingsLike.pluginButtonDisplay === 'object' && !Array.isArray(settingsLike.pluginButtonDisplay)
      ? settingsLike.pluginButtonDisplay
      : {};
    const nextMap = Object.assign({}, prevMap, { [id]: val });
    try{ updateAppSettings({ pluginButtonDisplay: nextMap }); }catch(e){}
  };

  rToolbar.addEventListener('change', ()=>{ if (rToolbar.checked) onDisplayChange('toolbar'); });
  rMore.addEventListener('change', ()=>{ if (rMore.checked) onDisplayChange('more'); });
  rLibrary.addEventListener('change', ()=>{ if (rLibrary.checked) onDisplayChange('library'); });
  actions.appendChild(displayWrap);

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
Message.on(EVENTS.OPEN_SETTINGS, ()=>{ if (!openSettingsWindow()) openSettings(); });
Message.on(EVENTS.OPEN_ABOUT, ()=>{ if (!openAboutWindow()) openAbout(); });

try{
  if (window && window.electronAPI && typeof window.electronAPI.onReplyFromMain === 'function') {
    window.electronAPI.onReplyFromMain('app:settings-changed', (payload)=>{
      try{
        const s = payload && typeof payload === 'object' ? payload : {};
        try{ _settingsUiStore.dispatch({ type: 'SET_DRAFT', settings: s }); }catch(e){}
        try{
          if (typeof s.enableAutoResize !== 'undefined') {
            if (!s.enableAutoResize) {
              try{ const p = document.querySelector('.floating-panel'); if (p) p.style.width = ''; }catch(e){}
            } else { window.dispatchEvent(new Event('resize')); }
          }
        }catch(e){}
        try{ if (typeof s.toolbarCollapsed !== 'undefined') applyCollapsed(!!s.toolbarCollapsed); }catch(e){}
        try{ if (typeof s.designLanguage !== 'undefined') applyDesignLanguage(s.designLanguage); }catch(e){}
        try{ if (s.theme) applyTheme(s.theme, s); }catch(e){}
        try{ if (typeof s.showTooltips !== 'undefined') applyTooltips(!!s.showTooltips); }catch(e){}
        try{ if (s.visualStyle) applyVisualStyle(s.visualStyle); }catch(e){}
        try{ if (Array.isArray(s.toolbarButtonOrder) || Array.isArray(s.toolbarButtonHidden) || typeof s.videoBoothEnabled !== 'undefined') applyToolbarLayout(s); }catch(e){}
        try{ if (s.canvasColor) applyModeCanvasBackground(_appMode, s.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) }); }catch(e){}
        try{ if (typeof s.multiTouchPen !== 'undefined') setMultiTouchPenEnabled(!!s.multiTouchPen); }catch(e){}
        try{ if (typeof s.smartInkRecognition !== 'undefined') setInkRecognitionEnabled(!!s.smartInkRecognition); }catch(e){}
        try{ if (_appMode === APP_MODES.ANNOTATION && s.annotationPenColor) { setBrushColor(normalizeHexColor(s.annotationPenColor, '#FF0000')); updatePenModeLabel(); syncToolbarIcons(); } }catch(e){}
      }catch(e){}
    });
  }
}catch(e){}

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
  const st = _settingsUiStore.getState();
  const d = st && st.draft ? st.draft : _makeSettingsDraftFromSettings(Settings.loadSettings());
  const v = _validateSettingsDraft(d);
  if (!v.ok) {
    try{ showToast(v.message || '设置无效', 'error', 3200); }catch(e){}
    try{
      if (v.focusId) {
        const el = document.getElementById(String(v.focusId));
        if (el) { el.focus(); if (typeof el.reportValidity === 'function') el.reportValidity(); }
      }
    }catch(e){}
    return;
  }
  const newS = {
    enableAutoResize: !!d.enableAutoResize,
    toolbarCollapsed: !!d.toolbarCollapsed,
    designLanguage: String(d.designLanguage || 'fluent'),
    theme: String(d.theme || 'light'),
    themeCustom: Object.assign({}, (d.themeCustom && typeof d.themeCustom === 'object') ? d.themeCustom : {}),
    visualStyle: String(d.visualStyle || 'blur'),
    mica: Object.assign({}, (d.mica && typeof d.mica === 'object') ? d.mica : {}),
    canvasColor: String(d.canvasColor || 'white'),
    showTooltips: !!d.showTooltips,
    multiTouchPen: !!d.multiTouchPen,
    overlayShapeEnabled: !!d.overlayShapeEnabled,
    annotationPenColor: normalizeHexColor(d.annotationPenColor, '#FF0000'),
    smartInkRecognition: !!d.smartInkRecognition,
    videoBoothEnabled: !!d.videoBoothEnabled,
    penTail: normalizePenTailSettings(d.penTail),
    shortcuts: {
      undo: d.shortcuts && typeof d.shortcuts.undo === 'string' ? d.shortcuts.undo.trim() : '',
      redo: d.shortcuts && typeof d.shortcuts.redo === 'string' ? d.shortcuts.redo.trim() : ''
    },
    toolbarButtonOrder: Array.isArray(d.toolbarButtonOrder) ? d.toolbarButtonOrder.slice() : [],
    toolbarButtonHidden: Array.isArray(d.toolbarButtonHidden) ? d.toolbarButtonHidden.slice() : []
  };
  const merged = updateAppSettings(newS);
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function') {
      window.electronAPI.invokeMain('message', EVENTS.SETTINGS_CHANGED, merged);
    }
  }catch(e){}
  // apply immediate effects
  if (!newS.enableAutoResize) {
    try{ const p = document.querySelector('.floating-panel'); if (p) p.style.width = ''; }catch(e){ console.error('Failed to reset panel width:', e); }
  } else { window.dispatchEvent(new Event('resize')); }
  applyCollapsed(newS.toolbarCollapsed);
  applyDesignLanguage(newS.designLanguage);
  applyTheme(newS.theme, newS);
  try{ applyVisualStyle(newS.visualStyle); }catch(e){ console.error('Failed to apply visual style:', e); }
  try{ applyModeCanvasBackground(_appMode, newS.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(merged, mode) }); }catch(e){ console.error('Failed to apply canvas background:', e); }
  applyTooltips(newS.showTooltips);
  try{ applyToolbarLayout(merged); }catch(e){ console.error('Failed to apply toolbar layout:', e); }
  try{ setMultiTouchPenEnabled(!!newS.multiTouchPen); }catch(e){ console.error('Failed to set multi-touch pen:', e); }
  try{ setInkRecognitionEnabled(!!newS.smartInkRecognition); }catch(e){ console.error('Failed to set ink recognition:', e); }
  try{
    if (_appMode === APP_MODES.ANNOTATION) {
      setBrushColor(newS.annotationPenColor);
      updatePenModeLabel();
      syncToolbarIcons();
    }
  }catch(e){ console.error('Failed to sync annotation state:', e); }
  closeSettingsModal();
});

if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', ()=>{ Settings.resetSettings(); const s = Settings.loadSettings(); if (optAutoResize) optAutoResize.checked = !!s.enableAutoResize; if (optCollapsed) optCollapsed.checked = !!s.toolbarCollapsed; if (optTheme) optTheme.value = s.theme || 'light'; if (optDesignLanguage) optDesignLanguage.value = s.designLanguage || 'fluent'; if (optVisualStyle) optVisualStyle.value = s.visualStyle || 'blur'; if (optCanvasColor) optCanvasColor.value = s.canvasColor || 'white'; if (optTooltips) optTooltips.checked = !!s.showTooltips; if (optMultiTouchPen) optMultiTouchPen.checked = !!s.multiTouchPen; if (optAnnotationPenColor) optAnnotationPenColor.value = String(s.annotationPenColor || '#FF0000'); if (optSmartInk) optSmartInk.checked = !!s.smartInkRecognition; if (keyUndo) keyUndo.value = (s.shortcuts && s.shortcuts.undo) || ''; if (keyRedo) keyRedo.value = (s.shortcuts && s.shortcuts.redo) || ''; try{ applyDesignLanguage(s.designLanguage); }catch(e){ console.error('Failed to reset design language:', e); } try{ applyTheme(s.theme, s); }catch(e){ console.error('Failed to reset theme:', e); } try{ setMultiTouchPenEnabled(!!s.multiTouchPen); }catch(e){ console.error('Failed to reset multi-touch pen:', e); } try{ setInkRecognitionEnabled(!!s.smartInkRecognition); }catch(e){ console.error('Failed to reset ink recognition:', e); } try{ if (_appMode === APP_MODES.ANNOTATION) { setBrushColor(String(s.annotationPenColor || '#FF0000').toUpperCase()); updatePenModeLabel(); syncToolbarIcons(); } }catch(e){ console.error('Failed to reset annotation state:', e); } });

class DesignStyleController {
  constructor(root){
    this._root = root || document.documentElement;
    this._last = '';
    this._clearT = 0;
  }

  get(){
    try{
      const r = this._root;
      if (r.classList.contains('dl-md3')) return 'material3';
      return 'fluent';
    }catch(e){}
    return 'fluent';
  }

  set(name){
    try{
      const r = this._root;
      const v = (String(name || '') === 'material3') ? 'material3' : 'fluent';
      const nextCls = v === 'material3' ? 'dl-md3' : 'dl-fluent';
      const prev = r.classList.contains(nextCls);
      if (!prev) {
        r.classList.add('dl-switching');
        r.classList.remove('dl-md3','dl-fluent');
        r.classList.add(nextCls);
        this._last = v;
        try{ r.dataset.designLanguage = v; }catch(e){}
        if (this._clearT) clearTimeout(this._clearT);
        this._clearT = setTimeout(()=>{ try{ r.classList.remove('dl-switching'); }catch(e){} }, 50);
      }
      return !prev;
    }catch(e){}
    return false;
  }
}

const _designStyleController = new DesignStyleController(document.documentElement);

export function setDesignLanguage(name){
  return _designStyleController.set(name);
}

function applyDesignLanguage(name){
  return setDesignLanguage(name);
}

function applyTheme(name, settingsOverride){
  try{
    const s = (settingsOverride && typeof settingsOverride === 'object') ? settingsOverride : Settings.loadSettings();
    applyThemeMode(String(name || (s && s.theme) || 'system'), s, document.documentElement);
  }catch(e){}
}

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
    designLanguage: (optDesignLanguage && optDesignLanguage.value) || s.designLanguage,
    theme: (optTheme && optTheme.value) || s.theme,
    showTooltips: !!(optTooltips && optTooltips.checked),
    visualStyle: (optVisualStyle && optVisualStyle.value) || s.visualStyle,
    canvasColor: (optCanvasColor && optCanvasColor.value) || s.canvasColor
  };
  applyDesignLanguage(preview.designLanguage);
  applyTheme(preview.theme, Object.assign({}, s, preview));
  applyTooltips(preview.showTooltips);
  // preview visual style
  try{ if (preview.visualStyle) applyVisualStyle(preview.visualStyle); }catch(e){}
  // preview canvas color
  try{ if (preview.canvasColor) applyModeCanvasBackground(_appMode, preview.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) }); }catch(e){}
});

if (revertPreviewBtn) revertPreviewBtn.addEventListener('click', ()=>{
  if (_previewBackup) {
    applyDesignLanguage(_previewBackup.designLanguage);
    applyTheme(_previewBackup.theme, _previewBackup);
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
    window.electronAPI.onReplyFromMain('note:apply-preview-state', (payload)=>{
      try{
        const p = payload && typeof payload === 'object' ? payload : {};
        const s = p.state && typeof p.state === 'object' ? p.state : null;
        const key = String(p.activeDocKey || 'whiteboard');
        const scale = Number(p.viewScale || 1) || 1;
        const rot = Number(p.rotationDeg || 0) || 0;
        if (key) setCanvasMode(key);
        if (s) applyCubenoteState(s, { conflict: 'overwrite' });
        try{ setViewTransform(scale, 0, 0); }catch(e){}
        try{ setViewRotation(rot); }catch(e){}
        showToast('已应用预览状态', 'success');
      }catch(e){
        showToast('应用预览失败', 'error');
      }
    });
    window.electronAPI.onReplyFromMain('note:request-import', ()=>{
      try{ startNoteImportFlow(); }catch(e){ showToast('导入失败', 'error'); }
    });
    window.electronAPI.onReplyFromMain('note:request-export', ()=>{
      try{ startNoteExportFlow(); }catch(e){ showToast('导出失败', 'error'); }
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
Message.on(EVENTS.SETTINGS_CHANGED, (s)=>{
  try{
    bindShortcutsFromSettings();
    if (s && typeof s.designLanguage !== 'undefined') applyDesignLanguage(s.designLanguage);
    if (s && s.theme) applyTheme(s.theme, s);
    if (s && s.visualStyle) applyVisualStyle(s.visualStyle);
    if (s && s.canvasColor) applyModeCanvasBackground(_appMode, s.canvasColor, { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(s, mode) });
    if (s && typeof s.multiTouchPen !== 'undefined') setMultiTouchPenEnabled(!!s.multiTouchPen);
    if (s && typeof s.smartInkRecognition !== 'undefined') setInkRecognitionEnabled(!!s.smartInkRecognition);
    if (s && (Array.isArray(s.toolbarButtonOrder) || Array.isArray(s.toolbarButtonHidden))) applyToolbarLayout(s);
    if (s && s.kind === 'pdf_viewer_opened') {
      setPdfMode(true);
      enterAnnotationMode({ persist: false });
      applyWindowInteractivity();
      scheduleInteractiveRectsUpdate();
    }
  }catch(e){}
});

// 处理主进程发来的退出/重启准备信号
if (window.electronAPI && window.electronAPI.onReplyFromMain) {
  window.electronAPI.onReplyFromMain('app:prepare-exit', (data) => {
    console.log('[App] 收到退出准备信号:', data);
    Message.emit(EVENTS.APP_PREPARE_EXIT, data);
  });

  window.electronAPI.onReplyFromMain('pdf:state-changed', (data) => {
    console.log('[App] PDF 状态变更:', data);
    const count = (data && typeof data.count === 'number') ? data.count : 0;
    if (count > 0) {
      if (!_pdfMode) {
        setPdfMode(true);
        // 如果当前不在批注模式，可以考虑切过去，但为了不打断用户，这里只改 PDF 标志位
        updateExitToolUI();
      }
    } else {
      if (_pdfMode) {
        setPdfMode(false);
        // 如果当前处于 PDF 关联的批注模式，恢复到白板模式
        if (_appMode === APP_MODES.ANNOTATION) {
          enterWhiteboardMode({ persist: true });
        }
        applyWindowInteractivity();
        scheduleInteractiveRectsUpdate();
      }
    }
  });
}

// initialize undo/redo button states now (renderer may have emitted before listener attached)
try{ if (undoBtn) undoBtn.disabled = !canUndo(); if (redoBtn) redoBtn.disabled = !canRedo(); if (historyStateDisplay) historyStateDisplay.textContent = `撤销: ${canUndo()? '可' : '—'}  重做: ${canRedo()? '可' : '—'}`; }catch(e){}

// apply persisted theme/tooltips on startup
try{
  if (settings) {
    if (typeof settings.designLanguage !== 'undefined') applyDesignLanguage(settings.designLanguage);
    if (settings.theme) applyTheme(settings.theme, settings);
    if (typeof settings.showTooltips !== 'undefined') applyTooltips(!!settings.showTooltips);
    // Apply toolbar layout on startup
    applyToolbarLayout(settings);
  }
}catch(e){
  console.error('Failed to apply startup settings:', e);
}
try{ if (settings) { if (settings.visualStyle) applyVisualStyle(settings.visualStyle); else applyVisualStyle('blur'); } }catch(e){}
try{ if (settings) { applyModeCanvasBackground(_appMode, settings.canvasColor || 'white', { getToolState, replaceStrokeColors, setBrushColor, updatePenModeLabel, getPreferredPenColor: (mode)=>getPenColorFromSettings(settings, mode) }); } }catch(e){}
try{ if (settings && typeof settings.multiTouchPen !== 'undefined') setMultiTouchPenEnabled(!!settings.multiTouchPen); }catch(e){}
try{ if (settings && typeof settings.smartInkRecognition !== 'undefined') setInkRecognitionEnabled(!!settings.smartInkRecognition); }catch(e){}
try{ initThemeAutoSync(()=>Settings.loadSettings()); }catch(e){}

async function getDisplayMetrics() {
  try {
    const res = await _invokeMainMessage('app:get-display-metrics', {});
    if (res && res.success) return res;
    return null;
  } catch (e) { return null; }
}

async function positionToolbarIdeally(animate = true) {
  const panel = document.querySelector('.floating-panel');
  if (!panel) return;

  const metrics = await getDisplayMetrics();
  if (!metrics || !metrics.workArea) return;

  const { workArea } = metrics;
  
  const width = Number(panel.offsetWidth || 0) || Number(panel.getBoundingClientRect().width || 0) || 64;
  const height = Number(panel.offsetHeight || 0) || Number(panel.getBoundingClientRect().height || 0) || 300;

  // Calculate center bottom position relative to workArea
  const left = workArea.x + (workArea.width - width) / 2;
  const marginBottom = 24;
  const top = workArea.y + workArea.height - height - marginBottom;

  panel.style.left = `${left}px`;
  panel.style.right = 'auto';
  panel.style.top = `${top}px`;
  panel.style.bottom = 'auto';
  
  if (animate) {
    panel.classList.remove('hyperos-entrance');
    void panel.offsetWidth; // Trigger reflow
    panel.classList.add('hyperos-entrance');
  }
  
  scheduleInteractiveRectsUpdate();
}

if (!_PIN_TOOLBAR_TO_TASKBAR) {
  if (window.electronAPI && window.electronAPI.onReplyFromMain) {
    window.electronAPI.onReplyFromMain('app:display-metrics-changed', (data) => {
      positionToolbarIdeally(false);
    });
  }

  setTimeout(() => {
    positionToolbarIdeally(true);
  }, 100);
}

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
      const w = Math.max(Number(toolsSection.scrollWidth || 0), Number(toolsSection.offsetWidth || 0));
      applyWidth(w);
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
