// modules.js
// 集中导出 UI 相关模块与接口，方便外部调用。
// 说明（中文）：
// - Pen: 提供画笔相关的初始化与状态更新接口
// - Erase: 提供橡皮相关的初始化与状态更新接口
// - 更多工具：导出子菜单定位/固定/关闭等辅助函数
// - 渲染器：导出画布的核心 API（颜色、大小、清空、撤销/重做等）

// 画笔与橡皮模块
export { default as Pen } from './tool_bar/pen.js';
export { default as Erase } from './tool_bar/erese.js';
export { default as ButtonBox } from './tool_bar/button_box.js';
export { default as Status } from './status.js';

// 子菜单定位与固定逻辑（more_decide_windows.js）
export { showSubmenu, cleanupMenuStyles, initPinHandlers, closeAllSubmenus, positionMenu } from './tool_bar/more_decide_windows.js';

// 渲染器核心 API（直接复用 renderer.js 中的导出）
export {
  setBrushSize,
  setEraserSize,
  setBrushColor,
  setErasing,
  setEraserMode,
  getToolState,
  clearAll,
  undo,
  redo,
  getSnapshot,
  loadSnapshot
} from './renderer.js';

// 方便示例：初始化所有 UI
export function initAllUI(){
  // 初始化画笔与橡皮 UI
  const pen = Pen;
  const erase = Erase;
  if (pen && pen.initPenUI) pen.initPenUI();
  if (erase && erase.initEraserUI) erase.initEraserUI();
  // 初始化 pin handlers
  initPinHandlers();
}
