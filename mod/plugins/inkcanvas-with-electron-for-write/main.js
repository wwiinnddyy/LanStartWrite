Mod.on('init', (ctx) => {
  const pluginId = (ctx && ctx.pluginId) || 'inkcanvas-with-electron-for-write';

  Mod.registerTool({
    id: 'inkcanvas-pen',
    title: 'InkCanvas 画笔',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>'
  });

  Mod.registerTool({
    id: 'inkcanvas-eraser',
    title: 'InkCanvas 橡皮擦',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z"/><path d="M17 17L7 7"/></svg>'
  });

  Mod.registerTool({
    id: 'inkcanvas-layers',
    title: '图层管理',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>'
  });

  Mod.registerMode({
    id: 'inkcanvas-mode',
    title: 'InkCanvas 模式',
    ui: {
      kind: 'html',
      html: `<div style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <div style="font-weight:600;font-size:16px">InkCanvas 高级书写模式</div>
        <div style="font-size:13px;opacity:0.75;color:#666">增强型书写控件，支持压力感应和图层管理</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px">压力感应:</span>
            <span id="pressure-status" style="font-size:13px;font-weight:500">已启用</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px">当前图层:</span>
            <span id="layer-status" style="font-size:13px;font-weight:500">图层 1</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px">笔触数量:</span>
            <span id="stroke-count" style="font-size:13px;font-weight:500">0</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button data-mod-plugin="${pluginId}" data-mod-action="toggle-pressure" class="mode-btn">切换压力感应</button>
          <button data-mod-plugin="${pluginId}" data-mod-action="add-layer" class="mode-btn">新建图层</button>
          <button data-mod-plugin="${pluginId}" data-mod-action="clear-layer" class="mode-btn">清空当前图层</button>
          <button data-mod-plugin="${pluginId}" data-mod-action="close" class="mode-btn">关闭</button>
        </div>
      </div>`
    }
  });

  Mod.subscribe('public/inkcanvas-ready');
  Mod.subscribe('public/stroke-added');
  Mod.subscribe('public/layer-changed');
});

Mod.on('tool', (e) => {
  const toolId = e && e.toolId;
  if (!toolId) return;

  if (toolId === 'inkcanvas-pen') {
    Mod.publish('inkcanvas-with-electron-for-write/tool', { tool: 'pen' });
    Mod.showOverlay({
      kind: 'html',
      html: `<div style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <div style="font-weight:600;font-size:16px">InkCanvas 画笔工具</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:13px">笔刷大小:</label>
            <input type="range" id="brush-size" min="1" max="50" value="4" style="flex:1">
            <span id="brush-size-value" style="font-size:13px;width:30px">4</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:13px">压力系数:</label>
            <input type="range" id="pressure-factor" min="0" max="100" value="50" style="flex:1">
            <span id="pressure-factor-value" style="font-size:13px;width:30px">0.5</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:13px">笔刷颜色:</label>
            <input type="color" id="brush-color" value="#000000" style="width:40px;height:30px">
            <span id="brush-color-value" style="font-size:13px">#000000</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="apply-pen-settings" class="mode-btn">应用设置</button>
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="close" class="mode-btn">关闭</button>
        </div>
      </div>`
    });
  } else if (toolId === 'inkcanvas-eraser') {
    Mod.publish('inkcanvas-with-electron-for-write/tool', { tool: 'eraser' });
    Mod.showOverlay({
      kind: 'html',
      html: `<div style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <div style="font-weight:600;font-size:16px">InkCanvas 橡皮擦工具</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:13px">橡皮大小:</label>
            <input type="range" id="eraser-size" min="5" max="100" value="20" style="flex:1">
            <span id="eraser-size-value" style="font-size:13px;width:30px">20</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:13px">橡皮模式:</label>
            <select id="eraser-mode" style="flex:1;padding:4px">
              <option value="pixel">像素擦除</option>
              <option value="stroke">笔画擦除</option>
              <option value="rect">矩形擦除</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="apply-eraser-settings" class="mode-btn">应用设置</button>
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="close" class="mode-btn">关闭</button>
        </div>
      </div>`
    });
  } else if (toolId === 'inkcanvas-layers') {
    Mod.showOverlay({
      kind: 'html',
      html: `<div style="display:flex;flex-direction:column;gap:12px;padding:16px">
        <div style="font-weight:600;font-size:16px">图层管理</div>
        <div id="layer-list" style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto">
          <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f5f5f5;border-radius:4px">
            <input type="checkbox" checked disabled style="margin:0">
            <span style="font-size:13px;flex:1">图层 1</span>
            <span style="font-size:11px;opacity:0.6">可见</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="add-layer" class="mode-btn">新建图层</button>
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="delete-layer" class="mode-btn">删除图层</button>
          <button data-mod-plugin="inkcanvas-with-electron-for-write" data-mod-action="close" class="mode-btn">关闭</button>
        </div>
      </div>`
    });
  }
});

Mod.on('ui', (e) => {
  const action = e && e.action;
  const value = e && e.value;

  if (action === 'close') {
    Mod.closeOverlay();
    return;
  }

  if (action === 'toggle-pressure') {
    Mod.publish('inkcanvas-with-electron-for-write/pressure-toggle', {});
  }

  if (action === 'add-layer') {
    Mod.publish('inkcanvas-with-electron-for-write/layer-add', {});
  }

  if (action === 'clear-layer') {
    Mod.publish('inkcanvas-with-electron-for-write/layer-clear', {});
  }

  if (action === 'delete-layer') {
    Mod.publish('inkcanvas-with-electron-for-write/layer-delete', {});
  }

  if (action === 'apply-pen-settings') {
    const brushSize = document.getElementById('brush-size')?.value || 4;
    const pressureFactor = document.getElementById('pressure-factor')?.value || 50;
    const brushColor = document.getElementById('brush-color')?.value || '#000000';
    Mod.publish('inkcanvas-with-electron-for-write/pen-settings', {
      brushSize: Number(brushSize),
      pressureFactor: Number(pressureFactor) / 100,
      brushColor: String(brushColor)
    });
  }

  if (action === 'apply-eraser-settings') {
    const eraserSize = document.getElementById('eraser-size')?.value || 20;
    const eraserMode = document.getElementById('eraser-mode')?.value || 'pixel';
    Mod.publish('inkcanvas-with-electron-for-write/eraser-settings', {
      eraserSize: Number(eraserSize),
      eraserMode: String(eraserMode)
    });
  }
});

Mod.on('bus', (e) => {
  const topic = e && e.topic;
  const payload = e && e.payload;

  if (topic === 'public/inkcanvas-ready') {
    console.log('[InkCanvas Plugin] InkCanvas ready:', payload);
  }

  if (topic === 'public/stroke-added') {
    console.log('[InkCanvas Plugin] Stroke added:', payload);
  }

  if (topic === 'public/layer-changed') {
    console.log('[InkCanvas Plugin] Layer changed:', payload);
  }
});
