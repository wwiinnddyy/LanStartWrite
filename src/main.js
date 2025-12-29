const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
