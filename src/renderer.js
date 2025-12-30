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
// brush appearance: normal vs chalk
let chalkMode = false;

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

window.addEventListener('resize', () => { updateCanvasSize(); redrawAll(); });

function pointerDown(e){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

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
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

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
  ctx.lineWidth = op.size || 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // chalk effect: draw multiple slightly jittered semi-transparent passes
  const drawPass = (strokeStyle, alpha, jitter) => {
    ctx.strokeStyle = strokeStyle;
    ctx.globalAlpha = alpha;
    if (!jitter) {
      // non-jittered pass
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
      return;
    }
    for (let i = startIndex; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const mid1 = { x: (p0.x + p1.x) / 2 + (Math.random() - 0.5) * jitter, y: (p0.y + p1.y) / 2 + (Math.random() - 0.5) * jitter };
      const mid2 = { x: (p1.x + p2.x) / 2 + (Math.random() - 0.5) * jitter, y: (p1.y + p2.y) / 2 + (Math.random() - 0.5) * jitter };
      ctx.beginPath();
      ctx.moveTo(mid1.x, mid1.y);
      ctx.quadraticCurveTo(p1.x + (Math.random() - 0.5) * jitter, p1.y + (Math.random() - 0.5) * jitter, mid2.x, mid2.y);
      ctx.stroke();
      _lastMid = mid2;
    }
  };

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
  ctx.strokeStyle = op.color || '#000';
  if (chalkMode) {
    // multiple passes for chalky appearance
    drawPass(op.color || '#000', 0.85, 0); // base pass
    drawPass(op.color || '#000', 0.25, Math.max(1, (op.size || 1) * 0.8));
    drawPass(op.color || '#000', 0.12, Math.max(1, (op.size || 1) * 1.6));
  } else {
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

// normalize common color formats to 6-char lowercase hex
function normalizeColorToHex(c){
  if (!c || typeof c !== 'string') return c;
  c = c.trim().toLowerCase();
  if (c[0] === '#'){
    if (c.length === 4) { // #abc -> #aabbcc
      return '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
    }
    if (c.length === 7) return c;
    return c; // unknown lengths
  }
  const rgb = c.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(',').map(p=>parseInt(p,10) || 0);
    const r = (parts[0] & 0xFF).toString(16).padStart(2,'0');
    const g = (parts[1] & 0xFF).toString(16).padStart(2,'0');
    const b = (parts[2] & 0xFF).toString(16).padStart(2,'0');
    return ('#'+r+g+b).toLowerCase();
  }
  return c;
}

// remap historical stroke colors according to simple rules (black<->white conversions)
export function remapHistoryForCanvas(canvasName){
  try{
    const mapping = {};
    if (canvasName === 'white') mapping['#ffffff'] = '#000000';
    else if (canvasName === 'black') mapping['#000000'] = '#ffffff';
    else if (canvasName === 'chalkboard') mapping['#000000'] = '#ffffff';
    const normMap = {};
    Object.keys(mapping).forEach(k=>{ normMap[normalizeColorToHex(k)] = mapping[k]; });
    let changed = false;
    for (const op of ops){
      if (op && op.type === 'stroke' && op.color){
        const n = normalizeColorToHex(op.color);
        if (normMap[n]){ op.color = normMap[n]; changed = true; }
      }
    }
    if (changed){ redrawAll(); pushHistory(); try{ Message.emit(EVENTS.HISTORY_CHANGED, { canUndo: canUndo(), canRedo: canRedo() }); }catch(e){} }
  }catch(e){ console.warn('remapHistoryForCanvas failed', e); }
}

export function setBrushAppearance(mode){
  try{ chalkMode = (mode === 'chalk'); }catch(e){}
}

function finalizeCurrentOp() { if (!currentOp) return; if (currentOp.type === 'stroke' || currentOp.type === 'erase' || currentOp.type === 'clearRect') { ops.push(currentOp); pushHistory(); } currentOp = null; }

function redrawAll() { ctx.clearRect(0, 0, canvas.width, canvas.height); for (const op of ops) { if (op.type === 'stroke') drawOp(op, 'source-over'); else if (op.type === 'erase') drawOp(op, 'destination-out'); else if (op.type === 'clearRect') { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fillRect(op.x, op.y, op.w, op.h); ctx.restore(); } } }

function drawOp(op, composite) {
  ctx.save();
  ctx.globalCompositeOperation = composite || 'source-over';
  ctx.lineWidth = op.size || 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pts = op.points;
  if (!pts || pts.length === 0) { ctx.restore(); return; }
  if (op.type === 'stroke') {
    if (chalkMode) {
      // base pass
      ctx.globalAlpha = 0.9; ctx.strokeStyle = op.color || '#000';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      // jittered light passes
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? 0.22 : 0.12;
        ctx.beginPath(); ctx.moveTo(pts[0].x + (Math.random() - 0.5) * (op.size || 1), pts[0].y + (Math.random() - 0.5) * (op.size || 1));
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x + (Math.random() - 0.5) * (op.size || 1.5), pts[i].y + (Math.random() - 0.5) * (op.size || 1.5));
        }
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = op.color || '#000';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  } else {
    // erase or other path-based operations
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOpSegment(op, x0, y0, x1, y1) { ctx.save(); ctx.globalCompositeOperation = (op.type === 'erase') ? 'destination-out' : 'source-over'; ctx.lineWidth = op.size || 1; ctx.lineCap='round'; ctx.lineJoin='round'; if (op.type === 'stroke') ctx.strokeStyle = op.color || '#000'; else ctx.strokeStyle='rgba(0,0,0,1)'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore(); }

function drawRectOverlay(x0,y0,x1,y1) { ctx.save(); ctx.setLineDash([6,4]); ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=1; ctx.strokeRect(Math.min(x0,x1), Math.min(y0,y1), Math.abs(x1-x0), Math.abs(y1-y0)); ctx.restore(); }

function deleteStrokesAtPoint(x,y) { const thresh = (eraserSize || 20); for (let i = ops.length-1; i>=0; i--) { const op = ops[i]; if (op.type !== 'stroke') continue; if (op.points.some(p => distance(p.x,p.y,x,y) <= thresh)) { ops.splice(i,1); } } redrawAll(); pushHistory(); }
function distance(x1,y1,x2,y2){return Math.hypot(x1-x2,y1-y2);} 

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
