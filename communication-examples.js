/**
 * communication-examples.js
 * 进程与模块间通信的实际使用示例
 * 这个文件可以作为参考，不需要包含在最终项目中
 */

// =====================================
// 示例 1: 模块间通信 - 清空页面后切换为笔模式
// =====================================

// 在 ui-tools.js 或任何需要检测清空事件的模块
import Message, { EVENTS } from './message.js';

// 定义自定义事件常量（可以在 message.js 中添加）
const CUSTOM_EVENTS = {
  CANVAS_CLEARED: 'canvas:cleared',
  MODE_CHANGED: 'mode:changed'
};

// 监听画布清空事件
Message.on(CUSTOM_EVENTS.CANVAS_CLEARED, () => {
  console.log('🎨 画布已清空，切换到笔模式');
  // 这里可以触发其他相关的 UI 更新
  updateToolbarState();
});

// 在 clear 按钮点击处理器中发送事件
function handleClearButtonClick() {
  clearAll(); // 清空操作
  Message.emit(CUSTOM_EVENTS.CANVAS_CLEARED);
  Message.emit(CUSTOM_EVENTS.MODE_CHANGED, { mode: 'pen' });
}

// =====================================
// 示例 2: 工具状态同步
// =====================================

// 当笔的颜色改变时通知其他模块
function handleColorChange(color) {
  setBrushColor(color);
  Message.emit('brush:color-changed', { color });
}

// 当橡皮大小改变时通知其他模块
function handleEraserSizeChange(size) {
  setEraserSize(size);
  Message.emit('eraser:size-changed', { size });
}

// 其他模块监听这些事件更新 UI
Message.on('brush:color-changed', (data) => {
  console.log('笔颜色已改变为:', data.color);
});

Message.on('eraser:size-changed', (data) => {
  console.log('橡皮大小已改变为:', data.size);
});

// =====================================
// 示例 3: 主进程与渲染进程通信
// =====================================

// ===== 渲染进程中 =====

// 保存画布内容到文件
async function saveCanvasToFile(canvasContent) {
  try {
    // 调用主进程的 handle 处理程序
    const result = await window.electronAPI.invokeMain('save-canvas', {
      content: canvasContent,
      filename: `drawing_${Date.now()}.json`
    });

    if (result.success) {
      console.log('✅ 画布已保存到:', result.filePath);
      Message.emit('canvas:saved', { path: result.filePath });
    }
  } catch (error) {
    console.error('❌ 保存失败:', error);
  }
}

// 监听主进程发送的消息
window.electronAPI.onReplyFromMain('file-operation', (data) => {
  console.log('📨 收到来自主进程的消息:', data);
  
  if (data.type === 'file-saved') {
    Message.emit('file:saved', { path: data.path });
  } else if (data.type === 'file-loaded') {
    Message.emit('file:loaded', { content: data.content });
  }
});

// ===== 主进程中 (main.js) =====

// 处理渲染进程的保存请求
ipcMain.handle('save-canvas', async (event, data) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // 保存到用户文档目录
    const docPath = app.getPath('documents');
    const filePath = path.join(docPath, 'LanStart', data.filename);
    
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 写入文件
    fs.writeFileSync(filePath, JSON.stringify(data.content, null, 2));
    
    // 发送成功消息给渲染进程
    mainWindow.webContents.send('file-operation', {
      type: 'file-saved',
      path: filePath,
      timestamp: Date.now()
    });
    
    return {
      success: true,
      filePath,
      message: '文件保存成功'
    };
  } catch (error) {
    console.error('保存文件时出错:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// =====================================
// 示例 4: 一次性监听事件
// =====================================

// 只监听第一次工具栏打开事件
Message.once('toolbar:opened', () => {
  console.log('🔔 工具栏首次打开 - 这条消息只会显示一次');
  initializeToolbarAnimation();
});

// 之后再次打开工具栏时不会触发回调

// =====================================
// 示例 5: 防抖处理频繁事件
// =====================================

let repositionTimeout = null;

// 监听工具栏移动事件（频繁触发）
Message.on('toolbar:move', (data) => {
  // 清除之前的定时器
  if (repositionTimeout) clearTimeout(repositionTimeout);
  
  // 防抖：只在最后一次移动 100ms 后执行
  repositionTimeout = setTimeout(() => {
    console.log('工具栏最终位置:', data);
    updateToolbarPosition(data.left, data.top);
  }, 100);
});

// =====================================
// 示例 6: 取消监听避免内存泄漏
// =====================================

// 定义回调函数（这样可以后续取消监听）
const handleMenuOpen = (data) => {
  console.log('菜单已打开:', data.id);
};

// 注册监听
Message.on('submenu:open', handleMenuOpen);

// 在组件销毁或不再需要时取消监听
function cleanup() {
  Message.off('submenu:open', handleMenuOpen);
  console.log('✓ 已取消菜单打开事件监听');
}

// =====================================
// 示例 7: 扩展事件系统
// =====================================

// 在 message.js 中添加新的事件常量
export const EXTENDED_EVENTS = {
  // 绘图相关
  BRUSH_CHANGED: 'brush:changed',
  ERASER_ACTIVATED: 'eraser:activated',
  ERASER_DEACTIVATED: 'eraser:deactivated',
  
  // 文件相关
  FILE_SAVED: 'file:saved',
  FILE_LOADED: 'file:loaded',
  FILE_EXPORT: 'file:export',
  
  // 历史记录相关
  HISTORY_UNDO: 'history:undo',
  HISTORY_REDO: 'history:redo',
  
  // 应用状态相关
  APP_STATE_CHANGED: 'app:state-changed',
  THEME_CHANGED: 'app:theme-changed'
};

// 发送自定义事件
function notifyEraserActivated(mode) {
  Message.emit('eraser:activated', {
    mode, // 'pixel', 'rect', 'stroke'
    size: getToolState().eraserSize,
    timestamp: Date.now()
  });
}

// 监听自定义事件
Message.on('eraser:activated', (data) => {
  console.log(`🔴 橡皮已激活: ${data.mode} 模式，大小: ${data.size}`);
  updateUIForEraserMode(data.mode);
});

// =====================================
// 示例 8: 条件性消息分发
// =====================================

// 根据应用状态发送不同的消息
function handleStateChange(newState) {
  if (newState === 'ready') {
    Message.emit('app:state-changed', {
      state: 'ready',
      timestamp: Date.now(),
      features: ['draw', 'erase', 'clear']
    });
  } else if (newState === 'error') {
    Message.emit('app:state-changed', {
      state: 'error',
      message: '应用出错'
    });
  }
}

// 监听并处理状态变化
Message.on('app:state-changed', (data) => {
  switch(data.state) {
    case 'ready':
      console.log('✅ 应用已就绪');
      enableAllTools();
      break;
    case 'error':
      console.log('❌ ' + data.message);
      disableAllTools();
      break;
  }
});

// =====================================
// 导出示例配置（可复制到实际项目）
// =====================================

/**
 * 推荐的通信使用模式：
 * 
 * 1. 定义事件常量 - 在 message.js 的 EVENTS 对象中
 * 2. 发送事件 - Message.emit(eventName, data)
 * 3. 监听事件 - Message.on(eventName, callback)
 * 4. 取消监听 - Message.off(eventName, callback)
 * 5. 一次性监听 - Message.once(eventName, callback)
 * 
 * 主进程通信：
 * 1. 渲染进程调用 - await window.electronAPI.invokeMain(channel, data)
 * 2. 主进程处理 - ipcMain.handle(channel, handler)
 * 3. 主进程回复 - mainWindow.webContents.send(channel, data)
 * 4. 渲染进程接收 - window.electronAPI.onReplyFromMain(channel, callback)
 */
