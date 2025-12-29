# 快速开始指南

## 🚀 5 分钟快速入门

### 第一步：理解基本概念

本项目包含两层通信系统：

1. **事件总线** - 同一进程内模块间通信
2. **IPC 通信** - 主进程和渲染进程间通信

### 第二步：模块间通信（事件总线）

#### 基本使用

```javascript
import Message, { EVENTS } from './message.js';

// 发送事件
Message.emit(EVENTS.TOOLBAR_MOVE, { left: 100, top: 200 });

// 监听事件
Message.on(EVENTS.TOOLBAR_MOVE, (data) => {
  console.log('工具栏移动到:', data.left, data.top);
});

// 一次性监听
Message.once(EVENTS.SUBMENU_OPEN, (data) => {
  console.log('菜单首次打开');
});

// 取消监听
const handler = (data) => { /* ... */ };
Message.on(EVENTS.TOOLBAR_MOVE, handler);
Message.off(EVENTS.TOOLBAR_MOVE, handler);
```

#### 常用事件

| 事件 | 何时触发 | 示例数据 |
|------|---------|---------|
| `TOOLBAR_MOVE` | 工具栏拖动时 | `{left: 100, top: 200}` |
| `SUBMENU_OPEN` | 菜单打开时 | `{id: 'colorMenu', pinned: false}` |
| `SUBMENU_CLOSE` | 菜单关闭时 | `{id: 'colorMenu'}` |

### 第三步：进程间通信（IPC）

#### 从渲染进程调用主进程

```javascript
// 异步调用（推荐）
try {
  const result = await window.electronAPI.invokeMain('get-info');
  console.log('应用版本:', result.appVersion);
} catch (error) {
  console.error('调用失败:', error);
}
```

#### 在主进程处理请求

```javascript
ipcMain.handle('get-info', async (event) => {
  return {
    appVersion: app.getVersion(),
    platform: process.platform
  };
});
```

#### 主进程发送消息给渲染进程

```javascript
// 在主进程中
mainWindow.webContents.send('file-saved', {
  path: '/path/to/file.json'
});

// 在渲染进程中接收
window.electronAPI.onReplyFromMain('file-saved', (data) => {
  console.log('文件已保存到:', data.path);
});
```

## 🎯 常见任务

### 任务 1: 清空页面后切换为笔模式

已在 `ui-tools.js` 中实现：

```javascript
if (clearBtn) clearBtn.addEventListener('click', ()=>{
  clearAll();                                    // 清空画布
  setErasing(false);                             // 切换为笔模式 ✨
  if (eraserTool) eraserTool.classList.remove('active');
  updatePenModeLabel();
  updateEraserModeLabel();
});
```

### 任务 2: 添加自定义事件

在 `message.js` 中添加事件常量：

```javascript
export const EVENTS = {
  // ... 现有事件
  MY_CUSTOM_EVENT: 'my:custom:event'  // 新增
};
```

发送和监听：

```javascript
// 发送
Message.emit(EVENTS.MY_CUSTOM_EVENT, { data: 'value' });

// 监听
Message.on(EVENTS.MY_CUSTOM_EVENT, (data) => {
  console.log('自定义事件触发:', data);
});
```

### 任务 3: 保存画布到文件

```javascript
// 渲染进程
async function save() {
  const result = await window.electronAPI.invokeMain('save-canvas', {
    content: getCanvasData(),
    filename: 'drawing.json'
  });
  console.log('已保存到:', result.filePath);
}

// 主进程 (main.js)
ipcMain.handle('save-canvas', async (event, data) => {
  const fs = require('fs');
  const filePath = '/path/to/' + data.filename;
  fs.writeFileSync(filePath, JSON.stringify(data.content));
  return { filePath };
});
```

### 任务 4: 防抖处理频繁事件

```javascript
let timeout;
Message.on(EVENTS.TOOLBAR_MOVE, () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    updateToolbarUI();
  }, 100); // 100ms 后执行
});
```

### 任务 5: 监听一次性事件

```javascript
Message.once('app:initialized', () => {
  console.log('应用初始化完成（仅此一次）');
  setupUI();
});

// 应用初始化完成时发送
Message.emit('app:initialized');
```

## 📚 进阶学习

| 想要... | 查看文件 |
|--------|---------|
| 快速查询 API | `COMMUNICATION_QUICK_REF.md` |
| 详细文档 | `COMMUNICATION.md` |
| 集成指南 | `INTEGRATION_GUIDE.md` |
| 代码示例 | `communication-examples.js` |
| 实现细节 | `IMPLEMENTATION_SUMMARY.md` |

## ⚡ 性能提示

```javascript
// ❌ 不要：创建大量监听器
for (let i = 0; i < 1000; i++) {
  Message.on('event', handler);
}

// ✅ 应该：使用事件委托
Message.on('event', (data) => {
  if (data.id === targetId) {
    handleEvent(data);
  }
});

// ❌ 不要：监听无用事件
Message.on('every-mouse-move', handler);

// ✅ 应该：使用防抖
let timeout;
Message.on('every-mouse-move', () => {
  clearTimeout(timeout);
  timeout = setTimeout(handler, 50);
});
```

## 🐛 调试技巧

### 在 Console 打印所有事件

```javascript
// 在浏览器开发者工具中
Message.emit = (function(original) {
  return function(name, ...args) {
    console.log('📤 Event:', name, args);
    return original.call(this, name, ...args);
  };
})(Message.emit);
```

### 监视特定事件

```javascript
const originalOn = Message.on;
Message.on = function(name, callback) {
  if (name === 'EVENTS.TOOLBAR_MOVE') {
    console.log('🔍 监听工具栏移动事件');
  }
  return originalOn.call(this, name, callback);
};
```

### 测试事件是否被触发

```javascript
let triggered = false;
Message.once('test:event', () => {
  triggered = true;
  console.log('✅ 事件被触发');
});

Message.emit('test:event');
console.assert(triggered, '事件未触发');
```

## ❓ 常见问题

**Q: 我如何添加新事件？**
A: 在 `message.js` 的 `EVENTS` 对象中添加，然后 `Message.emit()` 和 `Message.on()` 使用它。

**Q: 如何避免内存泄漏？**
A: 使用 `Message.off()` 取消监听，特别是在模块卸载时。

**Q: IPC 调用出错怎么办？**
A: 使用 try-catch 包裹 `invokeMain()`，检查主进程的错误日志。

**Q: 可以监听多个事件吗？**
A: 可以，为每个事件调用一次 `Message.on()`。

**Q: once 和 on 有什么区别？**
A: `once` 仅响应一次后自动取消，`on` 一直监听直到手动调用 `off`。

## 📋 检查清单

- [ ] 理解事件总线概念
- [ ] 理解 IPC 通信概念
- [ ] 能使用 `Message.on/emit`
- [ ] 能使用 `invokeMain` 调用主进程
- [ ] 理解如何添加自定义事件
- [ ] 了解内存泄漏防护
- [ ] 可以运行基本示例代码

## 🎓 下一步

1. **运行示例** - 查看 `communication-examples.js` 中的代码示例
2. **深入学习** - 阅读 `COMMUNICATION.md` 了解高级用法
3. **实践应用** - 在自己的代码中尝试使用通信系统
4. **性能优化** - 参考 `INTEGRATION_GUIDE.md` 的优化建议

## 📞 获取帮助

- 查看 `COMMUNICATION.md` 的 FAQ 部分
- 参考 `communication-examples.js` 中的类似示例
- 检查控制台的错误日志
- 使用开发者工具进行调试

---

**祝你使用愉快！** 🎉

如有问题，请参考完整的文档。每个文档都有相应的使用场景说明。
