/**
 * message.js
 *
 * 统一的事件总线（基于 MiniEventEmitter），用于：
 * - 渲染进程内：模块之间解耦通信（UI、绘图引擎、设置、插件等）
 * - 渲染进程 ↔ 主进程：通过 preload 暴露的 electronAPI 转发关键事件（见 ipc_bridge.js / main.js）
 *
 * 设计目标：
 * - 轻量、同步触发、无外部依赖
 * - 用字符串事件名 + 统一 EVENTS 常量，避免散落魔法字符串
 */

import MiniEventEmitter from './mini_eventemitter.js';

const bus = new MiniEventEmitter();

/**
 * 事件名常量表。
 * 说明：
 * - 这些事件主要用于渲染进程内部模块协作
 * - 部分事件会被桥接到主进程（例如 REQUEST_FILE_WRITE），以便执行受限能力（文件写入等）
 */
export const EVENTS = {
  /** 子菜单打开 */
  SUBMENU_OPEN: 'submenu:open',
  /** 子菜单关闭 */
  SUBMENU_CLOSE: 'submenu:close',
  /** 子菜单固定/取消固定 */
  SUBMENU_PIN: 'submenu:pin',
  /** 子菜单被拖拽移动（固定状态下） */
  SUBMENU_MOVE: 'submenu:move',
  
  /** 工具栏位置发生变化（拖拽） */
  TOOLBAR_MOVE: 'toolbar:move',
  /** 打开设置面板 */
  OPEN_SETTINGS: 'ui:open-settings',
  /** 请求导出当前页面 */
  REQUEST_EXPORT: 'ui:request-export',
  /** 打开关于对话框 */
  OPEN_ABOUT: 'ui:open-about',
  /** 切换视频展台显示 */
  TOGGLE_VIDEO_BOOTH: 'ui:toggle-video-booth',
  /** 请求主进程执行文件写入（渲染进程内仅发事件，主进程处理具体 I/O） */
  REQUEST_FILE_WRITE: 'io:request-file-write',
  /** 设置已变更（payload 为合并后的完整设置对象） */
  SETTINGS_CHANGED: 'settings:changed',
  /** 应用模式切换（白板 / 批注） */
  APP_MODE_CHANGED: 'app:mode-changed',
  /** 撤销/重做可用状态变更（绘图引擎 → UI） */
  HISTORY_CHANGED: 'history:changed',
  
  /** 应用准备退出/重启（主进程 → 渲染进程） */
  APP_PREPARE_EXIT: 'app:prepare-exit',
  
  /** 主进程 → 渲染进程（保留字段，当前主要使用 electronAPI 通道） */
  MAIN_PROCESS_MSG: 'main:message',
  /** 渲染进程 → 主进程（保留字段，当前主要使用 electronAPI 通道） */
  RENDERER_PROCESS_MSG: 'renderer:message'
};

/**
 * 消息通信模块（对 MiniEventEmitter 的薄封装）。
 *
 * 约定：
 * - on/off/once 返回值遵循 MiniEventEmitter 的语义
 * - emit 为同步触发：监听器内部异常会被捕获并打印，不影响后续监听器执行
 */
export default {
  /**
   * 订阅事件
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 事件回调函数
   * @returns {Function} 取消订阅函数
   */
  on: (eventName, callback) => bus.on(eventName, callback),
  
  /**
   * 取消订阅事件
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 要移除的回调函数
   * @returns {void}
   */
  off: (eventName, callback) => bus.off(eventName, callback),
  
  /**
   * 发送事件
   * @param {string} eventName - 事件名称
   * @param {...*} args - 传递的数据
   * @returns {void}
   */
  emit: (eventName, ...args) => bus.emit(eventName, ...args),
  
  /**
   * 一次性订阅事件（仅响应一次）
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 事件回调函数
   * @returns {Function} 取消订阅函数
   */
  once: (eventName, callback) => bus.once(eventName, callback),
  
  EVENTS
};
