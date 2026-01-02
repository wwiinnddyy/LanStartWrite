Mod.on('init', (ctx)=>{
  const pluginId = (ctx && ctx.pluginId) || 'demo.plugin';
  Mod.registerTool({ id: 'hello', title: 'Demo' });
  Mod.registerMode({
    id: 'demoMode',
    title: 'Demo 模式',
    ui: {
      kind: 'html',
      html: `<div style="display:flex;flex-direction:column;gap:10px">
        <div style="font-weight:600">Demo 模式已激活</div>
        <div style="font-size:12px;opacity:0.85">点击按钮向 public/bus 发送消息</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-mod-plugin="${pluginId}" data-mod-action="publish" class="mode-btn">Publish</button>
          <button data-mod-plugin="${pluginId}" data-mod-action="close" class="mode-btn">Close</button>
        </div>
      </div>`
    }
  });
  Mod.subscribe('public/app-mode-changed');
});

Mod.on('tool', (e)=>{
  const toolId = e && e.toolId;
  if (toolId !== 'hello') return;
  Mod.showOverlay({
    kind: 'html',
    html: `<div style="display:flex;flex-direction:column;gap:10px">
      <div style="font-weight:600">Demo 工具</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-mod-plugin="demo.plugin" data-mod-action="publish" class="mode-btn">Publish</button>
        <button data-mod-plugin="demo.plugin" data-mod-action="close" class="mode-btn">Close</button>
      </div>
    </div>`
  });
});

Mod.on('ui', (e)=>{
  const action = e && e.action;
  if (action === 'close') {
    Mod.closeOverlay();
    return;
  }
  if (action === 'publish') {
    Mod.publish('public/demo', { ts: Date.now(), from: 'demo.plugin' });
  }
});

Mod.on('bus', (e)=>{
  const topic = e && e.topic;
  if (topic === 'public/app-mode-changed') {
    Mod.publish('public/demo', { ts: Date.now(), from: 'demo.plugin', mode: (e && e.payload && e.payload.mode) || '' });
  }
});
