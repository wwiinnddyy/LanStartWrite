const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // 开发时打开开发者工具
  // mainWindow.webContents.openDevTools();
}

// 尝试优先使用 ANGLE (Direct3D) 来利用系统 GPU 驱动，可能改善绘制性能并降低 CPU/内存占用。
// 在某些 Windows 机器上这有助于偏向核显/集成显卡的渲染路径。
try {
  app.commandLine.appendSwitch('use-angle', 'd3d11');
} catch (e) {}

// 明确启用硬件加速（Electron 默认启用，但显式调用以表明意图）
try { app.enableHardwareAcceleration(); } catch (e) {}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * 旧版本 IPC 通信处理（向后兼容）
 */
ipcMain.on('fromRenderer', (event, arg) => {
  console.log('[IPC] 来自渲染进程:', arg);
  event.reply('fromMain', 'Pong: ' + arg);
});

/**
 * 新版本 IPC 通信处理
 * 处理异步消息请求
 */
ipcMain.handle('message', async (event, channel, data) => {
  console.log(`[IPC] 收到消息 (${channel}):`, data);
  
  // 根据不同的消息通道进行处理
  switch(channel) {
    case 'get-info':
      return {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: process.platform
      };
      
    case 'open-file':
      // 处理文件打开请求等
      return { success: true, message: '处理完成' };

    case 'io:request-file-write':
      // data: { path, content }
      try{
        // 限制写入到 app.getPath('userData') 下，或接受绝对路径
        const targetPath = data && data.path ? (path.isAbsolute(data.path) ? data.path : path.join(app.getPath('userData'), data.path)) : null;
        if (!targetPath) return { success: false, message: '缺少 path' };
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, data.content || '', 'utf8');
        return { success: true, path: targetPath };
      }catch(err){
        console.error('file write failed', err);
        return { success: false, error: String(err) };
      }
      
    default:
      return { success: true, data };
  }
});

/**
 * 同步消息处理
 * 处理来自渲染进程的同步请求
 */
ipcMain.on('sync-message', (event, channel, data) => {
  console.log(`[IPC] 收到同步消息 (${channel}):`, data);
  
  // 同步回复
  event.returnValue = {
    success: true,
    channel,
    timestamp: Date.now()
  };
});

/**
 * 广播消息给所有窗口
 * @param {string} channel - 消息通道
 * @param {*} data - 消息数据
 */
function broadcastMessage(channel, data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}
