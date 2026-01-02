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

window.addEventListener('DOMContentLoaded', async ()=>{
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
