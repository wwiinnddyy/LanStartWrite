import { setBrushSize, setBrushColor, setErasing, getToolState } from './renderer.js';
import { cleanupMenuStyles } from './more_decide_windows.js';
import { updateAppSettings } from './write_a_change.js';
import { buildPenColorSettingsPatch, normalizeHexColor } from './setting.js';

const penSizeInput = document.getElementById('size');
const colorMenu = document.getElementById('colorMenu');
const colorTool = document.getElementById('colorTool');
const colorButtons = document.querySelectorAll('.color');
const penModeLabel = document.getElementById('penModeLabel');

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

export function initPenUI(){
  if (penSizeInput) penSizeInput.addEventListener('input', (e)=>{ setBrushSize(Number(e.target.value)); updatePenModeLabel(); try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){} });

  colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const appMode = (document && document.body && document.body.dataset && document.body.dataset.appMode === 'annotation') ? 'annotation' : 'whiteboard';
      const nextColor = normalizeHexColor(btn.dataset.color, appMode === 'annotation' ? '#FF0000' : '#000000');
      setBrushColor(nextColor);
      try{
        updateAppSettings(buildPenColorSettingsPatch(appMode, nextColor));
      }catch(e){}
      setErasing(false);
      updatePenModeLabel();
      if (colorMenu) { cleanupMenuStyles(colorMenu); colorMenu.classList.remove('open'); colorMenu.setAttribute('aria-hidden','true'); }
      if (colorTool) colorTool.classList.remove('active');
      try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){}
    });
  });

  // initial label
  updatePenModeLabel();
}

export default {
  initPenUI,
  updatePenModeLabel
};
