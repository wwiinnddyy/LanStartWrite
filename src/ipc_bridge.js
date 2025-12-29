// ipc_bridge.js — forward certain Message bus events to main process
import Message, { EVENTS } from './message.js';

// forward file write requests to main process
Message.on(EVENTS.REQUEST_FILE_WRITE, async (payload)=>{
  try{
    if (window && window.electronAPI && typeof window.electronAPI.invokeMain === 'function'){
      const res = await window.electronAPI.invokeMain('message', 'io:request-file-write', payload);
      try{ Message.emit('io:request-file-write:result', res); }catch(e){}
    } else {
      console.warn('ipc_bridge: electronAPI.invokeMain not available');
    }
  }catch(e){ console.warn('ipc_bridge forward failed', e); }
});

// also listen for settings changed -> no-op here; renderer modules already handle via Message
export default {};
