// ui-tools.js (ESM)
import { setBrushSize, setEraserSize, setBrushColor, setErasing, setEraserMode, getToolState, clearAll, undo, redo } from './renderer.js';

const penSizeInput = document.getElementById('size');
const eraserSizeInput = document.getElementById('eraserSize');
const erasePixelBtn = document.getElementById('erasePixel');
const eraseRectBtn = document.getElementById('eraseRect');
const eraseStrokeBtn = document.getElementById('eraseStroke');
const colorTool = document.getElementById('colorTool');
const colorMenu = document.getElementById('colorMenu');
const eraserTool = document.getElementById('eraserTool');
const eraserMenu = document.getElementById('eraserMenu');
const clearBtn = document.getElementById('clear');
const colorButtons = document.querySelectorAll('.color');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const penModeLabel = document.getElementById('penModeLabel');
const eraserModeLabel = document.getElementById('eraserModeLabel');

function updateModeLabels(){
  const s = getToolState();
  if (penModeLabel) penModeLabel.textContent = `笔: ${s.brushColor} / ${s.brushSize}`;
  if (eraserModeLabel) eraserModeLabel.textContent = `橡皮模式: ${s.eraserMode} / ${s.eraserSize}`;
}

if (penSizeInput) penSizeInput.addEventListener('input', (e)=>{ setBrushSize(Number(e.target.value)); updateModeLabels(); });
if (eraserSizeInput) eraserSizeInput.addEventListener('input', (e)=>{ setEraserSize(Number(e.target.value)); updateModeLabels(); });

colorButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setBrushColor(btn.dataset.color || '#000');
    setErasing(false);
    updateModeLabels();
    if (colorMenu) { colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); }
  });
});

function updateEraserModeUI(mode){
  if (erasePixelBtn) erasePixelBtn.classList.toggle('active', mode==='pixel');
  if (eraseRectBtn) eraseRectBtn.classList.toggle('active', mode==='rect');
  if (eraseStrokeBtn) eraseStrokeBtn.classList.toggle('active', mode==='stroke');
  updateModeLabels();
}

if (erasePixelBtn) erasePixelBtn.addEventListener('click', ()=>{ setEraserMode('pixel'); updateEraserModeUI('pixel'); });
if (eraseRectBtn) eraseRectBtn.addEventListener('click', ()=>{ setEraserMode('rect'); updateEraserModeUI('rect'); });
if (eraseStrokeBtn) eraseStrokeBtn.addEventListener('click', ()=>{ setEraserMode('stroke'); updateEraserModeUI('stroke'); });

if (colorTool) {
  colorTool.addEventListener('click', ()=>{
    if (!colorMenu) return;
    if (colorMenu.classList.contains('open')) { colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); return; }
    if (colorTool.classList.contains('active')) { colorMenu.classList.add('open'); colorMenu.setAttribute('aria-hidden','false'); return; }
    setBrushColor('#000000'); setErasing(false);
    if (eraserTool) eraserTool.classList.remove('active');
    colorTool.classList.add('active');
    updateModeLabels();
  });
}

if (eraserTool) {
  eraserTool.addEventListener('click', ()=>{
    if (!eraserMenu) return;
    if (eraserMenu.classList.contains('open')) { eraserMenu.classList.remove('open'); eraserMenu.setAttribute('aria-hidden','true'); return; }
    if (eraserTool.classList.contains('active')) { eraserMenu.classList.add('open'); eraserMenu.setAttribute('aria-hidden','false'); return; }
    setErasing(true);
    if (colorTool) colorTool.classList.remove('active');
    eraserTool.classList.add('active');
    updateModeLabels();
  });
}

function closeAllSubmenus(){
  if (colorMenu && colorMenu.classList.contains('open')) { colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); }
  if (eraserMenu && eraserMenu.classList.contains('open')) { eraserMenu.classList.remove('open'); eraserMenu.setAttribute('aria-hidden','true'); }
}

document.addEventListener('click', (e)=>{ if (e.target.closest && (e.target.closest('.tool') || e.target.closest('.drag-handle'))) return; closeAllSubmenus(); });
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') closeAllSubmenus(); });

// Drag handle: allow floating panel to be moved with separate logic for mouse vs touch/pen
const panel = document.querySelector('.floating-panel');
const dragHandle = document.getElementById('dragHandle');
if (dragHandle && panel) {
  // make sure touch gestures don't interfere
  dragHandle.style.touchAction = 'none';

  let isPointerDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let dragOffsetX = 0, dragOffsetY = 0;
  let justDragged = false;
  let activePointerType = null;
  const MOVE_THRESHOLD = 2; // pixels before we treat it as a drag (more sensitive)

  dragHandle.addEventListener('pointerdown', (ev) => {
    const rect = panel.getBoundingClientRect();
    isPointerDown = true;
    activePointerType = ev.pointerType || 'mouse';
    startX = ev.clientX;
    startY = ev.clientY;
    dragOffsetX = ev.clientX - rect.left;
    dragOffsetY = ev.clientY - rect.top;
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.bottom = 'auto';

    if (activePointerType === 'touch' || activePointerType === 'pen') {
      // immediate drag for touch/pen
      dragging = true;
      if (ev.cancelable) ev.preventDefault();
    } else {
      // for mouse, wait until movement exceeds threshold
      dragging = false;
    }
    try { dragHandle.setPointerCapture(ev.pointerId); } catch(e){}
  });

  document.addEventListener('pointermove', (ev) => {
    if (!isPointerDown) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const moved = Math.hypot(dx, dy) >= MOVE_THRESHOLD;

    if (activePointerType === 'mouse') {
      if (!dragging && moved) {
        dragging = true;
      }
    } else {
      // for touch/pen, already dragging from pointerdown
    }

    if (dragging) {
      if (ev.cancelable) ev.preventDefault();
      const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - dragOffsetX));
      const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - dragOffsetY));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    }
  }, { passive: false });

  function endPointer(ev) {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (dragging) {
      justDragged = true;
      setTimeout(()=>{ justDragged = false; }, 250);
    }
    dragging = false;
    activePointerType = null;
    try { dragHandle.releasePointerCapture(ev.pointerId); } catch(e){}
  }

  document.addEventListener('pointerup', endPointer);
  document.addEventListener('pointercancel', endPointer);
  document.addEventListener('pointerleave', (ev) => { if (isPointerDown && ev.pointerId) endPointer(ev); });

  // suppress click on handle right after dragging to avoid toggling UI
  dragHandle.addEventListener('click', (e)=>{
    if (justDragged) { e.stopImmediatePropagation(); e.preventDefault(); }
  });
}

if (clearBtn) clearBtn.addEventListener('click', ()=>{ clearAll(); updateModeLabels(); });

if (undoBtn) undoBtn.addEventListener('click', ()=>{ undo(); });
if (redoBtn) redoBtn.addEventListener('click', ()=>{ redo(); });
document.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))) { e.preventDefault(); redo(); }
});

// init labels and eraser UI
updateEraserModeUI(getToolState().eraserMode || 'pixel');
updateModeLabels();

