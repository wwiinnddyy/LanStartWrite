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
      const PdfMod = await import('./pdf_viewer.js');
      const { resolvePdfOpenMode } = PdfMod;
      Settings.resetSettings();
      let s = Settings.loadSettings();
      eq(resolvePdfOpenMode(undefined, s), 'window', 'default pdf mode window');
      updateAppSettings({ pdfDefaultMode: 'fullscreen' });
      s = Settings.loadSettings();
      eq(resolvePdfOpenMode(undefined, s), 'fullscreen', 'setting pdfDefaultMode applied');
      eq(resolvePdfOpenMode('window', s), 'window', 'explicit string param window');
      eq(resolvePdfOpenMode('fullscreen', s), 'fullscreen', 'explicit string param fullscreen');
      eq(resolvePdfOpenMode({ mode: 'fullscreen' }, s), 'fullscreen', 'object param fullscreen');
    }

    {
      const el = document.createElement('div');
      el.className = 'settings-loading';
      el.hidden = true;
      document.body.appendChild(el);
      const disp = String(getComputedStyle(el).display || '');
      assert(disp === 'none', `settings-loading hidden display none (got ${disp})`);
      el.remove();
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
      const tools = document.createElement('div');
      tools.className = 'panel-section tools';
      panel.appendChild(tools);
      const makeTool = (id)=>{
        const wrap = document.createElement('div');
        wrap.className = 'tool';
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = 'tool-btn';
        wrap.appendChild(btn);
        tools.appendChild(wrap);
        return btn;
      };
      const pointerTool = makeTool('pointerTool');
      const colorTool = makeTool('colorTool');
      const eraserTool = makeTool('eraserTool');
      const moreTool = makeTool('moreTool');
      const exitTool = makeTool('exitTool');
      const collapseTool = makeTool('collapseTool');
      const undoBtn = makeTool('undoBtn');
      const redoBtn = makeTool('redoBtn');
      const colorMenu = document.createElement('div');
      colorMenu.id = 'colorMenu';
      colorMenu.className = 'submenu colors';
      colorMenu.dataset.pinned = 'false';
      colorMenu.setAttribute('aria-hidden','true');
      panel.appendChild(colorMenu);
      const eraserMenu = document.createElement('div');
      eraserMenu.id = 'eraserMenu';
      eraserMenu.className = 'submenu actions';
      eraserMenu.dataset.pinned = 'false';
      eraserMenu.setAttribute('aria-hidden','true');
      panel.appendChild(eraserMenu);
      const moreMenu = document.createElement('div');
      moreMenu.id = 'moreMenu';
      moreMenu.className = 'submenu actions';
      moreMenu.dataset.pinned = 'false';
      moreMenu.setAttribute('aria-hidden','true');
      panel.appendChild(moreMenu);
      const pinBtn = document.createElement('button');
      pinBtn.className = 'submenu-pin';
      moreMenu.appendChild(pinBtn);
      const MainTool = await import('./main_tool.js');
      let pointerCalls = 0;
      let applyCalls = 0;
      let rectCalls = 0;
      let inst = null;
      inst = MainTool.initMainTool({
        onPointerToggle: ()=>{
          pointerCalls++;
          throw new Error('simulated-crash');
        },
        onApplyInteractivity: ()=>{
          applyCalls++;
        },
        onScheduleRects: ()=>{
          rectCalls++;
        },
        onColorOpen: ({ button, menu })=>{
          assert(button === colorTool, 'colorOpen button ok');
          assert(menu === colorMenu, 'colorOpen menu ok');
        },
        onEraserOpen: ({ button, menu })=>{
          assert(button === eraserTool, 'eraserOpen button ok');
          assert(menu === eraserMenu, 'eraserOpen menu ok');
        },
        onMoreOpen: ({ button, menu })=>{
          assert(button === moreTool, 'moreOpen button ok');
          assert(menu === moreMenu, 'moreOpen menu ok');
        },
        onCollapseChanged: (collapsed)=>{
          if (collapsed) panel.classList.add('collapsed'); else panel.classList.remove('collapsed');
        },
        getInitialCollapsed: ()=>{
          return false;
        },
        onGlobalClickOutside: ()=>{
          if (inst) inst.closeAllSubmenus();
        },
        onEscape: ()=>{
          if (inst) inst.closeAllSubmenus();
        }
      });
      pointerTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert(pointerCalls === 1, 'pointer crash isolated');
      assert(applyCalls >= 1 && rectCalls >= 1, 'apply and rect callbacks invoked');
      colorTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      eraserTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      moreTool.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      inst.showSubmenu(moreMenu, moreTool);
      assert(moreMenu.classList.contains('open'), 'moreMenu opened via showSubmenu');
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      assert(!moreMenu.classList.contains('open'), 'outside click closes moreMenu via main_tool');
      const perf = MainTool.measureToolbarRenderPerf();
      assert(perf && typeof perf.totalMs === 'number' && perf.totalMs >= 0, 'measureToolbarRenderPerf totalMs non-negative');
      assert(perf && typeof perf.count === 'number' && perf.count >= 0, 'measureToolbarRenderPerf count non-negative');
      MainTool.simulateCrashIsolation();
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

      document.body.dataset.appMode = 'whiteboard';
      try{ delete document.body.dataset.pdfMode; }catch(e){}
      Message.emit(EVENTS.SETTINGS_CHANGED, { kind: 'pdf_viewer_opened', mode: 'window', path: 'file:///dummy.pdf' });
      eq(document.body.dataset.appMode, 'annotation', 'pdf viewer switches to annotation mode');
      eq(document.body.dataset.pdfMode, '1', 'pdf viewer sets pdf-mode flag');
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

    {
      document.body.innerHTML = '<div class="canvas-wrap"><canvas id="board"></canvas></div>';
      const toolNodes = await loadFragment('./tool_ui.html');
      toolNodes.forEach(n => document.body.appendChild(n));
      const moreNodes = await loadFragment('./more_decide_ui.html');
      const panel = document.querySelector('.floating-panel');
      if (panel) moreNodes.forEach(n => panel.appendChild(n)); else moreNodes.forEach(n => document.body.appendChild(n));
      const settingsNodes = await loadFragment('./setting_ui.html');
      settingsNodes.forEach(n => document.body.appendChild(n));

      const Ui = await import(`./ui-tools.js?tabsTest=${Date.now()}`);

      const tab = document.querySelector('.settings-tab[data-tab="appearance"]') || document.querySelector('.settings-tab[data-tab="input"]');
      assert(!!tab, 'settings tab exists');
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const waitRaf = ()=>new Promise(r => {
        try{
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(()=>r());
          else setTimeout(()=>r(), 16);
        }catch(e){ setTimeout(()=>r(), 16); }
      });
      await new Promise(r => setTimeout(r, 120));
      await waitRaf();
      await waitRaf();
      eq(tab.getAttribute('aria-selected'), 'true', 'tab click selects');
      const panelId = String(tab.getAttribute('aria-controls') || '');
      const page = panelId ? document.getElementById(panelId) : null;
      assert(!!page && page.hidden === false, 'tab click shows page');
      eq(page.getAttribute('aria-hidden'), 'false', 'tab click aria-hidden false');

      const loading = document.querySelector('.settings-loading');
      assert(!!loading, 'settings-loading exists');
      const disp = String(getComputedStyle(loading).display || '');
      assert(disp === 'none', `settings-loading hidden after load (got ${disp})`);

      const root = document.documentElement;
      const anyToolBtn = document.querySelector('.tool-btn');
      assert(!!anyToolBtn, 'tool-btn exists for style regression');

      try{ if (Ui && typeof Ui.setDesignLanguage === 'function') Ui.setDesignLanguage('material3'); }catch(e){}
      await waitRaf();
      await waitRaf();
      const md3ToolStyle = getComputedStyle(anyToolBtn);
      assert(String(md3ToolStyle.borderTopWidth || '') === '0px', `md3 tool-btn border removed (got ${md3ToolStyle.borderTopWidth})`);
      assert(Number(md3ToolStyle.opacity || 0) <= 0.65 && Number(md3ToolStyle.opacity || 0) >= 0.5, `md3 tool-btn opacity ok (got ${md3ToolStyle.opacity})`);
      const md3FilledBtn = document.querySelector('.md3-button.filled');
      assert(!!md3FilledBtn, 'md3 filled button exists');
      const md3FilledStyle = getComputedStyle(md3FilledBtn);
      eq(String(md3FilledStyle.backgroundColor || ''), 'rgb(0, 90, 193)', `md3 filled button bg primary (got ${md3FilledStyle.backgroundColor})`);

      try{ if (Ui && typeof Ui.setDesignLanguage === 'function') Ui.setDesignLanguage('fluent'); }catch(e){}
      await waitRaf();
      await waitRaf();
      const fluentToolStyle = getComputedStyle(anyToolBtn);
      assert(String(fluentToolStyle.borderTopWidth || '') === '1px', `fluent tool-btn border restored (got ${fluentToolStyle.borderTopWidth})`);
      assert(String(fluentToolStyle.backgroundColor || '').includes('0.86') || String(fluentToolStyle.backgroundColor || '').includes('rgba(255, 255, 255'), `fluent tool-btn background restored (got ${fluentToolStyle.backgroundColor})`);
      const fluentFilledStyle = getComputedStyle(md3FilledBtn);
      assert(String(fluentFilledStyle.backgroundColor || '') !== 'rgb(0, 90, 193)', `fluent md3 filled not styled as md3 (got ${fluentFilledStyle.backgroundColor})`);

      try{ root.classList.add('theme-dark'); }catch(e){}
      await waitRaf();

      const submenuModeBtn = document.getElementById('settingsBtn');
      assert(!!submenuModeBtn, 'submenu mode button exists');
      const st0 = getComputedStyle(submenuModeBtn);
      eq(String(st0.backgroundColor || ''), 'rgb(18, 18, 18)', `dark submenu bg is #121212 (got ${st0.backgroundColor})`);
      eq(String(st0.color || ''), 'rgb(255, 255, 255)', `dark submenu fg is #FFFFFF (got ${st0.color})`);

      submenuModeBtn.setAttribute('data-force-hover', 'true');
      await waitRaf();
      const stHover = getComputedStyle(submenuModeBtn);
      assert(String(stHover.boxShadow || '').includes('0.1') || String(stHover.boxShadow || '').includes('0.10'), `dark submenu hover overlay 10% (got ${stHover.boxShadow})`);
      submenuModeBtn.removeAttribute('data-force-hover');
      submenuModeBtn.setAttribute('data-force-active', 'true');
      await waitRaf();
      const stActive = getComputedStyle(submenuModeBtn);
      assert(String(stActive.boxShadow || '').includes('0.14'), `dark submenu active overlay (got ${stActive.boxShadow})`);
      submenuModeBtn.removeAttribute('data-force-active');
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

  try{
    const p = new URLSearchParams(location.search || '');
    const standalone = String(p.get('standalone') || '');
    if (standalone === 'settings') {
      try{ document.body.classList.add('standalone-window'); }catch(e){}
      try{ document.title = '设置 - LanStartWrite'; }catch(e){}
      const settingsNodes = await loadFragment('./setting_ui.html');
      settingsNodes.forEach(n => document.body.appendChild(n));

      try{
        const about = document.getElementById('aboutModal');
        if (about && about.parentElement) about.parentElement.removeChild(about);
      }catch(e){}
      try{
        const plugin = document.getElementById('pluginModal');
        if (plugin && plugin.parentElement) plugin.parentElement.removeChild(plugin);
      }catch(e){}

      const SettingsMod = await import('./setting.js');
      const Settings = SettingsMod.default;
      const { normalizeHexColor } = SettingsMod;
      const ColorsMod = await import('./colors_features.js');
      const { applyThemeMode } = ColorsMod;

      function applyDesignLanguage(name){
        try{
          const root = document.documentElement;
          const v = (String(name || '') === 'material3') ? 'material3' : 'fluent';
          const nextCls = v === 'material3' ? 'dl-md3' : 'dl-fluent';
          const prev = root.classList.contains(nextCls);
          root.classList.remove('dl-md3','dl-fluent');
          root.classList.add(nextCls);
          try{ root.dataset.designLanguage = v; }catch(e){}
          return !prev;
        }catch(e){}
        return false;
      }

      function _ensureToast(){
        let t = document.querySelector('.app-toast');
        if (!t) {
          t = document.createElement('div');
          t.className = 'app-toast';
          document.body.appendChild(t);
        }
        return t;
      }

      function showToast(msg, type='success', ms=1800){
        const t = _ensureToast();
        t.textContent = msg;
        t.classList.remove('success','error');
        t.classList.add(type);
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(t._hideT);
        t._hideT = setTimeout(()=>{ t.classList.remove('show'); }, ms);
      }

      function applyTheme(name, settingsOverride){
        try{
          const s = (settingsOverride && typeof settingsOverride === 'object') ? settingsOverride : Settings.loadSettings();
          applyThemeMode(String(name || (s && s.theme) || 'system'), s, document.documentElement);
        }catch(e){}
      }

      function applyTooltips(show){
        try{
          document.querySelectorAll('.tool-btn, .mode-btn, .submenu-drag-handle, .submenu-pin, button').forEach(el=>{
            if (!el.dataset.origTitle) el.dataset.origTitle = el.getAttribute('title') || '';
            if (show) el.setAttribute('title', el.dataset.origTitle || ''); else el.setAttribute('title','');
          });
        }catch(e){}
      }

      function applyVisualStyle(style){
        try{
          const root = document.documentElement;
          ['visual-solid','visual-blur','visual-transparent'].forEach(c=>root.classList.remove(c));
          if (!style || style === 'blur') root.classList.add('visual-blur');
          else if (style === 'solid') root.classList.add('visual-solid');
          else if (style === 'transparent') root.classList.add('visual-transparent');
        }catch(e){}
      }

      let _lastTouchActionAt = 0;
      function bindTouchTap(el, onTap, opts){
        if (!el || typeof onTap !== 'function') return;
        const delayMs = (opts && typeof opts.delayMs === 'number') ? Math.max(0, opts.delayMs) : 20;
        const moveThreshold = (opts && typeof opts.moveThreshold === 'number') ? Math.max(0, opts.moveThreshold) : 8;
        let down = null;
        let moved = false;

        function clear(){
          down = null;
          moved = false;
        }

        el.addEventListener('pointerdown', (e)=>{
          if (!e || e.pointerType !== 'touch') return;
          _lastTouchActionAt = Date.now();
          down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
          moved = false;
          try{ if (el.setPointerCapture) el.setPointerCapture(e.pointerId); }catch(err){}
        }, { passive: true });

        el.addEventListener('pointermove', (e)=>{
          if (!down || !e || e.pointerId !== down.id) return;
          const dx = (e.clientX - down.x);
          const dy = (e.clientY - down.y);
          if ((dx*dx + dy*dy) > (moveThreshold*moveThreshold)) moved = true;
        }, { passive: true });

        el.addEventListener('pointerup', (e)=>{
          if (!down || !e || e.pointerId !== down.id) return;
          const tUp = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const elapsed = tUp - down.t;
          const shouldFire = !moved;
          const delay = Math.max(0, delayMs - elapsed);
          const ev = e;
          clear();
          try{ if (el.releasePointerCapture) el.releasePointerCapture(ev.pointerId); }catch(err){}
          if (!shouldFire) return;
          _lastTouchActionAt = Date.now();
          try{ ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation(); }catch(err){}
          setTimeout(()=>{ try{ onTap(ev); }catch(err){} }, delay);
        });

        el.addEventListener('pointercancel', (e)=>{
          if (!down || !e || e.pointerId !== down.id) return;
          clear();
          try{ if (el.releasePointerCapture) el.releasePointerCapture(e.pointerId); }catch(err){}
        });

        el.addEventListener('click', (e)=>{
          if (Date.now() - _lastTouchActionAt < 400) {
            try{ e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); }catch(err){}
          }
        }, true);
      }

      function _broadcastSettings(merged){
        try{
          if (!window || !window.electronAPI || typeof window.electronAPI.invokeMain !== 'function') return;
          window.electronAPI.invokeMain('message', 'ui:broadcast-settings', { settings: merged });
        }catch(e){}
      }

      const settingsModal = document.getElementById('settingsModal');
      const settingsContent = settingsModal ? settingsModal.querySelector('.settings-content') : null;
      const settingsLoading = settingsModal ? settingsModal.querySelector('.settings-loading') : null;
      const settingsTabButtons = settingsModal ? Array.from(settingsModal.querySelectorAll('.settings-tab')) : [];
      const settingsPages = settingsModal ? Array.from(settingsModal.querySelectorAll('.settings-page')) : [];
      const closeSettings = document.getElementById('closeSettings');
      const saveSettings = document.getElementById('saveSettings');
      const resetSettingsBtn = document.getElementById('resetSettings');
      const optAutoResize = document.getElementById('optAutoResize');
      const optCollapsed = document.getElementById('optCollapsed');
      const optTheme = document.getElementById('optTheme');
      const optDesignLanguage = document.getElementById('optDesignLanguage');
      const optTooltips = document.getElementById('optTooltips');
      const optMultiTouchPen = document.getElementById('optMultiTouchPen');
      const optAnnotationPenColor = document.getElementById('optAnnotationPenColor');
      const optSmartInk = document.getElementById('optSmartInk');
      const optVisualStyle = document.getElementById('optVisualStyle');
      const optCanvasColor = document.getElementById('optCanvasColor');
      const keyUndo = document.getElementById('keyUndo');
      const keyRedo = document.getElementById('keyRedo');
      const previewSettingsBtn = document.getElementById('previewSettings');
      const revertPreviewBtn = document.getElementById('revertPreview');

      function _setSettingsLoading(loading){
        const on = !!loading;
        try{ if (settingsContent) settingsContent.setAttribute('aria-busy', on ? 'true' : 'false'); }catch(e){}
        try{
          if (settingsLoading) {
            if (on) { settingsLoading.hidden = false; settingsLoading.setAttribute('aria-hidden', 'false'); }
            else { settingsLoading.hidden = true; settingsLoading.setAttribute('aria-hidden', 'true'); }
          }
        }catch(e){}
      }

      const _SETTINGS_TAB_STORAGE_KEY = 'settingsSelectedTab';
      function _readPersistedSettingsTab(){
        try{
          const v = localStorage.getItem(_SETTINGS_TAB_STORAGE_KEY);
          return v ? String(v) : '';
        }catch(e){ return ''; }
      }

      function _writePersistedSettingsTab(tab){
        try{ localStorage.setItem(_SETTINGS_TAB_STORAGE_KEY, String(tab || '')); }catch(e){}
      }

      function _getFirstSettingsTab(){
        const t = settingsTabButtons && settingsTabButtons[0] ? String(settingsTabButtons[0].dataset.tab || '') : '';
        return t || 'general';
      }

      function _normalizeSettingsTab(tab){
        const t = String(tab || '');
        if (!t) return _getFirstSettingsTab();
        if (!settingsTabButtons || !settingsTabButtons.length) return t;
        const ok = settingsTabButtons.some(b => String(b.dataset.tab || '') === t);
        return ok ? t : _getFirstSettingsTab();
      }

      const _settingsLoadedTabs = new Set();
      if (settingsPages && settingsPages.length) {
        for (const p of settingsPages) {
          const tab = String(p.dataset.tab || '');
          if (!tab) continue;
          _settingsLoadedTabs.add(tab);
        }
      }

      const _settingsPageHideTimers = new WeakMap();
      function _activateSettingsPage(page){
        if (!page) return;
        const t = _settingsPageHideTimers.get(page);
        if (t) { clearTimeout(t); _settingsPageHideTimers.delete(page); }
        try{ page.hidden = false; }catch(e){}
        try{ page.setAttribute('aria-hidden', 'false'); }catch(e){}
        requestAnimationFrame(()=>{ try{ page.classList.add('active'); }catch(e){} });
      }

      function _deactivateSettingsPage(page){
        if (!page) return;
        try{ page.classList.remove('active'); }catch(e){}
        try{ page.setAttribute('aria-hidden', 'true'); }catch(e){}
        const timer = setTimeout(()=>{ try{ page.hidden = true; }catch(e){} }, 320);
        _settingsPageHideTimers.set(page, timer);
      }

      function _renderSettingsTab(tab){
        const sel = _normalizeSettingsTab(tab);
        if (settingsTabButtons && settingsTabButtons.length) {
          for (const btn of settingsTabButtons) {
            const t = String(btn.dataset.tab || '');
            const active = t === sel;
            try{ btn.setAttribute('aria-selected', active ? 'true' : 'false'); }catch(e){}
            try{ btn.tabIndex = active ? 0 : -1; }catch(e){}
          }
        }
        if (settingsPages && settingsPages.length) {
          for (const p of settingsPages) {
            const t = String(p.dataset.tab || '');
            if (!t) continue;
            if (t === sel) _activateSettingsPage(p);
            else _deactivateSettingsPage(p);
          }
        }
      }

      function _loadSettingsTabAsync(tab){
        const t = String(tab || '');
        if (!t) return Promise.resolve();
        if (_settingsLoadedTabs.has(t)) return Promise.resolve();
        _setSettingsLoading(true);
        return new Promise((resolve)=>{
          setTimeout(()=>{
            _settingsLoadedTabs.add(t);
            _setSettingsLoading(false);
            resolve();
          }, 80);
        });
      }

      function _selectSettingsTab(tab, opts){
        const t = _normalizeSettingsTab(tab);
        _writePersistedSettingsTab(t);
        _renderSettingsTab(t);
        _loadSettingsTabAsync(t).then(()=>{}).catch(()=>{ _setSettingsLoading(false); });
        const o = opts && typeof opts === 'object' ? opts : {};
        if (o.focus) {
          try{
            const btn = settingsModal ? settingsModal.querySelector(`.settings-tab[data-tab="${t}"]`) : null;
            if (btn) btn.focus();
          }catch(e){}
        }
      }

      let _previewBackup = null;

      function _readForm(){
        const patch = {};
        if (optAutoResize) patch.enableAutoResize = !!optAutoResize.checked;
        if (optCollapsed) patch.toolbarCollapsed = !!optCollapsed.checked;
        if (optTheme) patch.theme = String(optTheme.value || 'light');
        if (optDesignLanguage) patch.designLanguage = String(optDesignLanguage.value || 'fluent');
        if (optVisualStyle) patch.visualStyle = String(optVisualStyle.value || 'blur');
        if (optCanvasColor) patch.canvasColor = String(optCanvasColor.value || 'white');
        if (optTooltips) patch.showTooltips = !!optTooltips.checked;
        if (optMultiTouchPen) patch.multiTouchPen = !!optMultiTouchPen.checked;
        if (optSmartInk) patch.smartInkRecognition = !!optSmartInk.checked;
        if (optAnnotationPenColor) patch.annotationPenColor = normalizeHexColor(optAnnotationPenColor.value, '#FF0000');
        patch.shortcuts = {
          undo: keyUndo && typeof keyUndo.value === 'string' ? keyUndo.value.trim() : '',
          redo: keyRedo && typeof keyRedo.value === 'string' ? keyRedo.value.trim() : ''
        };
        return patch;
      }

      function _applyToForm(settings){
        const s = settings && typeof settings === 'object' ? settings : {};
        try{
          if (optAutoResize) optAutoResize.checked = !!s.enableAutoResize;
          if (optCollapsed) optCollapsed.checked = !!s.toolbarCollapsed;
          if (optTheme) optTheme.value = s.theme || 'light';
          if (optDesignLanguage) optDesignLanguage.value = s.designLanguage || 'fluent';
          if (optVisualStyle) optVisualStyle.value = s.visualStyle || 'blur';
          if (optCanvasColor) optCanvasColor.value = s.canvasColor || 'white';
          if (optTooltips) optTooltips.checked = typeof s.showTooltips !== 'undefined' ? !!s.showTooltips : true;
          if (optMultiTouchPen) optMultiTouchPen.checked = !!s.multiTouchPen;
          if (optSmartInk) optSmartInk.checked = !!s.smartInkRecognition;
          if (optAnnotationPenColor) optAnnotationPenColor.value = normalizeHexColor(s.annotationPenColor, '#FF0000');
          if (keyUndo) keyUndo.value = s.shortcuts && typeof s.shortcuts.undo === 'string' ? s.shortcuts.undo : '';
          if (keyRedo) keyRedo.value = s.shortcuts && typeof s.shortcuts.redo === 'string' ? s.shortcuts.redo : '';
        }catch(e){}
      }

      function _saveAndBroadcast(patch){
        const merged = Settings.saveSettings(patch);
        try{
          if (patch && typeof patch === 'object') {
            if (typeof patch.designLanguage !== 'undefined') {
              const changed = applyDesignLanguage(String(merged.designLanguage || 'fluent'));
              if (changed) showToast(`已切换：${String(merged.designLanguage || '') === 'material3' ? 'Material 3 Expressive' : 'Fluent'}`, 'success', 1600);
            }
            if (typeof patch.theme !== 'undefined') applyTheme(String(merged.theme || 'system'), merged);
            if (typeof patch.showTooltips !== 'undefined') applyTooltips(!!merged.showTooltips);
            if (typeof patch.visualStyle !== 'undefined') applyVisualStyle(String(merged.visualStyle || 'blur'));
          }
        }catch(e){}
        _broadcastSettings(merged);
        return merged;
      }

      function _wireRealtime(el){
        if (!el) return;
        const handler = ()=>{
          const patch = _readForm();
          _saveAndBroadcast(patch);
        };
        el.addEventListener('change', handler);
        el.addEventListener('input', handler);
      }

      [optAutoResize,optCollapsed,optTheme,optDesignLanguage,optVisualStyle,optCanvasColor,optTooltips,optMultiTouchPen,optSmartInk,optAnnotationPenColor,keyUndo,keyRedo].forEach(_wireRealtime);

      if (settingsTabButtons && settingsTabButtons.length) {
        for (const btn of settingsTabButtons) {
          btn.addEventListener('click', ()=>{
            const t = String(btn.dataset.tab || '');
            if (!t) return;
            _selectSettingsTab(t, { focus: false });
          });
          bindTouchTap(btn, ()=>{
            const t = String(btn.dataset.tab || '');
            if (!t) return;
            _selectSettingsTab(t, { focus: true });
          }, { delayMs: 20 });
        }
      }

      if (saveSettings) saveSettings.addEventListener('click', ()=>{ _saveAndBroadcast(_readForm()); });
      if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', ()=>{
        Settings.resetSettings();
        const merged = Settings.loadSettings();
        _applyToForm(merged);
        applyDesignLanguage(merged.designLanguage || 'fluent');
        applyTheme(merged.theme || 'system', merged);
        applyTooltips(typeof merged.showTooltips !== 'undefined' ? !!merged.showTooltips : true);
        applyVisualStyle(merged.visualStyle || 'blur');
        _broadcastSettings(merged);
      });
      if (closeSettings) closeSettings.addEventListener('click', ()=>{ try{ window.close(); }catch(e){} });

      if (previewSettingsBtn) previewSettingsBtn.addEventListener('click', ()=>{
        const s = Settings.loadSettings();
        if (!_previewBackup) _previewBackup = Object.assign({}, s);
        const preview = _readForm();
        applyDesignLanguage(preview.designLanguage || s.designLanguage);
        applyTheme(preview.theme || s.theme, Object.assign({}, s, preview));
        applyTooltips(typeof preview.showTooltips !== 'undefined' ? !!preview.showTooltips : !!s.showTooltips);
        applyVisualStyle(preview.visualStyle || s.visualStyle);
      });

      if (revertPreviewBtn) revertPreviewBtn.addEventListener('click', ()=>{
        if (_previewBackup) {
          applyDesignLanguage(_previewBackup.designLanguage || 'fluent');
          applyTheme(_previewBackup.theme || 'system', _previewBackup);
          applyTooltips(typeof _previewBackup.showTooltips !== 'undefined' ? !!_previewBackup.showTooltips : true);
          applyVisualStyle(_previewBackup.visualStyle || 'blur');
          _previewBackup = null;
        }
      });

      const initial = Settings.loadSettings();
      _setSettingsLoading(false);
      _applyToForm(initial);
      applyDesignLanguage(initial.designLanguage || 'fluent');
      applyTheme(initial.theme || 'system', initial);
      applyTooltips(typeof initial.showTooltips !== 'undefined' ? !!initial.showTooltips : true);
      applyVisualStyle(initial.visualStyle || 'blur');
      _selectSettingsTab(_readPersistedSettingsTab() || _getFirstSettingsTab(), { focus: false });
      if (settingsModal) {
        try{ settingsModal.classList.add('open'); }catch(e){}
        try{ settingsModal.setAttribute('aria-hidden','false'); }catch(e){}
      }
      try{ _broadcastSettings(initial); }catch(e){}
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
