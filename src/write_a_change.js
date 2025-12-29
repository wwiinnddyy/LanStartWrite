// write_a_change.js
// Provides cross-module helpers for updating settings and requesting file writes via Message bus.
import Message, { EVENTS } from './message.js';
import Settings from './setting.js';

export function updateAppSettings(partial){
  const merged = Settings.saveSettings(partial);
  try{ Message.emit(EVENTS.SETTINGS_CHANGED, merged); }catch(e){}
  return merged;
}

export function requestFileWrite(path, content){
  try{ Message.emit(EVENTS.REQUEST_FILE_WRITE, { path, content }); }catch(e){ console.warn('requestFileWrite emit failed', e); }
}

export default { updateAppSettings, requestFileWrite };
