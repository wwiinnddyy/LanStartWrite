const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let _overlayInteractiveRects = [];
let _overlayIgnoreConfig = { ignore: false, forward: false };
let _overlayLastApplied = null;
let _overlayPollTimer = null;

function _applyIgnoreMouse(ignore, forward) {
  if (!mainWindow) return;
  const key = `${ignore ? 1 : 0}:${forward ? 1 : 0}`;
  if (_overlayLastApplied === key) return;
  _overlayLastApplied = key;
  if (ignore) mainWindow.setIgnoreMouseEvents(true, { forward: !!forward });
  else mainWindow.setIgnoreMouseEvents(false);
}

function _shouldAllowOverlayInteraction() {
  if (!mainWindow) return false;
  const rects = Array.isArray(_overlayInteractiveRects) ? _overlayInteractiveRects : [];
  if (rects.length === 0) return false;
  const winBounds = mainWindow.getBounds();
  const p = screen.getCursorScreenPoint();
  const px = p.x;
  const py = p.y;
  for (const r of rects) {
    const left = winBounds.x + (Number(r.left) || 0);
    const top = winBounds.y + (Number(r.top) || 0);
    const width = Number(r.width) || 0;
    const height = Number(r.height) || 0;
    if (width <= 0 || height <= 0) continue;
    const right = left + width;
    const bottom = top + height;
    if (px >= left && px <= right && py >= top && py <= bottom) return true;
  }
  return false;
}

function _ensureOverlayPoll() {
  if (_overlayPollTimer) return;
  _overlayPollTimer = setInterval(() => {
    try {
      if (!_overlayIgnoreConfig.ignore) return;
      if (!_overlayIgnoreConfig.forward) return;
      if (!mainWindow) return;
      const allow = _shouldAllowOverlayInteraction();
      if (allow) _applyIgnoreMouse(false, false);
      else _applyIgnoreMouse(true, true);
    } catch (e) {}
  }, 30);
}

function _stopOverlayPoll() {
  if (!_overlayPollTimer) return;
  try { clearInterval(_overlayPollTimer); } catch (e) {}
  _overlayPollTimer = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  try{ mainWindow.setAlwaysOnTop(true, 'screen-saver'); }catch(e){}
  try{ mainWindow.maximize(); }catch(e){}
  
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

ipcMain.on('overlay:set-ignore-mouse', (event, payload) => {
  try{
    if (!mainWindow) return;
    const ignore = !!(payload && payload.ignore);
    const forward = !!(payload && payload.forward);
    _overlayIgnoreConfig = { ignore, forward };
    _applyIgnoreMouse(ignore, forward);
    if (ignore && forward) _ensureOverlayPoll();
    else _stopOverlayPoll();
  }catch(err){
    console.warn('overlay:set-ignore-mouse failed', err);
  }
});

ipcMain.on('overlay:set-interactive-rects', (event, payload) => {
  try {
    const rects = payload && Array.isArray(payload.rects) ? payload.rects : [];
    _overlayInteractiveRects = rects
      .map((r) => ({
        left: Number(r && r.left) || 0,
        top: Number(r && r.top) || 0,
        width: Number(r && r.width) || 0,
        height: Number(r && r.height) || 0
      }))
      .filter((r) => r.width > 0 && r.height > 0);
    if (_overlayIgnoreConfig && _overlayIgnoreConfig.ignore && _overlayIgnoreConfig.forward) _ensureOverlayPoll();
  } catch (e) {}
});

ipcMain.on('app:close', () => {
  try{
    if (mainWindow) mainWindow.close();
    else app.quit();
  }catch(e){
    try{ app.quit(); }catch(err){}
  }
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
