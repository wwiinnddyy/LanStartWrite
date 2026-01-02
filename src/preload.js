const { contextBridge, ipcRenderer } = require('electron');

/**
 * 向主进程发送消息的 API
 * @param {string} channel - 通道名称
 * @param {*} data - 要发送的数据
 */
const sendToMain = (channel, ...args) => ipcRenderer.send(channel, ...args);

/**
 * 接收来自主进程的回复
 * @param {string} channel - 通道名称
 * @param {Function} callback - 回调函数
 */
const onReplyFromMain = (channel, callback) => {
  ipcRenderer.on(channel, (event, ...args) => callback(...args));
};

/**
 * 调用主进程的处理程序（发送请求并等待回复）
 * @param {string} channel - 通道名称
 * @param {*} data - 要发送的数据
 * @returns {Promise} - 主进程的回复
 */
const invokeMain = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/**
 * 移除监听器
 * @param {string} channel - 通道名称
 * @param {Function} callback - 要移除的监听器
 */
const removeListener = (channel, callback) => ipcRenderer.removeListener(channel, callback);

/**
 * 向主进程发送消息（旧版本 API，已弃用但保留兼容）
 */
const send = (msg) => ipcRenderer.send('fromRenderer', msg);

/**
 * 接收来自主进程的回复（旧版本 API，已弃用但保留兼容）
 */
const onReply = (cb) => ipcRenderer.on('fromMain', (event, ...args) => cb(...args));

// 向渲染进程暴露 Electron API
contextBridge.exposeInMainWorld('electronAPI', {
  // 新的 IPC API
  sendToMain,
  onReplyFromMain,
  invokeMain,
  removeListener,
  
  // 旧版本 API（向后兼容）
  send,
  onReply
});
