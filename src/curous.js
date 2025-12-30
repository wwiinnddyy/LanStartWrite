// curous.js
// Simple selection/pan/zoom module for the whiteboard

import * as R from './renderer.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 3.0;

let canvas = null;
let overlay = null;
let selBox = null;
let handles = null;
let selectedIds = [];
let selecting = false;
let selectStart = null;
let selectionBounds = null;
let draggingSelection = false;
let dragStart = null;
let draggingHandle = null;
let pointerMap = new Map();
let pinchState = null;
let selectionEnabled = false;

function ensureOverlay(){
  if (overlay) return;
  canvas = document.getElementById('board');
  const parent = canvas.parentElement || document.body;
  overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right = '0'; overlay.style.bottom = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = 50;
  parent.appendChild(overlay);

  selBox = document.createElement('div');
  selBox.style.position = 'absolute';
  selBox.style.border = '2px dashed rgba(0,0,0,0.6)';
  selBox.style.background = 'rgba(0,0,0,0.03)';
  selBox.style.display = 'none';
  selBox.style.pointerEvents = 'auto';
  overlay.appendChild(selBox);

  handles = {};
  const names = ['nw','ne','se','sw','n','e','s','w'];
  for (const n of names){
    const h = document.createElement('div');
    h.className = 'curous-handle ' + n;
    h.style.position = 'absolute';
    h.style.width = '12px'; h.style.height = '12px'; h.style.background='white'; h.style.border='2px solid rgba(0,0,0,0.6)';
    h.style.borderRadius='2px'; h.style.boxSizing='border-box'; h.style.pointerEvents='auto';
    h.dataset.handle = n;
    h.style.display = 'none';
    overlay.appendChild(h);
    handles[n] = h;
  }
}

function toCssPos(x,y){
  // map canvas internal coordinates to CSS pixels for overlay placement
  const rect = canvas.getBoundingClientRect();
  const v = R.getViewTransform();
  const scaleX = rect.width / canvas.width;
  const cssX = (x * v.scale) * scaleX + rect.left + v.offsetX;
  const cssY = (y * v.scale) * (rect.height / canvas.height) + rect.top + v.offsetY;
  return { left: cssX, top: cssY };
}

function computeSelectionBounds(ids){
  if (!ids || ids.length===0) return null;
  let bminx=Infinity,bminy=Infinity,bmaxx=-Infinity,bmaxy=-Infinity;
  for (const id of ids){ const op = R.getSnapshot()[id]; if (!op) continue; if (op.points && op.points.length){ for (const p of op.points){ bminx=Math.min(bminx,p.x); bminy=Math.min(bminy,p.y); bmaxx=Math.max(bmaxx,p.x); bmaxy=Math.max(bmaxy,p.y); } } else if (op.type==='clearRect'){ bminx=Math.min(bminx,op.x); bminy=Math.min(bminy,op.y); bmaxx=Math.max(bmaxx,op.x+op.w); bmaxy=Math.max(bmaxy,op.y+op.h); } }
  if (bminx===Infinity) return null;
  return { x: bminx, y: bminy, w: bmaxx-bminx, h: bmaxy-bminy };
}

function showSelectionBox(bounds){
  if (!bounds){ selBox.style.display='none'; for (const k in handles) handles[k].style.display='none'; return; }
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const v = R.getViewTransform();
  const left = rect.left + v.offsetX + bounds.x * v.scale * scaleX;
  const top = rect.top + v.offsetY + bounds.y * v.scale * scaleY;
  const w = bounds.w * v.scale * scaleX;
  const h = bounds.h * v.scale * scaleY;
  selBox.style.left = left + 'px'; selBox.style.top = top + 'px'; selBox.style.width = Math.max(2,w) + 'px'; selBox.style.height = Math.max(2,h) + 'px'; selBox.style.display = 'block';
  // handles
  const hs = {
    nw: { left: left - 8, top: top - 8 },
    ne: { left: left + w - 4, top: top - 8 },
    se: { left: left + w - 4, top: top + h - 4 },
    sw: { left: left - 8, top: top + h - 4 },
    n: { left: left + w/2 - 6, top: top - 8 },
    e: { left: left + w - 4, top: top + h/2 - 6 },
    s: { left: left + w/2 - 6, top: top + h - 4 },
    w: { left: left - 8, top: top + h/2 - 6 }
  };
  for (const k in handles){ const h=handles[k]; h.style.left = hs[k].left + 'px'; h.style.top = hs[k].top + 'px'; h.style.display='block'; }
}

function canvasClientToCanvasInternal(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const v = R.getViewTransform();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cssX = clientX - rect.left - v.offsetX;
  const cssY = clientY - rect.top - v.offsetY;
  const x = (cssX * scaleX) / v.scale;
  const y = (cssY * scaleY) / v.scale;
  return { x, y };
}

function onPointerDown(e){
  if (!selectionEnabled) return;
  if (e.pointerType === 'touch'){
    pointerMap.set(e.pointerId, e);
    if (pointerMap.size === 2){
      // start pinch
      const arr = Array.from(pointerMap.values());
      pinchState = { a: arr[0], b: arr[1], startDist: Math.hypot(arr[0].clientX-arr[1].clientX, arr[0].clientY-arr[1].clientY), startView: R.getViewTransform() };
      e.preventDefault();
      return;
    }
  }

  if (e.button === 2){
    // right-button pan
    draggingSelection = false;
    dragStart = { x: e.clientX, y: e.clientY, view: R.getViewTransform() };
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp, { once: true });
    e.preventDefault();
    return;
  }

  // hit test handles
  for (const k in handles){ const h = handles[k]; const r = h.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom){ draggingHandle = k; dragStart = { x: e.clientX, y: e.clientY, bounds: selectionBounds }; window.addEventListener('pointermove', onHandleMove); window.addEventListener('pointerup', onHandleUp, { once: true }); e.preventDefault(); return; } }

  // if clicked inside selection box -> start move
  if (selectionBounds){ const rect = selBox.getBoundingClientRect(); if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom){ draggingSelection = true; dragStart = { x: e.clientX, y: e.clientY }; window.addEventListener('pointermove', onSelectionMove); window.addEventListener('pointerup', onSelectionUp, { once: true }); e.preventDefault(); return; } }

  // otherwise start rubberband selection
  selecting = true;
  const c = canvasClientToCanvasInternal(e.clientX, e.clientY);
  selectStart = { x: c.x, y: c.y };
  selBox.style.display='block'; selBox.style.left = e.clientX + 'px'; selBox.style.top = e.clientY + 'px'; selBox.style.width='2px'; selBox.style.height='2px';
  window.addEventListener('pointermove', onSelectingMove);
  window.addEventListener('pointerup', onSelectingUp, { once: true });
  e.preventDefault();
}

function onKeyDown(e){
  if (!selectionEnabled || !selectionBounds || !selectedIds || selectedIds.length===0) return;
  const arrowKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  if (!arrowKeys.includes(e.key)) return;
  const stepCss = e.shiftKey ? 10 : 1;
  const rect = canvas.getBoundingClientRect();
  const v = R.getViewTransform();
  const internalPerCssX = canvas.width / rect.width / v.scale;
  const internalPerCssY = canvas.height / rect.height / v.scale;
  let dx = 0, dy = 0;
  if (e.key === 'ArrowUp') dy = -stepCss * internalPerCssY;
  if (e.key === 'ArrowDown') dy = stepCss * internalPerCssY;
  if (e.key === 'ArrowLeft') dx = -stepCss * internalPerCssX;
  if (e.key === 'ArrowRight') dx = stepCss * internalPerCssX;
  R.moveOpsByIds(selectedIds, dx, dy);
  selectionBounds = computeSelectionBounds(selectedIds);
  showSelectionBox(selectionBounds);
  e.preventDefault();
}

function onSelectingMove(e){
  if (!selecting) return;
  const c = canvasClientToCanvasInternal(e.clientX, e.clientY);
  const x0 = Math.min(selectStart.x, c.x), y0 = Math.min(selectStart.y, c.y);
  const x1 = Math.max(selectStart.x, c.x), y1 = Math.max(selectStart.y, c.y);
  const rect = canvas.getBoundingClientRect();
  const v = R.getViewTransform();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const left = rect.left + v.offsetX + x0 * v.scale * scaleX;
  const top = rect.top + v.offsetY + y0 * v.scale * scaleY;
  const w = (x1 - x0) * v.scale * scaleX; const h = (y1 - y0) * v.scale * scaleY;
  selBox.style.left = left + 'px'; selBox.style.top = top + 'px'; selBox.style.width = Math.max(2,w) + 'px'; selBox.style.height = Math.max(2,h) + 'px';
}

function onSelectingUp(e){
  if (!selecting) return;
  selecting = false;
  window.removeEventListener('pointermove', onSelectingMove);
  const c = canvasClientToCanvasInternal(e.clientX, e.clientY);
  const x0 = Math.min(selectStart.x, c.x), y0 = Math.min(selectStart.y, c.y);
  const w = Math.abs(c.x - selectStart.x), h = Math.abs(c.y - selectStart.y);
  if (w > 0 && h > 0){
    selectedIds = R.getOpsInRect(x0,y0,w,h);
    selectionBounds = computeSelectionBounds(selectedIds);
    showSelectionBox(selectionBounds);
  } else {
    selectedIds = [];
    selectionBounds = null;
    showSelectionBox(null);
  }
  selectStart = null;
}

function onSelectionMove(e){
  if (!draggingSelection) return;
  const dx = (e.clientX - dragStart.x);
  const dy = (e.clientY - dragStart.y);
  // convert CSS delta to canvas internal coords
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const v = R.getViewTransform();
  const cx = dx * (scaleX / v.scale);
  const cy = dy * (scaleY / v.scale);
  R.moveOpsByIds(selectedIds, cx, cy);
  dragStart.x = e.clientX; dragStart.y = e.clientY;
  selectionBounds = computeSelectionBounds(selectedIds);
  showSelectionBox(selectionBounds);
}

function onSelectionUp(e){
  draggingSelection = false;
  window.removeEventListener('pointermove', onSelectionMove);
}

function onHandleMove(e){
  if (!draggingHandle) return;
  const k = draggingHandle;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const v = R.getViewTransform();
  const dx = (e.clientX - dragStart.x) * (scaleX / v.scale);
  const dy = (e.clientY - dragStart.y) * (scaleY / v.scale);
  // determine scale factors based on handle
  let sx = 1, sy = 1, ox = selectionBounds.x, oy = selectionBounds.y;
  if (k === 'nw'){ sx = (selectionBounds.w - dx) / selectionBounds.w; sy = (selectionBounds.h - dy) / selectionBounds.h; ox = selectionBounds.x + selectionBounds.w; oy = selectionBounds.y + selectionBounds.h; }
  else if (k === 'ne'){ sx = (selectionBounds.w + dx) / selectionBounds.w; sy = (selectionBounds.h - dy) / selectionBounds.h; ox = selectionBounds.x; oy = selectionBounds.y + selectionBounds.h; }
  else if (k === 'se'){ sx = (selectionBounds.w + dx) / selectionBounds.w; sy = (selectionBounds.h + dy) / selectionBounds.h; ox = selectionBounds.x; oy = selectionBounds.y; }
  else if (k === 'sw'){ sx = (selectionBounds.w - dx) / selectionBounds.w; sy = (selectionBounds.h + dy) / selectionBounds.h; ox = selectionBounds.x + selectionBounds.w; oy = selectionBounds.y; }
  else if (k === 'n'){ sx = 1; sy = (selectionBounds.h - dy) / selectionBounds.h; ox = selectionBounds.x; oy = selectionBounds.y + selectionBounds.h; }
  else if (k === 's'){ sx = 1; sy = (selectionBounds.h + dy) / selectionBounds.h; ox = selectionBounds.x; oy = selectionBounds.y; }
  else if (k === 'e'){ sx = (selectionBounds.w + dx) / selectionBounds.w; sy = 1; ox = selectionBounds.x; oy = selectionBounds.y; }
  else if (k === 'w'){ sx = (selectionBounds.w - dx) / selectionBounds.w; sy = 1; ox = selectionBounds.x + selectionBounds.w; oy = selectionBounds.y; }
  if (sx <= 0.01 || sy <= 0.01) return;
  R.scaleOpsByIds(selectedIds, sx, sy, ox, oy);
  dragStart.x = e.clientX; dragStart.y = e.clientY;
  selectionBounds = computeSelectionBounds(selectedIds);
  showSelectionBox(selectionBounds);
}

function onHandleUp(e){ draggingHandle = null; window.removeEventListener('pointermove', onHandleMove); }

function onPanMove(e){
  if (!dragStart) return;
  const v0 = dragStart.view;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  R.setViewTransform(v0.scale, v0.offsetX + dx, v0.offsetY + dy);
  // update overlay positions
  if (selectionBounds) showSelectionBox(selectionBounds);
}
function onPanUp(e){ window.removeEventListener('pointermove', onPanMove); dragStart = null; }

function onWheel(e){
  if (!selectionEnabled) return;
  const rect = canvas.getBoundingClientRect();
  const v = R.getViewTransform();
  const wheel = -e.deltaY;
  const factor = 1 + (wheel > 0 ? 0.08 : -0.08);
  let newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
  // zoom around cursor: adjust offset so that canvas point under cursor stays
  const clientX = e.clientX, clientY = e.clientY;
  const before = canvasClientToCanvasInternal(clientX, clientY);
  R.setViewTransform(newScale, v.offsetX, v.offsetY);
  const after = canvasClientToCanvasInternal(clientX, clientY);
  const dx = (after.x - before.x) * (rect.width / canvas.width) * newScale;
  const dy = (after.y - before.y) * (rect.height / canvas.height) * newScale;
  R.setViewTransform(newScale, v.offsetX - dx, v.offsetY - dy);
  if (selectionBounds) showSelectionBox(selectionBounds);
  e.preventDefault();
}

function onPointerMoveGlobal(e){
  if (e.pointerType === 'touch'){
    if (!pointerMap.has(e.pointerId)) return;
    pointerMap.set(e.pointerId, e);
    if (pointerMap.size === 2 && pinchState){
      const arr = Array.from(pointerMap.values());
      const dist = Math.hypot(arr[0].clientX-arr[1].clientX, arr[0].clientY-arr[1].clientY);
      const scaleFactor = dist / pinchState.startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchState.startView.scale * scaleFactor));
      // pan to keep midpoint stable
      const midX = (arr[0].clientX + arr[1].clientX)/2, midY = (arr[0].clientY + arr[1].clientY)/2;
      const before = canvasClientToCanvasInternal(midX, midY);
      R.setViewTransform(newScale, pinchState.startView.offsetX, pinchState.startView.offsetY);
      const after = canvasClientToCanvasInternal(midX, midY);
      const dx = (after.x - before.x) * (canvas.getBoundingClientRect().width / canvas.width) * newScale;
      const dy = (after.y - before.y) * (canvas.getBoundingClientRect().height / canvas.height) * newScale;
      R.setViewTransform(newScale, pinchState.startView.offsetX - dx, pinchState.startView.offsetY - dy);
      if (selectionBounds) showSelectionBox(selectionBounds);
    }
  }
}

function onPointerUpGlobal(e){
  if (e.pointerType === 'touch'){
    pointerMap.delete(e.pointerId);
    if (pointerMap.size < 2) pinchState = null;
  }
}

export function enableSelectionMode(enable){
  selectionEnabled = !!enable;
  ensureOverlay();
  if (selectionEnabled){
    canvas.style.touchAction = 'none';
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMoveGlobal);
    window.addEventListener('pointerup', onPointerUpGlobal);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
  } else {
    canvas.style.touchAction = '';
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMoveGlobal);
    window.removeEventListener('pointerup', onPointerUpGlobal);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    selectedIds = []; selectionBounds = null; showSelectionBox(null);
  }
}

// auto attach overlay element
ensureOverlay();

export default { enableSelectionMode };
