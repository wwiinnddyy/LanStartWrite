// drag_helper.js
// 通用拖动辅助：绑定在 `handle` 上，移动 `target` 元素。
// options: { clampRect: ()=>{left,top,right,bottom} , onMove, onEnd, threshold }
export function attachDragHelper(handle, target, options = {}){
  if (!handle || !target) return null;
  const mouseThreshold = (typeof options.threshold === 'number') ? options.threshold : 2;
  const touchThreshold = (typeof options.touchThreshold === 'number') ? options.touchThreshold : 5;
  let mouseDown = false;
  let touchDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let touchId = null;

  function getRect(){
    if (options.clampRect && typeof options.clampRect === 'function') return options.clampRect();
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  function _applyDelta(dx, dy, ev){
    let left = startLeft + dx;
    let top = startTop + dy;
    try{
      const c = getRect();
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
    if (options.onMove) options.onMove({ left, top, ev });
  }

  function onMouseDown(ev){
    if (!ev || ev.button !== 0) return;
    // 如果点击的是按钮或交互元素，不拦截拖动（或者说不干扰其点击）
    if (ev.target && ev.target.closest && ev.target.closest('button, .ctrl-btn, .win-btn, select, input')) return;
    
    mouseDown = true;
    touchDown = false;
    touchId = null;
    startX = ev.clientX; startY = ev.clientY;
    const r = target.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    dragging = false;
    if (handle && handle.style) handle.style.cursor = 'grabbing';
    if (options.onStart) options.onStart(ev);
    try{ ev.preventDefault(); }catch(e){}
  }

  function onMouseMove(ev){
    if (!mouseDown) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) >= mouseThreshold) dragging = true;
    if (!dragging) return;
    try{ ev.preventDefault(); }catch(e){}
    _applyDelta(dx, dy, ev);
  }

  function onMouseUp(ev){
    if (!mouseDown) return;
    mouseDown = false;
    dragging = false;
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
    touchId = t.identifier;
    startX = t.clientX; startY = t.clientY;
    const r = target.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    dragging = false;
    if (options.onStart) options.onStart(ev);
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
    _applyDelta(dx, dy, ev);
  }

  function onTouchEnd(ev){
    if (!touchDown) return;
    const t = _getTouchPoint(ev);
    if (!t) return;
    touchDown = false;
    dragging = false;
    touchId = null;
    if (options.onEnd) options.onEnd(ev, target.getBoundingClientRect());
  }

  handle.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove, { passive: false });
  window.addEventListener('mouseup', onMouseUp);
  handle.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);

  return function detach(){
    try{ handle.removeEventListener('mousedown', onMouseDown); }catch(e){}
    try{ window.removeEventListener('mousemove', onMouseMove); }catch(e){}
    try{ window.removeEventListener('mouseup', onMouseUp); }catch(e){}
    try{ handle.removeEventListener('touchstart', onTouchStart); }catch(e){}
    try{ window.removeEventListener('touchmove', onTouchMove); }catch(e){}
    try{ window.removeEventListener('touchend', onTouchEnd); }catch(e){}
    try{ window.removeEventListener('touchcancel', onTouchEnd); }catch(e){}
  };
}
