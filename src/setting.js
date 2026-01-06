/**
 * setting.js
 *
 * 应用设置存储与辅助函数。
 *
 * 存储位置：
 * - localStorage['appSettings']（渲染进程）
 *
 * 设计要点：
 * - loadSettings() 总是返回 DEFAULTS 与持久化值合并后的“完整设置对象”
 * - 颜色相关字段做统一规范化（大写、补全 #、校验 6/8 位 HEX）
 * - 画笔颜色支持模式隔离：annotationPenColor / whiteboardPenColor
 */
const DEFAULTS = {
  toolbarCollapsed: false,
  enableAutoResize: true,
  toolbarPosition: { right: 20, top: 80 },
  // new settings
  theme: 'light', // 'light' | 'dark'
  showTooltips: true,
  multiTouchPen: false,
  smartInkRecognition: false,
  penTail: {
    enabled: false,
    intensity: 50,
    samplePoints: 10,
    speedSensitivity: 100,
    pressureSensitivity: 100,
    shape: 'natural',
    profile: 'standard'
  },
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

/**
 * 规范化 HEX 颜色字符串。
 * @param {string} input - 输入颜色（可含或不含 #）
 * @param {string} fallback - 输入非法时的回退颜色
 * @returns {string} 规范化后的颜色（大写，含 #）
 */
export function normalizeHexColor(input, fallback){
  const raw = String(input || '').trim();
  if (!raw) return String(fallback || '').toUpperCase();
  const s = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return String(fallback || '').toUpperCase();
  return s.toUpperCase();
}

/**
 * 根据应用模式获取对应的画笔颜色设置字段名。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {'annotationPenColor'|'whiteboardPenColor'} 设置字段名
 */
export function getPenColorSettingKey(appMode){
  return appMode === 'annotation' ? 'annotationPenColor' : 'whiteboardPenColor';
}

/**
 * 获取某模式下画笔默认颜色。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {string} 默认颜色（大写 HEX）
 */
export function getDefaultPenColor(appMode){
  return appMode === 'annotation' ? DEFAULTS.annotationPenColor : DEFAULTS.whiteboardPenColor;
}

/**
 * 构造“仅更新画笔颜色”的 settings patch，用于与 updateAppSettings 合并写入。
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @param {string} color - 目标颜色
 * @returns {Object} 可直接传入 Settings.saveSettings / updateAppSettings 的 patch
 */
export function buildPenColorSettingsPatch(appMode, color){
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return { [key]: normalizeHexColor(color, def) };
}

/**
 * 从 settings 对象中读取某模式的画笔颜色（带回退与规范化）。
 * @param {Object} settings - loadSettings() 返回或其子集
 * @param {'annotation'|'whiteboard'} appMode - 应用模式
 * @returns {string} 规范化颜色（大写 HEX）
 */
export function getPenColorFromSettings(settings, appMode){
  const s = settings && typeof settings === 'object' ? settings : {};
  const key = getPenColorSettingKey(appMode);
  const def = getDefaultPenColor(appMode);
  return normalizeHexColor(s[key], def);
}

/**
 * 读取设置：DEFAULTS 与持久化值合并。
 * @returns {Object} 完整设置对象
 */
export function loadSettings(){
  const s = _safeGet('appSettings') || {};
  return Object.assign({}, DEFAULTS, s);
}

/**
 * 保存设置：与当前设置合并后写入 localStorage。
 * @param {Object} settings - 需要合并保存的设置字段
 * @returns {Object} 合并后的完整设置对象
 */
export function saveSettings(settings){
  const base = loadSettings();
  const merged = Object.assign({}, base, settings);
  _safeSet('appSettings', merged);
  return merged;
}

/**
 * 重置设置为 DEFAULTS。
 * @returns {Object} DEFAULTS 引用
 */
export function resetSettings(){
  _safeSet('appSettings', DEFAULTS);
  return DEFAULTS;
}

export default { loadSettings, saveSettings, resetSettings };
