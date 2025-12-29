// drag_helper.js
// 通用拖动辅助：绑定在 `handle` 上，移动 `target` 元素。
// options: { clampRect: ()=>{left,top,right,bottom} , onMove, onEnd, threshold }
export function attachDragHelper(handle, target, options = {}){
  if (!handle || !target) return null;
  const threshold = options.threshold || 2;
  let isPointerDown = false;
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let activePointerType = null;

  function getRect(){
    if (options.clampRect && typeof options.clampRect === 'function') return options.clampRect();
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }

  function onPointerDown(ev){
    isPointerDown = true;
    activePointerType = ev.pointerType || 'mouse';
    startX = ev.clientX; startY = ev.clientY;
    const r = target.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    dragging = (activePointerType === 'touch' || activePointerType === 'pen');
    try { if (ev.pointerId && handle.setPointerCapture) handle.setPointerCapture(ev.pointerId); } catch(e){}
    if (handle && handle.style) handle.style.cursor = 'grabbing';
    if (options.onStart) options.onStart(ev);
    ev.preventDefault();
  }

  function onPointerMove(ev){
    if (!isPointerDown) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const moved = Math.hypot(dx, dy) >= threshold;
    if (!dragging && activePointerType === 'mouse' && moved) dragging = true;
    if (dragging){
      ev.preventDefault();
      let left = startLeft + dx;
      let top = startTop + dy;
      // clamp
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
      // apply
      target.style.left = left + 'px';
      target.style.top = top + 'px';
      if (options.onMove) options.onMove({ left, top, ev });
    }
  }

  function onPointerUp(ev){
    if (!isPointerDown) return;
    isPointerDown = false; dragging = false; activePointerType = null;
    try { if (ev.pointerId && handle.releasePointerCapture) handle.releasePointerCapture(ev.pointerId); } catch(e){}
    if (handle && handle.style) handle.style.cursor = '';
    if (options.onEnd) options.onEnd(ev, target.getBoundingClientRect());
  }

  handle.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);

  return function detach(){
    try{ handle.removeEventListener('pointerdown', onPointerDown); }catch(e){}
    try{ window.removeEventListener('pointermove', onPointerMove); }catch(e){}
    try{ window.removeEventListener('pointerup', onPointerUp); }catch(e){}
  };
}
