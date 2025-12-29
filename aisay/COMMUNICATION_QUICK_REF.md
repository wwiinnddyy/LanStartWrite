# 通信系统快速参考

## 模块间通信 (EventEmitter)

### 导入
```javascript
import Message, { EVENTS } from './message.js';
```

### 核心 API

| 方法 | 用途 | 示例 |
|------|------|------|
| `on(name, fn)` | 订阅事件 | `Message.on(EVENTS.TOOLBAR_MOVE, handler)` |
| `off(name, fn)` | 取消订阅 | `Message.off(EVENTS.TOOLBAR_MOVE, handler)` |
| `emit(name, data)` | 发送事件 | `Message.emit(EVENTS.TOOLBAR_MOVE, {x:100})` |
| `once(name, fn)` | 仅监听一次 | `Message.once(EVENTS.SUBMENU_OPEN, handler)` |

### 内置事件

```javascript
SUBMENU_OPEN      // 'submenu:open'      - 子菜单打开
SUBMENU_CLOSE     // 'submenu:close'     - 子菜单关闭
SUBMENU_PIN       // 'submenu:pin'       - 子菜单钉住
SUBMENU_MOVE      // 'submenu:move'      - 子菜单移动
TOOLBAR_MOVE      // 'toolbar:move'      - 工具栏移动
```

## 进程间通信 (Electron IPC)

### 渲染进程 API (window.electronAPI)

```javascript
// 异步调用（推荐）
const result = await window.electronAPI.invokeMain(channel, data);

// 发送消息（无需回复）
window.electronAPI.sendToMain(channel, data);

// 监听回复
window.electronAPI.onReplyFromMain(channel, callback);

// 取消监听
window.electronAPI.removeListener(channel, callback);
```

### 主进程处理 (main.js)

```javascript
// 处理异步请求
ipcMain.handle('channel', async (event, data) => {
  // 处理逻辑
  return { success: true };
});

// 发送消息给渲染进程
mainWindow.webContents.send('channel', data);

// 监听消息
ipcMain.on('channel', (event, data) => {
  event.reply('reply-channel', response);
});
```

## 常用模式

### 模式 1: 发送与监听
```javascript
// 发送方
Message.emit('event:name', { key: 'value' });

// 接收方
Message.on('event:name', (data) => {
  console.log(data.key); // 'value'
});
```

### 模式 2: 防抖处理
```javascript
let timeout;
Message.on('frequent:event', () => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    // 延迟处理
  }, 100);
});
```

### 模式 3: 一次性操作
```javascript
Message.once('first:time:event', () => {
  console.log('仅执行一次');
});
```

### 模式 4: 清理监听器
```javascript
const handler = () => { /* ... */ };
Message.on('event:name', handler);
// 取消监听
Message.off('event:name', handler);
```

### 模式 5: 主进程与渲染进程通信
```javascript
// 渲染进程
try {
  const response = await window.electronAPI.invokeMain('action', data);
  console.log(response);
} catch (error) {
  console.error(error);
}

// 主进程
ipcMain.handle('action', async (event, data) => {
  // 处理请求
  return { success: true };
});
```

## 最佳实践

✅ **推荐**
- 使用事件常量而不是硬编码字符串
- 为异步操作使用 `invokeMain`
- 添加错误处理和超时控制
- 在组件卸载时取消监听器
- 为频繁事件进行防抖处理

❌ **避免**
- 在事件处理中进行重操作
- 监听器数量过多导致性能下降
- 忘记取消监听器导致内存泄漏
- 直接使用硬编码的事件字符串
- 阻塞主进程的长时间运算

## 添加新事件

1. 在 `message.js` 的 `EVENTS` 对象中添加常量：
```javascript
export const EVENTS = {
  // ... 现有事件
  MY_CUSTOM_EVENT: 'my:custom:event'
};
```

2. 在需要的地方发送：
```javascript
Message.emit(EVENTS.MY_CUSTOM_EVENT, data);
```

3. 在需要的地方监听：
```javascript
Message.on(EVENTS.MY_CUSTOM_EVENT, handler);
```

## 调试技巧

- 在控制台中打印所有事件：添加 `console.log` 到 `message.js` 的 `emit` 方法
- 使用 Chrome DevTools 的 Network 标签查看 IPC 消息
- 在 `main.js` 中添加日志记录所有 IPC 通信
- 使用 `Message.once` 测试事件是否被触发
