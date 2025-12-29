// ui-tools.js (ESM)
import { clearAll, undo, redo, setBrushColor, setErasing } from './renderer.js';
import { showSubmenu, cleanupMenuStyles, initPinHandlers, closeAllSubmenus } from './more_decide_windows.js';
import Message, { EVENTS } from './message.js';
import { initPenUI, updatePenModeLabel } from './pen.js';
import { initEraserUI, updateEraserModeLabel } from './erese.js';

const colorTool = document.getElementById('colorTool');
const colorMenu = document.getElementById('colorMenu');
const eraserTool = document.getElementById('eraserTool');
const eraserMenu = document.getElementById('eraserMenu');
const clearBtn = document.getElementById('clear');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

// initialize pen and eraser UI modules
initPenUI();
initEraserUI();

if (colorTool) {
  colorTool.addEventListener('click', ()=>{
    if (!colorMenu) return;
    setBrushColor('#000000'); setErasing(false);
    if (eraserTool) eraserTool.classList.remove('active');
    showSubmenu(colorMenu, colorTool);
    updatePenModeLabel();
  });
}

if (eraserTool) {
  eraserTool.addEventListener('click', ()=>{
    if (!eraserMenu) return;
    setErasing(true);
    if (colorTool) colorTool.classList.remove('active');
    showSubmenu(eraserMenu, eraserTool);
    updateEraserModeLabel();
  });
}

// submenu logic moved to more_decide_windows.js

document.addEventListener('click', (e)=>{ if (e.target.closest && (e.target.closest('.tool') || e.target.closest('.drag-handle'))) return; closeAllSubmenus(); });
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') closeAllSubmenus(); });

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
    onMove: ({ left, top }) => { try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left, top }); }catch(e){} },
    onEnd: (ev, rect) => { try{ Message.emit(EVENTS.TOOLBAR_MOVE, { left: rect.left, top: rect.top }); }catch(e){} }
  });
}

if (clearBtn) clearBtn.addEventListener('click', ()=>{ clearAll(); setErasing(false); if (eraserTool) eraserTool.classList.remove('active'); updatePenModeLabel(); updateEraserModeLabel(); });

if (undoBtn) undoBtn.addEventListener('click', ()=>{ undo(); });
if (redoBtn) redoBtn.addEventListener('click', ()=>{ redo(); });
document.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))) { e.preventDefault(); redo(); }
});

// ensure labels reflect initial state
updateEraserModeLabel();
updatePenModeLabel();

