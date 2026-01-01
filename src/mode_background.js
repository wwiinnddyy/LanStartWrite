export function applyModeCanvasBackground(mode, canvasColor, deps){
  try{
    const wrap = document.querySelector('.canvas-wrap');
    const board = document.getElementById('board');

    const map = {
      white: { bg: '#ffffff', pen: '#000000' },
      black: { bg: '#000000', pen: '#ffffff' },
      chalkboard: { bg: '#041604ff', pen: '#ffffff' }
    };
    const cfg = map[canvasColor] || { bg: '#ffffff', pen: '#000000' };

    if (mode === 'annotation') {
      if (wrap) wrap.style.background = 'transparent';
      if (board) board.style.background = 'transparent';
    } else {
      if (wrap) wrap.style.background = cfg.bg;
      if (board) board.style.background = cfg.bg;
    }

    const getToolState = deps && deps.getToolState;
    const replaceStrokeColors = deps && deps.replaceStrokeColors;
    const setBrushColor = deps && deps.setBrushColor;
    const updatePenModeLabel = deps && deps.updatePenModeLabel;

    const newPen = cfg.pen;

    try{
      if (typeof getToolState === 'function' && typeof replaceStrokeColors === 'function') {
        const toolState = getToolState();
        const oldPen = toolState && toolState.brushColor;
        if (oldPen !== newPen && (oldPen === '#000000' || oldPen === '#ffffff')) replaceStrokeColors(oldPen, newPen);
      }
    }catch(e){}

    try{ if (typeof setBrushColor === 'function') setBrushColor(newPen); }catch(e){}
    try{ if (typeof updatePenModeLabel === 'function') updatePenModeLabel(); }catch(e){}
  }catch(e){}
}
