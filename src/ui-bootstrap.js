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
