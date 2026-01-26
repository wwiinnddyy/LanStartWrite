/**
 * pen.js
 *
 * 画笔 UI 模块：
 * - 负责颜色/粗细等 UI 控件的事件绑定
 * - 负责将用户选择同步到绘图引擎（renderer.js）
 * - 负责将“当前模式”的颜色写入设置（annotationPenColor / whiteboardPenColor）
 *
 * 关键约定：
 * - 颜色二级菜单使用事件委托绑定，避免因 DOM 重新渲染导致监听丢失
 * - 颜色规范化由 setting.normalizeHexColor 统一处理
 */
import { setBrushSize, setBrushColor, setErasing, getToolState } from '../renderer.js';
import { cleanupMenuStyles } from './more_decide_windows.js';
import { updateAppSettings } from '../write_a_change.js';
import { buildPenColorSettingsPatch, normalizeHexColor } from '../setting.js';

const penSizeInput = document.getElementById('size');
const colorMenu = document.getElementById('colorMenu');
const colorTool = document.getElementById('colorTool');
const penModeLabel = document.getElementById('penModeLabel');
let _bound = false;

export function updatePenModeLabel(){
  const s = getToolState();
  const mode = (document && document.body && document.body.dataset && document.body.dataset.appMode === 'annotation') ? '批注' : '白板';
  if (penModeLabel) penModeLabel.textContent = `${mode}笔: ${s.brushColor} / ${s.brushSize}`;
  try{
    const cur = String((s && s.brushColor) ? s.brushColor : '').toUpperCase();
    document.querySelectorAll('.color').forEach((btn)=>{
      const c = String(btn && btn.dataset ? btn.dataset.color : '').toUpperCase();
      const on = !!cur && !!c && cur === c;
      try{ btn.classList.toggle('selected', on); }catch(e){}
      try{ btn.setAttribute('aria-pressed', on ? 'true' : 'false'); }catch(e){}
    });
  }catch(e){}
}

/**
 * 初始化画笔 UI 事件。
 * @returns {void}
 */
export function initPenUI(){
  if (_bound) { updatePenModeLabel(); return; }
  _bound = true;
  if (penSizeInput) penSizeInput.addEventListener('input', (e)=>{ setBrushSize(Number(e.target.value)); updatePenModeLabel(); try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){} });

  /**
   * 应用用户选择的颜色：
   * 1) 规范化颜色值（避免非法输入）
   * 2) 立即更新绘图引擎 brushColor
   * 3) 写入设置以实现模式隔离与持久化
   * 4) 退出橡皮状态并同步 UI
   * @param {HTMLElement} btn - .color 按钮元素（需包含 data-color）
   * @returns {void}
   */
  const applyColorFromBtn = (btn)=>{
    if (!btn) return;
    const appMode = (document && document.body && document.body.dataset && document.body.dataset.appMode === 'annotation') ? 'annotation' : 'whiteboard';
    const nextColor = normalizeHexColor(btn.dataset && btn.dataset.color, appMode === 'annotation' ? '#C50F1F' : '#000000');
    setBrushColor(nextColor);
    try{ updateAppSettings(buildPenColorSettingsPatch(appMode, nextColor)); }catch(e){}
    setErasing(false);
    updatePenModeLabel();
    if (colorMenu) { cleanupMenuStyles(colorMenu); colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); }
    if (colorTool) colorTool.classList.remove('active');
    try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){}
  };

  if (colorMenu) {
    colorMenu.addEventListener('click', (e)=>{
      const btn = e && e.target && e.target.closest ? e.target.closest('.color') : null;
      if (!btn) return;
      applyColorFromBtn(btn);
    });
    colorMenu.addEventListener('pointerup', (e)=>{
      if (e && e.pointerType === 'mouse') return;
      const btn = e && e.target && e.target.closest ? e.target.closest('.color') : null;
      if (!btn) return;
      applyColorFromBtn(btn);
    });
  }

  // initial label
  updatePenModeLabel();
}

export default {
  initPenUI,
  updatePenModeLabel
};
