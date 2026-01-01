import { setEraserSize, setEraserMode, setErasing, getToolState } from './renderer.js';
import { cleanupMenuStyles } from './more_decide_windows.js';

const eraserSizeInput = document.getElementById('eraserSize');
const erasePixelBtn = document.getElementById('erasePixel');
const eraseRectBtn = document.getElementById('eraseRect');
const eraseStrokeBtn = document.getElementById('eraseStroke');
const eraserMenu = document.getElementById('eraserMenu');
const eraserTool = document.getElementById('eraserTool');
const eraserModeLabel = document.getElementById('eraserModeLabel');

export function updateEraserModeLabel(){
  const s = getToolState();
  if (eraserModeLabel) eraserModeLabel.textContent = `橡皮模式: ${s.eraserMode} / ${s.eraserSize}`;
}

export function initEraserUI(){
  if (eraserSizeInput) eraserSizeInput.addEventListener('input', (e)=>{ setEraserSize(Number(e.target.value)); updateEraserModeLabel(); try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){} });

  function updateEraserModeUI(mode){
    if (erasePixelBtn) erasePixelBtn.classList.toggle('active', mode==='pixel');
    if (eraseRectBtn) eraseRectBtn.classList.toggle('active', mode==='rect');
    if (eraseStrokeBtn) eraseStrokeBtn.classList.toggle('active', mode==='stroke');
    updateEraserModeLabel();
    try{ window.dispatchEvent(new Event('toolbar:sync')); }catch(err){}
  }

  if (erasePixelBtn) erasePixelBtn.addEventListener('click', ()=>{ setEraserMode('pixel'); updateEraserModeUI('pixel'); });
  if (eraseRectBtn) eraseRectBtn.addEventListener('click', ()=>{ setEraserMode('rect'); updateEraserModeUI('rect'); });
  if (eraseStrokeBtn) eraseStrokeBtn.addEventListener('click', ()=>{ setEraserMode('stroke'); updateEraserModeUI('stroke'); });

  // clicking a mode should close menu and remove active state if needed
  // ensure eraser UI initialized
  updateEraserModeUI(getToolState().eraserMode || 'pixel');
}

export default {
  initEraserUI,
  updateEraserModeLabel
};
