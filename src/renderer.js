// renderer.js (ESM module)
// Core drawing logic and exported API for UI module
//
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let drawing = false;
let lastX = 0, lastY = 0;
let brushSize = 4;
let eraserSize = 20;
let brushColor = '#000000';
let erasing = false;
let eraserMode = 'pixel'; // 'pixel' | 'rect' | 'stroke'

const _documents = {
  whiteboard: { ops: [], history: [], historyIndex: -1, brushSize: 4, eraserSize: 20, brushColor: '#000000', erasing: false, eraserMode: 'pixel', view: { scale: 1, offsetX: 0, offsetY: 0 } },
  annotation: { ops: [], history: [], historyIndex: -1, brushSize: 4, eraserSize: 20, brushColor: '#ff0000', erasing: false, eraserMode: 'pixel', view: { scale: 1, offsetX: 0, offsetY: 0 } }
};
let _activeDocKey = 'whiteboard';

// operation log for redraw: supports strokes, erase paths, clear rects
let ops = _documents[_activeDocKey].ops;
let currentOp = null;
// points buffer & RAF for low-latency smoothed drawing
let _strokePoints = [];
let _drawPending = false;
let _lastMid = null;
let _rafId = null;
// history snapshots for undo/redo
let history = _documents[_activeDocKey].history;
let historyIndex = _documents[_activeDocKey].historyIndex;
// 减少历史快照数量以节省内存
const HISTORY_LIMIT = 30;

import Message, { EVENTS } from './message.js';
import Settings from './setting.js';
import { normalizePenTailSettings, buildPenTailSegment } from './pen_tail.js';

let _noteMeta = { createdAt: Date.now(), modifiedAt: Date.now() };

let _penTailConfig = normalizePenTailSettings({});
try{
  const _initialSettings = Settings.loadSettings();
  if (_initialSettings && typeof _initialSettings === 'object' && _initialSettings.penTail && typeof _initialSettings.penTail === 'object') {
    _penTailConfig = normalizePenTailSettings(_initialSettings.penTail);
  }
}catch(e){}

// 深拷贝并对超长笔画点数组进行下采样，防止单个操作占用过多内存
function snapshotOps(srcOps) {
  const cloned = JSON.parse(JSON.stringify(Array.isArray(srcOps) ? srcOps : []));
  for (const op of cloned) {
    if (op && op.type === 'stroke' && Array.isArray(op.points) && op.points.length > 600) {
      const maxPoints = 600;
      const step = Math.ceil(op.points.length / maxPoints);
      op.points = op.points.filter((p, i) => (i % step) === 0);
    }
  }
  return cloned;
}

function pushHistory() {
  if (historyIndex < history.length - 1) history.splice(historyIndex + 1);
  history.push(snapshotOps(ops));
  historyIndex = history.length - 1;
  if (history.length > HISTORY_LIMIT) { history.shift(); historyIndex--; }
  try{ _documents[_activeDocKey].historyIndex = historyIndex; }catch(e){}
  try{ _noteMeta.modifiedAt = Date.now(); }catch(e){}
  try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){}
}

function updateCanvasSize(){
  // 限制设备像素比，过高的 DPR 会显著增加画布像素占用（内存）。在高 DPI 屏幕上可调低以节省内存。
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const widthCss = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const heightCss = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  canvas.style.width = widthCss + 'px';
  canvas.style.height = heightCss + 'px';
  canvas.width = Math.floor(widthCss * dpr);
  canvas.height = Math.floor(heightCss * dpr);
  if (ctx.resetTransform) ctx.resetTransform(); else ctx.setTransform(1,0,0,1,0,0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

// View transform state (CSS transform applied to canvas)
let viewScale = 1;
let viewOffsetX = 0;
let viewOffsetY = 0;

// allow enabling/disabling pointer input for drawing (selection mode will disable)
let inputEnabled = true;
let multiTouchPenEnabled = false;
const touchStrokeMap = new Map();

export function setInputEnabled(enabled){ inputEnabled = !!enabled; }

export function setMultiTouchPenEnabled(enabled){
  multiTouchPenEnabled = !!enabled;
}

let _inkSeq = 0;
let _inkDebounceId = 0;
let _inkHoldId = 0;
let _inkPending = [];
let _inkPreview = null;
let _inkUi = null;
let _inkAutoConfirmId = 0;
let _activePointerId = 0;
let _inkLastScheduleAt = 0;
let _inkRecognitionEnabled = false;

export function setInkRecognitionEnabled(enabled){
  _inkRecognitionEnabled = !!enabled;
  _cancelInkTimers();
  if (!_inkRecognitionEnabled) _dismissInkPreview(false);
}

Message.on(EVENTS.SETTINGS_CHANGED, (payload)=>{
  try{
    const s = payload && typeof payload === 'object' ? payload : {};
    if (s.penTail && typeof s.penTail === 'object') {
      _penTailConfig = normalizePenTailSettings(s.penTail);
    }
  }catch(e){}
});

function applyViewTransform(){
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `translate(${viewOffsetX}px, ${viewOffsetY}px) scale(${viewScale})`;
}

export function setViewTransform(scale, offsetX, offsetY){
  viewScale = Math.max(0.1, Math.min(3.0, scale));
  viewOffsetX = Number(offsetX) || 0;
  viewOffsetY = Number(offsetY) || 0;
  try{ _documents[_activeDocKey].view = { scale: viewScale, offsetX: viewOffsetX, offsetY: viewOffsetY }; }catch(e){}
  applyViewTransform();
}

export function getViewTransform(){ return { scale: viewScale, offsetX: viewOffsetX, offsetY: viewOffsetY }; }

function screenToCanvas(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  // account for CSS view transform (translate + scale)
  const cssX = clientX - rect.left - viewOffsetX;
  const cssY = clientY - rect.top - viewOffsetY;
  const x = (cssX * scaleX) / viewScale;
  const y = (cssY * scaleY) / viewScale;
  return { x, y };
}

window.addEventListener('resize', () => { updateCanvasSize(); redrawAll(); });

function shouldUseMultiTouchStroke(e){
  return !!(multiTouchPenEnabled && inputEnabled && !erasing && e && e.pointerType === 'touch' && e.pointerId);
}

function drawBufferedStrokeSegmentFromState(state, flush = false) {
  if (!state || !state.strokePoints || state.strokePoints.length === 0) return;
  const op = state.op;
  const pts = state.strokePoints.slice();
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = (op && op.color) || '#000';
  ctx.lineWidth = (op && op.size) || 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const p = pts[0];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    ctx.restore();
    if (flush) state.strokePoints.length = 0;
    return;
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();
    state.lastMid = mid2;
  }

  if (flush && pts.length >= 2) {
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(state.lastMid ? state.lastMid.x : pts[0].x, state.lastMid ? state.lastMid.y : pts[0].y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    state.lastMid = null;
  }

  ctx.restore();
  if (flush) state.strokePoints.length = 0;
  else if (pts.length > 1) state.strokePoints = [pts[pts.length - 2], pts[pts.length - 1]];
}

function finalizeOp(op){
  if (!op) return;
  if (op.type === 'stroke' || op.type === 'erase' || op.type === 'clearRect') {
    if (op.type === 'stroke' && _penTailConfig && _penTailConfig.enabled && Array.isArray(op.points) && op.points.length >= 3) {
      try{
        const baseSize = Number(op.size) || brushSize || 1;
        const seg = buildPenTailSegment(op.points, baseSize, _penTailConfig);
        if (seg && seg.segment && Array.isArray(seg.segment) && seg.segment.length) {
          op.points = seg.segment;
        }
      }catch(e){}
    }
    ops.push(op);
    pushHistory();
    if (op.type === 'stroke') _enqueueInkRecognition(op);
  }
}

function finalizeMultiTouchStroke(e){
  const state = touchStrokeMap.get(e.pointerId);
  if (!state) return false;
  if (state.strokePoints && state.strokePoints.length > 0 && state.op && state.op.type === 'stroke') {
    drawBufferedStrokeSegmentFromState(state, true);
  }
  try { if (e && e.pointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId); } catch(err) {}
  finalizeOp(state.op);
  touchStrokeMap.delete(e.pointerId);
  return true;
}

function pointerDown(e){
  if (!inputEnabled) return;
  _inkSeq += 1;
  _inkLastScheduleAt = 0;
  _cancelInkTimers();
  _dismissInkPreview(true);
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const t = typeof e.timeStamp === 'number' ? e.timeStamp : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const p = typeof e.pressure === 'number' ? e.pressure : NaN;

  if (shouldUseMultiTouchStroke(e)) {
    const pt = { x, y, t, p };
    const op = { type: 'stroke', color: brushColor, size: brushSize, points: [pt] };
    const state = { op, lastX: x, lastY: y, strokePoints: [pt], drawPending: false, lastMid: null, rafId: null };
    touchStrokeMap.set(e.pointerId, state);
    try { if (e.pointerId && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch(err) {}
    return;
  }

  if (erasing && eraserMode === 'rect') {
    drawing = true;
    currentOp = { type: 'rectSelect', startX: x, startY: y, x: x, y: y };
    return;
  }

  if (erasing && eraserMode === 'stroke') {
    deleteStrokesAtPoint(x, y);
    drawing = true;
    return;
  }

  drawing = true;
  lastX = x; lastY = y;
  // pointer capture to avoid lost events and reduce touch-related delays
  _activePointerId = (e && e.pointerId) || 0;
  try { if (_activePointerId && canvas.setPointerCapture) canvas.setPointerCapture(_activePointerId); } catch(err) {}
  // start smoothing buffer
  _strokePoints.length = 0;
  const pt = { x, y, t, p };
  _strokePoints.push(pt);
  _lastMid = null;
  _drawPending = false;

  if (erasing && eraserMode === 'pixel') {
    currentOp = { type: 'erase', size: eraserSize, points: [pt] };
  } else {
    currentOp = { type: 'stroke', color: brushColor, size: brushSize, points: [pt] };
  }
}

function pointerMove(e){
  if (multiTouchPenEnabled && e && e.pointerType === 'touch' && e.pointerId && touchStrokeMap.has(e.pointerId)) {
    if (!inputEnabled) return;
    const state = touchStrokeMap.get(e.pointerId);
    if (!state) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const t = typeof e.timeStamp === 'number' ? e.timeStamp : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    const p = typeof e.pressure === 'number' ? e.pressure : NaN;
    if (state.op && state.op.type === 'stroke') {
      const pt = { x, y, t, p };
      state.op.points.push(pt);
      state.strokePoints.push(pt);
      if (!state.drawPending) {
        state.drawPending = true;
        state.rafId = requestAnimationFrame(() => {
          state.drawPending = false;
          drawBufferedStrokeSegmentFromState(state, false);
        });
      }
      state.lastX = x; state.lastY = y;
    }
    return;
  }

  if (!drawing) return;
  if (!inputEnabled) return;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);
  const t = typeof e.timeStamp === 'number' ? e.timeStamp : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const p = typeof e.pressure === 'number' ? e.pressure : NaN;

  if (currentOp && currentOp.type === 'rectSelect') { currentOp.x = x; currentOp.y = y; redrawAll(); drawRectOverlay(currentOp.startX, currentOp.startY, x, y); return; }
  if (erasing && eraserMode === 'stroke') { deleteStrokesAtPoint(x, y); return; }
  if (currentOp && (currentOp.type === 'stroke' || currentOp.type === 'erase')) {
    const pt = { x, y, t, p };
    currentOp.points.push(pt);
    if (currentOp.type === 'stroke') {
      _scheduleInkHoldFromMove(currentOp);
      // smoothing: store points and draw smoothed quad segments via RAF
      _strokePoints.push(pt);
      if (!_drawPending) {
        _drawPending = true;
        _rafId = requestAnimationFrame(() => {
          _drawPending = false;
          drawBufferedStrokeSegment(currentOp);
        });
      }
    } else {
      // eraser - draw immediate segment
      drawOpSegment(currentOp, lastX, lastY, x, y);
    }
    lastX = x; lastY = y;
  }
}

function pointerUp(evt){
  if (!inputEnabled) { drawing = false; return; }
  drawing = false;
  // flush any buffered stroke
  if (_strokePoints.length > 0 && currentOp && currentOp.type === 'stroke') {
    drawBufferedStrokeSegment(currentOp, true);
  }
  // release pointer capture
  try { if (evt && evt.pointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(evt.pointerId); } catch(err) {}
  _activePointerId = 0;
}

function drawBufferedStrokeSegment(op, flush = false) {
  if (!_strokePoints || _strokePoints.length === 0) return;
  // use midpoint quadratic smoothing: for pts p0,p1,p2 draw from mid(p0,p1) to mid(p1,p2) with control p1
  const pts = _strokePoints.slice();
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = op.color || '#000';
  ctx.lineWidth = op.size || 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const p = pts[0];
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    ctx.restore();
    if (flush) _strokePoints.length = 0;
    return;
  }

  let startIndex = 1;
  for (let i = startIndex; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();
    _lastMid = mid2;
  }

  if (flush && pts.length >= 2) {
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(_lastMid ? _lastMid.x : pts[0].x, _lastMid ? _lastMid.y : pts[0].y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    _lastMid = null;
  }

  ctx.restore();
  if (flush) _strokePoints.length = 0; else {
    // keep last two points for overlap
    if (pts.length > 1) {
      _strokePoints = [pts[pts.length - 2], pts[pts.length - 1]];
    }
  }
}

function finalizeCurrentOp() {
  if (!currentOp) return;
  finalizeOp(currentOp);
  currentOp = null;
}

function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const op of ops) {
    if (op.type === 'stroke') drawOp(op, 'source-over');
    else if (op.type === 'erase') drawOp(op, 'destination-out');
    else if (op.type === 'clearRect') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.restore();
    }
  }
  if (_inkPreview && Array.isArray(_inkPreview.previewOps) && _inkPreview.previewOps.length) {
    for (const op of _inkPreview.previewOps) drawPreviewOp(op);
  }
}

function drawOp(op, composite) {
  ctx.save();
  ctx.globalCompositeOperation = composite || 'source-over';
  if (op.type === 'stroke') ctx.strokeStyle = op.color || '#000';
  else ctx.strokeStyle = 'rgba(0,0,0,1)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = op.points;
  if (!pts || pts.length === 0) {
    ctx.restore();
    return;
  }
  let hasWidth = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p && typeof p.w !== 'undefined') {
      hasWidth = true;
      break;
    }
  }
  if (!hasWidth) {
    ctx.lineWidth = op.size || 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const baseSize = op.size || 1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const lw = Math.max(0.2, Number((a && a.w) || (b && b.w) || baseSize) || baseSize);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOpSegment(op, x0, y0, x1, y1) { ctx.save(); ctx.globalCompositeOperation = (op.type === 'erase') ? 'destination-out' : 'source-over'; ctx.lineWidth = op.size || 1; ctx.lineCap='round'; ctx.lineJoin='round'; if (op.type === 'stroke') ctx.strokeStyle = op.color || '#000'; else ctx.strokeStyle='rgba(0,0,0,1)'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore(); }

function drawPreviewOp(op) {
  const pts = op && op.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = (op && op.color) || '#3b82f6';
  ctx.lineWidth = (op && op.size) || 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawRectOverlay(x0,y0,x1,y1) { ctx.save(); ctx.setLineDash([6,4]); ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=1; ctx.strokeRect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0)); ctx.restore(); }

function deleteStrokesAtPoint(x,y) { const thresh = (eraserSize || 20); for (let i = ops.length-1; i>=0; i--) { const op = ops[i]; if (op.type !== 'stroke') continue; if (op.points.some(p => distance(p.x,p.y,x,y) <= thresh)) { ops.splice(i,1); } } redrawAll(); pushHistory(); }
function distance(x1,y1,x2,y2){return Math.hypot(x1-x2,y1-y2);} 

// Selection helper APIs: find ops inside rect and move/scale them
export function getOpsInRect(x0,y0,w,h){
  const ids = [];
  const rx0 = x0, ry0 = y0, rx1 = x0 + w, ry1 = y0 + h;
  for (let i=0;i<ops.length;i++){
    const op = ops[i];
    if (!op) continue;
    let bminx=Infinity,bminy=Infinity,bmaxx=-Infinity,bmaxy=-Infinity;
    if (op.points && op.points.length){
      for (const p of op.points){ bminx=Math.min(bminx,p.x); bminy=Math.min(bminy,p.y); bmaxx=Math.max(bmaxx,p.x); bmaxy=Math.max(bmaxy,p.y); }
    } else if (op.type==='clearRect'){
      bminx = op.x; bminy = op.y; bmaxx = op.x + op.w; bmaxy = op.y + op.h;
    } else continue;
    if (!(bmaxx < rx0 || bmaxy < ry0 || bminx > rx1 || bminy > ry1)) ids.push(i);
  }
  return ids;
}

export function moveOpsByIds(ids, dx, dy){
  if (!Array.isArray(ids) || ids.length===0) return;
  for (const id of ids){ const op=ops[id]; if (!op) continue; if (op.points) { for (const p of op.points){ p.x += dx; p.y += dy; } } else if (op.type==='clearRect'){ op.x += dx; op.y += dy; } }
  redrawAll(); pushHistory();
}

export function scaleOpsByIds(ids, scaleX, scaleY, originX, originY){
  if (!Array.isArray(ids) || ids.length===0) return;
  for (const id of ids){ const op=ops[id]; if (!op) continue; if (op.points) { for (const p of op.points){ p.x = originX + (p.x - originX) * scaleX; p.y = originY + (p.y - originY) * scaleY; } } else if (op.type==='clearRect'){ const nw = op.w * scaleX, nh = op.h * scaleY; op.x = originX + (op.x - originX) * scaleX; op.y = originY + (op.y - originY) * scaleY; op.w = nw; op.h = nh; } }
  redrawAll(); pushHistory();
}

// Initialize canvas and event handlers
updateCanvasSize();
canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', (e)=>{
  if (multiTouchPenEnabled && e && e.pointerType === 'touch' && e.pointerId && touchStrokeMap.has(e.pointerId)) {
    finalizeMultiTouchStroke(e);
    return;
  }
  if (currentOp && currentOp.type === 'rectSelect') {
    const x0 = Math.min(currentOp.startX, currentOp.x);
    const y0 = Math.min(currentOp.startY, currentOp.y);
    const w = Math.abs(currentOp.x - currentOp.startX);
    const h = Math.abs(currentOp.y - currentOp.startY);
    if (w>0 && h>0) { ops.push({type:'clearRect', x:x0, y:y0, w, h}); pushHistory(); }
    currentOp = null;
    redrawAll();
  } else {
    finalizeCurrentOp();
  }
  pointerUp(e);
});
canvas.addEventListener('pointerleave', (e)=>{
  if (multiTouchPenEnabled && e && e.pointerType === 'touch' && e.pointerId && touchStrokeMap.has(e.pointerId)) {
    finalizeMultiTouchStroke(e);
    return;
  }
  finalizeCurrentOp();
  pointerUp(e);
});

// Exported API for UI module
export function setBrushSize(v){ brushSize = Number(v); try{ _documents[_activeDocKey].brushSize = brushSize; }catch(e){} }
export function setEraserSize(v){ eraserSize = Number(v); try{ _documents[_activeDocKey].eraserSize = eraserSize; }catch(e){} }
export function setBrushColor(c){ brushColor = c; try{ _documents[_activeDocKey].brushColor = brushColor; }catch(e){} }
export function setErasing(b){ erasing = !!b; try{ _documents[_activeDocKey].erasing = erasing; }catch(e){} }
export function setEraserMode(m){ eraserMode = m; try{ _documents[_activeDocKey].eraserMode = eraserMode; }catch(e){} }
export function getToolState(){ return { brushColor, brushSize, eraserSize, eraserMode, erasing }; }
export function clearAll(){ ops.push({type:'clearRect', x:0, y:0, w:canvas.width, h:canvas.height}); redrawAll(); pushHistory(); }
export function undo(){ if (historyIndex <= 0) return; historyIndex -= 1; const snap = JSON.parse(JSON.stringify(history[historyIndex])); ops.length = 0; Array.prototype.push.apply(ops, snap); redrawAll(); try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){} }
export function redo(){ if (historyIndex >= history.length - 1) return; historyIndex += 1; const snap = JSON.parse(JSON.stringify(history[historyIndex])); ops.length = 0; Array.prototype.push.apply(ops, snap); redrawAll(); try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){} }

export function canUndo(){ return historyIndex > 0; }
export function canRedo(){ return historyIndex < history.length - 1; }

// initial empty history snapshot
pushHistory();

// Snapshot API for page handling
function _isAnnotationAppMode(){
  try{ return document && document.body && document.body.dataset && document.body.dataset.appMode === 'annotation'; }catch(e){ return false; }
}

export function getSnapshot(){
  if (_isAnnotationAppMode()) return [];
  return JSON.parse(JSON.stringify(ops));
}

export function loadSnapshot(snap){
  if (_isAnnotationAppMode()) return;
  ops.length = 0;
  if (Array.isArray(snap) && snap.length) {
    Array.prototype.push.apply(ops, JSON.parse(JSON.stringify(snap)));
  }
  // redraw and create a fresh history snapshot for the loaded state
  redrawAll();
  pushHistory();
}

export function getCubenoteState(){
  try{ finalizeCurrentOp(); }catch(e){}
  try{
    _documents[_activeDocKey].historyIndex = historyIndex;
    _documents[_activeDocKey].brushSize = brushSize;
    _documents[_activeDocKey].eraserSize = eraserSize;
    _documents[_activeDocKey].brushColor = brushColor;
    _documents[_activeDocKey].erasing = erasing;
    _documents[_activeDocKey].eraserMode = eraserMode;
    _documents[_activeDocKey].view = { scale: viewScale, offsetX: viewOffsetX, offsetY: viewOffsetY };
  }catch(e){}
  return {
    format: 'cubenote-state',
    schemaVersion: 1,
    meta: Object.assign({}, _noteMeta),
    activeDocKey: _activeDocKey,
    documents: {
      whiteboard: JSON.parse(JSON.stringify(_documents.whiteboard)),
      annotation: JSON.parse(JSON.stringify(_documents.annotation))
    }
  };
}

export function applyCubenoteState(state, opts){
  const s = (state && typeof state === 'object') ? state : null;
  if (!s || s.format !== 'cubenote-state' || Number(s.schemaVersion) !== 1) throw new Error('invalid cubenote state');
  const docs = s.documents && typeof s.documents === 'object' ? s.documents : null;
  if (!docs || !docs.whiteboard || !docs.annotation) throw new Error('invalid cubenote documents');
  const conflict = (opts && opts.conflict) ? String(opts.conflict) : 'overwrite';
  if (conflict === 'merge') {
    const incomingKey = (s.activeDocKey === 'annotation') ? 'annotation' : 'whiteboard';
    const incoming = docs[incomingKey];
    const incomingOps = Array.isArray(incoming && incoming.ops) ? incoming.ops : [];
    if (incomingOps.length) {
      const appended = JSON.parse(JSON.stringify(incomingOps));
      Array.prototype.push.apply(ops, appended);
      redrawAll();
      pushHistory();
    }
    return;
  }
  try{
    const wb = JSON.parse(JSON.stringify(docs.whiteboard));
    const an = JSON.parse(JSON.stringify(docs.annotation));

    _documents.whiteboard.ops = Array.isArray(wb.ops) ? wb.ops : [];
    _documents.whiteboard.history = Array.isArray(wb.history) ? wb.history : [];
    _documents.whiteboard.historyIndex = Number.isFinite(Number(wb.historyIndex)) ? Number(wb.historyIndex) : 0;
    _documents.whiteboard.brushSize = Number(wb.brushSize) || 4;
    _documents.whiteboard.eraserSize = Number(wb.eraserSize) || 20;
    _documents.whiteboard.brushColor = String(wb.brushColor || '#000000');
    _documents.whiteboard.erasing = !!wb.erasing;
    _documents.whiteboard.eraserMode = String(wb.eraserMode || 'pixel');
    _documents.whiteboard.view = wb.view && typeof wb.view === 'object'
      ? { scale: Number(wb.view.scale) || 1, offsetX: Number(wb.view.offsetX) || 0, offsetY: Number(wb.view.offsetY) || 0 }
      : { scale: 1, offsetX: 0, offsetY: 0 };

    _documents.annotation.ops = Array.isArray(an.ops) ? an.ops : [];
    _documents.annotation.history = Array.isArray(an.history) ? an.history : [];
    _documents.annotation.historyIndex = Number.isFinite(Number(an.historyIndex)) ? Number(an.historyIndex) : 0;
    _documents.annotation.brushSize = Number(an.brushSize) || 4;
    _documents.annotation.eraserSize = Number(an.eraserSize) || 20;
    _documents.annotation.brushColor = String(an.brushColor || '#ff0000');
    _documents.annotation.erasing = !!an.erasing;
    _documents.annotation.eraserMode = String(an.eraserMode || 'pixel');
    _documents.annotation.view = an.view && typeof an.view === 'object'
      ? { scale: Number(an.view.scale) || 1, offsetX: Number(an.view.offsetX) || 0, offsetY: Number(an.view.offsetY) || 0 }
      : { scale: 1, offsetX: 0, offsetY: 0 };

    _activeDocKey = (s.activeDocKey === 'annotation') ? 'annotation' : 'whiteboard';
    _ensureDocInitialized('whiteboard');
    _ensureDocInitialized('annotation');
    _loadDocState(_activeDocKey);

    if (s.meta && typeof s.meta === 'object') {
      const ca = Number(s.meta.createdAt || 0) || Date.now();
      const ma = Number(s.meta.modifiedAt || 0) || Date.now();
      _noteMeta = { createdAt: ca, modifiedAt: ma };
    } else {
      _noteMeta = { createdAt: Date.now(), modifiedAt: Date.now() };
    }

    redrawAll();
    try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){}
  }catch(e){
    throw e;
  }
}

// Replace stroke colors in all operations (for canvas color theme switching)
export function replaceStrokeColors(oldColor, newColor){
  const normalize = (c) => c.toLowerCase();
  const oldNorm = normalize(oldColor);
  const newNorm = normalize(newColor);
  if (oldNorm === newNorm) return; // no change needed
  
  // Replace in current operations
  ops.forEach(op => {
    if (op && op.type === 'stroke' && op.color && normalize(op.color) === oldNorm) {
      op.color = newColor;
    }
  });
  
  // Replace in history snapshots
  history.forEach(snap => {
    snap.forEach(op => {
      if (op && op.type === 'stroke' && op.color && normalize(op.color) === oldNorm) {
        op.color = newColor;
      }
    });
  });
  
  redrawAll();
}

function _cancelInkTimers(){
  if (_inkDebounceId) { try{ clearTimeout(_inkDebounceId); }catch(e){} _inkDebounceId = 0; }
  if (_inkHoldId) { try{ clearTimeout(_inkHoldId); }catch(e){} _inkHoldId = 0; }
}

function _dismissInkPreview(keepPending){
  if (_inkAutoConfirmId) { try{ clearTimeout(_inkAutoConfirmId); }catch(e){} _inkAutoConfirmId = 0; }
  const hadPreview = !!_inkPreview;
  if (_inkUi && _inkUi.parentElement) {
    try{ _inkUi.classList.remove('open'); }catch(e){}
  }
  _inkPreview = null;
  if (!keepPending) _inkPending = [];
  if (hadPreview) redrawAll();
}

function _ensureInkUi(){
  if (_inkUi) return _inkUi;
  const wrap = document.createElement('div');
  wrap.className = 'recognition-ui';
  wrap.innerHTML = `<button type="button" data-action="confirm">确认</button><button type="button" data-action="cancel">取消</button>`;
  wrap.addEventListener('click', (e)=>{
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    const act = btn.dataset && btn.dataset.action;
    if (act === 'confirm') _confirmInkPreview();
    else if (act === 'cancel') _dismissInkPreview(false);
  });
  document.body.appendChild(wrap);
  _inkUi = wrap;
  return _inkUi;
}

function _positionInkUiAtInternalPoint(p){
  try{
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + (p.x / canvas.width) * rect.width;
    const y = rect.top + (p.y / canvas.height) * rect.height;
    const ui = _ensureInkUi();
    const pad = 10;
    ui.style.left = Math.max(pad, Math.min(window.innerWidth - pad, x)) + 'px';
    ui.style.top = Math.max(pad, Math.min(window.innerHeight - pad, y)) + 'px';
    ui.classList.add('open');
  }catch(e){}
}

function _confirmInkPreview(){
  if (!_inkPreview || !_inkPreview.replacements || _inkPreview.replacements.length === 0) { _dismissInkPreview(false); return; }
  const reps = _inkPreview.replacements.slice();
  for (const r of reps) {
    const idx = ops.indexOf(r.opRef);
    if (idx >= 0) ops[idx] = r.newOp;
  }
  _dismissInkPreview(true);
  pushHistory();
}

function _enqueueInkRecognition(opRef){
  if (!_inkRecognitionEnabled) return;
  if (!opRef || opRef.type !== 'stroke' || !Array.isArray(opRef.points) || opRef.points.length < 5) return;
  _inkPending.push({ opRef });
  const seqAtSchedule = _inkSeq;
  _cancelInkTimers();
  _inkDebounceId = setTimeout(()=>{
    if (seqAtSchedule !== _inkSeq) return;
    _inkHoldId = setTimeout(()=>{
      if (seqAtSchedule !== _inkSeq) return;
      _runInkRecognition();
    }, 2000);
  }, 300);
}

function _runInkRecognition(){
  if (!_inkRecognitionEnabled) return;
  if (!_inkPending || _inkPending.length === 0) return;
  const candidates = _inkPending.slice();
  _inkPending = [];

  const replacements = [];
  const previewOps = [];
  let anchor = null;

  for (const c of candidates) {
    const op = c && c.opRef;
    if (!op || op.type !== 'stroke' || !Array.isArray(op.points) || op.points.length < 5) continue;
    const res = _recognizeInk(op.points);
    if (!res) continue;
    const newOp = { type: 'stroke', color: op.color, size: op.size, points: res.pointsInternal };
    const previewOp = { type: 'stroke', color: '#3b82f6', size: Math.max(2, Number(op.size) || 2), points: res.pointsInternal };
    replacements.push({ opRef: op, newOp });
    previewOps.push(previewOp);
    anchor = (op.points && op.points.length) ? op.points[op.points.length - 1] : anchor;
  }

  if (replacements.length === 0) return;

  _inkPreview = { replacements, previewOps };
  redrawAll();
  if (anchor) _positionInkUiAtInternalPoint(anchor);
  if (_inkAutoConfirmId) { try{ clearTimeout(_inkAutoConfirmId); }catch(e){} }
  _inkAutoConfirmId = setTimeout(()=>{ _confirmInkPreview(); }, 1500);
}

function _recognizeInk(pointsInternal){
  const sampledInternal = _downsampleInternalPoints(pointsInternal, 256);
  const pts = _toDipPoints(sampledInternal);
  if (!pts || pts.length < 5) return null;
  const pathLen = _pathLength(pts);
  if (pathLen <= 0.01) return null;

  const line = _tryLine(pts);
  if (line) return { kind: 'line', pointsInternal: _fromDipPoints(line) };

  const circle = _tryCircle(pts, pathLen);
  if (circle) return { kind: 'circle', pointsInternal: _fromDipPoints(circle) };

  const rect = _tryPolygon(pts, 4, pathLen);
  if (rect) return { kind: 'rect', pointsInternal: _fromDipPoints(rect) };

  const tri = _tryPolygon(pts, 3, pathLen);
  if (tri) return { kind: 'tri', pointsInternal: _fromDipPoints(tri) };

  return null;
}

function _downsampleInternalPoints(pointsInternal, maxPoints){
  const pts = Array.isArray(pointsInternal) ? pointsInternal : [];
  const n = pts.length;
  const maxN = Math.max(5, Number(maxPoints) || 256);
  if (n <= maxN) return pts;
  const step = Math.ceil(n / maxN);
  const out = [];
  out.push(pts[0]);
  for (let i = step; i < n - 1; i += step) out.push(pts[i]);
  out.push(pts[n - 1]);
  return out.length >= 5 ? out : pts.slice(0, 5);
}

function _scheduleInkHoldFromMove(opRef){
  if (!_inkRecognitionEnabled) return;
  if (!opRef || opRef.type !== 'stroke' || !Array.isArray(opRef.points) || opRef.points.length < 5) return;
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - _inkLastScheduleAt < 80) return;
  _inkLastScheduleAt = now;
  const seqAtSchedule = _inkSeq;
  _cancelInkTimers();
  _inkDebounceId = setTimeout(()=>{
    if (seqAtSchedule !== _inkSeq) return;
    _inkHoldId = setTimeout(()=>{
      if (seqAtSchedule !== _inkSeq) return;
      if (!drawing) return;
      if (currentOp !== opRef) return;
      _finalizeCurrentStrokeFromHold();
    }, 2000);
  }, 300);
}

function _finalizeCurrentStrokeFromHold(){
  if (!_inkRecognitionEnabled) return;
  if (!drawing) return;
  if (!currentOp || currentOp.type !== 'stroke') return;
  drawing = false;
  try { if (_activePointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(_activePointerId); } catch(e) {}
  _activePointerId = 0;
  finalizeCurrentOp();
  _cancelInkTimers();
  _runInkRecognition();
}

function _getUnscaledCssSize(){
  const rect = canvas.getBoundingClientRect();
  const s = Math.max(0.0001, viewScale || 1);
  return { w: rect.width / s, h: rect.height / s };
}

function _toDipPoints(pointsInternal){
  const size = _getUnscaledCssSize();
  const sx = size.w / canvas.width;
  const sy = size.h / canvas.height;
  const out = new Array(pointsInternal.length);
  for (let i = 0; i < pointsInternal.length; i++) {
    const p = pointsInternal[i];
    out[i] = { x: (p.x * sx), y: (p.y * sy) };
  }
  return out;
}

function _fromDipPoints(pointsDip){
  const size = _getUnscaledCssSize();
  const sx = canvas.width / size.w;
  const sy = canvas.height / size.h;
  const out = new Array(pointsDip.length);
  for (let i = 0; i < pointsDip.length; i++) {
    const p = pointsDip[i];
    out[i] = { x: (p.x * sx), y: (p.y * sy) };
  }
  return out;
}

function _pathLength(pts){
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
  return len;
}

function _bbox(pts){
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (!p) continue; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function _resample(pts, count){
  if (!pts || pts.length === 0) return [];
  if (pts.length === 1) return [pts[0]];
  const total = _pathLength(pts);
  if (total <= 0.001) return [{ x: pts[0].x, y: pts[0].y }];
  const step = total / (count - 1);
  const out = new Array(count);
  out[0] = { x: pts[0].x, y: pts[0].y };
  let distSoFar = 0;
  let target = step;
  let oi = 1;
  for (let i = 1; i < pts.length && oi < count - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (seg <= 0.0001) continue;
    while (distSoFar + seg >= target && oi < count - 1) {
      const t = (target - distSoFar) / seg;
      out[oi++] = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      target += step;
    }
    distSoFar += seg;
  }
  out[oi++] = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
  return out.slice(0, oi);
}

function _angleDegBetween(v1, v2){
  const a = Math.hypot(v1.x, v1.y);
  const b = Math.hypot(v2.x, v2.y);
  if (a <= 0.0001 || b <= 0.0001) return 0;
  const dot = (v1.x * v2.x + v1.y * v2.y) / (a * b);
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.acos(clamped) * 180 / Math.PI;
}

function _tryLine(pts){
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const d = Math.hypot(dx, dy);
  if (d < 20) return null;

  let meanX = 0, meanY = 0;
  for (const p of pts) { meanX += p.x; meanY += p.y; }
  meanX /= pts.length; meanY /= pts.length;
  let covXX = 0, covYY = 0, covXY = 0;
  for (const p of pts) {
    const ux = p.x - meanX;
    const uy = p.y - meanY;
    covXX += ux * ux;
    covYY += uy * uy;
    covXY += ux * uy;
  }
  covXX /= pts.length; covYY /= pts.length; covXY /= pts.length;
  const theta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  let avgDist = 0;
  for (const p of pts) {
    const vx = p.x - meanX;
    const vy = p.y - meanY;
    const proj = vx * dir.x + vy * dir.y;
    const px = meanX + proj * dir.x;
    const py = meanY + proj * dir.y;
    avgDist += Math.hypot(p.x - px, p.y - py);
  }
  avgDist /= pts.length;

  const endAngle = Math.atan2(dy, dx);
  const fitAngle = Math.atan2(dir.y, dir.x);
  let diff = Math.abs((endAngle - fitAngle) * 180 / Math.PI);
  while (diff > 180) diff -= 180;
  if (diff > 90) diff = 180 - diff;

  if (avgDist > 5) return null;
  if (diff > 3) return null;
  return [first, last];
}

function _tryCircle(pts, pathLen){
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closure = 1 - (Math.hypot(last.x - first.x, last.y - first.y) / Math.max(1, pathLen || _pathLength(pts)));
  if (closure < 0.9) return null;

  const b = _bbox(pts);
  const ar = b.h > 0 ? (b.w / b.h) : 0;
  if (ar < 0.75 || ar > 1.33) return null;
  if (Math.max(b.w, b.h) < 20) return null;

  let meanX = 0, meanY = 0;
  for (const p of pts) { meanX += p.x; meanY += p.y; }
  meanX /= pts.length; meanY /= pts.length;
  let Suu = 0, Suv = 0, Svv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const p of pts) {
    const u = p.x - meanX;
    const v = p.y - meanY;
    const uu = u * u;
    const vv = v * v;
    Suu += uu;
    Svv += vv;
    Suv += u * v;
    Suuu += uu * u;
    Svvv += vv * v;
    Suvv += u * vv;
    Svuu += v * uu;
  }
  const det = (Suu * Svv - Suv * Suv);
  if (Math.abs(det) < 1e-6) return null;
  const rhs1 = 0.5 * (Suuu + Suvv);
  const rhs2 = 0.5 * (Svvv + Svuu);
  const uc = (rhs1 * Svv - rhs2 * Suv) / det;
  const vc = (rhs2 * Suu - rhs1 * Suv) / det;
  const cx = meanX + uc;
  const cy = meanY + vc;
  let r = 0;
  for (const p of pts) r += Math.hypot(p.x - cx, p.y - cy);
  r /= pts.length;
  if (!(r > 5)) return null;

  let err = 0;
  for (const p of pts) {
    const dr = Math.hypot(p.x - cx, p.y - cy) - r;
    err += dr * dr;
  }
  err = Math.sqrt(err / pts.length);
  if (err > Math.max(3, r * 0.12)) return null;

  const steps = 64;
  const out = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
  return out;
}

function _tryPolygon(pts, cornersExpected, pathLen){
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closure = 1 - (Math.hypot(last.x - first.x, last.y - first.y) / Math.max(1, pathLen || _pathLength(pts)));
  if (closure < 0.88) return null;
  const sample = _resample(pts, 64);
  if (sample.length < 10) return null;

  const turns = [];
  for (let i = 1; i < sample.length - 1; i++) {
    const a = sample[i - 1], b = sample[i], c = sample[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const ang = _angleDegBetween(v1, v2);
    if (ang > 35) turns.push({ i, ang });
  }
  if (turns.length < cornersExpected) return null;
  turns.sort((p, q) => q.ang - p.ang);
  const picked = [];
  const minSep = Math.floor(sample.length / (cornersExpected * 2));
  for (const t of turns) {
    if (picked.length >= cornersExpected) break;
    if (picked.some(p => Math.abs(p.i - t.i) < minSep)) continue;
    picked.push(t);
  }
  if (picked.length !== cornersExpected) return null;
  picked.sort((p, q) => p.i - q.i);
  const verts = picked.map(p => sample[p.i]);

  if (cornersExpected === 4) {
    const edges = [];
    for (let k = 0; k < 4; k++) {
      const p0 = verts[k];
      const p1 = verts[(k + 1) % 4];
      edges.push({ x: p1.x - p0.x, y: p1.y - p0.y });
    }
    const ang01 = _angleDegBetween(edges[0], edges[1]);
    const ang12 = _angleDegBetween(edges[1], edges[2]);
    const ang23 = _angleDegBetween(edges[2], edges[3]);
    const ang30 = _angleDegBetween(edges[3], edges[0]);
    const okA = (Math.abs(ang01 - 90) <= 25) && (Math.abs(ang12 - 90) <= 25) && (Math.abs(ang23 - 90) <= 25) && (Math.abs(ang30 - 90) <= 25);
    if (!okA) return null;
    const a02 = _angleDegBetween(edges[0], edges[2]);
    const a13 = _angleDegBetween(edges[1], edges[3]);
    if (Math.min(a02, 180 - a02) > 20) return null;
    if (Math.min(a13, 180 - a13) > 20) return null;

    const rot = Math.atan2(edges[0].y, edges[0].x);
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      const rx = (p.x * cos - p.y * sin);
      const ry = (p.x * sin + p.y * cos);
      minX = Math.min(minX, rx);
      minY = Math.min(minY, ry);
      maxX = Math.max(maxX, rx);
      maxY = Math.max(maxY, ry);
    }
    const rect = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY }
    ];
    const cos2 = Math.cos(rot), sin2 = Math.sin(rot);
    return rect.map(p => ({ x: (p.x * cos2 - p.y * sin2), y: (p.x * sin2 + p.y * cos2) }));
  }

  if (cornersExpected === 3) {
    const a = verts[0], b = verts[1], c = verts[2];
    const tri = [a, b, c, a];
    const bb = _bbox(tri);
    if (Math.max(bb.w, bb.h) < 20) return null;
    return tri;
  }
  return null;
}

function _loadDocState(key){
  const doc = _documents[key];
  if (!doc) return;
  ops = doc.ops;
  history = doc.history;
  historyIndex = doc.historyIndex;
  brushSize = doc.brushSize;
  eraserSize = doc.eraserSize;
  brushColor = doc.brushColor;
  erasing = doc.erasing;
  eraserMode = doc.eraserMode;
  viewScale = (doc.view && doc.view.scale) || 1;
  viewOffsetX = (doc.view && doc.view.offsetX) || 0;
  viewOffsetY = (doc.view && doc.view.offsetY) || 0;
  applyViewTransform();
}

function _ensureDocInitialized(key){
  const doc = _documents[key];
  if (!doc) return;
  if (Array.isArray(doc.history) && doc.history.length > 0 && doc.historyIndex >= 0) return;
  doc.history.length = 0;
  doc.history.push(snapshotOps(doc.ops));
  doc.historyIndex = 0;
}

export function setCanvasMode(mode){
  const next = mode === 'annotation' ? 'annotation' : 'whiteboard';
  if (next === _activeDocKey) return;
  try{ finalizeCurrentOp(); }catch(e){}
  try{ drawing = false; currentOp = null; _strokePoints.length = 0; }catch(e){}
  try{ touchStrokeMap.clear(); }catch(e){}
  try{
    _documents[_activeDocKey].historyIndex = historyIndex;
    _documents[_activeDocKey].brushSize = brushSize;
    _documents[_activeDocKey].eraserSize = eraserSize;
    _documents[_activeDocKey].brushColor = brushColor;
    _documents[_activeDocKey].erasing = erasing;
    _documents[_activeDocKey].eraserMode = eraserMode;
    _documents[_activeDocKey].view = { scale: viewScale, offsetX: viewOffsetX, offsetY: viewOffsetY };
  }catch(e){}
  _activeDocKey = next;
  _ensureDocInitialized(_activeDocKey);
  _loadDocState(_activeDocKey);
  redrawAll();
  try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){}
}

_ensureDocInitialized('whiteboard');
_ensureDocInitialized('annotation');
_loadDocState('whiteboard');
