export function applyModeCanvasBackground(mode, canvasColor, deps){
  try{
    const wrap = document.querySelector('.canvas-wrap');
    const board = document.getElementById('board');
    const root = document.documentElement;
    const isDarkUi = !!(root && root.classList && root.classList.contains('theme-dark'));

    const map = {
      white: { bg: isDarkUi ? '#121212' : '#ffffff', pen: isDarkUi ? '#ffffff' : '#000000' },
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
    const getPreferredPenColor = deps && deps.getPreferredPenColor;

    const newPen = cfg.pen;
    const normalize = (c) => String(c || '').toLowerCase();
    const isAutoPen = (c) => {
      const n = normalize(c);
      return n === '#000000' || n === '#ffffff';
    };
    const preferredPen = (typeof getPreferredPenColor === 'function') ? getPreferredPenColor(mode) : null;
    const preferredNorm = normalize(preferredPen);
    const defaultPreferred = (mode === 'annotation') ? '#ff0000' : '#000000';
    const allowAutoSwitch = (mode !== 'annotation') && (preferredNorm === defaultPreferred);

    try{
      if (allowAutoSwitch && typeof getToolState === 'function' && typeof replaceStrokeColors === 'function') {
        const toolState = getToolState();
        const oldPen = toolState && toolState.brushColor;
        if (isAutoPen(oldPen) && normalize(oldPen) !== normalize(newPen)) replaceStrokeColors(oldPen, newPen);
      }
    }catch(e){}

    try{
      if (allowAutoSwitch && typeof getToolState === 'function' && typeof setBrushColor === 'function') {
        const toolState = getToolState();
        const cur = toolState && toolState.brushColor;
        if (isAutoPen(cur)) setBrushColor(newPen);
      }
    }catch(e){}
    try{ if (typeof updatePenModeLabel === 'function') updatePenModeLabel(); }catch(e){}
  }catch(e){}
}
