// more_decide_windows.js
// Submenu positioning and pin (固定) behavior separated.
import Message, { EVENTS } from './message.js';
export function getCanvasRect(){
  const canvasEl = document.getElementById('board');
  if (canvasEl) return canvasEl.getBoundingClientRect();
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
}

export function cleanupMenuStyles(menu){
  if (!menu) return;
  menu.style.position = '';
  menu.style.left = '';
  menu.style.top = '';
  menu.style.right = '';
  menu.style.bottom = '';
  menu.style.display = '';
  menu.style.flexDirection = '';
  menu.style.flexWrap = '';
  menu.style.maxWidth = '';
}

export function closeAllSubmenus(){
  const colorMenu = document.getElementById('colorMenu');
  const eraserMenu = document.getElementById('eraserMenu');
  const colorTool = document.getElementById('colorTool');
  const eraserTool = document.getElementById('eraserTool');
  // Do not close menus that are pinned (they should persist)
  if (colorMenu && colorMenu.classList.contains('open') && colorMenu.dataset.pinned!=='true') { cleanupMenuStyles(colorMenu); colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); try{ Message.emit(EVENTS.SUBMENU_CLOSE, { id: colorMenu.id }); }catch(e){} }
  if (eraserMenu && eraserMenu.classList.contains('open') && eraserMenu.dataset.pinned!=='true') { cleanupMenuStyles(eraserMenu); eraserMenu.classList.remove('open'); eraserMenu.setAttribute('aria-hidden','true'); try{ Message.emit(EVENTS.SUBMENU_CLOSE, { id: eraserMenu.id }); }catch(e){} }
  if (colorTool) colorTool.classList.remove('active');
  if (eraserTool) eraserTool.classList.remove('active');
}

export function positionMenu(menu, openerEl, pinned){
  if (!menu || !openerEl) return;
  const canvasRect = getCanvasRect();
  const openerRect = openerEl.getBoundingClientRect();

  // show temporarily to measure
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  menu.setAttribute('aria-hidden','false');
  const mRect = menu.getBoundingClientRect();
  const menuHeight = mRect.height;
  const GAP = 8; // gap between toolbar and submenu

  // NOTE: default behavior: when NOT pinned -> position absolute relative to panel so it follows toolbar movement.
  if (!pinned) {
    // absolute positioning relative to the floating toolbar panel; submenu shown above or below the toolbar
    menu.style.position = 'absolute';
    const panelEl = openerEl.closest && openerEl.closest('.floating-panel') ? openerEl.closest('.floating-panel') : (document.querySelector('.floating-panel') || menu.parentElement);
    const parentRect = panelEl.getBoundingClientRect();
    const panelHeight = panelEl.offsetHeight || 50;
    
    // intelligent space detection: decide placement based on available canvas space
    const panelTopInCanvas = parentRect.top - canvasRect.top; // space above panel
    const panelBottomInCanvas = canvasRect.bottom - parentRect.bottom; // space below panel
    
    let top;
    let isAbove = true; // default: try above first
    
    // check if submenu fits above the panel
    const fitsAbove = panelTopInCanvas >= menuHeight + GAP;
    // check if submenu fits below the panel
    const fitsBelow = panelBottomInCanvas >= menuHeight + GAP;
    
    if (fitsAbove) {
      // fits above: place above
      top = -GAP - menuHeight;
      isAbove = true;
    } else if (fitsBelow) {
      // doesn't fit above but fits below: place below
      top = panelHeight + GAP;
      isAbove = false;
    } else {
      // neither fits perfectly; prefer above if there's more space
      if (panelTopInCanvas >= panelBottomInCanvas) {
        top = -GAP - menuHeight;
        isAbove = true;
      } else {
        top = panelHeight + GAP;
        isAbove = false;
      }
    }
    
    // horizontal: center submenu relative to the panel
    let left = (parentRect.width - mRect.width) / 2;
    if (left < 6) left = 6;
    
    // clamp within parent horizontal bounds
    try{
      const maxLeft = Math.max(6, parentRect.width - mRect.width - 6);
      left = Math.min(Math.max(left, 6), maxLeft);
    }catch(e){}
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    // fixed layout: keep submenu at constant position relative to panel
    menu.style.zIndex = 2500;
    // mark placement for animation
    menu.dataset.placement = isAbove ? 'above' : 'below';
  } else {
    // pinned -> fixed positioning relative to viewport/canvas (stays in place when panel moves)
    menu.style.position = 'fixed';
    
    // intelligent space detection for pinned menus too
    const spaceAbove = openerRect.top - canvasRect.top;
    const spaceBelow = canvasRect.bottom - openerRect.bottom;
    const fitsAbove = spaceAbove >= menuHeight + GAP;
    const fitsBelow = spaceBelow >= menuHeight + GAP;
    
    let top;
    let isAbove = true;
    
    if (fitsAbove) {
      top = openerRect.top - GAP - menuHeight;
      isAbove = true;
    } else if (fitsBelow) {
      top = openerRect.bottom + GAP;
      isAbove = false;
    } else {
      if (spaceAbove >= spaceBelow) {
        top = Math.max(canvasRect.top + 4, openerRect.top - GAP - menuHeight);
        isAbove = true;
      } else {
        top = Math.min(canvasRect.bottom - menuHeight - 4, openerRect.bottom + GAP);
        isAbove = false;
      }
    }
    
    // horizontal: center relative to opener
    let left = openerRect.left + (openerRect.width - mRect.width) / 2;
    if (left < canvasRect.left + 6) left = canvasRect.left + 6;
    if (left + mRect.width > canvasRect.right - 6) left = Math.max(canvasRect.right - mRect.width - 6, canvasRect.left + 6);
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.dataset.placement = isAbove ? 'above' : 'below';
  }

  menu.style.visibility = '';
}

export function showSubmenu(menu, openerEl){
  if (!menu || !openerEl) return;
  // toggle: if already open -> close
  if (menu.classList.contains('open')){ cleanupMenuStyles(menu); menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); openerEl.classList.remove('active'); return; }

  // close others
  closeAllSubmenus();

  const pinned = menu.dataset && menu.dataset.pinned === 'true';
  menu.classList.add('open');
  menu.setAttribute('aria-hidden','false');
  positionMenu(menu, openerEl, pinned);
  openerEl.classList.add('active');
  // 通知外部：子菜单已打开
  try{ Message.emit(EVENTS.SUBMENU_OPEN, { id: menu.id, pinned: !!pinned }); }catch(e){}
}

export function initPinHandlers(){
  document.querySelectorAll('.submenu-pin').forEach(btn => {
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const menu = btn.closest('.submenu');
      if (!menu) return;
      // preserve visual position when toggling pinned state
      const wasPinned = menu.dataset.pinned === 'true';
      const mRect = menu.getBoundingClientRect();
      const opener = menu.parentElement && menu.parentElement.querySelector('.tool-btn');
      // toggle
      menu.dataset.pinned = wasPinned ? 'false' : 'true';
      btn.classList.toggle('pinned', !wasPinned);
      // if menu open, compute new coordinates so appearance doesn't change
      if (menu.classList.contains('open')){
        if (!wasPinned) {
          // becoming pinned -> switch to fixed, keep same viewport coords
          menu.style.position = 'fixed';
          menu.style.left = mRect.left + 'px';
          menu.style.top = mRect.top + 'px';
          // attach drag handlers so pinned menus can be moved independently
          attachDragToPinned(menu);
          try{ Message.emit(EVENTS.SUBMENU_PIN, { id: menu.id, pinned: true }); }catch(e){}
        } else {
          // becoming unpinned -> switch to absolute relative to parent and reposition smartly
          const parentRect = menu.parentElement.getBoundingClientRect();
          const left = mRect.left - parentRect.left;
          const top = mRect.top - parentRect.top;
          menu.style.position = 'absolute';
          menu.style.left = left + 'px';
          menu.style.top = top + 'px';
          // remove pinned drag handlers
          detachDragFromPinned(menu);
          // reposition using smart logic to match current toolbar position
          if (opener) positionMenu(menu, opener, false);
          try{ Message.emit(EVENTS.SUBMENU_PIN, { id: menu.id, pinned: false }); }catch(e){}
        }
      }
    });
  });
}

// Attach pointer drag handlers to a pinned (fixed) menu so user can move it.
function attachDragToPinned(menu){
  if (!menu) return;
  if (menu._pinDragAttached) return;
  const handle = menu.querySelector('.submenu-drag-handle') || menu;
  // ensure touch action disabled so pointer events behave like toolbar drag
  try{ if (handle && handle.style) handle.style.touchAction = 'none'; }catch(e){}
  // dynamic import of helper to avoid circular deps; attach and keep detach function
  import('./drag_helper.js').then(mod => {
    try{
      const detach = mod.attachDragHelper(handle, menu, {
        threshold: 2,
        // return raw canvas bounds; helper will account for target size when clamping
        clampRect: ()=>{
          const r = getCanvasRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        },
        onEnd: (ev, rect)=>{ try{ Message.emit(EVENTS.SUBMENU_MOVE, { id: menu.id, left: rect.left, top: rect.top }); }catch(e){} }
      });
      menu._pinDragAttached = true;
      menu._pinDragDetach = detach;
    }catch(e){ console.warn('attachDragToPinned: helper attach failed', e); }
  }).catch(e=>{ console.warn('attachDragToPinned: import failed', e); });
}

function detachDragFromPinned(menu){
  if (!menu || !menu._pinDragAttached) return;
  if (menu._pinDragDetach && typeof menu._pinDragDetach === 'function'){
    try{ menu._pinDragDetach(); }catch(e){}
  }
  menu._pinDragAttached = false;
  menu._pinDragDetach = null;
}

// auto-init: reposition pinned menus on window resize
window.addEventListener('resize', ()=>{
  ['colorMenu','eraserMenu'].forEach(id=>{
    const menu = document.getElementById(id);
    if (menu && menu.classList.contains('open') && menu.dataset.pinned==='true'){
      const opener = menu.parentElement && menu.parentElement.querySelector('.tool-btn');
      if (opener) positionMenu(menu, opener, true);
    }
  });
});

// Smart repositioning for unpinned submenus when toolbar is dragged
// Detects space availability and auto-switches submenu position (above/below)
function smartRepositionOpenSubmenus(){
  const colorMenu = document.getElementById('colorMenu');
  const eraserMenu = document.getElementById('eraserMenu');
  const colorTool = document.getElementById('colorTool');
  const eraserTool = document.getElementById('eraserTool');
  
  // reposition color submenu if open and unpinned
  if (colorMenu && colorMenu.classList.contains('open') && colorMenu.dataset.pinned !== 'true' && colorTool) {
    smartRepositionMenu(colorMenu, colorTool);
  }
  
  // reposition eraser submenu if open and unpinned
  if (eraserMenu && eraserMenu.classList.contains('open') && eraserMenu.dataset.pinned !== 'true' && eraserTool) {
    smartRepositionMenu(eraserMenu, eraserTool);
  }
}

// Intelligently reposition a single submenu based on available space
// Switches between above/below if current position doesn't fit
function smartRepositionMenu(menu, openerEl){
  if (!menu || !openerEl) return;
  
  const canvasRect = getCanvasRect();
  const panelEl = openerEl.closest && openerEl.closest('.floating-panel') ? openerEl.closest('.floating-panel') : document.querySelector('.floating-panel');
  if (!panelEl) return;
  
  const parentRect = panelEl.getBoundingClientRect();
  const panelHeight = panelEl.offsetHeight || 50;
  const mRect = menu.getBoundingClientRect();
  const menuHeight = mRect.height;
  const GAP = 8;
  
  // calculate available space above and below the panel
  const panelTopInCanvas = parentRect.top - canvasRect.top;
  const panelBottomInCanvas = canvasRect.bottom - parentRect.bottom;
  
  // check what fits
  const fitsAbove = panelTopInCanvas >= menuHeight + GAP;
  const fitsBelow = panelBottomInCanvas >= menuHeight + GAP;
  
  // determine new placement
  let newTop;
  let newPlacement;
  
  if (fitsAbove && fitsBelow) {
    // both fit; keep current placement
    newPlacement = menu.dataset.placement || 'above';
    newTop = (newPlacement === 'above') ? (-GAP - menuHeight) : (panelHeight + GAP);
  } else if (fitsAbove) {
    // only above fits
    newTop = -GAP - menuHeight;
    newPlacement = 'above';
  } else if (fitsBelow) {
    // only below fits
    newTop = panelHeight + GAP;
    newPlacement = 'below';
  } else {
    // neither fits; prefer the side with more space
    if (panelTopInCanvas >= panelBottomInCanvas) {
      newTop = -GAP - menuHeight;
      newPlacement = 'above';
    } else {
      newTop = panelHeight + GAP;
      newPlacement = 'below';
    }
  }
  
  // update position if it changed
  const currentTop = parseFloat(menu.style.top) || 0;
  if (Math.abs(currentTop - newTop) > 0.5) {
    menu.style.top = newTop + 'px';
    menu.dataset.placement = newPlacement;
  }
}

// Listen to toolbar drag events and reposition open submenus
Message.on(EVENTS.TOOLBAR_MOVE, ()=>{
  // debounce repositioning to avoid excessive reflows during fast drag
  if (!smartRepositionOpenSubmenus._timeout) {
    smartRepositionOpenSubmenus._timeout = setTimeout(()=>{
      smartRepositionOpenSubmenus._timeout = null;
      smartRepositionOpenSubmenus();
    }, 16); // ~60fps
  }
});

