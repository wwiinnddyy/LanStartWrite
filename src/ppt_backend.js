const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let edge;
try {
  edge = require('edge-js');
} catch (e) {
  console.error('edge-js not found. PPT linkage will not work.');
}

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('ws (websocket) not found. PPT linkage server will not start.');
}

const PPT_COM_PATH = path.join(__dirname, 'officeLink', 'inkeys_PPTLink', 'PptCOM.cs');

let pptInvoke;
let wss;
let lastStatus = null;
let statusInterval;

/**
 * 初始化 PPT 联动后端
 */
function init(broadcast) {
  if (!edge) return;

  try {
    // 编译并加载 PptCOM.cs
    pptInvoke = edge.func({
      source: fs.readFileSync(PPT_COM_PATH, 'utf8'),
      references: [
        'System.Windows.Forms.dll',
        'System.Drawing.dll',
        'Microsoft.Office.Interop.PowerPoint.dll'
      ],
      typeName: 'PptCOM.EdgeBridge',
      methodName: 'Invoke'
    });

    // 初始化 PPT COM 服务
    pptInvoke({ action: 'init' }, (err, res) => {
      if (err) console.error('PPT Init Error:', err);
      else console.log('PPT COM Service Initialized:', res);
    });

    // 启动 WebSocket 服务器
    if (WebSocket) {
      wss = new WebSocket.Server({ port: 8081 });
      console.log('PPT WebSocket server started on port 8081');

      wss.on('connection', (ws) => {
        console.log('New client connected to PPT controller');
        ws.isAlive = true;
        
        // 发送当前状态
        if (lastStatus) {
          ws.send(JSON.stringify({ type: 'status', data: lastStatus }));
        }

        ws.on('message', (message) => {
          try {
            const payload = JSON.parse(message);
            handleClientMessage(payload, ws);
          } catch (e) {
            console.error('Failed to parse client message:', e);
          }
        });

        ws.on('close', () => {
          console.log('Client disconnected');
        });

        // 心跳响应
        ws.on('pong', () => {
          ws.isAlive = true;
        });
      });

      // 心跳检测逻辑
      const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws) => {
          if (ws.isAlive === false) return ws.terminate();
          ws.isAlive = false;
          ws.ping();
        });
      }, 30000);

      wss.on('close', () => clearInterval(heartbeatInterval));
    }

    // 定期轮询 PPT 状态并推送
    statusInterval = setInterval(updatePptStatus, 1000);

  } catch (e) {
    console.error('Failed to initialize PPT backend:', e);
  }
}

/**
 * 更新并推送 PPT 状态
 */
function updatePptStatus() {
  if (!pptInvoke) return;

  pptInvoke({ action: 'getStatus' }, (err, res) => {
    if (err) {
      console.error('GetStatus Error:', err);
      return;
    }

    // 检查状态是否有变化，或者是否需要定期心跳同步
    if (!lastStatus || 
        lastStatus.currentPage !== res.currentPage || 
        lastStatus.totalPage !== res.totalPage ||
        lastStatus.notes !== res.notes) {
      
      lastStatus = res;
      broadcastStatus(res);
    }
  });
}

/**
 * 向所有客户端广播状态
 */
function broadcastStatus(status) {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'status', data: status });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * 处理客户端发送的控制指令
 */
function handleClientMessage(payload, ws) {
  if (!pptInvoke) return;

  const { action, page } = payload;
  console.log('Action received:', action, page);

  pptInvoke({ action, page }, (err, res) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    } else {
      // 指令执行成功，立即触发一次状态更新以同步所有客户端
      updatePptStatus();
    }
  });
}

module.exports = { init };
