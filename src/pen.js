import { setBrushSize, setBrushColor, setErasing, getToolState } from './renderer.js';
import { cleanupMenuStyles } from './more_decide_windows.js';

const penSizeInput = document.getElementById('size');
const colorMenu = document.getElementById('colorMenu');
const colorTool = document.getElementById('colorTool');
const colorButtons = document.querySelectorAll('.color');
const penModeLabel = document.getElementById('penModeLabel');

export function updatePenModeLabel(){
  const s = getToolState();
  if (penModeLabel) penModeLabel.textContent = `笔: ${s.brushColor} / ${s.brushSize}`;
}

export function initPenUI(){
  if (penSizeInput) penSizeInput.addEventListener('input', (e)=>{ setBrushSize(Number(e.target.value)); updatePenModeLabel(); try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){} });

  colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setBrushColor(btn.dataset.color || '#000');
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
