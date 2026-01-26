import Message, { EVENTS } from '../message.js';
import { attachDragHelper } from './drag_helper.js';

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    if (fallback) {
      try { fallback(e); } catch (_) {}
    }
    return undefined;
  }
}

function getCanvasRect() {
  const canvasEl = document.getElementById('board');
  if (canvasEl) return canvasEl.getBoundingClientRect();
  return {
    top: 0,
    left: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function getToolbarElements() {
  const panel = document.querySelector('.floating-panel');
  const dragHandle = document.getElementById('dragHandle');
  const toolsSection = panel ? panel.querySelector('.panel-section.tools') : null;
  return { panel, dragHandle, toolsSection };
}

function wirePanelDrag(onMove, onEnd) {
  const els = getToolbarElements();
  if (!els.panel || !els.dragHandle) return null;
  try {
    els.dragHandle.style.touchAction = 'none';
  } catch (e) {}
  const detach = attachDragHelper(els.dragHandle, els.panel, {
    threshold: 2,
    touchThreshold: 5,
    clampRect: () => ({
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight
    }),
    onMove: ({ left, top, screenDx, screenDy }) => {
      safeCall(() => Message.emit(EVENTS.TOOLBAR_MOVE, { left, top, screenDx, screenDy }));
      if (onMove) safeCall(() => onMove({ left, top }));
    },
    onEnd: (ev, rect) => {
      const payload = { left: rect.left, top: rect.top };
      safeCall(() => Message.emit(EVENTS.TOOLBAR_MOVE, payload));
      if (onEnd) safeCall(() => onEnd(payload));
    }
  });
  return detach;
}

function initToolbarInteractions(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const onApplyInteractivity = typeof opts.onApplyInteractivity === 'function' ? opts.onApplyInteractivity : null;
  const onScheduleRects = typeof opts.onScheduleRects === 'function' ? opts.onScheduleRects : null;
  const onPointerToggle = typeof opts.onPointerToggle === 'function' ? opts.onPointerToggle : null;
  const onColorOpen = typeof opts.onColorOpen === 'function' ? opts.onColorOpen : null;
  const onEraserOpen = typeof opts.onEraserOpen === 'function' ? opts.onEraserOpen : null;
  const onMoreOpen = typeof opts.onMoreOpen === 'function' ? opts.onMoreOpen : null;
  const onClear = typeof opts.onClear === 'function' ? opts.onClear : null;
  const onUndo = typeof opts.onUndo === 'function' ? opts.onUndo : null;
  const onRedo = typeof opts.onRedo === 'function' ? opts.onRedo : null;
  const onToggleMode = typeof opts.onToggleMode === 'function' ? opts.onToggleMode : null;
  const onCollapseChanged = typeof opts.onCollapseChanged === 'function' ? opts.onCollapseChanged : null;
  const getInitialCollapsed = typeof opts.getInitialCollapsed === 'function' ? opts.getInitialCollapsed : null;

  const colorTool = document.getElementById('colorTool');
  const pointerTool = document.getElementById('pointerTool');
  const eraserTool = document.getElementById('eraserTool');
  const moreTool = document.getElementById('moreTool');
  const clearBtn = document.getElementById('clear');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const collapseTool = document.getElementById('collapseTool');
  const exitTool = document.getElementById('exitTool');
  const colorMenu = document.getElementById('colorMenu');
  const eraserMenu = document.getElementById('eraserMenu');
  const moreMenu = document.getElementById('moreMenu');

  function applyInteractivity() {
    if (onApplyInteractivity) safeCall(() => onApplyInteractivity());
    if (onScheduleRects) safeCall(() => onScheduleRects());
  }

  function bindTap(el, handler) {
    if (!el || !handler) return;
    el.addEventListener('click', () => {
      safeCall(() => handler());
    });
  }

  if (pointerTool && onPointerToggle) {
    bindTap(pointerTool, () => {
      safeCall(() => onPointerToggle());
      applyInteractivity();
    });
  }

  if (colorTool && onColorOpen) {
    bindTap(colorTool, () => {
      safeCall(() => onColorOpen({ button: colorTool, menu: colorMenu }));
      applyInteractivity();
    });
  }

  if (eraserTool && onEraserOpen) {
    bindTap(eraserTool, () => {
      safeCall(() => onEraserOpen({ button: eraserTool, menu: eraserMenu }));
      applyInteractivity();
    });
  }

  if (moreTool && onMoreOpen) {
    bindTap(moreTool, () => {
      safeCall(() => onMoreOpen({ button: moreTool, menu: moreMenu }));
      applyInteractivity();
    });
  }

  if (clearBtn && onClear) {
    bindTap(clearBtn, () => {
      safeCall(() => onClear());
      applyInteractivity();
    });
  }

  if (undoBtn && onUndo) {
    bindTap(undoBtn, () => {
      safeCall(() => onUndo());
      applyInteractivity();
    });
  }

  if (redoBtn && onRedo) {
    bindTap(redoBtn, () => {
      safeCall(() => onRedo());
      applyInteractivity();
    });
  }

  if (exitTool && onToggleMode) {
    bindTap(exitTool, () => {
      safeCall(() => onToggleMode());
      applyInteractivity();
    });
  }

  const els = getToolbarElements();
  if (collapseTool && els.panel) {
    const applyCollapsed = (collapsed) => {
      const next = !!collapsed;
      safeCall(() => {
        els.panel.classList.toggle('collapsed', next);
        if (onCollapseChanged) onCollapseChanged(next);
      });
      applyInteractivity();
    };
    bindTap(collapseTool, () => {
      const next = !els.panel.classList.contains('collapsed');
      applyCollapsed(next);
    });
    if (getInitialCollapsed) {
      const initCollapsed = !!safeCall(() => getInitialCollapsed());
      if (initCollapsed) applyCollapsed(true);
    }
  }

  document.addEventListener('click', (e) => {
    const t = e && e.target;
    if (!t || !(t instanceof HTMLElement)) return;
    if (t.closest('.tool') || t.closest('.drag-handle')) return;
    if (opts.onGlobalClickOutside) {
      safeCall(() => opts.onGlobalClickOutside());
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e || e.key !== 'Escape') return;
    if (opts.onEscape) {
      safeCall(() => opts.onEscape());
    }
  });
}

function openerForMenu(menu) {
  if (!menu) return null;
  const id = String(menu.id || '');
  if (id === 'colorMenu') return document.getElementById('colorTool');
  if (id === 'eraserMenu') return document.getElementById('eraserTool');
  if (id === 'moreMenu') return document.getElementById('moreTool');
  return null;
}

function cleanupMenuStyles(menu) {
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

function closeAllSubmenus() {
  const colorMenu = document.getElementById('colorMenu');
  const eraserMenu = document.getElementById('eraserMenu');
  const moreMenu = document.getElementById('moreMenu');
  const colorTool = document.getElementById('colorTool');
  const eraserTool = document.getElementById('eraserTool');
  const moreTool = document.getElementById('moreTool');
  if (colorMenu && colorMenu.classList.contains('open') && colorMenu.dataset.pinned !== 'true') {
    cleanupMenuStyles(colorMenu);
    colorMenu.classList.remove('open');
    colorMenu.setAttribute('aria-hidden', 'true');
    safeCall(() => Message.emit(EVENTS.SUBMENU_CLOSE, { id: colorMenu.id, pinned: false }));
  }
  if (eraserMenu && eraserMenu.classList.contains('open') && eraserMenu.dataset.pinned !== 'true') {
    cleanupMenuStyles(eraserMenu);
    eraserMenu.classList.remove('open');
    eraserMenu.setAttribute('aria-hidden', 'true');
    safeCall(() => Message.emit(EVENTS.SUBMENU_CLOSE, { id: eraserMenu.id, pinned: false }));
  }
  if (moreMenu && moreMenu.classList.contains('open') && moreMenu.dataset.pinned !== 'true') {
    cleanupMenuStyles(moreMenu);
    moreMenu.classList.remove('open');
    moreMenu.setAttribute('aria-hidden', 'true');
    safeCall(() => Message.emit(EVENTS.SUBMENU_CLOSE, { id: moreMenu.id, pinned: false }));
  }
  if (colorTool) colorTool.classList.remove('active');
  if (eraserTool) eraserTool.classList.remove('active');
  if (moreTool) moreTool.classList.remove('active');
}

function positionMenu(menu, openerEl, pinned) {
  if (!menu || !openerEl) return;
  const canvasRect = getCanvasRect();
  const openerRect = openerEl.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');
  const mRect = menu.getBoundingClientRect();
  const menuHeight = mRect.height;
  const GAP = 8;
  if (!pinned) {
    menu.style.position = 'absolute';
    const panelEl = openerEl.closest && openerEl.closest('.floating-panel') ? openerEl.closest('.floating-panel') : (document.querySelector('.floating-panel') || menu.parentElement);
    const parentRect = panelEl.getBoundingClientRect();
    const panelHeight = panelEl.offsetHeight || 50;
    const panelTopInCanvas = parentRect.top - canvasRect.top;
    const panelBottomInCanvas = canvasRect.bottom - parentRect.bottom;
    let top;
    let isAbove = true;
    const fitsAbove = panelTopInCanvas >= menuHeight + GAP;
    const fitsBelow = panelBottomInCanvas >= menuHeight + GAP;
    if (fitsAbove) {
      top = -GAP - menuHeight;
      isAbove = true;
    } else if (fitsBelow) {
      top = panelHeight + GAP;
      isAbove = false;
    } else {
      if (panelTopInCanvas >= panelBottomInCanvas) {
        top = -GAP - menuHeight;
        isAbove = true;
      } else {
        top = panelHeight + GAP;
        isAbove = false;
      }
    }
    let left = (parentRect.width - mRect.width) / 2;
    if (left < 6) left = 6;
    try {
      const maxLeft = Math.max(6, parentRect.width - mRect.width - 6);
      left = Math.min(Math.max(left, 6), maxLeft);
    } catch (e) {}
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.zIndex = 2500;
    menu.dataset.placement = isAbove ? 'above' : 'below';
  } else {
    menu.style.position = 'fixed';
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
    let left = openerRect.left + (openerRect.width - mRect.width) / 2;
    if (left < canvasRect.left + 6) left = canvasRect.left + 6;
    if (left + mRect.width > canvasRect.right - 6) left = Math.max(canvasRect.right - mRect.width - 6, canvasRect.left + 6);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.dataset.placement = isAbove ? 'above' : 'below';
  }
  menu.style.visibility = '';
}

function showSubmenu(menu, openerEl) {
  if (!menu || !openerEl) return;
  if (menu.classList.contains('open')) {
    const pinned = menu.dataset && menu.dataset.pinned === 'true';
    cleanupMenuStyles(menu);
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    openerEl.classList.remove('active');
    safeCall(() => Message.emit(EVENTS.SUBMENU_CLOSE, { id: menu.id, pinned: !!pinned }));
    return;
  }
  closeAllSubmenus();
  const pinned = menu.dataset && menu.dataset.pinned === 'true';
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');
  positionMenu(menu, openerEl, pinned);
  openerEl.classList.add('active');
  safeCall(() => Message.emit(EVENTS.SUBMENU_OPEN, { id: menu.id, pinned: !!pinned }));
}

function attachDragToPinned(menu) {
  if (!menu) return;
  if (menu._pinDragAttached) return;
  const handle = menu.querySelector('.submenu-drag-handle') || menu;
  try {
    if (handle && handle.style) handle.style.touchAction = 'none';
  } catch (e) {}
  import('./drag_helper.js').then(mod => {
    try {
      const detach = mod.attachDragHelper(handle, menu, {
        threshold: 2,
        touchThreshold: 5,
        clampRect: () => {
          const r = getCanvasRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        },
        onEnd: (ev, rect) => {
          safeCall(() => Message.emit(EVENTS.SUBMENU_MOVE, { id: menu.id, left: rect.left, top: rect.top }));
        }
      });
      menu._pinDragAttached = true;
      menu._pinDragDetach = detach;
    } catch (e) {
      safeCall(() => {});
    }
  }).catch(e => {
    safeCall(() => {});
  });
}

function detachDragFromPinned(menu) {
  if (!menu || !menu._pinDragAttached) return;
  if (menu._pinDragDetach && typeof menu._pinDragDetach === 'function') {
    try {
      menu._pinDragDetach();
    } catch (e) {}
  }
  menu._pinDragAttached = false;
  menu._pinDragDetach = null;
}

function initPinHandlers() {
  let lastTouchTapAt = 0;
  document.querySelectorAll('.submenu-pin').forEach(btn => {
    const doToggle = () => {
      const menu = btn.closest('.submenu');
      if (!menu) return;
      const wasPinned = menu.dataset.pinned === 'true';
      const mRect = menu.getBoundingClientRect();
      const opener = openerForMenu(menu);
      menu.dataset.pinned = wasPinned ? 'false' : 'true';
      btn.classList.toggle('pinned', !wasPinned);
      if (menu.classList.contains('open')) {
        if (!wasPinned) {
          menu.style.position = 'fixed';
          menu.style.left = mRect.left + 'px';
          menu.style.top = mRect.top + 'px';
          attachDragToPinned(menu);
          safeCall(() => Message.emit(EVENTS.SUBMENU_PIN, { id: menu.id, pinned: true }));
        } else {
          const parentRect = menu.parentElement.getBoundingClientRect();
          const left = mRect.left - parentRect.left;
          const top = mRect.top - parentRect.top;
          menu.style.position = 'absolute';
          menu.style.left = left + 'px';
          menu.style.top = top + 'px';
          detachDragFromPinned(menu);
          if (opener) positionMenu(menu, opener, false);
          safeCall(() => Message.emit(EVENTS.SUBMENU_PIN, { id: menu.id, pinned: false }));
        }
      }
    };
    btn.addEventListener('click', e => {
      if (Date.now() - lastTouchTapAt < 400) return;
      e.stopPropagation();
      doToggle();
    });
    let down = null;
    let moved = false;
    const moveThreshold = 8;
    const delayMs = 50;
    const getTouchPoint = e => {
      const list = e && e.changedTouches ? e.changedTouches : null;
      if (!list || typeof list.length !== 'number') return null;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t) continue;
        if (!down || t.identifier === down.id) return t;
      }
      return null;
    };
    btn.addEventListener('touchstart', e => {
      const t = e && e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
      if (!t) return;
      down = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        t: typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
      };
      moved = false;
    }, { passive: true });
    btn.addEventListener('touchmove', e => {
      if (!down) return;
      const t = getTouchPoint(e);
      if (!t) return;
      const dx = t.clientX - down.x;
      const dy = t.clientY - down.y;
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) moved = true;
    }, { passive: true });
    btn.addEventListener('touchend', e => {
      if (!down) return;
      const t = getTouchPoint(e);
      if (!t) return;
      const tUp = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const elapsed = tUp - down.t;
      const shouldFire = !moved;
      const delay = Math.max(0, delayMs - elapsed);
      down = null;
      moved = false;
      if (!shouldFire) return;
      lastTouchTapAt = Date.now();
      try {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
      } catch (err) {}
      setTimeout(() => {
        safeCall(() => doToggle());
      }, delay);
    }, { passive: false });
    btn.addEventListener('touchcancel', () => {
      down = null;
      moved = false;
    });
  });
}

function smartRepositionMenu(menu, openerEl) {
  if (!menu || !openerEl) return;
  const canvasRect = getCanvasRect();
  const panelEl = openerEl.closest && openerEl.closest('.floating-panel') ? openerEl.closest('.floating-panel') : document.querySelector('.floating-panel');
  if (!panelEl) return;
  const parentRect = panelEl.getBoundingClientRect();
  const panelHeight = panelEl.offsetHeight || 50;
  const mRect = menu.getBoundingClientRect();
  const menuHeight = mRect.height;
  const GAP = 8;
  const panelTopInCanvas = parentRect.top - canvasRect.top;
  const panelBottomInCanvas = canvasRect.bottom - parentRect.bottom;
  const fitsAbove = panelTopInCanvas >= menuHeight + GAP;
  const fitsBelow = panelBottomInCanvas >= menuHeight + GAP;
  let newTop;
  let newPlacement;
  if (fitsAbove && fitsBelow) {
    newPlacement = menu.dataset.placement || 'above';
    newTop = newPlacement === 'above' ? -GAP - menuHeight : panelHeight + GAP;
  } else if (fitsAbove) {
    newTop = -GAP - menuHeight;
    newPlacement = 'above';
  } else if (fitsBelow) {
    newTop = panelHeight + GAP;
    newPlacement = 'below';
  } else {
    if (panelTopInCanvas >= panelBottomInCanvas) {
      newTop = -GAP - menuHeight;
      newPlacement = 'above';
    } else {
      newTop = panelHeight + GAP;
      newPlacement = 'below';
    }
  }
  const currentTop = parseFloat(menu.style.top) || 0;
  if (Math.abs(currentTop - newTop) > 0.5) {
    menu.style.top = newTop + 'px';
    menu.dataset.placement = newPlacement;
  }
}

function smartRepositionOpenSubmenus() {
  const colorMenu = document.getElementById('colorMenu');
  const eraserMenu = document.getElementById('eraserMenu');
  const moreMenu = document.getElementById('moreMenu');
  const colorTool = document.getElementById('colorTool');
  const eraserTool = document.getElementById('eraserTool');
  const moreTool = document.getElementById('moreTool');
  if (colorMenu && colorMenu.classList.contains('open') && colorMenu.dataset.pinned !== 'true' && colorTool) {
    smartRepositionMenu(colorMenu, colorTool);
  }
  if (eraserMenu && eraserMenu.classList.contains('open') && eraserMenu.dataset.pinned !== 'true' && eraserTool) {
    smartRepositionMenu(eraserMenu, eraserTool);
  }
  if (moreMenu && moreMenu.classList.contains('open') && moreMenu.dataset.pinned !== 'true' && moreTool) {
    smartRepositionMenu(moreMenu, moreTool);
  }
}

function initSubmenuRepositioning() {
  safeCall(() => {
    window.addEventListener('resize', () => {
      ['colorMenu', 'eraserMenu', 'moreMenu'].forEach(id => {
        const menu = document.getElementById(id);
        if (menu && menu.classList.contains('open') && menu.dataset.pinned === 'true') {
          const opener = openerForMenu(menu);
          if (opener) positionMenu(menu, opener, true);
        }
      });
    });
    Message.on(EVENTS.TOOLBAR_MOVE, () => {
      if (!smartRepositionOpenSubmenus._timeout) {
        smartRepositionOpenSubmenus._timeout = setTimeout(() => {
          smartRepositionOpenSubmenus._timeout = null;
          smartRepositionOpenSubmenus();
        }, 16);
      }
    });
  });
}

export function initMainTool(options) {
  safeCall(() => {
    initToolbarInteractions(options || {});
  });
  const detachDrag = safeCall(() => wirePanelDrag(options && options.onToolbarMove, options && options.onToolbarMoveEnd)) || null;
  safeCall(() => initPinHandlers());
  safeCall(() => initSubmenuRepositioning());
  return {
    closeAllSubmenus: () => safeCall(() => closeAllSubmenus()),
    showSubmenu: (menu, openerEl) => safeCall(() => showSubmenu(menu, openerEl)),
    positionMenu: (menu, openerEl, pinned) => safeCall(() => positionMenu(menu, openerEl, pinned)),
    detachToolbarDrag: () => {
      if (detachDrag && typeof detachDrag === 'function') {
        safeCall(() => detachDrag());
      }
    }
  };
}

export function simulateCrashIsolation() {
  const panel = document.querySelector('.floating-panel');
  if (!panel) return;
  safeCall(() => {
    const colorTool = document.getElementById('colorTool');
    if (colorTool) colorTool.classList.remove('active');
  });
}

export function measureToolbarRenderPerf() {
  const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const els = getToolbarElements();
  const endLookup = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const nodes = [];
  if (els.toolsSection) {
    els.toolsSection.querySelectorAll('.tool-btn').forEach(btn => {
      nodes.push(btn);
    });
  }
  const end = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  return {
    lookupMs: endLookup - start,
    totalMs: end - start,
    count: nodes.length
  };
}

export default {
  initMainTool,
  simulateCrashIsolation,
  measureToolbarRenderPerf
};

