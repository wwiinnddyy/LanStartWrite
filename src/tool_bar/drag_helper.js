// drag_helper.js
// 通用拖动辅助：绑定在 `handle` 上，移动 `target` 元素。
// options: { clampRect: ()=>{left,top,right,bottom} , onMove, onEnd, threshold }
export function attachDragHelper(handle, target, options = {}){
  if (!handle || !target) return null;
  const mouseThreshold = (typeof options.threshold === 'number') ? options.threshold : 2;
  const touchThreshold = (typeof options.touchThreshold === 'number') ? options.touchThreshold : 5;
  const usePointerEvents = options.usePointerEvents !== false && typeof window !== 'undefined' && !!window.PointerEvent;
  const useRaf = options.useRaf !== false;
  let mouseDown = false;
  let touchDown = false;
  let pointerDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let startScreenX = 0, startScreenY = 0;
  let startLeft = 0, startTop = 0;
  let touchId = null;
  let pointerId = null;
  let basis = 'viewport';
  let rafId = 0;
  let pending = null;

  function getRect(){
    if (options.clampRect && typeof options.clampRect === 'function') return options.clampRect();
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  function getBasis(){
    try{
      const cs = window.getComputedStyle ? window.getComputedStyle(target) : null;
      const pos = cs ? String(cs.position || '') : '';
      if (pos === 'absolute' || pos === 'relative') {
        const op = target.offsetParent;
        if (op && op.getBoundingClientRect) return 'offsetParent';
      }
    }catch(e){}
    return 'viewport';
  }

  function _getClampForBasis(){
    const c = getRect();
    if (basis !== 'offsetParent') return c;
    try{
      const op = target.offsetParent;
      if (op && op.getBoundingClientRect) {
        const pr = op.getBoundingClientRect();
        return {
          left: c.left - pr.left,
          top: c.top - pr.top,
          right: c.right - pr.left,
          bottom: c.bottom - pr.top
        };
      }
    }catch(e){}
    return c;
  }

  function _applyDelta(dx, dy, ev){
    let left = startLeft + dx;
    let top = startTop + dy;
    try{
      const c = _getClampForBasis();
      const w = target.offsetWidth; const h = target.offsetHeight;
      if (typeof c.left === 'number' && typeof c.right === 'number'){
        left = Math.max(c.left, Math.min(c.right - w, left));
      }
      if (typeof c.top === 'number' && typeof c.bottom === 'number'){
        top = Math.max(c.top, Math.min(c.bottom - h, top));
      }
    }catch(e){}
    target.style.left = left + 'px';
    target.style.top = top + 'px';
    const screenDx = (ev && typeof ev.screenX === 'number') ? (ev.screenX - startScreenX) : 0;
    const screenDy = (ev && typeof ev.screenY === 'number') ? (ev.screenY - startScreenY) : 0;
    if (options.onMove) options.onMove({ left, top, ev, screenDx, screenDy });
  }

  function _scheduleApply(dx, dy, ev){
    if (!useRaf) {
      _applyDelta(dx, dy, ev);
      return;
    }
    pending = { dx, dy, ev };
    if (rafId) return;
    rafId = requestAnimationFrame(()=>{
      rafId = 0;
      const p = pending;
      pending = null;
      if (!p) return;
      _applyDelta(p.dx, p.dy, p.ev);
    });
  }

  function _startDrag(clientX, clientY, ev){
    startX = clientX;
    startY = clientY;
    startScreenX = ev ? ev.screenX : 0;
    startScreenY = ev ? ev.screenY : 0;
    const r = target.getBoundingClientRect();
    basis = getBasis();
    if (basis === 'offsetParent') {
      try{
        const op = target.offsetParent;
        if (op && op.getBoundingClientRect) {
          const pr = op.getBoundingClientRect();
          startLeft = r.left - pr.left;
          startTop = r.top - pr.top;
        } else {
          startLeft = r.left;
          startTop = r.top;
          basis = 'viewport';
        }
      }catch(e){
        startLeft = r.left;
        startTop = r.top;
        basis = 'viewport';
      }
    } else {
      startLeft = r.left;
      startTop = r.top;
    }
    if (options.onStart) options.onStart(ev);
  }

  function onMouseDown(ev){
    if (!ev || ev.button !== 0) return;
    // 如果点击的是按钮或交互元素，不拦截拖动（或者说不干扰其点击）
    if (ev.target && ev.target.closest && ev.target.closest('button, .ctrl-btn, .win-btn, select, input')) return;
    
    mouseDown = true;
    touchDown = false;
    pointerDown = false;
    touchId = null;
    pointerId = null;
    _startDrag(ev.clientX, ev.clientY, ev);
    dragging = false;
    if (handle && handle.style) handle.style.cursor = 'grabbing';
    try{ ev.preventDefault(); }catch(e){}
  }

  function onMouseMove(ev){
    if (!mouseDown) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) >= mouseThreshold) dragging = true;
    if (!dragging) return;
    try{ ev.preventDefault(); }catch(e){}
    _scheduleApply(dx, dy, ev);
  }

  function onMouseUp(ev){
    if (!mouseDown) return;
    mouseDown = false;
    dragging = false;
    if (rafId) {
      try{ cancelAnimationFrame(rafId); }catch(e){}
      rafId = 0;
    }
    pending = null;
    if (handle && handle.style) handle.style.cursor = '';
    if (options.onEnd) options.onEnd(ev, target.getBoundingClientRect());
  }

  function _getTouchPoint(ev){
    const list = (ev && ev.changedTouches) ? ev.changedTouches : null;
    if (!list || typeof list.length !== 'number') return null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t) continue;
      if (touchId === null || t.identifier === touchId) return t;
    }
    return null;
  }

  function onTouchStart(ev){
    if (!ev) return;
    if (!ev.changedTouches || !ev.changedTouches.length) return;
    
    // 如果点击的是按钮或交互元素，不拦截拖动
    if (ev.target && ev.target.closest && ev.target.closest('button, .ctrl-btn, .win-btn, select, input')) return;

    const t = ev.changedTouches[0];
    if (!t) return;
    touchDown = true;
    mouseDown = false;
    pointerDown = false;
    touchId = t.identifier;
    pointerId = null;
    _startDrag(t.clientX, t.clientY, ev);
    dragging = false;
    try{ ev.preventDefault(); }catch(e){}
  }

  function onTouchMove(ev){
    if (!touchDown) return;
    const t = _getTouchPoint(ev);
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) >= touchThreshold) dragging = true;
    if (!dragging) return;
    try{ ev.preventDefault(); }catch(e){}
    _scheduleApply(dx, dy, ev);
  }

  function onTouchEnd(ev){
    if (!touchDown) return;
    const t = _getTouchPoint(ev);
    if (!t) return;
    touchDown = false;
    dragging = false;
    touchId = null;
    if (rafId) {
      try{ cancelAnimationFrame(rafId); }catch(e){}
      rafId = 0;
    }
    pending = null;
    if (options.onEnd) options.onEnd(ev, target.getBoundingClientRect());
  }

  function onPointerDown(ev){
    if (!ev) return;
    if (ev.button !== 0) return;
    if (ev.target && ev.target.closest && ev.target.closest('button, .ctrl-btn, .win-btn, select, input')) return;
    pointerDown = true;
    mouseDown = false;
    touchDown = false;
    touchId = null;
    pointerId = ev.pointerId;
    _startDrag(ev.clientX, ev.clientY, ev);
    dragging = false;
    if (handle && handle.style) handle.style.cursor = 'grabbing';
    try{
      if (handle.setPointerCapture) handle.setPointerCapture(pointerId);
    }catch(e){}
    try{ ev.preventDefault(); }catch(e){}
  }

  function onPointerMove(ev){
    if (!pointerDown) return;
    if (pointerId != null && ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) >= mouseThreshold) dragging = true;
    if (!dragging) return;
    try{ ev.preventDefault(); }catch(e){}
    _scheduleApply(dx, dy, ev);
  }

  function onPointerUp(ev){
    if (!pointerDown) return;
    if (pointerId != null && ev.pointerId !== pointerId) return;
    pointerDown = false;
    dragging = false;
    pointerId = null;
    if (rafId) {
      try{ cancelAnimationFrame(rafId); }catch(e){}
      rafId = 0;
    }
    pending = null;
    if (handle && handle.style) handle.style.cursor = '';
    if (options.onEnd) options.onEnd(ev, target.getBoundingClientRect());
  }

  if (usePointerEvents) {
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove, { passive: false });
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  } else {
    handle.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    handle.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
  }

  return function detach(){
    if (rafId) {
      try{ cancelAnimationFrame(rafId); }catch(e){}
      rafId = 0;
    }
    pending = null;
    if (usePointerEvents) {
      try{ handle.removeEventListener('pointerdown', onPointerDown); }catch(e){}
      try{ handle.removeEventListener('pointermove', onPointerMove); }catch(e){}
      try{ handle.removeEventListener('pointerup', onPointerUp); }catch(e){}
      try{ handle.removeEventListener('pointercancel', onPointerUp); }catch(e){}
    } else {
      try{ handle.removeEventListener('mousedown', onMouseDown); }catch(e){}
      try{ window.removeEventListener('mousemove', onMouseMove); }catch(e){}
      try{ window.removeEventListener('mouseup', onMouseUp); }catch(e){}
      try{ handle.removeEventListener('touchstart', onTouchStart); }catch(e){}
      try{ window.removeEventListener('touchmove', onTouchMove); }catch(e){}
      try{ window.removeEventListener('touchend', onTouchEnd); }catch(e){}
      try{ window.removeEventListener('touchcancel', onTouchEnd); }catch(e){}
    }
  };
}
