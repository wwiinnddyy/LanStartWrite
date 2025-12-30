// renderer.js (ESM module)
// Core drawing logic and exported API for UI module

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

let drawing = false;
let lastX = 0, lastY = 0;
let brushSize = 4;
let eraserSize = 20;
let brushColor = '#000000';
let erasing = false;
let eraserMode = 'pixel'; // 'pixel' | 'rect' | 'stroke'

// operation log for redraw: supports strokes, erase paths, clear rects
const ops = [];
let currentOp = null;
// points buffer & RAF for low-latency smoothed drawing
let _strokePoints = [];
let _drawPending = false;
let _lastMid = null;
let _rafId = null;
// history snapshots for undo/redo
const history = [];
let historyIndex = -1;
// 减少历史快照数量以节省内存
const HISTORY_LIMIT = 30;

import Message, { EVENTS } from './message.js';

// 深拷贝并对超长笔画点数组进行下采样，防止单个操作占用过多内存
function snapshotOps() {
  const cloned = JSON.parse(JSON.stringify(ops));
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
  history.push(snapshotOps());
  historyIndex = history.length - 1;
  if (history.length > HISTORY_LIMIT) { history.shift(); historyIndex--; }
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

export function setInputEnabled(enabled){ inputEnabled = !!enabled; }

function applyViewTransform(){
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `translate(${viewOffsetX}px, ${viewOffsetY}px) scale(${viewScale})`;
}

export function setViewTransform(scale, offsetX, offsetY){
  viewScale = Math.max(0.1, Math.min(3.0, scale));
  viewOffsetX = Number(offsetX) || 0;
  viewOffsetY = Number(offsetY) || 0;
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

function pointerDown(e){
  if (!inputEnabled) return;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);

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
  try { if (e.pointerId && canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch(err) {}
  // start smoothing buffer
  _strokePoints.length = 0;
  _strokePoints.push({x, y});
  _lastMid = null;
  _drawPending = false;

  if (erasing && eraserMode === 'pixel') {
    currentOp = { type: 'erase', size: eraserSize, points: [{x, y}] };
  } else {
    currentOp = { type: 'stroke', color: brushColor, size: brushSize, points: [{x, y}] };
  }
}

function pointerMove(e){
  if (!drawing) return;
  if (!inputEnabled) return;
  const { x, y } = screenToCanvas(e.clientX, e.clientY);

  if (currentOp && currentOp.type === 'rectSelect') { currentOp.x = x; currentOp.y = y; redrawAll(); drawRectOverlay(currentOp.startX, currentOp.startY, x, y); return; }
  if (erasing && eraserMode === 'stroke') { deleteStrokesAtPoint(x, y); return; }
  if (currentOp && (currentOp.type === 'stroke' || currentOp.type === 'erase')) {
    currentOp.points.push({x, y});
    if (currentOp.type === 'stroke') {
      // smoothing: store points and draw smoothed quad segments via RAF
      _strokePoints.push({x, y});
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

function finalizeCurrentOp() { if (!currentOp) return; if (currentOp.type === 'stroke' || currentOp.type === 'erase' || currentOp.type === 'clearRect') { ops.push(currentOp); pushHistory(); } currentOp = null; }

function redrawAll() { ctx.clearRect(0, 0, canvas.width, canvas.height); for (const op of ops) { if (op.type === 'stroke') drawOp(op, 'source-over'); else if (op.type === 'erase') drawOp(op, 'destination-out'); else if (op.type === 'clearRect') { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(op.x, op.y, op.w, op.h); ctx.restore(); } } }

function drawOp(op, composite) { ctx.save(); ctx.globalCompositeOperation = composite || 'source-over'; if (op.type === 'stroke') ctx.strokeStyle = op.color || '#000'; else ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = op.size || 1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); const pts = op.points; if (!pts || pts.length === 0) { ctx.restore(); return; } ctx.moveTo(pts[0].x, pts[0].y); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); ctx.restore(); }

function drawOpSegment(op, x0, y0, x1, y1) { ctx.save(); ctx.globalCompositeOperation = (op.type === 'erase') ? 'destination-out' : 'source-over'; ctx.lineWidth = op.size || 1; ctx.lineCap='round'; ctx.lineJoin='round'; if (op.type === 'stroke') ctx.strokeStyle = op.color || '#000'; else ctx.strokeStyle='rgba(0,0,0,1)'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore(); }

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
canvas.addEventListener('pointerup', (e)=>{ if (currentOp && currentOp.type === 'rectSelect') { const x0 = Math.min(currentOp.startX, currentOp.x); const y0 = Math.min(currentOp.startY, currentOp.y); const w = Math.abs(currentOp.x - currentOp.startX); const h = Math.abs(currentOp.y - currentOp.startY); if (w>0 && h>0) { ops.push({type:'clearRect', x:x0, y:y0, w, h}); pushHistory(); } currentOp = null; redrawAll(); } else { finalizeCurrentOp(); } pointerUp(e); });
canvas.addEventListener('pointerleave', (e)=>{ finalizeCurrentOp(); pointerUp(e); });

// Exported API for UI module
export function setBrushSize(v){ brushSize = Number(v); }
export function setEraserSize(v){ eraserSize = Number(v); }
export function setBrushColor(c){ brushColor = c; }
export function setErasing(b){ erasing = !!b; }
export function setEraserMode(m){ eraserMode = m; }
export function getToolState(){ return { brushColor, brushSize, eraserSize, eraserMode, erasing }; }
export function clearAll(){ ops.push({type:'clearRect', x:0, y:0, w:canvas.width, h:canvas.height}); redrawAll(); pushHistory(); }
export function undo(){ if (historyIndex <= 0) return; historyIndex -= 1; const snap = JSON.parse(JSON.stringify(history[historyIndex])); ops.length = 0; Array.prototype.push.apply(ops, snap); redrawAll(); try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){} }
export function redo(){ if (historyIndex >= history.length - 1) return; historyIndex += 1; const snap = JSON.parse(JSON.stringify(history[historyIndex])); ops.length = 0; Array.prototype.push.apply(ops, snap); redrawAll(); try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){} }

export function canUndo(){ return historyIndex > 0; }
export function canRedo(){ return historyIndex < history.length - 1; }

// initial empty history snapshot
pushHistory();

// Snapshot API for page handling
export function getSnapshot(){
  return JSON.parse(JSON.stringify(ops));
}

export function loadSnapshot(snap){
  ops.length = 0;
  if (Array.isArray(snap) && snap.length) {
    Array.prototype.push.apply(ops, JSON.parse(JSON.stringify(snap)));
  }
  // redraw and create a fresh history snapshot for the loaded state
  redrawAll();
  pushHistory();
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
