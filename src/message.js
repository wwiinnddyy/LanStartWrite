// message.js
// 进程与模块间的通信总线（基于 mini_eventemitter）
// 用于主进程、渲染进程、以及渲染进程内各模块之间的事件通信

import MiniEventEmitter from './mini_eventemitter.js';

const bus = new MiniEventEmitter();

// 常用事件名（字符串常量），方便调用方统一使用
export const EVENTS = {
  // 菜单相关事件
  SUBMENU_OPEN: 'submenu:open',
  SUBMENU_CLOSE: 'submenu:close',
  SUBMENU_PIN: 'submenu:pin',
  SUBMENU_MOVE: 'submenu:move',
  
  // 工具栏相关事件
  TOOLBAR_MOVE: 'toolbar:move',
  // UI actions
  OPEN_SETTINGS: 'ui:open-settings',
  REQUEST_EXPORT: 'ui:request-export',
  OPEN_ABOUT: 'ui:open-about',
  // file write request for main process handlers
  REQUEST_FILE_WRITE: 'io:request-file-write',
  // settings changed
  SETTINGS_CHANGED: 'settings:changed',
  // history/undo state changed (renderer -> UI)
  HISTORY_CHANGED: 'history:changed',
  
  // 主进程与渲染进程通信
  MAIN_PROCESS_MSG: 'main:message',
  RENDERER_PROCESS_MSG: 'renderer:message'
};

/**
 * 消息通信模块
 * 提供简单的发布-订阅接口
 */
export default {
  /**
   * 订阅事件
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 事件回调函数
   */
  on: (eventName, callback) => bus.on(eventName, callback),
  
  /**
   * 取消订阅事件
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 要移除的回调函数
   */
  off: (eventName, callback) => bus.off(eventName, callback),
  
  /**
   * 发送事件
   * @param {string} eventName - 事件名称
   * @param {...*} args - 传递的数据
   */
  emit: (eventName, ...args) => bus.emit(eventName, ...args),
  
  /**
   * 一次性订阅事件（仅响应一次）
   * @param {string} eventName - 事件名称
   * @param {Function} callback - 事件回调函数
   */
  once: (eventName, callback) => bus.once(eventName, callback),
  
  EVENTS
};
