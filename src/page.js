// page.js — 分页管理与底部左侧翻页工具栏
import { getSnapshot, loadSnapshot } from './renderer.js';

function initPageToolbar(){
  const pages = [];
  let current = 0;

  // 初始页面快照
  try { pages.push(getSnapshot()); } catch (e) { pages.push([]); }

  // 创建工具栏 DOM
  const toolbar = document.createElement('div');
  toolbar.id = 'pageToolbar';
  toolbar.setAttribute('role', 'toolbar');

  function makeBtn(text, title){
    const b = document.createElement('button');
    b.className = 'page-btn';
    b.textContent = text;
    b.title = title || '';
    return b;
  }

  const prevBtn = makeBtn('‹', '上一页');
  const nextBtn = makeBtn('›', '下一页');

  // 页码标签，放在上一页/下一页中间
  const label = document.createElement('div');
  label.className = 'page-label';

  // 新建按钮放到单独的圆角矩形控件中
  const newContainer = document.createElement('div');
  newContainer.className = 'page-new';
  const newBtn = document.createElement('button');
  newBtn.className = 'page-new-btn';
  newBtn.textContent = '+ 新建';
  newBtn.title = '新建页面';
  newContainer.appendChild(newBtn);

  // 按钮布局： prev | label | next
  toolbar.appendChild(prevBtn);
  toolbar.appendChild(label);
  toolbar.appendChild(nextBtn);
  // 新建控件独立放置在工具栏右侧（也可调整位置样式）
  toolbar.appendChild(newContainer);
  document.body.appendChild(toolbar);

  function updateUI(){
    label.textContent = `${current+1} / ${pages.length}`;
    prevBtn.disabled = current <= 0;
    prevBtn.style.opacity = prevBtn.disabled ? '0.5' : '1';
    // 下一页始终可点击（若在末页则会创建新页面）
    nextBtn.style.opacity = '1';
  }

  function saveCurrent(){
    try { pages[current] = getSnapshot(); } catch(e){ pages[current] = []; }
  }

  prevBtn.addEventListener('click', ()=>{
    if (current <= 0) return;
    saveCurrent();
    current -= 1;
    loadSnapshot(pages[current] || []);
    updateUI();
  });

  nextBtn.addEventListener('click', ()=>{
    saveCurrent();
    if (current >= pages.length - 1) {
      // 在末页时，下一页操作等同于新建页面
      pages.push([]);
      current = pages.length - 1;
      loadSnapshot([]);
    } else {
      current += 1;
      loadSnapshot(pages[current] || []);
    }
    updateUI();
  });

  newBtn.addEventListener('click', ()=>{
    saveCurrent();
    pages.push([]);
    current = pages.length - 1;
    loadSnapshot([]);
    updateUI();
  });

  updateUI();
}

// initialize immediately if DOM is ready, otherwise wait for DOMContentLoaded
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initPageToolbar);
} else {
  initPageToolbar();
}

export { initPageToolbar };
