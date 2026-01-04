// ui-bootstrap.js — load UI fragments then start app modules
async function loadFragment(key){
  try{
    let txt = '';
    try{
      if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function'){
        const o = await window.electronAPI.invokeMain('message', 'mod:get-fragment-override', { key: String(key || '') });
        if (o && typeof o.content === 'string' && o.content.trim()) txt = o.content;
      }
    }catch(e){}
    if (!txt) {
      const resp = await fetch(key);
      if (!resp.ok) throw new Error('fetch failed');
      txt = await resp.text();
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = txt;
    // return children to be appended
    return Array.from(wrapper.children);
  }catch(e){ console.warn('loadFragment', key, e); return []; }
}

async function runUnitTests(){
  const prior = localStorage.getItem('appSettings');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assert'); };
  const eq = (a, b, msg) => { if (a !== b) throw new Error(msg || `expected ${String(b)} got ${String(a)}`); };
  try{
    try{ localStorage.removeItem('appSettings'); }catch(e){}
    const SettingsMod = await import('./setting.js');
    const MessageMod = await import('./message.js');
    const WriteMod = await import('./write_a_change.js');
    const Settings = SettingsMod.default;
    const { buildPenColorSettingsPatch, getPenColorFromSettings, normalizeHexColor } = SettingsMod;
    const Message = MessageMod.default;
    const { EVENTS } = MessageMod;
    const { updateAppSettings } = WriteMod;

    {
      const s = Settings.loadSettings();
      assert(typeof s === 'object' && s, 'loadSettings returns object');
      assert(typeof s.annotationPenColor === 'string', 'annotationPenColor exists');
      assert(typeof s.whiteboardPenColor === 'string', 'whiteboardPenColor exists');
    }

    {
      Settings.resetSettings();
      updateAppSettings({ annotationPenColor: '#AABBCC' });
      updateAppSettings({ whiteboardPenColor: '#112233' });
      const s = Settings.loadSettings();
      eq(getPenColorFromSettings(s, 'annotation'), '#AABBCC', 'annotation color persisted');
      eq(getPenColorFromSettings(s, 'whiteboard'), '#112233', 'whiteboard color persisted');
    }

    {
      Settings.resetSettings();
      const p1 = buildPenColorSettingsPatch('annotation', 'ff00ff');
      const p2 = buildPenColorSettingsPatch('whiteboard', '#00ff00');
      const merged = updateAppSettings(Object.assign({}, p1, p2));
      eq(getPenColorFromSettings(merged, 'annotation'), '#FF00FF', 'annotation patch ok');
      eq(getPenColorFromSettings(merged, 'whiteboard'), '#00FF00', 'whiteboard patch ok');
    }

    {
      let last = null;
      const off = Message.on(EVENTS.SETTINGS_CHANGED, (p) => { last = p; });
      const merged = updateAppSettings({ annotationPenColor: '#010203' });
      try{ off(); }catch(e){}
      assert(last && typeof last === 'object', 'SETTINGS_CHANGED emitted');
      eq(String(last.annotationPenColor).toUpperCase(), '#010203', 'event payload has updated color');
      eq(String(merged.annotationPenColor).toUpperCase(), '#010203', 'merged has updated color');
    }

    {
      eq(normalizeHexColor('#a1b2c3', '#000000'), '#A1B2C3');
      eq(normalizeHexColor('A1B2C3', '#000000'), '#A1B2C3');
      eq(normalizeHexColor('bad', '#000000'), '#000000');
    }

    {
      document.body.dataset.appMode = 'annotation';
      const toolBtn = document.createElement('button');
      toolBtn.id = 'colorTool';
      document.body.appendChild(toolBtn);

      const menu = document.createElement('div');
      menu.id = 'colorMenu';
      menu.className = 'submenu colors open';
      const size = document.createElement('input');
      size.id = 'size';
      size.type = 'range';
      size.min = '1';
      size.max = '50';
      size.value = '4';
      menu.appendChild(size);
      const colors = ['#ffffff','#000000','#FF0000','#0000FF','#ff3b30','#ff9500','#ffcc00','#34c759','#007aff','#5856d6'];
      const buttons = colors.map((c)=>{
        const b = document.createElement('button');
        b.className = 'color';
        b.dataset.color = c;
        menu.appendChild(b);
        return b;
      });
      document.body.appendChild(menu);

      const Renderer = await import('./renderer.js');
      const Pen = await import('./pen.js');
      Pen.initPenUI();

      document.body.dataset.appMode = 'annotation';
      for (const btn of buttons) {
        const raw = String(btn.dataset.color || '');
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const expected = normalizeHexColor(raw, '#FF0000');
        eq(String(Renderer.getToolState().brushColor).toUpperCase(), expected, `annotation brushColor ${raw}`);
        const s = Settings.loadSettings();
        eq(getPenColorFromSettings(s, 'annotation'), expected, `annotation persisted ${raw}`);
        assert(btn.classList.contains('selected'), `selected class ${raw}`);
        eq(btn.getAttribute('aria-pressed'), 'true', `aria-pressed ${raw}`);
      }

      document.body.dataset.appMode = 'whiteboard';
      for (const btn of buttons) {
        const raw = String(btn.dataset.color || '');
        btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
        const expected = normalizeHexColor(raw, '#000000');
        eq(String(Renderer.getToolState().brushColor).toUpperCase(), expected, `whiteboard brushColor ${raw}`);
        const s = Settings.loadSettings();
        eq(getPenColorFromSettings(s, 'whiteboard'), expected, `whiteboard persisted ${raw}`);
        assert(btn.classList.contains('selected'), `selected class whiteboard ${raw}`);
        eq(btn.getAttribute('aria-pressed'), 'true', `aria-pressed whiteboard ${raw}`);
      }

      document.body.dataset.appMode = 'annotation';
      buttons[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.body.dataset.appMode = 'whiteboard';
      buttons[7].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const sFinal = Settings.loadSettings();
      eq(getPenColorFromSettings(sFinal, 'annotation'), normalizeHexColor(colors[5], '#FF0000'), 'mode color isolated (annotation)');
      eq(getPenColorFromSettings(sFinal, 'whiteboard'), normalizeHexColor(colors[7], '#000000'), 'mode color isolated (whiteboard)');

      toolBtn.remove();
      menu.remove();
    }

    {
      Settings.resetSettings();
      const SettingsNow = Settings.loadSettings();
      const { applyModeCanvasBackground } = await import('./mode_background.js');
      const Renderer = await import('./renderer.js');

      Renderer.setBrushColor('#000000');
      applyModeCanvasBackground('whiteboard', 'black', { getToolState: Renderer.getToolState, replaceStrokeColors: Renderer.replaceStrokeColors, setBrushColor: Renderer.setBrushColor, getPreferredPenColor: (mode)=>getPenColorFromSettings(SettingsNow, mode) });
      eq(String(Renderer.getToolState().brushColor).toUpperCase(), '#FFFFFF', 'auto pen switches when preference default');

      updateAppSettings({ whiteboardPenColor: '#34C759' });
      Renderer.setBrushColor('#000000');
      const s2 = Settings.loadSettings();
      applyModeCanvasBackground('whiteboard', 'black', { getToolState: Renderer.getToolState, replaceStrokeColors: Renderer.replaceStrokeColors, setBrushColor: Renderer.setBrushColor, getPreferredPenColor: (mode)=>getPenColorFromSettings(s2, mode) });
      eq(String(Renderer.getToolState().brushColor).toUpperCase(), '#000000', 'custom preference blocks auto switch');

      updateAppSettings({ whiteboardPenColor: '#FFFFFF' });
      Renderer.setBrushColor('#FFFFFF');
      const s3 = Settings.loadSettings();
      applyModeCanvasBackground('whiteboard', 'black', { getToolState: Renderer.getToolState, replaceStrokeColors: Renderer.replaceStrokeColors, setBrushColor: Renderer.setBrushColor, getPreferredPenColor: (mode)=>getPenColorFromSettings(s3, mode) });
      eq(String(Renderer.getToolState().brushColor).toUpperCase(), '#FFFFFF', 'explicit white preserved');
    }

    {
      document.body.innerHTML = '';
      document.body.dataset.appMode = 'whiteboard';

      const board = document.createElement('canvas');
      board.id = 'board';
      document.body.appendChild(board);

      const panel = document.createElement('div');
      panel.className = 'floating-panel';
      document.body.appendChild(panel);

      const dragHandle = document.createElement('div');
      dragHandle.id = 'dragHandle';
      panel.appendChild(dragHandle);

      const toolSection = document.createElement('div');
      toolSection.className = 'panel-section tools';
      panel.appendChild(toolSection);

      const addTool = (id)=>{
        const wrap = document.createElement('div');
        wrap.className = 'tool';
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = 'tool-btn';
        wrap.appendChild(btn);
        toolSection.appendChild(wrap);
        return btn;
      };

      addTool('pointerTool');
      addTool('colorTool');
      addTool('eraserTool');
      addTool('moreTool');
      addTool('exitTool');
      addTool('collapseTool');
      addTool('undo');
      addTool('redo');

      const colorMenu = document.createElement('div');
      colorMenu.id = 'colorMenu';
      colorMenu.className = 'submenu colors';
      colorMenu.dataset.pinned = 'false';
      colorMenu.setAttribute('aria-hidden', 'true');
      const size = document.createElement('input');
      size.id = 'size';
      size.type = 'range';
      size.value = '4';
      colorMenu.appendChild(size);
      const penLabel = document.createElement('div');
      penLabel.id = 'penModeLabel';
      colorMenu.appendChild(penLabel);
      panel.appendChild(colorMenu);

      const eraserMenu = document.createElement('div');
      eraserMenu.id = 'eraserMenu';
      eraserMenu.className = 'submenu actions';
      eraserMenu.dataset.pinned = 'false';
      eraserMenu.setAttribute('aria-hidden', 'true');
      const eraserSize = document.createElement('input');
      eraserSize.id = 'eraserSize';
      eraserSize.type = 'range';
      eraserSize.value = '20';
      eraserMenu.appendChild(eraserSize);
      const eraserLabel = document.createElement('div');
      eraserLabel.id = 'eraserModeLabel';
      eraserMenu.appendChild(eraserLabel);
      const clear = document.createElement('button');
      clear.id = 'clear';
      eraserMenu.appendChild(clear);
      panel.appendChild(eraserMenu);

      const moreMenu = document.createElement('div');
      moreMenu.id = 'moreMenu';
      moreMenu.className = 'submenu actions';
      moreMenu.dataset.pinned = 'false';
      moreMenu.setAttribute('aria-hidden', 'true');
      const exportBtn = document.createElement('button');
      exportBtn.id = 'exportBtn';
      moreMenu.appendChild(exportBtn);
      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'settingsBtn';
      moreMenu.appendChild(settingsBtn);
      const pluginManagerBtn = document.createElement('button');
      pluginManagerBtn.id = 'pluginManagerBtn';
      moreMenu.appendChild(pluginManagerBtn);
      const aboutBtn = document.createElement('button');
      aboutBtn.id = 'aboutBtn';
      moreMenu.appendChild(aboutBtn);
      const closeWhiteboardBtn = document.createElement('button');
      closeWhiteboardBtn.id = 'closeWhiteboardBtn';
      moreMenu.appendChild(closeWhiteboardBtn);
      panel.appendChild(moreMenu);

      const settingsModal = document.createElement('div');
      settingsModal.id = 'settingsModal';
      settingsModal.className = 'settings-modal';
      const settingsBackdrop = document.createElement('div');
      settingsBackdrop.className = 'settings-backdrop';
      settingsModal.appendChild(settingsBackdrop);
      const closeSettings = document.createElement('button');
      closeSettings.id = 'closeSettings';
      settingsModal.appendChild(closeSettings);
      document.body.appendChild(settingsModal);

      const aboutModal = document.createElement('div');
      aboutModal.id = 'aboutModal';
      aboutModal.className = 'settings-modal';
      const aboutBackdrop = document.createElement('div');
      aboutBackdrop.className = 'settings-backdrop';
      aboutModal.appendChild(aboutBackdrop);
      const closeAbout = document.createElement('button');
      closeAbout.id = 'closeAbout';
      aboutModal.appendChild(closeAbout);
      document.body.appendChild(aboutModal);

      await import('./ui-tools.js');

      const moreTool = document.getElementById('moreTool');
      assert(!!moreTool, 'moreTool exists');

      for (let i = 0; i < 12; i++) {
        moreTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const open = moreMenu.classList.contains('open');
        eq(moreMenu.getAttribute('aria-hidden'), open ? 'false' : 'true', 'moreMenu aria-hidden tracks open');
      }

      for (let i = 0; i < 12; i++) {
        moreTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(moreMenu.classList.contains('open'), 'moreMenu opened');
        settingsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(settingsModal.classList.contains('open'), 'settingsModal opened');
        closeSettings.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(!settingsModal.classList.contains('open'), 'settingsModal closed');

        moreTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(moreMenu.classList.contains('open'), 'moreMenu opened again');
        aboutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(aboutModal.classList.contains('open'), 'aboutModal opened');
        closeAbout.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        assert(!aboutModal.classList.contains('open'), 'aboutModal closed');
      }

      moreTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert(moreMenu.classList.contains('open'), 'moreMenu opened for outside-close');
      board.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert(!moreMenu.classList.contains('open'), 'outside click closes moreMenu');
    }

    {
      const invoke = async (ch, payload) => {
        if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') throw new Error('ipc unavailable');
        return await window.electronAPI.invokeMain('message', String(ch || ''), payload);
      };

      const Mod = (await import('./mod.js')).default;

      const mkDomId = (pluginId, toolId) => `mod-tool-${pluginId}-${toolId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

      const u = await invoke('tests:create-unsigned-lanmod', {
        id: 'unsigned.test',
        name: 'Unsigned Test',
        version: '1.0.0',
        permissions: ['ui:toolbar'],
        mainJs: `Mod.on('init', ()=>{ Mod.registerTool({ id:'hello', title:'Unsigned' }); });`
      });
      assert(u && u.success && u.path, 'created unsigned lanmod');
      const ins = await Mod.install(String(u.path));
      assert(ins && ins.success, 'install unsigned lanmod');
      await Mod.reload();

      for (let i = 0; i < 40; i++) {
        const btn = document.getElementById(mkDomId('unsigned.test', 'hello'));
        if (btn) break;
        await new Promise(r => setTimeout(r, 25));
      }
      assert(!!document.getElementById(mkDomId('unsigned.test', 'hello')), 'unsigned plugin tool button created');

      const b = await invoke('tests:create-unsigned-lanmod', {
        id: 'broken.test',
        name: 'Broken Test',
        version: '1.0.0',
        permissions: ['ui:toolbar'],
        mainJs: `export const x = ;`
      });
      assert(b && b.success && b.path, 'created broken lanmod');
      const ins2 = await Mod.install(String(b.path));
      assert(ins2 && ins2.success, 'install broken lanmod');
      await Mod.reload();

      for (let i = 0; i < 80; i++) {
        const list = await Mod.list();
        const installed = Array.isArray(list && list.installed) ? list.installed : [];
        const rec = installed.find((x) => x && x.id === 'broken.test');
        if (rec && rec.enabled === false) break;
        await new Promise(r => setTimeout(r, 25));
      }

      const list2 = await Mod.list();
      const installed2 = Array.isArray(list2 && list2.installed) ? list2.installed : [];
      const broken = installed2.find((x) => x && x.id === 'broken.test');
      assert(broken && broken.enabled === false, 'broken plugin auto-disabled');

      const rep = await invoke('audit:get-report', {});
      assert(rep && rep.success && rep.report && rep.report.stats, 'audit report available');
      const stats = rep.report.stats;
      assert(Number((stats.unsignedInstall && stats.unsignedInstall['unsigned.test']) || 0) >= 1, 'audit unsigned install recorded');
      assert(Number((stats.unsignedLoad && stats.unsignedLoad['unsigned.test']) || 0) >= 1, 'audit unsigned load recorded');
      assert(Number((stats.loadFailed && stats.loadFailed['broken.test']) || 0) >= 1, 'audit load failed recorded');
    }

    {
      const invoke = async (ch, payload) => {
        if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') throw new Error('ipc unavailable');
        return await window.electronAPI.invokeMain('message', String(ch || ''), payload);
      };

      const state = {
        format: 'cubenote-state',
        schemaVersion: 1,
        meta: { createdAt: 1700000000000, modifiedAt: 1700000001234 },
        activeDocKey: 'whiteboard',
        documents: {
          whiteboard: {
            ops: [{ type: 'stroke', color: '#000000', size: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
            history: [[{ type: 'stroke', color: '#000000', size: 4, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }]],
            historyIndex: 0,
            brushSize: 4,
            eraserSize: 20,
            brushColor: '#000000',
            erasing: false,
            eraserMode: 'pixel',
            view: { scale: 1, offsetX: 0, offsetY: 0 }
          },
          annotation: {
            ops: [],
            history: [[]],
            historyIndex: 0,
            brushSize: 4,
            eraserSize: 20,
            brushColor: '#FF0000',
            erasing: false,
            eraserMode: 'pixel',
            view: { scale: 1, offsetX: 0, offsetY: 0 }
          }
        }
      };

      const enc = await invoke('note:encode', { state });
      assert(enc && enc.success && typeof enc.xaml === 'string', 'note encode ok');
      assert(enc.xaml.includes('<Cubenote'), 'xaml root ok');

      const dec = await invoke('note:decode', { xaml: enc.xaml });
      assert(dec && dec.success, 'note decode ok');
      eq(dec.state && dec.state.format, 'cubenote-state', 'state format ok');
      eq(dec.state && dec.state.schemaVersion, 1, 'state schema ok');
      eq(JSON.stringify(dec.state && dec.state.documents && dec.state.documents.whiteboard && dec.state.documents.whiteboard.ops || []), JSON.stringify(state.documents.whiteboard.ops), 'ops preserved');

      const tamperedSha = enc.xaml.replace(/\bSha256="([a-fA-F0-9]{64})"/, (m, h) => {
        const first = String(h || '')[0] || '0';
        const repl = first.toLowerCase() === 'a' ? 'b' : 'a';
        return `Sha256="${repl}${String(h).slice(1)}"`;
      });
      const badSha = await invoke('note:decode', { xaml: tamperedSha });
      assert(badSha && badSha.success === false, 'note decode rejects tampered sha');
      eq(String(badSha.reason || ''), 'integrity_failed', 'note decode integrity_failed');

      const bad = await invoke('note:decode', { xaml: '<bad/>' });
      assert(bad && bad.success === false, 'note decode rejects invalid root');

      const incompatible = await invoke('note:decode', { xaml: '<Cubenote Version="2.0.0"><Payload Encoding="gzip+base64" Sha256="00"></Payload></Cubenote>' });
      assert(incompatible && incompatible.success === false, 'note decode rejects incompatible version');

      const tmp = await invoke('tests:get-temp-file', { ext: 'tmp', prefix: 'note' });
      assert(tmp && tmp.success && tmp.path, 'got temp file path');
      const exportRes = await invoke('note:export-cubenote', { path: String(tmp.path), state, requestId: `t-${Date.now()}` });
      assert(exportRes && exportRes.success && exportRes.path, 'export-cubenote ok');
      assert(String(exportRes.path).toLowerCase().endsWith('.cubenote'), 'export-cubenote normalizes extension');

      const importRes = await invoke('note:import-cubenote', { path: String(exportRes.path), requestId: `t-${Date.now()}-2` });
      assert(importRes && importRes.success && importRes.state, 'import-cubenote ok');
      eq(JSON.stringify(importRes.state), JSON.stringify(state), 'imported state equals exported state');

      const tmpBad = await invoke('tests:get-temp-file', { ext: 'cubenote', prefix: 'note-bad' });
      assert(tmpBad && tmpBad.success && tmpBad.path, 'got temp bad file path');
      const wr = await invoke('io:request-file-write', { path: String(tmpBad.path), content: '<bad/>' });
      assert(wr && wr.success, 'wrote bad file');
      const importBad = await invoke('note:import-cubenote', { path: String(tmpBad.path), requestId: `t-${Date.now()}-3` });
      assert(importBad && importBad.success === false, 'import-cubenote rejects invalid file');
    }
  }finally{
    try{
      if (prior === null) localStorage.removeItem('appSettings');
      else localStorage.setItem('appSettings', prior);
    }catch(e){}
  }
}

window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    const p = new URLSearchParams(location.search || '');
    if (p.get('runTests') === '1') {
      try{
        await runUnitTests();
        if (window && window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
          window.electronAPI.sendToMain('tests:result', { ok: true });
        }
      }catch(e){
        if (window && window.electronAPI && typeof window.electronAPI.sendToMain === 'function') {
          window.electronAPI.sendToMain('tests:result', { ok: false, error: String(e && e.stack ? e.stack : (e && e.message ? e.message : e)) });
        }
      }
      return;
    }
  }catch(e){}
  // load tool UI first (so .floating-panel exists)
  const toolNodes = await loadFragment('./tool_ui.html');
  toolNodes.forEach(n => document.body.appendChild(n));
  // then load submenus into the floating-panel so parent relations stay intact
  const moreNodes = await loadFragment('./more_decide_ui.html');
  const panel = document.querySelector('.floating-panel');
  if (panel) moreNodes.forEach(n => panel.appendChild(n)); else moreNodes.forEach(n => document.body.appendChild(n));
  // settings UI appended to body
  const settingsNodes = await loadFragment('./setting_ui.html');
  settingsNodes.forEach(n => document.body.appendChild(n));

  // now import main modules (renderer first, then ui-tools and page)
  try{ await import('./renderer.js'); }catch(e){ console.warn('import renderer failed', e); }
  // small IPC bridge to forward Message-based file write requests to main process
  try{ await import('./ipc_bridge.js'); }catch(e){ console.warn('import ipc_bridge failed', e); }
  try{ await import('./ui-tools.js'); }catch(e){ console.warn('import ui-tools failed', e); }
  try{ await import('./page.js'); }catch(e){ console.warn('import page failed', e); }
  try{ await import('./mod.js'); }catch(e){ console.warn('import mod failed', e); }

});
