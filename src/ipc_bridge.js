/**
 * ipc_bridge.js
 *
 * 渲染进程内的 IPC 桥：将 Message 总线上的特定事件转发到主进程处理。
 *
 * 背景：
 * - 渲染进程应避免直接访问 Node.js 文件系统能力（安全/权限边界）
 * - 通过 electronAPI.invokeMain('message', ...) 走主进程白名单通道
 */
import Message, { EVENTS } from './message.js';

/**
 * 转发文件写入请求到主进程，并将结果回灌到 Message 总线。
 * 事件链路：
 * - 渲染进程：Message.emit(EVENTS.REQUEST_FILE_WRITE, { path, content })
 * - 本桥接：invokeMain('message','io:request-file-write', payload)
 * - 主进程：ipcMain.handle('message', ...) 执行写入并返回结果
 * - 本桥接：Message.emit('io:request-file-write:result', res)
 */
Message.on(EVENTS.REQUEST_FILE_WRITE, async (payload)=>{
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function'){
      const res = await window.electronAPI.invokeMain('message', 'io:request-file-write', payload);
      try{ Message.emit('io:request-file-write:result', res); }catch(e){}
    } else {
      console.warn('ipc_bridge: electronAPI.invokeMain not available');
    }
  }catch(e){ console.warn('ipc_bridge forward failed', e); }
});

Message.on(EVENTS.TOOLBAR_MOVE, (payload) => {
  try {
    const isToolbarWindow = window.location.search.includes('toolbarWindow=1');
    if (isToolbarWindow && window.electronAPI && window.electronAPI.invokeMain) {
      // Use fire-and-forget for move events to avoid lag
      window.electronAPI.invokeMain('message', 'toolbar:move', { 
        screenDx: payload.screenDx || 0, 
        screenDy: payload.screenDy || 0 
      }).catch(() => {});
    }
  } catch (e) {}
});

/**
 * 说明：
 * - SETTINGS_CHANGED 事件不在此处转发，渲染进程内模块已直接订阅处理
 */
export default {};
