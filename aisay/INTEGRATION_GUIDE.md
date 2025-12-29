# 通信系统集成指南

## 项目概述

本项目实现了完整的进程与模块间通信系统，包括：

1. **模块间通信** - 渲染进程内各模块的事件总线
2. **进程间通信** - 主进程与渲染进程的双向 IPC 通信
3. **事件驱动架构** - 基于发布-订阅模式的解耦设计

## 文件结构

### 核心通信模块

| 文件 | 职责 | 说明 |
|------|------|------|
| `src/message.js` | 事件总线 | 渲染进程内的模块通信中枢 |
| `src/mini_eventemitter.js` | 事件发射器 | 轻量级 EventEmitter 实现 |
| `src/preload.js` | 桥接脚本 | 安全暴露 IPC API 到渲染进程 |
| `src/main.js` | 主进程 | Electron 主进程，处理 IPC 请求 |

### 文档

| 文件 | 内容 |
|------|------|
| `COMMUNICATION.md` | 详细的通信指南和 API 文档 |
| `COMMUNICATION_QUICK_REF.md` | 快速参考卡 |
| `communication-examples.js` | 完整的使用示例代码 |

## 实现的功能

### 1. 事件总线 (Message Bus)

**核心方法：**
- `Message.on(eventName, callback)` - 订阅事件
- `Message.off(eventName, callback)` - 取消订阅
- `Message.emit(eventName, data)` - 发送事件
- `Message.once(eventName, callback)` - 一次性监听

**内置事件：**
```javascript
{
  SUBMENU_OPEN,      // 子菜单打开
  SUBMENU_CLOSE,     // 子菜单关闭
  SUBMENU_PIN,       // 子菜单钉住/解钉
  SUBMENU_MOVE,      // 子菜单移动
  TOOLBAR_MOVE,      // 工具栏移动
  MAIN_PROCESS_MSG,  // 主进程消息
  RENDERER_PROCESS_MSG // 渲染进程消息
}
```

### 2. 进程间通信 (IPC)

**渲染进程 API (window.electronAPI)：**
```javascript
// 异步调用主进程（推荐）
const result = await window.electronAPI.invokeMain(channel, data);

// 发送消息（无需回复）
window.electronAPI.sendToMain(channel, data);

// 监听主进程回复
window.electronAPI.onReplyFromMain(channel, callback);

// 移除监听器
window.electronAPI.removeListener(channel, callback);
```

**主进程处理 (main.js)：**
```javascript
// 异步处理请求
ipcMain.handle('channel', async (event, data) => {
  return { success: true };
});

// 监听同步消息
ipcMain.on('channel', (event, data) => {
  event.reply('reply-channel', response);
});

// 发送消息给渲染进程
mainWindow.webContents.send('channel', data);
```

## 使用场景示例

### 场景 1: 清空页面后切换为笔模式

**需求：** 用户点击清空按钮后，自动将当前工具切换为笔模式

**实现：** 已在 `ui-tools.js` 中实现
```javascript
if (clearBtn) clearBtn.addEventListener('click', ()=>{
  clearAll();
  setErasing(false);  // 切换为笔模式
  if (eraserTool) eraserTool.classList.remove('active');
  updatePenModeLabel();
  updateEraserModeLabel();
});
```

**扩展方案（使用事件）：**
```javascript
// message.js 中添加事件常量
export const EVENTS = {
  // ...
  CANVAS_CLEARED: 'canvas:cleared'
};

// ui-tools.js 中发送事件
Message.emit(EVENTS.CANVAS_CLEARED);

// 其他模块监听
Message.on(EVENTS.CANVAS_CLEARED, () => {
  console.log('画布已清空');
  resetAllTools();
});
```

### 场景 2: 保存画布到文件

**流程：**
1. 用户点击保存按钮
2. 渲染进程调用主进程的保存功能
3. 主进程将画布数据写入文件
4. 主进程向渲染进程发送结果
5. 渲染进程显示保存成功提示

**代码实现：**

**渲染进程 (renderer.js):**
```javascript
async function saveCanvas() {
  const content = getCanvasData();
  
  try {
    const result = await window.electronAPI.invokeMain('save-canvas', {
      content,
      filename: `drawing_${Date.now()}.json`
    });
    
    if (result.success) {
      console.log('✅ 已保存到:', result.filePath);
      Message.emit('canvas:saved', { path: result.filePath });
    }
  } catch (error) {
    console.error('❌ 保存失败:', error);
    Message.emit('canvas:error', { error: error.message });
  }
}
```

**主进程 (main.js):**
```javascript
ipcMain.handle('save-canvas', async (event, data) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const docPath = app.getPath('documents');
    const filePath = path.join(docPath, 'LanStart', data.filename);
    
    // 创建目录
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 保存文件
    fs.writeFileSync(filePath, JSON.stringify(data.content, null, 2));
    
    // 通知渲染进程
    mainWindow.webContents.send('file-operation', {
      type: 'file-saved',
      path: filePath
    });
    
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 场景 3: 防止菜单频繁重新定位

**问题：** 工具栏移动时，子菜单需要重新定位，但频繁触发会影响性能

**解决方案：** 使用防抖处理
```javascript
let repositionTimeout = null;

Message.on(EVENTS.TOOLBAR_MOVE, () => {
  clearTimeout(repositionTimeout);
  repositionTimeout = setTimeout(() => {
    smartRepositionOpenSubmenus();
  }, 16); // 约 60fps
});
```

### 场景 4: 工具选择状态同步

**需求：** 当用户切换工具（笔/橡皮）时，所有相关 UI 应该及时更新

**实现：**
```javascript
// 定义事件常量
export const EXTENDED_EVENTS = {
  TOOL_SELECTED: 'tool:selected',
  ERASER_MODE_CHANGED: 'eraser:mode-changed'
};

// 笔工具被选中
colorTool.addEventListener('click', () => {
  setErasing(false);
  Message.emit(EXTENDED_EVENTS.TOOL_SELECTED, { tool: 'pen' });
});

// 橡皮工具被选中
eraserTool.addEventListener('click', () => {
  setErasing(true);
  Message.emit(EXTENDED_EVENTS.TOOL_SELECTED, { tool: 'eraser' });
});

// 橡皮模式改变
function setEraserModeUI(mode) {
  setEraserMode(mode);
  Message.emit(EXTENDED_EVENTS.ERASER_MODE_CHANGED, { mode });
}

// 其他模块可以监听这些事件
Message.on(EXTENDED_EVENTS.TOOL_SELECTED, (data) => {
  console.log('工具已切换:', data.tool);
  updateToolbarVisualState();
});
```

## 新增事件建议

为了更好地利用事件系统，建议在 `message.js` 中添加以下事件：

```javascript
export const EVENTS = {
  // ... 现有事件
  
  // 工具相关
  TOOL_SELECTED: 'tool:selected',
  BRUSH_CHANGED: 'brush:changed',
  ERASER_ACTIVATED: 'eraser:activated',
  ERASER_DEACTIVATED: 'eraser:deactivated',
  
  // 画布相关
  CANVAS_CLEARED: 'canvas:cleared',
  CANVAS_SAVED: 'canvas:saved',
  CANVAS_LOADED: 'canvas:loaded',
  
  // 历史记录相关
  HISTORY_CHANGED: 'history:changed',
  
  // 文件相关
  FILE_SAVED: 'file:saved',
  FILE_LOADED: 'file:loaded',
  FILE_EXPORT: 'file:export'
};
```

## 最佳实践

### ✅ 推荐做法

1. **使用事件常量**
   ```javascript
   Message.emit(EVENTS.CANVAS_CLEARED);  // ✅ 推荐
   Message.emit('canvas:cleared');       // ❌ 避免
   ```

2. **添加错误处理**
   ```javascript
   try {
     const result = await window.electronAPI.invokeMain('action', data);
   } catch (error) {
     console.error('操作失败:', error);
   }
   ```

3. **及时清理监听器**
   ```javascript
   const handler = () => { /* ... */ };
   Message.on('event', handler);
   
   // 不再需要时
   Message.off('event', handler);
   ```

4. **为频繁事件进行防抖**
   ```javascript
   let timeout;
   Message.on('frequent:event', () => {
     clearTimeout(timeout);
     timeout = setTimeout(handleEvent, 100);
   });
   ```

### ❌ 避免做法

1. **在事件处理中执行重操作**
   ```javascript
   // ❌ 不好
   Message.on('event', () => {
     heavyComputation();
   });
   
   // ✅ 好
   Message.on('event', debounce(heavyComputation, 500));
   ```

2. **忘记取消监听导致内存泄漏**
   ```javascript
   // ❌ 不好 - 多次运行会多次监听
   initializeComponent();
   Message.on('event', handler);
   
   // ✅ 好 - 先清理再监听
   const handler = () => { /* ... */ };
   Message.off('event', handler);
   Message.on('event', handler);
   ```

3. **直接传递大对象**
   ```javascript
   // ❌ 不好
   Message.emit('event', largeObject);
   
   // ✅ 好 - 只传递必要数据
   Message.emit('event', {
     id: largeObject.id,
     key: largeObject.key
   });
   ```

## 性能优化建议

1. **使用 once 代替 on + off**
   ```javascript
   Message.once('event', handler);  // ✅ 更高效
   ```

2. **避免监听无用事件**
   ```javascript
   // 定期审查监听列表，移除未使用的监听器
   ```

3. **为频繁事件添加防抖**
   ```javascript
   let timeout;
   Message.on('move', () => {
     clearTimeout(timeout);
     timeout = setTimeout(updateUI, 16);
   });
   ```

4. **使用事件委托**
   ```javascript
   // 而不是为每个元素添加监听器
   document.addEventListener('click', (e) => {
     if (e.target.classList.contains('tool')) {
       Message.emit('tool:clicked', { tool: e.target.id });
     }
   });
   ```

## 调试技巧

### 在 Console 中监视所有事件

```javascript
// 在 message.js 的 emit 方法中添加
const originalEmit = bus.emit;
bus.emit = function(name, ...args) {
  console.log(`📤 [Event] ${name}:`, args);
  return originalEmit.call(this, name, ...args);
};
```

### 监视 IPC 通信

```javascript
// 在 main.js 中
ipcMain.handle('message', async (event, channel, data) => {
  console.log(`[IPC] ← ${channel}:`, data);
  const result = await handleRequest(channel, data);
  console.log(`[IPC] → ${channel}:`, result);
  return result;
});
```

### 在 DevTools 中调试

1. 按 F12 打开开发者工具
2. 在 Console 标签页中执行 JavaScript
3. 监视事件和 IPC 消息
4. 使用 breakpoints 逐步调试

## 常见问题

**Q: 事件监听器没有被触发？**
A: 检查事件名称拼写、确保发送方和接收方使用相同的事件名

**Q: 内存持续增长？**
A: 检查是否有未清理的监听器，在组件卸载时调用 `off`

**Q: IPC 通信超时？**
A: 检查主进程的 handle 处理程序是否正确实现，确保返回值

**Q: 无法从主进程获取数据？**
A: 使用 `invokeMain` 而不是 `sendToMain`，确保返回 Promise

## 后续拓展

1. **添加事件过滤器** - 根据条件选择性监听
2. **实现事件优先级** - 控制事件处理顺序
3. **添加事件重试机制** - 处理 IPC 失败情况
4. **实现事件持久化** - 保存关键事件日志
5. **添加性能监控** - 追踪事件处理耗时
