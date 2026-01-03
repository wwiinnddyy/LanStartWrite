// setting.js - simple settings store and helpers
const DEFAULTS = {
  toolbarCollapsed: false,
  enableAutoResize: true,
  toolbarPosition: { right: 20, top: 80 },
  // new settings
  theme: 'light', // 'light' | 'dark'
  showTooltips: true,
  multiTouchPen: false,
  smartInkRecognition: false,
  annotationPenColor: '#FF0000',
  whiteboardPenColor: '#000000',
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

export function normalizeHexColor(input, fallback){
  const raw = String(input || '').trim();
  if (!raw) return String(fallback || '').toUpperCase();
  const s = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return String(fallback || '').toUpperCase();
  return s.toUpperCase();
}

export function getPenColorSettingKey(appMode){
  return appMode === 'annotation' ? 'annotationPenColor' : 'whiteboardPenColor';
}

export function getDefaultPenColor(appMode){
  return appMode === 'annotation' ? DEFAULTS.annotationPenColor : DEFAULTS.whiteboardPenColor;
}

export function buildPenColorSettingsPatch(appMode, color){
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return { [key]: normalizeHexColor(color, def) };
}

export function getPenColorFromSettings(settings, appMode){
  const s = settings && typeof settings === 'object' ? settings : {};
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return normalizeHexColor(s[key], def);
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
