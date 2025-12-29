# 进程与模块间的通信指南

本项目使用两层通信系统：
1. **模块间通信** - 基于 EventEmitter 的发布-订阅模式
2. **进程间通信** - 基于 Electron IPC 的主进程与渲染进程通信

## 模块间通信 (Message Bus)

### 概述
所有渲染进程内的模块可以通过 `message.js` 模块进行通信。

### 导入
```javascript
import Message, { EVENTS } from './message.js';
```

### API 方法

#### 1. on(eventName, callback)
订阅事件，每次触发时执行回调

```javascript
Message.on(EVENTS.TOOLBAR_MOVE, (data) => {
  console.log('工具栏移动到:', data.left, data.top);
});
```

#### 2. off(eventName, callback)
取消订阅事件

```javascript
const handleToolbarMove = (data) => { /* ... */ };
Message.on(EVENTS.TOOLBAR_MOVE, handleToolbarMove);
// 之后取消订阅
Message.off(EVENTS.TOOLBAR_MOVE, handleToolbarMove);
```

#### 3. emit(eventName, ...args)
发送事件，触发所有监听该事件的回调

```javascript
Message.emit(EVENTS.TOOLBAR_MOVE, { left: 100, top: 200 });
```

#### 4. once(eventName, callback)
订阅事件但仅响应一次

```javascript
Message.once(EVENTS.SUBMENU_OPEN, (data) => {
  console.log('菜单打开（仅此一次）:', data);
});
```

### 内置事件列表

| 事件常量 | 对应值 | 触发场景 | 传递数据 |
|---------|--------|---------|---------|
| `SUBMENU_OPEN` | `'submenu:open'` | 子菜单打开时 | `{ id: string, pinned?: boolean }` |
| `SUBMENU_CLOSE` | `'submenu:close'` | 子菜单关闭时 | `{ id: string }` |
| `SUBMENU_PIN` | `'submenu:pin'` | 子菜单钉住/解钉时 | `{ id: string, pinned: boolean }` |
| `SUBMENU_MOVE` | `'submenu:move'` | 子菜单移动时 | `{ id: string, left: number, top: number }` |
| `TOOLBAR_MOVE` | `'toolbar:move'` | 工具栏移动时 | `{ left: number, top: number }` |

### 示例：添加自定义事件

```javascript
// 定义新事件常量
export const EVENTS = {
  // ... 现有事件
  DRAWING_STARTED: 'drawing:started',
  DRAWING_ENDED: 'drawing:ended',
  CLEAR_CANVAS: 'canvas:clear'
};

// 在绘图模块中发送事件
Message.emit(EVENTS.DRAWING_STARTED, { 
  x: 100, 
  y: 200, 
  color: '#000000' 
});

// 在其他模块中监听事件
Message.on(EVENTS.DRAWING_STARTED, (data) => {
  console.log('开始绘图于:', data.x, data.y);
  updateUIState(data);
});
```

## 进程间通信 (Electron IPC)

### 渲染进程调用 (在 HTML/JavaScript 中)

通过 `window.electronAPI` 访问主进程 API。

#### 1. 异步调用 - invokeMain(channel, data)
向主进程发送请求并等待回复（推荐用于需要返回值的操作）

```javascript
// 获取应用信息
const info = await window.electronAPI.invokeMain('message', 'get-info');
console.log('应用版本:', info.appVersion);
```

#### 2. 异步发送 - sendToMain(channel, data)
向主进程发送消息（不需要立即回复）

```javascript
window.electronAPI.sendToMain('message', {
  type: 'save-file',
  data: { /* ... */ }
});
```

#### 3. 监听回复 - onReplyFromMain(channel, callback)
监听来自主进程的消息

```javascript
window.electronAPI.onReplyFromMain('file-saved', (data) => {
  console.log('文件已保存:', data);
});
```

#### 4. 同步调用（不推荐）
```javascript
const result = window.electronAPI.ipcRenderer?.sendSync?.('sync-message', 'channel', data);
```

### 主进程处理 (main.js)

#### 1. 处理异步请求 - ipcMain.handle()
```javascript
ipcMain.handle('message', async (event, channel, data) => {
  if (channel === 'get-info') {
    return {
      appVersion: app.getVersion(),
      platform: process.platform
    };
  }
});
```

#### 2. 发送消息给渲染进程
```javascript
mainWindow.webContents.send('file-saved', { 
  filename: 'document.txt',
  success: true 
});
```

#### 3. 监听渲染进程消息
```javascript
ipcMain.on('fromRenderer', (event, arg) => {
  console.log('收到消息:', arg);
  event.reply('fromMain', 'Pong: ' + arg);
});
```

### 实际应用示例

#### 示例 1: 保存文件流程

**渲染进程 (renderer.js):**
```javascript
async function saveFile(content) {
  try {
    const result = await window.electronAPI.invokeMain('message', {
      channel: 'save-file',
      content: content,
      filename: 'canvas.json'
    });
    
    if (result.success) {
      console.log('文件已保存到:', result.path);
    }
  } catch (error) {
    console.error('保存失败:', error);
  }
}
```

**主进程 (main.js):**
```javascript
ipcMain.handle('message', async (event, data) => {
  if (data.channel === 'save-file') {
    const fs = require('fs');
    const path = require('path');
    
    const filePath = path.join(app.getPath('documents'), data.filename);
    fs.writeFileSync(filePath, JSON.stringify(data.content));
    
    return {
      success: true,
      path: filePath
    };
  }
});
```

#### 示例 2: 监听画布清空事件

**任何模块:**
```javascript
import Message, { EVENTS } from './message.js';

// 定义清空事件（在 message.js 中添加）
// CANVAS_CLEARED: 'canvas:cleared'

// 监听画布清空
Message.on(EVENTS.CANVAS_CLEARED, () => {
  console.log('画布已清空，重置 UI 状态');
  resetToolbar();
});

// 发送画布清空事件
function clearCanvas() {
  clearAll(); // 执行清空操作
  Message.emit(EVENTS.CANVAS_CLEARED);
}
```

## 最佳实践

1. **使用事件常量** - 在 `EVENTS` 对象中定义所有事件名，避免硬编码字符串
2. **错误处理** - 使用 try-catch 包裹 IPC 调用
3. **避免过度通信** - 对频繁的事件（如鼠标移动）进行防抖
4. **内存泄漏** - 记得在组件卸载时取消订阅
5. **数据序列化** - IPC 只支持可序列化的数据（JSON 兼容）

## 调试技巧

1. 在 `main.js` 中为 IPC 处理程序添加日志
2. 使用 Chrome DevTools（F12）在渲染进程中调试
3. 在 message.js 中添加拦截器来追踪所有事件
4. 使用 Electron DevTools 的 IPC 标签页监视通信
