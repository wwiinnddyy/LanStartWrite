// setting.js - simple settings store and helpers
const DEFAULTS = {
  toolbarCollapsed: false,
  enableAutoResize: true,
  toolbarPosition: { right: 20, top: 80 },
  // new settings
  theme: 'light', // 'light' | 'dark'
  showTooltips: true,
  multiTouchPen: false,
  visualStyle: 'blur', // 'solid' | 'blur' | 'transparent'
  canvasColor: 'white', // 'white' | 'black' | 'chalkboard'
  shortcuts: { undo: 'Ctrl+Z', redo: 'Ctrl+Y' }
};

function _safeGet(key){
  try{ const v = localStorage.getItem(key); return v===null?null:JSON.parse(v); }catch(e){return null}
}

function _safeSet(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); return true; }catch(e){return false}
}

export function loadSettings(){
  const s = _safeGet('appSettings') || {};
  return Object.assign({}, DEFAULTS, s);
}

export function saveSettings(settings){
  const base = loadSettings();
  const merged = Object.assign({}, base, settings);
  _safeSet('appSettings', merged);
  return merged;
}

export function resetSettings(){
  _safeSet('appSettings', DEFAULTS);
  return DEFAULTS;
}

export default { loadSettings, saveSettings, resetSettings };
